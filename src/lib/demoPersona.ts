import { buildJudgedCardDays } from '@/lib/cardDays'
import type { CardDayMarkRecord, CardFailCause } from '@/lib/cardMarks'
import type { SavedCareStage } from '@/lib/careStage'
import { formatMinutes } from '@/lib/dailyRecords'
import { moveDateKey } from '@/lib/date'
import { getDaySummary } from '@/lib/daySummary'
import { DEMO_ID_PREFIX } from '@/lib/demoIds'
import { judgeExperiment, type Experiment } from '@/lib/experiments'
import type { FocusScoreRecord } from '@/lib/focusScore'
import { scorePsychTest } from '@/lib/psychTest'
import { getCardDayMarkInfo, type RestDay } from '@/lib/restDays'
import { getWeekday } from '@/lib/routines'
import { summarizePauses } from '@/lib/sessionRecords'
import { getWeekCardDays, getWeeklyNumbers } from '@/lib/weeklyCardStats'
import {
  PREDICTION_OPTIONS,
  getActualValue,
  getAvailableKinds,
  getPredictionDiff,
  pickPredictionKind,
  type PredictionKind,
  type WeeklyPrediction,
} from '@/lib/weeklyPrediction'
import type {
  Card,
  CheckIn,
  EmotionTag,
  FixedBlock,
  Goal,
  ManualItem,
  MissReason,
  PauseTag,
  PlayTag,
  SessionEndReport,
  SessionPause,
  ShortfallReason,
  StudyPlan,
  StudySession,
} from '@/types'

/**
 * 발표 시연용 "가상 사용자" 의 28일을 만드는 순수 함수들입니다. (FE#418, 최종 기획서 「10 시연」)
 * 저장소를 쓰지 않고 값만 만듭니다. 넣고 빼는 것은 lib/demoData.ts 가 합니다.
 *
 * ■ 어떤 사람인가 (발표 대본과 맞춘 줄거리)
 *   - 고2.
 *   - 목표 2개: '11월 학평 수학 3등급'(점수형, 처음엔 2등급이었다가 고침) · '기말 전 영단어장 1회독'(완주형, 300쪽)
 *   - 학원: 월·수·금 18:00 ~ 21:30 (고정 일정)
 *   - 하루 카드: 평일 3~4장, 주말 2~3장
 *   - 사건 (오늘 = 28일째)
 *       · 첫 2주: 학원 끝난 밤의 '밤 수학 오답' 을 자꾸 놓친다 → 두 번 연달아 실패 = 재발 신호 ①
 *       · 15일째(오늘의 14일 전): '폰을 다른 방에' 실험 시작 → 밤 카드 실행률이 오른다 → 오늘 판정하면 효과 있음
 *       · 16~21일째 중 화·목 하루: 아파서 쉼 (휴식 1회)
 *       · 19~25일째의 토요일: 꼭 하기로 한 '주말 수학 모의고사' 를 놓침 = 재발 신호 ②
 *       · 관리 단계: 1 → 2 → 1 → 0(회복) → 1 → 3 → 2
 *   - 데이터로 보면 아침 카드 실행률이 저녁보다 높다 → "저녁형" 가설은 틀리고, "폰이 가장 큰 방해" 는 맞다.
 *
 * ■ 늘 같은 사람이 되게
 *   무작위로 만들지 않고, 카드 이름 · "몇 번째 날" 로 정해지는 숫자(hashSeed → createRandom)를 씁니다.
 *   그래서 언제 넣어도 "오늘로부터 며칠 전" 의 하루하루가 같습니다. BE 시드(Project-BE#240)도 같은 규칙을 쓰면 같은 사람입니다.
 *   (요일은 넣는 날에 따라 달라지므로, 어떤 카드가 그날 있는지는 넣는 날마다 조금씩 다릅니다)
 *
 * ■ 지울 수 있게
 *   만드는 모든 카드 · 세션 · 목표 · 기록의 id 는 'demo-' 로 시작합니다.
 */

/** 며칠치를 만드는지 (오늘 포함) */
export const DEMO_DAYS = 28
/** 실험을 시작한 날 = 0번째 날부터 셌을 때 몇 번째 날인지 (오늘의 14일 전) */
const EXPERIMENT_START_INDEX = DEMO_DAYS - 15

const MINUTE = 60 * 1000

/**
 * 같은 씨앗(seed)이면 늘 같은 순서로 0 이상 1 미만의 수를 내는 함수입니다. (mulberry32 라는 방법)
 *
 *   const random = createRandom(418)
 *   random()  // 다시 createRandom(418) 로 만들면 같은 수가 같은 순서로 나옵니다
 */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 글자를 씨앗 숫자로 바꿉니다. 같은 글자면 늘 같은 숫자입니다. (FNV-1a 라는 방법) */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** 'YYYY-MM-DD' 날짜의 'HH:MM' 시각 (밀리초) */
function atTime(dateKey: string, time: string): number {
  const [year, month, day] = dateKey.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  return new Date(year, month - 1, day, hour, minute).getTime()
}

/** 배열에서 random 값으로 하나 고릅니다. */
function pick<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]
}

// ── 가상 사용자의 카드 ──

/** 카드 하루치의 결과 (lib/cardResult.ts 의 판정이 이렇게 나오도록 기록을 만듭니다) */
type Outcome = 'done' | 'late' | 'endedEarly' | 'selfReport' | 'failed' | 'unhandled' | 'rest'

/** 평소 확률: 제때 · 늦게 · 중간에 끝냄 · 나중에 적음. 나머지는 실패 기록(failCause 가 있을 때) 또는 미실행 */
interface OutcomeRates {
  done: number
  late: number
  early: number
  selfReport?: number
}

