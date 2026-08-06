import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MarkdownContent } from '@/components/markdown-content';
import { ToolCallBlock } from '@/components/tool-call-block';
import { ReasoningBlock } from '@/components/reasoning-block';
import { cn } from '@/lib/utils';
import { useStreamStore } from '@/state/stream-store';
import type { ContentBlock } from '@/state/stream-reducer';
import type { Message } from 'rem-agent-core';

function Blocks({ parts }: { parts: ContentBlock[] }) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'text') return <MarkdownContent key={i} text={part.text} className="text-xs" />;
        if (part.type === 'thinking') return <ReasoningBlock key={i} text={part.thinking} />;
        return <ToolCallBlock key={i} tool={part} />;
      })}
    </>
  );
}

function ThreadMessage({ message }: { message: Message }) {
  if (message.role === 'user') {
    const content = message.content;
    const text = typeof content === 'string'
      ? content
      : (content as Array<{ type: string; text?: string }>)
          .filter((p) => p.type === 'text')
          .map((p) => p.text)
          .join('\n');
    return <div className="rounded-md bg-muted px-2.5 py-1.5 text-xs">{text}</div>;
  }
  if (message.role === 'assistant') {
    return <Blocks parts={message.content as ContentBlock[]} />;
  }
  return null;
}

interface ThreadPanelProps {
  sessionId: string;
}

export function ThreadPanel({ sessionId }: ThreadPanelProps) {
  const session = useStreamStore((s) => s.bySession[sessionId]);
  const threads = session?.threads ?? [];
  const [selected, setSelected] = useState<string>();
  const active = threads.find((t) => t.agentThreadId === selected) ?? threads[0];

  if (threads.length === 0) return null;

  const messages = active ? session?.threadMessages[active.agentThreadId] ?? [] : [];
  const streaming = active ? session?.streaming[active.agentThreadId] : undefined;

  return (
    <div className="flex h-full w-[300px] flex-col">
      <Tabs value={active?.agentThreadId} onValueChange={setSelected}>
        <TabsList className="m-2 flex-wrap">
          {threads.map((t) => (
            <TabsTrigger key={t.agentThreadId} value={t.agentThreadId} className="text-[10px]">
              <span className={cn(
                'mr-1 inline-block size-1.5 rounded-full',
                session?.streaming[t.agentThreadId] ? 'bg-emerald-400' : 'bg-muted-foreground/40',
              )} />
              {t.agentId}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="px-3 pb-1 text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {active?.agentId} · 私有视角
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2 p-3">
          {messages.map((m, i) => <ThreadMessage key={i} message={m} />)}
          {streaming && <Blocks parts={streaming} />}
        </div>
      </ScrollArea>
    </div>
  );
}
