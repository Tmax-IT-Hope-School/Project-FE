import { ApiError, api } from '@/lib/api'
import { CARD_FAIL_CAUSES, CARD_MARKS_KEY, loadCardMarks } from '@/lib/cardMarks'
import type { CardDayMarkRecord } from '@/lib/cardMarks'
import { loadSavedCards } from '@/lib/cards'
import { fetchServerCheckIns, fromServerCheckIn, type ServerCheckIn } from '@/lib/checkInsApi'
import { loadAllSessions } from '@/lib/dailyRecords'
import { moveDateKey } from '@/lib/date'
import { getServerRanges } from '@/lib/historySessions'
import { MARK_SYNC_KEY, loadMarkSyncState, markKeyOf, restKeyOf } from '@/lib/markSync'
import { hasCheckIn, saveLocalCheckIn } from '@/lib/quickCheckIn'
import { REST_DAYS_KEY, loadRestDays, type RestDay } from '@/lib/restDays'
import { SESSION_MAX_RANGE_DAYS, fetchSessionsByRange } from '@/lib/sessionsApi'
import { SESSION_SYNC_KEY, loadSessionSyncState } from '@/lib/sessionSync'
import { loadData, saveData } from '@/lib/storage'
import type { Card, StudySession } from '@/types'

/**
 * 서버에 있는 내 기록을 이 기기(localStorage)로 받아 오는 규칙입니다. (2026-10-27)
 *
 * 화면들(홈 · 카드 · 타이머 · 목표 상세 · 통계 · 기록)은 이 기기의 저장소만 읽습니다.
 * 그래서 다른 기기에서 쓴 기록이나 서버에만 있는 기록은 새 기기 · 새 로그인에서 하나도 안 보였습니다.
 * 진짜 로그인이면 앱을 열 때 서버의 아래 네 가지를 받아서, 이 기기에 없는 것만 더합니다.
 *
 *   공부 기록        GET /study-sessions?from=&to=
 *   미루기 · 실패    GET /card-day-marks?from=&to=
 *   휴식 날          GET /rest-days?from=&to=
 *   체크인           GET /checkins?from=&to=
 *
 * ■ 처음에는 최근 6개월(186일), 그 뒤로는 지난번에 받은 날부터 오늘까지만 받습니다. (서버는 한 번에 31일까지)
 * ■ 받아 온 것은 "이미 서버로 보낸 것" 으로 적어 둡니다. 서버에 있던 것을 다시 보내면 겹치거나 거절되기 때문입니다.
 *   (공부 기록 → session-sync, 미루기 · 실패 · 휴식 · 사후 입력 → mark-sync)
 * ■ 예전에는 "모든 기록 지우기" 로 지운 기록이 되살아날까 봐 받아 오지 않았습니다.
 *   지금은 그 버튼이 서버의 카드 · 공부 기록 · 체크인도 같이 지워서(pages/SettingsPage.tsx) 받아 와도 되살아나지 않습니다.
 * ■ 서버 카드 번호는 이 기기 카드 id 로 바꿉니다. 이 기기에 없는 카드의 미루기 · 실패는 쓸 데가 없어서 버립니다.
 * ■ 테스트 로그인은 서버가 없어서 부르지 않습니다. (hooks/useServerHistoryPull.ts)
 */

/** 서버 응답을 기다리는 최대 시간(밀리초) */
const REQUEST_TIMEOUT_MS = 10000

// 어디까지 받았는지 적어 두는 이름입니다. (실제 키는 'study-server-history-pull')
// "모든 기록 지우기" 로 지우지 않습니다. 서버 것이 덜 지워졌을 때 그 기록을 다시 받아 오지 않으려는 것입니다.
export const SERVER_PULL_KEY = 'server-history-pull'

export interface ServerPullState {
  /** 받은 사람 (다른 계정으로 로그인하면 처음부터 다시 받습니다) */
  userId: string
  /** 이 날짜까지 받았음 ('YYYY-MM-DD') */
  through: string
}

export function loadServerPullState(): ServerPullState | null {
  const saved = loadData<unknown>(SERVER_PULL_KEY, null)
  if (typeof saved !== 'object' || saved === null) return null
  const state = saved as Record<string, unknown>
  if (typeof state.userId !== 'string' || typeof state.through !== 'string') return null
  return { userId: state.userId, through: state.through }
}

/**
 * 이번에 받을 날짜들을 31일씩 나눕니다. 오래된 것부터.
 * 처음(또는 다른 계정)이면 최근 6개월, 아니면 지난번에 받은 날부터 오늘까지입니다.
 * (지난번에 받은 날도 다시 받습니다. 그날 늦게 끝난 기록이 있을 수 있어서입니다)
 *
 *   getPullRanges(null, '7', '2026-10-27')                                   -> 6조각 (2026-04-25 ~ 2026-10-27)
 *   getPullRanges({ userId: '7', through: '2026-10-25' }, '7', '2026-10-27') -> [{ from: '2026-10-25', to: '2026-10-27' }]
 *   getPullRanges({ userId: '3', through: '2026-10-25' }, '7', '2026-10-27') -> 6조각 (다른 계정)
 */
