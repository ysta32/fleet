'use client';
import { useEffect, useRef, useState } from 'react';
import { icons } from '@fleet/ui';

/**
 * Copyable install command, always shown in full: the box grows to the command where there is room, and where
 * there is not the line scrolls sideways with a fade on the side that has more (never a silent ellipsis).
 * Copy always copies the whole command. Feedback is announced politely; the button keeps its width.
 */
export function InstallCommand({ cmd, quiet = false, id }: { cmd: string; quiet?: boolean; id?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [more, setMore] = useState<{ start: boolean; end: boolean }>({ start: false, end: false });
  const timer = useRef<number | undefined>(undefined);
  const line = useRef<HTMLElement>(null);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    const el = line.current;
    if (!el) return;
    const read = () => {
      const start = el.scrollLeft > 1;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setMore((m) => (m.start === start && m.end === end ? m : { start, end }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    el.addEventListener('scroll', read, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', read);
    };
  }, []);
  const scrolls = more.start || more.end;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setState('copied');
    } catch {
      setState('failed');
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2400);
  };
  return (
    <div className="install" data-quiet={quiet ? '' : undefined} id={id}>
      <code
        ref={line}
        data-more-start={more.start ? '' : undefined}
        data-more-end={more.end ? '' : undefined}
        // Keyboard users can scroll the line when it does not fit.
        tabIndex={scrolls ? 0 : undefined}
      >
        <span className="prompt" aria-hidden="true">
          $
        </span>
        <span className="cmd">{cmd}</span>
      </code>
      <button type="button" onClick={copy} aria-label={`Copy install command: ${cmd}`}>
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
          ? 'Install command copied'
          : state === 'failed'
            ? 'Copy failed. Select the text instead.'
            : ''}
      </span>
    </div>
  );
}

const COPY =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6.75" y="6.75" width="9.5" height="9.5" rx="1.5"/><path d="M13.25 4.25v-.5a1 1 0 0 0-1-1h-7.5a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1h.5"/></svg>';
