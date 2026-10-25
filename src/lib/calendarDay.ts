import {
  getCardResult,
  getCheckedCount,
  getRunRate,
  isMissResult,
  isStartedOnTime,
  type CardDay,
  type CardDayMark,
  type CardResult,
} from '@/lib/cardResult'
import { getCardsOnDate } from '@/lib/cards'
import { moveDateKey, toDayKey } from '@/lib/date'
import { getPlannedStartAt } from '@/lib/facts'
import { missReasonOptions } from '@/lib/missReasons'
import { getSessionCardId } from '@/lib/sessionRecords'
import { SHORTFALL_REASONS, getShortfallReasons } from '@/lib/sessionTags'
import type { Card, MissReason, StudySession } from '@/types'

/**
 * 분석 탭 달력 (최종 기획서 「4.6 분석」 달력, #410)
 *
 * 날마다 실행 · 지연 · 미실행 · 휴식 넷 중 하나로 칠하고, 네 상태를 **같은 크기**로 보여 줍니다.
 * 잘 된 날만 크게 보이면 성공한 날만 기억하게 되기 때문입니다. (7번 오류 · 선택적 기억)
 * 같은 이유로 연속 기록(스트릭) 대신 **최근 4주 실행률**을 보여 줍니다.
 *
 * 카드 하나하나의 결과는 lib/cardResult.ts(#381)가 정한 것을 그대로 씁니다. 여기서는 그 결과를 하루로 모읍니다.
 */

/** 달력 한 칸의 상태 — done 실행 · late 지연 · missed 미실행 · rest 휴식 */
export type DayStatus = 'done' | 'late' | 'missed' | 'rest'

/** 화면에 보이는 순서 */
export const DAY_STATUSES: DayStatus[] = ['done', 'late', 'missed', 'rest']

/** 상태마다 글자와 모양. 색만으로 구분하지 않도록 모양(○ △ ✕ −)도 같이 씁니다 */
export const DAY_STATUS_INFO: Record<DayStatus, { label: string; symbol: string }> = {
  done: { label: '실행', symbol: '○' },
  late: { label: '지연', symbol: '△' },
  missed: { label: '미실행', symbol: '✕' },
  rest: { label: '휴식', symbol: '−' },
}

/** 최근 몇 일의 실행률을 볼지 (4주) */
export const RECENT_RATE_DAYS = 28

/**
 * 사람이 처리한 표시와 그때 고른 원인입니다.
 * 쉬는 날 · 미루기 · 실패 표시(lib/restDays.ts 의 getCardDayMarkInfo)를 이 모양으로 바꿔 getMark 로 넘깁니다.
 * 통계 탭(StatsPage)과 기록 탭(lib/historyReport.ts)이 같은 방식으로 넘깁니다.
 */
export interface CardDayMarkRecord {
  mark: CardDayMark
  /** 미실행일 때 고른 원인 태그 */
  reason?: MissReason
}

/** 판정이 끝난 카드 하루치 (달력 상세에 한 줄로 보입니다) */
export interface JudgedCard {
  card: Card
  /** 카드 결과 7가지 중 하나 (cardResult.ts) */
  result: CardResult
  /** 달력 상태 4가지 중 하나 */
  status: DayStatus
  /** 실행률 0 ~ 1. 미실행이면 0 */
  runRate: number
  /** 체크한 체크리스트 수 */
  checkedCount: number
  /** 화면에 보일 사유 (예: '20분 늦게 시작', '다 못 한 이유: 막힘'). 없으면 빈 목록 */
  reasons: string[]
}

/** 달력 하루 */
export interface CalendarDay {
  dateKey: string
  /** 그날 판정이 끝난 카드 (시작 시각 순) */
  cards: JudgedCard[]
  /** 아직 판정 전인 카드 수 (카드 시간이 아직 안 끝남) */
  pendingCount: number
  /** 칸에 칠할 상태. 판정이 끝난 카드가 없으면 null (칠하지 않음) */
  status: DayStatus | null
}

/** buildCalendarDay 에 넣는 것 */
export interface CalendarDayInput {
  /** 'YYYY-MM-DD' */
  dateKey: string
  /** 전체 카드 (그날 하는 카드만 골라 씁니다) */
  cards: Card[]
  /** 그날 공부 세션 (노는 기록 빼고). groupSessionsByDayKey 로 나눈 것 */
  sessions: StudySession[]
  /** 옛 계획 id → 카드 id 표 (lib/sessionRecords.ts 의 buildCardIdByPlanId) */
  cardIdByPlanId: Record<string, string>
  /** 지금 시각 (Date.now() 값) */
  now: number
  /** 그 카드 · 그날에 사람이 처리한 표시 (쉬는 날 · 미루기 · 실패). 안 넘기면 표시가 없는 것으로 봅니다 */
  getMark?: (cardId: string, dateKey: string) => CardDayMarkRecord | undefined
}

const MS_PER_MINUTE = 60 * 1000

