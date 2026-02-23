// content_script.js
// Responsibilities: extract Gerrit context from DOM, display toast notifications,
// and provide FAB quick actions. No direct network requests.

'use strict';

const MSG = self.MESSAGE_TYPES;
const FAB_ROOT_ID = 'gj-fab-root';
const ISSUE_DIALOG_ID = '__gj_issue_dialog__';

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
    if (el.shadowRoot) results.push(...queryShadowAll(el.shadowRoot, selector));
  }
  return results;
}

// -- Extraction helpers -------------------------------------------------------

const ISSUE_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/i;
const JIRA_TAG_RE = /jira\s*:\s*([A-Z][A-Z0-9]+-\d+)/i;
const CHANGE_ID_RE = /\bChange-Id\s*:\s*(I[a-f0-9]{40})\b/i;

function normalizeIssueKey(key) {
  return key ? String(key).toUpperCase() : null;
}

function extractIssueKeyFromText(text) {
  if (!text) return null;

  const jiraTag = text.match(JIRA_TAG_RE);
  if (jiraTag) return normalizeIssueKey(jiraTag[1]);

  const bare = text.match(ISSUE_KEY_RE);
  if (bare) return normalizeIssueKey(bare[1]);

  return null;
}

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
    '#commitMessage',
    '#commitMessageEditor',
    'gr-editable-content#commitMessageEditor',
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
  // 1) subject/title (preferred)
  const subject = extractSubject();
  const fromSubject = extractIssueKeyFromText(subject);
  if (fromSubject) return fromSubject;

  const fromTitle = extractIssueKeyFromText(document.title);
  if (fromTitle) return fromTitle;

  // 2) commit message (jira: KEY or bare key)
  const commitText = getCommitMessageText();
  const fromCommit = extractIssueKeyFromText(commitText);
  if (fromCommit) return fromCommit;

  // 3) fallback: page text sample (for Gerrit DOM variations)
  const pageText = (document.body?.innerText || '').slice(0, 60000);
  const fromBody = extractIssueKeyFromText(pageText);
  if (fromBody) return fromBody;

  // 4) fallback: gather text inside open shadow roots explicitly
  const shadowTextChunks = [];
  for (const el of document.querySelectorAll('*')) {
    if (el.shadowRoot) {
      const txt = (el.shadowRoot.textContent || '').trim();
      if (txt) shadowTextChunks.push(txt);
    }
  }
  if (shadowTextChunks.length > 0) {
    const fromShadowText = extractIssueKeyFromText(shadowTextChunks.join('\n'));
    if (fromShadowText) return fromShadowText;
  }

  // 5) broad scan across common Gerrit nodes inside open shadow roots
  const broadSelectors = [
    '#subject',
    '.header-title',
    '.headerSubject',
    '.change-title',
    'h1',
    'h2',
    '#commitMessage',
    '#commitMessageEditor',
    '.commitMessage',
    'gr-editable-content',
    'gr-formatted-text',
    'gr-change-header',
    'gr-change-view',
  ];

  for (const sel of broadSelectors) {
    const els = queryShadowAll(document, sel);
    for (const el of els) {
      const text = (el.textContent || '').trim();
      const key = extractIssueKeyFromText(text);
      if (key) return key;
    }
  }

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

function hasIssueKey(context) {
  return !!context?.issueKey;
}

/**
 * Gerrit page content can be rendered asynchronously (including shadow DOM updates).
 * Retry briefly so popup/FAB actions do not fail just because extraction happened too early.
 */
