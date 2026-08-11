import { RuntimeError } from '../application/runtime/runtime-error.js';
import { storageFailure } from './local-worker-options.js';

export class ToolFatalState {
  private failure?: RuntimeError;
  private resolve!: (error: RuntimeError) => void;
  readonly promise = new Promise<RuntimeError>((resolve) => { this.resolve = resolve; });

  constructor(private readonly onFatal: () => void) {}

  get error(): RuntimeError | undefined { return this.failure; }

  assertHealthy(): void {
    if (this.failure) throw this.failure;
  }

  poison(error: unknown): RuntimeError {
    if (this.failure) return this.failure;
    const stable = storageFailure(error);
    this.failure = stable;
    this.resolve(stable);
    this.onFatal();
    return stable;
  }
}
