# Overnight digest JSON contract

This is the embed contract for Fleet's dashboard/visualizer and any other consumer.
Machine-readable schemas (JSON Schema 2020-12):

- `schema/digest.v1.json` — `$id` `https://github.com/ysta32/fleet/packages/digest/schema/digest.v1.json`
- `schema/index.v1.json` — `$id` `https://github.com/ysta32/fleet/packages/digest/schema/index.v1.json`

## Files layout

```
<out>/
  latest.json            # newest Digest
  index.json             # DigestIndex (all digests, newest first)
  index.html  styles.css
  digests/YYYY-MM-DD.json
  digests/YYYY-MM-DD.html
```

Default `<out>` is `~/.overnight/archive` (override with `--out` or `OVERNIGHT_OUT`). The Fleet daemon serves
`<out>/latest.json` at `GET /api/digest/latest`.

## Versioning

- `schema` is `"overnight.digest/v1"` (index: `"overnight.index/v1"`).
- Within v1 changes are additive only: new optional fields or new enum-free fields. Consumers must ignore unknown fields
  (the schemas set `additionalProperties: true`).
- A breaking change ships as v2 with a new schema id and a new `schema` value. Check `schema` before parsing.

## Digest

| Field         | Type                                         | Notes                                                    |
| ------------- | -------------------------------------------- | -------------------------------------------------------- |
| `schema`      | `"overnight.digest/v1"`                      | Constant.                                                |
| `id`          | string `YYYY-MM-DD`                          | Date of `window.until` in the configured timezone.       |
| `generatedAt` | ISO-8601 UTC                                 |                                                          |
| `window`      | `{since, until}`                             | ISO-8601 UTC.                                            |
| `owner`       | string                                       | GitHub user or org.                                      |
| `headline`    | string                                       | 1-2 sentences.                                           |
| `summarizer`  | `{kind:"llm", model}` or `{kind:"fallback"}` | Who wrote the summaries.                                 |
| `totals`      | DigestTotals                                 | See below.                                               |
| `projects`    | ProjectActivity[]                            | Red first, then by activity volume; quiet projects last. |
| `warnings`    | string[]                                     | Repos skipped due to errors, with reason.                |

### DigestTotals

All integers: `projectsActive`, `mergedPRs`, `commits`, `releases`, `ciFailures`, `openPRsNeedingAttention`,
`issuesOpened`, `issuesClosed`, `deployments`, `deploymentsFailed`, `starsDelta`, `agentContributions` (merged PRs
plus commits authored by bots/agents).

### ProjectActivity

| Field           | Type                                 | Required | Notes                                               |
| --------------- | ------------------------------------ | -------- | --------------------------------------------------- |
| `id`            | string                               | yes      | `owner/name`, or `vercel:<project>` if Vercel-only. |
| `name`, `url`   | string                               | yes      |                                                     |
| `description`   | string                               | no       |                                                     |
| `defaultBranch` | string                               | no       |                                                     |
| `vercelProject` | string                               | no       |                                                     |
| `siteUrl`       | string                               | no       |                                                     |
| `mergedPRs`     | PullRequestItem[]                    | yes      |                                                     |
| `openPRs`       | PullRequestItem[]                    | yes      | Only PRs needing attention.                         |
| `commits`       | CommitItem[]                         | yes      | Default-branch commits in window.                   |
| `releases`      | ReleaseItem[]                        | yes      |                                                     |
| `ciFailures`    | CIFailureItem[]                      | yes      |                                                     |
| `issues`        | IssueItem[]                          | yes      |                                                     |
| `deployments`   | DeploymentItem[]                     | yes      |                                                     |
| `traffic`       | `{views?, uniqueVisitors?, source}`  | no       | `source`: `github` or `vercel`.                     |
| `stats`         | RepoStats                            | no       | `stars, forks, starsDelta, forksDelta, openIssues`. |
| `health`        | `green` / `yellow` / `red` / `quiet` | yes      | See health semantics.                               |
| `summary`       | string                               | yes      | Plain text, 1-4 sentences.                          |
| `highlights`    | string[]                             | yes      | Up to 5 bullets.                                    |

### Item types

