// S1, the hero flare: one vessel drifts in, stops, its rim turns signal orange and a beam rises, in
// step with the headline's last words (.hero-sync). Pure markup and CSS: no script, nothing that can
// delay the poster or the headline. Under reduced motion the end state is drawn without animation.
// The vessel is an overlay on the scene, not a scene object: the poster and the live island both sit
// under it unchanged (packages/web/src/viz is not touched).
export function HeroFlare({ waiting }: { waiting: number }) {
  return (
    <div className="flare" aria-hidden="true">
      <span className="flare-beam" />
      <span className="flare-ring" />
      <span className="flare-ring flare-ring-2" />
      <span className="flare-hull">
        <svg viewBox="0 0 48 56" width="48" height="56" focusable="false">
          <g className="flare-frame">
            <path d="M24 3 44 26 24 53 4 26Z" />
            <path d="M4 26h40M24 3v50M24 3 15 26l9 27 9-27Z" />
          </g>
          <g className="flare-rim">
            <path d="M24 3 44 26 24 53 4 26Z" />
            <path d="M4 26h40" />
          </g>
        </svg>
      </span>
      <span className="flare-tag">
        <span className="flare-tag-dot" />
        <span>
          <b>
            {waiting} {waiting === 1 ? 'agent' : 'agents'}
          </b>{' '}
          · waiting on you
        </span>
      </span>
    </div>
  );
}
