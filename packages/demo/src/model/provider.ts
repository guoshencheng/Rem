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
    // @ai-sdk/openai v1.x returns a LanguageModelV1 instance, while ai v6.0.199
    // types LanguageModel as V2/V3. The runtime object is compatible; cast to
    // bridge the major-version type mismatch.
    return openai(config.model) as unknown as LanguageModel;
  }
  throw new Error(`Unsupported provider: ${config.provider}`);
}
