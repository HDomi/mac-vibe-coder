# 로드맵

| 단계 | 내용 | 상태 |
|------|------|------|
| M0 뼈대 | Electron + Node 서버(11398) + React. 폴더 트리, 즐겨찾기, 프리뷰(md/이미지/영상/PDF/텍스트), CLI 감지·설치 버튼 | 완료 (2026-10-19) |
| M1 Claude | Agent SDK 어댑터(로컬 claude 바이너리), 스트리밍 채팅, 승인/질문 카드, 세션 resume, 권한 모드 토글, 드래그앤드롭 첨부, 사용량 헤더 | 완료 |
| M2 Codex | app-server JSON-RPC 어댑터, 통합 이벤트 스키마, Codex 스레드 목록/재개 | 완료 |
| M3 운영 | xterm.js PTY 탭, Terminal.app/Finder 열기, git pull 자동 업데이트 + 재시작, launchd 스크립트 | 완료 (launchd 설치는 미실행) |
| M4 확장 | 프로젝트별 멀티 세션 탭, git 패널(status/diff/stage/commit/log), 백그라운드 알림 | 완료 |
| 다음 | 코드 하이라이트(shiki), mermaid, 세션 이름 변경, Gemini CLI 어댑터, 외부 접근(Tailscale + 인증) | 미착수 |

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
