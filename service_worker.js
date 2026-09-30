// service_worker.js
// All Jira API network requests are handled here only.
// No credential/token/Authorization logging.

'use strict';

importScripts('i18n.js', 'message_types.js');

const MSG = self.MESSAGE_TYPES;

// Gerrit and Jira URLs come from user settings. Nothing is hardcoded to one site.
// Kept in a module cache and reloaded before every message dispatch, because the
// service worker can be torn down at any time.
let sites = { gerritOrigin: '', jiraBase: '' };

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.origin;
  } catch {
    return '';
  }
}

async function loadSites() {
  const stored = await chrome.storage.local.get(['gerritOrigin', 'jiraBase', 'uiLanguage']);
  I18N.setLang(stored.uiLanguage || 'auto');
  sites = {
    gerritOrigin: normalizeOrigin(stored.gerritOrigin),
    jiraBase: normalizeOrigin(stored.jiraBase),
  };
  return sites;
}

const DEFAULT_TEMPLATE =
`{title}

{body}

브랜치: {branch}
반영 일시: {date}
Gerrit: {url}
Change-Id: {change_id}`;

function isGerritTab(url) {
  try {
    return !!sites.gerritOrigin && new URL(url).origin === sites.gerritOrigin;
  } catch {
    return false;
  }
}

function isAllowedChangeUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      !!sites.gerritOrigin &&
      parsed.origin === sites.gerritOrigin &&
      /\/c\/.+\/\+\/\d+/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function isValidIssueKey(key) {
  return typeof key === 'string' && /^[A-Z][A-Z0-9]+-\d+$/.test(key);
}

function assertJiraConfigured() {
  if (!sites.jiraBase) {
    const error = new Error('Jira site URL is not configured');
    error.code = 'no_site';
    throw error;
  }
}

function isJiraTab(url) {
  try {
    return !!sites.jiraBase && new URL(url).origin === sites.jiraBase;
  } catch {
    return false;
  }
}

// Content scripts are registered dynamically: the Gerrit and Jira hosts are only
// known after the user saves them in options and grants the host permissions.
// The same script runs on both; it picks its mode from the page origin.
async function registerSiteContentScripts() {
  const { gerritOrigin, jiraBase } = await loadSites();

  try {
    await chrome.scripting.unregisterContentScripts();
  } catch {
    // Nothing registered yet.
  }

  const scripts = [];
  for (const [id, origin] of [['gerrit', gerritOrigin], ['jira', jiraBase]]) {
    if (!origin || (id === 'jira' && origin === gerritOrigin)) continue;
    if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) continue;
    scripts.push({
      id,
      matches: [`${origin}/*`],
      // Confluence shares the Jira Cloud origin.
      ...(id === 'jira' ? { excludeMatches: [`${origin}/wiki/*`] } : {}),
      js: ['i18n.js', 'message_types.js', 'content_script.js'],
      runAt: 'document_idle',
    });
  }
  if (scripts.length) await chrome.scripting.registerContentScripts(scripts);
  return scripts.some((s) => s.id === 'gerrit');
}

chrome.runtime.onInstalled.addListener(() => { registerSiteContentScripts(); });
chrome.runtime.onStartup.addListener(() => { registerSiteContentScripts(); });

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
        files: ['i18n.js', 'message_types.js', 'content_script.js'],
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

function loadBehaviorSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['applyTransitionEnabled', 'applyTransitionName'],
      ({ applyTransitionEnabled, applyTransitionName }) => {
        resolve({
          applyTransitionEnabled: !!applyTransitionEnabled,
          applyTransitionName: String(applyTransitionName || '').trim(),
        });
      },
    );
  });
}

// FAB on/off is kept per site: fabEnabled for Gerrit, fabEnabledJira for Jira.
function setFabEnabled(enabled, onJira) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [onJira ? 'fabEnabledJira' : 'fabEnabled']: !!enabled }, resolve);
  });
}

