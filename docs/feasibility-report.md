# vibrato 가능성 조사 보고서

작성일: 2026-10-19
조사 환경: macOS 26.6.2 (arm64), Node v24.13.0, git 2.54.0, Claude Code 2.1.300, Codex CLI 0.162.1

## 1. 결론

**가능하다.** 핵심 요소를 전부 이 Mac에서 직접 검증했다.

| 항목 | 상태 | 검증 내용 |
|------|------|-----------|
| Claude 프로그래밍 연동 | OK | `claude --print --output-format stream-json --input-format stream-json` 플래그 존재. Agent SDK 0.3.303 설치 확인. 현재 claude.ai 구독 로그인 상태 |
| Codex 프로그래밍 연동 | OK | `codex app-server --listen stdio://` 로 JSON-RPC `initialize` 핸드셰이크 성공, `thread/list` 로 과거 세션 조회됨. ChatGPT(plus) 로그인 상태 |
| 터미널 임베딩 | OK | node-pty 1.1.0 (Node 24 arm64 prebuild) 로 zsh 스폰 성공. 단 `spawn-helper` 실행 권한 chmod 필요했음 |
| 모든 폴더 접근 | 조건부 OK | Node 는 실행한 사용자 권한으로 접근. TCC 보호 폴더는 권한 부여 필요 (4절) |
| 자동 업데이트 | OK | git + launchd 조합으로 구현 가능 (6절) |

## 2. 연동 방식 비교

### A. PTY 래핑 (node-pty + xterm.js)

터미널 그 자체를 브라우저에 띄운다. 모든 슬래시 커맨드, `/login`, TUI 전부 그대로 동작.
단점: 출력이 터미널 텍스트라 "원하는 UI" 로 재구성 불가.

### B. 구조화 프로토콜

| | Claude | Codex |
|---|---|---|
| 수단 | `@anthropic-ai/claude-agent-sdk` (`query()`) | `codex app-server` JSON-RPC (stdio) |
| 스트리밍 | `includePartialMessages: true` 로 `stream_event` (text_delta) | `item/agentMessage/delta`, `command/exec/outputDelta` |
| 멀티턴 입력 | `prompt` 에 AsyncIterable 전달 (streaming input), `streamInput()` | `turn/start`, `turn/steer` |
| 승인 | `canUseTool` 콜백 → allow/deny/updatedInput/updatedPermissions | 서버→클라이언트 요청 `item/commandExecution/requestApproval`, `item/fileChange/requestApproval` → accept/decline/cancel |
| 질문 | `AskUserQuestion` 도 `canUseTool` 로 들어옴 (questions/answers 구조) | (app-server 에 별도 elicitation 흐름 있음) |
| 중단 | `query.interrupt()` | `turn/interrupt` |
| 세션 재개 | `resume: sessionId` (`~/.claude/projects` 의 jsonl) | `thread/resume`, `thread/list` |
| 권한 모드 전환 | `setPermissionMode()` (streaming input 모드에서만) | `approvalPolicy` / `sandboxMode` |
| 이벤트 타입 | assistant, user, result, system, stream_event, tool_progress, status, rate_limit_event, compact_boundary, hook_*, task_*, auth_status, elicitation_complete | thread.started, turn.started/completed/failed, item.started/updated/completed. item: agent_message, reasoning, command_execution, file_change, mcp_tool_call, web_search, todo_list, error |

`@openai/codex-sdk` (0.163.0) 도 있지만 **승인 콜백이 없다** (`approvalPolicy: "never" | "on-request" | "on-failure" | "untrusted"` 만 설정). 대화형 승인 UI 가 목표면 app-server 직접 사용이 맞다. SDK 내부도 결국 CLI 스폰 + JSONL 이다.

### 추천: B 를 메인으로, A 를 보조 탭으로

- 채팅 UI, 승인 카드, 질문 카드, 도구 실행 로그 = B
- `/login`, 기타 터미널 전용 커맨드, 일반 셸 작업 = A (xterm.js 탭)
- `claude -p` 는 스킬/커스텀 커맨드(`/skill-name`) 는 프롬프트에 넣으면 동작. `/login` 같은 터미널 전용은 불가 → PTY 탭에서 처리

## 3. 인증 / 정책 리스크 (중요)

**Claude.** Agent SDK 공식 문서 문구:
> Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods instead.

