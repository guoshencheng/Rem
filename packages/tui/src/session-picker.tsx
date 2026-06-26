import type { SessionSummary } from "rem-agent-sdk";

export function SessionPicker(props: {
  sessions: SessionSummary[];
  onSelect: (sessionId: string) => void;
  onCancel: () => void;
}) {
  const options = () =>
    props.sessions.map((s) => ({
      name: s.title
        ? `${s.title} (${s.sessionId.slice(0, 8)})`
        : s.sessionId.slice(0, 8),
      description: `${s.messageCount} messages`,
      value: s.sessionId,
    }));

  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%">
      <box position="absolute" left="25%" top="25%" width="50%" height="50%"
           borderStyle="rounded" padding={2} flexDirection="column">
        <text bold fg="#FFFF00">Select Session (Esc to cancel)</text>
        <box flexGrow={1}>
          <select
            options={options()}
            onSelect={(item: { value: string }) => props.onSelect(item.value)}
            onCancel={props.onCancel}
          />
        </box>
      </box>
    </box>
  );
}
