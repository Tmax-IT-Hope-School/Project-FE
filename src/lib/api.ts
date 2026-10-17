/**
 * 서버(BE)에 요청을 보내는 함수입니다.
 *
 * 서버 주소는 코드에 적지 않고 환경변수(VITE_API_BASE_URL)에서 읽습니다. (#197)
 * 내 컴퓨터용·배포용으로 바꿀 때 코드를 고치지 않고 `.env`(또는 Vercel 설정)만 바꾸면 됩니다.
 * 견본은 저장소 맨 위의 `.env.example` 입니다.
 *
 * 서버를 부르는 모든 화면이 같은 방식으로 동작하도록, 아래 세 가지를 이 파일 한 곳에서 처리합니다. (#198)
 *   1. 서버가 에러일 때 준 메시지를 읽어서 ApiError 에 담습니다.
 *   2. 로그인한 상태면 모든 요청에 토큰을 붙입니다. (Authorization: Bearer 토큰)
 *      테스트 로그인의 토큰은 서버가 모르는 가짜라서 붙이지 않습니다. (lib/testLogin.ts)
 *   3. 서버가 "누구인지 모르겠다(401)" 고 하면 로그인 정보를 지웁니다. 그러면 로그인 화면으로 보내집니다.
 *   4. 서버가 "최신 약관에 동의해야 저장할 수 있다(403 CONSENT_REQUIRED)" 고 하면 창에 알립니다. 그러면 다시 동의하는 팝업이 뜹니다. (#512)
 *
 * ⚠️ 토큰이나 서버가 준 내용(일기·기분 등)은 console.log 로 찍지 않습니다. 개발자 도구에 남으면 안 되기 때문입니다.
 */
import {
  AUTH_STORAGE_KEY,
  CONSENT_REQUIRED_EVENT,
  UNAUTHORIZED_EVENT,
  getAuthToken,
} from '@/lib/authStorage'
import { removeData } from '@/lib/storage'
import { TEST_TOKEN } from '@/lib/testLogin'

/** 환경변수를 안 넣었을 때 쓰는 주소. 내 컴퓨터에서 켠 BE 서버입니다. (BE 의 모든 API 는 /api/v1 로 시작합니다) */
export const DEFAULT_API_BASE_URL = 'http://localhost:8080/api/v1'

/**
 * 서버 주소를 정합니다.
 *   - 환경변수가 있으면 그 값, 없거나 빈 글자면 기본값
 *   - 끝의 '/' 는 지웁니다. (api('/subjects') 와 이어 붙일 때 '//' 가 생기지 않게)
 *
 *   'http://localhost:8080/api/v1/'  -> 'http://localhost:8080/api/v1'
 *   undefined 또는 ''                -> DEFAULT_API_BASE_URL
 */
export function resolveApiBaseUrl(envValue: string | undefined): string {
  const value = envValue?.trim()
  return (value ? value : DEFAULT_API_BASE_URL).replace(/\/+$/, '')
}

const BASE_URL = resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL)

/** 서버가 에러일 때 준 내용에서 꺼낸 이름표(code)와 사람이 읽는 메시지(message) */
export interface ApiErrorDetail {
  code?: string
  message?: string
}

/**
 * 서버가 에러일 때 준 내용(JSON)에서 이름표와 메시지를 꺼냅니다. 못 찾으면 빈 객체입니다.
 *
 * ⚠️ BE 의 에러 모양 문서(docs/API.md, BE 이슈 #5)가 아직 확정되지 않아서, 이슈에 적힌 예시 모양과
 * 흔한 간단한 모양 두 가지를 모두 읽습니다. 문서가 확정되면 이 함수만 맞추면 됩니다.
 *
 *   { "error": { "code": "NOT_FOUND", "message": "계획을 찾을 수 없어요" } } -> { code: 'NOT_FOUND', message: '계획을 찾을 수 없어요' }
 *   { "code": "BAD_REQUEST", "message": "이름이 비었어요" }                   -> { code: 'BAD_REQUEST', message: '이름이 비었어요' }
 *   { "message": "오류" }                                                      -> { message: '오류' }
 *   '서버 오류' (JSON 이 아닌 글자) 또는 null                                   -> {}
 */
export function parseErrorBody(body: unknown): ApiErrorDetail {
  if (typeof body !== 'object' || body === null) return {}
  const record = body as Record<string, unknown>

  // { error: { ... } } 모양이면 안쪽을, 아니면 바깥쪽을 봅니다.
  const source =
    typeof record.error === 'object' && record.error !== null
      ? (record.error as Record<string, unknown>)
      : record

  const detail: ApiErrorDetail = {}
  if (typeof source.code === 'string' && source.code.trim() !== '') detail.code = source.code.trim()
  if (typeof source.message === 'string' && source.message.trim() !== '') {
    detail.message = source.message.trim()
  }
  return detail
}

/** 서버가 200번대가 아닌 응답을 줬을 때 던지는 에러입니다. */
export class ApiError extends Error {
  /** 서버가 준 상태 번호 (예: 400, 404, 500) */
  status: number
  /** 서버가 정한 에러 이름표 (예: 'NOT_FOUND'). 서버가 안 줬으면 없습니다. */
  code?: string

