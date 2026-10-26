/**
 * 코치가 먼저 말 거는 알림 (#578, 2026-10-18)
 * 사용자: "알림은 뭘 보내게 할까, 어쨌든 우리는 AI 최대화" → 알림 = 코치가 먼저 거는 말.
 * 알림을 누르면 코치 채팅이 열리고, 코치의 첫 말이 그 알림 글입니다. (pages/CoachPage.tsx 의 ?nudge=)
 *
 * | 알림         | 시각                    | 문장                                  | 누르면                          |
 * | ------------ | ----------------------- | ------------------------------------- | ------------------------------- |
 * | 아침         | 평일 07:20 · 주말 09:30 | 서버 AI (못 받으면 정해 둔 문장)      | 코치 → 오늘의 미션 칩           |
 * | 복습         | 17:30                   | 1 · 3 · 7일 전에 틀린 확인 문제가 있을 때 | 코치 → [📝 틀린 문제 다시]   |
 * | 시험 D-day   | 18:30                   | 시험 · 내 일정이 D-14 · D-7 · D-3 인 날 | 코치 → [📅 계획 짜기]          |
 * | 주간 분석    | 일요일 20:00            | 정해 둔 문장                          | 통계 탭 (AI 분석)               |
 * | 밤 정리      | 21:30                   | 서버 AI (못 받으면 정해 둔 문장)      | 코치 → [📅 내일 계획 짜 줘]     |
 *
 * 규칙
 *   - 하루 최대 4개, 그리고 설정의 "하루 메시지 수"(0 ~ 5)를 넘지 않습니다. 넘치면 위 표의 우선순위(아침 → 밤 정리 → 복습 → D-day → 주간)로 남깁니다.
 *   - 연락 금지 시간과 수업 시간(평일 08:20 ~ 16:30)에는 보내지 않습니다.
 *   - 오늘 · 내일 치만 만듭니다. (AI 문장을 오늘 · 내일 치만 받기 때문. 앱을 열 때마다 다시 만듭니다)
 *   - 서버가 위로가 필요하다고 했거나(comfort) 이 기기의 안전 브레이크가 공부 재촉을 멈췄으면, 그날은 아침 · 밤 위로 문장만 보냅니다.
 *   - 종류마다 켜고 끌 수 있습니다. (설정 → 알림)
 * 카드 시작 · 끝 알림은 lib/cardAlarms.ts 가 따로 만듭니다. (학생이 정한 계획이라 이 하루 한도에 넣지 않습니다)
 *
 * AI 문장: 하루 한 번(앱을 켤 때) 오늘 · 내일 치를 서버(POST /ai/nudges)에서 받아 이 기기에 저장해 둡니다.
 * 앱 알림은 앱을 닫아도 와야 해서 미리 예약하므로, 그때그때 받을 수 없기 때문입니다.
 * React 를 쓰지 않는 순수 함수(build…)와 저장소를 읽는 함수(load…)로 나눠 두었습니다.
 */
import type { Alarm } from '@/lib/appBridge'
import { api } from '@/lib/api'
import { getCardsOnDate, loadSavedCards } from '@/lib/cards'
import { LONG_PLAN_CHIP, QUIZ_CHIP, type CoachChip, type CoachMessage } from '@/lib/coachBriefing'
import { loadStudySessions, sessionMinutes } from '@/lib/dailyRecords'
import { moveDateKey, toDayKey } from '@/lib/date'
import { loadExamDates, loadSavedWritings } from '@/lib/diarySafety'
import { getPlannedStartAt } from '@/lib/facts'
import { loadFocusScores } from '@/lib/focusScore'
import { getMessageSettings } from '@/lib/messageSettings'
import { getUpcomingMyEvents } from '@/lib/myEvents'
import { toQuietHours } from '@/lib/notifications'
import { getSafetyBrakeResult, isWithinQuietHours, type QuietHours } from '@/lib/safetyBrake'
import { loadSchoolExamDates } from '@/lib/schoolEvents'
import { loadSchoolDay } from '@/lib/schoolToday'
import { loadData, saveData } from '@/lib/storage'
import { loadStudyFocus } from '@/lib/studyFocus'
import { loadQuizResults, wrongForReview } from '@/lib/studyQuiz'
import { COACH_PATH } from '@/lib/chatRooms'
import { STATS_PATH } from '@/lib/tabMenu'
import { queryOptions } from '@tanstack/react-query'
import type { Card } from '@/types'

