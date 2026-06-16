import "dotenv/config";

import { createAgentFromEnv, createUIAgentSession } from "@agent-harness/core";
import { TUIApp } from "@agent-harness/tui";
import { resolveConfig } from "./config.js";

async function main(): Promise<void> {
  const config = resolveConfig();

  const agent = createAgentFromEnv({
    name: config.agentName,
    maxTurns: config.maxTurns,
  });

  await agent.initialize();

  const session = createUIAgentSession(agent);
  const app = new TUIApp({ session });

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
