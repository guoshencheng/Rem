import { NextRequest } from 'next/server';

export function getWorkspace(request: NextRequest): string {
  const workspace = new URL(request.url).searchParams.get('workspace');
  if (!workspace) {
    throw new Error('Missing workspace query parameter');
  }
  return decodeURIComponent(workspace);
}
