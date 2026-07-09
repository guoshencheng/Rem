import { NextRequest } from 'next/server';

export function getWorkspace(request: NextRequest): string {
  const workspace = new URL(request.url).searchParams.get('workspace');
  // 兼容旧客户端/旧标签页以及存量 session：未传 workspace 时默认使用 'default'。
  if (!workspace) {
    return 'default';
  }
  return decodeURIComponent(workspace);
}
