import type { AnswerCheck } from '@/lib/answerChecksApi'
import { buildCalendarDay, groupSessionsByDayKey } from '@/lib/calendarDay'
import type { CardDayMarkInfo } from '@/lib/restDays'
import type { CardResult } from '@/lib/cardResult'
import { getCardsOnDate } from '@/lib/cards'
import { moveDateKey, toDayKey } from '@/lib/date'
import { getWeekday } from '@/lib/routines'
import { getSessionCardId } from '@/lib/sessionRecords'
import { getStudyMs } from '@/lib/studyTime'
import type { ServerQuizCount } from '@/lib/quizResultsApi'
import type { QuizResult } from '@/lib/studyQuiz'
import type { WeeklyPick } from '@/lib/weeklyPicks'
import type { Card, StudySession } from '@/types'

/**
 * 기록 탭(History)의 일간 · 주간 리포트 숫자를 만드는 함수들입니다. (2026-10-24 History 리포트 시안)
 * React 도 저장소도 쓰지 않습니다. 화면(pages/RecordsPage.tsx)이 저장된 값을 모아 넘기면 숫자로 바꿔 줍니다.
 *
 * ■ 쓰는 기록
 *   공부 시간       : 타이머 세션 (노는 기록 빼고, 날짜는 새벽 4시 기준)
 *   계획 시간       : 그날 하는 카드의 길이 합
 *   계획 완료       : 그날 카드를 하나도 빼먹지 않고 끝까지 한 날 (아래 isCompleteDay)
 *   확인 문제 정답률 : 채팅의 확인 문제(lib/studyQuiz.ts) + 서버에만 있는 확인 문제(lib/quizResultsApi.ts)
 *                      + 사진 채점(lib/answerChecksApi.ts, 애매는 뺌)
 *   이번 주에 고른 것: lib/weeklyPicks.ts
 *
 * ■ 숫자는 코드가 냅니다. "하루 한 줄" 같은 문장도 숫자를 끼워 넣는 정해 둔 문장입니다. (AI 를 부르지 않음)
 */

/** 리포트를 보여 주려면 기록한 날이 이만큼 있어야 합니다. 모자라면 카운트다운을 보여 줍니다. */
export const REPORT_MIN_DAYS = 14

/** "쉬어 간 주" 로 보는 기준: 다 지난 주에 공부한 날이 이만큼 이하 */
export const REST_WEEK_MAX_STUDY_DAYS = 2

/** "끝까지 했다" 로 보는 카드 결과. 중간에 끝냄 · 미룸 · 실패 · 미처리는 아닙니다. */
const COMPLETE_RESULTS: CardResult[] = ['done', 'late', 'selfReport']

const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토']

// ---------------------------------------------------------------------------
// 날짜 · 주
// ---------------------------------------------------------------------------

/**
 * 그 날짜가 든 주의 월요일. 리포트의 한 주는 월요일 ~ 일요일입니다.
 *
 *   getWeekStart('2026-10-17') -> '2026-10-12'  (토요일 → 그 주 월요일)
 *   getWeekStart('2026-10-18') -> '2026-10-12'  (일요일도 같은 주)
 *   getWeekStart('2026-10-19') -> '2026-10-19'  (월요일은 그대로)
 */
export function getWeekStart(dateKey: string): string {
  // getWeekday: 0 = 일요일 … 6 = 토요일. 월요일까지 며칠 거슬러 가야 하는지로 바꿉니다. (일요일은 6일)
  const daysFromMonday = (getWeekday(dateKey) + 6) % 7
  return moveDateKey(dateKey, -daysFromMonday)
}

/** 월요일부터 일요일까지 7일 ('2026-10-12' -> ['2026-10-12', …, '2026-10-18']) */
export function getWeekDateKeys(weekStart: string): string[] {
  return [0, 1, 2, 3, 4, 5, 6].map((days) => moveDateKey(weekStart, days))
}

