import { RemLocalApp } from 'rem-agent-ui/local';
import { calculatorTool, webFetchTool } from './demo-tools';

export function App() {
  return (
    <div className="h-screen">
      <RemLocalApp tools={[calculatorTool, webFetchTool]} maxTurns={20} />
    </div>
  );
}
