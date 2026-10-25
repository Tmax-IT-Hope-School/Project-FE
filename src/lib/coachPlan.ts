/**
 * 코치 채팅의 "계획 말풍선" 에 쓰는 함수들입니다. 화면은 pages/CoachPage.tsx 입니다. (2026-10-18 채팅 고도화 1단계)
 * 사용자: "얘가 플래너 한번 짜 주고 핑퐁하고 수정하는 게 맞지, 일방적으로 10분 주는 건 아닌 듯"
 *         "계획도 예를 들면 내가 적으면 얘가 30일치를 준다든지, 교과서나 이런 정보를 받아서"
 *
 * 계획은 두 가지입니다.
 *   오늘 계획(day) — POST /ai/day-plan 이 오늘 카드 초안을 짜 주고, POST /ai/day-plan/revise 로 고칩니다.
 *   긴 계획(long)  — POST /ai/long-plan 이 시험 · 대회 날 전날까지(최대 30일) 짜 주고, /ai/long-plan/revise 로 고칩니다.
 *                   AI 는 공부할 내용(topics)만 정하고, 날짜 · 시각에 나누는 것은 서버 코드가 합니다.
 *
 * 학생이 [이대로 할게] 를 누를 때만 카드로 저장합니다. 그 전에는 대화방의 말풍선으로만 남습니다.
 * 서버가 아직 이 기능을 모르거나(404) · AI 가 꺼졌거나(503) · 오늘 한도를 다 썼으면(429) 시연용 예시를 보여 주고
 * "시연용 예시" 라고 붙입니다. 테스트 로그인(서버 없음)도 시연용 예시입니다.
 * ⚠️ 사진은 서버에 보내기만 하고 어디에도 저장하지 않습니다. (lib/photoCards.ts 와 같음)
 */
import { api, ApiError } from '@/lib/api'
import type { ChatAction } from '@/lib/chatApi'
import { isDateKey, moveDateKey } from '@/lib/date'
import { draftToCard, toDraft, type PhotoCardDraft } from '@/lib/photoCards'
import type { StudyFocus } from '@/lib/studyFocus'
import type { Card } from '@/types'

/** 계획의 카드 한 장 (사진으로 받은 카드 초안과 같은 모양) */
export type PlanDraft = PhotoCardDraft

/** 쉬는 요일 (서버와 같은 글자) */
export type Weekday = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'

/** 긴 계획에서 AI 가 정한 공부할 내용 하나 (예: '미적분Ⅰ 3단원 개념', 90분) */
export interface LongPlanTopic {
  title: string
  /** 이 내용에 쓸 시간 합계 (분). 서버가 여러 날에 나눠 넣습니다. */
  minutes: number
  checklist: string[]
}

/** 긴 계획의 설정. 고칠 때 서버에 그대로 다시 보냅니다. (서버가 이것으로 카드를 다시 나눔) */
export interface LongPlanSpec {
  /** 준비하는 것 한 줄 (예: '중간고사 미적분 1~3단원') */
  goal: string
  startDate: string
  /** 시험 · 대회 날. 카드는 이 날 전날까지 */
  endDate: string
  dailyMinutes: number
  /** 매일 시작 시각 'HH:MM' */
  startTime: string
  restDays: Weekday[]
  topics: LongPlanTopic[]
}

/**
 * 말풍선의 계획 상태
 *   open     : 지금 고치는 중 (칩이 보이고, 학생이 쓰는 말은 고치는 요청이 됩니다)
 *   replaced : 고친 계획이 새로 나와서 지난 것이 됨 (흐리게)
 *   saved    : [이대로 할게] 로 카드에 저장함
 *   closed   : [나중에 할래] 로 닫음
 */
export type PlanStatus = 'open' | 'replaced' | 'saved' | 'closed'

/** 계획 말풍선 하나에 담는 계획 */
export interface CoachPlan {
  kind: 'day' | 'long'
  drafts: PlanDraft[]
  /** 긴 계획의 설정. 오늘 계획이면 null */
  spec: LongPlanSpec | null
  /** 저장할 때 지우고 새로 넣을 오늘 카드 (오늘 카드를 고치는 계획일 때). 없으면 빈 목록 */
  replaceCardIds: string[]
  /** true 면 지금 오늘 카드를 그대로 보여 준 것입니다. (아직 고치지 않음 — [이대로 할게] 는 아무것도 안 바꿈) */
  fromCards: boolean
  /** 왜 이렇게 짰는지 (서버 · 시연용 예시가 준 문장) */
  evidence: string[]
  /** true 면 하루 시간 안에 다 안 들어가서 줄인 것입니다. (긴 계획) */
  overflow: boolean
  /**
   * true 면 계획의 끝 날(spec.endDate)이 학생이 알려 준 시험 · 대회 날입니다. 저장할 때 홈 일정에 D-day 로 넣습니다.
   * ('30일치 짜 줘' 처럼 날짜 없이 기간만 말했으면 false)
   */
  isEventDate: boolean
  /** true 면 AI 가 아니라 시연용 예시입니다. */
  isDemo: boolean
  status: PlanStatus
}

/** 계획을 짜거나 고친 결과 — 코치의 한 줄과 새 계획 */
export interface PlanReply {
  /** true 면 위기 표현이 감지돼서 계획 대신 상담 전화 한 줄을 보여 줍니다. */
  showHelp: boolean
  /** 코치의 한 줄 (무엇을 바꿨는지 등) */
  reply: string
  /** 새 계획. null 이면 새 계획이 없습니다. (못 짰거나, 고치지 못해 지금 계획을 그대로 둠) */
  plan: CoachPlan | null
  /** true 면 학생이 "다 빼 줘" 처럼 해서 계획이 비었습니다. (지금 계획을 닫음) */
  cleared: boolean
  /** true 면 코치의 한 줄도 시연용입니다. */
  isDemo: boolean
  /**
   * 고치기 전 계획. 있으면 화면이 이 계획을 먼저 계획 말풍선으로 보여 주고, 그 아래에 고친 계획(plan)을 붙입니다.
   * AI 가 정한 값(day_plan)으로 지금 오늘 카드를 바로 고칠 때만 있습니다. (#695)
   * 못 고쳤으면(plan 이 null) 이 계획을 열어 둬서 학생이 이어서 고칠 수 있습니다.
   */
  before?: CoachPlan
}

/** 시작 시각을 모를 때 쓰는 시각 */
export const DEFAULT_START_TIME = '19:00'
/** 긴 계획의 하루 공부 시간 보기 (분). 처음 값은 60분 */
export const DAILY_MINUTES_OPTIONS = [30, 60, 90, 120]
export const DEFAULT_DAILY_MINUTES = 60
/**
 * AI 가 만드는 공부 카드 한 장의 가장 짧은 길이 (분). 서버의 StudyBlock 과 같은 값입니다.
 * 학교 한 교시가 50분이고 집중이 붙는 데 10 ~ 15분이 걸려서, 30분 밑은 공부 블록으로 보지 않습니다. (2026-10-18 멘토 결정)
 * 학생이 카드 폼에서 직접 정하는 길이는 자유입니다. 이 값은 코치가 짜 주는 계획에만 씁니다.
 */
