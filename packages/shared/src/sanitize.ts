import { projectNameFromPath } from './ids.js';

export function truncate(s: string, n: number): string {
  return s.slice(0, Math.max(0, n));
}

function sanitizeLabel(label: unknown): string | undefined {
  if (typeof label !== 'string' || label.length < 1 || label.length > 60) return undefined;
  return /[^A-Za-z0-9_.:-]/.test(label) ? undefined : label;
}

function commandName(command: string): string | undefined {
  let remaining = command.trimStart();
  while (remaining) {
    const match = /^(?:[^\s"'\\|&;()<>$`]+|"(?:\\.|[^"\\$`])*"|'[^']*'|\\[^\r\n])+/.exec(remaining);
    if (!match) return undefined;
    const raw = match[0];
    const rest = remaining.slice(raw.length);
    if (rest && !/^[\s|&;<>]/.test(rest)) return undefined;
    if (/^[a-zA-Z_][a-zA-Z0-9_]*=/.test(raw)) {
      if (rest && !/^\s/.test(rest)) return undefined;
      remaining = rest.trimStart();
      continue;
    }
    const token = raw.replace(
      /"((?:\\.|[^"\\])*)"|'([^']*)'|\\(.)/g,
      (_match, double: string | undefined, single: string | undefined, escaped: string | undefined) =>
        double !== undefined ? double.replace(/\\(["\\])/g, '$1') : (single ?? escaped ?? ''),
    );
    const name = projectNameFromPath(token);
    return /^[a-zA-Z0-9_.+-]+$/.test(name) ? name : undefined;
  }
  return undefined;
}

export function sanitizeTarget(toolName: string, input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const fields = input as Record<string, unknown>;
  let target: string | undefined;
  switch (toolName) {
    case 'Edit':
    case 'Write':
    case 'Read':
    case 'NotebookEdit':
      if (typeof fields.file_path === 'string') target = projectNameFromPath(fields.file_path);
      break;
    case 'Bash':
      if (typeof fields.command === 'string') target = commandName(fields.command);
      break;
    case 'Grep':
    case 'Glob':
      target = 'search';
      break;
    case 'Agent':
    case 'Task':
      target = sanitizeLabel(fields.subagent_type);
      break;
    case 'WebFetch':
      if (typeof fields.url === 'string') {
        try {
          const url = new URL(fields.url);
          if (url.protocol === 'http:' || url.protocol === 'https:') target = url.hostname;
        } catch {
          return undefined;
        }
      }
      break;
    case 'Skill':
      target = sanitizeLabel(fields.skill);
      break;
  }
  return target ? truncate(target, 60) : undefined;
}
