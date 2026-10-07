// Parses the root CHANGELOG.md at build time (Keep a Changelog style: "## [x.y.z] - YYYY-MM-DD").
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './repo';

export interface ReleaseGroup {
  heading: string;
  items: string[];
}
export interface Release {
  version: string;
  date: string | null;
  intro: string[];
  groups: ReleaseGroup[];
}

export function readChangelog(file = path.join(REPO_ROOT, 'CHANGELOG.md')): Release[] {
  const text = readFileSync(file, 'utf8');
  const releases: Release[] = [];
  let current: Release | null = null;
  let group: ReleaseGroup | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const rel = /^##\s+\[?([^\]\s]+)\]?(?:\s+[-–]\s+(\d{4}-\d{2}-\d{2}))?/.exec(line);
    if (rel) {
      current = { version: rel[1], date: rel[2] ?? null, intro: [], groups: [] };
      releases.push(current);
      group = null;
      continue;
    }
    if (!current) continue;
    const h = /^###\s+(.+)/.exec(line);
    if (h) {
      group = { heading: h[1], items: [] };
      current.groups.push(group);
      continue;
    }
    const item = /^[-*]\s+(.+)/.exec(line);
    if (item) {
      if (!group) {
        group = { heading: 'Changes', items: [] };
        current.groups.push(group);
      }
      group.items.push(item[1]);
      continue;
    }
    if (line.trim() && !group) current.intro.push(line.trim());
  }
  return releases;
}
