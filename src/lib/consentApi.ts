/**
 * 내 약관 동의 상태를 보고, 최신 약관에 다시 동의하는 함수입니다. (BE 저장소 docs/API.md "개인정보 동의", FE#512)
 *
 *   GET  /auth/consent  -> 200 { currentVersion, agreedVersion, agreedAt, needsConsent }
 *   POST /auth/consent  { terms, privacy, over14, version } -> 201 (위와 같은 모양, needsConsent 는 false)
 *     - 409: 낡은 약관 버전을 보냈거나, 이미 최신 약관에 동의함 (둘 다 저장되지 않음)
 *
 * 최신 약관에 동의하지 않은 사람은 저장(POST · PUT · PATCH)이 403 CONSENT_REQUIRED 로 막힙니다.
 * 보기 · 지우기 · 로그아웃 · 탈퇴는 동의하지 않아도 됩니다.
 */
import { ApiError, api } from '@/lib/api'
import { CONSENT_VERSION } from '@/lib/signup'
import { queryOptions } from '@tanstack/react-query'

/** 내 동의 상태 (서버 응답 모양 그대로) */
export interface ConsentStatus {
  /** 서버가 지금 받는 약관 버전 (예: 'v1') */
  currentVersion: string
  /** 내가 마지막으로 동의한 약관 버전. 동의한 적이 없으면 null */
  agreedVersion: string | null
  /** 내가 마지막으로 동의한 시각(밀리초). 동의한 적이 없으면 null */
  agreedAt: number | null
  /** true 면 최신 약관에 다시 동의해야 저장할 수 있습니다. */
  needsConsent: boolean
}

/** 다시 동의할 때 체크하는 것들 */
export interface ConsentChecks {
  /** [필수] 서비스 이용약관 */
  terms: boolean
  /** [필수] 개인정보 수집·이용 */
  privacy: boolean
}

/**
 * 동의 팝업이 지금 무엇을 보여 줘야 하는지.
 *   'none'          : 이미 최신 약관에 동의함 → "동의돼 있어요" 만 보여 주고 닫기
 *   'app-outdated'  : 서버의 약관이 이 앱이 아는 것보다 새것 → 새로 고쳐야 새 약관이 보임
 *   'needs-consent' : 약관을 보여 주고 동의받기
 *
 *   getConsentProblem({ needsConsent: false, … }, 'v1')                    -> 'none'
 *   getConsentProblem({ needsConsent: true, currentVersion: 'v2', … }, 'v1') -> 'app-outdated'
 *   getConsentProblem({ needsConsent: true, currentVersion: 'v1', … }, 'v1') -> 'needs-consent'
 */
export function getConsentProblem(
  status: ConsentStatus,
  appVersion: string,
): 'none' | 'app-outdated' | 'needs-consent' {
  if (!status.needsConsent) return 'none'
  if (status.currentVersion !== appVersion) return 'app-outdated'
  return 'needs-consent'
}

/** 필수 두 가지에 체크했고 만 14세 이상이라고 골라야 동의 버튼이 눌립니다. */
export function canAgree(checks: ConsentChecks, isOver14: boolean | null): boolean {
  return checks.terms && checks.privacy && isOver14 === true
}

function isConsentStatus(value: unknown): value is ConsentStatus {
  if (typeof value !== 'object' || value === null) return false
  const status = value as Record<string, unknown>
  return (
    typeof status.currentVersion === 'string' &&
    (status.agreedVersion === null || typeof status.agreedVersion === 'string') &&
    (status.agreedAt === null || typeof status.agreedAt === 'number') &&
    typeof status.needsConsent === 'boolean'
  )
}

function toStatus(value: unknown): ConsentStatus {
  if (!isConsentStatus(value)) throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
  return value
}

async function fetchConsentStatus(): Promise<ConsentStatus> {
  return toStatus(await api<unknown>('/auth/consent'))
}

/** 내 동의 상태 쿼리. 팝업을 열 때마다 새로 받습니다. */
export function consentStatusQuery() {
  return queryOptions({
    queryKey: ['consent-status'],
    queryFn: fetchConsentStatus,
    staleTime: 0,
  })
}

/** 최신 약관(이 앱의 CONSENT_VERSION)에 다시 동의합니다. 만 14세 이상 확인도 같이 보냅니다. */
export async function agreeToConsent(checks: ConsentChecks): Promise<ConsentStatus> {
  const result = await api<unknown>('/auth/consent', {
    method: 'POST',
    body: JSON.stringify({
      terms: checks.terms,
      privacy: checks.privacy,
      over14: true,
      version: CONSENT_VERSION,
    }),
  })
  return toStatus(result)
}
