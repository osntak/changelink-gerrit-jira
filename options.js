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

const emailEl    = /** @type {HTMLInputElement}  */ (document.getElementById('email'));
const tokenEl    = /** @type {HTMLInputElement}  */ (document.getElementById('token'));
const templateEl = /** @type {HTMLTextAreaElement} */ (document.getElementById('template'));
const statusEl   = document.getElementById('status');
const btnSave    = document.getElementById('btn-save');
const btnTest    = document.getElementById('btn-test');
const btnReset   = document.getElementById('btn-reset');

const optPreviewEl        = /** @type {HTMLInputElement} */ (document.getElementById('opt-preview'));
const optPillEl           = /** @type {HTMLInputElement} */ (document.getElementById('opt-pill'));
const optTransitionEl     = /** @type {HTMLInputElement} */ (document.getElementById('opt-transition'));
const optTransitionNameEl = /** @type {HTMLInputElement} */ (document.getElementById('opt-transition-name'));

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
    'jiraEmail', 'jiraToken', 'commentTemplate',
    'previewEnabled', 'showStatusPill',
    'applyTransitionEnabled', 'applyTransitionName', 'fabActions',
  ],
  ({
    jiraEmail, jiraToken, commentTemplate,
    previewEnabled, showStatusPill,
    applyTransitionEnabled, applyTransitionName, fabActions,
  }) => {
    if (jiraEmail) emailEl.value = jiraEmail;
    if (jiraToken) tokenEl.value = jiraToken;
    // Show saved template; initialize with default when not set yet.
    templateEl.value = commentTemplate ?? DEFAULT_TEMPLATE;

    optPreviewEl.checked = previewEnabled !== false;
    optPillEl.checked = showStatusPill !== false;
    optTransitionEl.checked = !!applyTransitionEnabled;
    optTransitionNameEl.value = applyTransitionName || '';

    const actions = fabActions || {};
    for (const [key, el] of Object.entries(FAB_ACTION_INPUTS)) {
      el.checked = actions[key] !== false;
    }

    // Populate the status combo suggestions when credentials are available.
    if (jiraEmail && jiraToken) loadStatusSuggestions();
  },
);

function loadStatusSuggestions() {
  chrome.runtime.sendMessage({ type: MSG.GET_JIRA_STATUSES }, (resp) => {
    if (chrome.runtime.lastError || !resp?.ok) return;
    const datalist = document.getElementById('status-options');
    if (!datalist) return;
    datalist.innerHTML = '';
    for (const name of resp.statuses || []) {
      const option = document.createElement('option');
      option.value = name;
      datalist.appendChild(option);
    }
  });
}

// ── Save ──────────────────────────────────────────────────────────────────────

btnSave.addEventListener('click', () => {
  const email = emailEl.value.trim();
  const token = tokenEl.value.trim();

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

  const payload = {
    commentTemplate: templateVal,
    previewEnabled: optPreviewEl.checked,
    showStatusPill: optPillEl.checked,
    applyTransitionEnabled: optTransitionEl.checked,
    applyTransitionName: optTransitionNameEl.value.trim(),
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

  if (result.networkError) {
    setStatus('네트워크 오류: 인터넷 연결을 확인하세요.', 'err');
  } else if (result.status === 200) {
    setStatus('연결 성공 (200 OK) — 인증이 정상입니다.', 'ok');
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
