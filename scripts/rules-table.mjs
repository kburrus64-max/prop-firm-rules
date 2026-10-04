// Prints the Markdown rules table used in README.md:  node scripts/rules-table.mjs
import { rules } from '../js/index.mjs';
const MODE = { static: 'Static', trailing_eod: 'Trailing (end-of-day)', trailing_closed: 'Trailing (closed balance)', trailing_intraday: 'Trailing (intraday, incl. open P/L)' };
const money = (n) => '$' + Number(n).toLocaleString('en-US');
const bySize = (o) => Object.entries(o).map(([s, a]) => `${money(a)} on ${Number(s) / 1000}K`).join(', ');
const daily = (d, p) => {
  if (!d) return 'None (see notes)';
  const amt = d.amountBySize ? bySize(d.amountBySize) : `${d.pct}% of ${d.amountBase === 'reference' ? (d.reference === 'max' ? 'higher of day-start balance/equity' : 'day-start balance') : 'initial balance'}`;
  const from = d.amountBySize ? '' : d.amountBase === 'initial' ? `, from ${d.reference === 'max' ? 'higher of day-start balance/equity' : 'day-start balance'}` : '';
  return amt + from + (d.kind === 'pause' ? ' (pauses trading, not a breach)' : '');
};
const dd = (m) => `${m.amountBySize ? bySize(m.amountBySize) : m.pct + '%'}, ${MODE[m.mode]}${m.lockAt === null || m.lockAt === undefined ? '' : `, locks at initial${m.lockAt ? ' + ' + money(m.lockAt) : ''}`}`;
console.log('| Firm | Program | Daily loss limit | Max drawdown | Daily reset | Source | Verified |');
console.log('|---|---|---|---|---|---|---|');
for (const f of rules.firms) for (const p of f.programs) {
  const src = p.sources.map((s, i) => `[${i + 1}](${s})`).join(' ');
  console.log(`| ${f.name} | ${p.name} | ${daily(p.dailyLoss, p)} | ${dd(p.maxDrawdown)} | ${p.reset} | ${src} | ${p.verified ? p.lastVerified : 'no'}${p.unverifiedFields ? ' (unverified: ' + p.unverifiedFields.join(', ') + ')' : ''} |`);
}
