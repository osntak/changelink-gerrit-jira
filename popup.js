'use strict';

const MSG = self.MESSAGE_TYPES;

const issueTitleEl = document.getElementById('issue-title');
const issueStatusSelectEl = /** @type {HTMLSelectElement} */ (document.getElementById('issue-status-select'));
const btnStatusChange = document.getElementById('btn-status-change');
const issueAssigneeEl = document.getElementById('issue-assignee');
const changeLineEl = document.getElementById('change-line');
const statusEl = document.getElementById('status');
const confirmEl = document.getElementById('confirm');
const confirmTextEl = document.getElementById('confirm-text');
const btnConfirmYes = document.getElementById('btn-confirm-yes');
const btnConfirmNo = document.getElementById('btn-confirm-no');
const btnRefresh = document.getElementById('btn-refresh');
const btnLink = document.getElementById('btn-link');
const btnComment = document.getElementById('btn-comment');
const fabEnabledEl = document.getElementById('fab-enabled');
const btnOptions = document.getElementById('btn-options');
const issueKeyInputEl = document.getElementById('issue-key-input');
const btnOpenIssue = document.getElementById('btn-open-issue');
const btnRowEl = document.getElementById('btn-row');
const previewPanelEl = document.getElementById('preview-panel');
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
// Whether this issue already has this change's comment / web link:
// 'fresh' (not yet), 'has', 'unknown' (could not check) or 'busy'.
let commentState = 'fresh';
let linkState = 'fresh';
// The issue those two states were read for; another key in the field makes them unknown.
let recordKey = '';
let previewEnabled = true;
// Jira site URL is user-configured in options.
let jiraBase = '';
chrome.storage.local.get(['jiraBase'], ({ jiraBase: saved }) => { jiraBase = saved || ''; });

function setStatus(message, cls) {
  statusEl.textContent = message;
  statusEl.className = `status ${cls || ''}`.trim();
}

// In-popup confirm (window.confirm would cover the popup with a browser dialog).
function askInline(text, yesLabel) {
  return new Promise((resolve) => {
    confirmTextEl.textContent = text;
    btnConfirmYes.textContent = yesLabel;
    confirmEl.classList.add('open');
    btnConfirmYes.focus();
    const done = (answer) => {
      confirmEl.classList.remove('open');
      btnConfirmYes.onclick = null;
      btnConfirmNo.onclick = null;
      resolve(answer);
    };
    btnConfirmYes.onclick = () => done(true);
    btnConfirmNo.onclick = () => done(false);
  });
}

function isGerritChangeUrl(url) {
  try {
    const u = new URL(String(url || ''));
    return /\/c\/.+\/\+\/\d+/.test(u.pathname);
  } catch {
    return false;
  }
}

function paintActions() {
  self.ChangeList.paintIcon(btnComment, 'comment', commentState, I18N.t('popup.btn.comment'));
  self.ChangeList.paintIcon(btnLink, 'link', linkState, I18N.t('popup.btn.link'));
}

function syncActionButtons() {
  // An open preview belongs to the issue it was built for.
  issueKeyInputEl.disabled = previewPanelEl.style.display === 'block';
  btnRefresh.disabled = false;
  const key = getEffectiveIssueKey();
  if (key !== recordKey) {
    // Another issue: what was read for the old one (comment, link, transitions) no longer applies.
    commentState = linkState = 'unknown';
    recordKey = key;
    resetTransitionUi();
  }
  paintActions();
  btnLink.disabled = !authConfigured || !key;
  btnComment.disabled = !authConfigured || !key;
  btnOpenIssue.disabled = !key;
  document.getElementById('head-key').textContent = key;
}

function setActionBusy(isBusy) {
  if (isBusy) {
    // What is in flight belongs to the key it started with.
    issueKeyInputEl.disabled = true;
    btnRefresh.disabled = true;
    btnLink.disabled = true;
    btnComment.disabled = true;
    btnStatusChange.disabled = true;
    return;
  }
  syncActionButtons();
  btnStatusChange.disabled = !issueStatusSelectEl.value;
}