export type NudgeKind = 'morning' | 'evening' | 'review' | 'dday' | 'weekly'

/** 하루 한도를 넘칠 때 남기는 순서 (앞일수록 먼저) */
export const NUDGE_KINDS: NudgeKind[] = ['morning', 'evening', 'review', 'dday', 'weekly']

/** 설정 화면에 보이는 이름과 설명 */
export const NUDGE_LABELS: Record<NudgeKind, { title: string; description: string }> = {
  morning: { title: '아침 한마디', description: '등교 전에 오늘 시간표 · 계획으로 말을 걸어요.' },
  evening: { title: '밤 정리', description: '밤에 오늘을 돌아보고 내일 계획을 같이 정해요.' },
  review: { title: '틀린 문제 복습', description: '틀린 확인 문제를 1 · 3 · 7일 뒤에 다시 내요.' },
  dday: { title: '시험 D-day', description: '시험 · 내 일정 14 · 7 · 3일 전에 계획을 권해요.' },
  weekly: { title: '주간 분석', description: '일요일 저녁에 이번 주 분석을 알려 줘요.' },
}

/** 주소의 ?nudge= 값이 알림 종류가 맞는지 (주소는 누구나 고칠 수 있어서 확인합니다) */
export function isNudgeKind(value: string): value is NudgeKind {
  return (NUDGE_KINDS as string[]).includes(value)
}

// ---- 시각 · 한도 (상수) ----

const MORNING_WEEKDAY_TIME = '07:20'
const MORNING_WEEKEND_TIME = '09:30'
const REVIEW_TIME = '17:30'
const DDAY_TIME = '18:30'
const WEEKLY_TIME = '20:00'
const EVENING_TIME = '21:30'
/** 코치 알림은 하루에 이만큼까지 (카드 알림 빼고) */
export const MAX_NUDGES_PER_DAY = 4
/** 틀린 문제를 다시 내는 날 — 틀린 날로부터 1 · 3 · 7일 뒤 (간격을 넓혀 가며 복습하면 오래 기억합니다) */
export const REVIEW_DAYS_AGO = [1, 3, 7]
/** 시험 · 내 일정 며칠 전에 알릴지 */
export const DDAY_STEPS = [14, 7, 3]
/** 수업 시간 (평일). NEIS 시간표에는 교시만 있고 시각이 없어서 일반적인 고등학교 시간으로 잡습니다. */
const CLASS_START = '08:20'
const CLASS_END = '16:30'
/** 학사일정에 남는 건 시험 날짜뿐이라, 시험 이름은 이렇게 부릅니다. */
const SCHOOL_EXAM_NAME = '학교 시험'

// ---- 알림 글 ----

/** 알림 한 개의 제목과 글. 서버 AI 문장도 이 모양입니다. */
export interface NudgeText {
  title: string
  body: string
}

/** 서버에서 받은 하루치 AI 문장 */
export interface NudgeTexts {
  morning: NudgeText | null
  evening: NudgeText | null
  /** true 면 서버가 위로가 필요하다고 본 날 (아침 · 밤 둘 다 위로 문장) */
  comfort: boolean
}

/** 위로가 필요한 날의 정해 둔 문장 (공부를 재촉하지 않음) */
const COMFORT_TEXTS: Record<'morning' | 'evening', NudgeText> = {
  morning: { title: '좋은 아침', body: '오늘은 무리하지 말자. 이야기하고 싶으면 언제든 와.' },
  evening: { title: '오늘 하루 수고했어', body: '힘든 일 있었으면 코치한테 털어놔도 돼.' },
}

