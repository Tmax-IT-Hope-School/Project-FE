/** 프로젝트 전체에서 쓰는 타입을 모아둡니다. */

/*
 * 날짜·시각 표기 규칙 (모든 타입 공통)
 * - 날짜: 'YYYY-MM-DD' 형식의 문자열        예) '2026-09-28'
 * - 시각: Date.now() 로 얻은 밀리초 숫자     예) 1790000000000
 */

export interface Post {
  id: number
  userId: number
  title: string
  body: string
}

/** 로그인한 사람 정보 */
export interface AuthUser {
  /** 사람을 구분하는 고유 값 (서버가 정해 줍니다) */
  id: string
  /** 화면에 보이는 이름 */
  name: string
}

/**
 * 과목 태그에 쓸 수 있는 색 (12가지).
 * 색을 더하려면 여기에 적은 뒤 타입 검사가 알려 주는 곳(색 이름표·색 표)을 모두 채우면 됩니다. (lib/subjects.ts 참고)
 */
export type SubjectColor = 'red' | 'orange' | 'green' | 'blue' | 'purple'

/** 과목 (예: 수학, 영어) */
export interface Subject {
  /** 과목을 구분하는 고유 값 */
  id: string
  /** 화면에 보이는 과목 이름 (예: '수학') */
  name: string
  /** 과목 태그에 칠할 색 */
  color: SubjectColor
}

/*
 * 아래 StudyPlan · StudySession 에서 이름 뒤에 ? 가 붙은 항목은 "없어도 되는" 항목입니다.
 * 나중에 더한 항목이라서, 그 전에 저장된 계획·기록에는 이 값이 없습니다.
 * 없을 때 어떻게 볼지는 항목마다 주석에 적어 두었습니다. (BE 와 맞춘 표: Project 저장소 #12)
 */

/** 계획·기록의 종류 — study: 공부, play: 노는 계획 */
export type PlanKind = 'study' | 'play'

/** 하루 계획 한 줄 (공부 계획 또는 노는 계획) */
export interface StudyPlan {
  /** 계획을 구분하는 고유 값 */
  id: string
  /** 계획한 날짜 (예: '2026-09-28') */
  date: string
  /** 어떤 과목의 계획인지 (Subject 의 id). 노는 계획이면 빈 글자('') */
  subjectId: string
  /** 할 일 내용 (예: '수학 문제집 3단원 풀기') */
  content: string
  /** 목표 시간 (분 단위) */
  targetMinutes: number
  /** 다 했으면 true, 아직이면 false */
  done: boolean
  /** 시작할 시각 (예: '19:00'). 안 정했으면 없음 */
  startTime?: string
  /** 공부 계획인지 노는 계획인지. 없으면 공부(study)로 봅니다 */
  kind?: PlanKind
  /** 루틴이 만든 계획이면 그 루틴의 id (Routine 의 id) */
  routineId?: string
  /** 구글 캘린더에 넣었으면 구글이 정해 준 일정 id. 앱이 만든 일정만 옮기고 지울 때 씁니다 (#316) */
  googleEventId?: string
}

/** 타이머로 한 번 잰 기록 (시작 ~ 정지) */
export interface StudySession {
  /** 기록을 구분하는 고유 값 */
  id: string
  /** 어떤 과목을 공부했는지 (Subject 의 id). 노는 기록이면 빈 글자('') */
  subjectId: string
  /** 공부를 시작한 시각 (Date.now() 값) */
  startedAt: number
  /** 공부를 끝낸 시각 (Date.now() 값) */
  endedAt: number
  /** 이 세션에서 일시정지를 누른 횟수 */
  pauseCount: number
  /** 시작 ~ 끝 사이에 일시정지해 있던 시간의 합 (밀리초). 없으면 0 으로 봅니다 */
  pausedMs?: number
  /** 어느 계획을 하려고 켠 타이머인지 (StudyPlan 의 id). 계획 없이 켰으면 없음 */
  planId?: string
  /** 시작할 때 약속한 목표 시간 (분). 목표 없이 켰으면 없음. 나중에 계획을 고쳐도 이 값은 그대로입니다 */
  targetMinutes?: number
  /** 목표 전에 그만뒀을 때 고른 이유. 안 골랐으면 없음 */
  stopReason?: MissReason
  /** 공부 기록인지 노는 기록인지. 없으면 공부(study)로 봅니다 */
  kind?: PlanKind

