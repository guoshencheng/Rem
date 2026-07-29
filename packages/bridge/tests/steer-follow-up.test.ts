import { describe, it, expect } from 'vitest';
import { AgentService } from '../src/agent.js';
import { ServiceError } from '../src/errors.js';

const makeService = () => {
  const di = {
    storage: { workspaceStore: {}, todoStore: {} },
    sessionProvider: {},
    ruleEngine: {},
  } as never;
  const runtimeConfig = {} as never;
  return new AgentService(di, runtimeConfig);
};

describe('AgentService steer/followUp', () => {
  it('throws 409 when session is not running', async () => {
    const service = makeService();
    await expect(service.steer('ws', 's1', 'hello')).rejects.toThrow(ServiceError);
    await expect(service.followUp('ws', 's1', 'hello')).rejects.toThrow(ServiceError);
  });
});
