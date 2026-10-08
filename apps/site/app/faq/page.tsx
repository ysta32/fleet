import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { PageHead } from '@/components/PageHead';
import { pageMeta } from '@/lib/site';

export const metadata = pageMeta(
  'faq',
  'FAQ',
  'Short answers about what Fleet reads, what it costs, what it runs on and what it does not do.',
);

const QA: [string, React.ReactNode][] = [
  [
    'Does Fleet send my transcripts anywhere?',
    'No. The collector reads them on your Mac and serves a summary on 127.0.0.1. There is no Fleet server and no telemetry. By default it asks GitHub, read-only through your own gh CLI, for PR and CI status of repos you worked in during the last 24 hours. Set "github": false in ~/.config/fleet/config.json to stop that. ntfy is contacted only if you set a topic.',
  ],
  [
    'Does it change how Claude Code runs?',
    'No. Fleet is read-only. It does not install hooks, edit settings.json or talk to your agents.',
  ],
  ['What does it cost?', 'Nothing. Fleet is MIT licensed with no paid tier.'],
  [
    'Are the cost numbers exact?',
    'They are estimates from token counts in the transcripts and public per-model list prices, including cache reads and writes. Your provider invoice is the source of truth.',
  ],
  [
    'Which platforms work?',
    'The collector targets macOS (it installs a launchd agent) with Node 20 or newer. The dashboard runs in any modern browser, including your phone over Tailscale.',
  ],
  [
    'Can my team use it?',
    'Fleet is built for one person watching their own agents. Each developer runs their own collector. There is no shared server or team view.',
  ],
  [
    'Is the fleet on this site real?',
    'The renderer is the real one from the app. The data is synthetic, from the deterministic demo generator. No real session, project or path appears on this site.',
  ],
  [
    'Who builds it?',
    <>
      One developer, in the open. See <Link href="/about">About</Link>.
    </>,
  ],
];

export default function Faq() {
  return (
    <>
      <PageHead label="FAQ" title={<>Short answers.</>} />
      <div className="wrap page-body">
        <div className="faq">
          {QA.map(([q, a]) => (
            <details key={q}>
              <summary>
                {q}
                <Icon name="chevron" />
              </summary>
              <div className="answer">{a}</div>
            </details>
          ))}
        </div>
      </div>
    </>
  );
}
