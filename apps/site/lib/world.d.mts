import type {
  DemoWorld,
  DemoWorldOptions,
  FleetSnapshot,
  SyntheticFleet,
  createDemoFleet,
} from '@fleet/shared';

export interface World {
  seed: number;
  /** the world's clock (epoch ms) */
  now: number;
}
type Create = (opts?: DemoWorldOptions) => DemoWorld;
export const WORLD_START: number;
export function interesting(snapshot: FleetSnapshot): boolean;
export function chooseWorld(createDemoWorld: Create, seed: number): World;
export function openWorld(createDemoWorld: Create, world: World): DemoWorld;
export function openFleet(create: typeof createDemoFleet, world: World): SyntheticFleet;
