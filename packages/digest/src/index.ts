export * from './types.js';
export {
  defaultConfig,
  loadConfig,
  readSecrets,
  parseDuration,
  resolveWindow,
  matchRepo,
  digestDateKey,
} from './config.js';
export { loadState, saveState } from './state.js';
export { collect } from './collect/index.js';
export { collectGitHub } from './collect/github.js';
export { collectVercel } from './collect/vercel.js';
export {
  computeHealth,
  fallbackProjectSummary,
  fallbackHeadline,
  fallbackSummarizer,
} from './summarize/fallback.js';
export { createLlmSummarizer, type AnthropicLike } from './summarize/llm.js';
export { buildDigest, computeTotals, sortProjects } from './digest.js';
export {
  renderDigestHtml,
  renderDigestFragment,
  renderIndexHtml,
  writeArchive,
  DIGEST_CSS,
  type DigestNav,
  type FragmentOptions,
  type DigestHtmlOptions,
  type IndexHtmlOptions,
  type WriteArchiveOptions,
} from './render/html.js';
export { renderMarkdown, renderPlainText, renderEmailHtml } from './render/text.js';
export { deliverAll } from './deliver/index.js';
export { deliverNotion } from './deliver/notion.js';
export { deliverEmail } from './deliver/email.js';
export { deliverNtfy } from './deliver/ntfy.js';
export { syntheticDigest, syntheticArchive } from './demo/synthetic.js';
export { runDigest, type RunOptions, type RunResult } from './run.js';
