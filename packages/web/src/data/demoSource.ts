import * as shared from '@fleet/shared';
import type { DemoFleet, FleetEvent, FleetSnapshot } from '@fleet/shared';

type DemoFactory = (opts?: { seed?: number; now?: number; projects?: number }) => DemoFleet;

export function createDemoSource(): DemoFleet {
  const createDemoFleet: unknown = Reflect.get(shared, 'createDemoFleet');
  if (typeof createDemoFleet === 'function') return (createDemoFleet as DemoFactory)();
  return syntheticFleet();
}

// REPLACE-WITH-SHARED: fallback until task 10 exports createDemoFleet.
function syntheticFleet(): DemoFleet {
  let now = Date.now();
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const frame = (at: number): FleetSnapshot => ({
    version: 1,
    generatedAt: at,
    demo: true,
    projects: [{ id: 'demo', name: 'Orbital', path: '', branch: 'demo', lastActivity: at }],
    sessions: [
      {
        id: 'demo-session',
        projectId: 'demo',
        model: 'sonnet',
        startedAt: at - 86_400_000,
        lastActivity: at,
        status: 'active',
        tokens,
        costUsd: 0,
        toolCalls: 0,
        agentIds: ['demo-agent'],
      },
    ],
    agents: [
      {
        id: 'demo-agent',
        sessionId: 'demo-session',
        projectId: 'demo',
        role: 'coder',
        model: 'sonnet',
        label: 'Demo coder',
        status: 'working',
        location: { kind: 'project', projectId: 'demo' },
        tokens,
        startedAt: at - 86_400_000,
        lastActivity: at,
      },
    ],
    prs: [],
    releases: [],
    deploys: [],
    alerts: [],
  });
  const event = (ts: number): FleetEvent => ({
    id: `demo-${ts}`,
    ts,
    kind: 'agent.tool',
    projectId: 'demo',
    sessionId: 'demo-session',
    agentId: 'demo-agent',
    severity: 'info',
    label: 'Edit orbit.ts',
  });
  const between = (from: number, to: number): FleetEvent[] => {
    const events: FleetEvent[] = [];
    for (let ts = (Math.floor(from / 5_000) + 1) * 5_000; ts <= to; ts += 5_000) events.push(event(ts));
    return events;
  };
  return {
    snapshot: () => frame(now),
    tick(dtMs) {
      const previous = now;
      now += Math.max(0, dtMs);
      return between(previous, now);
    },
    history(hours) {
      const from = now - hours * 3_600_000;
      const frames: FleetSnapshot[] = [];
      for (let ts = from; ts <= now; ts += 30_000) frames.push(frame(ts));
      return { from, to: now, frames, events: between(from - 1, now) };
    },
  };
}
