import { z } from 'zod';
import type { CollectContext, CollectResult, DeploymentItem, RawProject } from '../types.js';

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  link: z.object({ type: z.string(), repo: z.string().optional(), org: z.string().optional() }).nullish(),
  targets: z.object({ production: z.object({ alias: z.array(z.string()).optional() }).nullish() }).nullish(),
  alias: z.array(z.string()).optional(),
});
const deploymentSchema = z.object({
  uid: z.string(),
  name: z.string(),
  projectId: z.string().optional(),
  url: z.string(),
  state: z.string().optional(),
  readyState: z.string().optional(),
  target: z.string().nullish(),
  created: z.number(),
  meta: z
    .object({
      githubCommitMessage: z.string().optional(),
      githubCommitRef: z.string().optional(),
      githubRepo: z.string().optional(),
    })
    .nullish(),
});
const projectsSchema = z.object({ projects: z.array(projectSchema) });
const deploymentsSchema = z.object({
  deployments: z.array(deploymentSchema),
  pagination: z.object({ next: z.number().nullable().optional() }).nullish(),
});

function httpsUrl(host: string): string {
  return host.startsWith('https://') ? host : `https://${host}`;
}

function deploymentState(value: string | undefined): DeploymentItem['state'] | undefined {
  switch (value) {
    case 'READY':
    case 'ERROR':
    case 'CANCELED':
    case 'BUILDING':
    case 'QUEUED':
      return value;
    default:
      return undefined;
  }
}

export async function collectVercel(ctx: CollectContext, projects: RawProject[]): Promise<CollectResult> {
  const token = ctx.secrets.vercelToken;
  if (!token) return { projects, warnings: [] };

  let failure = 'Vercel collection failed (network or invalid response).';
  try {
    const request = async (path: string, params: Record<string, string>): Promise<unknown> => {
      const url = new URL(path, 'https://api.vercel.com');
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      if (ctx.config.vercelTeamId) url.searchParams.set('teamId', ctx.config.vercelTeamId);
      const response = await ctx.fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        failure = `Vercel collection failed: HTTP ${response.status} (${path}).`;
        throw new Error('Vercel HTTP error');
      }
      return response.json();
    };
    const catalog = projectsSchema.parse(await request('/v9/projects', { limit: '100' })).projects;
    const since = Date.parse(ctx.window.since);
    const until = Date.parse(ctx.window.until);
    if (!Number.isFinite(since) || !Number.isFinite(until) || since > until) {
      throw new Error('Invalid collection window');
    }
    const deployments: z.infer<typeof deploymentSchema>[] = [];
    const warnings: string[] = [];
    let cursor = until;
    for (let page = 0; page < 5; page++) {
      const result = deploymentsSchema.parse(
        await request('/v6/deployments', {
          since: String(since),
          until: String(cursor),
          limit: '100',
        }),
      );
      deployments.push(...result.deployments);
      const next = result.pagination?.next;
      if (next == null || next < since) break;
      if (next >= cursor) {
        warnings.push('Vercel deployment pagination did not advance; collection stopped.');
        break;
      }
      if (page === 4) warnings.push('Vercel deployment collection reached the five-page limit.');
      cursor = next;
    }

    const merged = projects.map((project) => ({ ...project, deployments: [...project.deployments] }));
    const findRepo = (name: string | undefined): RawProject | undefined =>
      name === undefined
        ? undefined
        : merged.find(
            (project) =>
              !project.id.startsWith('vercel:') && project.name.toLowerCase() === name.toLowerCase(),
          );
    const linked = new Map<string, RawProject>();
    for (const project of catalog) {
      const repo =
        findRepo(project.link?.type === 'github' ? project.link.repo : undefined) ??
        findRepo(ctx.config.vercelProjects[project.name]);
      if (!repo) continue;
      repo.vercelProject = project.name;
      const alias = project.targets?.production?.alias?.[0] ?? project.alias?.[0];
      if (alias) repo.siteUrl = httpsUrl(alias);
      linked.set(project.id, repo);
    }
    const seen = new Set<string>();
    for (const deployment of deployments) {
      if (deployment.created < since || deployment.created > until || seen.has(deployment.uid)) continue;
      seen.add(deployment.uid);
      const state = deploymentState(deployment.state ?? deployment.readyState);
      if (!state) {
        warnings.push('Vercel deployment skipped: unsupported or missing state.');
        continue;
      }
      const project = deployment.projectId
        ? catalog.find((entry) => entry.id === deployment.projectId)
        : catalog.find((entry) => entry.name === deployment.name);
      const name = project?.name ?? deployment.name;
      let repo = (project ? linked.get(project.id) : undefined) ?? findRepo(ctx.config.vercelProjects[name]);
      if (!repo) {
        const id = `vercel:${name}`;
        repo = merged.find((entry) => entry.id === id);
        if (!repo) {
          repo = {
            id,
            name,
            url: `https://vercel.com/${encodeURIComponent(name)}`,
            mergedPRs: [],
            openPRs: [],
            commits: [],
            releases: [],
            ciFailures: [],
            issues: [],
            deployments: [],
          };
          merged.push(repo);
        }
      }
      repo.vercelProject = name;
      const alias = project?.targets?.production?.alias?.[0] ?? project?.alias?.[0];
      if (alias) repo.siteUrl = httpsUrl(alias);
      if (repo.deployments.some((entry) => entry.id === deployment.uid)) continue;
      repo.deployments.push({
        id: deployment.uid,
        project: name,
        url: httpsUrl(deployment.url),
        target: deployment.target === 'production' ? 'production' : 'preview',
        state,
        at: new Date(deployment.created).toISOString(),
        ...(deployment.meta?.githubCommitMessage !== undefined
          ? { commitMessage: deployment.meta.githubCommitMessage }
          : {}),
        ...(deployment.meta?.githubCommitRef !== undefined
          ? { branch: deployment.meta.githubCommitRef }
          : {}),
      });
    }
    return { projects: merged, warnings };
  } catch {
    return { projects, warnings: [failure] };
  }
}
