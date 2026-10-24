/**
 * AI 코치 화면을 열면 보여 주는 첫 말(아침 브리핑)과 빠른 답 칩을 만드는 순수 함수입니다. (2026-10-18)
 * AI 를 부르지 않고 코드가 만듭니다. 그래서 화면을 열기만 해서는 AI 사용량을 쓰지 않습니다.
 * (학생이 칩을 누르거나 말을 보낼 때 처음으로 서버 채팅을 엽니다. pages/CoachPage.tsx)
 *
 * 재료: 지금 시각 · 오늘 학교 정보(시간표 · 급식 · 시험) · 오늘 카드 · 오늘 체크인(컨디션 · 감정 태그)
 *
 *   buildMorningBriefing({ hour: 8, school, grade: 2, cards, checkIn })
 *   -> { text: '좋은 아침! 오늘은 미적분Ⅰ · 문학 · 영어Ⅰ 수업이 있는 날이야. …', chips: [...] }
 */
import {
  DAILY_GOAL_MINUTES,
  countDoneMissions,
  nextMission,
  type Mission,
  type MissionSlot,
} from '@/lib/dailyMission'
import type { ChatReply } from '@/lib/chatApi'
import type { NotifyChange } from '@/lib/chatNotifySettings'
import { sessionMinutes } from '@/lib/dailyRecords'
import type { FocusScoreRecord } from '@/lib/focusScore'
import { dayLabelOf, type SchoolToday } from '@/lib/schoolToday'
import { loadData } from '@/lib/storage'
import {
  STUDY_FOCUS_OPTIONS,
  describeFocus,
  type StudyFocus,
  type StudyFocusKind,
} from '@/lib/studyFocus'
import type { TodayCardsState } from '@/lib/todayCards'
import type { Card, CheckIn, EmotionTag, StudySession } from '@/types'

/**
 * 말풍선 아래의 빠른 답 칩 하나.
 *   say          — 누르면 그 말을 내 말풍선으로 보냅니다
 *   startCard    — 그 카드로 타이머를 엽니다 (/timer?card=…)
 *   startMinutes — 그 길이의 즉석 카드를 만들어 바로 시작합니다
 *   newCard      — 카드 만들기 화면으로 갑니다
 *   checkIn      — 오늘 컨디션으로 저장하고(그날의 체크인), 그 말을 내 말풍선으로 보냅니다 (2026-10-18)
 *   startTitled  — 그 제목 · 길이의 카드를 만들어 바로 시작합니다 (예: '미적분Ⅰ 복습' 10분)
 *   focus        — "내가 준비하는 것" 으로 저장하고(내신 · 수능 · 대회 · 기타), 그 말을 내 말풍선으로 보냅니다
 *   pickDate     — 대화 아래에 작은 날짜 고르기 칸을 엽니다 (대회 날짜 → 내 일정, lib/myEvents.ts)
 *   dayPlan      — 코치가 오늘 계획을 짜서 계획 말풍선으로 보여 줍니다 (light 면 가볍게, tomorrow 면 내일 계획, lib/coachPlan.ts)
 *   longPlan     — 시험 · 대회 날까지의 긴 계획을 짜는 칸(목표 · 날짜 · 하루 시간 · 사진)을 엽니다
 *   quiz         — 확인 문제를 냅니다. topic 이 있으면 바로, 없으면 주제를 고르는 칸을 엽니다 (lib/studyQuiz.ts)
 *   quizReview   — 어제(또는 daysAgo 일 전) 틀린 문제를 다시 냅니다 (서버를 부르지 않음)
 *   makePlan     — AI 가 알아들은 목표 · 날짜로 긴 계획을 바로 짭니다. 날짜가 없으면 긴 계획 칸을 엽니다 (BE #327)
 *   checkCall    — 공부 끝 확인 통화를 겁니다 (/call — 오늘 공부를 끝내야 열림, lib/checkCall.ts)
 * 행동 칩(say · checkIn 이 아닌 것)은 누를 때만 실행합니다. 자동으로 하지 않습니다.
 */
