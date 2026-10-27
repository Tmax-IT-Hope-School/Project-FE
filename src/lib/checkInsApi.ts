/**
 * 매일 체크인을 서버(BE)에도 저장하는 함수들입니다. (#321, BE 이슈 #24)
 *
 * 서버와 정한 약속입니다. (BE 저장소의 docs/API.md "체크인") 전부 로그인이 필요합니다.
 *   그날의 체크인 저장   PUT /checkins/2026-10-17   { source, condition, mood, missReason, ... } -> 200 ServerCheckIn
 *                        같은 날을 다시 보내면 덮어씁니다. 덮어쓰기는 "전부 바꾸기" 라서, 안 보낸 칸은 서버에서 비워집니다.
 *   기간 안의 체크인     GET /checkins?from=2026-10-17&to=2026-10-17                -> 200 ServerCheckIn[] (없으면 [])
 *
 * ■ 이 기기의 저장소(localStorage 의 study-checkins)는 그대로 씁니다. 서버에는 "같이" 저장합니다.
 *   체크인은 통화 카드 · 안전 브레이크 · 인사이트 등 여러 곳이 이 기기의 저장소에서 읽습니다.
 *   그 코드를 한꺼번에 바꾸지 않으려고, 저장할 때 기기에 먼저 저장하고 서버로도 보냅니다.
 *   그래서 서버에 못 보내도 방금 고른 기분은 사라지지 않습니다. 못 보낸 날은 적어 두었다가 다음에 다시 보냅니다.
 *
 * ■ 서버에서 읽어 오는 것은 세 가지입니다.
 *   1. 코치 화면을 열 때 "오늘 체크인을 했는지" (다른 기기에서 했으면 다시 묻지 않으려고. pages/CoachPage.tsx)
 *   2. 보내기 직전에 서버에 있는 그날의 체크인.
 *      - 1탭 체크인은 AI 통화가 채운 칸(어제 못 채운 이유 등)이 덮어쓰기로 지워지지 않게, 비어 있는 칸만 서버 값으로 채워 보냅니다.
 *      - 자세히 체크인(/check)은 학생이 화면에서 보고 고친 그대로 보냅니다. 약속을 일부러 지웠는데 서버의 옛 약속이
 *        다시 채워지면 안 되기 때문입니다. (서버 규칙도 "마지막에 보낸 그대로" 입니다)
 *   3. 지난 날들의 체크인 (fetchServerCheckIns). 이 기기에 그날 체크인이 없을 때만 lib/serverHistoryPull.ts 가 적어 둡니다. (2026-10-27)
 *      "모든 기록 지우기" 가 서버의 체크인도 같이 지워서, 받아 와도 지운 기록이 되살아나지 않습니다.
 *
 * ■ 테스트 로그인(서버가 모르는 가짜 토큰)일 때는 서버를 부르지 않고 지금처럼 이 기기에만 저장합니다. (canSyncCheckIns)
 *
 * ⚠️ 체크인의 글(기타 이유)은 console.log 로 찍지 않습니다.
 *
 * ■ 예상 순공 · 오늘의 약속 · 개선안 실천(v2 체크인)은 #417 에서 지웠습니다. 서버가 그 칸을 줘도 읽지 않고, 보내지도 않습니다.
 */
import { api } from '@/lib/api'
import { hasCheckIn, isEmotionTag, saveLocalCheckIn } from '@/lib/quickCheckIn'
import { loadData, saveData } from '@/lib/storage'
import { TEST_TOKEN } from '@/lib/testLogin'
import type { CheckIn, EmotionTag, MissReason } from '@/types'
import { queryOptions } from '@tanstack/react-query'

/** 서버 응답을 기다리는 최대 시간(밀리초). 서버가 늦어도 체크인 화면에 오래 갇히지 않게 합니다. */
const REQUEST_TIMEOUT_MS = 10000

/** 서버에 못 보낸 체크인의 날짜들을 적어 두는 저장 키. "모든 기록 지우기" 로 같이 지워집니다. (lib/myData.ts) */
export const UNSENT_CHECKINS_KEY = 'checkins-unsent'

