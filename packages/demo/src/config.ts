export interface DemoConfig {
  agentName: string;
  maxTurns: number;
}

export function resolveConfig(): DemoConfig {
  const agentName = process.env.DEMO_AGENT_NAME ?? 'Core Demo Agent';
  const maxTurns = parseInt(process.env.DEMO_MAX_TURNS ?? '60', 10);

  return {
    agentName,
    maxTurns,
  };
}
