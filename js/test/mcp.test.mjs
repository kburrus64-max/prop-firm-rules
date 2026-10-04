import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMessage } from '../../mcp/server.mjs';

test('mcp: initialize and tools/list', () => {
  const init = handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  const names = handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }).result.tools.map((t) => t.name);
  assert.deepEqual(names, ['list_firms', 'get_rules', 'check_drawdown']);
  assert.equal(handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('mcp: check_drawdown FTMO 2-Step matches the calculator', () => {
  const r = handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'check_drawdown', arguments: { program: 'ftmo_2step', accountSize: 100000, currentEquity: 96500, todayPnl: -3000 } } });
  const b = r.result.structuredContent;
  assert.equal(b.result.dailyLossRemaining, 2000);
  assert.equal(b.result.maxDrawdownRemaining, 6500);
  assert.equal(r.result.isError, false);
});

test('mcp: unknown program is a tool error, not a crash', () => {
  const r = handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_rules', arguments: { program: 'nope' } } });
  assert.equal(r.result.isError, true);
});