async function getActiveGerritContext() {
  if (!sites.gerritOrigin) {
    return { ok: false, message: I18N.t('sw.error.noGerritOrigin') };
  }

  const tab = await getActiveTab();
  if (!tab || !tab.id || !tab.url || !isGerritTab(tab.url)) {
    return {
      ok: false,
      message: I18N.t('sw.error.notGerritTab'),
    };
  }
  if (!isAllowedChangeUrl(tab.url)) {
    return {
      ok: false,
      message: I18N.t('sw.error.notChangePage'),
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
      submittedAt: String(context?.submittedAt || '').trim(),
    };

    if (!isAllowedChangeUrl(safeContext.gerritUrl)) {
      return { ok: false, message: I18N.t('sw.error.notAllowedDomain') };
    }

    return { ok: true, tabId: tab.id, context: safeContext };
  } catch {
    return {
      ok: false,
      message: I18N.t('sw.error.contextRead'),
    };
  }
}

function formatDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseGerritTimestampUtc(raw) {
  const m = String(raw || '')
    .trim()
    .match(
      /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/,
    );
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] || 0);
  const milli = Number((m[7] || '').slice(0, 3).padEnd(3, '0'));
  return new Date(Date.UTC(year, month, day, hour, minute, second, milli));
}

function formatDateMaybe(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const parsed = parseGerritTimestampUtc(raw) || new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return formatDate(parsed);
}