/** 하루치 알림을 만드는 재료 (loadNudgeDay 가 저장소에서 모읍니다) */
export interface NudgeDay {
  /** 'YYYY-MM-DD' (하루의 기준은 새벽 4시) */
  dateKey: string
  /** 서버 AI 문장. 못 받았으면 null (정해 둔 문장을 씀) */
  texts: NudgeTexts | null
  /** 그날 카드 (시작 시각 순서) */
  cards: Card[]
  /** 그날 다시 낼 틀린 문제 수와, 그 문제가 며칠 전 것인지 */
  review: { count: number; daysAgo: number[] }
  /** 그날이 D-14 · D-7 · D-3 인 시험 · 내 일정. 없으면 null */
  dday: { name: string; dDay: number } | null
  /** 이 기기의 안전 브레이크가 공부 재촉을 멈췄는지 (lib/safetyBrake.ts 의 stopWhip) */
  stopWhip: boolean
}

/** 그날이 위로만 하는 날인지 */
function isComfortDay(day: NudgeDay): boolean {
  return day.stopWhip || day.texts?.comfort === true
}

/** 'HH:MM' → 분 */
function toMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

/** 'YYYY-MM-DD' 의 요일 (0 일요일 ~ 6 토요일) */
function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T12:00:00`).getDay()
}

/** 수업 시간인지 (평일 08:20 ~ 16:30). 방학 · 휴업일은 모르므로 평일이면 수업 시간으로 봅니다. */
export function isClassTime(at: number): boolean {
  const date = new Date(at)
  const weekday = date.getDay()
  if (weekday === 0 || weekday === 6) return false
  const minutes = date.getHours() * 60 + date.getMinutes()
  return minutes >= toMinutes(CLASS_START) && minutes < toMinutes(CLASS_END)
}

/** 글을 n 자로 줄입니다. (넘치면 … ) */
function shorten(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)}…` : text
}

/** '어제 · 3일 전' 처럼 며칠 전인지 (코치의 [📝 틀린 문제 다시] 도 씀) */
export function daysAgoText(daysAgo: number[]): string {
  return daysAgo.map((days) => (days === 1 ? '어제' : `${days}일 전`)).join(' · ')
}

/**
 * 그 종류의 알림 글. 서버 AI 문장이 있으면 그것, 없으면 정해 둔 문장입니다.
 * 위로만 하는 날이면 아침 · 밤은 위로 문장이고, 나머지는 null(보내지 않음)입니다.
 *
 *   nudgeTextOf('morning', { cards: [19:00 미적분 문제집], texts: null, … })
 *     -> { title: '☀️ 좋은 아침', body: '오늘 19:00 미적분 문제집부터야. 코치랑 계획 한 번 보자.' }
 *   nudgeTextOf('review', { review: { count: 2, daysAgo: [1, 3] }, … })
 *     -> { title: '📝 복습할 시간', body: '어제 · 3일 전에 틀린 문제 2개, 지금 다시 풀면 오래 기억나.' }
 */
export function nudgeTextOf(kind: NudgeKind, day: NudgeDay): NudgeText | null {
  if (isComfortDay(day)) {
    if (kind !== 'morning' && kind !== 'evening') return null
    return day.texts?.comfort ? (day.texts[kind] ?? COMFORT_TEXTS[kind]) : COMFORT_TEXTS[kind]
  }
  if (kind === 'morning') {
    if (day.texts?.morning) return day.texts.morning
    const first = day.cards.find((card) => card.startTime)
    return first
      ? {
          title: '☀️ 좋은 아침',
          body: `오늘 ${first.startTime} ${shorten(first.title, 12)}부터야. 코치랑 계획 한 번 보자.`,
        }
      : { title: '☀️ 좋은 아침', body: '오늘 할 공부를 코치랑 같이 정하자. 눌러서 시작해.' }
  }
  if (kind === 'evening') {
    return (
      day.texts?.evening ?? {
        title: '🌙 오늘 어땠어?',
        body: '오늘 한 것 정리하고, 내일 계획도 같이 정하자.',
      }
    )
  }
  if (kind === 'review') {
    if (day.review.count === 0) return null
    return {
      title: '📝 복습할 시간',
      body: `${daysAgoText(day.review.daysAgo)}에 틀린 문제 ${day.review.count}개, 지금 다시 풀면 오래 기억나.`,
    }
  }
  if (kind === 'dday') {
    if (day.dday === null) return null
    return {
      title: `📅 ${shorten(day.dday.name, 10)} D-${day.dday.dDay}`,
      body:
        day.dday.dDay >= 7
          ? '남은 날 계획을 코치랑 같이 짜 볼까?'
          : '마지막 정리 계획을 코치랑 같이 짜자.',
    }
  }
  // 주간 분석은 일요일에만
  if (weekdayOf(day.dateKey) !== 0) return null
  return {
    title: '📊 이번 주 분석이 나왔어',
    body: '이번 주 공부를 코치가 정리했어. 눌러서 확인해.',
  }
}

