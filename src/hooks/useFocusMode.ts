import { getCareLimits } from '@/lib/careLimits'
import {
  FOCUS_MODE_CHANGE_EVENT,
  canUseFocusMode,
  endFocusMode,
  getAutoUnlockReason,
  isSafetyBrakeOnNow,
  loadFocusMode,
  startFocusMode,
} from '@/lib/focusMode'
import { shouldShowCrisisHelp } from '@/lib/diarySafety'
import { SUPPORT_PATH } from '@/lib/helpLines'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

// 안전 브레이크·설정을 다시 확인하는 간격(밀리초). 켜진 동안 30초마다 봅니다.
const AUTO_CHECK_INTERVAL_MS = 30_000

/**
 * 집중 모드(#69)가 켜져 있는지 알려 주고, 켜고 끄는 함수를 줍니다.
 * 다른 화면에서 켜거나 꺼도 이 값이 같이 바뀝니다. (FOCUS_MODE_CHANGE_EVENT 신호를 듣습니다)
 *
 *   const focusMode = useFocusMode()
 *   if (focusMode.isOn) ...
 *   focusMode.start()
 *   focusMode.unlock('엄마가 불러서')
 */
export function useFocusMode() {
  const navigate = useNavigate()
  const [state, setState] = useState(loadFocusMode)

  function unlock(reason: string) {
    endFocusMode(reason, false)
    // 해제 이유에 위기 표현이 있거나 기분이 오래 낮으면 도움 안내로 보냅니다. (QA: 집중 모드 해제 이유)
    if (shouldShowCrisisHelp({ texts: [reason], diaryMoods: [] })) navigate(SUPPORT_PATH)
  }

  useEffect(() => {
    function handleChange() {
      setState(loadFocusMode())
    }
    window.addEventListener(FOCUS_MODE_CHANGE_EVENT, handleChange)
    return () => window.removeEventListener(FOCUS_MODE_CHANGE_EVENT, handleChange)
  }, [])

  return {
    isOn: state !== null,
    startedAt: state?.startedAt ?? null,
    start: () => startFocusMode(),
    /** 사용자가 이유를 적고 직접 해제할 때 씁니다. */
    unlock,
  }
}

/**
 * 집중 모드가 켜져 있는 동안 설정(#59)과 안전 브레이크(#95)를 계속 확인해서,
 * 허용을 껐거나 안전 브레이크가 켜지면 바로 풀어 줍니다. 풀었으면 그 이유를 message 로 알려 줍니다.
 * 모든 화면에 걸쳐 한 번만 돌면 되므로 Layout 에서만 부릅니다.
 */
export function useFocusModeAutoUnlock(isOn: boolean) {
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!isOn) return

    function check() {
      const reason = getAutoUnlockReason({
        canUse: canUseFocusMode(getCareLimits()),
        isSafetyBrakeOn: isSafetyBrakeOnNow(),
      })
      if (reason === null) return
      endFocusMode(reason, true)
      setMessage(reason)
    }

    // 켜지자마자 한 번, 그 뒤로는 30초마다, 그리고 다른 창에 갔다 돌아올 때마다 확인합니다.
    check()
    const intervalId = setInterval(check, AUTO_CHECK_INTERVAL_MS)
    window.addEventListener('focus', check)
    return () => {
      clearInterval(intervalId)
      window.removeEventListener('focus', check)
    }
  }, [isOn])

  return { message, dismiss: () => setMessage(null) }
}
