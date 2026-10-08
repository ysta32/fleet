// The one synthetic world every site surface draws from: hero scene and posters, product previews, phone,
// spend beat and overnight digest. It is createDemoWorld from @fleet/shared (the app's own demo world) at one
// seed and one fixed clock, so every surface shows the same numbers. Plain ESM so scripts/prebuild.mjs, the hero
// island and the Next pages share it; createDemoWorld is passed in, so this file has no imports.

/** The site's search starts here (UTC); the world's clock is the first moment from here someone is waiting. */
export const WORLD_START = Date.UTC(2026, 9, 7, 22, 40);
const STEP_MS = 5 * 60_000;
const MAX_STEPS = 288;
/** Once a wait appears, let it age a little so the inbox reads "8m", not "1m". */
const SETTLE_MS = 8 * 60_000;

/** Something needs the operator: a waiting session and at least two open alerts. */
export function interesting(snapshot) {
  return (
    snapshot.alerts.filter((a) => !a.cleared).length >= 2 &&
    snapshot.sessions.some((s) => s.status === 'waiting')
  );
}

/**
 * The site's world: `seed` (the shared DEMO_SEED) and the first clock, in 5 minute steps from WORLD_START, at
 * which the world is interesting, aged by SETTLE_MS when it is still interesting then. Throws when no moment
 * in the next day qualifies, so a generator change cannot silently ship a hero with nothing waiting.
 */
export function chooseWorld(createDemoWorld, seed) {
  for (let i = 0; i <= MAX_STEPS; i++) {
    const at = WORLD_START + i * STEP_MS;
    if (!interesting(createDemoWorld({ seed, now: at }).snapshot)) continue;
    const settled = at + SETTLE_MS;
    return { seed, now: interesting(createDemoWorld({ seed, now: settled }).snapshot) ? settled : at };
  }
  throw new Error(`demo world: no moment within 24h of ${new Date(WORLD_START).toISOString()} has a wait`);
}

/** The world (fleet, snapshot, spend, digest) at the site's clock. */
export function openWorld(createDemoWorld, world) {
  return createDemoWorld({ seed: world.seed, now: world.now });
}

/**
 * The world's fleet alone, for the browser hero island: createDemoWorld(world).fleet without the Spend and
 * digest work. createDemoWorld rolls days over at local midnight and the site builds with TZ=UTC, so the
 * build-time world uses UTC day starts, which is createDemoFleet's default; passing no startOfDay here keeps
 * the island's fleet identical to the posters and previews in any visitor time zone.
 */
export function openFleet(createDemoFleet, world) {
  return createDemoFleet({ seed: world.seed, now: world.now });
}
