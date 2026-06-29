import type { AgentService, SessionService } from 'rem-agent-bridge';

export type AppContext = {
  Variables: {
    agentService: AgentService;
    sessionService: SessionService;
  };
};
