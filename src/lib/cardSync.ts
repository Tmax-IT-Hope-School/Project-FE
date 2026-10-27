import { ApiError } from '@/lib/api'
import { loadSavedCards, saveCards } from '@/lib/cards'
import {
  createServerCard,
  deleteServerCard,
  fromServerCard,
  updateServerCard,
  type ServerCard,
} from '@/lib/cardsApi'
import { isDemoId } from '@/lib/demoIds'
import { loadGoals } from '@/lib/goals'
import { hasUnsentPostpone } from '@/lib/markSync'
import { loadData, saveData } from '@/lib/storage'
import type { Card, Goal } from '@/types'

/**
 * 이 기기의 카드와 서버의 카드를 맞추는 규칙입니다. (#516)
 *
 * ■ 방식: 이 기기 먼저 (체크인 lib/checkInsApi.ts 와 같은 방식)
 *   화면은 지금처럼 이 기기(localStorage)의 카드를 읽고 씁니다. 바뀐 카드는 "보낼 목록" 에 적어 두고 서버로 보냅니다.
 *   서버에 못 보내면(인터넷 끊김 · 서버 꺼짐) 목록에 남겨 두고, 다음에 앱을 열 때 다시 보냅니다.
 *   앱을 열 때 서버의 카드를 받아서, 다른 기기에서 만들거나 지운 카드를 이 기기에도 반영합니다.
 *
 * ■ 테스트 로그인은 서버를 쓰지 않습니다. (hooks/useCardSync.ts 가 진짜 로그인일 때만 부릅니다)
 */

// 아직 서버에 못 보낸 것을 적어 두는 이름입니다. (실제 키는 'study-card-sync-pending')
export const CARD_SYNC_KEY = 'card-sync-pending'

/** 서버에 보낼 것 */
export interface PendingCardSync {
  /** 만들거나 바꿔서 서버에 올릴 카드 (이 기기의 카드 id) */
  upserts: string[]
  /** 이 기기에서 지워서 서버에서도 지울 카드 (서버 번호) */
  deletes: string[]
}

export function loadPendingCardSync(): PendingCardSync {
  const saved = loadData<unknown>(CARD_SYNC_KEY, null)
  if (typeof saved !== 'object' || saved === null) return { upserts: [], deletes: [] }
  const record = saved as Record<string, unknown>
  const toList = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  return { upserts: toList(record.upserts), deletes: toList(record.deletes) }
}

function savePendingCardSync(pending: PendingCardSync): void {
  saveData(CARD_SYNC_KEY, pending)
}

/** 서버 번호를 뺀 카드 내용이 같은지 (서버 번호만 붙은 것은 "바뀐 것" 이 아닙니다) */
function isSameContent(a: Card, b: Card): boolean {
  // JSON 으로 바꿀 때 값이 undefined 인 칸은 빠집니다. 그래서 serverId 를 undefined 로 덮어서 비교합니다.
  return (
    JSON.stringify({ ...a, serverId: undefined }) === JSON.stringify({ ...b, serverId: undefined })
  )
}

/**
 * 바뀌기 전 · 뒤의 카드 목록에서 서버에 보낼 것을 찾습니다.
 *
 *   prev [A], next [A(제목 바꿈), B]       -> { upserts: ['A', 'B'], deletes: [] }
 *   prev [A(serverId 7)], next []          -> { upserts: [], deletes: ['7'] }
 *   prev [A], next []  (서버에 없던 카드)   -> { upserts: [], deletes: [] }
 */
export function diffCardChanges(prev: Card[], next: Card[]): PendingCardSync {
  const upserts: string[] = []
  for (const card of next) {
    const before = prev.find((item) => item.id === card.id)
    // 가상 카드는 서버로 보내지 않습니다. (lib/demoIds.ts)
    if (isDemoId(card.id)) continue
    if (!before || !isSameContent(before, card)) upserts.push(card.id)
  }
  const deletes: string[] = []
  for (const card of prev) {
    const isGone = !next.some((item) => item.id === card.id)
    if (isGone && card.serverId) deletes.push(card.serverId)
  }
  return { upserts, deletes }
}

/** 보낼 목록 두 개를 합칩니다. (겹치는 것은 하나만) */
export function addToPending(pending: PendingCardSync, more: PendingCardSync): PendingCardSync {
  return {
    upserts: [...new Set([...pending.upserts, ...more.upserts])],
    deletes: [...new Set([...pending.deletes, ...more.deletes])],
  }
}

