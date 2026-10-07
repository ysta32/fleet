'use client';
import { useEffect, useState } from 'react';
import { icons } from '@fleet/ui';

type Pref = 'system' | 'light' | 'dark';
const KEY = 'fleet-theme';
const ORDER: Pref[] = ['system', 'light', 'dark'];
const NEXT_LABEL: Record<Pref, string> = {
  system: 'Theme: system. Switch to light',
  light: 'Theme: light. Switch to dark',
  dark: 'Theme: dark. Follow system',
};

function apply(pref: Pref) {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

export function ThemeToggle() {
  const [pref, setPref] = useState<Pref>('system');
  useEffect(() => {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') setPref(saved);
  }, []);
  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
    setPref(next);
    apply(next);
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  };
  const glyph = pref === 'light' ? icons.sun : pref === 'dark' ? icons.moon : SYSTEM;
  return (
    <button type="button" className="icon-btn" onClick={cycle} aria-label={NEXT_LABEL[pref]} title={NEXT_LABEL[pref]}>
      <span className="icon icon-md" aria-hidden="true" dangerouslySetInnerHTML={{ __html: glyph }} />
    </button>
  );
}

// Half sun / half moon in the Halyard icon grammar (20 grid, 1.5 stroke, round caps).
const SYSTEM =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="6.25"/><path d="M10 3.75v12.5" /><path d="M10 6.5a3.5 3.5 0 0 1 0 7" /></svg>';

/** Inline, render-blocking: sets data-theme before first paint so there is no flash. */
export const THEME_BOOT = `try{var t=localStorage.getItem('${KEY}');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}document.documentElement.classList.add('js');`;
