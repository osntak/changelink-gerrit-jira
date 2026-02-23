'use strict';

const MSG = self.MESSAGE_TYPES;

const issueKeyEl = document.getElementById('issue-key');
const subjectEl = document.getElementById('subject');
const issueCardEl = document.getElementById('issue-card');
const issueSummaryEl = document.getElementById('issue-summary');
const issueStatusEl = document.getElementById('issue-status');
const issueAssigneeEl = document.getElementById('issue-assignee');
const statusEl = document.getElementById('status');
const btnRefresh = document.getElementById('btn-refresh');
const btnLink = document.getElementById('btn-link');
const btnComment = document.getElementById('btn-comment');
const fabEnabledEl = document.getElementById('fab-enabled');
const btnOptions = document.getElementById('btn-options');
const issueKeyInputEl = document.getElementById('issue-key-input');

let currentContext = null;

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
  btnRefresh.disabled = false;
  const key = getEffectiveIssueKey();
  btnLink.disabled = !key;
  btnComment.disabled = !key;
}

function setActionBusy(isBusy) {
  if (isBusy) {
    btnRefresh.disabled = true;
    btnLink.disabled = true;
    btnComment.disabled = true;
    return;
  }
  syncActionButtons();
}

function renderContext(context) {
  currentContext = context;
  issueKeyEl.textContent = context.issueKey || '-';
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

function loadFabSetting() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['fabEnabled'], ({ fabEnabled }) => {
      const enabled = fabEnabled !== false;
      fabEnabledEl.checked = enabled;
      resolve(enabled);
    });
  });
}

function renderIssueCard(issue) {
  issueSummaryEl.textContent = issue.summary || '(제목 없음)';
  issueStatusEl.textContent = `Status: ${issue.status || '-'}`;
  issueAssigneeEl.textContent = `Assignee: ${issue.assignee || 'Unassigned'}`;
  issueCardEl.style.display = 'block';
}

function hideIssueCard() {
  issueCardEl.style.display = 'none';
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
      issueKeyEl.textContent = '-';
      subjectEl.textContent = '-';
      syncActionButtons();
      setStatus(resp?.message || 'Gerrit 페이지를 찾을 수 없습니다.', 'warn');
      return false;
    }

    renderContext(resp.context);

    if (!resp.context.issueKey) {
      hideIssueCard();
      setStatus('PROJ-123 같은 이슈키가 필요합니다. 제목 또는 커밋 메시지에 jira: KEY를 추가하세요.', 'warn');
      syncActionButtons();
      return false;
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
  } catch {
    setStatus('요청 중 오류가 발생했습니다.', 'err');
  } finally {
    setActionBusy(false);
  }
}

async function addRemoteLink() {
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

async function addComment() {
  const issueKey = getEffectiveIssueKey();
  if (!issueKey) {
    setStatus('이슈키를 먼저 확인하세요.', 'warn');
    return;
  }

  setActionBusy(true);
  setStatus('코멘트 생성 중...', '');
  try {
    const resp = await sendMessage({ type: MSG.POPUP_ADD_COMMENT, issueKeyOverride: issueKey });
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

btnRefresh.addEventListener('click', async () => {
  setActionBusy(true);
  const ready = await loadContext();
  if (ready) await fetchIssue();
  setActionBusy(false);
});

btnLink.addEventListener('click', addRemoteLink);
btnComment.addEventListener('click', addComment);
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

(async () => {
  currentContext = null;
  syncActionButtons();
  await loadFabSetting();
  const ready = await loadContext();
  if (ready && isGerritChangeUrl(currentContext?.gerritUrl || '')) {
    await fetchIssue();
  } else if (ready) {
    setStatus('Gerrit change URL에서 자동 조회가 실행됩니다.', 'warn');
  }
})();
