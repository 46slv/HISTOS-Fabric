import { readFile } from 'node:fs/promises';
import { installProfile, refreshProfile, startContextService } from './context-service.mjs';
import { requestService } from './service-client.mjs';

const [command, input] = process.argv.slice(2);
try {
  if (command === 'install') {
    const result = await installProfile(JSON.parse(await readFile(input, 'utf8')));
    console.log(JSON.stringify(result));
  } else if (command === 'serve') {
    const service = await startContextService({ profileRoot: input });
    process.stderr.write(`${JSON.stringify({ event: 'histos.service.started', ...service })}\n`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { service.close().then(() => process.exit(0)); });
  } else if (command === 'index') console.log(JSON.stringify(await refreshProfile(input)));
  else if (command === 'health' || command === 'stop') console.log(JSON.stringify(await requestService({ profileRoot: input, operation: command })));
  else throw new Error('USAGE: node service-cli.mjs install <manifest.json> | serve|index|health|stop <profile-root>');
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