/**
 * 주 이름. 그 주의 목요일이 든 달로 정하고, 목요일이 그 달의 몇 번째 주인지 셉니다.
 * (달이 바뀌는 주도 이름이 하나로 정해집니다)
 *
 *   formatWeekLabel('2026-10-12') -> '10월 3주'  (목요일 10/15)
 *   formatWeekLabel('2026-09-28') -> '10월 1주'  (목요일 10/1)
 */
export function formatWeekLabel(weekStart: string): string {
  const thursday = moveDateKey(weekStart, 3)
  const [, month, day] = thursday.split('-').map(Number)
  return `${month}월 ${Math.ceil(day / 7)}주`
}

/** '2026-10-17' -> '토' */
export function weekdayNameOf(dateKey: string): string {
  return WEEKDAY_NAMES[getWeekday(dateKey)]
}

/** '2026-10-17' -> 17 */
export function dayOfMonth(dateKey: string): number {
  return Number(dateKey.slice(8, 10))
}

/** 분 → '1시간 50분' · '40분' · '0분' */
export function formatDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}분`
  if (rest === 0) return `${hours}시간`
  return `${hours}시간 ${rest}분`
}

/** 분 → '8h 10m' (좁은 칸 세 개에 나란히 놓을 때) */
export function formatShortDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes))
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

// ---------------------------------------------------------------------------
// 하루
// ---------------------------------------------------------------------------

/** 리포트 계산에 넣는 것 (화면이 저장소에서 꺼내 넘깁니다) */
export interface HistoryInput {
  /** 공부 기록 (노는 기록은 빼고 넘깁니다) */
  sessions: StudySession[]
  cards: Card[]
  /** 옛 계획 id → 카드 id 표 (lib/sessionRecords.ts 의 buildCardIdByPlanId) */
  cardIdByPlanId: Record<string, string>
  /** 그 카드 · 날짜에 휴식 · 미루기 · 실패로 처리한 표시 (lib/restDays.ts 의 getCardDayMarkInfo) */
  getMark: (cardId: string, dateKey: string) => CardDayMarkInfo | undefined
  /** 쉬는 날로 처리한 날짜들 */
  restDates: string[]
  /** 체크인한 날짜들 (공부를 안 했어도 "기록한 날" 로 셉니다) */
  checkInDates: string[]
  /**
   * 공부 기록 하나의 과목 이름. 카드 타이머 기록은 과목 칸이 비어 있어서(lib/cardSession.ts)
   * 화면이 카드 · 목표 제목에서 과목 이름을 찾아 넘깁니다. 못 찾으면 '기타'
   */
  subjectOf: (session: StudySession) => string
  /** 지금 시각 (Date.now() 값) */
  now: number
  /** 오늘 ('YYYY-MM-DD', 새벽 4시 기준) */
  todayKey: string
}

/** 과목 하나의 시간 */
export interface SubjectMinutes {
  subject: string
  minutes: number
}

/** 하루치 리포트 숫자 */
export interface DayReport {
  dateKey: string
  /** 그날 공부한 시간 (분) */
  studyMinutes: number
  /** 과목별 시간 (많은 순) */
  bySubject: SubjectMinutes[]
  /** 그날 카드 길이의 합 (분). 쉬는 날이면 0 */
  plannedMinutes: number
  /** 판정이 끝난 카드 수 (쉰 카드는 뺌) */
  cardCount: number
  /** 그중 끝까지 한 카드 수 */
  doneCount: number
  /** 아직 시간이 안 된 카드 수 */
  pendingCount: number
  /** 쉬는 날로 처리한 날 */
  isRestDay: boolean
  /** 계획을 끝까지 해낸 날 */
  isComplete: boolean
}

/** 기록이 하나도 없는 날 (미래의 날 · 기록을 시작하기 전의 날) */
function emptyDay(dateKey: string): DayReport {
  return {
    dateKey,
    studyMinutes: 0,
    bySubject: [],
    plannedMinutes: 0,
    cardCount: 0,
    doneCount: 0,
    pendingCount: 0,
    isRestDay: false,
    isComplete: false,
  }
}

/**
 * 계획을 끝까지 해낸 날인지. 판정이 끝난 카드가 1장 이상이고, 아직 시간이 안 된 카드가 없고,
 * 쉰 카드를 뺀 모든 카드를 끝까지 했으면(제때 · 늦게 · 나중에 적음) true 입니다.
 *
 *   카드 3장 모두 제때            -> true
 *   카드 3장 중 1장 중간에 끝냄   -> false
 *   카드 2장 다 했는데 1장 남음   -> false  (아직 하루가 안 끝남)
 *   카드가 없음                   -> false
 */
function isCompleteDay(results: CardResult[], pendingCount: number): boolean {
  const counted = results.filter((result) => result !== 'rest')
  if (counted.length === 0 || pendingCount > 0) return false
  return counted.every((result) => COMPLETE_RESULTS.includes(result))
}

/** 기록을 처음 남긴 날 (공부 · 체크인 중 가장 이른 날). 기록이 없으면 null */
export function getFirstRecordDay(input: HistoryInput): string | null {
  const days = [
    ...input.sessions.map((session) => toDayKey(session.startedAt)),
    ...input.checkInDates,
  ].filter((dateKey) => dateKey <= input.todayKey)
  if (days.length === 0) return null
  return days.reduce((earliest, dateKey) => (dateKey < earliest ? dateKey : earliest))
}

/**
 * 기록을 처음 남긴 날부터 오늘까지, 날마다의 리포트 숫자를 만듭니다. (날짜 → 하루)
 * 한 번 만들어 두고 일간 · 주간 리포트가 같이 꺼내 씁니다.
 */
export function buildDayReports(input: HistoryInput): Map<string, DayReport> {
  const reports = new Map<string, DayReport>()
  const firstDay = getFirstRecordDay(input)
  if (firstDay === null) return reports

  const sessionsByDay = groupSessionsByDayKey(input.sessions)
  const restDates = new Set(input.restDates)

  for (let dateKey = firstDay; dateKey <= input.todayKey; dateKey = moveDateKey(dateKey, 1)) {
    const daySessions = sessionsByDay.get(dateKey) ?? []

    // 공부 시간: 세션마다 밀리초로 더한 뒤 마지막에 분으로 바꿉니다. (세션마다 반올림하면 합이 어긋남)
    let studyMs = 0
    const msBySubject = new Map<string, number>()
    for (const session of daySessions) {
      const ms = getStudyMs(session)
      studyMs += ms
      const subject = input.subjectOf(session)
      msBySubject.set(subject, (msBySubject.get(subject) ?? 0) + ms)
    }
    const bySubject = [...msBySubject.entries()]
      .map(([subject, ms]) => ({ subject, minutes: Math.round(ms / 60000) }))
      .filter((item) => item.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes)

    // 카드 판정은 통계 탭 달력과 같은 함수로 합니다. (lib/calendarDay.ts)
    const calendar = buildCalendarDay({
      dateKey,
      cards: input.cards,
      sessions: daySessions,
      cardIdByPlanId: input.cardIdByPlanId,
      now: input.now,
      getMark: (cardId, markDate) => {
        const info = input.getMark(cardId, markDate)
        return info ? { mark: info.mark } : undefined
      },
    })
    const results = calendar.cards.map((item) => item.result)
    const isRestDay = restDates.has(dateKey)
    // 계획 시간: 그날 하는 카드 중 카드를 만든 뒤의 날만 셉니다. (나중에 만든 반복 카드가 지난 날 계획이 되지 않게)
    const plannedMinutes = isRestDay
      ? 0
      : getCardsOnDate(input.cards, dateKey)
          .filter((card) => toDayKey(card.createdAt) <= dateKey)
          .filter((card) => input.getMark(card.id, dateKey)?.mark !== 'rest')
          .reduce((sum, card) => sum + card.durationMinutes, 0)

    reports.set(dateKey, {
      dateKey,
      studyMinutes: Math.round(studyMs / 60000),
      bySubject,
      plannedMinutes,
      cardCount: results.filter((result) => result !== 'rest').length,
      doneCount: results.filter((result) => COMPLETE_RESULTS.includes(result)).length,
      pendingCount: calendar.pendingCount,
      isRestDay,
      isComplete: isCompleteDay(results, calendar.pendingCount),
    })
  }
  return reports
}

/** 그날의 리포트 숫자. 기록이 없는 날이면 0 으로 채운 하루 */
export function getDayReport(reports: Map<string, DayReport>, dateKey: string): DayReport {
  return reports.get(dateKey) ?? emptyDay(dateKey)
}

/** 그날까지(그날 포함) 계획을 끝까지 해낸 날 수. "계획 성공 N일째" 에 씁니다. */
export function countCompleteDaysUntil(reports: Map<string, DayReport>, dateKey: string): number {
  let count = 0
  for (const report of reports.values()) {
    if (report.dateKey <= dateKey && report.isComplete) count += 1
  }
  return count
}

/** 계획 대비 몇 %인지 (0 ~ 100 넘을 수 있음). 계획이 없으면 null */
export function getPlanPercent(day: DayReport): number | null {
  if (day.plannedMinutes === 0) return null
  return Math.round((day.studyMinutes / day.plannedMinutes) * 100)
}

/**
 * 하루 한 줄. 숫자를 끼워 넣는 정해 둔 문장입니다.
 *
 *   계획 완료, 1시간 50분, 성공 100일째  -> '계획한 1시간 50분을 끝까지 채웠어요. 이걸로 계획 성공 100일째예요!'
 *   계획 2시간 중 1시간 30분             -> '계획한 2시간 중 1시간 30분을 했어요. 조금만 더 가면 돼요.'
 *   쉬는 날                             -> '쉬어 간 날이에요. 쉬는 것도 계획이에요.'
 */
export function dayHeadline(day: DayReport, completeDays: number, isToday: boolean): string {
  if (day.isComplete) {
    return `계획한 ${formatDuration(day.plannedMinutes)}을 끝까지 채웠어요. 이걸로 계획 성공 ${completeDays}일째예요!`
  }
  if (day.isRestDay) return '쉬어 간 날이에요. 쉬는 것도 계획이에요.'
  if (day.studyMinutes > 0 && day.plannedMinutes > 0) {
    const percent = getPlanPercent(day) ?? 0
    const tail =
      isToday && day.pendingCount > 0
        ? '남은 카드도 이어서 해 봐요.'
        : percent >= 80
          ? '거의 다 왔어요!'
          : '조금만 더 가면 돼요.'
    return `계획한 ${formatDuration(day.plannedMinutes)} 중 ${formatDuration(day.studyMinutes)}을 했어요. ${tail}`
  }
  if (day.studyMinutes > 0) return `카드 없이 ${formatDuration(day.studyMinutes)} 공부했어요.`
  if (isToday) return '아직 오늘 공부 기록이 없어요. 카드 하나만 시작해 볼까요?'
  return '이날은 공부 기록이 없어요.'
}

// ---------------------------------------------------------------------------
// 확인 문제 정답률
// ---------------------------------------------------------------------------

/** 문제 하나를 맞혔는지 + 과목 */
export interface QuestionMark {
  subject: string
  correct: boolean
}

/**
 * 채팅 확인 문제 결과를 문제 하나하나로 풉니다.
 * 과목은 그 문제를 낸 카드로 공부한 세션의 과목에서 찾고, 없으면 주제 글에 든 과목 이름, 그것도 없으면 '기타' 입니다.
 */
export function quizMarks(
  results: QuizResult[],
  dateKeys: string[],
  input: Pick<HistoryInput, 'sessions' | 'cardIdByPlanId' | 'subjectOf'>,
  subjectNames: string[],
): QuestionMark[] {
  const marks: QuestionMark[] = []
  for (const result of results) {
    if (!dateKeys.includes(result.date)) continue
    const subject = quizSubjectOf(result, input, subjectNames)
    result.questions.forEach((question, index) => {
      const answer = result.answers[index]
      if (!answer) return
      marks.push({ subject, correct: answer.choiceIndex === question.answerIndex })
    })
  }
  return marks
}

function quizSubjectOf(
  result: QuizResult,
  input: Pick<HistoryInput, 'sessions' | 'cardIdByPlanId' | 'subjectOf'>,
  subjectNames: string[],
): string {
  if (result.cardId) {
    const session = input.sessions.find(
      (item) => getSessionCardId(item, input.cardIdByPlanId) === result.cardId,
    )
    if (session) return input.subjectOf(session)
  }
  return subjectNames.find((name) => result.topic.includes(name)) ?? '기타'
}

/**
 * 서버에만 있는 확인 문제 결과(다른 기기에서 푼 것 등, lib/quizResultsApi.ts)를 문제 하나하나로 풉니다.
 * 서버에는 과목 · 단원 · 날짜별 맞은 수만 있어서, 맞은 수만큼 "맞음" · 나머지는 "틀림" 으로 둡니다. 과목은 서버의 과목 이름입니다.
 *
 *   serverQuizMarks([{ subjectName: '수학', date: '2026-10-25', correct: 2, total: 3, … }], ['2026-10-25'])
 *     -> [수학 맞음, 수학 맞음, 수학 틀림]
 */
export function serverQuizMarks(counts: ServerQuizCount[], dateKeys: string[]): QuestionMark[] {
  const marks: QuestionMark[] = []
  for (const count of counts) {
    if (!dateKeys.includes(count.date)) continue
    for (let index = 0; index < count.total; index++) {
      marks.push({ subject: count.subjectName, correct: index < count.correct })
    }
  }
  return marks
}

/** 사진 채점 결과를 문제 하나하나로 풉니다. 애매(UNSURE)는 맞았는지 몰라서 뺍니다. */
export function photoMarks(checks: AnswerCheck[], dateKeys: string[]): QuestionMark[] {
  const marks: QuestionMark[] = []
  for (const check of checks) {
    if (!dateKeys.includes(check.date)) continue
    const subject = check.subjectText ?? '기타'
    for (const item of check.items) {
      if (item.result === 'UNSURE') continue
      marks.push({ subject, correct: item.result === 'CORRECT' })
    }
  }
  return marks
}

/** 정답률 한 묶음 */
export interface AccuracySummary {
  total: number
  correct: number
  /** 0 ~ 100. 문제가 없으면 null */
  percent: number | null
  /** 과목별 (문제가 많은 순) */
  bySubject: { subject: string; total: number; correct: number; percent: number }[]
}

/**
 * 맞힌 문제 수로 정답률을 냅니다.
 *
 *   수학 3문제 중 2개 + 영어 2문제 중 2개 -> { total: 5, correct: 4, percent: 80, bySubject: [수학 67%, 영어 100%] }
 */
export function summarizeAccuracy(marks: QuestionMark[]): AccuracySummary {
  const bySubjectMap = new Map<string, { total: number; correct: number }>()
  for (const mark of marks) {
    const item = bySubjectMap.get(mark.subject) ?? { total: 0, correct: 0 }
    item.total += 1
    if (mark.correct) item.correct += 1
    bySubjectMap.set(mark.subject, item)
  }
  const correct = marks.filter((mark) => mark.correct).length
  return {
    total: marks.length,
    correct,
    percent: marks.length === 0 ? null : Math.round((correct / marks.length) * 100),
    bySubject: [...bySubjectMap.entries()]
      .map(([subject, item]) => ({
        subject,
        ...item,
        percent: Math.round((item.correct / item.total) * 100),
      }))
      .sort((a, b) => b.total - a.total),
  }
}

// ---------------------------------------------------------------------------
// 한 주
// ---------------------------------------------------------------------------

/** 주간 리포트의 요일 칸 하나 */
export type WeekDayState = 'complete' | 'missed' | 'rest' | 'future'

/** 한 주의 숫자 */
export interface WeekReport {
  weekStart: string
  days: DayReport[]
  /** 요일 칸 상태 (월 ~ 일) */
  dayStates: WeekDayState[]
  totalMinutes: number
  /** 하루 평균 (지난 날만 나눔. 이번 주면 오늘까지) */
  averageMinutes: number
  /** 공부한 날 수 */
  studyDays: number
  /** 계획을 끝까지 해낸 날 수 */
  completeDays: number
  /** 가장 오래 공부한 날. 공부한 날이 없으면 null */
  bestDay: DayReport | null
  /** 오늘이 든 주 (아직 안 끝난 주) */
  isCurrent: boolean
}

/**
 * 요일 칸 상태: 색칠 = 완료 · 회색 = 못 채움 · 점선 = 쉬는 날(카드도 공부도 없거나 쉬는 날로 처리) · 미래
 */
function toWeekDayState(day: DayReport, todayKey: string): WeekDayState {
  if (day.dateKey > todayKey) return 'future'
  if (day.isComplete) return 'complete'
  if (day.isRestDay || (day.cardCount === 0 && day.studyMinutes === 0)) return 'rest'
  return 'missed'
}

export function buildWeekReport(
  reports: Map<string, DayReport>,
  weekStart: string,
  todayKey: string,
): WeekReport {
  const days = getWeekDateKeys(weekStart).map((dateKey) => getDayReport(reports, dateKey))
  const pastDays = days.filter((day) => day.dateKey <= todayKey)
  const totalMinutes = days.reduce((sum, day) => sum + day.studyMinutes, 0)
  const studied = days.filter((day) => day.studyMinutes > 0)
  const bestDay = studied.reduce<DayReport | null>(
    (best, day) => (best === null || day.studyMinutes > best.studyMinutes ? day : best),
    null,
  )
  return {
    weekStart,
    days,
    dayStates: days.map((day) => toWeekDayState(day, todayKey)),
    totalMinutes,
    averageMinutes: pastDays.length === 0 ? 0 : Math.round(totalMinutes / pastDays.length),
    studyDays: studied.length,
    completeDays: days.filter((day) => day.isComplete).length,
    bestDay,
    isCurrent: weekStart === getWeekStart(todayKey),
  }
}

/**
 * "쉬어 간 주" 인지. 다 지난 주이고, 그 주 전에도 기록이 있었는데(시작한 주가 아님), 공부한 날이 2일 이하면 true.
 * 이런 주에는 숫자 비교와 발견을 쉬고, 다시 시작할 작은 한 걸음만 보여 줍니다.
 */
export function isRestWeek(week: WeekReport, firstRecordDay: string | null): boolean {
  if (week.isCurrent || firstRecordDay === null) return false
  if (firstRecordDay >= week.weekStart) return false
  return week.studyDays <= REST_WEEK_MAX_STUDY_DAYS
}

/**
 * 이번 주 한 줄. 지난주와 비교할 수 있으면 비교하고, 계획 성공 날 수로 끝맺습니다.
 *
 *   시간 ↑ · 정답률 ↑          -> '공부 시간도 정답률도 지난주보다 올랐어요. 계획 성공 100일도 넘었어요!'
 *   시간 ↓                    -> '공부 시간은 지난주보다 40분 줄었어요. 그래도 계획을 끝까지 해낸 날이 3일이에요.'
 */
export function weekHeadline(input: {
  week: WeekReport
  lastWeek: WeekReport
  accuracyDiff: number | null
  completeDaysTotal: number
}): string {
  const { week, lastWeek, accuracyDiff, completeDaysTotal } = input
  const minutesDiff = week.totalMinutes - lastWeek.totalMinutes
  const milestone =
    completeDaysTotal >= 10
      ? ` 계획 성공 ${Math.floor(completeDaysTotal / 10) * 10}일도 넘었어요!`
      : ` 계획을 끝까지 해낸 날은 이번 주 ${week.completeDays}일이에요.`

  if (week.totalMinutes === 0) return '이번 주는 아직 공부 기록이 없어요. 카드 하나로 시작해 봐요.'
  if (lastWeek.totalMinutes === 0) {
    return `이번 주 ${formatDuration(week.totalMinutes)} 공부했어요.${milestone}`
  }
  if (minutesDiff > 0 && accuracyDiff !== null && accuracyDiff > 0) {
    return `공부 시간도 정답률도 지난주보다 올랐어요.${milestone}`
  }
  if (minutesDiff > 0) {
    return `공부 시간이 지난주보다 ${formatDuration(minutesDiff)} 늘었어요.${milestone}`
  }
  if (week.isCurrent) {
    return `이번 주 지금까지 ${formatDuration(week.totalMinutes)} 공부했어요.${milestone}`
  }
  return `공부 시간은 지난주보다 ${formatDuration(-minutesDiff)} 줄었어요. 그래도 계획을 끝까지 해낸 날이 ${week.completeDays}일이에요.`
}

// ---------------------------------------------------------------------------
// 이번 주 발견 · 다음 주에 해 볼 것
// ---------------------------------------------------------------------------

/** 다음 주에 해 볼 것 하나 (보기) */
export interface PickOption {
  title: string
  hint: string
  /** true 면 "이번 주는 넘어가기" */
  skip: boolean
}

/** 이번 주 발견 한 줄과, 그 발견에 맞춘 보기 3개 */
export interface WeekFinding {
  text: string
  options: PickOption[]
}

const SKIP_OPTION: PickOption = {
  title: '이번 주는 넘어가기',
  hint: '괜찮아요. 다음 리포트에서 다시 골라요',
  skip: true,
}

/** 5분 단위로 반올림 (예: 32 -> 30) */
function roundTo5(minutes: number): number {
  return Math.max(5, Math.round(minutes / 5) * 5)
}

/**
 * 이번 주 기록에서 발견 하나를 고르고, 그에 맞는 보기 3개를 만듭니다. 위에서부터 맞는 것 하나만 씁니다.
 *   1. 타이머를 목표보다 일찍 멈춘 날이 2번 이상    -> '50분 타이머를 보통 30분쯤에서 멈췄어요'
 *   2. 폰 때문에 일시정지한 게 3번 이상             -> '폰 때문에 멈춘 게 4번이에요'
 *   3. 카드를 늦게 시작한 게 2번 이상               -> '카드를 늦게 시작한 날이 3번이에요'
 *   4. 그 밖                                        -> '이번 주는 크게 흔들린 곳이 없어요'
 */
export function findWeekFinding(sessions: StudySession[], week: WeekReport): WeekFinding {
  const dateKeys = week.days.map((day) => day.dateKey)
  const weekSessions = sessions.filter((session) => dateKeys.includes(toDayKey(session.startedAt)))

  // 1. 일찍 멈춤: 목표 시간이 있는 세션 중 목표의 80% 전에 끝낸 것
  const stoppedEarly = weekSessions.filter(
    (session) =>
      session.targetMinutes !== undefined &&
      session.targetMinutes >= 20 &&
      getStudyMs(session) / 60000 < session.targetMinutes * 0.8,
  )
  if (stoppedEarly.length >= 2) {
    const target = roundTo5(
      stoppedEarly.reduce((sum, session) => sum + (session.targetMinutes ?? 0), 0) /
        stoppedEarly.length,
    )
    const stopped = roundTo5(
      stoppedEarly.reduce((sum, session) => sum + getStudyMs(session) / 60000, 0) /
        stoppedEarly.length,
    )
    return {
      text: `${target}분 타이머를 보통 ${stopped}분쯤에서 멈췄어요`,
      options: [
        {
          title: `타이머를 ${stopped}분으로 줄이기`,
          hint: '끝까지 가는 경험부터 쌓아요',
          skip: false,
        },
        {
          title: `${stopped}분 뒤 5분 쉬고 이어 하기`,
          hint: '멈추는 대신 쉬는 시간을 미리 넣어요',
          skip: false,
        },
        SKIP_OPTION,
      ],
    }
  }

  // 2. 폰 때문에 멈춤: 일시정지 이유에 '폰' 을 고른 횟수
  const phonePauses = weekSessions
    .flatMap((session) => session.pauses ?? [])
    .filter((pause) => pause.tag === 'phone' || (pause.tags ?? []).includes('phone')).length
  if (phonePauses >= 3) {
    return {
      text: `폰 때문에 공부를 멈춘 게 ${phonePauses}번이에요`,
      options: [
        { title: '폰을 다른 방에 두기', hint: '손이 안 닿으면 덜 멈춰요', skip: false },
        { title: '시작할 때 폰 뒤집어 두기', hint: '알림이 눈에 덜 띄어요', skip: false },
        SKIP_OPTION,
      ],
    }
  }

  // 3. 늦게 시작: 카드 결과가 '늦게 시작' 인 날 (달력의 지연과 같은 기준)
  const lateDays = week.days.filter((day) => day.cardCount > day.doneCount && day.studyMinutes > 0)
  if (lateDays.length >= 2) {
    return {
      text: `카드를 다 못 채운 날이 ${lateDays.length}번이에요`,
      options: [
        { title: '책상에 앉으면 타이머부터 켜기', hint: '시작이 제일 어려워요', skip: false },
        { title: '가장 쉬운 카드부터 하기', hint: '첫 카드를 끝내면 다음이 쉬워요', skip: false },
        SKIP_OPTION,
      ],
    }
  }

  return {
    text: '이번 주는 크게 흔들린 곳이 없어요',
    options: [
      { title: '지금 하던 대로 1주 더', hint: '잘 되는 건 그대로 두는 게 좋아요', skip: false },
      { title: '카드 하나를 10분 늘려 보기', hint: '조금씩 늘리면 부담이 덜해요', skip: false },
      SKIP_OPTION,
    ],
  }
}

/** 쉬어 간 주 다음에 고르는 아주 작은 보기 */
export const RESTART_OPTIONS: PickOption[] = [
  { title: '하루 10분만 타이머 켜기', hint: '10분이 지나면 그만해도 돼요', skip: false },
  { title: '카드 1장만 하기', hint: '가장 쉬운 카드 하나만 골라요', skip: false },
  { title: '이번 주는 푹 쉬기', hint: '쉬는 것도 계획이에요. 다음 주에 다시 봐요', skip: true },
]

/**
 * 그 주에 고른 것을 얼마나 했는지. 공부한 날 중 계획을 끝까지 해낸 날로 봅니다. ('지켰어?' 를 묻지 않음)
 * 고른 것이 없거나 "넘어가기" 였으면 null
 *
 *   공부한 날 5일, 그중 완료 4일 -> { studyDays: 5, completeDays: 4 }
 */
export function getPickResult(
  pick: WeeklyPick | undefined,
  week: WeekReport,
): { studyDays: number; completeDays: number } | null {
  if (!pick || pick.skip) return null
  return { studyDays: week.studyDays, completeDays: week.completeDays }
}
