# Authorization and verification

User requirement: all future interactive verification, login, remote browser and
administration entry points must use **owner-private ChatGPT Sites with Sites-managed
OAuth**. Do not publish a public verification page or enable a shared-token URL
as an alternative. Preserve private audience when updating a Site.

Use the configuration pattern in
[Codebase Graph MCP on Render](https://github.com/EiraWalker/Code-Tools/tree/main/Plugins/codebase-graph-mcp-render),
especially `docs/plugin.md` and `SECURITY.md`. The repository-specific requirements
are in [sites/bundlefoundry-control/docs/private-verification.md](sites/bundlefoundry-control/docs/private-verification.md).

Render exposes public health/status and a separately authenticated machine API.
Never expose an interactive verification page there. Do not mount the legacy `LoginRelay`,
even if old `LOGIN_*` environment variables still exist. Sites identity headers
are trusted only at the Sites authenticated hosting boundary, never on public Render.
Use a separate backend service credential stored in platform secrets if a private
Sites gateway needs to call a backend. A service token does not replace user OAuth.

Reuse valid encrypted credentials. Do not log passwords, cookies, authorization
headers, OAuth codes/tokens, browser images or input. Save and close a browser by
terminating the real Chrome process before archiving its profile; delete plaintext
profile files after the encrypted archive is verified. Never commit credential
files, private state, production identifiers or secret values.

# GPT Enhancement workspace

ChatGPT Queue runs in Firefox / Firefox Nightly with **Violentmonkey**.
Use its native installation, settings and update workflow. The environment baseline
is maintained in [project context](firefox-chatgpt-toolkit/docs/CONTEXT.md#项目运行环境).

The canonical workspace is `E:\firefox dev`, including the ChatGPT plugin and
Firefox development tools. For Firefox connection, page diagnosis, or browser
acceptance, read [Puppeteer tasks](firefox-chatgpt-toolkit/browser/firefox-puppeteer/SKILL.md)
and follow its task rules. Use the pinned Puppeteer Core connector with an existing
Firefox Nightly Remote Control session; its runtime setup is documented in that
module's README. Keep protocol implementation upstream; write only scoped
project tasks. The old D-drive path is a compatibility Junction, not another checkout.

For ChatGPT Queue work, read [CONTEXT.md](CONTEXT.md) first. The active source is
`firefox-chatgpt-toolkit/userscripts/chatgpt-queue`; `.local/legacy-workspace` is
a preserved archive. Change the source modules and rebuild the userscript there.

For architecture or state changes, read [architecture](firefox-chatgpt-toolkit/docs/architecture.md)
and the relevant [ADR](firefox-chatgpt-toolkit/docs/adr/README.md). For local setup,
verification or a release, read [development](firefox-chatgpt-toolkit/docs/development.md).
Keep current checks separate from the dated browser evidence in `VALIDATION.md`.

Discover code through codebase-memory-mcp project `gpt-enhancement-queue` or
`gpt-enhancement-native`; index the current source directory if the index is absent
or points elsewhere. Use file search for configuration, literal text and coverage gaps.
For library/API documentation, use Context7 when that documentation is needed.

Private browser tasks, screenshots and diagnostics go under `.local/`.
Use the user's existing Firefox and an explicitly designated tab for browser acceptance;
read-only inspection and fixtures do not authorize sending prompts in other chats.

Browser verification must not interfere with the user's other work (2026-10-11).
Use background capture and an already-enabled background debugging connection to
the designated test page. Do not activate windows, switch visible tabs, simulate
OS keyboard/mouse input, change the shared clipboard, or restart Firefox for testing.
If no background connection exists, continue local/API checks and prepare the
first-connection steps for an agreed time. Investigate protocol failures and record
real-page acceptance as pending; do not repeatedly ask the user to bring Firefox forward.
See [development](firefox-chatgpt-toolkit/docs/development.md) for this boundary.
