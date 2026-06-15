import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export interface ProviderConfig {
  provider: "openai";
  apiKey: string;
  model: string;
}

export function createLanguageModel(config: ProviderConfig): LanguageModel {
  if (config.provider === "openai") {
    const openai = createOpenAI({ apiKey: config.apiKey });
    return openai(config.model);
  }
  throw new Error(`Unsupported provider: ${config.provider}`);
}
