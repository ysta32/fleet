import type { Digest, DigestIndex } from '../types.js';
import { computeTotals, sortProjects } from '../digest.js';
import { computeHealth, fallbackHeadline, fallbackProjectSummary } from '../summarize/fallback.js';
import { syntheticArchive, syntheticDigest } from './synthetic.js';

export type ScenarioName =
  'typical' | 'first-run' | 'quiet-night' | 'all-green' | 'rough-night' | 'llm-fallback' | 'partial-warnings';

const DATE = '2026-10-07';

export function scenarioDigest(name: ScenarioName): Digest {
  const digest = syntheticDigest(DATE, 7);
  for (const [i, project] of digest.projects.entries()) {
    if (name === 'quiet-night') {
      project.mergedPRs = [];
      project.openPRs = [];
      project.commits = [];
      project.releases = [];
      project.ciFailures = [];
      project.issues = [];
      project.deployments = [];
      delete project.traffic;
      if (project.stats) {
        project.stats.starsDelta = 0;
        project.stats.forksDelta = 0;
      }
    } else if (name === 'all-green') {
      project.ciFailures = [];
      project.openPRs = [];
      project.deployments = project.deployments.filter((deployment) => deployment.state === 'READY');
      if (computeHealth(project) === 'quiet') {
        const sha = (i + 1).toString(16).padStart(40, '0');
        project.commits.push({
          sha,
          message: 'docs: refresh getting started guide',
          url: `${project.url}/commit/${sha}`,
          author: { login: digest.owner, isBot: false },
          at: digest.window.since,
          branch: project.defaultBranch ?? 'main',
        });
      }
    } else if (name === 'rough-night' && i < 4) {
      const at = new Date(Date.parse(digest.window.until) - 1).toISOString();
      project.deployments.push({
        id: `dpl_rough_${i}`,
        project: project.name,
        url: `https://${project.name}.example.app`,
        target: 'production',
        state: 'ERROR',
        at,
        branch: project.defaultBranch ?? 'main',
      });
      project.ciFailures.push({
        workflow: 'build and test',
        runId: 9_100_000_000 + i,
        url: `${project.url}/actions/runs/${9_100_000_000 + i}`,
        branch: project.defaultBranch ?? 'main',
        at,
        conclusion: 'failure',
      });
    }
    project.health = computeHealth(project);
    if (['quiet-night', 'all-green', 'rough-night', 'llm-fallback'].includes(name)) {
      Object.assign(project, fallbackProjectSummary(project));
    }
  }
  digest.projects = sortProjects(digest.projects);
  digest.totals = computeTotals(digest.projects);
  if (['quiet-night', 'all-green', 'rough-night', 'llm-fallback'].includes(name)) {
    digest.headline = fallbackHeadline(digest.projects);
  }
  if (name === 'all-green') digest.headline += ' Everything looks healthy.';
  if (name === 'llm-fallback') digest.summarizer = { kind: 'fallback' };
  if (name === 'partial-warnings') {
    digest.warnings = [
      'Skipped acme-dev/legacy-app: 403 Resource not accessible by integration',
      'Skipped acme-dev/internal-tools: 404 Repository not found',
      'Skipped acme-dev/archive-service: 503 Service unavailable',
    ];
  }
  return digest;
}

export function scenarioIndex(name: ScenarioName, d: Digest): DigestIndex {
  const digests =
    name === 'first-run' ? [d] : syntheticArchive(14, DATE).map((entry) => (entry.id === d.id ? d : entry));
  return {
    schema: 'overnight.index/v1',
    owner: d.owner,
    updatedAt: d.generatedAt,
    digests: digests
      .map(({ id, headline, window, totals }) => ({
        id,
        headline,
        window,
        totals,
        path: `digests/${id}.html`,
      }))
      .sort((a, b) => b.id.localeCompare(a.id)),
  };
}