function renderTemplate(template, vars) {
  // Function replacements so values containing `$&`/`$'` etc. are inserted literally.
  return template
    .replace(/\{title\}/g, () => vars.title ?? '')
    .replace(/\{body\}/g, () => vars.body ?? '')
    .replace(/\{branch\}/g, () => vars.branch ?? '')
    .replace(/\{change_num\}/g, () => vars.changeNum ?? '')
    .replace(/\{change_id\}/g, () => vars.changeId ?? '')
    .replace(/\{project\}/g, () => vars.project ?? '')
    .replace(/\{owner\}/g, () => vars.owner ?? '')
    .replace(/\{date\}/g, () => vars.date ?? '')
    .replace(/\{url\}/g, () => vars.url ?? '')
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
    // Empty text nodes are invalid ADF; an empty paragraph is accepted.
    paragraphs.push({ type: 'paragraph', content: [] });
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

async function readJiraErrorDetail(resp) {
  try {
    const json = await resp.json();
    const messages = [
      ...(Array.isArray(json?.errorMessages) ? json.errorMessages : []),
      ...Object.values(json?.errors || {}),
    ].map((m) => String(m)).filter(Boolean);
    return messages.join('\n').slice(0, 300);
  } catch {
    return '';
  }
}

function mapJiraError(status) {
  switch (status) {
    case 400: return I18N.t('sw.http.400');
    case 401: return I18N.t('sw.http.401');
    case 403: return I18N.t('sw.http.403');
    case 404: return I18N.t('sw.http.404');
    default: return I18N.t('sw.http.other', { status });
  }
}

function mapClientError(err, fallbackMessage) {
  if (!err) return fallbackMessage;
  if (err.code === 'missing_credentials') {
    return I18N.t('sw.error.missingCredentials');
  }
  if (err.code === 'invalid_issue_key') {
    return I18N.t('sw.error.noIssueKey');
  }
  if (err.code === 'invalid_gerrit_url') {
    return I18N.t('sw.error.invalidGerritUrl');
  }
  if (typeof err.status === 'number') {
    const base = mapJiraError(err.status);
    return err.detail ? `${base}\n${err.detail}` : base;
  }
  if (err.code === 'network_error') {
    return I18N.t('sw.error.network');
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
    assertJiraConfigured();
    const { email, token } = await this.getCredentials();

    const headers = {
      Authorization: `Basic ${btoa(`${email}:${token}`)}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    };

    try {
      return await fetch(`${sites.jiraBase}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        // Never attach browser Jira session cookies: Atlassian prefers cookie
        // sessions over Basic auth, so a stale session breaks token auth.
        credentials: 'omit',
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

  async getTransitions(issueKey) {
    if (!isValidIssueKey(issueKey)) {
      const error = new Error('Invalid issue key');
      error.code = 'invalid_issue_key';
      throw error;
    }

    const resp = await this.fetch(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions?expand=transitions.fields`,
      { method: 'GET' },
    );

    if (resp.status !== 200) {
      const error = new Error('Transitions request failed');
      error.status = resp.status;
      throw error;
    }

    const json = await resp.json();
    const transitions = Array.isArray(json?.transitions) ? json.transitions : [];

    // A transition screen can require fields (e.g. resolution when moving to
    // Resolved). Only the ones still empty on the issue need input; Jira keeps the
    // current value of the rest (fix version, severity and so on).
    const requiredKeys = [...new Set(transitions.flatMap((t) =>
      Object.entries(t?.fields || {}).filter(([, f]) => f?.required).map(([key]) => key)))];
    const current = requiredKeys.length ? await this.getIssueFields(issueKey, requiredKeys) : {};
    // The popup preselects the site default resolution, so "Change status" alone
    // does what a plain Jira transition would.
    const defaultResolution = requiredKeys.includes('resolution') && isEmptyFieldValue(current.resolution)
      ? await this.getResolutions().then((list) => list.find((r) => r.isDefault)?.id || '').catch(() => '')
      : '';

    return transitions.map((t) => ({
      id: String(t?.id || ''),
      name: String(t?.name || ''),
      toStatus: String(t?.to?.name || ''),
      needs: Object.entries(t?.fields || {})
        .filter(([key, f]) => f?.required && isEmptyFieldValue(current[key]))
        .map(([key, f]) => ({
          key,
          name: String(f.name || key),
          multi: f.schema?.type === 'array',
          value: key === 'resolution' ? defaultResolution : '',
          // Empty when the field is free text/date: the popup then sends the user to Jira.
          options: (Array.isArray(f.allowedValues) ? f.allowedValues : [])
            .filter((v) => !v?.archived)
            .map((v) => ({ id: String(v?.id || ''), name: String(v?.name ?? v?.value ?? '') }))
            .filter((o) => o.id && o.name),
        })),
    })).filter((t) => t.id && t.name);
  },

  // Current values of the given fields; {} on failure, so every required field is asked for.
  async getIssueFields(issueKey, keys) {
    try {
      const resp = await this.fetch(
        `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=${keys.map(encodeURIComponent).join(',')}`,
        { method: 'GET' },
      );
      if (resp.status !== 200) return {};
      return (await resp.json())?.fields || {};
    } catch {
      return {};
    }
  },

  async getStatuses() {
    const resp = await this.fetch('/rest/api/3/status', { method: 'GET' });
    if (resp.status !== 200) {
      const error = new Error('Status list request failed');
      error.status = resp.status;
      throw error;
    }

    const json = await resp.json();
    const names = (Array.isArray(json) ? json : [])
      .map((s) => String(s?.name || '').trim())
      .filter(Boolean);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'ko'));
  },

  // The search endpoint also marks the site default: the resolution Jira applies
  // when a transition sends none (Done on this kind of site).
  async getResolutions() {
    const resp = await this.fetch('/rest/api/3/resolution/search?maxResults=100', { method: 'GET' });
    if (resp.status !== 200) {
      const error = new Error('Resolution list request failed');
      error.status = resp.status;
      throw error;
    }
    const json = await resp.json();
    return (Array.isArray(json?.values) ? json.values : [])
      .map((r) => ({ id: String(r?.id || ''), name: String(r?.name || ''), isDefault: !!r?.isDefault }))
      .filter((r) => r.id && r.name);
  },

  async doTransition(issueKey, transitionId, fields) {
    if (!isValidIssueKey(issueKey)) {
      const error = new Error('Invalid issue key');
      error.code = 'invalid_issue_key';
      throw error;
    }

    const resp = await this.fetch(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
      {
        method: 'POST',
        body: {
          transition: { id: String(transitionId) },
          ...(fields && Object.keys(fields).length ? { fields } : {}),
        },
      },
    );

    if (resp.status !== 204) {
      const error = new Error('Transition request failed');
      error.status = resp.status;
      error.detail = await readJiraErrorDetail(resp);
      throw error;
    }
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
      error.detail = await readJiraErrorDetail(resp);
      throw error;
    }
  },

  async hasGerritComment(issueKey, needle) {
    if (!isValidIssueKey(issueKey) || !needle) return false;

    const resp = await this.fetch(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?maxResults=100&orderBy=-created`,
      { method: 'GET' },
    );
    // Duplicate check is best-effort: on lookup failure, do not block comment creation.
    if (resp.status !== 200) return false;

    try {
      const json = await resp.json();
      const comments = Array.isArray(json?.comments) ? json.comments : [];
      return comments.some((c) => JSON.stringify(c?.body || '').includes(needle));
    } catch {
      return false;
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
      error.detail = await readJiraErrorDetail(resp);
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

async function buildCommentText(context) {
  const { commentTemplate } = await loadStorageData();
  const template = (commentTemplate || '').trim() || DEFAULT_TEMPLATE;
  const reflectedAt = formatDateMaybe(context.submittedAt);

  const rendered = renderTemplate(template, {
    title: context.subject || '(no title)',
    body: context.body || '',
    branch: context.branch || '',
    changeNum: context.changeNum || '',
    changeId: context.changeId || '',
    project: context.project || '',
    owner: context.owner || '',
    date: reflectedAt,
    url: context.gerritUrl,
  });

  return ensureCommentMinimum(rendered, {
    title: context.subject || '(no title)',
    url: context.gerritUrl,
  });
}

async function buildCommentAdf(context, commentTextOverride) {
  const text = String(commentTextOverride || '').trim() || await buildCommentText(context);
  const safeText = ensureCommentMinimum(text, {
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
      message: mapClientError(err, I18N.t('sw.error.lookupIssue')),
    };
  }
}

async function handlePopupGetTransitions(issueKey) {
  try {
    const key = String(issueKey || '').trim();
    const transitions = await jiraClient.getTransitions(key);
    return { ok: true, transitions };
  } catch (err) {
    return {
      ok: false,
      message: mapClientError(err, I18N.t('sw.error.lookupTransitions')),
    };
  }
}

function isEmptyFieldValue(value) {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

// Popup sends [{ key, id, multi }] for the required fields it asked for; Jira wants
// { key: { id } } or, for array fields such as fixVersions, { key: [{ id }] }.
function buildTransitionFields(values) {
  const fields = {};
  for (const v of Array.isArray(values) ? values : []) {
    const key = String(v?.key || '');
    const id = String(v?.id || '');
    if (!/^\w+$/.test(key) || !id) continue;
    fields[key] = v.multi ? [{ id }] : { id };
  }
  return fields;
}

async function handlePopupDoTransition(issueKey, transitionId, fieldValues) {
  const id = String(transitionId || '').trim();
  if (!id) {
    return { ok: false, message: I18N.t('sw.error.pickTransition') };
  }

  try {
    const key = String(issueKey || '').trim();
    await jiraClient.doTransition(key, id, buildTransitionFields(fieldValues));
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: mapClientError(err, I18N.t('sw.error.transitionFailed')),
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
      message: I18N.t('sw.error.noIssueKey'),
    };
  }
  if (!isAllowedChangeUrl(context.gerritUrl)) {
    return {
      ok: false,
      message: I18N.t('sw.error.invalidGerritUrl'),
    };
  }

  try {
    await jiraClient.addRemoteLink(issueKey, buildRemoteLinkPayload(context));
    return { ok: true, issueKey };
  } catch (err) {
    return {
      ok: false,
      message: mapClientError(err, I18N.t('sw.error.remoteLinkFailed')),
    };
  }
}

function buildDuplicateNeedle(context) {
  if (context.project && context.changeNum) {
    return `/c/${context.project}/+/${context.changeNum}`;
  }
  return context.gerritUrl || '';
}

async function resolveCommentTarget(issueKeyOverride) {
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
      message: I18N.t('sw.error.noIssueKey'),
    };
  }
  if (!isAllowedChangeUrl(context.gerritUrl)) {
    return {
      ok: false,
      message: I18N.t('sw.error.invalidGerritUrl'),
    };
  }

  return { ok: true, context, issueKey };
}

async function handlePopupPreviewComment(issueKeyOverride) {
  const target = await resolveCommentTarget(issueKeyOverride);
  if (!target.ok) return target;

  try {
    const [text, duplicated] = await Promise.all([
      buildCommentText(target.context),
      jiraClient.hasGerritComment(target.issueKey, buildDuplicateNeedle(target.context)),
    ]);
    return { ok: true, issueKey: target.issueKey, text, duplicate: duplicated };
  } catch (err) {
    return {
      ok: false,
      message: mapClientError(err, I18N.t('sw.error.previewFailed')),
    };
  }
}

async function handlePopupCheckComment(issueKeyOverride) {
  const target = await resolveCommentTarget(issueKeyOverride);
  if (!target.ok) return target;

  try {
    const duplicated = await jiraClient.hasGerritComment(
      target.issueKey,
      buildDuplicateNeedle(target.context),
    );
    return { ok: true, issueKey: target.issueKey, duplicate: duplicated };
  } catch (err) {
    return {
      ok: false,
      message: mapClientError(err, I18N.t('sw.error.checkCommentFailed')),
    };
  }
}

async function handlePopupAddComment(issueKeyOverride, force, commentText) {
  const target = await resolveCommentTarget(issueKeyOverride);
  if (!target.ok) return target;
  const { context, issueKey } = target;

  try {
    if (!force) {
      const duplicated = await jiraClient.hasGerritComment(
        issueKey,
        buildDuplicateNeedle(context),
      );
      if (duplicated) {
        return {
          ok: false,
          duplicate: true,
          issueKey,
          message: I18N.t('sw.comment.duplicate', { issueKey }),
        };
      }
    }

    const adfDoc = await buildCommentAdf(context, commentText);
    await jiraClient.addComment(issueKey, adfDoc);
    return { ok: true, issueKey };
  } catch (err) {
    return {
      ok: false,
      message: mapClientError(err, I18N.t('sw.error.commentFailed')),
    };
  }
}

async function transitionByNameIfConfigured(issueKey) {
  const { applyTransitionEnabled, applyTransitionName } = await loadBehaviorSettings();
  if (!applyTransitionEnabled || !applyTransitionName) {
    return { attempted: false };
  }

  const wanted = applyTransitionName.toLowerCase();
  try {
    const transitions = await jiraClient.getTransitions(issueKey);
    const match = transitions.find(
      (t) => t.name.toLowerCase() === wanted || t.toStatus.toLowerCase() === wanted,
    );
    if (!match) {
      return {
        attempted: true,
        ok: false,
        note: I18N.t('sw.transition.noMatch', { name: applyTransitionName }),
      };
    }

    // Same rule as the popup: only resolution is filled in here, from the default
    // chosen in options. Without one it is left out and Jira applies its own
    // default resolution (Done on Jira Cloud), as a transition always did before.
    // Any other empty required field is left to Jira's own dialog.
    const { applyResolution } = await chrome.storage.local.get(['applyResolution']);
    const needs = match.needs || [];
    const blocking = needs.filter((f) => f.key !== 'resolution');
    if (blocking.length) {
      return {
        attempted: true,
        ok: false,
        note: I18N.t('sw.transition.needsFields', { fields: blocking.map((f) => f.name).join(', ') }),
      };
    }
    const fields = needs.length && applyResolution?.id ? { resolution: { id: String(applyResolution.id) } } : {};
    await jiraClient.doTransition(issueKey, match.id, fields);
    return { attempted: true, ok: true, note: match.toStatus || match.name };
  } catch (err) {
    return {
      attempted: true,
      ok: false,
      note: mapClientError(err, I18N.t('sw.transition.shortFail')),
    };
  }
}

async function handlePopupQuickApply(issueKeyOverride, commentText, force) {
  const target = await resolveCommentTarget(issueKeyOverride);
  if (!target.ok) return target;
  const { context, issueKey } = target;

  try {
    if (!force) {
      const duplicated = await jiraClient.hasGerritComment(
        issueKey,
        buildDuplicateNeedle(context),
      );
      if (duplicated) {
        return {
          ok: false,
          duplicate: true,
          issueKey,
          message: I18N.t('sw.comment.duplicate', { issueKey }),
        };
      }
    }

    await jiraClient.addRemoteLink(issueKey, buildRemoteLinkPayload(context));

    const adfDoc = await buildCommentAdf(context, commentText);
    await jiraClient.addComment(issueKey, adfDoc);

    const transition = await transitionByNameIfConfigured(issueKey);

    let summary;
    if (transition.attempted && transition.ok) {
      summary = I18N.t('sw.apply.doneWithTransition', { issueKey, status: transition.note });
    } else if (transition.attempted) {
      summary = I18N.t('sw.apply.doneTransitionFailed', { issueKey, note: transition.note });
    } else {
      summary = I18N.t('sw.apply.done', { issueKey });
    }

    return {
      ok: true,
      issueKey,
      transitioned: !!(transition.attempted && transition.ok),
      // Link and comment went through but the status did not change: callers show
      // this as a warning, not a plain success.
      transitionFailed: !!(transition.attempted && !transition.ok),
      message: summary,
    };
  } catch (err) {
    return {
      ok: false,
      message: mapClientError(err, I18N.t('sw.error.applyFailed')),
    };
  }
}

async function handlePopupSetFabEnabled(enabled) {
  const tab = await getActiveTab();
  await setFabEnabled(enabled, !!tab?.url && isJiraTab(tab.url));

  if (!tab || !tab.id || !tab.url || !(isGerritTab(tab.url) || isJiraTab(tab.url))) {
    return {
      ok: true,
      message: I18N.t('sw.fab.savedGerritTab'),
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
      message: I18N.t('sw.fab.savedReload'),
    };
  }
}

// Changes whose commit message mentions the issue key. With a Gerrit HTTP password
// saved in options, authenticates as that account (it wins over the browser
// session, and a wrong password is reported rather than silently falling back).
// Otherwise uses the browser's Gerrit login cookie, seeing what the Gerrit UI sees.
async function handleGetGerritChanges(issueKey) {
  const key = String(issueKey || '').trim().toUpperCase();
  if (!isValidIssueKey(key)) return { ok: false, message: I18N.t('sw.error.noIssueKey') };
  if (!sites.gerritOrigin) return { ok: false, message: I18N.t('sw.error.noGerritOrigin') };

  const { gerritUser, gerritPassword } = await chrome.storage.local.get(['gerritUser', 'gerritPassword']);
  const basic = gerritUser && gerritPassword ? basicAuth(gerritUser, gerritPassword) : '';

  // An issue rarely has more than a handful of changes; past this the popup links
  // to the full Gerrit search instead of growing a long list.
  const limit = 10;
  const query = encodeURIComponent(`message:"${key}"`);
  let resp;
  try {
    resp = await fetch(
      `${sites.gerritOrigin}${basic ? '/a' : ''}/changes/?q=${query}&n=${limit}&o=DETAILED_ACCOUNTS`,
      basic
        ? { credentials: 'omit', headers: { Accept: 'application/json', Authorization: `Basic ${basic}` } }
        : { credentials: 'include', headers: { Accept: 'application/json' } },
    );
  } catch {
    // Also lands here when an SSO login redirect leaves the Gerrit origin.
    return { ok: false, message: I18N.t('sw.gerrit.unreachable') };
  }
  if (basic && resp.status === 401) {
    return { ok: false, message: I18N.t('sw.gerrit.badPassword') };
  }
  if (!resp.ok || new URL(resp.url).origin !== sites.gerritOrigin) {
    return { ok: false, message: I18N.t('sw.gerrit.searchFailed', { status: resp.status }) };
  }

  let list;
  try {
    // Gerrit prefixes JSON with )]}' to block XSSI.
    list = JSON.parse((await resp.text()).replace(/^\)\]\}'\s*/, ''));
  } catch {
    return { ok: false, message: I18N.t('sw.gerrit.searchFailed', { status: resp.status }) };
  }
  if (!Array.isArray(list)) list = [];

  // An anonymous search still succeeds but only sees public changes, so an empty
  // result needs a login check: /accounts/self answers 403 without a session.
  let signedIn = true;
  if (!list.length && !basic) {
    const me = await fetch(`${sites.gerritOrigin}/accounts/self`, { credentials: 'include' }).catch(() => null);
    signedIn = !!me?.ok && new URL(me.url).origin === sites.gerritOrigin;
  }

  return {
    ok: true,
    signedIn,
    loginUrl: signedIn ? '' : `${sites.gerritOrigin}/login/`,
    more: !!list[list.length - 1]?._more_changes,
    searchUrl: `${sites.gerritOrigin}/q/${query}`,
    changes: list.map((c) => ({
      number: c._number,
      subject: String(c.subject || ''),
      // Gerrit's UI shows work-in-progress changes as WIP rather than NEW.
      status: c.work_in_progress && c.status === 'NEW' ? 'WIP' : String(c.status || ''),
      project: String(c.project || ''),
      branch: String(c.branch || ''),
      owner: String(c.owner?.name || c.owner?.username || ''),
      // Merged changes show when they were merged; the rest when they last changed.
      date: c.submitted
        ? I18N.t('gerrit.date.merged', { date: formatDateMaybe(c.submitted).slice(0, 10) })
        : I18N.t('gerrit.date.updated', { date: formatDateMaybe(c.updated).slice(0, 10) }),
      url: `${sites.gerritOrigin}/c/${encodeURIComponent(c.project).replace(/%2F/g, '/')}/+/${c._number}`,
    })),
  };
}

// btoa only takes Latin-1; encode as UTF-8 first so non-ASCII usernames work.
function basicAuth(user, password) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(`${user}:${password}`)));
}

