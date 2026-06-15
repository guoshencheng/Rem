import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
    process.env.DEMO_AGENT_NAME = "Test Agent";
    process.env.DEMO_MAX_TURNS = "10";

    const config = resolveConfig();

    expect(config.agentName).toBe("Test Agent");
    expect(config.maxTurns).toBe(10);
  });

  it("uses defaults when optional variables are missing", () => {
    const config = resolveConfig();

    expect(config.agentName).toBe("Core Demo Agent");
    expect(config.maxTurns).toBe(60);
  });
});