const MIN_STUDY_MINUTES = 30
/** 긴 계획의 하루 공부 시간 범위 (분). 서버도 30 ~ 300분을 받습니다. (통화 중 계획 도구도 씀, lib/callTools.ts) */
export const MIN_DAILY_MINUTES = MIN_STUDY_MINUTES
export const MAX_DAILY_MINUTES = 300
/** 긴 계획은 오늘부터 이만큼(일) 뒤까지만 짤 수 있습니다. (서버도 같음) */
export const MAX_LONG_PLAN_DAYS = 30
/** 고치는 요청 · 목표 한 줄의 최대 글자 수 (서버도 100자) */
export const MAX_PLAN_TEXT_LENGTH = 100
/** 하루 계획 · 고치기에 같이 보내는 계획 방 대화(planTalk)의 줄 수 · 한 줄 글자 수 (서버도 8줄 · 200자, #695) */
export const MAX_PLAN_TALK_LINES = 8
export const MAX_PLAN_TALK_LINE_LENGTH = 200
/** 오늘 계획을 가볍게 고칠 때 서버에 보내는 요청 */
export const LIGHTER_REQUEST = '오늘 컨디션이 안 좋아서 가볍게 줄여 줘'

/** 고치지 못했을 때 코치의 한 줄 */
const KEEP_REPLY = '지금 계획은 그대로 둘게. 다르게 말해 줄래? (예: 영어는 빼 줘, 8시부터)'
const PLAN_TIMEOUT_MS = 30_000
// 사진을 읽느라 오래 걸려서 넉넉하게 기다립니다. (lib/photoCards.ts 와 비슷)
const PHOTO_PLAN_TIMEOUT_MS = 45_000

const WEEKDAYS: Weekday[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

// ---- 날짜 · 시각 ----

/** 'YYYY-MM-DD' 의 요일 (0 = 일요일) */
function weekdayIndexOf(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day).getDay()
}

