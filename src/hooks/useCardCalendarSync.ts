import { useIsServerData } from '@/hooks/useIsServerData'
import { addPendingDeletes, removedCardKeys, syncCardsToCalendar } from '@/lib/cardCalendar'
import { CARDS_CHANGED_EVENT, type CardsChangedDetail } from '@/lib/cards'
import { CALENDAR_CONNECTED_EVENT } from '@/lib/googleCalendar'
import { useEffect } from 'react'

// 카드가 바뀐 뒤 이만큼 기다렸다가 맞춥니다. AI 계획처럼 카드가 한꺼번에 여러 장 바뀌어도 한 번만 맞추려고.
const SYNC_DELAY_MS = 1500

/**
 * 카드를 구글 캘린더 일정으로 맞춥니다. (#736, 규칙은 lib/cardCalendar.ts)
 * 모든 화면에 늘 있는 Layout 에서 한 번만 부릅니다. 테스트 로그인이면 아무것도 하지 않습니다(서버 카드 번호가 없어서).
 *
 *   - 앱을 열 때 한 번
 *   - 카드가 바뀔 때마다 (이 기기에서 바꿈 · 서버에서 받음 둘 다) 1.5초 뒤
 *   - 구글 캘린더를 연결했을 때
 * 구글 캘린더를 연결하지 않았거나 연결이 끝났으면 맞추기는 그냥 끝납니다. (다시 연결하면 그때 맞춤)
 */
export function useCardCalendarSync(): void {
  const isServerData = useIsServerData()

  useEffect(() => {
    if (!isServerData) return
    let timerId: number | undefined
    let isRunning = false
    let runAgain = false

    async function run() {
      // 맞추는 중에 또 바뀌면, 지금 것을 끝낸 뒤 한 번 더 맞춥니다. (두 번이 동시에 돌면 일정이 두 번 생겨서)
      if (isRunning) {
        runAgain = true
        return
      }
      isRunning = true
      try {
        await syncCardsToCalendar()
      } catch {
        // 인터넷이 끊겼거나 연결이 끝났습니다. 다음에 카드가 바뀌거나 다시 연결하면 또 맞춥니다.
      }
      isRunning = false
      if (runAgain) {
        runAgain = false
        schedule()
      }
    }

    function schedule() {
      window.clearTimeout(timerId)
      timerId = window.setTimeout(() => void run(), SYNC_DELAY_MS)
    }

    function handleCardsChanged(event: Event) {
      const { prev, next } = (event as CustomEvent<CardsChangedDetail>).detail
      // 사라진 카드는 지울 목록에 적어 둡니다. (연결이 끝나 있어도 다음에 지우려고)
      addPendingDeletes(removedCardKeys(prev, next))
      schedule()
    }

    window.addEventListener(CARDS_CHANGED_EVENT, handleCardsChanged)
    window.addEventListener(CALENDAR_CONNECTED_EVENT, schedule)
    schedule()
    // 로그아웃하거나 화면을 떠날 때 듣기를 멈춥니다.
    return () => {
      window.clearTimeout(timerId)
      window.removeEventListener(CARDS_CHANGED_EVENT, handleCardsChanged)
      window.removeEventListener(CALENDAR_CONNECTED_EVENT, schedule)
    }
  }, [isServerData])
}
