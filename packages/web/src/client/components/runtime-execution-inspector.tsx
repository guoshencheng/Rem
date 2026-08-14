import { useEffect, useState } from 'react';
import type { Run } from 'rem-agent-core';
import { api, type RuntimeRunInspectorData } from '@/api/client';
import { SectionLabel } from '@/components/section-label';
import { StatusDot } from '@/components/status-dot';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface RuntimeExecutionInspectorProps {
  sessionId: string;
  onResolved?: () => Promise<void> | void;
}

const statusLabel: Record<Run['status'] | 'idle', string> = {
  queued: '排队中', idle: '空闲', running: '执行中', waiting: '待处置', completed: '已完成', failed: '失败', cancelled: '已取消',
};

export function RuntimeExecutionInspector({ sessionId, onResolved }: RuntimeExecutionInspectorProps) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [detail, setDetail] = useState<RuntimeRunInspectorData>();
  const [error, setError] = useState<string>();
  const [resolving, setResolving] = useState<string>();

  useEffect(() => {
    let active = true;
    setDetail(undefined); setSelectedRunId(undefined); setError(undefined);
    void api.listRuns(sessionId).then((items) => {
      if (!active) return;
      setRuns(items);
      setSelectedRunId(items[0]?.runId);
    }).catch((reason) => { if (active) setError(toMessage(reason)); });
    return () => { active = false; };
  }, [sessionId]);

  useEffect(() => {
    if (!selectedRunId) return;
    let active = true;
    setDetail(undefined); setError(undefined);
    void api.getRunInspector(selectedRunId).then((value) => {
      if (active) setDetail(value);
    }).catch((reason) => { if (active) setError(toMessage(reason)); });
    return () => { active = false; };
  }, [selectedRunId]);

  const refreshDetail = async () => {
    if (selectedRunId) setDetail(await api.getRunInspector(selectedRunId));
  };

  const resolve = async (invocationId: string, action: 'confirm-succeeded' | 'retry' | 'fail') => {
    if (!selectedRunId) return;
    setResolving(invocationId); setError(undefined);
    try {
      const output = action === 'confirm-succeeded' ? (window.prompt('记录工具结果', '') ?? '') : '';
      const resolved = await api.resolveToolInvocation(selectedRunId, invocationId, action === 'confirm-succeeded'
        ? { action, result: { output }, idempotencyKey: `web:resolve:${invocationId}:${Date.now()}` }
        : { action, idempotencyKey: `web:resolve:${invocationId}:${Date.now()}` });
      if (resolved.status === 'queued') await api.waitForRun(selectedRunId);
      await refreshDetail();
      await onResolved?.();
    } catch (reason) { setError(toMessage(reason)); }
    finally { setResolving(undefined); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col p-[var(--ds-space-panel)]">
      <SectionLabel className="mb-[var(--ds-space-card)]">运行检查器</SectionLabel>
      {error && <p className="mb-[var(--ds-space-card)] text-meta text-destructive">{error}</p>}
      {runs.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>还没有任务运行</EmptyTitle>
            <EmptyDescription>发送一条消息后，这里会显示执行节点和工具审计。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <ScrollArea className="max-h-44 shrink-0">
            <div className="grid gap-[var(--ds-space-tree)] pr-[var(--ds-space-tree)]">
              {runs.map((run) => (
                <button
                  key={run.runId}
                  type="button"
                  onClick={() => setSelectedRunId(run.runId)}
                  className={cn(
                    'flex min-w-0 items-center gap-[var(--ds-space-row-gap)] rounded-md border border-transparent px-[var(--ds-space-row-x)] py-[var(--ds-space-tree)] text-left text-meta hover:bg-hover',
                    selectedRunId === run.runId && 'border-selected-border bg-selected-bg',
                  )}
                >
                  <StatusDot tone={run.status === 'running' || run.status === 'queued' ? 'running' : 'offline'} />
                  <span className="min-w-0 flex-1 truncate">{run.runId}</span>
                  <Badge size="tag" variant={run.status === 'failed' ? 'destructive' : 'secondary'}>{statusLabel[run.status]}</Badge>
                </button>
              ))}
            </div>
          </ScrollArea>
          {detail && <RunDetail detail={detail} resolving={resolving} onResolve={(id, action) => void resolve(id, action)} />}
        </>
      )}
    </div>
  );
}

