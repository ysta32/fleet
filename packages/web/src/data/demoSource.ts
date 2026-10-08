import { createDemoFleet, demoSpendSummary } from '@fleet/shared';
import type { DemoFleet, SyntheticFleet } from '@fleet/shared';

/** Local midnight, matching the top bar's "Today" so archived demo sessions roll up per local day. */
function localStartOfDay(at: number): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

let current: SyntheticFleet | null = null;

/**
 * One synthetic world per page: the harbour, top bar, Spend and Overnight all read the fleet created
 * here, so they share a clock (`now`), a seed and a project list.
 */
export function createDemoSource(): DemoFleet {
  current = createDemoFleet({ startOfDay: localStartOfDay });
  return current;
}

/** The fleet behind the demo; created on first use when the page has not started one yet. */
export function currentDemoFleet(): SyntheticFleet {
  current ??= createDemoFleet({ startOfDay: localStartOfDay });
  return current;
}

/** Spend example derived from the current demo snapshot (Today equals the top bar's Today). */
export function demoSpendExample(): Record<string, unknown> {
  return demoSpendSummary(currentDemoFleet().snapshot()) as unknown as Record<string, unknown>;
}