function extractContextWithRetry(timeoutMs = 1800) {
  const first = extractContext();
  if (hasIssueKey(first)) return Promise.resolve(first);

  return new Promise((resolve) => {
    const startedAt = Date.now();
    let done = false;

    const finish = (ctx) => {
      if (done) return;
      done = true;
      clearInterval(pollTimer);
      clearTimeout(deadlineTimer);
      observer.disconnect();
      resolve(ctx);
    };

    const checkNow = () => {
      const ctx = extractContext();
      if (hasIssueKey(ctx)) finish(ctx);
    };

    const observer = new MutationObserver(() => {
      checkNow();
    });

    if (document.documentElement) {
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    }

    const pollTimer = setInterval(() => {
      checkNow();
      if (Date.now() - startedAt >= timeoutMs) {
        finish(extractContext());
      }
    }, 120);

    const deadlineTimer = setTimeout(() => {
      finish(extractContext());
    }, timeoutMs);
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

// -- Runtime messaging ---------------------------------------------------------

function sendRuntimeMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

// -- FAB + Quick actions -------------------------------------------------------

let fabDocClickHandler = null;

function closeFabMenu() {
  const menu = document.getElementById('gj-fab-menu');
  if (!menu) return;
  menu.style.opacity = '0';
  menu.style.transform = 'translateY(8px)';
  menu.style.pointerEvents = 'none';
}

function openFabMenu() {
  const menu = document.getElementById('gj-fab-menu');
  if (!menu) return;
  menu.style.opacity = '1';
  menu.style.transform = 'translateY(0)';
  menu.style.pointerEvents = 'auto';
}

function isFabMenuOpen() {
  const menu = document.getElementById('gj-fab-menu');
  return !!menu && menu.style.opacity === '1';
}

function ensureIssueDialog() {
  let dialog = document.getElementById(ISSUE_DIALOG_ID);
  if (dialog) return dialog;

  dialog = document.createElement('div');
  dialog.id = ISSUE_DIALOG_ID;

  Object.assign(dialog.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(0,0,0,0.35)',
    zIndex: '2147483645',
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
  });

  dialog.innerHTML = `
    <div id="gj-issue-dialog-card" style="width: min(440px, calc(100vw - 40px)); background:#fff; border-radius:10px; border:1px solid #d9e0ea; box-shadow:0 12px 28px rgba(0,0,0,0.28); overflow:hidden; font-family:system-ui,-apple-system,sans-serif;">
      <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:#f4f8ff; border-bottom:1px solid #d9e0ea;">
        <strong style="font-size:13px; color:#1e2530;">Jira Issue</strong>
        <button id="gj-issue-dialog-close" type="button" style="border:1px solid #d9e0ea; background:#fff; border-radius:6px; width:28px; height:28px; cursor:pointer;">×</button>
      </div>
      <div style="padding:12px; font-size:12px; color:#2b3647; line-height:1.55;">
        <div id="gj-issue-dialog-key" style="font-weight:700; color:#1565c0; margin-bottom:8px;"></div>
        <div id="gj-issue-dialog-summary" style="font-weight:700; margin-bottom:8px;"></div>
        <div id="gj-issue-dialog-status" style="margin-bottom:4px;"></div>
        <div id="gj-issue-dialog-assignee"></div>
      </div>
    </div>
  `;

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.style.display = 'none';
  });

  document.body.appendChild(dialog);

  const closeBtn = document.getElementById('gj-issue-dialog-close');
  closeBtn?.addEventListener('click', () => {
    dialog.style.display = 'none';
  });

  return dialog;
}

function showIssueDialog(issueKey, issue) {
  const dialog = ensureIssueDialog();
  const keyEl = document.getElementById('gj-issue-dialog-key');
  const summaryEl = document.getElementById('gj-issue-dialog-summary');
  const statusEl = document.getElementById('gj-issue-dialog-status');
  const assigneeEl = document.getElementById('gj-issue-dialog-assignee');

  if (keyEl) keyEl.textContent = issueKey;
  if (summaryEl) summaryEl.textContent = issue.summary || '(제목 없음)';
  if (statusEl) statusEl.textContent = `Status: ${issue.status || '-'}`;
  if (assigneeEl) assigneeEl.textContent = `Assignee: ${issue.assignee || 'Unassigned'}`;

  dialog.style.display = 'flex';
}

