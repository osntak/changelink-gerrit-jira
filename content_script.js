// content_script.js
// Responsibilities: extract Gerrit context from DOM, display toast notifications,
// and provide FAB quick actions. No direct network requests.

'use strict';

const MSG = self.MESSAGE_TYPES;
const FAB_ROOT_ID = 'gj-fab-root';
const ISSUE_DIALOG_ID = '__gj_issue_dialog__';
const FAB_SCHEMA_VERSION = '2';
const NETWORK_HOOK_SCRIPT_ID = '__gj_network_hook__';
const NETWORK_CONTEXT_EVENT_TYPE = 'GJ_NETWORK_CONTEXT';

let networkContextCache = {
  issueKey: null,
  subject: '',
  branch: '',
  body: '',
  changeNum: '',
  project: '',
  owner: '',
  changeId: '',
  submittedAt: '',
};

const JIRA_BASE = 'https://yourcompany.atlassian.net';
let detailFetchInFlight = null;

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
const JIRA_BROWSE_RE = /\/browse\/([A-Z][A-Z0-9]+-\d+)\b/i;

function normalizeIssueKey(key) {
  return key ? String(key).toUpperCase() : null;
}

function mergeNetworkContext(partial) {
  networkContextCache = {
    ...networkContextCache,
    ...partial,
  };
}

function parseGerritJson(raw) {
  if (!raw) return null;
  const stripped = String(raw).replace(/^\)\]\}'\s*\n?/, '').trim();
  if (!stripped) return null;
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

function buildGerritDetailCandidates() {
  const changeNum = extractChangeNum();
  const project = extractProject();
  if (!changeNum) return [];

  const list = [];
  if (project) {
    const id = encodeURIComponent(`${project}~${changeNum}`);
    list.push(`/a/changes/${id}/detail?o=CURRENT_REVISION&o=CURRENT_COMMIT`);
    list.push(`/changes/${id}/detail?o=CURRENT_REVISION&o=CURRENT_COMMIT`);
  }

  const numeric = encodeURIComponent(changeNum);
  list.push(`/a/changes/${numeric}/detail?o=CURRENT_REVISION&o=CURRENT_COMMIT`);
  list.push(`/changes/${numeric}/detail?o=CURRENT_REVISION&o=CURRENT_COMMIT`);
  return list;
}

async function fetchGerritDetailContext() {
  if (detailFetchInFlight) return detailFetchInFlight;

  detailFetchInFlight = (async () => {
    const candidates = buildGerritDetailCandidates();
    for (const path of candidates) {
      try {
        const resp = await fetch(path, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!resp.ok) continue;

        const text = await resp.text();
        const payload = parseGerritJson(text);
        const derived = deriveContextFromPayload(payload);
        if (!derived) continue;

        mergeNetworkContext(derived);
        return derived;
      } catch {
        // Try next candidate endpoint.
      }
    }
    return null;
  })();

  try {
    return await detailFetchInFlight;
  } finally {
    detailFetchInFlight = null;
  }
}

function deriveContextFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const subject = String(payload.subject || '').trim();
  const branch = String(payload.branch || '').trim();
  const project = String(payload.project || '').trim();
  const owner = String(payload?.owner?.name || payload?.owner?.username || '').trim();
  const changeNum = String(payload?._number || '').trim();
  const submittedAt = String(payload.submitted || payload.updated || '').trim();

  const revisions = payload.revisions || {};
  const currentRevisionKey = payload.current_revision;
  const currentRevision = currentRevisionKey ? revisions[currentRevisionKey] : null;
  const commitMessage = String(currentRevision?.commit?.message || '').trim();

  const payloadChangeId = String(payload.change_id || '').trim();
  const changeIdMatch = commitMessage.match(/\bChange-Id\s*:\s*(I[a-f0-9]{40})\b/i);
  const changeId = payloadChangeId || (changeIdMatch ? changeIdMatch[1] : '');

  const body = commitMessage
    ? commitMessage
      .split('\n')
      .slice(1)
      .filter((line) => !/^\s*jira\s*:/i.test(line))
      .filter((line) => !/^\s*change-id\s*:/i.test(line))
      .filter((line) => !/^\s*cherry[- ]picked\s+from\b/i.test(line))
      .filter((line) => !/^\s*cherry[- ]picked[- ]from\s*:/i.test(line))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    : '';

  const issueKey =
    extractIssueKeyFromCommitPreferred(commitMessage) ||
    extractIssueKeyFromText(subject) ||
    null;

  return {
    issueKey,
    subject,
    branch,
    body,
    changeNum,
    project,
    owner,
    changeId,
    submittedAt,
  };
}

function extractIssueKeyFromText(text) {
  if (!text) return null;

  const jiraTag = text.match(JIRA_TAG_RE);
  if (jiraTag) return normalizeIssueKey(jiraTag[1]);

  const bare = text.match(ISSUE_KEY_RE);
  if (bare) return normalizeIssueKey(bare[1]);

  return null;
}