/** 그 종류의 알림 시각 ('HH:MM') */
function nudgeTimeOf(kind: NudgeKind, dateKey: string): string {
  if (kind === 'morning') {
    const weekday = weekdayOf(dateKey)
    return weekday === 0 || weekday === 6 ? MORNING_WEEKEND_TIME : MORNING_WEEKDAY_TIME
  }
  if (kind === 'review') return REVIEW_TIME
  if (kind === 'dday') return DDAY_TIME
  if (kind === 'weekly') return WEEKLY_TIME
  return EVENING_TIME
}

/** 알림을 누르면 갈 주소. 주간 분석은 통계 탭(AI 분석), 나머지는 코치(첫 말이 그 알림 글) */
export function nudgeUrlOf(kind: NudgeKind): string {
  return kind === 'weekly' ? STATS_PATH : `${COACH_PATH}?nudge=${kind}`
}

export interface CoachNudgesInput {
  /** 지금 (Date.now() 값) */
  now: number
  /** 오늘 · 내일 (loadNudgeDay) */
  days: NudgeDay[]
  /** 켜 둔 종류 (설정) */
  enabled: Record<NudgeKind, boolean>
  /** 설정의 "하루 메시지 수" (0 ~ 5). 하루 알림이 이 수와 4 중 작은 것을 넘지 않습니다. */
  dailyCount: number
  /** 연락 금지 시간 */
  quietHours: QuietHours
}

/**
 * 코치 알림 목록 (오늘 · 내일). 카드 · 세션 알림과 합쳐서 앱에 보냅니다. (hooks/useAppBridge.ts)
 * 순수 함수라 now 만 바꿔 넣어 확인할 수 있습니다.
 *
 * 예) 지금 10-18(일) 07:00, 하루 메시지 수 3, 연락 금지 23:00 ~ 07:00
 *     오늘: 어제 틀린 문제 2개, D-day 없음 · 내일(월): 없음
 *   -> 10-18 09:30 아침 · 17:30 복습 · 21:30 밤 정리 (20:00 주간 분석은 하루 3개를 넘어서 빠짐)
 *      10-19 07:20 아침 · 21:30 밤 정리
 */
export function buildCoachNudgeAlarms(input: CoachNudgesInput): Alarm[] {
  const perDay = Math.min(MAX_NUDGES_PER_DAY, input.dailyCount)
  const alarms: Alarm[] = []
  for (const day of input.days) {
    const dayAlarms: Alarm[] = []
    for (const kind of NUDGE_KINDS) {
      if (dayAlarms.length >= perDay) break
      if (!input.enabled[kind]) continue
      const text = nudgeTextOf(kind, day)
      const at = getPlannedStartAt({ date: day.dateKey, startTime: nudgeTimeOf(kind, day.dateKey) })
      if (text === null || at === null || at <= input.now) continue
      if (isWithinQuietHours(new Date(at), input.quietHours) || isClassTime(at)) continue
      dayAlarms.push({
        id: `nudge-${day.dateKey}-${kind}`,
        at,
        title: text.title,
        body: text.body,
        url: nudgeUrlOf(kind),
      })
    }
    alarms.push(...dayAlarms)
  }
  return alarms.sort((a, b) => a.at - b.at)
}

// ---- 알림을 누르고 들어왔을 때 코치의 첫 말 ----

/** [📅 내일 계획 짜 줘] — 밤 정리 알림에서 내일 계획을 핑퐁으로 짭니다. */
export const TOMORROW_PLAN_CHIP: CoachChip = {
  kind: 'dayPlan',
  label: '📅 내일 계획 짜 줘',
  tomorrow: true,
}

