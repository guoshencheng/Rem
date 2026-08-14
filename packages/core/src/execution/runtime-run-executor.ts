import type { AgentRun } from '../domain/run/types.js';
import type { RunExecutor } from './run-executor.js';
import type { TeamRunExecutor } from './team-run-executor.js';

export class RuntimeRunExecutor implements RunExecutor {
  constructor(private readonly single: RunExecutor, private readonly team: TeamRunExecutor) {}
  execute(input: Parameters<RunExecutor['execute']>[0]): ReturnType<RunExecutor['execute']> {
    const team = input.run.executionType === 'team' || input.run.executionPlanSnapshot?.executionType === 'team';
    return (team ? this.team : this.single).execute(input);
  }
}

export function isTeamRun(run: AgentRun): boolean { return run.executionType === 'team' || run.executionPlanSnapshot?.executionType === 'team'; }
