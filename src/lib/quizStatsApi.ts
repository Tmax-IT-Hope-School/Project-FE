/**
 * 확인 문제(퀴즈) 결과를 서버에 저장하고, 통계 탭이 그릴 기간 통계를 받아 오는 함수들입니다. (2026-10-24)
 *
 * 서버와 정한 약속입니다. (BE 저장소의 docs/API.md "퀴즈 결과 · 통계") 전부 로그인이 필요합니다.
 *   퀴즈 결과 저장   POST /quiz-results   { subjectId, unit, correctCount, totalCount, questionSeconds[] } -> 201
 *                     날짜는 서버가 정합니다. (새벽 4시 기준) 퀴즈 한 번 = 한 단원입니다.
 *   기간 통계        GET  /quiz-results/stats?from=2026-10-19&to=2026-10-25 (31일까지)
 *                     -> { from, to, days: [{ date, studyMinutes }],
 *                          subjects: [{ subjectId, name, color, days: [{ date, correctCount, totalCount, studyMinutes }],
 *                                       units: [{ unit, correctCount, totalCount, averageSeconds, days: [...] }] }] }
 *
 * ■ 테스트 로그인은 서버를 부르지 않습니다. 통계 탭은 시연용 예시(lib/statsDemo.ts)를 보여 줍니다.
 * ■ 카드에는 과목이 없어서, 퀴즈를 다 푼 뒤 학생이 과목을 고르면 저장합니다. (pages/ChatRoomPage.tsx)
 */
import { api } from '@/lib/api'
import { moveDateKey } from '@/lib/date'
import type { CoachQuiz } from '@/lib/studyQuiz'
import { countCorrect } from '@/lib/studyQuiz'
import {
  average,
  sum,
  UNIT_COLORS,
  type StatsData,
  type StatsReport,
  type StatsSubject,
} from '@/lib/statsDemo'
import type { SubjectColor } from '@/types'
import { queryOptions } from '@tanstack/react-query'

/** 서버의 단원 이름 글자 수 한도 (quiz_results.unit) */
const MAX_UNIT_LENGTH = 30

/** 서버로 보내는 퀴즈 결과 하나 */
interface QuizResultBody {
  subjectId: number
  unit: string
  correctCount: number
  totalCount: number
  /** 문제마다 걸린 시간(초), 문제 순서대로 */
  questionSeconds: number[]
}

/**
 * 다 푼 문제 말풍선을 서버로 보낼 모양으로 바꿉니다. 보낼 수 없으면 null
 *   (안 끝났음 · 시연용 예시 · 단원을 모름 · 과목 번호가 숫자가 아님)
 */
export function toQuizResultBody(quiz: CoachQuiz, subjectId: string): QuizResultBody | null {
  const subjectNumber = Number(subjectId)
  const unit = quiz.unit?.trim() ?? ''
  if (quiz.status !== 'done' || quiz.isDemo) return null
  if (unit === '' || unit.length > MAX_UNIT_LENGTH) return null
  if (!Number.isInteger(subjectNumber) || subjectNumber <= 0) return null
  return {
    subjectId: subjectNumber,
    unit,
    correctCount: countCorrect(quiz),
    totalCount: quiz.questions.length,
    // 밀리초를 초로 반올림. 한 문제에 1시간을 넘으면 1시간으로 둡니다. (서버 한도)
    questionSeconds: quiz.answers.map((answer) =>
      Math.min(3600, Math.round((answer?.ms ?? 0) / 1000)),
    ),
  }
}

/** 퀴즈 결과 하나를 서버에 저장합니다. */
export async function postQuizResult(body: QuizResultBody): Promise<void> {
  await api<unknown>('/quiz-results', { method: 'POST', body: JSON.stringify(body) })
}

/* ---------- 기간 통계 ---------- */

interface ServerCountDay {
  date: string
  correctCount: number
  totalCount: number
}

interface ServerUnit {
  unit: string
  correctCount: number
  totalCount: number
  averageSeconds: number
  days: ServerCountDay[]
}

interface ServerSubject {
  subjectId: number
  name: string
  color: SubjectColor
  days: (ServerCountDay & { studyMinutes: number })[]
  units: ServerUnit[]
}

/** 서버가 주는 기간 통계 */
export interface ServerQuizStats {
  from: string
  to: string
  days: { date: string; studyMinutes: number }[]
  subjects: ServerSubject[]
}

