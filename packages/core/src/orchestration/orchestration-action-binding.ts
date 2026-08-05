import type { AgentOrchestrationActions } from './orchestration-actions.js';

/** 编排工具绑定器：agent 创建时拿到稳定的 actions 门面，beforeRun 时再 bind 到当前 delivery 的实际实现（organizer 与 member 工具集不同）。 */
export class OrchestrationActionBinding {
  readonly actions: AgentOrchestrationActions;
  private current?: AgentOrchestrationActions;

  constructor(canFinish: boolean) {
    this.actions = {
      sendMessage: (input) => this.requireCurrent().sendMessage(input),
      ...(canFinish ? { finishDiscussion: (answer: string) => {
        const finish = this.requireCurrent().finishDiscussion;
        if (!finish) throw new Error('finish_discussion is not available');
        return finish(answer);
      } } : {}),
    };
  }

  bind(actions: AgentOrchestrationActions): void { this.current = actions; }

  private requireCurrent(): AgentOrchestrationActions {
    if (!this.current) throw new Error('Agent orchestration actions are not bound to a Delivery');
    return this.current;
  }
}
