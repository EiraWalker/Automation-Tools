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
