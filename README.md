# Gerrit → Jira Comment (Chrome Extension)

Chrome Extension (Manifest V3)으로, Gerrit change 페이지에서 툴바 버튼 한 번으로 Jira 이슈에 코멘트를 자동 추가합니다.

---

## 기능

| 기능 | 설명 |
|------|------|
| 원클릭 댓글 | Gerrit change 페이지에서 확장프로그램 아이콘 클릭 → Jira 이슈에 ADF 형식 댓글 자동 추가 |
| 이슈키 자동 추출 | 커밋 메시지의 `jira: PROJ-123` 태그 (1순위) 또는 change 제목(예: `[PROJ-123] Fix bug`) (2순위)에서 자동 감지 |
| 댓글 템플릿 커스터마이즈 | `{title}`, `{body}`, `{branch}`, `{change_num}`, `{project}`, `{owner}`, `{date}`, `{url}` 플레이스홀더로 댓글 형식을 자유롭게 변경 가능 |
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

### 템플릿 설정

옵션 페이지 하단의 **댓글 템플릿** 텍스트 영역에서 Jira에 남길 댓글 형식을 직접 편집할 수 있습니다.

**지원 플레이스홀더:**

| 플레이스홀더 | 설명 | 예시 값 |
|---|---|---|
| `{title}` | Gerrit change 제목 (subject) | `[PROJ-123] Fix login bug` |
| `{body}` | 커밋 메시지 본문 (제목 제외, `jira:` 줄 제거) | `세션 만료 처리 수정.` |
| `{branch}` | 대상 브랜치 | `main` |
| `{change_num}` | Gerrit change 번호 | `12345` |
| `{project}` | Gerrit 프로젝트 경로 | `platform/myapp` |
| `{owner}` | change 작성자 이름 | `홍길동` |
| `{date}` | 댓글 작성 일시 (`YYYY-MM-DD HH:mm`) | `2025-02-23 14:30` |
| `{url}` | Gerrit change 전체 URL (클릭 가능 링크로 변환됨) | `http://gerrit.../+/12345` |

- 템플릿을 비워 두거나 **기본값으로 초기화** 버튼을 누르면 아래 기본 템플릿이 적용됩니다.
- 값이 없는 플레이스홀더(예: 브랜치 추출 실패 시 `{branch}`)는 빈 문자열로 대체되고, 연속된 빈 줄은 자동으로 압축됩니다.

---

## 사용 방법

1. Gerrit change 상세 페이지로 이동합니다.
   예: `http://gerrit.example.com/c/myproject/+/12345`
2. 툴바의 **Gerrit → Jira Comment** 아이콘을 클릭합니다.
3. 이슈키가 감지되면 Jira에 댓글이 추가되고, 우상단 토스트로 결과가 표시됩니다.

### 댓글 형식 (기본 템플릿)

옵션 페이지에서 템플릿을 변경하지 않았을 때 사용되는 기본 형식입니다.

**템플릿:**

```
{title}

{body}

브랜치: {branch}
반영 일시: {date}
Gerrit: {url}
```

**렌더링 예시:**

```
[PROJ-123] Fix login bug

세션 만료 시 쿠키를 재설정하도록 수정.

브랜치: main
반영 일시: 2025-02-23 14:30
Gerrit: http://gerrit.example.com/c/myproject/+/12345
```

> Jira에서 `{url}` 부분은 클릭 가능한 ADF 하이퍼링크로 렌더링됩니다.

---

## 이슈키 추출 규칙

우선순위 순서:

| 순위 | 소스 | 예시 |
|------|------|------|
| 1 | 커밋 메시지의 `jira:` 태그 | `jira: PROJ-123` |
| 2 | change 제목 / 문서 제목의 bare key | `[PROJ-123] Fix bug`, `PROJ-123: Fix bug` |

- `jira:` 태그가 가장 명시적이므로 1순위로 처리합니다.
- 제목 기반 추출은 2순위입니다 (비이슈 태그 `[OOXML]` 등과 오인식 가능성이 낮아야 하므로 후순위).
- 이슈키를 찾지 못하면 토스트로 안내하고 종료합니다.

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
                       chrome.storage.local 읽기 (credentials + commentTemplate)
                       renderTemplate() — 플레이스홀더 치환
                       Jira API fetch (POST /comment, GET /myself)
content_script.js      Gerrit DOM 파싱 (subject, issueKey, body, branch,
                                        changeNum, project, owner, url)
                       Shadow DOM 탐색 (queryShadow / queryShadowAll)
                       토스트 표시
options.html / .js     이메일·토큰·댓글 템플릿 저장 UI
                       기본값으로 초기화 버튼
                       연결 테스트 (service worker 경유)
```

### 메시지 흐름

```
[action click] ──► service_worker
                        │
                        ├─► EXTRACT_INFO ──► content_script (DOM 추출)
                        │       ◄─────────── { subject, issueKey, url,
                        │                     body, branch, changeNum,
                        │                     project, owner }
                        │
                        ├─► chrome.storage.local (jiraEmail, jiraToken,
                        │                         commentTemplate)
                        │
                        ├─► renderTemplate(template, vars)
                        │       — 플레이스홀더 치환, 빈 줄 압축
                        │
                        ├─► fetch POST /rest/api/3/issue/{key}/comment
                        │       — rendered text → ADF 변환 후 전송
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