  /*
   * 아래는 카드 기준으로 넓힌 칸입니다. (최종 기획서 「4.4 타이머」, #380)
   * 옛 기록에는 없습니다. 없을 때 어떻게 볼지는 lib/sessionRecords.ts 의 함수가 정합니다.
   */
  /** 어느 카드의 세션인지 (Card 의 id). 새 세션은 꼭 있습니다. 옛 기록은 planId 로 찾습니다 */
  cardId?: string
  /** 세션을 잰 방법. 없으면 normal */
  mode?: SessionMode
  /** 일시정지 한 번 한 번 (이유 태그 포함). 있으면 pauseCount · pausedMs 는 이 값에서 계산한 것입니다 */
  pauses?: SessionPause[]
  /** 예정 종료 전에 [끝내기] 를 눌렀으면 true (중도 종료) */
  endedEarly?: boolean
  /** 종료 팝업에서 받은 것. 팝업을 닫아 버렸으면 없음 */
  endReport?: SessionEndReport
  /** 딴생각 주차장에 쓴 한 줄 메모 */
  memos?: SessionMemo[]
  /** 노는 기록일 때 무엇을 했는지 */
  playTag?: PlayTag
  /** 노는 기록일 때, 놀기가 끝난 뒤 [카드 시작] · [놀기 끝] 을 누를 때까지 더 쉰 시간 (밀리초) */
  overRestMs?: number
}

/** 세션을 잰 방법 — normal: 타이머, offline: 폰을 내고 앱이 잰 세션(야자 등), selfReport: 끝난 뒤 사후 입력 */
export type SessionMode = 'normal' | 'offline' | 'selfReport'

/** 일시정지 이유 (1탭). 이름표와 내부/외부 분류는 lib/sessionTags.ts */
export type PauseTag = 'toilet' | 'snack' | 'phone' | 'mindWander' | 'stuck' | 'external' | 'other'

/** 일시정지 한 번 */
export interface SessionPause {
  /** 일시정지를 누른 시각 */
  startedAt: number
  /** 다시 시작한 시각. 일시정지한 채로 끝냈으면 세션이 끝난 시각 */
  endedAt: number
  /** 이유 */
  tag: PauseTag
  /** '기타' 를 골랐을 때 쓴 글 (빈칸 허용) */
  note?: string
  /** '기타' 글을 AI 가 나눈 이름표 (#419 표 8번). 참고 칸이라 판정 · 집계에 쓰지 않습니다 */
  aiSource?: 'inner' | 'outer'
}

/** 체크리스트를 다 못 했을 때 고르는 이유. 이름표는 lib/sessionTags.ts */
export type ShortfallReason =
  'tooMuch' | 'stuck' | 'phone' | 'mindWander' | 'tired' | 'external' | 'etc'

/** 잘 된 이유 (체크리스트를 다 했을 때 가끔 묻습니다). 이름표와 내부/외부 분류는 lib/sessionTags.ts */
export type GoodReason = 'focus' | 'goodPlan' | 'condition' | 'environment' | 'helped' | 'luck'

/** 세션 중에 같이 한 것 — 즐거움 묶기를 대신합니다 */
export type WithWhat = 'music' | 'video' | 'none'

/** 노는 기록의 종류 */
export type PlayTag = 'youtube' | 'game' | 'sns' | 'webtoon' | 'rest' | 'etc'

/** 종료 팝업에서 받은 것 (산출물 말고는 모두 1탭) */
export interface SessionEndReport {
  /** 체크한 체크리스트 항목 (ChecklistItem 의 id → 체크한 시각) */
  checked: Record<string, number>
  /** 다 못 했을 때 고른 이유 */
  shortfallReason?: ShortfallReason
  /** 같이 한 것 */
  withWhat?: WithWhat
  /** 산출물 증빙 — 링크 또는 2~3줄 요약 (사진은 저장소가 정해진 뒤) */
  proof?: { link?: string; summary?: string }
  /** 잘 된 이유 (물었을 때만) */
  goodReasons?: GoodReason[]
  /** 관리 4단계라 증빙이 꼭 필요했던 세션이면 true — 증빙이 없으면 실행으로 인정하지 않습니다 (#408) */
  proofRequired?: boolean
}

