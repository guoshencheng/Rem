import type { CliRenderer } from "@opentui/core";
import {
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  SelectRenderableEvents,
} from "@opentui/core";
import type { InputRenderable } from "@opentui/core";
import type { IAgentService, SessionSummary } from "rem-agent-bridge";

export function showPicker(params: {
  renderer: CliRenderer;
  overlayBox: BoxRenderable;
  sessions: SessionSummary[];
  onSelect: (sessionId: string) => void;
}): void {
  const options = params.sessions.map((s) => ({
    name: s.title
      ? `${s.title} (${s.sessionId.slice(0, 8)})`
      : s.sessionId.slice(0, 8),
    description: `${s.messageCount} messages`,
    value: s.sessionId,
  }));

  params.overlayBox.remove("picker-content");
  params.overlayBox.remove("picker-select");

  const selectNode = new SelectRenderable(params.renderer, { id: "picker-select", options });
  selectNode.on(SelectRenderableEvents.ITEM_SELECTED, (_index: number, option: { value: string } | null) => {
    if (option) {
      params.onSelect(option.value);
    }
  });

  const pickerBox = new BoxRenderable(params.renderer, {
    id: "picker-content",
    position: "absolute",
    left: "25%",
    top: "25%",
    width: "50%",
    height: "50%",
    borderStyle: "rounded",
    padding: 2,
    flexDirection: "column",
  });
  pickerBox.add(new TextRenderable(params.renderer, {
    content: "Select Session (Esc to cancel)",
    fg: "#FFFF00",
  }));
  const selectWrapper = new BoxRenderable(params.renderer, { flexGrow: 1 });
  selectWrapper.add(selectNode);
  pickerBox.add(selectWrapper);

  params.overlayBox.add(pickerBox);
  params.overlayBox.visible = true;
  selectNode.focus();
}

export function hidePicker(params: {
  overlayBox: BoxRenderable;
  inputNode: InputRenderable;
}): void {
  params.overlayBox.visible = false;
  params.inputNode.focus();
}

export async function switchSession(params: {
  agentService: IAgentService;
  workspace: string;
  currentSessionId: string;
  onClearChat: () => void;
  onUpdateStatus: () => void;
}): Promise<void> {
  params.agentService.interrupt(params.workspace, params.currentSessionId).catch(() => {});
  params.onClearChat();
  params.onUpdateStatus();
}
