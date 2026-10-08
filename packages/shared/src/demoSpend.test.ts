import { describe, expect, it } from 'vitest';
import { createDemoFleet, DEMO_PROJECT_NAMES } from './demo.js';
import { demoSpendSummary } from './demoSpend.js';

const NOW = new Date(2026, 9, 7, 15, 30).getTime();

describe('demoSpendSummary', () => {
  it('agrees with the harbour snapshot: today, clock, repos and month totals', () => {
    const snapshot = createDemoFleet({ now: NOW }).snapshot();
    const summary = demoSpendSummary(snapshot);
    const midnight = new Date(NOW);
    midnight.setHours(0, 0, 0, 0);
    const today = snapshot.sessions
      .filter((session) => session.startedAt >= midnight.getTime())
      .reduce((sum, session) => sum + session.costUsd, 0);
    expect(today).toBeGreaterThan(0);
    expect(summary.todayUsd).toBe(today);
    expect(summary.generatedAt).toBe(NOW);
    expect(summary.monthStart).toBe(new Date(2026, 9, 1).getTime());
    expect(summary.daily).toHaveLength(31);
    expect(summary.daily.at(-1)!.key).toBe('2026-10-07');
    const month = summary.daily.filter((day) => day.key.startsWith('2026-10-'));
    expect(month).toHaveLength(7);
    expect(summary.monthToDateUsd).toBeCloseTo(
      month.reduce((sum, day) => sum + day.costUsd, 0),
      2,
    );
    expect(summary.forecastMonthEndUsd).toBeGreaterThan(summary.monthToDateUsd);
    for (const repo of summary.breakdown.repo) expect(DEMO_PROJECT_NAMES).toContain(repo.key);
    expect(summary.breakdown.model.length).toBeGreaterThan(1);
    expect(summary.burnUsdPerHour).toBeGreaterThan(0);
  });

  it.each([42, 7, 999])(
    'spends a believable $25-90 per day with a forecast under a $1,500 budget (seed %i)',
    (seed) => {
      // Late evening, so "today" covers the whole 12h pre-simulated window.
      const summary = demoSpendSummary(
        createDemoFleet({ seed, now: new Date(2026, 9, 7, 23, 50).getTime() }).snapshot(),
      );
      expect(summary.todayUsd).toBeGreaterThanOrEqual(25);
      expect(summary.todayUsd).toBeLessThanOrEqual(90);
      for (const day of summary.daily.slice(0, -1).filter((entry) => {
        const weekday = new Date(`${entry.key}T12:00:00`).getDay();
        return weekday !== 0 && weekday !== 6;
      })) {
        expect(day.costUsd).toBeGreaterThanOrEqual(15);
        expect(day.costUsd).toBeLessThanOrEqual(90);
      }
      expect(summary.budget.monthlyUsd).toBe(1500);
      expect(summary.forecastMonthEndUsd).toBeLessThanOrEqual(1500 * 1.1);
      expect(summary.forecastMonthEndUsd).toBeGreaterThan(500);
    },
  );

  it('is deterministic for a given snapshot and seed', () => {
    const snapshot = createDemoFleet({ now: NOW, seed: 3 }).snapshot();
    expect(demoSpendSummary(snapshot, { seed: 3 })).toEqual(demoSpendSummary(snapshot, { seed: 3 }));
  });
});
