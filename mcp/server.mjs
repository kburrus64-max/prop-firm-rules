#!/usr/bin/env node
// prop-firm-rules MCP server (stdio). Zero dependencies, read-only, works offline on the bundled dataset.
// Tools: list_firms, get_rules, check_drawdown. Same tools and math as the hosted server at
// https://floorguard-kappa.vercel.app/api/mcp (use that URL if you'd rather not run anything locally).
// Transport: newline-delimited JSON-RPC 2.0 on stdin/stdout, per the MCP stdio spec. Logs go to stderr.
import { createInterface } from 'node:readline';
import { rules, evaluate } from '../js/index.mjs';

const VERSION = JSON.parse((await import('node:fs')).readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const DISCLAIMER = "Informational only, not financial advice. Prop firms change rules often; always verify every value with the firm's current terms and your account dashboard. Not affiliated with, endorsed by, or sponsored by any prop firm.";

const programs = () => rules.firms.flatMap((firm) => firm.programs.map((program) => ({ firm, program })));
const programIds = () => programs().map((x) => x.program.id);
const findProgram = (id) => programs().find((x) => x.program.id === id) || null;
const round2 = (v) => (v === null || v === undefined ? v : Math.round(v * 100) / 100);
const wrap = (fields) => ({ ok: true, lastVerified: rules.lastVerified, ...fields, disclaimer: DISCLAIMER });
const fail = (message, extra = {}) => ({ ok: false, error: message, ...extra, disclaimer: DISCLAIMER });

// check_drawdown parameters: name -> [required, description]
const CHECK_PARAMS = {
  program: [true, 'Program id from list_firms, e.g. ftmo_2step'],
  accountSize: [true, 'Nominal account size, e.g. 100000 (must be one of the program sizes when the rule is a fixed $ amount per size)'],
  startingBalance: [false, 'Initial balance the percentages apply to (default: accountSize)'],
  currentEquity: [true, 'Current equity including open P&L'],
  currentBalance: [false, 'Current closed balance (default: currentEquity)'],
  highWaterMark: [false, 'Peak the firm trails from (highest EOD balance / closed balance / intraday equity, per program mode)'],
  todayPnl: [false, "Today's P&L since the firm's daily reset, closed + open (default 0)"],
  dayStartBalance: [false, 'Balance at the daily reset, if positions were held through it (default: currentEquity - todayPnl)'],
  customDailyLoss: [false, 'Your own daily loss limit in $ for programs without one (e.g. Topstep optional DLL)'],
};

function listFirms() {
  const firms = rules.firms.map((f) => ({
    id: f.id, name: f.name,
    programs: f.programs.map((p) => ({ id: p.id, name: p.name, sizes: p.sizes, sizesVerified: p.sizesVerified, verified: p.verified, lastVerified: p.lastVerified })),
  }));
  return wrap({ firms, vocabulary: rules.vocabulary });
}

function getRules({ program } = {}) {
  const hit = findProgram(String(program || '').trim());
  if (!hit) return fail(`Unknown program id "${program}".`, { validPrograms: programIds() });
  const { programs: _omit, ...firm } = hit.firm;
  return wrap({ program: hit.program, firm, vocabulary: rules.vocabulary });
}

function checkDrawdown(args = {}) {
  const hit = findProgram(String(args.program || '').trim());
  if (!hit) return fail(`Unknown program id "${args.program}".`, { validPrograms: programIds() });
  const p = hit.program;
  const vals = {}; const bad = [];
  for (const [k, [required]] of Object.entries(CHECK_PARAMS)) {
    if (k === 'program') continue;
    const raw = args[k];
    if (raw === undefined || raw === null || raw === '') { if (required) bad.push(`${k} is required`); continue; }
    const n = Number(raw);
    if (!Number.isFinite(n)) bad.push(`${k} must be a number`); else vals[k] = n;
  }
  if (!bad.length) {
    if (!(vals.accountSize > 0)) bad.push('accountSize must be > 0');
    const bySize = [p.dailyLoss, p.maxDrawdown].some((r) => r && r.amountBySize);
    if (bySize && !p.sizes.includes(vals.accountSize)) bad.push(`accountSize must be one of ${p.sizes.join(', ')} for ${p.id}`);
  }
  if (bad.length) return fail(bad.join('; '));
  const r = evaluate({
    program: p, size: vals.accountSize, initial: vals.startingBalance ?? vals.accountSize,
    currentBalance: vals.currentBalance ?? vals.currentEquity, currentEquity: vals.currentEquity,
    todayPnl: vals.todayPnl ?? 0, highWaterMark: vals.highWaterMark, dayStartBalance: vals.dayStartBalance,
    customDailyAmount: vals.customDailyLoss,
  });
  const limit = (l, extra) => (l ? { ...extra, allowance: round2(l.amount), floor: round2(l.floor), room: round2(l.room), remaining: round2(Math.max(0, l.room)), breached: l.room <= 0, status: l.status } : null);
  const daily = limit(r.daily, r.daily && { kind: r.daily.kind, reference: round2(r.daily.reference) });
  const maxDrawdown = limit(r.drawdown, r.drawdown && { mode: r.drawdown.mode, peak: round2(r.drawdown.peak) });
  const breachedRules = [daily?.breached && 'dailyLoss', maxDrawdown?.breached && 'maxDrawdown'].filter(Boolean);
  return wrap({
    program: { id: p.id, name: p.name, firm: hit.firm.name, lastVerified: p.lastVerified },
    result: {
      dailyLossRemaining: daily ? daily.remaining : null, maxDrawdownRemaining: maxDrawdown ? maxDrawdown.remaining : null,
      breached: breachedRules.length > 0, breachedRules, bindingLimit: r.bindingLimit, status: r.status, daily, maxDrawdown,
    },
    notes: [!daily && `${p.id} has no daily loss limit in the dataset.`, p.verified === false && 'Program marked verified=false; treat values as placeholders.'].filter(Boolean),
  });
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const TOOLS = [
  { name: 'list_firms', title: 'List prop firms and programs', description: 'List supported prop firms and their programs: program ids, account sizes, verified flags and last-verified dates.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: READ_ONLY },
  { name: 'get_rules', title: 'Get rules for one program', description: 'Full daily-loss and max-drawdown rules for one program (static/trailing mode, lock, reset time, notes, official source links, firm copy-trading/automation policy).', inputSchema: { type: 'object', properties: { program: { type: 'string', description: CHECK_PARAMS.program[1], enum: programIds() } }, required: ['program'], additionalProperties: false }, annotations: READ_ONLY },
  { name: 'check_drawdown', title: 'Check remaining drawdown room', description: 'Remaining daily-loss and max-drawdown room in dollars for an account, the binding limit and breach flags.', inputSchema: { type: 'object', properties: Object.fromEntries(Object.entries(CHECK_PARAMS).map(([k, [, d]]) => [k, k === 'program' ? { type: 'string', description: d, enum: programIds() } : { type: 'number', description: d }])), required: Object.entries(CHECK_PARAMS).filter(([, [r]]) => r).map(([k]) => k), additionalProperties: false }, annotations: READ_ONLY },
];
const RUN = { list_firms: listFirms, get_rules: getRules, check_drawdown: checkDrawdown };

export function handleMessage(msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'Invalid JSON-RPC 2.0 message.' } };
  if (typeof msg.method !== 'string' || !('id' in msg) || msg.id === null) return null; // notification or client response
  const { id, method, params = {} } = msg;
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  switch (method) {
    case 'initialize': return ok({
      protocolVersion: PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'prop-firm-rules', title: 'Prop Firm Rules (FloorGuard)', version: VERSION },
      instructions: `Read-only, sourced prop-firm daily-loss and max-drawdown rules. Call list_firms for program ids, get_rules for one program, check_drawdown for remaining room. ${DISCLAIMER}`,
    });
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS });
    case 'tools/call': {
      const fn = RUN[params.name];
      if (!fn) return err(-32602, `Unknown tool: ${params.name}`);
      const body = fn(params.arguments && typeof params.arguments === 'object' ? params.arguments : {});
      return ok({ content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body, isError: body.ok === false });
    }
    case 'resources/list': return ok({ resources: [] });
    case 'prompts/list': return ok({ prompts: [] });
    default: return err(-32601, `Method not found: ${method}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('prop-firm-rules-mcp')) {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); return; }
    const out = Array.isArray(msg) ? msg.map(handleMessage).filter(Boolean) : handleMessage(msg);
    if (out && (!Array.isArray(out) || out.length)) process.stdout.write(JSON.stringify(out) + '\n');
  });
  console.error(`prop-firm-rules MCP server ${VERSION} (stdio) ready`);
}
