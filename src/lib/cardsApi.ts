import { ApiError, api } from '@/lib/api'
import { localGoalIdOf } from '@/lib/goalsApi'
import { queryOptions } from '@tanstack/react-query'
import type { Card, CardAlert, ChecklistItem, Goal } from '@/types'

/**
 * 카드를 서버(BE `/api/v1/cards`, docs/API.md 「카드」)와 주고받는 함수들입니다. (#516)
 * 이 기기의 카드 모양(Card)과 서버의 카드 모양을 서로 바꾸는 일도 여기서 합니다.
 * 언제 보내고 받을지는 lib/cardSync.ts 가 정합니다.
 */

/** 서버를 기다리는 최대 시간(밀리초) */
const REQUEST_TIMEOUT_MS = 10000

// 서버가 받는 한도입니다. 넘으면 서버가 400 으로 거절해서, 보내기 전에 맞춥니다.
const MAX_TITLE_LENGTH = 100
const MAX_DURATION_MINUTES = 600
const MAX_CHECKLIST_ITEMS = 20
const MAX_ITEM_LENGTH = 100
const MAX_ITEM_ID_LENGTH = 40
const MAX_REASON_LENGTH = 30
const MAX_FAIL_CAUSES = 5
const MAX_ALERT_MINUTES = 120

/** 서버가 주는 카드 한 장 */
export interface ServerCard {
  id: string
  title: string
  date: string
  repeatDays: number[] | null
  startTime: string | null
  durationMinutes: number
  checklist: { id: string; text: string }[]
  goalId: string | null
  /** 카드의 과목 번호. "과목 없음" 이면 null. 과목 칸이 없는 옛 서버(BE #404 전)면 없습니다 */
  subjectId?: string | null
  priority: Card['priority']
  type: Card['type']
  expectedDone: number | null
  expectedDoneReason: string | null
  expectedFailCauses: string[] | null
  alert: { method: CardAlert['method']; minutesBefore: number; text: string | null } | null
  planningMs: number | null
  createdAt: number
}

/** 서버가 준 값이 카드 모양인지 확인합니다. (꼭 쓰는 칸만 봅니다) */
function isServerCard(value: unknown): value is ServerCard {
  if (typeof value !== 'object' || value === null) return false
  const card = value as Record<string, unknown>
  return (
    typeof card.id === 'string' &&
    typeof card.title === 'string' &&
    typeof card.date === 'string' &&
    typeof card.durationMinutes === 'number' &&
    Array.isArray(card.checklist)
  )
}

/** 숫자를 min ~ max 사이로 맞춥니다. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** 서버로 보낼 체크리스트. 빈 항목은 빼고, 하나도 없으면 제목으로 한 줄 만듭니다. (서버는 1개 이상 받습니다) */
function toServerChecklist(card: Card): { id: string; text: string }[] {
  const items = card.checklist
    .filter((item) => item.text.trim() !== '')
    .slice(0, MAX_CHECKLIST_ITEMS)
    .map((item) => ({
      id: item.id.slice(0, MAX_ITEM_ID_LENGTH),
      text: item.text.trim().slice(0, MAX_ITEM_LENGTH),
    }))
  if (items.length > 0) return items
  return [{ id: `${card.id}-item-0`.slice(0, MAX_ITEM_ID_LENGTH), text: card.title.slice(0, 100) }]
}

/**
 * 서버로 보낼 카드 본문을 만듭니다.
 * - create(만들기): 빈 칸은 보내지 않습니다.
 * - update(바꾸기): 모든 칸을 보내서 서버를 이 기기의 카드와 똑같이 맞춥니다. 지울 칸은 빈 값('' · [])으로 보냅니다.
 * goalServerId 는 카드에 연결한 목표의 서버 번호입니다. 목표가 아직 서버에 없으면 '' ("목표 없음") 로 보내고,
 * 목표가 서버에 올라가면 lib/goalSync.ts 가 이 카드를 다시 보냅니다. 이 기기의 카드에는 목표 연결이 그대로 있습니다.
 *
 *   toServerCardBody({ title: '수학', date: '2026-10-17', startTime: '19:00', durationMinutes: 60, checklist: [{ id: 'a', text: '42쪽' }], … }, 'create')
 *     -> { title: '수학', date: '2026-10-17', repeatDays: [], startTime: '19:00', durationMinutes: 60, checklist: [{ id: 'a', text: '42쪽' }], … }
 */
