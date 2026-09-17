// i18n.js
// Shared string table for popup, options, content script and service worker.
//
// chrome.i18n (_locales) follows the browser language and cannot be overridden,
// but the language here is a user setting, so the table is kept in-extension.
//
// Language preference lives in chrome.storage.local under 'uiLanguage':
//   'auto' (or unset) -> browser language, Korean when it starts with ko
//   'ko' | 'en'       -> forced

(function initI18n(root) {
  'use strict';

  const CATALOG = { ko: {}, en: {} };
  let lang = 'en';

  /**
   * @param {Record<string, {ko: string, en: string}>} entries
   */
  function register(entries) {
    for (const key of Object.keys(entries)) {
      CATALOG.ko[key] = entries[key].ko;
      CATALOG.en[key] = entries[key].en;
    }
  }

  function resolve(pref) {
    if (pref === 'ko' || pref === 'en') return pref;
    const nav = String((root.navigator && root.navigator.language) || 'en').toLowerCase();
    return nav.startsWith('ko') ? 'ko' : 'en';
  }

  function setLang(pref) {
    lang = resolve(pref);
    return lang;
  }

  function getLang() {
    return lang;
  }

  /**
   * @param {string} key
   * @param {Record<string, string|number>} [vars] replaces {name} in the string
   */
  function t(key, vars) {
    let s = CATALOG[lang][key];
    if (s == null) s = CATALOG.en[key];
    // A missing key shows as the key itself, which is easier to spot than a blank.
    if (s == null) return key;
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
    }
    return s;
  }

  /**
   * Fills elements carrying data-i18n / data-i18n-placeholder / data-i18n-title.
   * data-i18n-html is for the few strings with inline markup; values come from
   * this file only, never from user or network input.
   */
  function applyDom(scope) {
    const el = scope || root.document;
    if (!el) return;

    el.querySelectorAll('[data-i18n]').forEach((node) => {
      node.textContent = t(node.dataset.i18n);
    });
    el.querySelectorAll('[data-i18n-html]').forEach((node) => {
      node.innerHTML = t(node.dataset.i18nHtml);
    });
    el.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
      node.placeholder = t(node.dataset.i18nPlaceholder);
    });
    el.querySelectorAll('[data-i18n-title]').forEach((node) => {
      node.title = t(node.dataset.i18nTitle);
    });
    el.querySelectorAll('[data-i18n-label]').forEach((node) => {
      node.setAttribute('aria-label', t(node.dataset.i18nLabel));
    });
  }

  /**
   * Reads the stored preference, then runs the callback. Pages call this before
   * their first render so nothing flashes in the wrong language.
   * @param {() => void} [done]
   */
  function init(done) {
    try {
      chrome.storage.local.get(['uiLanguage'], (data) => {
        setLang((data && data.uiLanguage) || 'auto');
        if (done) done();
      });
    } catch {
      setLang('auto');
      if (done) done();
    }
  }

  root.I18N = { register, setLang, getLang, t, applyDom, init };
})(typeof self !== 'undefined' ? self : window);

// -- Strings -------------------------------------------------------------------
// Keys are namespaced by surface: options.*, popup.*, cs.* (content script),
// sw.* (service worker). Keep both languages filled; a missing key falls back to
// English and then to the key itself.

