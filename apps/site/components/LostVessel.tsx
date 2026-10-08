'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const TOW_MS = 900;

/**
 * S3, the live 404: a vessel adrift past the outer range ring. Clicking it (or the link) tows it back
 * to the harbour, then navigates home. Reduced motion skips the tow and the drift is drawn still.
 */
export function LostVessel() {
  const router = useRouter();
  const [towing, setTowing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const tow = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Let modified clicks (new tab, new window) behave like a normal link.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (towing) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      router.push('/');
      return;
    }
    setTowing(true);
    timer.current = window.setTimeout(() => router.push('/'), TOW_MS);
  };
  return (
    <div className="adrift" data-towing={towing ? '' : undefined}>
      <svg className="adrift-rings" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
        <circle cx="200" cy="200" r="60" />
        <circle cx="200" cy="200" r="120" />
        <circle cx="200" cy="200" r="180" />
        <path d="M200 8v384M8 200h384" />
        <path className="adrift-home" d="M200 186 214 200 200 214 186 200Z" />
      </svg>
      <span className="adrift-tow" aria-hidden="true" />
      <a
        href="/"
        className="adrift-vessel"
        onClick={tow}
        aria-label="Tow the lost vessel back to the harbour (home page)"
      >
        <span className="adrift-bob">
          <svg viewBox="0 0 48 56" width="40" height="46" aria-hidden="true" focusable="false">
            <path d="M24 3 44 26 24 53 4 26Z" />
            <path d="M4 26h40M24 3v50M24 3 15 26l9 27 9-27Z" />
          </svg>
        </span>
        <span className="adrift-tag">Out of range · tow it home</span>
      </a>
    </div>
  );
}
