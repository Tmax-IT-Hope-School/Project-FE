/**
 * 목표의 진척과 2주 목표 점검 규칙입니다. (기획서 「4.7 목표와 숲」, #403)
 * React 를 쓰지 않는 순수 함수라서 같은 입력이면 항상 같은 결과가 나옵니다.
 *
 *   진척 — 완주형: 남은 분량 ÷ 남은 일수 = 하루 페이스. 처음부터 D-day 까지 고르게 했을 때의 선과 비교합니다.
 *          점수형: 예상 성장 곡선(lib/growthCurve.ts) + 시험 결과 (시험 연결은 #403 다음 PR)
 *   점검 — 2주마다 페이스를 보여 주고 유지 / 수정 / 포기를 고릅니다.
 *          수정·포기 때는 처음 적은 '이루면 좋은 점' 을 먼저 보여 주고 이유를 받아야 저장합니다.
 *          원래 목표값은 지우지 않고 이력(history)으로 남깁니다. (3번 · 7번 오류: 신 포도 · 목표 슬쩍 낮추기 대응)
 *   결과 — D-day 가 되면 결과를 적고 '완료' 로 보관합니다. 지우지 않고 카드 탭 '완료한 목표' 에 남깁니다. (#672)
 */
import { toDayKey } from '@/lib/date'
import { changeGoalTarget } from '@/lib/goals'
import { getDaysUntil } from '@/lib/onboardingSteps'
import type { Goal, GoalProgressEntry } from '@/types'

/** 목표 점검 간격 (일) */
export const GOAL_CHECK_INTERVAL_DAYS = 14