/** 딴생각 주차장 메모 한 줄 */
export interface SessionMemo {
  /** 쓴 시각 */
  at: number
  /** 한 줄 */
  text: string
  /** AI 가 나눈 이름표 (#419 표 9번, 다음 버전 리포트 재료). 참고 칸이라 판정 · 집계에 쓰지 않습니다 */
  aiCategory?: MemoCategory
}

/** 딴생각 메모 이름표: #연락 · #다른과제 · #걱정 · #생활 */
export type MemoCategory = 'contact' | 'otherTask' | 'worry' | 'life'

/** 요일마다 반복되는 계획의 틀. 그 요일의 계획에 자동으로 들어옵니다 */
export interface Routine {
  /** 루틴을 구분하는 고유 값 */
  id: string
  /** 무슨 요일마다 (0 = 일요일, 1 = 월요일 … 6 = 토요일. Date 의 getDay() 와 같은 숫자입니다) */
  weekdays: number[]
  /** 공부 루틴인지 노는 루틴인지 */
  kind: PlanKind
  /** 어떤 과목인지 (Subject 의 id). 노는 루틴이면 빈 글자('') */
  subjectId: string
  /** 할 일 내용 */
  content: string
  /** 목표 시간 (분 단위) */
  targetMinutes: number
  /** 시작할 시각 (예: '19:00'). 안 정했으면 없음 */
  startTime?: string
}

/*
 * ── 카드 (최종 기획서 2026-10-17, docs/PLAN.md 「4.3 카드」) ──
 * 분석의 기본 단위가 하루 → 카드로 바뀌었습니다. 위의 StudyPlan · Routine 을 대신합니다. (#379)
 * 칸 이름은 BE(Project-BE#222)와 같습니다. 바꾸면 BE 와 RN 앱(Project-App)에도 알려 주세요.
 */

/** 카드의 우선순위 — absolute: 미룰 수 없는 카드(과제 제출 등), flexible: 줄이거나 미룰 수 있는 카드 */
export type CardPriority = 'absolute' | 'flexible'

/** 카드의 유형 — self: 자습, lecture: 인강 */
export type CardType = 'self' | 'lecture'

/** 카드 체크리스트의 한 항목. 체크했는지는 카드가 아니라 그날의 세션 기록에 남깁니다 (#380) */
export interface ChecklistItem {
  /** 항목을 구분하는 고유 값 */
  id: string
  /** 할 일 (예: '수학 문제집 42~45쪽') */
  text: string
  /** AI 가 추천해서 넣었고 아직 사람이 안 고쳤으면 true. 폼에서 'AI 추천' 표시를 붙입니다 (#413) */
  aiSuggested?: boolean
}

/** 카드를 시작하라고 알려 주는 방법 */
export interface CardAlert {
  /** message: 알림 메시지, call: AI 전화 */
  method: 'message' | 'call'
  /** 시작 몇 분 전에 알릴지. 0 이면 정각 */
  minutesBefore: number
  /** 알림에 보일 문장. 없으면 기본 문구 */
  text?: string
}

/**
 * 카드 한 장 = "언제 + 무엇을" 정한 계획 하나. 1회성 카드와 요일마다 반복하는 카드가 있습니다.
 * 반복 카드도 한 장으로 두고, 날마다 했는지는 세션 기록에 남깁니다. (매일 복사하지 않음)
 */
