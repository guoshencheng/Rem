import { tool } from 'ai';
export class InMemoryToolProvider {
    tools = new Map();
    register(def, executor) {
        this.tools.set(def.name, { def, executor });
    }
    getToolSet() {
        const result = {};
        for (const [name, { def }] of this.tools) {
            result[name] = tool({
                description: def.description,
                parameters: def.parameters,
            });
        }
        return result;
    }
    async execute(calls) {
        const results = [];
        for (const call of calls) {
            const registered = this.tools.get(call.toolName);
            if (!registered) {
                results.push({
                    toolCallId: call.toolCallId,
                    toolName: call.toolName,
                    output: '',
                    error: `Tool "${call.toolName}" not found`,
                });
                continue;
            }
            try {
                const output = await registered.executor(call.input);
                results.push({
                    toolCallId: call.toolCallId,
                    toolName: call.toolName,
                    output,
                });
            }
            catch (err) {
                results.push({
                    toolCallId: call.toolCallId,
                    toolName: call.toolName,
                    output: '',
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        return results;
    }
}
//# sourceMappingURL=in-memory-tool-provider.js.map