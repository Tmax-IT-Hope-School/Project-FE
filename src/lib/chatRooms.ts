/**
 * 채팅 탭의 대화방 3개와, 다른 화면에서 [이야기하기] 로 대화방에 들어가는 길입니다. (2026-10-18, #582)
 * 사용자 결정(저녁): "맨 위 📞 매일 통화 카드 + 채팅방 3개 📅 계획 · 💬 상담 · 📚 과목 쌤", "다양한 세션에서 채팅 가능해야"
 *
 *   📞 매일 통화(카드, 방 아님) /call       확인 통화 문(#584) — 오늘 공부 하나를 끝내면 열림
 *   📅 계획(/chat/plan)                    AI 가 오늘 · 시험 날까지 계획을 짜 주고 핑퐁, 목표 세우기(WOOP), 주간 점검
 *   💬 상담(/chat/counsel)                 매일 코치 — 아침 브리핑 · 알림 첫 말 · 공부 끝 후기 · 못 한 카드 · 1388
 *   📚 과목 쌤(/chat/tutor)                과외 선생님 — 문제 · 개념 질문(사진 가능) · 틀린 확인 문제 설명
 *
 * 방마다 대화 기록은 이 기기에 따로 남깁니다. (lib/coachThread.ts) 서버에는 어느 방인지(room)만 같이 보냅니다. (BE #330)
 * React 를 쓰지 않는 순수 함수와 값만 있습니다.
 *
 * ⚠️ 방의 이름 · 아이콘 · 주소 조각 · 서버 room 값 · 첫 인사와 칩 · 설명은 **아래 CHAT_ROOMS 한 곳에만** 둡니다.
 *    화면(채팅 목록 · 대화방)과 [이야기하기] 입구(TALK_ROOM_OF)는 이 값을 읽기만 합니다.
 *    방 이름이나 개수가 바뀌면 여기만 고치면 됩니다.
 */
// 칩 모양(타입)만 가져옵니다. 값까지 가져오면 coachBriefing → dailyMission 과 서로 불러서 꼬일 수 있어서, 칩은 아래에 직접 적습니다.
import type { CoachChip, CoachMessage } from '@/lib/coachBriefing'
import { loadData, removeData, saveData } from '@/lib/storage'
import { CHAT_PATH } from '@/lib/tabMenu'

/** 대화방 이름. 주소(/chat/coach 등) · 이 기기의 저장 이름(lib/coachThread.ts)에도 이 글자를 씁니다. */
export type ChatRoomId = 'plan' | 'counsel' | 'tutor'

/** 서버(BE #330)가 받는 방 이름. 계획 방은 PLANNER (BE 에서 GOAL_MATE → PLANNER 로 바꾸는 중, 2026-10-18) */
export type ServerChatRoom = 'PLANNER' | 'COACH' | 'TUTOR'

/** 대화방 하나의 정보 */
export interface ChatRoomInfo {
  id: ChatRoomId
  serverRoom: ServerChatRoom
  /** 방 이름 (말풍선 위 · 목록) */
  name: string
  emoji: string
  /** 목록 · 머리에 보이는 역할 한 줄 */
  role: string
  /** 입력칸에 미리 보이는 글 (375px 한 줄에 들어가게 짧게) */
  placeholder: string
  /**
   * true 면 "매일 코치" 방입니다: 아침 브리핑 · 오늘의 미션 · 코치 알림 첫 말 · 공부 끝 회고 · 머리의 [📞 통화].
   * 이런 방은 하나만 둡니다. false 인 방은 아래 greeting 으로 하루를 시작합니다.
   */
  isDailyCoach: boolean
  /**
   * true 면 "계획" 방입니다: 오늘 계획 · 시험 날까지의 긴 계획을 짜고 고치는 곳. 이런 방은 하나만 둡니다.
   * 다른 방에서 계획 칩([▷ 오늘 계획 짜 줘] 등)을 누르면 이 방으로 넘어가서 짭니다.
   */
  isPlanner: boolean
  /** 그날 처음 열었을 때 · [새 대화] 를 눌렀을 때 코드가 하는 첫 말. 열기만 해서는 AI 사용량을 쓰지 않습니다. */
  greeting: CoachMessage
}

// 여러 방의 첫 칩에 같이 쓰는 칩
const QUIZ_CHIP: CoachChip = { kind: 'quiz', label: '📝 문제 내 줘' }
const QUIZ_REVIEW_CHIP: CoachChip = { kind: 'quizReview', label: '📝 틀린 문제 다시' }