interface DemoCardSpec {
  key: string
  title: string
  goal?: 'math' | 'words'
  /** 반복 요일 (0 = 일요일). 비어 있으면 1회성 카드 */
  repeatDays: number[]
  startTime: string
  durationMinutes: number
  checklist: string[]
  /** 기록 화면의 과목 태그 (mock 과목 id) */
  subjectId: string
  absolute?: boolean
  lecture?: boolean
  /** 예상 달성 개수를 낮춘 카드 */
  expectedDone?: { count: number; reason: string }
  rates: OutcomeRates
  /** 제때·늦게 했을 때 보통 체크하는 개수. 없으면 전부 (계획 과대 카드는 전부보다 적게) */
  usualChecked?: number
  /** 못 했을 때 실패로 적는 원인. 없으면 아무 표시 없이 미실행으로 둡니다 */
  failCause?: CardFailCause
  /** 다 못 했을 때 고르는 이유 */
  shortfall: ShortfallReason
}

const DEMO_CARDS: DemoCardSpec[] = [
  {
    key: 'morning-words',
    title: '아침 영단어 20쪽',
    goal: 'words',
    repeatDays: [1, 2, 3, 4, 5],
    startTime: '06:40',
    durationMinutes: 20,
    checklist: ['20쪽 외우기', '어제 외운 것 다시 보기'],
    subjectId: 'english',
    rates: { done: 0.86, late: 0.08, early: 0.02 },
    failCause: 'tired',
    shortfall: 'tired',
  },
  {
    key: 'math-lecture',
    title: '수학 개념 인강 1강',
    goal: 'math',
    repeatDays: [1, 3, 5],
    startTime: '16:30',
    durationMinutes: 60,
    checklist: ['인강 1강 듣기', '예제 3개 풀기'],
    subjectId: 'math',
    lecture: true,
    rates: { done: 0.7, late: 0.15, early: 0.1 },
    failCause: 'phone',
    shortfall: 'mindWander',
  },
  {
    key: 'night-math',
    title: '밤 수학 오답 정리',
    goal: 'math',
    repeatDays: [1, 3, 5],
    startTime: '21:40',
    durationMinutes: 40,
    checklist: ['오늘 틀린 문제 다시 풀기', '오답노트에 옮기기', '비슷한 문제 1개 풀기'],
    subjectId: 'math',
    expectedDone: { count: 2, reason: '시간이 빠듯해서' },
    // 실험 전: 학원 끝나고 지쳐서 시작해도 중간에 끝내기 일쑤. 우연히 놓치는 날은 없고(합 1), 놓친 날은 줄거리에 박아 둔 두 번뿐
    // 실험 뒤 확률은 NIGHT_MATH_AFTER_EXPERIMENT
    rates: { done: 0.2, late: 0.25, early: 0.55 },
    usualChecked: 2,
    failCause: 'tired',
    shortfall: 'tired',
  },
  {
    key: 'math-book',
    title: '수학 문제집 6쪽',
    goal: 'math',
    repeatDays: [2, 4],
    startTime: '19:00',
    durationMinutes: 60,
    checklist: ['문제집 6쪽 풀기', '채점하기', '틀린 문제 표시하기'],
    subjectId: 'math',
    // 시간은 다 채우는데 체크리스트가 남는 카드 → 계획 패턴 '과대'
    rates: { done: 0.8, late: 0.12, early: 0.04 },
    usualChecked: 2,
    failCause: 'tooMuch',
    shortfall: 'tooMuch',
  },
  {
    key: 'korean',
    title: '국어 비문학 3지문',
    repeatDays: [2, 4],
    startTime: '21:00',
    durationMinutes: 40,
    checklist: ['지문 3개 읽기', '지문마다 한 줄 요약'],
    subjectId: 'korean',
    rates: { done: 0.6, late: 0.15, early: 0.05, selfReport: 0.08 },
    failCause: 'procrastinated',
    shortfall: 'mindWander',
  },
  {
    // 국어(21:00 ~ 21:40)와 시간이 겹치는 유연 카드 → 카드 탭의 "유연 카드부터 줄여 볼까요?"
    key: 'listening',
    title: '영어 듣기 1회분',
    repeatDays: [2, 4],
    startTime: '21:30',
    durationMinutes: 30,
    checklist: ['듣기 1회분 풀기', '틀린 문항 다시 듣기'],
    subjectId: 'english',
    rates: { done: 0.45, late: 0.2, early: 0.25 },
    failCause: 'tired',
    shortfall: 'tired',
  },
  {
    key: 'mock-exam',
    title: '주말 수학 모의고사',
    goal: 'math',
    repeatDays: [6],
    startTime: '10:00',
    durationMinutes: 100,
    checklist: ['모의고사 1회 시간 재고 풀기', '채점하기', '틀린 문제 3개 다시 풀기'],
    subjectId: 'math',
    absolute: true,
    rates: { done: 0.85, late: 0.15, early: 0 },
    shortfall: 'stuck',
  },
  {
    key: 'english-reading',
    title: '영어 독해 지문 5개',
    repeatDays: [6],
    startTime: '13:30',
    durationMinutes: 50,
    checklist: ['지문 5개 풀기', '모르는 단어 정리'],
    subjectId: 'english',
    rates: { done: 0.6, late: 0.2, early: 0.05 },
    failCause: 'phone',
    shortfall: 'mindWander',
  },
  {
    key: 'weekend-words',
    title: '영단어 주말 몰아보기',
    goal: 'words',
    repeatDays: [6],
    startTime: '15:30',
    durationMinutes: 40,
    checklist: ['이번 주 100쪽 다시 보기'],
    subjectId: 'english',
    rates: { done: 0.7, late: 0.15, early: 0.05 },
    failCause: 'phone',
    shortfall: 'tired',
  },
  {
    key: 'literature',
    title: '국어 문학 작품 1개',
    repeatDays: [0],
    startTime: '15:00',
    durationMinutes: 40,
    checklist: ['작품 1개 읽기', '표현 3개 정리'],
    subjectId: 'korean',
    rates: { done: 0.6, late: 0.2, early: 0.05 },
    failCause: 'event',
    shortfall: 'mindWander',
  },
  {
    key: 'weekly-check',
    title: '일요일 한 주 점검',
    repeatDays: [0],
    startTime: '20:00',
    durationMinutes: 30,
    checklist: ['이번 주 카드 돌아보기', '다음 주 카드 고치기'],
    subjectId: 'korean',
    rates: { done: 0.75, late: 0.15, early: 0 },
    failCause: 'tooMuch',
    shortfall: 'tooMuch',
  },
]

