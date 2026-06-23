import type { IncomingMessage, ServerResponse } from 'node:http';

export function errorHandler(
  error: Error,
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  console.error('Server error:', error);
  if (res.headersSent) return;
  res.writeHead(500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: error.message }));
}
