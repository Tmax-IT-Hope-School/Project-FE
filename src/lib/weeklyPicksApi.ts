/**
 * "이번 주에 고른 것"(lib/weeklyPicks.ts)을 서버(BE)에도 저장하고 받아오는 함수들입니다. (#654, BE #416)
 *
 * 서버와 정한 약속입니다. (BE 저장소의 docs/API.md "weekly-picks") 전부 로그인이 필요합니다.
 *   그 주에 고른 것 저장   PUT /weekly-picks/2026-10-26   { title, hint, skip, decidedAt }
 *                          -> 200 { id: '5', weekStart, title, hint, skip, decidedAt }
 *                          한 주에 하나만 두고, 같은 주를 다시 보내면 덮어씁니다.
 *   기간 안의 고른 것      GET /weekly-picks?from=2026-04-20&to=2026-11-02
 *                          -> 200 [...] (오래된 주부터, 없으면 []) · 한 번에 366일까지
 *   실패                   400 주소의 날짜가 월요일이 아님 · title · hint 가 비었거나 60자를 넘음 · skip 없음 · decidedAt 이 0 이하
 *
 * ■ 이 기기(localStorage)에 먼저 저장하고, 서버에는 "같이" 저장합니다. (체크인과 같은 방식, lib/checkInsApi.ts)
 *   그래서 서버에 못 보내도 방금 고른 것은 사라지지 않습니다. 못 보낸 주는 적어 두었다가 다음에 기록 탭을 열 때 다시 보냅니다.
 *   - 기록 탭을 열면 서버의 고른 것(지난 26주 ~ 다음 주)을 받아 이 기기 것과 합쳐 봅니다. (mergeServerPicks)
 *   - 이 기기에만 있는 것(이 기능 전에 고른 것 등)은 그때 한 번 서버로 올립니다. (findPicksToSend)
 *   - 시연용 가상 데이터('demo-' 로 시작하는 id)는 서버로 보내지 않습니다.
 *   - 테스트 로그인(서버가 모르는 가짜 토큰)이면 서버를 부르지 않고 이 기기에만 저장합니다. (hooks/useWeeklyPicks.ts)
 *
 * ⚠️ 서버에는 고른 것을 지우는 주소가 없습니다. 그래서 "모든 기록 지우기" 를 해도 서버에 올라간 고른 것은
 *    다음에 기록 탭을 열 때 다시 보입니다. (서버 기록은 탈퇴할 때 지워집니다)
 */
import { api, ApiError } from '@/lib/api'
import { isDateKey, moveDateKey } from '@/lib/date'
import { DEMO_ID_PREFIX } from '@/lib/demoPersona'
import { getWeekStart } from '@/lib/historyReport'
import { getWeekday } from '@/lib/routines'
import { loadData, saveData } from '@/lib/storage'
import type { WeeklyPick } from '@/lib/weeklyPicks'
import { queryOptions } from '@tanstack/react-query'

/** 서버 응답을 기다리는 최대 시간(밀리초). 서버가 늦어도 기록 탭이 오래 멈춰 있지 않게 합니다. */
const REQUEST_TIMEOUT_MS = 10000

/** 서버가 받는 title · hint 의 최대 글자 수 (앞뒤 빈칸을 지운 뒤) */
const MAX_TEXT_LENGTH = 60

/** 서버에서 받아 올 지난 주 수 (약 6개월. 공부 기록을 받아 오는 기간과 비슷하게 맞췄습니다) */
const SERVER_PICK_WEEKS = 26

/** 서버에 못 보낸 고른 것의 주(월요일 날짜)들을 적어 두는 저장 키. "모든 기록 지우기" 로 같이 지워집니다. (lib/myData.ts) */
export const UNSENT_WEEKLY_PICKS_KEY = 'weekly-picks-unsent'

/** 고른 것 쿼리의 이름표 앞부분. 서버에 저장한 뒤 이 이름표로 "낡았다" 고 표시해서 다시 받게 합니다. */
export const WEEKLY_PICKS_QUERY_KEY = ['weekly-picks'] as const

// ---------------------------------------------------------------------------
// 서버 부르기
// ---------------------------------------------------------------------------

