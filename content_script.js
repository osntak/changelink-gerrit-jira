// content_script.js
// Responsibilities: extract page info from Gerrit DOM, display toast notifications.
// NO network requests are made here. No credentials are handled here.

'use strict';

// ── Shadow-DOM helpers ────────────────────────────────────────────────────────

/**
 * Recursively queries `selector` starting from `root`, piercing open shadow
 * roots (Gerrit uses Polymer/Lit which creates nested shadow DOMs).
 * Returns the first match, or null.
 *
 * @param {Document|ShadowRoot|Element} root
 * @param {string} selector
 * @returns {Element|null}
 */
function queryShadow(root, selector) {
  // Direct hit on the current root level
  const direct = root.querySelector(selector);
  if (direct) return direct;

  // Descend into any open shadow roots
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) {
      const found = queryShadow(el.shadowRoot, selector);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Like queryShadow but returns ALL matches across every shadow root.
 *
 * @param {Document|ShadowRoot|Element} root
 * @param {string} selector
 * @returns {Element[]}
 */
function queryShadowAll(root, selector) {
  const results = Array.from(root.querySelectorAll(selector));

  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) {
      results.push(...queryShadowAll(el.shadowRoot, selector));
    }
  }
  return results;
}

// ── Issue-key extraction ──────────────────────────────────────────────────────

/** Matches bare Jira issue keys (e.g. PROJ-123, PROJ-45). */
const ISSUE_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/;

/** Matches the "jira: KEY" annotation in commit messages. */
const JIRA_TAG_RE = /jira\s*:\s*([A-Z][A-Z0-9]+-\d+)/i;

/**
 * Extracts the Gerrit change subject / title.
 *
 * Strategy (in order):
 *   1. Known Gerrit element selectors, shadow-DOM-aware.
 *   2. Cleaned-up document.title as a universal fallback.
 */
function extractSubject() {
  // Selectors used across Gerrit versions (both Polymer and Lit)
  const selectors = [
    '#subject',                              // gr-change-view > #subject
    '.headerSubject',                        // some themes
    '.header-title',                         // Gerrit 3.x
    'gr-change-header .header-title',
    '[data-test-id="subject"]',
    '.change-title',
    'h1.subject',
  ];

  for (const sel of selectors) {
    const el = queryShadow(document, sel);
    const text = el?.textContent?.trim();
    if (text) return text;
  }

  // document.title fallback: strip " · Gerrit Code Review", "- Gerrit …", etc.
  return document.title
    .replace(/\s*[·•|–\-]+\s*Gerrit.*/i, '')
    .replace(/^[A-Za-z0-9]+:\s*/,          '') // strip leading Change-Id prefix
    .trim() || document.title.trim();
}

/**
 * Extracts a Jira issue key from the current Gerrit change page.
 *
 * Priority:
 *   1. "jira: KEY" annotation in commit message DOM (shadow-aware)
 *   2. Bare issue key in subject/title (e.g. [PROJ-123] Fix bug)
 *   Returns null if neither is found — caller shows an error toast.
 *
 * Rationale: commit message annotation is explicit and unambiguous.
 * Subject-based extraction comes second because titles can contain
 * non-issue bracketed tags like [OOXML] that happen to look like keys.
 */
function extractIssueKey() {
  // 1. "jira: KEY" in commit message blocks (various Gerrit versions)
  const commitSelectors = [
    '.commitMessage',
    'gr-formatted-text.commitMessage',
    '[slot="commitMessage"]',
    '.commit-message-container',
    '[data-testid="commit-message"]',
    'gr-formatted-text',   // generic: any formatted-text block
  ];

  for (const sel of commitSelectors) {
    const els = queryShadowAll(document, sel);
    for (const el of els) {
      const match = el.textContent.match(JIRA_TAG_RE);
      if (match) return match[1];
    }
  }

  // 2. Bare key in change subject / title
  const subject = extractSubject();
  const fromSubject = subject.match(ISSUE_KEY_RE);
  if (fromSubject) return fromSubject[1];

  return null;
}

// ── Toast notification ────────────────────────────────────────────────────────

const TOAST_COLORS = {
  success: '#2e7d32',
  error:   '#c62828',
  warn:    '#e65100',
  info:    '#1565c0',
};

/**
 * Shows a transient notification in the top-right corner.
 * Auto-dismisses after 4 s with a CSS fade-out.
 *
 * @param {string} message
 * @param {'success'|'error'|'warn'|'info'} [type]
 */
