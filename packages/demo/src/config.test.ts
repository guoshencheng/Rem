import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveConfig } from "./config.js";

describe("resolveConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("uses environment variables and defaults", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.DEMO_MODEL = "gpt-4o";
    process.env.DEMO_AGENT_NAME = "Test Agent";
    process.env.DEMO_MAX_TURNS = "10";

    const config = resolveConfig();

    expect(config.agentName).toBe("Test Agent");
    expect(config.maxTurns).toBe(10);
  });

  it("uses defaults when optional variables are missing", () => {
    process.env.OPENAI_API_KEY = "sk-test";

    const config = resolveConfig();

    expect(config.agentName).toBe("Core Demo Agent");
    expect(config.maxTurns).toBe(60);
  });

  it("exits when OPENAI_API_KEY is missing", () => {
    delete process.env.OPENAI_API_KEY;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => resolveConfig()).toThrow("process.exit called");
    expect(errorSpy).toHaveBeenCalledWith("Error: OPENAI_API_KEY environment variable is required.");

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
