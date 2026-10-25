/**
 * AI 코치(멘토) 채팅을 서버(BE)와 주고받는 함수들입니다. (#416, BE 이슈 #238 → 2026-10-18 코치 탭)
 * 채팅은 "글로 하는 통화" 입니다. 통화와 같은 대본으로 AI 코치와 이야기합니다.
 *
 * 서버와 정한 약속입니다. (BE 저장소의 docs/API.md "상담 채팅") 전부 로그인이 필요합니다.
 *   열기      POST /chats?grade=2&classNo=1   { careLevel, maxHarshness, card, room?, about? }   (학년 · 반은 있으면 — 오늘 시간표를 대본에)
 *                                         -> 200 { chatId, reply, showHelp, helpLines, quickReplies?, action?, tags? }
 *             POST /chats?greet=false     (같은 본문) -> 200 { chatId, reply: null, … }  첫 인사 없이 채팅 번호만 (BE 채팅 수정 1)
 *   말 보내기  POST /chats/{chatId}/messages { lines: [{ speaker: 'ai' | 'me', text }], image? }  (이 서버 세션의 대화 전체)
 *                                         -> 200 (위와 같은 모양)
 *   room  · about · image · tags 는 대화방 3개(BE #330, 2026-10-18)부터입니다.
 *     room  — 어느 방인지: COACH(기본, 💬 상담) · PLANNER(📅 계획) · TUTOR(📚 과목 쌤). lib/chatRooms.ts
 *     about — 무엇에 대한 대화인지: 종류 + 이 기기에서 만든 사실 줄 1~8개. 서버가 첫 말을 그 주제로 꺼냅니다.
 *     image — 이번 말에 붙인 사진 한 장(줄인 data URL). 그 한 번의 답에만 쓰고 서버 · 이 기기 어디에도 저장하지 않습니다.
 *     tags  — 후기 · 못 한 카드 대화에서 AI 가 학생 말로 짐작한 이유 값 (0~3개). 화면은 "맞아?" 로 확인만 받습니다.
 *     otherRooms — 말 보내기에 같이 보내는, 오늘 다른 대화방에서 학생이 한 말 몇 줄 (2026-10-22, lib/coachThread.ts 의 otherRoomLines).
 *                  서버가 그 한 번의 답에만 대본에 붙이고 저장하지 않습니다. 그래서 다른 방 이야기를 이 방 AI 도 압니다.
 *   sources (BE #342, 2026-10-18) — 📚 과목 쌤 방에서 AI 가 웹 검색을 했을 때 답에 쓴 출처 (0~3개, { title, url }).
 *     서버가 교육 · 공공 · 백과사전 사이트만 남겨 줍니다. 화면은 답 아래에 작은 링크로 보여 줍니다.
 *   정리하기  POST /calls/{chatId}/finish (lib/callReview.ts 의 finishCall). 코치 탭은 날이 바뀌면 지난 세션을 조용히 정리합니다.
 *             정리한 요약은 서버 대본의 [지난 통화] 로 들어가서, 다음 날 AI 가 "어제 약속 지켰어?" 처럼 이어서 물어봅니다.
 *   실패      400 대화 모양이 틀림 · 409 이미 끝났거나 서버가 대본을 잊음 · 429 오늘 AI 사용량을 다 씀 · 503 AI 가 꺼져 있음
 *
 * - 열기 요청은 통화를 걸 때와 똑같습니다. (말투 · 학생 카드. pages/CallActivePage.tsx)
 *   서버는 숫자를 서버의 기록으로 다시 계산하고, 서버에 기록이 없을 때만 이 카드를 씁니다.
 * - showHelp 가 true 면 학생의 말에서 위기 표현이 감지된 것입니다. reply 는 서버가 정해 둔 안내입니다. (BE #307 부터 채팅은 이어 갑니다)
 * - quickReplies · action 은 AI 가 고른 빠른 답 · 행동입니다(BE #309, #327). 없거나 모양이 틀리면 빈 값으로 봅니다.
 *   action 의 day_plan · startTime 은 계획 방 고도화(FE #695 · BE #431)부터입니다. 서버가 아직 안 주면 그냥 안 옵니다.
 *
 * ⚠️ 대화는 학생의 마음 이야기입니다. **서버에는 저장하지 않습니다.** 서버는 답을 받는 데만 쓰고, 정리할 때 요약만 남깁니다.
 *    대신 **이 기기에는** 남깁니다. (lib/coachThread.ts, 2026-10-18 사용자 결정: "멘토와 연속적인 대화를 한다는 느낌으로")
 *    지난 대화가 이어 보여야 멘토와 계속 이야기하는 것 같기 때문입니다. 설정의 "모든 기록 지우기" 로 지울 수 있습니다.
 *    console.log 로 찍지 않습니다.
 */