function extractIssueKeyFromCommitPreferred(commitText) {
  if (!commitText) return null;

  const tagMatch = commitText.match(JIRA_TAG_RE);
  if (tagMatch) return normalizeIssueKey(tagMatch[1]);

  const bareMatch = commitText.match(ISSUE_KEY_RE);
  if (bareMatch) return normalizeIssueKey(bareMatch[1]);

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
    'pre.plaintext',
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
  // 1) commit message first (JIRA: KEY is most reliable)
  const commitText = getCommitMessageText();
  const fromCommit = extractIssueKeyFromCommitPreferred(commitText);
  if (fromCommit) return fromCommit;

  // 2) Gerrit detail payload cache
  if (networkContextCache.issueKey) return networkContextCache.issueKey;

  // 3) direct extraction from Jira browse links in rendered commit message
  for (const sel of ['a[href*="atlassian.net/browse/"]', 'a[href*="/browse/"]']) {
    const links = queryShadowAll(document, sel);
    for (const link of links) {
      const href = String(link.getAttribute('href') || '');
      const hrefMatch = href.match(JIRA_BROWSE_RE);
      if (hrefMatch) return normalizeIssueKey(hrefMatch[1]);

      const text = (link.textContent || '').trim();
      const textMatch = text.match(ISSUE_KEY_RE);
      if (textMatch) return normalizeIssueKey(textMatch[1]);
    }
  }

  // 4) content-first fallback
  const pageText = (document.body?.innerText || '').slice(0, 60000);
  const fromBody = extractIssueKeyFromText(pageText);
  if (fromBody) return fromBody;

  // 5) fallback: gather text inside open shadow roots explicitly
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

  // 6) broad scan across common Gerrit nodes inside open shadow roots
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

  // 7) last resort: subject/title fallback
  const subject = extractSubject();
  const fromSubject = extractIssueKeyFromText(subject);
  if (fromSubject) return fromSubject;

  const fromTitle = extractIssueKeyFromText(document.title);
  if (fromTitle) return fromTitle;

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
  // Priority 0: parse explicit branch query parameter from Gerrit links
  // e.g. /q/project:OfficeFilter+branch:develop+status:merged
  const branchLinks = queryShadowAll(document, 'a[href*="branch:"]');
  for (const link of branchLinks) {
    const href = String(link.getAttribute('href') || '');
    const m = href.match(/(?:^|[+&])branch:([^+&\s]+)/i);
    if (m && m[1]) {
      const fromHref = decodeURIComponent(m[1]).trim();
      if (fromHref && fromHref.length < 200) return fromHref;
    }

    const text = (link.textContent || '').trim();
    if (text && text.length < 200) return text;
  }

  const selectors = [
    '.branch .value',
    '#branch',
    'gr-change-metadata .branch',
    'gr-change-metadata .value a[href*="/q/branch:"]',
    'gr-change-metadata .value a[href*="branch:"]',
    '[data-label="Branch"] .value',
    '[data-label="branch"] .value',
    '[data-test-id="branch"]',
    'gr-linked-chip[href*="/q/branch"]',
    'a[href*="/q/branch:"]',
    'a[href*="branch:"]',
    '.destBranch .value',
    '.destBranch',
  ];

  for (const sel of selectors) {
    const el = queryShadow(document, sel);
    const text = el?.textContent?.trim();
    if (text && text.length < 200) return text;
  }

  // Fallback: metadata layout with "Branch" label and neighboring value.
  const labels = queryShadowAll(document, 'label, .label, dt, th, span, div');
  for (const labelEl of labels) {
    const labelText = (labelEl.textContent || '').trim().toLowerCase();
    if (labelText !== 'branch') continue;

    const row = labelEl.closest('tr, li, dl, .metadata, .section, .row, div');
    if (!row) continue;

    const valueCandidates = row.querySelectorAll('.value, dd, td, a[href*="/q/branch:"], span, div');
    for (const candidate of valueCandidates) {
      const value = (candidate.textContent || '').trim();
      if (!value || value.toLowerCase() === 'branch') continue;
      if (value.length < 200) return value;
    }
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
    .filter((line) => !/^\s*change-id\s*:/i.test(line))
    .filter((line) => !/^\s*cherry[- ]picked\s+from\b/i.test(line))
    .filter((line) => !/^\s*cherry[- ]picked[- ]from\s*:/i.test(line))
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
    issueKey: networkContextCache.issueKey || extractIssueKey(),
    subject: networkContextCache.subject || extractSubject(),
    gerritUrl: window.location.href,
    branch: networkContextCache.branch || extractBranch(),
    body: networkContextCache.body || extractCommitBody(),
    changeNum: networkContextCache.changeNum || extractChangeNum(),
    project: networkContextCache.project || extractProject(),
    owner: networkContextCache.owner || extractOwner(),
    changeId: networkContextCache.changeId || extractChangeId(),
    submittedAt: networkContextCache.submittedAt,
  };
}

