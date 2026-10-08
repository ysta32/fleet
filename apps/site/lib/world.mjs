// The one synthetic world every site surface draws from: hero scene and posters, product previews, phone,
// spend beat and overnight digest. Plain ESM so scripts/prebuild.mjs, scripts/assets.mjs, the hero island
// and the Next pages all run the same steps. createDemoFleet is passed in, so this file has no imports and
// the client never bundles the generator through it.

/** createDemoFleet's default seed: the same world the app's own demo mode shows. */
export const WORLD_SEED = 42;
/** The site's fixed clock (UTC). The world is advanced from here to the first moment someone is waiting. */
export const WORLD_START = Date.UTC(2026, 9, 7, 22, 40);
const STEP_MS = 30_000;
const MAX_STEPS = 720;
/** After the first wait appears, let it age a little so the inbox reads "8m", not "now". */
const SETTLE_MS = 8 * 60_000;

/** Something needs the operator: a waiting session and at least two open alerts. */
export function interesting(snapshot) {
  return (
    snapshot.alerts.filter((a) => !a.cleared).length >= 2 &&
    snapshot.sessions.some((s) => s.status === 'waiting')
  );
}

/** Replays the world's steps on a fresh fleet: `steps` x 30s, then the settle. */
export function advanceWorld(fleet, steps) {
  for (let i = 0; i < steps; i++) fleet.tick(STEP_MS);
  fleet.tick(SETTLE_MS);
  return fleet;
}

/** Fewest 30s steps after which (steps + settle) the world is interesting; 0 when none is found. */
export function chooseWorld(createDemoFleet) {
  const probe = createDemoFleet({ seed: WORLD_SEED, now: WORLD_START });
  for (let steps = 0; steps <= MAX_STEPS; steps++) {
    if (interesting(probe.snapshot())) {
      const check = advanceWorld(createDemoFleet({ seed: WORLD_SEED, now: WORLD_START }), steps);
      if (interesting(check.snapshot())) return { seed: WORLD_SEED, start: WORLD_START, steps };
    }
    probe.tick(STEP_MS);
  }
  return { seed: WORLD_SEED, start: WORLD_START, steps: 0 };
}

/** The fleet at the world's moment. */
export function openWorld(createDemoFleet, world) {
  return advanceWorld(createDemoFleet({ seed: world.seed, now: world.start }), world.steps);
}