export type CoachChip =
  | { kind: 'say'; label: string }
  | { kind: 'startCard'; label: string; cardId: string }
  | { kind: 'startMinutes'; label: string; minutes: number }
  | { kind: 'newCard'; label: string }
  | { kind: 'checkIn'; label: string; condition: number; emotions: EmotionTag[] }
  | { kind: 'startTitled'; label: string; title: string; minutes: number }
  /** 시험 범위 사진으로 카드 만들기 화면(/cards/photo)을 엽니다. 시험이 가까울 때만 나옵니다. */
  | { kind: 'photoCards'; label: string }
  /** "내가 준비하는 것" 을 저장합니다. (2026-10-18 lib/studyFocus.ts) */
  | { kind: 'focus'; label: string; focus: StudyFocusKind }
  /** 날짜 고르기 칸을 엽니다. 고른 날짜는 내 일정이 됩니다. (lib/myEvents.ts) */
  | { kind: 'pickDate'; label: string }
  /**
   * 코치가 오늘 계획을 짜 줍니다. light 면 컨디션이 안 좋은 날처럼 가볍게 (2026-10-18 계획 핑퐁)
   * tomorrow 면 내일 계획 (밤 정리 알림의 [📅 내일 계획 짜 줘], lib/coachNudges.ts)
   */
  | { kind: 'dayPlan'; label: string; light?: boolean; tomorrow?: boolean }
  /** 시험 · 대회 날까지의 긴 계획(최대 30일)을 짜는 칸을 엽니다. */
  | { kind: 'longPlan'; label: string }
  /** 확인 문제 (2026-10-18 "제대로 공부했나 문제를 내 보기도"). 카드로 내면 그 카드의 제목 · 체크리스트 */
  | { kind: 'quiz'; label: string; topic?: string; cardId?: string; checklist?: string[] }
  /** 틀린 문제 다시 풀기. daysAgo 가 없으면 어제 것, 있으면 그 날들(복습 알림: 1 · 3 · 7일 전) */
  | { kind: 'quizReview'; label: string; daysAgo?: number[] }
  /** AI 가 채팅에서 알아들은 목표 · 날짜로 긴 계획 짜기 (endDate 가 없으면 칸을 엶) */
  | { kind: 'makePlan'; label: string; goal: string; endDate: string | null }
  /** 공부 끝 확인 통화 걸기 (2026-10-18 "공부를 하게 하고 완료한 조건으로 통화") */
  | { kind: 'checkCall'; label: string }
  /** 📎 사진 고르기 창을 엽니다. 과목 쌤 방에서 문제 사진을 보낼 때 (2026-10-18 대화방 3개, #582) */
  | { kind: 'pickPhoto'; label: string }
  /** 방금 공부의 후기를 코치와 말로 나눕니다. AI 가 이유를 짐작하면 "맞아?" 로 확인받아 기록에 남김 (#582) */
  | { kind: 'reviewTalk'; label: string; sessionId: string }
  /** 채팅으로 부탁한 알림 설정 변경안에 답합니다. change 가 null 이면 [그대로 둘게] (#594, lib/chatNotifySettings.ts) */
  | { kind: 'notifySettings'; label: string; change: NotifyChange | null }

/**
 * 계획 칩. 코치가 먼저 계획을 짜 주고, 학생이 고칠 곳을 말하며 핑퐁합니다. (lib/coachPlan.ts)
 * (2026-10-18 사용자: "플래너 한번 짜 주고 핑퐁하고 수정하는 게 맞지, 일방적으로 10분 주는 건 아닌 듯")
 */
export const PLAN_CHIP: CoachChip = { kind: 'dayPlan', label: '▷ 오늘 계획 짜 줘' }
export const LIGHT_PLAN_CHIP: CoachChip = {
  kind: 'dayPlan',
  label: '▷ 오늘 계획 가볍게 고치기',
  light: true,
}
export const LONG_PLAN_CHIP: CoachChip = { kind: 'longPlan', label: '📅 시험·대회 계획 짜기' }
/** 확인 문제 칩. 누르면 주제를 고르는 칸(오늘 카드 · 직접 적기 · 사진)이 열립니다. */
export const QUIZ_CHIP: CoachChip = { kind: 'quiz', label: '📝 문제 내 줘' }
/** 어제 틀린 문제를 다시 푸는 칩 */
export const QUIZ_REVIEW_CHIP: CoachChip = { kind: 'quizReview', label: '📝 틀린 문제 다시' }

/**
 * 공부를 끝낸 카드로 확인 문제를 내는 칩. 카드의 제목 · 체크리스트로 3문제를 냅니다.
 *   quizChipForCard({ id: 'c1', title: '미적분 3단원', checklist: [{ text: '예제 10문제' }] })
 *   -> { kind: 'quiz', label: '📝 방금 공부한 거 3문제', topic: '미적분 3단원', cardId: 'c1', checklist: ['예제 10문제'] }
 */
export function quizChipForCard(card: Pick<Card, 'id' | 'title' | 'checklist'>): CoachChip {
  return {
    kind: 'quiz',
    label: '📝 방금 공부한 거 3문제',
    topic: card.title,
    cardId: card.id,
    checklist: card.checklist.map((item) => item.text).filter((text) => text.trim() !== ''),
  }
}

/**
 * 시험이 이만큼(일) 안으로 다가오면 "📅 시험·대회 계획 짜기" 칩을 보여 줍니다.
 * (예전 "📸 시험 범위 찍기" 칩 대신 — 긴 계획 칸에서 시험 범위 · 교과서 사진도 넣을 수 있습니다)
 */
