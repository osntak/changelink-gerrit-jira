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

/**
 * Default Jira comment template (used when none is saved in options).
 * Supported placeholders: {title} {body} {branch} {change_num} {project}
 *                         {owner} {date} {url}
 */
const DEFAULT_TEMPLATE =
`{title}

{body}

브랜치: {branch}
반영 일시: {date}
Gerrit: {url}`;

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

  // ── Step 3: load credentials + template ───────────────────────────────────
  const { jiraEmail, jiraToken, commentTemplate } = await loadStorageData();

  if (!jiraEmail || !jiraToken) {
    toastTab(
      tab.id,
      'Jira 이메일/토큰이 설정되지 않았습니다. 확장프로그램 옵션 페이지에서 설정하세요.',
    );
    return;
  }

  // ── Step 4: render template → POST comment ────────────────────────────────
  const template = (commentTemplate || '').trim() || DEFAULT_TEMPLATE;
  const rendered = renderTemplate(template, {
    title:     safeSubject,
    body:      String(info.body      ?? '').trim(),
    branch:    String(info.branch    ?? '').trim(),
    changeNum: String(info.changeNum ?? '').trim(),
    project:   String(info.project   ?? '').trim(),
    owner:     String(info.owner     ?? '').trim(),
    date:      formatDate(new Date()),
    url,
  });

  let status;
  try {
    status = await postJiraComment(issueKey, url, rendered, jiraEmail, jiraToken);
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

function loadStorageData() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['jiraEmail', 'jiraToken', 'commentTemplate'],
      resolve,
    );
  });
}

// ── Comment template ──────────────────────────────────────────────────────────

/**
 * Replaces all `{placeholder}` tokens in the template with actual values.
 * Collapses 3+ consecutive newlines to 2 so an empty {body} doesn't leave
 * a double blank line in the Jira comment.
 *
 * @param {string} template
 * @param {{ title: string, body: string, branch: string, changeNum: string,
 *           project: string, owner: string, date: string, url: string }} vars
 * @returns {string}
 */
function renderTemplate(template, vars) {
  return template
    .replace(/\{title\}/g,      vars.title     ?? '')
    .replace(/\{body\}/g,       vars.body      ?? '')
    .replace(/\{branch\}/g,     vars.branch    ?? '')
    .replace(/\{change_num\}/g, vars.changeNum ?? '')
    .replace(/\{project\}/g,    vars.project   ?? '')
    .replace(/\{owner\}/g,      vars.owner     ?? '')
    .replace(/\{date\}/g,       vars.date      ?? '')
    .replace(/\{url\}/g,        vars.url       ?? '')
    .replace(/\n{3,}/g, '\n\n')   // collapse extra blank lines from empty vars
    .trim();
}

/**
 * Formats a Date to a human-readable Korean locale string, e.g.
 * "2025-02-23 14:30"
 *
 * @param {Date} d
 * @returns {string}
 */
function formatDate(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Jira API ──────────────────────────────────────────────────────────────────

/**
 * POST an ADF comment to the specified Jira issue.
 *
 * Security notes:
 *   - JIRA_BASE is a fixed constant — never derived from user/page input.
 *   - issueKey is validated by isValidIssueKey() before reaching here.
 *   - Authorization header is NEVER logged.
 *   - Only the HTTP status code is returned; the response body is discarded.
 *
 * @param {string} issueKey    e.g. "PROJ-123"
 * @param {string} changeUrl   validated Gerrit change URL (used to make links)
 * @param {string} rendered    fully-rendered template string
 * @param {string} email       Jira account email
 * @param {string} token       Jira API token
 * @returns {Promise<number>}  HTTP status code
 */
async function postJiraComment(issueKey, changeUrl, rendered, email, token) {
  const apiUrl =
    `${JIRA_BASE}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`;

  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${email}:${token}`)}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(textToAdf(rendered, changeUrl)),
  });

  return resp.status;
}

// ── ADF builder ───────────────────────────────────────────────────────────────

/**
 * Converts a plain-text string into an ADF (Atlassian Document Format) doc.
 *
 * Rules:
 *   - Double newlines  → paragraph boundaries
 *   - Single newlines  → hardBreak within a paragraph
 *   - Any occurrence of `linkUrl` in the text → inline hyperlink
 *
 * @param {string} text
 * @param {string} linkUrl  URL to auto-link wherever it appears in the text
 * @returns {object}        ADF comment payload  { body: { type:'doc', ... } }
 */
function textToAdf(text, linkUrl) {
  const paragraphs = text
    .split(/\n\n+/)
    .map(p => buildAdfParagraph(p, linkUrl))
    .filter(p => p.content.length > 0);

  // Ensure the doc always has at least one paragraph (ADF requirement)
  if (paragraphs.length === 0) {
    paragraphs.push({ type: 'paragraph', content: [{ type: 'text', text: '' }] });
  }

  return { body: { type: 'doc', version: 1, content: paragraphs } };
}

/**
 * Builds a single ADF paragraph node from a paragraph string.
 * Newlines within the paragraph become `hardBreak` nodes.
 */
function buildAdfParagraph(paraText, linkUrl) {
  const nodes = [];
  const lines = paraText.split('\n');

  for (let i = 0; i < lines.length; i++) {
    if (i > 0) nodes.push({ type: 'hardBreak' });
    nodes.push(...inlineNodesForLine(lines[i], linkUrl));
  }

  return { type: 'paragraph', content: nodes };
}

/**
 * Splits a single line of text into ADF inline nodes.
 * If the line contains `linkUrl`, that substring becomes a clickable link.
 */
function inlineNodesForLine(line, linkUrl) {
  if (!linkUrl || !line.includes(linkUrl)) {
    return line ? [{ type: 'text', text: line }] : [];
  }

  const idx = line.indexOf(linkUrl);
  const nodes = [];
  if (idx > 0) nodes.push({ type: 'text', text: line.slice(0, idx) });
  nodes.push({
    type: 'text',
    text: linkUrl,
    marks: [{ type: 'link', attrs: { href: linkUrl } }],
  });
  const after = line.slice(idx + linkUrl.length);
  if (after) nodes.push({ type: 'text', text: after });
  return nodes;
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
