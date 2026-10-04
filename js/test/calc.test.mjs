// Run: node --test tests/   (Node 18+, no dependencies)
// Most expectations are the worked examples published by the firms themselves (see data/firms.json sources).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate, maxLots, classify, maxDrawdown, STATUS } from '../calc.mjs';

const data = JSON.parse(readFileSync(new URL('../../data/firms.json', import.meta.url)));
const prog = (id) => data.firms.flatMap((f) => f.programs).find((p) => p.id === id);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} expected ${b}, got ${a}`);

test('FTMO 2-Step daily floor follows FTMO examples ($100k: day1 95,000; day2 97,000) and static max loss 90,000', () => {
  const p = prog('ftmo_2step');
  let r = evaluate({ program: p, size: 100000, currentBalance: 100000, currentEquity: 100000, todayPnl: 0 });
  close(r.daily.floor, 95000); close(r.drawdown.floor, 90000); assert.equal(r.status, STATUS.GREEN);
  r = evaluate({ program: p, size: 100000, currentBalance: 102000, currentEquity: 102000, todayPnl: 0 });
  close(r.daily.floor, 97000); close(r.daily.room, 5000); close(r.drawdown.floor, 90000);
});

test('FTMO 1-Step trailing EOD max loss: highest midnight balance 104,000 -> 94,000, stays after a lower close', () => {
  const p = prog('ftmo_1step');
  let r = evaluate({ program: p, size: 100000, currentBalance: 104000, currentEquity: 104000, todayPnl: 0, highWaterMark: 104000 });
  close(r.drawdown.floor, 94000); close(r.daily.floor, 101000);
  r = evaluate({ program: p, size: 100000, currentBalance: 103000, currentEquity: 103000, todayPnl: 0, highWaterMark: 104000 });
  close(r.drawdown.floor, 94000);
});

test('FundedNext Stellar 2-Step: $3,000 closed loss leaves $2,000; losing $5,000 from a $110k day start is a breach', () => {
  const p = prog('fundednext_stellar_2step');
  let r = evaluate({ program: p, size: 100000, currentBalance: 97000, currentEquity: 97000, todayPnl: -3000 });
  close(r.daily.room, 2000);
  r = evaluate({ program: p, size: 100000, currentBalance: 105000, currentEquity: 105000, todayPnl: -5000 });
  close(r.daily.room, 0); assert.equal(r.daily.status, STATUS.RED); assert.equal(r.status, STATUS.RED);
});

test('FundingPips: opening balance 105k / equity 107k -> floor 101,650 (5% of 107k)', () => {
  const r = evaluate({ program: prog('fundingpips_2step_5'), size: 100000, currentBalance: 105000, currentEquity: 107000, todayPnl: 0, dayStartBalance: 105000, dayStartEquity: 107000 });
  close(r.daily.floor, 101650); close(r.drawdown.floor, 90000);
});

test('The5ers High Stakes: day-start balance 105k / equity 110k -> floor 104,500', () => {
  const r = evaluate({ program: prog('the5ers_high_stakes'), size: 100000, currentBalance: 105000, currentEquity: 110000, todayPnl: 0, dayStartBalance: 105000, dayStartEquity: 110000 });
  close(r.daily.floor, 104500);
});

test('Blue Guardian: higher of balance/equity at 5pm minus fixed 4% of initial (98,000 and 96,000 examples)', () => {
  const p = prog('blue_guardian_2step');
  let r = evaluate({ program: p, size: 100000, currentBalance: 100000, currentEquity: 102000, todayPnl: 0, dayStartBalance: 100000, dayStartEquity: 102000 });
  close(r.daily.floor, 98000); close(r.drawdown.floor, 92000);
  r = evaluate({ program: p, size: 100000, currentBalance: 100000, currentEquity: 98000, todayPnl: 0, dayStartBalance: 100000, dayStartEquity: 98000 });
  close(r.daily.floor, 96000);
});

test('Alpha Pro 10%: balance-based, carried floating P/L ignored -> floor 95,000 either way; 4,000 left when equity opens at 99k', () => {
  const p = prog('alpha_pro_10');
  let r = evaluate({ program: p, size: 100000, currentBalance: 100000, currentEquity: 101000, todayPnl: 0, dayStartBalance: 100000, dayStartEquity: 101000 });
  close(r.daily.floor, 95000);
  r = evaluate({ program: p, size: 100000, currentBalance: 100000, currentEquity: 99000, todayPnl: 0, dayStartBalance: 100000, dayStartEquity: 99000 });
  close(r.daily.floor, 95000); close(r.daily.room, 4000);
});

test('E8 One: daily loss level 98,500 on a 102,500 day start; dynamic drawdown trails closed balance and locks at initial', () => {
  const p = prog('e8_one');
  let r = evaluate({ program: p, size: 100000, currentBalance: 102500, currentEquity: 102500, todayPnl: 0 });
  close(r.daily.floor, 98500);
  // E8 table: +2k -> 96k; -3k (balance 99k, high 102k) -> 96k; +7k (balance 107k) -> locks at 100k
  r = evaluate({ program: p, size: 100000, currentBalance: 102000, currentEquity: 102000, todayPnl: 0 });
  close(r.drawdown.floor, 96000);
  r = evaluate({ program: p, size: 100000, currentBalance: 99000, currentEquity: 99000, todayPnl: 0, highWaterMark: 102000 });
  close(r.drawdown.floor, 96000);
  r = evaluate({ program: p, size: 100000, currentBalance: 107000, currentEquity: 107000, todayPnl: 0, highWaterMark: 107000 });
  close(r.drawdown.floor, 100000);
});

test('Topstep 50K Combine MLL: 48,000 start, 48,500 after +500 day, stays after -500 day, locks at 50,000', () => {
  const p = prog('topstep_combine');
  let r = evaluate({ program: p, size: 50000, currentBalance: 50000, currentEquity: 50000, todayPnl: 0 });
  close(r.drawdown.floor, 48000); assert.equal(r.daily, null);
  r = evaluate({ program: p, size: 50000, currentBalance: 50000, currentEquity: 50000, todayPnl: 0, highWaterMark: 50500 });
  close(r.drawdown.floor, 48500);
  r = evaluate({ program: p, size: 50000, currentBalance: 53000, currentEquity: 53000, todayPnl: 0, highWaterMark: 53000 });
  close(r.drawdown.floor, 50000);
});

test('Topstep custom daily limit (optional add-on) is modelled when entered', () => {
  const r = evaluate({ program: prog('topstep_combine'), size: 50000, currentBalance: 49600, currentEquity: 49600, todayPnl: -400, customDailyAmount: 1000 });
  close(r.daily.floor, 49000); close(r.daily.room, 600); assert.equal(r.daily.kind, 'pause');
});

test('Apex intraday 50K: peak 50,900 incl. open profit -> 48,900, does not move down at 50,200', () => {
  const p = prog('apex_intraday_eval');
  let r = evaluate({ program: p, size: 50000, currentBalance: 50000, currentEquity: 50900, todayPnl: 900 });
  close(r.drawdown.floor, 48900);
  r = evaluate({ program: p, size: 50000, currentBalance: 50000, currentEquity: 50200, todayPnl: 200, highWaterMark: 50900 });
  close(r.drawdown.floor, 48900);
});

test('Apex EOD 50K: $1,000 session DLL (pause) and $2,000 EOD threshold', () => {
  const r = evaluate({ program: prog('apex_eod_eval'), size: 50000, currentBalance: 49700, currentEquity: 49700, todayPnl: -300 });
  close(r.daily.floor, 49000); close(r.daily.room, 700); assert.equal(r.daily.kind, 'pause');
  close(r.drawdown.floor, 48000);
});

test('max lot size: $2,000 room, 20-pip stop at $10/pip -> 10.00 lots; 20% buffer of a $5,000 limit -> 5.00 lots', () => {
  assert.equal(maxLots({ room: 2000, stopDistance: 20, valuePerUnit: 10 }), 10);
  assert.equal(maxLots({ room: 2000, bufferAmount: 1000, stopDistance: 20, valuePerUnit: 10 }), 5);
  assert.equal(maxLots({ room: 1234, stopDistance: 15, valuePerUnit: 10 }), 8.22); // 8.2266 rounded DOWN
  assert.equal(maxLots({ room: 500, bufferAmount: 600, stopDistance: 10, valuePerUnit: 10 }), 0);
  assert.equal(maxLots({ room: 700, stopDistance: 10, valuePerUnit: 50, lotStep: 1 }), 1); // futures: whole contracts
  assert.equal(maxLots({ room: 700, stopDistance: 0, valuePerUnit: 50 }), null);
});

test('evaluate picks the tighter limit for lot sizing', () => {
  // FTMO 2-step $100k, equity 91,500 (DD room 1,500) and today -500 (daily room 4,500) -> drawdown binds
  const r = evaluate({ program: prog('ftmo_2step'), size: 100000, currentBalance: 91500, currentEquity: 91500, todayPnl: -500, stopDistance: 10, valuePerUnit: 10 });
  assert.equal(r.bindingLimit, 'drawdown'); close(r.drawdown.room, 1500); assert.equal(r.maxLots, 15);
  assert.equal(r.drawdown.status, STATUS.RED); // 1,500 of 10,000 left = 15%
});

test('status thresholds: >50% green, <=50% amber, <=20% red, breached red', () => {
  assert.equal(classify(5000, 5000), STATUS.GREEN);
  assert.equal(classify(2600, 5000), STATUS.GREEN);
  assert.equal(classify(2500, 5000), STATUS.AMBER);
  assert.equal(classify(1000, 5000), STATUS.RED);
  assert.equal(classify(-1, 5000), STATUS.RED);
});

test('conservative measure: floating profit does not hide a balance below the floor', () => {
  const r = maxDrawdown({ pct: 10, mode: 'static' }, { size: 100000, initial: 100000, measured: Math.min(89000, 91000) });
  assert.ok(r.room < 0);
});

test('rules data: 8-12 firms, every program has https sources, a last-verified date and a verified flag', () => {
  assert.ok(data.firms.length >= 8 && data.firms.length <= 12, `firm count ${data.firms.length}`);
  for (const f of data.firms) for (const p of f.programs) {
    assert.ok(Array.isArray(p.sources) && p.sources.length > 0, `${p.id} sources`);
    for (const s of p.sources) assert.match(s, /^https:\/\//, `${p.id} source ${s}`);
    assert.match(p.lastVerified, /^\d{4}-\d{2}-\d{2}$/, `${p.id} lastVerified`);
    assert.equal(typeof p.verified, 'boolean', `${p.id} verified`);
    assert.ok(p.maxDrawdown, `${p.id} maxDrawdown`);
    for (const s of p.sizes) {
      const r = evaluate({ program: p, size: s, currentBalance: s, currentEquity: s, todayPnl: 0 });
      assert.ok(r.drawdown && r.drawdown.room > 0, `${p.id} ${s} drawdown computable`);
      if (p.dailyLoss) assert.ok(r.daily && r.daily.room > 0, `${p.id} ${s} daily computable`);
    }
  }
});

test('5% daily-loss comparison (bal 105k / eq 107k at reset)', () => {
  const expected = { ftmo_2step: 100000, fundednext_stellar_2step: 100000, the5ers_high_stakes: 101650, fundingpips_2step_5: 101650, alpha_pro_10: 99750, blue_guardian_2step: 103000 };
  for (const [id, floor] of Object.entries(expected)) {
    const r = evaluate({ program: prog(id), size: 100000, currentBalance: 105000, currentEquity: 107000, todayPnl: 0, dayStartBalance: 105000, dayStartEquity: 107000 });
    close(r.daily.floor, floor, id);
  }
});

test('worked example: Topstep 50K after +500/-500 days, ES 10-pt stop, 10% buffer -> 2 contracts', () => {
  const r = evaluate({ program: prog('topstep_combine'), size: 50000, currentBalance: 50000, currentEquity: 50000, todayPnl: 0, highWaterMark: 50500, stopDistance: 10, valuePerUnit: 50, lotStep: 1, bufferPct: 10 });
  close(r.drawdown.room, 1500); assert.equal(r.maxLots, 2);
  assert.equal(maxLots({ room: 2000, bufferAmount: 500, stopDistance: 20, valuePerUnit: 10 }), 7.5);
});

test('index.mjs helpers: getProgram / getFirm / check / every firm policy has sources', async () => {
  const lib = await import('../index.mjs');
  assert.equal(lib.getProgram('ftmo_2step').firmId, 'ftmo');
  assert.equal(lib.getProgram('nope'), undefined);
  assert.equal(lib.getFirm('topstep').policy.remoteServerTrading, 'banned');
  close(lib.check('ftmo_2step', { size: 100000, currentBalance: 100000, currentEquity: 100000, todayPnl: 0 }).daily.floor, 95000);
  assert.throws(() => lib.check('nope', {}), /Unknown program/);
  for (const f of lib.rules.firms) if (f.policy) {
    assert.ok(f.policy.sources.length > 0, `${f.id} policy sources`);
    assert.match(f.policy.lastVerified, /^\d{4}-\d{2}-\d{2}$/);
  }
});
