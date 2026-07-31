'use client';

import { useState, useRef, useCallback, KeyboardEvent, ClipboardEvent, DragEvent, ChangeEvent } from 'react';
import { ArrowUp, Square, Plus } from 'lucide-react';
import type { ApprovalDecision, ApprovalRequest, Usage, Rule, UserInputContent } from 'rem-agent-core';
import { cn } from '../../lib/utils.js';
import { ApprovalBar } from './approval-bar.js';
import { TokenStatsBadge } from './token-stats.js';
import { AttachmentChips } from './attachment-chips.js';
import { DEFAULT_CONTEXT_WINDOW } from '../../lib/context-window.js';
import {
  isTextFile,
  isImageFile,
  readFileAsText,
  readFileAsImageAttachment,
  buildUserInputContent,
  TEXT_FILE_MAX_BYTES,
  IMAGE_MAX_BYTES,
  MAX_TEXT_FILES,
  MAX_IMAGES,
  type TextAttachment,
  type ImageAttachment,
} from '../../lib/attachments.js';

interface InputBoxProps {
  streaming: boolean;
  initialized: boolean;
  pendingApprovals?: ApprovalRequest[];
  tokenUsage?: Usage;
  maxTokens?: number;
  onResolveApproval(approvalId: string, decision: ApprovalDecision, rule?: Omit<Rule, 'source'>): void;
  onSend(content: UserInputContent): void | Promise<void>;
  onInterrupt(): void;
}

export function InputBox({
  streaming,
  initialized,
  pendingApprovals,
  tokenUsage,
  maxTokens = DEFAULT_CONTEXT_WINDOW,
  onResolveApproval,
  onSend,
  onInterrupt,
}: InputBoxProps) {
  const [content, setContent] = useState('');
  const [textFiles, setTextFiles] = useState<TextAttachment[]>([]);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);

  const hasPayload = content.trim().length > 0 || textFiles.length > 0 || images.length > 0;

  const addFiles = useCallback(async (files: File[]) => {
    setAttachError(null);
    for (const file of files) {
      try {
        if (isImageFile(file)) {
          if (file.size > IMAGE_MAX_BYTES) {
            setAttachError(`${file.name} exceeds 5MB limit`);
            continue;
          }
          const img = await readFileAsImageAttachment(file);
          setImages((prev) => {
            if (prev.length >= MAX_IMAGES) {
              setAttachError(`At most ${MAX_IMAGES} images`);
              return prev;
            }
            return [...prev, img];
          });
        } else if (isTextFile(file)) {
          if (file.size > TEXT_FILE_MAX_BYTES) {
            setAttachError(`${file.name} exceeds 100KB limit`);
            continue;
          }
          const text = await readFileAsText(file);
          setTextFiles((prev) => {
            if (prev.length >= MAX_TEXT_FILES) {
              setAttachError(`At most ${MAX_TEXT_FILES} files`);
              return prev;
            }
            return [...prev, { name: file.name, text }];
          });
        } else {
          setAttachError(`${file.name}: unsupported file type`);
        }
      } catch {
        setAttachError(`Failed to read ${file.name}`);
      }
    }
  }, []);

  const handleSend = useCallback(async () => {
    const text = content.trim();
    if ((!text && textFiles.length === 0 && images.length === 0) || streaming || !initialized) return;
    const payload = buildUserInputContent(text, textFiles, images);
    const snapshot = { text: content, textFiles, images };
    setContent('');
    setTextFiles([]);
    setImages([]);
    setAttachError(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    try {
      await onSend(payload);
    } catch {
      setContent(snapshot.text);
      setTextFiles(snapshot.textFiles);
      setImages(snapshot.images);
    }
  }, [content, textFiles, images, streaming, initialized, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (composingRef.current || e.nativeEvent.isComposing) return;
      e.preventDefault();
      void handleSend();
    }
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length > 0) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) void addFiles(files);
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) void addFiles(files);
    e.target.value = '';
  };

  const placeholder = initialized ? 'Message...' : 'Connecting...';

  return (
    <div onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
      <ApprovalBar approvals={pendingApprovals ?? []} onResolve={onResolveApproval} />
      <AttachmentChips
        textFiles={textFiles}
        images={images}
        onRemoveText={(i) => setTextFiles((prev) => prev.filter((_, idx) => idx !== i))}
        onRemoveImage={(i) => setImages((prev) => prev.filter((_, idx) => idx !== i))}
      />
      {attachError && <div className="text-err text-xs mb-1">{attachError}</div>}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={() => { composingRef.current = false; }}
        disabled={streaming || !initialized}
        placeholder={placeholder}
        rows={2}
        className="w-full bg-transparent text-sm text-tx placeholder-tx3 outline-none resize-none min-h-[48px] max-h-[160px]"
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        accept="image/*,text/*,.ts,.tsx,.js,.jsx,.json,.md,.py,.go,.rs,.java,.c,.cpp,.h,.css,.html,.xml,.yml,.yaml,.toml,.sh,.log,.csv,.sql"
        onChange={handleFileInputChange}
      />
      <div className="flex items-center justify-between mt-3 gap-4">
        <div className="flex items-center gap-3">
          {tokenUsage && <TokenStatsBadge usage={tokenUsage} maxTokens={maxTokens} />}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!initialized}
            onClick={() => fileInputRef.current?.click()}
            className="p-1.5 rounded-lg text-tx3 hover:bg-bd hover:text-tx disabled:opacity-50 transition-colors"
            aria-label="Add attachment"
          >
            <Plus size={18} />
          </button>
          {streaming ? (
            <button
              type="button"
              onClick={onInterrupt}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-err text-white text-xs font-medium hover:opacity-90 transition-opacity"
            >
              <Square size={12} fill="currentColor" />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!hasPayload || !initialized}
              className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
                hasPayload && initialized
                  ? 'bg-ac text-ac-ink hover:opacity-90'
                  : 'bg-tx3/20 text-tx3',
              )}
              aria-label="Send"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
