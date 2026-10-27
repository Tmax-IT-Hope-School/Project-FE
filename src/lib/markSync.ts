import { ApiError, api } from '@/lib/api'
import { loadSavedCards } from '@/lib/cards'
import { loadCardMarks, type CardDayMarkRecord } from '@/lib/cardMarks'
import { loadAllSessions } from '@/lib/dailyRecords'
import { toDayKey } from '@/lib/date'
import { loadRestDays, type RestDay } from '@/lib/restDays'
import { toEndReportBody } from '@/lib/sessionsApi'
import { loadData, saveData } from '@/lib/storage'
import type { Card, StudySession } from '@/types'

/**
 * 미루기 · 실패 · 휴식 · 사후 입력을 서버(BE docs/API.md 「미루기 · 실패 · 사후 입력」 · 「휴식 처리」)로 보내는 규칙입니다. (#516)
 *
 * ■ 이 파일은 보내기만 합니다. 서버의 미루기 · 실패 · 휴식을 받아 오는 것은 lib/serverHistoryPull.ts 가 합니다. (2026-10-27)
 *   받아 온 것은 sent 에 적혀 있어서 다시 보내지 않습니다.
 * ■ 한도 · 기한은 서버가 다시 검사합니다. (미루기 한 달 5번 · 휴식 7일 안 · 사후 입력은 그날 다음 통화 전까지 등)
 *   이 기기에서는 통과했어도 늦게 보내면 서버가 거절할 수 있습니다. 거절한 것(400 · 404 · 409)은 다시 보내지 않고, 이 기기의 기록은 그대로 둡니다.
 * ■ 카드의 일은 그 카드가 서버에 올라간 뒤 보냅니다. 서버는 내 카드 번호로 받습니다.
 * ■ 미루기는 카드를 옮기기 전에 보내야 합니다. 서버는 "그날 하는 카드" 만 미룰 수 있어서,
 *   카드의 날짜를 먼저 바꾸면 미루기가 거절됩니다. 그래서 lib/cardSync.ts 는 안 보낸 미루기가 있는 카드를 기다립니다. (hasUnsentPostpone)
 * ■ 테스트 로그인은 서버를 쓰지 않습니다. (hooks/useMarkSync.ts 가 진짜 로그인일 때만 부릅니다)
 */

/** 서버를 기다리는 최대 시간(밀리초) */
const REQUEST_TIMEOUT_MS = 10000

// 무엇을 보냈는지 적어 두는 이름입니다. (실제 키는 'study-mark-sync')
export const MARK_SYNC_KEY = 'mark-sync'

/** 보낸 것과 서버가 거절한 것 (아래 markKeyOf · restKeyOf · 사후 입력 기록 id 로 적습니다) */
export interface MarkSyncState {
  sent: string[]
  skipped: string[]
}

export function loadMarkSyncState(): MarkSyncState {
  const saved = loadData<unknown>(MARK_SYNC_KEY, null)
  if (typeof saved !== 'object' || saved === null) return { sent: [], skipped: [] }
  const record = saved as Record<string, unknown>
  const toList = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  return { sent: toList(record.sent), skipped: toList(record.skipped) }
}

/** 보냄 · 거절됨 목록에 하나를 더해 저장합니다. */
function addToState(kind: keyof MarkSyncState, key: string): void {
  const state = loadMarkSyncState()
  saveData(MARK_SYNC_KEY, { ...state, [kind]: [...new Set([...state[kind], key])] })
}

/** 미루기 · 실패 표시 하나의 이름. (같은 카드 · 같은 날짜에는 하나만 남길 수 있어서 이걸로 구별합니다) */
export function markKeyOf(mark: Pick<CardDayMarkRecord, 'mark' | 'cardId' | 'dateKey'>): string {
  return `${mark.mark}:${mark.cardId}:${mark.dateKey}`
}

/** 휴식 날 하나의 이름 */
export function restKeyOf(day: Pick<RestDay, 'date'>): string {
  return `rest:${day.date}`
}

/** 서버에 보낼 일 하나 */
export interface MarkToSend {
  /** 보냄 · 거절됨 목록에 적을 이름 */
  key: string
  /** 보낼 주소 (예: '/cards/7/postpone') */
  path: string
  /** 보낼 본문. 휴식은 본문이 없습니다 */
  body?: Record<string, unknown>
}

/** 미루기 · 실패 표시를 서버에 보낼 모양으로 바꿉니다. */
function toMarkRequest(mark: CardDayMarkRecord, cardServerId: string): MarkToSend {
  const key = markKeyOf(mark)
  const path = `/cards/${encodeURIComponent(cardServerId)}`
  if (mark.mark === 'postponed') {
    return {
      key,
      path: `${path}/postpone`,
      body: {
        date: mark.dateKey,
        reason: mark.reason?.trim() ?? '',
        newDate: mark.newDate,
        newStartTime: mark.newStartTime,
      },
    }
  }
  // 실패 원인은 대표 원인(처음 고른 것) 하나만 보냅니다. 서버 칸이 하나라서, 여러 개(causes)는 이 기기에만 있습니다.
  const body: Record<string, unknown> = { date: mark.dateKey, cause: mark.cause }
  if (mark.reason?.trim()) body.reason = mark.reason.trim().slice(0, 500)
  return { key, path: `${path}/fail`, body }
}

