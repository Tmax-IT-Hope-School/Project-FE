/**
 * AI 통화를 시작할 때 서버에 같이 보내는 "학생 카드" 를 만듭니다. React 없이 돌아가는 계산입니다.
 *
 * 통화는 쌓인 기록을 보고 질문과 말투가 달라져야 합니다. 그런데 기록이 아직 이 브라우저에만 있어서,
 * 여기서 숫자로 정리해 한 장으로 보냅니다. 서버는 이 카드로 AI 의 지침(대본)을 만듭니다.
 * (서버의 약속: BE 저장소의 docs/API.md "AI 통화", BE 이슈 #27 · #28)
 *
 * ■ "지난 통화 이후" 칸 (#414, 최종 기획서 「4.5」 통화 대본)
 *   대본이 아침이든 밤이든 같은 구조가 되도록, 결산은 '어제' 가 아니라 '지난 통화 이후' 의 카드로 합니다.
 *   (결산 → 처리 안 된 카드 → 다음 통화까지의 카드 → 조건부 모듈 1개 → 마무리)
 *   어제 순공 · 스트릭 같은 옛 칸은 서버 대본(BE#28)이 새 칸으로 바뀔 때까지 같이 보냅니다. 바뀐 뒤 지웁니다.
 *
 * ⚠️ 카드에는 숫자와 정해진 분류값만 담습니다. 계획 내용·일기·이름·약속 문장 같은 "내가 쓴 글" 은 넣지 않습니다.
 *    글은 AI 회사(OpenAI)로 그대로 넘어가기 때문입니다. 새 값을 더할 때도 이 원칙을 지켜 주세요.
 */
import { loadAwayRecords } from '@/lib/away'
import { getAwaySummary } from '@/lib/awaySummary'
import { loadCallLog } from '@/lib/callLog'
import {
  MODULE_COUNT_DAYS,
  PREDICT_REVEAL_EVERY_DAYS,
  countRecentModule,
  pickCallModule,
  type CallModule,
  type CallModuleConditions,
} from '@/lib/callModules'
import { buildJudgedCardDays } from '@/lib/cardDays'
import { loadCardMarks, type CardFailCause } from '@/lib/cardMarks'
import { isMissResult } from '@/lib/cardResult'
import { getCardsOnDate, loadSavedCards } from '@/lib/cards'
import { loadLatestCareStage } from '@/lib/careStage'
import { loadAllSessions, loadStudySessions } from '@/lib/dailyRecords'
import { getTodayKey, moveDateKey, toDayKey } from '@/lib/date'
import { getDaySummary } from '@/lib/daySummary'
import { loadExamDates, loadSavedWritings } from '@/lib/diarySafety'
import { getFacts, getPlannedStartAt } from '@/lib/facts'
import { loadUnlockRecords, type FocusUnlockRecord } from '@/lib/focusMode'
import { isGoalCheckDue } from '@/lib/goalProgress'
import { loadGoals } from '@/lib/goals'
import { getMissReasons, getRelapseSignal, type JudgedCardDay } from '@/lib/relapseSignal'
import { getCardDayMarkInfo, loadRestDays } from '@/lib/restDays'
import { getSafetyBrakeResult } from '@/lib/safetyBrake'
import { loadAutoSettings } from '@/lib/settingsMapping'
import { loadRecord } from '@/lib/storage'
import { MIN_COMPLETION_SAMPLES, getMondayKey } from '@/lib/weeklyFacts'
import type {
  AwayRecord,
  Card,
  CheckIn,
  EmotionTag,
  MissReason,
  StudyPlan,
  StudySession,
} from '@/types'

/**
 * 학생 카드의 "지난 통화 이후" 칸 (#414). 서버 CallSessionRequest.Card 에 같은 이름으로 더합니다.
 * 숫자와 정해진 분류값만 담습니다. (카드 제목 같은 글은 넣지 않습니다)
 */