function RunDetail({
  detail, resolving, onResolve,
}: {
  detail: RuntimeRunInspectorData;
  resolving?: string;
  onResolve: (invocationId: string, action: 'confirm-succeeded' | 'retry' | 'fail') => void;
}) {
  return (
    <ScrollArea className="mt-[var(--ds-space-card-group)] min-h-0 flex-1">
      <div className="grid gap-[var(--ds-space-card-group)] pr-[var(--ds-space-tree)]">
        <Card>
          <CardHeader><CardTitle>{detail.run.executionType === 'team' ? 'Team Run' : 'Single Agent Run'}</CardTitle><CardDescription>{detail.run.agentId} · {detail.run.agentRevision}</CardDescription></CardHeader>
          <CardContent className="grid grid-cols-2 gap-[var(--ds-space-tree)]">
            <Metric label="节点" value={detail.nodes.length} />
            <Metric label="投递" value={detail.deliveries.length} />
            <Metric label="日志" value={detail.entries.length} />
            <Metric label="工具" value={detail.invocations.length} />
          </CardContent>
        </Card>
        <section>
          <SectionLabel className="mb-[var(--ds-space-card)]">Execution Nodes</SectionLabel>
          <div className="grid gap-[var(--ds-space-tree)]">
            {detail.nodes.map((node) => <div key={node.nodeId} className="flex items-center justify-between rounded-sm bg-surface px-[var(--ds-space-inner)] py-[var(--ds-space-tree)] text-meta"><span className="truncate">{node.role} · {node.agentId}</span><Badge size="tag">{statusLabel[node.status]}</Badge></div>)}
          </div>
        </section>
        {detail.deliveries.length > 0 && <section><SectionLabel className="mb-[var(--ds-space-card)]">Deliveries</SectionLabel><div className="grid gap-[var(--ds-space-tree)]">{detail.deliveries.map((delivery) => <div key={delivery.deliveryId} className="rounded-sm bg-surface px-[var(--ds-space-inner)] py-[var(--ds-space-tree)] text-meta"><div className="flex items-center justify-between gap-2"><span className="truncate">{delivery.kind} · batch {delivery.batchId}</span><Badge size="tag">{statusLabel[delivery.status]}</Badge></div><div className="mt-1 flex flex-wrap gap-x-3 text-label text-muted-foreground"><span>attempt {delivery.attempt}</span>{delivery.requestedByNodeId && <span>from {delivery.requestedByNodeId}</span>}{delivery.resultEntryId && <span>result {delivery.resultEntryId}</span>}{delivery.errorCode && <span className="text-destructive">{delivery.errorCode}</span>}</div></div>)}</div></section>}
        {detail.invocations.length > 0 && <section><SectionLabel className="mb-[var(--ds-space-card)]">Tool Invocations</SectionLabel><div className="grid gap-[var(--ds-space-tree)]">{detail.invocations.map((invocation) => <InvocationCard key={invocation.invocationId} invocation={invocation} resolving={resolving} onResolve={onResolve} />)}</div></section>}
      </div>
    </ScrollArea>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-sm bg-surface p-[var(--ds-space-inner)]"><div className="text-label text-muted-foreground">{label}</div><div className="text-composite-text">{value}</div></div>;
}

function InvocationCard({
  invocation, resolving, onResolve,
}: {
  invocation: RuntimeRunInspectorData['invocations'][number];
  resolving?: string;
  onResolve: (invocationId: string, action: 'confirm-succeeded' | 'retry' | 'fail') => void;
}) {
  const unsafeRetry = invocation.sideEffect === 'non-idempotent' && !invocation.supportsIdempotencyKey;
  return <div className="rounded-sm bg-surface px-[var(--ds-space-inner)] py-[var(--ds-space-tree)] text-meta"><div className="flex justify-between gap-2"><span className="truncate">{invocation.toolName}</span><Badge size="tag">{invocation.status}</Badge></div><code className="mt-1 block truncate text-label text-muted-foreground">{invocation.toolCallId}</code>{invocation.status === 'unknown' && <div className="mt-2 flex gap-1"><button type="button" disabled={resolving === invocation.invocationId} onClick={() => onResolve(invocation.invocationId, 'confirm-succeeded')}>确认成功</button><button type="button" disabled={resolving === invocation.invocationId || unsafeRetry} title={unsafeRetry ? '非幂等工具且不支持幂等键，不能安全重试' : undefined} onClick={() => onResolve(invocation.invocationId, 'retry')}>重试</button><button type="button" disabled={resolving === invocation.invocationId} onClick={() => onResolve(invocation.invocationId, 'fail')}>标记失败</button></div>}</div>;
}

function toMessage(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