export function toServerCardBody(
  card: Card,
  mode: 'create' | 'update',
  goalServerId = '',
): Record<string, unknown> {
  const checklist = toServerChecklist(card)
  const reason = card.expectedDoneReason?.trim().slice(0, MAX_REASON_LENGTH) ?? ''
  const failCauses = (card.expectedFailCauses ?? [])
    .map((cause) => cause.trim().slice(0, MAX_ITEM_LENGTH))
    .filter((cause) => cause !== '')
    .slice(0, MAX_FAIL_CAUSES)
  const body: Record<string, unknown> = {
    title: card.title.trim().slice(0, MAX_TITLE_LENGTH),
    date: card.date,
    repeatDays: card.repeatDays ?? [],
    durationMinutes: clamp(card.durationMinutes, 1, MAX_DURATION_MINUTES),
    checklist,
    goalId: goalServerId,
    // 진짜 로그인의 과목은 서버에서 받아서 id 가 곧 서버 번호입니다. 숫자가 아니면 "과목 없음"('') 으로 보냅니다. (#652)
    subjectId: card.subjectId && /^\d{1,18}$/.test(card.subjectId) ? card.subjectId : '',
    priority: card.priority,
    type: card.type,
    expectedDone: clamp(card.expectedDone ?? checklist.length, 0, checklist.length),
    alert: {
      method: card.alert?.method ?? 'message',
      minutesBefore: clamp(card.alert?.minutesBefore ?? 0, 0, MAX_ALERT_MINUTES),
      text: card.alert?.text?.slice(0, 100) ?? '',
    },
  }
  if (card.planningMs !== undefined) body.planningMs = Math.max(0, Math.round(card.planningMs))
  // 시작 시각 · 이유 · 예상 실패 원인: 만들 때는 있을 때만, 바꿀 때는 없으면 빈 값으로 지웁니다.
  if (card.startTime) body.startTime = card.startTime
  else if (mode === 'update') body.startTime = ''
  if (reason !== '' || mode === 'update') body.expectedDoneReason = reason
  if (failCauses.length > 0 || mode === 'update') body.expectedFailCauses = failCauses
  return body
}

/**
 * 서버의 카드를 이 기기의 카드 모양으로 바꿉니다.
 * local 은 이 기기에 이미 있는 같은 카드입니다. 서버에 없는 칸(AI 추천 표시)은 local 의 것을 그대로 둡니다.
 * goals 는 이 기기의 목표들입니다. 서버 카드의 목표 번호를 이 기기의 목표 id 로 바꿀 때 씁니다. (toLocalGoalId)
 *
 *   fromServerCard({ id: '7', title: '수학', … })            -> { id: 'card-s7', serverId: '7', title: '수학', … }   (다른 기기에서 만든 카드)
 *   fromServerCard({ id: '7', … }, { id: 'card-1', goalId: 'g1', … }) -> { id: 'card-1', serverId: '7', goalId: 'g1', … }
 */
export function fromServerCard(server: ServerCard, local?: Card, goals: Goal[] = []): Card {
  const checklist: ChecklistItem[] = server.checklist.map((item) => {
    const localItem = local?.checklist.find((each) => each.id === item.id)
    // AI 추천 표시는 서버에 없어서, 글이 그대로면 이 기기의 표시를 남깁니다.
    return localItem?.aiSuggested && localItem.text === item.text
      ? { id: item.id, text: item.text, aiSuggested: true }
      : { id: item.id, text: item.text }
  })
  const card: Card = {
    id: local?.id ?? `card-s${server.id}`,
    serverId: server.id,
    title: server.title,
    date: server.date,
    durationMinutes: server.durationMinutes,
    checklist,
    priority: server.priority === 'absolute' ? 'absolute' : 'flexible',
    type: server.type === 'lecture' ? 'lecture' : 'self',
    createdAt: local?.createdAt ?? server.createdAt,
  }
  if (server.repeatDays && server.repeatDays.length > 0) card.repeatDays = server.repeatDays
  if (server.startTime) card.startTime = server.startTime
  const goalId = toLocalGoalId(server.goalId, local, goals)
  if (goalId) card.goalId = goalId
  // 과목 칸이 아예 없는 옛 서버면 이 기기의 과목을 그대로 둡니다. (#652)
  const subjectId = server.subjectId === undefined ? local?.subjectId : server.subjectId
  if (subjectId) card.subjectId = subjectId
  if (server.expectedDone !== null) card.expectedDone = server.expectedDone
  if (server.expectedDoneReason) card.expectedDoneReason = server.expectedDoneReason
  if (server.expectedFailCauses && server.expectedFailCauses.length > 0) {
    card.expectedFailCauses = server.expectedFailCauses
  }
  if (server.alert) {
    card.alert = { method: server.alert.method, minutesBefore: server.alert.minutesBefore }
    if (server.alert.text) card.alert.text = server.alert.text
  }
  if (server.planningMs !== null) card.planningMs = server.planningMs
  return card
}

