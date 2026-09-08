import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadProfile } from './context-service.mjs';

export async function requestService({ profileRoot, operation = 'health', name, arguments: args, client = 'cli' }) {
  const { root, config } = await loadProfile(profileRoot);
  const endpoint = JSON.parse(await readFile(path.join(root, 'endpoint.json'), 'utf8'));
  if (endpoint.profile_id !== config.profile_id || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(endpoint.url ?? '') || typeof endpoint.instance_id !== 'string') throw new Error('INVALID_SERVICE_ENDPOINT');
  if (!['health', 'call', 'stop'].includes(operation)) throw new Error('UNKNOWN_CLIENT_OPERATION');
  const route = operation === 'stop' ? '/control/stop' : `/${operation}`;
  const body = operation === 'stop' ? { instance_id: endpoint.instance_id } : { name, arguments: args };
  const response = await fetch(`${endpoint.url}${route}`, { method: operation === 'health' ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { authorization: `Bearer ${config.capability}`, 'x-histos-instance': endpoint.instance_id, 'x-histos-client': client, 'content-type': 'application/json' }, ...(operation === 'health' ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'SERVICE_REQUEST_FAILED');
  return result;
}
