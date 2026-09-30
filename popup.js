'use strict';

const MSG = self.MESSAGE_TYPES;

const issueTitleEl = document.getElementById('issue-title');
const issueStatusSelectEl = /** @type {HTMLSelectElement} */ (document.getElementById('issue-status-select'));
const issueAssigneeEl = document.getElementById('issue-assignee');
const issueCommentStateEl = document.getElementById('issue-comment-state');
const statusEl = document.getElementById('status');
const btnRefresh = document.getElementById('btn-refresh');
const btnApply = document.getElementById('btn-apply');
const btnLink = document.getElementById('btn-link');
const btnComment = document.getElementById('btn-comment');
const fabEnabledEl = document.getElementById('fab-enabled');
const btnOptions = document.getElementById('btn-options');
const issueKeyInputEl = document.getElementById('issue-key-input');
const btnOpenIssue = document.getElementById('btn-open-issue');
const btnRowEl = document.getElementById('btn-row');
const previewPanelEl = document.getElementById('preview-panel');
const previewTitleEl = document.getElementById('preview-title');
const previewDupEl = document.getElementById('preview-dup');
const previewTextEl = document.getElementById('preview-text');
const btnPreviewSubmit = document.getElementById('btn-preview-submit');
const btnPreviewCancel = document.getElementById('btn-preview-cancel');
const gerritListEl = document.getElementById('gerrit-list');
const transitionFormEl = document.getElementById('transition-form');
const transitionFieldsEl = document.getElementById('transition-fields');
const btnTransitionSubmit = document.getElementById('btn-transition-submit');
const btnTransitionCancel = document.getElementById('btn-transition-cancel');
let currentTransitions = [];

// Opened on a Jira issue page: show only the Gerrit changes that mention the
// issue (body.jira-mode hides the Gerrit-change UI).
let jiraMode = false;

let currentContext = null;
let authConfigured = true;
let currentIssueStatus = '';
let commentDuplicate = null; // null = unknown, true/false = checked
let previewEnabled = true;
let previewMode = null; // 'comment' | 'apply'
// Jira site URL is user-configured in options.
let jiraBase = '';
chrome.storage.local.get(['jiraBase'], ({ jiraBase: saved }) => { jiraBase = saved || ''; });

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
  // Gerrit subject를 우선 표시; 이슈 조회가 성공하면 Jira 제목으로 대체된다.
  issueTitleEl.textContent = context.subject || '-';
  if (!issueKeyInputEl.value && context.issueKey) {
    issueKeyInputEl.value = context.issueKey;
  }
  syncActionButtons();
  updateApplyEmphasis();
}

function isChangeMerged() {
  return !!currentContext?.submittedAt;
}

// 머지된 change인데 아직 코멘트가 안 달렸으면 반영 처리를 강조한다.
function updateApplyEmphasis() {
  const emphasize = isChangeMerged() && commentDuplicate !== true;
  btnApply.classList.toggle('primary', emphasize);
  btnApply.title = emphasize ? I18N.t('popup.title.applyMerged') : '';
}

function renderCommentState() {
  if (commentDuplicate === true) {
    issueCommentStateEl.textContent = I18N.t('popup.state.commentExists');
    issueCommentStateEl.style.display = 'block';
  } else {
    issueCommentStateEl.style.display = 'none';
  }
  updateApplyEmphasis();
}

async function checkCommentState(issueKey) {
  commentDuplicate = null;
  renderCommentState();
  try {
    const resp = await sendMessage({ type: MSG.POPUP_CHECK_COMMENT, issueKeyOverride: issueKey });
    if (resp?.ok) commentDuplicate = !!resp.duplicate;
  } catch {
    // Comment-state badge is optional UI; keep unknown on failure.
  }
  renderCommentState();
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
  if (!jiraBase) return '';
  return `${jiraBase}/browse/${encodeURIComponent(issueKey)}`;
}

