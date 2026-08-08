import { useState } from 'react';
import { SendHorizonal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from '@/components/ui/input-group';

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
    <div className="border-t border-border px-[var(--ds-space-stage-x)] py-[var(--ds-space-stage-y)]">
      <InputGroup data-disabled={disabled || undefined}>
        <InputGroupTextarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
          }}
          placeholder="输入消息…"
          disabled={disabled}
          rows={2}
        />
        <InputGroupAddon>
          <span>⌘ + Enter 发送</span>
          <Button onClick={submit} disabled={disabled || !value.trim()}>
            <SendHorizonal data-icon="inline-start" />
            发送
          </Button>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