/** 서버의 과목 색 이름 → 그래프에 칠할 색 */
const SUBJECT_HEX: Record<SubjectColor, string> = {
  red: '#d6336c',
  orange: '#e8590c',
  green: '#0c8a6c',
  blue: '#4f46e5',
  purple: '#7048e8',
}

/**
 * 오늘이 든 주의 월요일 ~ 일요일 날짜 7개 ('YYYY-MM-DD')
 *   weekDateKeys('2026-10-24') -> ['2026-10-19', … , '2026-10-25'] (10-24 는 토요일)
 */
export function weekDateKeys(todayKey: string): string[] {
  const [year, month, day] = todayKey.split('-').map(Number)
  // getDay(): 0 = 일요일 … 6 = 토요일. 월요일까지 며칠 앞으로 가야 하는지
  const backToMonday = (new Date(year, month - 1, day).getDay() + 6) % 7
  const monday = moveDateKey(todayKey, -backToMonday)
  return [0, 1, 2, 3, 4, 5, 6].map((offset) => moveDateKey(monday, offset))
}

/** 기간 통계를 받아 옵니다. 모양이 틀리면 에러입니다. */
async function fetchQuizStats(from: string, to: string): Promise<ServerQuizStats> {
  const result = await api<unknown>(`/quiz-results/stats?from=${from}&to=${to}`)
  if (
    typeof result !== 'object' ||
    result === null ||
    !Array.isArray((result as ServerQuizStats).subjects) ||
    !Array.isArray((result as ServerQuizStats).days)
  ) {
    throw new Error('통계 응답 모양이 올바르지 않습니다')
  }
  return result as ServerQuizStats
}

/** 통계 탭이 쓰는 쿼리. 퀴즈를 새로 풀면 이 키를 무효화합니다. */
export function quizStatsQuery(from: string, to: string) {
  return queryOptions({
    queryKey: ['quiz-stats', from, to],
    queryFn: () => fetchQuizStats(from, to),
  })
}

/** 맞은 개수 · 전체 개수 → 점수(%). 문제가 없으면 null */
function scoreOf(correct: number, total: number): number | null {
  return total > 0 ? Math.round((correct / total) * 100) : null
}

/** 'YYYY-MM-DD' -> '10월 23일 (금)' */
function dateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][
    new Date(year, month - 1, day).getDay()
  ]
  return `${month}월 ${day}일 (${weekday})`
}

/** 점수가 있는 날마다 간단한 일간 리포트를 만듭니다. (AI 가 아니라 숫자로 만든 문장, 최근 3일) */
function dayReports(
  scores: (number | null)[],
  bestWorstOfDay: (dayIndex: number) => { best: string; worst: string } | null,
): StatsReport[] {
  const reports: StatsReport[] = []
  scores.forEach((score, dayIndex) => {
    if (score === null) return
    const previous = scores.slice(0, dayIndex).filter((value) => value !== null)
    const before = previous.length > 0 ? previous[previous.length - 1] : null
    const delta = before === null ? 0 : score - before
    const pair = bestWorstOfDay(dayIndex)
    let note = before === null ? '이번 주 첫 기록이야.' : `지난번보다 ${Math.abs(delta)}점 `
    if (before !== null) note += delta >= 0 ? '올랐어.' : '내려갔어.'
    if (pair && pair.worst !== pair.best) note += ` ${pair.worst} 쪽을 한 번 더 보자.`
    reports.push({
      dayIndex,
      score,
      delta,
      note,
      tags:
        pair && pair.best !== pair.worst
          ? [
              ['가장 좋음', pair.best],
              ['더 볼 것', pair.worst],
            ]
          : [],
    })
  })
  return reports.slice(-3)
}

/** 이름과 점수 목록에서 가장 높은 것 · 낮은 것의 이름 (점수가 하나도 없으면 null) */
function bestWorst(items: { name: string; score: number | null }[]) {
  const scored = items.filter((item) => item.score !== null) as { name: string; score: number }[]
  if (scored.length === 0) return null
  const sorted = [...scored].sort((a, b) => b.score - a.score)
  return { best: sorted[0].name, worst: sorted[sorted.length - 1].name }
}

/**
 * 서버의 기간 통계를 통계 탭이 그리는 모양(StatsData)으로 바꿉니다.
 * dates 는 그래프 가로축의 날짜 7개(월 ~ 일)입니다.
 */
