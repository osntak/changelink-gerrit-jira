// service_worker.js
// All Jira API network requests are handled here only.
// No credential/token/Authorization logging.

'use strict';

importScripts('message_types.js');

const MSG = self.MESSAGE_TYPES;

const GERRIT_ORIGINS = [
  'http://gerrit.example.com',
  'https://gerrit.example.com',
];

const JIRA_BASE = 'https://yourcompany.atlassian.net';
const JIRA_ALLOWED_HOST = 'yourcompany.atlassian.net';

const DEFAULT_TEMPLATE =
`{title}

{body}

브랜치: {branch}
반영 일시: {date}
Gerrit: {url}
Change-Id: {change_id}`;

function isGerritTab(url) {
  try {
    return GERRIT_ORIGINS.includes(new URL(url).origin);
  } catch {
    return false;
  }
}

function isAllowedChangeUrl(url) {
  try {
    const parsed = new URL(url);
    return GERRIT_ORIGINS.includes(parsed.origin) && /\/c\/.+\/\+\/\d+/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isValidIssueKey(key) {
  return typeof key === 'string' && /^[A-Z][A-Z0-9]+-\d+$/.test(key);
}

function assertAllowedJiraBase() {
  const host = new URL(JIRA_BASE).hostname;
  if (host !== JIRA_ALLOWED_HOST) {
    throw new Error('Jira base URL is not allowed');
  }
}

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

function isMissingReceiverError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return (
    msg.includes('receiving end does not exist') ||
    msg.includes('could not establish connection')
  );
}

function injectContentScripts(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: ['message_types.js', 'content_script.js'],
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      },
    );
  });
}

async function sendToTabWithRecovery(tabId, message) {
  try {
    return await sendToTab(tabId, message);
  } catch (err) {
    if (!isMissingReceiverError(err)) {
      throw err;
    }
    // Recovery path: receiver is usually missing when content script was not attached.
    await injectContentScripts(tabId);
    return sendToTab(tabId, message);
  }
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

function loadStorageData() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['jiraEmail', 'jiraToken', 'commentTemplate'],
      resolve,
    );
  });
}

function setFabEnabled(enabled) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ fabEnabled: !!enabled }, resolve);
  });
}

async function getActiveGerritContext() {
  const tab = await getActiveTab();
  if (!tab || !tab.id || !tab.url || !isGerritTab(tab.url)) {
    return {
      ok: false,
      message: 'Gerrit change 페이지에서 팝업을 열어주세요.',
    };
  }
  if (!isAllowedChangeUrl(tab.url)) {
    return {
      ok: false,
      message: 'Gerrit change 상세 페이지(/c/.../+/번호)에서 실행하세요.',
    };
  }

  try {
    const context = await sendToTabWithRecovery(tab.id, { type: MSG.EXTRACT_CONTEXT });
    const safeContext = {
      issueKey: isValidIssueKey(context?.issueKey || '') ? context.issueKey : null,
      subject: String(context?.subject || '').trim().slice(0, 500),
      gerritUrl: String(context?.gerritUrl || tab.url),
      branch: String(context?.branch || '').trim(),
      body: String(context?.body || '').trim(),
      changeNum: String(context?.changeNum || '').trim(),
      project: String(context?.project || '').trim(),
      owner: String(context?.owner || '').trim(),
      changeId: String(context?.changeId || '').trim(),
    };

    if (!isAllowedChangeUrl(safeContext.gerritUrl)) {
      return { ok: false, message: '허용된 Gerrit 도메인이 아닙니다.' };
    }

    return { ok: true, tabId: tab.id, context: safeContext };
  } catch {
    return {
      ok: false,
      message: '페이지 정보를 읽을 수 없습니다. 페이지를 새로고침 후 다시 시도하세요.',
    };
  }
}

function formatDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderTemplate(template, vars) {
  return template
    .replace(/\{title\}/g, vars.title ?? '')
    .replace(/\{body\}/g, vars.body ?? '')
    .replace(/\{branch\}/g, vars.branch ?? '')
    .replace(/\{change_num\}/g, vars.changeNum ?? '')
    .replace(/\{change_id\}/g, vars.changeId ?? '')
    .replace(/\{project\}/g, vars.project ?? '')
    .replace(/\{owner\}/g, vars.owner ?? '')
    .replace(/\{date\}/g, vars.date ?? '')
    .replace(/\{url\}/g, vars.url ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function ensureCommentMinimum(text, vars) {
  let out = (text || '').trim();

  if (vars.title && !out.includes(vars.title)) {
    out = `${out}\n\n제목: ${vars.title}`;
  }
  if (vars.url && !out.includes(vars.url)) {
    out = `${out}\nGerrit: ${vars.url}`;
  }

  return out.trim();
}

function textToAdf(text, linkUrl) {
  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => buildAdfParagraph(p, linkUrl))
    .filter((p) => p.content.length > 0);

  if (paragraphs.length === 0) {
    paragraphs.push({ type: 'paragraph', content: [{ type: 'text', text: '' }] });
  }

  return { body: { type: 'doc', version: 1, content: paragraphs } };
}

function buildAdfParagraph(paraText, linkUrl) {
  const nodes = [];
  const lines = paraText.split('\n');

  for (let i = 0; i < lines.length; i++) {
    if (i > 0) nodes.push({ type: 'hardBreak' });
    nodes.push(...inlineNodesForLine(lines[i], linkUrl));
  }

  return { type: 'paragraph', content: nodes };
}

function inlineNodesForLine(line, linkUrl) {
  if (!line) return [];
  if (!linkUrl || !line.includes(linkUrl)) return [{ type: 'text', text: line }];

  const nodes = [];
  let cursor = 0;

  while (cursor < line.length) {
    const idx = line.indexOf(linkUrl, cursor);
    if (idx === -1) {
      const tail = line.slice(cursor);
      if (tail) nodes.push({ type: 'text', text: tail });
      break;
    }

    const before = line.slice(cursor, idx);
    if (before) nodes.push({ type: 'text', text: before });

    nodes.push({
      type: 'text',
      text: linkUrl,
      marks: [{ type: 'link', attrs: { href: linkUrl } }],
    });

    cursor = idx + linkUrl.length;
  }

  return nodes;
}

function mapJiraError(status) {
  switch (status) {
    case 400: return '잘못된 요청 (400): 이슈 키 또는 요청 형식을 확인하세요.';
    case 401: return '인증 실패 (401): Jira 이메일 또는 API 토큰을 확인하세요.';
    case 403: return '권한 없음 (403): 해당 작업 권한이 없습니다.';
    case 404: return '대상을 찾을 수 없음 (404): 이슈 키를 확인하세요.';
    default: return `Jira API 오류: HTTP ${status}`;
  }
}

function mapClientError(err, fallbackMessage) {
  if (!err) return fallbackMessage;
  if (err.code === 'missing_credentials') {
    return 'Jira 이메일/토큰이 설정되지 않았습니다.\n옵션 페이지에서 설정하세요.';
  }
  if (err.code === 'invalid_issue_key') {
    return 'PROJ-123 같은 이슈키가 필요합니다. 제목 또는 커밋 메시지에 jira: KEY를 추가하세요.';
  }
  if (err.code === 'invalid_gerrit_url') {
    return '현재 페이지 URL이 허용된 Gerrit 도메인이 아닙니다.';
  }
  if (typeof err.status === 'number') {
    return mapJiraError(err.status);
  }
  if (err.code === 'network_error') {
    return '네트워크 오류가 발생했습니다. 인터넷 연결을 확인하세요.';
  }
  return fallbackMessage;
}

const jiraClient = {
  async getCredentials() {
    const { jiraEmail, jiraToken } = await loadStorageData();
    if (!jiraEmail || !jiraToken) {
      const error = new Error('Missing credentials');
      error.code = 'missing_credentials';
      throw error;
    }
    return { email: jiraEmail, token: jiraToken };
  },

  async fetch(path, options = {}) {
    assertAllowedJiraBase();
    const { email, token } = await this.getCredentials();

    const headers = {
      Authorization: `Basic ${btoa(`${email}:${token}`)}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    };

    try {
      return await fetch(`${JIRA_BASE}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch {
      const error = new Error('Network error');
      error.code = 'network_error';
      throw error;
    }
  },

  async getIssue(issueKey) {
    if (!isValidIssueKey(issueKey)) {
      const error = new Error('Invalid issue key');
      error.code = 'invalid_issue_key';
      throw error;
    }

    const path = `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,status,assignee`;
    const resp = await this.fetch(path, { method: 'GET' });

    if (resp.status !== 200) {
      const error = new Error('Issue request failed');
      error.status = resp.status;
      throw error;
    }

    const json = await resp.json();
    return {
      summary: String(json?.fields?.summary || ''),
      status: String(json?.fields?.status?.name || ''),
      assignee: String(json?.fields?.assignee?.displayName || 'Unassigned'),
    };
  },

  async addRemoteLink(issueKey, payload) {
    if (!isValidIssueKey(issueKey)) {
      const error = new Error('Invalid issue key');
      error.code = 'invalid_issue_key';
      throw error;
    }

    const resp = await this.fetch(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/remotelink`,
      {
        method: 'POST',
        body: payload,
      },
    );

    if (resp.status !== 200 && resp.status !== 201) {
      const error = new Error('Remote link request failed');
      error.status = resp.status;
      throw error;
    }
  },

  async addComment(issueKey, adfDoc) {
    if (!isValidIssueKey(issueKey)) {
      const error = new Error('Invalid issue key');
      error.code = 'invalid_issue_key';
      throw error;
    }

    const resp = await this.fetch(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
      {
        method: 'POST',
        body: { body: adfDoc },
      },
    );

    if (resp.status !== 201) {
      const error = new Error('Comment request failed');
      error.status = resp.status;
      throw error;
    }
  },
};

function buildRemoteLinkPayload(context) {
  const payload = {
    object: {
      url: context.gerritUrl,
      title: `Gerrit: ${context.subject || '(no title)'}`,
    },
  };

  if (context.changeNum) {
    payload.globalId = `gerrit:change:${context.changeNum}`;
  } else if (context.changeId) {
    payload.globalId = `gerrit:changeid:${context.changeId}`;
  }

  return payload;
}

async function buildCommentAdf(context) {
  const { commentTemplate } = await loadStorageData();
  const template = (commentTemplate || '').trim() || DEFAULT_TEMPLATE;

  const rendered = renderTemplate(template, {
    title: context.subject || '(no title)',
    body: context.body || '',
    branch: context.branch || '',
    changeNum: context.changeNum || '',
    changeId: context.changeId || '',
    project: context.project || '',
    owner: context.owner || '',
    date: formatDate(new Date()),
    url: context.gerritUrl,
  });

  const safeText = ensureCommentMinimum(rendered, {
    title: context.subject || '(no title)',
    url: context.gerritUrl,
  });

  return textToAdf(safeText, context.gerritUrl).body;
}

async function handlePopupGetContext() {
  const result = await getActiveGerritContext();
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return { ok: true, context: result.context };
}

async function handlePopupGetAuthState() {
  const { jiraEmail, jiraToken } = await loadStorageData();
  return {
    ok: true,
    configured: !!(jiraEmail && jiraToken),
  };
}

async function handlePopupGetIssue(issueKey) {
  try {
    const key = String(issueKey || '').trim();
    const issue = await jiraClient.getIssue(key);
    return { ok: true, issue };
  } catch (err) {
    return {
      ok: false,
      message: mapClientError(err, '이슈 조회에 실패했습니다.'),
    };
  }
}

async function handlePopupAddRemoteLink(issueKeyOverride) {
  const contextResp = await getActiveGerritContext();
  if (!contextResp.ok) {
    return { ok: false, message: contextResp.message };
  }

  const context = contextResp.context;
  const overrideKey = String(issueKeyOverride || '').trim().toUpperCase();
  const issueKey = isValidIssueKey(overrideKey) ? overrideKey : context.issueKey;

  if (!issueKey) {
    return {
      ok: false,
      message: 'PROJ-123 같은 이슈키가 필요합니다. 제목 또는 커밋 메시지에 jira: KEY를 추가하세요.',
    };
  }
  if (!isAllowedChangeUrl(context.gerritUrl)) {
    return {
      ok: false,
      message: '현재 페이지 URL이 허용된 Gerrit 도메인이 아닙니다.',
    };
  }

  try {
    await jiraClient.addRemoteLink(issueKey, buildRemoteLinkPayload(context));
    return { ok: true, issueKey };
  } catch (err) {
    return {
      ok: false,
      message: mapClientError(err, '웹링크 추가에 실패했습니다.'),
    };
  }
}

async function handlePopupAddComment(issueKeyOverride) {
  const contextResp = await getActiveGerritContext();
  if (!contextResp.ok) {
    return { ok: false, message: contextResp.message };
  }

  const context = contextResp.context;
  const overrideKey = String(issueKeyOverride || '').trim().toUpperCase();
  const issueKey = isValidIssueKey(overrideKey) ? overrideKey : context.issueKey;

  if (!issueKey) {
    return {
      ok: false,
      message: 'PROJ-123 같은 이슈키가 필요합니다. 제목 또는 커밋 메시지에 jira: KEY를 추가하세요.',
    };
  }
  if (!isAllowedChangeUrl(context.gerritUrl)) {
    return {
      ok: false,
      message: '현재 페이지 URL이 허용된 Gerrit 도메인이 아닙니다.',
    };
  }

  try {
    const adfDoc = await buildCommentAdf(context);
    await jiraClient.addComment(issueKey, adfDoc);
    return { ok: true, issueKey };
  } catch (err) {
    return {
      ok: false,
      message: mapClientError(err, '코멘트 생성에 실패했습니다.'),
    };
  }
}

async function handlePopupSetFabEnabled(enabled) {
  await setFabEnabled(enabled);

  const tab = await getActiveTab();
  if (!tab || !tab.id || !tab.url || !isGerritTab(tab.url)) {
    return {
      ok: true,
      message: 'FAB 설정이 저장되었습니다. Gerrit 탭에서 반영됩니다.',
    };
  }

  try {
    await sendToTab(tab.id, {
      type: enabled ? MSG.FAB_ENABLE : MSG.FAB_DISABLE,
    });
    return { ok: true };
  } catch {
    return {
      ok: true,
      message: 'FAB 설정이 저장되었습니다. 페이지 새로고침 시 반영됩니다.',
    };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === MSG.TEST_CONNECTION) {
    handleTestConnection(msg.email, msg.token).then(sendResponse);
    return true;
  }

  if (msg.type === MSG.POPUP_GET_CONTEXT) {
    handlePopupGetContext().then(sendResponse);
    return true;
  }

  if (msg.type === MSG.POPUP_GET_AUTH_STATE) {
    handlePopupGetAuthState().then(sendResponse);
    return true;
  }

  if (msg.type === MSG.POPUP_GET_ISSUE) {
    handlePopupGetIssue(msg.issueKey).then(sendResponse);
    return true;
  }

  if (msg.type === MSG.POPUP_ADD_REMOTE_LINK) {
    handlePopupAddRemoteLink(msg.issueKeyOverride).then(sendResponse);
    return true;
  }

  if (msg.type === MSG.POPUP_ADD_COMMENT) {
    handlePopupAddComment(msg.issueKeyOverride).then(sendResponse);
    return true;
  }

  if (msg.type === MSG.POPUP_SET_FAB_ENABLED) {
    handlePopupSetFabEnabled(!!msg.enabled).then(sendResponse);
    return true;
  }

  return false;
});

async function handleTestConnection(email, token) {
  if (!email || !token) {
    return { status: 401 };
  }

  try {
    assertAllowedJiraBase();
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