export interface Card {
  /** 카드를 구분하는 고유 값 */
  id: string
  /** 무엇을 하는지 (예: '수학 문제집') */
  title: string
  /** 1회성 카드면 그 날짜, 반복 카드면 반복을 시작한 날짜 ('YYYY-MM-DD') */
  date: string
  /** 반복 카드면 요일 목록 (0 = 일요일 … 6 = 토요일). 1회성 카드면 없음 */
  repeatDays?: number[]
  /** 시작 시각 (예: '19:00'). 새 카드는 꼭 있고, 옛 계획에서 옮긴 카드만 없을 수 있습니다 */
  startTime?: string
  /** 길이 (분) */
  durationMinutes: number
  /** 체크리스트 (필수, 1개 이상). 비어 있으면 AI 기본값 또는 제목 1개로 채웁니다 */
  checklist: ChecklistItem[]
  /** 연결한 목표의 id. 없으면 "목표 없음" */
  goalId?: string
  /** 우선순위. 기본은 flexible */
  priority: CardPriority
  /** 유형. 기본은 self(자습) */
  type: CardType
  /** 예상 달성 개수. 없으면 "체크리스트 전부" 로 봅니다 */
  expectedDone?: number
  /** 예상 달성 개수를 낮춘 이유 (태그 1개) */
  expectedDoneReason?: string
  /** 예상 실패 원인 (내 행동에서 나오는 원인을 1개 이상 포함) */
  expectedFailCauses?: string[]
  /** 알림. 없으면 기본(정각 · 메시지 · 기본 문구) */
  alert?: CardAlert
  /** 카드 편집 화면을 연 순간부터 저장할 때까지 걸린 시간 (밀리초). '계획 대 실행 비율' 에 씁니다 */
  planningMs?: number
  /** 카드를 만든 시각 */
  createdAt: number
}

/*
 * ── 목표 (최종 기획서 「4.7 목표와 숲」, #391) ──
 * 목표 = D-day 가 있는 장기 결과. 카드는 목표를 위한 일상 행동이고, 카드의 goalId 로 이어집니다.
 * 칸은 BE(Project-BE#221)와 같은 뜻입니다. 바꾸면 BE 에도 알려 주세요.
 */

/** 목표 유형 — score: 점수형(11월 학평 수학 3등급), completion: 완주형(영단어장 1회독). BE 의 SCORE / COMPLETION */
export type GoalKind = 'score' | 'completion'

/** 목표 상태 — 진행 / 완료 / 포기 */
export type GoalStatus = 'active' | 'done' | 'givenUp'

/** 목표값을 고치기 전의 값 (3·7번 오류 대응: 원래 목표를 잊지 않게 지우지 않고 남깁니다) */
export interface GoalTargetSnapshot {
  title: string
  dDay: string
  currentScore?: string
  totalAmount?: number
  amountUnit?: string
  /** 이 값에서 바꾼 시각 */
  changedAt: number
  /** 왜 바꿨는지 */
  reason: string
}

/** 목표 하나 (WOOP 순서로 만듭니다) */
export interface Goal {
  /** 목표를 구분하는 고유 값 */
  id: string
  kind: GoalKind
  /** W 소망 — 목표 한 줄 (예: '11월 학평 수학 3등급') */
  title: string
  /** D-day ('YYYY-MM-DD') */
  dDay: string
  /** 점수형: 지금 점수·등급 (예: '5등급', '62점') */
  currentScore?: string
  /** 완주형: 전체 분량 (예: 300) */
  totalAmount?: number
  /** 완주형: 분량 단위 (예: '쪽', '강') */
  amountUnit?: string
  /** O 결과 — 이루면 좋은 점 */
  benefit: string
  /** O 결과 — 안 하면 생길 일 */
  cost: string
  /** O 방해물 — 내 안의 방해물 1개 (내부 원인만) */
  obstacle: string
  /** P 계획 — 방해물이 생겼을 때의 대처 */
  plan: string
  status: GoalStatus
  /** D-day 뒤에 적은 결과. 아직이면 없음 */
  result?: string
  /** 목표값을 고친 기록 (오래된 것부터) */
  history: GoalTargetSnapshot[]
  /** 목표를 만든 시각 */
  createdAt: number
}

/**
 * 온보딩에서 처음 세운 계획입니다.
 * 한 번 저장하면 나중에 루틴을 바꿔도 이 값은 바뀌지 않습니다. "처음의 나" 와 지금을 비교하는 기준입니다.
 */
