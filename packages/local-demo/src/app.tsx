import { RemLocalApp, RemLocalChat } from 'rem-agent-ui/local';
import { calculatorTool, webFetchTool } from './demo-tools';

const tools = [calculatorTool, webFetchTool];

export function App() {
  const params = new URLSearchParams(window.location.search);
  const chatMode = params.get('mode') === 'chat';
  const sessionId = params.get('session') ?? undefined;

  return (
    <div className="h-screen">
      {chatMode ? (
        <RemLocalChat sessionId={sessionId} tools={tools} maxTurns={20} />
      ) : (
        <RemLocalApp tools={tools} maxTurns={20} />
      )}
    </div>
  );
}