/**
 * 서버에서 받은 카드로 이 기기의 카드를 맞춥니다. 저장하지 않고 결과만 돌려줍니다.
 *
 * ■ 규칙
 *   1. 서버 번호가 있는 카드
 *      - 아직 보낼 목록에 있으면(이 기기에서 고쳤는데 못 보냄) 이 기기의 것을 둡니다.
 *      - 아니면 서버의 내용으로 맞춥니다. (다른 기기에서 고친 것)
 *      - 서버에 없고 보낼 목록에도 없으면 다른 기기에서 지운 것이라 이 기기에서도 뺍니다.
 *   2. 서버 번호가 없는 카드는 아직 서버에 없는 카드라 그대로 두고, 보낼 목록에 더합니다. (처음 연결할 때 올라갑니다)
 *   3. 이 기기에 없는 서버 카드는 다른 기기에서 만든 것이라 더합니다. (이 기기에서 지우는 중인 것은 빼고)
 *
 *   이 기기 [A(7), B], 서버 [7(제목 바뀜), 9]  -> cards [A(서버 제목), B, card-s9], toUpload ['B']
 * goals 는 이 기기의 목표들입니다. 서버 카드의 목표 번호를 이 기기의 목표 id 로 바꿀 때 씁니다. (lib/cardsApi.ts)
 */
export function mergeServerCards(
  local: Card[],
  server: ServerCard[],
  pending: PendingCardSync,
  goals: Goal[] = [],
): { cards: Card[]; toUpload: string[] } {
  const cards: Card[] = []
  const toUpload: string[] = []
  for (const card of local) {
    if (!card.serverId) {
      cards.push(card)
      // 가상 카드는 서버로 보내지 않습니다. (lib/demoIds.ts)
      if (!isDemoId(card.id)) toUpload.push(card.id)
      continue
    }
    const serverCard = server.find((item) => item.id === card.serverId)
    if (pending.upserts.includes(card.id)) cards.push(card)
    else if (serverCard) cards.push(fromServerCard(serverCard, card, goals))
    // 서버에 없고 보낼 것도 없으면: 다른 기기에서 지운 카드 → 넣지 않습니다.
  }
  for (const serverCard of server) {
    const isLinked = local.some((card) => card.serverId === serverCard.id)
    if (!isLinked && !pending.deletes.includes(serverCard.id))
      cards.push(fromServerCard(serverCard, undefined, goals))
  }
  return { cards, toUpload }
}

/** 이 기기에서 카드를 바꿨을 때 보낼 목록에 적습니다. (hooks/useCardSync.ts 가 카드 저장 이벤트를 받을 때 부릅니다) */
export function markCardChanges(prev: Card[], next: Card[]): void {
  savePendingCardSync(addToPending(loadPendingCardSync(), diffCardChanges(prev, next)))
}

/** 서버에서 받은 카드를 이 기기에 반영하고, 아직 서버에 없는 카드를 보낼 목록에 더합니다. */
export function applyServerCards(server: ServerCard[]): void {
  const local = loadSavedCards() ?? []
  const pending = loadPendingCardSync()
  const { cards, toUpload } = mergeServerCards(local, server, pending, loadGoals())
  if (JSON.stringify(cards) !== JSON.stringify(local)) saveCards(cards, 'server')
  savePendingCardSync(addToPending(pending, { upserts: toUpload, deletes: [] }))
}

/**
 * 이 목표에 연결한 카드를 보낼 목록에 다시 적고 보냅니다.
 * 목표가 서버에 처음 올라갔을 때 lib/goalSync.ts 가 부릅니다. (그 전에 보낸 카드는 서버에 "목표 없음" 으로 있어서)
 */
export function markCardsOfGoal(goalId: string): void {
  const cardIds = (loadSavedCards() ?? [])
    .filter((card) => card.goalId === goalId)
    .map((card) => card.id)
  if (cardIds.length === 0) return
  savePendingCardSync(addToPending(loadPendingCardSync(), { upserts: cardIds, deletes: [] }))
  requestCardPush()
}

/** 카드에 연결한 목표의 서버 번호. 목표가 없거나 아직 서버에 없으면 '' ("목표 없음") 입니다. */
function getGoalServerId(card: Card): string {
  if (!card.goalId) return ''
  return loadGoals().find((goal) => goal.id === card.goalId)?.serverId ?? ''
}

/** 보낸 카드에 서버 번호를 붙여 저장합니다. 보내는 사이에 또 고쳤으면 보낼 목록에 남겨 둡니다. */
function linkServerId(sent: Card, serverId: string): void {
  const cards = loadSavedCards() ?? []
  const current = cards.find((card) => card.id === sent.id)
  if (current) {
    saveCards(
      cards.map((card) => (card.id === sent.id ? { ...card, serverId } : card)),
      'server',
    )
  }
  // 보내는 사이에 고쳤으면(내용이 다르면) 다음에 한 번 더 보냅니다. 지워졌으면 아래 지우기 목록이 맡습니다.
  if (!current || isSameContent(current, sent)) {
    const pending = loadPendingCardSync()
    savePendingCardSync({ ...pending, upserts: pending.upserts.filter((id) => id !== sent.id) })
  }
}

