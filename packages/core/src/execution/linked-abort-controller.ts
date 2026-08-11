export class LinkedAbortController {
  readonly controller = new AbortController();
  private readonly abort = () => this.controller.abort();

  constructor(private readonly external: AbortSignal) {
    if (external.aborted) this.abort();
    else external.addEventListener('abort', this.abort, { once: true });
  }

  dispose(): void { this.external.removeEventListener('abort', this.abort); }
}
