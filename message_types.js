// Shared runtime message types used across service worker, popup, and content script.
(function initMessageTypes(root) {
  const MESSAGE_TYPES = Object.freeze({
    EXTRACT_CONTEXT: 'EXTRACT_CONTEXT',
    EXTRACT_INFO: 'EXTRACT_INFO', // backward compatibility
    SHOW_TOAST: 'SHOW_TOAST',
    FAB_ENABLE: 'FAB_ENABLE',
    FAB_DISABLE: 'FAB_DISABLE',
    POPUP_GET_CONTEXT: 'POPUP_GET_CONTEXT',
    POPUP_SET_FAB_ENABLED: 'POPUP_SET_FAB_ENABLED',
    POPUP_GET_ISSUE: 'POPUP_GET_ISSUE',
    POPUP_ADD_REMOTE_LINK: 'POPUP_ADD_REMOTE_LINK',
    POPUP_ADD_COMMENT: 'POPUP_ADD_COMMENT',
    TEST_CONNECTION: 'TEST_CONNECTION',
  });

  root.MESSAGE_TYPES = MESSAGE_TYPES;
})(typeof self !== 'undefined' ? self : window);
