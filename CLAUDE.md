# CLAUDE.md

Claude Code(및 다른 AI 에이전트)가 이 저장소에서 작업할 때 **반드시** 지키는 규칙입니다.
사람이 읽어도 됩니다 — 팀 규칙이 전부 여기에 요약돼 있습니다.

> 이 프로젝트는 **고등학교 2학년 학생들의 첫 팀 프로젝트**입니다.
> 따라서 "동작하는 코드"보다 **"학생이 읽고 이해할 수 있는 코드"** 가 우선입니다.
> 그리고 **학생이 실수로 사고를 치지 않게 막는 것**이 속도보다 우선입니다.

---

## 0. 대원칙 5가지

1. **한국어로 대화한다.** 코드·변수명·커밋 타입은 영어, 설명·주석·커밋 본문은 한국어.
2. **학생이 이해 못 할 코드는 쓰지 않는다.** 화려한 추상화보다 길고 명확한 코드가 낫다.
3. **요청받은 것만 한다.** 시키지 않은 리팩터링·파일 삭제·라이브러리 추가 금지.
4. **되돌리기 어려운 일은 먼저 물어본다.** (force push, 브랜치 삭제, PR merge, 파일 대량 삭제)
5. **거짓말하지 않는다.** 검증 안 한 건 "확인 안 했다"고 말한다. 빌드가 깨졌으면 깨졌다고 말한다.

---

## 1. 기술 스택 (임의로 바꾸지 말 것)

| 구분          | 사용 기술                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------- |
| 프레임워크    | React 19 + TypeScript                                                                               |
| 빌드 도구     | Vite 8                                                                                              |
| 스타일        | Tailwind CSS v4 (+ `cn()` 유틸)                                                                     |
| 라우팅        | React Router v7                                                                                     |
| 서버 데이터   | TanStack Query v5 (`queryOptions` + `useSuspenseQuery`) + Suspense(스켈레톤) + react-error-boundary |
| 린트/포맷     | oxlint + Prettier                                                                                   |
| 패키지 매니저 | **pnpm** — `npm`/`yarn` 사용 금지                                                                   |

**새 라이브러리 설치는 반드시 허락을 받고 하세요.** "이거 쓰면 편한데 설치할까요?" 라고 먼저 묻습니다.
특히 상태관리(zustand/redux), UI킷(MUI 등)은 팀이 합의해야 합니다.
(데이터패칭은 2026-10-10 에 TanStack Query 로 정했습니다. 다른 데이터패칭 라이브러리를 더하지 않습니다.)
**라이브러리를 늘리는 것보다, 지금 있는 것으로 만드는 법을 알려주는 게 이 프로젝트의 목적입니다.**

---

## 2. 폴더 구조와 "어디에 만들까"

```
src/
├── pages/         주소(URL)가 있는 화면. 파일 하나 = 화면 하나
├── components/
│   ├── ui/        버튼·인풋처럼 어디서나 쓰는 조각
│   └── layout/    헤더·푸터 등 모든 페이지 공통 틀
├── hooks/         use로 시작하는 재사용 로직 (React 상태 사용)
├── lib/           React 없이 돌아가는 순수 함수 (cn, api)
├── types/         두 파일 이상에서 쓰는 타입
└── router.tsx     주소 ↔ 페이지 연결표
```

판단 기준:

- **두 군데 이상에서 쓰이면** → `components/ui/` 로 뺀다.
- **한 페이지에서만 쓰이면** → 그 페이지 파일 안에 둔다. **미리 빼지 않는다.**
- **JSX가 없으면** → `lib/` (React 무관) 또는 `hooks/` (React 상태 사용).

자세한 내용과 판단표: **[docs/FOLDER-STRUCTURE.md](./docs/FOLDER-STRUCTURE.md)**

---

## 3. 코드 작성 규칙

### 반드시

