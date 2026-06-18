import "dotenv/config";

import { createAgentFromEnv, FileSessionProvider } from "rem-agent-core";
import { TUIApp } from "rem-agent-tui";
import { resolveConfig } from "./config.js";

async function main(): Promise<void> {
  const config = resolveConfig();

  const sessionProvider = new FileSessionProvider(config.sessionDir);

  if (config.sessionId) {
    const existing = await sessionProvider.load(config.sessionId);
    if (!existing) {
      console.error(`Session not found: ${config.sessionId}`);
      process.exit(1);
    }
  }

  const agent = createAgentFromEnv({
    name: config.agentName,
    maxTurns: config.maxTurns,
    sessionProvider,
  });

  const app = new TUIApp({ agent, sessionId: config.sessionId });
  await app.init();

  app.start();

  process.on("SIGINT", () => {
    app.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