export interface SinceLastCallFields {
  /** 지난 통화가 끝난 뒤 몇 시간 지났는지. 통화한 적이 없으면 null → 최근 24시간을 봅니다 */
  hoursSinceLastCall: number | null
  /** 지난 통화 이후 실행한 카드 수 (제때 · 늦게 · 중간에 끝냄 · 나중에 적음) */
  doneCardCount: number
  /** 실행한 카드의 평균 실행률 (0 ~ 100). 실행한 카드가 없으면 null */
  cardRunRate: number | null
  /** 미루거나 못 한 카드 수 (아직 정리 안 한 카드 포함) */
  missedCardCount: number
  /** 그중 아직 미루기 · 실패를 고르지 않은 카드 수 — 통화에서 원인을 묻고, 나눌지 · 휴식으로 할지 정합니다 */
  unhandledCardCount: number
  /** 미실행 원인 중 가장 많은 것 (CardFailCause 글자: MissReason + 'procrastinated' 미루다 보니). 없으면 null */
  mainMissCause: CardFailCause | null
  /** 다음 통화까지(앞으로 24시간) 할 카드 수 */
  nextCardCount: number
  /** 그중 절대(미룰 수 없는) 카드 수 */
  nextAbsoluteCardCount: number
  /** 오늘 감정 태그를 안 골랐으면 true — 결산 전에 묻습니다 */
  emotionTagsMissing: boolean
  /** 이번 통화에 넣을 조건부 모듈 (lib/callModules.ts 의 우선순위). 없으면 null */
  callModule: CallModule | null
}

/** 서버에 보내는 학생 카드. 모르는 값은 null 입니다. (0 과 "모름" 은 다릅니다) */
export interface CallCard extends Partial<SinceLastCallFields> {
  /** 어제의 순공시간 (분) */
  yesterdayStudyMinutes: number | null
  /** 어제 계획의 목표 시간 합계 (분). 계획이 없었으면 0 */
  yesterdayPlanMinutes: number | null
  /** 어제 계획을 못 채운 이유로 오늘 체크인에서 고른 것. 안 골랐으면 null */
  yesterdayMissReason: MissReason | null
  /** 오늘 계획의 개수 */
  todayPlanCount: number | null
  /** 오늘 계획의 목표 시간 합계 (분) */
  todayPlanMinutes: number | null
  /** 오늘 첫 계획의 시작 시각 'HH:MM'. 시각을 정한 계획이 없으면 null */
  todayFirstStart: string | null
  /** 이번 주 계획 대비 실제 (%) */
  weekPlanRate: number | null
  /** 이번 주 완주율 (%). 목표가 있는 타이머가 5번 미만이면 숫자가 크게 흔들려서 보내지 않습니다(null) */
  weekCompletionRate: number | null
  /** 이번 주 평균 시작 지연 (분) */
  weekStartDelayMinutes: number | null
  /** 최근 7일의 기분 (1 ~ 5). 오래된 날부터 */
  recentMoods: number[]
  /** 어제 공부하다가 다른 탭·앱으로 나갔다 온 횟수 (딴짓 감지) */
  yesterdayAwayCount: number | null
  /** 어제 가장 자주 나간 시간대 (0 ~ 23시). 나간 적이 없으면 null */
  yesterdayAwayPeakHour: number | null
  /** 어제 집중 모드를 스스로 푼 횟수 (저절로 풀린 것은 세지 않습니다) */
  yesterdayUnlockCount: number | null
}

/** 공부하다 나간 기록과 집중 모드를 푼 기록입니다. 학생 카드에는 어제의 "횟수" 만 들어갑니다. */
export interface FocusRecords {
  awayRecords: AwayRecord[]
  unlockRecords: FocusUnlockRecord[]
}

// 서버가 받는 범위입니다. 저장된 값이 깨져서 범위를 벗어나면 통화 자체가 400 으로 막히기 때문에, 보내기 전에 맞춥니다.
const MAX_MINUTES_PER_DAY = 1440
const MAX_START_DELAY_MINUTES = 600
const MAX_PLAN_COUNT = 50
const MAX_AWAY_COUNT = 200
const MAX_UNLOCK_COUNT = 50
const MOOD_DAYS = 7

