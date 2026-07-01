'use client';

import { useEffect, useState } from 'react';
import { renderMarkdown } from '@/lib/markdown';

interface MarkdownContentProps {
  text: string;
  className?: string;
}

export function MarkdownContent({ text, className }: MarkdownContentProps) {
  const [html, setHtml] = useState('');

  useEffect(() => {
    let cancelled = false;
    renderMarkdown(text).then((result) => {
      if (!cancelled) {
        setHtml(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [text]);

  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
