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

chrome.storage.local.get(
  [
    'gerritOrigin', 'jiraBase',
    'jiraEmail', 'jiraToken', 'commentTemplate',
    'previewEnabled', 'showStatusPill',
    'applyTransitionEnabled', 'applyTransitionName', 'fabActions',
  ],
  ({
    gerritOrigin, jiraBase,
    jiraEmail, jiraToken, commentTemplate,
    previewEnabled, showStatusPill,
    applyTransitionEnabled, applyTransitionName, fabActions,
  }) => {
    if (gerritOrigin) gerritUrlEl.value = gerritOrigin;
    if (jiraBase) jiraUrlEl.value = jiraBase;
    if (jiraEmail) emailEl.value = jiraEmail;
    if (jiraToken) tokenEl.value = jiraToken;
    // Show saved template; initialize with default when not set yet.
    templateEl.value = commentTemplate ?? DEFAULT_TEMPLATE;

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

function setTransitionOptions(statuses, selected) {
  optTransitionNameEl.innerHTML = '';
  const offOption = document.createElement('option');
  offOption.value = '';
  offOption.textContent = '사용 안 함';
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
  btnTokenVisibility.setAttribute('aria-label', show ? '토큰 숨기기' : '토큰 표시');
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
    setStatus('Gerrit 주소는 https://gerrit.example.com 형식으로 입력하세요.', 'err');
    return;
  }
  if (jiraUrlEl.value.trim() && !jiraBase) {
    setStatus('Jira 주소는 https://yourcompany.atlassian.net 형식으로 입력하세요.', 'err');
    return;
  }

  const wanted = [];
  if (gerritOrigin) wanted.push(`${gerritOrigin}/*`);
  if (jiraBase) wanted.push(`${jiraBase}/*`);
  if (wanted.length && !(await requestSitePermissions(wanted))) {
    setStatus('사이트 접근 권한이 없으면 동작하지 않습니다. 저장을 다시 눌러 허용하세요.', 'err');
    return;
  }

  if ((email && !token) || (!email && token)) {
    setStatus('이메일과 토큰은 함께 입력하거나 둘 다 비워두세요.', 'err');
    return;
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setStatus('올바른 이메일 형식을 입력하세요.', 'err');
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
  };
  if (email && token) {
    payload.jiraEmail = email;
    payload.jiraToken = token;
  }

  // Persisted to local storage only — no sync, no logging.
  chrome.storage.local.set(payload, () => {
    if (chrome.runtime.lastError) {
      setStatus('저장 중 오류가 발생했습니다.', 'err');
      return;
    }

    // Re-register the Gerrit content script for the newly saved host.
    notifySitesChanged();

    // When fields are empty, clear previously saved credentials.
    if (!email && !token) {
      chrome.storage.local.remove(['jiraEmail', 'jiraToken'], () => {
        if (chrome.runtime.lastError) {
          setStatus('저장 중 오류가 발생했습니다.', 'err');
          return;
        }
        setStatus('저장되었습니다.', 'ok', 3000);
      });
      return;
    }

    setStatus('저장되었습니다.', 'ok', 3000);
  });
});

// ── Reset template ─────────────────────────────────────────────────────────────

btnReset.addEventListener('click', () => {
  templateEl.value = DEFAULT_TEMPLATE;
  setStatus('기본 템플릿으로 초기화됐습니다. 저장 버튼을 눌러 적용하세요.', 'inf', 4000);
});

// ── Connection test ───────────────────────────────────────────────────────────
// The actual fetch is done inside the service worker (handleTestConnection).
// This page only sends the current field values and receives the HTTP status.

btnTest.addEventListener('click', async () => {
  const email = emailEl.value.trim();
  const token = tokenEl.value.trim();

  if (!email || !token) {
    setStatus('이메일과 토큰을 입력한 뒤 테스트하세요.', 'err');
    return;
  }

  btnTest.disabled = true;
  setStatus('테스트 중…', 'inf');

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
    setStatus('서비스 워커와 통신할 수 없습니다. 확장프로그램을 재로드하세요.', 'err');
    btnTest.disabled = false;
    return;
  }

  if (result.noSite) {
    setStatus('Jira 주소를 입력하고 저장한 뒤 테스트하세요.', 'err');
  } else if (result.networkError) {
    setStatus('네트워크 오류: 인터넷 연결을 확인하세요.', 'err');
  } else if (result.status === 200) {
    // Passing the test but forgetting 저장 was a recurring trap — persist
    // the verified credentials immediately.
    chrome.storage.local.set({ jiraEmail: email, jiraToken: token }, () => {
      if (chrome.runtime.lastError) {
        setStatus('연결 성공 (200 OK) — 자동 저장 실패. 저장 버튼을 눌러주세요.', 'err');
        return;
      }
      setStatus('연결 성공 (200 OK) — 인증 정보가 자동 저장되었습니다.', 'ok');
    });
  } else if (result.status === 401) {
    const lines = ['인증 실패 (401) — 이메일 또는 토큰을 확인하세요.'];
    if (result.reason === 'EMPTY_INPUT') {
      lines.push('이메일 또는 토큰이 비어 있는 상태로 전송되었습니다.');
    } else {
      lines.push(`전송된 값: 이메일 ${result.emailLength}자 / 토큰 ${result.tokenLength}자`);
      if (result.reason) lines.push(`서버 사유: ${result.reason}`);
    }
    if (result.denied) {
      lines.push(`추가 사유: ${result.denied} — CAPTCHA 잠금일 수 있습니다. 브라우저에서 Jira에 로그인한 뒤 다시 시도하세요.`);
    }
    if (result.headerNames) {
      lines.push(`응답 헤더: ${result.headerNames}`);
    }
    setStatus(lines.join('\n'), 'err');
  } else if (result.status === 403) {
    setStatus('권한 부족 (403) — 계정에 API 접근 권한이 없습니다.', 'err');
  } else {
    setStatus(`예상치 못한 응답 코드: ${result.status}`, 'err');
  }

  btnTest.disabled = false;
});