  /**
   * message 는 서버가 준 메시지가 있으면 그것이고, 없으면 "요청에 실패했습니다 (404)" 입니다.
   * 그래서 error.message 를 화면에 그대로 보여줘도 됩니다.
   */
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/**
 * "서버에 연결하지 못한" 에러인지 알려줍니다. 서버가 꺼져 있거나, 주소가 틀리거나, 인터넷이 끊겼거나,
 * 정해 둔 시간(AbortSignal.timeout)이 지난 경우입니다.
 * 서버가 답을 했는데 거절한 경우(400 등)는 ApiError 라서 false 입니다.
 *
 *   서버 꺼짐 -> true   /   ApiError(404) -> false   /   일반 Error -> false
 */
export function isConnectionError(error: unknown): boolean {
  if (error instanceof ApiError) return false
  // 연결 자체가 실패하면 fetch 가 TypeError 를 던집니다.
  if (error instanceof TypeError) return true
  // 시간이 지나서 요청을 끊은 경우
  return (
    error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')
  )
}

/**
 * 어떤 에러든 사용자에게 보여줄 한국어 한 줄로 바꿉니다.
 *
 *   ApiError(서버 메시지 있음)  -> 서버가 준 메시지  (예: '계획을 찾을 수 없어요')
 *   ApiError(서버 메시지 없음)  -> '요청에 실패했습니다 (500)'
 *   연결 실패                   -> '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.'
 *   그 밖의 에러                -> '알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해 주세요.'
 */
export function getApiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (isConnectionError(error)) {
    return '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.'
  }
  return '알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해 주세요.'
}

/** 응답 본문을 JSON 으로 읽습니다. 본문이 없거나 JSON 이 아니면 null 입니다. (에러 응답은 모양이 제각각일 수 있어서) */
async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await response.text())
  } catch {
    return null
  }
}

/**
 * 서버가 401(누구인지 모르겠다)을 줬을 때 로그인 정보를 지우고 앱에 알립니다.
 * AuthProvider 가 이 알림을 받아 로그아웃하면, RequireAuth 가 로그인 화면으로 보냅니다.
 *
 * 요청을 보낸 뒤에 사용자가 다시 로그인해서 토큰이 바뀌었다면 지우지 않습니다. (새 로그인을 날리면 안 되니까요)
 */
function handleUnauthorized(sentToken: string): void {
  if (getAuthToken() !== sentToken) return
  removeData(AUTH_STORAGE_KEY)
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
}

/**
 * 사용 예:
 *   const health = await api<{ status: string }>('/health')              -> { status: 'ok' }
 *   await api('/subjects', { method: 'POST', body: JSON.stringify(s) }) -> 만든 과목
 *   await api('/plans/1', { method: 'DELETE' })                          -> undefined (204 본문 없음)
 *
 * 로그인한 상태면 요청에 `Authorization: Bearer 토큰` 이 자동으로 붙습니다. (직접 넣은 Authorization 이 있으면 그걸 씁니다)
 *
 * 실패하면 에러를 던집니다. 호출하는 쪽은 try/catch 로 받아서 getApiErrorMessage(error) 를 보여주면 됩니다.
 *   - 서버가 거절했다(400·404·500 등)  -> ApiError  (error.status, error.code, error.message)
 *   - 서버가 꺼져 있다 · 연결 실패     -> isConnectionError(error) === true (브라우저의 TypeError 그대로)
 *   - 로그인한 상태에서 401            -> ApiError(401) 를 던지고, 로그인 정보를 지워 로그인 화면으로 보냅니다.
 *     (로그인 전의 401 은 "코드가 틀렸다" 같은 뜻이라 로그인 정보를 건드리지 않고 ApiError 만 던집니다)
 *   - 저장이 403 CONSENT_REQUIRED     -> ApiError(403) 를 던지고, 다시 동의하는 팝업을 띄웁니다. 동의한 뒤 저장을 다시 누르면 됩니다.
 */
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  // 테스트 로그인의 토큰은 가짜라서 서버에 보내지 않습니다. 보내면 서버가 401 로 거절하고,
  // 아래의 "401 이면 로그아웃" 때문에 테스트로 써 보던 사람이 갑자기 로그인 화면으로 튕겨 나갑니다.
  const savedToken = getAuthToken()
  const token = savedToken === TEST_TOKEN ? null : savedToken

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token !== null && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  })

  if (!response.ok) {
    const detail = parseErrorBody(await readJsonSafely(response))
    // 토큰을 보냈는데 401 이면 로그인이 만료됐거나 틀린 것이라, 로그인 정보를 지웁니다.
    if (response.status === 401 && token !== null) handleUnauthorized(token)
    // 최신 약관에 동의하지 않아 저장이 막혔으면 다시 동의하는 팝업을 띄우라고 알립니다. (components/layout/ConsentGate.tsx)
    if (response.status === 403 && detail.code === 'CONSENT_REQUIRED' && token !== null) {
      window.dispatchEvent(new Event(CONSENT_REQUIRED_EVENT))
    }
    throw new ApiError(
      detail.message ?? `요청에 실패했습니다 (${response.status})`,
      response.status,
      detail.code,
    )
  }

  // 204 No Content 처럼 본문이 없는 응답 대비
  if (response.status === 204) return undefined as T

  return (await response.json()) as T
}
