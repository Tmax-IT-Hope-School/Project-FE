import { ApiError } from '@/lib/api'
import { loadSavedCards } from '@/lib/cards'
import { loadAllSessions } from '@/lib/dailyRecords'
import { isDemoId } from '@/lib/demoIds'
import { createSession, type SessionCreateInput } from '@/lib/sessionsApi'
import { loadData, saveData } from '@/lib/storage'
import type { Card, StudySession } from '@/types'

/**
 * 이 기기의 공부 기록(세션)을 서버(BE `/api/v1/study-sessions`)로 보내는 규칙입니다. (#516)
 *
 * ■ 보내기만 합니다. 서버의 기록을 이 기기로 받아 오지는 않습니다.
 *   서버에는 기록을 고치는 주소가 없고, 받아 오면 "모든 기록 지우기" 로 지운 기록이 다른 기기에서 다시 들어올 수 있어서입니다.
 *   서버에 보낸 기록은 서버의 분석 · AI(통화 · 리포트)가 "타이머가 잰 숫자" 로 씁니다.
 * ■ 끝나고 10분이 지난 기록만 보냅니다.
 *   끝난 직후에는 종료 팝업에서 체크 · 증빙을 더 붙이는데(#398), 서버에는 보낸 기록을 고치는 주소가 없기 때문입니다.
 *   단, 확인 통화를 걸 때는 기다리지 않고 바로 보냅니다(settleMs 0). 서버가 "오늘 끝낸 공부" 를 봐야 통화를 열어 주기 때문입니다.
 *   (그때는 종료 팝업이 이미 끝난 뒤라서 더 붙일 것이 없습니다. lib/checkCall.ts)
 * ■ 카드 세션은 그 카드가 서버에 올라간 뒤(서버 번호가 생긴 뒤) 보냅니다. 서버는 내 카드의 번호만 받습니다. (lib/cardSync.ts)
 * ■ 보내지 않는 기록
 *   - 사후 입력(selfReport): 서버가 이 주소로 받지 않습니다. (사후 입력 주소로 따로 보냅니다 — #516 다음 단계)
 *   - 카드 없이 잰 옛 공부 기록(과목 · 계획 기준): 서버에 그 계획이 없을 수 있어서 보내지 않습니다.
 * ■ 테스트 로그인은 서버를 쓰지 않습니다. (hooks/useSessionSync.ts 가 진짜 로그인일 때만 부릅니다)
 */

// 무엇을 보냈는지 적어 두는 이름입니다. (실제 키는 'study-session-sync')
export const SESSION_SYNC_KEY = 'session-sync'
/** 끝나고 이만큼 지나야 보냅니다. (종료 팝업에서 더 붙일 시간) */
export const SESSION_SETTLE_MS = 10 * 60 * 1000

export interface SessionSyncState {
  /** 보낸 기록: 이 기기의 기록 id → 서버의 기록 번호 */
  sent: Record<string, string>
  /** 서버가 받지 않은 기록 (값이 틀림 · 카드가 없음 · 다른 기록과 시간이 겹침). 다시 보내도 같아서 더 보내지 않습니다 */
  skipped: string[]
}

export function loadSessionSyncState(): SessionSyncState {
  const saved = loadData<unknown>(SESSION_SYNC_KEY, null)
  if (typeof saved !== 'object' || saved === null) return { sent: {}, skipped: [] }
  const record = saved as Record<string, unknown>
  const sent: Record<string, string> = {}
  if (typeof record.sent === 'object' && record.sent !== null) {
    for (const [id, serverId] of Object.entries(record.sent)) {
      if (typeof serverId === 'string') sent[id] = serverId
    }
  }
  const skipped = Array.isArray(record.skipped)
    ? record.skipped.filter((id): id is string => typeof id === 'string')
    : []
  return { sent, skipped }
}

function saveSessionSyncState(state: SessionSyncState): void {
  saveData(SESSION_SYNC_KEY, state)
}

/** 보낼 기록 하나 */
export interface SessionToSend {
  /** 이 기기의 기록 id */
  sessionId: string
  /** 서버에 보낼 값 */
  input: SessionCreateInput
}

/** 이 기기의 기록을 서버에 보낼 값으로 바꿉니다. cardServerId 는 그 카드의 서버 번호입니다. */
export function toSessionInput(session: StudySession, cardServerId?: string): SessionCreateInput {
  const input: SessionCreateInput = {
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    pauseCount: session.pauseCount,
    pausedMs: session.pausedMs ?? 0,
    kind: session.kind ?? 'study',
    mode: session.mode === 'offline' ? 'offline' : 'normal',
  }
  if (cardServerId) input.cardId = cardServerId
  // 서버는 목표 시간을 1 ~ 600분만 받습니다.
  if (session.targetMinutes !== undefined && session.targetMinutes >= 1) {
    input.targetMinutes = Math.min(600, Math.round(session.targetMinutes))
  }
  if (session.stopReason !== undefined) input.stopReason = session.stopReason
  if (session.pauses !== undefined) input.pauses = session.pauses
  if (session.endedEarly !== undefined) input.endedEarly = session.endedEarly
  if (session.endReport !== undefined) input.endReport = session.endReport
  if (session.memos !== undefined) input.memos = session.memos
  if (session.playTag !== undefined) input.playTag = session.playTag
  if (session.overRestMs !== undefined) input.overRestMs = session.overRestMs
  return input
}

