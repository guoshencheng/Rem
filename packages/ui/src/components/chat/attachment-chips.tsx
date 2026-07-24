'use client';

import { X, FileText } from 'lucide-react';
import type { TextAttachment, ImageAttachment } from '../../lib/attachments';

interface AttachmentChipsProps {
  textFiles: TextAttachment[];
  images: ImageAttachment[];
  onRemoveText(index: number): void;
  onRemoveImage(index: number): void;
}

export function AttachmentChips({ textFiles, images, onRemoveText, onRemoveImage }: AttachmentChipsProps) {
  if (textFiles.length === 0 && images.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {images.map((img, i) => (
        <div key={`img-${i}`} className="relative group">
          <img src={img.dataUrl} alt={img.name} className="h-12 w-12 object-cover rounded-lg border border-bd" />
          <button
            type="button"
            aria-label={`Remove ${img.name}`}
            onClick={() => onRemoveImage(i)}
            className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-tx3 text-bg flex items-center justify-center"
          >
            <X size={10} />
          </button>
        </div>
      ))}
      {textFiles.map((f, i) => (
        <div key={`file-${i}`} className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-bd text-xs text-tx2">
          <FileText size={12} />
          <span className="max-w-[160px] truncate">{f.name}</span>
          <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onRemoveText(i)} className="text-tx3 hover:text-tx">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
