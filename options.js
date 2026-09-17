// options.js
// Handles options page UI: load/save credentials, run connection test.
//
// Security rules enforced here:
//   - chrome.storage.local only (no sync).
//   - Token/email values are NEVER written to console or any log.
//   - Connection test is routed through the background service worker so that
//     the Authorization header is only constructed in the service worker context.

'use strict';

const MSG = self.MESSAGE_TYPES;

const gerritUrlEl = /** @type {HTMLInputElement} */ (document.getElementById('gerrit-url'));
const jiraUrlEl   = /** @type {HTMLInputElement} */ (document.getElementById('jira-url'));
const emailEl    = /** @type {HTMLInputElement}  */ (document.getElementById('email'));
const tokenEl    = /** @type {HTMLInputElement}  */ (document.getElementById('token'));
const templateEl = /** @type {HTMLTextAreaElement} */ (document.getElementById('template'));
const statusEl   = document.getElementById('status');
const btnSave    = document.getElementById('btn-save');
const btnTest    = document.getElementById('btn-test');
const btnReset   = document.getElementById('btn-reset');
const btnTokenVisibility = document.getElementById('btn-token-visibility');

const optPreviewEl        = /** @type {HTMLInputElement} */ (document.getElementById('opt-preview'));
const optPillEl           = /** @type {HTMLInputElement} */ (document.getElementById('opt-pill'));
const optTransitionNameEl = /** @type {HTMLSelectElement} */ (document.getElementById('opt-transition-name'));
const uiLanguageEl        = /** @type {HTMLSelectElement} */ (document.getElementById('ui-language'));

const FAB_ACTION_INPUTS = {
  openIssue: /** @type {HTMLInputElement} */ (document.getElementById('fab-open-issue')),
  lookup:    /** @type {HTMLInputElement} */ (document.getElementById('fab-lookup')),
  link:      /** @type {HTMLInputElement} */ (document.getElementById('fab-link')),
  comment:   /** @type {HTMLInputElement} */ (document.getElementById('fab-comment')),
  apply:     /** @type {HTMLInputElement} */ (document.getElementById('fab-apply')),
  options:   /** @type {HTMLInputElement} */ (document.getElementById('fab-options')),
};

// Must match DEFAULT_TEMPLATE in service_worker.js
const DEFAULT_TEMPLATE =
`{title}

{body}

브랜치: {branch}
반영 일시: {date}
Gerrit: {url}
Change-Id: {change_id}`;

// ── Status helper ─────────────────────────────────────────────────────────────

/**
 * @param {string} msg
 * @param {'ok'|'err'|'inf'} cls
 * @param {number} [autoClearMs] if set, clears status after this many ms
 */
function setStatus(msg, cls, autoClearMs) {
  statusEl.textContent = msg;
  statusEl.className   = cls;
  if (autoClearMs) {
    setTimeout(() => { statusEl.textContent = ''; statusEl.className = ''; }, autoClearMs);
  }
}

// ── Load saved values on page open ───────────────────────────────────────────

I18N.init(() => {
  document.documentElement.lang = I18N.getLang();
  I18N.applyDom();

  chrome.storage.local.get(
    [
      'gerritOrigin', 'jiraBase',
      'jiraEmail', 'jiraToken', 'commentTemplate',
      'previewEnabled', 'showStatusPill',
      'applyTransitionEnabled', 'applyTransitionName', 'fabActions',
      'uiLanguage',
    ],
    ({
      gerritOrigin, jiraBase,
      jiraEmail, jiraToken, commentTemplate,
      previewEnabled, showStatusPill,
      applyTransitionEnabled, applyTransitionName, fabActions,
      uiLanguage,
    }) => {
      if (gerritOrigin) gerritUrlEl.value = gerritOrigin;
      if (jiraBase) jiraUrlEl.value = jiraBase;
      if (jiraEmail) emailEl.value = jiraEmail;
      if (jiraToken) tokenEl.value = jiraToken;
      // Show saved template; initialize with default when not set yet.
      templateEl.value = commentTemplate ?? DEFAULT_TEMPLATE;

      uiLanguageEl.value = uiLanguage || 'auto';

      optPreviewEl.checked = previewEnabled !== false;
      optPillEl.checked = showStatusPill !== false;

      const savedTransition = applyTransitionEnabled ? String(applyTransitionName || '') : '';
      setTransitionOptions(savedTransition ? [savedTransition] : [], savedTransition);

      const actions = fabActions || {};
      for (const [key, el] of Object.entries(FAB_ACTION_INPUTS)) {
        el.checked = actions[key] !== false;
      }

      // Populate the status combo from the Jira site when credentials exist.
      if (jiraEmail && jiraToken) loadStatusOptions(savedTransition);
    },
  );
});

