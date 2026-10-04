// prop-firm-rules: drawdown / daily-loss calculator. MIT License. https://github.com/kburrus64-max/prop-firm-rules
// Pure calculation helpers for the prop-firm rules checker. No DOM access, so they run in Node tests too.
// All money values are in account currency. See data/firms.json "vocabulary" for the rule vocabulary.

export const STATUS = { GREEN: 'green', AMBER: 'amber', RED: 'red' };
// Thresholds on "room left as a share of the limit amount".
export const AMBER_AT = 0.5; // <= 50% of the allowance left -> amber
export const RED_AT = 0.2;   // <= 20% left (or breached) -> red

const num = (v, fallback = NaN) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? fallback : Number(v));

/** Dollar amount of a rule for a given account size / initial balance. */
export function ruleAmount(rule, { size, initial, reference }) {
  if (!rule) return null;
  if (rule.amountBySize) {
    const a = rule.amountBySize[String(size)];
    return a === undefined ? null : Number(a);
  }
  if (rule.amount !== undefined) return Number(rule.amount);
  if (rule.pct !== undefined) {
    const base = rule.amountBase === 'reference' ? reference : initial;
    return (rule.pct / 100) * base;
  }
  return null;
}

/** Classify a limit by room left versus its allowance. */
export function classify(room, amount) {
  if (amount === null || amount === undefined || !(amount > 0)) return null;
  if (room <= 0) return STATUS.RED;
  const left = room / amount;
  if (left <= RED_AT) return STATUS.RED;
  if (left <= AMBER_AT) return STATUS.AMBER;
  return STATUS.GREEN;
}

const RANK = { green: 0, amber: 1, red: 2 };
export const worst = (...s) => s.filter(Boolean).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), STATUS.GREEN);

/**
 * Daily loss limit.
 * dayStartBalance / dayStartEquity: values at the firm's daily reset.
 * measured: the account value the firm compares against the floor (we pass the lower of balance and equity).
 */
export function dailyLoss(rule, { size, initial, dayStartBalance, dayStartEquity, measured }) {
  if (!rule) return null;
  const reference = rule.reference === 'max' ? Math.max(dayStartBalance, dayStartEquity) : dayStartBalance;
  const amount = ruleAmount(rule, { size, initial, reference });
  if (amount === null) return null;
  const floor = reference - amount;
  const room = measured - floor;
  return { kind: rule.kind || 'hard', reference, amount, floor, room, status: classify(room, amount) };
}

/**
 * Max drawdown. highWaterMark = the high the firm trails from:
 *   trailing_eod      -> highest end-of-day balance so far
 *   trailing_closed   -> highest closed balance so far (current balance counts)
 *   trailing_intraday -> highest balance incl. open profit (current equity counts)
 */
export function maxDrawdown(rule, { size, initial, highWaterMark, currentBalance, currentEquity, measured }) {
  if (!rule) return null;
  const amount = ruleAmount(rule, { size, initial, reference: initial });
  if (amount === null) return null;
  let floor;
  let peak = initial;
  if (rule.mode === 'static') {
    floor = initial - amount;
  } else {
    const hwm = num(highWaterMark, initial);
    peak = Math.max(initial, hwm);
    if (rule.mode === 'trailing_closed') peak = Math.max(peak, currentBalance);
    if (rule.mode === 'trailing_intraday') peak = Math.max(peak, currentBalance, currentEquity);
    floor = peak - amount;
    if (rule.lockAt !== null && rule.lockAt !== undefined) floor = Math.min(floor, initial + Number(rule.lockAt));
  }
  const room = measured - floor;
  return { mode: rule.mode, amount, peak, floor, room, status: classify(room, amount) };
}

/** Largest position (in lots/contracts, rounded down to lotStep) whose stop-out keeps you above the buffered floor. */
export function maxLots({ room, bufferAmount = 0, stopDistance, valuePerUnit, lotStep = 0.01 }) {
  const riskPerLot = num(stopDistance) * num(valuePerUnit);
  if (!(riskPerLot > 0)) return null;
  const usable = room - bufferAmount;
  if (!(usable > 0)) return 0;
  const raw = usable / riskPerLot;
  const steps = Math.floor(raw / lotStep + 1e-9);
  return Number((steps * lotStep).toFixed(6));
}

/**
 * Full evaluation used by the UI.
 * input: { program, size, initial, currentBalance, currentEquity, todayPnl, dayStartBalance?, dayStartEquity?,
 *          highWaterMark?, customDailyAmount?, stopDistance?, valuePerUnit?, lotStep?, bufferPct? }
 */
export function evaluate(input) {
  const p = input.program;
  const size = num(input.size);
  const initial = num(input.initial, size);
  const currentBalance = num(input.currentBalance, initial);
  const currentEquity = num(input.currentEquity, currentBalance);
  const todayPnl = num(input.todayPnl, 0);
  // Today's P&L = change in equity since the daily reset (closed + open).
  const dayStartEquity = num(input.dayStartEquity, currentEquity - todayPnl);
  const dayStartBalance = num(input.dayStartBalance, dayStartEquity);
  // Conservative: compare the lower of balance and equity against each floor.
  const measured = Math.min(currentBalance, currentEquity);

  let dRule = p.dailyLoss;
  const custom = num(input.customDailyAmount, NaN);
  if (!dRule && custom > 0) dRule = { amount: custom, reference: 'balance', kind: 'pause' };

  const daily = dailyLoss(dRule, { size, initial, dayStartBalance, dayStartEquity, measured });
  const hwmDefault = p.maxDrawdown && p.maxDrawdown.mode === 'trailing_eod' ? Math.max(initial, dayStartBalance) : Math.max(initial, currentBalance);
  const dd = maxDrawdown(p.maxDrawdown, { size, initial, highWaterMark: num(input.highWaterMark, hwmDefault), currentBalance, currentEquity, measured });

  const bufferPct = Math.min(Math.max(num(input.bufferPct, 0), 0), 95) / 100;
  const limits = [daily, dd].filter(Boolean);
  // The binding limit is the one with the least usable room after the buffer.
  let binding = null;
  for (const l of limits) {
    const usable = l.room - bufferPct * l.amount;
    if (!binding || usable < binding.usable) binding = { limit: l, usable };
  }
  const lots = binding
    ? maxLots({ room: binding.limit.room, bufferAmount: bufferPct * binding.limit.amount, stopDistance: input.stopDistance, valuePerUnit: input.valuePerUnit, lotStep: num(input.lotStep, 0.01) })
    : null;

  return {
    size, initial, currentBalance, currentEquity, todayPnl, dayStartBalance, dayStartEquity, measured,
    daily, drawdown: dd, maxLots: lots,
    bindingLimit: binding ? (binding.limit === daily ? 'daily' : 'drawdown') : null,
    status: worst(daily && daily.status, dd && dd.status),
  };
}
