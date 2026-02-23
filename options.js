// options.js
// Handles options page UI: load/save credentials, run connection test.
//
// Security rules enforced here:
//   - chrome.storage.local only (no sync).
//   - Token/email values are NEVER written to console or any log.
//   - Connection test is routed through the background service worker so that
//     the Authorization header is only constructed in the service worker context.

'use strict';

const emailEl  = /** @type {HTMLInputElement} */ (document.getElementById('email'));
const tokenEl  = /** @type {HTMLInputElement} */ (document.getElementById('token'));
const statusEl = document.getElementById('status');
const btnSave  = document.getElementById('btn-save');
const btnTest  = document.getElementById('btn-test');

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

chrome.storage.local.get(['jiraEmail', 'jiraToken'], ({ jiraEmail, jiraToken }) => {
  if (jiraEmail) emailEl.value = jiraEmail;
  if (jiraToken) tokenEl.value = jiraToken;
});

// ── Save ──────────────────────────────────────────────────────────────────────

btnSave.addEventListener('click', () => {
  const email = emailEl.value.trim();
  const token = tokenEl.value.trim();

  if (!email || !token) {
    setStatus('이메일과 토큰을 모두 입력하세요.', 'err');
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setStatus('올바른 이메일 형식을 입력하세요.', 'err');
    return;
  }

  // Persisted to local storage only — no sync, no logging.
  chrome.storage.local.set({ jiraEmail: email, jiraToken: token }, () => {
    if (chrome.runtime.lastError) {
      setStatus('저장 중 오류가 발생했습니다.', 'err');
      return;
    }
    setStatus('저장되었습니다.', 'ok', 3000);
  });
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
        { type: 'TEST_CONNECTION', email, token },
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
    setStatus('인증 실패 (401) — 이메일 또는 토큰을 확인하세요.', 'err');
  } else if (result.status === 403) {
    setStatus('권한 부족 (403) — 계정에 API 접근 권한이 없습니다.', 'err');
  } else {
    setStatus(`예상치 못한 응답 코드: ${result.status}`, 'err');
  }

  btnTest.disabled = false;
});
