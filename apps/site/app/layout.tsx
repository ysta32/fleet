import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { IBM_Plex_Mono, Instrument_Serif, Schibsted_Grotesk } from 'next/font/google';
import './globals.css';
import './ink.generated.css';
import { Wordmark } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import { MobileMenu, NavLinks } from '@/components/NavLinks';
import { RevealObserver } from '@/components/Reveal';
import { THEME_BOOT, ThemeToggle } from '@/components/ThemeToggle';
import { FOOTER, REPO_URL, SITE_URL } from '@/lib/site';

const display = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});
const sans = Schibsted_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Fleet: mission control for Claude Code agents', template: '%s · Fleet' },
  description:
    'Fleet shows every Claude Code agent you run as one live, local fleet, and pings your phone when one needs you. Free, MIT, local-first.',
  applicationName: 'Fleet',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0b0d0c' },
    { media: '(prefers-color-scheme: light)', color: '#f3f0e8' },
  ],
  colorScheme: 'dark light',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header className="nav">
          <div className="wrap">
            <Link href="/" className="brand" aria-label="Fleet home">
              <Wordmark className="wordmark" />
            </Link>
            <nav aria-label="Primary">
              <NavLinks />
            </nav>
            <div className="nav-end">
              <a className="icon-btn nav-gh" href={REPO_URL} aria-label="Fleet on GitHub">
                <Icon name="external" size="md" />
              </a>
              <ThemeToggle />
              <MobileMenu />
            </div>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <footer className="footer">
          <div className="wrap">
            <div className="footer-grid">
              <div>
                <Link href="/" className="brand" aria-label="Fleet home">
                  <Wordmark className="wordmark" />
                </Link>
                <p style={{ marginTop: 'var(--fl-space-4)', maxWidth: '32ch' }}>
                  Local mission control for Claude Code agents. Built by one developer, in the open.
                </p>
              </div>
              {FOOTER.map((col) => (
                <nav key={col.title} aria-label={col.title}>
                  <h2>{col.title}</h2>
                  <ul>
                    {col.links.map((l) => (
                      <li key={l.href}>
                        {l.href.startsWith('http') ? <a href={l.href}>{l.label}</a> : <Link href={l.href}>{l.label}</Link>}
                      </li>
                    ))}
                  </ul>
                </nav>
              ))}
            </div>
            <div className="footer-base">
              <span>MIT License. No warranty. No telemetry.</span>
              <span className="mono">v0.x · synthetic data on this site</span>
            </div>
          </div>
        </footer>
        <RevealObserver />
      </body>
    </html>
  );
}
