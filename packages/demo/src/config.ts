import { createLanguageModel, type ProviderConfig } from "./model/provider.js";
import type { LanguageModel } from "ai";

export interface DemoConfig {
  model: LanguageModel;
  agentName: string;
  maxTurns: number;
}

function getEnv(key: string): string | undefined {
  return process.env[key];
}

export function resolveConfig(): DemoConfig {
  const apiKey = getEnv("OPENAI_API_KEY");
  if (!apiKey) {
    console.error("Error: OPENAI_API_KEY environment variable is required.");
    console.error("Set it with: export OPENAI_API_KEY=sk-...");
    process.exit(1);
  }

  const modelName = getEnv("DEMO_MODEL") ?? "gpt-4.1";
  const agentName = getEnv("DEMO_AGENT_NAME") ?? "Core Demo Agent";
  const maxTurns = parseInt(getEnv("DEMO_MAX_TURNS") ?? "60", 10);

  const providerConfig: ProviderConfig = {
    provider: "openai",
    apiKey,
    model: modelName,
  };

  return {
    model: createLanguageModel(providerConfig),
    agentName,
    maxTurns,
  };
}
