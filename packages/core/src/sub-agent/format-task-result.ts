function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface FormatTaskResultParams {
  childSessionId: string;
  task: string;
  content: string;
  failed?: boolean;
}

export function formatTaskResult(params: FormatTaskResultParams): string {
  const state = params.failed ? 'failed' : 'completed';
  return `<task id="${params.childSessionId}" state="${state}">\n  <summary>${escapeXml(params.task)}</summary>\n  <task_result>\n${params.content}\n  </task_result>\n</task>`;
}
