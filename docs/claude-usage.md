# Claude 사용량 조회 경로 (v0.3.18)

## 확인한 원인

2026-10-19, 기존 OAuth 토큰 직접 조회는 `HTTP 429`를 반환했다. 같은 환경에서 Claude Code `2.1.300`과 설치된 Agent SDK `0.3.303`의 구조화된 사용량 제어 요청은 정상 응답했다. SDK와 새 앱의 `/api/usage` 경로에서 5시간·주간·모델별 사용률과 리셋 시각을 실제로 확인했다.

API 주소 변경이나 SDK 버전 불일치로 단정할 근거는 없었다. 앱이 SDK에 이미 제공된 조회 방식을 사용하지 않고 별도의 HTTP 호출에 의존하던 것이 문제였다. v0.3.17의 오류 표시 수정만으로는 데이터 조회를 복구하지 못했다.

## 변경

- Keychain에서 Claude 토큰을 직접 꺼내 `/api/oauth/usage`를 호출하던 경로를 제거했다.
- 설치된 Claude CLI를 SDK로 실행하고 `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })` 제어 요청으로 조회한다.
- 사용자 프롬프트나 모델 턴을 보내지 않으며, 조회용 프로세스는 도구·훅·대화 저장을 비활성화한다. 성공·실패·시간 초과 모두 abort와 close로 정리한다.
- 최신 `rate_limits.limits[]`의 `kind`로 세션·전체 주간·모델별 주간을 구분한다. 기존 `five_hour`, `seven_day`, `model_scoped`도 지원한다.
- 0은 유효한 사용률로 처리하고, null·누락·잘못된 숫자는 0으로 바꾸지 않는다. SDK 미지원·조회 실패는 명시적인 오류로 처리한다.
- 기존 5분 캐시와 동시 요청 병합은 유지한다.

## 검증

- 설치된 CLI/SDK를 사용하는 실제 메타데이터 조회와 앱의 `/api/usage` 응답을 확인했다. AI 대화 턴은 실행하지 않았다.
- 신·구 응답, 모델별 사용량, 0·null 구분, 조회 프로세스의 성공·실패·시간 초과·미지원 정리를 회귀 테스트한다.
- SDK 메서드는 공식적으로 실험적이다. 이름과 응답 형식이 바뀔 수 있어 기능 검사와 응답 검증을 거친다. 사용량은 계산·추정하지 않는다.

## 공식 근거

- [Agent SDK v0.3.169 릴리즈](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.169): 구조화된 사용량 조회 메서드 추가.
- [SDK 변경 기록](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md): 사용량 응답 및 모델별 한도 필드 변경.
- [Claude Code 상태 표시줄 문서](https://code.claude.com/docs/en/statusline#available-data): 사용률과 리셋 시각을 포함한 공식 로컬 데이터 경로. 이 앱은 상태 표시줄 설정을 변경하지 않고 SDK 제어 요청을 사용한다.
