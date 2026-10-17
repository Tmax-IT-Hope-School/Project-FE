/**
 * 분기 함수(#91)의 결과를 보고 "목표를 바꿔 볼까요?" 하고 제안할 내용을 만드는 파일입니다. (기획서 v2 4장)
 *
 *  - carrot-raise (잘 지켰고 효과도 있음) → 오늘 목표를 10% 올리자고 제안
 *  - goal-down (계획 과다·피곤·아픔·행사 등) → 최근 실제 평균의 110% 로 낮추자고 제안
 *
 * React 를 쓰지 않는 순수 함수라서 같은 입력이면 항상 같은 결과가 나옵니다.
 * "목표" 는 오늘 계획들의 목표 시간(분) 합계입니다. (StudyPlan.targetMinutes)
 */
import type { CareAction } from '@/lib/careDecision'
import { MAX_TARGET_MINUTES } from '@/lib/countdown'
import { toDayKey } from '@/lib/date'
import type { StudyPlan } from '@/types'

// ─── 숫자 상수: 규칙을 바꾸고 싶으면 여기 숫자만 고치면 됩니다. ───

/** 목표를 올릴 때 곱하는 값입니다. 1.1 = 10% 상향 (예: 240분 → 264분) */
export const GOAL_RAISE_RATE = 1.1

/** 목표를 낮출 때 "최근 실제 평균"에 곱하는 값입니다. 1.1 = 평균의 110% */
export const GOAL_RECOVERY_RATE = 1.1

/** 제안을 거절하면 이 일수 동안은 다시 묻지 않습니다. */
export const DECLINE_SNOOZE_DAYS = 3

export type GoalAdjustKind = 'raise' | 'lower'

export interface GoalAdjustProposal {
  /** raise 올리기 / lower 낮추기 */
  kind: GoalAdjustKind
  /** 지금 목표 (분) */
  fromMinutes: number
  /** 제안하는 새 목표 (분) */
  toMinutes: number
}

/**
 * 분기 결과가 목표 조정이면 제안을 만들고, 아니면 null 을 돌려줍니다.
 *
 *  - carrot-raise: 지금 목표 × 1.1 (반올림).  예) 240 → 264
 *  - goal-down: 최근 실제 평균 × 1.1 (반올림).  예) 평균 100분, 지금 목표 240 → 110
 *
 * 제안하지 않는 경우 (null)
 *  - 다른 대응(채찍·당근만 등)일 때
 *  - 지금 목표가 0분 이하일 때 (올리거나 낮출 기준이 없음)
 *  - goal-down 인데 최근 평균을 모르거나 0 이하일 때 (근거 없이 낮추지 않음)
 *  - goal-down 인데 계산한 값이 지금 목표보다 낮지 않을 때 ("낮추자" 며 올리는 일 방지)
 *  - raise 인데 반올림하면 값이 그대로일 때 (너무 작은 목표)
 *  - raise 인데 더 올릴 수 있는 만큼(maxMinutes)에 이미 닿았을 때 (수락해도 안 바뀌는 제안을 하지 않습니다)
 *    예) 600분 계획 하나(maxMinutes 600) -> null / 580분 계획 하나(maxMinutes 600) -> 600분까지만 제안
 */
export function proposeGoalAdjust(
  action: CareAction,
  currentMinutes: number,
  recentAverageMinutes: number | null,
  maxMinutes: number = Infinity,
): GoalAdjustProposal | null {
  if (currentMinutes <= 0) return null

  if (action === 'carrot-raise') {
    // 계획 하나는 600분까지라서(scalePlanMinutes), 올릴 수 있는 만큼(maxMinutes)까지만 제안합니다.
    const toMinutes = Math.min(Math.round(currentMinutes * GOAL_RAISE_RATE), maxMinutes)
    if (toMinutes <= currentMinutes) return null
    return { kind: 'raise', fromMinutes: currentMinutes, toMinutes }
  }

  if (action === 'goal-down') {
    if (recentAverageMinutes === null || recentAverageMinutes <= 0) return null
    const toMinutes = Math.round(recentAverageMinutes * GOAL_RECOVERY_RATE)
    if (toMinutes >= currentMinutes) return null
    return { kind: 'lower', fromMinutes: currentMinutes, toMinutes }
  }

  return null
}

/**
 * 거절한 뒤 아직 "다시 묻지 않는 기간"인지 알려줍니다.
 *
 * declinedDate 가 'YYYY-MM-DD' 일 때, 그날부터 DECLINE_SNOOZE_DAYS 일 동안은 true 입니다.
 *   예) 3일로 정했고 10일에 거절 → 10·11·12일은 true, 13일부터 false
 * declinedDate 가 null(거절한 적 없음)이면 false 입니다.
 */
export function isDeclineSnoozed(declinedDate: string | null, today: Date = new Date()): boolean {
  if (declinedDate === null) return false

  const declined = new Date(`${declinedDate}T00:00:00`)
  if (Number.isNaN(declined.getTime())) return false

  // 오늘 날짜(새벽 4시 기준)의 0시로 맞춰서 몇 일이 지났는지 셉니다. (시각 차이로 하루가 어긋나지 않게 날짜 문자열로 다시 만듭니다)
  const todayStart = new Date(`${toDayKey(today)}T00:00:00`)
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  const passedDays = Math.round((todayStart.getTime() - declined.getTime()) / MS_PER_DAY)

  // passedDays 가 음수면 (거절 날짜가 미래) 시계가 바뀐 것이니 안전하게 "아직 쉬는 중"으로 봅니다.
  return passedDays < DECLINE_SNOOZE_DAYS
}

/** 계획 하나의 목표 시간을 1 ~ 최대(600분) 사이로 맞춥니다. 입력 칸이 받는 범위와 같습니다. */
function clampPlanMinutes(minutes: number): number {
  return Math.min(MAX_TARGET_MINUTES, Math.max(1, minutes))
}

/**
 * 수락했을 때 계획들의 목표 시간을 새 합계에 맞춰 같은 비율로 바꿉니다.
 *
 *   예) 30분·60분(합계 90) 을 135분으로 → 45분·90분
 *
 * - 각 계획은 반올림하므로 합계가 1~2분 어긋날 수 있습니다.
 * - 계획이 하나라도 0분이 되면 안 되므로 최소 1분으로 둡니다. 한 계획이 최대(600분)를 넘지 않게도 막습니다.
 *   예) 600분짜리 계획 하나를 660분으로 올리자는 비율이면 600분에서 멈춥니다.
 * - 원래 합계가 0 이하면 비율을 구할 수 없어서 그대로 돌려줍니다.
 * - 노는 계획(kind 가 'play')은 공부 목표가 아니라서 합계에 넣지 않고, 시간도 바꾸지 않습니다. (#238)
 */
export function scalePlanMinutes(plans: StudyPlan[], newTotalMinutes: number): StudyPlan[] {
  const oldTotal = plans
    .filter((plan) => plan.kind !== 'play')
    .reduce((sum, plan) => sum + plan.targetMinutes, 0)
  if (oldTotal <= 0 || newTotalMinutes <= 0) return plans

  const ratio = newTotalMinutes / oldTotal
  return plans.map((plan) =>
    plan.kind === 'play'
      ? plan
      : { ...plan, targetMinutes: clampPlanMinutes(Math.round(plan.targetMinutes * ratio)) },
  )
}
