/**
 * AI 와의 대화방을 **이 기기에만** 남기는 곳입니다. (2026-10-18 사용자 결정)
 *   "채팅 탭은 무조건 하나" · "멘토와 연속적인 대화를 한다는 느낌으로"
 *   저녁에 대화방을 3개(📅 계획 · 💬 상담 · 📚 과목 쌤)로 나눴습니다. 방마다 기록을 따로 둡니다. (lib/chatRooms.ts, #582)
 *
 * - 다시 열면 지난 대화가 이어서 보입니다. 날이 바뀌면 날짜 구분선 아래로 그날 대화가 이어집니다.
 * - [새 대화] 를 누르면 "새 대화" 구분선을 긋고 서버 세션을 새로 엽니다. 앞의 말풍선은 그대로 남습니다.
 *   이 세션은 "깨끗한 새 대화" 라서 서버가 [지난 통화] · 다른 방 이야기를 넣지 않습니다. (isFreshSession, 2026-10-31)
 * - 서버에는 대화를 저장하지 않습니다. (lib/chatApi.ts) 이 기기에 최근 14일 · 말풍선 300개까지만 둡니다.
 * - 설정의 "모든 기록 지우기" 가 같이 지웁니다. (lib/myData.ts 의 'coach-thread')
 * - 다른 사람이 로그인하면 빈 대화방에서 시작합니다. (ownerId)
 *
 * 서버 채팅은 하루 단위 "세션" 으로 엽니다. 대화방은 이어지지만, 서버에 보내는 대화는 지금 세션의 말풍선만입니다.
 * 날이 바뀌었거나 오래 쉬었거나 길어지면 새 세션을 엽니다. 앞 세션은 조용히 정리해서(POST /calls/{id}/finish)
 * 요약을 남기고, 그 요약이 다음 세션 대본의 [지난 통화] 가 되어 AI 가 이어서 기억합니다. (pages/ChatRoomPage.tsx)
 * 단, 학생이 [새 대화] 를 눌러 연 세션은 이어 가지 않습니다. ("새 대화 눌러도 이전 걸 계속 참고하고 이어져서")
 */
import type { CallLine } from '@/lib/callReview'
import {
  MAX_CHAT_LINES,
  MAX_CHAT_TEXT_LENGTH,
  readChatSources,
  type ChatSource,
} from '@/lib/chatApi'
import {
  CHAT_ROOMS,
  cleanAboutLines,
  isChatAboutKind,
  threadStorageKey,
  type ChatAbout,
  type ChatRoomId,
  type TalkTarget,
} from '@/lib/chatRooms'
import type { CoachChip } from '@/lib/coachBriefing'
import {
  MAX_PLAN_TALK_LINE_LENGTH,
  MAX_PLAN_TALK_LINES,
  planLineForAi,
  toCoachPlan,
  type CoachPlan,
} from '@/lib/coachPlan'
import { toDayKey } from '@/lib/date'
import { loadData, saveData } from '@/lib/storage'
import { quizLineForAi, toCoachQuiz, type CoachQuiz } from '@/lib/studyQuiz'