function dispatchMessage(msg, sendResponse) {
  if (msg.type === MSG.SET_SITES) {
    registerSiteContentScripts()
      .then((registered) => sendResponse({ ok: true, registered }))
      .catch((err) => sendResponse({ ok: false, message: String(err?.message || err) }));
    return;
  }

  if (msg.type === MSG.TEST_CONNECTION) {
    handleTestConnection(msg.email, msg.token, msg.gerritUser, msg.gerritPassword).then(sendResponse);
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

  if (msg.type === MSG.POPUP_CHECK_COMMENT) {
    handlePopupCheckComment(msg.issueKeyOverride).then(sendResponse);
    return true;
  }

  if (msg.type === MSG.POPUP_GET_TRANSITIONS) {
    handlePopupGetTransitions(msg.issueKey).then(sendResponse);
    return true;
  }

  if (msg.type === MSG.POPUP_DO_TRANSITION) {
    handlePopupDoTransition(msg.issueKey, msg.transitionId, msg.fields).then(sendResponse);
    return true;
  }

  if (msg.type === MSG.POPUP_ADD_REMOTE_LINK) {
    handlePopupAddRemoteLink(msg.issueKeyOverride).then(sendResponse);
    return true;
  }

  if (msg.type === MSG.POPUP_ADD_COMMENT) {
    handlePopupAddComment(msg.issueKeyOverride, !!msg.force, msg.commentText).then(sendResponse);
    return true;
  }

  if (msg.type === MSG.POPUP_PREVIEW_COMMENT) {
    handlePopupPreviewComment(msg.issueKeyOverride).then(sendResponse);
    return true;
  }

  if (msg.type === MSG.POPUP_QUICK_APPLY) {
    handlePopupQuickApply(msg.issueKeyOverride, msg.commentText, !!msg.force).then(sendResponse);
    return true;
  }

  if (msg.type === MSG.GET_JIRA_RESOLUTIONS) {
    jiraClient.getResolutions()
      .then((resolutions) => sendResponse({ ok: true, resolutions }))
      .catch(() => sendResponse({ ok: false, resolutions: [] }));
    return true;
  }

  if (msg.type === MSG.GET_JIRA_STATUSES) {
    jiraClient.getStatuses()
      .then((statuses) => sendResponse({ ok: true, statuses }))
      .catch(() => sendResponse({ ok: false, statuses: [] }));
    return true;
  }

  if (msg.type === MSG.OPEN_OPTIONS) {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === MSG.GET_GERRIT_CHANGES) {
    // A stray exception must still answer, or the popup stays on "Searching...".
    handleGetGerritChanges(msg.issueKey)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, message: I18N.t('sw.gerrit.unreachable') }));
    return true;
  }

  if (msg.type === MSG.POPUP_SET_FAB_ENABLED) {
    handlePopupSetFabEnabled(!!msg.enabled).then(sendResponse);
    return true;
  }

}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Site URLs must be in the cache before any handler runs; the worker may have
  // just been restarted.
  loadSites().then(() => dispatchMessage(msg, sendResponse));
  return true;
});

