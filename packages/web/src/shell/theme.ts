import { useCallback, useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'fleet.theme';

function read(): ThemePref {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function systemTheme(): 'light' | 'dark' {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Applies a theme preference to <html data-theme> and the browser chrome colour. */
export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  const bg = getComputedStyle(root).getPropertyValue('--fl-bg').trim();
  if (bg)
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute('content', bg));
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(read);
  const [system, setSystem] = useState<'light' | 'dark'>(systemTheme);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!query) return;
    const change = () => setSystem(query.matches ? 'light' : 'dark');
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    applyTheme(pref);
  }, [pref, system]);
  const resolved = pref === 'system' ? system : pref;
  const toggle = useCallback(() => {
    const current = document.documentElement.getAttribute('data-theme') ?? systemTheme();
    const next: ThemePref = current === 'light' ? 'dark' : 'light';
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // Theme still switches for this visit when storage is unavailable.
    }
    setPref(next);
  }, []);
  return { pref, resolved, toggle };
}