export function getPullRanges(
  state: ServerPullState | null,
  userId: string,
  todayKey: string,
): { from: string; to: string }[] {
  const all = getServerRanges(todayKey)
  if (state === null || state.userId !== userId) return all
  const oldest = all[0].from
  const from = state.through < oldest ? oldest : state.through > todayKey ? todayKey : state.through
  const ranges: { from: string; to: string }[] = []
  for (let start = from; start <= todayKey; start = moveDateKey(start, SESSION_MAX_RANGE_DAYS)) {
    const end = moveDateKey(start, SESSION_MAX_RANGE_DAYS - 1)
    ranges.push({ from: start, to: end < todayKey ? end : todayKey })
  }
  return ranges
}

// ── 서버에서 받기 ──

/** 서버의 미루기 · 실패 표시 하나 (BE CardDayMarkResponse) */
export interface ServerMark {
  cardId: string
  date: string
  mark: 'postponed' | 'failed'
  reason: string | null
  cause: string | null
  newDate: string | null
  newStartTime: string | null
  createdAt: number
}

function isServerMark(value: unknown): value is ServerMark {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.cardId === 'string' &&
    typeof item.date === 'string' &&
    (item.mark === 'postponed' || item.mark === 'failed') &&
    typeof item.createdAt === 'number'
  )
}

/** 서버의 휴식 날 하나 (BE RestDayResponse) */
export interface ServerRestDay {
  date: string
  createdAt: number
}

function isServerRestDay(value: unknown): value is ServerRestDay {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return typeof item.date === 'string' && typeof item.createdAt === 'number'
}

/** 목록을 주는 GET 하나. 목록이 아니면 502 에러, 모양이 틀린 줄은 뺍니다. */
async function fetchList<T>(path: string, isItem: (value: unknown) => value is T): Promise<T[]> {
  const result = await api<unknown>(path, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!Array.isArray(result)) throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
  return result.filter(isItem)
}

