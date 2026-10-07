import type { CollectContext, CollectResult } from '../types.js';
import { collectGitHub } from './github.js';
import { collectVercel } from './vercel.js';

export async function collect(ctx: CollectContext): Promise<CollectResult> {
  const github = await collectGitHub(ctx);
  const vercel = await collectVercel(ctx, github.projects);
  return { projects: vercel.projects, warnings: [...github.warnings, ...vercel.warnings] };
}
