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
    process.env.DEMO_SESSION_DIR = "/tmp/test-sessions";

    const config = resolveConfig();

    expect(config.agentName).toBe("Test Agent");
    expect(config.maxTurns).toBe(10);
    expect(config.sessionDir).toBe("/tmp/test-sessions");
  });

  it("uses defaults when optional variables are missing", () => {
    const config = resolveConfig();

    expect(config.agentName).toBe("Core Demo Agent");
    expect(config.maxTurns).toBe(60);
  });

  it("resolves sessionDir with default path", () => {
    const config = resolveConfig();
    expect(config.sessionDir).toContain(".rem-agent");
    expect(config.sessionDir).toContain("sessions");
  });

  it("has no sessionId by default", () => {
    const config = resolveConfig();
    expect(config.sessionId).toBeUndefined();
  });
});
