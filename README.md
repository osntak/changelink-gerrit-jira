# Gerrit → Jira Comment (Chrome Extension)

Chrome Extension (Manifest V3)으로, Gerrit change 페이지에서 툴바 버튼 한 번으로 Jira 이슈에 코멘트를 자동 추가합니다.

---

## 기능

| 기능 | 설명 |
|------|------|
| 원클릭 댓글 | Gerrit change 페이지에서 확장프로그램 아이콘 클릭 → Jira 이슈에 ADF 형식 댓글 자동 추가 |
| 이슈키 자동 추출 | change 제목(예: `[PROJ-123] Fix bug`) 또는 커밋 메시지의 `jira: PROJ-123` 패턴에서 자동 감지 |
| 연결 테스트 | 옵션 페이지에서 Jira 인증을 미리 확인 가능 |
| 토스트 알림 | 성공/실패 결과를 페이지 우상단에 4.5초간 표시 |

---

## 설치 방법

> Chrome Web Store에 등록되지 않은 로컬 설치(개발자 모드)입니다.

1. 이 저장소를 클론하거나 ZIP으로 다운로드합니다.
2. Chrome 주소창에 `chrome://extensions` 를 입력합니다.
3. 우상단 **개발자 모드** 토글을 켭니다.
4. **압축해제된 확장프로그램을 로드합니다** 클릭 → 이 폴더(`gerrit-jira-automation/`)를 선택합니다.
5. 확장프로그램 아이콘이 툴바에 표시됩니다.

---

## 초기 설정

1. 툴바의 확장프로그램 아이콘을 **우클릭** → **옵션** 을 선택합니다.
   (또는 `chrome://extensions` → 이 확장프로그램의 **세부정보** → **확장 프로그램 옵션**)
2. **Jira 이메일**과 **Jira API 토큰**을 입력합니다.
   - API 토큰 발급: [https://id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
3. **저장** 클릭.
4. (선택) **연결 테스트** 클릭 → `연결 성공 (200 OK)` 확인.

---

## 사용 방법

1. Gerrit change 상세 페이지로 이동합니다.
   예: `http://gerrit.example.com/c/myproject/+/12345`
2. 툴바의 **Gerrit → Jira Comment** 아이콘을 클릭합니다.
3. 이슈키가 감지되면 Jira에 댓글이 추가되고, 우상단 토스트로 결과가 표시됩니다.

### 댓글 형식 (Jira)

```
[auto:gerrit] Gerrit change: http://gerrit.example.com/c/myproject/+/12345
Title: [PROJ-123] Fix login bug
```

---

## 이슈키 추출 규칙

우선순위 순서:

| 순위 | 소스 | 예시 |
|------|------|------|
| 1 | change 제목 / 문서 제목 | `[PROJ-123] Fix bug`, `PROJ-123: Fix bug` |
| 2 | 커밋 메시지의 `jira:` 태그 | `jira: PROJ-123` |
| 3 | 페이지 전체 텍스트 fallback | — |

이슈키를 찾지 못하면 토스트로 안내합니다.

---

## 보안 설계

| 항목 | 구현 |
|------|------|
| 토큰 저장 | `chrome.storage.local` 전용 — `chrome.storage.sync` 미사용 |
| 로그 노출 | 토큰·이메일·Authorization 헤더 등 민감 정보를 `console.log` 포함 어떤 로그에도 출력하지 않음 |
| 네트워크 요청 | 모든 Jira fetch는 background service worker에서만 수행 — content script는 DOM 읽기 전용 |
| host_permissions | `http://gerrit.example.com/*`, `https://gerrit.example.com/*`, `https://yourcompany.atlassian.net/*` 최소 고정 |
| 이슈키 검증 | service worker에서 정규식 allowlist로 재검증 후 URL 경로에 삽입 |
| 변경 URL 검증 | content script가 반환한 URL도 service worker에서 허용 Gerrit 도메인 여부 재검증 |
| 응답 본문 | Jira API 응답 본문은 읽지 않음 — HTTP 상태 코드만 사용 |
| 토큰 입력 UI | `type="password"` 필드 사용 |

---

## 아키텍처

```
manifest.json          MV3 설정, 최소 권한
service_worker.js      chrome.action.onClicked 처리
                       Jira API fetch (POST /comment, GET /myself)
                       chrome.storage.local 읽기
content_script.js      Gerrit DOM 파싱 (subject, issueKey)
                       Shadow DOM 탐색 (queryShadow/queryShadowAll)
                       토스트 표시
options.html / .js     이메일·토큰 저장 UI
                       연결 테스트 (service worker 경유)
```

### 메시지 흐름

```
[action click] ──► service_worker
                        │
                        ├─► EXTRACT_INFO ──► content_script (DOM 추출)
                        │       ◄─────────── { subject, issueKey, url }
                        │
                        ├─► chrome.storage.local (credentials)
                        │
                        ├─► fetch POST /rest/api/3/issue/{key}/comment
                        │
                        └─► SHOW_TOAST ──► content_script (토스트 표시)

[options page] ──► chrome.runtime.sendMessage TEST_CONNECTION
                        │
                        └─► service_worker: fetch GET /rest/api/3/myself
                                ◄─── { status } (body discarded)
```

---

## 지원 환경

- Gerrit: `http://gerrit.example.com/*` (HTTPS도 지원)
- Jira Cloud: `https://yourcompany.atlassian.net`
- Chrome 109+ (MV3 service worker 안정)

---

## 라이선스

Internal use only.