export interface InitialPlan {
  /** 처음 계획을 세운 날짜 (예: '2026-10-10') */
  createdDate: string
  /** 하루에 공부하기로 한 시간 (분) */
  dailyMinutes: number
  /** 일주일에 며칠 하기로 했는지 */
  daysPerWeek: number
}

/** 공부 중에 다른 탭·앱으로 나갔다 돌아온 기록 (딴짓 한 번) */
export interface AwayRecord {
  /** 기록을 구분하는 고유 값 */
  id: string
  /** 나간 날짜 (예: '2026-09-28'). 하루 단위로 모아서 셀 때 씁니다. */
  date: string
  /** 공부하던 과목 (Subject 의 id). 알 수 없으면 null */
  subjectId: string | null
  /** 나간 시각 (Date.now() 값) */
  leftAt: number
  /** 돌아온 시각 (Date.now() 값) */
  returnedAt: number
  /** 나가 있던 시간 (밀리초). returnedAt - leftAt 과 같습니다. */
  awayMs: number
}

/** 뽀모도로의 구간 — study: 공부, break: 휴식 */
export type PomodoroPhase = 'study' | 'break'

/** 개선안의 강도 — easy: 쉬움, normal: 보통, hard: 강함 */
export type SuggestionLevel = 'easy' | 'normal' | 'hard'

/** 개선안의 진행 상태 */
export type SuggestionStatus = 'suggested' | 'active' | 'done' | 'dropped'

/** AI 가 실패 원인에 맞춰 고른 개선안 한 장. "만약 ~하면 → ~한다" 문장입니다. */
export interface Suggestion {
  /** 개선안을 구분하는 고유 값 */
  id: string
  /** 어떤 실패 원인에 맞춘 것인지 */
  cause: MissReason
  /** 강도 — 쉬움·보통·강함 */
  level: SuggestionLevel
  /** "만약 ~하면" 에 들어갈 문장 */
  ifText: string
  /** "~한다" 에 들어갈 문장 */
  thenText: string
  /** 왜 추천하는지 한 줄 */
  reason: string
  /** 지금 상태 */
  status: SuggestionStatus
  /** 도전을 시작한 날짜 ('YYYY-MM-DD'). 아직 안 골랐으면 없음 */
  startDate?: string
  /** 실험 기간 (7~14일). 아직 안 골랐으면 없음 */
  days?: number
}

/**
 * 도전 중인 개선안을 그날 지켰는지 적은 기록 (#65)
 * 개선안 하나 · 날짜 하나마다 하나씩 남습니다. (개선안은 동시에 2개까지 도전할 수 있어서 개선안마다 따로 적습니다)
 */
export interface SuggestionCheck {
  /** 어떤 개선안인지 (Suggestion 의 id) */
  suggestionId: string
  /** 지켰는지 확인한 날짜 (예: '2026-09-28'). 체크인한 날이 아니라 "지켰는지 묻는 날(어제)" 입니다. */
  date: string
  /** 지켰으면 true, 못 지켰으면 false */
  kept: boolean
}

/** 하루가 끝난 뒤 AI 가 내린 평가 (날짜마다 하나) */
export interface Evaluation {
  /** 평가한 날짜 (예: '2026-09-28') */
  date: string
  /** 하루 점수 (0 ~ 100) */
  score: number
  /** 그날 정해진 AI 의 관리 강도 (0 회복 ~ 4 강제적 채찍) */
  careLevel: CareLevel
  /** AI 가 남긴 한마디 요약 */
  summary: string
}

/** 자유롭게 쓰는 일기 (하루에 하나, #63) */
export interface DiaryEntry {
  /** 쓴 날짜 (예: '2026-09-28') */
  date: string
  /** 오늘 기분 (1 ~ 5, 체크인과 같은 척도) */
  mood: number
  /** 일기 내용 (원문은 본인만 봅니다) */
  content: string
}

/** AI 가 내준 성찰 일기 처방 (#70) */
export interface ReflectionPrescription {
  /** 처방을 구분하는 고유 값 */
  id: string
  /** 처방이 시작된 날짜 */
  startDate: string
  /** 처방 기간(일). 예: 5 */
  days: number
  /** 왜 처방했는지 (예: "최근 '하기 싫음'이 3번 나와서...") */
  reason: string
  /** 기간 동안 매일 똑같이 묻는 질문 목록 */
  questions: string[]
}

