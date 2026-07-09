import type { Workspace } from './types.js';

export type { Workspace };

export interface WorkspaceRepository {
  list(): Promise<Workspace[]>;
  add(path: string): Promise<Workspace>;
  remove(path: string): Promise<void>;
}
