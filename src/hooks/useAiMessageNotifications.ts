import { AI_MESSAGES_CHANGE_EVENT, countUnreadAiMessages, loadAiMessages } from '@/lib/aiMessages'
import { getCareLimits } from '@/lib/careLimits'
import { getTodayKey } from '@/lib/date'
import { loadExamDates, loadSavedWritings } from '@/lib/diarySafety'
import { getMessageSettings } from '@/lib/messageSettings'
import {
  canSendAiMessageNotification,
  getNotificationPermission,
  showAiMessageNotification,
  toQuietHours,
} from '@/lib/notifications'
import { getSafetyBrakeResult } from '@/lib/safetyBrake'
import { loadData, loadList, saveData } from '@/lib/storage'
import { useAuth } from '@/hooks/useAuth'
import { useEffect } from 'react'

// 한 번 알림을 보낸 메시지의 id 를 저장해 두는 키. 새로고침하거나 다른 페이지로 가도
// 똑같은 메시지로 또 알림이 뜨지 않게 막아줍니다.
const NOTIFIED_IDS_KEY = 'ai-message-notified-ids'

// 오늘 알림을 몇 번 보냈는지 저장해 두는 키. 하루 메시지 수(#60)를 지키는 데 씁니다.
const SENT_TODAY_KEY = 'ai-message-sent-today'

/** 오늘 보낸 알림 개수. date 가 오늘이 아니면 어제 기록이라 0 으로 칩니다. */
interface SentToday {
  date: string
  count: number
}

/**
 * 아직 알림을 보내지 않은 안 읽은 메시지를 찾아 시스템 알림으로 띄웁니다.
 *
 * 알림을 보내기 전에 아래 설정을 모두 지킵니다.
 * - 연락 금지 시간, 하루 메시지 수 (#60 메시지 설정)
 * - 관리 강도 최대 한도 (#59)
 * - 안전 브레이크 (#95): 체크인·일기·성찰 일기에 저장된 기분과 글, 그리고 시험 날짜(#80)로 판정합니다.
 *   시험 직전 3일·직후 2일에는 채찍 메시지(3~4단계) 알림이 멈춥니다.
 */