import { api, ApiError } from '@/lib/api'
import { loadCallCard } from '@/lib/callCard'
import { loadStudySignals } from '@/lib/studySignals'
import type { CallLine } from '@/lib/callReview'
import type { ChatAbout, ServerChatRoom } from '@/lib/chatRooms'
import { loadSchoolClass } from '@/lib/schoolToday'
import { getCallTone } from '@/lib/todayCare'

// 서버가 GPT 의 답을 기다리는 시간(15초)보다 조금 넉넉하게 기다립니다.
const REQUEST_TIMEOUT_MS = 25_000

/** 서버가 받는 대화의 한도입니다. (BE ChatMessageRequest: 60줄, 한 줄 500자) */
export const MAX_CHAT_LINES = 60
export const MAX_CHAT_TEXT_LENGTH = 500

/** 도움받을 곳 하나 (서버의 HelpLine 과 같은 모양) */
export interface ChatHelpLine {
  name: string
  number: string
  detail: string
}

/**
 * AI 가 함께 제안한 행동 하나. 화면은 칩으로 보여 주고, 누를 때만 실행합니다.
 *   start_timer  — 지금 공부 시작 · shrink_today — 오늘 목표를 줄여서 시작 · create_card — 그 제목의 카드로 시작
 *   make_plan    — 시험 · 대회 날까지의 긴 계획 짜기 (title = 목표 한 줄, date = 그 날. BE #327, 2026-10-18)
 *   start_quiz   — 그 주제로 확인 문제 풀기 (title = 주제)
 *   day_plan     — 학생과 정한 대로 오늘 계획 짜기 (minutes = 오늘 총 공부 분, title = 먼저 할 것, startTime = 시작 시각. #695)
 *                  이것만은 칩을 기다리지 않고 계획 방이 바로 계획을 짭니다. (pages/ChatRoomPage.tsx)
 */
export interface ChatAction {
  type: 'start_timer' | 'shrink_today' | 'create_card' | 'make_plan' | 'start_quiz' | 'day_plan'
  /** 분. day_plan 은 오늘 총 공부 분(20 ~ 600), 나머지는 카드 하나의 분(5 ~ 120). 모르면 null */
  minutes: number | null
  /** create_card 의 카드 제목 · make_plan 의 목표 · start_quiz 의 주제 · day_plan 의 먼저 할 것 (30자까지). 모르면 null */
  title: string | null
  /** make_plan 의 시험 · 대회 날 'YYYY-MM-DD'. 모르거나 서버가 범위(내일 ~ 30일 뒤) 밖이라고 비웠으면 null */
  date: string | null
  /** day_plan 의 시작 시각 'HH:mm'. 모르거나 모양이 틀리면 null. 다른 행동은 늘 null */
  startTime: string | null
}

/** AI 코치의 말 하나 */
export interface ChatReply {
  chatId: string
  reply: string
  /** true 면 위기 표현이 감지됐습니다. 상담 전화 한 줄을 보여 줍니다. (대화는 이어 갑니다) */
  showHelp: boolean
  helpLines: ChatHelpLine[]
  /** AI 가 고른 빠른 답 (3개까지). 서버가 안 주면 빈 목록 — 그때는 화면이 코드로 칩을 붙입니다. */
  quickReplies: string[]
  /** AI 가 제안한 행동. 없으면 null */
  action: ChatAction | null
  /** AI 가 학생 말로 짐작한 이유 값 (후기 · 못 한 카드 대화에서만, 3개까지). 없으면 빈 목록 */
  tags: string[]
  /** 과목 쌤이 웹 검색으로 찾은 출처 (3개까지). 검색하지 않았으면 빈 목록 */
  sources: ChatSource[]
}

/** 출처 하나 (웹 검색으로 찾은 페이지) */
export interface ChatSource {
  title: string
  url: string
}

const ACTION_TYPES: ChatAction['type'][] = [
  'start_timer',
  'shrink_today',
  'create_card',
  'make_plan',
  'start_quiz',
  'day_plan',
]

// 날짜 모양 'YYYY-MM-DD'
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
// 시각 모양 'HH:mm' (00:00 ~ 23:59)
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
/** day_plan 의 오늘 총 공부 분 범위 (서버와 같음) */
const DAY_PLAN_MIN_MINUTES = 20
const DAY_PLAN_MAX_MINUTES = 600

/** 서버가 준 빠른 답을 확인합니다. 글자만, 빈 것은 빼고, 3개 · 한 개 20자까지 */
function readQuickReplies(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map((item) => item.trim().slice(0, 20))
    .slice(0, 3)
}

