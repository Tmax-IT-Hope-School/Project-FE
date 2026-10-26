/**
 * 계획 방 「🎯 목표 세우기」 대화 — AI 와 WOOP 순서로 목표 하나를 세우고, 끝나면 목표 초안을 받습니다. (STARFLOW D8, BE #239)
 * 받은 초안은 목표 만들기 화면(/goals/new)에 채워서 학생이 확인한 뒤 [목표 저장] 으로 저장합니다.
 * 저장은 그 화면이 하던 대로 saveGoals → 서버 POST /goals 로 갑니다. (lib/goalSync.ts, 진행 중 목표 3개까지)
 *
 * 서버와 정한 약속입니다. (BE 저장소의 docs/API.md "목표 만들기 대화") 전부 로그인이 필요합니다.
 *   대화 열기    POST /goal-chats                      (본문 없음) -> 200 { chatId, reply, showHelp, helpLines }
 *   말 보내기    POST /goal-chats/{chatId}/messages    { lines }   -> 200 위와 같은 모양
 *   끝내기       POST /goal-chats/{chatId}/finish      { lines }   -> 200 { goalDraft, showHelp, helpLines }
 *                goalDraft 가 null 이면 초안을 못 만든 것(에러 아님). 정하지 못한 칸은 null 입니다.
 *   실패         404 대화가 없거나 2시간이 지남 · 서버가 다시 켜짐 (새로 시작) / 503 AI 가 꺼짐
 *
 * ⚠️ 대화 원문과 초안은 서버가 저장하지 않습니다. 이 파일도 대화를 따로 저장하지 않습니다. (말풍선은 대화방 기록에 남음)
 */
import { api, ApiError } from '@/lib/api'
import type { CallLine } from '@/lib/callReview'
import { createEmptyGoalDraft, type GoalDraft } from '@/lib/goalForm'

/** 서버가 GPT 를 기다리는 시간보다 조금 길게 기다립니다. (채팅과 같은 25초) */
const REQUEST_TIMEOUT_MS = 25_000

/** 목표 대화에서 AI 의 말 하나 */
export interface GoalChatReply {
  chatId: string
  reply: string
  /** true 면 위기 표현이 감지돼 서버가 대화를 닫았습니다. 상담 전화 안내를 보여 줍니다. */
  showHelp: boolean
}

/** 서버가 대화로 채운 목표 초안. 정하지 못한 칸은 null (BE GoalDraft) */
export interface ServerGoalDraft {
  kind: 'score' | 'completion' | null
  title: string | null
  dDay: string | null
  currentScore: string | null
  totalAmount: number | null
  amountUnit: string | null
  benefit: string | null
  cost: string | null
  obstacle: string | null
  plan: string | null
}

/** 끝내기의 답 */
export interface GoalChatFinish {
  /** 초안. 못 만들었으면 null (빈 저장 화면으로 보냄) */
  goalDraft: ServerGoalDraft | null
  showHelp: boolean
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** 서버의 말 하나 → GoalChatReply. 모양이 틀리면 502 에러 */
function toGoalChatReply(value: unknown): GoalChatReply {
  if (typeof value !== 'object' || value === null) throw badResponse()
  const item = value as Record<string, unknown>
  if (
    typeof item.chatId !== 'string' ||
    typeof item.reply !== 'string' ||
    typeof item.showHelp !== 'boolean'
  ) {
    throw badResponse()
  }
  return { chatId: item.chatId, reply: item.reply, showHelp: item.showHelp }
}

/** 서버의 초안 → ServerGoalDraft. 칸마다 모양이 틀리면 그 칸만 null 로 봅니다. (학생이 직접 쓰면 되니까) */
export function toServerGoalDraft(value: unknown): ServerGoalDraft | null {
  if (typeof value !== 'object' || value === null) return null
  const item = value as Record<string, unknown>
  return {
    kind: item.kind === 'score' || item.kind === 'completion' ? item.kind : null,
    title: textOrNull(item.title),
    dDay: textOrNull(item.dDay),
    currentScore: textOrNull(item.currentScore),
    totalAmount:
      typeof item.totalAmount === 'number' && Number.isInteger(item.totalAmount)
        ? item.totalAmount
        : null,
    amountUnit: textOrNull(item.amountUnit),
    benefit: textOrNull(item.benefit),
    cost: textOrNull(item.cost),
    obstacle: textOrNull(item.obstacle),
    plan: textOrNull(item.plan),
  }
}

function badResponse(): ApiError {
  // 502: 서버가 이상한 응답을 줬다는 뜻으로 씁니다.
  return new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
}

/** 목표 대화를 엽니다. 첫 질문(정해 둔 글)이 돌아옵니다. */
export async function openGoalChat(): Promise<GoalChatReply> {
  const result = await api<unknown>('/goal-chats', {
    method: 'POST',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  return toGoalChatReply(result)
}

/** 지금까지의 대화(맨 끝이 방금 학생이 쓴 말)를 보내고 AI 의 다음 질문을 받습니다. */
export async function sendGoalChatMessage(
  chatId: string,
  lines: CallLine[],
): Promise<GoalChatReply> {
  const result = await api<unknown>(`/goal-chats/${encodeURIComponent(chatId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ lines }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  return toGoalChatReply(result)
}

/** 대화를 끝내고 목표 초안을 받습니다. 서버는 아무것도 저장하지 않습니다. */
export async function finishGoalChat(chatId: string, lines: CallLine[]): Promise<GoalChatFinish> {
  const result = await api<unknown>(`/goal-chats/${encodeURIComponent(chatId)}/finish`, {
    method: 'POST',
    body: JSON.stringify({ lines }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (typeof result !== 'object' || result === null) throw badResponse()
  const item = result as Record<string, unknown>
  if (typeof item.showHelp !== 'boolean') throw badResponse()
  return { goalDraft: toServerGoalDraft(item.goalDraft), showHelp: item.showHelp }
}

/**
 * 서버 초안 → 목표 만들기 화면의 입력칸 값. 비어 있는 칸은 빈 값으로 두어 학생이 직접 쓰게 합니다.
 * 유형을 모르면(kind null) 점수형으로 두되, 완주형 칸(분량)만 있으면 완주형으로 봅니다.
 *
 *   toGoalFormDraft({ kind: 'score', title: '11월 학평 수학 3등급', dDay: '2026-11-19', currentScore: '5등급', … })
 *     -> { kind: 'score', title: '11월 학평 수학 3등급', dDay: '2026-11-19', currentScore: '5등급', totalAmount: '', amountUnit: '쪽', … }
 */
export function toGoalFormDraft(draft: ServerGoalDraft | null): GoalDraft {
  const empty = createEmptyGoalDraft()
  if (draft === null) return empty
  const kind =
    draft.kind ??
    (draft.totalAmount !== null && draft.currentScore === null ? 'completion' : 'score')
  return {
    kind,
    title: draft.title ?? '',
    dDay: draft.dDay ?? '',
    currentScore: draft.currentScore ?? '',
    totalAmount: draft.totalAmount === null ? '' : String(draft.totalAmount),
    amountUnit: draft.amountUnit ?? empty.amountUnit,
    benefit: draft.benefit ?? '',
    cost: draft.cost ?? '',
    obstacle: draft.obstacle ?? '',
    plan: draft.plan ?? '',
  }
}