/** 보낼 목록에서 하나를 뺍니다. */
function dropPending(kind: keyof PendingCardSync, value: string): void {
  const pending = loadPendingCardSync()
  savePendingCardSync({ ...pending, [kind]: pending[kind].filter((item) => item !== value) })
}

/** 서버가 "값이 틀렸다(400)" 고 하면 다시 보내도 같은 결과라 목록에서 뺍니다. (이 기기의 카드는 그대로) */
function isRejected(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400
}

/**
 * 카드를 만들 때(POST) 404 가 오면 "과목을 찾을 수 없어요" 입니다. (만들기에서 404 가 나는 것은 과목뿐입니다, BE #404)
 * 다른 기기에서 그 과목을 지웠는데 이 기기의 카드에는 아직 남아 있을 때 생깁니다.
 */
function isMissingSubject(error: unknown, card: Card): boolean {
  return error instanceof ApiError && error.status === 404 && Boolean(card.subjectId)
}

/**
 * 지워진 과목을 이 기기의 카드에서도 뺍니다. 서버도 과목을 지우면 그 카드를 "과목 없음" 으로 바꿉니다. (#652)
 * 카드는 보낼 목록에 그대로 남아서, 다음에 과목 없이 다시 보냅니다.
 */
function dropMissingSubject(cardId: string): void {
  const cards = loadSavedCards() ?? []
  saveCards(
    cards.map((card) => (card.id === cardId ? { ...card, subjectId: undefined } : card)),
    'server',
  )
}

// 지금 보내는 중인지. 보내는 중에 또 부르면 끝난 뒤 한 번 더 보냅니다.
let isPushing = false
let pushAgain = false

/**
 * 보낼 목록에 적힌 카드를 하나씩 서버로 보냅니다. 서버에 닿지 못하면 거기서 멈추고 남은 것은 다음에 보냅니다.
 * - 서버 번호가 없으면 만들고(POST), 있으면 이 기기의 카드와 똑같이 바꿉니다(PATCH). 서버에서 사라졌으면(404) 다시 만듭니다.
 * - 카드의 과목이 서버에서 지워졌으면(만들기도 404) 과목을 빼고 다시 보냅니다. (#652)
 * - 지운 카드는 서버에서도 지웁니다(DELETE).
 * - 아직 안 보낸 미루기가 있는 카드는 기다립니다. 서버가 미루기로 카드를 옮겨야 해서, 날짜를 먼저 바꾸면 미루기가 거절됩니다. (lib/markSync.ts)
 */
export async function pushPendingCards(): Promise<void> {
  if (isPushing) {
    pushAgain = true
    return
  }
  isPushing = true
  try {
    for (const cardId of loadPendingCardSync().upserts) {
      const card = (loadSavedCards() ?? []).find((item) => item.id === cardId)
      if (!card) {
        dropPending('upserts', cardId)
        continue
      }
      if (card.serverId && hasUnsentPostpone(card.id)) continue
      try {
        let saved: ServerCard
        const goalServerId = getGoalServerId(card)
        if (card.serverId) {
          try {
            saved = await updateServerCard(card.serverId, card, goalServerId)
          } catch (error) {
            if (!(error instanceof ApiError && error.status === 404)) throw error
            saved = await createServerCard(card, goalServerId)
          }
        } else {
          saved = await createServerCard(card, goalServerId)
        }
        linkServerId(card, saved.id)
      } catch (error) {
        if (isRejected(error)) {
          dropPending('upserts', cardId)
          continue
        }
        // 과목이 지워졌으면 과목을 빼고 이번 일이 끝난 뒤 한 번 더 보냅니다. (안 그러면 이 카드에서 계속 멈춥니다)
        if (isMissingSubject(error, card)) {
          dropMissingSubject(card.id)
          pushAgain = true
          continue
        }
        return
      }
    }
    for (const serverId of loadPendingCardSync().deletes) {
      try {
        await deleteServerCard(serverId)
        dropPending('deletes', serverId)
      } catch (error) {
        if (isRejected(error)) {
          dropPending('deletes', serverId)
          continue
        }
        return
      }
    }
  } finally {
    isPushing = false
    if (pushAgain) {
      pushAgain = false
      void pushPendingCards()
    }
  }
}

// 카드를 여러 번 빠르게 고칠 때(체크리스트를 한 글자씩 등) 매번 보내지 않으려고 조금 기다렸다가 보냅니다.
const PUSH_WAIT_MS = 800
let pushTimerId: ReturnType<typeof setTimeout> | undefined

/** 잠시 뒤 보낼 목록을 서버로 보냅니다. 그사이 또 부르면 다시 기다립니다. */
export function requestCardPush(): void {
  if (pushTimerId !== undefined) clearTimeout(pushTimerId)
  pushTimerId = setTimeout(() => {
    pushTimerId = undefined
    void pushPendingCards()
  }, PUSH_WAIT_MS)
}