/** 대화방의 말풍선 하나 */
export interface ThreadBubble {
  id: number
  speaker: 'ai' | 'me'
  text: string
  /** 말한 시각 (Date.now() 값). 날짜 구분선을 그리는 데 씁니다. */
  at: number
  /** 코치 말풍선 아래의 빠른 답 칩. 가장 마지막 코치 말풍선의 칩만 보입니다. */
  chips?: CoachChip[]
  /** true 면 테스트 로그인용 "시연용 정해진 답" 입니다. (AI 가 쓴 말이 아님) */
  isDemo?: boolean
  /** 코치가 짜 준 계획 (계획 말풍선, lib/coachPlan.ts). 고치면 새 말풍선에 새 계획이 붙습니다. */
  plan?: CoachPlan
  /** 코치가 낸 확인 문제 (문제 말풍선, lib/studyQuiz.ts). 푸는 동안 이 말풍선 안에서 바뀝니다. */
  quiz?: CoachQuiz
  /** 내 말에 사진을 붙여 보냈는지. 사진 자체는 저장하지 않고 "보냈다" 는 표시만 남깁니다. */
  hasPhoto?: boolean
  /** true 면 말풍선이 아니라 [새 대화] 구분선입니다. 서버에는 보내지 않습니다. */
  isDivider?: boolean
  /** AI 가 짐작한 이유를 "맞아?" 로 확인받는 칸 (후기 · 못 한 카드 대화) */
  reasonCheck?: ReasonCheck
  /** 과목 쌤이 웹 검색으로 찾은 출처. 답 아래에 작은 링크로 보여 줍니다. (BE #342) */
  sources?: ChatSource[]
  /**
   * true 면 방금 받은 AI 의 답이라 메신저처럼 문장마다 나눠 타자 치듯 보여 줍니다. (lib/chatReveal.ts)
   * 효과는 받은 때(at)부터 몇 초 동안만이라, 새로고침하거나 다시 열면 바로 전체가 보입니다.
   */
  typing?: boolean
}

/**
 * AI 가 학생 말로 짐작한 이유 확인 (BE #330 의 tags)
 *   open 확인 기다림 · editing 칩으로 고치는 중 · saved 기록함 · dismissed 넘김
 */
export interface ReasonCheck {
  kind: 'SESSION_REVIEW' | 'CARD_FAIL'
  values: string[]
  /** 저장할 곳 (그 공부 기록 · 그 카드 하루치) */
  target: TalkTarget
  status: 'open' | 'editing' | 'saved' | 'dismissed'
}

/** 지금 서버 세션이 무엇에 대한 대화인지. [이야기하기] 로 연 세션만 있습니다. */
export interface ThreadTopic {
  about: ChatAbout
  target: TalkTarget | null
}

/** 이 기기에 남기는 대화방 */
export interface CoachThread {
  /** 대화방 주인 (로그인한 사람 번호) */
  ownerId: string
  bubbles: ThreadBubble[]
  /** 지금 열려 있는 서버 채팅 번호. 없으면 null (학생이 말할 때 처음 엽니다) */
  chatId: string | null
  /** 이 번호의 말풍선부터 끝까지가 지금 서버 세션의 대화입니다. */
  sessionFrom: number
  /** 마지막으로 서버와 주고받은 시각. 없으면 null */
  lastServerAt: number | null
  /** 위기 표현이 감지돼서 상담 전화 한 줄을 보여 주는 중인지 */
  isHelpShown: boolean
  /** 지금 서버 세션의 주제. 없으면 null (보통 대화). 서버가 대본을 잊어 다시 열 때도 이 주제로 엽니다. */
  topic: ThreadTopic | null
  /**
   * true 면 지금(또는 다음에 열) 서버 세션이 [새 대화] 를 눌러 시작한 "깨끗한 새 대화" 입니다. (2026-10-31)
   * 열 때 fresh 를 보내서 서버가 [지난 통화] 를 넣지 않게 하고, 말 보낼 때 다른 방 이야기도 보내지 않습니다.
   * 저장해 둬서 [새 대화] 를 누르고 새로고침해도 이어집니다. 날이 바뀌는 등 저절로 새 세션을 열 때는 false 로 돌아갑니다.
   */
  isFreshSession: boolean
}

/** 며칠 치 대화를 남길지 */
export const THREAD_KEEP_DAYS = 14
/** 말풍선을 몇 개까지 남길지 */
export const THREAD_MAX_BUBBLES = 300
/**
 * 서버와 마지막으로 주고받은 지 이만큼 지나면 새 세션을 엽니다.
 * 서버가 대본을 2시간 기억해서(BE ChatScriptStore), 그보다 조금 짧게 잡습니다.
 */
export const SESSION_IDLE_MS = 100 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000
const CHIP_KINDS = [
  'say',
  'startCard',
  'startMinutes',
  'newCard',
  'checkIn',
  'startTitled',
  'dayPlan',
  'longPlan',
  'quiz',
  'quizReview',
  'makePlan',
  'checkCall',
  'pickPhoto',
  'reviewTalk',
]