/** 대화방 목록. 이 순서대로 채팅 탭에 보입니다. (방을 바꾸려면 여기 한 곳만) */
export const CHAT_ROOMS: ChatRoomInfo[] = [
  {
    id: 'plan',
    serverRoom: 'PLANNER',
    name: '계획',
    emoji: '📅',
    role: 'AI 가 계획을 짜 주고 같이 고쳐요',
    placeholder: '계획 이야기하기',
    isDailyCoach: false,
    isPlanner: true,
    greeting: {
      text: '계획 방이야. 오늘 할 공부를 내가 먼저 짜 줄게. 보고 "줄여 줘", "8시부터" 처럼 말하면 같이 고치자. 시험 · 대회 날까지 길게 짜거나, 큰 목표부터 세워도 돼.',
      chips: [
        { kind: 'dayPlan', label: '▷ 오늘 계획 짜 줘' },
        { kind: 'longPlan', label: '📅 시험 · 대회 계획' },
        { kind: 'say', label: '🎯 목표 세우기' },
      ],
    },
  },
  {
    id: 'counsel',
    serverRoom: 'COACH',
    name: '상담',
    emoji: '💬',
    role: '매일 코치 — 하루 이야기 · 공부 후기',
    placeholder: '코치에게 말하기',
    isDailyCoach: true,
    isPlanner: false,
    greeting: {
      text: '새로 이야기하자. 요즘 공부는 어때? 편하게 말해 줘.',
      chips: [
        { kind: 'say', label: '요즘 좀 지쳤어' },
        { kind: 'say', label: '잘 되고 있어' },
        QUIZ_CHIP,
      ],
    },
  },
  {
    id: 'tutor',
    serverRoom: 'TUTOR',
    name: '과목 쌤',
    emoji: '📚',
    role: '모르는 문제 · 개념을 단계별로 설명해',
    placeholder: '과목 쌤에게 물어보기',
    isDailyCoach: false,
    isPlanner: false,
    greeting: {
      text: '안녕, 나는 과목 쌤이야. 모르는 문제나 개념을 물어봐. 📎 로 문제 사진을 보내도 돼. 답만 알려 주기보다 어디서 막혔는지부터 같이 볼게.',
      chips: [{ kind: 'pickPhoto', label: '📎 문제 사진 보내기' }, QUIZ_CHIP, QUIZ_REVIEW_CHIP],
    },
  },
]

/**
 * 채팅 목록 맨 위의 "📞 매일 통화" 카드. 통화는 대화방이 아니라 /call 로 갑니다. (확인 통화 문 #584 를 그대로 씀)
 * null 로 바꾸면 목록에서 빠집니다.
 */
export const CALL_ENTRY: { emoji: string; name: string; path: string } | null = {
  emoji: '📞',
  name: '매일 통화',
  path: '/call',
}

/** 대화방 하나의 주소. 예) chatRoomPath('tutor') -> '/chat/tutor' */
export function chatRoomPath(room: ChatRoomId): string {
  return `${CHAT_PATH}/${room}`
}

/**
 * 주소에서 받은 글자를 대화방 이름으로 바꿉니다. 모르는 값이면 null (주소는 누구나 고칠 수 있어서 그대로 믿지 않습니다)
 *
 *   toChatRoomId('tutor')  -> 'tutor'
 *   toChatRoomId('admin')  -> null
 */
export function toChatRoomId(value: string | undefined): ChatRoomId | null {
  return CHAT_ROOMS.find((room) => room.id === value)?.id ?? null
}

/** 대화방 정보 */
export function getChatRoom(room: ChatRoomId): ChatRoomInfo {
  return CHAT_ROOMS.find((item) => item.id === room) ?? CHAT_ROOMS[0]
}

/** "매일 코치" 방 (아침 브리핑 · 미션 · 알림이 이어지는 방). 알림 · 홈 미션 줄 · 회고가 이 방으로 갑니다. */
export const DAILY_COACH_ROOM: ChatRoomId =
  CHAT_ROOMS.find((room) => room.isDailyCoach)?.id ?? CHAT_ROOMS[0].id