- `className` 을 합칠 때는 **항상 `cn()`** (`@/lib/cn`). 문자열 템플릿으로 붙이면 Tailwind 충돌이 안 잡힙니다.
- `cn()` 에서 **`className` props 는 맨 마지막**. 그래야 쓰는 쪽에서 덮어쓸 수 있습니다.
- import 는 **`@/` 별칭**. `../../` 금지.
- **탭·날짜·단계처럼 "지금 무엇을 보고 있는지" 는 주소에 둔다.** `useState` 대신 `useQueryParam`(`@/hooks/useQueryParam`)을 쓰면 새로고침해도 유지되고 뒤로 가기가 자연스럽습니다. 주소에서 받은 값은 쓰기 전에 꼭 확인하고, 비밀번호·이름 같은 개인 내용은 주소에 담지 않습니다.
- 컴포넌트·페이지는 **PascalCase + named export**. 훅·유틸은 **camelCase**.
- props 타입은 `interface XxxProps` 로 명시.
- 이벤트 핸들러는 `handleXxx`, props 로 받는 함수는 `onXxx`.
- 조금이라도 헷갈릴 코드에는 **한국어 주석 한 줄**.
- **카드 · 목표 · 고정 일정은 `saveCards` · `saveGoals` · `saveFixedBlocks`(또는 `useCards` 등 훅)로만 저장.** `saveData` 로 바로 쓰면 서버로 가지 않습니다. → [docs/SERVER-SYNC.md](./docs/SERVER-SYNC.md)
- **서버에서 받아오는 데이터는 TanStack Query 로.** 쿼리 설정은 `lib/` 에 `queryOptions` 로 두고, 화면에서는 `useSuspenseQuery` 로 받아온 뒤 바깥을 `AsyncBoundary`(스켈레톤 + 실패 안내)로 감쌉니다. `useEffect` 안에서 `fetch` 하지 않습니다. → [docs/DATA-FETCHING.md](./docs/DATA-FETCHING.md)

### 금지

- `any` — 정말 모르겠으면 `unknown` 을 쓰고 사람에게 물어본다.
- `// @ts-ignore`, `eslint-disable` 로 에러 덮기 — 원인을 고친다.
- 인라인 `style={{}}` — Tailwind 로 불가능한 경우만 예외(주석 필수).
- API 키·비밀번호를 코드에 직접 쓰기.
- `node_modules`, `dist`, `pnpm-lock.yaml` 수동 편집.

---

## 4. 반응형은 선택이 아니라 필수

이 프로젝트는 **PC와 모바일을 둘 다** 지원합니다. 화면을 만들 때마다 지키세요.

**모바일 기준으로 쓰고 `sm:` 로 키웁니다.** (접두사 없는 클래스 = 모바일 기본값)

```tsx
<h1 className="text-2xl sm:text-3xl">                {/* 글자 */}
<div className="grid grid-cols-1 sm:grid-cols-2">    {/* 카드 목록 */}
<div className="flex flex-col sm:flex-row">          {/* 배치 */}
<section className="px-4 py-6 sm:px-6 sm:py-10">     {/* 여백 */}
<nav className="hidden sm:flex">                     {/* PC 전용 */}
<button className="sm:hidden">                       {/* 모바일 전용 */}
```

**화면을 만들기 전에 시안부터 봅니다.** [docs/design/README.md](./docs/design/README.md) 에서 그 화면을 찾아
데스크톱·모바일 그림(`docs/design/screens/*.png`)을 **둘 다 Read 로 열어** 보고 만드세요.
시안은 모양 참고용이고 이 문서의 규칙이 우선입니다. 시안이 없는 화면은 README 의 "시안이 없는 화면" 표를 따릅니다.

화면을 만들거나 고친 뒤에는 **항상** 아래를 확인하고 보고하세요.

- [ ] 375px 에서 가로 스크롤이 안 생긴다 (고정 너비 대신 `w-full max-w-*`)
- [ ] 누르는 건 최소 40px (`h-10`)
- [ ] 이미지에 `max-w-full`
- [ ] `h-screen` 대신 `min-h-screen` (모바일 주소창 때문)

자세한 규칙: `responsive-ui` 스킬 (`.claude/skills/responsive-ui/`)

---

## 5. 작업이 끝나면 반드시 통과시킬 것

코드를 고쳤으면 **커밋하기 전에** 실행하고 결과를 보고합니다.

```bash
pnpm run typecheck   # 타입 에러 0개
pnpm run lint        # 린트 에러 0개
pnpm run format      # 코드 자동 정리
pnpm run build       # 빌드 성공
```

- 하나라도 실패하면 **커밋하지 말고** 고친 뒤 다시 돌립니다.
- 고쳐도 안 되면 **에러 메시지 원문을 그대로 보여주고** 사람에게 물어봅니다.
- 설정을 끄거나 무시 주석으로 덮어서 통과시키는 것은 **금지**입니다.

---

## 6. Git 작업 규칙 (GitHub MCP / gh CLI 공통)

### 6-0. 브랜치 전략

```
feat/login-form ─┐
fix/header-bug  ─┼─▶  develop  ─▶  main
chore/prettier  ─┘   (개발 통합)       (최종본)
```

| 브랜치        | 무엇                          | 직접 커밋 |
| ------------- | ----------------------------- | --------- |
| `main`        | 최종본. 안정적으로 도는 코드  | ❌ 금지   |
| `develop`     | 개발 통합. 작업물이 모이는 곳 | ❌ 금지   |
| `feat/...` 등 | 실제로 작업하는 브랜치        | ✅        |

- 작업 브랜치는 **항상 `develop` 에서** 딴다. (`main` 이 아니다)
- 작업이 끝나면 **`develop` 으로 PR** 을 올린다.
- `develop → main` PR 은 **사람이** 연다. AI 가 먼저 만들지 않는다.