/** 빈 대화방 */
export function emptyThread(ownerId: string): CoachThread {
  return {
    ownerId,
    bubbles: [],
    chatId: null,
    sessionFrom: 1,
    lastServerAt: null,
    isHelpShown: false,
    topic: null,
    isFreshSession: false,
  }
}

/** 저장소에서 꺼낸 칩이 쓸 수 있는 모양인지 (이상한 칩은 버립니다) */
function isChip(value: unknown): value is CoachChip {
  if (typeof value !== 'object' || value === null) return false
  const chip = value as Record<string, unknown>
  if (typeof chip.label !== 'string' || !CHIP_KINDS.includes(chip.kind as string)) return false
  if (chip.kind === 'startCard') return typeof chip.cardId === 'string'
  if (chip.kind === 'startMinutes') return typeof chip.minutes === 'number'
  if (chip.kind === 'checkIn')
    return typeof chip.condition === 'number' && Array.isArray(chip.emotions)
  if (chip.kind === 'startTitled')
    return typeof chip.title === 'string' && typeof chip.minutes === 'number'
  if (chip.kind === 'quiz') {
    // 주제 · 카드 번호 · 체크리스트는 없어도 됩니다. (없으면 주제를 고르는 칸이 열림)
    const isOptionalText = (field: unknown) => field === undefined || typeof field === 'string'
    const isOptionalList = chip.checklist === undefined || Array.isArray(chip.checklist)
    return isOptionalText(chip.topic) && isOptionalText(chip.cardId) && isOptionalList
  }
  if (chip.kind === 'makePlan') {
    // 목표 한 줄은 꼭 있고, 날짜는 없어도 됩니다. (없으면 긴 계획 칸이 열림)
    return (
      typeof chip.goal === 'string' && (chip.endDate === null || typeof chip.endDate === 'string')
    )
  }
  if (chip.kind === 'reviewTalk') return typeof chip.sessionId === 'string'
  if (chip.kind === 'quizReview') {
    // 며칠 전 문제인지는 없어도 됩니다. (없으면 어제 것)
    return (
      chip.daysAgo === undefined ||
      (Array.isArray(chip.daysAgo) && chip.daysAgo.every((days) => typeof days === 'number'))
    )
  }
  return true
}

function toBubble(value: unknown): ThreadBubble | null {
  if (typeof value !== 'object' || value === null) return null
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'number' || typeof item.text !== 'string' || typeof item.at !== 'number') {
    return null
  }
  if (item.speaker !== 'ai' && item.speaker !== 'me') return null
  const bubble: ThreadBubble = { id: item.id, speaker: item.speaker, text: item.text, at: item.at }
  if (Array.isArray(item.chips)) bubble.chips = item.chips.filter(isChip)
  if (item.isDemo === true) bubble.isDemo = true
  const plan = toCoachPlan(item.plan)
  if (plan) bubble.plan = plan
  const quiz = toCoachQuiz(item.quiz)
  if (quiz) bubble.quiz = quiz
  if (item.hasPhoto === true) bubble.hasPhoto = true
  if (item.typing === true) bubble.typing = true
  if (item.isDivider === true) bubble.isDivider = true
  const reasonCheck = toReasonCheck(item.reasonCheck)
  if (reasonCheck) bubble.reasonCheck = reasonCheck
  const sources = readChatSources(item.sources)
  if (sources.length > 0) bubble.sources = sources
  return bubble
}

const REASON_CHECK_STATUSES: ReasonCheck['status'][] = ['open', 'editing', 'saved', 'dismissed']

function isTarget(value: unknown): value is TalkTarget {
  if (typeof value !== 'object' || value === null) return false
  const target = value as Record<string, unknown>
  if (target.type === 'session') return typeof target.sessionId === 'string'
  return (
    target.type === 'card' &&
    typeof target.cardId === 'string' &&
    typeof target.dateKey === 'string'
  )
}

