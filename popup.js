'use strict';

const MSG = self.MESSAGE_TYPES;

const subjectEl = document.getElementById('subject');
const issueCardEl = document.getElementById('issue-card');
const issueSummaryEl = document.getElementById('issue-summary');
const issueStatusEl = document.getElementById('issue-status');
const issueAssigneeEl = document.getElementById('issue-assignee');
const statusEl = document.getElementById('status');
const btnRefresh = document.getElementById('btn-refresh');
const btnApply = document.getElementById('btn-apply');
const btnLink = document.getElementById('btn-link');
const btnComment = document.getElementById('btn-comment');
const fabEnabledEl = document.getElementById('fab-enabled');
const btnOptions = document.getElementById('btn-options');
const issueKeyInputEl = document.getElementById('issue-key-input');
const btnOpenIssue = document.getElementById('btn-open-issue');
const transitionSelectEl = document.getElementById('transition-select');
const btnTransition = document.getElementById('btn-transition');
const btnRowEl = document.getElementById('btn-row');
const previewPanelEl = document.getElementById('preview-panel');
const previewTitleEl = document.getElementById('preview-title');
const previewDupEl = document.getElementById('preview-dup');
const previewTextEl = document.getElementById('preview-text');
const btnPreviewSubmit = document.getElementById('btn-preview-submit');
const btnPreviewCancel = document.getElementById('btn-preview-cancel');

let currentContext = null;
let authConfigured = true;
let previewEnabled = true;
let previewMode = null; // 'comment' | 'apply'
const JIRA_BASE = 'https://yourcompany.atlassian.net';

function setStatus(message, cls) {
  statusEl.textContent = message;
  statusEl.className = `status ${cls || ''}`.trim();
}

function isGerritChangeUrl(url) {
  try {
    const u = new URL(String(url || ''));
    return /\/c\/.+\/\+\/\d+/.test(u.pathname);
  } catch {
    return false;
  }
}

function syncActionButtons() {
  issueKeyInputEl.disabled = false;
  btnRefresh.disabled = false;
  const key = getEffectiveIssueKey();
  btnApply.disabled = !authConfigured || !key;
  btnLink.disabled = !authConfigured || !key;
  btnComment.disabled = !authConfigured || !key;
  btnOpenIssue.disabled = !key;
}

function setActionBusy(isBusy) {
  if (isBusy) {
    btnRefresh.disabled = true;
    btnApply.disabled = true;
    btnLink.disabled = true;
    btnComment.disabled = true;
    return;
  }
  syncActionButtons();
}

function renderContext(context) {
  currentContext = context;
  subjectEl.textContent = context.subject || '(제목 없음)';
  if (!issueKeyInputEl.value && context.issueKey) {
    issueKeyInputEl.value = context.issueKey;
  }
  syncActionButtons();
}

function normalizeIssueKey(key) {
  return String(key || '').trim().toUpperCase();
}

function isValidIssueKey(key) {
  return /^[A-Z][A-Z0-9]+-\d+$/.test(key);
}

function getEffectiveIssueKey() {
  const manual = normalizeIssueKey(issueKeyInputEl.value);
  if (isValidIssueKey(manual)) return manual;
  const detected = normalizeIssueKey(currentContext?.issueKey);
  if (isValidIssueKey(detected)) return detected;
  return '';
}

function buildIssueUrl(issueKey) {
  return `${JIRA_BASE}/browse/${encodeURIComponent(issueKey)}`;
}

function loadFabSetting() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['fabEnabled', 'previewEnabled'], ({ fabEnabled, previewEnabled: pe }) => {
      const enabled = fabEnabled !== false;
      fabEnabledEl.checked = enabled;
      previewEnabled = pe !== false;
      resolve(enabled);
    });
  });
}

async function loadAuthState() {
  try {
    const resp = await sendMessage({ type: MSG.POPUP_GET_AUTH_STATE });
    authConfigured = !!resp?.configured;
  } catch {
    authConfigured = false;
  }
  syncActionButtons();
}

function renderIssueCard(issue) {
  issueSummaryEl.textContent = issue.summary || '(제목 없음)';
  issueStatusEl.textContent = `Status: ${issue.status || '-'}`;
  issueAssigneeEl.textContent = `Assignee: ${issue.assignee || 'Unassigned'}`;
  issueCardEl.style.display = 'block';
}

function hideIssueCard() {
  issueCardEl.style.display = 'none';
  resetTransitionUi();
}

function resetTransitionUi() {
  transitionSelectEl.innerHTML = '<option value="">상태 변경...</option>';
  transitionSelectEl.disabled = true;
  btnTransition.disabled = true;
}

