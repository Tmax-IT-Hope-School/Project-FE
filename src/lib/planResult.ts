import { getPlannedStartAt } from '@/lib/facts'
import { getPlanProgress } from '@/lib/planProgress'
import type { StudyPlan, StudySession } from '@/types'

/**
 * 계획 하나의 결과입니다. (#313)
 * - onTime: 제때 했어요 / late: 늦게 시작했어요 / done: 다 했어요(시작 시각이 없는 계획)
 * - partial: 조금 했어요 / missed: 못 했어요
 * 글자는 혼내는 말투가 되지 않게 "했어요" 로 씁니다.
 */
export type PlanResult = 'onTime' | 'late' | 'done' | 'partial' | 'missed'

/** 결과마다 화면에 보여 줄 글자 */
export const PLAN_RESULT_LABELS: Record<PlanResult, string> = {
  onTime: '제때 했어요',
  late: '늦게 시작했어요',
  done: '다 했어요',
  partial: '조금 했어요',
  missed: '못 했어요',
}

/** 시작 시각보다 이만큼(분)까지 늦게 켜도 "제때" 로 봅니다 */
export const ON_TIME_GRACE_MINUTES = 10

const MS_PER_MINUTE = 60 * 1000

/** 그 계획으로 처음 켠 타이머의 시작 시각입니다. 한 번도 안 켰으면 null 입니다. */
function getFirstStartAt(planId: string, sessions: StudySession[]): number | null {
  let firstStartAt: number | null = null
  for (const session of sessions) {
    if (session.planId !== planId) continue
    if (firstStartAt === null || session.startedAt < firstStartAt) {
      firstStartAt = session.startedAt
    }
  }
  return firstStartAt
}

/**
 * 계획을 계획한 시간에 실제로 했는지 타이머 기록으로 판정합니다.
 * 아직 판정할 수 없으면 null 입니다. React 를 쓰지 않는 순수 함수라서 같은 입력이면 항상 같은 결과가 나옵니다.
 *
 * ■ 규칙
 * 1. 노는 계획은 판정하지 않습니다. (null)
 * 2. 체크 표시(done)로는 "했음" 을 판정하지 않습니다. 스스로 누를 수 있어서, 했다는 판정은 타이머 기록만으로 합니다. (#247 과 같은 이유)
 *    다만 체크한 계획에 "못 했어요"·"조금 했어요" 를 붙이지는 않습니다. (규칙 5)
 * 3. 목표를 채웠는지는 getPlanProgress 의 isReached 를 그대로 씁니다. (밀리초로 비교)
 * 4. 목표를 채웠으면 바로 판정합니다.
 *    - 시작 시각이 없으면 "다 함"
 *    - 그 계획으로 처음 켠 타이머가 시작 시각 + 10분 안에 시작됐으면 "제때 함", 더 늦었으면 "늦게 함"
 *      (일찍 시작한 것도 제때입니다. 00:00 ~ 03:59 시작 시각은 다음 날 새벽입니다 — lib/facts.ts 규칙 8 과 같습니다)
 * 5. 목표를 못 채웠으면 그날이 끝난 뒤(다음 날 새벽 4시)에만 판정합니다.
 *    - 타이머를 한 번이라도 켰으면 "조금 했어요", 한 번도 안 켰으면 "못 했어요"
 *    - 단, 체크 표시를 한 계획은 판정하지 않습니다. (타이머 없이 끝내고 체크만 한 계획에 "못 했어요" 가 붙으면 틀린 말이 됩니다)
 *    - 그날이 아직 안 끝났으면 null (아직 하는 중일 수 있습니다)
 *
 * ■ 예시 (10/5 19:00 시작 · 50분 계획, todayKey 는 오늘 날짜)
 *   19:05 시작 · 50분 공부                       -> 'onTime'
 *   18:40 시작 · 50분 공부 (일찍 시작)            -> 'onTime'
 *   19:30 시작 · 50분 공부                       -> 'late'
 *   시작 시각 없는 계획 · 50분 공부               -> 'done'
 *   19:00 시작 · 30분 공부, todayKey '2026-10-05' -> null (그날이 안 끝남)
 *   19:00 시작 · 30분 공부, todayKey '2026-10-06' -> 'partial'
 *   기록 없음, todayKey '2026-10-06'             -> 'missed'
 *   기록 없음 · 체크함, todayKey '2026-10-06'     -> null   (체크한 계획은 판정하지 않음)
 *   노는 계획                                    -> null
 */
export function getPlanResult(
  plan: StudyPlan,
  sessions: StudySession[],
  todayKey: string,
): PlanResult | null {
  // 규칙 1
  if (plan.kind === 'play') return null

  const firstStartAt = getFirstStartAt(plan.id, sessions)

  // 규칙 3, 4
  if (getPlanProgress(plan, sessions).isReached) {
    const plannedStartAt = getPlannedStartAt(plan)
    if (plannedStartAt === null || firstStartAt === null) return 'done'
    const isOnTime = firstStartAt - plannedStartAt <= ON_TIME_GRACE_MINUTES * MS_PER_MINUTE
    return isOnTime ? 'onTime' : 'late'
  }

  // 규칙 5. 날짜는 'YYYY-MM-DD' 글자라서 크기 비교로 앞뒤를 알 수 있습니다.
  const isDayOver = todayKey > plan.date
  if (!isDayOver) return null
  // 체크한 계획은 타이머 없이 끝냈을 수 있어서, 못 했다고 하지 않습니다. (목표를 채운 판정은 위 규칙 4 가 따로 합니다)
  if (plan.done) return null
  return firstStartAt === null ? 'missed' : 'partial'
}
