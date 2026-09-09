import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { installProfile, startContextService } from '../service/context-service.mjs';
import { createMcpHandler } from './context-mcp.mjs';

test('real stdio MCP bridge handshakes, discovers four tools, calls all four and preserves scope errors', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'histos-mcp-test-')); const sourceRoot = path.join(root, 'source'); await mkdir(sourceRoot);
  await writeFile(path.join(sourceRoot, 'a.mjs'), 'export function alpha(value) {\n return value + 1;\n}\n');
  const profileRoot = path.join(root, 'profile'); const installed = await installProfile({ profileRoot, sourceRoot, scopeId: 'mcp-fixture', paths: ['a.mjs'] });
  const service = await startContextService({ profileRoot });
  const child = spawn(process.execPath, [fileURLToPath(new URL('./context-mcp.mjs', import.meta.url)), profileRoot, 'real-stdio-test'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(); let buffer = ''; let next = 1; let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  child.stdout.on('data', data => { buffer += data; while (buffer.includes('\n')) { const pos = buffer.indexOf('\n'); const value = JSON.parse(buffer.slice(0, pos)); buffer = buffer.slice(pos + 1); const target = pending.get(value.id); if (target) { pending.delete(value.id); target(value); } } });
  const send = (method, params) => { const id = next++; return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('MCP_TEST_TIMEOUT')), 10000); pending.set(id, value => { clearTimeout(timer); resolve(value); }); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); }); };
  try {
    assert.equal((await send('tools/list')).error.code, -32002);
    const init = await send('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } }); assert.equal(init.result.protocolVersion, '2025-11-25');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const listed = await send('tools/list'); assert.equal(listed.result.tools.length, 4); assert.ok(listed.result.tools.every(t => t.inputSchema.additionalProperties === false));
    const args = { ...installed.scope, query: 'alpha' };
    for (const name of ['context_search', 'context_compile', 'context_read', 'context_explain']) {
      const input = name === 'context_read' ? { ...installed.scope, path: 'a.mjs', start_line: 1, end_line: 3 } : { ...args, ...(name === 'context_search' ? {} : { goal: 'Find alpha', max_tokens: 2000 }) };
      const result = await send('tools/call', { name, arguments: input }); assert.equal(result.result.isError, false, JSON.stringify(result)); assert.equal(JSON.parse(result.result.content[0].text).service.instance_id, service.instance_id);
    }
    const wrong = await send('tools/call', { name: 'context_search', arguments: { ...args, scope_id: 'other' } }); assert.equal(wrong.result.isError, true); assert.match(wrong.result.content[0].text, /SCOPE_MISMATCH/);
    assert.equal((await send('tools/call', { name: 'write_file', arguments: {} })).error.code, -32602);
    assert.equal((await send('resources/list')).error.code, -32601);
    assert.equal(stderr, '');
  } finally { child.stdin.end(); await new Promise(resolve => child.once('exit', resolve)); await service.close(); await rm(root, { recursive: true, force: true }); }
});

test('protocol invalid requests fail before any service I/O', async () => {
  const handler = createMcpHandler({ profileRoot: 'unused', request: () => { throw new Error('must not run'); } });
  for (const message of [null, [], { jsonrpc: '1.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: {}, method: 'ping' }]) assert.equal((await handler(message)).error.code, -32600);
  assert.equal(await handler({ jsonrpc: '2.0', method: 'notifications/cancelled' }), null);
});
