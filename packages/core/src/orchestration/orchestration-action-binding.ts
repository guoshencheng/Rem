import type { AgentOrchestrationActions } from './orchestration-actions.js';

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
