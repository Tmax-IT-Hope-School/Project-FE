import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { Card } from '@/components/ui/Card'
import { useIsServerData } from '@/hooks/useIsServerData'
import { useQueryParam } from '@/hooks/useQueryParam'
import { cn } from '@/lib/cn'
import { getTodayKey } from '@/lib/date'
import { quizStatsQuery, toStatsData, weekDateKeys } from '@/lib/quizStatsApi'
import {
  allSubjectsAverage,
  average,
  averageOrNull,
  DEMO_STATS,
  formatHours,
  formatSpeedDelta,
  STATS_DAYS,
  sum,
  WEAK_SCORE,
  type StatsData,
  type StatsReport,
} from '@/lib/statsDemo'
import { useSuspenseQuery } from '@tanstack/react-query'

/*
 * 통계 탭(/stats) 화면입니다. (2026-10-24)
 *
 *   위: [전체 · 과목들] 과목 고르기 + [이번 주 전체 · 월 ~ 일] 요일 고르기 (처음엔 둘 다 전체)
 *   왼쪽: 꺾은선 그래프 (세로 = 점수, 가로 = 요일)
 *         전체   -> 모든 과목 평균(검은 굵은 선) + 과목별 선(옅게)
 *         과목   -> 그 과목의 단원별 선
 *   오른쪽: 상세 분석 (요약 숫자 4개 · 과목/단원별 정답률 · 공부 시간 · 풀이 속도 · 일간 리포트)
 *
 * 진짜 로그인은 서버의 퀴즈 결과로(lib/quizStatsApi.ts), 테스트 로그인은 시연용 예시로(lib/statsDemo.ts) 그립니다.
 * 고른 과목 · 요일은 주소(?subject=3&day=thu)에 둡니다. 새로고침해도 그대로입니다.
 */

/** 주소에 쓰는 요일 이름 (STATS_DAYS 와 같은 순서). 'week' 는 이번 주 전체 */
const DAY_IDS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/** '전체' 를 골랐을 때 쓰는 색 */
const ALL_COLOR = '#191f28'

/** 그래프 선 하나. 점수가 null 인 날은 점을 찍지 않습니다. */
interface ChartLine {
  name: string
  color: string
  scores: (number | null)[]
  /** true 면 옅고 가늘게 (전체 화면의 과목 선) */
  faded: boolean
}

/** 상세 분석 표의 한 줄 (과목 또는 단원) */
interface DetailRow {
  name: string
  color: string
  /** 정답률(%). 푼 문제가 없으면 null */
  correct: number | null
  /** 푼 문제 수. 모르면 null */
  solved: number | null
  /** 공부 시간(시간). 모르면 null (서버 기록에는 단원 · 과목별 시간이 없음) */
  hours: number | null
  speedSec: number | null
  speedDeltaSec: number | null
}

/** 오른쪽 상세 분석에 보여 줄 것 */
interface Detail {
  name: string
  title: string
  color: string
  score: number | null
  scoreNote: string
  /** 공부 시간(시간). 모르면 null */
  hours: number | null
  hoursNote: string
  speedSec: number | null
  summary: string
  effect: string
  rowHeader: '과목' | '단원'
  rows: DetailRow[]
  reportFocus: string
  reports: StatsReport[]
}

export function StatsPage() {
  const isServerData = useIsServerData()
  if (!isServerData) return <StatsView data={DEMO_STATS} />
  return (
    <AsyncBoundary
      pendingFallback={<p className="px-1 py-10 text-center text-slate-500">통계를 불러오는 중…</p>}
      errorMessage="통계를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요."
    >
      <ServerStats />
    </AsyncBoundary>
  )
}

/** 진짜 로그인: 이번 주(월 ~ 일) 통계를 서버에서 받아 그립니다. */
function ServerStats() {
  const dates = weekDateKeys(getTodayKey())
  const { data } = useSuspenseQuery(quizStatsQuery(dates[0], dates[6]))
  return <StatsView data={toStatsData(data, dates)} />
}