/** 저장소에서 꺼낸 이유 확인 칸. 모양이 틀리면 버립니다. */
function toReasonCheck(value: unknown): ReasonCheck | null {
  if (typeof value !== 'object' || value === null) return null
  const check = value as Record<string, unknown>
  if (check.kind !== 'SESSION_REVIEW' && check.kind !== 'CARD_FAIL') return null
  if (!Array.isArray(check.values) || !isTarget(check.target)) return null
  if (!REASON_CHECK_STATUSES.includes(check.status as ReasonCheck['status'])) return null
  return {
    kind: check.kind,
    values: check.values.filter((item): item is string => typeof item === 'string'),
    target: check.target,
    status: check.status as ReasonCheck['status'],
  }
}

/** 저장소에서 꺼낸 세션 주제. 모양이 틀리면 null */
function toTopic(value: unknown): ThreadTopic | null {
  if (typeof value !== 'object' || value === null) return null
  const topic = value as Record<string, unknown>
  const about = topic.about as Record<string, unknown> | undefined
  if (!about || !isChatAboutKind(about.kind) || !Array.isArray(about.lines)) return null
  const lines = cleanAboutLines(about.lines.filter((line) => typeof line === 'string'))
  if (lines.length === 0) return null
  return {
    about: { kind: about.kind, lines },
    target: isTarget(topic.target) ? topic.target : null,
  }
}

/** 이 기기의 대화방 (room 방). 없거나 다른 사람 것이거나 깨져 있으면 빈 대화방입니다. */
export function loadCoachThread(ownerId: string, room: ChatRoomId): CoachThread {
  const saved = loadData<unknown>(threadStorageKey(room), null)
  if (typeof saved !== 'object' || saved === null) return emptyThread(ownerId)
  const record = saved as Record<string, unknown>
  if (record.ownerId !== ownerId || !Array.isArray(record.bubbles)) return emptyThread(ownerId)
  return {
    ownerId,
    bubbles: record.bubbles.map(toBubble).filter((bubble) => bubble !== null),
    chatId: typeof record.chatId === 'string' ? record.chatId : null,
    sessionFrom: typeof record.sessionFrom === 'number' ? record.sessionFrom : 1,
    lastServerAt: typeof record.lastServerAt === 'number' ? record.lastServerAt : null,
    isHelpShown: record.isHelpShown === true,
    topic: toTopic(record.topic),
    // 이 칸이 없던 예전에 저장한 대화방은 false (예전처럼 이어지는 세션)
    isFreshSession: record.isFreshSession === true,
  }
}

/** 대화방(room 방)을 저장합니다. 14일보다 오래된 말풍선과, 300개를 넘는 앞쪽 말풍선은 버립니다. */
export function saveCoachThread(thread: CoachThread, now: number, room: ChatRoomId): void {
  const recent = thread.bubbles.filter((bubble) => now - bubble.at <= THREAD_KEEP_DAYS * DAY_MS)
  saveData(threadStorageKey(room), { ...thread, bubbles: recent.slice(-THREAD_MAX_BUBBLES) })
}

/** 대화방 목록에 보여 줄 마지막 말풍선 (구분선 빼고). 없으면 null */
export function lastTalkBubble(thread: CoachThread): ThreadBubble | null {
  return thread.bubbles.findLast((bubble) => !bubble.isDivider) ?? null
}

// 다른 방 이야기로 보낼 줄 수 · 한 줄 글자 수 · 방마다 줄 수 (BE OtherRoomTalk 가 6줄 · 80자로 씀)
const OTHER_ROOM_MAX_LINES = 6
const OTHER_ROOM_LINE_LENGTH = 80
const OTHER_ROOM_LINES_PER_ROOM = 3
// 이보다 짧은 말("응" · "1번" 같은 대답)은 다른 방에 알려 줄 내용이 없어서 뺍니다.
const OTHER_ROOM_MIN_TEXT_LENGTH = 4