/** 성찰 일기 하루 답 (questions 와 같은 순서로 answers 를 저장합니다) */
export interface ReflectionEntry {
  /** 쓴 날짜 */
  date: string
  /** 어떤 처방에 대한 답인지 (ReflectionPrescription 의 id) */
  prescriptionId: string
  /** 질문별 답 (원문은 본인만 봅니다) */
  answers: string[]
}

/** 어제 계획을 못 채운 이유 (#26 에서 버튼으로 고릅니다) */
export type MissReason =
  | 'tired' // 피곤·수면
  | 'event' // 약속·행사
  | 'phone' // 폰·SNS
  | 'tooMuch' // 계획 과다
  | 'unwilling' // 하기 싫음
  | 'sick' // 아픔
  | 'etc' // 기타

/** 매일 체크인 (하루에 하나) */
/**
 * 하루 첫 한 줄에서 고르는 감정 태그 (#387, BE#220 과 같은 이름)
 * 막막함 · 불안함 · 피곤함 · 짜증남 · 평온함 · 의욕 있음. 글자는 lib/quickCheckIn.ts 의 EMOTION_OPTIONS
 */
export type EmotionTag = 'STUCK' | 'ANXIOUS' | 'TIRED' | 'ANNOYED' | 'CALM' | 'MOTIVATED'

export interface CheckIn {
  /** 체크인한 날짜 (예: '2026-09-28') */
  date: string
  /** 오늘 컨디션 (1 ~ 5) */
  condition: number
  /** 하루 첫 한 줄에서 고른 감정 태그 (여러 개, #387). 안 골랐거나 옛 기록이면 없습니다. */
  emotions?: EmotionTag[]
  /** 오늘 기분 (1 ~ 5) */
  mood: number
  /** 어제 계획을 다 못 채운 날에만 고르는 미달 원인 (#26) */
  missReason?: MissReason
  /** 미달 원인을 '기타'(etc)로 골랐을 때 적은 한 줄 (최대 50자) */
  missReasonNote?: string
  /** 오늘 예상 순공시간(분) */
  expectedMinutes: number
  /** 오늘의 약속 "만약 ~하면" (#79) */
  promiseIf?: string
  /** 오늘의 약속 "~한다" (#79) */
  promiseThen?: string
  /**
   * 이 날 정한 약속을 지켰는지. 약속을 정한 다음 날 체크인에서 "지켰어 / 못 지켰어" 로 답한 값입니다. (#79)
   * 약속을 안 정했거나 아직 안 골랐으면 없습니다. ("못 지킴" 이 아니라 "모름")
   */
  promiseKept?: boolean
  /**
   * 어제 휴대폰 집중 모드(스크린 타임·집중 모드·앱 타이머)를 켰는지 내가 한 답 (#106).
   * "체크인에서 확인받기" 를 켠 사람만 묻고, 안 골랐으면 없습니다. 정말 켰는지는 확인할 수 없습니다.
   */
  phoneFocusKept?: boolean
  /**
   * 앱을 처음 열 때 기분 하나로 만든 1탭 체크인이면 true (#242). 자세한 체크인(/check)을 저장하면 없어집니다.
   * /check 가 \"오늘 체크인 완료\" 를 붙일지 정하는 데 씁니다. (1탭만 한 사람은 자세한 체크인을 아직 안 한 것입니다)
   */
  isQuick?: boolean
}

/** 관리 강도 — 0 회복, 1 당근, 2 넛지, 3 심리적 채찍, 4 강제적 채찍 */
export type CareLevel = 0 | 1 | 2 | 3 | 4

/** 인사이트에 대한 내 반응 (#84 버튼 3개) */
export type InsightResponse =
  | 'surprised' // 몰랐는데 맞아
  | 'alreadyKnew' // 이미 알던 거야
  | 'wrong' // 틀렸어

