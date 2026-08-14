import { stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createAgentRuntimeFromEnv, type AgentRuntime } from 'rem-agent-core';
import { createWebApp } from './app.js';
import { createWebAgentDefinitions } from './runtime-agent-definitions.js';

function parseArgs(argv: string[]): { port?: number } {
  const args: { port?: number } = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port') args.port = Number(argv[++i]);
  }
  return args;
}

function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', () => resolve(findAvailablePort(startPort + 1)));
    server.listen(startPort, () => {
      server.close(() => resolve(startPort));
    });
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (process.env.NODE_ENV === 'development') {
    const debugLogFile = process.env.REM_AGENT_DEBUG_FILE
      ?? (process.env.REM_AGENT_DEBUG === '1' ? '/tmp/rem-agent-debug.log' : path.join(process.env.REM_AGENT_HOME ?? path.join(homedir(), '.rem-agent'), 'debug.log'));
    console.log(`Rem Web debug log: ${debugLogFile ?? 'disabled'}`);
  }
  let runtime: AgentRuntime;
  try {
    runtime = await createAgentRuntimeFromEnv({
      agentDefinitions: createWebAgentDefinitions(),
      executionRoot: process.env.REM_EXECUTION_ROOT || process.cwd(),
      worker: { pollMs: 250 },
    });
  } catch (err: unknown) {
    console.error(`Core Runtime 初始化失败: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
    return;
  }
  const app = createWebApp({ runtime });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Rem Web received ${signal}, shutting down Runtime`);
    await runtime.shutdown().catch((error: unknown) => {
      console.error(`Core Runtime 关闭失败: ${error instanceof Error ? error.message : String(error)}`);
    });
    process.exit(0);
  };
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

  const isProduction = process.env.NODE_ENV === 'production';
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  if (isProduction) {
    const staticRoot = path.resolve(dirname, '../client');
    const { readFile } = await import('node:fs/promises');
    app.get('*', async (c) => {
      const reqPath = c.req.path.endsWith('/') ? `${c.req.path}index.html` : c.req.path;
      const filePath = path.join(staticRoot, reqPath);
      const fileStat = await stat(filePath).catch(() => null);
      if (fileStat?.isFile()) {
        const content = await readFile(filePath);
        const type = MIME[path.extname(filePath)] ?? 'application/octet-stream';
        return new Response(content, { headers: { 'Content-Type': type } });
      }
      return c.html(await readFile(path.join(staticRoot, 'index.html'), 'utf-8'));
    });
  }

  const port = args.port ?? (isProduction ? 3000 : await findAvailablePort(3001));
  if (!isProduction) {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    while (true) {
      if (await stat(path.resolve(dir, 'package.json')).catch(() => null)) break;
      const parent = path.resolve(dir, '..');
      if (parent === dir) break;
      dir = parent;
    }
    await writeFile(path.resolve(dir, '.dev-port'), String(port), 'utf-8');
  }
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`Rem Web listening at http://localhost:${info.port}`);
  });
}

await main();
