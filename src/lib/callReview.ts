/**
 * 통화가 끝난 뒤 서버에 자막을 보내 "오늘의 결론" 을 받아 옵니다. (BE 이슈 #29)
 * 결론에는 요약 · 대답에서 보인 생각 습관(인지편향)과 근거 · 해 볼 행동 · 약속이 들어 있습니다.
 *
 * 서버(BE)와 정한 약속입니다. (BE 저장소의 docs/API.md "AI 통화 마무리") 로그인이 필요합니다.
 *   요청  POST /calls/{callId}/finish   { lines: [{ speaker: 'ai' | 'me', text }] }
 *   응답  200 CallConclusion
 *   실패  404 (내 통화가 아님) / 409 (이미 마무리함) / 503 (AI 가 꺼져 있음 · 정리 실패. 같은 자막으로 다시 보내면 됨)
 *
 * ⚠️ 자막은 학생의 대화입니다. 서버는 정리하는 데만 쓰고 저장하지 않습니다.
 *    이 파일도 자막을 브라우저 저장소에 넣지 않고, console.log 로 찍지 않습니다.
 */
import { ApiError, api } from '@/lib/api'
import { WAITING_TEXT, type SubtitleMessage } from '@/lib/transcript'

// 서버가 GPT 로 정리하는 동안 기다리는 최대 시간(밀리초). 서버는 GPT 를 20초까지 기다립니다.
const REQUEST_TIMEOUT_MS = 30_000
// 서버가 받는 자막의 한도입니다. (BE 의 CallFinishRequest: 200줄, 한 줄 500자)
const MAX_LINES = 200
const MAX_TEXT_LENGTH = 500

/** 서버에 보내는 자막 한 줄. speaker 는 말풍선의 speaker 와 같습니다. ('ai' = AI 코치, 'me' = 나) */
export interface CallLine {
  speaker: 'ai' | 'me'
  text: string
}

/**
 * 대답에서 보인 생각 습관(인지편향) 하나. 이름은 "생각" 에 붙이는 이름입니다.
 * ("너는 계획 오류형이야" 가 아니라 "그런 생각을 '계획 오류' 라고 해")
 */
export interface ThinkingHabit {
  /** 습관을 구분하는 이름. 예: 'PLANNING_FALLACY' */
  key: string
  /** 보여 줄 이름. 예: '계획 오류' */
  label: string
  /** 어떤 생각인지 한 줄 */
  description: string
  /** 그 습관이 보인 근거 한 줄 (내가 한 말의 요지). 없으면 null */
  evidence: string | null
  /** 알아차린 뒤 해 볼 행동 하나 */
  solution: string
}

/** 통화를 마무리하고 받은 "오늘의 결론" */
export interface CallConclusion {
  callId: string
  /** true 면 위기 표현이 감지된 통화입니다. 다른 칸은 모두 null 이고, 도움 안내를 먼저 보여 줍니다. */
  showHelp: boolean
  /** 통화 요약 2~3문장. 못 만들었으면 null */
  summary: string | null
  /** 대답에서 보인 생각 습관. 뚜렷하지 않았으면 null */
  bias: ThinkingHabit | null
  // 서버가 주는 오늘의 약속 · 지난 약속(promiseIf · promiseThen · promiseKept)은 v2 체크인과 함께 #417 에서 쓰지 않기로 해서 읽지 않습니다.
}

/** 결과 화면으로 넘기는 값입니다. 통화 화면이 navigate 의 state 로 넘깁니다. */
export interface CallResultState {
  callId: string
  lines: CallLine[]
}

/**
 * 말풍선 목록을 서버에 보낼 자막으로 바꿉니다.
 * 글자를 기다리던 자리('…')와 빈 말풍선은 빼고, 서버의 한도(200줄 · 한 줄 500자)에 맞게 자릅니다.
 * 줄이 너무 많으면 앞(오래된 것)을 버리고 뒤를 남깁니다. 마무리 이야기는 통화 끝에 하기 때문입니다.
 */
export function toCallLines(messages: SubtitleMessage[]): CallLine[] {
  const lines = messages
    .map((message) => ({ speaker: message.speaker, text: message.text.trim() }))
    .filter((line) => line.text !== '' && line.text !== WAITING_TEXT)
    .map((line) => ({ ...line, text: line.text.slice(0, MAX_TEXT_LENGTH) }))
  return lines.slice(-MAX_LINES)
}

/** 화면 주소에 딸려 온 값(location.state)이 결과 화면이 쓸 수 있는 모양인지 확인합니다. 아니면 null */
export function readCallResultState(state: unknown): CallResultState | null {
  if (typeof state !== 'object' || state === null) return null
  const record = state as Record<string, unknown>
  if (typeof record.callId !== 'string' || record.callId === '') return null
  if (!Array.isArray(record.lines)) return null
  const lines = record.lines.filter(
    (line): line is CallLine =>
      typeof line === 'object' &&
      line !== null &&
      ((line as CallLine).speaker === 'ai' || (line as CallLine).speaker === 'me') &&
      typeof (line as CallLine).text === 'string',
  )
  return { callId: record.callId, lines }
}

export function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

/** 서버가 준 생각 습관이 약속한 모양인지 확인합니다. (지난 통화 목록 lib/callHistoryApi.ts 도 씁니다) */
export function isThinkingHabit(value: unknown): value is ThinkingHabit {
  if (typeof value !== 'object' || value === null) return false
  const habit = value as Record<string, unknown>
  return (
    typeof habit.key === 'string' &&
    typeof habit.label === 'string' &&
    typeof habit.description === 'string' &&
    isStringOrNull(habit.evidence) &&
    typeof habit.solution === 'string'
  )
}

/** 서버가 준 값이 약속한 모양이 맞는지 확인합니다. (서버 응답도 그대로 믿지 않고 확인합니다) */
function isCallConclusion(value: unknown): value is CallConclusion {
  if (typeof value !== 'object' || value === null) return false
  const result = value as Record<string, unknown>
  return (
    typeof result.callId === 'string' &&
    typeof result.showHelp === 'boolean' &&
    isStringOrNull(result.summary) &&
    (result.bias === null || isThinkingHabit(result.bias))
  )
}

/** 통화를 마무리하고 오늘의 결론을 받습니다. 실패하면 에러를 던집니다. (503 이면 다시 시도할 수 있습니다) */
export async function finishCall({ callId, lines }: CallResultState): Promise<CallConclusion> {
  const result = await api<unknown>(`/calls/${encodeURIComponent(callId)}/finish`, {
    method: 'POST',
    body: JSON.stringify({ lines }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  // 502: 서버가 이상한 응답을 줬다는 뜻으로 씁니다.
  if (!isCallConclusion(result)) throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
  return result
}
