import { useEffect } from 'react'
import { CARDS_CHANGED_EVENT, loadSavedCards, saveCards } from '@/lib/cards'
import { getTodayKey } from '@/lib/date'
import { withGoalCardEnds } from '@/lib/goalCardEnd'
import { GOALS_CHANGED_EVENT, loadGoals } from '@/lib/goals'

/** 끝난 목표의 반복 카드에 그만하는 날을 채워 저장합니다. 바뀐 카드가 없으면 저장하지 않습니다. */
function syncGoalCardEnds() {
  const cards = loadSavedCards()
  if (cards === undefined) return
  const next = withGoalCardEnds(cards, loadGoals(), getTodayKey())
  // 같은 목록이면 바뀐 게 없다는 뜻이라 저장하지 않습니다. (저장 → 카드 이벤트 → 다시 부름 이 끝없이 돌지 않게)
  if (next !== cards) saveCards(next)
}

/**
 * 목표를 그만두거나 D-day 가 지나면, 그 목표의 반복 카드(루틴 카드)를 그만하게 합니다. (#734, 규칙은 lib/goalCardEnd.ts)
 * 모든 화면에 늘 있는 Layout 에서 한 번만 부릅니다. 저장은 saveCards 로 해서 서버로도 갑니다. (hooks/useCardSync.ts)
 *
 *   - 앱을 열 때 (자는 사이 D-day 가 지난 것도 여기서 맞춥니다)
 *   - 목표가 저장될 때 (그만두기 · 결과 적기 · D-day 바꾸기)
 *   - 카드가 저장될 때 (서버에서 받은 카드 · 새로 만든 루틴 카드)
 * 테스트 로그인에서도 돕니다. (이 기기의 카드만 고치고, 서버로 보내는지는 useCardSync 가 정합니다)
 */
export function useGoalCardEnds(): void {
  useEffect(() => {
    syncGoalCardEnds()
    window.addEventListener(GOALS_CHANGED_EVENT, syncGoalCardEnds)
    window.addEventListener(CARDS_CHANGED_EVENT, syncGoalCardEnds)
    // 로그아웃하거나 화면을 떠날 때 멈춥니다.
    return () => {
      window.removeEventListener(GOALS_CHANGED_EVENT, syncGoalCardEnds)
      window.removeEventListener(CARDS_CHANGED_EVENT, syncGoalCardEnds)
    }
  }, [])
}