/**
 * 학생이 오늘(새벽 4시 기준) 다른 대화방에서 한 말 몇 줄입니다. (2026-10-22 점검 "채팅 방끼리 학생 정보를 공유하지 않는다")
 * 방마다 대화는 이 기기에만 있어서, 서버에 같이 보내야 이 방의 답 · 계획이 그 이야기를 압니다.
 * 방마다 마지막 3줄, 모두 합쳐 최근 6줄까지, 한 줄은 방 이름을 넣어 80자까지. 보낼 때는 시간 순서입니다.
 * 빼는 말: 구분선 · 4자보다 짧은 말 · 칩을 눌러 붙은 말("이대로 할게" 처럼 그 방 칩 글자와 똑같은 말)
 *   칩 말이 섞이면 방마다 3줄 안에서 학생이 직접 쓴 말이 밀려나서 뺍니다. (2026-10-22 QA)
 * room 이 null 이면 모든 방의 말을 모읍니다. 음성 통화는 어느 방도 아니라서 null 로 부릅니다. (#699)
 *
 *   상담 방에 오늘 "미적분 극한이 헷갈려" 를 썼고 지금 계획 방이면 -> ['상담: 미적분 극한이 헷갈려']
 */
export function otherRoomLines(
  ownerId: string,
  room: ChatRoomId | null,
  todayKey: string,
): string[] {
  const lines: { at: number; text: string }[] = []
  for (const other of CHAT_ROOMS) {
    if (other.id === room) continue
    const bubbles = loadCoachThread(ownerId, other.id).bubbles
    const chipLabels = new Set(
      bubbles.flatMap((bubble) => bubble.chips ?? []).map((chip) => chip.label),
    )
    const mine = bubbles.filter((bubble) => {
      const text = bubble.text.replace(/\s+/g, ' ').trim()
      return (
        bubble.speaker === 'me' &&
        !bubble.isDivider &&
        text.length >= OTHER_ROOM_MIN_TEXT_LENGTH &&
        !chipLabels.has(text) &&
        toDayKey(bubble.at) === todayKey
      )
    })
    for (const bubble of mine.slice(-OTHER_ROOM_LINES_PER_ROOM)) {
      const line = `${other.name}: ${bubble.text.replace(/\s+/g, ' ').trim()}`
      // 이모지가 반으로 잘리지 않게 글자(코드 포인트) 단위로 자릅니다.
      lines.push({
        at: bubble.at,
        text: Array.from(line).slice(0, OTHER_ROOM_LINE_LENGTH).join(''),
      })
    }
  }
  return lines
    .sort((a, b) => a.at - b.at)
    .slice(-OTHER_ROOM_MAX_LINES)
    .map((line) => line.text)
}

/**
 * 계획 방에서 오늘 나눈 말을 하루 계획 · 고치기 요청에 같이 보낼 줄로 만듭니다. (#695, 서버의 planTalk)
 * 채팅에서 정한 "2시간만 · 9시부터 · 수학 먼저" 가 계획 초안에 들어가게 하려고 보냅니다.
 * - 오늘(새벽 4시 기준) 말 중 마지막 [새 대화] 구분선 뒤의 말만 씁니다. (지금 대화)
 * - 빼는 것: 구분선 · 빈 말 · 방의 첫 인사(코드가 쓴 정해진 말) · 시연용 말과 시연용 계획 말풍선 · '[계획 초안] …' 줄
 * - 한 줄은 '나: …' / '코치: …' 모양이고 200자까지, 최근 8줄을 시간 순서로 돌려줍니다.
 *
 *   [나 '오늘 2시간만 할래' · 코치 '좋아, 몇 시부터 할까?' · 나 '9시부터 수학 먼저']
 *   -> ['나: 오늘 2시간만 할래', '코치: 좋아, 몇 시부터 할까?', '나: 9시부터 수학 먼저']
 *   [어제 말 · 구분선 · 시연용 답] -> []
 */
