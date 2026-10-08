import { PageHead } from '@/components/PageHead';
import { INSTALL_CMD, REPO_URL, pageMeta } from '@/lib/site';

export const metadata = pageMeta(
  'docs',
  'Docs',
  'Install Fleet, use the CLI, configure it, reach it from your phone over Tailscale, set up ntfy alerts, and understand the privacy model.',
);

const SECTIONS = [
  ['install', 'Install'],
  ['cli', 'CLI'],
  ['config', 'Configuration'],
  ['phone', 'Phone over Tailscale'],
  ['notifications', 'Notifications'],
  ['privacy', 'Privacy model'],
  ['architecture', 'Architecture'],
  ['troubleshooting', 'Troubleshooting'],
] as const;

const CLI = [
  ['fleet start', 'Run the collector in the foreground. Useful while debugging.'],
  ['fleet install', 'Install and load the launchd agent so the collector starts at login (macOS).'],
  ['fleet uninstall', 'Unload and remove the launchd agent.'],
  ['fleet status', 'Show daemon health and counts.'],
  ['fleet token', 'Print the access token and the LAN URL for your phone.'],
  ['fleet open', 'Open the dashboard in your browser.'],
  ['fleet doctor', 'Check Node, the transcripts folder, gh and the port.'],
  ['fleet demo', 'Run the daemon with synthetic demo data. Good for screenshots.'],
] as const;

const CONFIG = [
  ['port', '4747', 'Port for the API and the web app. FLEET_PORT overrides it.'],
  ['lan', 'false', 'false binds 127.0.0.1. true binds 0.0.0.0 for your phone. FLEET_LAN=1 overrides it.'],
  ['token', 'random', '32 random bytes in hex, generated on first run. Required for every non-local request.'],
  ['claudeProjectsDir', '~/.claude/projects', 'Where Claude Code writes its transcripts.'],
  ['recentWindowMs', '86400000', 'Sessions active within this window (24h) are shown.'],
  ['shareContent', 'false', 'Allow status and handoff excerpts to reach remote clients.'],
  ['notify.macos', 'true', 'Show macOS notifications.'],
  ['notify.ntfyUrl', '""', 'Your ntfy topic URL. Empty disables ntfy.'],
  ['notify.kinds', 'all five', 'army.done, army.blocked, ci.failed, session.waiting, deploy.failed.'],
  ['github', 'true', 'Poll PR and CI status through the gh CLI, read-only.'],
  ['githubPollMs', '60000', 'GitHub polling interval.'],
  ['allowedHosts', 'none', 'Extra Host names accepted in LAN mode, for example your-mac.tailnet.ts.net.'],
] as const;

