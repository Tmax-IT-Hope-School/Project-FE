import { useIsServerData } from '@/hooks/useIsServerData'
import { pushUnsentQuizResults, QUIZ_STATS_QUERY_KEY } from '@/lib/quizResultsApi'
import { QUIZ_RESULTS_CHANGED_EVENT } from '@/lib/studyQuiz'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

/** 못 보낸 것이 있는지 다시 확인하는 간격 (1분) */
const CHECK_INTERVAL_MS = 60 * 1000

/**
 * 채팅 확인 문제의 결과를 서버로 보냅니다. (#653, 규칙은 lib/quizResultsApi.ts)
 * 모든 화면에 늘 있는 Layout 에서 한 번만 부릅니다. 테스트 로그인이면 아무것도 하지 않습니다.
 *
 *   - 문제를 다 풀어서 결과가 저장되면(saveQuizResult) 바로 보냅니다.
 *   - 앱을 열 때, 그리고 1분마다 못 보낸 것을 다시 보냅니다. (인터넷이 끊겼다 돌아온 경우)
 *   - 하나라도 보냈으면 기록 탭 · 문제 풀이 리포트가 서버 통계를 다시 받게 합니다.
 */
export function useQuizResultSync(): void {
  const isServerData = useIsServerData()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!isServerData) return
    async function push() {
      const didSend = await pushUnsentQuizResults()
      // 서버의 결과가 늘었으니 받아 둔 통계를 "낡았다" 고 표시합니다. (보낸 것을 이 기기 몫으로 다시 빼야 해서)
      if (didSend) void queryClient.invalidateQueries({ queryKey: QUIZ_STATS_QUERY_KEY })
    }
    function handleChange() {
      void push()
    }
    handleChange()
    const timerId = setInterval(handleChange, CHECK_INTERVAL_MS)
    window.addEventListener(QUIZ_RESULTS_CHANGED_EVENT, handleChange)
    // 로그아웃하거나 화면을 떠날 때 멈춥니다.
    return () => {
      clearInterval(timerId)
      window.removeEventListener(QUIZ_RESULTS_CHANGED_EVENT, handleChange)
    }
  }, [isServerData, queryClient])
}