/** 어디서 한 체크인인지. manual: 자세히 체크인(/check) · quick: 1탭 체크인(코치의 컨디션 칩) · call: AI 통화가 만든 것 */
type CheckInSource = 'manual' | 'quick' | 'call'

const MISS_REASONS: MissReason[] = [
  'tired',
  'event',
  'phone',
  'tooMuch',
  'unwilling',
  'sick',
  'etc',
]

/** 서버가 주는 체크인 하나의 모양. 답하지 않은 칸은 null 입니다. */
export interface ServerCheckIn {
  date: string
  source: CheckInSource
  condition: number | null
  mood: number | null
  missReason: MissReason | null
  missReasonNote: string | null
  /** 감정 태그 (BE#220). 아직 이 칸을 주지 않는 서버도 있어서 없을 수 있습니다. */
  emotions?: unknown
}

/** 서버로 보내는 모양 (PUT 본문). 날짜는 주소에 넣습니다. */
interface CheckInBody {
  source: CheckInSource
  condition: number
  mood: number
  missReason: MissReason | null
  missReasonNote: string | null
  /** 감정 태그 (BE#220). 모르면 null. 이 칸을 아직 모르는 서버는 무시합니다. (Spring Boot 기본 설정) */
  emotions: EmotionTag[] | null
}