/** "나를 잘 아는" 인사이트 카드 (#73) */
export interface Insight {
  /** 인사이트를 구분하는 고유 값 */
  id: string
  /** 카드에 보여줄 한 문장 (예: "스스로 밤형이라고 했지만...") */
  sentence: string
  /** 이 결론의 근거가 된 날짜 목록 */
  evidenceDates: string[]
  /** 비교하는 두 조건이 각각 5일 이상 쌓이기 전이면 true ("가설" 배지를 붙입니다) */
  isHypothesis: boolean
  /** 내가 누른 반응 버튼 (#84, 아직 안 눌렀으면 없음) */
  response?: InsightResponse
}

/** 시험 종류 */
export type ExamType = 'mock' | 'school' | 'quiz' | 'etc' // 모의고사 / 내신 / 쪽지시험 / 기타

/** 시험 한 과목의 점수 */
export interface ExamSubjectScore {
  /** 어떤 과목인지 (Subject 의 id) */
  subjectId: string
  /** 시험 전에 입력하는 예상 점수 */
  expectedScore: number
  /** 시험이 끝난 뒤 입력하는 실제 점수 (시험 전에는 없음) */
  actualScore?: number
}

/** 시험 후 회고 3문항 (#81) */
export interface ExamReflection {
  /** ① 준비가 충분했나 (1 ~ 5) */
  preparedness: number
  /** ② 가장 아쉬운 점 (한 줄) */
  regret: string
  /** ③ 다음에 바꿀 한 가지 (한 줄) */
  nextChange: string
}

/** 시험 (모의고사·내신·쪽지시험 등) */
export interface Exam {
  /** 시험을 구분하는 고유 값 */
  id: string
  /** 시험 종류 */
  type: ExamType
  /** 시험 이름 (예: '10월 모의고사') */
  name: string
  /** 시험 날짜 */
  date: string
  /** 과목별 예상·실제 점수 */
  subjectScores: ExamSubjectScore[]
  /** 시험 후 회고 (#81, 시험 날짜가 지나야 입력합니다) */
  reflection?: ExamReflection
}

/** 과거에 공부 계획이 무너졌던 때 (#89, 여러 개 고를 수 있습니다) */
export type PastFailureCause =
  | 'afterExam' // 시험 끝난 직후
  | 'weekend' // 주말
  | 'lateAcademy' // 학원 늦게 끝난 날
  | 'phone' // 폰 보다가
  | 'tooMuchPlan' // 계획이 많아서

/** 아침형 / 밤형 (#89 자기 인식) */
export type Chronotype = 'morning' | 'night'

/** 온보딩에서 받은 과목별 현재 수준 (#88) */
export interface SubjectLevel {
  /** 어떤 과목인지 (Subject 의 id) */
  subjectId: string
  /** 최근 등급 (1 ~ 9). 점수로 입력했으면 없습니다 */
  grade?: number
  /** 최근 점수. 등급으로 입력했으면 없습니다 */
  score?: number
  /** 이 과목에 대한 자신감 (1 ~ 5) */
  confidence: number
}

/**
 * 온보딩 설문 답 (#58, #88, #89)
 * 처음에는 학년 · 시험 · 시험 날짜 · 하루 공부 가능 시간만 꼭 묻습니다.
 * ? 가 붙은 항목은 나중에 "내 정보 더 알려주기" 에서 답하는 것이라 없을 수 있습니다. (#239)
 */
export interface OnboardingAnswers {
  /** 학년 */
  grade: '고1' | '고2' | '고3' | 'N수' | '대학생'
  /** 목표로 하는 시험 이름 (예: '수능') */
  targetExam: string
  /** 목표 시험 날짜 (D-day 계산용) */
  targetExamDate: string
  /** 목표 대학 (선택) */
  targetUniversity?: string
  /** 목표 점수 (선택) */
  targetScore?: string
  /** 평소 기상 시각 ('HH:MM') */
  wakeUpTime?: string
  /** 평소 취침 시각 ('HH:MM') */
  sleepTime?: string
  /** 학교 끝나는 시각 ('HH:MM') */
  schoolEndTime?: string
  /** 학원 끝나는 시각 ('HH:MM') */
  academyEndTime?: string
  /** 주로 공부하는 장소 */
  studyPlace?: string
  /** 과목별 최근 성적·자신감 (#88, 건너뛰면 빈 배열) */
  subjectLevels?: SubjectLevel[]
  /** 과거에 계획이 무너졌던 때 (여러 개) */
  pastFailureCauses?: PastFailureCause[]
  /** 아침형 / 밤형 */
  chronotype?: Chronotype
  /** 한 번에 집중 가능한 시간(분) */
  maxFocusMinutes?: number
  /** 가장 큰 방해 요소 */
  biggestDistraction?: string
  /** 하루 공부 가능 시간(분) */
  dailyAvailableMinutes: number
  /** 공부하는 이유 (한 줄, 최대 50자). 비워 둘 수 있습니다 */
  motivationReason?: string
  /** 목표를 이루면 하고 싶은 것 (한 줄, 최대 50자) */
  goalReward?: string
}

