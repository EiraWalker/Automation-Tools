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
