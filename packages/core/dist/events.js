export class EventBus {
    handlers = new Map();
    on(event, handler, priority = 50) {
        const list = this.handlers.get(event) ?? [];
        list.push({ handler, priority });
        list.sort((a, b) => b.priority - a.priority);
        this.handlers.set(event, list);
        return () => {
            const updated = list.filter(h => h.handler !== handler);
            this.handlers.set(event, updated);
        };
    }
    once(event, handler, priority = 50) {
        const off = this.on(event, async (ctx) => {
            off();
            await handler(ctx);
        }, priority);
    }
    async emit(event, ctx) {
        const list = this.handlers.get(event) ?? [];
        for (const entry of list) {
            await entry.handler(ctx);
        }
    }
}
//# sourceMappingURL=events.js.map