/**
 * 알림을 누르고 들어왔을 때 코치가 먼저 하는 말. 글은 알림과 같고, 칩은 그 알림에서 할 일입니다.
 * missionChips: 아침 알림에 붙일 오늘의 미션 칩 (pages/CoachPage.tsx 가 buildMissionBriefing 으로 만들어 넘김)
 * 그날 보낼 글이 없으면(예: 복습할 문제를 그새 다 풀었음) null 입니다.
 *
 *   buildNudgeCoachMessage('evening', 하루, [])
 *     -> { text: '🌙 오늘 어땠어?\n오늘 한 것 정리하고, 내일 계획도 같이 정하자.',
 *          chips: [📅 내일 계획 짜 줘, 📝 문제 내 줘, 오늘 정리할래] }
 */
export function buildNudgeCoachMessage(
  kind: NudgeKind,
  day: NudgeDay,
  missionChips: CoachChip[],
): CoachMessage | null {
  const text = nudgeTextOf(kind, day)
  if (text === null) return null
  const message = `${text.title}\n${text.body}`
  const laterChip: CoachChip = { kind: 'say', label: '이따 할게' }
  if (isComfortDay(day)) {
    return {
      text: message,
      chips: [
        { kind: 'say', label: '고마워' },
        { kind: 'say', label: '이야기하고 싶어' },
      ],
    }
  }
  if (kind === 'morning') return { text: message, chips: missionChips }
  if (kind === 'evening') {
    return {
      text: message,
      chips: [TOMORROW_PLAN_CHIP, QUIZ_CHIP, { kind: 'say', label: '오늘 정리할래' }],
    }
  }
  if (kind === 'review') {
    return {
      text: message,
      chips: [
        { kind: 'quizReview', label: '📝 틀린 문제 다시', daysAgo: day.review.daysAgo },
        laterChip,
      ],
    }
  }
  if (kind === 'dday' && day.dday) {
    return {
      text: message,
      chips: [{ ...LONG_PLAN_CHIP, label: `📅 ${shorten(day.dday.name, 8)} 계획 짜기` }, laterChip],
    }
  }
  return { text: message, chips: [laterChip] }
}

// ---- 저장소에서 읽기 ----

// 종류별로 끈 알림 목록을 넣어 두는 이름 (실제 키는 'study-coach-nudges-off'). 설정의 "알림" 에서 켜고 끕니다.
const NUDGES_OFF_KEY = 'coach-nudges-off'
// 예전 "오늘의 미션 알림" 끄기 (실제 키는 'study-mission-alerts-off'). 껐던 사람은 아침 · 밤 정리를 꺼진 채로 시작합니다.
const OLD_MISSION_OFF_KEY = 'mission-alerts-off'

/** 종류별로 켜져 있는지. 처음에는 모두 켜져 있습니다. */
export function loadNudgeSettings(): Record<NudgeKind, boolean> {
  const saved = loadData<unknown>(NUDGES_OFF_KEY, null)
  const off = Array.isArray(saved)
    ? saved.filter((kind): kind is NudgeKind => typeof kind === 'string' && isNudgeKind(kind))
    : loadData<unknown>(OLD_MISSION_OFF_KEY, false) === true
      ? (['morning', 'evening'] as NudgeKind[])
      : []
  return {
    morning: !off.includes('morning'),
    evening: !off.includes('evening'),
    review: !off.includes('review'),
    dday: !off.includes('dday'),
    weekly: !off.includes('weekly'),
  }
}

/** 한 종류를 켜거나 끕니다. 끄면 다음 확인(10초 안)에 앱의 예약에서도 빠집니다. */
export function setNudgeOn(kind: NudgeKind, isOn: boolean): Record<NudgeKind, boolean> {
  const next = { ...loadNudgeSettings(), [kind]: isOn }
  saveData(
    NUDGES_OFF_KEY,
    NUDGE_KINDS.filter((item) => !next[item]),
  )
  return next
}

// 받아 둔 AI 문장 (실제 키는 'study-coach-nudge-texts'). { 'YYYY-MM-DD': { morning, evening, comfort, fetchedOn } }
const TEXTS_KEY = 'coach-nudge-texts'
/** 너무 쌓이지 않게 최근 며칠 치만 남깁니다. */
const KEEP_TEXT_DAYS = 3