/** 서버가 준 이유 값을 확인합니다. 글자만, 겹치지 않게, 3개까지 (어떤 값인지는 화면이 다시 확인합니다) */
function readTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const tags = value.filter((item): item is string => typeof item === 'string' && item !== '')
  return [...new Set(tags)].slice(0, 3)
}

/**
 * 서버가 준 출처를 확인합니다. http · https 주소만, 같은 주소는 하나만, 3개까지.
 * 제목은 60자까지, 비었으면 사이트 주소를 씁니다. 저장해 둔 대화를 다시 읽을 때도 씁니다. (lib/coachThread.ts)
 *   readChatSources([{ title: '극한 - 위키백과', url: 'https://ko.wikipedia.org/wiki/극한' }, { title: 'x', url: 'javascript:1' }])
 *     -> [{ title: '극한 - 위키백과', url: 'https://ko.wikipedia.org/wiki/극한' }]
 */
export function readChatSources(value: unknown): ChatSource[] {
  if (!Array.isArray(value)) return []
  const sources: ChatSource[] = []
  for (const item of value) {
    if (sources.length === 3) break
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    if (typeof record.url !== 'string') continue
    let host: string
    try {
      const url = new URL(record.url)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
      host = url.hostname
    } catch {
      continue
    }
    if (sources.some((source) => source.url === record.url)) continue
    const title =
      typeof record.title === 'string' && record.title.trim() !== ''
        ? record.title.trim().slice(0, 60)
        : host
    sources.push({ title, url: record.url })
  }
  return sources
}

/**
 * day_plan 의 오늘 총 공부 분을 확인합니다. 정수이고 20 ~ 600 이면 그대로, 아니면 null
 * (카드 하나의 분처럼 범위 안으로 당기지 않습니다. 틀린 값으로 계획을 짜는 것보다 모르는 채로 짜는 게 낫습니다)
 *   readDayPlanMinutes(120) -> 120   readDayPlanMinutes(5) -> null   readDayPlanMinutes('120') -> null
 */
function readDayPlanMinutes(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  return value >= DAY_PLAN_MIN_MINUTES && value <= DAY_PLAN_MAX_MINUTES ? value : null
}

/** 서버가 준 행동을 확인합니다. 모양이 틀리면 null. 모르는 칸은 읽지 않고 넘어갑니다. */
function readAction(value: unknown): ChatAction | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (!ACTION_TYPES.includes(record.type as ChatAction['type'])) return null
  const type = record.type as ChatAction['type']
  const minutes =
    type === 'day_plan'
      ? readDayPlanMinutes(record.minutes)
      : typeof record.minutes === 'number' && Number.isInteger(record.minutes)
        ? Math.min(120, Math.max(5, record.minutes))
        : null
  const title =
    typeof record.title === 'string' && record.title.trim() !== ''
      ? record.title.trim().slice(0, 30)
      : null
  const date =
    typeof record.date === 'string' && DATE_PATTERN.test(record.date) ? record.date : null
  // 시작 시각은 day_plan 에만 씁니다. 'HH:mm' 모양이 아니면 null
  const startTime =
    type === 'day_plan' &&
    typeof record.startTime === 'string' &&
    TIME_PATTERN.test(record.startTime)
      ? record.startTime
      : null
  return { type, minutes, title, date, startTime }
}

/** 서버가 준 값이 약속한 모양이 맞는지 확인합니다. (서버 응답도 그대로 믿지 않고 확인합니다) 빠른 답 · 행동은 따로 읽습니다. */
function isChatReply(
  value: unknown,
): value is Omit<ChatReply, 'quickReplies' | 'action' | 'tags' | 'sources'> {
  if (typeof value !== 'object' || value === null) return false
  const reply = value as Record<string, unknown>
  return (
    typeof reply.chatId === 'string' &&
    typeof reply.reply === 'string' &&
    typeof reply.showHelp === 'boolean' &&
    Array.isArray(reply.helpLines) &&
    reply.helpLines.every(
      (line) =>
        typeof line === 'object' &&
        line !== null &&
        typeof (line as Record<string, unknown>).name === 'string' &&
        typeof (line as Record<string, unknown>).number === 'string',
    )
  )
}

