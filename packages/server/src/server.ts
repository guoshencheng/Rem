import { createServer as createHttpServer, type Server } from 'node:http';
import { corsMiddleware } from './middleware/cors.js';
import {
  handleAgentRun,
  handleAgentInterrupt,
  handleAgentReset,
} from './routes/agent.js';
import { handleListSessions } from './routes/sessions.js';
import { handleStream } from './routes/stream.js';
import { errorHandler } from './middleware/error.js';
import { ProviderManager } from 'rem-agent-core';

export interface AgentServerOptions {
  configPath?: string;
  port?: number;
  host?: string;
}

export class AgentServer {
  private server?: Server;
  private port: number;
  private host: string;
  private configPath?: string;

  constructor(options: AgentServerOptions = {}) {
    this.port = options.port ?? 8321;
    this.host = options.host ?? 'localhost';
    this.configPath = options.configPath;
  }

  async start(): Promise<void> {
    await ProviderManager.getInstance({ configPath: this.configPath });

    this.server = createHttpServer((req, res) => {
      try {
        corsMiddleware(req, res, () => this.handleRequest(req, res));
      } catch (error) {
        errorHandler(error as Error, req, res);
      }
    });

    return new Promise((resolve) => {
      this.server!.listen(this.port, this.host, () => {
        console.log(
          `Agent server listening on http://${this.host}:${this.port}`,
        );
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server?.close(() => resolve());
    });
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    try {
      if (method === 'POST' && url === '/api/agent/run') {
        await handleAgentRun(req, res);
        return;
      }
      if (method === 'POST' && url === '/api/agent/interrupt') {
        await handleAgentInterrupt(req, res);
        return;
      }
      if (method === 'POST' && url === '/api/agent/reset') {
        await handleAgentReset(req, res);
        return;
      }
      if (method === 'GET' && url === '/api/sessions') {
        await handleListSessions(req, res);
        return;
      }
      if (method === 'GET' && url.startsWith('/api/stream/')) {
        await handleStream(req, res);
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    } catch (error) {
      errorHandler(error as Error, req, res);
    }
  }
}
