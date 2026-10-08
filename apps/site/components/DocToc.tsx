'use client';
import { useEffect, useState } from 'react';

/**
 * "On this page" with scroll-spy: the link for the section at the reading line gets
 * aria-current="location". Without script it is a plain list of anchors.
 */
export function DocToc({ sections }: { sections: readonly (readonly [string, string])[] }) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const els = sections
      .map(([id]) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    // The active section is the last one whose heading has crossed the reading line (30% down).
    let frame = 0;
    // A followed #link wins until the reader scrolls by hand, even if its section cannot reach the line.
    let pinned: string | null = null;
    // The jump a link starts is "settled" once scrolling has paused; any scroll after that (wheel,
    // keys, touch or a dragged scrollbar, which fires no input event of its own) ends the pin.
    let settled = false;
    let settle = 0;
    const armSettle = () => {
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        settled = true;
      }, 160);
    };
    const onHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (els.some((el) => el.id === id)) {
        pinned = id;
        settled = false;
        armSettle();
        setActive(id);
      }
    };
    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.3;
      let current = els[0]!.id;
      for (const el of els) if (el.getBoundingClientRect().top <= line) current = el.id;
      // Short closing sections never reach the line: at the very bottom, the last one is current.
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atEnd && !pinned) current = els[els.length - 1]!.id;
      setActive(pinned ?? current);
    };
    // Input that scrolls by hand ends the pin at once, even mid-jump.
    const unpin = () => {
      pinned = null;
    };
    const MANUAL = ['wheel', 'touchmove', 'keydown'] as const;
    const onScroll = () => {
      if (pinned !== null) {
        if (settled) pinned = null;
        else armSettle();
      }
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    if (window.location.hash) onHash();
    update();
    window.addEventListener('hashchange', onHash);
    for (const t of MANUAL) window.addEventListener(t, unpin, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    const onResize = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      window.removeEventListener('hashchange', onHash);
      for (const t of MANUAL) window.removeEventListener(t, unpin);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, [sections]);
  return (
    <nav className="toc" aria-labelledby="toc-h">
      <h2 id="toc-h" className="label">
        On this page
      </h2>
      <ol>
        {sections.map(([id, label]) => (
          <li key={id}>
            <a href={`#${id}`} aria-current={active === id ? 'location' : undefined}>
              {label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
