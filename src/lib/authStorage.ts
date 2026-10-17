/**
 * 로그인 정보(사용자·토큰)를 저장소에서 읽는 함수들입니다.
 *
 * React 를 쓰지 않는 파일이라, AuthProvider(화면 쪽)와 api.ts(서버 요청 쪽)가 같이 씁니다.
 * api.ts 는 useAuth() 를 쓸 수 없어서, 요청에 붙일 토큰을 여기서 직접 읽습니다. (#198)
 */
import { loadData } from '@/lib/storage'
import type { AuthUser } from '@/types'

// 저장소에 넣는 이름입니다. (실제 키는 storage.ts 가 앞에 'study-' 를 붙여서 'study-auth' 가 됩니다)
export const AUTH_STORAGE_KEY = 'auth'

/**
 * 서버가 "누구인지 모르겠다(401)" 고 했을 때 api.ts 가 창에 알리는 이벤트 이름입니다.
 * AuthProvider 가 이걸 듣고 로그아웃하면, RequireAuth 가 알아서 로그인 화면으로 보냅니다.
 */
export const UNAUTHORIZED_EVENT = 'auth:unauthorized'

/**
 * 서버가 저장을 "최신 약관에 동의한 뒤에 하세요(403 CONSENT_REQUIRED)" 라고 막았을 때 api.ts 가 창에 알리는 이벤트 이름입니다.
 * ConsentGate 가 이걸 듣고 다시 동의하는 팝업을 띄웁니다. (#512)
 */
export const CONSENT_REQUIRED_EVENT = 'auth:consent-required'

/** 저장해 두는 로그인 정보입니다. 둘 다 null 이면 로그인 전입니다. */
export interface AuthState {
  user: AuthUser | null
  token: string | null
}

export const loggedOutState: AuthState = { user: null, token: null }

/** 저장소에서 꺼낸 값이 우리가 저장한 모양이 맞는지 확인합니다. (깨진 값을 로그인으로 착각하면 안 되기 때문입니다) */
export function isAuthState(value: unknown): value is AuthState {
  if (typeof value !== 'object' || value === null) return false
  const state = value as Record<string, unknown>

  // 로그아웃 상태: 둘 다 null
  if (state.user === null && state.token === null) return true

  // 로그인 상태: 사용자(id·이름)와 토큰이 모두 있어야 합니다.
  const user = state.user as Record<string, unknown> | null
  return (
    typeof user === 'object' &&
    user !== null &&
    typeof user.id === 'string' &&
    typeof user.name === 'string' &&
    typeof state.token === 'string' &&
    state.token !== ''
  )
}

/** 저장된 로그인 정보를 불러옵니다. 없거나 깨져 있으면 "로그인 전" 입니다. */
export function loadAuth(): AuthState {
  const saved = loadData<unknown>(AUTH_STORAGE_KEY, null)
  return isAuthState(saved) ? saved : loggedOutState
}

/** 지금 저장된 로그인 토큰을 돌려줍니다. 로그인 전이면 null 입니다. */
export function getAuthToken(): string | null {
  return loadAuth().token
}