/** 실험(폰을 다른 방에)을 시작한 뒤 밤 수학 오답의 확률 */
const NIGHT_MATH_AFTER_EXPERIMENT: OutcomeRates = { done: 0.7, late: 0.2, early: 0.07 }

/** 1회성 절대 카드 (과제 제출). 17번째 날에 제때 함 */
const ONE_OFF_CARD: DemoCardSpec & { dayIndex: number } = {
  key: 'science-report',
  title: '과학 수행평가 보고서 제출',
  repeatDays: [],
  startTime: '15:00',
  durationMinutes: 60,
  checklist: ['보고서 마무리', '선생님께 제출'],
  subjectId: 'science',
  absolute: true,
  rates: { done: 1, late: 0, early: 0 },
  shortfall: 'tooMuch',
  dayIndex: 17,
}

/** 일시정지 이유와 그 비율 (폰이 가장 많음 → "폰이 가장 큰 방해" 가설이 맞게) */
const PAUSE_TAGS: { tag: PauseTag; weight: number }[] = [
  { tag: 'phone', weight: 0.45 },
  { tag: 'mindWander', weight: 0.25 },
  { tag: 'toilet', weight: 0.15 },
  { tag: 'snack', weight: 0.1 },
  { tag: 'stuck', weight: 0.05 },
]

const MEMO_TEXTS = [
  '엄마한테 문자 답장하기',
  '수행평가 주제 생각나면 적기',
  '내일 준비물 챙기기',
  '친구한테 노트 빌리기',
]
const PLAY_TAGS: PlayTag[] = ['youtube', 'youtube', 'game', 'sns', 'webtoon']

function pickPauseTag(random: () => number): PauseTag {
  let value = random()
  for (const item of PAUSE_TAGS) {
    if (value < item.weight) return item.tag
    value -= item.weight
  }
  return 'other'
}

// ── 만드는 결과 ──

export interface DemoPersona {
  /** 0번째 날 (오늘의 27일 전) */
  startKey: string
  cards: Card[]
  goals: Goal[]
  fixedBlocks: FixedBlock[]
  /** 공부 기록 + 노는 기록 */
  sessions: StudySession[]
  /** 공부 기록마다의 집중도 (나중에 적은 기록은 타이머로 재지 않아서 없음) */
  focusScores: FocusScoreRecord[]
  /** 알림 화면의 "어제 순공" 메시지 글 (통계 탭과 같은 숫자) */
  yesterdayMessage: string
  /** 홈 화면이 아직 읽는 옛 계획 (카드 하루치마다 하나, 날짜별) */
  plansByDate: Record<string, StudyPlan[]>
  marks: CardDayMarkRecord[]
  restDays: RestDay[]
  checkins: Record<string, CheckIn>
  careStageLog: Record<string, SavedCareStage>
  experiments: Experiment[]
  manualItems: ManualItem[]
  predictions: WeeklyPrediction[]
}

/** 이 카드가 그날 있는지 (반복 카드는 요일, 1회성 카드는 그날만) */
function isOnDay(spec: DemoCardSpec, dayIndex: number, dateKey: string): boolean {
  if (spec.repeatDays.length === 0) return dayIndex === ONE_OFF_CARD.dayIndex
  return spec.repeatDays.includes(getWeekday(dateKey))
}

/** 줄거리에 박아 둔 날들 (그날의 요일을 보고 정합니다) */
interface StoryDays {
  /** 밤 수학 오답을 두 번 연달아 실패한 날 (재발 신호 ①) */
  relapseIndexes: number[]
  /** 주말 모의고사를 놓친 날 (재발 신호 ②) */
  missedMockIndex: number
  /** 아파서 쉰 날 */
  restIndex: number
}

function findStoryDays(startKey: string): StoryDays {
  const dateOf = (index: number) => moveDateKey(startKey, index)
  const indexes = (from: number, to: number, weekdays: number[]) => {
    const found: number[] = []
    for (let index = from; index <= to; index++) {
      if (weekdays.includes(getWeekday(dateOf(index)))) found.push(index)
    }
    return found
  }
  return {
    // 6 ~ 12번째 날의 월·수·금 중 처음 두 번 (실험 시작 전, 실험 기준선 안)
    relapseIndexes: indexes(6, 12, [1, 3, 5]).slice(0, 2),
    missedMockIndex: indexes(18, 24, [6])[0],
    restIndex: indexes(15, 21, [2, 4])[0],
  }
}

/** 줄거리에 박아 둔 "놓친 날" 인지 (재발 신호 ① · ②) */
function isStoryMiss(spec: DemoCardSpec, dayIndex: number, story: StoryDays): boolean {
  return (
    (spec.key === 'night-math' && story.relapseIndexes.includes(dayIndex)) ||
    (spec.key === 'mock-exam' && dayIndex === story.missedMockIndex)
  )
}

/**
 * 카드 하루치의 결과를 정합니다. 줄거리의 날이면 그대로, 아니면 카드의 확률로.
 * missedLastTime: 이 카드를 바로 앞 회차에도 놓쳤는지. 그렇다면 이번엔 놓치지 않고 '중간에 끝냄' 으로 바꿉니다.
 * (같은 카드를 두 번 연달아 놓치면 재발 신호가 나서, 줄거리 밖의 재발 신호가 생기지 않게 하려는 것)
 */
