# 로드맵

| 단계 | 내용 | 상태 |
|------|------|------|
| M0 뼈대 | Electron + Node 서버(11398) + React. 폴더 트리, 즐겨찾기, 프리뷰(md/이미지/영상/PDF/텍스트), CLI 감지·설치 버튼 | 완료 (2026-10-19) |
| M1 Claude | Agent SDK 어댑터(로컬 claude 바이너리), 스트리밍 채팅, 승인/질문 카드, 세션 resume, 권한 모드 토글, 드래그앤드롭 첨부, 사용량 헤더 | 완료 |
| M2 Codex | app-server JSON-RPC 어댑터, 통합 이벤트 스키마, Codex 스레드 목록/재개 | 완료 |
| M3 운영 | xterm.js PTY 탭, Terminal.app/Finder 열기, git pull 자동 업데이트 + 재시작, launchd 스크립트 | 완료 (launchd 설치는 미실행) |
| M4 확장 | 프로젝트별 멀티 세션 탭, git 패널(status/diff/stage/commit/log), 백그라운드 알림 | 완료 |
| M5 UX | 우클릭 컨텍스트 메뉴, 파일 브라우저 단축키/복사·붙여넣기/휴지통, 즐겨찾기 그룹, 패널 접기·드래그 분할, 모델 선택, 세션 이름 변경·삭제, 슬래시 커맨드 자동완성, 퀵오픈(⌘P), 코드 하이라이트·복사, 전역 단축키, 로그인 시 실행 토글 | 완료 |
| 다음 | mermaid, Gemini CLI 어댑터, 외부 접근(Tailscale + 인증), 세션 검색 | 미착수 |

## 첨부 파일 동작 규칙

- Finder에서 드롭: Electron `webUtils.getPathForFile` 로 절대 경로 획득 → 첨부 칩(이미지는 썸네일). 복사 없음.
- 앱 내 파일 트리에서 드롭: 경로 그대로 첨부.
- 브라우저(localhost) 모드 / 클립보드 붙여넣기: 경로를 읽을 수 없으므로 `/api/attach` 로 업로드 → `~/.mac-vibe-coder/attachments/` 에 저장 후 그 경로 사용.
- Claude: 이미지는 base64 image 블록 + 경로 텍스트, 그 외 파일은 경로 텍스트. Codex: `localImage` / `mention` 입력 항목.

## 인증 원칙

- AI API 키는 사용하지 않는다. 설치된 `claude`(claude.ai 구독 로그인) 와 `codex`(ChatGPT 로그인) 바이너리만 쓴다.
- Claude: Agent SDK 를 쓰되 `pathToClaudeCodeExecutable` 로 로컬 `claude` 를 지정한다. `--bare` 는 OAuth 를 읽지 않으므로 쓰지 않는다. SDK 가 번들하는 바이너리(269MB)는 설치만 될 뿐 사용하지 않는다.
- Codex: `codex app-server` 가 현재 로그인 상태를 그대로 사용한다.
- 로그인/로그아웃은 앱 내 터미널 탭에서 `claude` → `/login`, `codex login` 으로 처리한다.

## 권한 모드 매핑

| UI | Claude (permissionMode) | Codex (approvalPolicy / sandbox) |
|----|------|------|
| 기본 | default | on-request / workspace-write |
| 편집 자동 | acceptEdits | on-request / workspace-write (동일) |
| 계획 | plan | on-request / read-only |
| 전부 허용 | bypassPermissions | never / danger-full-access |

## 업데이트 흐름

1. 서버가 시작 시 + 10분마다 `git fetch origin` 후 `HEAD...origin/<branch>` 카운트.
2. 뒤처진 커밋이 있으면 헤더 우측 배지 "업데이트 N".
3. 적용 → `git pull --ff-only && npm ci && npm run build` 를 SSE 로 스트리밍. 활성 세션이 있으면 보류(강제 옵션 있음).
4. 성공 시 서버가 종료 코드 75 로 나감. Electron 은 75 를 보면 `app.relaunch()`. launchd 는 KeepAlive 로 재시작. 브라우저 모드는 수동 재시작.
5. 로컬 변경이 있어 ff 불가하면 로그에 그대로 표시. 자동 stash 없음.

