// shared/utils/index.ts
import { createHash, randomUUID } from 'crypto';

export const generateId = (): string => randomUUID();

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const retry = async <T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 500
): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    if (retries <= 0) throw err;
    await sleep(delayMs);
    return retry(fn, retries - 1, delayMs * 2);
  }
};

export const hashContent = (content: string): string =>
  createHash('sha256').update(content).digest('hex');

export const satoshisToBSV = (satoshis: number): number =>
  satoshis / 1e8;

export const bsvToSatoshis = (bsv: number): number =>
  Math.round(bsv * 1e8);

export const formatTxId = (txid: string): string =>
  `${txid.slice(0, 8)}...${txid.slice(-8)}`;

export const timestamp = (): number => Date.now();

export const chunk = <T>(arr: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );

// Resolve inter-agent URLs — uses env vars injected by docker-compose,
// falls back to localhost for local dev outside Docker.
export const agentUrl = (role: string, path = ''): string => {
  const envKey = `${role.toUpperCase()}_URL`;
  const base = process.env[envKey] ?? `http://localhost:${
    ({ orchestrator:4000, discovery:4001, negotiation:4002, payment:4003, knowledge:4004, validator:4005 } as Record<string,number>)[role] ?? 4000
  }`;
  return `${base}${path}`;
};

export const logger = {
  info: (agent: string, msg: string, data?: unknown) =>
    console.log(JSON.stringify({ level: 'info', agent, msg, data, ts: new Date().toISOString() })),
  error: (agent: string, msg: string, err?: unknown) =>
    console.error(JSON.stringify({ level: 'error', agent, msg, err: String(err), ts: new Date().toISOString() })),
  warn: (agent: string, msg: string, data?: unknown) =>
    console.warn(JSON.stringify({ level: 'warn', agent, msg, data, ts: new Date().toISOString() })),
};
