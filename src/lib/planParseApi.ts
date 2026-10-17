/**
 * 한 문장을 서버(GPT)에 보내 계획 초안 여러 개로 바꾸는 함수입니다. (#248)
 * 아무것도 저장하지 않습니다. 저장은 학생이 미리보기를 확인한 뒤 따로 합니다. (원칙: 숫자는 코드가, 말은 AI 가)
 *
 * 서버와 정한 약속입니다. (BE 저장소의 docs/API.md "말로 계획 세우기", BE 이슈 #86) 로그인이 필요합니다.
 *   POST /study-plans/parse  { date, text }  -> 200 { showHelp, drafts: [{ date, subjectId | null, content, targetMinutes, startTime | null, kind }] }
 *   - date 는 모든 초안이 들어갈 날짜입니다. text 는 200자까지.
 *   - subjectId 는 내 과목 안에서만 고르고, 없으면 null 입니다. (새 과목을 만들지 않습니다) 노는 계획은 항상 null 입니다.
 *   - startTime 은 문장에 시각이 있을 때만 채우고, 없으면 null 입니다.
 *   - 초안은 10개까지입니다. 문장에서 계획을 못 찾으면 drafts 가 빈 배열입니다.
 *   - 위기 표현이 있으면 GPT 를 부르지 않고 { showHelp: true, drafts: [] } 를 줍니다. 화면은 미리보기 대신 도움 안내를 먼저 보여 줍니다.
 *   실패  400 문장이 비었거나 200자를 넘음 · 401 로그인 풀림 · 429 오늘 AI 사용량을 다 씀(하루 20번) · 503 GPT 가 꺼져 있거나 실패함
 *   서버가 준 message 는 사람이 읽는 한국어 문장이라 화면에 그대로 보여줘도 됩니다. (getApiErrorMessage)
 */
import { ApiError, api } from '@/lib/api'
import type { PlanKind } from '@/types'

/** 서버 응답을 기다리는 최대 시간(밀리초). 서버가 GPT 를 최대 10초 기다리므로 그보다 조금 더 줍니다. */
const REQUEST_TIMEOUT_MS = 15000

/** 문장의 최대 글자 수 (서버와 같습니다) */
export const VOICE_PLAN_MAX_LENGTH = 200

/** AI 가 만든 계획 초안 하나. subjectId 가 null 이면 공부 계획인데 과목을 못 정한 것입니다. */
export interface PlanDraft {
  date: string
  subjectId: string | null
  content: string
  targetMinutes: number
  /** 'HH:MM'. 문장에 시각이 없었으면 null */
  startTime: string | null
  kind: PlanKind
}

export interface ParsePlansResult {
  /** true 면 문장에 위기 표현이 있어서 AI 를 쓰지 않은 것입니다. 초안 대신 도움 안내를 보여 줍니다. */
  showHelp: boolean
  drafts: PlanDraft[]
}

function isPlanDraft(value: unknown): value is PlanDraft {
  if (typeof value !== 'object' || value === null) return false
  const draft = value as Record<string, unknown>
  return (
    typeof draft.date === 'string' &&
    (draft.subjectId === null || typeof draft.subjectId === 'string') &&
    typeof draft.content === 'string' &&
    typeof draft.targetMinutes === 'number' &&
    Number.isFinite(draft.targetMinutes) &&
    (draft.startTime === null || typeof draft.startTime === 'string') &&
    (draft.kind === 'study' || draft.kind === 'play')
  )
}

/**
 * 한 문장을 계획 초안으로 바꿉니다. 실패하면 ApiError 를 던집니다. (서버 응답 모양이 이상하면 502)
 *
 *   const { showHelp, drafts } = await parsePlans('2026-10-18', '3시부터 수학 2시간, 영어 단어 30분')
 */
export async function parsePlans(date: string, text: string): Promise<ParsePlansResult> {
  const result = await api<unknown>('/study-plans/parse', {
    method: 'POST',
    body: JSON.stringify({ date, text }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (typeof result !== 'object' || result === null) {
    throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
  }
  const record = result as Record<string, unknown>
  if (typeof record.showHelp !== 'boolean' || !Array.isArray(record.drafts)) {
    throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
  }
  if (!record.drafts.every(isPlanDraft)) {
    throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
  }
  return { showHelp: record.showHelp, drafts: record.drafts }
}
