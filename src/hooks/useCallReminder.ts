import {
  CALL_TIME_STORAGE_KEY,
  LAST_RING_STORAGE_KEY,
  isBusyForCall,
  isTypingInField,
  shouldRingNow,
  showCallNotification,
} from '@/lib/callReminder'
import { isServerDataMode } from '@/lib/dataMode'
import { loadExamDates, loadSavedWritings } from '@/lib/diarySafety'
import { loadFocusMode } from '@/lib/focusMode'
import { isTimerLocked } from '@/lib/timerLock'
import { getMessageSettings } from '@/lib/messageSettings'
import { toQuietHours } from '@/lib/notifications'
import { getSafetyBrakeResult } from '@/lib/safetyBrake'
import { loadData, saveData } from '@/lib/storage'
import { useAuth } from '@/hooks/useAuth'
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

// 시간을 확인하는 간격(밀리초)입니다. 정해진 시간으로부터 5분 안이면 울리므로 10초마다 봐도 충분합니다.
const CHECK_INTERVAL_MS = 10_000

/**
 * 앱이 열려 있는 동안, 정해 둔 "전화 받을 시간" 이 되면 브라우저 알림을 띄우고 전화 수신 화면(/call)으로 보냅니다.
 *
 * - 이미 전화 화면(/call, /call/active)에 있으면 건드리지 않습니다. (통화 중에 또 울리면 안 됩니다)
 * - 집중 모드 중이거나 글을 쓰는 화면이면 건너뜁니다. (lib/callReminder.ts 의 isBusyForCall)
 * - 하루에 한 번만 울립니다. (언제 울렸는지 저장해 둡니다)
 * - 오늘 공부를 안 했어도 울립니다. 통화의 공부 조건은 2026-10-22 에 뺐습니다. (lib/checkCall.ts)
 * - 테스트 로그인(시연)이면 울리지 않습니다. 통화를 걸 수 없기 때문입니다.
 * - 앱이 닫혀 있을 때는 동작하지 않습니다. (웹 푸시는 서버와 서비스 워커가 필요합니다)
 *
 * 라우터 안쪽에 있는 컴포넌트에서 한 번만 부르면 됩니다. (지금은 Layout)
 */
export function useCallReminder() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { isLoggedIn } = useAuth()

  // 10초마다 도는 확인 함수는 처음 만들어질 때의 값만 기억하므로, 지금 주소는 ref 에 따로 적어 둡니다.
  const pathnameRef = useRef(pathname)
  useEffect(() => {
    pathnameRef.current = pathname
  }, [pathname])

  useEffect(() => {
    // 로그인 전(로그아웃한 뒤 켜 둔 로그인 화면 등)에는 전화를 걸지 않습니다. 로그인하면 갑자기 전화 화면이 뜨기 때문입니다.
    if (!isLoggedIn) return

    function check() {
      // 테스트 로그인은 통화를 걸 수 없어서 전화 화면으로 데려가지 않습니다. (임시 키는 서버에서만 받음, 2026-10-22 QA)
      if (!isServerDataMode()) return
      // 이미 전화 화면이면 다시 띄우지 않습니다.
      if (pathnameRef.current.startsWith('/call')) return
      // 집중 모드 중이거나 글을 쓰는 화면이면 이번 전화는 건너뜁니다. (화면이 넘어가면 집중이 깨지거나 쓰던 글이 사라집니다)
      // 공부 세션 중(타이머 잠금, #396)에도 집중 모드처럼 이번 전화를 건너뜁니다.
      if (isBusyForCall(loadFocusMode() !== null || isTimerLocked())) return
      // 글을 적는 칸에 커서가 있으면(계획 이름 · 시험 추가 · 건의 · 비밀번호 등) 이번 전화는 건너뜁니다. 화면이 넘어가면 적던 내용이 사라집니다.
      if (isTypingInField(document.activeElement)) return

      const savedTime = loadData<unknown>(CALL_TIME_STORAGE_KEY, null)
      const lastRingAt = loadData<unknown>(LAST_RING_STORAGE_KEY, null)
      if (!shouldRingNow(new Date(), savedTime, lastRingAt)) return

      // 연락 금지 시간이거나 위기 표현 · 오랜 기분 저하가 감지된 상태면 전화를 걸지 않습니다. (#60, #95)
      // 설정 화면에 "이 시간에는 메시지도 전화도 안 와요" 라고 약속했기 때문입니다.
      // (학생이 상담 탭에서 직접 거는 통화는 막지 않습니다)
      // AI 메시지 알림(useAiMessageNotifications)과 같은 방법으로 판정합니다.
      const { texts, moods, crisisFlagged } = loadSavedWritings()
      const brake = getSafetyBrakeResult({
        now: new Date(),
        recentTexts: texts,
        recentMoods: moods,
        crisisFlagged,
        exams: loadExamDates(),
        quietHours: toQuietHours(getMessageSettings()),
      })
      if (brake.quiet || brake.stopWhip || brake.recoveryMode) return

      // 먼저 "울렸다" 고 기록해서, 아래에서 에러가 나도 같은 전화가 계속 반복되지 않게 합니다.
      saveData(LAST_RING_STORAGE_KEY, Date.now())
      showCallNotification()
      navigate('/call')
    }

    // 열자마자 한 번 확인하고(시간이 막 지난 직후에 열 수도 있으니까), 그다음부터 10초마다 확인합니다.
    check()
    const intervalId = setInterval(check, CHECK_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [navigate, isLoggedIn])
}