## 세션 수명주기 보장 (v0.3.7 전수조사 결과)

- 세션 닫기(탭 ✕, ⌘W, 서버 종료)는 항상 CLI 자식 프로세스를 끝낸다. Claude 는 AbortController, Codex 는 app-server kill.
- 서버 종료(SIGTERM/SIGINT, 업데이트 재시작)는 모든 세션과 PTY 셸을 닫고 나간다 (4초 상한).
- 아무 브라우저도 보고 있지 않고 6시간 동안 이벤트가 없는 세션은 10분 주기 리퍼가 닫는다.
- Codex app-server 요청은 120초(목록/모델 조회는 30초) 안에 응답이 없거나 프로세스가 죽으면 즉시 거부된다. 호출자가 영원히 기다리지 않는다.
- Codex 스레드 시작/재개 실패 시 반쯤 뜬 app-server 를 바로 죽인다. 30분 유휴로 app-server 가 스레드를 내리면 세션을 닫지 않고 다음 전송 때 `thread/resume` 한다.
- 전송 요청 자체가 실패하면 상태를 idle 로 되돌려 가짜 "작업 중" 이 남지 않는다.
- 업데이트 적용은 한 번에 하나만 실행된다.
- Electron 은 서버 자식이 죽으면 1.5초→30초 지수 백오프로 재시작한다. 다른 인스턴스가 포트를 쓰고 있으면 재시작 대신 그 서버에 붙는다.
- 부모가 강제 종료(SIGKILL)돼도 Claude CLI 는 stdin 종료로, Codex app-server(stdio) 는 연결 종료로, PTY 셸은 SIGHUP 으로 스스로 끝난다.

## 브라우저 탭과 CDP (v0.3.40, v0.3.41 에서 포트 분리)

- 앱 전용 Chrome 을 CDP 포트 9323(`MVC_BROWSER_CDP_PORT`), 프로필 `~/.mac-vibe-coder/chrome-profile`(`MVC_BROWSER_PROFILE`)로 띄운다. `debugweb`(9222, `/tmp/chrome-lumi-debug`)과 포트도 프로필도 겹치지 않는다. Chrome 두 개가 한 프로필을 동시에 열 수 없어서 로그인은 따로 한 번 해야 한다.
- v0.3.40 은 9222 를 공유했다. 앱 Chrome 과 `debugweb` 이 프로필 잠금으로 부딪히고, 앱이 사용자의 `debugweb` 창 탭을 앞으로 끌어오는 문제가 있어서 나눴다.
- 포트에 Chrome 이 없으면 서버가 headless 로 띄운다(detached). 업데이트 재시작에서는 살려 두고, 앱 종료(SIGTERM)에서만 닫는다.
- 화면은 `Page.startScreencast` 프레임을 `/browser` WebSocket 으로 받아 그린다. 패널이 보일 때만 screencast 하고, 프레임마다 ack 해서 밀리지 않게 한다. headless 페이지는 `Emulation.setDeviceMetricsOverride` 로 패널 크기에 맞춘다.
- 입력은 `Input.dispatchMouseEvent` · `Input.dispatchKeyEvent` 로 보낸다. 한글 IME 는 숨은 textarea 에서 조합하고 조합이 끝나면 `Input.insertText` 로 넣는다. ⌘C 는 페이지 선택 텍스트를 읽어 클립보드에 쓰고, ⌘V 는 `insertText` 로 붙인다.
- 캡처는 `Page.captureScreenshot` PNG 를 첨부 폴더에 저장하고 채팅 입력창 첨부로 넘긴다.
- 앱 안 에이전트 세션만 패널 페이지를 안다. Claude 는 system prompt append 와 `MVC_BROWSER_INFO_URL` 환경 변수, Codex 는 `developerInstructions` 로 `GET /api/browser/target` 을 안내받고, 9222 · `debugweb` 을 쓰지 말라는 지시도 받는다. 앱 밖 터미널 세션에는 이 안내가 없어서 지금처럼 `debugweb` 을 쓴다.
- 제약: system prompt 는 세션 시작 때 기록되므로 안내는 새 세션부터 적용된다. Codex 기본 샌드박스(workspace-write)는 localhost 접속을 막아서, Codex 실측은 "모두 허용" 모드에서만 된다.