interface SavedTexts extends NudgeTexts {
  /** 받은 날 'YYYY-MM-DD'. 오늘 받은 것만 "새것" 으로 봅니다. */
  fetchedOn: string
}

function toNudgeText(value: unknown): NudgeText | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const body = typeof record.body === 'string' ? record.body.trim() : ''
  // 서버가 제목 20자 · 글 70자로 검사하지만, 알림 화면이 깨지지 않게 한 번 더 막습니다.
  if (title === '' || body === '' || title.length > 40 || body.length > 120) return null
  return { title, body }
}

function loadSavedTexts(): Record<string, SavedTexts> {
  const saved = loadData<unknown>(TEXTS_KEY, {})
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return {}
  const result: Record<string, SavedTexts> = {}
  for (const [dateKey, value] of Object.entries(saved as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue
    const record = value as Record<string, unknown>
    if (typeof record.fetchedOn !== 'string') continue
    result[dateKey] = {
      morning: toNudgeText(record.morning),
      evening: toNudgeText(record.evening),
      comfort: record.comfort === true,
      fetchedOn: record.fetchedOn,
    }
  }
  return result
}

/** 그날의 받아 둔 AI 문장. 없으면 null */
export function loadNudgeTexts(dateKey: string): NudgeTexts | null {
  return loadSavedTexts()[dateKey] ?? null
}

function saveNudgeTexts(dateKey: string, texts: NudgeTexts, todayKey: string): void {
  const all = { ...loadSavedTexts(), [dateKey]: { ...texts, fetchedOn: todayKey } }
  const keepFrom = moveDateKey(todayKey, -1)
  const kept = Object.fromEntries(
    Object.entries(all)
      .filter(([key]) => key >= keepFrom)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-KEEP_TEXT_DAYS),
  )
  saveData(TEXTS_KEY, kept)
}

/** 학사일정 시험 날짜에서 시험 기간의 첫날만 (앞 시험 날과 3일 넘게 떨어진 날) */
function examStartDates(dates: string[]): string[] {
  const sorted = [...new Set(dates)].sort()
  return sorted.filter((date, index) => {
    const before = sorted[index - 1]
    return before === undefined || moveDateKey(before, 3) < date
  })
}

