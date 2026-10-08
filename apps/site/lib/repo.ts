// Build-time facts read from this repository. Everything shown as "proof" on the site is computed
// here from files on disk, so it cannot drift from the code or be invented.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ICON_NAMES } from '@fleet/ui';

export const REPO_ROOT = path.resolve(process.cwd(), '../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export interface RepoFacts {
  testFiles: number;
  testCases: number;
  packages: number;
  icons: number;
  license: string;
}

let cached: RepoFacts | null = null;

export function repoFacts(): RepoFacts {
  if (cached) return cached;
  const files = walk(path.join(REPO_ROOT, 'packages'));
  const tests = files.filter((f) => /\.(test|spec)\.tsx?$/.test(f));
  let cases = 0;
  for (const t of tests) cases += (readFileSync(t, 'utf8').match(/^\s*(it|test)\(/gm) ?? []).length;
  const packages = readdirSync(path.join(REPO_ROOT, 'packages')).filter((p) => {
    try {
      return statSync(path.join(REPO_ROOT, 'packages', p, 'package.json')).isFile();
    } catch {
      return false;
    }
  }).length;
  const licenseText = readFileSync(path.join(REPO_ROOT, 'LICENSE'), 'utf8');
  cached = {
    testFiles: tests.length,
    testCases: cases,
    packages,
    icons: ICON_NAMES.length,
    license: /MIT License/.test(licenseText) ? 'MIT' : 'See LICENSE',
  };
  return cached;
}

/** The released version: the collector package version is Fleet's version. */
export function fleetVersion(): string {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'packages/collector/package.json'), 'utf8')) as {
    version?: unknown;
  };
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+/.test(pkg.version)) {
    throw new Error('packages/collector/package.json: missing or invalid "version"');
  }
  return pkg.version;
}
