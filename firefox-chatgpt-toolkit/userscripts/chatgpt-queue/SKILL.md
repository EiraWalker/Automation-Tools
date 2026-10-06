---
name: chatgpt-queue-userscript
description: Install, use, maintain and validate the Tampermonkey ChatGPT Queue userscript in existing Firefox. Supports the native ChatGPT composer, automatic queued turns, effective Accent color and configurable full-width conversations.
---

# ChatGPT Queue userscript

Read [README.md](README.md) for installation and user behavior. Install the complete `chatgpt-queue.user.js` in Firefox Tampermonkey; no npm or MCP is needed for everyday use. Check the installed version, enabled flag, full-site `@match`, and User excludes. Refresh already-open ChatGPT tabs after installing/updating; a script enabled in the dashboard can still be excluded from the site.

Use the native ChatGPT composer. Ctrl+Enter enqueues; Enter enqueues during generation or when queued items exist, while idle Enter stays native. There is no enqueue/run button or second message textarea. Queue rows display only when present; `Ctrl + Enter  Enqueue` stays visible. The userscript menu opens its settings; full width defaults on. The UI follows the actual site's background/text/font and effective Accent color.

For changes, use Node.js 22.13+, `npm ci --ignore-scripts`, `npm test`, `npm run build`, and `npm run check`. Source locations: `src/core.cjs` for queue state/persistence, `src/browser.js` for page adapter/UI/locking, `src/queue.css` for styling. Keep the generated script synchronized with source and preserve GPL/source attribution.

Validate adapter changes against the current logged-in ChatGPT frontend in the user's existing Firefox and the explicitly designated test tab. If available, use the companion firefox-native-automation and background-window-capture skills. Preserve the native draft, avoid other conversations, and confirm the installed script works after reload and SPA navigation. Fixtures and console injection into one tab alone do not prove Tampermonkey is installed site-wide.

Before automatic-send testing, inspect busy state and native composer, then use minimal test messages within the authorized test conversation. Verify sent turns and retained queue state rather than treating a click as receipt. Unconfirmed send stays uncertain; do not retry it blindly. Stop/Esc pauses, empty-composer Ctrl+Enter resumes. A stored queue starts paused after reload; another tab holding the Web Lock manages the queue.

Read [VALIDATION.md](VALIDATION.md) for established runtime evidence and limits. Private chat URLs, screenshots and stored queue text are local evidence and are not part of the published source.