/** 'YYYY-MM-DD' 두 날짜 사이의 날 수 (to - from) */
function daysBetween(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split('-').map(Number)
  const [ty, tm, td] = toKey.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

/** dateKey 에서 가장 가까운 시험 · 내 일정 (60일 안). 없으면 null */
function nearestExamFrom(dateKey: string): { name: string; dDay: number } | null {
  const school = examStartDates(loadSchoolExamDates()).map((date) => ({
    name: SCHOOL_EXAM_NAME,
    dDay: daysBetween(dateKey, date),
  }))
  const mine = getUpcomingMyEvents(dateKey, 60).map((event) => ({
    name: event.name,
    dDay: event.dDay,
  }))
  const upcoming = [...school, ...mine]
    .filter((item) => item.dDay >= 0 && item.dDay <= 60)
    .sort((a, b) => a.dDay - b.dDay)
  return upcoming[0] ?? null
}

/** 그날이 D-14 · D-7 · D-3 인 시험 · 내 일정 */
function ddayOn(dateKey: string): { name: string; dDay: number } | null {
  const school = examStartDates(loadSchoolExamDates()).map((date) => ({
    name: SCHOOL_EXAM_NAME,
    dDay: daysBetween(dateKey, date),
  }))
  const mine = getUpcomingMyEvents(dateKey, Math.max(...DDAY_STEPS)).map((event) => ({
    name: event.name,
    dDay: event.dDay,
  }))
  return [...school, ...mine].find((item) => DDAY_STEPS.includes(item.dDay)) ?? null
}

/** 저장소에서 그날의 알림 재료를 모읍니다. stopWhip 은 오늘 기준 안전 브레이크입니다. */
export function loadNudgeDay(dateKey: string, stopWhip: boolean): NudgeDay {
  const results = loadQuizResults()
  const daysAgo = REVIEW_DAYS_AGO.filter(
    (days) => wrongForReview(results, dateKey, [days]).length > 0,
  )
  return {
    dateKey,
    texts: loadNudgeTexts(dateKey),
    cards: getCardsOnDate(loadSavedCards() ?? [], dateKey),
    review: { count: wrongForReview(results, dateKey, daysAgo).length, daysAgo },
    dday: ddayOn(dateKey),
    stopWhip,
  }
}

/** 이 기기의 안전 브레이크가 지금 공부 재촉을 멈췄는지 (위기 표현이 있던 글이 있으면 true) */
export function loadStopWhip(now: number): boolean {
  const { texts, moods, crisisFlagged } = loadSavedWritings()
  return getSafetyBrakeResult({
    now: new Date(now),
    recentTexts: texts,
    recentMoods: moods,
    crisisFlagged,
    exams: loadExamDates(),
  }).stopWhip
}

/**
 * 지금의 코치 알림 목록을 저장소에서 만듭니다. (hooks/useAppBridge.ts 가 카드 알림과 합쳐서 보냅니다)
 * 저장된 값이 깨져 있어도 앱이 멈추지 않게, 문제가 생기면 빈 목록입니다.
 */
export function loadCoachNudgeAlarms(now: number): Alarm[] {
  try {
    const todayKey = toDayKey(now)
    const stopWhip = loadStopWhip(now)
    const settings = getMessageSettings()
    return buildCoachNudgeAlarms({
      now,
      days: [loadNudgeDay(todayKey, stopWhip), loadNudgeDay(moveDateKey(todayKey, 1), stopWhip)],
      enabled: loadNudgeSettings(),
      dailyCount: settings.dailyCount,
      quietHours: toQuietHours(settings),
    })
  } catch {
    return []
  }
}

// ---- 서버 AI 문장 받기 ----

/** 서버(POST /ai/nudges)에 보내는 모양. 칸은 BE docs/API.md "코치 알림 문장" 과 같습니다. */
export interface NudgeRequest {
  date: string
  subjects?: string[]
  cards?: { startTime: string; title: string; minutes: number }[]
  yesterday?: {
    plannedCards: number
    doneCards: number
    studyMinutes: number
    focusScore?: number
    phoneLifts?: number
  }
  wrongQuizTopics?: string[]
  exam?: { name: string; daysLeft: number }
  focus?: { kind: string; name: string | null }
}

/** 반올림해서 min ~ max 안으로 자릅니다. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

/**
 * 그날 알림 문장을 받으려고 서버에 보낼 숫자들을 이 기기의 기록으로 만듭니다. 비어 있는 칸은 보내지 않습니다.
 *   - 과목: 오늘 시간표(반을 골랐을 때만, 1교시부터). 내일 시간표는 아직 모름
 *   - 카드: 그날 시작 시각이 있는 카드 10장까지
 *   - 전날: 계획 카드 수 · 끝낸 카드 수 · 공부한 분 · 집중도 평균 · 폰 든 횟수 (전날 기록이 있을 때만)
 *   - 틀린 문제 주제: 그날 전 7일 안에 틀린 문제가 있던 주제 3개까지
 *   - 시험: 60일 안의 가장 가까운 시험 · 내 일정
 */
export function buildNudgeRequest(dateKey: string, todayKey: string): NudgeRequest {
  const request: NudgeRequest = { date: dateKey }
  const allCards = loadSavedCards() ?? []

  const subjects = dateKey === todayKey ? (loadSchoolDay(dateKey)?.subjects ?? []) : []
  if (subjects.length > 0) request.subjects = subjects.slice(0, 8).map((s) => s.slice(0, 20))

  const cards: NonNullable<NudgeRequest['cards']> = []
  for (const card of getCardsOnDate(allCards, dateKey)) {
    if (!card.startTime || cards.length >= 10) continue
    cards.push({
      startTime: card.startTime,
      title: card.title.slice(0, 30),
      minutes: clamp(card.durationMinutes, 5, 120),
    })
  }
  if (cards.length > 0) request.cards = cards

  const yesterdayKey = moveDateKey(dateKey, -1)
  const planned = getCardsOnDate(allCards, yesterdayKey)
  const sessions = loadStudySessions().filter(
    (session) => toDayKey(session.startedAt) === yesterdayKey,
  )
  if (planned.length > 0 || sessions.length > 0) {
    const plannedIds = planned.map((card) => card.id)
    const doneIds = new Set(
      sessions
        .map((session) => session.cardId)
        .filter((id): id is string => id !== undefined && plannedIds.includes(id)),
    )
    const scores = loadFocusScores().filter((score) => toDayKey(score.startedAt) === yesterdayKey)
    const lifts = scores.filter((score) => score.measuredBy === 'lift')
    request.yesterday = {
      plannedCards: clamp(planned.length, 0, 20),
      doneCards: clamp(doneIds.size, 0, 20),
      studyMinutes: clamp(
        sessions.reduce((sum, session) => sum + sessionMinutes(session), 0),
        0,
        1440,
      ),
      ...(scores.length > 0
        ? {
            focusScore: clamp(
              scores.reduce((sum, score) => sum + score.score, 0) / scores.length,
              0,
              100,
            ),
          }
        : {}),
      ...(lifts.length > 0
        ? {
            phoneLifts: clamp(
              lifts.reduce((sum, score) => sum + score.count, 0),
              0,
              200,
            ),
          }
        : {}),
    }
  }

  const weekAgo = moveDateKey(dateKey, -7)
  const topics: string[] = []
  for (const result of [...loadQuizResults()].reverse()) {
    if (result.date < weekAgo || result.date >= dateKey) continue
    const hasWrong = result.questions.some(
      (question, index) => result.answers[index]?.choiceIndex !== question.answerIndex,
    )
    const topic = result.topic.trim().slice(0, 30)
    if (hasWrong && topic !== '' && !topics.includes(topic)) topics.push(topic)
  }
  if (topics.length > 0) request.wrongQuizTopics = topics.slice(0, 3)

  const exam = nearestExamFrom(dateKey)
  if (exam) request.exam = { name: exam.name.slice(0, 30), daysLeft: exam.dDay }

  const focus = loadStudyFocus()
  if (focus) request.focus = { kind: focus.kind, name: focus.name }
  return request
}

/** 서버 응답 → 하루치 AI 문장. 모양이 틀리면 null */
function toNudgeTexts(value: unknown): NudgeTexts | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  return {
    morning: toNudgeText(record.morning),
    evening: toNudgeText(record.evening),
    comfort: record.comfort === true,
  }
}