function renderTransitions(transitions) {
  resetTransitionUi();
  if (!Array.isArray(transitions) || transitions.length === 0) return;

  for (const t of transitions) {
    const option = document.createElement('option');
    option.value = t.id;
    option.textContent = t.toStatus && t.toStatus !== t.name
      ? `${t.name} → ${t.toStatus}`
      : t.name;
    transitionSelectEl.appendChild(option);
  }
  transitionSelectEl.disabled = false;
}

async function loadTransitions(issueKey) {
  resetTransitionUi();
  try {
    const resp = await sendMessage({
      type: MSG.POPUP_GET_TRANSITIONS,
      issueKey,
    });
    if (resp?.ok) renderTransitions(resp.transitions);
  } catch {
    // Transition list is optional UI; issue lookup already reported errors.
  }
}

async function applyTransition() {
  const issueKey = getEffectiveIssueKey();
  const transitionId = transitionSelectEl.value;
  if (!issueKey || !transitionId) return;

  setActionBusy(true);
  transitionSelectEl.disabled = true;
  btnTransition.disabled = true;
  setStatus('상태 변경 중...', '');
  try {
    const resp = await sendMessage({
      type: MSG.POPUP_DO_TRANSITION,
      issueKey,
      transitionId,
    });
    if (!resp?.ok) {
      setStatus(resp?.message || '상태 변경에 실패했습니다.', 'err');
      transitionSelectEl.disabled = false;
      btnTransition.disabled = false;
      return;
    }
    setStatus(`상태 변경 완료: ${issueKey}`, 'ok');
    await fetchIssue();
  } catch {
    setStatus('요청 중 오류가 발생했습니다.', 'err');
    transitionSelectEl.disabled = false;
    btnTransition.disabled = false;
  } finally {
    setActionBusy(false);
  }
}