// Switching the combo repaints the page right away, before the save button is
// pressed; btnSave persists the choice.
uiLanguageEl.addEventListener('change', () => {
  document.documentElement.lang = I18N.setLang(uiLanguageEl.value);
  I18N.applyDom();
  setTransitionOptions([...optTransitionNameEl.options].map((o) => o.value), optTransitionNameEl.value);
});

function setTransitionOptions(statuses, selected) {
  optTransitionNameEl.innerHTML = '';
  const offOption = document.createElement('option');
  offOption.value = '';
  offOption.textContent = I18N.t('options.transition.off');
  optTransitionNameEl.appendChild(offOption);

  const names = [...new Set(statuses.filter(Boolean))];
  if (selected && !names.includes(selected)) names.unshift(selected);

  for (const name of names) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    optTransitionNameEl.appendChild(option);
  }
  optTransitionNameEl.value = selected || '';
}

function loadStatusOptions(selected) {
  chrome.runtime.sendMessage({ type: MSG.GET_JIRA_STATUSES }, (resp) => {
    if (chrome.runtime.lastError || !resp?.ok) return;
    const current = optTransitionNameEl.value || selected || '';
    setTransitionOptions(resp.statuses || [], current);
  });
}

// ── Token visibility ──────────────────────────────────────────────────────────

btnTokenVisibility.addEventListener('click', () => {
  const show = tokenEl.type === 'password';
  tokenEl.type = show ? 'text' : 'password';
  btnTokenVisibility.classList.toggle('on', show);
  btnTokenVisibility.setAttribute('aria-pressed', String(show));
  // Keep the key on the element so a later applyDom() does not revert the label.
  btnTokenVisibility.dataset.i18nLabel = show ? 'options.a11y.hideToken' : 'options.a11y.showToken';
  btnTokenVisibility.setAttribute('aria-label', I18N.t(btnTokenVisibility.dataset.i18nLabel));
});

// ── Site URLs ─────────────────────────────────────────────────────────────────

/** @returns {string} origin without trailing slash, or '' when invalid */
function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.origin;
  } catch {
    return '';
  }
}

/**
 * Host permissions are optional in the manifest, so they must be requested from
 * inside the click handler: Chrome rejects the prompt without a user gesture.
 */
function requestSitePermissions(origins) {
  return new Promise((resolve) => {
    chrome.permissions.request({ origins }, (granted) => {
      resolve(!chrome.runtime.lastError && granted);
    });
  });
}

function notifySitesChanged() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: MSG.SET_SITES }, (response) => {
      resolve(!chrome.runtime.lastError && response);
    });
  });
}

// ── Save ──────────────────────────────────────────────────────────────────────