function loadFabSetting() {
  return new Promise((resolve) => {
    // FAB on/off is per site; the switch shows the one for the site of this tab.
    chrome.storage.local.get(['fabEnabled', 'fabEnabledJira', 'previewEnabled'], ({ fabEnabled, fabEnabledJira, previewEnabled: pe }) => {
      const enabled = (jiraMode ? fabEnabledJira : fabEnabled) !== false;
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
  if (issue.summary) issueTitleEl.textContent = issue.summary;
  currentIssueStatus = issue.status || '';
  issueAssigneeEl.textContent = issue.assignee || I18N.t('popup.value.unassigned');
  resetTransitionUi();
}

function hideIssueCard() {
  issueTitleEl.textContent = currentContext?.subject || '-';
  issueAssigneeEl.textContent = '-';
  currentIssueStatus = '';
  commentDuplicate = null;
  renderCommentState();
  resetTransitionUi();
}

function resetTransitionUi() {
  currentTransitions = [];
  closeTransitionForm();
  issueStatusSelectEl.innerHTML = '';
  const current = document.createElement('option');
  current.value = '';
  current.textContent = currentIssueStatus || '-';
  issueStatusSelectEl.appendChild(current);
  issueStatusSelectEl.value = '';
  issueStatusSelectEl.disabled = true;
}

function renderTransitions(transitions) {
  resetTransitionUi();
  if (!Array.isArray(transitions) || transitions.length === 0) return;
  currentTransitions = transitions;

  for (const t of transitions) {
    const target = t.toStatus || t.name;
    if (currentIssueStatus && target === currentIssueStatus) continue;
    const option = document.createElement('option');
    option.value = t.id;
    option.textContent = target;
    issueStatusSelectEl.appendChild(option);
  }
  issueStatusSelectEl.disabled = issueStatusSelectEl.options.length <= 1;
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

function closeTransitionForm() {
  transitionFormEl.style.display = 'none';
  transitionFieldsEl.textContent = '';
}

// Picking a status: transitions without required fields run right away; the rest
// open a small form, like the dialog Jira shows for Resolved.
function onTransitionPicked() {
  closeTransitionForm();
  const t = currentTransitions.find((x) => x.id === issueStatusSelectEl.value);
  if (!t) return;
  const needs = Array.isArray(t.needs) ? t.needs : [];
  if (!needs.length) {
    applyTransition();
    return;
  }
  // Only resolution is asked here. Any other empty required field (fix version,
  // severity, free text...) is left to Jira's own dialog.
  const blocking = needs.filter((f) => f.key !== 'resolution' || !f.options?.length);
  if (blocking.length) {
    setStatus(I18N.t('popup.transition.needsJira', {
      status: t.toStatus || t.name,
      fields: blocking.map((f) => f.name).join(', '),
    }), 'warn');
    issueStatusSelectEl.value = '';
    return;
  }

  for (const f of needs) {
    const label = document.createElement('span');
    label.textContent = f.name;
    const select = document.createElement('select');
    select.dataset.key = f.key;
    select.dataset.multi = f.multi ? '1' : '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = I18N.t('popup.transition.pick');
    select.appendChild(placeholder);
    for (const o of f.options) {
      const option = document.createElement('option');
      option.value = o.id;
      option.textContent = o.name;
      select.appendChild(option);
    }
    // Jira's default resolution comes preselected (an unknown id leaves "Select").
    select.value = f.value || '';
    transitionFieldsEl.append(label, select);
  }
  transitionFormEl.style.display = 'block';
  // Everything else waits until the form is submitted or cancelled, including the
  // status select and the issue key (the form belongs to this issue and status).
  setActionBusy(true);
  issueStatusSelectEl.disabled = true;
  issueKeyInputEl.disabled = true;
  setStatus(I18N.t('popup.transition.fillFields'), '');
}

function submitTransitionForm() {
  const selects = [...transitionFieldsEl.querySelectorAll('select')];
  if (selects.some((s) => !s.value)) {
    setStatus(I18N.t('popup.transition.pickAll'), 'warn');
    return;
  }
  applyTransition(selects.map((s) => ({ key: s.dataset.key, id: s.value, multi: !!s.dataset.multi })));
}

async function applyTransition(fields) {
  const issueKey = getEffectiveIssueKey();
  const transitionId = issueStatusSelectEl.value;
  if (!issueKey || !transitionId) return;

  setActionBusy(true);
  issueStatusSelectEl.disabled = true;
  // A second click while the first request runs would send the transition twice.
  btnTransitionSubmit.disabled = true;
  btnTransitionCancel.disabled = true;
  setStatus(I18N.t('popup.status.transitioning'), '');
  try {
    const resp = await sendMessage({
      type: MSG.POPUP_DO_TRANSITION,
      issueKey,
      transitionId,
      fields,
    });
    if (!resp?.ok) {
      setStatus(resp?.message || I18N.t('popup.status.transitionFailed'), 'err');
      issueStatusSelectEl.value = '';
      issueStatusSelectEl.disabled = false;
      return;
    }
    await fetchIssue();
    // After fetchIssue so its own "issue loaded" line does not hide this one.
    setStatus(I18N.t('popup.status.transitionDone', { key: issueKey }), 'ok');
  } catch {
    setStatus(I18N.t('popup.status.requestError'), 'err');
    issueStatusSelectEl.value = '';
    issueStatusSelectEl.disabled = false;
  } finally {
    closeTransitionForm();
    btnTransitionSubmit.disabled = false;
    btnTransitionCancel.disabled = false;
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
      issueTitleEl.textContent = '-';
      syncActionButtons();
      setStatus(resp?.message || I18N.t('popup.status.noGerritPage'), 'warn');
      return false;
    }

    renderContext(resp.context);
    if (!getEffectiveIssueKey()) {
      hideIssueCard();
      setStatus(I18N.t('popup.status.enterIssueKey'), 'warn');
      return true;
    }
    setStatus(I18N.t('popup.status.contextReady'), 'ok');
    return true;
  } catch {
    hideIssueCard();
    currentContext = null;
    syncActionButtons();
    setStatus(I18N.t('popup.status.noConnection'), 'err');
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
      setStatus(resp?.message || I18N.t('popup.status.fabSaveFailed'), 'err');
      fabEnabledEl.checked = !enabled;
      return;
    }
    if (resp.message) {
      setStatus(resp.message, 'warn');
    } else {
      setStatus(I18N.t(enabled ? 'popup.status.fabOn' : 'popup.status.fabOff'), 'ok');
    }
  } catch {
    fabEnabledEl.checked = !enabled;
    setStatus(I18N.t('popup.status.fabError'), 'err');
  } finally {
    fabEnabledEl.disabled = false;
  }
}

async function fetchIssue() {
  if (!authConfigured) {
    setStatus(I18N.t('popup.status.authMissingFetch'), 'warn');
    return;
  }
  const issueKey = getEffectiveIssueKey();
  if (!issueKey) {
    setStatus(I18N.t('popup.status.noIssueKey'), 'warn');
    return;
  }

  setActionBusy(true);
  setStatus(I18N.t('popup.status.fetchingIssue'), '');
  try {
    const resp = await sendMessage({
      type: MSG.POPUP_GET_ISSUE,
      issueKey,
    });

    if (!resp?.ok) {
      hideIssueCard();
      setStatus(resp?.message || I18N.t('popup.status.fetchFailed'), 'err');
      return;
    }

    renderIssueCard(resp.issue);
    setStatus(I18N.t('popup.status.fetchDone', { key: issueKey }), 'ok');
    await Promise.all([loadTransitions(issueKey), checkCommentState(issueKey)]);
  } catch {
    setStatus(I18N.t('popup.status.requestError'), 'err');
  } finally {
    setActionBusy(false);
  }
}

async function addRemoteLink() {
  if (!authConfigured) {
    setStatus(I18N.t('popup.status.authMissingLink'), 'warn');
    return;
  }
  const issueKey = getEffectiveIssueKey();
  if (!issueKey) {
    setStatus(I18N.t('popup.status.noIssueKey'), 'warn');
    return;
  }

  setActionBusy(true);
  setStatus(I18N.t('popup.status.addingLink'), '');
  try {
    const resp = await sendMessage({ type: MSG.POPUP_ADD_REMOTE_LINK, issueKeyOverride: issueKey });
    if (!resp?.ok) {
      setStatus(resp?.message || I18N.t('popup.status.linkFailed'), 'err');
      return;
    }
    setStatus(I18N.t('popup.status.linkDone', { key: issueKey }), 'ok');
  } catch {
    setStatus(I18N.t('popup.status.requestError'), 'err');
  } finally {
    setActionBusy(false);
  }
}

async function requestAddComment(issueKey) {
  const resp = await sendMessage({ type: MSG.POPUP_ADD_COMMENT, issueKeyOverride: issueKey });
  if (resp?.duplicate) {
    const proceed = window.confirm(I18N.t('popup.confirm.duplicateComment', { key: resp.issueKey }));
    if (!proceed) return { ok: false, cancelled: true };
    return sendMessage({ type: MSG.POPUP_ADD_COMMENT, issueKeyOverride: issueKey, force: true });
  }
  return resp;
}

async function addComment() {
  if (!authConfigured) {
    setStatus(I18N.t('popup.status.authMissingComment'), 'warn');
    return;
  }
  const issueKey = getEffectiveIssueKey();
  if (!issueKey) {
    setStatus(I18N.t('popup.status.noIssueKey'), 'warn');
    return;
  }

  setActionBusy(true);
  setStatus(I18N.t('popup.status.addingComment'), '');
  try {
    const resp = await requestAddComment(issueKey);
    if (resp?.cancelled) {
      setStatus(I18N.t('popup.status.commentCancelled'), 'warn');
      return;
    }
    if (!resp?.ok) {
      setStatus(resp?.message || I18N.t('popup.status.commentFailed'), 'err');
      return;
    }
    setStatus(I18N.t('popup.status.commentDone', { key: issueKey }), 'ok');
    commentDuplicate = true;
    renderCommentState();
  } catch {
    setStatus(I18N.t('popup.status.requestError'), 'err');
  } finally {
    setActionBusy(false);
  }
}

async function applyLinkAndComment() {
  if (!authConfigured) {
    setStatus(I18N.t('popup.status.authMissingApply'), 'warn');
    return;
  }
  const issueKey = getEffectiveIssueKey();
  if (!issueKey) {
    setStatus(I18N.t('popup.status.noIssueKey'), 'warn');
    return;
  }

  setActionBusy(true);
  setStatus(I18N.t('popup.status.applying'), '');
  try {
    let resp = await sendMessage({ type: MSG.POPUP_QUICK_APPLY, issueKeyOverride: issueKey });
    if (resp?.duplicate) {
      const proceed = window.confirm(I18N.t('popup.confirm.duplicateApply', { key: resp.issueKey }));
      if (!proceed) {
        setStatus(I18N.t('popup.status.applyCancelled'), 'warn');
        return;
      }
      resp = await sendMessage({ type: MSG.POPUP_QUICK_APPLY, issueKeyOverride: issueKey, force: true });
    }

    if (!resp?.ok) {
      setStatus(resp?.message || I18N.t('popup.status.applyFailed'), 'err');
      return;
    }
    setStatus(resp.message || I18N.t('popup.status.applyDone', { key: issueKey }), resp.transitionFailed ? 'warn' : 'ok');
    commentDuplicate = true;
    renderCommentState();
  } catch {
    setStatus(I18N.t('popup.status.requestError'), 'err');
  } finally {
    setActionBusy(false);
  }
}

// -- Editable comment preview ---------------------------------------------------

function closePreview() {
  previewMode = null;
  previewPanelEl.style.display = 'none';
  btnRowEl.style.display = 'grid';
}

async function openPreview(mode) {
  if (!authConfigured) {
    setStatus(I18N.t('popup.status.authMissing'), 'warn');
    return;
  }
  const issueKey = getEffectiveIssueKey();
  if (!issueKey) {
    setStatus(I18N.t('popup.status.noIssueKey'), 'warn');
    return;
  }

  setActionBusy(true);
  setStatus(I18N.t('popup.status.buildingPreview'), '');
  try {
    const resp = await sendMessage({ type: MSG.POPUP_PREVIEW_COMMENT, issueKeyOverride: issueKey });
    if (!resp?.ok) {
      setStatus(resp?.message || I18N.t('popup.status.previewFailed'), 'err');
      return;
    }

    previewMode = mode;
    previewTextEl.value = resp.text || '';
    previewDupEl.textContent = resp.duplicate ? I18N.t('popup.preview.dup') : '';
    previewTitleEl.textContent = I18N.t(mode === 'apply' ? 'popup.preview.titleApply' : 'popup.preview.title');
    btnPreviewSubmit.textContent = I18N.t(mode === 'apply' ? 'popup.btn.previewSubmitApply' : 'popup.btn.previewSubmitComment');
    btnRowEl.style.display = 'none';
    previewPanelEl.style.display = 'block';
    setStatus(I18N.t('popup.status.previewHint'), '');
  } catch {
    setStatus(I18N.t('popup.status.requestError'), 'err');
  } finally {
    setActionBusy(false);
  }
}

async function submitPreview() {
  const issueKey = getEffectiveIssueKey();
  const commentText = previewTextEl.value.trim();
  if (!previewMode || !issueKey) return;
  if (!commentText) {
    setStatus(I18N.t('popup.status.emptyComment'), 'warn');
    return;
  }

  const mode = previewMode;
  btnPreviewSubmit.disabled = true;
  btnPreviewCancel.disabled = true;
  setStatus(I18N.t(mode === 'apply' ? 'popup.status.applying' : 'popup.status.submittingComment'), '');
  try {
    const resp = await sendMessage({
      type: mode === 'apply' ? MSG.POPUP_QUICK_APPLY : MSG.POPUP_ADD_COMMENT,
      issueKeyOverride: issueKey,
      commentText,
      force: true,
    });
    if (!resp?.ok) {
      setStatus(resp?.message || I18N.t('popup.status.submitFailed'), 'err');
      return;
    }
    closePreview();
    setStatus(
      resp.message
        || I18N.t(mode === 'apply' ? 'popup.status.applyDone' : 'popup.status.commentDone', { key: issueKey }),
      resp.transitionFailed ? 'warn' : 'ok',
    );
    commentDuplicate = true;
    renderCommentState();
  } catch {
    setStatus(I18N.t('popup.status.requestError'), 'err');
  } finally {
    btnPreviewSubmit.disabled = false;
    btnPreviewCancel.disabled = false;
  }
}

function openIssuePage() {
  const issueKey = getEffectiveIssueKey();
  if (!issueKey) {
    setStatus(I18N.t('popup.status.noIssueKey'), 'warn');
    return;
  }
  const url = buildIssueUrl(issueKey);
  if (!url) {
    setStatus(I18N.t('popup.status.noJiraBase'), 'warn');
    return;
  }
  chrome.tabs.create({ url });
  window.close();
}

// -- Jira mode: Gerrit changes mentioning the issue --------------------------------

/** @returns {Promise<{ onJira: boolean, key: string }>} key is '' off an issue page */
async function getJiraTab() {
  const [{ jiraBase: base }, [tab]] = await Promise.all([
    chrome.storage.local.get(['jiraBase']),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  try {
    if (!base || !tab?.url || new URL(tab.url).origin !== base) return { onJira: false, key: '' };
  } catch {
    return { onJira: false, key: '' };
  }
  return { onJira: true, key: self.jiraIssueKeyFromUrl(tab.url) };
}

function appendGerritNote(text) {
  const note = document.createElement('div');
  note.className = 'change-empty';
  note.textContent = text;
  gerritListEl.appendChild(note);
}

function appendGerritLink(href, text) {
  const link = document.createElement('a');
  link.className = 'login-link';
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = text;
  gerritListEl.appendChild(link);
}

async function loadGerritChanges() {
  const key = getEffectiveIssueKey();
  gerritListEl.textContent = '';
  document.getElementById('head-key').textContent = key ? ` · ${key}` : '';
  if (!key) {
    setStatus(I18N.t('popup.status.enterIssueKeyJira'), 'warn');
    return;
  }
  btnRefresh.disabled = true;
  setStatus(I18N.t('gerrit.loading'), '');
  try {
    const resp = await sendMessage({ type: MSG.GET_GERRIT_CHANGES, issueKey: key });
    if (!resp?.ok) {
      setStatus(resp?.message || I18N.t('popup.status.requestError'), 'err');
      return;
    }
    if (resp.signedIn) setStatus(I18N.t('popup.status.gerritDone', { n: resp.changes.length }), 'ok');
    else setStatus(I18N.t('gerrit.notSignedIn'), 'warn');
    if (!resp.changes.length) {
      if (resp.signedIn) appendGerritNote(I18N.t('gerrit.empty'));
      if (resp.loginUrl) appendGerritLink(resp.loginUrl, I18N.t('gerrit.signIn'));
      return;
    }
    for (const c of resp.changes) {
      const item = document.createElement('a');
      item.className = 'change-item';
      item.href = c.url;
      item.target = '_blank';
      item.rel = 'noopener noreferrer';

      const head = document.createElement('div');
      head.className = 'subject';
      const status = document.createElement('span');
      status.className = `change-status ${c.status}`;
      status.textContent = c.status;
      head.append(status, `${c.number} · ${c.subject}`);

      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = [`${c.project} / ${c.branch}`, c.owner, c.date].filter(Boolean).join(' · ');

      item.append(head, meta);
      gerritListEl.appendChild(item);
    }
    if (resp.more && resp.searchUrl) appendGerritLink(resp.searchUrl, I18N.t('gerrit.viewAll'));
  } catch {
    setStatus(I18N.t('popup.status.requestError'), 'err');
  } finally {
    btnRefresh.disabled = false;
  }
}

// On a Jira page that is not an issue (board, filter...), only the issue key
// field is shown; Enter looks up the changes for the typed key.
async function initJiraMode(issueKey) {
  jiraMode = true;
  document.body.classList.add('jira-mode');
  document.body.classList.toggle('jira-nokey', !issueKey);
  issueKeyInputEl.value = issueKey;
  syncActionButtons();
  if (!issueKey) issueKeyInputEl.focus();
  await loadGerritChanges();
}

btnRefresh.addEventListener('click', async () => {
  if (jiraMode) {
    await loadGerritChanges();
    return;
  }
  setActionBusy(true);
  const ready = await loadContext();
  if (ready && authConfigured) {
    await fetchIssue();
  } else if (ready) {
    setStatus(I18N.t('popup.status.contextRefreshed'), 'warn');
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
  setStatus(I18N.t('popup.status.cancelled'), '');
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
issueStatusSelectEl.addEventListener('change', onTransitionPicked);
btnTransitionSubmit.addEventListener('click', submitTransitionForm);
btnTransitionCancel.addEventListener('click', () => {
  closeTransitionForm();
  issueStatusSelectEl.value = '';
  issueStatusSelectEl.disabled = false;
  setActionBusy(false);
  setStatus(I18N.t('popup.status.cancelled'), '');
});

I18N.init(async () => {
  I18N.applyDom();
  currentContext = null;
  authConfigured = true;
  syncActionButtons();
  await loadAuthState();
  const jiraTab = await getJiraTab();
  jiraMode = jiraTab.onJira;
  await loadFabSetting();
  if (jiraTab.onJira) {
    await initJiraMode(jiraTab.key);
    return;
  }
  const ready = await loadContext();
  if (ready && authConfigured && isGerritChangeUrl(currentContext?.gerritUrl || '') && getEffectiveIssueKey()) {
    await fetchIssue();
  } else if (ready && !authConfigured) {
    setStatus(I18N.t('popup.status.authMissingInit'), 'warn');
  } else if (ready) {
    setStatus(I18N.t('popup.status.autoFetchHint'), 'warn');
  }
});
