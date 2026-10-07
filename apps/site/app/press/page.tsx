import { Mark, Wordmark } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import { PageHead } from '@/components/PageHead';
import { pageMeta } from '@/lib/site';

export const metadata = pageMeta('press', 'Press kit', 'The Fleet mark, wordmark, palette and screenshots, free to use when writing about Fleet.');

const SWATCHES = [
  ['Ink', 'bg', 'Background, dark'],
  ['Bone', 'fg', 'Text, dark'],
  ['Signal', 'accent', 'Needs you. Used sparingly'],
  ['Surface', 'surface-2', 'Raised panels'],
] as const;

const SHOTS = [
  ['/poster/fleet-1920.webp', 'Fleet 3D view, wide', 1920, 1080],
  ['/poster/fleet-close-1280.webp', 'Fleet 3D view, close', 1280, 800],
] as const;

export default function Press() {
  return (
    <>
      <PageHead
        label="Press kit"
        title={<>The mark, the palette, <em>the harbour.</em></>}
        lead="Use these when you write about Fleet. Please do not recolor the pennant or put the mark on orange."
      />
      <div className="wrap page-body" style={{ display: 'grid', gap: 'var(--fl-space-10)' }}>
        <section aria-labelledby="logo-h" style={{ display: 'grid', gap: 'var(--fl-space-5)' }}>
          <h2 id="logo-h" className="h3">
            Logo
          </h2>
          <div className="asset-grid">
            <div className="asset">
              <div className="asset-frame fl-ink">
                <Mark />
              </div>
              <div className="asset-row">
                <span>Mark</span>
                <a className="link-arrow" href="/brand/mark.svg" download>
                  SVG <Icon name="chevron" />
                </a>
              </div>
            </div>
            <div className="asset">
              <div className="asset-frame">
                <Wordmark />
              </div>
              <div className="asset-row">
                <span>Wordmark</span>
                <a className="link-arrow" href="/brand/wordmark.svg" download>
                  SVG <Icon name="chevron" />
                </a>
              </div>
            </div>
          </div>
          <p className="caption">
            The mark is a mast with a signal pennant, crossed by an orbit. The pennant and the dot are always signal
            orange; the mast and orbit follow the text color. Keep clear space equal to the pennant height.
          </p>
        </section>

        <section aria-labelledby="palette-h" style={{ display: 'grid', gap: 'var(--fl-space-5)' }}>
          <h2 id="palette-h" className="h3">
            Palette
          </h2>
          <div className="swatches fl-ink">
            {SWATCHES.map(([name, token, use]) => (
              <div className="swatch" key={name}>
                <div className="swatch-chip" style={{ background: `var(--fl-${token})` }} />
                <div className="swatch-meta">
                  <strong>{name}</strong>
                  <code className="num">--fl-{token}</code>
                  <span style={{ color: 'var(--fl-fg-muted)' }}>{use}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="caption">
            Type: Instrument Serif for display, Schibsted Grotesk for interface text, IBM Plex Mono for numbers.
          </p>
        </section>

        <section aria-labelledby="shots-h" style={{ display: 'grid', gap: 'var(--fl-space-5)' }}>
          <h2 id="shots-h" className="h3">
            Screenshots
          </h2>
          <div className="asset-grid">
            {SHOTS.map(([src, label, w, h]) => (
              <div className="asset" key={src}>
                <div className="media" style={{ aspectRatio: `${w} / ${h}` }}>
                  <img src={src} alt={label} loading="lazy" decoding="async" width={w} height={h} />
                </div>
                <div className="asset-row">
                  <span>
                    {label} <span className="num">· {w}×{h}</span>
                  </span>
                  <a className="link-arrow" href={src} download>
                    WebP <Icon name="chevron" />
                  </a>
                </div>
              </div>
            ))}
          </div>
          <p className="caption">All screenshots use synthetic demo data.</p>
        </section>
      </div>
    </>
  );
}
