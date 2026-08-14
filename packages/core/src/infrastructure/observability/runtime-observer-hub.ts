import type { RuntimeObservation, RuntimeObserver, RuntimeObservationSink } from '../../sdk/runtime-observer.js';
import { RuntimeError } from '../../application/runtime/runtime-error.js';
import { log } from './debug-log.js';

export class RuntimeObserverHub {
  private readonly observers: readonly RuntimeObserver[];

  constructor(observers: readonly RuntimeObserver[] = []) {
    this.observers = observers.map((observer, index) => validateObserver(observer, index));
  }

  sink(): RuntimeObservationSink {
    return (event) => this.observe(event);
  }

  observe(event: RuntimeObservation): void {
    for (const [index, observer] of this.observers.entries()) {
      let result: void | PromiseLike<void>;
      try { result = observer.observe(structuredClone(event)); }
      catch { log('runtime-observer', 'observer failed', { observerIndex: index }); continue; }
      if (result !== undefined) void Promise.resolve(result).catch(() => {
        log('runtime-observer', 'observer rejected', { observerIndex: index });
      });
    }
  }
}

function validateObserver(value: unknown, index: number): RuntimeObserver {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RuntimeError('INVALID_INPUT', `Runtime observer ${index} must be an object`);
  }
  let current: object | null = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, 'observe');
    if (descriptor) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new RuntimeError('INVALID_INPUT', `Runtime observer ${index}.observe must be a function`);
      }
      return { observe: descriptor.value.bind(value) };
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  throw new RuntimeError('INVALID_INPUT', `Runtime observer ${index}.observe must be a function`);
}
