// Shared runtime message types (and the Jira URL / commit message helpers) used
// across service worker, popup, and content script.
(function initMessageTypes(root) {
  const MESSAGE_TYPES = Object.freeze({
    EXTRACT_CONTEXT: 'EXTRACT_CONTEXT',
    EXTRACT_INFO: 'EXTRACT_INFO', // backward compatibility
    SHOW_TOAST: 'SHOW_TOAST',
    FAB_ENABLE: 'FAB_ENABLE',
    FAB_DISABLE: 'FAB_DISABLE',
    POPUP_GET_CONTEXT: 'POPUP_GET_CONTEXT',
    POPUP_GET_AUTH_STATE: 'POPUP_GET_AUTH_STATE',
    POPUP_SET_FAB_ENABLED: 'POPUP_SET_FAB_ENABLED',
    POPUP_GET_ISSUE: 'POPUP_GET_ISSUE',
    POPUP_GET_TRANSITIONS: 'POPUP_GET_TRANSITIONS',
    GET_JIRA_STATUSES: 'GET_JIRA_STATUSES',
    GET_JIRA_RESOLUTIONS: 'GET_JIRA_RESOLUTIONS',
    POPUP_DO_TRANSITION: 'POPUP_DO_TRANSITION',
    POPUP_ADD_REMOTE_LINK: 'POPUP_ADD_REMOTE_LINK',
    POPUP_ADD_COMMENT: 'POPUP_ADD_COMMENT',
    POPUP_PREVIEW_COMMENT: 'POPUP_PREVIEW_COMMENT',
    POPUP_CHECK_COMMENT: 'POPUP_CHECK_COMMENT',
    OPEN_OPTIONS: 'OPEN_OPTIONS',
    TEST_CONNECTION: 'TEST_CONNECTION',
    SET_SITES: 'SET_SITES',
    GET_GERRIT_CHANGES: 'GET_GERRIT_CHANGES',
    JIRA_LIST_ADD: 'JIRA_LIST_ADD',
  });

  // Issue key of a Jira page: an issue opened over a board/backlog/search as
  // ?selectedIssue=KEY, /browse/KEY, .../issues/KEY, or a service desk queue
  // URL ending in the key.
  function jiraIssueKeyFromUrl(url) {
    try {
      const u = new URL(url);
      // Confluence shares the Jira Cloud origin; its pages are never issues.
      if (u.pathname.startsWith('/wiki/')) return '';
      const key = [
        u.searchParams.get('selectedIssue'),
        (u.pathname.match(/\/(?:browse|issues)\/([^/]+)/) || [])[1],
        // Only service desk queues end in the key; other app pages may end in "page-1".
        u.pathname.includes('/queues/') ? u.pathname.split('/').pop() : '',
      ].find((k) => k && /^[A-Z][A-Z0-9]+-\d+$/i.test(k));
      return key ? key.toUpperCase() : '';
    } catch {
      return '';
    }
  }

  // Look like issue keys but are not. Whole tokens, so projects named ES or CP still count.
  const NOT_ISSUE = /^(UTF-(8|16|32)|SHA-(1|224|256|384|512)|ISO-\d{4,5}|CP-(437|949|1252)|WIN-125\d|AES-(128|192|256)|MD-5|RFC-\d+|CVE-\d+|TLS-1|SSL-[23])$/;

  // The issue a commit is for: a "Jira: KEY" line wins, otherwise the first key in
  // the text (the subject line comes first in a commit message), skipping things
  // like UTF-8 and SHA-256. `loose` also takes lower-case keys, as the Gerrit page
  // detection always did; the Jira list does not, so "utf-8" never counts there.
  function mainIssueKey(text, loose) {
    const s = String(text || '');
    const tag = s.match(/jira\s*:\s*([A-Z][A-Z0-9]+-\d+)/i);
    if (tag && !NOT_ISSUE.test(tag[1].toUpperCase())) return tag[1].toUpperCase();
    for (const m of s.matchAll(loose ? /\b([A-Z][A-Z0-9]+-\d+)\b/gi : /\b([A-Z][A-Z0-9]+-\d+)\b/g)) {
      const key = m[1].toUpperCase();
      if (!NOT_ISSUE.test(key)) return key;
    }
    return null;
  }

  // Commit message body for the comment {body}: drops the subject line and the
  // trailers that already have their own template variables or say nothing.
  function commitBodyFromMessage(message) {
    return String(message || '')
      .trim()
      .split('\n')
      .slice(1)
      .filter((line) => !/^\s*jira\s*:/i.test(line))
      .filter((line) => !/^\s*change-id\s*:/i.test(line))
      .filter((line) => !/^\s*cherry[- ]picked\s+from\b/i.test(line))
      .filter((line) => !/^\s*cherry[- ]picked[- ]from\s*:/i.test(line))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  root.MESSAGE_TYPES = MESSAGE_TYPES;
  root.jiraIssueKeyFromUrl = jiraIssueKeyFromUrl;
  root.commitBodyFromMessage = commitBodyFromMessage;
  root.mainIssueKey = mainIssueKey;
})(typeof self !== 'undefined' ? self : window);