export function planTalkLines(bubbles: ThreadBubble[], todayKey: string): string[] {
  const lastDivider = bubbles.findLastIndex((bubble) => bubble.isDivider)
  // 방마다 하루를 여는 정해진 인사 (lib/chatRooms.ts). 계획에 쓸 내용이 없어서 뺍니다.
  const greetings = new Set(CHAT_ROOMS.map((chatRoom) => chatRoom.greeting.text))
  const lines: string[] = []
  for (const bubble of bubbles.slice(lastDivider + 1)) {
    if (bubble.isDemo || bubble.plan?.isDemo || toDayKey(bubble.at) !== todayKey) continue
    if (bubble.speaker === 'ai' && greetings.has(bubble.text)) continue
    const text = bubble.text
      .split('\n')
      .filter((line) => !line.trim().startsWith('[계획 초안]'))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text === '') continue
    const line = `${bubble.speaker === 'me' ? '나' : '코치'}: ${text}`
    // 이모지가 반으로 잘리지 않게 글자(코드 포인트) 단위로 자릅니다.
    lines.push(Array.from(line).slice(0, MAX_PLAN_TALK_LINE_LENGTH).join(''))
  }
  return lines.slice(-MAX_PLAN_TALK_LINES)
}

/** 다음 말풍선 번호 */
export function nextBubbleId(bubbles: ThreadBubble[]): number {
  return bubbles.reduce((max, bubble) => Math.max(max, bubble.id), 0) + 1
}

/** 지금 서버 세션의 대화 줄 (sessionFrom 번호부터 끝까지). 서버에는 말 · 사람만 보냅니다. */
export function sessionLines(thread: CoachThread): CallLine[] {
  return thread.bubbles
    .filter((bubble) => bubble.id >= thread.sessionFrom && !bubble.isDivider)
    .map(({ speaker, text, plan, quiz }) => {
      // 계획 · 문제 말풍선이면 계획 한 줄 · 결과 한 줄을 붙여서, AI 가 무슨 이야기인지 알게 합니다. (서버 한도 500자)
      const extra = plan ? planLineForAi(plan) : quiz ? quizLineForAi(quiz) : null
      return {
        speaker,
        text: extra ? `${text}\n${extra}`.slice(0, MAX_CHAT_TEXT_LENGTH) : text,
      }
    })
}

/**
 * 열려 있는 서버 세션을 닫고 새로 열어야 하는지.
 *   - 마지막으로 주고받은 날과 오늘이 다름 (하루의 기준은 새벽 4시)
 *   - 100분 넘게 쉼 (서버가 대본을 잊기 전)
 *   - 서버가 받는 줄 수(60)에 거의 닿음
 */
export function needsNewSession(thread: CoachThread, now: number): boolean {
  if (thread.chatId === null) return false
  if (thread.lastServerAt === null) return true
  if (toDayKey(thread.lastServerAt) !== toDayKey(now)) return true
  if (now - thread.lastServerAt > SESSION_IDLE_MS) return true
  return sessionLines(thread).length >= MAX_CHAT_LINES - 2
}

/** 세션 줄에 학생이 한 말이 있는지 (없으면 정리할 것이 없습니다) */
export function hasStudentLine(lines: CallLine[]): boolean {
  return lines.some((line) => line.speaker === 'me')
}

/**
 * 새 세션이 시작될 말풍선 번호. 방금 쓴 내 말 바로 앞의 코치 말부터 보내서, AI 가 무엇에 대한 답인지 알게 합니다.
 *   [... 코치(12) · 나(13)] -> 12
 */
export function newSessionStart(bubbles: ThreadBubble[]): number {
  const last = bubbles[bubbles.length - 1]
  const previous = bubbles[bubbles.length - 2]
  return previous && previous.speaker === 'ai' ? previous.id : (last?.id ?? 1)
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

/**
 * 날짜 구분선의 글자. 하루의 기준(새벽 4시)으로 정합니다.
 *   dayLabel(2026-10-18 오후) -> '10월 18일 일요일'
 */
export function dayLabel(at: number): string {
  const [year, month, day] = toDayKey(at).split('-').map(Number)
  const weekday = WEEKDAYS[new Date(year, month - 1, day).getDay()]
  return `${month}월 ${day}일 ${weekday}요일`
}
