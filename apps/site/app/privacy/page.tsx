import Link from 'next/link';
import { PageHead } from '@/components/PageHead';
import { pageMeta } from '@/lib/site';

export const metadata = pageMeta('privacy', 'Privacy', 'What Fleet and this website collect: nothing, and why.');

export default function Privacy() {
  return (
    <>
      <PageHead label="Privacy" title={<>We collect nothing.</>} lead="Plain language. Last updated October 2026." />
      <div className="wrap page-body article">
        <section>
          <h2>This website</h2>
          <p>
            This site is static HTML. It sets no cookies, runs no analytics and loads no third-party scripts. It stores
            one item in your browser&apos;s local storage: your light or dark preference, if you choose one. Our host,
            Vercel, keeps standard server logs to operate the service.
          </p>
          <p>The fleet shown on this site is synthetic. It contains no real sessions, projects or file paths.</p>
        </section>
        <section>
          <h2>The Fleet app</h2>
          <p>
            Fleet runs on your computer. It reads Claude Code transcripts locally and serves a dashboard on your
            machine. We operate no server that receives your data, and the app has no telemetry.
          </p>
          <p>
            Fleet contacts other services only when you turn them on: GitHub through your own <code>gh</code> login, and
            the ntfy topic you configure. Those services have their own privacy policies.
          </p>
          <p>
            See the <Link href="/docs#privacy">privacy model</Link> in the docs for the technical details.
          </p>
        </section>
      </div>
    </>
  );
}
