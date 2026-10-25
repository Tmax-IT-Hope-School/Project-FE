import { getTodayKey, moveDateKey } from '@/lib/date'
import { getDaysUntil } from '@/lib/exams'
import { loadData, saveData } from '@/lib/storage'

/**
 * 학교 학사일정(NEIS, BE#282)을 화면에 맞게 고르는 순수 함수들입니다. (FE#508)
 * 화면은 홈의 학교 정보 묶음([일정] 탭 · 시험 계획 제안, pages/HomePage.tsx) 입니다. 학사일정은 GET /school/today 로 같이 받습니다.
 */

/** 학사일정 하나 (서버 응답 모양 그대로) */
export interface SchoolEvent {
  /** 'YYYY-MM-DD' */
  date: string
  name: string
  content: string | null
  /** 해당 학년들. 빈 목록이면 학년 구분 없는 행사 */
  grades: number[]
  /** 시험인지 (서버 코드가 이름으로 판정) */
  exam: boolean
}

/** 이어진 날들을 하나로 묶은 일정 (예: 12/9 ~ 12/11 '2학기 2차 정기시험') */
export interface SchoolEventPeriod {
  name: string
  /** 'YYYY-MM-DD' */
  start: string
  /** 'YYYY-MM-DD'. 하루짜리면 start 와 같습니다. */
  end: string
  exam: boolean
}

/** 시험이 이만큼 남았으면 "계획 다시 짜기" 를 제안합니다. */
export const REPLAN_WITHIN_DAYS = 14

/**
 * 온보딩의 학년 답('고1' · '고2' · '고3')을 숫자로. 그 밖(N수 · 대학생 · 기타)이면 null
 *
 *   gradeNumberOf('고2') -> 2     gradeNumberOf('N수') -> null
 */
export function gradeNumberOf(grade: string | undefined): number | null {
  if (grade === '고1') return 1
  if (grade === '고2') return 2
  if (grade === '고3') return 3
  return null
}

/**
 * 내 학년에 해당하는 행사만. 학년 구분이 없는 행사(grades 가 빈 목록)와 내 학년을 모를 때는 모두 남깁니다.
 *
 *   [{ grades: [1, 2] }, { grades: [3] }, { grades: [] }] 와 2학년 -> 첫째 · 셋째
 */
export function filterForGrade(events: SchoolEvent[], grade: number | null): SchoolEvent[] {
  if (grade === null) return events
  return events.filter((event) => event.grades.length === 0 || event.grades.includes(grade))
}

/**
 * 같은 이름이 이어지는 날들을 한 기간으로 묶습니다. 사이가 3일 안이면 이어진 것으로 봅니다(주말을 끼는 시험 때문).
 * 결과는 시작 날짜 순서입니다.
 *
 *   12/9 · 12/10 · 12/11 '2학기 2차 정기시험' -> [{ name: '2학기 2차 정기시험', start: 12/9, end: 12/11 }]
 */
export function groupEventPeriods(events: SchoolEvent[]): SchoolEventPeriod[] {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date))
  const periods: SchoolEventPeriod[] = []
  // 이름마다 가장 최근 기간. 다른 행사가 사이에 끼어 있어도 같은 이름끼리 이어 붙이려고 따로 둡니다.
  const latestByName = new Map<string, SchoolEventPeriod>()
  for (const event of sorted) {
    const latest = latestByName.get(event.name)
    if (latest && daysBetween(latest.end, event.date) <= 3) {
      latest.end = event.date
      continue
    }
    const period = { name: event.name, start: event.date, end: event.date, exam: event.exam }
    periods.push(period)
    latestByName.set(event.name, period)
  }
  return periods
}

/** 두 날짜 사이의 날 수 ('2026-12-09' → '2026-12-11' = 2) */
function daysBetween(from: string, to: string): number {
  const toTime = (key: string) => {
    const [year, month, day] = key.split('-').map(Number)
    return Date.UTC(year, month - 1, day)
  }
  return Math.round((toTime(to) - toTime(from)) / (24 * 60 * 60 * 1000))
}

/** 아직 끝나지 않은 일정들 (오늘 진행 중인 것 포함), 앞에서부터 limit 개 */
export function getUpcomingPeriods(
  periods: SchoolEventPeriod[],
  todayKey: string,
  limit: number,
): SchoolEventPeriod[] {
  return periods.filter((period) => period.end >= todayKey).slice(0, limit)
}

/** 아직 끝나지 않은 다음 시험. 없으면 undefined */
export function getNextExamPeriod(
  periods: SchoolEventPeriod[],
  todayKey: string,
): SchoolEventPeriod | undefined {
  return periods.find((period) => period.exam && period.end >= todayKey)
}