const LONG_PLAN_CHIP_EXAM_DAYS = 30

/**
 * 오늘 컨디션을 묻는 칩 3개. 누르면 그날의 체크인이 됩니다. (예전의 "하루 첫 한 줄" 대신)
 * 컨디션은 1 ~ 5 중 4 · 3 · 2 로, '피곤해' 는 감정 태그 '피곤함' 도 같이 남깁니다.
 */
export const CONDITION_CHIPS: CoachChip[] = [
  { kind: 'checkIn', label: '😄 좋아', condition: 4, emotions: [] },
  { kind: 'checkIn', label: '😐 그냥 그래', condition: 3, emotions: [] },
  { kind: 'checkIn', label: '😩 피곤해', condition: 2, emotions: ['TIRED'] },
]

/** 코치가 하는 말 하나와 그 아래 칩들 */
export interface CoachMessage {
  text: string
  chips: CoachChip[]
}

export interface BriefingInput {
  /** 지금 시각의 시 (0 ~ 23) */
  hour: number
  /** 오늘 학교 정보. 못 받았거나 학교를 안 골랐으면 null */
  school: SchoolToday | null
  /** 내 학년 (1 ~ 3). 모르면 null — 학년 구분 없이 시험을 고릅니다 */
  grade: number | null
  cards: TodayCardsState
  /** 오늘 체크인. 아직 안 했으면 undefined */
  checkIn: CheckIn | undefined
  /** 어제 확인 문제에서 틀린 문제 수 (lib/studyQuiz.ts). 없으면 0 */
  yesterdayWrongCount?: number
}

/** 피곤해서 목표를 줄여 잡을 때의 길이 (분) */
export const SMALL_START_MINUTES = 10

