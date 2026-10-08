'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { icons } from '@fleet/ui';
import { NAV, REPO_URL } from '@/lib/site';

function isCurrent(path: string, href: string) {
  return path === href || path.startsWith(`${href}/`);
}

export function NavLinks() {
  const path = usePathname() ?? '/';
  return (
    <ul className="nav-links">
      {NAV.map((item) => (
        <li key={item.href}>
          <Link href={item.href} aria-current={isCurrent(path, item.href) ? 'page' : undefined}>
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="icon-btn menu-btn"
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className="icon icon-md"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: open ? icons.close : MENU }}
        />
      </button>
      {open && (
        <nav id="mobile-menu" className="mobile-menu" aria-label="Mobile">
          <ul>
            {NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} aria-current={isCurrent(path ?? '/', item.href) ? 'page' : undefined}>
                  {item.label}
                  <span
                    className="icon"
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{ __html: icons.chevron }}
                  />
                </Link>
              </li>
            ))}
            <li>
              <a href={REPO_URL}>
                GitHub
                <span
                  className="icon"
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: icons.external }}
                />
              </a>
            </li>
          </ul>
        </nav>
      )}
    </>
  );
}

const MENU =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3.75 6.25h12.5"/><path d="M3.75 10h12.5"/><path d="M3.75 13.75h7.5"/></svg>';