function StatsView({ data }: { data: StatsData }) {
  const [subjectId, setSubjectId] = useQueryParam('subject', 'all')
  const [dayId, setDayId] = useQueryParam('day', 'week')

  // 주소는 손으로 고칠 수 있어서, 모르는 값이면 전체로 봅니다.
  const subjectIndex = data.subjects.findIndex((subject) => subject.id === subjectId)
  const dayIndex = DAY_IDS.indexOf(dayId)

  const { title, lines, averageLine } = buildChart(data, subjectIndex)
  const detail = buildDetail(data, subjectIndex, dayIndex)

  const subjectChips = [
    {
      id: 'all',
      name: '전체',
      color: ALL_COLOR,
      score: averageOrNull(allSubjectsAverage(data.subjects)),
    },
    ...data.subjects.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      score: averageOrNull(s.scores),
    })),
  ]
  const dayChips = [
    { id: 'week', name: '이번 주 전체' },
    ...DAY_IDS.map((id, i) => ({ id, name: STATS_DAYS[i] })),
  ]

  return (
    <div className="flex flex-col gap-4 pb-6">
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <div>
          <h1 className="text-[28px] leading-snug font-bold tracking-tight text-slate-900">통계</h1>
          <p className="text-[15px] break-keep text-slate-500">
            하루 끝 확인 시험 점수를 과목 · 단원별로 봐요.
          </p>
        </div>
        <p className="text-sm font-semibold text-slate-700">
          {data.weekLabel}
          {data.isDemo && (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              시연용 예시
            </span>
          )}
        </p>
      </div>

      {data.subjects.length === 0 && (
        <p className="rounded-2xl bg-white p-5 text-[15px] break-keep text-slate-600">
          아직 과목이 없어요. 확인 문제를 다 푼 뒤 과목을 고르면 여기에 점수가 쌓여요.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* 왼쪽: 고르기 + 그래프 + 한 줄 정리 */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <div role="group" aria-label="과목 고르기" className="flex flex-wrap gap-2">
              {subjectChips.map((chip) => {
                const isOn = chip.id === (subjectIndex < 0 ? 'all' : subjectId)
                return (
                  <button
                    key={chip.id}
                    type="button"
                    aria-pressed={isOn}
                    onClick={() => setSubjectId(chip.id)}
                    className={cn(
                      'flex h-10 items-center gap-2 rounded-full border px-4 text-[15px] font-bold transition active:scale-95',
                      isOn
                        ? 'border-2 bg-slate-50 text-slate-900'
                        : 'border-slate-200 bg-white text-slate-600',
                    )}
                    // 과목마다 색이 달라서 테두리 색만 style 로 줍니다.
                    style={isOn ? { borderColor: chip.color } : undefined}
                  >
                    <ColorDot color={chip.color} />
                    {chip.name}
                    <span className="text-[13px] font-medium text-slate-500">
                      {chip.score === null ? '기록 없음' : `평균 ${chip.score}점`}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* 요일 고르기. 375px 에서는 이 막대만 옆으로 밀어서 봅니다. */}
            <div className="mt-3 overflow-x-auto">
              <div
                role="group"
                aria-label="요일 고르기"
                className="inline-flex gap-1 rounded-xl bg-slate-100 p-1"
              >
                {dayChips.map((chip) => {
                  const isOn = chip.id === (dayIndex < 0 ? 'week' : dayId)
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      aria-pressed={isOn}
                      onClick={() => setDayId(chip.id)}
                      className={cn(
                        'h-10 min-w-10 shrink-0 rounded-lg px-3 text-sm whitespace-nowrap transition',
                        isOn
                          ? 'bg-white font-bold text-slate-900 shadow-sm'
                          : 'font-medium text-slate-500',
                      )}
                    >
                      {chip.name}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[17px] font-bold tracking-tight text-slate-900">{title}</h2>
              <p className="text-[13px] text-slate-500">세로 = 점수 · 가로 = 요일 (일별 평균)</p>
            </div>
            <ScoreChart lines={lines} averageLine={averageLine} dayIndex={dayIndex} title={title} />
          </Card>

          <div className="bg-brand-light rounded-2xl p-5">
            <p className="text-brand text-[13px] font-bold">
              {data.isDemo ? 'AI 한 줄 정리' : '한 줄 정리'} · {detail.name}
            </p>
            <p className="mt-1 text-base leading-relaxed break-keep text-slate-900">
              {detail.summary}
            </p>
          </div>
          <div className="rounded-2xl bg-amber-50 p-5">
            <p className="text-[13px] font-bold text-amber-800">시간 대비 효과 · {detail.name}</p>
            <p className="mt-1 text-[15px] leading-relaxed break-keep text-slate-800">
              {detail.effect}
            </p>
          </div>
        </div>

        {/* 오른쪽: 상세 분석 */}
        <DetailPanel detail={detail} dateLabels={data.dateLabels} />
      </div>
    </div>
  )
}

/** 작은 색 동그라미. 과목마다 색이 달라서 style 로 칠합니다. */
function ColorDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  )
}

/** 왼쪽 그래프에 그릴 선들을 정합니다. 전체면 과목별 + 평균선, 과목이면 단원별 */
function buildChart(
  data: StatsData,
  subjectIndex: number,
): { title: string; lines: ChartLine[]; averageLine: (number | null)[] | null } {
  if (subjectIndex < 0) {
    return {
      title: '전체 평균 점수 (모든 과목)',
      lines: data.subjects.map((s) => ({
        name: s.name,
        color: s.color,
        scores: s.scores,
        faded: true,
      })),
      averageLine: allSubjectsAverage(data.subjects),
    }
  }
  const subject = data.subjects[subjectIndex]
  return {
    title: `${subject.name} 단원별 점수`,
    lines: subject.units.map((u) => ({
      name: u.name,
      color: u.color,
      scores: u.dailyScores,
      faded: false,
    })),
    averageLine: null,
  }
}

/** 오른쪽 상세 분석의 내용을 정합니다. 요일을 고르면 그날 값, 아니면 이번 주 평균 · 합계 */
function buildDetail(data: StatsData, subjectIndex: number, dayIndex: number): Detail {
  const isDay = dayIndex >= 0
  const pick = (series: (number | null)[]) => (isDay ? series[dayIndex] : averageOrNull(series))
  const dayNote = (series: (number | null)[]) => {
    const today = series[dayIndex]
    const yesterday = dayIndex > 0 ? series[dayIndex - 1] : null
    if (today === null) return '이날 푼 문제 없음'
    if (yesterday === null) return '전날 기록 없음'
    const diff = today - yesterday
    return `전날보다 ${diff >= 0 ? '+' : ''}${diff}점`
  }
  const daySuffix = isDay ? ` · ${STATS_DAYS[dayIndex]}요일` : ''
  const totalHours = isDay ? data.totalHours[dayIndex] : sum(data.totalHours)

  if (subjectIndex < 0) {
    const allScores = allSubjectsAverage(data.subjects)
    const rows: DetailRow[] = data.subjects.map((s) => ({
      name: s.name,
      color: s.color,
      correct: pick(s.scores),
      // 그날 푼 문제 수는 예시에서만 압니다. (예시는 하루 10문제)
      solved: isDay ? (data.isDemo ? 10 : null) : sum(s.units.map((u) => u.solved)),
      // 과목별 공부 시간은 예시에만 있습니다. (서버 기록의 카드 타이머에는 과목이 없음)
      hours: data.isDemo ? (isDay ? s.hours[dayIndex] : sum(s.hours)) : null,
      speedSec: s.units.length > 0 ? average(s.units.map((u) => u.speedSec)) : null,
      speedDeltaSec: averageOrNull(s.units.map((u) => u.speedDeltaSec)),
    }))
    const speeds = rows.map((r) => r.speedSec)
    return {
      name: '전체',
      title: `전체 과목 분석${daySuffix}`,
      color: ALL_COLOR,
      score: pick(allScores),
      scoreNote: isDay ? dayNote(allScores) : data.all.weekDelta,
      hours: totalHours,
      hoursNote: '타이머 기록 전체',
      speedSec: averageOrNull(speeds),
      summary: data.all.summary,
      effect: data.all.effect,
      rowHeader: '과목',
      rows,
      reportFocus: data.all.reportFocus,
      reports: pickReports(data.all.reports, allScores, rows, dayIndex),
    }
  }

  const subject = data.subjects[subjectIndex]
  const weekHours = sum(subject.hours)
  const rows: DetailRow[] = subject.units.map((u) => ({
    name: u.name,
    color: u.color,
    correct: pick(u.dailyScores),
    // 요일을 고르면 예시는 하루치를 어림해서 보여 줍니다. 서버 기록은 그날 문제 수를 따로 주지 않습니다.
    solved: isDay ? (data.isDemo ? Math.max(1, Math.round(u.solved / 7)) : null) : u.solved,
    hours:
      u.hours === null
        ? null
        : isDay && weekHours > 0
          ? (u.hours * subject.hours[dayIndex]) / weekHours
          : u.hours,
    speedSec: u.speedSec,
    speedDeltaSec: u.speedDeltaSec,
  }))
  return {
    name: subject.name,
    title: `${subject.name} 상세 분석${daySuffix}`,
    color: subject.color,
    score: pick(subject.scores),
    scoreNote: isDay ? dayNote(subject.scores) : subject.weekDelta,
    // 과목별 공부 시간은 예시에만 있습니다. 서버 기록은 "전체" 에서만 봅니다.
    hours: data.isDemo ? (isDay ? subject.hours[dayIndex] : weekHours) : null,
    hoursNote: data.isDemo ? '타이머 기록' : '전체에서만 봐요',
    speedSec: subject.units.length > 0 ? average(subject.units.map((u) => u.speedSec)) : null,
    summary: subject.summary,
    effect: subject.effect,
    rowHeader: '단원',
    rows,
    reportFocus: subject.reportFocus,
    reports: pickReports(subject.reports, subject.scores, rows, dayIndex),
  }
}

/**
 * 보여 줄 일간 리포트를 고릅니다.
 * 이번 주 전체면 써 둔 리포트 전부, 요일을 고르면 그날 것 하나.
 * 그날 리포트가 없으면 그날 점수로 간단히 만듭니다. 그날 점수도 없으면 없음.
 */
function pickReports(
  reports: StatsReport[],
  scores: (number | null)[],
  rows: DetailRow[],
  dayIndex: number,
): StatsReport[] {
  if (dayIndex < 0) return reports
  const written = reports.filter((report) => report.dayIndex === dayIndex)
  if (written.length > 0) return written

  const score = scores[dayIndex]
  if (score === null) return []
  const yesterday = dayIndex > 0 ? scores[dayIndex - 1] : null
  const delta = yesterday === null ? 0 : score - yesterday
  const scored = rows.filter((row) => row.correct !== null) as (DetailRow & { correct: number })[]
  const sorted = [...scored].sort((a, b) => b.correct - a.correct)
  const best = sorted[0]?.name
  const worst = sorted[sorted.length - 1]?.name
  let note = `전날보다 ${Math.abs(delta)}점 내려갔어. ${worst ?? ''} 쪽을 내일 다시 볼게.`
  if (yesterday === null) note = '이날 점수를 기준으로 한 주 변화를 볼게.'
  else if (delta >= 0) note = `전날보다 ${delta}점 올랐어. ${best ?? ''} 쪽이 특히 좋았어.`
  return [
    {
      dayIndex,
      score,
      delta,
      note,
      tags:
        best && worst && best !== worst
          ? [
              ['가장 좋음', best],
              ['더 볼 것', worst],
            ]
          : [],
    },
  ]
}

/* ---------- 그래프 ---------- */

// 그래프 안의 좌표 (viewBox 기준). 점수 0 은 아래(280), 100 은 위(20)
const CHART_LEFT = 60
const CHART_RIGHT = 610
const CHART_TOP = 20
const CHART_BOTTOM = 280

function xOf(dayIndex: number): number {
  return CHART_LEFT + (dayIndex * (CHART_RIGHT - CHART_LEFT)) / 6
}

function yOf(score: number): number {
  return CHART_BOTTOM - (score / 100) * (CHART_BOTTOM - CHART_TOP)
}

/** 점수들을 polyline 의 points 글자로 바꿉니다. 점수가 없는 날은 건너뛰고 이어서 그립니다. */
function toPoints(scores: (number | null)[]): string {
  return scores
    .map((score, i) => (score === null ? null : `${xOf(i).toFixed(1)},${yOf(score).toFixed(1)}`))
    .filter((point) => point !== null)
    .join(' ')
}

/** 마지막으로 점수가 있는 날의 점수. 하나도 없으면 null */
function lastScore(scores: (number | null)[]): number | null {
  const numbers = scores.filter((score) => score !== null)
  return numbers.length > 0 ? numbers[numbers.length - 1] : null
}

/** 선 끝 이름들이 겹치지 않게 세로 위치를 22 이상 띄워서 돌려줍니다. (lastScores 와 같은 순서) */
function labelYs(lastScores: number[]): number[] {
  const order = lastScores.map((score, i) => ({ i, y: yOf(score) + 6 })).sort((a, b) => a.y - b.y)
  for (let k = 1; k < order.length; k++) {
    if (order[k].y - order[k - 1].y < 22) order[k].y = order[k - 1].y + 22
  }
  const result: number[] = []
  order.forEach((item) => (result[item.i] = item.y))
  return result
}

interface ScoreChartProps {
  lines: ChartLine[]
  /** 전체 평균 선 (검은 굵은 선). 없으면 null */
  averageLine: (number | null)[] | null
  /** 강조할 요일. -1 이면 없음 */
  dayIndex: number
  title: string
}

/** 꺾은선 그래프. 라이브러리 없이 SVG 로 그립니다. */
function ScoreChart({ lines, averageLine, dayIndex, title }: ScoreChartProps) {
  const all = averageLine
    ? [...lines, { name: '전체 평균', color: ALL_COLOR, scores: averageLine, faded: false }]
    : lines
  // 점수가 하루도 없는 선은 그리지 않습니다.
  const drawn = all.filter((line) => lastScore(line.scores) !== null)
  const ys = labelYs(drawn.map((line) => lastScore(line.scores) ?? 0))

  return (
    // 375px 에서는 그래프만 옆으로 밀어서 봅니다. (페이지 전체 가로 스크롤은 생기지 않음)
    <div className="mt-2 overflow-x-auto">
      <svg
        viewBox="0 -20 760 362"
        role="img"
        aria-label={`${title} 꺾은선 그래프`}
        // 휴대폰에서는 글자가 너무 작아지지 않게 최소 너비를 둡니다.
        className="block h-auto w-full min-w-[480px] sm:min-w-0"
      >
        {dayIndex >= 0 && (
          <rect x={xOf(dayIndex) - 35} y={10} width={70} height={306} rx={12} fill="#eef2ff" />
        )}
        {[100, 75, 50, 25, 0].map((score) => (
          <g key={score}>
            <line
              x1={CHART_LEFT}
              x2={CHART_RIGHT}
              y1={yOf(score)}
              y2={yOf(score)}
              stroke={score === 0 ? '#cbd5e1' : '#eef0f3'}
            />
            <text x={50} y={yOf(score) + 4} textAnchor="end" fontSize={15} fill="#64748b">
              {score}
            </text>
          </g>
        ))}
        <text x={50} y={0} textAnchor="end" fontSize={15} fontWeight={700} fill="#64748b">
          점수
        </text>
        {STATS_DAYS.map((day, i) => (
          <text
            key={day}
            x={xOf(i)}
            y={312}
            textAnchor="middle"
            fontSize={17}
            fontWeight={i === dayIndex ? 700 : 400}
            fill="#475569"
          >
            {day}
          </text>
        ))}
        <text x={335} y={340} textAnchor="middle" fontSize={15} fill="#64748b">
          요일
        </text>
        {drawn.length === 0 && (
          <text x={335} y={160} textAnchor="middle" fontSize={17} fill="#94a3b8">
            이번 주에 푼 확인 문제가 아직 없어요
          </text>
        )}

        {drawn.map((line, lineIndex) => {
          const isAverage = averageLine !== null && line.scores === averageLine
          const width = isAverage ? 5 : line.faded ? 2 : 3.5
          const opacity = line.faded ? 0.4 : 1
          return (
            <g key={line.name} opacity={opacity}>
              <polyline
                points={toPoints(line.scores)}
                fill="none"
                stroke={line.color}
                strokeWidth={width}
                strokeLinejoin="round"
              />
              {line.scores.map((score, i) =>
                score === null ? null : (
                  <circle
                    key={i}
                    cx={xOf(i)}
                    cy={yOf(score)}
                    r={isAverage ? 5 : 4}
                    fill={line.color}
                  />
                ),
              )}
              <text
                x={624}
                y={ys[lineIndex]}
                fontSize={isAverage ? 18 : 17}
                fontWeight={isAverage ? 900 : 700}
                fill={line.color}
              >
                {line.name}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/* ---------- 오른쪽 상세 분석 ---------- */

function DetailPanel({ detail, dateLabels }: { detail: Detail; dateLabels: string[] }) {
  const weakCount = detail.rows.filter(
    (row) => row.correct !== null && row.correct < WEAK_SCORE,
  ).length

  return (
    <Card className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden
          className="size-3.5 rounded-full"
          style={{ backgroundColor: detail.color }}
        />
        <h2 className="text-xl font-bold tracking-tight text-slate-900">{detail.title}</h2>
      </div>

      {/* 요약 숫자 4개. 375px 에서는 2 x 2 */}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
        <SummaryTile
          label="평균 정답률"
          value={detail.score === null ? '–' : `${detail.score}%`}
          note={detail.scoreNote}
        />
        <SummaryTile
          label="공부 시간"
          value={detail.hours === null ? '–' : formatHours(detail.hours)}
          note={detail.hoursNote}
        />
        <SummaryTile
          label="풀이 속도"
          value={detail.speedSec === null ? '–' : `${detail.speedSec}초`}
          note="한 문제당 평균"
        />
        <SummaryTile
          label="취약"
          value={`${weakCount}개`}
          note={`정답률 ${WEAK_SCORE}% 미만`}
          warn
        />
      </dl>

      <section>
        <h3 className="text-base font-bold text-slate-900">{detail.rowHeader}별 분석</h3>
        {detail.rows.length === 0 && (
          <p className="mt-2 text-sm text-slate-500">아직 푼 확인 문제가 없어요.</p>
        )}
        <ul className="mt-2 divide-y divide-slate-100">
          {detail.rows.map((row) => (
            <li key={row.name} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="flex items-center gap-2 font-bold text-slate-900">
                  {row.name}
                  {row.correct !== null && row.correct < WEAK_SCORE && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                      {detail.rowHeader === '단원' ? '취약' : '주의'}
                    </span>
                  )}
                </p>
                <p className="text-[13px] text-slate-500">
                  {row.hours !== null && `${formatHours(row.hours)} · `}
                  {row.speedSec !== null && <b className="text-slate-800">{row.speedSec}초</b>}
                  {row.speedDeltaSec !== null && (
                    <span
                      className={cn(
                        'ml-1 font-semibold',
                        row.speedDeltaSec < 0
                          ? 'text-emerald-700'
                          : row.speedDeltaSec > 0
                            ? 'text-orange-700'
                            : 'text-slate-500',
                      )}
                    >
                      ({formatSpeedDelta(row.speedDeltaSec)})
                    </span>
                  )}
                </p>
              </div>
              <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-slate-200">
                {/* 정답률만큼 막대를 채웁니다. 너비 · 색이 값마다 달라서 style 로 줍니다. */}
                <div style={{ width: `${row.correct ?? 0}%`, backgroundColor: row.color }} />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {row.correct === null ? (
                  '이날 푼 문제 없음'
                ) : (
                  <>
                    정답 <b className="text-slate-900">{row.correct}%</b> · 오답 {100 - row.correct}
                    %{row.solved !== null && ` · ${row.solved}문제`}
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="text-base font-bold text-slate-900">실력 변화 분석 · 일간 리포트</h3>
        <p className="mt-0.5 text-xs break-keep text-slate-500">{detail.reportFocus}</p>
        {detail.reports.length === 0 && (
          <p className="mt-2 text-sm text-slate-500">이 기간에는 리포트가 없어요.</p>
        )}
        <ul className="mt-2 flex flex-col gap-2">
          {detail.reports.map((report) => (
            <li
              key={report.dayIndex}
              className="flex gap-3 rounded-xl border-l-4 bg-slate-50 p-3"
              // 왼쪽 선 색이 과목마다 달라서 style 로 줍니다.
              style={{ borderLeftColor: detail.color }}
            >
              <div className="w-24 shrink-0">
                <p className="text-xs text-slate-500">{dateLabels[report.dayIndex]}</p>
                <p className="text-xl font-bold text-slate-900">{report.score}점</p>
                <p
                  className={cn(
                    'text-xs font-bold',
                    report.delta >= 0 ? 'text-emerald-700' : 'text-orange-700',
                  )}
                >
                  {report.delta >= 0 ? '▲' : '▼'} {Math.abs(report.delta)}점
                </p>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-1.5">
                  {report.tags.map(([label, value]) => (
                    <span
                      key={label}
                      className="rounded-full bg-white px-2.5 py-0.5 text-xs text-slate-700"
                    >
                      {label} <b>{value}</b>
                    </span>
                  ))}
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed break-keep text-slate-700">
                  {report.note}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </Card>
  )
}

interface SummaryTileProps {
  label: string
  value: string
  note: string
  /** true 면 주황 바탕 (취약 개수) */
  warn?: boolean
}

function SummaryTile({ label, value, note, warn = false }: SummaryTileProps) {
  return (
    <div className={cn('rounded-xl p-3', warn ? 'bg-amber-50' : 'bg-slate-50')}>
      <dt className={cn('text-xs', warn ? 'text-amber-800' : 'text-slate-500')}>{label}</dt>
      <dd className={cn('text-xl font-bold', warn ? 'text-amber-800' : 'text-slate-900')}>
        {value}
      </dd>
      <dd className={cn('text-xs', warn ? 'text-amber-800' : 'text-slate-500')}>{note}</dd>
    </div>
  )
}
