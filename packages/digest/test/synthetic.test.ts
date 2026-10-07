import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeHealth } from '../src/summarize/fallback.js';
import { syntheticArchive, syntheticDigest } from '../src/demo/synthetic.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/demo-digest.json', import.meta.url));

describe('syntheticDigest', () => {
  it('is deterministic and seed-sensitive', () => {
    expect(syntheticDigest('2026-10-07', 7)).toEqual(syntheticDigest('2026-10-07', 7));
    expect(syntheticDigest('2026-10-07', 8)).not.toEqual(syntheticDigest('2026-10-07', 7));
  });

  it('has correct window, owner and summarizer', () => {
    const d = syntheticDigest('2026-10-07');
    expect(d.window).toEqual({ since: '2026-10-06T06:00:00.000Z', until: '2026-10-07T06:00:00.000Z' });
    expect(d.owner).toBe('acme-dev');
    expect(d.summarizer).toEqual({ kind: 'llm', model: 'claude-sonnet-5-5' });
    expect(d.projects).toHaveLength(10);
  });

  it('uses only acme-dev URLs and never the real owner', () => {
    const json = JSON.stringify(syntheticArchive(10, '2026-10-07'));
    expect(json).not.toContain('ysta32');
    const urls = json.match(/https:\/\/github\.com\/[^"]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u.startsWith('https://github.com/acme-dev/')).toBe(true);
  });

  it('keeps totals consistent, health consistent and projects sorted', () => {
    const order = { red: 0, yellow: 1, green: 2, quiet: 3 };
    for (const d of syntheticArchive(14, '2026-10-07')) {
      const ps = d.projects;
      expect(d.totals.mergedPRs).toBe(ps.reduce((n, p) => n + p.mergedPRs.length, 0));
      expect(d.totals.commits).toBe(ps.reduce((n, p) => n + p.commits.length, 0));
      expect(d.totals.projectsActive).toBe(ps.filter((p) => p.health !== 'quiet').length);
      expect(d.totals.agentContributions).toBe(
        ps.reduce(
          (n, p) =>
            n +
            p.mergedPRs.filter((x) => x.author.isBot).length +
            p.commits.filter((x) => x.author.isBot).length,
          0,
        ),
      );
      expect(d.totals.deploymentsFailed).toBe(
        ps.reduce(
          (n, p) => n + p.deployments.filter((x) => x.state === 'ERROR' || x.state === 'CANCELED').length,
          0,
        ),
      );
      for (let i = 1; i < ps.length; i++) {
        expect(order[ps[i - 1]!.health]).toBeLessThanOrEqual(order[ps[i]!.health]);
      }
      for (const p of ps) {
        expect(p.highlights.length).toBeLessThanOrEqual(5);
        expect(p.summary.length).toBeGreaterThan(0);
        for (const dep of p.deployments) expect(dep.url).toBe(`https://${p.name}.example.app`);
      }
    }
  });

  it('has red projects on most days and bot/human authors', () => {
    const days = syntheticArchive(20, '2026-10-07');
    expect(days.filter((d) => d.projects.some((p) => p.health === 'red')).length).toBeGreaterThanOrEqual(14);
    const logins = new Set(
      days.flatMap((d) => d.projects.flatMap((p) => p.mergedPRs.map((x) => x.author.login))),
    );
    expect(logins.has('claude[bot]') || logins.has('codex-agent[bot]')).toBe(true);
    expect(logins.has('acme-dev')).toBe(true);
  });

  it('release versions increase over days per repo', () => {
    const last = new Map<string, number[]>();
    for (const d of syntheticArchive(60, '2026-10-07')) {
      for (const p of d.projects) {
        for (const r of p.releases) {
          const v = r.tag.slice(1).split('.').map(Number);
          const prev = last.get(p.name);
          if (prev) {
            const cmp = v[0]! - prev[0]! || v[1]! - prev[1]! || v[2]! - prev[2]!;
            expect(cmp).toBeGreaterThan(0);
          }
          last.set(p.name, v);
        }
      }
    }
    expect(last.size).toBeGreaterThan(0);
  });

  it('rejects invalid dates', () => {
    expect(() => syntheticDigest('2026-13-40')).toThrow();
  });
});

describe('regressions over a 60-day archive', () => {
  const days = syntheticArchive(60, '2026-10-07');

  it('every project health equals computeHealth of its raw data', () => {
    for (const d of days) {
      for (const p of d.projects) expect(p.health, `${d.id} ${p.name}`).toBe(computeHealth(p));
    }
  });

  it('headline never claims healthy when any project is red or yellow', () => {
    for (const d of days) {
      if (d.projects.some((p) => p.health === 'red' || p.health === 'yellow')) {
        expect(d.headline, d.id).not.toMatch(/healthy/i);
      }
    }
  });

  it('release versions stay unique and increasing across years', () => {
    const seen = new Map<string, string>();
    for (const d of syntheticArchive(400, '2026-10-07')) {
      for (const p of d.projects) {
        for (const r of p.releases) {
          expect(seen.get(p.name), `${d.id} ${p.name}`).not.toBe(r.tag);
          seen.set(p.name, r.tag);
        }
      }
    }
    expect(syntheticDigest('2025-11-17').projects.length).toBe(10);
  });
});

describe('dates around 2020', () => {
  it('keeps release versions unique across 2019-12-25..2020-01-05 and rejects pre-2000 dates', () => {
    const seen = new Set<string>();
    for (const d of syntheticArchive(12, '2020-01-05')) {
      for (const p of d.projects) {
        for (const r of p.releases) {
          const key = `${p.name}@${r.tag}`;
          expect(seen.has(key), key).toBe(false);
          seen.add(key);
          expect(r.tag).toMatch(/^v\d+\.\d+\.\d+$/);
        }
      }
    }
    expect(() => syntheticDigest('1999-12-31')).toThrow(/before 2000/);
  });
});

describe('syntheticArchive', () => {
  it('returns days ordered oldest first ending at endDate', () => {
    const a = syntheticArchive(3, '2026-10-07');
    expect(a.map((d) => d.id)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
  });
});

describe('fixtures/demo-digest.json', () => {
  it('equals regenerated output', () => {
    const onDisk = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(syntheticDigest('2026-10-07', 7))));
  });
});