/** 사후 입력 기록을 서버에 보낼 모양으로 바꿉니다. 날짜는 시작 시각이 속한 날(새벽 4시 기준)입니다. */
function toLateEntryRequest(session: StudySession, cardServerId: string): MarkToSend {
  const body: Record<string, unknown> = {
    date: toDayKey(session.startedAt),
    startedAt: session.startedAt,
    endedAt: session.endedAt,
  }
  if (session.endReport) body.endReport = toEndReportBody(session.endReport)
  return { key: session.id, path: `/cards/${encodeURIComponent(cardServerId)}/late-entry`, body }
}

/**
 * 지금 서버에 보낼 것을 고릅니다. 저장하지 않고 결과만 돌려줍니다.
 * - ready: 지금 보낼 것 (휴식 → 미루기 · 실패 → 사후 입력 순)
 * - skip: 앞으로도 보낼 수 없는 것 (카드가 이 기기에서 지워짐)
 * 둘 다 아닌 것은 기다립니다. (카드가 아직 서버에 없음)
 *
 *   휴식 2026-10-15                            -> ready  POST /rest-days/2026-10-15
 *   카드 A(서버 7) 를 10-17 에 미룸            -> ready  POST /cards/7/postpone
 *   카드 B(서버 번호 없음) 를 실패로 기록       -> 기다림
 *   지운 카드의 표시                            -> skip
 *   이미 보냈거나 서버가 거절한 것              -> 고르지 않음
 */
export function pickMarksToSend(
  marks: CardDayMarkRecord[],
  restDays: RestDay[],
  sessions: StudySession[],
  cards: Card[],
  state: MarkSyncState,
): { ready: MarkToSend[]; skip: string[] } {
  const ready: MarkToSend[] = []
  const skip: string[] = []
  const isDone = (key: string) => state.sent.includes(key) || state.skipped.includes(key)
  // 카드의 서버 번호. 카드가 없으면 null(못 보냄), 아직 서버에 없으면 undefined(기다림)
  const serverIdOf = (cardId: string): string | null | undefined => {
    const card = cards.find((item) => item.id === cardId)
    return card ? card.serverId : null
  }

  for (const day of restDays) {
    const key = restKeyOf(day)
    if (!isDone(key)) ready.push({ key, path: `/rest-days/${encodeURIComponent(day.date)}` })
  }
  for (const mark of marks) {
    const key = markKeyOf(mark)
    if (isDone(key)) continue
    const serverId = serverIdOf(mark.cardId)
    if (serverId === null) skip.push(key)
    else if (serverId) ready.push(toMarkRequest(mark, serverId))
  }
  for (const session of sessions) {
    if (session.mode !== 'selfReport' || !session.cardId || isDone(session.id)) continue
    const serverId = serverIdOf(session.cardId)
    if (serverId === null) skip.push(session.id)
    else if (serverId) ready.push(toLateEntryRequest(session, serverId))
  }
  return { ready, skip }
}

/**
 * 이 카드에 아직 서버로 안 보낸 미루기가 있는지. 있으면 lib/cardSync.ts 가 그 카드의 날짜 바꾸기를 기다립니다.
 * (서버의 미루기가 1회성 카드를 새 날짜로 직접 옮깁니다)
 */
export function hasUnsentPostpone(cardId: string): boolean {
  const state = loadMarkSyncState()
  return loadCardMarks().some((mark) => {
    if (mark.cardId !== cardId || mark.mark !== 'postponed') return false
    const key = markKeyOf(mark)
    return !state.sent.includes(key) && !state.skipped.includes(key)
  })
}

/** 서버가 "받을 수 없다" 고 한 것인지. 400 값이 틀림 · 404 카드가 없음 · 409 한도 · 기한 · 이미 처리함 */
function isRejected(error: unknown): boolean {
  return error instanceof ApiError && [400, 404, 409].includes(error.status)
}

// 지금 보내는 중인지. 보내는 중에 또 불리면 무시합니다. (1분마다 다시 부르니까요)
let isPushing = false

/**
 * 보낼 것을 하나씩 서버로 보냅니다. 서버에 닿지 못하면 거기서 멈추고 남은 것은 다음에 보냅니다.
 * 하나라도 보냈으면 true 를 돌려줍니다. (미루기를 보냈으면 기다리던 카드를 이어서 보내야 해서, hooks/useMarkSync.ts)
 */
export async function pushPendingMarks(): Promise<boolean> {
  if (isPushing) return false
  isPushing = true
  let didSend = false
  try {
    const { ready, skip } = pickMarksToSend(
      loadCardMarks(),
      loadRestDays(),
      loadAllSessions(),
      loadSavedCards() ?? [],
      loadMarkSyncState(),
    )
    for (const key of skip) addToState('skipped', key)
    for (const item of ready) {
      try {
        await api<unknown>(item.path, {
          method: 'POST',
          ...(item.body ? { body: JSON.stringify(item.body) } : {}),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        addToState('sent', item.key)
        didSend = true
      } catch (error) {
        if (!isRejected(error)) break
        addToState('skipped', item.key)
        // 거절된 미루기도 "기다릴 것 없음" 이라 카드를 이어서 보냅니다.
        didSend = true
      }
    }
  } finally {
    isPushing = false
  }
  return didSend
}
