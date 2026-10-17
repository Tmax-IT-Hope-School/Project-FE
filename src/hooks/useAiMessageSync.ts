import { useAuth } from '@/hooks/useAuth'
import { ApiError } from '@/lib/api'
import { loadAiMessages, markAsNotified, saveAiMessages } from '@/lib/aiMessages'
import {
  fetchNewServerMessages,
  getLatestServerMessageId,
  mergeServerMessages,
  nextPollDelayMs,
} from '@/lib/aiMessagesApi'
import { TEST_TOKEN } from '@/lib/testLogin'
import { useEffect } from 'react'

/**
 * 서버가 만든 메시지를 받아서 알림 목록에 더합니다. (#256)
 *   - 앱을 열 때 한 번, 그다음 1분마다, 탭으로 다시 돌아왔을 때 받습니다.
 *   - 연달아 실패하면 기다리는 시간을 늘립니다. (1분 -> 2분 -> 4분 … 최대 10분. lib/aiMessagesApi.ts 의 nextPollDelayMs)
 *   - 테스트 로그인(서버가 모르는 가짜 토큰)이나 로그아웃 상태에서는 받지 않습니다.
 *   - 받은 메시지는 localStorage 의 알림 목록에 합치므로, 알림 화면 · 헤더의 빨간 점 · 시스템 알림은 따로 고칠 것이 없습니다.
 *
 * 레이아웃(Layout)에서 한 번만 부릅니다.
 */
export function useAiMessageSync(): void {
  const { token } = useAuth()
  const canSync = token !== null && token !== TEST_TOKEN

  useEffect(() => {
    if (!canSync) return

    let cancelled = false
    let running = false
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    function schedule() {
      clearTimeout(timer)
      if (cancelled) return
      timer = setTimeout(sync, nextPollDelayMs(failures))
    }

    async function sync() {
      // 이미 받는 중이면 겹쳐서 받지 않습니다. (탭 전환과 1분 타이머가 동시에 올 수 있습니다)
      if (running || cancelled) return
      running = true
      try {
        const current = loadAiMessages()
        const latestId = getLatestServerMessageId(current)
        const received = await fetchNewServerMessages(latestId)
        // 받는 동안 다른 곳에서 알림이 바뀌었을 수 있어서, 합치기 직전에 다시 읽습니다.
        const merged = mergeServerMessages(loadAiMessages(), received)
        // 이 기기에서 처음 받는 메시지들은 옛 메시지일 수 있어서, 휴대폰 알림을 한꺼번에 띄우지 않습니다. (알림 화면에는 보입니다)
        if (latestId === null) markAsNotified(received.map((message) => message.id))
        if (merged && !cancelled) saveAiMessages(merged)
        failures = 0
      } catch (error) {
        // 로그인이 풀린 것(401)은 곧 로그인 화면으로 가므로 더 시도하지 않습니다.
        if (error instanceof ApiError && error.status === 401) {
          cancelled = true
          return
        }
        failures += 1
      } finally {
        running = false
      }
      schedule()
    }

    function handleVisible() {
      if (document.visibilityState !== 'visible') return
      // 탭으로 돌아오면 기다리던 타이머를 건너뛰고 바로 받습니다.
      clearTimeout(timer)
      void sync()
    }

    void sync()
    document.addEventListener('visibilitychange', handleVisible)
    return () => {
      cancelled = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', handleVisible)
    }
  }, [canSync])
}