/** "계획" 방. 계획 칩 · 홈의 [코치와 계획 짜기] · 밤 정리의 [내일 계획 짜 줘] · 주간 숫자 이야기가 이 방으로 갑니다. */
export const PLANNER_ROOM: ChatRoomId =
  CHAT_ROOMS.find((room) => room.isPlanner)?.id ?? CHAT_ROOMS[0].id

/**
 * 매일 코치(💬 상담 방)의 주소. 코치 알림 · 미션 · 홈 미션 줄 · 통화를 마친 뒤 이 주소로 옵니다.
 * (2026-10-18 저녁까지는 '/coach' 였습니다. 예전 주소는 router.tsx 가 넘깁니다)
 */
export const COACH_PATH = chatRoomPath(DAILY_COACH_ROOM)

/** 📅 계획 방의 주소. 홈의 [코치와 계획 짜기](?plan=today) · 다른 방의 계획 칩이 이 주소로 옵니다. */
export const PLAN_CHAT_PATH = chatRoomPath(PLANNER_ROOM)

/**
 * 방마다 저장소에 넣는 이름 (실제 키는 앞에 'study-' 가 붙음)
 * 매일 코치(상담) 방은 예전 이름('coach-thread') 그대로 써서, 대화방을 나누기 전의 코치 대화가 이어서 보입니다.
 *
 *   threadStorageKey('counsel') -> 'coach-thread'
 *   threadStorageKey('tutor')   -> 'chat-thread-tutor'
 */
export function threadStorageKey(room: ChatRoomId): string {
  return room === DAILY_COACH_ROOM ? 'coach-thread' : `chat-thread-${room}`
}

// ---- 대화 주제 (about) ----

/**
 * 무엇에 대한 대화인지 (BE #330). 서버는 이 종류에 맞춰 코치의 첫 말과 이야기 방법을 정합니다.
 *   SESSION_REVIEW 방금 공부 후기 · CARD_FAIL 못 한 카드 · WEEKLY_REPORT 주간 리포트 · AI 분석
 *   QUIZ_WRONG 틀린 확인 문제 · PSYCH_RESULT 성향 검사 결과 · DAY_REVIEW 달력의 하루
 *   SCHEDULE_ADJUST 일정 조정 제안 (홈, 2026-10-26 — lib/scheduleAdjust.ts)
 */
export type ChatAboutKind =
  | 'SESSION_REVIEW'
  | 'CARD_FAIL'
  | 'WEEKLY_REPORT'
  | 'QUIZ_WRONG'
  | 'PSYCH_RESULT'
  | 'DAY_REVIEW'
  | 'SCHEDULE_ADJUST'

const ABOUT_KINDS: ChatAboutKind[] = [
  'SESSION_REVIEW',
  'CARD_FAIL',
  'WEEKLY_REPORT',
  'QUIZ_WRONG',
  'PSYCH_RESULT',
  'DAY_REVIEW',
  'SCHEDULE_ADJUST',
]

/**
 * [이야기하기] 의 주제마다 어느 방으로 갈지. 방 구성이 바뀌면 여기만 고칩니다.
 *   후기 · 못 한 카드 · 검사 결과 · 하루 → 상담(매일 코치) / 주간 숫자 · 일정 조정 → 계획 / 틀린 문제 → 과목 쌤
 */
export const TALK_ROOM_OF: Record<ChatAboutKind, ChatRoomId> = {
  SESSION_REVIEW: DAILY_COACH_ROOM,
  CARD_FAIL: DAILY_COACH_ROOM,
  WEEKLY_REPORT: PLANNER_ROOM,
  QUIZ_WRONG: 'tutor',
  PSYCH_RESULT: DAILY_COACH_ROOM,
  DAY_REVIEW: DAILY_COACH_ROOM,
  SCHEDULE_ADJUST: PLANNER_ROOM,
}

/** 주제와, 이 기기에서 만든 사실 줄 (카드 제목 · 숫자 등. 이름 같은 개인정보는 넣지 않습니다) */
export interface ChatAbout {
  kind: ChatAboutKind
  lines: string[]
}

/** 서버가 받는 사실 줄 한도 (BE ChatAbout: 1 ~ 8줄, 한 줄 150자) */
export const MAX_ABOUT_LINES = 8
export const MAX_ABOUT_LINE_LENGTH = 150

/** 주소 · 저장소에서 꺼낸 값이 주제 종류인지 */
export function isChatAboutKind(value: unknown): value is ChatAboutKind {
  return ABOUT_KINDS.includes(value as ChatAboutKind)
}