/**
 * 서버 카드의 목표 번호를 이 기기의 목표 id 로 바꿉니다.
 * - 서버에 목표 번호가 있으면: 그 서버 번호를 가진 이 기기의 목표. 아직 없으면 다른 기기의 목표라 goalSync 가 붙일 id 로.
 * - 서버에 목표가 없으면: 이 기기의 목표가 아직 서버에 안 올라가서 '' 로 보낸 것일 수 있어서, 그때만 이 기기의 연결을 남깁니다.
 *
 *   toLocalGoalId('4', 카드, [{ id: 'goal-1', serverId: '4' }])        -> 'goal-1'
 *   toLocalGoalId('4', 카드, [])                                      -> 'goal-s4'
 *   toLocalGoalId(null, { goalId: 'goal-2' }, [{ id: 'goal-2' }])     -> 'goal-2'   (목표가 아직 서버에 없음)
 *   toLocalGoalId(null, { goalId: 'goal-1' }, [{ id: 'goal-1', serverId: '4' }]) -> undefined (다른 기기에서 연결을 뺌)
 */
function toLocalGoalId(
  serverGoalId: string | null,
  local: Card | undefined,
  goals: Goal[],
): string | undefined {
  if (serverGoalId) {
    return goals.find((goal) => goal.serverId === serverGoalId)?.id ?? localGoalIdOf(serverGoalId)
  }
  const localGoal = goals.find((goal) => goal.id === local?.goalId)
  return local?.goalId && !localGoal?.serverId ? local.goalId : undefined
}

/** 내 카드 전부를 서버에서 받습니다. 실패하면 에러를 던집니다. */
export async function fetchServerCards(): Promise<ServerCard[]> {
  const result = await api<unknown>('/cards', { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  return Array.isArray(result) ? result.filter(isServerCard) : []
}

/** 서버의 카드 목록 쿼리 설정입니다. 앱을 열 때 한 번 받아 이 기기의 카드와 맞춥니다. (hooks/useCardSync.ts) */
export function serverCardsQuery() {
  return queryOptions({
    queryKey: ['server-cards'],
    queryFn: fetchServerCards,
    // 앱을 쓰는 동안에는 이 기기에서 바꾼 것을 바로 보내므로, 자주 다시 받지 않습니다.
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}

/** 서버에 카드를 만들고, 만들어진 카드를 돌려줍니다. */
export async function createServerCard(card: Card, goalServerId = ''): Promise<ServerCard> {
  const result = await api<unknown>('/cards', {
    method: 'POST',
    body: JSON.stringify(toServerCardBody(card, 'create', goalServerId)),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!isServerCard(result)) throw new Error('서버가 준 카드의 모양이 달라요')
  return result
}

/** 서버의 카드를 이 기기의 카드와 똑같이 바꾸고, 바뀐 카드를 돌려줍니다. 서버에 없으면 ApiError(404) 를 던집니다. */
export async function updateServerCard(
  serverId: string,
  card: Card,
  goalServerId = '',
): Promise<ServerCard> {
  const result = await api<unknown>(`/cards/${encodeURIComponent(serverId)}`, {
    method: 'PATCH',
    body: JSON.stringify(toServerCardBody(card, 'update', goalServerId)),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!isServerCard(result)) throw new Error('서버가 준 카드의 모양이 달라요')
  return result
}

/** 서버의 카드를 지웁니다. 이미 없으면(404) 지운 것으로 봅니다. */
export async function deleteServerCard(serverId: string): Promise<void> {
  try {
    await api<unknown>(`/cards/${encodeURIComponent(serverId)}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return
    throw error
  }
}

/**
 * 서버에 있는 내 카드를 모두 지웁니다. 설정의 "모든 기록 지우기" 가 부릅니다.
 * (안 지우면 다음에 앱을 열 때 서버의 카드가 이 기기로 다시 들어옵니다)
 * 서버에 한꺼번에 지우는 주소가 없어서 카드마다 지우기를 보냅니다. 하나라도 실패하면 에러를 던집니다.
 * 한 장씩 차례로 기다리면 카드가 많을 때 수십 초가 걸려서, 그사이 새로고침하면 중간에 끊겼습니다.
 * 그래서 지우기 요청을 한꺼번에 보내고(Promise.all) 모두 끝날 때까지 기다립니다.
 */
export async function deleteAllServerCards(): Promise<void> {
  const cards = await fetchServerCards()
  await Promise.all(cards.map((card) => deleteServerCard(card.id)))
}