export function toStatsData(server: ServerQuizStats, dates: string[]): StatsData {
  const totalMinutesOf = (date: string) =>
    server.days.find((day) => day.date === date)?.studyMinutes ?? 0
  const subjects: StatsSubject[] = server.subjects.map((subject) => {
    const dayOf = (date: string) => subject.days.find((day) => day.date === date)
    const scores = dates.map((date) => {
      const day = dayOf(date)
      return day ? scoreOf(day.correctCount, day.totalCount) : null
    })
    const units = subject.units.map((unit, index) => ({
      name: unit.unit,
      correct: scoreOf(unit.correctCount, unit.totalCount) ?? 0,
      solved: unit.totalCount,
      // 단원별 공부 시간 · 지난주와 비교한 속도는 서버에 아직 없습니다.
      hours: null,
      speedSec: unit.averageSeconds,
      speedDeltaSec: null,
      color: UNIT_COLORS[index % UNIT_COLORS.length],
      dailyScores: dates.map((date) => {
        const day = unit.days.find((item) => item.date === date)
        return day ? scoreOf(day.correctCount, day.totalCount) : null
      }),
    }))
    const pair = bestWorst(units.map((unit) => ({ name: unit.name, score: unit.correct })))
    const weekScore = average(scores.filter((score) => score !== null))
    return {
      id: String(subject.subjectId),
      name: subject.name,
      color: SUBJECT_HEX[subject.color] ?? SUBJECT_HEX.blue,
      scores,
      hours: dates.map(() => 0),
      weekDelta: '이번 주 기록',
      summary:
        units.length === 0
          ? `이번 주에 푼 ${subject.name} 확인 문제가 아직 없어요. 공부를 마치고 확인 문제를 풀면 여기에 쌓여요.`
          : `이번 주 ${subject.name} 정답률은 ${weekScore}%예요.` +
            (pair && pair.best !== pair.worst
              ? ` ${pair.best} 은(는) 잘하고 있고, ${pair.worst} 은(는) 더 연습하면 좋아요.`
              : ''),
      effect:
        '단원별 공부 시간은 아직 모아지지 않아요. 카드에 과목이 없어서 공부 시간은 전체에서만 봐요.',
      reportFocus: '그날 푼 확인 문제 점수와, 가장 잘한 · 더 볼 단원을 보여 줘요.',
      units,
      reports: dayReports(scores, (dayIndex) =>
        bestWorst(units.map((unit) => ({ name: unit.name, score: unit.dailyScores[dayIndex] }))),
      ),
    }
  })

  const allScores = dates.map((_, dayIndex) => {
    const values = subjects
      .map((subject) => subject.scores[dayIndex])
      .filter((score) => score !== null)
    return values.length > 0 ? average(values) : null
  })
  const pair = bestWorst(
    subjects.map((subject) => ({
      name: subject.name,
      score: subject.scores.some((score) => score !== null)
        ? average(subject.scores.filter((score) => score !== null))
        : null,
    })),
  )
  const totalMinutes = sum(dates.map(totalMinutesOf))
  return {
    isDemo: false,
    weekLabel: `${dateLabel(dates[0]).split(' (')[0]} ~ ${dateLabel(dates[6]).split(' (')[0]}`,
    dateLabels: dates.map(dateLabel),
    subjects,
    totalHours: dates.map((date) => totalMinutesOf(date) / 60),
    all: {
      weekDelta: '이번 주 기록',
      summary: pair
        ? `이번 주는 ${pair.best} 이(가) 가장 좋고, ${pair.worst} 을(를) 더 보면 좋아요.`
        : '이번 주에 푼 확인 문제가 아직 없어요. 공부를 마치고 확인 문제를 풀면 여기에 쌓여요.',
      effect: `이번 주 타이머로 모두 ${Math.floor(totalMinutes / 60)}시간 ${totalMinutes % 60}분 공부했어요.`,
      reportFocus: '그날 푼 확인 문제 점수와, 가장 잘한 · 더 볼 과목을 보여 줘요.',
      reports: dayReports(allScores, (dayIndex) =>
        bestWorst(
          subjects.map((subject) => ({ name: subject.name, score: subject.scores[dayIndex] })),
        ),
      ),
    },
  }
}
