// service_worker.js
// All network requests (Jira API) are handled here only.
// No DOM access. No logging of credentials, tokens, or Authorization headers.

'use strict';

// ── Allowlists (minimal, fixed) ───────────────────────────────────────────────

const GERRIT_ORIGINS = [
  'http://gerrit.example.com',
  'https://gerrit.example.com',
];

/** Single allowed Jira base URL. Never interpolated from user/page input. */
const JIRA_BASE = 'https://yourcompany.atlassian.net';

// ── Validation helpers ────────────────────────────────────────────────────────

/** Returns true when the tab URL belongs to the allowed Gerrit instance. */
function isGerritTab(url) {
  try {
    return GERRIT_ORIGINS.includes(new URL(url).origin);
  } catch {
    return false;
  }
}

/**
 * Validates that a Jira issue key is structurally correct.
 * Prevents path-traversal or injection via the key segment in the API URL.
 *
 * @param {string} key
 * @returns {boolean}
 */
function isValidIssueKey(key) {
  return typeof key === 'string' && /^[A-Z][A-Z0-9]+-\d+$/.test(key);
}

/**
 * Validates that a change URL originates from the allowed Gerrit domains.
 * The content script is sandboxed to Gerrit pages, but we re-validate here
 * so the Jira comment never contains a URL from an unexpected origin.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isAllowedChangeUrl(url) {
  try {
    return GERRIT_ORIGINS.includes(new URL(url).origin);
  } catch {
    return false;
  }
}

// ── Messaging helpers ─────────────────────────────────────────────────────────

/**
 * Send a message to the content script running in `tabId`.
 * Resolves with the response or rejects if the content script is not ready.
 */
function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

/** Fire-and-forget toast helper (errors silently discarded). */
function toastTab(tabId, message, toastType = 'error') {
  chrome.tabs.sendMessage(tabId, { type: 'SHOW_TOAST', message, toastType });
}

// ── Action click handler ──────────────────────────────────────────────────────

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url || !isGerritTab(tab.url)) {
    toastTab(tab.id, 'Gerrit change 페이지에서만 사용할 수 있습니다.', 'warn');
    return;
  }
  await handleGerritAction(tab);
});

// ── Main orchestration ────────────────────────────────────────────────────────

/**
 * Full pipeline for a valid Gerrit tab:
 *   1. Extract subject / issueKey / url via the content script.
 *   2. Validate extracted data (key format, URL origin).
 *   3. Load credentials from chrome.storage.local.
 *   4. POST ADF comment to Jira (status code only used; body discarded).
 *   5. Show result toast.
 */
async function handleGerritAction(tab) {
  // ── Step 1: page info extraction ──────────────────────────────────────────
  let info;
  try {
    info = await sendToTab(tab.id, { type: 'EXTRACT_INFO' });
  } catch {
    toastTab(
      tab.id,
      '페이지 정보를 읽을 수 없습니다. 페이지를 새로고침 후 다시 시도하세요.',
    );
    return;
  }

  const { subject = '', issueKey, url } = info ?? {};

  // ── Step 2: validate extracted values ─────────────────────────────────────
  if (!isValidIssueKey(issueKey)) {
    toastTab(
      tab.id,
      '이슈 키를 찾지 못했습니다 (예: PROJ-123). 제목 또는 커밋 메시지에 "jira: KEY" 형식으로 추가하세요.',
      'warn',
    );
    return;
  }

  if (!isAllowedChangeUrl(url)) {
    toastTab(tab.id, '현재 페이지 URL이 허용된 Gerrit 도메인이 아닙니다.');
    return;
  }

  // Sanitise subject: trim whitespace, cap length to prevent oversized comments.
  const safeSubject = String(subject).trim().slice(0, 500) || '(no title)';

  // ── Step 3: load credentials ───────────────────────────────────────────────
  const { jiraEmail, jiraToken } = await loadCredentials();

  if (!jiraEmail || !jiraToken) {
    toastTab(
      tab.id,
      'Jira 이메일/토큰이 설정되지 않았습니다. 확장프로그램 옵션 페이지에서 설정하세요.',
    );
    return;
  }

  // ── Step 4: POST comment ───────────────────────────────────────────────────
  let status;
  try {
    status = await postJiraComment(issueKey, url, safeSubject, jiraEmail, jiraToken);
  } catch {
    toastTab(tab.id, '네트워크 오류가 발생했습니다. 인터넷 연결을 확인하세요.');
    return;
  }

  // ── Step 5: report result ──────────────────────────────────────────────────
  if (status === 201) {
    toastTab(tab.id, `Jira 댓글 추가 완료: ${issueKey}`, 'success');
  } else {
    toastTab(tab.id, mapJiraError(status));
  }
}

