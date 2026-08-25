# Gerrit Jira Tools (Chrome Extension, MV3)

Gerrit change 페이지에서 Jira 작업을 빠르게 수행하는 Chrome 확장 프로그램입니다.

- 이슈 조회 / 이슈 상태 변경(transition)
- 웹링크(Remote Link) 추가
- 코멘트 생성 — 등록 전 미리보기·수정 가능, 중복 코멘트 방지
- 반영 처리 원클릭 (웹링크 + 코멘트 + 옵션 시 상태 전환까지)
- Gerrit 페이지에 이슈 상태 배지(pill) 표시 (클릭 시 이슈 이동)
- FAB(빠른 액션 메뉴): 드래그 위치 이동, 이슈키 감지 상태 색 표시, 버튼 구성 설정 가능

## 1. 빠른 시작

### 1) ZIP 준비

```bash
npm run build
```

생성 파일:

- `gerrit-jira-automation-v1.3.0.zip` (manifest 버전에 따라 파일명 변경)

### 2) Chrome에 설치

1. `chrome://extensions` 접속
2. 우측 상단 `개발자 모드` ON
3. ZIP 압축 해제
4. `압축해제된 확장 프로그램을 로드합니다` 클릭
5. 압축 해제한 폴더 선택

## 2. 초기 설정 (필수)

1. 확장 아이콘 클릭
2. 우측 상단 `⚙` 버튼(옵션) 클릭
3. Jira 이메일 + Jira API 토큰 입력
4. `저장` 클릭
5. 필요 시 `연결 테스트` 실행

Jira API 토큰 발급:

- <https://id.atlassian.com/manage-profile/security/api-tokens>

## 3. 사용 방법

### 팝업 액션 (권장)

Gerrit change 페이지(`.../c/.../+/...`)에서 확장 아이콘 클릭.

팝업에서 사용 가능한 액션:

1. `이슈 조회` — 이슈키 입력칸에서 Enter로도 실행
2. `⚡ 반영 처리` — 웹링크 + 코멘트 (+옵션 시 상태 전환) 한 번에
3. `웹링크 추가` / `코멘트 생성`
4. `이슈 페이지 이동` (외부 링크 아이콘)
5. `상태 변경` — 이슈 조회 후 이슈 카드에서 이동 가능한 상태를 선택해 변경
6. `⚙` — 우상단 버튼으로 설정 페이지 이동

`코멘트 생성`/`반영 처리`는 기본적으로 **미리보기 패널**을 먼저 띄워 내용을 확인·수정한 뒤 등록합니다
(설정에서 끌 수 있음). 같은 change의 코멘트가 이미 있으면 경고를 표시합니다(중복 방지).

`Issue key` 입력칸 동작:

- 자동 감지 성공 시 키 자동 입력
- 필요하면 수동으로 `PROJ-123` 형태 입력
- 자동 감지 우선순위:
- 1) 커밋 메시지의 `JIRA: KEY`
- 2) 커밋 메시지의 bare key
- 3) 페이지 내용 fallback
- 4) 제목(subject/title) 마지막 fallback
- Gerrit `detail` JSON(`current_revision -> revisions[..].commit.message`)도 fallback 소스로 사용

### FAB 액션

팝업의 `Enable FAB`를 켜면 Gerrit 페이지 우하단에 FAB가 나타납니다.

FAB 메뉴 액션 (설정 페이지에서 버튼 구성 변경 가능):

1. 이슈 페이지 이동
2. 이슈 조회
3. 웹링크 추가
4. 코멘트 생성
5. ⚡ 반영 처리
6. ⚙️ 설정

FAB 표시 요소:

- **메인 버튼 색**: 이슈키 감지 시 파랑, 미감지 시 회색
- **상태 배지(pill)**: change 페이지에서 `PROJ-1234 · 검토 중` 형태로 이슈 상태 표시, 클릭 시 이슈 열기 (설정에서 끌 수 있음)
- FAB가 Gerrit UI(예: 다음/이전 버튼)를 가리면 **Jira 버튼을 드래그**해서 이동. 위치는 저장되어 유지됩니다

## 3.5 동작 설정 (옵션 페이지)

- 코멘트 미리보기 사용 여부
- Gerrit 페이지 상태 배지 표시 여부
- 반영 처리 시 상태 전환 + 전환할 상태 이름 (예: `검토 중`, transition 이름/결과 상태 이름 모두 매칭)
- FAB 메뉴 버튼 구성 (6개 개별 on/off)

## 4. 댓글 템플릿

옵션 페이지에서 Jira 댓글 템플릿 편집 가능.

지원 플레이스홀더:

- `{title}`
- `{body}`
- `{branch}`
- `{change_num}`
- `{change_id}`
- `{project}`
- `{owner}`
- `{date}`
- `{url}`

`{date}`는 Gerrit submit 시각을 사용하며, 값이 없으면 빈칸으로 둡니다.

기본 템플릿은 `Change-Id`를 맨 아래에 배치합니다.

주의:

- `{body}`에서는 아래 메타 라인을 자동 제거합니다.
- `jira: ...`
- `Change-Id: ...`
- `cherry-picked from ...`

## 5. 보안 정책

- 자격증명 저장: `chrome.storage.local`만 사용 (`sync` 미사용)
- 토큰/이메일/Authorization 헤더 로그 노출 금지
- Jira 응답은 상태코드 기반 메시지 + 오류 요약(`errorMessages`)만 발췌 표시 (본문 전체 미노출)
- 고정 host permissions만 허용:
  - `http://gerrit.example.com/*`
  - `https://gerrit.example.com/*`
  - `https://yourcompany.atlassian.net/*`

## 6. 트러블슈팅

### `이슈키를 찾지 못했습니다`가 뜰 때

1. `Issue key`에 직접 `PROJ-123` 입력
2. Gerrit 탭 새로고침 후 다시 시도
3. 제목/커밋 메시지에 이슈 키가 실제로 있는지 확인

### `Jira 이메일/토큰이 설정되지 않았습니다`가 뜰 때

- 옵션 페이지에서 이메일/토큰 저장 필요
- 미설정 상태에서는 주요 액션 버튼이 비활성화됨

### CSP 오류(Inline Script 차단)

- Gerrit CSP 정책상 인라인 주입은 차단됨
- 현재 버전은 해당 경로를 사용하지 않도록 처리되어 있음

## 7. 릴리즈/배포

### GitHub Actions 자동 릴리즈 (태그 기반)

- 트리거: `v*.*.*` 태그 푸시

```bash
git push origin v1.1.0
```

### GitHub Actions 수동 실행 (Run workflow)

- `Actions > Release > Run workflow`
- 입력값 `tag`: 예) `v1.1.0`

워크플로우가 수행하는 작업:

1. manifest 버전 동기화
2. ZIP 빌드
3. GitHub Release 생성 + Release Notes + Assets 업로드

## 8. 개발 메모

- 네트워크 호출(Jira API)은 `service_worker.js`에서만 수행
- `content_script.js`는 DOM 컨텍스트 추출과 FAB UI 처리 담당
- 팝업은 `popup.html` + `popup.js`

## License

Internal use only.
