import { useAuth } from '@/hooks/useAuth'
import { isInApp, onAppMessage, saveAppNotificationPermission, sendToApp } from '@/lib/appBridge'
import { CALL_TIME_STORAGE_KEY, isCallTimeInQuietHours, parseCallTime } from '@/lib/callReminder'
import { loadCardAlarms, loadSessionAlarms, MAX_ALARMS } from '@/lib/cardAlarms'
import { coachNudgeTextsQuery, loadCoachNudgeAlarms } from '@/lib/coachNudges'
import { isServerDataToken } from '@/lib/dataMode'
import { moveDateKey, toDayKey } from '@/lib/date'
import { loadExamDates, loadSavedWritings } from '@/lib/diarySafety'
import { getMessageSettings } from '@/lib/messageSettings'
import { toQuietHours } from '@/lib/notifications'
import { queryClient } from '@/lib/queryClient'
import { getSafetyBrakeResult } from '@/lib/safetyBrake'
import { loadData } from '@/lib/storage'
import { TIMER_LOCK_EVENT } from '@/lib/timerLock'
import { router } from '@/router'
import { useEffect, useRef } from 'react'

// 카드 · 전화 시각이 바뀌었는지 확인하는 간격(밀리초). 다른 알림 훅(useAppAlerts)과 같이 10초마다 봅니다.
const SYNC_INTERVAL_MS = 10_000
// 매일 전화 알림을 누르면 갈 주소 (전화 수신 화면)
const CALL_URL = '/call'

// 'ready' 를 보냈는지. 개발 모드(StrictMode)는 effect 를 두 번 돌려서, 훅 밖에 두고 한 번만 보냅니다.
let isReadySent = false

/**
 * 휴대폰 앱 안에서 열렸을 때 앱과 연결합니다. 앱 밖(브라우저)에서는 아무 일도 하지 않습니다. (lib/appBridge.ts)
 * 어느 화면에서든 돌아야 해서 App.tsx 에서 한 번만 부릅니다. (라우터 밖이라 주소 이동은 router.navigate 로 합니다)
 *
 * 1. 다 뜨면 'ready' 를 보내고, 앱이 보내는 'navigate'(알림을 눌렀을 때)로 그 주소에 갑니다.
 * 2. 카드 알림(lib/cardAlarms.ts) · 코치 알림(lib/coachNudges.ts) · 진행 중 공부 세션 알림(공부 끝 · 15분 멈춤)과
 *    매일 전화 시각을 10초마다 확인해서, 바뀌었을 때만 앱에 보냅니다.
 *    코치 알림의 AI 문장은 진짜 로그인일 때 오늘 · 내일 치를 하루 한 번 받아 둡니다. (받기 전 · 못 받으면 정해 둔 문장)
 *    ⚠️ 'alarms.set' 은 앱의 예약을 통째로 바꾸므로 세 목록을 합쳐서 한 번에 보냅니다.
 *    세션을 시작 · 일시정지 · 다시 시작 · 끝낼 때와 앱이 뒤로 갈 때는 10초를 기다리지 않고 바로 보냅니다.
 *    (앱이 뒤로 가면 웹이 곧 멈춰서, 그 전에 마지막 상태를 예약해 두려고)
 */
export function useAppBridge(): void {
  const { isLoggedIn, token } = useAuth()
  const isServerData = isServerDataToken(token)
  // 마지막으로 보낸 내용. 같은 내용을 10초마다 또 보내지 않으려고 기억해 둡니다. (undefined = 아직 안 보냄)
  const lastAlarmsJson = useRef<string | undefined>(undefined)
  const lastCallTime = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (!isInApp()) return
    const stopListening = onAppMessage((message) => {
      if (message.type === 'navigate') void router.navigate(message.payload.url)
      // 휴대폰 설정에서 알림 권한이 바뀌면 적어 둡니다. (lib/notifications.ts 가 읽습니다)
      if (message.type === 'notify.permission') {
        saveAppNotificationPermission(message.payload.permission)
      }
    })
    // 듣기 시작한 다음에 보냅니다. 앱은 'ready' 를 받자마자 기다리던 'navigate' 를 보내기 때문입니다.
    if (!isReadySent) {
      isReadySent = true
      sendToApp('ready', {})
    }
    return stopListening
  }, [])

  useEffect(() => {
    if (!isInApp()) return

    function sync() {
      // 로그인 전(로그아웃 뒤)에는 빈 목록 · 전화 끔을 보내서, 앞사람의 알림이 오지 않게 합니다.
      const now = Date.now()
      // 진짜 로그인이면 코치 알림의 AI 문장(오늘 · 내일)을 받아 둡니다. 하루 한 번만 서버를 부르고, 받으면 다음 확인 때 반영됩니다.
      if (isLoggedIn && isServerData) {
        const todayKey = toDayKey(now)
        for (const dateKey of [todayKey, moveDateKey(todayKey, 1)]) {
          queryClient.fetchQuery(coachNudgeTextsQuery(dateKey, todayKey)).catch(() => null)
        }
      }
      // 카드 · 코치 · 진행 중 세션 알림을 합쳐 가까운 순서로 48개까지 (앱이 한 번에 예약하는 최대 개수)
      const alarms = isLoggedIn
        ? [...loadSessionAlarms(now), ...loadCardAlarms(now), ...loadCoachNudgeAlarms(now)]
            .sort((a, b) => a.at - b.at)
            .slice(0, MAX_ALARMS)
        : []
      const alarmsJson = JSON.stringify(alarms)
      if (alarmsJson !== lastAlarmsJson.current) {
        lastAlarmsJson.current = alarmsJson
        sendToApp('alarms.set', { alarms })
      }

      const callTime = isLoggedIn ? loadCallTime() : null
      if (callTime !== lastCallTime.current) {
        lastCallTime.current = callTime
        sendToApp('call.schedule', { time: callTime, url: CALL_URL })
      }
    }

    sync()
    const intervalId = setInterval(sync, SYNC_INTERVAL_MS)
    // 앱이 다시 앞으로 오거나 뒤로 갈 때 바로 맞춥니다. (뒤에 있는 동안은 10초 확인이 멈출 수 있습니다)
    const stopListening = onAppMessage((message) => {
      if (message.type === 'appState') sync()
    })
    // 공부 세션을 시작 · 일시정지 · 다시 시작 · 끝내면 useCardSession 이 이 신호를 보냅니다. 바로 맞춥니다.
    window.addEventListener(TIMER_LOCK_EVENT, sync)
    return () => {
      clearInterval(intervalId)
      stopListening()
      window.removeEventListener(TIMER_LOCK_EVENT, sync)
    }
  }, [isLoggedIn, isServerData])
}

/**
 * 저장된 전화 시각('HH:MM'). null 이면 앱의 전화 알림을 끕니다.
 * 웹도 전화를 걸지 않는 때(hooks/useCallReminder.ts)는 null 입니다: 안 정함 · 연락 금지 시간 안 · 위기 표현 감지(#95)
 */
function loadCallTime(): string | null {
  const saved = loadData<unknown>(CALL_TIME_STORAGE_KEY, null)
  if (typeof saved !== 'string' || parseCallTime(saved) === null) return null
  if (isCallTimeInQuietHours(saved, toQuietHours(getMessageSettings()))) return null

  const { texts, moods, crisisFlagged } = loadSavedWritings()
  const brake = getSafetyBrakeResult({
    now: new Date(),
    recentTexts: texts,
    recentMoods: moods,
    crisisFlagged,
    exams: loadExamDates(),
  })
  return brake.stopWhip ? null : saved
}
