import { generateText } from 'ai';
export class AgentLoop {
    model;
    events;
    constructor(model, events) {
        this.model = model;
        this.events = events;
    }
    async executeTurn(ctx, state) {
        await this.events.emit('turn:before', { agent: this, state });
        if (!state.budget.checkTurn()) {
            return {
                output: { content: 'Budget exceeded.', completed: true },
                toolCalls: [],
                completed: true,
                shouldContinue: false,
                usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, outputTokenDetails: { textTokens: 0, reasoningTokens: 0 } },
            };
        }
        state.currentTurn = ctx.turnNumber;
        const messages = [
            ...ctx.conversation,
            { role: 'user', content: ctx.input.content },
        ];
        await this.events.emit('phase:reason:before', { agent: this, state });
        const response = await generateText({
            model: this.model,
            system: ctx.systemPrompt,
            messages,
            tools: Object.keys(ctx.availableTools).length > 0 ? ctx.availableTools : undefined,
        });
        await this.events.emit('phase:reason:after', { agent: this, state });
        const parts = [];
        if (response.text) {
            parts.push({ type: 'text', text: response.text });
        }
        for (const tc of response.toolCalls) {
            parts.push({
                type: 'tool-call',
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                input: tc.input,
            });
        }
        state.addMessage({
            role: 'assistant',
            content: parts.length === 1 && parts[0].type === 'text'
                ? parts[0].text
                : parts,
        });
        await this.events.emit('turn:after', { agent: this, state });
        const completed = response.toolCalls.length === 0;
        return {
            output: {
                content: response.text,
                completed,
            },
            toolCalls: response.toolCalls.map(tc => ({
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                input: tc.input,
            })),
            completed,
            shouldContinue: !completed,
            usage: response.usage,
        };
    }
}
//# sourceMappingURL=loop.js.map