/** 칩 글자가 너무 길면 줄입니다. (칩은 한 줄로 보여야 해서) */
function shorten(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

/**
 * 시각에 맞는 첫인사. 낮에 "수업" 이야기는 오늘이 학교 가는 날일 때만 합니다.
 * (주말 · 방학에는 서버가 다음 학교 가는 날의 시간표를 줘서 schoolDay 가 오늘과 다릅니다. 학교를 모르면 수업 이야기는 안 함)
 */
function greetingOf(hour: number, school: SchoolToday | null): string {
  const isSchoolDayToday = school !== null && school.schoolDay === school.date
  if (hour < 11) return '좋은 아침!'
  if (hour < 17) return isSchoolDayToday ? '오늘 수업 잘 듣고 있어?' : '오늘 하루 잘 보내고 있어?'
  if (hour < 22) return '오늘 하루 수고했어!'
  return '늦었네, 오늘은 마무리만 해 보자.'
}

/** 시간표에서 과목 이름을 겹치지 않게 3개까지 */
function subjectsOf(school: SchoolToday | null): string[] {
  const subjects: string[] = []
  for (const period of school?.timetable ?? []) {
    if (!subjects.includes(period.subject)) subjects.push(period.subject)
  }
  return subjects.slice(0, 3)
}

/** 오늘 점심(없으면 오늘 첫 끼) 메뉴 두 개. 첫 메뉴가 밥이면 그다음부터 고릅니다. */
function lunchOf(school: SchoolToday | null): string | null {
  const todayMeals = (school?.meals ?? []).filter((meal) => meal.date === school?.date)
  const meal = todayMeals.find((item) => item.kind === '중식') ?? todayMeals[0]
  if (!meal) return null
  const dishes = meal.dishes.filter((dish) => !dish.endsWith('밥'))
  return (dishes.length > 0 ? dishes : meal.dishes).slice(0, 2).join(', ')
}

/** 30일 안에서 가장 가까운 내 학년 시험. 없으면 null */
function nearestExamOf(
  school: SchoolToday | null,
  grade: number | null,
): { name: string; dDay: number } | null {
  const exams = (school?.events ?? []).filter(
    (event) =>
      event.exam &&
      event.dDay >= 0 &&
      (grade === null || event.grades.length === 0 || event.grades.includes(grade)),
  )
  if (exams.length === 0) return null
  const nearest = exams.reduce((best, event) => (event.dDay < best.dDay ? event : best))
  return { name: nearest.name, dDay: nearest.dDay }
}

/** 오늘 피곤하다고 했는지 (감정 태그 '피곤함' 이거나 컨디션 1 · 2) */
export function isTiredToday(checkIn: CheckIn | undefined): boolean {
  if (!checkIn) return false
  return (checkIn.emotions ?? []).includes('TIRED') || checkIn.condition <= 2
}

/** 코치 화면을 열면 보여 줄 첫 말과 칩을 만듭니다. */
export function buildMorningBriefing(input: BriefingInput): CoachMessage {
  const lines: string[] = [greetingOf(input.hour, input.school)]

  const subjects = subjectsOf(input.school)
  // 주말에는 서버가 다음 월요일 시간표를 줘서 "월요일엔 … 수업이 있어" 로 말합니다. (schoolDay, 2026-10-22)
  const school = input.school
  if (subjects.length > 0 && school && school.schoolDay !== school.date) {
    lines.push(
      `${dayLabelOf(school.schoolDay, school.date)}엔 ${subjects.join(' · ')} 수업이 있어.`,
    )
  } else if (subjects.length > 0) {
    lines.push(`오늘은 ${subjects.join(' · ')} 수업이 있는 날이야.`)
  }
  const lunch = lunchOf(input.school)
  if (lunch) lines.push(`점심은 ${lunch} 🍚`)
  const exam = nearestExamOf(input.school, input.grade)
  if (exam) {
    lines.push(
      exam.dDay === 0 ? `오늘이 ${exam.name}이야. 힘내!` : `${exam.name}까지 D-${exam.dDay}.`,
    )
  }

  // 어제 확인 문제에서 틀린 게 있으면 다시 풀자고 합니다. (칩은 아래에서 맨 뒤에 붙임)
  const wrongCount = input.yesterdayWrongCount ?? 0
  if (wrongCount > 0) lines.push(`어제 틀린 문제가 ${wrongCount}개 있어. 한 번 더 풀어 볼까?`)
  const reviewChips = wrongCount > 0 ? [QUIZ_REVIEW_CHIP] : []

  const card = input.cards.current ?? input.cards.next
  // 오늘 컨디션을 아직 모르면 그것부터 묻습니다. 칩을 누르면 그날의 체크인이 되고, 그다음은 AI 와 이야기합니다.
  if (input.checkIn === undefined) {
    lines.push('먼저, 오늘 컨디션은 어때? 하나만 골라 줘.')
    return { text: lines.join('\n'), chips: [...CONDITION_CHIPS, ...reviewChips] }
  }
  const isTired = isTiredToday(input.checkIn)
  if (isTired) {
    lines.push('피곤하다고 했지? 오늘 계획은 가볍게 짜 줄게. 보고 고칠 곳을 말해 줘.')
  } else if (card) {
    const time = card.startTime ?? '시간 미정'
    lines.push(
      `${input.cards.current ? '지금' : '다음에'} 할 카드는 '${card.title}'(${time} · ${card.durationMinutes}분)이야. 시작해 볼까?`,
    )
  } else {
    lines.push('오늘 카드는 아직 없어. 내가 먼저 오늘 계획을 짜 볼까?')
  }

  const restChip: CoachChip = { kind: 'say', label: '오늘은 쉴래' }
  let chips: CoachChip[]
  if (isTired) {
    chips = [
      { kind: 'dayPlan', label: '▷ 가볍게 계획 짜 줘', light: true },
      { kind: 'say', label: '그래도 다 할래' },
      restChip,
    ]
  } else if (card) {
    chips = [
      { kind: 'startCard', label: `▷ ${shorten(card.title, 10)} 시작`, cardId: card.id },
      { kind: 'dayPlan', label: '오늘 계획 고칠래' },
      restChip,
    ]
  } else {
    chips = [PLAN_CHIP, LONG_PLAN_CHIP, restChip]
  }

  // 시험이 30일 안이면 시험 날까지의 긴 계획 칩을 더합니다. (범위표 · 교과서 사진도 넣을 수 있음)
  const hasLongChip = chips.some((chip) => chip.kind === 'longPlan')
  if (exam && exam.dDay >= 1 && exam.dDay <= LONG_PLAN_CHIP_EXAM_DAYS && !hasLongChip) {
    chips = [...chips, { kind: 'longPlan', label: `📅 ${shorten(exam.name, 8)} 계획 짜기` }]
  }
  return { text: lines.join('\n'), chips: [...chips, ...reviewChips] }
}

/**
 * 학생이 쓴 말에 "피곤 · 시간 없 · 하기 싫" 같은 핑계가 있으면 오늘 계획을 가볍게 고치자는 칩을 붙입니다. (핑계 협상)
 * 예전에는 "10분으로 줄여서 시작" 을 코드가 정해 줬는데, 지금은 코치가 가볍게 다시 짠 계획을 보고 같이 고칩니다.
 * AI 의 답(서버든 시연용이든) 아래에 코드가 붙입니다. 누를 때만 실행됩니다.
 *
 *   negotiationChipsFor('오늘 너무 피곤해') -> [▷ 오늘 계획 가볍게 고치기, 그래도 다 할래]
 *   negotiationChipsFor('좋아')            -> []
 */
export function negotiationChipsFor(studentText: string): CoachChip[] {
  const isExcuse = EXCUSE_WORDS.some((word) => studentText.includes(word))
  if (!isExcuse) return []
  return [LIGHT_PLAN_CHIP, { kind: 'say', label: '그래도 다 할래' }]
}

/** 계획 이야기인지 볼 낱말 */
const PLAN_TALK_WORDS = ['계획', '플래너', '스케줄', '뭐 하지', '뭐하지', '뭐부터']
/** 시험 · 대회 이야기인지 볼 낱말 */
const EXAM_TALK_WORDS = ['시험', '중간', '기말', '모의', '대회', '자격증', '수능']
/** 확인 문제 이야기인지 볼 낱말 ("다 했어" · "배웠어" 처럼 공부를 끝낸 말도 문제로 확인하자고 권합니다) */
const QUIZ_TALK_WORDS = ['문제 내', '문제 좀', '퀴즈', '확인해', '배웠어', '공부했어', '외웠어']

/**
 * AI 가 칩을 안 줬을 때 코드가 붙이는 칩. 핑계면 가볍게 고치기, 계획 이야기면 계획 칩, 시험 이야기면 긴 계획 칩입니다.
 *
 *   codeChipsFor('오늘 뭐부터 하지') -> [▷ 오늘 계획 짜 줘, 📅 시험·대회 계획 짜기]
 *   codeChipsFor('다음 주 중간고사야') -> [📅 시험·대회 계획 짜기]
 *   codeChipsFor('오늘 수열 배웠어')   -> [📝 문제 내 줘]
 */
export function codeChipsFor(studentText: string): CoachChip[] {
  const negotiation = negotiationChipsFor(studentText)
  if (negotiation.length > 0) return negotiation
  // "중간고사 문제 내 줘" 처럼 문제를 부탁하면 시험 이야기보다 문제가 먼저입니다.
  if (QUIZ_TALK_WORDS.some((word) => studentText.includes(word))) return [QUIZ_CHIP]
  if (PLAN_TALK_WORDS.some((word) => studentText.includes(word))) return [PLAN_CHIP, LONG_PLAN_CHIP]
  if (EXAM_TALK_WORDS.some((word) => studentText.includes(word))) return [LONG_PLAN_CHIP]
  return []
}

/** 목표를 줄여 주자고 할 핑계 말들 */
export const EXCUSE_WORDS = [
  '피곤',
  '졸려',
  '힘들',
  '시간 없',
  '시간이 없',
  '바빠',
  '하기 싫',
  '귀찮',
  '쉴래',
  '10분만',
]

/** 공부 중에 폰을 든 기록 (앱이 세션마다 저장. 키 'study-phone-lifts', 세션 번호별) */
export interface PhoneLiftRecord {
  /** 폰을 들고 있던 시간 합계 (밀리초) */
  liftedMs: number
  /** 잠깐 확인(5~30초) 횟수 */
  checks: number
  /** 30초 넘게 든 횟수 */
  longLifts: number
  /** 들고 앱 밖으로 나간 횟수 */
  outsideLifts: number
  /** 앱 밖에 있던 시간 합계 (밀리초) */
  outsideMs: number
}

function isPhoneLiftRecord(value: unknown): value is PhoneLiftRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return ['liftedMs', 'checks', 'longLifts', 'outsideLifts', 'outsideMs'].every(
    (key) => typeof record[key] === 'number' && (record[key] as number) >= 0,
  )
}

