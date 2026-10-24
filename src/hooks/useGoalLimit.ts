import { useIsServerData } from '@/hooks/useIsServerData'
import { getActiveGoals, MAX_ACTIVE_GOALS } from '@/lib/goals'
import { serverGoalsQuery } from '@/lib/goalsApi'
import type { Goal } from '@/types'
import { useQuery } from '@tanstack/react-query'

/**
 * 목표를 하나 더 만들 수 있는지 알려 줍니다. (진행 중 목표는 동시에 3개까지)
 *
 * 이 기기의 목표만 세면 안 되는 때가 있습니다. 다른 기기에서 만든 목표나 예전 데이터가 서버에만 있으면,
 * 이 기기에서는 2개로 보여도 서버에는 3개가 넘어서, 새로 만든 목표를 서버가
 * "진행 중인 목표는 3개까지예요"(409)로 거절합니다. 그러면 그 목표는 이 기기에만 남습니다.
 * 그래서 진짜 로그인이면 서버의 진행 중 목표 수도 같이 보고, 둘 중 큰 쪽으로 판단합니다.
 *
 *   const { canAdd, activeCount, serverOnlyCount } = useGoalLimit(goals)
 */
export function useGoalLimit(goals: Goal[]) {
  const isServerData = useIsServerData()
  // useGoalSync 와 같은 쿼리라서 서버에 한 번 더 묻지 않고 같은 결과를 나눠 씁니다.
  const { data: serverGoals } = useQuery({ ...serverGoalsQuery(), enabled: isServerData })

  const localActive = getActiveGoals(goals).length
  const serverActive = serverGoals
    ? serverGoals.filter((goal) => goal.status === 'active').length
    : 0
  const activeCount = Math.max(localActive, serverActive)

  return {
    /** 하나 더 만들 수 있으면 true */
    canAdd: activeCount < MAX_ACTIVE_GOALS,
    /** 진행 중 목표 수 (이 기기 · 서버 중 큰 쪽) */
    activeCount,
    /** 서버에만 더 있는 진행 중 목표 수 (안내 문구에 씀). 없으면 0 */
    serverOnlyCount: Math.max(0, serverActive - localActive),
  }
}
