import type { AgentAssembly } from '../assembly/types.js';
import type { AgentSystem, CreateAgentSystemOptions } from './types.js';
import { REMAgent } from '../agent/rem-agent.js';
import { AgentRunDriver } from '../agent/agent-run-driver.js';
import { BroadcastBus } from '../agent/broadcast-bus.js';
import { SessionRuntimeRegistry } from '../session/runtime-registry.js';
import { SessionUsecase } from '../session/session-usecase.js';
import { CoreAgentSystem } from './agent-system.js';
import { DelegationEventDriver } from '../delegation/event-driver.js';
import { DelegationRunner } from '../delegation/runner.js';
import { resolveDelegationMaxDepth } from '../delegation/depth.js';
import { AgentThreadUsecase } from '../session/agent-thread/agent-thread-usecase.js';
import { SessionAgentContextUsecase } from '../session/session-agent-context-usecase.js';
import { MultiAgentCoordinator } from '../orchestration/multi-agent-coordinator.js';

export function createAgentSystem(
  assembly: AgentAssembly,
  options: CreateAgentSystemOptions = {},
): AgentSystem {
  const bus = new BroadcastBus();
  const sessionUsecase = new SessionUsecase(assembly.di);
  const threadUsecase = new AgentThreadUsecase(assembly.di.storage.agentThreadStore);
  const contextUsecase = new SessionAgentContextUsecase({
    sessionProvider: assembly.di.sessionProvider,
    configProvider: assembly.di.configProvider,
    threadUsecase,
  });
  const registry = new SessionRuntimeRegistry();
  const driver = new AgentRunDriver({
    sessionUsecase,
    publish: (event) => bus.publish(event),
  });
  const createAgent = options.createRootAgent ?? ((params) => new REMAgent(params));
  const delegationRunner = new DelegationRunner({
    di: assembly.di,
    runtimeConfig: assembly.runtimeConfig,
    sessionUsecase,
    eventDriver: new DelegationEventDriver(sessionUsecase),
    threadUsecase,
    createAgent,
    publish: (event) => bus.publish(event),
    maxDepth: resolveDelegationMaxDepth(options.delegation?.maxDepth),
  });
  const multiAgentCoordinator = new MultiAgentCoordinator({
    di: assembly.di,
    runtimeConfig: assembly.runtimeConfig,
    sessionUsecase,
    threadUsecase,
    contextUsecase,
    delegationRunner,
    createAgent,
    publish: (event) => bus.publish(event),
  });
  return new CoreAgentSystem({
    bus,
    driver,
    registry,
    sessionUsecase,
    threadUsecase,
    contextUsecase,
    createRootAgent: createAgent,
    delegationRunner,
    agentParams: { di: assembly.di, runtimeConfig: assembly.runtimeConfig },
    multiAgentCoordinator,
  });
}