function decideOutcome(
  spec: DemoCardSpec,
  dayIndex: number,
  story: StoryDays,
  missedLastTime: boolean,
): Outcome {
  if (dayIndex === story.restIndex) return 'rest'
  if (isStoryMiss(spec, dayIndex, story)) return spec.key === 'night-math' ? 'failed' : 'unhandled'

  const rates =
    spec.key === 'night-math' && dayIndex >= EXPERIMENT_START_INDEX
      ? NIGHT_MATH_AFTER_EXPERIMENT
      : spec.rates
  let value = createRandom(hashSeed(`${spec.key}|${dayIndex}`))()
  for (const [outcome, rate] of [
    ['done', rates.done],
    ['late', rates.late],
    ['endedEarly', rates.early],
    ['selfReport', rates.selfReport ?? 0],
  ] as const) {
    if (value < rate) return outcome
    value -= rate
  }
  if (missedLastTime) return 'endedEarly'
  return spec.failCause ? 'failed' : 'unhandled'
}

const cardIdOf = (key: string) => `${DEMO_ID_PREFIX}card-${key}`
const planIdOf = (dateKey: string, key: string) => `${DEMO_ID_PREFIX}plan-${dateKey}-${key}`

function toCard(spec: DemoCardSpec, startKey: string, createdAt: number): Card {
  const id = cardIdOf(spec.key)
  const isOneOff = spec.repeatDays.length === 0
  const goalId =
    spec.goal === 'math'
      ? `${DEMO_ID_PREFIX}goal-math`
      : spec.goal === 'words'
        ? `${DEMO_ID_PREFIX}goal-words`
        : undefined
  return {
    id,
    title: spec.title,
    date: isOneOff ? moveDateKey(startKey, ONE_OFF_CARD.dayIndex) : startKey,
    ...(isOneOff ? {} : { repeatDays: spec.repeatDays }),
    startTime: spec.startTime,
    durationMinutes: spec.durationMinutes,
    checklist: spec.checklist.map((text, index) => ({ id: `${id}-item-${index}`, text })),
    ...(goalId ? { goalId } : {}),
    priority: spec.absolute ? 'absolute' : 'flexible',
    type: spec.lecture ? 'lecture' : 'self',
    expectedDone: spec.expectedDone?.count ?? spec.checklist.length,
    ...(spec.expectedDone ? { expectedDoneReason: spec.expectedDone.reason } : {}),
    alert: { method: 'message', minutesBefore: 10 },
    planningMs: 30_000 + (hashSeed(spec.key) % 60) * 1000,
    createdAt,
  }
}

/** 제때·늦게·중간에 끝냄·나중에 적음 하루치의 공부 기록 하나를 만듭니다. */
function buildStudySession(
  spec: DemoCardSpec,
  card: Card,
  dateKey: string,
  dayIndex: number,
  outcome: 'done' | 'late' | 'endedEarly' | 'selfReport',
): StudySession {
  const random = createRandom(hashSeed(`${spec.key}|${dayIndex}|session`))
  const scheduled = atTime(dateKey, spec.startTime)
  const offsetMinutes =
    outcome === 'done'
      ? -3 + Math.floor(random() * 11) // 3분 일찍 ~ 7분 늦게 (10분 안이면 '제때')
      : outcome === 'late'
        ? 12 + Math.floor(random() * 28)
        : outcome === 'endedEarly'
          ? Math.floor(random() * 6)
          : 0
  const startedAt = scheduled + offsetMinutes * MINUTE
  const runFraction =
    outcome === 'endedEarly'
      ? 0.4 + random() * 0.3
      : outcome === 'selfReport'
        ? 1
        : 0.95 + random() * 0.1
  const runMinutes = Math.round(spec.durationMinutes * runFraction)

  // 일시정지: 40분 넘는 카드에서 0 ~ 2번. 첫 번째는 공부 20 ~ 45분째
  const pauses: SessionPause[] = []
  if (spec.durationMinutes >= 40 && outcome !== 'selfReport') {
    const roll = random()
    const count = roll < 0.35 ? 0 : roll < 0.8 ? 1 : 2
    let studiedBefore = 20 + Math.floor(random() * 25)
    let pausedSoFar = 0
    for (let index = 0; index < count && studiedBefore < runMinutes; index++) {
      const length = 2 + Math.floor(random() * 6)
      const pauseStart = startedAt + (studiedBefore + pausedSoFar) * MINUTE
      pauses.push({
        startedAt: pauseStart,
        endedAt: pauseStart + length * MINUTE,
        tag: pickPauseTag(random),
      })
      pausedSoFar += length
      studiedBefore += 10 + Math.floor(random() * 15)
    }
  }
  const { pauseCount, pausedMs } = summarizePauses(pauses)
  const endedAt = startedAt + runMinutes * MINUTE + pausedMs

  // 체크리스트: 제때 → 보통 개수, 늦게 → 하나 덜, 중간에 끝냄 → 1개, 나중에 적음 → 하나 덜
  const total = card.checklist.length
  const usual = spec.usualChecked ?? total
  const checkedCount =
    outcome === 'done' ? usual : outcome === 'endedEarly' ? 1 : Math.max(1, usual - 1)
  const checked: Record<string, number> = {}
  card.checklist.slice(0, checkedCount).forEach((item, index) => {
    checked[item.id] = endedAt - (checkedCount - index) * 30_000
  })
  const endReport: SessionEndReport = {
    checked,
    ...(checkedCount < total ? { shortfallReason: spec.shortfall } : {}),
    withWhat: random() < 0.3 ? 'music' : 'none',
    ...(checkedCount === total && random() < 0.4
      ? { goodReasons: [random() < 0.5 ? 'focus' : 'goodPlan'] }
      : {}),
    ...(spec.key === 'mock-exam'
      ? { proof: { summary: '모의고사 1회 · 76점, 틀린 문제 6개 표시' } }
      : {}),
  }
  const memoRoll = random()

  return {
    id: `${DEMO_ID_PREFIX}session-${dateKey}-${spec.key}`,
    subjectId: spec.subjectId,
    startedAt,
    endedAt,
    pauseCount,
    pausedMs,
    planId: planIdOf(dateKey, spec.key),
    targetMinutes: spec.durationMinutes,
    kind: 'study',
    cardId: card.id,
    mode: outcome === 'selfReport' ? 'selfReport' : 'normal',
    ...(pauses.length > 0 ? { pauses } : {}),
    ...(outcome === 'endedEarly' ? { endedEarly: true } : {}),
    endReport,
    ...(memoRoll < 0.2
      ? { memos: [{ at: startedAt + 10 * MINUTE, text: pick(MEMO_TEXTS, random) }] }
      : {}),
  }
}

