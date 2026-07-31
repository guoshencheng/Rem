import type { AgentAssembly } from '../assembly/types.js';
import type { AgentSystem, CreateAgentSystemOptions } from './types.js';
import { REMAgent } from '../agent/rem-agent.js';
import { AgentRunDriver } from '../agent/agent-run-driver.js';
import { BroadcastBus } from '../agent/broadcast-bus.js';
import { SessionRuntimeRegistry } from '../session/runtime-registry.js';
import { SessionService } from '../session/service.js';
import { CoreAgentSystem } from './agent-system.js';

export function createAgentSystem(
  assembly: AgentAssembly,
  options: CreateAgentSystemOptions = {},
): AgentSystem {
  const bus = new BroadcastBus();
  const sessionService = new SessionService(assembly.di);
  const registry = new SessionRuntimeRegistry();
  const driver = new AgentRunDriver({
    sessionService,
    publish: (event) => bus.publish(event),
  });
  return new CoreAgentSystem({
    bus,
    driver,
    registry,
    sessionService,
    createRootAgent: options.createRootAgent ?? ((params) => new REMAgent(params)),
    agentParams: { di: assembly.di, runtimeConfig: assembly.runtimeConfig },
  });
}
