import { useEffect } from 'react';
import type { Message } from 'rem-agent-core';
import { SectionLabel } from '@/components/section-label';
import { StatusDot } from '@/components/status-dot';
import {
  ThreadContentBlocks,
  ThreadMessage,
} from '@/components/thread-message';
import type { ToolResultMap } from '@/components/thread-message';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStreamStore } from '@/state/stream-store';

interface CollaborationInspectorProps {
  sessionId: string;
  selectedThreadId?: string;
  onSelectedThreadChange: (threadId: string) => void;
}

function resultText(message: Extract<Message, { role: 'toolResult' }>): string {
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function collectToolResults(messages: Message[]): ToolResultMap {
  return Object.fromEntries(
    messages
      .filter((message): message is Extract<Message, { role: 'toolResult' }> => (
        message.role === 'toolResult'
      ))
      .map((message) => [
        message.toolCallId,
        message.isError ? { error: resultText(message) } : { output: resultText(message) },
      ]),
  );
}

export function CollaborationInspector({
  sessionId,
  selectedThreadId,
  onSelectedThreadChange,
}: CollaborationInspectorProps) {
  const session = useStreamStore((state) => state.bySession[sessionId]);
  const threads = session?.threads ?? [];
  const active = threads.find((thread) => thread.agentThreadId === selectedThreadId) ?? threads[0];

  useEffect(() => {
    if (active && active.agentThreadId !== selectedThreadId) {
      onSelectedThreadChange(active.agentThreadId);
    }
  }, [active, onSelectedThreadChange, selectedThreadId]);

  if (!active) {
    return (
      <div className="flex h-full p-[var(--ds-space-panel)]">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>没有协作 Thread</EmptyTitle>
            <EmptyDescription>Agent Thread 创建后会显示在这里</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const messages = session?.threadMessages[active.agentThreadId] ?? [];
  const streaming = session?.streaming[active.agentThreadId];
  const toolResults = collectToolResults(messages);
  const running = streaming !== undefined;

  return (
    <div className="flex h-full min-h-0 flex-col p-[var(--ds-space-panel)]">
      <SectionLabel className="mb-[var(--ds-space-card)]">协作线程</SectionLabel>
      <Tabs value={active.agentThreadId} onValueChange={onSelectedThreadChange}>
        <TabsList className="max-w-full justify-start overflow-x-auto">
          {threads.map((thread) => (
            <TabsTrigger key={thread.agentThreadId} value={thread.agentThreadId}>
              <StatusDot
                tone={session?.streaming[thread.agentThreadId] ? 'running' : 'offline'}
              />
              <span className="max-w-20 truncate">{thread.agentId}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mt-[var(--ds-space-card-group)]">
        <h2 className="truncate text-panel-title leading-compact font-semibold">
          {active.agentId}
        </h2>
        <p className="truncate text-meta leading-compact text-muted-foreground">
          {active.role} · {active.agentThreadId}
        </p>
      </div>

      <Card className="mt-[var(--ds-space-card-group)]">
        <CardHeader>
          <CardTitle>运行状态</CardTitle>
          <CardDescription>{running ? '正在生成私有消息' : '当前 Thread 空闲'}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-sm bg-surface p-[var(--ds-space-inner)]">
            <span>消息</span>
            <span className="text-composite-text">{messages.length}</span>
          </div>
        </CardContent>
      </Card>

      <Alert className="mt-[var(--ds-space-card-group)]">
        <AlertDescription>私有内容不会进入用户可见的公开会话。</AlertDescription>
      </Alert>

      <SectionLabel className="mb-[var(--ds-space-card)] mt-[var(--ds-space-card-group)]">
        私有消息
      </SectionLabel>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-[var(--ds-space-card)] pr-[var(--ds-space-tree)]">
          {messages.map((message, index) => (
            <ThreadMessage key={index} message={message} toolResults={toolResults} />
          ))}
          {streaming && <ThreadContentBlocks parts={streaming} />}
        </div>
      </ScrollArea>
    </div>
  );
}
