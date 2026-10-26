/**
 * 지난 통화 목록을 서버에서 받아 옵니다. (STARFLOW D19 — 마무리한 통화를 다시 볼 곳이 없었음)
 * 화면은 pages/CallHistoryPage.tsx 입니다.
 *
 * 서버(BE)와 정한 약속입니다. (BE 저장소의 docs/API.md "내 통화 기록") 로그인이 필요합니다.
 *   요청  GET /calls
 *   응답  200 [{ callId, date, summary, bias, missReason, promiseIf, promiseThen, promiseKept }]
 *         오늘을 넣어 최근 30일, 최근 것부터. 마무리한 통화만 나오고, 위기 표현이 감지된 통화는 빠집니다.
 *         끝낸 채팅(글로 하는 통화)도 같이 나옵니다. 서버가 통화와 채팅을 나눠 주지 않아서 화면도 한 목록으로 보여 줍니다.
 *   실패  401 (로그인 풀림)
 *
 * 확인 통화였으면 요약 끝에 '이해도: 조금 헷갈림' 이 붙어 옵니다. 떼어 내서 배지로 보여 줍니다. (lib/checkCall.ts, BE #327)
 * 오늘의 약속(promiseIf · promiseThen)은 #417 에서 통화 결과 화면에 보이지 않기로 해서, 이 목록에서도 읽지 않습니다.
 */
import { api, ApiError } from '@/lib/api'
import { isStringOrNull, isThinkingHabit, type ThinkingHabit } from '@/lib/callReview'
import { splitUnderstanding, type Understanding } from '@/lib/checkCall'
import { isDateKey } from '@/lib/date'
import { queryOptions } from '@tanstack/react-query'

/** 서버가 오래 답하지 않으면 기다리지 않습니다. (다른 *Api.ts 와 같은 10초) */
const REQUEST_TIMEOUT_MS = 10000

/** 지난 통화 하나 */
export interface PastCall {
  callId: string
  /** 통화한 날 'YYYY-MM-DD' (새벽 4시 기준) */
  date: string
  /** 통화 요약. 이해도 문구는 떼어 낸 것입니다. 못 만들었으면 null */
  summary: string | null
  /** 확인 통화에서 코치가 말한 이해도. 확인 통화가 아니었으면 null */
  understanding: Understanding | null
  /** 대답에서 보인 생각 습관. 없었으면 null */
  bias: ThinkingHabit | null
}

/**
 * 서버 응답 한 줄 → PastCall. 모양이 틀리면 null
 *
 *   toPastCall({ callId: '12', date: '2026-10-14', summary: '극한 정의를 설명했어. 이해도: 조금 헷갈림', bias: null, … })
 *     -> { callId: '12', date: '2026-10-14', summary: '극한 정의를 설명했어.', understanding: '조금 헷갈림', bias: null }
 */
export function toPastCall(value: unknown): PastCall | null {
  if (typeof value !== 'object' || value === null) return null
  const item = value as Record<string, unknown>
  if (typeof item.callId !== 'string' || typeof item.date !== 'string' || !isDateKey(item.date)) {
    return null
  }
  if (!isStringOrNull(item.summary)) return null
  if (item.bias !== null && !isThinkingHabit(item.bias)) return null
  const split = item.summary === null ? null : splitUnderstanding(item.summary)
  return {
    callId: item.callId,
    date: item.date,
    // 이해도만 있고 요약이 비면(드묾) 요약은 없는 것으로 봅니다.
    summary: split && split.summary !== '' ? split.summary : null,
    understanding: split?.understanding ?? null,
    bias: item.bias,
  }
}

/** 지난 통화 목록을 받습니다. 목록이 아니면 502, 서버가 거절하면 그 에러를 던집니다. 모양이 틀린 한 줄은 건너뜁니다. */
export async function fetchPastCalls(): Promise<PastCall[]> {
  const result = await api<unknown>('/calls', { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!Array.isArray(result)) throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
  const calls: PastCall[] = []
  for (const item of result) {
    const call = toPastCall(item)
    if (call) calls.push(call)
  }
  return calls
}

/** 지난 통화 쿼리. 못 받으면 에러라서 화면의 AsyncBoundary 가 실패 안내를 보여 줍니다. */
export function pastCallsQuery() {
  return queryOptions({
    queryKey: ['calls'],
    queryFn: fetchPastCalls,
  })
}
