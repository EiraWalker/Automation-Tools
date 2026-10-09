/* SPDX-License-Identifier: GPL-3.0-or-later */
function archiveToMarkdown(root) {
  function inline(node) {
    if (node.nodeType === 3) return node.textContent.replace(/[\t\r\n ]+/g, ' ');
    if (node.nodeType !== 1 || node.matches('button,script,style,svg,[data-cq-archive-button],[data-conversation-role]')) return '';
    const tex = node.querySelector('annotation[encoding="application/x-tex"]');
    if (tex && node.matches('.katex,.katex-display,[data-math]')) return node.matches('.katex-display') ? `\n\n$$\n${tex.textContent}\n$$\n\n` : `$${tex.textContent}$`;
    const children = () => [...node.childNodes].map(inline).join('');
    const tag = node.tagName;
    if (tag === 'PRE') {
      const code = node.querySelector('code') || node, text = code.textContent.replace(/\n$/, '');
      const language = code.className.match(/(?:language|lang)-([\w+-]+)/)?.[1] || node.getAttribute('data-language') || '';
      const runs = text.match(/`+/g) || [], fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
      return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
    }
    if (tag === 'CODE') { const text = node.textContent, fence = '`'.repeat(Math.max(1, ...(text.match(/`+/g) || []).map(run => run.length + 1))); return `${fence}${/^ | $|`/.test(text) ? ' ' : ''}${text}${/^ | $|`/.test(text) ? ' ' : ''}${fence}`; }
    if (tag === 'BR') return '\n';
    if (tag === 'STRONG' || tag === 'B') return `**${children()}**`;
    if (tag === 'EM' || tag === 'I') return `*${children()}*`;
    if (tag === 'DEL' || tag === 'S') return `~~${children()}~~`;
    if (tag === 'A') { const text = children().trim() || node.textContent.trim() || '来源'; const href = node.getAttribute('href'); return href && /^(https?:|\/)/i.test(href) ? `[${text.replace(/\]/g, '\\]')}](${new URL(href, location.href).href.replace(/\)/g, '%29')})` : text; }
    if (tag === 'IMG') { const text = node.getAttribute('alt') || '图片', src = node.getAttribute('src'); return src && /^https?:/i.test(src) ? `[${text}](${src.replace(/\)/g, '%29')})` : `[${text}]`; }
    if (tag === 'TABLE') {
      const rows = [...node.querySelectorAll('tr')].map(row => [...row.querySelectorAll('th,td')].map(cell => inline(cell).trim().replace(/\|/g, '\\|').replace(/\n/g, '<br>')));
      if (!rows.length) return '';
      const width = Math.max(...rows.map(row => row.length)), render = row => '| ' + Array.from({ length: width }, (_, i) => row[i] || '').join(' | ') + ' |';
      return '\n\n' + [render(rows[0]), render(Array(width).fill('---')), ...rows.slice(1).map(render)].join('\n') + '\n\n';
    }
    if (tag === 'UL' || tag === 'OL') {
      const start = Number(node.getAttribute('start')) || 1;
      return '\n\n' + [...node.children].filter(child => child.tagName === 'LI').map((li, index) => {
        const marker = tag === 'OL' ? `${start + index}. ` : '- ', text = [...li.childNodes].map(inline).join('').trim();
        return marker + text.replace(/\n/g, '\n' + ' '.repeat(marker.length));
      }).join('\n') + '\n\n';
    }
    if (tag === 'BLOCKQUOTE') return '\n\n' + children().trim().split('\n').map(line => '> ' + line).join('\n') + '\n\n';
    if (/^H[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${children().trim()}\n\n`;
    if (tag === 'HR') return '\n\n---\n\n';
    if (tag === 'P' || tag === 'DIV' || tag === 'SECTION') return '\n\n' + children().trim() + '\n\n';
    return children();
  }
  // Collapse only block separators, never whitespace inside fenced code.
  const text = inline(root).trim(), lines = text.split('\n'); let fence = null, blanks = 0;
  return lines.filter(line => {
    const match = line.match(/^(`{3,}|~{3,})/);
    if (match) { if (!fence) fence = match[1]; else if (line.trim() === fence) fence = null; blanks = 0; return true; }
    if (fence) return true;
    if (!line.trim()) return ++blanks <= 2;
    blanks = 0; return true;
  }).join('\n').trim();
}
class ArchivePageAdapter {
  constructor(adapter) { this.adapter = adapter; }
  replies() { return this.adapter.messages('assistant'); }
  container(node) { return node.closest('[data-content-search-turn-key],[data-testid^="conversation-turn-"],article') || node.parentElement; }
  toolbar(node) {
    const turn = this.adapter.mode === 'codex' ? node.closest('[data-local-conversation-final-assistant="true"]') || node.querySelector('[data-local-conversation-final-assistant="true"]') || node : this.container(node);
    const candidates = [...turn.querySelectorAll('.turn-action-controls,[data-testid="copy-turn-action-button"],button[aria-label="Copy"]')];
    const control = candidates.find(candidate => candidate.matches('.turn-action-controls')) || candidates.at(-1);
    return control?.matches('.turn-action-controls') ? control : control?.parentElement;
  }
  complete(node) {
    const turn = this.container(node), replies = this.replies(), latest = node === replies.at(-1), mode = this.adapter.mode;
    if (turn.querySelector('[data-is-streaming="true"],.result-streaming')) return false;
    if (latest && firstVisible(STOP_SELECTOR)) return false;
    if (mode === 'work') return turn.querySelector('[data-talvt-turn-state]')?.getAttribute('data-talvt-turn-state') === 'complete';
    if (mode === 'codex') {
      const final = node.closest('[data-local-conversation-final-assistant="true"]') || node.querySelector('[data-local-conversation-final-assistant="true"]');
      return Boolean(final?.querySelector('button[aria-label="Rate response"]'));
    }
    return Boolean(turn.querySelector('[data-testid="copy-turn-action-button"],[data-testid="good-response-turn-action-button"],[data-testid="bad-response-turn-action-button"]') || (turn.querySelector('.turn-action-controls button[aria-label="Copy"]') && turn.querySelector('.turn-action-controls button[aria-label="Regenerate response"]')));
  }
  snapshot(node) {
    if (!this.complete(node)) throw archiveFailure('A_ANSWER_INCOMPLETE', '该回答尚未完成。');
    const users = this.adapter.messages('user'), questionNode = users.filter(user => user.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).at(-1);
    if (!questionNode) throw archiveFailure('A_QUESTION_MISSING', '无法定位这条回答对应的问题。');
    const final = node.querySelector('[data-local-conversation-final-assistant="true"]') || node;
    const content = final.querySelector('[data-markdown-text-style="assistant-message"],.markdown') || final;
    const questionContent = questionNode.querySelector('[data-user-message-bubble],[data-search-result-target]') || questionNode;
    const question = questionContent.children.length ? archiveToMarkdown(questionContent) : questionContent.textContent.trim(), answer = archiveToMarkdown(content);
    if (!question || !answer) throw archiveFailure('A_CONTENT_MISSING', '问答内容未完整加载。');
    const nativeId = node.getAttribute('data-message-id') || node.querySelector('[data-chatgpt-selection-message-id]')?.getAttribute('data-chatgpt-selection-message-id');
    const unit = node.getAttribute('data-content-search-unit-key') || node.closest('[data-content-search-unit-key]')?.getAttribute('data-content-search-unit-key');
    const turn = node.closest('[data-turn-key]')?.getAttribute('data-turn-key');
    if (!nativeId && !unit && !turn) throw archiveFailure('A_ANSWER_ID_MISSING', '无法识别这条回答的版本。');
    const answerId = nativeId || `${unit || turn}:${archiveHash(answer)}`;
    const conversation = this.adapter.conversation;
    if (!conversation) throw archiveFailure('A_CONVERSATION_MISSING', '请先打开已保存的会话。');
    return Object.freeze({ mode: this.adapter.mode, conversation, answerId, key: `${this.adapter.mode}:${conversation}:${answerId}`, url: location.origin + location.pathname, question, answer });
  }
}
if (typeof module !== 'undefined') Object.assign(module.exports, { archiveToMarkdown, ArchivePageAdapter });
