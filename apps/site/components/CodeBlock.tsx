'use client';
import { useEffect, useRef, useState } from 'react';
import { icons } from '@fleet/ui';

const COPY =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6.75" y="6.75" width="9.5" height="9.5" rx="1.5"/><path d="M13.25 4.25v-.5a1 1 0 0 0-1-1h-7.5a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1h.5"/></svg>';

/** A docs code block with a copy button. Copies the block's text exactly as shown. */
export function CodeBlock({ label, children }: { label: string; children: React.ReactNode }) {
  const pre = useRef<HTMLPreElement>(null);
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    const text = pre.current?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(text.trim() + '\n');
      setState('copied');
    } catch {
      setState('failed');
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2400);
  };
  return (
    <div className="code-block">
      <pre className="code" ref={pre}>
        {children}
      </pre>
      <button type="button" className="code-copy" onClick={copy} aria-label={`Copy ${label}`}>
        <span
          className="icon"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: state === 'copied' ? icons.check : COPY }}
        />
        <span aria-hidden="true">
          {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select' : 'Copy'}
        </span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === 'copied'
          ? `${label} copied`
          : state === 'failed'
            ? 'Copy failed. Select the text instead.'
            : ''}
      </span>
    </div>
  );
}
