# mac-vibe-coder

맥환경에서의 로컬 바이브코딩을 도와주기위한 프로젝트.
Claude Code · Codex CLI 를 한 화면에서 쓰는 개인용 앱. 구독 로그인된 로컬 CLI 만 사용하고 API 키는 쓰지 않는다.

## 기능

- 프로젝트 폴더 열기(네이티브 다이얼로그), 즐겨찾기, 최근 폴더
- Claude Code / Codex 채팅: 토큰 스트리밍, 도구 실행 카드, 승인 카드(허용 / 항상 허용 / 거부+사유), 질문 카드, 권한 모드 전환, 중단, 이전 세션 이어하기, 프로젝트별 멀티 세션 탭
- 첨부: Finder 드롭 · 앱 내 파일 트리 드롭 · 클립보드 붙여넣기 (이미지 썸네일 칩)
- 파일 미리보기: Markdown, 이미지, 영상(탐색 가능), 오디오, PDF, 텍스트/코드
- 내장 터미널(xterm.js + node-pty, 로그인 셸), `claude` / `codex` TUI 원클릭, Terminal.app / Finder 로 열기
- Git 패널: 상태, diff, 스테이지/해제/버리기, 커밋, 최근 로그
- 상단 사용량 바: Claude 5시간·주간·모델별, Codex 5시간·주간 (남은 %)
- CLI 감지 + 설치/업데이트 버튼 (공식 스크립트 / Homebrew / npm)
- 자동 업데이트: GitHub `main` 이 앞서면 배지 표시 → pull · install · build · 재시작
- 창이 안 보일 때 완료/승인/질문 알림

## 구조

- `server/` — Node + Hono. `127.0.0.1:11398` 에 바인드. 파일 시스템, 즐겨찾기, 에이전트 세션(WebSocket `/ws`), PTY(`/pty`), git, 사용량, 업데이트 API, 빌드된 SPA 서빙
  - `server/agents/claude.ts` — Agent SDK 어댑터 (로컬 `claude` 바이너리 사용)
  - `server/agents/codex.ts` — `codex app-server` JSON-RPC(stdio) 어댑터
  - `server/agents/types.ts` — 두 에이전트를 같은 UI 로 그리는 통합 이벤트 스키마
- `web/` — React + Vite + Tailwind SPA
- `electron/` — 앱 껍데기. 메인 프로세스가 시스템 Node 로 서버를 자식 프로세스로 띄우고 창을 연다
- `bin/start.sh`, `scripts/launchd.sh` — 로그인 시 자동 실행용
- `docs/` — 조사 보고서, 로드맵

## 실행

```bash
npm install

# 앱으로 실행 (빌드 포함)
npm start

# 이미 빌드돼 있으면
npm run app

# 브라우저 개발 모드: vite(5173) + 서버(11398) 핫리로드
npm run dev          # http://localhost:5173

# 앱 개발 모드: 위 dev 를 띄워둔 채로
npm run dev:app

# 서버만 (브라우저로 http://127.0.0.1:11398)
npm run serve
```

VS Code 통합 터미널에서는 `ELECTRON_RUN_AS_NODE=1` 이 걸려 있어 Electron 이 일반 Node 로 실행된다. npm 스크립트가 이 변수를 제거하므로 스크립트로 실행한다.

## 로그인 시 자동 실행

```bash
scripts/launchd.sh install     # ~/Library/LaunchAgents/com.hdomi.mac-vibe-coder.plist
scripts/launchd.sh uninstall
```

launchd 로 띄우면 macOS 가 Desktop/Documents 접근 권한을 물을 수 있다. 팝업이 안 뜨고 파일 목록이 `EACCES` 면 시스템 설정 > 개인정보 보호 및 보안 > 전체 디스크 접근 권한에 `node_modules/electron/dist/Electron.app` 을 추가한다. 앱 안의 오류 카드에 설정 바로가기가 있다.

## 설정 파일

- `~/.mac-vibe-coder/config.json` — 즐겨찾기, 최근 폴더
- `~/.mac-vibe-coder/attachments/` — 브라우저 모드/붙여넣기 첨부 사본

## 앱 아이콘

남색 macOS 스타일 타일에 코드 괄호와 민트색 파형을 결합했다. 코드와 바이브를 표현하며 Dock, 사이드바, 브라우저 탭에 같은 디자인을 쓴다.

- 원본: `web/public/icon.svg`
- Dock용 이미지: `web/public/icon.png`, macOS 패키징용: `assets/icon.icns`
- 원본 수정 후 `npm run icons`로 PNG를 다시 생성한다. macOS에서는 ICNS도 함께 생성한다. 생성 파일은 저장소에 포함하며 일반 빌드에는 재생성이 필요 없다.
- Dock 아이콘 변경은 앱 재실행 후 반영된다. 현재는 Electron으로 직접 실행하므로 Finder의 Electron.app 아이콘은 바뀌지 않는다.

## 문서

- [가능성 조사 보고서](docs/feasibility-report.md)
- [로드맵 · 동작 규칙](docs/roadmap.md)
