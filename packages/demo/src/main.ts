import "dotenv/config";

import { App } from "./tui/app.js";
import { createDemoAgent } from "./agent.js";
import { resolveConfig } from "./config.js";

async function main(): Promise<void> {
  const config = resolveConfig();

  const agent = createDemoAgent(config.agentName, config.maxTurns, {
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
    onSubmit: (text) => {
      app.addUserMessage(text);
      app.clearInput();

      const result = agent.run({ content: text });
      const message = app.startAssistantMessage();

      (async () => {
        try {
          for await (const chunk of result.stream.fullStream) {
            message.appendChunk(chunk);
            app.requestRender();
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          app.addAssistantMessage(`Stream error: ${errorMessage}`);
        }
      })();

      result.stream.text
        .then((text) => {
          app.finalizeAssistantMessage(text);
        })
        .catch((error) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          app.addAssistantMessage(`Stream text error: ${errorMessage}`);
        });

      result.output
        .then(() => {
          app.updateConversation(agent.conversation);
        })
        .catch((error) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          app.addAssistantMessage(`Error: ${errorMessage}`);
        });
    },
    onInterrupt: () => {
      agent.interrupt();
    },
    onQuit: () => {
      app.stop();
      process.exit(0);
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