function initNetworkContextBridge() {
  // Disabled: inline/page script injection is blocked by Gerrit CSP.
  // Keep this as a no-op to avoid runtime CSP errors.
  return;
}

function hasIssueKey(context) {
  return !!context?.issueKey;
}

/**
 * Gerrit page content can be rendered asynchronously (including shadow DOM updates).
 * Retry briefly so popup/FAB actions do not fail just because extraction happened too early.
 */
function extractContextWithRetry(timeoutMs = 1800) {
  // Kick off detail API enrichment immediately and prefer it over DOM fallback.
  const detailPromise = fetchGerritDetailContext();
  const first = extractContext();
  if (hasIssueKey(first) && first.branch && first.submittedAt) {
    return Promise.resolve(first);
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    let done = false;
    let detailFetchDone = false;

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
      const readyBase = hasIssueKey(ctx) && ctx.branch;
      if (!readyBase) return;
      // `submittedAt` is populated from Gerrit detail payload cache.
      // Wait until detail fetch has completed once so we don't return too early.
      if (ctx.submittedAt || detailFetchDone) finish(ctx);
    };

    // DOM만으로 충분치 않은 경우 Gerrit detail API를 한번 조회해 보강.
    detailPromise.finally(() => {
      detailFetchDone = true;
      checkNow();
    });

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

function setFabMenuItemsState(menu, isOpen) {
  const items = Array.from(menu.children);
  items.forEach((item, idx) => {
    item.style.opacity = isOpen ? '1' : '0';
    item.style.transform = isOpen ? 'translateY(0) scale(1)' : 'translateY(6px) scale(0.94)';
    item.style.transitionDelay = isOpen ? `${idx * 22}ms` : '0ms';
  });
}

function closeFabMenu() {
  const menu = document.getElementById('gj-fab-menu');
  if (!menu) return;
  menu.style.opacity = '0';
  menu.style.transform = 'translateY(6px)';
  menu.style.pointerEvents = 'none';
  setFabMenuItemsState(menu, false);

  const mainButton = document.getElementById('gj-fab-main');
  if (mainButton) {
    mainButton.style.transform = 'translateY(0) scale(1)';
    mainButton.style.boxShadow = '0 6px 18px rgba(0,0,0,0.35)';
  }
}

function openFabMenu() {
  const menu = document.getElementById('gj-fab-menu');
  if (!menu) return;
  menu.style.opacity = '1';
  menu.style.transform = 'translateY(0)';
  menu.style.pointerEvents = 'auto';
  setFabMenuItemsState(menu, true);

  const mainButton = document.getElementById('gj-fab-main');
  if (mainButton) {
    mainButton.style.transform = 'translateY(-1px) scale(1.03)';
    mainButton.style.boxShadow = '0 10px 24px rgba(0,0,0,0.32)';
  }
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

function openJiraIssueInNewTab() {
  const ctx = extractContext();
  const key = normalizeIssueKey(ctx.issueKey);
  if (!key) {
    showToast('이슈키를 찾을 수 없습니다.', 'warn');
    return;
  }

  window.open(`${JIRA_BASE}/browse/${encodeURIComponent(key)}`, '_blank', 'noopener,noreferrer');
}

function buildFabActionButton({ id, icon, title, onClick, iconSvg }) {
  const btn = document.createElement('button');
  btn.id = id;
  btn.type = 'button';
  btn.title = title;
  btn.setAttribute('aria-label', title);
  if (iconSvg) {
    btn.innerHTML = iconSvg;
  } else {
    btn.textContent = icon;
  }

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
    opacity: '0',
    transform: 'translateY(6px) scale(0.94)',
    transition: 'opacity 0.16s ease, transform 0.18s ease',
  });

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    closeFabMenu();
    await onClick();
  });

  return btn;
}

function renderFab() {
  const existing = document.getElementById(FAB_ROOT_ID);
  if (existing) {
    const sameVersion = existing.getAttribute('data-fab-version') === FAB_SCHEMA_VERSION;
    const hasOpenIssueButton = !!existing.querySelector('#gj-fab-open-issue');
    if (sameVersion && hasOpenIssueButton) return;
    existing.remove();
  }

  const root = document.createElement('div');
  root.id = FAB_ROOT_ID;
  root.setAttribute('data-fab-version', FAB_SCHEMA_VERSION);

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
    transform: 'translateY(6px)',
    pointerEvents: 'none',
    transition: 'opacity 0.16s ease, transform 0.18s ease',
  });

  menu.appendChild(buildFabActionButton({
    id: 'gj-fab-open-issue',
    iconSvg: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7"></path><path d="M10 14 21 3"></path><path d="M21 14v7h-7"></path><path d="M3 10v11h11"></path></svg>',
    title: '이슈 페이지 이동',
    onClick: openJiraIssueInNewTab,
  }));

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
    transition: 'transform 0.16s ease, box-shadow 0.16s ease',
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
initNetworkContextBridge();