/** 'YYYY-MM-DD' 의 그날 낮 12시 (하루 기준 시각 새벽 4시와 헷갈리지 않게 낮으로 잡습니다) */
function noonOf(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

/** from 날짜부터 to 날짜까지 며칠 지났는지 (같은 날 = 0) */
function daysBetween(fromKey: string, toKey: string): number {
  return getDaysUntil(toKey, noonOf(fromKey))
}

/**
 * 2주 목표 점검을 할 때가 됐는지. 진행 중인 목표만, 마지막 점검(없으면 만든 날)부터 14일이 지났으면 true
 *
 *   만든 날 10/01, 점검 안 함, 오늘 10/15  -> true  (14일)
 *   만든 날 10/01, 점검 안 함, 오늘 10/14  -> false (13일)
 *   마지막 점검 10/15, 오늘 10/20          -> false
 *   포기한 목표                             -> false
 */
export function isGoalCheckDue(goal: Goal, todayKey: string): boolean {
  if (goal.status !== 'active') return false
  const fromKey = toDayKey(goal.lastCheckedAt ?? goal.createdAt)
  return daysBetween(fromKey, todayKey) >= GOAL_CHECK_INTERVAL_DAYS
}

/** 완주형 목표에서 지금까지 한 분량 (가장 늦은 날짜의 기록). 기록이 없으면 0 */
export function getDoneAmount(goal: Goal): number {
  const log = goal.progressLog ?? []
  return log.length === 0 ? 0 : log[log.length - 1].doneAmount
}

/**
 * 그 날짜까지 한 누적 분량을 적습니다. 같은 날짜에 다시 적으면 바꾸고, 날짜 순으로 둡니다.
 * 0보다 작으면 0, 전체 분량보다 크면 전체 분량으로 맞춥니다.
 *
 *   recordDoneAmount({ totalAmount: 300, progressLog: [] }, '2026-10-17', 40)
 *     -> progressLog: [{ dateKey: '2026-10-17', doneAmount: 40 }]
 *   recordDoneAmount(위 결과, '2026-10-17', 350) -> 같은 날짜를 300 으로 바꿈
 */
export function recordDoneAmount(goal: Goal, dateKey: string, doneAmount: number): Goal {
  const total = goal.totalAmount ?? Number.POSITIVE_INFINITY
  const amount = Math.min(Math.max(0, Math.round(doneAmount)), total)
  const others = (goal.progressLog ?? []).filter((entry) => entry.dateKey !== dateKey)
  const progressLog: GoalProgressEntry[] = [...others, { dateKey, doneAmount: amount }].sort(
    (a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0),
  )
  return { ...goal, progressLog }
}

/** 고르게 했을 때보다 이만큼(전체의 비율) 넘게 뒤처지면 '뒤처짐', 넘게 앞서면 '앞섬' 입니다 (출발값) */
export const PACE_MARGIN_RATE = 0.05

/** 완주형 목표의 진척 */
export interface CompletionProgress {
  total: number
  done: number
  remaining: number
  /** 오늘을 포함해 D-day 까지 남은 날 (지났으면 1) */
  daysLeft: number
  /** 남은 분량 ÷ 남은 날 (올림). 다 했으면 0 */
  dailyPace: number
  /** 만든 날부터 D-day 까지 고르게 했다면 오늘까지 했어야 하는 분량 */
  expectedDone: number
  /** 고르게 했을 때와 비교 — ahead 앞섬 · onTrack 맞음 · behind 뒤처짐 · done 다 함 */
  status: 'ahead' | 'onTrack' | 'behind' | 'done'
  /** 그래프의 시작 날짜(만든 날) */
  startKey: string
}

/**
 * 완주형 목표의 진척을 계산합니다. 전체 분량이 없으면 null
 *
 *   300쪽, 10/01 만듦, D-day 10/30(30일), 오늘 10/16 에 150쪽
 *     -> 고르게 했다면 160쪽(300 × 16/30) · 남은 150쪽 ÷ 15일 = 하루 10쪽 · onTrack (차이가 전체의 5% 안)
 *   같은 조건에 90쪽  -> behind, 하루 14쪽
 *   300쪽 다 함       -> done, 하루 0쪽
 */
export function getCompletionProgress(goal: Goal, todayKey: string): CompletionProgress | null {
  const total = goal.totalAmount
  if (total === undefined || total <= 0) return null
  const done = Math.min(getDoneAmount(goal), total)
  const remaining = total - done
  const startKey = toDayKey(goal.createdAt)
  // 만든 날부터 D-day 까지 며칠짜리 목표인지 (같은 날이면 1일) · 오늘까지 며칠 지났는지 (만든 날 = 1일째)
  const totalDays = Math.max(1, daysBetween(startKey, goal.dDay) + 1)
  const passedDays = Math.min(totalDays, Math.max(0, daysBetween(startKey, todayKey) + 1))
  const daysLeft = Math.max(1, daysBetween(todayKey, goal.dDay) + 1)
  const expectedDone = Math.round((total * passedDays) / totalDays)
  const margin = total * PACE_MARGIN_RATE

  let status: CompletionProgress['status'] = 'onTrack'
  if (remaining === 0) status = 'done'
  else if (done < expectedDone - margin) status = 'behind'
  else if (done > expectedDone + margin) status = 'ahead'

  return {
    total,
    done,
    remaining,
    daysLeft,
    dailyPace: remaining === 0 ? 0 : Math.ceil(remaining / daysLeft),
    expectedDone,
    status,
    startKey,
  }
}

/** 점검 — 유지. 점검한 때만 남깁니다. */
export function keepGoal(goal: Goal, now: number): Goal {
  return { ...goal, lastCheckedAt: now }
}

/** 점검 — 수정. 고치기 전 값과 이유는 history 에 남깁니다. (lib/goals.ts 의 changeGoalTarget) */
export function changeGoalOnCheck(
  goal: Goal,
  changes: Parameters<typeof changeGoalTarget>[1],
  reason: string,
  now: number,
): Goal {
  return { ...changeGoalTarget(goal, changes, reason.trim(), now), lastCheckedAt: now }
}

/** 점검 — 포기. 목표는 지우지 않고 '포기' 로 두고 이유를 남깁니다. (숲에도 끝난 목표로 남습니다) */
export function giveUpGoal(goal: Goal, reason: string, now: number): Goal {
  return { ...goal, status: 'givenUp', givenUpReason: reason.trim(), lastCheckedAt: now }
}

/** 수정·포기 이유로 받는 글자 수 */
export const CHECK_REASON_MAX_LENGTH = 100

/** 수정·포기 이유가 저장할 수 있는 글인지 (빈칸만 적은 것은 안 됨) */
export function isCheckReasonValid(reason: string): boolean {
  const trimmed = reason.trim()
  return trimmed !== '' && trimmed.length <= CHECK_REASON_MAX_LENGTH
}

/** D-day 결과로 받는 글자 수 (서버 goals.result 도 100자까지) */
export const GOAL_RESULT_MAX_LENGTH = 100

/**
 * D-day 결과를 적을 때가 됐는지. 진행 중인 목표만, D-day 당일부터 true 입니다. (#672)
 * 시험은 D-day 에 보니까 그날부터 적을 수 있게 합니다.
 * 'YYYY-MM-DD' 글자는 앞에서부터 비교하면 날짜 순서와 같아서 >= 로 비교합니다.
 *
 *   D-day 10/30, 오늘 10/29 -> false
 *   D-day 10/30, 오늘 10/30 -> true
 *   D-day 10/30, 오늘 11/02 -> true
 *   이미 완료 · 포기한 목표   -> false
 */
export function isGoalResultDue(goal: Goal, todayKey: string): boolean {
  return goal.status === 'active' && todayKey >= goal.dDay
}

/**
 * 완주형 목표의 결과 한 줄을 적어 둔 분량으로 만듭니다. 따로 묻지 않습니다. 전체 분량이 없으면 ''
 *
 *   300쪽 중 300쪽 -> '300/300쪽 · 끝까지 했어요'
 *   300쪽 중 240쪽 -> '240/300쪽 · 80%'
 */
export function getCompletionResultText(goal: Goal, todayKey: string): string {
  const progress = getCompletionProgress(goal, todayKey)
  if (progress === null) return ''
  const amount = `${progress.done}/${progress.total}${goal.amountUnit ?? ''}`
  if (progress.status === 'done') return `${amount} · 끝까지 했어요`
  return `${amount} · ${Math.round((progress.done / progress.total) * 100)}%`
}

/** 결과가 저장할 수 있는 글인지 (빈칸만 적은 것은 안 됨) */
export function isGoalResultValid(result: string): boolean {
  const trimmed = result.trim()
  return trimmed !== '' && trimmed.length <= GOAL_RESULT_MAX_LENGTH
}

/**
 * 결과를 적고 목표를 '완료' 로 보관합니다. 지우지 않습니다. (#672)
 * 진행 중 목표에서 빠지므로 진행 중 3칸 중 하나가 비어 새 목표를 만들 수 있습니다.
 * 서버에는 useGoalSync 가 { status: 'done', result } 로 보냅니다. (lib/goalsApi.ts 의 toServerGoalBody)
 *
 *   finishGoal({ status: 'active', … }, ' 4등급 ') -> { status: 'done', result: '4등급', … }
 */
export function finishGoal(goal: Goal, result: string): Goal {
  return { ...goal, status: 'done', result: result.trim() }
}