export default function Docs() {
  return (
    <>
      <PageHead
        label="Docs"
        title={<>Set it up once. <em>Forget it is there.</em></>}
        lead="Everything you need to install, configure and trust Fleet. Ten minutes, start to finish."
      />
      <div className="wrap page-body doc">
        <nav className="toc" aria-label="On this page">
          <ol>
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`}>{label}</a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="article">
          <section id="install" aria-labelledby="install-h">
            <h2 id="install-h">Install</h2>
            <p>
              You need macOS and Node 20 or newer. Claude Code should already be writing transcripts to{' '}
              <code>~/.claude/projects</code>.
            </p>
            <pre className="code">
              <code>
                <span className="c"># install the collector and start it at login</span>
                {'\n'}
                {INSTALL_CMD}
                {'\n\n'}
                <span className="c"># check your setup, then open the dashboard</span>
                {'\n'}fleet doctor{'\n'}fleet open
              </code>
            </pre>
            <p>
              Prefer source? <code>FLEET_FROM_GIT=1 bash scripts/install.sh</code> clones the repository, builds it and
              links the CLI. The installer never touches <code>~/.claude/settings.json</code>.
            </p>
          </section>

          <section id="cli" aria-labelledby="cli-h">
            <h2 id="cli-h">CLI</h2>
            <dl className="def">
              {CLI.map(([cmd, what]) => (
                <div key={cmd}>
                  <dt>
                    <code>{cmd}</code>
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section id="config" aria-labelledby="config-h">
            <h2 id="config-h">Configuration</h2>
            <p>
              Fleet reads <code>~/.config/fleet/config.json</code> (or <code>FLEET_CONFIG</code>). The file is created on
              first run with mode 0600. Data lives in <code>~/.local/share/fleet</code> (or <code>FLEET_DATA</code>).
            </p>
            <dl className="def">
              {CONFIG.map(([key, def, what]) => (
                <div key={key}>
                  <dt>
                    <code>{key}</code>
                  </dt>
                  <dd>
                    {what} <span className="num">Default: {def}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section id="phone" aria-labelledby="phone-h">
            <h2 id="phone-h">Phone over Tailscale</h2>
            <ol>
              <li>
                Install Tailscale on your Mac and phone and sign both in to the same tailnet.
              </li>
              <li>
                Set <code>&quot;lan&quot;: true</code> in the config, and add your Mac&apos;s tailnet name to{' '}
                <code>allowedHosts</code>.
              </li>
              <li>
                Restart the collector, then run <code>fleet token</code>. Open the printed URL on your phone. It carries
                the token, so treat it like a password.
              </li>
              <li>Add the page to your home screen to keep it one tap away.</li>
            </ol>
            <p>
              Do not expose the port to the public internet. LAN mode is for networks you control, and Tailscale keeps it
              that way.
            </p>
          </section>

          <section id="notifications" aria-labelledby="notifications-h">
            <h2 id="notifications-h">Notifications</h2>
            <p>
              macOS notifications are on by default. For your phone, pick a hard-to-guess ntfy topic, subscribe to it in
              the ntfy app, and set it in the config:
            </p>
            <pre className="code">
              <code>{`{
  "notify": {
    "macos": true,
    "ntfyUrl": "https://ntfy.sh/<your-long-random-topic>",
    "kinds": ["army.blocked", "session.waiting", "ci.failed"]
  }
}`}</code>
            </pre>
            <p>
              Anyone who knows a public ntfy topic can read it. Each alert sends a title and a short body, such as the
              project and what it is waiting for. Self-host ntfy if that is too much.
            </p>
          </section>

          <section id="privacy" aria-labelledby="privacy-h">
            <h2 id="privacy-h">Privacy model</h2>
            <ul>
              <li>
                <strong>Read-only.</strong> Fleet reads transcripts and never writes to them or to Claude Code settings.
              </li>
              <li>
                <strong>Local.</strong> The collector binds 127.0.0.1 by default. There is no Fleet server and no
                telemetry.
              </li>
              <li>
                <strong>Token-gated.</strong> Every non-local request needs the token. Loopback requests also check the
                Host header to block DNS rebinding.
              </li>
              <li>
                <strong>Minimal by default.</strong> With <code>shareContent</code> off, remote clients get state and
                counts, not status or handoff excerpts.
              </li>
              <li>
                <strong>Two outbound calls, both through your own accounts.</strong> GitHub status is on by default.
                It runs read-only through your signed-in <code>gh</code>, only for repos with activity in the last 24
                hours, and turns off with <code>&quot;github&quot;: false</code>. ntfy runs only if you set a topic.
                Nothing else leaves the machine.
              </li>
            </ul>
          </section>

          <section id="architecture" aria-labelledby="architecture-h">
            <h2 id="architecture-h">Architecture</h2>
            <p>
              Three workspace packages do the work. <code>fleet-collector</code> tails transcripts, polls GitHub, keeps a
              short history and serves the API and web app. <code>@fleet/shared</code> holds the protocol types, the
              cost estimator and the synthetic demo generator. <code>@fleet/web</code> is the React and three.js app:
              the 3D fleet, the dashboard and replay. Halyard (<code>@fleet/ui</code>) is the design system all three
              share.
            </p>
            <p>
              Source and issues are on <a href={REPO_URL}>GitHub</a>.
            </p>
          </section>

          <section id="troubleshooting" aria-labelledby="troubleshooting-h">
            <h2 id="troubleshooting-h">Troubleshooting</h2>
            <h3>The dashboard is empty.</h3>
            <p>
              Run <code>fleet doctor</code>. It checks that <code>claudeProjectsDir</code> exists. Sessions older than{' '}
              <code>recentWindowMs</code> are hidden; start Claude Code in any repo and it appears.
            </p>
            <h3>Port 4747 is in use.</h3>
            <p>
              Another collector is probably running. Check <code>fleet status</code>, or set <code>FLEET_PORT</code> to
              a free port.
            </p>
            <h3>My phone cannot connect.</h3>
            <p>
              Confirm <code>lan</code> is true, the Mac&apos;s tailnet name is in <code>allowedHosts</code>, and the URL
              includes the token from <code>fleet token</code>.
            </p>
            <h3>No PR or CI status.</h3>
            <p>
              Run <code>gh auth status</code>. GitHub polling needs a signed-in gh CLI and a GitHub remote on the repo.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