function showToast(message, type = 'info') {
  const existing = document.getElementById('__gjc_toast__');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = '__gjc_toast__';
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');

  Object.assign(toast.style, {
    position:     'fixed',
    top:          '20px',
    right:        '20px',
    zIndex:       '2147483647',
    background:   TOAST_COLORS[type] ?? TOAST_COLORS.info,
    color:        '#fff',
    padding:      '12px 20px',
    borderRadius: '6px',
    fontSize:     '14px',
    fontFamily:   'system-ui, -apple-system, sans-serif',
    maxWidth:     '440px',
    boxShadow:    '0 4px 16px rgba(0,0,0,0.35)',
    lineHeight:   '1.5',
    wordBreak:    'break-word',
    opacity:      '1',
    transition:   'opacity 0.3s ease',
    userSelect:   'none',
  });

  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 320);
  }, 4500);
}

// ── URL-based extraction (highly reliable) ───────────────────────────────────

/**
 * Extracts the numeric Gerrit change number from the current URL.
 * URL pattern: /c/{project}/+/{changeNum}[/...]
 * Returns empty string if the pattern does not match.
 */
function extractChangeNum() {
  const m = window.location.pathname.match(/\/c\/.+\/\+\/(\d+)/);
  return m ? m[1] : '';
}

/**
 * Extracts the Gerrit project (repository) path from the current URL.
 * URL pattern: /c/{project}/+/{changeNum}
 * e.g. "/c/platform/myapp/+/12345" → "platform/myapp"
 * Returns empty string if the pattern does not match.
 */
function extractProject() {
  const m = window.location.pathname.match(/\/c\/(.+?)\/\+\/\d+/);
  return m ? m[1] : '';
}

// ── Branch extraction ─────────────────────────────────────────────────────────

/**
 * Extracts the target branch of the Gerrit change (shadow-DOM-aware).
 * Returns an empty string if not found.
 */
function extractBranch() {
  const selectors = [
    '.branch .value',
    'gr-change-metadata .branch',
    '[data-label="Branch"] .value',
    'gr-linked-chip[href*="/q/branch"]',
    '.destBranch .value',
    '.destBranch',
  ];
  for (const sel of selectors) {
    const el = queryShadow(document, sel);
    const text = el?.textContent?.trim();
    if (text && text.length < 200) return text;
  }
  return '';
}

// ── Owner extraction ──────────────────────────────────────────────────────────

/**
 * Extracts the change owner (author) display name from the Gerrit page.
 * Returns empty string if not found.
 */
function extractOwner() {
  const selectors = [
    '.owner gr-account-label',
    'gr-change-metadata .owner gr-account-label',
    '[data-section="owner"] gr-account-label',
    'gr-account-chip.owner',
  ];
  for (const sel of selectors) {
    const el = queryShadow(document, sel);
    const text = el?.textContent?.trim();
    if (text && text.length < 200) return text;
  }
  return '';
}

// ── Commit body extraction ────────────────────────────────────────────────────

/**
 * Extracts the commit message body:
 *   - First line (title/subject) stripped.
 *   - Lines matching "jira: ..." removed (redundant in Jira comment).
 *   - Consecutive blank lines collapsed.
 * Returns empty string if there is no body or the commit message is not found.
 */
function extractCommitBody() {
  const commitSelectors = [
    '.commitMessage',
    'gr-formatted-text.commitMessage',
    '[slot="commitMessage"]',
    '.commit-message-container',
    '[data-testid="commit-message"]',
    'gr-formatted-text',
  ];

  for (const sel of commitSelectors) {
    const els = queryShadowAll(document, sel);
    for (const el of els) {
      const text = el.textContent.trim();
      if (!text) continue;

      const body = text
        .split('\n')
        .slice(1)                                          // drop first line (title)
        .filter(line => !/^\s*jira\s*:/i.test(line))      // drop jira: lines
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')                       // collapse excess blanks
        .trim();

      return body; // may be empty string — that is fine
    }
  }
  return '';
}

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'EXTRACT_INFO') {
    sendResponse({
      subject:   extractSubject(),
      issueKey:  extractIssueKey(),
      url:       window.location.href,
      branch:    extractBranch(),
      body:      extractCommitBody(),
      changeNum: extractChangeNum(),
      project:   extractProject(),
      owner:     extractOwner(),
    });
    return false; // synchronous — no need to keep channel open
  }

  if (msg.type === 'SHOW_TOAST') {
    showToast(msg.message, msg.toastType ?? 'info');
    sendResponse({ ok: true });
    return false;
  }
});
