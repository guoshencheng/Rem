import "dotenv/config";
import { TUIApp } from "rem-agent-tui";
import { resolveConfig } from "./config.js";

async function runTUI(): Promise<void> {
  const config = resolveConfig();
  const app = new TUIApp({
    serverUrl: `http://${config.host}:${config.port}`,
    sessionId: config.sessionId,
    maxTurns: config.maxTurns,
  });
  await app.init();
  app.start();

  process.on("SIGINT", () => {
    app.stop();
    process.exit(0);
  });
}

runTUI().catch((e) => {
  console.error(e);
  process.exit(1);
});