/** 나 사용설명서 항목의 분류 (#87) */
export type ManualItemCategory =
  | 'rhythm' // 리듬
  | 'cautionDay' // 주의할 날
  | 'effectiveMethod' // 효과 있는 방법
  | 'careStyle' // 잘 맞는 관리 방식

/** 나 사용설명서에 쌓이는 검증된 사실 한 줄 (#87) */
export interface ManualItem {
  /** 항목을 구분하는 고유 값 */
  id: string
  /** 4가지 분류 중 하나 */
  category: ManualItemCategory
  /** 한 줄 제목 (예: '오전 집중형') */
  title: string
  /** 이 사실이 확인된 날짜 */
  confirmedDate: string
  /** 근거 (예: '폰을 다른 방에 두면 효과 있음 (2주 실험: 순공 +35분)') */
  evidence: string
}

/**
 * AI 가 보낸 메시지의 종류
 * - regular: 정해진 빈도(예: 하루 3번)에 맞춰 보낸 메시지
 * - event: 무슨 일이 생겨서 바로 보낸 메시지 (예: 계획 시간 지남, 목표 달성)
 */
export type AiMessageKind = 'regular' | 'event'

/**
 * 알림을 누가 만들었는지
 * - ai: AI 가 쓴 메시지 (서버에서 옵니다)
 * - app: 앱이 정해 둔 문장에 숫자를 끼워 만든 알림 (AI 를 부르지 않습니다)
 */
export type AiMessageSource = 'ai' | 'app'

/** 알림 화면에 쌓이는 알림 하나 (AI 가 보낸 메시지와 앱이 만든 알림을 한 목록에 둡니다) */
export interface AiMessage {
  /** 메시지를 구분하는 고유 값 */
  id: string
  /** 보낸 시각 (Date.now() 값) */
  sentAt: number
  /** 보낼 때의 관리 강도 (0 회복 ~ 4 강제적 채찍). 말풍선 색이 이 값에 따라 바뀝니다. */
  careLevel: CareLevel
  /** 정기 메시지인지, 이벤트 알림인지 */
  kind: AiMessageKind
  /** 이벤트 알림일 때 말풍선 아래에 붙는 짧은 이름 (예: '계획 시간 지남') */
  eventLabel?: string
  /** 누가 만든 알림인지. 없으면 AI 가 쓴 메시지('ai')로 봅니다 */
  source?: AiMessageSource
  /** 메시지 내용 */
  text: string
  /** 읽었으면 true, 아직 안 읽었으면 false */
  read: boolean
}

/**
 * 주간 회고 하나 (#82). 한 주(월~일)에 하나만 저장됩니다.
 * 건너뛴 주도 skipped: true 로 저장해서, 같은 주에 다시 묻지 않습니다.
 */
export interface WeeklyReview {
  /** 그 주의 월요일 날짜 (예: '2026-10-05'). 어느 주의 회고인지 구분합니다. */
  weekStart: string
  /** ① 이번 주 가장 잘한 것 (최대 100자) */
  best: string
  /** ② 가장 아쉬운 것 (최대 100자) */
  regret: string
  /** ③ 다음 주에 바꿀 한 가지 (최대 100자) */
  change: string
  /** 건너뛰었으면 true. 이때 세 답은 빈 글자입니다. */
  skipped: boolean
  /** 저장한 시각 (Date.now() 값) */
  savedAt: number
}