function renderContext(context) {
  currentContext = context;
  // Gerrit subject를 우선 표시; 이슈 조회가 성공하면 Jira 제목으로 대체된다.
  issueTitleEl.textContent = context.subject || '-';
  changeLineEl.textContent = [context.changeNum, context.branch, context.submittedAt ? 'MERGED' : '']
    .filter(Boolean).join(' · ') || '-';
  if (!issueKeyInputEl.value && context.issueKey) {
    issueKeyInputEl.value = context.issueKey;
  }
  syncActionButtons();
}

const toState = (v) => (v === true ? 'has' : v === false ? 'fresh' : 'unknown');

async function checkRecordState(issueKey) {
  recordKey = issueKey;
  try {
    const resp = await sendMessage({ type: MSG.POPUP_CHECK_COMMENT, issueKeyOverride: issueKey });
    // The key may have been edited while this was in flight.
    if (recordKey !== issueKey) return;
    if (resp?.ok) {
      commentState = toState(resp.commented);
      linkState = toState(resp.linked);
    }
  } catch {
    commentState = linkState = 'unknown';
  }
  paintActions();
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
  commentState = linkState = 'unknown';
  paintActions();
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
  btnStatusChange.disabled = true;
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
    if (resp?.ok && getEffectiveIssueKey() === issueKey) renderTransitions(resp.transitions);
  } catch {
    // Transition list is optional UI; issue lookup already reported errors.
  }
}

function closeTransitionForm() {
  transitionFormEl.style.display = 'none';
  transitionFieldsEl.textContent = '';
}

// "Change status": transitions without required fields run right away; the rest
// open a small form, like the dialog Jira shows for Resolved.
function onStatusChangeClicked() {
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
    btnStatusChange.disabled = true;
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
      changeLineEl.textContent = '-';
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

    if (getEffectiveIssueKey() !== issueKey) return;
    renderIssueCard(resp.issue);
    setStatus(I18N.t('popup.status.fetchDone', { key: issueKey }), 'ok');
    await Promise.all([loadTransitions(issueKey), checkRecordState(issueKey)]);
  } catch {
    setStatus(I18N.t('popup.status.requestError'), 'err');
  } finally {
    setActionBusy(false);
  }
}

// Checks shared by the two actions; returns the issue key or '' after telling why.
function actionIssueKey(authKey) {
  if (!authConfigured) {
    setStatus(I18N.t(authKey), 'warn');
    return '';
  }
  const issueKey = getEffectiveIssueKey();
  if (!issueKey) setStatus(I18N.t('popup.status.noIssueKey'), 'warn');
  return issueKey;
}

async function addRemoteLink() {
  // A web link of the same change is overwritten, so a second one changes nothing.
  if (linkState === 'has' || linkState === 'busy') return;
  const issueKey = actionIssueKey('popup.status.authMissingLink');
  if (!issueKey) return;

  setActionBusy(true);
  linkState = 'busy';
  paintActions();
  setStatus(I18N.t('popup.status.addingLink'), '');
  try {
    const resp = await sendMessage({ type: MSG.POPUP_ADD_REMOTE_LINK, issueKeyOverride: issueKey });
    if (!resp?.ok) {
      linkState = 'fresh';
      setStatus(resp?.message || I18N.t('popup.status.linkFailed'), 'err');
      return;
    }
    linkState = 'has';
    setStatus(I18N.t('popup.status.linkDone', { key: issueKey }), 'ok');
  } catch {
    linkState = 'fresh';
    setStatus(I18N.t('popup.status.requestError'), 'err');
  } finally {
    setActionBusy(false);
  }
}

// After a comment on a merged change: preselect the status set in options, so
// "Change status" is one click away. Nothing changes until it is clicked.
function afterComment(issueKey, suggest) {
  commentState = 'has';
  // The preselected status shows in the dropdown above, so the message stays short.
  const option = suggest && [...issueStatusSelectEl.options].find((o) => o.value === suggest.id);
  if (option) issueStatusSelectEl.value = option.value;
  setStatus(I18N.t('popup.status.commentDone', { key: issueKey }), 'ok');
}

