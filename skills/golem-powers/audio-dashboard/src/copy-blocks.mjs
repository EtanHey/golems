import { parse } from 'parse5';

const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

function httpHref(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url.href : '';
  } catch { return ''; }
}

function renderProse(text, { linksOnly = false } = {}) {
  const links = /\[([^\]\n]+)\]\((https?:\/\/(?:[^\s()<>"']|\([^\s()<>"']*\))+)\)|(https?:\/\/[^\s<>"']+)/gi;
  let html = '', offset = 0;
  const kept = [];
  for (const match of text.matchAll(links)) {
    let raw = match[2] || match[3];
    if (match[3]) {
      while (/[.,;:!?`*_]$/.test(raw) || [')', ']'].some((close, i) => raw.endsWith(close)
        && raw.split(close).length > raw.split(['(', '['][i]).length)) raw = raw.slice(0, -1);
    }
    const href = httpHref(raw);
    if (href) kept.push(`<a href="${escapeHtml(href)}" rel="noopener noreferrer">${escapeHtml(match[1] || raw)}</a>`);
    html += escapeHtml(text.slice(offset, match.index));
    html += href ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${escapeHtml(match[1] || raw)}</a>` : escapeHtml(match[0]);
    if (match[3] && href) html += escapeHtml(match[3].slice(raw.length));
    offset = match.index + match[0].length;
  }
  return linksOnly ? kept.join(' ') : html + escapeHtml(text.slice(offset));
}

export const renderInlineProse = text => renderProse(String(text ?? '').replace(/\s+/g, ' ').trim());

// Only HTTP(S) prose becomes links; fenced payloads remain escaped literal text.
// `{ prose: false }` keeps the fenced copy blocks and the prose's links, never the prose itself
// (the decision-flow answer sheet, which never repeats the narration).
export function renderCardBody(text = '', { prose: withProse = true } = {}) {
  const source = String(text ?? '').replace(/\r\n?/g, '\n');
  const fence = /^```([^\n`]*)\n([\s\S]*?)\n```[ \t]*(?=\n|$)/gm;
  let html = '', offset = 0;
  const prose = text => text.split(/\n+/).filter(line => line.trim())
    .map(line => withProse ? `<p>${renderProse(line)}</p>` : renderProse(line, { linksOnly: true }))
    .filter(Boolean).map(line => withProse ? line : `<p class="df-body-links">${line}</p>`).join('');
  for (const match of source.matchAll(fence)) {
    html += prose(source.slice(offset, match.index));
    const isDiff = match[1].trim() === 'diff';
    const raw = match[2];
    const code = isDiff ? raw.split('\n').map(line => {
      const kind = line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed'
        : line.startsWith('@@') ? 'hunk' : 'context';
      return `<span class="ad-diff-${kind}">${escapeHtml(line)}</span>`;
    }).join('\n') : escapeHtml(raw.replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, ''));
    html += `<div class="ad-copy-block"><pre><code>${code}</code></pre><button type="button" data-copy-block aria-label="Copy code block">Copy</button><span role="status" aria-live="polite"></span></div>`;
    offset = match.index + match[0].length;
  }
  return html + prose(source.slice(offset));
}

function copyRuntime() {
  document.querySelectorAll('[data-copy-block]').forEach(button => {
    const block = button.closest('.ad-copy-block'), status = block.querySelector('[role="status"]');
    let timer;
    button.addEventListener('click', async () => {
      const text = block.querySelector('pre code').textContent;
      const fallback = () => {
        const focus = document.activeElement, selection = window.getSelection();
        const ranges = Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange());
        const area = document.createElement('textarea');
        area.value = text;
        area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
        document.body.appendChild(area);
        try {
          area.focus({ preventScroll: true }); area.select();
          if (!document.execCommand('copy')) throw new Error('Copy unavailable');
        } finally {
          area.remove(); focus?.focus({ preventScroll: true });
          selection.removeAllRanges(); ranges.forEach(range => selection.addRange(range));
        }
      };
      clearTimeout(timer);
      try {
        try {
          if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
          await navigator.clipboard.writeText(text);
        } catch { fallback(); }
        button.textContent = 'Copied'; status.textContent = 'Copied';
      } catch { button.textContent = 'Copy failed'; status.textContent = 'Copy failed. Select the code and copy it.'; }
      timer = setTimeout(() => { button.textContent = 'Copy'; status.textContent = ''; }, 1500);
    });
  });
}

export const COPY_BLOCK_ASSETS = `<style>
.ad-copy-block{position:relative;margin:12px 0;color:#edf2fa;background:#111b2d;border:1px solid #64748b;border-radius:8px;min-width:0}
.ad-copy-block pre{margin:0;padding:52px 16px 16px;overflow:auto;white-space:pre;text-align:left}
.ad-copy-block code{font:13px/1.6 ui-monospace,monospace;color:inherit;background:transparent}
/* Opaque dark well stays fixed in light/dark hosts. All four text pairs exceed AA. */
.ad-copy-block .ad-diff-added{color:#96e6a1;background:#163322}
.ad-copy-block .ad-diff-removed{color:#ffb4b4;background:#3d2029}
.ad-copy-block .ad-diff-hunk{color:#a8d4ff}
.ad-copy-block .ad-diff-context{color:#aab7cb}
.ad-copy-block button{position:absolute;top:8px;right:8px;padding:6px 12px;min-height:32px;color:inherit;background:transparent;border:1px solid currentColor;border-radius:5px;cursor:pointer}
.ad-copy-block button:hover{background:#64748b33}.ad-copy-block button:focus-visible{outline:3px solid #50b7ff;outline-offset:3px}
.ad-copy-block [role=status]{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
</style><script data-copy-runtime>(${copyRuntime.toString()})();</script>`;

// Command names are case-sensitive. Known subcommands/flags separate instructions from status prose.
const COMMAND_FORMS = [
  /^git\s+(?:-\S+|(?:status|diff|log|show|add|commit|push|pull|fetch|switch|checkout|branch|restore|reset|merge|rebase|clone|init|worktree|remote|config|stash|tag|clean|rev-parse|ls-files|grep)\b)/,
  /^(?:npm|pnpm|yarn|bun|pip3?|pipx)\s+(?:-\S+|(?:install|i|ci|run|exec|test|start|dev|build|add|remove|update|upgrade|init|publish|list|show|uninstall|x)\b)/,
  /^gh\s+(?:-\S+|(?:auth|pr|issue|repo|run|workflow|release|api|extension)\b)/,
  /^brew\s+(?:-\S+|(?:install|upgrade|update|uninstall|reinstall|services|info|list|search|doctor)\b)/,
  /^(?:node|python3?|bash|zsh|sh)\s+(?:-\S+|\S+\.(?:js|mjs|cjs|ts|py|sh)(?=[\s`]|$))/,
  /^curl\s+(?:-\S+|["']?https?:\/\/|[\w-]+\.[a-z]{2,})/,
  /^wget\s+(?:-\S+|["']?https?:\/\/)/,
  /^(?:bash|sh|zsh)\s+<\(\s*(?:curl|wget)\b/,
  /^(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\s+(?:-\S+|["']?https?:\/\/)/i,
  /^(?:cd|ssh|npx|uvx|sudo)\s+(?!(?:is|are|was|were|the)\b)\S+/,
  /^uv\s+(?:-\S+|(?:run|sync|add|remove|pip|tool|venv|python|lock|init|build|publish)\b)/,
  /^make\s+(?:-\S+|(?:install|test|build|clean|all|check|dev|run|lint)\b)/,
  /^docker\s+(?:-\S+|(?:compose|run|build|pull|push|exec|ps|images|logs|start|stop|restart|rm|system)\b)/,
  /^(?:claude|codex)\s+(?:-\S+|(?:mcp|login|logout|auth|exec|review|resume|doctor|update)\b)/,
  /^op\s+(?:-\S+|(?:signin|signout|read|run|item|vault|account|inject|whoami)\b)/,
  /^export\s+[A-Za-z_][A-Za-z0-9_]*=/,
  /^open\s+(?:-\S+|["']?(?:\.\.?\/|~\/|\/))/,
  /^defaults\s+(?:read|write|delete|import|export|find)\b/,
  /^launchctl\s+(?:load|unload|bootstrap|bootout|print|kickstart|enable|disable|list)\b/,
  /^cargo\s+(?:-\S+|(?:build|test|run|check|clippy|fmt|install|update|clean|publish)\b)/,
];
const LOCATION = /(?:^|[\s`"'(])(?:~\/[^\s]+|\/(?!\/)[\w.-]+(?:\/[^\s]*|(?=\s|$)))/i;
const RELATIVE_PATH = /(?:^|[\s`"'(])\.\.?\/[^\s]+/;
const BARE_FILE = /(?:^|[\s`"'(])([A-Za-z_][\w.-]*(?:\/[A-Za-z_][\w.-]*)+\.(?:html|md|json|mjs|js|ts|sh|py|yml|yaml|toml|txt|env|plist|log))(?=$|[\s`"'),;:.])/g;
function commandLike(line) {
  if (/^\s*open\s+["']?https?:\/\//.test(line) || /\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/.test(line)
    || /[<$]\(\s*(?:curl|wget)\b|\b(?:irm|iwr|Invoke-WebRequest|Invoke-RestMethod)\s+["']?https?:\/\/|\|\s*(?:iex|Invoke-Expression)\b/i.test(line)) return true;
  const start = line.replace(/^\s*(?:[-*]\s+|\d+[.)]\s+)?/, '');
  if (/^\$\s+\S/.test(start)) return true;
  const candidates = [start, ...[...line.matchAll(/(?=(?:`|\b(?:run|execute)\s+|:\s+)([^\n]+))/gi)].map(match => match[1])];
  return candidates.some(candidate => COMMAND_FORMS.some(pattern => pattern.test(candidate)));
}
function pathLike(line) {
  line = line.replace(/https?:\/\/[^\s]+/gi, '');
  return LOCATION.test(line) || RELATIVE_PATH.test(line) || [...line.matchAll(BARE_FILE)]
    .some(match => /^[a-z_]/.test(match[1]) || match[1].split('/').length >= 3);
}
const BLOCK = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'dt', 'dd', 'pre', 'br', 'label']);
export const COPY_BLOCK_RUNBOOK = 'Put terminal commands and literal text or file paths to paste in a fenced code block in the card body. Keep a multi-line sequence in one fence. URLs remain clickable links, never copy blocks. No bypass.';

// `decisions` (decision-flow): each body is also checked as fully rendered prose, because the answer
// sheet no longer shows body prose; an unfenced command there must still fail, never just disappear.
export function analyzeCopyBlocks(html, { decisions = [] } = {}) {
  const violations = [];
  const attr = (node, name) => node?.attrs?.find(a => a.name === name)?.value;
  const hasClass = (node, name) => (attr(node, 'class') || '').split(/\s+/).includes(name);
  const children = node => node.childNodes || [];
  const contains = (node, predicate) => predicate(node) || children(node).some(child => contains(child, predicate));
  const text = node => {
    if (['script', 'style', 'textarea', 'audio'].includes(node.tagName) || hasClass(node, 'df-teleprompter') || hasClass(node, 'tp')) return '';
    const block = node.parentNode;
    if (node.tagName === 'pre' && hasClass(block, 'ad-copy-block') && children(node).some(n => n.tagName === 'code')
      && children(block).some(n => n.tagName === 'button' && attr(n, 'data-copy-block') !== undefined && attr(n, 'type') === 'button')
      && contains(block, n => attr(n, 'role') === 'status')) return '\n';
    if (node.tagName === 'a' && httpHref(attr(node, 'href'))) {
      const label = children(node).map(text).join('').trim(), href = httpHref(attr(node, 'href'));
      return httpHref(label) === href ? href : ' link ';
    }
    if (node.nodeName === '#text') return node.value;
    const value = children(node).map(text).join('');
    return BLOCK.has(node.tagName) ? `\n${value}\n` : value;
  };
  const walk = node => {
    if (hasClass(node, 'df-card') || hasClass(node, 'dbx-card') || hasClass(node, 'df-top')) {
      for (const line of text(node).split('\n').filter(line => commandLike(line) || pathLike(line))) {
        violations.push({ segment: attr(node, 'data-decision') || 'card', metric: 'COPY_BLOCK_REQUIRED', value: 1, threshold: 0,
          evidence: `Instruction outside a copy block (text withheld for portable receipts, ${line.trim().length} characters).` });
      }
    } else children(node).forEach(walk);
  };
  walk(parse(String(html)));
  for (const decision of Array.isArray(decisions) ? decisions : []) {
    if (typeof decision?.body !== 'string' || !decision.body.trim()) continue;
    walk(parse(`<article class="df-card" data-decision="${escapeHtml(decision.id ?? 'card')}">${renderCardBody(decision.body)}</article>`));
  }
  return { verdict: violations.length ? 'REJECTED' : 'PASS', violations };
}