### 6-1. 브랜치를 먼저 만든다 — 이름은 **물어본다**

**`main` 과 `develop` 에 직접 커밋하는 것은 절대 금지입니다.**
(`.claude/hooks/guard-git.sh` 가 실제로 막습니다. 차단당하면 우회하지 말고 규칙을 따르세요.)
작업 요청을 받으면 코드를 건드리기 **전에** 브랜치부터 만듭니다.

브랜치 이름은 **후보 3개를 만들어서 `AskUserQuestion` 으로 고르게 하세요.**
혼자 정하고 넘어가지도, 빈손으로 "뭐로 할까요?" 묻지도 마세요.

```
타입/영문-설명            feat/login-form
타입/이슈번호-영문-설명   feat/12-login-form
```

| 타입       | 언제                    |
| ---------- | ----------------------- |
| `feat`     | 새 기능                 |
| `fix`      | 버그 수정               |
| `refactor` | 동작 그대로 코드 정리   |
| `style`    | CSS·여백 등 보이는 것만 |
| `docs`     | 문서만                  |
| `chore`    | 설정·패키지 등 기타     |

소문자·하이픈만. 한글·공백·대문자 금지.
한국어 → 영어 사전과 후보 만드는 요령: `.claude/commands/start.md`

```bash
git switch develop && git pull origin develop && git switch -c feat/12-login-form
```

`develop` 이 없다는 에러가 나면: `git fetch origin && git switch -c develop origin/develop`

### 6-2. 커밋 메시지는 **당신이 쓴다**

사용자에게 "커밋 메시지 뭐로 할까요?" 라고 묻지 마세요. `git diff` 를 읽고 직접 씁니다.

```
<타입>: <한국어로 무엇을 했는지>      ← 50자 이내, 마침표 없음

<왜 그렇게 했는지 — 필요할 때만 2~3줄>

Refs: #12
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

**좋은 예**

```
feat: 로그인 폼에 이메일 형식 검사 추가

정규식으로 @ 포함 여부를 확인하고, 틀리면 Input 아래에
빨간 안내 문구를 보여주도록 했습니다.

Refs: #12
```

**나쁜 예** — `수정` / `update` / `feat: 작업함` / `feat: 로그인 만들고 헤더도 고침`

규칙:

- **한 커밋 = 한 가지 일.** 성격이 다르면 `git add` 를 나눠 커밋을 쪼갭니다.
- `git add .` 금지. 바꾼 파일을 명시합니다.

### 6-3. Pull Request

- **base 브랜치는 `develop`** — `gh pr create --base develop ...`
- 제목은 커밋과 같은 형식: `feat: 로그인 폼 추가`
- 본문은 `.github/PULL_REQUEST_TEMPLATE.md` 를 **실제 내용으로** 채웁니다. 빈칸 금지.
- **체크리스트는 당신이 직접 검증해서 채웁니다.** 사용자에게 확인했냐고 묻지 마세요.
  단, **돌려보지 않은 항목을 체크하는 것은 절대 금지**입니다. 특히 "눈으로 확인" 항목은
  사람이 브라우저로 봐야 하므로 기본적으로 비워두고 사용자에게 안내합니다.
- 관련 이슈는 `Closes #12` 로 연결.
- 리뷰는 선택. 사용자가 원할 때만 리뷰어를 지정합니다. merge 는 PR 을 올린 사람이 직접 확인한 뒤 GitHub 웹에서 합니다.
- PR 하나는 **파일 10개 / 300줄 이내** 목표.

### 6-4. 절대 혼자 하지 않는 것

- `git push --force`, `git reset --hard`, `git rebase`
- 브랜치 삭제, PR merge / close
- `main` / `develop` 으로의 직접 push
- `develop → main` PR 생성·merge (사람이 합니다)
- 이미 올라간 커밋 수정 (`commit --amend`)
- 파일·폴더 삭제, 의존성 제거
- 저장소 설정 변경(공개 범위, 협업자 등)

이 중 대부분은 `.claude/hooks/guard-git.sh` 가 **실제로 차단**합니다.
force push(`--force`/`-f`/`+refspec`), `--mirror`, `--delete`, `--prune`,
`reset --hard`, `clean -f`, `checkout .`, `stash drop`, `filter-branch`,
`reflog expire`, `gc --prune`, `remote set-url`, `rm -rf .git` 등입니다.

여기에 더해 `.husky/` 의 git 훅이 커밋·푸시 시점에 한 번 더 검사합니다.
(main·develop 직접 커밋/푸시, 커밋 메시지 형식, 강제 푸시, 브랜치 삭제 푸시)