// Posts once; if the service worker finds a comment already there, or cannot
// check, asks in the popup and posts again with force.
async function postComment(issueKey, force, commentText) {
  const resp = await sendMessage({ type: MSG.POPUP_ADD_COMMENT, issueKeyOverride: issueKey, force, commentText });
  if (resp?.duplicate || resp?.unknown) {
    const text = resp.duplicate
      ? I18N.t('popup.confirm.duplicateComment', { key: resp.issueKey })
      : I18N.t('popup.confirm.unknownComment', { key: resp.issueKey });
    if (!await askInline(text, I18N.t(resp.duplicate ? 'popup.btn.commentAgain' : 'popup.btn.commentAnyway'))) {
      return { cancelled: true, duplicate: !!resp.duplicate };
    }
    return postComment(issueKey, true, commentText);
  }
  return resp;
}

async function addComment() {
  const issueKey = actionIssueKey('popup.status.authMissingComment');
  if (!issueKey) return;
  // Decided before the confirm and the lock, so a refresh in between cannot flip it.
  const known = commentState;
  setActionBusy(true);
  try {
    if (known === 'has'
      && !await askInline(I18N.t('popup.confirm.duplicateComment', { key: issueKey }), I18N.t('popup.btn.commentAgain'))) {
      return;
    }
    commentState = 'busy';
    paintActions();
    setStatus(I18N.t('popup.status.addingComment'), '');
    const resp = await postComment(issueKey, known === 'has');
    if (resp?.cancelled) {
      commentState = resp.duplicate ? 'has' : known;
      setStatus(I18N.t('popup.status.commentCancelled'), 'warn');
      return;
    }
    if (!resp?.ok) {
      commentState = known;
      setStatus(resp?.message || I18N.t('popup.status.commentFailed'), 'err');
      return;
    }
    afterComment(issueKey, resp.suggest);
  } catch {
    if (commentState === 'busy') commentState = known;
    setStatus(I18N.t('popup.status.requestError'), 'err');
  } finally {
    setActionBusy(false);
  }
}

// -- Editable comment preview ---------------------------------------------------

function closePreview() {
  previewPanelEl.style.display = 'none';
  btnRowEl.style.display = 'grid';
  syncActionButtons();
}

// The preview's key and whether it showed a duplicate / could-not-check warning.
// Submitting a warned preview is the answer to that warning (force); otherwise the
// duplicate check runs again at submit time.
let preview = { key: '', warned: false };