/**
 * 카드 결과(7가지)를 달력 상태(4가지)로 바꿉니다.
 * 중도 종료는 시작한 시각으로 나눕니다. 제때 시작했으면 실행, 늦게 시작했으면 지연입니다.
 * (끝까지 못 한 것은 실행률과 날짜 상세의 '중간에 끝냈어요' 로 보입니다)
 *
 *   toDayStatus('done', true)          -> 'done'
 *   toDayStatus('selfReport', null)    -> 'done'    (사후 입력도 한 것)
 *   toDayStatus('late', false)         -> 'late'
 *   toDayStatus('endedEarly', true)    -> 'done'
 *   toDayStatus('endedEarly', false)   -> 'late'
 *   toDayStatus('failed', null)        -> 'missed'  (미루기 · 미처리도 미실행)
 *   toDayStatus('rest', null)          -> 'rest'
 */
export function toDayStatus(result: CardResult, startedOnTime: boolean | null): DayStatus {
  if (result === 'rest') return 'rest'
  if (isMissResult(result)) return 'missed'
  if (result === 'late') return 'late'
  if (result === 'endedEarly' && startedOnTime === false) return 'late'
  return 'done'
}

/** 같은 수일 때 어느 쪽으로 볼지. 앞에 있을수록 먼저입니다 (아쉬운 쪽을 먼저 봐야 좋은 날만 기억하지 않습니다) */
const TIE_ORDER: DayStatus[] = ['missed', 'late', 'done']

/**
 * 그날 카드들의 상태로 칸 하나의 상태를 정합니다.
 * 1. 카드가 없으면 null
 * 2. 전부 휴식이면 휴식
 * 3. 휴식을 뺀 카드 중 가장 많은 상태. 수가 같으면 미실행 → 지연 → 실행 순으로 먼저 고릅니다
 * 한 장만 못 해도 그날을 통째로 '미실행' 이라고 부르지 않습니다. (흑백 사고, 6번 오류)
 *
 *   ['done', 'done', 'missed'] -> 'done'
 *   ['done', 'missed']         -> 'missed'  (같은 수 → 아쉬운 쪽)
 *   ['done', 'late']           -> 'late'
 *   ['rest', 'rest']           -> 'rest'
 *   ['rest', 'done']           -> 'done'
 *   []                         -> null
 */
export function pickDayStatus(statuses: DayStatus[]): DayStatus | null {
  if (statuses.length === 0) return null
  const counted = statuses.filter((status) => status !== 'rest')
  if (counted.length === 0) return 'rest'

  let best = TIE_ORDER[0]
  let bestCount = -1
  for (const status of TIE_ORDER) {
    const count = counted.filter((item) => item === status).length
    // > 라서 수가 같으면 앞에 있는(먼저 본) 상태가 남습니다.
    if (count > bestCount) {
      best = status
      bestCount = count
    }
  }
  return best
}

/** 세션을 날짜('YYYY-MM-DD', 새벽 4시 기준)별로 나눕니다. */
export function groupSessionsByDayKey(sessions: StudySession[]): Map<string, StudySession[]> {
  const byDay = new Map<string, StudySession[]>()
  for (const session of sessions) {
    const dayKey = toDayKey(session.startedAt)
    byDay.set(dayKey, [...(byDay.get(dayKey) ?? []), session])
  }
  return byDay
}

/** 처음 시작한 시각이 예정보다 몇 분 늦었는지. 시작 시각이 없거나 잰 세션이 없으면 null */
function getLateMinutes(day: CardDay): number | null {
  const scheduledStartAt = getPlannedStartAt({ date: day.dateKey, startTime: day.card.startTime })
  const measured = day.sessions.filter((session) => session.mode !== 'selfReport')
  if (scheduledStartAt === null || measured.length === 0) return null
  const firstStartAt = Math.min(...measured.map((session) => session.startedAt))
  return Math.max(0, Math.round((firstStartAt - scheduledStartAt) / MS_PER_MINUTE))
}

/**
 * 카드 하루치의 사유를 글자로 모읍니다. 같은 글은 한 번만 넣습니다.
 *
 *   지연, 20분 늦게 시작                       -> ['20분 늦게 시작']
 *   실패, 원인 '피곤·수면'                     -> ['원인: 피곤·수면']
 *   중도 종료, 체크리스트를 다 못 한 이유 '막힘' -> ['다 못 한 이유: 막힘']
 */
function getReasons(day: CardDay, status: DayStatus, markReason?: MissReason): string[] {
  const reasons: string[] = []
  if (markReason) {
    const label = missReasonOptions.find((option) => option.key === markReason)?.label ?? '기타'
    reasons.push(`원인: ${label}`)
  }
  if (status === 'late') {
    const lateMinutes = getLateMinutes(day)
    if (lateMinutes !== null) reasons.push(`${lateMinutes}분 늦게 시작`)
  }
  for (const session of day.sessions) {
    if (session.stopReason) {
      const label =
        missReasonOptions.find((option) => option.key === session.stopReason)?.label ?? '기타'
      reasons.push(`그만둔 이유: ${label}`)
    }
    // 다 못 한 이유를 여러 개 골랐으면 한 줄에 같이 씁니다. 예) '다 못 한 이유: 막힘 · 피곤함'
    const shortfalls = getShortfallReasons(session.endReport)
    if (shortfalls.length > 0) {
      const labels = shortfalls.map(
        (shortfall) =>
          SHORTFALL_REASONS.find((option) => option.key === shortfall)?.label ?? '기타',
      )
      reasons.push(`다 못 한 이유: ${labels.join(' · ')}`)
    }
  }
  return [...new Set(reasons)]
}

