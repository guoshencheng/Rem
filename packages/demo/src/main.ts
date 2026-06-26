import "dotenv/config";
import { AgentServer } from "rem-agent-server";
import { TUIApp } from "rem-agent-tui";
import type { TUIAppOptions } from "rem-agent-tui";
import { spawn } from "node:child_process";
import { resolveConfig } from "./config.js";
import { createCliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";

function getChildEnv(config: ReturnType<typeof resolveConfig>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OTUI_NO_NATIVE_RENDER: "true",
    REM_AGENT_SESSIONS_DIR: config.sessionDir,
    REM_AGENT_NAME: config.agentName,
    REM_AGENT_MAX_TURNS: String(config.maxTurns),
    DEMO_AGENT_NAME: config.agentName,
    DEMO_MAX_TURNS: String(config.maxTurns),
    DEMO_PORT: String(config.port),
    DEMO_HOST: config.host,
    DEMO_SESSION_DIR: config.sessionDir,
  };
}

async function runServer(): Promise<void> {
  const config = resolveConfig();
  process.env.REM_AGENT_SESSIONS_DIR = config.sessionDir;
  process.env.REM_AGENT_NAME = config.agentName;
  process.env.REM_AGENT_MAX_TURNS = String(config.maxTurns);

  const server = new AgentServer({ port: config.port, host: config.host });
  await server.start();
  console.log(`Server ready on http://${config.host}:${config.port}`);

  process.on("SIGINT", () => {
    server.stop().finally(() => process.exit(0));
  });
}

async function runTUI(): Promise<void> {
  const config = resolveConfig();
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    targetFps: 30,
    screenMode: "alternate-screen",
  });

  process.on("SIGINT", () => {
    renderer.destroy();
    process.exit(0);
  });

  await render(() => TUIApp({
    serverUrl: `http://${config.host}:${config.port}`,
    sessionId: config.sessionId,
    maxTurns: config.maxTurns,
  }), renderer);
}

async function runAll(): Promise<void> {
  const config = resolveConfig();
  const childEnv = getChildEnv(config);

  const serverProc = spawn(
    process.execPath,
    [new URL(import.meta.url).pathname, "server"],
    { env: childEnv, stdio: "inherit" },
  );

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server startup timeout")), 5000);
    const onData = (chunk: Buffer) => {
      if (chunk.toString().includes("Server ready")) {
        clearTimeout(timer);
        serverProc.stdout?.off("data", onData);
        resolve();
      }
    };
    serverProc.stdout?.on("data", onData);
    serverProc.on("error", reject);
    serverProc.on("exit", (code) => {
      if (code !== 0) reject(new Error(`Server exited with code ${code}`));
    });
  });

  const tuiProc = spawn(
    process.execPath,
    [new URL(import.meta.url).pathname, "tui"],
    { env: childEnv, stdio: "inherit" },
  );

  tuiProc.on("exit", () => {
    serverProc.kill("SIGINT");
    process.exit(0);
  });

  process.on("SIGINT", () => {
    tuiProc.kill("SIGINT");
    serverProc.kill("SIGINT");
    process.exit(0);
  });
}

const command = process.argv.find((a) => a === "server" || a === "tui");

if (command === "server") {
  runServer().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else if (command === "tui") {
  runTUI().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  runAll().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
