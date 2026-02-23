# Gerrit Jira Automation (Chrome Extension, MV3)

Gerrit change 페이지에서 Jira 연동 3기능을 팝업으로 제공합니다.

1. 이슈 조회 (summary/status/assignee)
2. 웹링크(Remote Link) 추가
3. 코멘트 생성 (ADF)
4. FAB On/Off 토글 (`chrome.storage.local.fabEnabled`, 기본값 true)

## 현재 상태 점검 (코드 기준)

- 기존 UX(v1.0): 툴바 아이콘 클릭 시 즉시 코멘트 생성
  - 근거: 이전 `chrome.action.onClicked` 기반 동작
- 현재 UX(v1.1+): 툴바 아이콘 클릭 시 `popup.html` 열림, 팝업에서 기능 선택 실행
  - 근거: `manifest.json`의 `action.default_popup = popup.html`

네트워크 호출은 원칙대로 background(service worker)에서만 수행합니다.

- Jira API 호출 위치: `service_worker.js`
- content script 역할: Gerrit DOM 컨텍스트 추출 + 토스트 표시

## 기능 상세

### 1) 이슈 조회

- API: `GET /rest/api/3/issue/{issueKey}?fields=summary,status,assignee`
- 팝업 카드 표시:
  - Summary
  - Status
  - Assignee (없으면 `Unassigned`)

### 2) 웹링크 추가 (Remote Link)

- API: `POST /rest/api/3/issue/{issueKey}/remotelink`
- 매핑:
  - `object.url = gerritUrl`
  - `object.title = Gerrit: {subject}`
  - `globalId` (가능하면):
    - `gerrit:change:{changeNumber}`
    - 또는 `gerrit:changeid:{Change-Id}`

### 3) 코멘트 생성

- API: `POST /rest/api/3/issue/{issueKey}/comment`
- 형식: ADF
- 최소 포함 정보:
  - `[auto:gerrit]` 마커
  - Gerrit subject
  - Gerrit URL
- 기존 템플릿 옵션은 유지되며, 최소 정보가 누락되면 보정합니다.

## 이슈키 추출 규칙

content script에서 아래 우선순위로 탐지합니다.

1. subject/title의 bare key (`PROJ-123`)
2. commit message의 `jira: KEY`

정규식: `/([A-Z][A-Z0-9]+-\d+)/`

## 보안 정책

- 자격증명 저장: `chrome.storage.local`만 사용 (`sync` 미사용)
- 민감정보 보호:
  - 이메일/토큰/Authorization 헤더를 로그/UI에 원문 노출하지 않음
- host_permissions 최소 고정:
  - `http://gerrit.example.com/*`
  - `https://gerrit.example.com/*`
  - `https://yourcompany.atlassian.net/*`
- Jira Base URL:
  - 기본값 `https://yourcompany.atlassian.net`
  - allowlist(`yourcompany.atlassian.net`) 검증 강제
- 오류 메시지:
  - 상태코드 기반 요약만 표시 (400/401/403/404)
  - 응답 body 원문 미노출

## 아키텍처

- `manifest.json`: MV3 설정, popup 진입점
- `message_types.js`: runtime 메시지 상수
- `service_worker.js`: JiraClient(fetch/auth/error mapping), 3기능 API 처리
- `content_script.js`: Gerrit 컨텍스트 추출 + FAB 렌더링/제거
- `popup.html`, `popup.js`: 통합 UI(조회/웹링크/코멘트/FAB 토글)
- `options.html`, `options.js`: 이메일/토큰/템플릿 저장 + 연결 테스트

## 설치 및 실행

1. 저장소 다운로드
2. `chrome://extensions` 접속
3. 개발자 모드 ON
4. 압축해제된 확장프로그램 로드
5. 이 폴더 선택

## 옵션 설정

1. 확장 옵션 페이지 열기
2. Jira 이메일/토큰 입력 후 저장
3. (선택) 연결 테스트 실행

## 사용 방법

1. Gerrit change 페이지 열기
2. 툴바 아이콘 클릭해서 팝업 열기
3. `이슈 조회 / 새로고침`으로 감지 및 카드 확인
4. 필요 시 `Enable FAB` 토글로 Gerrit 페이지 FAB 표시 여부를 즉시 전환
5. `웹링크 추가` 또는 `코멘트 생성` 실행

## 트러블슈팅

- 400: 이슈 키/요청 형식 확인
- 401: 이메일/토큰 확인
- 403: Jira 권한 확인
- 404: 이슈 키 존재 여부 확인
- Gerrit 페이지 아님: Gerrit change 상세 페이지에서 실행 필요
- issueKey 미탐지: 제목 또는 커밋 메시지에 `PROJ-123` / `jira: PROJ-123` 추가

## 빌드

```bash
npm run build
```

산출물: `gerrit-jira-automation-v<manifest.version>.zip`

## 라이선스

Internal use only.