/**
 * 공부 기록 하나의 집중도 (lib/focusScore.ts 와 같은 모양). 폰을 든 시간의 비율을 카드마다 정한 범위에서 고릅니다.
 *   실험(폰을 다른 방에) 전의 밤 수학 오답 → 12 ~ 30% (폰을 자주 듦)
 *   실험 뒤의 밤 수학 오답               → 0 ~ 6%
 *   나머지 카드                         → 2 ~ 14%
 */
function buildFocusScore(
  session: StudySession,
  specKey: string,
  dayIndex: number,
): FocusScoreRecord {
  const random = createRandom(hashSeed(`${specKey}|${dayIndex}|focus`))
  const runMs = session.endedAt - session.startedAt - (session.pausedMs ?? 0)
  const isNightMath = specKey === 'night-math'
  const ratio =
    isNightMath && dayIndex < EXPERIMENT_START_INDEX
      ? 0.12 + random() * 0.18
      : isNightMath
        ? random() * 0.06
        : 0.02 + random() * 0.12
  // 초 단위로 맞춥니다.
  const distractedMs = Math.round((runMs * ratio) / 1000) * 1000
  return {
    sessionId: session.id,
    startedAt: session.startedAt,
    score: Math.round(((runMs - distractedMs) / runMs) * 100),
    runMs,
    distractedMs,
    measuredBy: 'lift',
    // 폰을 든 횟수: 들었으면 1 ~ 4번
    count: distractedMs === 0 ? 0 : 1 + Math.floor(random() * 4),
    // 든 시간 중 앱 밖에 나가 있던 시간 (근거 글에만 씀)
    outsideMs: Math.round((distractedMs * random() * 0.5) / 1000) * 1000,
  }
}

/**
 * 알림 화면의 "어제 순공" 한 줄. 통계 탭 · 통화 요약과 같은 계산(getDaySummary)이라 숫자가 같습니다.
 * (예전에는 '어제 순공 3시간 10분, 계획의 80%' 로 박혀 있어서 통계 탭과 숫자가 달랐습니다)
 *   -> '어제 순공 1시간 43분, 계획의 85%야. 폰은 다른 방에 두기 15일째!'
 */
function buildYesterdayMessage(
  todayKey: string,
  plansByDate: Record<string, StudyPlan[]>,
  sessions: StudySession[],
): string {
  const yesterday = moveDateKey(todayKey, -1)
  const { studyMinutes, achievementRate } = getDaySummary(
    yesterday,
    plansByDate[yesterday] ?? [],
    sessions,
  )
  // 실험은 EXPERIMENT_START_INDEX 번째 날에 시작했고, 오늘은 DEMO_DAYS - 1 번째 날입니다.
  const experimentLine = ` 폰은 다른 방에 두기 ${DEMO_DAYS - EXPERIMENT_START_INDEX}일째!`
  if (studyMinutes === 0) return `어제는 쉬어 가는 날이었지.${experimentLine}`
  const rateText = achievementRate === null ? '' : `, 계획의 ${achievementRate}%`
  return `어제 순공 ${formatMinutes(studyMinutes)}${rateText}야.${experimentLine}`
}

/** 실패 원인 → 체크인의 "어제 못 한 이유" (미루기는 '하기 싫음' 으로) */
function toMissReason(cause: CardFailCause): MissReason {
  return cause === 'procrastinated' ? 'unwilling' : cause
}

/** 그날 기분 · 컨디션에 맞는 감정 태그 */
function emotionsFor(condition: number, random: () => number): EmotionTag[] {
  if (condition <= 2) return ['TIRED', 'ANXIOUS']
  if (condition === 3) return [random() < 0.5 ? 'CALM' : 'STUCK']
  return [random() < 0.6 ? 'MOTIVATED' : 'CALM']
}

/** 예측 보기 중에서 target 에 가장 가까운 값 (사람들이 자기를 조금 낙관하는 모습을 넣으려고 씁니다) */
function nearestOption(kind: PredictionKind, target: number): number {
  const values = PREDICTION_OPTIONS[kind].values
  return values.reduce((best, value) =>
    Math.abs(value - target) < Math.abs(best - target) ? value : best,
  )
}

/** 실행률 평균 (0 ~ 100 정수). 하루치가 없으면 0 */
function averagePercent(rates: number[]): number {
  if (rates.length === 0) return 0
  return Math.round((rates.reduce((sum, rate) => sum + rate, 0) / rates.length) * 100)
}

/**
 * 가상 사용자의 28일을 만듭니다. todayKey 는 오늘(새벽 4시 기준), now 는 지금 시각입니다.
 * 오늘 카드 중 아직 시간이 안 끝난 것은 기록을 넣지 않습니다. (아직 오지 않은 시각의 기록이 생기면 안 되므로)
 */
