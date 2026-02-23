// content_script.js
// Responsibilities: extract page info from Gerrit DOM, display toast notifications.
// NO network requests are made here. No credentials are handled here.

// ── Issue key extraction ──────────────────────────────────────────────────────

/** Matches bare Jira issue keys (e.g. PROJ-123, PROJ-45). */
const ISSUE_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/;

/** Matches the "jira: KEY" annotation in commit messages. */
const JIRA_TAG_RE = /jira\s*:\s*([A-Z][A-Z0-9]+-\d+)/i;

/**
 * Extracts the Gerrit change subject/title.
 * Tries multiple selectors for different Gerrit versions/themes,
 * then falls back to document.title (Gerrit always includes the subject there).
 */
function extractSubject() {
  // Gerrit Polymer / Lit element selectors (most to least specific)
  const selectors = [
    'gr-change-view #subject',
    '.header-title',
    'gr-change-header .header-title',
    'gr-change-header [slot="header"]',
    '.change-title',
    'h1.subject',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }

  // document.title usually contains the subject, e.g.:
  //   "I1234abc: Fix login bug · Gerrit Code Review"
  //   "Fix login bug - Gerrit"
  const title = document.title
    .replace(/\s*[·•|–\-]+\s*Gerrit.*/i, '')   // strip " · Gerrit Code Review" suffix
    .replace(/^[A-Z0-9]+:\s*/i, '')              // strip leading change-id prefix
    .trim();

  return title || document.title.trim();
}

/**
 * Extracts the Jira issue key from the current Gerrit change page.
 *
 * Priority:
 *   1. Bare issue key in subject/title (e.g. "[PROJ-123] Fix bug")
 *   2. "jira: KEY" annotation anywhere in the commit message block
 *   3. "jira: KEY" annotation anywhere in the full page text
 */
function extractIssueKey() {
  // 1. Try subject first
  const subject = extractSubject();
  const fromSubject = subject.match(ISSUE_KEY_RE);
  if (fromSubject) return fromSubject[1];

  // 2. Commit message containers (various Gerrit versions)
  const commitSelectors = [
    '.commitMessage',
    'gr-formatted-text.commitMessage',
    'gr-commit-info .commitMessage',
    '.commit-message-container',
    '[data-testid="commit-message"]',
    'gr-formatted-text',       // fallback: any formatted-text block
  ];
  for (const sel of commitSelectors) {
    const els = document.querySelectorAll(sel);
    for (const el of els) {
      const match = el.textContent.match(JIRA_TAG_RE);
      if (match) return match[1];
    }
  }

  // 3. Full-page text fallback
  const jiraMatch = document.body.innerText.match(JIRA_TAG_RE);
  if (jiraMatch) return jiraMatch[1];

  return null;
}

// ── Toast ─────────────────────────────────────────────────────────────────────

const TOAST_COLORS = {
  success: '#2e7d32',
  error:   '#c62828',
  warn:    '#e65100',
  info:    '#1565c0',
};

/**
 * Displays a transient notification in the top-right corner of the page.
 * Auto-dismisses after 4 seconds with a fade-out transition.
 */
function showToast(message, type = 'info') {
  const existing = document.getElementById('__gjc_toast__');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = '__gjc_toast__';

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
    fontFamily:   'system-ui, sans-serif',
    maxWidth:     '420px',
    boxShadow:    '0 4px 16px rgba(0,0,0,0.35)',
    lineHeight:   '1.5',
    wordBreak:    'break-word',
    opacity:      '1',
    transition:   'opacity 0.3s ease',
  });

  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 320);
  }, 4000);
}

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'EXTRACT_INFO') {
    sendResponse({
      subject:  extractSubject(),
      issueKey: extractIssueKey(),
      url:      window.location.href,
    });
    return false; // synchronous response
  }

  if (msg.type === 'SHOW_TOAST') {
    showToast(msg.message, msg.toastType ?? 'info');
    sendResponse({ ok: true });
    return false;
  }
});