- 본인 전용 로컬 도구가 본인 CLI(구독 로그인)를 띄우는 건 claudecodeui 등 오픈소스가 흔히 하는 방식이지만, 공식적으로 승인된 경로는 **API 키** 다. 배포(타인 사용)까지 가면 위반 소지. 개인 사용은 회색지대.
- `--bare` 모드는 OAuth 를 아예 읽지 않으므로 API 키 필수.
- SDK 는 258MB 네이티브 바이너리를 optional dependency 로 번들한다 (`@anthropic-ai/claude-agent-sdk-darwin-arm64`). 로컬 `claude` 를 쓰려면 `pathToClaudeCodeExecutable` 지정. SDK 버전 = 번들 CLI 버전이므로 로컬 CLI 쓸 땐 프로토콜 불일치 주의.

**Codex.** app-server 는 현재 로그인(ChatGPT) 그대로 사용 (검증: `account/updated` 알림에 `authMode: "chatgpt", planType: "plus"`). codex-sdk 는 `CODEX_API_KEY` 주입 언급 있음. app-server 는 "experimental" 표기 → 프로토콜 변동 가능. `codex app-server generate-ts --out ./types` 로 설치된 버전 기준 타입 생성해 고정 권장. WebSocket 전송(`--listen ws://`)도 실험적, stdio 권장.

## 4. macOS 폴더 접근 (TCC)

- Node 프로세스는 사용자 권한으로 `/` 전체 탐색 가능.
- 단 Desktop, Documents, Downloads, 외장 볼륨 등 TCC 보호 폴더는 **프로세스별 권한** 이 필요하다. 거부되면 프롬프트 없이 `EACCES` 로 조용히 실패.
- 터미널에서 `npm start` 로 띄우면 터미널 앱의 권한을 상속 → 보통 문제없음.
- launchd 로 띄우면 상속 없음 → **시스템 설정 > 개인정보 보호 및 보안 > 전체 디스크 접근 권한** 에 실제 실행되는 `node` 바이너리(예: `~/.nvm/versions/node/v24.13.0/bin/node`) 를 추가해야 한다. nvm 으로 Node 버전 바꾸면 경로가 바뀌어 재등록 필요 → 런처 스크립트에서 node 경로 고정 권장.
- 앱에서 EACCES 감지 시 "전체 디스크 접근 권한 필요" 안내 + 설정 딥링크 `x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles` 띄우면 UX 좋다.

## 5. 아키텍처 제안

```
vibrato/
├─ server/                 # Node + TypeScript, 127.0.0.1:11398 바인드
│  ├─ index.ts             # HTTP(정적 SPA + REST) + WebSocket
│  ├─ fs/                  # 폴더 트리, 파일 읽기, Range 스트리밍(영상), chokidar watch
│  ├─ favorites.ts         # ~/.vibrato/config.json
│  ├─ agents/
│  │  ├─ types.ts          # 통합 이벤트 스키마 (아래)
│  │  ├─ claude.ts         # Agent SDK 어댑터
│  │  └─ codex.ts          # app-server JSON-RPC 어댑터
│  ├─ pty.ts               # node-pty 세션 관리
│  └─ updater.ts           # git fetch/pull + 재시작
├─ web/                    # Vite SPA (Vue 3 + Tailwind 추천, 기존 프로젝트 스택과 맞춤)
├─ bin/start.sh            # node 경로 고정 런처 (launchd 가 호출)
├─ launchd/com.hdomi.vibrato.plist
└─ docs/
```

**통합 이벤트 스키마** (두 에이전트를 같은 UI 로 그리기 위한 정규화):

```ts
type AgentEvent =
  | { kind: 'session_started'; agent: 'claude'|'codex'; sessionId: string }
  | { kind: 'text_delta'; text: string }
  | { kind: 'reasoning_delta'; text: string }
  | { kind: 'tool_started'; id: string; name: string; input: unknown }
  | { kind: 'tool_output'; id: string; chunk: string }
  | { kind: 'tool_completed'; id: string; ok: boolean }
  | { kind: 'approval_request'; id: string; summary: string; detail: unknown; options: string[] }
  | { kind: 'question'; id: string; questions: Question[] }
  | { kind: 'turn_completed'; usage?: unknown; cost?: number }
  | { kind: 'error'; message: string };
```

클라이언트 → 서버: `send_message`, `approve {id, decision}`, `answer {id, answers}`, `interrupt`, `set_mode`.

**프리뷰.** md: markdown-it + shiki + mermaid. 이미지: 정적 서빙. 영상: HTTP Range 요청 지원 필수 (없으면 탐색 불가). PDF: iframe. 코드: CodeMirror 6 읽기전용(필요 시 편집). chokidar 로 파일 변경 시 자동 새로고침 (에이전트가 파일 고치면 즉시 반영).