function sendMessage(msg) {
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

async function loadContext() {
  try {
    const resp = await sendMessage({ type: MSG.POPUP_GET_CONTEXT });
    if (!resp?.ok) {
      hideIssueCard();
      currentContext = null;
      subjectEl.textContent = '-';
      syncActionButtons();
      setStatus(resp?.message || 'Gerrit 페이지를 찾을 수 없습니다.', 'warn');
      return false;
    }

    renderContext(resp.context);
    if (!getEffectiveIssueKey()) {
      hideIssueCard();
      setStatus('Issue key를 입력하거나 자동 감지를 확인하세요.', 'warn');
      return true;
    }
    setStatus('컨텍스트 확인 완료. 이슈 조회를 실행합니다.', 'ok');
    return true;
  } catch {
    hideIssueCard();
    currentContext = null;
    syncActionButtons();
    setStatus('확장프로그램과 통신할 수 없습니다. 확장프로그램을 다시 로드하세요.', 'err');
    return false;
  }
}

async function setFabEnabled(enabled) {
  fabEnabledEl.disabled = true;
  try {
    const resp = await sendMessage({
      type: MSG.POPUP_SET_FAB_ENABLED,
      enabled: !!enabled,
    });
    if (!resp?.ok) {
      setStatus(resp?.message || 'FAB 설정 저장에 실패했습니다.', 'err');
      fabEnabledEl.checked = !enabled;
      return;
    }
    if (resp.message) {
      setStatus(resp.message, 'warn');
    } else {
      setStatus(`FAB ${enabled ? '활성화' : '비활성화'} 완료`, 'ok');
    }
  } catch {
    fabEnabledEl.checked = !enabled;
    setStatus('FAB 설정 변경 중 오류가 발생했습니다.', 'err');
  } finally {
    fabEnabledEl.disabled = false;
  }
}

async function fetchIssue() {
  if (!authConfigured) {
    setStatus('Jira 인증이 없어 이슈 조회는 비활성화되었습니다.\n컨텍스트 탐색은 계속 사용할 수 있습니다.', 'warn');
    return;
  }
  const issueKey = getEffectiveIssueKey();
  if (!issueKey) {
    setStatus('이슈키를 먼저 확인하세요.', 'warn');
    return;
  }

  setActionBusy(true);
  setStatus('Jira 이슈 조회 중...', '');
  try {
    const resp = await sendMessage({
      type: MSG.POPUP_GET_ISSUE,
      issueKey,
    });

    if (!resp?.ok) {
      hideIssueCard();
      setStatus(resp?.message || '이슈 조회에 실패했습니다.', 'err');
      return;
    }

    renderIssueCard(resp.issue);
    setStatus(`이슈 조회 완료: ${issueKey}`, 'ok');
    await loadTransitions(issueKey);
  } catch {
    setStatus('요청 중 오류가 발생했습니다.', 'err');
  } finally {
    setActionBusy(false);
  }
}

async function addRemoteLink() {
  if (!authConfigured) {
    setStatus('Jira 인증이 없어 웹링크 추가는 비활성화되었습니다.', 'warn');
    return;
  }
  const issueKey = getEffectiveIssueKey();
  if (!issueKey) {
    setStatus('이슈키를 먼저 확인하세요.', 'warn');
    return;
  }

  setActionBusy(true);
  setStatus('웹링크 추가 중...', '');
  try {
    const resp = await sendMessage({ type: MSG.POPUP_ADD_REMOTE_LINK, issueKeyOverride: issueKey });
    if (!resp?.ok) {
      setStatus(resp?.message || '웹링크 추가에 실패했습니다.', 'err');
      return;
    }
    setStatus(`웹링크 추가 완료: ${issueKey}`, 'ok');
  } catch {
    setStatus('요청 중 오류가 발생했습니다.', 'err');
  } finally {
    setActionBusy(false);
  }
}

async function requestAddComment(issueKey) {
  const resp = await sendMessage({ type: MSG.POPUP_ADD_COMMENT, issueKeyOverride: issueKey });
  if (resp?.duplicate) {
    const proceed = window.confirm(
      `${resp.issueKey}에 이 change의 코멘트가 이미 있습니다.\n그래도 새 코멘트를 생성할까요?`,
    );
    if (!proceed) return { ok: false, cancelled: true };
    return sendMessage({ type: MSG.POPUP_ADD_COMMENT, issueKeyOverride: issueKey, force: true });
  }
  return resp;
}

async function addComment() {
  if (!authConfigured) {
    setStatus('Jira 인증이 없어 코멘트 생성은 비활성화되었습니다.', 'warn');
    return;
  }
  const issueKey = getEffectiveIssueKey();
  if (!issueKey) {
    setStatus('이슈키를 먼저 확인하세요.', 'warn');
    return;
  }

  setActionBusy(true);
  setStatus('코멘트 생성 중...', '');
  try {
    const resp = await requestAddComment(issueKey);
    if (resp?.cancelled) {
      setStatus('코멘트 생성을 취소했습니다.', 'warn');
      return;
    }
    if (!resp?.ok) {
      setStatus(resp?.message || '코멘트 생성에 실패했습니다.', 'err');
      return;
    }
    setStatus(`코멘트 생성 완료: ${issueKey}`, 'ok');
  } catch {
    setStatus('요청 중 오류가 발생했습니다.', 'err');
  } finally {
    setActionBusy(false);
  }
}

async function applyLinkAndComment() {
  if (!authConfigured) {
    setStatus('Jira 인증이 없어 반영 처리는 비활성화되었습니다.', 'warn');
    return;
  }
  const issueKey = getEffectiveIssueKey();
  if (!issueKey) {
    setStatus('이슈키를 먼저 확인하세요.', 'warn');
    return;
  }

  setActionBusy(true);
  setStatus('반영 처리 중...', '');
  try {
    let resp = await sendMessage({ type: MSG.POPUP_QUICK_APPLY, issueKeyOverride: issueKey });
    if (resp?.duplicate) {
      const proceed = window.confirm(
        `${resp.issueKey}에 이 change의 코멘트가 이미 있습니다.\n그래도 반영 처리를 진행할까요?`,
      );
      if (!proceed) {
        setStatus('반영 처리를 취소했습니다.', 'warn');
        return;
      }
      resp = await sendMessage({ type: MSG.POPUP_QUICK_APPLY, issueKeyOverride: issueKey, force: true });
    }

    if (!resp?.ok) {
      setStatus(resp?.message || '반영 처리에 실패했습니다.', 'err');
      return;
    }
    setStatus(resp.message || `반영 처리 완료: ${issueKey}`, 'ok');
  } catch {
    setStatus('요청 중 오류가 발생했습니다.', 'err');
  } finally {
    setActionBusy(false);
  }
}

// -- Editable comment preview ---------------------------------------------------

let previewHidIssueCard = false;

function closePreview() {
  previewMode = null;
  previewPanelEl.style.display = 'none';
  btnRowEl.style.display = 'grid';
  if (previewHidIssueCard) {
    issueCardEl.style.display = 'block';
    previewHidIssueCard = false;
  }
}

async function openPreview(mode) {
  if (!authConfigured) {
    setStatus('Jira 인증이 없어 사용할 수 없습니다.', 'warn');
    return;
  }
  const issueKey = getEffectiveIssueKey();
  if (!issueKey) {
    setStatus('이슈키를 먼저 확인하세요.', 'warn');
    return;
  }

  setActionBusy(true);
  setStatus('미리보기 생성 중...', '');
  try {
    const resp = await sendMessage({ type: MSG.POPUP_PREVIEW_COMMENT, issueKeyOverride: issueKey });
    if (!resp?.ok) {
      setStatus(resp?.message || '미리보기 생성에 실패했습니다.', 'err');
      return;
    }

    previewMode = mode;
    previewTextEl.value = resp.text || '';
    previewDupEl.textContent = resp.duplicate ? '⚠ 이미 이 change의 코멘트가 있습니다' : '';
    previewTitleEl.textContent = mode === 'apply' ? '반영 처리 — 코멘트 미리보기' : '코멘트 미리보기';
    btnPreviewSubmit.textContent = mode === 'apply' ? '반영 처리 실행' : '코멘트 등록';
    previewHidIssueCard = issueCardEl.style.display === 'block';
    if (previewHidIssueCard) issueCardEl.style.display = 'none';
    btnRowEl.style.display = 'none';
    previewPanelEl.style.display = 'block';
    setStatus('내용 확인/수정 후 실행하세요.', '');
  } catch {
    setStatus('요청 중 오류가 발생했습니다.', 'err');
  } finally {
    setActionBusy(false);
  }
}

async function submitPreview() {
  const issueKey = getEffectiveIssueKey();
  const commentText = previewTextEl.value.trim();
  if (!previewMode || !issueKey) return;
  if (!commentText) {
    setStatus('코멘트 내용이 비어 있습니다.', 'warn');
    return;
  }

  const mode = previewMode;
  btnPreviewSubmit.disabled = true;
  btnPreviewCancel.disabled = true;
  setStatus(mode === 'apply' ? '반영 처리 중...' : '코멘트 등록 중...', '');
  try {
    const resp = await sendMessage({
      type: mode === 'apply' ? MSG.POPUP_QUICK_APPLY : MSG.POPUP_ADD_COMMENT,
      issueKeyOverride: issueKey,
      commentText,
      force: true,
    });
    if (!resp?.ok) {
      setStatus(resp?.message || '실행에 실패했습니다.', 'err');
      return;
    }
    closePreview();
    setStatus(resp.message || `${mode === 'apply' ? '반영 처리' : '코멘트 생성'} 완료: ${issueKey}`, 'ok');
  } catch {
    setStatus('요청 중 오류가 발생했습니다.', 'err');
  } finally {
    btnPreviewSubmit.disabled = false;
    btnPreviewCancel.disabled = false;
  }
}

function openIssuePage() {
  const issueKey = getEffectiveIssueKey();
  if (!issueKey) {
    setStatus('이슈키를 먼저 확인하세요.', 'warn');
    return;
  }
  chrome.tabs.create({ url: buildIssueUrl(issueKey) });
  window.close();
}

btnRefresh.addEventListener('click', async () => {
  setActionBusy(true);
  const ready = await loadContext();
  if (ready && authConfigured) {
    await fetchIssue();
  } else if (ready) {
    setStatus('컨텍스트 새로고침 완료.\nJira 인증 후 이슈 조회를 사용할 수 있습니다.', 'warn');
  }
  setActionBusy(false);
});

btnApply.addEventListener('click', () => {
  if (previewEnabled) openPreview('apply');
  else applyLinkAndComment();
});
btnLink.addEventListener('click', addRemoteLink);
btnComment.addEventListener('click', () => {
  if (previewEnabled) openPreview('comment');
  else addComment();
});
btnPreviewSubmit.addEventListener('click', submitPreview);
btnPreviewCancel.addEventListener('click', () => {
  closePreview();
  setStatus('취소했습니다.', '');
});
issueKeyInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    btnRefresh.click();
  }
});
fabEnabledEl.addEventListener('change', () => {
  setFabEnabled(fabEnabledEl.checked);
});
issueKeyInputEl.addEventListener('input', () => {
  const normalized = normalizeIssueKey(issueKeyInputEl.value);
  if (normalized !== issueKeyInputEl.value) {
    issueKeyInputEl.value = normalized;
  }
  syncActionButtons();
});
btnOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
btnOpenIssue.addEventListener('click', openIssuePage);
transitionSelectEl.addEventListener('change', () => {
  btnTransition.disabled = !transitionSelectEl.value;
});
btnTransition.addEventListener('click', applyTransition);

(async () => {
  currentContext = null;
  authConfigured = true;
  syncActionButtons();
  await loadAuthState();
  await loadFabSetting();
  const ready = await loadContext();
  if (ready && authConfigured && isGerritChangeUrl(currentContext?.gerritUrl || '') && getEffectiveIssueKey()) {
    await fetchIssue();
  } else if (ready && !authConfigured) {
    setStatus('Jira 인증이 없어 API 버튼은 비활성화되었습니다.\nSubject/Issue Key 탐색은 계속 사용할 수 있습니다.', 'warn');
  } else if (ready) {
    setStatus('Gerrit change URL에서 자동 조회가 실행됩니다.', 'warn');
  }
})();
