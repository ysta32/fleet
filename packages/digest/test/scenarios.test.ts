import { describe, it, expect } from 'vitest';
import { scenarioDigest, scenarioIndex, type ScenarioName } from '../src/demo/scenarios.js';
import { syntheticDigest } from '../src/demo/synthetic.js';
import { computeTotals, sortProjects } from '../src/digest.js';
import { computeHealth } from '../src/summarize/fallback.js';

const scenarios: ScenarioName[] = [
  'typical',
  'first-run',
  'quiet-night',
  'all-green',
  'rough-night',
  'llm-fallback',
  'partial-warnings',
];

describe('visual scenarios', () => {
  it.each(scenarios)('%s has deterministic, consistent data and archive entries', (name) => {
    const digest = scenarioDigest(name);
    expect(digest).toEqual(scenarioDigest(name));
    expect(digest.totals).toEqual(computeTotals(digest.projects));
    expect(digest.projects).toEqual(sortProjects([...digest.projects].reverse()));
    for (const project of digest.projects) expect(project.health).toBe(computeHealth(project));
    const index = scenarioIndex(name, digest);
    expect(index.digests).toHaveLength(name === 'first-run' ? 1 : 14);
    expect(index.digests[0]).toEqual({
      id: digest.id,
      headline: digest.headline,
      totals: digest.totals,
      window: digest.window,
      path: `digests/${digest.id}.html`,
    });
    expect(new Set(index.digests.map((entry) => entry.id)).size).toBe(index.digests.length);
    if (name !== 'first-run') expect(index.digests.at(-1)?.id).toBe('2026-09-24');
  });

  it('preserves typical data for the first run', () => {
    expect(scenarioDigest('typical')).toEqual(syntheticDigest('2026-10-07', 7));
    expect(scenarioDigest('first-run')).toEqual(scenarioDigest('typical'));
  });

  it('clears all activity on a quiet night', () => {
    const digest = scenarioDigest('quiet-night');
    expect(digest.headline).toBe('A quiet night — nothing shipped.');
    expect(Object.values(digest.totals).every((total) => total === 0)).toBe(true);
    for (const project of digest.projects) {
      expect(project.health).toBe('quiet');
      for (const value of Object.values(project)) if (Array.isArray(value)) expect(value).toEqual([]);
    }
  });

  it('makes every project green and removes failures and attention', () => {
    const digest = scenarioDigest('all-green');
    expect(digest.projects.length).toBeGreaterThan(0);
    for (const project of digest.projects) {
      expect(project.health).toBe('green');
      expect(project.ciFailures).toEqual([]);
      expect(project.openPRs).toEqual([]);
      expect(project.deployments.every((deployment) => deployment.state === 'READY')).toBe(true);
      expect(project.summary).not.toMatch(/failed|needs.*attention/i);
    }
  });

  it('has at least four red projects with failing production deploys and CI', () => {
    const red = scenarioDigest('rough-night').projects.filter((project) => project.health === 'red');
    expect(
      red.filter(
        (project) =>
          project.deployments.some(
            (deployment) => deployment.target === 'production' && deployment.state === 'ERROR',
          ) && project.ciFailures.some((failure) => failure.branch === project.defaultBranch),
      ).length,
    ).toBeGreaterThanOrEqual(4);
  });

  it('exercises fallback and partial collection warnings', () => {
    expect(scenarioDigest('llm-fallback').summarizer).toEqual({ kind: 'fallback' });
    const warnings = scenarioDigest('partial-warnings').warnings;
    expect(warnings).toHaveLength(3);
    expect(warnings).toContain('Skipped acme-dev/legacy-app: 403 Resource not accessible by integration');
  });

  it('returns independent scenario instances', () => {
    const digest = scenarioDigest('typical');
    digest.projects.length = 0;
    digest.warnings.push('changed');
    expect(scenarioDigest('typical')).toEqual(syntheticDigest('2026-10-07', 7));
  });
});