/**
 * 달력 하루를 만듭니다. 그날 하는 카드마다 결과를 판정하고, 칸에 칠할 상태를 정합니다.
 *
 * - 카드를 만들기 전 날짜는 그날 기록(세션 · 처리 표시)이 있을 때만 셉니다.
 *   (나중에 만든 반복 카드 때문에 지난 날이 '미실행' 으로 칠해지지 않게)
 * - 아직 판정할 수 없는 카드(카드 시간 전 · 하는 중)는 pendingCount 로만 셉니다.
 *
 *   (10/17 19:00 · 60분 카드 하나, 지금 10/17 21:00)
 *   세션 19:05 ~ 20:00  -> { status: 'done', cards: [{ result: 'done', runRate: 0.92, … }], pendingCount: 0 }
 *   세션 없음           -> { status: 'missed', cards: [{ result: 'unhandled', runRate: 0, … }], pendingCount: 0 }
 *   (지금 10/17 19:30, 세션 없음) -> { status: null, cards: [], pendingCount: 1 }
 */
export function buildCalendarDay(input: CalendarDayInput): CalendarDay {
  const judged: JudgedCard[] = []
  let pendingCount = 0

  for (const card of getCardsOnDate(input.cards, input.dateKey)) {
    const sessions = input.sessions.filter(
      (session) => getSessionCardId(session, input.cardIdByPlanId) === card.id,
    )
    const markRecord = input.getMark?.(card.id, input.dateKey)
    const isBeforeCreated = input.dateKey < toDayKey(card.createdAt)
    if (isBeforeCreated && sessions.length === 0 && markRecord === undefined) continue

    const day: CardDay = { card, dateKey: input.dateKey, sessions, mark: markRecord?.mark }
    const result = getCardResult(day, input.now)
    if (result === null) {
      pendingCount += 1
      continue
    }

    const status = toDayStatus(result, isStartedOnTime(day))
    judged.push({
      card,
      result,
      status,
      runRate: isMissResult(result) ? 0 : getRunRate(day),
      checkedCount: getCheckedCount(day),
      reasons: getReasons(day, status, markRecord?.reason),
    })
  }

  return {
    dateKey: input.dateKey,
    cards: judged,
    pendingCount,
    status: pickDayStatus(judged.map((item) => item.status)),
  }
}

/** 오늘을 포함한 최근 4주(28일) 날짜를 오래된 날부터 돌려줍니다. ('2026-10-17' -> ['2026-09-20', …, '2026-10-17']) */
export function getRecentDateKeys(todayKey: string): string[] {
  const dateKeys: string[] = []
  for (let daysAgo = RECENT_RATE_DAYS - 1; daysAgo >= 0; daysAgo -= 1) {
    dateKeys.push(moveDateKey(todayKey, -daysAgo))
  }
  return dateKeys
}

/** 여러 날의 실행률 요약 */
export interface RunRateSummary {
  /** 평균 실행률 0 ~ 1. 셀 카드가 없으면 null */
  rate: number | null
  /** 실행률에 넣은 카드 수 (휴식 카드는 뺌) */
  cardCount: number
  /** 상태별 날 수 */
  dayCounts: Record<DayStatus, number>
}

/**
 * 여러 날(보통 최근 4주)의 실행률을 구합니다. 카드마다 실행률을 낸 뒤 평균합니다. (relapseSignal.ts 와 같은 방식)
 * 휴식 카드는 모든 집계에서 빼고(「5.1」), 상태별 날 수는 따로 셉니다.
 *
 *   카드 4장: 실행(1) · 지연(1) · 중도 종료(0.5) · 미실행(0)  -> rate 0.625, cardCount 4
 *   카드 2장: 실행(1) · 휴식                                 -> rate 1,     cardCount 1
 *   카드 없음                                                -> rate null,  cardCount 0
 */
export function summarizeRunRate(days: CalendarDay[]): RunRateSummary {
  const dayCounts: Record<DayStatus, number> = { done: 0, late: 0, missed: 0, rest: 0 }
  let rateSum = 0
  let cardCount = 0

  for (const day of days) {
    if (day.status !== null) dayCounts[day.status] += 1
    for (const item of day.cards) {
      if (item.status === 'rest') continue
      rateSum += item.runRate
      cardCount += 1
    }
  }

  return { rate: cardCount === 0 ? null : rateSum / cardCount, cardCount, dayCounts }
}
