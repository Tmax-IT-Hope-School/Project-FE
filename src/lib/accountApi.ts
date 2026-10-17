/**
 * 로그인한 사람이 자기 계정을 관리할 때 서버를 부르는 함수들입니다. (화면은 pages/AccountPage.tsx)
 *
 * 서버(BE)와 정한 약속입니다. (BE 저장소의 docs/API.md "내 계정", BE 이슈 #101) 전부 로그인이 필요합니다.
 *   내 정보 보기    GET  /auth/profile                                                    -> 200 Profile
 *   내 정보 고치기  PUT  /auth/profile   { name, nickname, schoolCode, schoolName, diaryAnalysis } -> 200 Profile
 *   로그아웃        POST /auth/logout                                                     -> 204
 *   탈퇴            POST /auth/withdraw  { credential }                                    -> 204
 *   실패            값이 틀리거나 구글 확인에 실패하면 400 / 로그인이 풀렸으면 401
 *
 * 계정은 모두 구글 계정이라 비밀번호가 없습니다. 그래서 비밀번호 바꾸기는 없고, 탈퇴할 때는 구글로 한 번 더 확인합니다.
 */
import { ApiError, api, isConnectionError } from '@/lib/api'
import { getAuthToken } from '@/lib/authStorage'
import { TEST_TOKEN } from '@/lib/testLogin'
import { turnOffWebPush, unsubscribeThisDevice } from '@/lib/webPush'
import { queryOptions } from '@tanstack/react-query'

/** 서버 응답을 기다리는 최대 시간(밀리초). 서버가 멈춰도 로딩이 영원히 끝나지 않으면 안 되기 때문입니다. */
const REQUEST_TIMEOUT_MS = 10000

/** 서버가 돌려주는 내 정보 */
export interface Profile {
  email: string
  /** 이름 (실명) */
  name: string
  /** 앱에서 부르는 이름 */
  nickname: string
  /** 고른 고등학교의 번호와 이름. 고르지 않았으면 둘 다 null */
  schoolCode: string | null
  schoolName: string | null
  /** [선택 동의] 일기·감정 기록을 분석에 써도 되는지 */
  diaryAnalysis: boolean
}

/** 내 정보를 고칠 때 서버에 보내는 값. 고칠 수 있는 것을 한꺼번에 보냅니다. (이메일은 바꿀 수 없습니다) */
export type ProfileUpdateInput = Omit<Profile, 'email'>

/** 서버가 준 값이 약속한 모양이 맞는지 확인합니다. (서버 응답도 그대로 믿지 않고 확인합니다) */
function isProfile(value: unknown): value is Profile {
  if (typeof value !== 'object' || value === null) return false
  const profile = value as Record<string, unknown>
  return (
    typeof profile.email === 'string' &&
    typeof profile.name === 'string' &&
    typeof profile.nickname === 'string' &&
    (profile.schoolCode === null || typeof profile.schoolCode === 'string') &&
    (profile.schoolName === null || typeof profile.schoolName === 'string') &&
    typeof profile.diaryAnalysis === 'boolean'
  )
}