/** 'YYYY-MM-DD' 두 날짜 사이의 날 수 (to - from) */
export function daysBetween(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split('-').map(Number)
  const [ty, tm, td] = toKey.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

/** '2026-10-19' -> '10/19 (월)' */
export function formatPlanDay(dateKey: string): string {
  const [, month, day] = dateKey.split('-').map(Number)
  return `${month}/${day} (${WEEKDAY_LABELS[weekdayIndexOf(dateKey)]})`
}

/** '19:40' -> 1180 (자정부터 몇 분) */
function toMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

/** 1180 -> '19:40' */
function toTime(totalMinutes: number): string {
  const hour = Math.floor(totalMinutes / 60)
  const minute = totalMinutes % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

// ---- 화면에 보여 줄 글 ----

/** 계획의 날짜 묶음 하나 (말풍선에서 날짜별로 보여 줍니다) */
export interface PlanDayGroup {
  date: string
  /** '10/19 (월)' */
  label: string
  drafts: PlanDraft[]
}

/** 카드를 날짜별로 묶습니다. 날짜 · 시작 시각 순서입니다. */
export function groupPlanByDate(drafts: PlanDraft[]): PlanDayGroup[] {
  const sorted = [...drafts].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || (a.startTime ?? '99').localeCompare(b.startTime ?? '99'),
  )
  const groups: PlanDayGroup[] = []
  for (const draft of sorted) {
    const last = groups[groups.length - 1]
    if (last && last.date === draft.date) {
      last.drafts.push(draft)
    } else {
      groups.push({ date: draft.date, label: formatPlanDay(draft.date), drafts: [draft] })
    }
  }
  return groups
}

/**
 * 말풍선 위의 요약 한 줄
 *
 *   긴 계획  -> '10/18~11/1 · 공부 12일 · 하루 60분'
 *   오늘 계획 -> '카드 3장 · 총 90분'
 */
export function summarizePlan(plan: CoachPlan): string {
  const totalMinutes = plan.drafts.reduce((sum, draft) => sum + draft.durationMinutes, 0)
  if (plan.kind === 'long' && plan.spec) {
    const groups = groupPlanByDate(plan.drafts)
    const first = groups[0]?.date ?? plan.spec.startDate
    const last = groups[groups.length - 1]?.date ?? plan.spec.endDate
    const [, firstMonth, firstDay] = first.split('-').map(Number)
    const [, lastMonth, lastDay] = last.split('-').map(Number)
    return `${firstMonth}/${firstDay}~${lastMonth}/${lastDay} · 공부 ${groups.length}일 · 하루 ${plan.spec.dailyMinutes}분`
  }
  return `카드 ${plan.drafts.length}장 · 총 ${totalMinutes}분`
}

/**
 * AI 코치(서버 채팅)에게 보내는 대화 줄에 붙일 계획 한 줄. AI 가 "어떤 계획을 얘기하는지" 알게 합니다.
 *
 *   -> '[계획 초안] 카드 2장 · 총 60분 — 10/19 19:00 미적분 문제집 30분, 10/19 19:40 영어 단어 30분'
 */
export function planLineForAi(plan: CoachPlan): string {
  const cards = plan.drafts
    .slice(0, 8)
    .map((draft) => {
      const [, month, day] = draft.date.split('-').map(Number)
      return `${month}/${day} ${draft.startTime ?? ''} ${draft.title} ${draft.durationMinutes}분`
    })
    .join(', ')
  const more = plan.drafts.length > 8 ? ` 외 ${plan.drafts.length - 8}장` : ''
  return `[계획 초안] ${summarizePlan(plan)} — ${cards}${more}`.slice(0, 300)
}

// ---- 오늘 카드에서 시작하는 계획 ----

/** 지금 오늘 카드들을 그대로 계획으로 보여 줍니다. (고치면 저장할 때 이 카드들을 바꿉니다) */
export function planFromCards(cards: Card[]): CoachPlan {
  return {
    kind: 'day',
    drafts: cards.map((card) => ({
      date: card.date,
      startTime: card.startTime ?? null,
      durationMinutes: card.durationMinutes,
      title: card.title,
      checklist: card.checklist.map((item) => item.text),
    })),
    spec: null,
    replaceCardIds: cards.map((card) => card.id),
    fromCards: true,
    evidence: [],
    overflow: false,
    isEventDate: false,
    isDemo: false,
    status: 'open',
  }
}

/** 계획을 저장할 카드로 바꿉니다. (카드 번호는 저장하는 순간의 시각으로 만듭니다) */
export function planToCards(plan: CoachPlan, now: number): Card[] {
  return plan.drafts.map((draft, index) =>
    draftToCard(draft, {
      id: `card-${now}-${index}`,
      now,
      startTime: draft.startTime ?? DEFAULT_START_TIME,
    }),
  )
}

// ---- 서버 ----

function isText(value: unknown): value is string {
  return typeof value === 'string'
}

function textOrNull(value: unknown): string | null {
  return isText(value) && value.trim() !== '' ? value.trim() : null
}

/** 서버 응답의 초안 목록. 목록이 아니면 null (못 짬), 빈 목록이면 [] (계획이 빔) */
function draftsOf(value: unknown): PlanDraft[] | null {
  if (!Array.isArray(value)) return null
  return value.map(toDraft).filter((draft): draft is PlanDraft => draft !== null)
}

function isWeekday(value: unknown): value is Weekday {
  return WEEKDAYS.includes(value as Weekday)
}

/** 서버가 준 긴 계획의 설정을 확인합니다. 모양이 틀리면 null */
function toSpec(value: unknown): LongPlanSpec | null {
  if (typeof value !== 'object' || value === null) return null
  const spec = value as Record<string, unknown>
  if (!isText(spec.goal) || !isText(spec.startDate) || !isText(spec.endDate)) return null
  if (!isDateKey(spec.startDate) || !isDateKey(spec.endDate)) return null
  if (typeof spec.dailyMinutes !== 'number' || !isText(spec.startTime)) return null
  if (!/^\d{2}:\d{2}$/.test(spec.startTime) || !Array.isArray(spec.topics)) return null
  const topics: LongPlanTopic[] = []
  for (const item of spec.topics) {
    if (typeof item !== 'object' || item === null) continue
    const topic = item as Record<string, unknown>
    if (!isText(topic.title) || typeof topic.minutes !== 'number') continue
    const checklist = Array.isArray(topic.checklist) ? topic.checklist.filter(isText) : []
    topics.push({ title: topic.title, minutes: topic.minutes, checklist })
  }
  return {
    goal: spec.goal,
    startDate: spec.startDate,
    endDate: spec.endDate,
    dailyMinutes: spec.dailyMinutes,
    startTime: spec.startTime,
    restDays: Array.isArray(spec.restDays) ? spec.restDays.filter(isWeekday) : [],
    topics,
  }
}

/** 서버에 보낼 준비하는 것 (없으면 null) */
function focusBody(focus: StudyFocus | null) {
  return focus ? { kind: focus.kind, name: focus.name } : null
}

/** 서버에 보낼 오늘 과목 (8개 · 각 20자까지) */
function subjectsBody(subjects: string[]): string[] {
  return subjects.slice(0, 8).map((subject) => subject.slice(0, 20))
}

/**
 * 고칠 때 보내는 카드 모양 (서버 한도: 5 ~ 120분 · 제목 30자 · 체크리스트 5개 · 각 50자)
 * 서버는 AI 가 30분보다 짧게 고친 카드를 30분으로 올립니다. 학생이 원래 넣어 둔 짧은 카드는 그대로 둡니다.
 */
function draftBody(draft: PlanDraft) {
  return {
    date: draft.date,
    startTime: draft.startTime ?? DEFAULT_START_TIME,
    durationMinutes: Math.min(120, Math.max(5, draft.durationMinutes)),
    title: draft.title.slice(0, 30),
    checklist: draft.checklist.slice(0, 5).map((item) => item.slice(0, 50)),
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
  }
  return value as Record<string, unknown>
}

/** 위기 표현이 감지됐을 때의 결과 (계획 대신 상담 전화 한 줄) */
function helpReply(): PlanReply {
  return { showHelp: true, reply: '', plan: null, cleared: false, isDemo: false }
}

/** 새 계획이 없는 결과 (코치의 한 줄만) */
function textReply(reply: string, isDemo = false): PlanReply {
  return { showHelp: false, reply, plan: null, cleared: false, isDemo }
}

// ---- AI 가 채팅에서 학생과 정한 오늘 계획 (#695) ----

/**
 * AI 코치가 계획 방 채팅에서 학생과 정한 오늘 계획의 값입니다. (채팅 답의 action 'day_plan', lib/chatApi.ts)
 * 이 값이 오면 "몇 분 할래?" 처럼 다시 묻지 않고 바로 오늘 계획을 짭니다.
 * (2026-10-25 사용자: "깊게 대화가 안 되고 계속 물어봐서")
 */
export interface DayPlanAsk {
  /** 오늘 총 공부 시간 (분, 20 ~ 600). 모르면 null */
  totalMinutes: number | null
  /** 시작 시각 'HH:mm'. 모르면 null */
  startTime: string | null
  /** 먼저 할 것 한 줄 (30자까지). 모르면 null */
  firstTask: string | null
}

/**
 * 채팅 답의 행동이 day_plan 이면 그 값을, 아니면 null 을 돌려줍니다. (값은 lib/chatApi.ts 가 이미 확인함)
 *   dayPlanAskOf({ type: 'day_plan', minutes: 120, title: '수학', startTime: '21:00', date: null })
 *   -> { totalMinutes: 120, startTime: '21:00', firstTask: '수학' }
 *   dayPlanAskOf({ type: 'start_timer', … }) -> null
 */
export function dayPlanAskOf(action: ChatAction | null): DayPlanAsk | null {
  if (action?.type !== 'day_plan') return null
  return { totalMinutes: action.minutes, startTime: action.startTime, firstTask: action.title }
}

/** AI 가 정한 값이 하나도 없을 때의 고치는 요청 글 (서버가 같이 받은 계획 방 대화를 보고 고칩니다) */
const ASK_TALK_REQUEST = '채팅에서 이야기한 대로 고쳐 줘'

/**
 * AI 가 정한 값으로 지금 오늘 카드를 고칠 때 보내는 요청 글. 코드가 만듭니다.
 *   dayPlanAskText({ totalMinutes: 120, startTime: '21:00', firstTask: '수학' }) -> '총 120분, 21:00부터, 수학 먼저'
 *   dayPlanAskText({ totalMinutes: null, startTime: '20:30', firstTask: null })  -> '20:30부터'
 *   dayPlanAskText({ totalMinutes: null, startTime: null, firstTask: null })     -> '채팅에서 이야기한 대로 고쳐 줘'
 */
export function dayPlanAskText(ask: DayPlanAsk): string {
  const parts: string[] = []
  if (ask.totalMinutes !== null) parts.push(`총 ${ask.totalMinutes}분`)
  if (ask.startTime !== null) parts.push(`${ask.startTime}부터`)
  if (ask.firstTask !== null) parts.push(`${ask.firstTask} 먼저`)
  if (parts.length === 0) return ASK_TALK_REQUEST
  return parts.join(', ').slice(0, MAX_PLAN_TEXT_LENGTH)
}

/**
 * 서버에 보낼 계획 방 대화(planTalk). 먼저 할 것이 있으면 맨 끝에 '나: 먼저 할 것 — …' 한 줄로 붙입니다.
 * 최근 8줄만, 한 줄은 200자까지. (서버 한도. 이모지가 반으로 잘리지 않게 글자 단위로 자름)
 *   planTalkBody(['나: 오늘 2시간만 할래'], '수학') -> ['나: 오늘 2시간만 할래', '나: 먼저 할 것 — 수학']
 */
function planTalkBody(planTalk: string[], firstTask: string | null = null): string[] {
  const lines = firstTask ? [...planTalk, `나: 먼저 할 것 — ${firstTask}`] : planTalk
  return lines
    .slice(-MAX_PLAN_TALK_LINES)
    .map((line) => Array.from(line).slice(0, MAX_PLAN_TALK_LINE_LENGTH).join(''))
}

export interface DayPlanInput {
  /** 계획을 짤 날 (오늘) */
  date: string
  focus: StudyFocus | null
  /** 오늘 시간표 과목 */
  subjects: string[]
  /** 오늘 컨디션 1 ~ 5. 2 이하면 서버가 가볍게 짭니다. 모르면 null */
  condition: number | null
  /**
   * 오늘 다른 대화방(상담 · 과목 쌤)에서 학생이 한 말 몇 줄 (lib/coachThread.ts 의 otherRoomLines, 2026-10-22)
   * 서버가 목표 없는 칸에 그 공부(예: 미적분 극한)를 넣습니다. 안 주면 보내지 않습니다.
   */
  otherRooms?: string[]
  /** AI 가 채팅에서 학생과 정한 값 (day_plan). 총 분 · 시작 시각은 그대로, 먼저 할 것은 planTalk 끝 줄로 보냅니다. */
  ask?: DayPlanAsk | null
  /** 계획 방에서 오늘 나눈 말 (lib/coachThread.ts 의 planTalkLines, #695). 안 주면 보내지 않습니다. */
  planTalk?: string[]
}

/**
 * 오늘 계획을 짜 달라고 합니다. (진짜 로그인일 때만)
 *   요청 { date, focus?, subjects?, condition?, otherRooms?, totalMinutes?, startTime?, planTalk? }
 *   응답 { drafts: [...], evidence: ['…'] } — drafts 가 비었으면 넣을 빈 시간이 없는 것 (이유는 evidence)
 * totalMinutes · startTime · planTalk 는 #695 부터입니다. 서버가 아직 모르면 무시하므로 먼저 보내도 괜찮습니다.
 */
export async function requestDayPlan(input: DayPlanInput): Promise<PlanReply> {
  const ask = input.ask ?? null
  const planTalk = planTalkBody(input.planTalk ?? [], ask?.firstTask ?? null)
  const record = asRecord(
    await api<unknown>('/ai/day-plan', {
      method: 'POST',
      body: JSON.stringify({
        date: input.date,
        focus: focusBody(input.focus),
        subjects: subjectsBody(input.subjects),
        condition: input.condition,
        ...(input.otherRooms && input.otherRooms.length > 0
          ? { otherRooms: input.otherRooms }
          : {}),
        // 채팅에서 정한 총 분 · 시작 시각 · 계획 방 대화 (없으면 보내지 않음)
        ...(ask && ask.totalMinutes !== null ? { totalMinutes: ask.totalMinutes } : {}),
        ...(ask && ask.startTime !== null ? { startTime: ask.startTime } : {}),
        ...(planTalk.length > 0 ? { planTalk } : {}),
      }),
      signal: AbortSignal.timeout(PLAN_TIMEOUT_MS),
    }),
  )
  const drafts = draftsOf(record.drafts) ?? []
  const evidence = Array.isArray(record.evidence) ? record.evidence.filter(isText) : []
  if (drafts.length === 0) {
    return textReply(evidence[0] ?? '오늘은 더 넣을 빈 시간이 없어. 내일 계획을 짜 볼까?')
  }
  return {
    showHelp: false,
    reply: '오늘 계획을 짜 봤어. 고칠 곳이 있으면 말해 줘!',
    plan: {
      kind: 'day',
      drafts,
      spec: null,
      replaceCardIds: [],
      fromCards: false,
      evidence,
      overflow: false,
      isEventDate: false,
      isDemo: false,
      status: 'open',
    },
    cleared: false,
    isDemo: false,
  }
}

/**
 * 오늘 계획을 학생의 요청대로 고쳐 달라고 합니다. (진짜 로그인일 때만)
 *   요청 { drafts, request, focus?, subjects?, planTalk? }
 *   응답 { showHelp, reply, drafts } — drafts 가 null 이면 못 고친 것 (지금 계획을 그대로 둠)
 * planTalk(계획 방에서 오늘 나눈 말)는 #695 부터입니다. 서버가 아직 모르면 무시합니다.
 */
export async function reviseDayPlan(
  plan: CoachPlan,
  request: string,
  extra: { focus: StudyFocus | null; subjects: string[]; planTalk?: string[] },
): Promise<PlanReply> {
  const planTalk = planTalkBody(extra.planTalk ?? [])
  const record = asRecord(
    await api<unknown>('/ai/day-plan/revise', {
      method: 'POST',
      body: JSON.stringify({
        drafts: plan.drafts.slice(0, 14).map(draftBody),
        request: request.slice(0, MAX_PLAN_TEXT_LENGTH),
        focus: focusBody(extra.focus),
        subjects: subjectsBody(extra.subjects),
        ...(planTalk.length > 0 ? { planTalk } : {}),
      }),
      signal: AbortSignal.timeout(PLAN_TIMEOUT_MS),
    }),
  )
  if (record.showHelp === true) return helpReply()
  const drafts = draftsOf(record.drafts)
  const reply = textOrNull(record.reply)
  if (drafts === null) return textReply(KEEP_REPLY)
  if (drafts.length === 0) {
    return { ...textReply(reply ?? '계획을 다 뺐어.'), cleared: true }
  }
  return {
    showHelp: false,
    reply: reply ?? '이렇게 고쳐 봤어. 어때?',
    plan: { ...plan, drafts, fromCards: false, evidence: [], isDemo: false, status: 'open' },
    cleared: false,
    isDemo: false,
  }
}

export interface LongPlanInput {
  /** 준비하는 것 한 줄 (예: '중간고사 미적분 1~3단원') */
  goal: string
  /** 시험 · 대회 날 (오늘 + 1 ~ 30일) */
  endDate: string
  dailyMinutes: number
  /** 교과서 · 시험 범위 사진 (data URL). 없으면 null */
  image: string | null
  focus: StudyFocus | null
  /** true 면 endDate 가 학생이 알려 준 시험 · 대회 날입니다. (서버에는 보내지 않고 CoachPlan.isEventDate 로 둠) */
  isEventDate: boolean
}

/**
 * 긴 계획 응답을 확인합니다. (짜기 · 고치기 같은 모양)
 * base 는 고치기 전 계획(짜기면 null), isEventDate 는 CoachPlan.isEventDate 에 넣을 값입니다.
 */
function readLongPlanResponse(
  record: Record<string, unknown>,
  base: CoachPlan | null,
  isEventDate: boolean,
): PlanReply {
  if (record.showHelp === true) return helpReply()
  const spec = toSpec(record.plan)
  const drafts = draftsOf(record.drafts)
  const reply = textOrNull(record.reply)
  if (drafts !== null && drafts.length === 0) {
    return { ...textReply(reply ?? '계획을 다 뺐어.'), cleared: true }
  }
  if (spec === null || drafts === null) {
    // 짜기는 못 짠 것, 고치기는 못 고친 것 (지금 계획을 그대로 둠)
    return textReply(
      base === null ? '이번엔 계획을 못 짰어. 준비하는 걸 조금 더 자세히 적어 줄래?' : KEEP_REPLY,
    )
  }
  return {
    showHelp: false,
    reply: reply ?? (base === null ? '계획을 짜 봤어. 어때?' : '이렇게 고쳐 봤어. 어때?'),
    plan: {
      kind: 'long',
      drafts,
      spec,
      replaceCardIds: [],
      fromCards: false,
      evidence: [],
      overflow: record.overflow === true,
      isEventDate,
      isDemo: false,
      status: 'open',
    },
    cleared: false,
    isDemo: false,
  }
}

/**
 * 시험 · 대회 날까지의 긴 계획을 짜 달라고 합니다. (진짜 로그인일 때만)
 *   요청 { goal, endDate, dailyMinutes, image?, focus? }
 *   응답 { showHelp, reply, plan: 설정 | null, drafts: [...] | null, overflow }
 */
export async function requestLongPlan(input: LongPlanInput): Promise<PlanReply> {
  const record = asRecord(
    await api<unknown>('/ai/long-plan', {
      method: 'POST',
      body: JSON.stringify({
        goal: input.goal.slice(0, MAX_PLAN_TEXT_LENGTH),
        endDate: input.endDate,
        dailyMinutes: input.dailyMinutes,
        image: input.image,
        focus: focusBody(input.focus),
      }),
      signal: AbortSignal.timeout(input.image ? PHOTO_PLAN_TIMEOUT_MS : PLAN_TIMEOUT_MS),
    }),
  )
  return readLongPlanResponse(record, null, input.isEventDate)
}

/** 긴 계획을 학생의 요청대로 고쳐 달라고 합니다. 요청 { plan: 설정, request } → 짜기와 같은 응답 */
export async function reviseLongPlan(plan: CoachPlan, request: string): Promise<PlanReply> {
  const record = asRecord(
    await api<unknown>('/ai/long-plan/revise', {
      method: 'POST',
      body: JSON.stringify({ plan: plan.spec, request: request.slice(0, MAX_PLAN_TEXT_LENGTH) }),
      signal: AbortSignal.timeout(PLAN_TIMEOUT_MS),
    }),
  )
  return readLongPlanResponse(record, plan, plan.isEventDate)
}

/**
 * 서버가 계획을 못 짜는 이유가 "아직 준비 안 됨" 이면 시연용 예시 앞에 붙일 한 줄, 아니면 null
 *   404 — 서버에 이 기능이 아직 배포되지 않음 · 503 — AI 가 꺼짐 · 429 — 오늘 AI 한도를 다 씀
 */
function fallbackNoticeOf(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null
  if (error.status === 404)
    return '계획 서버가 아직 준비 중이라 시연용 예시로 보여 줄게. 서버 준비가 끝나면 진짜로 짜 줄게.'
  if (error.status === 503) return '지금 AI 가 꺼져 있어서 시연용 예시로 보여 줄게.'
  if (error.status === 429)
    return '오늘 AI 를 다 써서 시연용 예시로 보여 줄게. 내일은 진짜로 짜 줄게.'
  return null
}

/**
 * 서버로 계획을 짜 보고, 아직 준비가 안 됐으면(404 · 503 · 429) 시연용 예시로 대신합니다.
 * 그 밖의 실패(연결 끊김 · 400 등)는 그대로 던져서 화면이 [다시 보내기] 를 보여 줍니다.
 */
export async function withDemoFallback(
  serverCall: () => Promise<PlanReply>,
  demoCall: () => PlanReply,
): Promise<PlanReply> {
  try {
    return await serverCall()
  } catch (error) {
    const notice = fallbackNoticeOf(error)
    if (notice === null) throw error
    const demo = demoCall()
    return { ...demo, reply: `${notice}\n${demo.reply}`, isDemo: true }
  }
}

// ---- 시연용 예시 (테스트 로그인 · 서버 준비 전) ----

/** 하루의 카드들을 첫 카드 시각부터 10분씩 쉬며 다시 놓습니다. 자정을 넘는 카드는 뺍니다. */
function retimeDay(drafts: PlanDraft[], startTime: string): PlanDraft[] {
  let cursor = toMinutes(startTime)
  const placed: PlanDraft[] = []
  for (const draft of drafts) {
    if (cursor + draft.durationMinutes > 24 * 60) break
    placed.push({ ...draft, startTime: toTime(cursor) })
    cursor += draft.durationMinutes + 10
  }
  return placed
}

/** 날짜마다 retimeDay 를 합니다. startTime 이 null 이면 그날 첫 카드의 시각을 그대로 씁니다. */
function retimeAll(drafts: PlanDraft[], startTime: string | null): PlanDraft[] {
  return groupPlanByDate(drafts).flatMap((group) =>
    retimeDay(group.drafts, startTime ?? group.drafts[0].startTime ?? DEFAULT_START_TIME),
  )
}

/** 시연용 계획 하나 (상태는 open) */
function demoPlan(fields: Pick<CoachPlan, 'kind' | 'drafts' | 'spec' | 'evidence'>): CoachPlan {
  return {
    ...fields,
    replaceCardIds: [],
    fromCards: false,
    overflow: false,
    isEventDate: false,
    isDemo: true,
    status: 'open',
  }
}

/**
 * 시연용 오늘 계획. 오늘 시간표 과목으로 3장(50 · 50 · 40분)을 19시(지났으면 지금부터 10분 뒤)부터 놓습니다.
 * light 면 1장 · 40분입니다. (컨디션이 안 좋을 때 — 한 장을 짧게 깎지 않고 장 수를 줄임)
 */
export function makeDemoDayPlan(input: {
  todayKey: string
  now: number
  subjects: string[]
  light: boolean
}): PlanReply {
  const [first = '국어', second = '수학'] = input.subjects
  const nowDate = new Date(input.now)
  // 10분 단위로 올림한 "지금부터 10분 뒤"
  const soon = Math.ceil((nowDate.getHours() * 60 + nowDate.getMinutes() + 10) / 10) * 10
  const start = toTime(Math.min(Math.max(toMinutes(DEFAULT_START_TIME), soon), 23 * 60))
  const drafts: PlanDraft[] = input.light
    ? [
        {
          date: input.todayKey,
          startTime: null,
          durationMinutes: 40,
          title: `${first} 오늘 배운 것 복습`,
          checklist: ['필기 다시 읽기', '예제 2개 풀기'],
        },
      ]
    : [
        {
          date: input.todayKey,
          startTime: null,
          durationMinutes: 50,
          title: `${first} 복습`,
          checklist: ['오늘 배운 부분 다시 읽기', '예제 3개 풀기'],
        },
        {
          date: input.todayKey,
          startTime: null,
          durationMinutes: 50,
          title: `${second} 문제 풀기`,
          checklist: ['문제집 4쪽', '틀린 문제 표시'],
        },
        {
          date: input.todayKey,
          startTime: null,
          durationMinutes: 40,
          title: '영어 단어 · 본문',
          checklist: ['단어 30개 외우고 가리고 쓰기', '본문 1과 소리 내어 읽기'],
        },
      ]
  const placed = retimeDay(drafts, start)
  if (placed.length === 0) {
    return textReply('오늘은 너무 늦었어. 푹 자고 내일 계획을 짜 보자!', true)
  }
  return {
    showHelp: false,
    reply: input.light
      ? '컨디션이 안 좋다고 해서 가볍게 짜 봤어. 고칠 곳 있으면 말해 줘.'
      : '오늘 계획을 짜 봤어. 고칠 곳이 있으면 말해 줘!',
    plan: demoPlan({
      kind: 'day',
      drafts: placed,
      spec: null,
      evidence: [
        input.subjects.length > 0
          ? '오늘 시간표 과목으로 짰어요'
          : '시간표를 몰라서 기본 과목으로 짰어요',
        input.light
          ? '컨디션이 안 좋다고 해서 짧게 잡았어요'
          : `${start} 부터 카드 사이에 10분씩 쉬게 했어요`,
      ],
    }),
    cleared: false,
    isDemo: true,
  }
}

/** 시연용 긴 계획의 공부할 내용. 사진을 넣었으면 시험 범위 예시, 아니면 목표 이름으로 만듭니다. */
function demoTopicTitles(goal: string, hasPhoto: boolean): string[] {
  if (hasPhoto) {
    return [
      '미적분Ⅰ 3단원 개념 정리',
      '미적분Ⅰ 3단원 문제 풀기',
      '미적분Ⅰ 4단원 개념 정리',
      '미적분Ⅰ 4단원 문제 풀기',
      '문학 작품 3개 다시 읽기',
      '영어Ⅰ 4~5과 본문 암기',
    ]
  }
  const name = goal.length > 14 ? `${goal.slice(0, 14)}…` : goal
  return [
    `${name} 범위 훑어보기`,
    `${name} 개념 정리 ①`,
    `${name} 개념 정리 ②`,
    `${name} 문제 풀기 ①`,
    `${name} 문제 풀기 ②`,
    `${name} 오답 정리`,
  ]
}

/**
 * 시연용 긴 계획. 오늘부터 시험 전날까지(쉬는 요일 빼고) 하루 한 장씩, 마지막 날은 총복습입니다.
 * 진짜 계획은 서버 코드가 공부할 내용의 양에 맞춰 나눕니다. (여기는 모양만 보여 주는 예시)
 */
export function makeDemoLongPlan(input: {
  todayKey: string
  goal: string
  endDate: string
  dailyMinutes: number
  hasPhoto: boolean
  isEventDate: boolean
}): PlanReply {
  const spec: LongPlanSpec = {
    goal: input.goal,
    startDate: input.todayKey,
    endDate: input.endDate,
    dailyMinutes: input.dailyMinutes,
    startTime: DEFAULT_START_TIME,
    restDays: [],
    topics: demoTopicTitles(input.goal, input.hasPhoto).map((title) => ({
      title,
      minutes: input.dailyMinutes,
      checklist: [],
    })),
  }
  const drafts = scheduleDemoLongPlan(spec)
  if (drafts.length === 0) {
    return textReply('공부할 날이 없어. 날짜를 다시 골라 줄래?', true)
  }
  return {
    showHelp: false,
    reply: '계획을 짜 봤어. 마지막 날은 총복습이야. 어때?',
    plan: {
      ...demoPlan({ kind: 'long', drafts, spec, evidence: [] }),
      isEventDate: input.isEventDate,
    },
    cleared: false,
    isDemo: true,
  }
}

/**
 * 설정대로 시연용 긴 계획의 카드를 놓습니다. (처음 짤 때와 고칠 때 같이 씀)
 * 공부할 날 = 시작 날 ~ 시험 전날 중 쉬는 요일을 뺀 날. 하루 한 장, 공부할 내용을 차례로 돌려 쓰고 마지막 날은 총복습입니다.
 */
function scheduleDemoLongPlan(spec: LongPlanSpec): PlanDraft[] {
  const days: string[] = []
  for (let day = spec.startDate; day < spec.endDate; day = moveDateKey(day, 1)) {
    if (!spec.restDays.includes(WEEKDAYS[weekdayIndexOf(day)])) days.push(day)
  }
  const titles = spec.topics.map((topic) => topic.title)
  if (titles.length === 0) return []
  return days.map((day, index) => {
    // 3일 이상이면 마지막 날은 앞에서 한 것을 다시 보는 총복습
    const isReview = days.length >= 3 && index === days.length - 1
    return {
      date: day,
      startTime: spec.startTime,
      durationMinutes: Math.min(120, spec.dailyMinutes),
      title: isReview ? '총복습 · 오답 다시 보기' : titles[index % titles.length],
      checklist: isReview
        ? ['틀린 문제만 다시 풀기', '헷갈린 개념 한 줄 정리']
        : ['교과서 · 필기 보기', '문제 5개'],
    }
  })
}

/**
 * 고치는 요청 속 시각. '8시' · '8시 반' · '저녁 7시 30분' · '20:00' 을 알아듣습니다. 없으면 null
 * '아침 · 오전' 이 없으면 1 ~ 11시는 저녁으로 봅니다. (학생이 공부하는 시간)
 *
 *   timeOf('8시부터 해 줘') -> '20:00'   timeOf('시작 시각을 07:30 로') -> '07:30'
 */
export function timeOf(request: string): string | null {
  const clock = /(\d{1,2}):(\d{2})/.exec(request)
  if (clock) {
    const hour = Number(clock[1])
    const minute = Number(clock[2])
    return hour <= 23 && minute <= 59 ? toTime(hour * 60 + minute) : null
  }
  const spoken = /(\d{1,2})\s*시\s*(반|(\d{1,2})\s*분)?/.exec(request)
  if (!spoken) return null
  let hour = Number(spoken[1])
  const minute = spoken[2] === '반' ? 30 : Number(spoken[3] ?? 0)
  const isMorning = request.includes('아침') || request.includes('오전')
  if (!isMorning && hour >= 1 && hour <= 11) hour += 12
  return hour <= 23 && minute <= 59 ? toTime(hour * 60 + minute) : null
}

/**
 * 시연용 고치기. 낱말을 보고 아래만 알아듣습니다. (진짜 AI 는 더 자유롭게 고칩니다)
 *   '주말 빼'            -> 토 · 일을 뺌
 *   '하루 90분' · '90분' -> 하루 합을 그 분으로 (한 장은 30분 밑으로 줄이지 않고, 모자라면 뒤 카드부터 뺌)
 *   '줄여' · '가볍게'    -> 오늘 계획은 카드 수를 줄임(한 장 길이는 그대로), 긴 계획은 하루 시간을 절반으로(30분까지)
 *   '8시부터' · '20:00'  -> 매일 그 시각부터
 *   '영어는 빼'          -> 제목에 '영어' 가 든 것을 뺌
 * 긴 계획은 서버처럼 설정(spec)만 바꾸고 카드를 다시 나눕니다. 오늘 계획은 카드를 바로 고칩니다.
 */
export function reviseDemoPlan(plan: CoachPlan, request: string): PlanReply {
  const changes: string[] = []
  const isWeekendRequest = request.includes('주말')
  // '영어는 빼 줘' 의 '영어' 처럼 빼 달라는 낱말 ('주말은 빼 줘' 는 위에서 따로 봄)
  const removeWord = isWeekendRequest ? undefined : /(\S+?)(은|는|을|를)?\s*빼/.exec(request)?.[1]
  // '8시 30분부터' 의 '30분' 은 길이가 아니라 시각이라서, 시각을 지운 글에서 길이를 찾습니다.
  const withoutTime = request
    .replace(/\d{1,2}:\d{2}/g, ' ')
    .replace(/\d{1,2}\s*시\s*(반|\d{1,2}\s*분)?/g, ' ')
  const minutesMatch = /(\d{2,3})\s*분/.exec(withoutTime)
  const targetMinutes = minutesMatch
    ? Math.min(MAX_DAILY_MINUTES, Math.max(MIN_STUDY_MINUTES, Number(minutesMatch[1])))
    : null
  const isShorter = ['줄여', '가볍게', '적게'].some((word) => request.includes(word))
  const newTime = timeOf(request)

  let drafts = plan.drafts
  let spec = plan.spec
  if (spec) {
    // 긴 계획: 설정을 바꾸고 카드를 다시 나눕니다.
    if (isWeekendRequest) {
      spec = { ...spec, restDays: [...new Set<Weekday>([...spec.restDays, 'SAT', 'SUN'])] }
      changes.push('주말은 뺐어')
    }
    if (removeWord) {
      const word = removeWord
      const left = spec.topics.filter((topic) => !topic.title.includes(word))
      if (left.length < spec.topics.length) {
        spec = { ...spec, topics: left }
        changes.push(`'${word}' 는 뺐어`)
      }
    }
    if (minutesMatch) {
      const daily = Math.min(
        MAX_DAILY_MINUTES,
        Math.max(MIN_DAILY_MINUTES, Number(minutesMatch[1])),
      )
      spec = { ...spec, dailyMinutes: daily }
      changes.push(`하루 ${daily}분으로 맞췄어`)
    } else if (isShorter) {
      spec = {
        ...spec,
        dailyMinutes: Math.max(MIN_DAILY_MINUTES, Math.round(spec.dailyMinutes / 2)),
      }
      changes.push(`하루 ${spec.dailyMinutes}분으로 줄였어`)
    }
    if (newTime) {
      spec = { ...spec, startTime: newTime }
      changes.push(`${newTime} 부터로 바꿨어`)
    }
    drafts = scheduleDemoLongPlan(spec)
  } else {
    // 오늘 계획: 카드를 바로 고칩니다.
    if (removeWord) {
      const word = removeWord
      const left = drafts.filter((draft) => !draft.title.includes(word))
      if (left.length < drafts.length) {
        drafts = left
        changes.push(`'${word}' 카드는 뺐어`)
      }
    }
    if (targetMinutes !== null && drafts.length > 0) {
      drafts = fitDayTotal(drafts, targetMinutes)
      changes.push(`모두 ${targetMinutes}분 안쪽으로 맞췄어`)
    } else if (isShorter && drafts.length > 1) {
      // 줄여 달라면 한 장을 짧게 깎지 않고 장 수를 줄입니다. (뒤 카드부터)
      drafts = drafts.slice(0, Math.ceil(drafts.length / 2))
      changes.push(`카드를 ${drafts.length}장으로 줄였어. 한 장은 그대로 두고 개수만 줄였어`)
    } else if (isShorter && drafts.length === 1) {
      const only = drafts[0]
      const shorter = Math.max(MIN_STUDY_MINUTES, Math.round((only.durationMinutes * 0.6) / 5) * 5)
      drafts = [{ ...only, durationMinutes: shorter }]
      changes.push(
        shorter < only.durationMinutes
          ? `${shorter}분으로 줄였어`
          : `이미 ${MIN_STUDY_MINUTES}분 한 장이라 더 줄이진 않을게`,
      )
    }
    if (newTime) changes.push(`${newTime} 부터로 바꿨어`)
    // 길이나 시각이 바뀌었으면 카드 사이 10분 쉬는 시간을 다시 맞춥니다.
    drafts = retimeAll(drafts, newTime)
  }

  if (changes.length === 0) {
    return textReply(
      "시연에서는 '줄여 줘' · '주말은 빼 줘' · '8시부터' · '영어는 빼 줘' 만 알아들어. 진짜 AI 는 더 자세히 고쳐 줘.",
      true,
    )
  }
  if (drafts.length === 0) {
    return { ...textReply(`${changes.join(', ')}. 그랬더니 계획이 비었어.`, true), cleared: true }
  }
  return {
    showHelp: false,
    reply: `${changes.join(', ')}. 어때?`,
    plan: { ...plan, drafts, spec, fromCards: false, evidence: [], isDemo: true, status: 'open' },
    cleared: false,
    isDemo: true,
  }
}

// ---- 채팅 글에서 긴 계획 요청 알아듣기 ----

/** 긴 계획을 짜 달라는 말인지 볼 낱말 */
const PLAN_WORDS = ['계획', '플랜', '플래너', '스케줄']
const LONG_HINT_WORDS = [
  '시험',
  '중간',
  '기말',
  '모의',
  '대회',
  '자격증',
  '수능',
  '30일',
  '한 달',
  '한달',
]

/** 채팅 글에서 알아들은 긴 계획 요청 */
export interface LongPlanText {
  /** 목표 한 줄 (계획을 부탁하는 말을 지운 것). 못 찾았으면 '' */
  goal: string
  /** 계획의 끝 날 (내일 ~ 30일 뒤). 날짜를 못 알아들었으면 null — 화면에서 고르게 합니다. */
  endDate: string | null
  /** true 면 endDate 가 학생이 말한 시험 · 대회 날 그대로입니다. ('30일치' 처럼 기간만 말했거나 30일보다 멀면 false) */
  isEventDate: boolean
  /** 학생이 말한 날이 30일보다 멀면 그 날. (계획은 30일 뒤까지만 짜고, 이 날은 홈 일정에 넣습니다) 아니면 null */
  farEventDate: string | null
}

/**
 * 채팅에 쓴 말이 "시험 · 대회까지 계획 짜 줘" 인지 보고, 목표 한 줄과 날짜를 꺼냅니다. 아니면 null
 * 날짜는 '11월 2일' · '11/2' · 'D-14' · '14일 뒤' 를 알아듣습니다. '30일치' · '한 달' 이면 30일 뒤까지입니다.
 *
 *   parseLongPlanText('11월 2일 중간고사 미적분 1~3단원 계획 짜 줘', '2026-10-18')
 *   -> { goal: '중간고사 미적분 1~3단원', endDate: '2026-11-02', isEventDate: true, farEventDate: null }
 *   parseLongPlanText('11월 5일에 수학 중간고사야. 미적분 1~3단원이야. 시험날까지 계획 짜 줘', …)
 *   -> { goal: '수학 중간고사 미적분 1~3단원', … }   (날짜 뒤 '에' · 마침표 · '시험날' 은 지움)
 *   parseLongPlanText('12월 25일 토익 계획', …) -> { goal: '토익', endDate: '2026-11-17', isEventDate: false, farEventDate: '2026-12-25' }
 *   parseLongPlanText('기말 계획 짜 줘', …)     -> { goal: '기말', endDate: null, … }   (날짜는 화면에서 고름)
 *   parseLongPlanText('오늘 피곤해', …)         -> null
 */
export function parseLongPlanText(text: string, todayKey: string): LongPlanText | null {
  if (!PLAN_WORDS.some((word) => text.includes(word))) return null
  let saidDate: string | null = null
  let rest = text

  // 날짜 바로 뒤의 '에' · '에는' 도 같이 찾아서, 날짜를 지울 때 함께 지웁니다. ('11월 5일에 수학 …' → '수학 …')
  const monthDay =
    /(\d{1,2})\s*월\s*(\d{1,2})\s*일(에는|에)?/.exec(text) ??
    /(\d{1,2})\/(\d{1,2})(에는|에)?/.exec(text)
  const dDay = /[Dd]\s*-\s*(\d{1,3})(에는|에)?/.exec(text)
  const after = /(\d{1,3})\s*일\s*(뒤|후)(에는|에)?/.exec(text)
  const isMonthLong = ['30일', '한 달', '한달'].some((word) => text.includes(word))
  if (monthDay) {
    const [year] = todayKey.split('-').map(Number)
    const month = String(Number(monthDay[1])).padStart(2, '0')
    const day = String(Number(monthDay[2])).padStart(2, '0')
    let date = `${year}-${month}-${day}`
    // 이미 지난 날짜면 내년으로 봅니다. (12월에 '1월 5일' 이라고 하면 다음 해)
    if (isDateKey(date) && date < todayKey) date = `${year + 1}-${month}-${day}`
    if (isDateKey(date)) saidDate = date
    rest = rest.replace(monthDay[0], ' ')
  } else if (dDay) {
    saidDate = moveDateKey(todayKey, Number(dDay[1]))
    rest = rest.replace(dDay[0], ' ')
  } else if (after) {
    saidDate = moveDateKey(todayKey, Number(after[1]))
    rest = rest.replace(after[0], ' ')
  }
  // 날짜도 기간도 없고 시험 · 대회 같은 낱말도 없으면 "오늘 계획" 이야기로 봅니다.
  if (saidDate === null && !isMonthLong && !LONG_HINT_WORDS.some((word) => text.includes(word))) {
    return null
  }

  const lastDate = moveDateKey(todayKey, MAX_LONG_PLAN_DAYS)
  let endDate: string | null = null
  let isEventDate = false
  let farEventDate: string | null = null
  if (saidDate !== null && saidDate > todayKey) {
    if (daysBetween(todayKey, saidDate) <= MAX_LONG_PLAN_DAYS) {
      endDate = saidDate
      isEventDate = true
    } else {
      endDate = lastDate
      farEventDate = saidDate
    }
  } else if (isMonthLong) {
    endDate = lastDate
  }
  // 목표 한 줄: 계획을 부탁하는 말 · '까지' · '30일치' 를 지우고 남은 글
  const goal = rest
    .replace(/(30일치|30일|한\s?달치?)/g, ' ')
    .replace(
      /(계획|플랜|플래너|스케줄)\s*(좀|을|를)?\s*(짜|세워|만들어)?\s*(줘|주라|줄래|줄 수 있어|봐)?[?.!]*/g,
      ' ',
    )
    .replace(/까지|이야|이에요|인데|있어|준비하고|준비해|준비/g, ' ')
    // '중간고사야.' 처럼 문장부호 바로 앞의 '야' (낱말 속 '야' 는 남깁니다. 예: '분야를')
    .replace(/야(?=[.,!?])/g, ' ')
    // '시험날' · '시험 당일' 은 날짜를 가리키는 말이라 목표 이름에서 뺍니다.
    .replace(/시험\s?날|시험\s?당일/g, ' ')
    // 문장 끝 마침표 · 쉼표 · 물음표 ('1~3단원' 의 물결표는 남깁니다)
    .replace(/[.,!?]+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PLAN_TEXT_LENGTH)
  return { goal, endDate, isEventDate, farEventDate }
}

// ---- 대화방 저장용 확인 ----

/** 저장소에서 꺼낸 계획이 쓸 수 있는 모양인지 확인합니다. (lib/coachThread.ts 가 씀) 깨졌으면 null */
export function toCoachPlan(value: unknown): CoachPlan | null {
  if (typeof value !== 'object' || value === null) return null
  const plan = value as Record<string, unknown>
  if (plan.kind !== 'day' && plan.kind !== 'long') return null
  const drafts = draftsOf(plan.drafts)
  if (drafts === null) return null
  const statuses: PlanStatus[] = ['open', 'replaced', 'saved', 'closed']
  const status = statuses.includes(plan.status as PlanStatus)
    ? (plan.status as PlanStatus)
    : 'closed'
  const spec = plan.spec === null ? null : toSpec(plan.spec)
  if (plan.kind === 'long' && spec === null) return null
  return {
    kind: plan.kind,
    drafts,
    spec,
    replaceCardIds: Array.isArray(plan.replaceCardIds) ? plan.replaceCardIds.filter(isText) : [],
    fromCards: plan.fromCards === true,
    evidence: Array.isArray(plan.evidence) ? plan.evidence.filter(isText) : [],
    overflow: plan.overflow === true,
    isEventDate: plan.isEventDate === true,
    isDemo: plan.isDemo === true,
    status,
  }
}

/**
 * 계획 말풍선 아래의 "고쳐 줘" 칩 글자. 누르면 이 글이 그대로 고치는 요청이 됩니다. ([이대로 할게] · [시간 바꿔 줘] 는 화면이 붙임)
 *
 *   오늘 계획                       -> ['가볍게 줄여 줘']
 *   긴 계획(하루 90분)              -> ['하루 1시간으로 줄여 줘', '주말은 빼 줘']
 *   긴 계획(하루 60분)              -> ['하루 40분으로 줄여 줘', '주말은 빼 줘']
 *   긴 계획(하루 60분, 다 안 들어감) -> ['하루 90분으로 늘려 줘', '주말은 빼 줘']
 */
export function planReviseLabels(plan: CoachPlan): string[] {
  if (plan.kind === 'day' || plan.spec === null) return ['가볍게 줄여 줘']
  const daily = plan.spec.dailyMinutes
  // 하루 시간 안에 다 안 들어갔으면(overflow) 줄이기 대신 늘리기를 권합니다.
  const labels =
    plan.overflow && daily < MAX_DAILY_MINUTES
      ? [`하루 ${Math.min(MAX_DAILY_MINUTES, daily + 30)}분으로 늘려 줘`]
      : [reduceLabelOf(daily)]
  const hasWeekend = plan.drafts.some((draft) => [0, 6].includes(weekdayIndexOf(draft.date)))
  if (hasWeekend) labels.push('주말은 빼 줘')
  return labels
}

/**
 * 긴 계획의 "줄여 줘" 칩 글자. 한 번에 현실적인 만큼만 줄이고, 30분 밑으로는 권하지 않습니다.
 *   reduceLabelOf(120) -> '하루 1시간으로 줄여 줘'   reduceLabelOf(60) -> '하루 40분으로 줄여 줘'
 *   reduceLabelOf(40)  -> '하루 30분으로 줄여 줘'    reduceLabelOf(30) -> '조금 줄여 줘'
 */
function reduceLabelOf(daily: number): string {
  if (daily > 60) return '하루 1시간으로 줄여 줘'
  if (daily > 40) return '하루 40분으로 줄여 줘'
  if (daily > MIN_STUDY_MINUTES) return `하루 ${MIN_STUDY_MINUTES}분으로 줄여 줘`
  return '조금 줄여 줘'
}

/**
 * 시연용: 오늘 계획의 합을 target 분에 맞춥니다. 한 장은 30분 밑으로 줄이지 않고, 그래도 넘치면 뒤 카드부터 뺍니다.
 *   [50, 50, 40] 을 90분에  -> [30, 30, 30]
 *   [50, 50, 40] 을 60분에  -> [30, 30]   (세 장 × 30분 = 90분이 넘어서 한 장을 뺌)
 *   [50] 을 90분에          -> [90]
 */
function fitDayTotal(drafts: PlanDraft[], target: number): PlanDraft[] {
  let kept = drafts
  while (kept.length > 1 && kept.length * MIN_STUDY_MINUTES > target) {
    kept = kept.slice(0, -1)
  }
  const total = kept.reduce((sum, draft) => sum + draft.durationMinutes, 0)
  return kept.map((draft) => ({
    ...draft,
    durationMinutes: Math.min(
      120,
      Math.max(MIN_STUDY_MINUTES, Math.round((draft.durationMinutes * target) / total / 5) * 5),
    ),
  }))
}
