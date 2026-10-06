# Attribution

The inline queue layout (rounded message rows and numbered entries) is inspired
by **kgruiz/chatgpt-queue**. Earlier iterations also referenced its header and
pause/resume controls; those controls are absent from this version:
https://github.com/kgruiz/chatgpt-queue

Reference revision: 025682292c3c9156835467b4077afd979f6ea6c4.
Upstream license: GNU GPL v3. This distribution includes the full GPL v3 text in LICENSE.

This is an independently assembled userscript adaptation. It is not the upstream
browser extension and is not endorsed by its author or by OpenAI. The extension's
model menus, attachment handling, background process and React Query bridge are not
included. The original orange/red styling is replaced by inherited ChatGPT theme
tokens and the effective submit-button color.

The userscript and its source are distributed under GPL-3.0-or-later. All source
needed to rebuild the userscript is included. Runtime dependencies: none.

Development-only test dependency: jsdom 29.1.1 (MIT), installed separately via npm;
its code is not embedded in the userscript.

Full-width layout idea reference: https://github.com/xcanwin/KeepChatGPT
Reference revision: bdc253c (2026-07-21). Upstream is GPL-2.0.
No KeepChatGPT source code or CSS is included. The layout implementation was
written independently using semantic attributes and CSS width tokens inspected
on the actual logged-in ChatGPT page in native Firefox on 2026-10-06.

Firefox cross-realm callback/promise handling follows Mozilla's documentation:
https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Sharing_objects_with_page_scripts
https://www.tampermonkey.net/documentation.php?q=sandbox
