'use client';
import { useEffect, useRef, useState } from 'react';

interface Island {
  mount(el: HTMLElement, opts: { seed?: number; projects?: number; onReady?: () => void }): { unmount(): void };
}

type Why = 'pending' | 'live' | 'reduced' | 'no-webgl' | 'error' | 'save-data';

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Waits for load + idle so the scene never competes with LCP (the poster is the LCP element). */
function afterLcp(cb: () => void): () => void {
  let cancelled = false;
  let idle = 0;
  const run = () => {
    if (cancelled) return;
    const ric = (window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    if (ric) idle = ric(() => !cancelled && cb(), { timeout: 2500 });
    else idle = window.setTimeout(() => !cancelled && cb(), 600);
  };
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener('load', run);
    window.clearTimeout(idle);
    (window as Window & { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(idle);
  };
}

/**
 * The real Fleet visualizer over a poster. The poster is a still render of the same scene.
 * Reduced motion, Save-Data or no WebGL keep the poster. The island (public/island/fleet-scene.js)
 * is the FleetScene from packages/web driven by createDemoFleet: synthetic data, no network.
 */
export function FleetStage({
  poster,
  posterAlt,
  interactive = false,
  seed = 7,
  projects,
  onState,
}: {
  poster: string;
  posterAlt: string;
  interactive?: boolean;
  seed?: number;
  projects?: number;
  onState?: (why: Why) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [why, setWhy] = useState<Why>('pending');

  useEffect(() => onState?.(why), [why, onState]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (mq.matches) return setWhy('reduced');
    if (conn?.saveData && !interactive) return setWhy('save-data');
    if (!webglAvailable()) return setWhy('no-webgl');
    let handle: { unmount(): void } | null = null;
    let disposed = false;
    const start = () => {
      import(/* webpackIgnore: true */ '/island/fleet-scene.js' as string)
        .then((mod: Island) => {
          if (disposed) return;
          handle = mod.mount(el, {
            seed,
            projects,
            onReady: () => {
              if (!disposed) {
                setReady(true);
                setWhy('live');
              }
            },
          });
        })
        .catch(() => !disposed && setWhy('error'));
    };
    const cancel = interactive ? (start(), () => undefined) : afterLcp(start);
    const onChange = () => {
      if (mq.matches) {
        handle?.unmount();
        handle = null;
        setReady(false);
        setWhy('reduced');
      }
    };
    mq.addEventListener('change', onChange);
    return () => {
      disposed = true;
      cancel();
      mq.removeEventListener('change', onChange);
      handle?.unmount();
    };
  }, [interactive, seed, projects]);

  return (
    <>
      <img
        className="hero-poster"
        src={poster}
        alt={posterAlt}
        fetchPriority="high"
        decoding="async"
        width={1920}
        height={1080}
        aria-hidden={ready ? true : undefined}
      />
      <div ref={host} className="hero-live" data-ready={ready} aria-hidden={!interactive} />
    </>
  );
}
