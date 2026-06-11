import type { MemoryProvider, MemoryContext } from '../sdk/memory-provider.js';
import type { AgentState } from '../state.js';
export declare class SimpleMemoryProvider implements MemoryProvider {
    private agentName;
    constructor(agentName: string);
    buildContext(state: AgentState): Promise<MemoryContext>;
}
//# sourceMappingURL=simple-memory-provider.d.ts.map