async function openPreview() {
  const issueKey = actionIssueKey('popup.status.authMissing');
  if (!issueKey) return;

  setActionBusy(true);
  setStatus(I18N.t('popup.status.buildingPreview'), '');
  try {
    const resp = await sendMessage({ type: MSG.POPUP_PREVIEW_COMMENT, issueKeyOverride: issueKey });
    if (!resp?.ok) {
      setStatus(resp?.message || I18N.t('popup.status.previewFailed'), 'err');
      return;
    }

    preview = { key: issueKey, warned: resp.duplicate !== false };
    previewTextEl.value = resp.text || '';
    previewDupEl.textContent = resp.duplicate === true ? I18N.t('popup.preview.dup')
      : resp.duplicate == null ? I18N.t('popup.preview.unknown') : '';
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
  const issueKey = preview.key;
  const commentText = previewTextEl.value.trim();
  if (!issueKey) return;
  if (!commentText) {
    setStatus(I18N.t('popup.status.emptyComment'), 'warn');
    return;
  }

  btnPreviewSubmit.disabled = true;
  btnPreviewCancel.disabled = true;
  setStatus(I18N.t('popup.status.submittingComment'), '');
  try {
    const resp = await postComment(issueKey, preview.warned, commentText);
    if (resp?.cancelled) {
      setStatus(I18N.t('popup.status.commentCancelled'), 'warn');
      return;
    }
    if (!resp?.ok) {
      setStatus(resp?.message || I18N.t('popup.status.submitFailed'), 'err');
      return;
    }
    closePreview();
    afterComment(issueKey, resp.suggest);
    paintActions();
    btnStatusChange.disabled = !issueStatusSelectEl.value;
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

// -- Popup size ---------------------------------------------------------------
// Chrome sizes the popup to its content (at most 800 x 600), so dragging the grip
// changes the body width and, on Jira, the list height. Kept per mode.

const SIZE_LIMITS = { minW: 360, maxW: 800, minH: 200, maxH: 440 };
const resizeGripEl = document.getElementById('resize-grip');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function applyPopupSize(size) {
  if (size?.w) document.body.style.width = `${clamp(size.w, SIZE_LIMITS.minW, SIZE_LIMITS.maxW)}px`;
  if (jiraMode && size?.h) gerritListEl.style.maxHeight = `${clamp(size.h, SIZE_LIMITS.minH, SIZE_LIMITS.maxH)}px`;
}

async function restorePopupSize() {
  const { popupSize } = await chrome.storage.local.get(['popupSize']);
  applyPopupSize(popupSize?.[jiraMode ? 'jira' : 'gerrit']);
}

// The list height is its max-height (the CSS default until dragged), not the
// rendered height, which is shorter when there are few changes.
const listMaxHeight = () => parseFloat(gerritListEl.style.maxHeight || getComputedStyle(gerritListEl).maxHeight) || 460;

resizeGripEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  resizeGripEl.setPointerCapture(e.pointerId);
  // screenX/Y, not clientX/Y: the popup window itself moves while it grows.
  const start = { x: e.screenX, y: e.screenY, w: document.body.offsetWidth, h: listMaxHeight() };
  let movedY = false;
  const onMove = (ev) => {
    const dy = ev.screenY - start.y;
    movedY = movedY || Math.abs(dy) > 3;
    applyPopupSize({ w: start.w + ev.screenX - start.x, h: movedY ? start.h + dy : 0 });
  };
  const onEnd = async () => {
    resizeGripEl.removeEventListener('pointermove', onMove);
    resizeGripEl.removeEventListener('lostpointercapture', onEnd);
    const { popupSize } = await chrome.storage.local.get(['popupSize']);
    const mode = jiraMode ? 'jira' : 'gerrit';
    const size = { ...popupSize?.[mode], w: document.body.offsetWidth };
    if (jiraMode && movedY) size.h = listMaxHeight();
    chrome.storage.local.set({ popupSize: { ...popupSize, [mode]: size } });
  };
  resizeGripEl.addEventListener('pointermove', onMove);
  // Fires after pointerup too, and when capture is lost without one.
  resizeGripEl.addEventListener('lostpointercapture', onEnd);
});

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
  document.getElementById('head-key').textContent = key;
  if (!key) {
    setStatus(I18N.t('popup.status.enterIssueKeyJira'), 'warn');
    return;
  }
  btnRefresh.disabled = true;
  issueKeyInputEl.disabled = true;
  setStatus(I18N.t('gerrit.loading'), '');
  try {
    const resp = await sendMessage({ type: MSG.GET_GERRIT_CHANGES, issueKey: key });
    if (getEffectiveIssueKey() !== key) return;
    if (!resp?.ok) {
      setStatus(resp?.message || I18N.t('popup.status.requestError'), 'err');
      return;
    }
    if (!resp.signedIn) setStatus(I18N.t('gerrit.notSignedIn'), 'warn');
    else setStatus('', '');
    if (!resp.changes.length) {
      if (resp.signedIn) appendGerritNote(I18N.t('gerrit.empty'));
      if (resp.loginUrl) appendGerritLink(resp.loginUrl, I18N.t('gerrit.signIn'));
      return;
    }
    self.ChangeList.render(gerritListEl, { issueKey: key, resp, send: sendMessage });
  } catch {
    setStatus(I18N.t('popup.status.requestError'), 'err');
  } finally {
    btnRefresh.disabled = false;
    issueKeyInputEl.disabled = false;
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

btnLink.addEventListener('click', addRemoteLink);
btnComment.addEventListener('click', () => {
  // A second click while the confirm is open would leave the first one unanswered.
  if (commentState === 'busy' || confirmEl.classList.contains('open')) return;
  if (previewEnabled) openPreview();
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
// Picking a status only arms the button; nothing changes until it is clicked.
issueStatusSelectEl.addEventListener('change', () => {
  closeTransitionForm();
  btnStatusChange.disabled = !issueStatusSelectEl.value || btnRefresh.disabled;
});
btnStatusChange.addEventListener('click', onStatusChangeClicked);
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
  const style = document.createElement('style');
  style.textContent = self.ChangeList.CSS;
  document.head.appendChild(style);
  currentContext = null;
  authConfigured = true;
  syncActionButtons();
  await loadAuthState();
  const jiraTab = await getJiraTab();
  jiraMode = jiraTab.onJira;
  if (jiraMode) document.body.classList.add('jira-mode');
  await Promise.all([loadFabSetting(), restorePopupSize()]);
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
