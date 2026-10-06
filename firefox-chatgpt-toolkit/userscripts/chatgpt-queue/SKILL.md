---
name: chatgpt-queue-userscript
description: Install, use, maintain and validate the Tampermonkey ChatGPT Queue userscript in existing Firefox. Supports the native ChatGPT composer, automatic queued turns, effective Accent color and configurable full-width conversations.
---

# ChatGPT Queue userscript

Read [README.md](README.md) for installation and user behavior. Install the complete `chatgpt-queue.user.js` in Firefox Tampermonkey; no npm or MCP is needed for everyday use. Check the installed version, enabled flag, full-site `@match`, and User excludes. Refresh already-open ChatGPT tabs after installing/updating; a script enabled in the dashboard can still be excluded from the site.

Use the native ChatGPT composer. Ctrl+Enter enqueues; Enter enqueues during generation or when queued items exist, while idle Enter stays native. There is no enqueue/run button or second message textarea. Queue rows contain only unsent prompts: pop on confirmed receipt/start, keep the accepted turn separately until its answer completes, then dispatch the next prompt. The last prompt hides the list at start; `Ctrl + Enter  Enqueue` stays visible. The userscript menu opens its settings; full width defaults on. The UI follows the actual site's background/text/font and effective Accent color.

For changes, use Node.js 22.13+, `npm ci --ignore-scripts`, `npm test`, `npm run build`, and `npm run check`. Source locations: `src/core.cjs` for queue state/persistence, `src/browser.js` for page adapter/UI/locking, `src/queue.css` for styling, and `src/notice-card.js` for the reusable rounded notice card with accent/neutral actions. Keep the generated script synchronized with source and preserve GPL/source attribution.

Validate adapter changes against the current logged-in ChatGPT frontend in the user's existing Firefox and the explicitly designated test tab. If available, use the companion firefox-native-automation and background-window-capture skills. Preserve the native draft, avoid other conversations, and confirm the installed script works after reload and SPA navigation. Fixtures and console injection into one tab alone do not prove Tampermonkey is installed site-wide.

Before automatic-send testing, inspect busy state and native composer, then use minimal test messages within the authorized test conversation. Verify sent turns and retained queue state rather than treating a click as receipt. An unconfirmed send is a coded execution error, never a sent/unsent question. Inspect Console `[ChatGPT Queue][CODE]` or the JSON from Copy diagnostics; Recheck only reads the receipt and never resends. Diagnostics and `chatgpt-queue:error` event details contain state signals, not chat text or URLs. Reload automatically reconciles a stored accepted message against the actual page before continuing. Stop/Esc pauses, empty-composer Ctrl+Enter resumes. A stored queue starts paused after reload; another tab holding the Web Lock manages the queue.

Read [VALIDATION.md](VALIDATION.md) for established runtime evidence and limits. Private chat URLs, screenshots and stored queue text are local evidence and are not part of the published source.

When editing click interception, require an actual native send button target. A shadow control retargets to the host, so its nearest button can be null; comparing that null with an absent send button can swallow every queue action. Keep the full installed-script regression test, in addition to isolated component tests.

Accepted running turns persist in `state.active` with their text for receipt checks; they are absent from `state.items`. Do not use an empty queue as proof that the current answer has completed. Keep reload reconciliation compatible with old states whose accepted item is still in `items`, and allow pending items to reorder around a separately running turn.
