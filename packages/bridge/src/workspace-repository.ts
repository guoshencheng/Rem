export interface Workspace {
  /** workspace 唯一标识符，即目录绝对路径 */
  path: string;
  /** 显示名称，默认取目录名 */
  name: string;
  /** 添加时间戳 */
  createdAt: number;
}

export interface WorkspaceRepository {
  list(): Promise<Workspace[]>;
  add(path: string, name?: string): Promise<Workspace>;
  remove(path: string): Promise<void>;
}