btnSave.addEventListener('click', async () => {
  const email = emailEl.value.trim();
  const token = tokenEl.value.trim();

  const gerritOrigin = normalizeOrigin(gerritUrlEl.value);
  const jiraBase = normalizeOrigin(jiraUrlEl.value);

  if (gerritUrlEl.value.trim() && !gerritOrigin) {
    setStatus(I18N.t('options.status.badGerritUrl'), 'err');
    return;
  }
  if (jiraUrlEl.value.trim() && !jiraBase) {
    setStatus(I18N.t('options.status.badJiraUrl'), 'err');
    return;
  }

  const wanted = [];
  if (gerritOrigin) wanted.push(`${gerritOrigin}/*`);
  if (jiraBase) wanted.push(`${jiraBase}/*`);
  if (wanted.length && !(await requestSitePermissions(wanted))) {
    setStatus(I18N.t('options.status.noPermission'), 'err');
    return;
  }

  if ((email && !token) || (!email && token)) {
    setStatus(I18N.t('options.status.credPair'), 'err');
    return;
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setStatus(I18N.t('options.status.badEmail'), 'err');
    return;
  }

  // commentTemplate: empty string means "use default" (service worker handles this)
  const templateVal = templateEl.value; // preserve as-is, including empty

  const fabActions = {};
  for (const [key, el] of Object.entries(FAB_ACTION_INPUTS)) {
    fabActions[key] = el.checked;
  }

  const transitionName = optTransitionNameEl.value.trim();
  const payload = {
    gerritOrigin,
    jiraBase,
    commentTemplate: templateVal,
    previewEnabled: optPreviewEl.checked,
    showStatusPill: optPillEl.checked,
    applyTransitionEnabled: !!transitionName,
    applyTransitionName: transitionName,
    fabActions,
    uiLanguage: uiLanguageEl.value,
  };
  if (email && token) {
    payload.jiraEmail = email;
    payload.jiraToken = token;
  }

  // Persisted to local storage only — no sync, no logging.
  chrome.storage.local.set(payload, () => {
    if (chrome.runtime.lastError) {
      setStatus(I18N.t('options.status.saveError'), 'err');
      return;
    }

    // Re-register the Gerrit content script for the newly saved host.
    notifySitesChanged();

    // When fields are empty, clear previously saved credentials.
    if (!email && !token) {
      chrome.storage.local.remove(['jiraEmail', 'jiraToken'], () => {
        if (chrome.runtime.lastError) {
          setStatus(I18N.t('options.status.saveError'), 'err');
          return;
        }
        setStatus(I18N.t('options.status.saved'), 'ok', 3000);
      });
      return;
    }

    setStatus(I18N.t('options.status.saved'), 'ok', 3000);
  });
});

// ── Reset template ─────────────────────────────────────────────────────────────

btnReset.addEventListener('click', () => {
  templateEl.value = DEFAULT_TEMPLATE;
  setStatus(I18N.t('options.status.resetDone'), 'inf', 4000);
});

// ── Connection test ───────────────────────────────────────────────────────────
// The actual fetch is done inside the service worker (handleTestConnection).
// This page only sends the current field values and receives the HTTP status.

btnTest.addEventListener('click', async () => {
  const email = emailEl.value.trim();
  const token = tokenEl.value.trim();

  if (!email || !token) {
    setStatus(I18N.t('options.status.needCreds'), 'err');
    return;
  }

  btnTest.disabled = true;
  setStatus(I18N.t('options.status.testing'), 'inf');

  let result;
  try {
    // Delegate the network call to the service worker.
    // The service worker discards the response body and returns only { status }.
    result = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: MSG.TEST_CONNECTION, email, token },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        }
      );
    });
  } catch {
    setStatus(I18N.t('options.status.swUnreachable'), 'err');
    btnTest.disabled = false;
    return;
  }

  if (result.noSite) {
    setStatus(I18N.t('options.status.noSite'), 'err');
  } else if (result.networkError) {
    setStatus(I18N.t('options.status.networkError'), 'err');
  } else if (result.status === 200) {
    // Passing the test but forgetting 저장 was a recurring trap — persist
    // the verified credentials immediately.
    chrome.storage.local.set({ jiraEmail: email, jiraToken: token }, () => {
      if (chrome.runtime.lastError) {
        setStatus(I18N.t('options.status.testOkSaveFailed'), 'err');
        return;
      }
      setStatus(I18N.t('options.status.testOkSaved'), 'ok');
    });
  } else if (result.status === 401) {
    const lines = [I18N.t('options.status.auth401')];
    if (result.reason === 'EMPTY_INPUT') {
      lines.push(I18N.t('options.status.emptyInput'));
    } else {
      lines.push(I18N.t('options.status.sentLengths', { email: result.emailLength, token: result.tokenLength }));
      if (result.reason) lines.push(I18N.t('options.status.serverReason', { reason: result.reason }));
    }
    if (result.denied) {
      lines.push(I18N.t('options.status.denied', { reason: result.denied }));
    }
    if (result.headerNames) {
      lines.push(I18N.t('options.status.respHeaders', { headers: result.headerNames }));
    }
    setStatus(lines.join('\n'), 'err');
  } else if (result.status === 403) {
    setStatus(I18N.t('options.status.forbidden'), 'err');
  } else {
    setStatus(I18N.t('options.status.unexpected', { status: result.status }), 'err');
  }

  btnTest.disabled = false;
});