/**
 * 지금 서버에 보낼 기록을 고릅니다. 저장하지 않고 결과만 돌려줍니다.
 * - ready: 지금 보낼 기록 (시작이 빠른 순)
 * - skip: 앞으로도 보낼 수 없는 기록 (카드가 이 기기에서 지워짐)
 * 둘 다 아닌 기록은 기다립니다. (끝난 지 10분이 안 됨 · 카드가 아직 서버에 없음)
 *
 *   카드 A(서버 7) 의 세션, 20분 전에 끝남   -> ready (cardId '7')
 *   카드 A(서버 7) 의 세션, 3분 전에 끝남    -> 기다림
 *   카드 B(서버 번호 없음) 의 세션           -> 기다림 (카드가 먼저 올라가야 함)
 *   지운 카드의 세션                          -> skip
 *   노는 기록                                 -> ready (카드 없이도 받음)
 *   사후 입력 · 카드 없는 옛 공부 기록 · 이미 보낸 것 -> 고르지 않음
 */
export function pickSessionsToSend(
  sessions: StudySession[],
  cards: Card[],
  state: SessionSyncState,
  now: number,
  settleMs: number = SESSION_SETTLE_MS,
): { ready: SessionToSend[]; skip: string[] } {
  const ready: SessionToSend[] = []
  const skip: string[] = []
  const sorted = [...sessions].sort((a, b) => a.startedAt - b.startedAt)
  for (const session of sorted) {
    if (state.sent[session.id] !== undefined || state.skipped.includes(session.id)) continue
    // 가상 기록은 서버로 보내지 않습니다. (lib/demoIds.ts)
    if (isDemoId(session.id)) continue
    if (session.mode === 'selfReport') continue
    if (now - session.endedAt < settleMs) continue
    const card = session.cardId ? cards.find((item) => item.id === session.cardId) : undefined
    if (session.kind === 'play') {
      ready.push({ sessionId: session.id, input: toSessionInput(session, card?.serverId) })
      continue
    }
    // 여기부터 공부 기록입니다. 카드 없는 옛 기록은 보내지 않습니다.
    if (!session.cardId) continue
    if (!card) skip.push(session.id)
    else if (card.serverId)
      ready.push({ sessionId: session.id, input: toSessionInput(session, card.serverId) })
  }
  return { ready, skip }
}

/** 서버가 "받을 수 없다" 고 한 것인지. 400 값이 틀림 · 404 카드가 없음 · 409 다른 기록과 시간이 겹침 */
function isRejected(error: unknown): boolean {
  return error instanceof ApiError && [400, 404, 409].includes(error.status)
}

// 지금 보내는 일. 보내는 중이 아니면 null 입니다.
let pushing: Promise<void> | null = null

/**
 * 보낼 기록을 하나씩 서버로 보냅니다. 서버에 닿지 못하면 거기서 멈추고 남은 것은 다음에 보냅니다.
 * 같은 기록을 두 번 보내도 서버에 두 번 저장되지 않습니다. (createSession 이 409 를 "이미 저장됨" 으로 알아봅니다)
 * settleMs 는 끝나고 얼마나 기다린 기록부터 보낼지입니다. 확인 통화 전에는 0 으로 불러 바로 보냅니다.
 *
 * 이미 보내는 중에 또 불리면: 보통(1분마다)은 그냥 넘어가고, 바로 보내기(settleMs 0)는 그 일이 끝나기를 기다렸다가 한 번 더 봅니다.
 */
export async function pushPendingSessions(settleMs: number = SESSION_SETTLE_MS): Promise<void> {
  if (pushing) {
    if (settleMs >= SESSION_SETTLE_MS) return
    await pushing
    return pushPendingSessions(settleMs)
  }
  pushing = pushOnce(settleMs)
  try {
    await pushing
  } finally {
    pushing = null
  }
}

/** pushPendingSessions 가 한 번 보내는 일 */
async function pushOnce(settleMs: number): Promise<void> {
  const { ready, skip } = pickSessionsToSend(
    loadAllSessions(),
    loadSavedCards() ?? [],
    loadSessionSyncState(),
    Date.now(),
    settleMs,
  )
  if (skip.length > 0) {
    const state = loadSessionSyncState()
    saveSessionSyncState({ ...state, skipped: [...state.skipped, ...skip] })
  }
  for (const { sessionId, input } of ready) {
    try {
      const saved = await createSession(input)
      const state = loadSessionSyncState()
      saveSessionSyncState({ ...state, sent: { ...state.sent, [sessionId]: saved.id } })
    } catch (error) {
      if (!isRejected(error)) return
      const state = loadSessionSyncState()
      saveSessionSyncState({ ...state, skipped: [...state.skipped, sessionId] })
    }
  }
}
