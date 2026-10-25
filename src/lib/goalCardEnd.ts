import { isOneOffCard } from '@/lib/cards'
import { toDayKey } from '@/lib/date'
import type { Card, Goal } from '@/types'

/**
 * 목표가 끝나면 그 목표의 반복 카드(루틴 카드)를 그만하게 하는 규칙입니다. (#734, 2026-10-25 QA 7번)
 * 반복 카드는 "시작한 날 + 요일" 뿐이라, 목표를 그만두거나 D-day 가 지나도 카드가 계속 생겼습니다.
 * 카드에 그만하는 날(endDate)을 채우면 isCardOnDate(lib/cards.ts)와 서버의 Card.isOnDate 가 그 뒤 날짜를 거릅니다.
 * 이 파일은 계산만 합니다. 저장은 hooks/useGoalCardEnds.ts 가 합니다.
 */

/** 'YYYY-MM-DD' 둘 중 이른 날 (글자로 비교해도 날짜 순서와 같습니다) */
function earlierKey(a: string, b: string): string {
  return a <= b ? a : b
}

/**
 * 목표가 끝난 날. 아직 진행 중이면 null 입니다. 그 목표의 반복 카드는 이 날까지만 합니다. (그날은 함)
 *
 * - 완료(done): D-day. 결과는 D-day 부터 적을 수 있어서(isGoalResultDue) D-day 까지는 한 것으로 봅니다.
 * - 그만둠(givenUp): 그만둔 날. 그만둘 때 giveUpGoal 이 lastCheckedAt 을 찍습니다. D-day 가 더 이르면 D-day.
 *   다른 기기에서 그만둬서 그만둔 날을 모르면(서버에 lastCheckedAt 칸이 없음) null 을 돌려주고, 카드 쪽에서 정합니다.
 * - 진행 중(active): 오늘이 D-day 를 지났으면 D-day, 아니면 null (D-day 를 뒤로 미루면 다시 null 이 됩니다)
 *
 *   (D-day 10/30)
 *   goalEndDay({ status: 'done', … }, '2026-11-02')                                  -> '2026-10-30'
 *   goalEndDay({ status: 'givenUp', lastCheckedAt: 10/20 낮 }, '2026-10-25')         -> '2026-10-20'
 *   goalEndDay({ status: 'givenUp', lastCheckedAt: undefined }, '2026-10-25')        -> null
 *   goalEndDay({ status: 'active', … }, '2026-10-30')                                -> null  (D-day 당일은 아직)
 *   goalEndDay({ status: 'active', … }, '2026-10-31')                                -> '2026-10-30'
 */
export function goalEndDay(
  goal: Pick<Goal, 'status' | 'dDay' | 'lastCheckedAt'>,
  todayKey: string,
): string | null {
  if (goal.status === 'done') return goal.dDay
  if (goal.status === 'givenUp') {
    return goal.lastCheckedAt === undefined
      ? null
      : earlierKey(toDayKey(goal.lastCheckedAt), goal.dDay)
  }
  return todayKey > goal.dDay ? goal.dDay : null
}

/**
 * 카드 한 장이 가져야 할 그만하는 날. undefined 면 끝 없이 반복입니다.
 * 목표와 이어진 반복 카드만 봅니다. 1회성 카드 · 목표 없는 카드 · 목표를 못 찾은 카드는 지금 값을 그대로 둡니다.
 *
 * - 그만둔 날을 모르는 목표(위 null)는 이미 정해 둔 값이 있으면 그대로, 없으면 오늘과 D-day 중 이른 날로 정합니다.
 *   (오늘로 정해 두면 다음 날 다시 계산해도 바뀌지 않습니다)
 * - 시작한 날보다 앞이 되면 시작한 날로 맞춥니다. (서버가 "시작한 날보다 앞" 을 400 으로 거절해서)
 */
function wantedEndDate(card: Card, goals: Goal[], todayKey: string): string | undefined {
  if (isOneOffCard(card) || !card.goalId) return card.endDate
  const goal = goals.find((item) => item.id === card.goalId)
  if (!goal) return card.endDate

  let end = goalEndDay(goal, todayKey)
  if (goal.status === 'givenUp' && end === null) {
    end = card.endDate ?? earlierKey(todayKey, goal.dDay)
  }
  if (end === null) return undefined
  return end < card.date ? card.date : end
}

/**
 * 끝난 목표의 반복 카드에 그만하는 날을 채운 새 카드 목록을 돌려줍니다. 바뀐 카드가 없으면 받은 목록 그대로입니다.
 * (그대로면 저장하지 않아도 된다는 뜻이라, 부르는 쪽이 === 로 비교합니다)
 *
 *   (오늘 10/25, 목표 g1 을 10/20 에 그만둠, 카드 c1 은 g1 의 월 · 수 루틴)
 *   withGoalCardEnds([c1], [g1], '2026-10-25') -> [{ …c1, endDate: '2026-10-20' }]
 *   withGoalCardEnds([그 결과], [g1], '2026-10-26') -> 받은 목록 그대로 (이미 맞음)
 */
export function withGoalCardEnds(cards: Card[], goals: Goal[], todayKey: string): Card[] {
  let isChanged = false
  const next = cards.map((card) => {
    const endDate = wantedEndDate(card, goals, todayKey)
    if (endDate === card.endDate) return card
    isChanged = true
    if (endDate !== undefined) return { ...card, endDate }
    // 끝 없이 반복으로 되돌릴 때는 칸을 아예 뺍니다. (저장 · 비교할 때 endDate: undefined 가 남지 않게)
    const copy = { ...card }
    delete copy.endDate
    return copy
  })
  return isChanged ? next : cards
}