**상태 저장.** 즐겨찾기·최근 폴더·설정은 `~/.vibrato/config.json`. 세션 목록은 `~/.claude/projects` 와 Codex `thread/list` 를 그대로 읽어 재사용 → 별도 DB 불필요.

**보안.** 모든 폴더에 접근하는 서버이므로 `127.0.0.1` 만 바인드, `Origin` 검사, WebSocket 에 로컬 토큰. 외부 노출(Tailscale 등)은 나중에 별도 인증 붙인 뒤.

## 6. 자동 업데이트

1. 서버 시작 시 + 10분 주기로 `git fetch origin main` 후 `git rev-list HEAD..origin/main --count`.
2. 0 보다 크면 UI 상단에 "업데이트 있음" 배지 + 커밋 로그.
3. 사용자 클릭(또는 설정에서 자동) → 진행 중 에이전트 턴이 없을 때만 → `git pull --ff-only && npm ci && npm run build` → `process.exit(0)`.
4. launchd `KeepAlive: true` 가 프로세스를 다시 띄운다. 로그인 시 자동 실행(`RunAtLoad`) 도 같이 해결.
5. 로컬 변경으로 ff 불가하면 UI 에 그대로 표시, 자동 stash 는 하지 않는다.

태그(`v*`) 기준 업데이트가 더 안정적이지만 v1 은 `main` 추적으로 시작하면 충분. `gh` 는 미설치 상태 (필요 없음, git 만으로 됨).

## 7. 단계별 로드맵

| 단계 | 내용 |
|------|------|
| M0 뼈대 | 서버 + SPA + 11398, 폴더 트리, 즐겨찾기, md/이미지/영상/PDF 프리뷰 |
| M1 Claude | Agent SDK 어댑터, 스트리밍 채팅, 승인 카드, AskUserQuestion 카드, 세션 resume, 권한 모드 토글 |
| M2 Codex | app-server 어댑터, 통합 이벤트 스키마로 같은 UI 에 렌더 |
| M3 운영 | xterm.js PTY 탭, 자동 업데이트, launchd, TCC 안내 |
| M4 확장 | 멀티 세션 탭/분할, git 패널(status/diff/commit), 완료 알림(`osascript` 또는 Web Notification), Gemini CLI 등 추가 어댑터 |

## 8. 알려진 함정

- node-pty 1.1.0: 설치 직후 `prebuilds/darwin-arm64/spawn-helper` 가 실행 권한 없어 `posix_spawnp failed`. `postinstall` 에 `chmod +x` 추가.
- Agent SDK `canUseTool` 은 allow 규칙/permissionMode 로 이미 허용된 호출엔 안 불린다. 모든 호출을 UI 에 찍으려면 `PreToolUse` 훅 병행.
- `claude -p` 로 `--bare` 안 쓰면 프로젝트의 hooks/`.mcp.json` 이 신뢰 확인 없이 실행됨. 폴더 신뢰 UI 를 앱에 두거나 `--bare` + 필요한 것만 명시.
- SIGTERM 으로 죽이면 진행 중 턴 유실. 종료 전 `interrupt()` 먼저.
- Codex app-server 스레드는 30분 유휴 시 `thread/closed` → 재개는 `thread/resume`.
- 참고 프로젝트 claudecodeui(siteboon, 14.2k stars) 는 AGPL-3.0. 구조 참고는 OK, 코드 복사는 AGPL 전염.

## 9. 참고 자료

- Agent SDK TypeScript: https://code.claude.com/docs/en/agent-sdk/typescript
- Agent SDK overview (인증 정책 문구): https://code.claude.com/docs/en/agent-sdk/overview
- 승인/질문 처리: https://code.claude.com/docs/en/agent-sdk/user-input
- 권한: https://code.claude.com/docs/en/agent-sdk/permissions
- headless(-p) 모드: https://code.claude.com/docs/en/headless
- Codex SDK: https://learn.chatgpt.com/docs/codex-sdk
- Codex app-server 해설: https://codex.danielvaughan.com/2026/04/15/codex-app-server-complete-guide/
- Codex SDK TS README: https://github.com/openai/codex/tree/main/sdk/typescript
- claudecodeui: https://github.com/siteboon/claudecodeui
- node-pty: https://github.com/tyriar/node-pty
- TCC / Full Disk Access (launchd): https://developer.apple.com/forums/thread/661178
