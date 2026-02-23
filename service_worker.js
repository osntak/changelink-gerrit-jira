// service_worker.js
// All network requests (Jira API) are handled here only.
// No DOM access. No logging of credentials or tokens.

const GERRIT_ORIGINS = [
  'http://gerrit.example.com',
  'https://gerrit.example.com',
];

/** Returns true when the tab URL belongs to the Gerrit instance. */
function isGerritTab(url) {
  try {
    return GERRIT_ORIGINS.includes(new URL(url).origin);
  } catch {
    return false;
  }
}

/**
 * Send a message to the content script in the given tab.
 * Returns a Promise that resolves with the response.
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

// ── Action click handler ──────────────────────────────────────────────────────
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url || !isGerritTab(tab.url)) {
    // Best-effort toast on non-Gerrit pages; may silently fail if no content script.
    chrome.tabs.sendMessage(tab.id, {
      type: 'SHOW_TOAST',
      message: 'Gerrit change 페이지에서만 사용할 수 있습니다.',
      toastType: 'warn',
    });
    return;
  }

  await handleGerritAction(tab);
});

/**
 * Orchestrates the full flow for a Gerrit tab:
 *   1. Extract page info via content script.
 *   2. Validate credentials from local storage.
 *   3. POST ADF comment to Jira.
 *   4. Show result toast via content script.
 */
async function handleGerritAction(tab) {
  // Step 1: extract subject / issueKey / url from the page
  let info;
  try {
    info = await sendToTab(tab.id, { type: 'EXTRACT_INFO' });
  } catch {
    chrome.tabs.sendMessage(tab.id, {
      type: 'SHOW_TOAST',
      message:
        '페이지 정보를 읽을 수 없습니다. 페이지를 새로고침 후 다시 시도하세요.',
      toastType: 'error',
    });
    return;
  }

  const { subject, issueKey, url } = info ?? {};

  if (!issueKey) {
    sendToTab(tab.id, {
      type: 'SHOW_TOAST',
      message:
        '이슈 키를 찾지 못했습니다 (예: PROJ-123). 제목 또는 커밋 메시지에 "jira: KEY" 형식으로 추가하세요.',
      toastType: 'warn',
    });
    return;
  }

  // Step 2: load credentials from local storage
  const { jiraEmail, jiraToken } = await loadCredentials();

  if (!jiraEmail || !jiraToken) {
    sendToTab(tab.id, {
      type: 'SHOW_TOAST',
      message:
        'Jira 이메일/토큰이 설정되지 않았습니다. 옵션 페이지에서 설정하세요.',
      toastType: 'error',
    });
    return;
  }

  // Step 3: POST comment to Jira
  let status;
  try {
    status = await postJiraComment(issueKey, url, subject, jiraEmail, jiraToken);
  } catch {
    sendToTab(tab.id, {
      type: 'SHOW_TOAST',
      message: '네트워크 오류가 발생했습니다. 인터넷 연결을 확인하세요.',
      toastType: 'error',
    });
    return;
  }

  // Step 4: report result
  if (status === 201) {
    sendToTab(tab.id, {
      type: 'SHOW_TOAST',
      message: `Jira 댓글 추가 완료: ${issueKey}`,
      toastType: 'success',
    });
  } else {
    sendToTab(tab.id, {
      type: 'SHOW_TOAST',
      message: mapJiraError(status),
      toastType: 'error',
    });
  }
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function loadCredentials() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['jiraEmail', 'jiraToken'], resolve);
  });
}

// ── Jira API ──────────────────────────────────────────────────────────────────

const JIRA_BASE = 'https://yourcompany.atlassian.net';

/**
 * POST an ADF comment to the given Jira issue.
 * Returns the HTTP response status code.
 * NEVER logs credentials, tokens, or Authorization header values.
 */
async function postJiraComment(issueKey, changeUrl, subject, email, token) {
  const apiUrl = `${JIRA_BASE}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`;
  const credentials = btoa(`${email}:${token}`);

  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(buildAdfComment(changeUrl, subject)),
  });

  return resp.status;
}

/**
 * Builds an Atlassian Document Format (ADF) body for the Jira comment.
 * Content: gerrit URL as a hyperlink + the change title.
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

/** Maps known Jira HTTP status codes to user-friendly Korean messages. */
function mapJiraError(status) {
  if (status === 401) return '인증 실패 (401): Jira 이메일 또는 API 토큰을 확인하세요.';
  if (status === 403) return '권한 없음 (403): 해당 이슈에 코멘트 권한이 없습니다.';
  if (status === 404) return '이슈를 찾을 수 없음 (404): 이슈 키 또는 Jira URL을 확인하세요.';
  return `Jira API 오류: HTTP ${status}`;
}

// ── Message handler (from options page for connection test) ───────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'TEST_CONNECTION') {
    handleTestConnection(msg.email, msg.token).then(sendResponse);
    return true; // keep channel open for async response
  }
});

/**
 * Tests Jira credentials by calling GET /rest/api/3/myself.
 * Returns only the HTTP status code — response body is discarded.
 */
async function handleTestConnection(email, token) {
  try {
    const credentials = btoa(`${email}:${token}`);
    const resp = await fetch(`${JIRA_BASE}/rest/api/3/myself`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: 'application/json',
      },
    });
    return { status: resp.status };
  } catch {
    return { status: null, networkError: true };
  }
}
