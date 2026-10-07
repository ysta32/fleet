import type { Metadata } from 'next';

const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
/** Canonical origin: SITE_URL, else the Vercel production host, else local preview. */
export const SITE_URL = process.env.SITE_URL ?? (vercelHost ? `https://${vercelHost}` : 'http://localhost:4530');
export const REPO_URL = 'https://github.com/ysta32/fleet';
export const ACTIONS_URL = `${REPO_URL}/actions`;
export const CI_BADGE_URL = `${REPO_URL}/actions/workflows/ci.yml/badge.svg`;
export const INSTALL_CMD = 'npm i -g fleet-collector && fleet install';

export const NAV = [
  { href: '/features', label: 'Features' },
  { href: '/docs', label: 'Docs' },
  { href: '/changelog', label: 'Changelog' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/demo', label: 'Demo' },
] as const;

export const FOOTER = [
  {
    title: 'Product',
    links: [
      { href: '/features', label: 'Features' },
      { href: '/demo', label: 'Live demo' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/changelog', label: 'Changelog' },
    ],
  },
  {
    title: 'Help',
    links: [
      { href: '/docs', label: 'Docs' },
      { href: '/faq', label: 'FAQ' },
      { href: '/status', label: 'Status' },
      { href: REPO_URL, label: 'GitHub' },
    ],
  },
  {
    title: 'About',
    links: [
      { href: '/about', label: 'About' },
      { href: '/press', label: 'Press kit' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
    ],
  },
] as const;

/** Per-page metadata with a prebuilt OG card at /og/<slug>.png (see scripts/assets.mjs). */
export function pageMeta(slug: string, title: string, description: string): Metadata {
  const url = slug === 'home' ? '/' : `/${slug}`;
  const image = { url: `/og/${slug}.png`, width: 1200, height: 630, alt: `Fleet: ${title}` };
  return {
    title: slug === 'home' ? { absolute: title } : title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: 'Fleet', type: 'website', images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image.url] },
  };
}
