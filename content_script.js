// content_script.js
// Responsibilities: extract Gerrit context from DOM, display toast notifications.
// No network requests and no credential handling here.

'use strict';

const MSG = self.MESSAGE_TYPES;
const FAB_ROOT_ID = 'gj-fab-root';

// -- Shadow-DOM helpers -------------------------------------------------------

function queryShadow(root, selector) {
  const direct = root.querySelector(selector);
  if (direct) return direct;

  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) {
      const found = queryShadow(el.shadowRoot, selector);
      if (found) return found;
    }
  }
  return null;
}

function queryShadowAll(root, selector) {
  const results = Array.from(root.querySelectorAll(selector));
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) {
      results.push(...queryShadowAll(el.shadowRoot, selector));
    }
  }
  return results;
}

// -- Extraction helpers -------------------------------------------------------

const ISSUE_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/;
const JIRA_TAG_RE = /jira\s*:\s*([A-Z][A-Z0-9]+-\d+)/i;
const CHANGE_ID_RE = /\bChange-Id\s*:\s*(I[a-f0-9]{40})\b/i;

function extractSubject() {
  const selectors = [
    '#subject',
    '.headerSubject',
    '.header-title',
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

  return document.title
    .replace(/\s*[·•|–\-]+\s*Gerrit.*/i, '')
    .replace(/^[A-Za-z0-9]+:\s*/, '')
    .trim() || document.title.trim();
}

function getCommitMessageText() {
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
      const text = (el.textContent || '').trim();
      if (text) return text;
    }
  }
  return '';
}

function extractIssueKey() {
  // Priority 1: subject/title
  const subject = extractSubject();
  const fromSubject = subject.match(ISSUE_KEY_RE);
  if (fromSubject) return fromSubject[1];

  // Priority 2: commit message "jira: KEY"
  const commitText = getCommitMessageText();
  const fromTag = commitText.match(JIRA_TAG_RE);
  if (fromTag) return fromTag[1].toUpperCase();

  return null;
}

function extractChangeNum() {
  const m = window.location.pathname.match(/\/c\/.+\/\+\/(\d+)/);
  return m ? m[1] : '';
}

function extractProject() {
  const m = window.location.pathname.match(/\/c\/(.+?)\/\+\/\d+/);
  return m ? m[1] : '';
}

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

function extractCommitBody() {
  const text = getCommitMessageText();
  if (!text) return '';

  return text
    .split('\n')
    .slice(1)
    .filter((line) => !/^\s*jira\s*:/i.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractChangeId() {
  const commitText = getCommitMessageText();
  const match = commitText.match(CHANGE_ID_RE);
  return match ? match[1] : '';
}

function extractContext() {
  return {
    issueKey: extractIssueKey(),
    subject: extractSubject(),
    gerritUrl: window.location.href,
    branch: extractBranch(),
    body: extractCommitBody(),
    changeNum: extractChangeNum(),
    project: extractProject(),
    owner: extractOwner(),
    changeId: extractChangeId(),
  };
}

// -- FAB ---------------------------------------------------------------------

function removeFab() {
  const existing = document.getElementById(FAB_ROOT_ID);
  if (existing) existing.remove();
}

function renderFab() {
  if (document.getElementById(FAB_ROOT_ID)) return;

  const root = document.createElement('div');
  root.id = FAB_ROOT_ID;

  Object.assign(root.style, {
    position: 'fixed',
    right: '24px',
    bottom: '24px',
    zIndex: '2147483646',
  });

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Jira';
  button.setAttribute('aria-label', 'Open Gerrit Jira popup');

  Object.assign(button.style, {
    width: '56px',
    height: '56px',
    borderRadius: '28px',
    border: 'none',
    background: '#1565c0',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
    boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
  });

  button.addEventListener('click', () => {
    showToast('툴바 아이콘 팝업에서 Jira 기능을 실행하세요.', 'info');
  });

  root.appendChild(button);
  document.body.appendChild(root);
}

function applyFabEnabled(enabled) {
  if (enabled) renderFab();
  else removeFab();
}

function initFabFromStorage() {
  chrome.storage.local.get(['fabEnabled'], ({ fabEnabled }) => {
    applyFabEnabled(fabEnabled !== false);
  });
}

// -- Toast notification --------------------------------------------------------

const TOAST_COLORS = {
  success: '#2e7d32',
  error: '#c62828',
  warn: '#e65100',
  info: '#1565c0',
};

function showToast(message, type = 'info') {
  const existing = document.getElementById('__gjc_toast__');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = '__gjc_toast__';
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');

  Object.assign(toast.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    zIndex: '2147483647',
    background: TOAST_COLORS[type] ?? TOAST_COLORS.info,
    color: '#fff',
    padding: '12px 20px',
    borderRadius: '6px',
    fontSize: '14px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    maxWidth: '440px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    lineHeight: '1.5',
    wordBreak: 'break-word',
    opacity: '1',
    transition: 'opacity 0.3s ease',
    userSelect: 'none',
  });

  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 320);
  }, 4500);
}

// -- Message listener ----------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === MSG.EXTRACT_CONTEXT || msg.type === MSG.EXTRACT_INFO) {
    sendResponse(extractContext());
    return false;
  }

  if (msg.type === MSG.SHOW_TOAST) {
    showToast(msg.message, msg.toastType || 'info');
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === MSG.FAB_ENABLE) {
    applyFabEnabled(true);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === MSG.FAB_DISABLE) {
    applyFabEnabled(false);
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

initFabFromStorage();
