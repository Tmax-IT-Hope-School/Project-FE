/**
 * AI 의 답을 "메신저처럼" 보여 주는 규칙입니다. (2026-10-18 사용자: "SSE 방식임? 좀 자연스럽게 보이게", #582)
 *
 * 서버는 답을 한 번에 줍니다. 진짜 스트리밍(SSE)을 하지 않는 이유: 서버가 말투 · 금지 표현 · 행동 버튼을
 * **다 검사한 뒤에** 보여 주려고서입니다. (검사 전 글자가 먼저 화면에 나오면 걸러야 할 말이 잠깐이라도 보일 수 있음)
 * 그래서 화면이 받은 답을 이렇게 보여 줍니다.
 *   1. 두세 문장으로 긴 답은 문장 단위로 말풍선 2~3개로 나눕니다. (splitReply)
 *      줄을 바꾼 답(번호 목록 · 풀이 단계)은 나누지 않고 하나로 둡니다. 나누면 줄바꿈이 빈칸으로 바뀌어 목록이 흐트러집니다.
 *   2. 말풍선마다 타자 치듯 글자가 나타나고, 다음 말풍선은 0.5초 쉬고 나옵니다. (revealSchedule · visibleLength)
 *   3. 칩 · 계획 · 문제 카드는 글이 다 나온 뒤에 보입니다. (화면 쪽: pages/ChatRoomPage.tsx)
 * React 를 쓰지 않는 순수 함수입니다.
 */

/** 1초에 나타나는 글자 수 */
export const TYPING_CHARS_PER_SECOND = 40
/** 글자가 나타나는 시간 합의 최대 (밀리초). 답이 길면 이 안에 끝나게 빨라집니다. */
export const MAX_TYPING_MS = 2000
/** 말풍선과 말풍선 사이에 쉬는 시간 (밀리초). "입력 중" 점이 보입니다. */
export const PART_GAP_MS = 500
/** 한 답을 나누는 말풍선 수의 최대 */
export const MAX_PARTS = 3
/** 이보다 짧은 답은 나누지 않습니다. (짧은 말을 쪼개면 오히려 어색해서) */
const MIN_SPLIT_LENGTH = 25

/**
 * 문장이 끝나는 곳의 위치들. "문장부호(. ? ! ~) 바로 뒤에 빈칸이나 줄바꿈" 이 오는 곳입니다.
 * 이런 곳은 끊지 않습니다:
 *   - 숫자 바로 뒤의 점: '3.5점', '1. 개념 정리' (목록 번호)
 *   - 말줄임표: '그런데... 음', '음…'
 */
function sentenceEnds(text: string): number[] {
  const ends: number[] = []
  for (let i = 0; i < text.length - 1; i++) {
    const char = text[i]
    const next = text[i + 1]
    if (!'.?!~'.includes(char) || !/\s/.test(next)) continue
    const previous = text[i - 1] ?? ''
    if (char === '.' && (previous === '.' || /\d/.test(previous))) continue
    ends.push(i + 1)
  }
  return ends
}

/**
 * 답을 말풍선 1~3개로 나눕니다. 짧거나 한 문장이면 그대로 하나입니다.
 * 문장이 4개 이상이면 앞에서부터 고르게 묶어 3개 이하로 합칩니다. (4문장 → 2 · 2, 5문장 → 2 · 2 · 1)
 * 줄바꿈이 든 답은 그대로 하나입니다. (과목 쌤의 번호 목록 · 풀이처럼 줄 모양이 뜻을 가진 답, 2026-10-31)
 *
 *   splitReply('좋아!')                                                 -> ['좋아!']
 *   splitReply('어제 순공 1시간 40분이었어. 꽤 했네! 오늘은 영어부터 할까?')
 *     -> ['어제 순공 1시간 40분이었어.', '꽤 했네!', '오늘은 영어부터 할까?']
 *   splitReply('평균 3.5점이야. 1. 개념 2. 문제 순서로 가자. 어때?')
 *     -> ['평균 3.5점이야.', '1. 개념 2. 문제 순서로 가자.', '어때?']   (3.5 · 1. 에서 안 끊음)
 *   splitReply('풀이는 이래.\n1. 양변에 2를 곱해.\n2. x = 3 이야.')
 *     -> ['풀이는 이래.\n1. 양변에 2를 곱해.\n2. x = 3 이야.']   (줄바꿈이 있어서 그대로)
 */
export function splitReply(text: string): string[] {
  const trimmed = text.trim()
  if (trimmed.length < MIN_SPLIT_LENGTH || trimmed.includes('\n')) return [trimmed]
  const sentences: string[] = []
  let start = 0
  for (const end of sentenceEnds(trimmed)) {
    sentences.push(trimmed.slice(start, end).trim())
    start = end
  }
  sentences.push(trimmed.slice(start).trim())
  const filled = sentences.filter((sentence) => sentence !== '')
  if (filled.length <= 1) return [trimmed]
  if (filled.length <= MAX_PARTS) return filled
  // 4문장 이상: 한 묶음에 넣을 문장 수를 정해 앞에서부터 묶습니다. (4문장 → 2 · 2, 5문장 → 2 · 2 · 1)
  const size = Math.ceil(filled.length / MAX_PARTS)
  const parts: string[] = []
  for (let i = 0; i < filled.length; i += size) parts.push(filled.slice(i, i + size).join(' '))
  return parts
}

/** 말풍선마다 언제 시작해서 얼마 동안 글자가 나오는지 (밀리초, 답을 받은 때부터) */
export interface RevealSchedule {
  starts: number[]
  durations: number[]
  /** 마지막 말풍선의 글자가 다 나오는 때 */
  totalMs: number
}

/**
 * 말풍선들의 시간표. 1초에 40자로 나오되, 글자 시간의 합이 2초를 넘으면 그 안에 끝나게 빨라집니다.
 *
 *   revealSchedule(['어제 순공 1시간 40분이었어.', '꽤 했네!'])
 *     -> { starts: [0, 925], durations: [425, 125], totalMs: 1050 }   (17자 → 425ms, 쉬고 500ms)
 */
export function revealSchedule(parts: string[]): RevealSchedule {
  const totalChars = parts.reduce((sum, part) => sum + part.length, 0)
  const charsPerSecond = Math.max(TYPING_CHARS_PER_SECOND, (totalChars * 1000) / MAX_TYPING_MS)
  const starts: number[] = []
  const durations: number[] = []
  let at = 0
  parts.forEach((part, index) => {
    if (index > 0) at += PART_GAP_MS
    starts.push(at)
    const duration = Math.round((part.length * 1000) / charsPerSecond)
    durations.push(duration)
    at += duration
  })
  return { starts, durations, totalMs: at }
}

/**
 * 지금 보여 줄 글자 수. 아직 시작 전이면 0, 끝났으면 전부입니다.
 *   visibleLength(20, 250, 500) -> 10
 */
export function visibleLength(length: number, elapsedInPart: number, duration: number): number {
  if (elapsedInPart <= 0) return 0
  if (duration <= 0 || elapsedInPart >= duration) return length
  return Math.floor((length * elapsedInPart) / duration)
}