async function postChat(path: string, body: unknown): Promise<ChatReply> {
  const result = await api<unknown>(path, {
    method: 'POST',
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  // 502: 서버가 이상한 응답을 줬다는 뜻으로 씁니다.
  if (!isChatReply(result)) throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
  const record = result as unknown as Record<string, unknown>
  return {
    chatId: result.chatId,
    reply: result.reply,
    showHelp: result.showHelp,
    helpLines: result.helpLines,
    quickReplies: readQuickReplies(record.quickReplies),
    action: readAction(record.action),
    tags: readTags(record.tags),
    sources: readChatSources(record.sources),
  }
}

/** 채팅을 열 때 고를 것 (대화방 3개, BE #330). 안 주면 코치 방 · 주제 없음 */
export interface StartChatOptions {
  room?: ServerChatRoom
  about?: ChatAbout | null
}

/**
 * 채팅을 엽니다. AI 코치의 첫 인사가 돌아옵니다. 요청은 통화를 걸 때와 같습니다.
 * 이 기기에 학년 · 반이 있으면 같이 보내서, 서버가 오늘 시간표를 대본에 넣게 합니다. (BE #307)
 * room · about 을 주면 그 방 · 그 주제로 엽니다. (BE #330)
 *
 *   startChat({ room: 'TUTOR', about: { kind: 'QUIZ_WRONG', lines: ['문제: … / 학생 답: 1 / 정답: 0'] } })
 */
export function startChat(options: StartChatOptions = {}): Promise<ChatReply> {
  return postChat(startChatPath(true), startChatBody(options))
}

/**
 * 첫 인사 없이 채팅 번호만 받습니다. 학생이 먼저 말을 보낼 때 씁니다. (BE POST /chats?greet=false, 점검 "채팅 수정 1")
 * 첫 인사를 만드는 데 8초쯤 걸리는데, 학생이 먼저 말하는 화면에서는 그 인사를 쓰지 않고 버렸습니다.
 * 서버가 옛 버전이라 greet 를 모르고 인사를 같이 줘도, 채팅 번호만 쓰므로 그대로 동작합니다.
 */
export async function openChatSession(options: StartChatOptions = {}): Promise<string> {
  const result = await api<unknown>(startChatPath(false), {
    method: 'POST',
    body: JSON.stringify(startChatBody(options)),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const chatId =
    typeof result === 'object' && result !== null
      ? (result as Record<string, unknown>).chatId
      : undefined
  // 502: 서버가 이상한 응답을 줬다는 뜻으로 씁니다. (postChat 과 같음)
  if (typeof chatId !== 'string' || chatId === '') {
    throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
  }
  return chatId
}

/**
 * 채팅을 여는 주소. 이 기기에 학년 · 반이 있으면 붙이고, greet 가 false 면 greet=false 를 붙입니다.
 *   startChatPath(true)  -> '/chats?grade=2&classNo=1'
 *   startChatPath(false) -> '/chats?grade=2&classNo=1&greet=false'
 */
function startChatPath(greet: boolean): string {
  const params = new URLSearchParams()
  const schoolClass = loadSchoolClass()
  if (schoolClass) {
    params.set('grade', String(schoolClass.grade))
    params.set('classNo', String(schoolClass.classNo))
  }
  if (!greet) params.set('greet', 'false')
  const query = params.toString()
  return query ? `/chats?${query}` : '/chats'
}

/** 채팅을 열 때 보내는 본문. 요청은 통화를 걸 때와 같습니다. (startChat · openChatSession 이 같이 씀) */
function startChatBody(options: StartChatOptions): object {
  const tone = getCallTone()
  return {
    careLevel: tone.careLevel,
    maxHarshness: tone.maxHarshness,
    card: loadCallCard(),
    // 기기에만 있는 최근 7일 집중도 · 폰 든 횟수 · 확인 문제 결과 (lib/studySignals.ts, BE #334)
    studySignals: loadStudySignals(),
    // 생각 습관 테스트(selfReportedBiases · selfReportedWeaknesses)는 #417 에서 지워서 보내지 않습니다. (서버에서 선택 칸)
    ...(options.room ? { room: options.room } : {}),
    ...(options.about ? { about: options.about } : {}),
  }
}

/**
 * 학생의 말을 보냅니다. lines 는 이 서버 세션의 대화 전체이고, 맨 끝이 방금 학생이 쓴 말입니다.
 * image 를 주면 그 말에 붙인 사진으로 같이 보냅니다. (그 한 번만. 다음 말에는 다시 보내지 않습니다)
 */
export function sendChatMessage(
  chatId: string,
  lines: CallLine[],
  image: string | null = null,
  otherRooms: string[] = [],
): Promise<ChatReply> {
  return postChat(`/chats/${encodeURIComponent(chatId)}/messages`, {
    lines,
    ...(image ? { image } : {}),
    // 오늘 다른 대화방에서 한 말 (없으면 보내지 않음)
    ...(otherRooms.length > 0 ? { otherRooms } : {}),
  })
}