// ── Storage ───────────────────────────────────────────────────────────────────

function loadCredentials() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['jiraEmail', 'jiraToken'], resolve);
  });
}

// ── Jira API ──────────────────────────────────────────────────────────────────

/**
 * POST an ADF comment to the specified Jira issue.
 *
 * Security notes:
 *   - JIRA_BASE is a fixed constant — never derived from user/page input.
 *   - issueKey is validated by isValidIssueKey() before reaching this function.
 *   - The Authorization header and credentials are NEVER logged.
 *   - Only the HTTP status code is returned; the response body is discarded.
 *
 * @param {string} issueKey  e.g. "PROJ-123"
 * @param {string} changeUrl validated Gerrit change URL
 * @param {string} subject   sanitised change title (max 500 chars)
 * @param {string} email     Jira account email
 * @param {string} token     Jira API token
 * @returns {Promise<number>} HTTP status code
 */
async function postJiraComment(issueKey, changeUrl, subject, email, token) {
  const apiUrl =
    `${JIRA_BASE}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`;

  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      // Authorization header is constructed only here, in the service worker.
      Authorization: `Basic ${btoa(`${email}:${token}`)}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(buildAdfComment(changeUrl, subject)),
  });

  return resp.status;
}

/**
 * Builds an Atlassian Document Format (ADF) comment body.
 *
 * Rendered output (Jira Cloud):
 *   [auto:gerrit] Gerrit change: <linked URL>
 *   Title: <subject>
 *
 * @param {string} changeUrl
 * @param {string} subject
 * @returns {object} ADF comment payload
 */
function buildAdfComment(changeUrl, subject) {
  return {
    body: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '[auto:gerrit] Gerrit change: ' },
            {
              type: 'text',
              text: changeUrl,
              marks: [{ type: 'link', attrs: { href: changeUrl } }],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: `Title: ${subject}` }],
        },
      ],
    },
  };
}

/**
 * Maps Jira HTTP status codes to user-friendly Korean error messages.
 * Only the status code is exposed — never the response body.
 *
 * @param {number} status
 * @returns {string}
 */
function mapJiraError(status) {
  switch (status) {
    case 400: return '잘못된 요청 (400): ADF 형식 또는 이슈 키를 확인하세요.';
    case 401: return '인증 실패 (401): Jira 이메일 또는 API 토큰을 확인하세요.';
    case 403: return '권한 없음 (403): 해당 이슈에 코멘트 권한이 없습니다.';
    case 404: return '이슈를 찾을 수 없음 (404): 이슈 키 또는 Jira 프로젝트를 확인하세요.';
    case 429: return '요청 제한 초과 (429): 잠시 후 다시 시도하세요.';
    default:  return `Jira API 오류: HTTP ${status}`;
  }
}

// ── Connection test (from options page) ───────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'TEST_CONNECTION') {
    handleTestConnection(msg.email, msg.token).then(sendResponse);
    return true; // keep the message channel open for the async response
  }
});

/**
 * Tests Jira credentials via GET /rest/api/3/myself.
 * Returns only { status } — the response body is completely discarded.
 * Called exclusively by the options page via chrome.runtime.sendMessage.
 *
 * @param {string} email
 * @param {string} token
 * @returns {Promise<{status: number|null, networkError?: boolean}>}
 */
async function handleTestConnection(email, token) {
  try {
    const resp = await fetch(`${JIRA_BASE}/rest/api/3/myself`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${btoa(`${email}:${token}`)}`,
        Accept: 'application/json',
      },
    });
    return { status: resp.status };
  } catch {
    return { status: null, networkError: true };
  }
}
