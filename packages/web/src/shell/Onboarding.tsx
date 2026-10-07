import { useState } from 'react';
import { Icon } from './Icon';

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-command">
      <code>
        <span aria-hidden="true">$ </span>
        {command}
      </code>
      <button
        type="button"
        className="btn btn-quiet btn-sm"
        aria-label={copied ? 'Copied' : `Copy ${command}`}
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          });
        }}
      >
        {copied ? <Icon name="check" /> : null}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/** First run: the collector is up but has never seen a Claude Code session. */
export function Onboarding() {
  return (
    <section className="onboarding" aria-labelledby="onboarding-title">
      <p className="micro onboarding-kicker">First watch</p>
      <h2 id="onboarding-title" className="onboarding-title">
        No sessions yet.
      </h2>
      <p className="onboarding-lead">
        Fleet watches the Claude Code transcripts on this machine, the orchestration state in each repo, and your PRs,
        CI and deploys. Nothing leaves this computer.
      </p>
      <ol className="onboarding-steps">
        <li>
          <span className="step-n">01</span>
          <div>
            <strong>Start Claude Code in any repo.</strong>
            <p>It shows up here as a vessel within 2 seconds.</p>
            <CopyCommand command="claude" />
          </div>
        </li>
        <li>
          <span className="step-n">02</span>
          <div>
            <strong>Nothing after a minute? Check the collector.</strong>
            <p>Doctor checks the transcript folder, the port and your GitHub token.</p>
            <CopyCommand command="fleet doctor" />
          </div>
        </li>
        <li>
          <span className="step-n">03</span>
          <div>
            <strong>Watch from your phone.</strong>
            <p>Prints a LAN link with an access token. Add it to your home screen.</p>
            <CopyCommand command="fleet token" />
          </div>
        </li>
      </ol>
    </section>
  );
}