/** 서버가 준 값 하나를 WeeklyPick 으로 바꿉니다. 모양이 틀리면 null (깨진 항목 하나가 화면을 멈추지 않게) */
function toWeeklyPick(value: unknown): WeeklyPick | null {
  if (typeof value !== 'object' || value === null) return null
  const item = value as Record<string, unknown>
  if (typeof item.weekStart !== 'string' || !isDateKey(item.weekStart)) return null
  if (typeof item.title !== 'string' || typeof item.hint !== 'string') return null
  if (typeof item.skip !== 'boolean') return null
  if (typeof item.decidedAt !== 'number' || !Number.isFinite(item.decidedAt)) return null
  return {
    // 이 기기에서 고른 것과 같은 id 모양으로 둡니다. 한 주에 하나라서 겹치지 않습니다.
    id: `pick-${item.weekStart}`,
    weekStart: item.weekStart,
    title: item.title,
    hint: item.hint,
    skip: item.skip,
    decidedAt: item.decidedAt,
  }
}

/**
 * 기간 안(from ~ to, 둘 다 포함)에 시작한 주의 고른 것들을 서버에서 받아옵니다. 오래된 주부터 옵니다.
 * 서버에 닿지 못하거나 거절하면 에러를 던집니다.
 *
 *   await fetchWeeklyPicks('2026-10-01', '2026-10-31')  -> [{ id: 'pick-2026-10-19', weekStart: '2026-10-19', … }]
 */
