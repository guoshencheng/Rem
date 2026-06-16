import type { CoreAgent } from '../core-agent.js';
import type { AgentStatus, AgentStreamChunk } from '../types.js';
import type { UIAgentSession, UISessionCallbacks } from './types.js';

export function createUIAgentSession(
  agent: CoreAgent,
  initialCallbacks: UISessionCallbacks = {},
): UIAgentSession {
  let callbacks = initialCallbacks;

  const updateStatus = (status: AgentStatus) => {
    callbacks.onStatusChange?.(status);
  };

  agent.on('core-agent:start', () => {
    callbacks.onStart?.();
    updateStatus('running');
  });

  agent.on('core-agent:stop', () => {
    callbacks.onStop?.();
    updateStatus('idle');
  });

  agent.on('core-agent:error', () => {
    updateStatus('error');
    callbacks.onError?.(new Error('Agent error'));
  });

  agent.on('turn:before', (ctx) => {
    const turnNumber = ctx.state.currentTurn;
    const maxTurns = agent.maxTurns;
    callbacks.onTurnChange?.(turnNumber, maxTurns);
  });

  return {
    get status() {
      return agent.status;
    },
    get currentTurn() {
      return agent.conversation.filter((m) => m.role === 'user').length;
    },
    get maxTurns() {
      return agent.maxTurns;
    },

    setCallbacks(newCallbacks: UISessionCallbacks) {
      callbacks = newCallbacks;
    },

    submit(text: string) {
      callbacks.onUserMessage?.(text);

      const result = agent.run({ content: text });

      (async () => {
        try {
          for await (const chunk of result.stream.fullStream) {
            callbacks.onStreamChunk?.(chunk);
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          callbacks.onError?.(err);
        }
      })();

      result.stream.text
        .then((finalText) => {
          callbacks.onAssistantMessageFinalized?.(finalText);
        })
        .catch((error) => {
          const err = error instanceof Error ? error : new Error(String(error));
          callbacks.onError?.(err);
        });

      result.output.catch((error) => {
        const err = error instanceof Error ? error : new Error(String(error));
        callbacks.onError?.(err);
      });
    },

    interrupt() {
      agent.interrupt();
    },

    async reset() {
      await agent.reset();
    },
  };
}
