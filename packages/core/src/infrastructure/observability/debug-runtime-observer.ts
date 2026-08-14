import type { RuntimeObserver } from '../../sdk/runtime-observer.js';
import { logStructured } from './debug-log.js';

export const debugRuntimeObserver: RuntimeObserver = {
  observe(event) { logStructured('runtime-observation', { ...event }); },
};