export function buildDemoPersona(todayKey: string, now: number): DemoPersona {
  const startKey = moveDateKey(todayKey, -(DEMO_DAYS - 1))
  const dateOf = (index: number) => moveDateKey(startKey, index)
  // 카드 · 목표는 0번째 날 전날 밤에 만든 것으로 둡니다. (달력은 카드를 만든 날 전은 비워 두기 때문)
  const createdAt = atTime(moveDateKey(startKey, -1), '21:00')
  const story = findStoryDays(startKey)
  const specs = [...DEMO_CARDS, ONE_OFF_CARD]
  const cards = specs.map((spec) => toCard(spec, startKey, createdAt))

  const sessions: StudySession[] = []
  const focusScores: FocusScoreRecord[] = []
  const plansByDate: Record<string, StudyPlan[]> = {}
  const marks: CardDayMarkRecord[] = []
  /** 날짜 → 그날 실패로 적은 원인들 (다음 날 체크인의 "어제 못 한 이유") */
  const failCausesByDay: Record<number, CardFailCause[]> = {}
  /** 카드 → 바로 앞 회차를 놓쳤는지 (쉰 날은 회차로 치지 않음) */
  const missedLastTime: Record<string, boolean> = {}

  for (let dayIndex = 0; dayIndex < DEMO_DAYS; dayIndex++) {
    const dateKey = dateOf(dayIndex)
    specs.forEach((spec, specIndex) => {
      if (!isOnDay(spec, dayIndex, dateKey)) return
      const card = cards[specIndex]
      const cardEnd = atTime(dateKey, spec.startTime) + spec.durationMinutes * MINUTE
      // 오늘 카드 중 아직 끝나지 않은 카드는 결과를 만들지 않습니다.
      const isPending = cardEnd + 30 * MINUTE > now
      const outcome: Outcome | 'pending' = isPending
        ? 'pending'
        : decideOutcome(spec, dayIndex, story, missedLastTime[spec.key] ?? false)
      if (outcome !== 'pending' && outcome !== 'rest') {
        missedLastTime[spec.key] = outcome === 'failed' || outcome === 'unhandled'
      }
      const didIt =
        outcome === 'done' ||
        outcome === 'late' ||
        outcome === 'endedEarly' ||
        outcome === 'selfReport'

      plansByDate[dateKey] = [
        ...(plansByDate[dateKey] ?? []),
        {
          id: planIdOf(dateKey, spec.key),
          date: dateKey,
          subjectId: spec.subjectId,
          content: spec.title,
          targetMinutes: spec.durationMinutes,
          done: didIt && outcome !== 'endedEarly',
          startTime: spec.startTime,
          kind: 'study',
        },
      ]
      if (didIt) {
        const session = buildStudySession(spec, card, dateKey, dayIndex, outcome)
        sessions.push(session)
        // 나중에 적은 기록(selfReport)은 타이머로 재지 않아서 집중도가 없습니다.
        if (outcome !== 'selfReport') focusScores.push(buildFocusScore(session, spec.key, dayIndex))
      }
      if (outcome === 'failed') {
        const random = createRandom(hashSeed(`${spec.key}|${dayIndex}|cause`))
        // 재발 신호 ① 의 두 번째 실패는 폰 때문. 나머지도 45% 는 폰 (폰이 가장 큰 방해가 되게)
        const cause: CardFailCause =
          dayIndex === story.relapseIndexes[1] || random() < 0.45
            ? 'phone'
            : (spec.failCause ?? 'tired')
        marks.push({ cardId: card.id, dateKey, mark: 'failed', at: cardEnd + 60 * MINUTE, cause })
        failCausesByDay[dayIndex] = [...(failCausesByDay[dayIndex] ?? []), cause]
      }
    })

    // 노는 기록: 열흘에 네 번쯤, 밤 10시 40분 무렵 (오늘은 빼고)
    const playRandom = createRandom(hashSeed(`play|${dayIndex}`))
    if (dayIndex < DEMO_DAYS - 1 && playRandom() < 0.4) {
      const startedAt = atTime(dateKey, '22:40') + Math.floor(playRandom() * 20) * MINUTE
      sessions.push({
        id: `${DEMO_ID_PREFIX}play-${dateKey}`,
        subjectId: '',
        startedAt,
        endedAt: startedAt + (15 + Math.floor(playRandom() * 30)) * MINUTE,
        pauseCount: 0,
        kind: 'play',
        playTag: pick(PLAY_TAGS, playRandom),
      })
    }
  }

  const restDays: RestDay[] = [
    { date: dateOf(story.restIndex), reason: 'sick', at: atTime(dateOf(story.restIndex), '08:00') },
  ]

  // ── 체크인 (1탭). 오늘은 비워서 시연 때 코치의 컨디션 칩으로 직접 고르게 합니다. 사흘은 깜빡한 날 ──
  const checkins: Record<string, CheckIn> = {}
  for (let dayIndex = 0; dayIndex < DEMO_DAYS - 1; dayIndex++) {
    if ([4, 11, 23].includes(dayIndex)) continue
    const dateKey = dateOf(dayIndex)
    const random = createRandom(hashSeed(`checkin|${dayIndex}`))
    const isHardDay = dayIndex === story.restIndex || story.relapseIndexes.includes(dayIndex)
    const condition = isHardDay ? 2 : random() < 0.25 ? 3 : random() < 0.8 ? 4 : 5
    const yesterdayCauses = failCausesByDay[dayIndex - 1] ?? []
    checkins[dateKey] = {
      date: dateKey,
      condition,
      emotions: emotionsFor(condition, random),
      mood: isHardDay ? 2 : Math.max(3, condition - (random() < 0.3 ? 1 : 0)),
      ...(yesterdayCauses.length > 0 ? { missReason: toMissReason(yesterdayCauses[0]) } : {}),
    }
  }

  // ── 관리 단계 기록 (홈과 타이머가 가장 최근 것을 읽습니다) ──
  const careStageLog: Record<string, SavedCareStage> = {}
  const logStage = (dayIndex: number | undefined, stage: SavedCareStage) => {
    if (dayIndex !== undefined && dayIndex < DEMO_DAYS) careStageLog[dateOf(dayIndex)] = stage
  }
  const afterRelapse = story.relapseIndexes[1] + 1
  logStage(0, {
    stage: 1,
    rule: 'toBase',
    reason: '처음 2주는 심리검사로 본 성향에 맞춰 칭찬부터 시작해요',
  })
  logStage(afterRelapse, {
    stage: 2,
    rule: 'up',
    reason: '밤 수학 오답 카드를 두 번 연달아 못 했어요. 학원 끝난 밤을 한 번 더 챙길게요',
  })
  logStage(EXPERIMENT_START_INDEX, {
    stage: 1,
    rule: 'toBase',
    reason: '폰을 다른 방에 두는 실험을 시작했어요. 다시 칭찬 단계로 돌아가요',
  })
  logStage(story.restIndex, {
    stage: 0,
    rule: 'recovery',
    reason: '아파서 쉬는 날로 처리했어요. 오늘은 회복만 해요',
  })
  logStage(story.restIndex + 1, {
    stage: 1,
    rule: 'toBase',
    reason: '쉬고 나서 부담 없이 다시 시작해요',
  })
  logStage(story.missedMockIndex + 1, {
    stage: 3,
    rule: 'up',
    reason: '꼭 하기로 한 주말 모의고사를 놓쳤어요. 이번 주는 조금 더 단단하게 챙길게요',
  })
  // 놓친 날의 4일 뒤 (오늘을 넘으면 오늘)
  logStage(Math.min(story.missedMockIndex + 4, DEMO_DAYS - 1), {
    stage: 2,
    rule: 'toBase',
    reason: '다시 카드를 제때 시작해서 한 단계 내려왔어요',
  })

  // ── 목표 2개 ──
  const goals: Goal[] = [
    {
      id: `${DEMO_ID_PREFIX}goal-math`,
      kind: 'score',
      title: '11월 학평 수학 3등급',
      dDay: moveDateKey(todayKey, 33),
      currentScore: '5등급',
      benefit: '원하는 반에 들어갈 수 있어요',
      cost: '겨울방학에 수학을 처음부터 다시 해야 해요',
      obstacle: '학원 다녀오면 피곤하다고 미뤄요',
      plan: '학원 끝나면 씻기 전에 오답 1개부터 펴요',
      status: 'active',
      // 처음엔 2등급이었다가 고침 (원래 목표값을 지우지 않고 남김, 3·7번 오류 대응)
      history: [
        {
          title: '11월 학평 수학 2등급',
          dDay: moveDateKey(todayKey, 33),
          currentScore: '5등급',
          changedAt: atTime(dateOf(10), '22:00'),
          reason: '2주 해 보니 한 번에 세 등급은 무리라서 한 단계 낮췄어요',
        },
      ],
      createdAt,
    },
    {
      id: `${DEMO_ID_PREFIX}goal-words`,
      kind: 'completion',
      title: '기말 전 영단어장 1회독',
      dDay: moveDateKey(todayKey, 20),
      totalAmount: 300,
      amountUnit: '쪽',
      benefit: '내신 영어 단어 문제를 다 맞힐 수 있어요',
      cost: '기말 직전에 몰아서 외우게 돼요',
      obstacle: '폰을 자꾸 보게 돼요',
      plan: '폰을 다른 방에 두고 시작해요',
      status: 'active',
      history: [],
      createdAt,
    },
  ]

  const fixedBlocks: FixedBlock[] = [
    {
      id: `${DEMO_ID_PREFIX}block-academy`,
      title: '수학 학원',
      repeatDays: [1, 3, 5],
      startTime: '18:00',
      endTime: '21:30',
      createdAt,
    },
  ]

  // ── 실험 판정 · 사용설명서: 화면과 같은 판정 함수로 계산해서 숫자를 맞춥니다 ──
  const getMark = (cardId: string, dateKey: string) =>
    getCardDayMarkInfo(cardId, dateKey, restDays, marks)
  const judgedDays = buildJudgedCardDays(cards, sessions, startKey, todayKey, now, getMark)
  const experimentBase = {
    id: `${DEMO_ID_PREFIX}experiment-phone-room`,
    hypothesis: '밤 카드 전에 폰을 다른 방에 두면 학원 끝나고도 시작할 수 있다',
    cause: 'phone' as const,
    strategyId: 'phone-room',
    cardIds: [cardIdOf('night-math')],
    startDate: dateOf(EXPERIMENT_START_INDEX),
    minGainPp: 10,
  }
  const judged = judgeExperiment(experimentBase, judgedDays)
  const experiments: Experiment[] = [
    {
      ...experimentBase,
      status: judged.status,
      ...(judged.baselineRate !== null ? { baselineRate: judged.baselineRate } : {}),
      ...(judged.experimentRate !== null ? { experimentRate: judged.experimentRate } : {}),
    },
  ]

  const pastDays = judgedDays.filter((day) => day.dateKey < todayKey && day.result !== 'rest')
  const startTimeOf = (cardId: string) =>
    cards.find((card) => card.id === cardId)?.startTime ?? '12:00'
  const morningRate = averagePercent(
    pastDays.filter((day) => startTimeOf(day.cardId) < '12:00').map((day) => day.runRate),
  )
  const nightRate = averagePercent(
    pastDays.filter((day) => startTimeOf(day.cardId) >= '18:00').map((day) => day.runRate),
  )
  const academyNightDays = pastDays.filter(
    (day) => day.cardId === cardIdOf('night-math') && day.dateKey < dateOf(EXPERIMENT_START_INDEX),
  )
  // 못 했거나 중간에 끝낸 날
  const academyNightMissed = academyNightDays.filter(
    (day) => day.result === 'failed' || day.result === 'unhandled' || day.result === 'endedEarly',
  ).length
  const manualItems: ManualItem[] = [
    {
      id: `${DEMO_ID_PREFIX}manual-rhythm`,
      category: 'rhythm',
      title: '밤보다 아침에 더 잘 해요',
      confirmedDate: dateOf(DEMO_DAYS - 8),
      evidence: `아침 카드 실행률 ${morningRate}% · 밤 카드 ${nightRate}% (최근 3주)`,
    },
    {
      id: `${DEMO_ID_PREFIX}manual-caution`,
      category: 'cautionDay',
      title: '학원 있는 날 밤에는 카드를 자주 놓쳐요',
      confirmedDate: dateOf(EXPERIMENT_START_INDEX),
      evidence: `첫 2주 학원 날(월·수·금) 밤 수학 오답 ${academyNightDays.length}번 중 ${academyNightMissed}번 못 하거나 중간에 끝냄`,
    },
  ]
  if (
    judged.status === 'effective' &&
    judged.baselineRate !== null &&
    judged.experimentRate !== null
  ) {
    manualItems.push({
      id: `${DEMO_ID_PREFIX}manual-phone-room`,
      category: 'effectiveMethod',
      title: '밤 카드 전에 폰을 다른 방에 두기',
      confirmedDate: todayKey,
      evidence: `2주 실험: 밤 수학 오답 실행률 ${Math.round(judged.baselineRate * 100)}% → ${Math.round(judged.experimentRate * 100)}%`,
    })
  }

  // ── 지난 주들의 예측 (이번 주 예측은 시연 때 직접 하도록 비워 둡니다) ──
  const currentMonday = moveDateKey(todayKey, -((getWeekday(todayKey) + 6) % 7))
  const predictions: WeeklyPrediction[] = []
  // 지난주 월요일부터 0번째 날이 든 주까지 거꾸로 갑니다.
  const firstMonday = moveDateKey(startKey, -((getWeekday(startKey) + 6) % 7))
  for (
    let monday = moveDateKey(currentMonday, -7);
    monday >= firstMonday;
    monday = moveDateKey(monday, -7)
  ) {
    const numbers = getWeeklyNumbers(getWeekCardDays(cards, sessions, monday, now))
    const kind = pickPredictionKind(monday, getAvailableKinds(numbers))
    const actual = kind ? getActualValue(kind, numbers) : null
    // 다음 주 월요일 밤에 예측했다고 둡니다. (지금보다 미래가 되지 않게)
    const answeredAt = Math.min(now, atTime(moveDateKey(monday, 7), '21:00'))
    if (kind && actual !== null) {
      // 예측은 실제보다 조금 낙관적으로 (계획 오류) — 시작 지연은 실제보다 짧게 봄
      const optimistic = kind === 'startDelay' ? actual - 10 : actual + 20
      const predicted = nearestOption(kind, optimistic)
      predictions.push({
        weekStart: monday,
        kind,
        predicted,
        actual,
        diff: getPredictionDiff(predicted, actual),
        answeredAt,
      })
    }
  }

  return {
    startKey,
    cards,
    goals,
    fixedBlocks,
    sessions,
    focusScores,
    yesterdayMessage: buildYesterdayMessage(todayKey, plansByDate, sessions),
    plansByDate,
    marks,
    restDays,
    checkins,
    careStageLog,
    experiments,
    manualItems,
    predictions,
  }
}