async function handleFabIssueLookup() {
  const ctx = extractContext();
  if (!ctx.issueKey) {
    showToast('PROJ-123 같은 이슈키가 필요합니다. 제목 또는 jira: KEY를 확인하세요.', 'warn');
    return;
  }

  showToast(`이슈 조회 중: ${ctx.issueKey}`, 'info');

  try {
    const resp = await sendRuntimeMessage({
      type: MSG.POPUP_GET_ISSUE,
      issueKey: ctx.issueKey,
    });

    if (!resp?.ok) {
      showToast(resp?.message || '이슈 조회에 실패했습니다.', 'error');
      return;
    }

    showIssueDialog(ctx.issueKey, resp.issue);
    showToast(`이슈 조회 완료: ${ctx.issueKey}`, 'success');
  } catch {
    showToast('요청 중 오류가 발생했습니다.', 'error');
  }
}

async function handleFabAddRemoteLink() {
  showToast('웹링크 추가 중...', 'info');
  try {
    const resp = await sendRuntimeMessage({ type: MSG.POPUP_ADD_REMOTE_LINK });
    if (!resp?.ok) {
      showToast(resp?.message || '웹링크 추가에 실패했습니다.', 'error');
      return;
    }
    showToast(`웹링크 추가 완료: ${resp.issueKey || ''}`.trim(), 'success');
  } catch {
    showToast('요청 중 오류가 발생했습니다.', 'error');
  }
}

async function handleFabAddComment() {
  showToast('코멘트 생성 중...', 'info');
  try {
    const resp = await sendRuntimeMessage({ type: MSG.POPUP_ADD_COMMENT });
    if (!resp?.ok) {
      showToast(resp?.message || '코멘트 생성에 실패했습니다.', 'error');
      return;
    }
    showToast(`코멘트 생성 완료: ${resp.issueKey || ''}`.trim(), 'success');
  } catch {
    showToast('요청 중 오류가 발생했습니다.', 'error');
  }
}

function buildFabActionButton({ id, icon, title, onClick }) {
  const btn = document.createElement('button');
  btn.id = id;
  btn.type = 'button';
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.textContent = icon;

  Object.assign(btn.style, {
    width: '42px',
    height: '42px',
    borderRadius: '21px',
    border: 'none',
    background: '#fff',
    color: '#1d2b3f',
    fontSize: '19px',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
  });

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    closeFabMenu();
    await onClick();
  });

  return btn;
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
    display: 'grid',
    gap: '10px',
    justifyItems: 'end',
  });

  const menu = document.createElement('div');
  menu.id = 'gj-fab-menu';
  Object.assign(menu.style, {
    display: 'grid',
    gap: '8px',
    opacity: '0',
    transform: 'translateY(8px)',
    pointerEvents: 'none',
    transition: 'all 0.16s ease',
  });

  menu.appendChild(buildFabActionButton({
    id: 'gj-fab-issue',
    icon: '🔍',
    title: '이슈 조회',
    onClick: handleFabIssueLookup,
  }));

  menu.appendChild(buildFabActionButton({
    id: 'gj-fab-link',
    icon: '🔗',
    title: '웹링크 추가',
    onClick: handleFabAddRemoteLink,
  }));

  menu.appendChild(buildFabActionButton({
    id: 'gj-fab-comment',
    icon: '💬',
    title: '코멘트 생성',
    onClick: handleFabAddComment,
  }));

  const mainButton = document.createElement('button');
  mainButton.id = 'gj-fab-main';
  mainButton.type = 'button';
  mainButton.setAttribute('aria-label', 'Toggle Jira quick actions');
  mainButton.textContent = 'Jira';

  Object.assign(mainButton.style, {
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

  mainButton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isFabMenuOpen()) closeFabMenu();
    else openFabMenu();
  });

  root.appendChild(menu);
  root.appendChild(mainButton);
  document.body.appendChild(root);

  fabDocClickHandler = (e) => {
    if (!root.contains(e.target)) closeFabMenu();
  };
  document.addEventListener('click', fabDocClickHandler, true);
}

function removeFab() {
  closeFabMenu();
  const existing = document.getElementById(FAB_ROOT_ID);
  if (existing) existing.remove();

  if (fabDocClickHandler) {
    document.removeEventListener('click', fabDocClickHandler, true);
    fabDocClickHandler = null;
  }
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

// -- Message listener ----------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === MSG.EXTRACT_CONTEXT || msg.type === MSG.EXTRACT_INFO) {
    extractContextWithRetry().then(sendResponse);
    return true;
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
