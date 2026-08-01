import type { AgentDI } from '../assembly/agent-di.js';
import type { Session } from '../session/model.js';
import type { RemMetaEvent } from './types.js';
import { log } from '../infrastructure/observability/debug-log.js';

/**
 * 会话标题生成：异步触发，经 emit 发出 session-title meta 事件，由上层 SessionUsecase 落盘。
 * 由 REMAgent 构造函数作为协作编排调用；不在此处自行启动之外的副作用。
 */
export function forkSessionTitleGeneration(params: {
  di: AgentDI;
  session: Session;
  emit: (event: RemMetaEvent) => void;
}): void {
  const { di, session, emit } = params;
  if (session.metadata.title) return;
  void (async () => {
    try {
      const title = await di.titleProvider.generateTitle(session.conversation);
      if (title) {
        log('title', 'generated', { sessionId: session.sessionId, title });
        emit({ type: 'session-title', title });
      }
    } catch {
      log('title', 'failed', { sessionId: session.sessionId });
    }
  })();
}