/** 그 세션의 폰 기록. 앱이 아니거나(웹) 기록이 없으면 null 입니다. */
export function loadPhoneLift(sessionId: string): PhoneLiftRecord | null {
  const saved = loadData<unknown>('phone-lifts', {})
  if (typeof saved !== 'object' || saved === null) return null
  const record = (saved as Record<string, unknown>)[sessionId]
  return isPhoneLiftRecord(record) ? record : null
}

/** 공부가 끝난 지 이만큼 안이면 코치가 먼저 결과를 물어봅니다. (3시간) */
export const RECAP_WITHIN_MS = 3 * 60 * 60 * 1000

/**
 * 코치가 먼저 결과를 물어볼 공부 기록. 3시간 안에 끝났고, 아직 물어보지 않은 가장 최근 것 하나입니다. 없으면 null
 *
 *   findRecapSession(기록들, 지금, '지난번에 물어본 기록 번호')
 */
export function findRecapSession(
  sessions: StudySession[],
  now: number,
  lastRecappedId: string | null,
): StudySession | null {
  const recent = sessions
    .filter((session) => session.endedAt <= now && now - session.endedAt <= RECAP_WITHIN_MS)
    .sort((a, b) => b.endedAt - a.endedAt)[0]
  if (!recent || recent.id === lastRecappedId) return null
  return recent
}

