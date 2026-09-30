// Shared runtime message types (and the Jira URL helper) used across service
// worker, popup, and content script.
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
    POPUP_QUICK_APPLY: 'POPUP_QUICK_APPLY',
    OPEN_OPTIONS: 'OPEN_OPTIONS',
    TEST_CONNECTION: 'TEST_CONNECTION',
    SET_SITES: 'SET_SITES',
    GET_GERRIT_CHANGES: 'GET_GERRIT_CHANGES',
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

  root.MESSAGE_TYPES = MESSAGE_TYPES;
  root.jiraIssueKeyFromUrl = jiraIssueKeyFromUrl;
})(typeof self !== 'undefined' ? self : window);
