'use client';

import { useEffect, useRef, useState } from 'react';
import { renderMarkdown } from '../../lib/markdown.js';

interface MarkdownContentProps {
  text: string;
  className?: string;
}

function addCopyButtons(container: HTMLDivElement) {
  const codeBlocks = container.querySelectorAll('pre code');

  codeBlocks.forEach((code) => {
    const pre = code.parentElement;
    if (!pre || pre.querySelector('.code-copy-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'code-copy-btn';
    btn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    btn.style.cssText =
      'position:absolute;top:8px;right:8px;padding:4px;border-radius:6px;background:var(--color-card);color:var(--color-tx3);border:1px solid var(--color-bd);cursor:pointer;opacity:0;transition:opacity 0.15s;';
    btn.setAttribute('aria-label', 'Copy code');

    btn.addEventListener('click', async () => {
      const text = code.textContent || '';
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
          document.execCommand('copy');
        } catch {
          // ignore
        }
        document.body.removeChild(textarea);
      }
      btn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => {
        btn.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      }, 2000);
    });

    pre.style.position = 'relative';
    pre.appendChild(btn);

    pre.addEventListener('mouseenter', () => {
      btn.style.opacity = '1';
    });
    pre.addEventListener('mouseleave', () => {
      btn.style.opacity = '0';
    });
  });
}

export function MarkdownContent({ text, className }: MarkdownContentProps) {
  const [html, setHtml] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!containerRef.current || !html) return;

    const container = containerRef.current;
    addCopyButtons(container);

    const observer = new MutationObserver(() => {
      addCopyButtons(container);
    });

    observer.observe(container, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [html]);

  return (
    <div
      ref={containerRef}
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