function rangeQuery(range: { from: string; to: string }): string {
  return `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
}

export interface ServerHistory {
  sessions: StudySession[]
  marks: ServerMark[]
  restDays: ServerRestDay[]
  checkIns: ServerCheckIn[]
}

/** 기간들의 네 가지 기록을 한꺼번에 받습니다. 하나라도 실패하면 에러를 던집니다. (다음에 앱을 열 때 다시 받습니다) */
async function fetchServerHistory(ranges: { from: string; to: string }[]): Promise<ServerHistory> {
  const [sessions, marks, restDays, checkIns] = await Promise.all([
    Promise.all(ranges.map((range) => fetchSessionsByRange(range.from, range.to))),
    Promise.all(
      ranges.map((range) => fetchList(`/card-day-marks?${rangeQuery(range)}`, isServerMark)),
    ),
    Promise.all(
      ranges.map((range) => fetchList(`/rest-days?${rangeQuery(range)}`, isServerRestDay)),
    ),
    Promise.all(ranges.map((range) => fetchServerCheckIns(range.from, range.to))),
  ])
  return {
    sessions: sessions.flat(),
    marks: marks.flat(),
    restDays: restDays.flat(),
    checkIns: checkIns.flat(),
  }
}

// ── 이 기기에 없는 것만 고르기 (저장하지 않고 결과만 돌려줌) ──

/**
 * 서버 공부 기록 중 이 기기에 없는 것을 이 기기 모양으로 바꿉니다.
 *   - 이미 보낸 기록(sentServerIds) · 이미 받아 온 기록('server-번호') · 시작 시각이 1초 안으로 같은 기록은 뺍니다.
 *   - id 는 'server-번호', 카드 번호는 이 기기 카드 id 로 바꿉니다. 이 기기에 없는 카드면 카드 칸을 비웁니다.
 *
 *   서버 { id: '12', cardId: '7' } + 이 기기 카드 { id: 'card-s7', serverId: '7' } -> { id: 'server-12', cardId: 'card-s7' }
 */
export function pickNewSessions(
  server: StudySession[],
  local: StudySession[],
  sentServerIds: string[],
  cards: Card[],
): StudySession[] {
  const sent = new Set(sentServerIds)
  const localIds = new Set(local.map((session) => session.id))
  const cardIdByServerId = new Map<string, string>()
  for (const card of cards) {
    if (card.serverId) cardIdByServerId.set(card.serverId, card.id)
  }
  // 이미 있는 기록의 시작 시각들 (더한 기록도 넣어서, 서버가 같은 기록을 두 번 줘도 한 번만 더합니다)
  const starts = local.map((session) => session.startedAt)
  const added: StudySession[] = []
  for (const session of server) {
    const id = `server-${session.id}`
    if (sent.has(session.id) || localIds.has(id)) continue
    if (starts.some((startedAt) => Math.abs(startedAt - session.startedAt) < 1000)) continue
    const { cardId: serverCardId, ...rest } = session
    const cardId = serverCardId ? cardIdByServerId.get(serverCardId) : undefined
    added.push({ ...rest, id, ...(cardId ? { cardId } : {}) })
    starts.push(session.startedAt)
  }
  return added
}

/**
 * 서버 미루기 · 실패 중 이 기기에 없는 것. 같은 카드 · 같은 날짜에 이미 표시가 있으면 이 기기 것을 둡니다.
 * 이 기기에 없는 카드의 표시와 같은 카드 · 날짜가 두 번 온 것은 뺍니다.
 */
export function pickNewMarks(
  server: ServerMark[],
  local: CardDayMarkRecord[],
  cards: Card[],
): CardDayMarkRecord[] {
  const taken = new Set(local.map((mark) => `${mark.cardId}:${mark.dateKey}`))
  const added: CardDayMarkRecord[] = []
  for (const item of server) {
    const card = cards.find((one) => one.serverId === item.cardId)
    if (!card || taken.has(`${card.id}:${item.date}`)) continue
    taken.add(`${card.id}:${item.date}`)
    const mark: CardDayMarkRecord = {
      cardId: card.id,
      dateKey: item.date,
      mark: item.mark,
      at: item.createdAt,
    }
    if (item.reason) mark.reason = item.reason
    if (item.newDate) mark.newDate = item.newDate
    if (item.newStartTime) mark.newStartTime = item.newStartTime
    // 이 기기가 모르는 원인 글자면 비워 둡니다.
    const cause = CARD_FAIL_CAUSES.find((option) => option.key === item.cause)?.key
    if (cause) mark.cause = cause
    added.push(mark)
  }
  return added
}

/** 서버 휴식 날 중 이 기기에 없는 날. 서버에는 쉰 이유가 없어서 '기타' 로 둡니다. */
export function pickNewRestDays(server: ServerRestDay[], local: RestDay[]): RestDay[] {
  const taken = new Set(local.map((day) => day.date))
  const added: RestDay[] = []
  for (const item of server) {
    if (taken.has(item.date)) continue
    taken.add(item.date)
    added.push({ date: item.date, reason: 'etc', at: item.createdAt })
  }
  return added
}

// ── 받아서 저장하기 ──

/**
 * 서버 기록을 받아 이 기기에 없는 것만 더하고, 더한 개수를 돌려줍니다.
 * 저장하기 직전에 이 기기의 저장소를 다시 읽어서, 받는 사이에 새로 생긴 기록을 덮어쓰지 않습니다.
 */
export async function pullServerHistory(userId: string, todayKey: string): Promise<number> {
  const ranges = getPullRanges(loadServerPullState(), userId, todayKey)
  const server = await fetchServerHistory(ranges)
  // 카드는 useCardSync 가 서버 것으로 맞춘 뒤의 목록입니다. (받는 동안 그 일이 끝납니다)
  const cards = loadSavedCards() ?? []

  // 공부 기록
  const sessionState = loadSessionSyncState()
  const localSessions = loadAllSessions()
  const newSessions = pickNewSessions(
    server.sessions,
    localSessions,
    Object.values(sessionState.sent),
    cards,
  )
  if (newSessions.length > 0) {
    saveData('sessions', [...localSessions, ...newSessions])
    const sent = { ...sessionState.sent }
    for (const session of newSessions) sent[session.id] = session.id.slice('server-'.length)
    saveData(SESSION_SYNC_KEY, { ...sessionState, sent })
  }

  // 미루기 · 실패 · 휴식
  const localMarks = loadCardMarks()
  const newMarks = pickNewMarks(server.marks, localMarks, cards)
  if (newMarks.length > 0) saveData(CARD_MARKS_KEY, [...localMarks, ...newMarks])
  const localRestDays = loadRestDays()
  const newRestDays = pickNewRestDays(server.restDays, localRestDays)
  if (newRestDays.length > 0) saveData(REST_DAYS_KEY, [...localRestDays, ...newRestDays])

  // 받아 온 것은 보낸 것으로 적습니다. 사후 입력 기록도 lib/markSync.ts 가 다시 보내지 않게 같이 적습니다.
  const markSentKeys = [
    ...newMarks.map(markKeyOf),
    ...newRestDays.map(restKeyOf),
    ...newSessions.filter((session) => session.mode === 'selfReport').map((session) => session.id),
  ]
  if (markSentKeys.length > 0) {
    const markState = loadMarkSyncState()
    saveData(MARK_SYNC_KEY, {
      ...markState,
      sent: [...new Set([...markState.sent, ...markSentKeys])],
    })
  }

  // 체크인 (기분이 없는 체크인은 이 기기 모양으로 못 바꿔서 뺍니다)
  let newCheckIns = 0
  for (const item of server.checkIns) {
    const checkIn = fromServerCheckIn(item)
    if (checkIn === null || hasCheckIn(checkIn.date)) continue
    saveLocalCheckIn(checkIn)
    newCheckIns += 1
  }

  saveData(SERVER_PULL_KEY, { userId, through: todayKey } satisfies ServerPullState)
  return newSessions.length + newMarks.length + newRestDays.length + newCheckIns
}
