import os from 'os';
import si from 'systeminformation';

const TIMEOUT_MS = Number(process.env.DIAG_TIMEOUT_MS || 15000);

const probes = [
  ['cpu', () => si.cpu()],
  ['currentLoad', () => si.currentLoad()],
  ['mem', () => si.mem()],
  ['fsSize', () => si.fsSize()],
  ['fsStats', () => si.fsStats()],
  ['networkInterfaces', () => si.networkInterfaces()],
  ['networkStats', () => si.networkStats()],
  ['time', () => si.time()],
  ['osInfo', () => si.osInfo()],
  ['system', () => si.system()],
];

function summarize(value) {
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value).slice(0, 8);
    return `object keys: ${keys.join(', ') || 'none'}`;
  }

  return String(value);
}

async function withTimeout(name, fn) {
  const startedAt = Date.now();
  let timeoutId;

  try {
    const result = await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`timed out after ${TIMEOUT_MS}ms`)),
          TIMEOUT_MS
        );
      }),
    ]);

    return {
      name,
      status: 'ok',
      durationMs: Date.now() - startedAt,
      summary: summarize(result),
    };
  } catch (error) {
    return {
      name,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      summary: error.message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

console.log('System information diagnostic');
console.log('-----------------------------');
console.log(`Host: ${os.hostname()}`);
console.log(`Platform: ${os.platform()} ${os.release()} (${os.arch()})`);
console.log(`Node: ${process.version}`);
console.log(`Timeout: ${TIMEOUT_MS}ms per probe`);
console.log('');

for (const [name, fn] of probes) {
  process.stdout.write(`${name.padEnd(20)} `);
  const result = await withTimeout(name, fn);
  const marker = result.status === 'ok' ? 'OK' : 'FAIL';
  console.log(`${marker.padEnd(5)} ${String(result.durationMs).padStart(6)}ms  ${result.summary}`);
}

console.log('');
console.log('If most probes fail or time out, check OS management services and permissions.');
console.log('On Windows, make sure WMI / Windows Management Instrumentation is enabled and try running PowerShell as Administrator.');
