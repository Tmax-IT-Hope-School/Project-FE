import { useAuth } from '@/hooks/useAuth'
import { useIsServerData } from '@/hooks/useIsServerData'
import { serverCardsQuery } from '@/lib/cardsApi'
import { getTodayKey } from '@/lib/date'
import { shouldRetryQuery } from '@/lib/queryRetry'
import { loadServerPullState, pullServerHistory } from '@/lib/serverHistoryPull'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

/**
 * 진짜 로그인이면 앱을 열 때 서버의 공부 기록 · 미루기/실패 · 휴식 · 체크인을 이 기기로 받아 옵니다. (규칙은 lib/serverHistoryPull.ts)
 * Layout 에서 useCardSync 다음에 한 번만 부릅니다.
 *
 * 서버의 카드를 다 받은 뒤에 시작합니다. 기록의 카드 번호를 이 기기 카드 id 로 바꿔야 하기 때문입니다.
 * 이 계정으로 처음 받았을 때 더한 것이 있으면 새로고침합니다. (화면들은 저장소를 처음 열 때만 읽습니다)
 * 그 뒤로 받은 것은 새로고침 없이 저장만 해 두고, 다음에 그 화면을 열 때 보입니다. (쓰는 도중에 화면이 바뀌지 않게)
 */
export function useServerHistoryPull(): void {
  const { user } = useAuth()
  const isServerData = useIsServerData()
  const userId = user?.id

  // useCardSync 와 같은 쿼리라서 서버에 한 번 더 묻지 않고 같은 결과를 나눠 씁니다.
  const { data: serverCards } = useQuery({ ...serverCardsQuery(), enabled: isServerData })

  const { data: pulled } = useQuery({
    queryKey: ['server-history-pull', userId],
    queryFn: async () => {
      const isFirst = loadServerPullState()?.userId !== userId
      const added = await pullServerHistory(userId as string, getTodayKey())
      return { isFirst, added }
    },
    enabled: isServerData && userId !== undefined && serverCards !== undefined,
    // 앱을 열 때 한 번만 받습니다. (다시 받는 것은 다음에 앱을 열 때)
    staleTime: Infinity,
    retry: shouldRetryQuery,
  })

  useEffect(() => {
    if (pulled?.isFirst && pulled.added > 0) window.location.reload()
  }, [pulled])
}