export async function fetchWeeklyPicks(from: string, to: string): Promise<WeeklyPick[]> {
  const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  const result = await api<unknown>(`/weekly-picks?${query}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  // 502: 서버가 이상한 모양의 답을 줬다는 뜻으로 씁니다.
  if (!Array.isArray(result)) throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
  return result.map(toWeeklyPick).filter((pick) => pick !== null)
}

/**
 * 고른 것 하나를 서버에 저장합니다. 같은 주에 이미 있으면 서버가 덮어씁니다.
 * 이 기기에서 고른 시각(decidedAt)을 그대로 보냅니다. 서버가 저장한 것을 돌려줍니다.
 * 실패하면 에러를 던집니다. 보낸 것은 이 기기의 저장소에 그대로 있습니다.
 */
export async function saveWeeklyPickToServer(pick: WeeklyPick): Promise<WeeklyPick> {
  const result = await api<unknown>(`/weekly-picks/${encodeURIComponent(pick.weekStart)}`, {
    method: 'PUT',
    body: JSON.stringify({
      title: pick.title.trim(),
      hint: pick.hint.trim(),
      skip: pick.skip,
      decidedAt: pick.decidedAt,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const saved = toWeeklyPick(result)
  if (saved === null) throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
  return saved
}

/**
 * 기록 탭에서 받아 올 기간. 오늘이 든 주의 26주 전 월요일 ~ 다음 주 월요일입니다.
 * (다음 주에 해 볼 것을 이번 주에 미리 고르기 때문에 다음 주까지 받습니다)
 *
 *   getPicksRange('2026-10-24')  -> { from: '2026-04-20', to: '2026-10-26' }
 */
export function getPicksRange(todayKey: string): { from: string; to: string } {
  const thisWeekStart = getWeekStart(todayKey)
  return {
    from: moveDateKey(thisWeekStart, -7 * SERVER_PICK_WEEKS),
    to: moveDateKey(thisWeekStart, 7),
  }
}

/**
 * 기간 안의 고른 것 쿼리 설정입니다. 화면에서는 useSuspenseQueries · useSuspenseQuery 로 받아옵니다. (docs/DATA-FETCHING.md)
 * 서버에 닿지 못하거나 거절하면 에러 대신 null("모름") 입니다. 그러면 화면은 이 기기의 것만 보여 줍니다.
 * 고른 것을 못 받았다고 기록 탭 전체가 실패 안내로 바뀌지 않게 하려는 것입니다. (체크인의 todayCheckInForCoachQuery 와 같은 방식)
 */
export function weeklyPicksQuery(from: string, to: string) {
  return queryOptions({
    queryKey: [...WEEKLY_PICKS_QUERY_KEY, from, to],
    queryFn: async (): Promise<WeeklyPick[] | null> => {
      try {
        return await fetchWeeklyPicks(from, to)
      } catch {
        return null
      }
    },
  })
}

// ---------------------------------------------------------------------------
// 이 기기 것과 서버 것 맞추기 (React 없이 도는 규칙)
// ---------------------------------------------------------------------------

/**
 * 서버로 보내도 되는 것인지 확인합니다. 서버가 거절할 것(400)은 미리 거릅니다.
 *   - 시연용 가상 데이터('demo-' 로 시작) 는 보내지 않습니다.
 *   - 주의 시작이 월요일 날짜가 아니면 보내지 않습니다.
 *   - title · hint 가 비었거나 60자를 넘으면 보내지 않습니다. (앞뒤 빈칸을 지운 뒤)
 *
 *   canSendPick({ id: 'pick-2026-10-26', weekStart: '2026-10-26', title: '폰을 다른 방에 두기', … })  -> true
 *   canSendPick({ id: 'demo-pick-2026-10-19', … })                                                -> false
 */
export function canSendPick(pick: WeeklyPick): boolean {
  if (pick.id.startsWith(DEMO_ID_PREFIX)) return false
  if (!isDateKey(pick.weekStart) || getWeekday(pick.weekStart) !== 1) return false
  const title = pick.title.trim()
  const hint = pick.hint.trim()
  return (
    title.length > 0 &&
    title.length <= MAX_TEXT_LENGTH &&
    hint.length > 0 &&
    hint.length <= MAX_TEXT_LENGTH &&
    pick.decidedAt > 0
  )
}

/** 서버에 못 보낸 고른 것의 주(월요일 날짜)들 */
export function loadUnsentPickWeeks(): string[] {
  const saved = loadData<unknown>(UNSENT_WEEKLY_PICKS_KEY, [])
  return Array.isArray(saved) ? saved.filter((week) => typeof week === 'string') : []
}

/** 그 주를 "서버에 못 보냄" 으로 적어 둡니다. */
export function markPickUnsent(weekStart: string): void {
  const weeks = loadUnsentPickWeeks()
  if (!weeks.includes(weekStart)) saveData(UNSENT_WEEKLY_PICKS_KEY, [...weeks, weekStart])
}

/** 그 주를 "서버에 못 보냄" 목록에서 지웁니다. */
export function clearPickUnsent(weekStart: string): void {
  saveData(
    UNSENT_WEEKLY_PICKS_KEY,
    loadUnsentPickWeeks().filter((week) => week !== weekStart),
  )
}

/**
 * 이 기기의 고른 것과 서버의 고른 것을 합칩니다. 한 주에 하나만 남깁니다.
 *   - 둘 다 있는 주: 서버 것 (다른 기기에서 새로 골랐을 수 있어서)
 *     단, 이 기기에서 골랐는데 아직 서버에 못 보낸 주(unsentWeeks)는 이 기기 것 (이 기기 것이 더 새것)
 *   - 서버에만 있는 주: 서버 것 (다른 기기에서 고른 것)
 *   - 이 기기에만 있는 주: 이 기기 것 (아직 안 올라간 것 · 시연 데이터 · 받아 온 기간 밖)
 *
 *   이 기기 [10/19 'A']  +  서버 [10/19 'B', 10/26 'C']             -> [10/19 'B', 10/26 'C']
 *   이 기기 [10/19 'A']  +  서버 [10/19 'B'],  못 보낸 주 ['10/19']  -> [10/19 'A']
 */
export function mergeServerPicks(
  local: WeeklyPick[],
  server: WeeklyPick[],
  unsentWeeks: string[],
): WeeklyPick[] {
  const fromServer = server.map((serverPick) => {
    const localPick = local.find((pick) => pick.weekStart === serverPick.weekStart)
    const isUnsent = unsentWeeks.includes(serverPick.weekStart)
    return localPick !== undefined && isUnsent ? localPick : serverPick
  })
  const localOnly = local.filter(
    (pick) => !server.some((serverPick) => serverPick.weekStart === pick.weekStart),
  )
  return [...fromServer, ...localOnly]
}

/**
 * 기록 탭을 열었을 때 서버로 보낼 이 기기의 고른 것들입니다. (보내도 되는 것만, canSendPick)
 *   1. 못 보낸 주(unsentWeeks)의 것 — 지난번에 보내다 실패한 것
 *   2. 받아 온 기간(range) 안에 있는데 서버에 없는 것 — 이 기능 전에 이 기기에만 저장한 것 (한 번 올리면 다음부터는 서버에 있음)
 * 받아 온 기간 밖의 것은 서버에 있는지 몰라서 보내지 않습니다.
 */
export function findPicksToSend(
  local: WeeklyPick[],
  server: WeeklyPick[],
  unsentWeeks: string[],
  range: { from: string; to: string },
): WeeklyPick[] {
  return local.filter(canSendPick).filter((pick) => {
    if (unsentWeeks.includes(pick.weekStart)) return true
    const isInRange = pick.weekStart >= range.from && pick.weekStart <= range.to
    const isOnServer = server.some((serverPick) => serverPick.weekStart === pick.weekStart)
    return isInRange && !isOnServer
  })
}