/**
 * 사실 줄을 서버 한도에 맞춥니다. 줄바꿈은 빈칸으로, 빈 줄은 빼고, 한 줄 150자 · 8줄까지.
 *
 *   cleanAboutLines(['카드: 미적분\n3단원', '', '집중도 82%']) -> ['카드: 미적분 3단원', '집중도 82%']
 */
export function cleanAboutLines(lines: string[]): string[] {
  return lines
    .map((line) => line.replace(/\s+/g, ' ').trim().slice(0, MAX_ABOUT_LINE_LENGTH))
    .filter((line) => line !== '')
    .slice(0, MAX_ABOUT_LINES)
}

// ---- 다른 화면에서 [이야기하기] 로 들어오기 ----

/**
 * 대화가 끝난 뒤 AI 가 짐작한 이유를 어디에 저장할지
 *   session — 그 공부 기록의 "다 못 한 이유" (SESSION_REVIEW)
 *   card    — 그 카드 하루치의 실패 원인 (CARD_FAIL)
 */
export type TalkTarget =
  { type: 'session'; sessionId: string } | { type: 'card'; cardId: string; dateKey: string }

/** [이야기하기] 를 눌러 대화방에 맡겨 두는 요청 */
export interface TalkRequest {
  room: ChatRoomId
  about: ChatAbout
  /** 대화방에 내 말풍선으로 먼저 붙일 글. 예) '💬 방금 공부 후기 나눌래' */
  label: string
  target: TalkTarget | null
  /** 맡긴 시각 */
  at: number
}

// 저장 이름 (실제 키는 'study-chat-talk-request'). 사실 줄은 주소에 싣지 않고 여기에 잠깐 둡니다.
// (카드 제목 · 문제 글처럼 길고 개인적인 글은 주소에 담지 않는 규칙)
const TALK_REQUEST_KEY = 'chat-talk-request'
/** 맡긴 지 이만큼 지난 요청은 버립니다. (예전에 눌러 둔 것이 엉뚱할 때 열리지 않게) */
export const TALK_REQUEST_TTL_MS = 10 * 60 * 1000

/**
 * [이야기하기] 를 누른 화면이 요청을 맡겨 두고, 갈 주소를 돌려줍니다. 방은 주제로 정합니다(TALK_ROOM_OF).
 * 대화방은 주소의 ?talk= 를 보고 맡긴 요청을 꺼내 갑니다.
 *
 *   const path = startTalk({ about: { kind: 'QUIZ_WRONG', lines: [...] }, label: '📚 틀린 문제 물어볼래', target: null })
 *   navigate(path)   // '/chat/tutor?talk=QUIZ_WRONG'
 */
export function startTalk(request: Omit<TalkRequest, 'at' | 'room'>): string {
  const room = TALK_ROOM_OF[request.about.kind]
  saveData(TALK_REQUEST_KEY, {
    ...request,
    room,
    about: { ...request.about, lines: cleanAboutLines(request.about.lines) },
    at: Date.now(),
  })
  return talkPath(room, request.about.kind)
}

function isTalkTarget(value: unknown): value is TalkTarget {
  if (typeof value !== 'object' || value === null) return false
  const target = value as Record<string, unknown>
  if (target.type === 'session') return typeof target.sessionId === 'string'
  if (target.type === 'card') {
    return typeof target.cardId === 'string' && typeof target.dateKey === 'string'
  }
  return false
}

/**
 * 맡겨 둔 요청을 봅니다(지우지 않음). 방 · 주제가 맞고 10분이 안 지났을 때만 돌려주고, 아니면 null.
 *   peekTalkRequest('counsel', 'SESSION_REVIEW', now) -> { room: 'counsel', about: {…}, label: '💬 방금 공부 후기 나눌래', … }
 */
export function peekTalkRequest(
  room: ChatRoomId,
  kind: ChatAboutKind,
  now: number,
): TalkRequest | null {
  const saved = loadData<unknown>(TALK_REQUEST_KEY, null)
  if (typeof saved !== 'object' || saved === null) return null
  const record = saved as Record<string, unknown>
  const about = record.about as Record<string, unknown> | undefined
  if (record.room !== room || typeof record.at !== 'number' || typeof record.label !== 'string') {
    return null
  }
  if (!about || about.kind !== kind || !Array.isArray(about.lines)) return null
  if (now - record.at > TALK_REQUEST_TTL_MS || record.at > now) return null
  const lines = cleanAboutLines(about.lines.filter((line) => typeof line === 'string'))
  if (lines.length === 0) return null
  return {
    room,
    about: { kind, lines },
    label: record.label,
    target: isTalkTarget(record.target) ? record.target : null,
    at: record.at,
  }
}

