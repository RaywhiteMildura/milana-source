import type { Logger } from '../adapters/types.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
const level = (process.env.RACELENS_LOG || 'info') as keyof typeof LEVELS;

export const logger: Logger = {
  debug: (m, meta) => LEVELS[level] <= LEVELS.debug && console.debug(ts(), '[debug]', m, meta ?? ''),
  info: (m, meta) => LEVELS[level] <= LEVELS.info && console.log(ts(), '[info]', m, meta ?? ''),
  warn: (m, meta) => LEVELS[level] <= LEVELS.warn && console.warn(ts(), '[warn]', m, meta ?? ''),
  error: (m, meta) => console.error(ts(), '[error]', m, meta ?? ''),
};

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
