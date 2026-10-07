# Fleet monorepo layout

npm workspaces (`packages/*`, `apps/*`), Node >= 20, TypeScript, vitest, prettier.

| path                 | owner          | what                                                                      |
| -------------------- | -------------- | ------------------------------------------------------------------------- |
| `packages/shared`    | fleet          | frozen contract types (`src/types.ts`), pricing, synthetic demo generator |
| `packages/collector` | fleet          | local read-only daemon + `fleet` CLI (default port 4747)                  |
| `packages/web`       | fleet          | WebGL visualizer + dashboard + PWA (Vite + React + r3f)                   |
| `packages/digest`    | Overnight army | morning digest; JSON contract in `packages/digest/SCHEMA.md`              |
| `apps/site`          | fleet          | landing site on Vercel (synthetic demo only)                              |

Each package exposes `build`, `typecheck` scripts (optional) and tests as `src/**/*.test.ts` picked up by the root `vitest.config.ts`.
CI (`.github/workflows/ci.yml`): `npm ci`, `format:check`, `build`, `typecheck`, `test`, privacy guard.

Privacy: never commit real transcripts (`*.jsonl` outside fixtures), `.env*`, or screenshots of real sessions.
