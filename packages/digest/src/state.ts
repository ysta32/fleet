import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { StateSnapshot } from './types.js';

const stateSchema = z.object({
  lastRunAt: z.string().datetime({ offset: true }).optional(),
  repoStats: z.record(
    z.string(),
    z.object({ stars: z.number().nonnegative(), forks: z.number().nonnegative() }),
  ),
});

export async function loadState(dir: string): Promise<StateSnapshot> {
  let content: string;
  try {
    content = await readFile(join(dir, 'state.json'), 'utf8');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return { repoStats: {} };
    throw error;
  }
  return stateSchema.parse(JSON.parse(content));
}

export async function saveState(dir: string, s: StateSnapshot): Promise<void> {
  const content = JSON.stringify(stateSchema.parse(s), null, 2) + '\n';
  await mkdir(dir, { recursive: true });
  const temporary = join(dir, `.state-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    await rename(temporary, join(dir, 'state.json'));
  } catch (error) {
    try {
      await rm(temporary, { force: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'State write failed and temporary file cleanup failed');
    }
    throw error;
  }
}