/** 꺼내 쓴 요청을 지웁니다. (새로고침해도 같은 이야기를 또 꺼내지 않게) */
export function clearTalkRequest(): void {
  removeData(TALK_REQUEST_KEY)
}

/** [이야기하기] 로 갈 주소. 예) talkPath('tutor', 'QUIZ_WRONG') -> '/chat/tutor?talk=QUIZ_WRONG' */
export function talkPath(room: ChatRoomId, kind: ChatAboutKind): string {
  return `${chatRoomPath(room)}?talk=${kind}`
}

// ---- 목록의 "새 말" 점 ----

// 방마다 마지막으로 열어 본 시각 (실제 키는 'study-chat-last-seen')
const LAST_SEEN_KEY = 'chat-last-seen'

/** 방마다 마지막으로 열어 본 시각. 없거나 깨졌으면 빈 객체 */
export function loadLastSeen(): Partial<Record<ChatRoomId, number>> {
  const saved = loadData<unknown>(LAST_SEEN_KEY, null)
  if (typeof saved !== 'object' || saved === null) return {}
  const seen: Partial<Record<ChatRoomId, number>> = {}
  for (const room of CHAT_ROOMS) {
    const at = (saved as Record<string, unknown>)[room.id]
    if (typeof at === 'number') seen[room.id] = at
  }
  return seen
}

/** 이 방을 지금 보고 있다고 적어 둡니다. */
export function markRoomSeen(room: ChatRoomId, at: number): void {
  saveData(LAST_SEEN_KEY, { ...loadLastSeen(), [room]: at })
}

// ---- 계획 칩을 계획 방으로 넘기기 ----

// 저장 이름 (실제 키는 'study-chat-plan-handoff'). 다른 방에서 누른 계획 칩을 계획 방이 꺼내 갑니다.
const PLAN_HANDOFF_KEY = 'chat-plan-handoff'

/** 계획 방으로 넘길 수 있는 칩 (오늘 계획 · 긴 계획 칸 · AI 가 알아들은 목표 · 날짜로 긴 계획) */
export type PlanHandoffChip = Extract<CoachChip, { kind: 'dayPlan' | 'longPlan' | 'makePlan' }>

/**
 * 다른 방에서 누른 계획 칩을 맡기고, 계획 방 주소를 돌려줍니다. 계획 방이 열리면서 그 칩을 대신 눌러 줍니다.
 *
 *   navigate(handOffPlanChip({ kind: 'dayPlan', label: '📅 내일 계획 짜 줘', tomorrow: true }))
 *   // '/chat/plan?plan=chip'
 */
export function handOffPlanChip(chip: PlanHandoffChip): string {
  saveData(PLAN_HANDOFF_KEY, { chip, at: Date.now() })
  return `${PLAN_CHAT_PATH}?plan=chip`
}

/** 맡겨 둔 계획 칩을 꺼내고 지웁니다. 10분이 지났거나 모양이 틀리면 null */
export function takePlanHandoff(now: number): PlanHandoffChip | null {
  const saved = loadData<unknown>(PLAN_HANDOFF_KEY, null)
  removeData(PLAN_HANDOFF_KEY)
  if (typeof saved !== 'object' || saved === null) return null
  const record = saved as Record<string, unknown>
  if (typeof record.at !== 'number' || now - record.at > TALK_REQUEST_TTL_MS) return null
  const chip = record.chip as Record<string, unknown> | null
  if (typeof chip !== 'object' || chip === null || typeof chip.label !== 'string') return null
  if (chip.kind === 'dayPlan') {
    return {
      kind: 'dayPlan',
      label: chip.label,
      ...(chip.light === true ? { light: true } : {}),
      ...(chip.tomorrow === true ? { tomorrow: true } : {}),
    }
  }
  if (chip.kind === 'longPlan') return { kind: 'longPlan', label: chip.label }
  if (chip.kind === 'makePlan' && typeof chip.goal === 'string') {
    const endDate = typeof chip.endDate === 'string' ? chip.endDate : null
    return { kind: 'makePlan', label: chip.label, goal: chip.goal, endDate }
  }
  return null
}
