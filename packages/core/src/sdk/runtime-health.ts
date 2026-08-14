import type { RuntimeErrorCode } from '../domain/error/types.js';

export interface RuntimeHealth {
  status: 'ready' | 'degraded' | 'stopped';
  checkedAt: Date;
  checks: {
    runtime: 'ready' | 'not-ready' | 'stopped';
    storage: 'ok' | 'error' | 'unknown';
    worker: 'running' | 'stopped';
  };
  errorCode?: RuntimeErrorCode;
}