/**
 * 그날의 AI 알림 문장 (진짜 로그인 · 앱 안에서만 부릅니다. hooks/useAppBridge.ts)
 *   - 오늘 이미 받아 둔 것이 있으면 서버를 부르지 않고 그것을 씁니다. (하루 한 번)
 *   - 서버가 아직 준비 안 됨(404) · AI 꺼짐(503) · 한도(429) · 연결 실패면 null — 정해 둔 문장을 씁니다.
 *     실패도 null 로 끝내서, 10초마다 다시 부르지 않습니다. (다음에 앱을 켤 때 다시 받음)
 * 화면에 보이는 데이터가 아니라 알림 예약에 쓰는 것이라, 화면의 useSuspenseQuery 대신 queryClient.fetchQuery 로 부릅니다.
 */
export function coachNudgeTextsQuery(dateKey: string, todayKey: string) {
  return queryOptions({
    queryKey: ['coach-nudge-texts', dateKey, todayKey],
    queryFn: async (): Promise<NudgeTexts | null> => {
      const saved = loadSavedTexts()[dateKey]
      if (saved && saved.fetchedOn === todayKey) return saved
      try {
        const result = await api<unknown>('/ai/nudges', {
          method: 'POST',
          body: JSON.stringify(buildNudgeRequest(dateKey, todayKey)),
        })
        const texts = toNudgeTexts(result)
        if (texts) saveNudgeTexts(dateKey, texts, todayKey)
        return texts
      } catch {
        // 404 · 503 · 429 · 연결 실패 모두 정해 둔 문장으로 갑니다. (알림은 꼭 가야 해서 에러를 화면에 띄우지 않음)
        return null
      }
    },
    staleTime: Infinity,
    retry: false,
  })
}
