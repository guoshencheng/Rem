import type { IncomingMessage, ServerResponse } from 'node:http';

export function corsMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  next();
}
