import { useState } from 'react';
import { SendHorizonal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface ComposerProps {
  disabled?: boolean;
  onSend: (content: string) => void;
}

export function Composer({ disabled, onSend }: ComposerProps) {
  const [value, setValue] = useState('');
  const submit = () => {
    const content = value.trim();
    if (!content || disabled) return;
    onSend(content);
    setValue('');
  };
  return (
    <div className="flex items-end gap-2 border-t border-border p-3">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        }}
        placeholder="输入消息…（⌘+Enter 发送）"
        className="min-h-[40px] flex-1 resize-none text-xs"
        rows={2}
      />
      <Button size="sm" onClick={submit} disabled={disabled || !value.trim()}>
        <SendHorizonal data-icon="inline-start" />
        发送
      </Button>
    </div>
  );
}
