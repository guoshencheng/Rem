import { App } from "./tui/app.js";
import { createDemoAgent } from "./agent.js";
import { resolveConfig } from "./config.js";

async function main(): Promise<void> {
  const config = resolveConfig();

  const agent = createDemoAgent(config.model, config.agentName, config.maxTurns, {
    onStart: () => {
      app.addEvent("core-agent:start");
    },
    onTurnBefore: (turnNumber) => {
      app.updateStatus(turnNumber, "running");
      app.addEvent("turn:before", `turn #${turnNumber}`);
    },
    onReasonBefore: () => {
      app.addEvent("phase:reason:before", "reasoning...");
    },
    onReasonAfter: (durationMs) => {
      const seconds = (durationMs / 1000).toFixed(1);
      app.addEvent("phase:reason:after", `took ${seconds}s`);
    },
    onTurnAfter: (turnNumber) => {
      app.addEvent("turn:after", `turn #${turnNumber} done`);
      app.updateStatus(turnNumber, "idle");
    },
    onError: (error) => {
      app.addEvent("core-agent:error", error.message);
      app.updateStatus(0, "error");
    },
    onStatusChange: (status) => {
      app.updateStatus(0, status);
    },
  });

  await agent.initialize();

  const app = new App(config.maxTurns, {
    onSubmit: async (text) => {
      app.addUserMessage(text);
      app.clearInput();

      try {
        const output = await agent.run({ content: text });
        app.addAssistantMessage(output.content);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        app.addAssistantMessage(`Error: ${message}`);
      }
    },
    onInterrupt: () => {
      agent.interrupt();
    },
  });

  app.start();

  // Graceful shutdown on SIGINT
  process.on("SIGINT", () => {
    app.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