/** 밀리초 → '1분 40초' · '40초' */
function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}초`
  return seconds === 0 ? `${minutes}분` : `${minutes}분 ${seconds}초`
}

/**
 * 타이머가 끝나고 코치 탭에 오면 코치가 먼저 거는 말. 숫자는 기록으로 계산한 것만 씁니다.
 * 집중도(lib/focusScore.ts)가 있으면 맨 앞에 붙입니다.
 *
 *   buildSessionRecap(25분 기록, { checks: 1, longLifts: 1, outsideMs: 100000, … }, { score: 92, … })
 *   -> '25분 했네! 집중도 92%, 폰은 2번 들었어, 그중 앱 밖에 1분 40초 있었어. 어땠어?'
 *   웹(폰 기록 없음) -> '25분 했네! 집중도 88%, 다른 탭·앱에 3분 있었어. 어땠어?'
 */
export function buildSessionRecap(
  session: StudySession,
  phone: PhoneLiftRecord | null,
  focus: FocusScoreRecord | null = null,
): CoachMessage {
  const minutes = sessionMinutes(session)
  let text = `${minutes}분 했네!`
  // 폰을 한 번도 안 엎었으면 "폰은 한 번도 안 들었어" 가 사실이 아니라서 폰 이야기는 하지 않습니다.
  const showPhone = phone !== null && focus?.measuredBy !== 'outside'
  if (focus) {
    text += ` 집중도 ${focus.score}%`
    if (focus.measuredBy === 'hidden') {
      // 웹: 다른 탭 · 앱에 있던 시간
      text +=
        focus.count === 0
          ? ', 다른 탭·앱으로 한 번도 안 갔어.'
          : `, 다른 탭·앱에 ${formatDuration(focus.distractedMs)} 있었어.`
    } else if (focus.measuredBy === 'outside') {
      text +=
        focus.distractedMs === 0
          ? ', 폰을 안 엎어서 앱 밖 시간으로 셌는데 밖으로는 안 나갔어.'
          : `, 폰을 안 엎어서 앱 밖에 있던 시간(${formatDuration(focus.distractedMs)})으로 셌어.`
    } else {
      // 앱: 뒤에 폰 이야기가 이어집니다.
      text += showPhone ? ',' : '.'
    }
  }
  if (phone && showPhone) {
    const lifts = phone.checks + phone.longLifts
    if (lifts === 0) {
      text += ' 폰은 한 번도 안 들었어. 대단한데?'
    } else {
      text += ` 폰은 ${lifts}번 들었어`
      text +=
        phone.outsideMs > 0
          ? `, 그중 앱 밖에 ${formatDuration(phone.outsideMs)} 있었어.`
          : '. 앱 밖으로는 안 나갔고.'
    }
  }
  text += ' 어땠어?'
  return {
    text,
    chips: [
      { kind: 'say', label: '다 했어' },
      { kind: 'say', label: '일부만 했어' },
      { kind: 'say', label: '못 했어' },
    ],
  }
}

// ---- 오늘의 미션 (lib/dailyMission.ts) ----

/** 미션 알림을 누르고 들어왔을 때 코치의 첫 줄 */
const MISSION_SLOT_GREETINGS: Record<MissionSlot, string> = {
  morning: '☀️ 오늘의 미션이야!',
  afterSchool: '🎒 하교했지? 미션 확인하자.',
  evening: '🌙 오늘 마무리 전에 미션 보자.',
}

/**
 * 미션 하나를 하자고 권하는 코치의 말과 칩. 칩을 누르면 그 미션을 바로 할 수 있습니다.
 *
 *   buildMissionPrompt({ kind: 'plan', … }, undefined)
 *   -> { text: '오늘 할 공부를 같이 정해 보자. …', chips: [▷ 오늘 계획 정하기, 이따 할게] }
 */
export function buildMissionPrompt(mission: Mission, nowCard: Card | undefined): CoachMessage {
  const laterChip: CoachChip = { kind: 'say', label: '이따 할게' }
  if (mission.kind === 'checkIn') {
    return { text: '오늘 컨디션은 어때? 하나만 골라 줘.', chips: CONDITION_CHIPS }
  }
  if (mission.kind === 'plan') {
    return {
      text: '오늘 할 공부를 같이 정해 보자. 내가 먼저 짜 볼 테니 고칠 곳을 말해 줘. 저장하면 시간 맞춰 알려 줄게.',
      chips: [PLAN_CHIP, laterChip],
    }
  }
  const startChip: CoachChip = nowCard
    ? { kind: 'startCard', label: `▷ ${shorten(nowCard.title, 10)} 시작`, cardId: nowCard.id }
    : {
        kind: 'startMinutes',
        label: `▷ ${DAILY_GOAL_MINUTES}분 시작`,
        minutes: DAILY_GOAL_MINUTES,
      }
  return {
    text: '폰을 화면이 바닥을 보게 엎어 두고 시작해 보자. 폰을 들면 내가 알려 줄게 📱',
    chips: [startChip, laterChip],
  }
}

/** '① ✅ 컨디션 알려 주기' 처럼 미션 목록을 줄로 만듭니다. */
function missionListText(missions: Mission[]): string {
  const numbers = ['①', '②', '③']
  return missions
    .map(
      (mission, index) => `${numbers[index] ?? '·'} ${mission.done ? '✅' : '⬜'} ${mission.title}`,
    )
    .join('\n')
}

/**
 * 오늘의 미션 전체를 보여 주고 다음 미션을 권하는 말. 미션 알림을 누르고 들어왔거나(slot) 미션 줄을 눌렀을 때 씁니다.
 * 다 끝냈으면 칭찬하고 칩은 [고마워!] 하나입니다.
 */
export function buildMissionBriefing(
  missions: Mission[],
  slot: MissionSlot | null,
  nowCard: Card | undefined,
): CoachMessage {
  const head = slot ? MISSION_SLOT_GREETINGS[slot] : '오늘의 미션이야.'
  const list = missionListText(missions)
  const next = nextMission(missions)
  if (!next) {
    return {
      text: `${head}\n${list}\n오늘 미션 다 끝냈어. 대단해 👏`,
      chips: [{ kind: 'say', label: '고마워!' }],
    }
  }
  const prompt = buildMissionPrompt(next, nowCard)
  return { text: `${head}\n${list}\n${prompt.text}`, chips: prompt.chips }
}

/**
 * 미션을 끝내고 코치 화면에 돌아왔을 때 코치가 먼저 거는 한 줄. (몇 개 끝냈는지 + 다음 미션)
 *
 *   -> '✅ 오늘의 미션 2/3 끝! 남은 건 '첫 카드 폰 엎어 두고 시작'. …'
 */
export function buildMissionProgress(missions: Mission[], nowCard: Card | undefined): CoachMessage {
  const done = countDoneMissions(missions)
  const next = nextMission(missions)
  if (!next) {
    return {
      text: `✅ 오늘의 미션 ${done}/${missions.length} 다 끝냈어! 오늘 정말 잘했어 👏`,
      chips: [{ kind: 'say', label: '고마워!' }],
    }
  }
  const prompt = buildMissionPrompt(next, nowCard)
  return {
    text: `✅ 오늘의 미션 ${done}/${missions.length} 끝! 남은 건 '${next.title}'.\n${prompt.text}`,
    chips: prompt.chips,
  }
}

// ---- 서버 AI 가 준 빠른 답 · 행동 (lib/chatApi.ts 의 quickReplies · action) ----

/**
 * AI 가 고른 빠른 답과 행동을 칩으로 바꿉니다. 둘 다 없으면 빈 목록 — 그때는 화면이 코드 칩(핑계 협상)을 씁니다.
 * 행동 칩이 먼저, 빠른 답이 그 뒤입니다. 행동은 누를 때만 실행합니다.
 *
 *   chipsFromServer({ quickReplies: ['응 할게'], action: { type: 'shrink_today', minutes: 10, title: null, date: null } }, undefined)
 *   -> [▷ 오늘 계획 가볍게 고치기, 응 할게]
 *   action: { type: 'make_plan', title: '중간고사 미적분', date: '2026-11-02' }  -> [📅 계획 짜기]
 *   action: { type: 'start_quiz', title: '수열의 극한' }                         -> [📝 문제 풀기]
 */
export function chipsFromServer(
  reply: Pick<ChatReply, 'quickReplies' | 'action'>,
  nowCard: Card | undefined,
): CoachChip[] {
  const chips: CoachChip[] = []
  const action = reply.action
  if (action?.type === 'shrink_today') {
    // "오늘 목표를 줄이자" 는 코드가 분을 정해 주지 않고, 코치가 가볍게 다시 짠 계획을 같이 고칩니다. (계획 핑퐁)
    chips.push(LIGHT_PLAN_CHIP)
  } else if (action?.type === 'start_timer') {
    chips.push(
      nowCard && action.minutes === null
        ? { kind: 'startCard', label: `▷ ${shorten(nowCard.title, 10)} 시작`, cardId: nowCard.id }
        : {
            kind: 'startMinutes',
            label: `▷ ${action.minutes ?? DAILY_GOAL_MINUTES}분 시작`,
            minutes: action.minutes ?? DAILY_GOAL_MINUTES,
          },
    )
  } else if (action?.type === 'create_card' && action.title) {
    const minutes = action.minutes ?? DAILY_GOAL_MINUTES
    chips.push({
      kind: 'startTitled',
      label: `▷ ${shorten(action.title, 8)} ${minutes}분 시작`,
      title: action.title,
      minutes,
    })
  } else if (action?.type === 'make_plan' && action.title) {
    // "11월 2일 중간고사 준비해" 처럼 말하면 AI 가 목표 · 날짜를 알아듣고 계획 짜기 칩을 줍니다. (BE #327)
    chips.push({
      kind: 'makePlan',
      label: '📅 계획 짜기',
      goal: action.title,
      endDate: action.date,
    })
  } else if (action?.type === 'start_quiz' && action.title) {
    // "방금 수열 공부했어" 처럼 말하면 그 주제로 확인 문제를 풀자고 합니다. (BE #327)
    chips.push({ kind: 'quiz', label: '📝 문제 풀기', topic: action.title })
  }
  for (const text of reply.quickReplies) {
    chips.push({ kind: 'say', label: text })
  }
  return chips
}

// ---- 내가 준비하는 것 (lib/studyFocus.ts) ----

/** "요즘 뭐 준비하고 있어?" 칩 4개. 누르면 저장하고 그 말을 보냅니다. */
export const FOCUS_CHIPS: CoachChip[] = STUDY_FOCUS_OPTIONS.map((option) => ({
  kind: 'focus',
  label: `${option.emoji} ${option.label}`,
  focus: option.kind,
}))

/** 대회 · 기타를 고른 뒤 이름을 안 적고 넘어가는 칩 */
export const SKIP_FOCUS_NAME_LABEL = '이름은 나중에'

/**
 * 오늘 컨디션을 들은 뒤, 준비하는 것을 아직 모르면 코치가 한 번 묻는 말. (코드가 만들어서 AI 를 부르지 않음)
 */
export function buildFocusQuestion(): CoachMessage {
  return {
    text: '알려 줘서 고마워! 하나만 더 — 요즘 뭐 준비하고 있어? 고르면 오늘 계획을 거기에 맞춰 짜 줄게.',
    chips: FOCUS_CHIPS,
  }
}

/** 대회 · 기타를 골랐을 때 이름을 묻는 말 */
export function buildFocusNameQuestion(kind: StudyFocusKind): CoachMessage {
  const example = kind === 'CONTEST' ? '정보올림피아드, 컴활 1급' : '코딩 공부, 토익'
  return {
    text: `좋아! 이름을 적어 주면 계획을 더 맞춰 줄게. (예: ${example})`,
    chips: [{ kind: 'say', label: SKIP_FOCUS_NAME_LABEL }],
  }
}

/** 대회 · 기타의 이름을 들은 뒤 날짜를 묻는 말. 고르면 홈의 "다가오는 일정" 에 D-day 로 뜹니다. */
export const SKIP_FOCUS_DATE_LABEL = '아직 몰라'

export function buildFocusDateQuestion(name: string): CoachMessage {
  return {
    text: `'${name}' 날짜도 알려 줄래? 홈 일정에 D-day 로 띄워 줄게. (예: 11월 2일)`,
    chips: [
      { kind: 'pickDate', label: '📅 날짜 고르기' },
      { kind: 'say', label: SKIP_FOCUS_DATE_LABEL },
    ],
  }
}

/**
 * 준비하는 것을 정한 뒤 코치의 한 줄 반응 (테스트 로그인 · 서버 없이). 날짜를 받았으면 D-day 도 말합니다.
 * 오늘 계획을 아직 안 정했으면 같이 정하자고 권합니다. (오늘의 미션 ②)
 *
 *   buildFocusReaction({ kind: 'SUNEUNG', name: null }, null, true)
 *   -> { text: '수능 준비 중이구나! 오늘 계획 짤 때 거기에 맞춰 볼게. 같이 정해 볼까?', chips: [▷ 오늘 계획 정하기, 이따 할게] }
 */
export function buildFocusReaction(
  focus: StudyFocus,
  dDay: number | null,
  needsPlan: boolean,
): CoachMessage {
  // 이름이 있으면 이름으로("정보올림피아드 준비 중이구나!"), 없으면 종류로("수능 준비 중이구나!") 말합니다.
  const head = `${focus.name ?? describeFocus(focus)} 준비 중이구나!`
  const dateLine =
    dDay === null ? '' : ` ${dDay === 0 ? '바로 오늘이네!' : `D-${dDay}, 홈 일정에 넣어 뒀어.`}`
  // 날짜를 알면 그날까지의 긴 계획도 바로 짤 수 있게 칩을 줍니다.
  const longChips: CoachChip[] = dDay !== null && dDay >= 1 ? [LONG_PLAN_CHIP] : []
  if (!needsPlan) {
    return { text: `${head}${dateLine} 계획 짤 때 거기에 맞춰 볼게.`, chips: longChips }
  }
  return {
    text: `${head}${dateLine} 오늘 계획 짤 때 거기에 맞춰 볼게. 같이 정해 볼까?`,
    chips: [PLAN_CHIP, ...longChips, { kind: 'say', label: '이따 할게' }],
  }
}
