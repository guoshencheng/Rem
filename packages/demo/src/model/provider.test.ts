import { describe, it, expect } from "vitest";
import { createLanguageModel, type ProviderConfig } from "./provider.js";

describe("createLanguageModel", () => {
  it("returns an OpenAI language model for provider 'openai'", () => {
    const config: ProviderConfig = {
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-4.1",
    };
    const model = createLanguageModel(config);
    expect(model).toBeDefined();
    expect(model.provider).toBe("openai.chat");
  });

  it("throws for unsupported providers", () => {
    const config = {
      provider: "unsupported",
      apiKey: "test-key",
      model: "model",
    } as unknown as ProviderConfig;
    expect(() => createLanguageModel(config)).toThrow("Unsupported provider: unsupported");
  });
});
