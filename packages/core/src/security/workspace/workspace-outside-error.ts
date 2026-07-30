export class WorkspaceOutsideError extends Error {
  constructor(
    public readonly absolutePath: string,
    public readonly workspaceRoot: string,
  ) {
    super(`Path "${absolutePath}" resolves outside workspace root "${workspaceRoot}"`);
    this.name = 'WorkspaceOutsideError';
  }
}
