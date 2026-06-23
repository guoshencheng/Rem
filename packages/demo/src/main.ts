import "dotenv/config";
import { AgentServer } from "rem-agent-server";
import { TUIApp } from "rem-agent-tui";
import { resolveConfig } from "./config.js";

async function main(): Promise<void> {
  const config = resolveConfig();

  process.env.REM_AGENT_SESSIONS_DIR = config.sessionDir;
  process.env.REM_AGENT_NAME = config.agentName;
  process.env.REM_AGENT_MAX_TURNS = String(config.maxTurns);

  const server = new AgentServer({
    port: config.port,
    host: config.host,
  });
  await server.start();

  const app = new TUIApp({
    serverUrl: `http://${config.host}:${config.port}`,
    sessionId: config.sessionId,
    maxTurns: config.maxTurns,
  });
  await app.init();
  app.start();

  process.on("SIGINT", () => {
    app.stop();
    server.stop().finally(() => process.exit(0));
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