// Gerrit HTTP password check: /a/accounts/self answers 200 for valid Basic credentials.
async function testGerritCredentials(gerritUser, gerritPassword) {
  if (!sites.gerritOrigin) return { noSite: true };
  try {
    const resp = await fetch(`${sites.gerritOrigin}/a/accounts/self`, {
      headers: { Authorization: `Basic ${basicAuth(gerritUser, gerritPassword)}` },
      credentials: 'omit',
    });
    return { status: resp.status };
  } catch {
    return { networkError: true };
  }
}

async function handleTestConnection(email, token, gerritUser, gerritPassword) {
  const gerrit = gerritUser && gerritPassword
    ? await testGerritCredentials(gerritUser, gerritPassword)
    : undefined;
  if (!email && !token) return { gerrit };
  return { ...(await testJiraCredentials(email, token)), gerrit };
}

async function testJiraCredentials(email, token) {
  // Diagnostics carry only lengths and server reason headers — never the values.
  const emailLength = String(email || '').length;
  const tokenLength = String(token || '').length;

  if (!email || !token) {
    return { status: 401, reason: 'EMPTY_INPUT', emailLength, tokenLength };
  }

  if (!sites.jiraBase) {
    return { status: null, noSite: true };
  }

  try {
    assertJiraConfigured();
    const resp = await fetch(`${sites.jiraBase}/rest/api/3/myself`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${btoa(`${email}:${token}`)}`,
        Accept: 'application/json',
      },
      credentials: 'omit',
    });
    return {
      status: resp.status,
      reason: resp.headers.get('x-seraph-loginreason') || '',
      denied: resp.headers.get('x-authentication-denied-reason') || '',
      headerNames: [...resp.headers.keys()].join(', '),
      emailLength,
      tokenLength,
    };
  } catch {
    return { status: null, networkError: true };
  }
}