/** 숫자를 정수로 만들고 min ~ max 안으로 맞춥니다. 숫자가 아니면 null 입니다. */
function clampOrNull(value: number | null, min: number, max: number): number | null {
  if (value === null || !Number.isFinite(value)) return null
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** 'HH:MM' 모양(00:00 ~ 23:59)인지 확인합니다. */
function isClockTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

/**
 * 계획·공부 기록·체크인으로 학생 카드를 만듭니다. 기록이 하나도 없으면 null 입니다. (처음 온 사람)
 *
 * ■ 예시 — 오늘이 2026-10-07(수)
 *   어제(10/06) 계획 240분, 순공 190분 · 오늘 체크인에서 못 채운 이유로 '폰·SNS' 를 고름
 *   오늘 계획 3개(합쳐서 180분, 가장 이른 시작 19:00) · 최근 기분 3, 2, 4
 *   -> { yesterdayStudyMinutes: 190, yesterdayPlanMinutes: 240, yesterdayMissReason: 'phone',
 *        todayPlanCount: 3, todayPlanMinutes: 180, todayFirstStart: '19:00',
 *        weekPlanRate: (이번 주 월 ~ 오늘 계산), weekCompletionRate: (타이머 5번 미만이면 null), weekStartDelayMinutes: …,
 *        recentMoods: [3, 2, 4],
 *        yesterdayAwayCount: 3, yesterdayAwayPeakHour: 21, yesterdayUnlockCount: 1 }
 *     (어제 공부하다 3번 나갔고 그중 2번이 밤 9시대 · 집중 모드를 스스로 1번 풂)
 *
 * ■ 규칙
 *  - "오늘·어제" 는 하루의 기준(새벽 4시, lib/date.ts)을 따릅니다. todayKey 로 받습니다.
 *  - 노는 계획·노는 기록은 세지 않습니다. (getDaySummary · getFacts 와 같은 규칙)
 *  - 이번 주 숫자는 월요일부터 오늘까지로 계산합니다. (주간 리포트와 같은 규칙)
 *  - 나간 기록·집중 모드를 푼 기록은 어제 것의 횟수와 시간대만 넣습니다. 풀 때 적은 이유(내가 쓴 글)는 넣지 않습니다.
 *    (세는 방법은 주간 리포트의 "집중 기록" 카드와 같습니다. lib/awaySummary.ts)
 */
export function buildCallCard(
  plans: StudyPlan[],
  sessions: StudySession[],
  checkIns: Record<string, CheckIn>,
  focusRecords: FocusRecords,
  todayKey: string = getTodayKey(),
  now: Date = new Date(),
): CallCard | null {
  const checkInDates = Object.keys(checkIns)
  if (plans.length === 0 && sessions.length === 0 && checkInDates.length === 0) return null

  const yesterdayKey = moveDateKey(todayKey, -1)
  const yesterday = getDaySummary(yesterdayKey, plans, sessions)
  const yesterdayPlans = plans.filter((plan) => plan.date === yesterdayKey && plan.kind !== 'play')
  const todayPlans = plans.filter((plan) => plan.date === todayKey && plan.kind !== 'play')

  // 오늘 계획 중 시작 시각을 정한 것만 골라 가장 이른 시각을 찾습니다. 'HH:MM' 은 글자 순서가 곧 시간 순서입니다.
  const startTimes = todayPlans
    .map((plan) => plan.startTime)
    .filter(isClockTime)
    .sort()

  const week = getFacts(plans, sessions, getMondayKey(now), todayKey)
  // 어제 하루의 나간 횟수 · 가장 자주 나간 시간대 · 집중 모드를 푼 횟수
  const yesterdayFocus = getAwaySummary(
    focusRecords.awayRecords,
    focusRecords.unlockRecords,
    yesterdayKey,
    yesterdayKey,
  )

  // 최근 7일 안에 체크인한 날의 기분을 오래된 날부터 모읍니다.
  const oldestMoodDate = moveDateKey(todayKey, -(MOOD_DAYS - 1))
  const recentMoods = checkInDates
    .filter((date) => date >= oldestMoodDate && date <= todayKey)
    .sort()
    .map((date) => checkIns[date].mood)
    .filter((mood) => Number.isInteger(mood) && mood >= 1 && mood <= 5)

  const sumMinutes = (items: StudyPlan[]) =>
    items.reduce(
      (sum, plan) => sum + (Number.isFinite(plan.targetMinutes) ? plan.targetMinutes : 0),
      0,
    )

  return {
    yesterdayStudyMinutes: clampOrNull(yesterday.studyMinutes, 0, MAX_MINUTES_PER_DAY),
    yesterdayPlanMinutes: clampOrNull(sumMinutes(yesterdayPlans), 0, MAX_MINUTES_PER_DAY),
    yesterdayMissReason: checkIns[todayKey]?.missReason ?? null,
    todayPlanCount: clampOrNull(todayPlans.length, 0, MAX_PLAN_COUNT),
    todayPlanMinutes: clampOrNull(sumMinutes(todayPlans), 0, MAX_MINUTES_PER_DAY),
    todayFirstStart: startTimes[0] ?? null,
    weekPlanRate: clampOrNull(week.planRate.value, 0, 100),
    weekCompletionRate:
      week.completionRate.sampleCount >= MIN_COMPLETION_SAMPLES
        ? clampOrNull(week.completionRate.value, 0, 100)
        : null,
    weekStartDelayMinutes: clampOrNull(week.startDelayMinutes.value, 0, MAX_START_DELAY_MINUTES),
    recentMoods,
    // 연속 공부 일수(streakDays)는 보내지 않습니다. 기획서가 스트릭을 지웠습니다(「4.6」 "스트릭 대신 4주 실행률", #417). 서버는 이 칸이 선택입니다.
    yesterdayAwayCount: clampOrNull(yesterdayFocus.awayCount, 0, MAX_AWAY_COUNT),
    yesterdayAwayPeakHour: yesterdayFocus.peakHour?.hour ?? null,
    yesterdayUnlockCount: clampOrNull(yesterdayFocus.unlockCount, 0, MAX_UNLOCK_COUNT),
  }
}

/**
 * 저장된 계획을 모든 날짜에서 모아 한 배열로 돌려줍니다. (usePlans 의 allPlans 와 같은 값입니다)
 * 계획은 목록이 아니라 { '2026-10-10': [계획, 계획], … } 처럼 날짜별로 묶여 저장됩니다.
 */
function loadAllPlans(): StudyPlan[] {
  const plans: StudyPlan[] = []
  for (const dayPlans of Object.values(loadRecord<unknown>('plans'))) {
    // 저장된 값이 깨져서 배열이 아닌 날은 건너뜁니다.
    if (Array.isArray(dayPlans)) plans.push(...(dayPlans as StudyPlan[]))
  }
  return plans
}

/** 지난 통화 기록이 없을 때 결산하는 기간 (시간) */
const DEFAULT_SINCE_HOURS = 24
/** 다음 통화까지로 보는 기간 (시간) */
const NEXT_CALL_HOURS = 24
const MS_PER_HOUR = 60 * 60 * 1000
const MAX_CARD_COUNT = 50
const MAX_HOURS_SINCE = 24 * 365

/**
 * 카드 하루치 중 예정 시작 시각이 지난 통화 이후 ~ 지금 사이인 것. 통화한 적이 없으면 최근 24시간.
 * 예정 시작 시각을 모르는 옛 카드는 그날 낮 12시로 봅니다. (통화 결과 화면의 카드 처리 #415 도 같은 기준)
 */
export function getDaysSinceLastCall(
  judgedDays: JudgedCardDay[],
  cards: Pick<Card, 'id' | 'startTime'>[],
  lastCallAt: number | null,
  now: number,
): JudgedCardDay[] {
  const sinceAt = lastCallAt ?? now - DEFAULT_SINCE_HOURS * MS_PER_HOUR
  const startTimeById = new Map(cards.map((card) => [card.id, card.startTime]))
  return judgedDays.filter((day) => {
    const startAt =
      getPlannedStartAt({ date: day.dateKey, startTime: startTimeById.get(day.cardId) }) ??
      new Date(`${day.dateKey}T12:00:00`).getTime()
    return startAt >= sinceAt && startAt <= now
  })
}

/** 실행으로 치는 카드 결과 (휴식 · 미실행이 아닌 것) */
function isRunResult(result: JudgedCardDay['result']): boolean {
  return result !== 'rest' && !isMissResult(result)
}

export interface SinceLastCallInput {
  /** 저장된 카드 전체 */
  cards: Pick<Card, 'id' | 'date' | 'repeatDays' | 'startTime' | 'priority'>[]
  /** 카드 하루치 판정 (cardDays.ts). 지난 통화 무렵부터 오늘까지 */
  judgedDays: JudgedCardDay[]
  /** 지난 통화가 끝난 시각. 없으면 null */
  lastCallAt: number | null
  now: number
  todayKey: string
  /** 오늘 고른 감정 태그. 오늘 체크인이 없거나 태그를 안 골랐으면 undefined 또는 빈 목록 */
  todayEmotions: EmotionTag[] | undefined
  /** 조건부 모듈마다 조건이 됐는지 */
  moduleConditions: CallModuleConditions
}

/**
 * "지난 통화 이후" 칸을 계산합니다. React 도 저장소도 쓰지 않는 순수 함수입니다.
 * 카드 하루치는 그 카드의 예정 시작 시각이 지난 통화 이후 ~ 지금 사이인 것만 셉니다.
 *
 *   지난 통화 어제 21:00, 그 뒤 카드 3개: 제때(실행률 0.9) · 늦게(0.7) · 처리 안 함
 *     -> { hoursSinceLastCall: (지금 - 어제 21시), doneCardCount: 2, cardRunRate: 80,
 *          missedCardCount: 1, unhandledCardCount: 1, … }
 *   통화한 적 없음                    -> 최근 24시간의 카드로 셈, hoursSinceLastCall: null
 *   앞으로 24시간 안의 카드 2개(그중 절대 1개) -> nextCardCount: 2, nextAbsoluteCardCount: 1
 *   오늘 감정 태그 없음               -> emotionTagsMissing: true
 */
export function buildSinceLastCall(input: SinceLastCallInput): SinceLastCallFields {
  const days = getDaysSinceLastCall(input.judgedDays, input.cards, input.lastCallAt, input.now)

  const runDays = days.filter((day) => isRunResult(day.result))
  const missDays = days.filter((day) => isMissResult(day.result))
  // 미실행 원인 중 가장 많은 것 (같으면 먼저 나온 것). 하루에 여러 개 골랐으면 하나하나 셉니다.
  const causeCounts = new Map<CardFailCause, number>()
  for (const day of missDays) {
    for (const cause of getMissReasons(day)) {
      causeCounts.set(cause, (causeCounts.get(cause) ?? 0) + 1)
    }
  }
  let mainMissCause: CardFailCause | null = null
  for (const [cause, count] of causeCounts) {
    if (mainMissCause === null || count > (causeCounts.get(mainMissCause) ?? 0))
      mainMissCause = cause
  }

  // 다음 통화까지 = 지금부터 24시간. 오늘 · 내일 카드 중 예정 시작 시각이 그 안인 것
  const untilAt = input.now + NEXT_CALL_HOURS * MS_PER_HOUR
  const tomorrowKey = moveDateKey(input.todayKey, 1)
  const nextCards = [input.todayKey, tomorrowKey].flatMap((dateKey) =>
    getCardsOnDate(input.cards as Card[], dateKey).filter((card) => {
      const startAt = getPlannedStartAt({ date: dateKey, startTime: card.startTime })
      return startAt !== null && startAt > input.now && startAt <= untilAt
    }),
  )

  const runRateSum = runDays.reduce((sum, day) => sum + day.runRate, 0)
  return {
    hoursSinceLastCall:
      input.lastCallAt === null
        ? null
        : clampOrNull(Math.floor((input.now - input.lastCallAt) / MS_PER_HOUR), 0, MAX_HOURS_SINCE),
    doneCardCount: Math.min(runDays.length, MAX_CARD_COUNT),
    cardRunRate: runDays.length === 0 ? null : Math.round((runRateSum / runDays.length) * 100),
    missedCardCount: Math.min(missDays.length, MAX_CARD_COUNT),
    unhandledCardCount: Math.min(
      days.filter((day) => day.result === 'unhandled').length,
      MAX_CARD_COUNT,
    ),
    mainMissCause,
    nextCardCount: Math.min(nextCards.length, MAX_CARD_COUNT),
    nextAbsoluteCardCount: Math.min(
      nextCards.filter((card) => card.priority === 'absolute').length,
      MAX_CARD_COUNT,
    ),
    emotionTagsMissing: (input.todayEmotions ?? []).length === 0,
    callModule: pickCallModule(input.moduleConditions),
  }
}

/** 저장된 카드 · 기록 · 표시로 최근 21일 카드 하루치를 판정합니다. 지난 통화 시각도 같이 돌려줍니다. */
export function loadCallJudgedDays(
  now: number,
  todayKey: string,
): { cards: Card[]; judgedDays: JudgedCardDay[]; lastCallAt: number | null } {
  const cards = loadSavedCards() ?? []
  const restDays = loadRestDays()
  const marks = loadCardMarks()
  // 재발 신호(② 최근 7일 vs 기준선 14일)까지 보려고 21일치를 판정합니다.
  const judgedDays = buildJudgedCardDays(
    cards,
    loadAllSessions(),
    moveDateKey(todayKey, -20),
    todayKey,
    now,
    (cardId, dateKey) => getCardDayMarkInfo(cardId, dateKey, restDays, marks),
  )
  return { cards, judgedDays, lastCallAt: loadCallLog().at(-1)?.endedAt ?? null }
}

/** 저장된 기록으로 "지난 통화 이후" 칸을 만듭니다. (통화를 시작할 때 · 끝났을 때 같은 값이 나옵니다) */
export function loadSinceLastCall(
  now: number = Date.now(),
  todayKey: string = getTodayKey(),
): SinceLastCallFields {
  const { cards, judgedDays, lastCallAt } = loadCallJudgedDays(now, todayKey)

  const { texts, moods, crisisFlagged } = loadSavedWritings()
  const brake = getSafetyBrakeResult({
    now: new Date(now),
    recentTexts: texts,
    recentMoods: moods,
    crisisFlagged,
    exams: loadExamDates(),
  })
  const careStage = loadLatestCareStage(todayKey)
  const log = loadCallLog()
  const weekFromKey = moveDateKey(todayKey, -(MODULE_COUNT_DAYS - 1))
  const sinceKey = lastCallAt === null ? moveDateKey(todayKey, -1) : toDayKey(lastCallAt)
  const moduleConditions: CallModuleConditions = {
    safetyBrake: brake.stopWhip,
    // 오늘 판정이 회복(0) 이거나 안전 브레이크가 회복 모드를 켰을 때
    recovery: (careStage?.dateKey === todayKey && careStage.stage === 0) || brake.recoveryMode,
    // 지난 통화 이후 새로 생긴 미실행으로 재발 신호가 났을 때
    review4: getRelapseSignal(judgedDays, todayKey, sinceKey).hasSignal,
    goalCheck: loadGoals().some((goal) => isGoalCheckDue(goal, todayKey)),
    // 최근 7일에 넣은 횟수가 설정한 주 횟수(1 또는 2)보다 적을 때
    distortionFeedback:
      countRecentModule(log, 'distortionFeedback', weekFromKey) <
      loadAutoSettings().distortionFeedbackPerWeek.value,
    predictReveal:
      countRecentModule(
        log,
        'predictReveal',
        moveDateKey(todayKey, -(PREDICT_REVEAL_EVERY_DAYS - 1)),
      ) === 0,
  }

  return buildSinceLastCall({
    cards,
    judgedDays,
    lastCallAt,
    now,
    todayKey,
    todayEmotions: loadRecord<CheckIn>('checkins')[todayKey]?.emotions,
    moduleConditions,
  })
}

/** 이 브라우저에 저장된 기록으로 학생 카드를 만듭니다. 통화 화면이 통화를 시작할 때 부릅니다. */
export function loadCallCard(): CallCard | null {
  try {
    const card = buildCallCard(
      loadAllPlans(),
      // 모양이 틀린 기록과 노는 기록은 빼고 불러옵니다. (홈 · 리포트와 같은 방법)
      loadStudySessions(),
      loadRecord<CheckIn>('checkins'),
      { awayRecords: loadAwayRecords(), unlockRecords: loadUnlockRecords() },
    )
    if (card === null) return null
    // "지난 통화 이후" 칸을 더합니다. 이 계산이 실패해도 옛 칸만으로 통화는 걸리게 합니다.
    try {
      return { ...card, ...loadSinceLastCall() }
    } catch {
      return card
    }
  } catch {
    // 저장된 값이 깨져 있어도 통화는 걸려야 합니다. 카드 없이(처음 온 사람처럼) 겁니다.
    return null
  }
}
