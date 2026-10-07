import { PageHead } from '@/components/PageHead';
import { REPO_URL, pageMeta } from '@/lib/site';

export const metadata = pageMeta('terms', 'Terms', 'Fleet is MIT licensed and provided as is, without warranty. Plain-language terms.');

export default function Terms() {
  return (
    <>
      <PageHead label="Terms" title={<>MIT, in plain words.</>} lead="This summary is for convenience. The license text is what counts." />
      <div className="wrap page-body article">
        <section>
          <h2>You may</h2>
          <ul>
            <li>Use Fleet for anything, personal or commercial, at no cost.</li>
            <li>Copy, change, merge, publish, distribute, sublicense and sell copies.</li>
          </ul>
        </section>
        <section>
          <h2>You must</h2>
          <ul>
            <li>Keep the copyright notice and the license text in copies or substantial portions of the software.</li>
          </ul>
        </section>
        <section>
          <h2>No warranty</h2>
          <p>
            Fleet is provided as is, without warranty of any kind. If it breaks something, the author is not liable.
            Support is best effort, through GitHub issues.
          </p>
        </section>
        <section>
          <h2>Your model provider</h2>
          <p>
            Fleet is not affiliated with Anthropic. Your use of Claude Code and its models is governed by your agreement
            with your provider. Cost figures in Fleet are estimates.
          </p>
          <p>
            Full text: <a href={`${REPO_URL}/blob/main/LICENSE`}>LICENSE</a>.
          </p>
        </section>
      </div>
    </>
  );
}