**차단당하면 우회하지 마세요.** 다른 명령으로 같은 결과를 내려는 시도도 금지입니다.
특히 `--no-verify` 로 husky 를 건너뛰는 것은 **절대 금지**입니다.
왜 막혔는지 사용자에게 설명하고, 훅이 알려주는 안전한 대안을 제시하세요.

### 6-5. 작업 흐름 (요청 하나 = 이 순서)

1. **확인** — `git status` 로 현재 브랜치와 수정 파일 확인. 남의 작업이 섞여 있으면 멈추고 묻는다.
2. **브랜치** — 이름 후보를 제시해 고르게 하고, 최신 **`develop`** 에서 새 브랜치를 판다.
3. **작업** — 작은 단위로. 반응형 규칙을 지킨다.
4. **검증** — `typecheck` → `lint` → `format` → `build` 전부 통과.
5. **커밋** — 컨벤션대로 직접 작성. 여러 일을 했으면 커밋을 나눈다.
6. **푸시** — `git push -u origin <브랜치명>`
7. **PR** — **base 는 `develop`.** 템플릿을 채우고 체크리스트를 검증해서 표시. 이슈 연결, 리뷰어는 원할 때만 지정.
8. **보고** — **PR 링크 + 바꾼 것 3줄 요약.**

**merge 는 사람이 합니다. AI는 merge 하지 않습니다.**

### 6-6. GitHub MCP 를 쓸 때

MCP 도구가 연결돼 있으면 `gh` CLI 대신 써도 됩니다. **규칙은 똑같습니다.**

- 브랜치 이름은 물어보고, 커밋 메시지는 컨벤션대로 직접 씁니다.
- MCP 로 파일을 직접 고쳐 `main`·`develop` 에 바로 올리는 기능은 쓰지 마세요.
  항상 로컬 브랜치 → 커밋 → 푸시 → PR 순서를 따릅니다.

---

## 7. 사람과 대화하는 방식

- 전문 용어는 **괄호로 짧게 풀어준다.** 예: "리렌더(화면을 다시 그리는 것)"
- 코드를 고친 뒤에는 **"무엇을 / 왜" 2~3줄 요약.** 코드 전체를 다시 붙여넣지 않는다.
- 질문은 **한 번에 하나씩.** 3개를 한꺼번에 던지지 않는다.
- 학생이 틀린 방향으로 가도 **먼저 이유를 설명하고**, 그래도 하겠다면 그대로 해 준다.
- "이거 왜 이래요?" 에는 **고치기 전에 원인부터 설명**한다.
- 에러 메시지는 **한국어로 한 문장 번역** → **어느 파일 몇 번째 줄** → **어떻게 고칠지** 순서로.

---

## 8. 참고 문서

| 문서                                                   | 내용                                     |
| ------------------------------------------------------ | ---------------------------------------- |
| [README.md](./README.md)                               | 설치·실행 방법, 명령어                   |
| [CONTRIBUTING.md](./CONTRIBUTING.md)                   | 협업 규칙 요약                           |
| [docs/FOLDER-STRUCTURE.md](./docs/FOLDER-STRUCTURE.md) | `src/` 구조와 판단표                     |
| [docs/CONVENTIONS.md](./docs/CONVENTIONS.md)           | 브랜치·커밋·코드 치트시트                |
| [docs/GIT-GUIDE.md](./docs/GIT-GUIDE.md)               | git/GitHub 입문                          |
| [docs/AI-GUIDE.md](./docs/AI-GUIDE.md)                 | Claude Code·MCP 사용법                   |
| [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)   | 자주 나는 에러                           |
| [docs/DATA-FETCHING.md](./docs/DATA-FETCHING.md)       | 서버 데이터 받아오기 (TanStack Query)    |
| [docs/SERVER-SYNC.md](./docs/SERVER-SYNC.md)           | 이 기기의 데이터를 서버와 맞추기 (#516)  |
| [docs/design/README.md](./docs/design/README.md)       | 화면 시안 (데스크톱·모바일 그림)         |
| [docs/AI-FEATURES.md](./docs/AI-FEATURES.md)           | 앱 안의 AI(GPT) 기능 — 원칙·지금·다음    |
| [docs/HISTORY-REPORT.md](./docs/HISTORY-REPORT.md)     | 기록 탭(일간·주간 리포트) 규칙과 데이터  |
| [docs/PLAN.md](./docs/PLAN.md)                         | 최종 기획서 (2026-10-17) — 이슈의 「장」 |
| [docs/APP-BRIDGE.md](./docs/APP-BRIDGE.md)             | 휴대폰 앱과 말 주고받기 (앱 브릿지)      |

스킬(`.claude/skills/`): `github-flow` · `new-page` · `new-component` · `responsive-ui`
명령어(`.claude/commands/`): `/setup` `/start` `/save` `/pr` `/check` `/sync` `/run` `/fix`
