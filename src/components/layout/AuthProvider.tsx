import { AuthContext, type AuthContextValue } from '@/hooks/useAuth'
import {
  AUTH_STORAGE_KEY,
  UNAUTHORIZED_EVENT,
  loadAuth,
  loggedOutState,
  type AuthState,
} from '@/lib/authStorage'
import { disconnectCalendar } from '@/lib/googleCalendar'
import { queryClient } from '@/lib/queryClient'
import { saveData } from '@/lib/storage'
import { unsubscribeThisDevice } from '@/lib/webPush'
import type { AuthUser } from '@/types'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

interface AuthProviderProps {
  children: ReactNode
}

/**
 * 로그인 상태를 들고 있다가 아래의 모든 화면에 나눠 주는 컴포넌트입니다. (App.tsx 에서 앱 전체를 감쌉니다)
 *
 * 참고: 토큰을 localStorage 에 두면 페이지 안의 스크립트가 읽을 수 있습니다.
 * 지금은 팀이 정한 방식(#6 저장 함수)을 쓰고, 서버를 연결할 때 저장 방식을 다시 정합니다.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  // 처음 한 번만 저장소에서 불러옵니다. 그래서 새로고침해도 로그인이 유지됩니다.
  const [auth, setAuth] = useState<AuthState>(loadAuth)

  // 로그인·로그아웃으로 바뀔 때마다 저장합니다. 로그아웃하면 토큰도 null 로 덮어써서 남지 않습니다.
  useEffect(() => {
    saveData(AUTH_STORAGE_KEY, auth)
  }, [auth])

  // useCallback: 렌더링될 때마다 함수가 새로 만들어지지 않게 해서, 받아 쓰는 쪽이 괜히 다시 그려지지 않게 합니다.
  const login = useCallback((user: AuthUser, token: string) => {
    setAuth({ user, token })
  }, [])

  const logout = useCallback(() => {
    // 서버에서 받아 보관해 둔 것(내 정보 등)을 지웁니다. 안 지우면 같은 기기에서 다른 사람이 로그인했을 때 앞사람의 정보가 잠깐 보입니다.
    queryClient.clear()
    // 구글 캘린더 연결도 끊습니다. (이 기기의 출입증을 지우고 구글 쪽 허락도 취소)
    // 안 끊으면 같은 기기에서 다음 사람이 로그인했을 때 앞사람의 구글 일정이 보이고, 새 계획이 앞사람의 캘린더에 들어갑니다.
    disconnectCalendar()
    setAuth(loggedOutState)
  }, [])

  // 서버가 "누구인지 모르겠다(401)" 고 하면 api.ts 가 알려 줍니다. 그러면 로그아웃해서,
  // 문지기(RequireAuth)가 로그인 화면으로 보내게 합니다. (#198)
  // 로그인이 만료돼서 서버를 부를 수 없으니, 이 기기의 푸시 구독은 브라우저에서만 지웁니다.
  // 남겨 두면 같은 기기에서 다른 사람이 로그인했을 때 설정에 "켜져 있어요" 가 뜨고 앞사람 알림이 옵니다.
  useEffect(() => {
    function handleUnauthorized() {
      void unsubscribeThisDevice()
      logout()
    }
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized)
  }, [logout])

  // useMemo: 로그인 정보가 바뀔 때만 값을 새로 만듭니다.
  const value = useMemo<AuthContextValue>(
    () => ({
      user: auth.user,
      token: auth.token,
      isLoggedIn: auth.user !== null && auth.token !== null,
      login,
      logout,
    }),
    [auth, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