/** 이 토큰으로 서버에 체크인을 저장할 수 있는지. 로그아웃 상태와 테스트 로그인은 false 입니다. */
export function canSyncCheckIns(token: string | null): boolean {
  return token !== null && token !== TEST_TOKEN
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || typeof value === 'number'
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

/** 서버가 준 값이 체크인 모양이 맞는지 확인합니다. (서버 응답도 그대로 믿지 않고 확인합니다) */
function isServerCheckIn(value: unknown): value is ServerCheckIn {
  if (typeof value !== 'object' || value === null) return false
  const checkIn = value as Record<string, unknown>
  return (
    typeof checkIn.date === 'string' &&
    (checkIn.source === 'manual' || checkIn.source === 'quick' || checkIn.source === 'call') &&
    isNumberOrNull(checkIn.condition) &&
    isNumberOrNull(checkIn.mood) &&
    (checkIn.missReason === null || MISS_REASONS.includes(checkIn.missReason as MissReason)) &&
    isStringOrNull(checkIn.missReasonNote)
  )
}

/** 서버가 준 감정 태그를 이 기기의 모양으로 바꿉니다. 목록이 아니거나 모르는 이름은 뺍니다. */
function toEmotionTags(value: unknown): EmotionTag[] {
  return Array.isArray(value) ? value.filter(isEmotionTag) : []
}

/**
 * 이 기기의 체크인에서 비어 있는 칸만 서버 값으로 채웁니다. 이 기기에 적힌 값은 바꾸지 않습니다.
 * AI 통화가 서버에 채운 "어제 못 채운 이유" · "약속" 을, 이 기기의 체크인을 보낼 때 지우지 않으려는 것입니다.
 *
 *   이 기기 { mood: 4 }  +  서버 { mood: 2, missReason: 'phone' }  ->  { mood: 4, missReason: 'phone' }
 *   이 기기 { mood: 4, missReason: 'tired' }  +  서버 { missReason: 'phone' }  ->  missReason 은 'tired' 그대로
 */
export function fillBlanksFromServer(local: CheckIn, server: ServerCheckIn): CheckIn {
  const filled: CheckIn = { ...local }
  if (filled.missReason === undefined && server.missReason !== null) {
    filled.missReason = server.missReason
    if (server.missReason === 'etc' && server.missReasonNote !== null) {
      filled.missReasonNote = server.missReasonNote
    }
  }
  // 감정 태그는 이 기기에서 하나도 안 골랐을 때만 서버 것을 가져옵니다. (모르는 이름은 뺍니다)
  const serverEmotions = toEmotionTags(server.emotions)
  if (
    (filled.emotions === undefined || filled.emotions.length === 0) &&
    serverEmotions.length > 0
  ) {
    filled.emotions = serverEmotions
  }
  return filled
}

/**
 * 서버의 체크인을 이 기기의 체크인 모양으로 바꿉니다. 이 기기에 그날 체크인이 없을 때(다른 기기에서 했을 때) 씁니다.
 * 기분이 없는 체크인(기분을 말하지 않은 통화 등)은 null 입니다. 이 기기의 체크인은 기분이 꼭 있어야 해서, 그날은 다시 묻습니다.
 * 컨디션이 비었으면 기분과 같은 값으로 채웁니다. (1탭 체크인과 같은 규칙. lib/quickCheckIn.ts)
 * 예전 자세히 체크인(manual)이 아니면 isQuick 을 붙입니다. (다시 보낼 때 출처를 정하는 데 씁니다)
 */
export function fromServerCheckIn(server: ServerCheckIn): CheckIn | null {
  if (server.mood === null) return null
  const checkIn: CheckIn = {
    date: server.date,
    condition: server.condition ?? server.mood,
    mood: server.mood,
  }
  if (server.source !== 'manual') checkIn.isQuick = true
  return fillBlanksFromServer(checkIn, server)
}

/**
 * 이 기기의 체크인을 서버로 보내는 모양으로 바꿉니다.
 *   - isQuick 은 서버에 없는 칸이라 보내지 않습니다.
 *   - 1탭 체크인인데 서버의 그날 체크인이 AI 통화(call)로 만든 것이면 call 을 그대로 둡니다.
 */
export function toServerBody(checkIn: CheckIn, server: ServerCheckIn | null): CheckInBody {
  let source: CheckInSource = 'manual'
  if (checkIn.isQuick === true) source = server?.source === 'call' ? 'call' : 'quick'
  return {
    source,
    condition: checkIn.condition,
    mood: checkIn.mood,
    missReason: checkIn.missReason ?? null,
    // 서버는 '기타' 가 아닐 때 이유 글을 받지 않습니다.
    missReasonNote: checkIn.missReason === 'etc' ? (checkIn.missReasonNote ?? null) : null,
    // 1탭 체크인에서 고른 감정 태그. 자세히 체크인처럼 태그를 묻지 않은 체크인은 null("모름")로 보냅니다.
    emotions: checkIn.emotions ?? null,
  }
}

/** 서버에 있는 그날의 체크인. 없으면 null 입니다. 서버에 닿지 못하면 에러를 던집니다. */
async function fetchServerCheckIn(date: string): Promise<ServerCheckIn | null> {
  const query = `from=${encodeURIComponent(date)}&to=${encodeURIComponent(date)}`
  const result = await api<unknown>(`/checkins?${query}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!Array.isArray(result)) return null
  const found = result.find((item) => isServerCheckIn(item) && item.date === date)
  return found === undefined ? null : (found as ServerCheckIn)
}

/** 기간 안(31일까지)의 서버 체크인 목록. 모양이 틀린 것은 뺍니다. (lib/serverHistoryPull.ts 가 이 기기로 받아 올 때 씁니다) */
export async function fetchServerCheckIns(from: string, to: string): Promise<ServerCheckIn[]> {
  const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  const result = await api<unknown>(`/checkins?${query}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  return Array.isArray(result) ? result.filter(isServerCheckIn) : []
}

/**
 * 체크인을 서버로 보냅니다.
 * 1탭 체크인이고 서버에 그날 체크인이 있으면, 이 기기에서 비어 있는 칸만 서버 값으로 채워서 보냅니다. (fillBlanksFromServer)
 * 1탭 체크인은 학생이 기분만 골라서, 다른 칸이 비어 있는 것이 "지웠다" 는 뜻이 아니기 때문입니다.
 * 자세히 체크인은 학생이 고친 그대로 보냅니다.
 * 보낸 체크인을 돌려줍니다. 부르는 쪽이 그것을 이 기기에도 저장하면, 서버와 이 기기의 그날 체크인이 같아집니다.
 * 실패하면 에러를 던집니다. 보낸 체크인은 부르는 쪽(이 기기의 저장소)에 그대로 있습니다.
 */
export async function sendCheckIn(checkIn: CheckIn): Promise<CheckIn> {
  const server = await fetchServerCheckIn(checkIn.date)
  const merged =
    server !== null && checkIn.isQuick === true ? fillBlanksFromServer(checkIn, server) : checkIn
  await api<unknown>(`/checkins/${encodeURIComponent(checkIn.date)}`, {
    method: 'PUT',
    body: JSON.stringify(toServerBody(merged, server)),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  return merged
}

/**
 * 서버에 있는 오늘의 체크인을 받아서, 이 기기에 오늘 체크인이 없으면 이 기기에도 적어 둡니다.
 * (다른 기기에서 체크인했으면 이 기기에서 다시 묻지 않으려는 것입니다)
 * 기분이 없는 체크인이면 적지 않습니다. 이 기기에 이미 있으면 덮어쓰지 않습니다.
 */
async function copyTodayFromServer(todayKey: string): Promise<ServerCheckIn | null> {
  const server = await fetchServerCheckIn(todayKey)
  if (server !== null && !hasCheckIn(todayKey)) {
    const checkIn = fromServerCheckIn(server)
    if (checkIn !== null) saveLocalCheckIn(checkIn)
  }
  return server
}

/**
 * 코치 화면이 첫 말을 만들기 전에 쓰는 "오늘 체크인" 쿼리입니다.
 * 진짜 로그인이면(canSync) 서버의 오늘 체크인을 받아서, 이 기기에 오늘 체크인이 없으면 서버 것을 적어 둡니다. (copyTodayFromServer)
 * 다른 기기에서 이미 컨디션을 알려 줬으면 코치가 다시 묻지 않게 하려는 것입니다. (#321)
 * 그래서 화면은 받아온 뒤에 이 기기의 저장소(loadLocalCheckIn)만 보면 됩니다.
 * 테스트 로그인이면 서버를 부르지 않고 바로 null, 서버에 닿지 못하거나 거절하면 에러 대신 null 입니다.
 */
export function todayCheckInForCoachQuery(todayKey: string, canSync: boolean) {
  return queryOptions({
    queryKey: ['checkins', 'today', todayKey, canSync],
    queryFn: async (): Promise<ServerCheckIn | null> => {
      if (!canSync) return null
      try {
        return await copyTodayFromServer(todayKey)
      } catch {
        // 서버가 꺼져 있거나 늦으면 "모름" 으로 보고 이 기기의 값을 씁니다. (이슈 #321 완료 조건)
        return null
      }
    },
    // 하루에 한 번 확인하면 되는 값이라, 5분 동안은 다시 받아오지 않습니다.
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * 서버에 저장된 내 체크인을 모두 지웁니다. 설정의 "모든 기록 지우기" 가 부릅니다. (BE: DELETE /checkins -> 204)
 * 이 기기의 체크인은 따로 지웁니다. (lib/myData.ts 의 deleteMyData)
 * 실패하면 에러를 던집니다.
 */
export async function deleteServerCheckIns(): Promise<void> {
  await api<void>('/checkins', {
    method: 'DELETE',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

/** 서버에 못 보낸 체크인의 날짜들 */
export function loadUnsentDates(): string[] {
  const saved = loadData<unknown>(UNSENT_CHECKINS_KEY, [])
  return Array.isArray(saved) ? saved.filter((date) => typeof date === 'string') : []
}

/** 그 날짜를 "서버에 못 보냄" 으로 적어 둡니다. */
export function markUnsent(date: string): void {
  const dates = loadUnsentDates()
  if (!dates.includes(date)) saveData(UNSENT_CHECKINS_KEY, [...dates, date])
}

/** 그 날짜를 "서버에 못 보냄" 목록에서 지웁니다. */
export function clearUnsent(date: string): void {
  saveData(
    UNSENT_CHECKINS_KEY,
    loadUnsentDates().filter((item) => item !== date),
  )
}