function notifyUnreadMessages(): void {
  // 알림 권한이 없으면 아무것도 하지 않습니다.
  // (예전에는 권한이 없어도 "이미 알린 메시지" 로 적어 두어서, 나중에 알림을 켜도 그 메시지는 영영 알림이 안 왔습니다)
  if (getNotificationPermission() !== 'granted') return

  // 알림 화면을 보고 있는 중이면 휴대폰 알림을 또 띄우지 않습니다. (화면에서 이미 보이고, 화면이 곧 "읽음" 으로 바꿉니다)
  // "이미 알렸다" 고 적지도 않아서, 화면을 떠난 뒤에도 안 읽은 채로 남은 것이 있으면 그때 알립니다.
  if (window.location.pathname === '/notifications' && document.visibilityState === 'visible')
    return
  const messages = loadAiMessages()
  if (countUnreadAiMessages(messages) === 0) return

  const notifiedIds = new Set(loadList<string>(NOTIFIED_IDS_KEY))
  // 아직 검사하지 않은 안 읽은 메시지만 고릅니다.
  const targets = messages.filter((message) => !message.read && !notifiedIds.has(message.id))
  if (targets.length === 0) return

  // 먼저 "검사했다" 고 적어 둡니다. 보냈든 조건에 걸려 건너뛰었든, 같은 메시지를 또 검사하지 않기 위해서입니다.
  // 알림을 띄우는 일은 조금 기다려야 해서(아래 await), 그 사이에 이 검사가 한 번 더 돌아도 두 번 보내지 않게 먼저 적습니다.
  saveData(NOTIFIED_IDS_KEY, [...notifiedIds, ...targets.map((message) => message.id)])

  const settings = getMessageSettings()
  const limits = getCareLimits()
  const today = getTodayKey()

  // 체크인·일기·성찰 일기에 저장된 글과 기분을 모두 안전 브레이크 입력으로 씁니다.
  const { texts, moods } = loadSavedWritings()
  const brake = getSafetyBrakeResult({
    now: new Date(),
    recentTexts: texts,
    recentMoods: moods,
    exams: loadExamDates(),
    quietHours: toQuietHours(settings),
  })

  /** 오늘 보낸 알림 개수를 저장소에서 읽습니다. (저장된 값이 깨져 있을 수 있어서 모양을 확인하고 씁니다) */
  function readSentCountToday(): number {
    const savedSent = loadData<Partial<SentToday> | null>(SENT_TODAY_KEY, null)
    const hasTodayCount = savedSent?.date === today && typeof savedSent.count === 'number'
    // 날짜가 지났으면(또는 값이 없으면) 0 부터 다시 셉니다.
    return hasTodayCount ? (savedSent.count ?? 0) : 0
  }

  function writeSentCountToday(count: number) {
    saveData<SentToday>(SENT_TODAY_KEY, { date: today, count: Math.max(0, count) })
  }

  /** 고른 메시지를 하나씩 알림으로 띄우고, 오늘 보낸 개수를 저장합니다. */
  async function sendNotifications() {
    for (const message of targets) {
      // 알림을 띄우는 일은 기다려야 해서(아래 await), 이 함수가 두 번 겹쳐 돌 수 있습니다.
      // 시작할 때 개수를 한 번만 읽어 두면 둘 다 같은 숫자에서 출발해 하루 한도를 넘기므로, 메시지마다 저장소에서 다시 읽습니다.
      const hasRoomToday = readSentCountToday() < settings.dailyCount
      const canSend = canSendAiMessageNotification({
        careLevel: message.careLevel,
        brake,
        maxCareLevel: limits.maxCareLevel,
      })
      if (!hasRoomToday || !canSend) continue

      // 띄우기 전에 자리를 먼저 하나 잡아 둡니다. (기다리는 동안 겹쳐 도는 쪽이 이 자리를 보고 한도를 지킵니다)
      writeSentCountToday(readSentCountToday() + 1)
      // 브라우저가 막으면 false 가 옵니다. 실제로 뜬 것만 세어야 해서, 안 뜨면 잡아 둔 자리를 돌려줍니다.
      const isShown = await showAiMessageNotification(message)
      if (!isShown) writeSentCountToday(readSentCountToday() - 1)
    }
  }
  // void: 끝나기를 기다리지 않습니다. 알림은 화면과 상관없이 뒤에서 뜹니다.
  void sendNotifications()
}

/**
 * 앱이 열려 있는 동안, 안 읽은 새 알림을 시스템 알림(휴대폰·컴퓨터의 알림)으로도 띄웁니다.
 * Layout 에서 한 번만 불러서 씁니다.
 *
 * - 앱을 열었을 때 한 번 확인합니다.
 * - 알림이 새로 쌓일 때마다 다시 확인합니다. (예: 계획 시각이 지나서 알림이 쌓인 바로 그때. lib/appAlertCheck.ts)
 *   예전에는 앱을 열 때만 확인해서, 쓰는 도중에 쌓인 알림은 다음에 앱을 열어야 떴습니다.
 */
export function useAiMessageNotifications(): void {
  const { isLoggedIn } = useAuth()

  useEffect(() => {
    // 로그인 전에는 알리지 않습니다. 같이 쓰는 기기에서 로그아웃한 뒤, 이전 사람의 메시지 내용이 브라우저 알림으로 뜨면 안 되기 때문입니다.
    if (!isLoggedIn) return

    notifyUnreadMessages()

    // 알림 목록이 바뀌었다는 신호(lib/aiMessages.ts 의 saveAiMessages 가 보냅니다)를 듣습니다.
    window.addEventListener(AI_MESSAGES_CHANGE_EVENT, notifyUnreadMessages)
    return () => window.removeEventListener(AI_MESSAGES_CHANGE_EVENT, notifyUnreadMessages)
  }, [isLoggedIn])
}
