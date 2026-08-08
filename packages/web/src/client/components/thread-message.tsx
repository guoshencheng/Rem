import type { Message } from 'rem-agent-core';
import type { ContentBlock } from '@/state/stream-reducer';
import { MarkdownContent } from '@/components/markdown-content';
import { ReasoningBlock } from '@/components/reasoning-block';
import { ToolCallBlock } from '@/components/tool-call-block';
import type { ToolResultInfo } from '@/components/tool-call-block';

export type ToolResultMap = Record<string, ToolResultInfo>;

export function ThreadContentBlocks({
  parts,
  toolResults = {},
}: {
  parts: ContentBlock[];
  toolResults?: ToolResultMap;
}) {
  return (
    <>
      {parts.map((part, index) => {
        if (part.type === 'text') {
          return <MarkdownContent key={index} text={part.text} className="text-body leading-body" />;
        }
        if (part.type === 'thinking') {
          return <ReasoningBlock key={index} text={part.thinking} />;
        }
        return <ToolCallBlock key={part.id} tool={part} result={toolResults[part.id]} />;
      })}
    </>
  );
}

function userMessageText(message: Extract<Message, { role: 'user' }>): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

export function ThreadMessage({
  message,
  toolResults,
}: {
  message: Message;
  toolResults: ToolResultMap;
}) {
  if (message.role === 'user') {
    return (
      <div className="rounded-md bg-raised p-[var(--ds-space-inner)] text-body leading-body text-secondary-foreground">
        {userMessageText(message)}
      </div>
    );
  }
  if (message.role === 'assistant') {
    return <ThreadContentBlocks parts={message.content as ContentBlock[]} toolResults={toolResults} />;
  }
  return null;
}
