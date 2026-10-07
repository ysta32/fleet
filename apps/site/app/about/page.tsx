import { PageHead } from '@/components/PageHead';
import { REPO_URL, pageMeta } from '@/lib/site';

export const metadata = pageMeta('about', 'About', 'Fleet is a solo-built, open-source tool for watching many Claude Code agents at once.');

export default function About() {
  return (
    <>
      <PageHead label="About" title={<>Built by one person, <em>for one person.</em></>} />
      <div className="wrap page-body">
        <div className="prose" style={{ fontSize: 'var(--fl-text-lg)', lineHeight: 'var(--fl-leading-snug)' }}>
          <p>
            Fleet started as a fix for a specific annoyance: running a dozen Claude Code agents in parallel and finding
            out, much too late, that one had been waiting on a question the whole time.
          </p>
          <p>
            It is written and maintained by Stanley Yang. There is no company behind it, no team page, no customers to
            list and no investors to thank. It is built for my own daily workflow and published so you can use it too.
          </p>
          <p>
            The design system is called Halyard, after the line that raises a signal flag. Most of the time Fleet should
            be dark and quiet. When something needs you, one signal goes up.
          </p>
          <p>
            Questions, bugs and ideas go to <a href={`${REPO_URL}/issues`}>GitHub issues</a>.
          </p>
        </div>
      </div>
    </>
  );
}
