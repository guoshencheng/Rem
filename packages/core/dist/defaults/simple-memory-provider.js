export class SimpleMemoryProvider {
    agentName;
    constructor(agentName) {
        this.agentName = agentName;
    }
    async buildContext(state) {
        return {
            systemPrompt: `You are ${this.agentName}.`,
            messages: state.conversation,
        };
    }
}
//# sourceMappingURL=simple-memory-provider.js.map