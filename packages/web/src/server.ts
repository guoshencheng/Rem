import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createRemHandler } from 'rem-agent-routes';
import { getAgentService } from './agent-service.js';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
};

async function serveStaticFile(filePath: string): Promise<Response | null> {
  try {
    const s = await stat(filePath);
    if (!s.isFile()) return null;
    const content = await readFile(filePath);
    const ext = path.extname(filePath);
    const ct = MIME[ext] || 'application/octet-stream';
    return new Response(content, { headers: { 'Content-Type': ct } });
  } catch {
    return null;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';
const staticRoot = isProduction ? path.resolve(__dirname, 'client') : undefined;

const app = new Hono();

const remHandler = createRemHandler({ getAgentService });

app.all('/api/rem/*', async (c) => {
  const url = new URL(c.req.url);
  const pathname = url.pathname;
  const prefixIndex = pathname.indexOf('/api/rem/');
  if (prefixIndex === -1) return c.notFound();
  const segmentsStr = pathname.slice(prefixIndex + '/api/rem/'.length);
  const segments = segmentsStr.split('/').filter(Boolean);
  return remHandler(c.req.raw, segments);
});

if (isProduction && staticRoot) {
  app.get('*', async (c) => {
    const reqPath = c.req.path.endsWith('/') ? c.req.path + 'index.html' : c.req.path;
    const filePath = path.join(staticRoot, reqPath);

    const resp = await serveStaticFile(filePath);
    if (resp) return resp;

    const html = await readFile(path.join(staticRoot, 'index.html'), 'utf-8');
    return c.html(html);
  });
}

const port = Number(process.env.PORT) || (isProduction ? 3000 : 3001);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Rem Agent API running at http://localhost:${info.port}`);
});
