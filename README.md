# Gerrit Jira Tools (Chrome Extension, MV3)

Gerrit change 페이지에서 Jira 작업을 빠르게 수행하는 Chrome 확장 프로그램입니다.

- 이슈 조회
- 웹링크(Remote Link) 추가
- 코멘트 생성(ADF)
- Jira 이슈 페이지 바로 열기
- FAB(빠른 액션 메뉴) On/Off

## 1. 빠른 시작

### 1) ZIP 준비

```bash
npm run build
```

생성 파일:

- `gerrit-jira-automation-v1.1.0.zip` (manifest 버전에 따라 파일명 변경)

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

팝업에서 사용 가능한 액션 4개:

1. `이슈 조회 / 새로고침`
2. `웹링크 추가`
3. `코멘트 생성`
4. `이슈 페이지 이동` (외부 링크 아이콘)

`Issue key` 입력칸 동작:

- 자동 감지 성공 시 키 자동 입력
- 필요하면 수동으로 `PROJ-123` 형태 입력

### FAB 액션

팝업의 `Enable FAB`를 켜면 Gerrit 페이지 우하단에 FAB가 나타납니다.

FAB에서 같은 4개 액션 제공:

1. 이슈 페이지 이동
2. 이슈 조회
3. 웹링크 추가
4. 코멘트 생성

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

기본 템플릿은 `Change-Id`를 맨 아래에 배치합니다.

주의:

- `{body}`에서는 아래 메타 라인을 자동 제거합니다.
- `jira: ...`
- `Change-Id: ...`
- `cherry-picked from ...`

## 5. 보안 정책

- 자격증명 저장: `chrome.storage.local`만 사용 (`sync` 미사용)
- 토큰/이메일/Authorization 헤더 로그 노출 금지
- Jira 응답 본문(raw body) 미표시, 상태코드 기반 메시지 사용
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