/** 심리검사 35문항의 답 (시작 저항 · 주의 분산 · 계획 낙관이 높은 편, 기록 부담은 낮은 편) */
const DEMO_PSYCH_ANSWERS: Record<string, number> = {
  ...answersFor('S', [6, 5, 6, 5, 6]),
  ...answersFor('A', [5, 6, 5, 6, 6]),
  ...answersFor('P', [6, 5, 6, 6, 5]),
  ...answersFor('R', [3, 2, 3, 2, 3]),
  ...answersFor('F', [4, 5, 4, 4, 5]),
  ...answersFor('E', [3, 3, 2, 3, 3]),
  ...answersFor('C', [4, 5, 4, 5, 4]),
}

/** 'S' 와 [6, 5, …] → { S1: 6, S2: 5, … } (심리검사 문항 코드는 척도 글자 + 번호) */
function answersFor(letter: string, values: number[]): Record<string, number> {
  return Object.fromEntries(values.map((value, index) => [`${letter}${index + 1}`, value]))
}

/**
 * 온보딩을 끝낸 상태로 만드는 값들 (저장 키 → 값). lib/demoData.ts 는 비어 있는 키에만 넣습니다.
 * 키와 모양은 lib/onboardingProgress.ts 의 STAGES 가 보는 것과 같습니다.
 */
export function buildDemoOnboarding(startKey: string, todayKey: string): Record<string, unknown> {
  const doneAt = atTime(startKey, '07:00') - 12 * 60 * MINUTE
  return {
    'onboarding-intro-seen': true,
    'onboarding-answers': {
      grade: '고2',
      sleepTime: '00:30',
      wakeUpTime: '06:20',
      targetExam: '11월 학평',
      targetExamDate: moveDateKey(todayKey, 33),
      motivationReason: '원하는 반에 들어가려고',
    },
    'psych-test': {
      answers: DEMO_PSYCH_ANSWERS,
      scores: scorePsychTest(DEMO_PSYCH_ANSWERS),
      takenAt: doneAt,
    },
    'onboarding-care-consent': doneAt,
    'onboarding-result-seen': true,
    // 관리 단계 3 까지 보이도록 한도 3 (온보딩이 제안하는 값과 같음)
    'care-limits': {
      maxCareLevel: 3,
      maxHarshness: 2,
      allowOffHoursCall: false,
      allowFocusMode: false,
      pendingMaxCareLevel: null,
      pendingMaxHarshness: null,
      pendingEffectiveDate: null,
    },
    'call-time': '21:00',
  }
}
