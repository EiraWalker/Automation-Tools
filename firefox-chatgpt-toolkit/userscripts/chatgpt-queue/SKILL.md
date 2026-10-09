---
name: chatgpt-queue-userscript
description: Install, use, maintain and validate the Tampermonkey ChatGPT Queue userscript in existing Firefox. Supports Chat, Work and current Codex Cloud /local conversations, native composers, automatic queued turns, effective Accent color and configurable full-width conversations.
---

# ChatGPT Queue userscript

Read [README.md](README.md) for installation and user behavior. Install the complete `chatgpt-queue.user.js` in Firefox Tampermonkey; no npm or MCP is needed for everyday use. Check the installed version, enabled flag, full-site `@match`, and User excludes. Refresh already-open ChatGPT tabs after installing/updating; a script enabled in the dashboard can still be excluded from the site.

Use the native composer in Chat, Work or Codex Cloud. Ctrl+Q enqueues; Enter enqueues during generation or when queued items exist, while idle Enter stays native. There is no enqueue/run button or second message textarea. Queue rows contain only unsent prompts: pop on confirmed receipt/start, keep the accepted turn separately until its answer completes, then dispatch the next prompt. The last prompt hides the list at start; `Ctrl + Q  Enqueue` stays visible. The userscript menu opens its settings; full width defaults on. The UI follows the actual site's background/text/font and effective Accent color.

For changes, use Node.js 22.13+, `npm ci --ignore-scripts`, `npm test`, `npm run build`, and `npm run check`. Source locations: `src/core.cjs` for queue state/persistence, `src/browser.js` for page adapter/UI/locking, `src/queue.css` for styling, and `src/notice-card.js` for the reusable rounded notice card with accent/neutral actions. Keep the generated script synchronized with source and preserve GPL/source attribution.

Validate adapter changes against the current logged-in ChatGPT frontend in the user's existing Firefox and the explicitly designated test tab. If available, use the companion firefox-native-automation and background-window-capture skills. Preserve the native draft, avoid other conversations, and confirm the installed script works after reload and SPA navigation. Fixtures and console injection into one tab alone do not prove Tampermonkey is installed site-wide.

Before automatic-send testing, inspect busy state and native composer, then use minimal test messages within the authorized test conversation. Verify sent turns and retained queue state rather than treating a click as receipt. An unconfirmed send is a coded execution error, never a sent/unsent question. Inspect Console `[ChatGPT Queue][CODE]` or the JSON from Copy diagnostics; Recheck only reads the receipt and never resends. Diagnostics and `chatgpt-queue:error` event details contain state signals, not chat text or URLs. Reload automatically reconciles a stored accepted message against the actual page before continuing. Stop/Esc pauses, empty-composer Ctrl+Q resumes. A stored queue starts paused after reload; another tab holding the Web Lock manages the queue.

Read [VALIDATION.md](VALIDATION.md) for established runtime evidence and limits. Private chat URLs, screenshots and stored queue text are local evidence and are not part of the published source.

When editing click interception, require an actual native send button target. A shadow control retargets to the host, so its nearest button can be null; comparing that null with an absent send button can swallow every queue action. Keep the full installed-script regression test, in addition to isolated component tests.

Accepted running turns persist in `state.active` with their text for receipt checks; they are absent from `state.items`. Do not use an empty queue as proof that the current answer has completed. Keep reload reconciliation compatible with old states whose accepted item is still in `items`, and allow pending items to reorder around a separately running turn.

For Work, use data-talvt-turn-state on the current turn; retained Copy/Regenerate controls are insufficient during tools or approvals. Treat only complete as completion, and terminal failures as errors. Composer labels can change to Work with Codex after navigation; prefer task structure over a fixed English label. New Work conversations require their first native send to establish the real ID; ignore optimistic local-chatgpt: IDs.

For current Codex Cloud /local/<id>, locate data-codex-composer-root around the native markdown editor. Message unit keys have no role suffix: identify user bubbles and final assistant text structurally. Stop/streaming overrides retained final Copy/Rate controls. Wait for the native editor's asynchronous state update before clicking an already-enabled send button; a click too soon can submit an old empty value. Confirm a matching new user receipt before popping. Other Codex URL/layout variants remain unverified.

Keep old Chat storage keys compatible. Work/Codex add mode prefixes to queue and lock keys, and navigation must invalidate the old owner before a new attachment. Never write into another mode's composer during transitions. Synthetic shortcut events can exercise an installed userscript in the real site, but are not trusted physical-key evidence. Report these boundaries separately.
