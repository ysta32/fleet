import type { FleetSnapshot, SyntheticFleet, DemoFleetOptions } from '@fleet/shared';

export interface World {
  seed: number;
  start: number;
  steps: number;
}
type Create = (opts?: DemoFleetOptions) => SyntheticFleet;
export const WORLD_SEED: number;
export const WORLD_START: number;
export function interesting(snapshot: FleetSnapshot): boolean;
export function advanceWorld<F extends { tick(ms: number): unknown }>(fleet: F, steps: number): F;
export function chooseWorld(createDemoFleet: Create): World;
export function openWorld(createDemoFleet: Create, world: World): SyntheticFleet;
