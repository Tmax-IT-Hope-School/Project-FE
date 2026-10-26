import { useCards } from '@/hooks/useCards'
import { getTodayKey } from '@/lib/date'
import { getServerRanges, mergeServerSessions } from '@/lib/historySessions'
import { sessionsByRangeQuery } from '@/lib/sessionsApi'
import { loadSessionSyncState } from '@/lib/sessionSync'
import type { StudySession } from '@/types'
import { useSuspenseQueries } from '@tanstack/react-query'
import { useState } from 'react'

/**
 * 서버의 공부 기록(최근 6개월)을 31일씩 나눠 받아서, 이 기기 기록과 합친 목록을 돌려줍니다. (lib/historySessions.ts)
 * 기록 탭(RecordsPage)과 통계 탭(StatsPage)이 같이 씁니다. 같은 주소를 받으므로 한 탭에서 받은 것을 다른 탭이 다시 받지 않습니다.
 *
 * ⚠️ useSuspenseQueries 를 써서, 받는 동안 이 훅을 부른 컴포넌트가 멈춥니다. 바깥을 AsyncBoundary 로 감싸 주세요.
 *    진짜 로그인일 때만 부릅니다. (테스트 로그인은 서버가 없음, useIsServerData)
 *
 *   const sessions = useServerMergedSessions(localSessions)
 */
export function useServerMergedSessions(localSessions: StudySession[]): StudySession[] {
  const [todayKey] = useState(getTodayKey)
  const { cards } = useCards()
  const results = useSuspenseQueries({
    queries: getServerRanges(todayKey).map((range) => sessionsByRangeQuery(range.from, range.to)),
  })
  return mergeServerSessions({
    local: localSessions,
    server: results.flatMap((result) => result.data),
    sentServerIds: Object.values(loadSessionSyncState().sent),
    cards,
  })
}