| Type              | Required fields                                                | Optional fields                                  |
| ----------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| `Actor`           | `login`, `isBot`                                               |                                                  |
| `PullRequestItem` | `number`, `title`, `url`, `author`, `at`, `labels`             | `additions`, `deletions`, `draft`, `attention[]` |
| `CommitItem`      | `sha`, `message` (first line), `url`, `author`, `at`, `branch` |                                                  |
| `ReleaseItem`     | `tag`, `name`, `url`, `at`, `prerelease`                       | `notes` (max 2000 chars)                         |
| `CIFailureItem`   | `workflow`, `runId`, `url`, `branch`, `at`, `conclusion`       | `commitMessage`                                  |
| `IssueItem`       | `number`, `title`, `url`, `author`, `at`, `state`, `labels`    |                                                  |
| `DeploymentItem`  | `id`, `project`, `url`, `target`, `state`, `at`                | `commitMessage`, `branch`                        |

Enums: `attention` is one of `review_requested`, `ci_failing`, `stale`, `conflicts`, `approved_unmerged`.
`conclusion` is `failure`, `timed_out`, `cancelled` or `startup_failure`. Issue `state` is `opened` or `closed`.
Deployment `target` is `production` or `preview`; `state` is `READY`, `ERROR`, `CANCELED`, `BUILDING` or `QUEUED`.
For merged PRs `at` is the merge time; for open PRs it is the last update time.

### DigestIndex

`{schema:"overnight.index/v1", owner, updatedAt, digests:[{id, headline, window, totals, path}]}`. `path` is relative
to `<out>`, e.g. `digests/2026-10-07.json`.

## Health semantics

- `red`: failing CI on the default branch, the latest production deploy is `ERROR`, or an open PR has `ci_failing`.
- `yellow`: any other attention PRs, a failed preview deploy, or other CI failures.
- `green`: activity with none of the above.
- `quiet`: no activity in the window.

## TypeScript usage

```ts
import type { Digest, ProjectActivity } from '@fleet/digest';

const res = await fetch('/api/digest/latest');
const digest = (await res.json()) as Digest;
if (digest.schema !== 'overnight.digest/v1') throw new Error('unsupported digest version');
const red: ProjectActivity[] = digest.projects.filter((p) => p.health === 'red');
```

## Embedding HTML

```ts
import { renderDigestFragment, DIGEST_CSS } from '@fleet/digest';

const html = `<style>${DIGEST_CSS}</style>${renderDigestFragment(digest)}`;
```

The fragment has no `<html>` or `<head>`. All classes are prefixed `ovn-` and the CSS is scoped under `.ovn-root`,
so it will not leak into the host page.

## Example (trimmed)

```json
{
  "schema": "overnight.digest/v1",
  "id": "2026-10-07",
  "generatedAt": "2026-10-07T13:00:12.000Z",
  "window": { "since": "2026-10-06T13:00:00.000Z", "until": "2026-10-07T13:00:00.000Z" },
  "owner": "ysta32",
  "headline": "3 PRs merged across 2 projects; one CI failure needs a look.",
  "summarizer": { "kind": "fallback" },
  "totals": {
    "projectsActive": 2,
    "mergedPRs": 3,
    "commits": 7,
    "releases": 0,
    "ciFailures": 1,
    "openPRsNeedingAttention": 1,
    "issuesOpened": 1,
    "issuesClosed": 0,
    "deployments": 2,
    "deploymentsFailed": 0,
    "starsDelta": 2,
    "agentContributions": 4
  },
  "projects": [
    {
      "id": "ysta32/example",
      "name": "example",
      "url": "https://github.com/ysta32/example",
      "mergedPRs": [
        {
          "number": 12,
          "title": "Fix retry loop",
          "url": "https://github.com/ysta32/example/pull/12",
          "author": { "login": "claude[bot]", "isBot": true },
          "at": "2026-10-07T04:10:00.000Z",
          "labels": []
        }
      ],
      "openPRs": [],
      "commits": [],
      "releases": [],
      "ciFailures": [],
      "issues": [],
      "deployments": [],
      "health": "green",
      "summary": "One PR merged by an agent.",
      "highlights": ["Fix retry loop (#12)"]
    }
  ],
  "warnings": []
}
```