async function fetchProfile(): Promise<Profile> {
  const result = await api<unknown>('/auth/profile', {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  // 502: 서버가 이상한 응답을 줬다는 뜻으로 씁니다.
  if (!isProfile(result)) throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
  return result
}

/**
 * 내 정보의 쿼리 설정입니다. 화면에서는 useSuspenseQuery(profileQuery()) 로 받아옵니다. (docs/DATA-FETCHING.md)
 * queryKey 에 사람을 구분하는 값이 없는 이유: 로그인한 사람의 것 하나뿐이고, 로그아웃할 때 보관함에서 지우기 때문입니다.
 */
export function profileQuery() {
  return queryOptions({
    queryKey: ['profile'],
    queryFn: fetchProfile,
    // 400·404 같은 거절은 다시 시도해도 같아서, 다시 시도하지 않습니다.
    retry: false,
  })
}

/** 내 정보를 고치고, 고친 뒤의 내 정보를 돌려줍니다. 실패하면 에러를 던집니다. */
export async function updateProfile(input: ProfileUpdateInput): Promise<Profile> {
  const result = await api<unknown>('/auth/profile', {
    method: 'PUT',
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!isProfile(result)) throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
  return result
}

/**
 * 서버의 로그인 토큰을 지웁니다. 실패해도 에러를 던지지 않습니다.
 *
 * 로그아웃은 서버가 꺼져 있어도 되어야 합니다. 그래서 이 함수의 결과와 상관없이 화면은 로그아웃을 진행합니다.
 * (서버에 닿지 못하면 그 토큰은 30일 뒤에 스스로 끝납니다)
 *
 * ⚠️ 이 기기의 로그인 정보를 지우기 "전에" 불러야 합니다. 지운 뒤에는 보낼 토큰이 없습니다.
 * 부르는 쪽(설정 화면)은 이 함수가 끝나기를 기다리지 않고 바로 로그인 정보를 지웁니다. 그래서 이 함수는 맨 처음에
 * 토큰을 읽어 두고, 서버를 부르는 두 요청(로그아웃 · 푸시 끄기)에 그 토큰을 직접 붙여서 보냅니다.
 * (예전에는 푸시 끄기를 먼저 기다린 뒤에 로그아웃을 불러서, 그때는 토큰이 이미 지워져 토큰 없이 나갔고
 *  서버의 로그인 토큰이 30일 동안 살아 있었습니다)
 */
export async function logoutOnServer(): Promise<void> {
  const token = getAuthToken()
  // 토큰이 없거나 테스트 로그인(가짜 토큰)이면 서버에 알릴 것이 없습니다. 이 기기의 푸시 구독만 정리합니다.
  const authHeaders =
    token !== null && token !== TEST_TOKEN ? { Authorization: `Bearer ${token}` } : undefined

  if (!authHeaders) {
    // 서버가 모르는 테스트 로그인이거나 로그인 정보가 없으면, 이 기기의 구독만 지웁니다.
    await unsubscribeThisDevice()
    return
  }

  // 이 기기의 푸시 알림도 끕니다. 같은 기기를 다른 사람이 쓰면, 내 알림(생각 습관 작전)이 그 사람에게 가지 않게 하려는 것입니다.
  // 순서가 중요합니다. 서버의 로그인 토큰을 먼저 무효로 만들면 구독 삭제가 401 로 거절돼 서버에 구독이 남으므로,
  // 구독 삭제를 끝낸 뒤에 로그아웃을 알립니다. (둘 다 실패해도 로그아웃은 계속합니다)
  await turnOffWebPush(authHeaders).catch(() => undefined)
  await api<void>('/auth/logout', {
    method: 'POST',
    headers: authHeaders,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => {
    // 일부러 아무것도 하지 않습니다. (위 설명)
  })
}

/**
 * 탈퇴합니다. 서버의 계정과 기록이 지워집니다. 실패하면 에러를 던집니다.
 * credential 은 구글 버튼을 한 번 더 눌러 받은 신분증(ID 토큰)입니다. 서버가 가입한 그 구글 계정이 맞는지 확인합니다. (다르면 400)
 */
export async function withdraw(credential: string): Promise<void> {
  await api<void>('/auth/withdraw', {
    method: 'POST',
    body: JSON.stringify({ credential }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

/**
 * 계정 관련 요청이 실패했을 때 화면에 보여줄 한 줄을 고릅니다.
 *
 *   서버가 거절(400 · 404 등) -> 서버가 준 메시지  (예: '이름은 2자 이상으로 적어 주세요')
 *   서버에 닿지 못함      -> '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'
 */
export function getAccountErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (isConnectionError(error)) return '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'
  return '알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해 주세요.'
}
