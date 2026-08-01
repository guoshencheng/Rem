import type { AgentAssembly } from '../assembly/types.js';
import type { AgentSystem, CreateAgentSystemOptions } from './types.js';
import { REMAgent } from '../agent/rem-agent.js';
import { AgentRunDriver } from '../agent/agent-run-driver.js';
import { BroadcastBus } from '../agent/broadcast-bus.js';
import { SessionRuntimeRegistry } from '../session/runtime-registry.js';
import { SessionService } from '../session/service.js';
import { CoreAgentSystem } from './agent-system.js';
import { DelegationEventDriver } from '../delegation/event-driver.js';
import { DelegationRunner } from '../delegation/runner.js';
import { resolveDelegationMaxDepth } from '../delegation/depth.js';
import { AgentProfileService } from '../agent-profile/service.js';
import { AgentThreadService } from '../session/agent-thread/service.js';
import { SessionAgentContextService } from '../session/agent-context-service.js';

export function createAgentSystem(
  assembly: AgentAssembly,
  options: CreateAgentSystemOptions = {},
): AgentSystem {
  const bus = new BroadcastBus();
  const sessionService = new SessionService(assembly.di);
  const profileService = new AgentProfileService(assembly.di.storage.agentProfileStore);
  const threadService = new AgentThreadService(assembly.di.storage.agentThreadStore);
  const contextService = new SessionAgentContextService({
    sessionProvider: assembly.di.sessionProvider,
    profileService,
    threadService,
  });
  const registry = new SessionRuntimeRegistry();
  const driver = new AgentRunDriver({
    sessionService,
    publish: (event) => bus.publish(event),
  });
  const createAgent = options.createRootAgent ?? ((params) => new REMAgent(params));
  const delegationRunner = new DelegationRunner({
    di: assembly.di,
    runtimeConfig: assembly.runtimeConfig,
    sessionService,
    eventDriver: new DelegationEventDriver(sessionService),
    threadService,
    createAgent,
    publish: (event) => bus.publish(event),
    maxDepth: resolveDelegationMaxDepth(options.delegation?.maxDepth),
  });
  return new CoreAgentSystem({
    bus,
    driver,
    registry,
    sessionService,
    profileService,
    threadService,
    contextService,
    createRootAgent: createAgent,
    delegationRunner,
    agentParams: { di: assembly.di, runtimeConfig: assembly.runtimeConfig },
  });
}
