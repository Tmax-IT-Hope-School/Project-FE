import { hasGrantedAllScopesGoogle, useGoogleLogin, useGoogleOAuth } from '@react-oauth/google'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useIsServerData } from '@/hooks/useIsServerData'
import { clearCalendarAlarms } from '@/lib/calendarAlarmsApi'
import {
  CALENDAR_SCOPE,
  canWriteCalendar,
  disconnectCalendar,
  getCalendarStatus,
  saveCalendarToken,
  type CalendarStatus,
} from '@/lib/googleCalendar'

/**
 * 구글 캘린더 연결 · 끊기와 지금 상태입니다. (홈 달력이 씁니다, lib/googleCalendar.ts)
 *
 *   const connection = useCalendarConnect()
 *   connection.status        -> 'unavailable' | 'off' | 'expired' | 'on'
 *   connection.canWrite      -> 카드를 구글 일정으로 넣을 수 있는지 (읽기 권한만 받은 옛 연결이면 false, #736)
 *   connection.connect()     -> 구글 창을 띄워 캘린더 권한 받기 (버튼을 누른 그 순간에 불러야 합니다)
 *   connection.disconnect()  -> 연결 끊기 (구글 쪽 허락도 취소 · 서버에 올린 알림용 일정도 지움)
 */
export function useCalendarConnect() {
  const queryClient = useQueryClient()
  const isServerData = useIsServerData()
  // 구글 연결 창 스크립트가 준비됐는지. (App.tsx 의 GoogleOAuthProvider 가 미리 불러 둡니다)
  const { scriptLoadedSuccessfully } = useGoogleOAuth()
  // 지금 연결 상태. 연결 · 끊기 뒤에 다시 읽어서 바꿉니다.
  const [status, setStatus] = useState<CalendarStatus>(() => getCalendarStatus())
  const [canWrite, setCanWrite] = useState(() => canWriteCalendar())
  const [isConnecting, setIsConnecting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  /** 구글 창이 끝났을 때. 실패했으면 안내 문장을 받고, 성공했으면 null 입니다. */
  function finish(failMessage: string | null) {
    setIsConnecting(false)
    setErrorMessage(failMessage)
    setStatus(getCalendarStatus())
    setCanWrite(canWriteCalendar())
  }

  // 누르면 구글 창을 띄워 캘린더 권한을 받는 함수를 만듭니다. (@react-oauth/google)
  // flow: 'implicit' = 창에서 바로 출입증(access token)을 받는 방식. 서버가 필요 없습니다.
  // prompt: '' = 처음 한 번만 "허락할까요?" 를 묻습니다. 한 시간 뒤 다시 연결할 때는 창이 잠깐 떴다가 바로 닫힙니다.
  const openGoogleWindow = useGoogleLogin({
    flow: 'implicit',
    scope: CALENDAR_SCOPE,
    prompt: '',
    onSuccess: (tokenResponse) => {
      // 구글 창에서 캘린더 체크를 풀고 허락할 수도 있어서 한 번 더 확인합니다.
      if (!hasGrantedAllScopesGoogle(tokenResponse, CALENDAR_SCOPE)) {
        finish('캘린더 권한에 체크해야 연결돼요. 다시 연결해 주세요.')
        return
      }
      saveCalendarToken(tokenResponse.access_token, tokenResponse.expires_in)
      // 새 출입증으로 구글 일정을 다시 받아오게, 예전에 받아 둔 것을 버립니다.
      void queryClient.invalidateQueries({ queryKey: ['google-calendar'] })
      finish(null)
    },
    // 구글 창에서 허락하지 않았을 때
    onError: () => finish('권한을 허락하지 않아서 연결하지 못했어요.'),
    // 창을 그냥 닫았거나, 팝업이 막혀서 창이 안 떴을 때
    onNonOAuthError: () =>
      finish('연결을 마치지 않았어요. 창이 안 떴다면 브라우저의 팝업 차단을 풀어 주세요.'),
  })

  function connect() {
    setErrorMessage(null)
    setIsConnecting(true)
    // 버튼을 누른 그 순간에 창을 띄웁니다. 중간에 기다렸다가 띄우면 브라우저가 팝업을 막습니다.
    openGoogleWindow()
  }

  function disconnect() {
    disconnectCalendar()
    queryClient.removeQueries({ queryKey: ['google-calendar'] })
    // 서버에 올려 둔 일정(10분 전 알림용)도 지웁니다. 실패해도 지난 일정은 하루 뒤 서버가 지웁니다.
    if (isServerData) void clearCalendarAlarms().catch(() => {})
    setErrorMessage(null)
    setStatus(getCalendarStatus())
    setCanWrite(canWriteCalendar())
  }

  return {
    status,
    canWrite,
    /** 구글 창을 띄울 준비가 됐는지. false 면 연결 버튼을 잠깐 막아 둡니다 */
    isReady: scriptLoadedSuccessfully,
    isConnecting,
    errorMessage,
    connect,
    disconnect,
  }
}

/** useCalendarConnect 가 돌려주는 값의 모양. 연결 상태를 다른 컴포넌트에 넘길 때 씁니다 */
export type CalendarConnection = ReturnType<typeof useCalendarConnect>
