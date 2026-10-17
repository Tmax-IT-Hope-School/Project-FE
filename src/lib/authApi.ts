import { ApiError, api, isConnectionError } from '@/lib/api'
import type { School } from '@/lib/schoolSearch'
import { CONSENT_VERSION, type SignupConsents } from '@/lib/signup'
import type { AuthUser } from '@/types'

/**
 * 서버(BE)에 로그인하고 가입하는 함수들입니다.
 * 로그인·가입은 구글 하나뿐입니다. (#319) 이메일 가입은 2026-10-15 에, 이메일 로그인은 2026-10-17 에 뺐습니다.
 * 서버(BE)와 정한 약속은 BE 저장소의 docs/API.md "가입 · 로그인" 에 있습니다. (BE 이슈 #19)
 */

/** 서버 응답을 기다리는 최대 시간(밀리초). 서버가 멈춰도 로딩이 영원히 끝나지 않으면 안 되기 때문입니다. */
const REQUEST_TIMEOUT_MS = 10000

/** 로그인에 성공했을 때 서버가 돌려주는 값 */
export interface AuthResult {
  /** 로그인 열쇠(토큰) */
  token: string
  /** 로그인한 사람 */
  user: AuthUser
}

/** 서버가 준 값이 약속한 모양이 맞는지 확인합니다. (서버 응답도 그대로 믿지 않고 확인합니다) */
function isAuthResult(value: unknown): value is AuthResult {
  if (typeof value !== 'object' || value === null) return false
  const result = value as Record<string, unknown>
  const user = result.user as Record<string, unknown> | null

  return (
    typeof result.token === 'string' &&
    result.token !== '' &&
    typeof user === 'object' &&
    user !== null &&
    typeof user.id === 'string' &&
    typeof user.name === 'string'
  )
}

/* ---------- 구글로 시작하기 (#319, BE #19) ----------
 *   시작  POST /auth/google         { credential }                                         -> 200 LOGGED_IN 또는 SIGNUP_REQUIRED
 *   가입  POST /auth/google/signup  { credential, name, nickname, schoolCode, schoolName, consents(terms · privacy · diaryAnalysis · over14 · version) } -> 201 { token, user }
 *   실패  400 (구글 확인 실패 · 한 시간이 지남) / 409 (같은 이메일의 이메일 계정 · 이미 가입) / 503 (서버에 구글 로그인이 꺼짐)
 * credential 은 구글 버튼이 준 신분증(ID 토큰)입니다. 진짜인지는 서버가 구글에 확인합니다.
 */

/** 구글로 시작했을 때의 결과. 가입한 사람이면 로그인 정보, 처음이면 가입 화면을 채울 이름·이메일 */
export type GoogleStartResult =
  | { status: 'LOGGED_IN'; auth: AuthResult }
  | { status: 'SIGNUP_REQUIRED'; name: string; email: string }

/** 구글 버튼이 준 신분증을 서버에 보냅니다. */
export async function startWithGoogle(credential: string): Promise<GoogleStartResult> {
  const result = await api<unknown>('/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const record = (typeof result === 'object' && result !== null ? result : {}) as Record<
    string,
    unknown
  >
  if (record.status === 'LOGGED_IN' && isAuthResult(record)) {
    return { status: 'LOGGED_IN', auth: { token: record.token, user: record.user } }
  }
  if (record.status === 'SIGNUP_REQUIRED' && typeof record.email === 'string') {
    const name = typeof record.name === 'string' ? record.name : ''
    return { status: 'SIGNUP_REQUIRED', name, email: record.email }
  }
  throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
}

/** 구글로 가입할 때 서버에 보내는 값. 이메일은 서버가 구글에서 확인한 값을 써서 보내지 않습니다 */
export interface GoogleSignupInput {
  credential: string
  name: string
  nickname: string
  /** 고른 고등학교. 안 골랐으면 null */
  school: School | null
  consents: SignupConsents
  /** 만 14세 이상이라고 확인했는지. 가입 화면에서 "네" 를 골랐을 때만 true 이고, true 가 아니면 서버가 가입을 거절합니다 */
  isOver14: boolean
}

/** 구글로 가입합니다. 가입과 동시에 로그인돼서 로그인 정보를 돌려줍니다. */
export async function signupWithGoogle(input: GoogleSignupInput): Promise<AuthResult> {
  const result = await api<unknown>('/auth/google/signup', {
    method: 'POST',
    body: JSON.stringify({
      credential: input.credential,
      name: input.name,
      nickname: input.nickname,
      schoolCode: input.school?.code ?? null,
      schoolName: input.school?.name ?? null,
      // 서버는 동의 세 가지에 더해 만 14세 확인(over14)과 동의 문구 버전(version)을 필수로 받습니다. 빠지면 400 입니다.
      consents: { ...input.consents, over14: input.isOver14, version: CONSENT_VERSION },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!isAuthResult(result)) throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
  return result
}

// 서버는 켜져 있는데 이 API 가 없을 때(옛 버전의 서버) 보여줄 안내입니다.
const SERVER_NOT_READY_MESSAGE =
  '서버 로그인이 아직 준비되지 않았어요. 서버가 연결되면 쓸 수 있어요.'
// 서버에 닿지 못했을 때(서버가 꺼져 있음 · 인터넷 끊김 · 응답이 너무 늦음) 보여줄 안내입니다.
const SERVER_UNREACHABLE_MESSAGE = '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'

/**
 * 구글로 시작하기·가입이 실패했을 때 화면에 보여줄 한 줄을 고릅니다.
 *   400 · 409 · 503            -> 서버가 준 메시지 (예: '구글 확인에 실패했어요. 다시 Google로 시작해 주세요')
 *   404 (서버에 이 API 가 없음) -> '서버 로그인이 아직 준비되지 않았어요. …'
 *   서버에 닿지 못함           -> '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'
 */
export function getGoogleAuthErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return SERVER_NOT_READY_MESSAGE
    return error.message
  }
  if (isConnectionError(error)) return SERVER_UNREACHABLE_MESSAGE
  return '알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해 주세요.'
}
