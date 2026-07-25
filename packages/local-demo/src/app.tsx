import { useMemo } from 'react';
import { RemLocalApp } from 'rem-agent-ui/local';
import { calculatorTool, webFetchTool } from './demo-tools';
import { createMiniMaxOpenAIProvider } from './providers';

export function App() {
  const customProviders = useMemo(() => [createMiniMaxOpenAIProvider()], []);
  return (
    <div className="h-screen">
      <RemLocalApp tools={[calculatorTool, webFetchTool]} maxTurns={20} customProviders={customProviders} />
    </div>
  );
}