(typeof self !== 'undefined' ? self : window).I18N.register({
  // popup
  'popup.label.issue': { ko: '이슈', en: 'Issue' },
  'popup.label.status': { ko: '상태', en: 'Status' },
  'popup.label.statusChange': { ko: '상태 변경', en: 'Change status' },
  'popup.label.assignee': { ko: '담당자', en: 'Assignee' },
  'popup.label.fab': { ko: 'FAB 사용', en: 'Enable FAB' },
  'popup.value.unassigned': { ko: '담당자 없음', en: 'Unassigned' },

  'popup.btn.refresh': { ko: '이슈 다시 조회', en: 'Reload issue' },
  'popup.btn.options': { ko: '설정 열기', en: 'Open settings' },
  'popup.btn.openIssue': { ko: '이슈 페이지 이동', en: 'Open issue page' },
  'popup.btn.apply': { ko: '⚡ 반영 처리', en: '⚡ Apply to Jira' },
  'popup.btn.link': { ko: '웹링크 추가', en: 'Add web link' },
  'popup.btn.comment': { ko: '코멘트 생성', en: 'Add comment' },
  'popup.btn.previewSubmit': { ko: '등록', en: 'Submit' },
  'popup.btn.previewCancel': { ko: '취소', en: 'Cancel' },
  'popup.btn.previewSubmitApply': { ko: '반영 처리 실행', en: 'Apply to Jira' },
  'popup.btn.previewSubmitComment': { ko: '코멘트 등록', en: 'Post comment' },

  'popup.title.applyMerged': { ko: '머지된 change입니다. Jira에 반영 처리하세요.', en: 'This change is merged. Apply it to Jira.' },
  'popup.state.commentExists': { ko: '💬 이 change의 코멘트가 이미 등록되어 있습니다', en: '💬 A comment for this change is already posted' },

  'popup.preview.title': { ko: '코멘트 미리보기', en: 'Comment preview' },
  'popup.preview.titleApply': { ko: '반영 처리 - 코멘트 미리보기', en: 'Apply to Jira - comment preview' },
  'popup.preview.dup': { ko: '⚠ 이미 이 change의 코멘트가 있습니다', en: '⚠ This change already has a comment' },

  'popup.confirm.duplicateComment': { ko: '{key}에 이 change의 코멘트가 이미 있습니다.\n그래도 새 코멘트를 생성할까요?', en: '{key} already has a comment for this change.\nPost another one anyway?' },
  'popup.confirm.duplicateApply': { ko: '{key}에 이 change의 코멘트가 이미 있습니다.\n그래도 반영 처리를 진행할까요?', en: '{key} already has a comment for this change.\nApply to Jira anyway?' },

  'popup.status.initializing': { ko: '초기화 중...', en: 'Starting up...' },
  'popup.status.requestError': { ko: '요청 중 오류가 발생했습니다.', en: 'The request failed.' },
  'popup.status.noJiraBase': { ko: '설정에서 Jira 주소를 먼저 입력하세요.', en: 'Set the Jira URL in options first.' },
  'popup.status.noIssueKey': { ko: '이슈키를 먼저 확인하세요.', en: 'Set an issue key first.' },
  'popup.status.cancelled': { ko: '취소했습니다.', en: 'Cancelled.' },

  'popup.status.transitioning': { ko: '상태 변경 중...', en: 'Changing status...' },
  'popup.status.transitionFailed': { ko: '상태 변경에 실패했습니다.', en: 'Could not change the status.' },
  'popup.status.transitionDone': { ko: '상태 변경 완료: {key}', en: 'Status changed: {key}' },

  'popup.status.noGerritPage': { ko: 'Gerrit 페이지를 찾을 수 없습니다.', en: 'No Gerrit page found.' },
  'popup.status.enterIssueKey': { ko: 'Issue key를 입력하거나 자동 감지를 확인하세요.', en: 'Enter an issue key, or check what was auto-detected.' },
  'popup.status.contextReady': { ko: '컨텍스트 확인 완료. 이슈 조회를 실행합니다.', en: 'Context loaded. Looking up the issue.' },
  'popup.status.contextRefreshed': { ko: '컨텍스트 새로고침 완료.\nJira 인증 후 이슈 조회를 사용할 수 있습니다.', en: 'Context refreshed.\nSet up Jira auth to look up issues.' },
  'popup.status.noConnection': { ko: '확장프로그램과 통신할 수 없습니다. 확장프로그램을 다시 로드하세요.', en: 'Cannot reach the extension. Reload it and try again.' },
  'popup.status.autoFetchHint': { ko: 'Gerrit change URL에서 자동 조회가 실행됩니다.', en: 'Auto lookup runs on a Gerrit change URL.' },

  'popup.status.fabSaveFailed': { ko: 'FAB 설정 저장에 실패했습니다.', en: 'Could not save the FAB setting.' },
  'popup.status.fabOn': { ko: 'FAB 활성화 완료', en: 'FAB enabled' },
  'popup.status.fabOff': { ko: 'FAB 비활성화 완료', en: 'FAB disabled' },
  'popup.status.fabError': { ko: 'FAB 설정 변경 중 오류가 발생했습니다.', en: 'Changing the FAB setting failed.' },

  'popup.status.authMissing': { ko: 'Jira 인증이 없어 사용할 수 없습니다.', en: 'Unavailable without Jira auth.' },
  'popup.status.authMissingFetch': { ko: 'Jira 인증이 없어 이슈 조회는 비활성화되었습니다.\n컨텍스트 탐색은 계속 사용할 수 있습니다.', en: 'Issue lookup is off without Jira auth.\nContext detection still works.' },
  'popup.status.authMissingLink': { ko: 'Jira 인증이 없어 웹링크 추가는 비활성화되었습니다.', en: 'Adding a web link is off without Jira auth.' },
  'popup.status.authMissingComment': { ko: 'Jira 인증이 없어 코멘트 생성은 비활성화되었습니다.', en: 'Adding a comment is off without Jira auth.' },
  'popup.status.authMissingApply': { ko: 'Jira 인증이 없어 반영 처리는 비활성화되었습니다.', en: 'Applying to Jira is off without Jira auth.' },
  'popup.status.authMissingInit': { ko: 'Jira 인증이 없어 API 버튼은 비활성화되었습니다.\nSubject/Issue Key 탐색은 계속 사용할 수 있습니다.', en: 'API buttons are off without Jira auth.\nSubject and issue key detection still work.' },

  'popup.status.fetchingIssue': { ko: 'Jira 이슈 조회 중...', en: 'Looking up the Jira issue...' },
  'popup.status.fetchFailed': { ko: '이슈 조회에 실패했습니다.', en: 'Could not load the issue.' },
  'popup.status.fetchDone': { ko: '이슈 조회 완료: {key}', en: 'Issue loaded: {key}' },

  'popup.status.addingLink': { ko: '웹링크 추가 중...', en: 'Adding the web link...' },
  'popup.status.linkFailed': { ko: '웹링크 추가에 실패했습니다.', en: 'Could not add the web link.' },
  'popup.status.linkDone': { ko: '웹링크 추가 완료: {key}', en: 'Web link added: {key}' },

  'popup.status.addingComment': { ko: '코멘트 생성 중...', en: 'Adding the comment...' },
  'popup.status.commentCancelled': { ko: '코멘트 생성을 취소했습니다.', en: 'Comment cancelled.' },
  'popup.status.commentFailed': { ko: '코멘트 생성에 실패했습니다.', en: 'Could not add the comment.' },
  'popup.status.commentDone': { ko: '코멘트 생성 완료: {key}', en: 'Comment added: {key}' },
  'popup.status.submittingComment': { ko: '코멘트 등록 중...', en: 'Posting the comment...' },

  'popup.status.applying': { ko: '반영 처리 중...', en: 'Applying to Jira...' },
  'popup.status.applyCancelled': { ko: '반영 처리를 취소했습니다.', en: 'Apply cancelled.' },
  'popup.status.applyFailed': { ko: '반영 처리에 실패했습니다.', en: 'Could not apply to Jira.' },
  'popup.status.applyDone': { ko: '반영 처리 완료: {key}', en: 'Applied to Jira: {key}' },

  'popup.status.buildingPreview': { ko: '미리보기 생성 중...', en: 'Building the preview...' },
  'popup.status.previewFailed': { ko: '미리보기 생성에 실패했습니다.', en: 'Could not build the preview.' },
  'popup.status.previewHint': { ko: '내용 확인/수정 후 실행하세요.', en: 'Review or edit the text, then run it.' },
  'popup.status.emptyComment': { ko: '코멘트 내용이 비어 있습니다.', en: 'The comment is empty.' },
  'popup.status.submitFailed': { ko: '실행에 실패했습니다.', en: 'The action failed.' },

  // service worker
  'sw.error.noGerritOrigin': { ko: '설정에서 Gerrit 주소를 먼저 입력하세요.', en: 'Set the Gerrit URL in options first.' },
  'sw.error.notGerritTab': { ko: 'Gerrit change 페이지에서 팝업을 열어주세요.', en: 'Open the popup on a Gerrit change page.' },
  'sw.error.notChangePage': { ko: 'Gerrit change 상세 페이지(/c/.../+/번호)에서 실행하세요.', en: 'Run this on a Gerrit change detail page (/c/.../+/number).' },
  'sw.error.notAllowedDomain': { ko: '허용된 Gerrit 도메인이 아닙니다.', en: 'Not an allowed Gerrit domain.' },
  'sw.error.contextRead': { ko: '페이지 정보를 읽을 수 없습니다. 페이지를 새로고침 후 다시 시도하세요.', en: "Couldn't read the page. Reload it and try again." },
  'sw.error.missingCredentials': { ko: 'Jira 이메일/토큰이 설정되지 않았습니다.\n옵션 페이지에서 설정하세요.', en: 'Jira email and API token are not set.\nConfigure them on the options page.' },
  'sw.error.noIssueKey': { ko: 'PROJ-123 같은 이슈키가 필요합니다. 제목 또는 커밋 메시지에 jira: KEY를 추가하세요.', en: 'An issue key like PROJ-123 is required. Add jira: KEY to the subject or the commit message.' },
  'sw.error.invalidGerritUrl': { ko: '현재 페이지 URL이 허용된 Gerrit 도메인이 아닙니다.', en: 'The current page is not on an allowed Gerrit domain.' },
  'sw.error.network': { ko: '네트워크 오류가 발생했습니다. 인터넷 연결을 확인하세요.', en: 'Network error. Check your internet connection.' },
  'sw.error.lookupIssue': { ko: '이슈 조회에 실패했습니다.', en: 'Failed to look up the issue.' },
  'sw.error.lookupTransitions': { ko: '상태 목록 조회에 실패했습니다.', en: 'Failed to load the status list.' },
  'sw.error.pickTransition': { ko: '변경할 상태를 선택하세요.', en: 'Pick a status to move the issue to.' },
  'sw.error.transitionFailed': { ko: '상태 변경에 실패했습니다.', en: 'Failed to change the status.' },
  'sw.error.remoteLinkFailed': { ko: '웹링크 추가에 실패했습니다.', en: 'Failed to add the web link.' },
  'sw.error.previewFailed': { ko: '코멘트 미리보기 생성에 실패했습니다.', en: 'Failed to build the comment preview.' },
  'sw.error.checkCommentFailed': { ko: '코멘트 상태 확인에 실패했습니다.', en: 'Failed to check for an existing comment.' },
  'sw.error.commentFailed': { ko: '코멘트 생성에 실패했습니다.', en: 'Failed to add the comment.' },
  'sw.error.applyFailed': { ko: '반영 처리에 실패했습니다.', en: 'Failed to apply to Jira.' },
  'sw.http.400': { ko: '잘못된 요청 (400): 이슈 키 또는 요청 형식을 확인하세요.', en: 'Bad request (400): check the issue key and the request format.' },
  'sw.http.401': { ko: '인증 실패 (401): Jira 이메일 또는 API 토큰을 확인하세요.', en: 'Auth failed (401): check your Jira email and API token.' },
  'sw.http.403': { ko: '권한 없음 (403): 해당 작업 권한이 없습니다.', en: "Forbidden (403): you don't have permission for this." },
  'sw.http.404': { ko: '대상을 찾을 수 없음 (404): 이슈 키를 확인하세요.', en: 'Not found (404): check the issue key.' },
  'sw.http.other': { ko: 'Jira API 오류: HTTP {status}', en: 'Jira API error: HTTP {status}' },
  'sw.comment.duplicate': { ko: '{issueKey}에 이 change의 코멘트가 이미 있습니다.', en: '{issueKey} already has a comment for this change.' },
  'sw.transition.noMatch': { ko: '일치하는 상태 없음: {name} (이미 해당 상태이거나 이름 확인 필요)', en: 'No matching transition: {name} (already in that status, or check the name)' },
  'sw.transition.shortFail': { ko: '상태 변경 실패', en: 'Status change failed' },
  'sw.apply.done': { ko: '반영 처리 완료: {issueKey} (웹링크+코멘트)', en: 'Applied to {issueKey} (web link + comment)' },
  'sw.apply.doneWithTransition': { ko: '반영 처리 완료: {issueKey} (웹링크+코멘트+상태변경: {status})', en: 'Applied to {issueKey} (web link + comment + status: {status})' },
  'sw.apply.doneTransitionFailed': { ko: '반영 처리 완료: {issueKey} (웹링크+코멘트) / 상태변경 실패: {note}', en: 'Applied to {issueKey} (web link + comment) / status change failed: {note}' },
  'sw.fab.savedGerritTab': { ko: 'FAB 설정이 저장되었습니다. Gerrit 탭에서 반영됩니다.', en: 'FAB setting saved. It takes effect on Gerrit tabs.' },
  'sw.fab.savedReload': { ko: 'FAB 설정이 저장되었습니다. 페이지 새로고침 시 반영됩니다.', en: 'FAB setting saved. It takes effect after a page reload.' },

  // content script
  'cs.error.noIssueKey': { ko: 'PROJ-123 같은 이슈키가 필요합니다. 제목 또는 jira: KEY를 확인하세요.', en: 'An issue key like PROJ-123 is required. Check the subject or the jira: KEY line.' },
  'cs.toast.openIssue': { ko: '이슈 열기', en: 'Open issue' },
  'cs.toast.lookingUp': { ko: '이슈 조회 중: {key}', en: 'Looking up {key}...' },
  'cs.toast.lookupDone': { ko: '이슈 조회 완료: {key}', en: 'Looked up {key}' },
  'cs.toast.requestError': { ko: '요청 중 오류가 발생했습니다.', en: 'Something went wrong with the request.' },
  'cs.toast.linking': { ko: '웹링크 추가 중...', en: 'Adding web link...' },
  'cs.toast.linkDone': { ko: '웹링크 추가 완료: {key}', en: 'Web link added: {key}' },
  'cs.toast.commenting': { ko: '코멘트 생성 중...', en: 'Adding comment...' },
  'cs.toast.commentCancelled': { ko: '코멘트 생성을 취소했습니다.', en: 'Comment cancelled.' },
  'cs.toast.commentDone': { ko: '코멘트 생성 완료: {key}', en: 'Comment added: {key}' },
  'cs.toast.applying': { ko: '반영 처리 중...', en: 'Applying to Jira...' },
  'cs.toast.applyCancelled': { ko: '반영 처리를 취소했습니다.', en: 'Apply cancelled.' },
  'cs.toast.applyDone': { ko: '반영 처리 완료: {key}', en: 'Applied to {key}' },
  'cs.toast.optionsFailed': { ko: '설정 페이지를 열 수 없습니다.', en: "Couldn't open the options page." },
  'cs.toast.noIssueKeyFound': { ko: '이슈키를 찾을 수 없습니다.', en: 'No issue key found.' },
  'cs.confirm.duplicateComment': { ko: '{issueKey}에 이 change의 코멘트가 이미 있습니다.\n그래도 새 코멘트를 생성할까요?', en: '{issueKey} already has a comment for this change.\nAdd another one anyway?' },
  'cs.confirm.duplicateApply': { ko: '{issueKey}에 이 change의 코멘트가 이미 있습니다.\n그래도 반영 처리(웹링크+코멘트)를 진행할까요?', en: '{issueKey} already has a comment for this change.\nApply anyway (web link + comment)?' },
  'cs.dialog.noSummary': { ko: '(제목 없음)', en: '(no title)' },
  'cs.fab.openIssue': { ko: '이슈 페이지 이동', en: 'Open in Jira' },
  'cs.fab.lookup': { ko: '이슈 조회', en: 'Look up issue' },
  'cs.fab.link': { ko: '웹링크 추가', en: 'Add web link' },
  'cs.fab.comment': { ko: '코멘트 생성', en: 'Add comment' },
  'cs.fab.apply': { ko: '반영 처리', en: 'Apply to Jira' },
  'cs.fab.options': { ko: '설정', en: 'Settings' },
  'cs.fab.mainTitle': { ko: 'Jira 빠른 액션', en: 'Jira quick actions' },
  'cs.fab.mainTitleNoKey': { ko: 'Jira 이슈키 미감지 (커밋 메시지에 jira: KEY 필요)', en: 'No Jira issue key detected (add jira: KEY to the commit message)' },
  'cs.pill.title': { ko: 'Jira 이슈 열기', en: 'Open Jira issue' },

  // options
  'options.pageTitle': { ko: 'Changelink - 설정', en: 'Changelink - Settings' },
  'options.title': { ko: '설정', en: 'Settings' },
  'options.subtitle': { ko: 'Changelink의 계정 연결, 동작 방식, 댓글 템플릿을 관리합니다.<br>변경 사항은 저장 즉시 모든 Gerrit 탭에 반영됩니다.', en: 'Manage the account connection, behavior and comment template for Changelink.<br>Changes reach every Gerrit tab as soon as you save.' },
  'options.field.gerritUrl': { ko: 'Gerrit 주소', en: 'Gerrit URL' },
  'options.note.gerritUrl': { ko: 'change 페이지 주소에서 <code>/c/</code> 앞까지. 예: <code>https://gerrit.example.com</code>', en: 'Everything before <code>/c/</code> in a change page URL. Example: <code>https://gerrit.example.com</code>' },
  'options.field.jiraUrl': { ko: 'Jira 주소', en: 'Jira URL' },
  'options.note.jiraUrl': { ko: 'Jira 를 열었을 때 주소창의 맨 앞부분. 예: <code>https://yourcompany.atlassian.net</code><br>저장하면 이 두 사이트의 접근 권한을 묻습니다. 허용해야 동작합니다. Jira 는 Cloud 기준입니다.', en: 'The front part of the address bar when Jira is open. Example: <code>https://yourcompany.atlassian.net</code><br>Saving asks for access to both sites. Nothing works until you allow it. Jira Cloud is assumed.' },
  'options.field.email': { ko: 'Jira 이메일', en: 'Jira email' },
  'options.field.token': { ko: 'Jira API 토큰', en: 'Jira API token' },
  'options.placeholder.token': { ko: 'API 토큰을 입력하세요', en: 'Enter your API token' },
  'options.a11y.showToken': { ko: '토큰 표시', en: 'Show token' },
  'options.a11y.hideToken': { ko: '토큰 숨기기', en: 'Hide token' },
  'options.note.token': { ko: 'API 토큰은 Atlassian 계정에서 발급한 값을 사용하세요.', en: 'Use an API token issued from your Atlassian account.' },
  'options.btn.save': { ko: '저장', en: 'Save' },
  'options.btn.test': { ko: '연결 테스트', en: 'Test connection' },
  'options.section.behavior': { ko: '동작 설정', en: 'Behavior' },
  'options.field.uiLanguage': { ko: '표시 언어', en: 'Display language' },
  'options.lang.auto': { ko: '자동 (브라우저 언어)', en: 'Auto (browser language)' },
  'options.toggle.preview': { ko: '팝업에서 코멘트 생성/반영 처리 전 미리보기·수정', en: 'Preview and edit in the popup before creating a comment or applying' },
  'options.toggle.pill': { ko: 'Gerrit 페이지에 이슈 상태 배지(pill) 표시', en: 'Show the issue status pill on Gerrit pages' },
  'options.toggle.transition': { ko: '반영 처리 시 이슈 상태 전환', en: 'Transition the issue status when applying' },
  'options.transition.off': { ko: '사용 안 함', en: 'Off' },
  'options.note.transition': { ko: '상태 목록은 저장된 Jira 계정에서 자동으로 불러옵니다.', en: 'The status list is loaded from the saved Jira account.' },
  'options.group.fab': { ko: 'FAB 메뉴 버튼 구성', en: 'FAB menu buttons' },
  'options.fab.openIssue': { ko: '이슈 페이지 이동', en: 'Open issue page' },
  'options.fab.lookup': { ko: '이슈 조회', en: 'Look up issue' },
  'options.fab.link': { ko: '웹링크 추가', en: 'Add web link' },
  'options.fab.comment': { ko: '코멘트 생성', en: 'Create comment' },
  'options.fab.apply': { ko: '반영 처리', en: 'Apply' },
  'options.fab.options': { ko: '설정', en: 'Settings' },
  'options.section.template': { ko: 'Jira 댓글 템플릿', en: 'Jira comment template' },
  'options.template.intro': { ko: '아래 플레이스홀더를 자유롭게 조합하세요. 비워두면 기본값이 사용됩니다.', en: 'Combine the placeholders below however you like. Leave it empty to use the default.' },
  'options.table.placeholder': { ko: '플레이스홀더', en: 'Placeholder' },
  'options.table.meaning': { ko: '치환 내용', en: 'Replaced with' },
  'options.ph.title': { ko: '커밋 제목 (첫 번째 줄)', en: 'Commit subject (first line)' },
  'options.ph.body': { ko: '커밋 메시지 본문 (제목·jira 라인 제외)', en: 'Commit message body (subject and jira line dropped)' },
  'options.ph.branch': { ko: '타겟 브랜치명', en: 'Target branch name' },
  'options.ph.changeNum': { ko: 'Gerrit change 번호 (예: 12345)', en: 'Gerrit change number (e.g. 12345)' },
  'options.ph.changeId': { ko: 'Gerrit Change-Id (예: Iabc123...)', en: 'Gerrit Change-Id (e.g. Iabc123...)' },
  'options.ph.project': { ko: '저장소 경로 (예: platform/myapp)', en: 'Repository path (e.g. platform/myapp)' },
  'options.ph.owner': { ko: 'change 작성자 이름', en: 'Change owner name' },
  'options.ph.date': { ko: '반영 일시 (submit 시각, 없으면 빈칸)', en: 'Submit time (blank when there is none)' },
  'options.ph.url': { ko: 'Gerrit change 링크 (클릭 가능)', en: 'Gerrit change link (clickable)' },
  'options.field.template': { ko: '템플릿', en: 'Template' },
  'options.btn.reset': { ko: '기본값으로 초기화', en: 'Reset to default' },
  'options.section.help': { ko: '도움말', en: 'Help' },
  'options.help.token': { ko: 'API 토큰 발급: <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener noreferrer">Atlassian 계정 설정</a>에서 발급하세요.', en: 'API token: issue one from <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener noreferrer">your Atlassian account settings</a>.' },
  'options.help.popup': { ko: 'Gerrit change 페이지에서 툴바 아이콘을 클릭하면 popup이 열리며 이슈 조회/웹링크 추가/코멘트 생성을 실행할 수 있습니다.', en: 'Click the toolbar icon on a Gerrit change page to open the popup, where you can look up the issue, add a web link or create a comment.' },
  'options.help.issueKey': { ko: '이슈 키는 change 제목(예: <code>[PROJ-123] Fix bug</code>) 또는 커밋 메시지의 <code>jira: PROJ-123</code> 형식에서 자동 추출됩니다.', en: 'The issue key is picked up from the change subject (e.g. <code>[PROJ-123] Fix bug</code>) or from a <code>jira: PROJ-123</code> line in the commit message.' },
  'options.help.test': { ko: '연결 테스트는 Jira 인증 여부만 확인하며 응답 본문은 읽지 않습니다.', en: 'The connection test only checks Jira authentication; it never reads the response body.' },
  'options.status.badGerritUrl': { ko: 'Gerrit 주소는 https://gerrit.example.com 형식으로 입력하세요.', en: 'Enter the Gerrit URL in the form https://gerrit.example.com' },
  'options.status.badJiraUrl': { ko: 'Jira 주소는 https://yourcompany.atlassian.net 형식으로 입력하세요.', en: 'Enter the Jira URL in the form https://yourcompany.atlassian.net' },
  'options.status.noPermission': { ko: '사이트 접근 권한이 없으면 동작하지 않습니다. 저장을 다시 눌러 허용하세요.', en: 'Nothing works without site access. Press Save again and allow it.' },
  'options.status.credPair': { ko: '이메일과 토큰은 함께 입력하거나 둘 다 비워두세요.', en: 'Enter both the email and the token, or leave both empty.' },
  'options.status.badEmail': { ko: '올바른 이메일 형식을 입력하세요.', en: 'Enter a valid email address.' },
  'options.status.saveError': { ko: '저장 중 오류가 발생했습니다.', en: 'Saving failed.' },
  'options.status.saved': { ko: '저장되었습니다.', en: 'Saved.' },
  'options.status.resetDone': { ko: '기본 템플릿으로 초기화됐습니다. 저장 버튼을 눌러 적용하세요.', en: 'Reset to the default template. Press Save to apply it.' },
  'options.status.needCreds': { ko: '이메일과 토큰을 입력한 뒤 테스트하세요.', en: 'Enter the email and token before testing.' },
  'options.status.testing': { ko: '테스트 중...', en: 'Testing...' },
  'options.status.swUnreachable': { ko: '서비스 워커와 통신할 수 없습니다. 확장프로그램을 재로드하세요.', en: 'Cannot reach the service worker. Reload the extension.' },
  'options.status.noSite': { ko: 'Jira 주소를 입력하고 저장한 뒤 테스트하세요.', en: 'Enter and save the Jira URL before testing.' },
  'options.status.networkError': { ko: '네트워크 오류: 인터넷 연결을 확인하세요.', en: 'Network error: check your internet connection.' },
  'options.status.testOkSaved': { ko: '연결 성공 (200 OK) - 인증 정보가 자동 저장되었습니다.', en: 'Connected (200 OK) - credentials saved automatically.' },
  'options.status.testOkSaveFailed': { ko: '연결 성공 (200 OK) - 자동 저장 실패. 저장 버튼을 눌러주세요.', en: 'Connected (200 OK) - but saving them failed. Press the Save button.' },
  'options.status.auth401': { ko: '인증 실패 (401) - 이메일 또는 토큰을 확인하세요.', en: 'Authentication failed (401) - check the email and token.' },
  'options.status.emptyInput': { ko: '이메일 또는 토큰이 비어 있는 상태로 전송되었습니다.', en: 'The email or token was sent empty.' },
  'options.status.sentLengths': { ko: '전송된 값: 이메일 {email}자 / 토큰 {token}자', en: 'Sent: email {email} chars / token {token} chars' },
  'options.status.serverReason': { ko: '서버 사유: {reason}', en: 'Server reason: {reason}' },
  'options.status.denied': { ko: '추가 사유: {reason} - CAPTCHA 잠금일 수 있습니다. 브라우저에서 Jira에 로그인한 뒤 다시 시도하세요.', en: 'Extra reason: {reason} - this may be a CAPTCHA lock. Log in to Jira in the browser and try again.' },
  'options.status.respHeaders': { ko: '응답 헤더: {headers}', en: 'Response headers: {headers}' },
  'options.status.forbidden': { ko: '권한 부족 (403) - 계정에 API 접근 권한이 없습니다.', en: 'Forbidden (403) - the account has no API access.' },
  'options.status.unexpected': { ko: '예상치 못한 응답 코드: {status}', en: 'Unexpected response code: {status}' },
});
