/**
 * 통계 탭의 「전체 기간 추세」 — 첫 공부 기록이 있는 달부터 이번 달까지, 달마다 순공시간과 공부한 날 수. (STARFLOW H4)
 * 월말 리포트(BE #45, 만들지 않기로 함)와 다릅니다. 글로 정리하지 않고 달마다 숫자 두 개만 봅니다.
 *
 * 진짜 로그인은 서버가 내 기록 전체로 센 값을 받습니다. (BE GET /study-sessions/monthly)
 *   응답 200 [{ month: '2026-09', studyMinutes: 0, studyDays: 0 }, { month: '2026-10', studyMinutes: 1240, studyDays: 18 }]
 * 테스트 로그인 · 서버가 아직 이 주소를 모를 때(배포 전 404)는 화면이 가진 공부 기록으로 같은 규칙으로 셉니다. (buildMonthlyTrend)
 *
 * 규칙 (BE MonthlyStudy 와 같음)
 *   - 노는 기록은 뺍니다. 순공 = 끝 − 시작 − 일시정지 (lib/studyTime.ts)
 *   - 어느 달인지는 시작한 날(새벽 4시 기준, lib/date.ts 의 toDayKey)로 정합니다.
 *   - 분은 그 달의 밀리초를 다 더한 뒤 한 번만 반올림합니다.
 *   - 공부하지 않은 달도 0 으로 채웁니다. (빈 달이 사라지면 꾸준히 한 것처럼 보여서)
 */
import { api, ApiError } from '@/lib/api'
import { toDayKey } from '@/lib/date'
import { getStudyMs } from '@/lib/studyTime'
import type { StudySession } from '@/types'
import { queryOptions } from '@tanstack/react-query'

/** 서버가 오래 답하지 않으면 기다리지 않습니다. (다른 *Api.ts 와 같은 10초) */
const REQUEST_TIMEOUT_MS = 10000

/** 한 달의 공부 합계 */
export interface MonthlyStudy {
  /** 'YYYY-MM' */
  month: string
  /** 그 달 순공시간 (분) */
  studyMinutes: number
  /** 그 달에 공부 기록이 있는 날 수 */
  studyDays: number
}

/** 'YYYY-MM' 모양인지 */
function isMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
}

/** 서버 응답 → MonthlyStudy[]. 모양이 틀리면 null (한 칸이라도 틀리면 믿지 않습니다) */
export function toMonthlyStudies(value: unknown): MonthlyStudy[] | null {
  if (!Array.isArray(value)) return null
  const months: MonthlyStudy[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return null
    const item = raw as Record<string, unknown>
    if (
      !isMonth(item.month) ||
      typeof item.studyMinutes !== 'number' ||
      typeof item.studyDays !== 'number'
    ) {
      return null
    }
    months.push({ month: item.month, studyMinutes: item.studyMinutes, studyDays: item.studyDays })
  }
  return months
}

/** 서버에서 달마다 합계를 받습니다. 못 받으면 에러를 던집니다. */
export async function fetchMonthlyStudies(): Promise<MonthlyStudy[]> {
  const result = await api<unknown>('/study-sessions/monthly', {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const months = toMonthlyStudies(result)
  // 502: 서버가 이상한 모양의 답을 줬다는 뜻으로 씁니다.
  if (months === null) throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
  return months
}

/**
 * 달마다 합계 쿼리. 못 받으면(서버 배포 전 404 · 연결 끊김) 에러 대신 null 이라서,
 * 화면은 가진 공부 기록으로 직접 셉니다. (buildMonthlyTrend)
 */
export function monthlyStudyQuery() {
  return queryOptions({
    queryKey: ['study-sessions', 'monthly'],
    queryFn: async (): Promise<MonthlyStudy[] | null> => {
      try {
        return await fetchMonthlyStudies()
      } catch {
        return null
      }
    },
  })
}

/** 'YYYY-MM' 의 다음 달. '2026-12' → '2027-01' */
function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4))
  const monthIndex = Number(month.slice(5, 7)) // 1 ~ 12
  return monthIndex === 12 ? `${year + 1}-01` : `${year}-${String(monthIndex + 1).padStart(2, '0')}`
}

/**
 * 공부 기록으로 달마다 합계를 셉니다. (서버와 같은 규칙)
 *
 *   buildMonthlyTrend([8월 3일 30분, 10월 1일 20분, 10월 1일 40분], '2026-10-26')
 *     -> [{ month: '2026-08', 30분, 1일 }, { month: '2026-09', 0분, 0일 }, { month: '2026-10', 60분, 1일 }]
 */
export function buildMonthlyTrend(sessions: StudySession[], todayKey: string): MonthlyStudy[] {
  const msByMonth = new Map<string, number>()
  const daysByMonth = new Map<string, Set<string>>()
  for (const session of sessions) {
    if (session.kind === 'play') continue
    const dayKey = toDayKey(session.startedAt)
    const month = dayKey.slice(0, 7)
    msByMonth.set(month, (msByMonth.get(month) ?? 0) + getStudyMs(session))
    const days = daysByMonth.get(month) ?? new Set<string>()
    days.add(dayKey)
    daysByMonth.set(month, days)
  }
  if (msByMonth.size === 0) return []

  const first = [...msByMonth.keys()].sort()[0]
  const last = todayKey.slice(0, 7)
  const months: MonthlyStudy[] = []
  // 시계가 틀린 기기의 미래 기록이 있어도 이번 달까지만 셉니다.
  for (let month = first; month <= last; month = nextMonth(month)) {
    months.push({
      month,
      studyMinutes: Math.round((msByMonth.get(month) ?? 0) / 60000),
      studyDays: daysByMonth.get(month)?.size ?? 0,
    })
  }
  return months
}

/** 추세 카드 머리의 숫자들 */
export interface TrendSummary {
  /** 몇 달째인지 (첫 기록의 달 ~ 이번 달) */
  monthCount: number
  /** 전체 순공시간 (분) */
  totalMinutes: number
  /** 공부한 날 전체 */
  totalDays: number
  /** 가장 많이 한 달. 모든 달이 0분이면 null */
  bestMonth: MonthlyStudy | null
}

/**
 * 추세 카드에 쓸 합계를 셉니다.
 *
 *   summarizeTrend([{ '2026-09', 0분 }, { '2026-10', 1240분, 18일 }])
 *     -> { monthCount: 2, totalMinutes: 1240, totalDays: 18, bestMonth: 10월 }
 */
export function summarizeTrend(months: MonthlyStudy[]): TrendSummary {
  let bestMonth: MonthlyStudy | null = null
  for (const month of months) {
    if (
      month.studyMinutes > 0 &&
      (bestMonth === null || month.studyMinutes > bestMonth.studyMinutes)
    ) {
      bestMonth = month
    }
  }
  return {
    monthCount: months.length,
    totalMinutes: months.reduce((sum, month) => sum + month.studyMinutes, 0),
    totalDays: months.reduce((sum, month) => sum + month.studyDays, 0),
    bestMonth,
  }
}

/** '2026-10' → '10월'. withYear 면 '2026년 10월' (막대 아래 글자 · 화면 낭독기가 읽는 글) */
export function formatMonthLabel(month: string, withYear = false): string {
  const year = month.slice(0, 4)
  const monthNumber = Number(month.slice(5, 7))
  return withYear ? `${year}년 ${monthNumber}월` : `${monthNumber}월`
}
