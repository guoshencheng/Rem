import type { Message } from 'rem-agent-core';
import { MarkdownContent } from '@/components/markdown-content';
import { ReasoningBlock } from '@/components/reasoning-block';
import { ToolCallBlock } from '@/components/tool-call-block';
import type { ToolResultInfo } from '@/components/tool-call-block';
import type { ContentBlock } from '@/state/runtime-stream-projection';

export type ToolResultMap = Record<string, ToolResultInfo>;

export function RuntimeMessageContent({
  parts, toolResults = {},
}: { parts: ContentBlock[]; toolResults?: ToolResultMap }) {
  return (
    <>
      {parts.map((part, index) => {
        if (part.type === 'text') return <MarkdownContent key={index} text={part.text} className="text-body leading-body" />;
        if (part.type === 'thinking') return <ReasoningBlock key={index} text={part.thinking} />;
        if (part.type === 'toolCall') return <ToolCallBlock key={part.id} tool={part} result={toolResults[part.id]} />;
        return null;
      })}
    </>
  );
}

export function RuntimeMessage({ message, toolResults }: { message: Message; toolResults: ToolResultMap }) {
  if (message.role === 'user') return <div className="rounded-md bg-raised p-[var(--ds-space-inner)] text-body leading-body text-secondary-foreground">{messageText(message)}</div>;
  if (message.role === 'assistant') return <RuntimeMessageContent parts={message.content as ContentBlock[]} toolResults={toolResults} />;
  return null;
}

function messageText(message: Extract<Message, { role: 'user' }>): string {
  if (typeof message.content === 'string') return message.content;
  return message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
}