/** 시험을 구분하는 글자 (닫은 제안을 기억할 때 씁니다) */
export function examKeyOf(period: SchoolEventPeriod): string {
  return `${period.start}|${period.name}`
}

// 닫은 "계획 다시 짜기" 제안 (시험마다 한 번만 보이게. 실제 키는 'study-school-replan-dismissed')
const DISMISSED_KEY = 'school-replan-dismissed'

/** 닫은 제안들 */
export function loadDismissedReplans(): string[] {
  const saved = loadData<unknown>(DISMISSED_KEY, [])
  return Array.isArray(saved)
    ? saved.filter((item): item is string => typeof item === 'string')
    : []
}

/** 이 시험의 제안을 닫았다고 적어 두고, 새 목록을 돌려줍니다. */
export function dismissReplan(period: SchoolEventPeriod): string[] {
  const next = [...loadDismissedReplans(), examKeyOf(period)]
  saveData(DISMISSED_KEY, next)
  return next
}

/**
 * "계획 다시 짜기" 를 제안할지. 다음 시험이 14일 안에 시작하고(이미 시작했어도 끝나기 전), 그 시험의 제안을 닫지 않았으면 true
 *
 *   오늘 11/27, 시험 12/9 시작(12일 남음) -> true
 *   오늘 11/1, 시험 12/9 시작(38일 남음)  -> false
 */
export function shouldSuggestReplan(
  period: SchoolEventPeriod | undefined,
  todayKey: string,
  dismissed: string[],
): boolean {
  if (!period || dismissed.includes(examKeyOf(period))) return false
  return daysUntilKey(period.start, todayKey) <= REPLAN_WITHIN_DAYS && period.end >= todayKey
}

/** todayKey 기준으로 dateKey 까지 며칠 남았는지 (오늘 0, 내일 1, 지난날은 음수) */
export function daysUntilKey(dateKey: string, todayKey: string): number {
  const [year, month, day] = todayKey.split('-').map(Number)
  return getDaysUntil(dateKey, new Date(year, month - 1, day, 12))
}

/**
 * 기간을 짧게 보여줍니다.
 *
 *   하루    -> '10월 20일'
 *   여러 날 -> '12월 9일 ~ 11일'  /  달이 바뀌면 '12월 30일 ~ 1월 2일'
 */
export function formatPeriodDates(period: SchoolEventPeriod): string {
  const [, startMonth, startDay] = period.start.split('-').map(Number)
  const [, endMonth, endDay] = period.end.split('-').map(Number)
  if (period.start === period.end) return `${startMonth}월 ${startDay}일`
  if (startMonth === endMonth) return `${startMonth}월 ${startDay}일 ~ ${endDay}일`
  return `${startMonth}월 ${startDay}일 ~ ${endMonth}월 ${endDay}일`
}

// 학사일정에서 받은 내 학년의 시험 날짜들 (실제 키는 'study-school-exam-dates')
// 안전 브레이크가 "시험 직전 3일 · 직후 2일" 을 판단할 때 읽습니다. (lib/diarySafety.ts 의 loadExamDates)
// 시험 기록 화면(/exams)을 지운 뒤(2026-10-18)에는 시험 날짜를 여기서만 얻습니다.
const EXAM_DATES_KEY = 'school-exam-dates'
// 서버는 오늘부터의 일정만 주므로, 지난 시험 날짜도 이만큼은 남겨 둡니다. ("직후 2일" 을 판단하려고)
const KEEP_PAST_EXAM_DAYS = 7

/** 저장해 둔 학사일정 시험 날짜 ('YYYY-MM-DD' 목록). 없거나 깨져 있으면 빈 목록 */
export function loadSchoolExamDates(): string[] {
  const saved = loadData<unknown>(EXAM_DATES_KEY, [])
  return Array.isArray(saved)
    ? saved.filter((item): item is string => typeof item === 'string')
    : []
}

/**
 * 받아온 학사일정에서 내 학년의 시험 날짜만 저장합니다. 지난 7일 안의 시험 날짜는 남겨서 합칩니다.
 *
 *   events: [{ date: '2026-12-09', exam: true, grades: [2] }, { date: '2026-12-20', exam: false }] , 학년 2
 *     -> 저장: ['2026-12-09'] (+ 전에 저장한 것 중 지난 7일 안의 날짜)
 */
export function saveSchoolExamDates(events: SchoolEvent[], grade: number | null): void {
  const keepFrom = moveDateKey(getTodayKey(), -KEEP_PAST_EXAM_DAYS)
  const recentPast = loadSchoolExamDates().filter((date) => date >= keepFrom)
  const fetched = filterForGrade(events, grade)
    .filter((event) => event.exam)
    .map((event) => event.date)
  saveData(EXAM_DATES_KEY, [...new Set([...recentPast, ...fetched])].sort())
}
