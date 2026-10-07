import type { ProjectActivity, ProjectHealth, RawProject, Summarizer } from '../types.js';

function defaultBranchOf(p: RawProject): string {
  return p.defaultBranch ?? 'main';
}

function latestProdDeploy(p: RawProject) {
  return p.deployments
    .filter((d) => d.target === 'production')
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
}

function activityVolume(p: RawProject): number {
  return (
    p.mergedPRs.length +
    p.commits.length +
    p.releases.length +
    p.ciFailures.length +
    p.issues.length +
    p.deployments.length +
    p.openPRs.length
  );
}

export function computeHealth(p: RawProject): ProjectHealth {
  const branch = defaultBranchOf(p);
  const prod = latestProdDeploy(p);
  const lastGood = p.deployments
    .filter((d) => d.target === 'production' && d.state === 'READY')
    .reduce((max, d) => Math.max(max, Date.parse(d.at)), Number.NEGATIVE_INFINITY);
  const mainFailing = p.ciFailures.some((f) => f.branch === branch && Date.parse(f.at) > lastGood);
  if (
    mainFailing ||
    prod?.state === 'ERROR' ||
    p.openPRs.some((pr) => pr.attention?.includes('ci_failing'))
  ) {
    return 'red';
  }
  if (
    p.openPRs.length > 0 ||
    p.ciFailures.length > 0 ||
    p.deployments.some((d) => d.target === 'preview' && d.state === 'ERROR')
  ) {
    return 'yellow';
  }
  if (activityVolume(p) === 0) return 'quiet';
  return 'green';
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function times(n: number): string {
  return n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`;
}

export function fallbackProjectSummary(p: RawProject): { summary: string; highlights: string[] } {
  const parts: string[] = [];
  if (p.mergedPRs.length > 0) {
    const agents = p.mergedPRs.filter((pr) => pr.author.isBot).length;
    parts.push(`Merged ${plural(p.mergedPRs.length, 'PR')}${agents > 0 ? ` (${agents} by agents)` : ''}`);
  }
  if (p.releases.length > 0) {
    parts.push(`shipped ${p.releases.map((r) => r.tag).join(', ')}`);
  }
  const prod = p.deployments.filter((d) => d.target === 'production' && d.state === 'READY').length;
  if (prod > 0) parts.push(`deployed to production ${times(prod)}`);
  if (parts.length === 0 && p.commits.length > 0) {
    parts.push(`Pushed ${plural(p.commits.length, 'commit')}`);
  }

  const sentences: string[] = [];
  if (parts.length > 0) {
    const first = parts[0] as string;
    const head = first.charAt(0).toUpperCase() + first.slice(1);
    const rest = parts.slice(1);
    const joined =
      rest.length === 0
        ? head
        : rest.length === 1
          ? `${head} and ${rest[0]}`
          : `${head}, ${rest.slice(0, -1).join(', ')}, and ${rest[rest.length - 1]}`;
    sentences.push(`${joined}.`);
  }

  const branch = defaultBranchOf(p);
  const mainFails = p.ciFailures.filter((f) => f.branch === branch).length;
  const otherFails = p.ciFailures.length - mainFails;
  if (mainFails > 0) sentences.push(`${plural(mainFails, 'CI run')} failed on ${branch}.`);
  if (otherFails > 0) sentences.push(`${plural(otherFails, 'CI run')} failed on other branches.`);
  const failedDeploys = p.deployments.filter((d) => d.state === 'ERROR').length;
  if (failedDeploys > 0) sentences.push(`${plural(failedDeploys, 'deploy')} failed.`);
  const attention = p.openPRs.length;
  if (attention > 0 && sentences.length < 3) {
    sentences.push(`${plural(attention, 'open PR')} ${attention === 1 ? 'needs' : 'need'} attention.`);
  }
  if (sentences.length === 0) {
    sentences.push(activityVolume(p) === 0 ? 'No activity overnight.' : 'Minor activity overnight.');
  }

  const highlights: string[] = [];
  for (const pr of p.mergedPRs.slice(0, 3)) highlights.push(`#${pr.number} ${pr.title}`);
  for (const r of p.releases)
    highlights.push(`Release ${r.tag}${r.name && r.name !== r.tag ? `: ${r.name}` : ''}`);
  for (const f of p.ciFailures) highlights.push(`CI failed: ${f.workflow} on ${f.branch}`);
  for (const d of p.deployments) {
    if (d.state === 'ERROR') highlights.push(`Deploy failed (${d.target}): ${d.project}`);
  }
  for (const pr of p.openPRs) {
    if (pr.attention?.includes('ci_failing')) highlights.push(`#${pr.number} ${pr.title} has failing CI`);
  }
  return { summary: sentences.slice(0, 3).join(' '), highlights: highlights.slice(0, 5) };
}

export function fallbackHeadline(projects: ProjectActivity[]): string {
  const moved = projects.filter((p) => p.health !== 'quiet' && activityVolume(p) > 0);
  if (moved.length === 0) return 'A quiet night — nothing shipped.';
  const merged = moved.reduce((n, p) => n + p.mergedPRs.length, 0);
  const releases = moved.reduce((n, p) => n + p.releases.length, 0);
  const failing = projects.filter((p) => p.health === 'red').length;
  const bits: string[] = [];
  if (merged > 0) bits.push(`${plural(merged, 'PR')} merged`);
  if (releases > 0) bits.push(plural(releases, 'release'));
  if (failing > 0)
    bits.push(`${failing} failing ${failing === 1 ? 'project needs' : 'projects need'} a look`);
  const tail = bits.length > 0 ? `: ${bits.join(', ')}` : '';
  return `${plural(moved.length, 'project')} moved overnight${tail}.`;
}

export const fallbackSummarizer: Summarizer = {
  async summarize(projects) {
    const out: ProjectActivity[] = projects.map((p) => ({
      ...p,
      health: computeHealth(p),
      ...fallbackProjectSummary(p),
    }));
    return { projects: out, headline: fallbackHeadline(out), summarizer: { kind: 'fallback' } };
  },
};
