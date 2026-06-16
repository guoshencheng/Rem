import { describe, it, expect } from "vitest";
import { ChatLog } from "../src/chat-log.js";

describe("ChatLog", () => {
  it("prunes old messages when exceeding maxMessages", () => {
    const chatLog = new ChatLog(3);
    chatLog.addUser("msg 1");
    chatLog.addUser("msg 2");
    chatLog.addUser("msg 3");
    chatLog.addUser("msg 4");

    expect(chatLog.children.length).toBe(3);
  });
});
