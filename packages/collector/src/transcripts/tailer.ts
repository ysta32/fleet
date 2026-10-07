import { EventEmitter } from 'node:events';
import { watch, type FSWatcher } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export interface TranscriptFile {
  path: string;
  sessionId: string;
  projectDir: string;
  projectId: string;
  isSubagent: boolean;
  parentSessionId?: string;
  agentFileId?: string;
}

export interface TailerOptions {
  root: string;
  recentWindowMs: number;
  pollMs?: number;
}

const INITIAL_TAIL_BYTES = 2 * 1024 * 1024;
const CHUNK_BYTES = 4 * 1024 * 1024;

interface FileState {
  file: TranscriptFile;
  offset: number;
  pending: Buffer;
  mtimeMs: number;
  size: number;
}

export class Tailer extends EventEmitter {
  private readonly root: string;
  private readonly recentWindowMs: number;
  private readonly pollMs: number;
  private readonly files = new Map<string, FileState>();
  private timer: NodeJS.Timeout | undefined;
  private watcher: FSWatcher | undefined;
  private running = false;
  private again = false;
  private stopped = true;

  constructor(opts: TailerOptions) {
    super();
    this.root = opts.root;
    this.recentWindowMs = opts.recentWindowMs;
    this.pollMs = opts.pollMs ?? 1500;
  }

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    await this.poll();
    if (this.stopped) return;
    this.timer = setInterval(() => void this.poll(), this.pollMs);
    this.timer.unref();
    try {
      this.watcher = watch(this.root, { recursive: true }, () => void this.poll());
      this.watcher.on('error', () => this.closeWatcher());
      this.watcher.unref?.();
    } catch {
      // fs.watch unavailable (e.g. missing root or platform limits); polling covers it.
      this.watcher = undefined;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.closeWatcher();
  }

  private closeWatcher(): void {
    try {
      this.watcher?.close();
    } catch {
      // already closed
    }
    this.watcher = undefined;
  }

  private async poll(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        await this.scan();
      } while (this.again && !this.stopped);
    } finally {
      this.running = false;
    }
  }

  private async safeReaddir(dir: string): Promise<import('node:fs').Dirent[]> {
    try {
      return await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  }

  private async discover(): Promise<TranscriptFile[]> {
    const out: TranscriptFile[] = [];
    for (const proj of await this.safeReaddir(this.root)) {
      if (!proj.isDirectory()) continue;
      const projectDir = proj.name;
      const projPath = path.join(this.root, projectDir);
      for (const ent of await this.safeReaddir(projPath)) {
        if (ent.isFile() && ent.name.endsWith('.jsonl')) {
          out.push({
            path: path.join(projPath, ent.name),
            sessionId: ent.name.slice(0, -'.jsonl'.length),
            projectDir,
            projectId: projectDir,
            isSubagent: false,
          });
        } else if (ent.isDirectory()) {
          const subDir = path.join(projPath, ent.name, 'subagents');
          for (const sub of await this.safeReaddir(subDir)) {
            if (!sub.isFile() || !sub.name.endsWith('.jsonl')) continue;
            const base = sub.name.slice(0, -'.jsonl'.length);
            const agentFileId = base.startsWith('agent-') ? base.slice('agent-'.length) : base;
            out.push({
              path: path.join(subDir, sub.name),
              sessionId: ent.name,
              projectDir,
              projectId: projectDir,
              isSubagent: true,
              parentSessionId: ent.name,
              agentFileId,
            });
          }
        }
      }
    }
    return out;
  }

  private async scan(): Promise<void> {
    const now = Date.now();
    const found = await this.discover();
    const seen = new Set<string>();
    for (const file of found) {
      if (this.stopped) return;
      seen.add(file.path);
      try {
        const st = await stat(file.path);
        const known = this.files.get(file.path);
        if (!known) {
          if (now - st.mtimeMs > this.recentWindowMs) continue;
          const state: FileState = {
            file,
            offset: 0,
            pending: Buffer.alloc(0),
            mtimeMs: st.mtimeMs,
            size: st.size,
          };
          this.files.set(file.path, state);
          this.emit('file', file);
          const start = st.size > INITIAL_TAIL_BYTES ? st.size - INITIAL_TAIL_BYTES : 0;
          await this.readFrom(state, start, st.size, start > 0);
        } else if (st.size < known.offset) {
          // truncated or rewritten: restart from the beginning
          known.pending = Buffer.alloc(0);
          known.mtimeMs = st.mtimeMs;
          known.size = st.size;
          await this.readFrom(known, 0, st.size, false);
        } else if (st.size !== known.size || st.mtimeMs !== known.mtimeMs || st.size > known.offset) {
          known.mtimeMs = st.mtimeMs;
          known.size = st.size;
          await this.readFrom(known, known.offset, st.size, false);
        }
      } catch {
        // file vanished or unreadable; retry next poll
      }
    }
    for (const p of [...this.files.keys()]) if (!seen.has(p)) this.files.delete(p);
  }

  private async readFrom(state: FileState, from: number, to: number, skipToNewline: boolean): Promise<void> {
    state.offset = from;
    if (to <= from) return;
    const fh = await open(state.file.path, 'r');
    try {
      let pos = from;
      let skipping = skipToNewline;
      while (pos < to) {
        const len = Math.min(CHUNK_BYTES, to - pos);
        const buf = Buffer.alloc(len);
        const { bytesRead } = await fh.read(buf, 0, len, pos);
        if (bytesRead <= 0) break;
        pos += bytesRead;
        let chunk = Buffer.concat([state.pending, buf.subarray(0, bytesRead)]);
        if (skipping) {
          const nl = chunk.indexOf(0x0a);
          if (nl < 0) {
            state.pending = Buffer.alloc(0);
            state.offset = pos;
            continue;
          }
          chunk = chunk.subarray(nl + 1);
          skipping = false;
        }
        const lastNl = chunk.lastIndexOf(0x0a);
        if (lastNl < 0) {
          state.pending = Buffer.from(chunk);
        } else {
          state.pending = Buffer.from(chunk.subarray(lastNl + 1));
          const lines = chunk
            .subarray(0, lastNl)
            .toString('utf8')
            .split('\n')
            .map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
            .filter((l) => l.length > 0);
          state.offset = pos;
          if (lines.length > 0) this.emit('lines', state.file, lines);
        }
        state.offset = pos;
      }
    } finally {
      await fh.close();
    }
  }
}
