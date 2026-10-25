import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { Card } from '@/components/ui/Card'
import { ChipButton } from '@/components/ui/ChipButton'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Skeleton } from '@/components/ui/Skeleton'
import { useCards } from '@/hooks/useCards'
import { useQueryParam } from '@/hooks/useQueryParam'
import { useStudySessions } from '@/hooks/useStudySessions'
import { useSubjects } from '@/hooks/useSubjects'
import { answerChecksQuery } from '@/lib/answerChecksApi'
import { cn } from '@/lib/cn'
import { formatMinutes } from '@/lib/dailyRecords'
import { getTodayKey, isDateKey, moveDateKey } from '@/lib/date'
import {
  buildQuizWeeks,
  daySummary,
  isWeakUnit,
  previousScore,
  previousUnitRate,
  sumReviews,
  unitSpan,
  weekDates,
  WEEKDAY_LABELS,
  weekStartOf,
  weekSummary,
  type SubjectWeek,
  type UnitStat,
} from '@/lib/quizReport'
import { serverQuizCountsQuery } from '@/lib/quizResultsApi'
import { loadQuizResults } from '@/lib/studyQuiz'
import { usePrefetchQuery, useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

/** '2026-10-19' -> '10월 19일 (월)' */
function dateLabel(dateKey: string, index: number): string {
  const [, month, day] = dateKey.split('-').map(Number)
  return `${month}월 ${day}일 (${WEEKDAY_LABELS[index]})`
}

/** '2026-10-19' -> '10.19' */
function shortDate(dateKey: string): string {
  const [, month, day] = dateKey.split('-').map(Number)
  return `${month}.${day}`
}

/** 공부 시간 글자. 0분이면 기록이 없는 것이라 '–' 로 보여 줍니다. */
function minutesText(minutes: number): string {
  return minutes > 0 ? formatMinutes(minutes) : '–'
}

/**
 * 문제 풀이 주간 리포트 화면(/records/quiz)입니다. 기록 탭의 [문제 풀이 리포트] 에서 들어옵니다. (2026-10-24)
 *
 * - 과목 버튼으로 과목을 고르고, 그 과목의 요일별 점수를 꺾은선 그래프로 봅니다.
 * - 처음에는 오른쪽 창에 한 주 전체 평균이 나오고, 요일을 누르면 그날 기록이 나옵니다. [전체 평균] 으로 돌아갑니다.
 * - 아래 주간 정리표에서 요일마다 한 줄씩 봅니다.
 * - 보고 있는 주 · 과목 · 요일은 주소(?week= &subject= &day=)에 둡니다. 숫자 계산은 lib/quizReport.ts 가 합니다.
 */
export function QuizReportPage() {
  const thisWeekStart = weekStartOf(getTodayKey())
  const [weekParam, setWeekParam] = useQueryParam('week', thisWeekStart, { replace: true })
  const [, setDayParam] = useQueryParam('day', '', { replace: true })

  // 주소의 값은 누구나 고칠 수 있어서, 날짜가 아니거나 앞으로의 주면 이번 주로 봅니다.
  const weekStart =
    isDateKey(weekParam) && weekParam <= thisWeekStart ? weekStartOf(weekParam) : thisWeekStart
  const dates = weekDates(weekStart)

  function handleMoveWeek(days: number) {
    setWeekParam(moveDateKey(weekStart, days))
    setDayParam('')
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[28px] leading-tight font-bold tracking-tight">문제 풀이 리포트</h1>

      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="지난주"
          onClick={() => handleMoveWeek(-7)}
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-lg text-slate-600 hover:bg-slate-200"
        >
          ‹
        </button>
        <p className="min-w-0 flex-1 text-center text-[15px] font-semibold text-slate-800 sm:flex-none">
          {dateLabel(dates[0], 0)} ~ {dateLabel(dates[6], 6)}
        </p>
        <button
          type="button"
          aria-label="다음 주"
          disabled={weekStart === thisWeekStart}
          onClick={() => handleMoveWeek(7)}
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-lg text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
        >
          ›
        </button>
      </div>

      {/* 사진 채점 결과는 서버에서 받아옵니다. 받아오는 동안은 자리 표시, 못 받아오면 다시 시도 안내가 나옵니다. */}
      <AsyncBoundary
        pendingFallback={
          <div className="flex flex-col gap-4">
            <Skeleton className="h-10 w-48 rounded-full" />
            <Skeleton className="h-80 w-full rounded-2xl" />
          </div>
        }
        errorMessage="사진 채점 결과를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요."
        resetKeys={[weekStart]}
      >
        <QuizReportBody weekStart={weekStart} />
      </AsyncBoundary>
    </div>
  )
}

interface QuizReportBodyProps {
  /** 보고 있는 주의 월요일 'YYYY-MM-DD' */
  weekStart: string
}

/** 과목 버튼 · 그래프 · 오른쪽 창 · 정리표. 사진 채점 결과를 받아오는(useSuspenseQueries) 부분이라 AsyncBoundary 안에 둡니다. */
function QuizReportBody({ weekStart }: QuizReportBodyProps) {
  const subjects = useSubjects()
  const { cards } = useCards()
  const { sessions } = useStudySessions()
  // 이 기기의 채팅 확인 문제 결과(lib/studyQuiz.ts)는 화면을 열 때 한 번 읽습니다.
  const [results] = useState(loadQuizResults)
  const [subjectParam, setSubjectParam] = useQueryParam('subject', '', { replace: true })
  const [dayParam, setDayParam] = useQueryParam('day', '', { replace: true })

  const dates = weekDates(weekStart)
  // 서버에만 있는 확인 문제 결과(다른 기기에서 푼 것 등)를 사진 채점과 "같이" 받기 시작합니다.
  // 이 줄이 없으면 아래 useSuspenseQuery 는 사진 채점을 다 받은 뒤에야 불려서 늦어집니다.
  usePrefetchQuery(serverQuizCountsQuery(weekStart))
  // 지난주 점수도 내야 해서 지난주 7일 + 이번 주 7일의 사진 채점 결과를 받아옵니다. (서버 약속이 날짜 하나씩이라 요청 14개)
  const checkQueries = useSuspenseQueries({
    queries: [...weekDates(moveDateKey(weekStart, -7)), ...dates].map((date) =>
      answerChecksQuery(date),
    ),
  })
  const answerChecks = checkQueries.flatMap((query) => query.data)
  // 서버의 확인 문제 결과는 못 받아도 에러 대신 null 이라서, 이 기기의 결과만으로 셉니다. (lib/quizResultsApi.ts)
  const { data: serverCounts } = useSuspenseQuery(serverQuizCountsQuery(weekStart))

  const weeks = buildQuizWeeks({
    results,
    answerChecks,
    serverCounts: serverCounts ?? [],
    sessions,
    cards,
    subjects,
    weekStart,
  })
  const week = weeks.find((item) => item.name === subjectParam) ?? weeks[0]
  // 'day' 는 0(월) ~ 6(일). 그 밖의 값이면 요일을 안 고른 것(전체 평균)으로 봅니다.
  const dayIndex = /^[0-6]$/.test(dayParam) ? Number(dayParam) : null

  if (!week) {
    return (
      <Card>
        <p className="font-semibold text-slate-900">이 주에 푼 문제가 없어요</p>
        <p className="mt-1 text-sm text-slate-500">
          채팅에서 확인 문제를 풀거나, 통계 탭에서 문제집 사진을 채점하면 과목별 점수가 여기에
          쌓여요.
        </p>
      </Card>
    )
  }

  return (
    <>
      <div role="group" aria-label="과목 고르기" className="flex flex-wrap gap-2">
        {weeks.map((item) => (
          <ChipButton
            key={item.name}
            selected={item.name === week.name}
            onClick={() => setSubjectParam(item.name)}
          >
            {item.name}
          </ChipButton>
        ))}
      </div>

      {/* PC 는 [그래프 | 오른쪽 창] 두 칸, 모바일은 위아래로 쌓습니다. */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[17px] font-bold tracking-tight text-slate-900">
                {week.name} 점수
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">요일별 문제 풀이 점수 (100점 만점)</p>
            </div>
            <ChipButton
              selected={dayIndex === null}
              onClick={() => setDayParam('')}
              className="shrink-0"
            >
              전체 평균
            </ChipButton>
          </div>
          <ScoreChart
            week={week}
            dates={dates}
            selected={dayIndex}
            onSelect={(index) => setDayParam(String(index))}
            className="mt-4"
          />
        </Card>

        <Card aria-live="polite">
          {dayIndex === null ? (
            <WeekPanel week={week} dates={dates} />
          ) : (
            <DayPanel
              week={week}
              index={dayIndex}
              date={dates[dayIndex]}
              onBack={() => setDayParam('')}
            />
          )}
        </Card>
      </div>

      <Card title={`${week.name} 주간 정리표`}>
        <SummaryTable
          week={week}
          dates={dates}
          selected={dayIndex}
          onSelect={(index) => setDayParam(String(index))}
        />
      </Card>

      <p className="text-xs leading-relaxed text-slate-500">
        점수는 그날 처음 푼 문제(채팅 확인 문제 + 사진 채점)의 정답률이에요. 사진 채점의
        &lsquo;애매&rsquo;는 빼요. 틀린 확인 문제를 다시 풀어 맞힌 건 점수에 넣지 않고 &lsquo;오답
        다시 풀기&rsquo;로 따로 보여 줘요. 단원은 확인 문제를 낼 때 적은 주제로 나누고, 사진 채점은
        한 칸으로 모아요. 풀이 속도는 이 기기에서 푼 확인 문제에만 있어요. 다른 기기에서 푼 확인
        문제는 서버에 과목 · 단원별 맞은 수만 있어서, AI 가 정한 단원으로 점수에만 더해요.
      </p>
    </>
  )
}

// ---- 그래프 ----

interface ScoreChartProps {
  week: SubjectWeek
  dates: string[]
  selected: number | null
  onSelect: (index: number) => void
  className?: string
}

// 세로축 눈금 (점수)
const SCORE_TICKS = [100, 75, 50, 25, 0]

/**
 * 요일별 점수 꺾은선 그래프. 차트 라이브러리 없이 SVG 로 그립니다. (components/ui/GrowthCurveChart.tsx 와 같은 방법)
 * - 선 · 눈금선은 SVG, 점 · 글자 · 요일 버튼은 HTML 입니다. SVG 를 가로로 늘여도 점이 찌그러지거나 글자가 작아지지 않게 하려는 것입니다.
 * - 문제를 안 푼 날은 점을 찍지 않고, 앞뒤 날을 점선으로 잇습니다.
 */
function ScoreChart({ week, dates, selected, onSelect, className }: ScoreChartProps) {
  // 7칸 중 index 번째 칸의 가운데(왼쪽에서 %), 점수의 높이(위에서 %)
  const xOf = (index: number) => ((index + 0.5) / 7) * 100
  const yOf = (rate: number) => 100 - rate
  const points = week.days.flatMap((stat, index) =>
    stat ? [{ index, x: xOf(index), y: yOf(stat.rate), rate: stat.rate }] : [],
  )
  // 하루도 안 빠지고 이어진 날끼리 묶습니다. 예: [[월, 화], [목, 금]] → 화와 목 사이는 점선
  const runs: (typeof points)[] = []
  for (const point of points) {
    const run = runs[runs.length - 1]
    if (run && run[run.length - 1].index === point.index - 1) run.push(point)
    else runs.push([point])
  }
  // SVG 좌표는 가로 700 × 세로 100 이라 가로 % 에 7 을 곱합니다.
  const toPoints = (run: typeof points) => run.map((point) => `${point.x * 7},${point.y}`).join(' ')
  // 점수 글자는 고른 날에만, 안 골랐으면 마지막으로 푼 날에만 붙입니다.
  const labelPoint = points.find(
    (point) => point.index === (selected ?? points[points.length - 1]?.index),
  )

  return (
    <div className={className}>
      <div className="flex gap-2">
        <div className="relative mt-6 h-44 w-7 shrink-0 sm:h-52" aria-hidden="true">
          {SCORE_TICKS.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 -translate-y-1/2 text-xs text-slate-400 tabular-nums"
              // 눈금 높이가 점수마다 달라서 Tailwind 클래스로 쓸 수 없어 style 로 줍니다.
              style={{ top: `${yOf(tick)}%` }}
            >
              {tick}
            </span>
          ))}
        </div>

        <div className="relative mt-6 h-44 min-w-0 flex-1 sm:h-52">
          <svg
            viewBox="0 0 700 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full overflow-visible"
            aria-hidden="true"
          >
            {selected !== null && (
              <rect
                x={selected * 100 + 4}
                y={0}
                width={92}
                height={100}
                className="fill-brand-light"
              />
            )}
            {SCORE_TICKS.map((tick) => (
              <line
                key={tick}
                x1={0}
                x2={700}
                y1={yOf(tick)}
                y2={yOf(tick)}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                className={tick === 0 ? 'stroke-slate-300' : 'stroke-slate-100'}
              />
            ))}
            {runs.slice(1).map((run, order) => {
              const before = runs[order][runs[order].length - 1]
              return (
                <line
                  key={`gap-${run[0].index}`}
                  x1={before.x * 7}
                  y1={before.y}
                  x2={run[0].x * 7}
                  y2={run[0].y}
                  strokeWidth={1.5}
                  strokeDasharray="4 5"
                  vectorEffect="non-scaling-stroke"
                  className="stroke-slate-300"
                />
              )
            })}
            {runs
              .filter((run) => run.length > 1)
              .map((run) => (
                <g key={`run-${run[0].index}`}>
                  <polygon
                    points={`${toPoints(run)} ${run[run.length - 1].x * 7},100 ${run[0].x * 7},100`}
                    className="fill-brand/10"
                  />
                  <polyline
                    points={toPoints(run)}
                    fill="none"
                    strokeWidth={2.5}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    className="stroke-brand"
                  />
                </g>
              ))}
          </svg>

          {points.map((point) => (
            <span
              key={point.index}
              className={cn(
                'bg-brand pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white',
                point.index === selected ? 'size-3.5 ring-4' : 'size-2.5',
              )}
              // 점의 자리가 점수마다 달라서 Tailwind 클래스로 쓸 수 없어 style 로 줍니다.
              style={{ left: `${point.x}%`, top: `${point.y}%` }}
            />
          ))}
          {labelPoint && (
            <span
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-full pb-2 text-xs font-bold text-slate-900 tabular-nums"
              style={{ left: `${labelPoint.x}%`, top: `${labelPoint.y}%` }}
            >
              {labelPoint.rate}점
            </span>
          )}

          {/* 그래프의 요일 칸 어디를 눌러도 그날을 고릅니다. 키보드 · 화면 읽기 프로그램은 아래 요일 버튼을 씁니다. */}
          <div className="absolute inset-0 grid grid-cols-7">
            {dates.map((date, index) => (
              <button
                key={date}
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                onClick={() => onSelect(index)}
                className="cursor-pointer"
              />
            ))}
          </div>
        </div>
      </div>

      {/* 요일 버튼이 가로축입니다. 세로축 글자 칸(w-7)과 사이(gap-2)만큼 왼쪽을 띄워 그래프 칸과 맞춥니다. */}
      <div role="group" aria-label="요일 고르기" className="mt-2 ml-9 grid grid-cols-7 gap-1">
        {dates.map((date, index) => {
          const stat = week.days[index]
          return (
            <button
              key={date}
              type="button"
              aria-pressed={selected === index}
              aria-label={`${dateLabel(date, index)}, ${stat ? `${stat.rate}점` : '문제 안 풂'}`}
              onClick={() => onSelect(index)}
              className={cn(
                'flex h-12 cursor-pointer flex-col items-center justify-center rounded-xl text-sm font-semibold transition-colors',
                selected === index
                  ? 'bg-brand-light text-brand'
                  : 'text-slate-700 hover:bg-slate-50',
                !stat && selected !== index && 'text-slate-400',
              )}
            >
              {WEEKDAY_LABELS[index]}
              <span className="text-[11px] font-normal text-slate-400 tabular-nums">
                {shortDate(date)}
              </span>
            </button>
          )
        })}
      </div>
      {runs.length > 1 && (
        <p className="mt-2 flex items-center gap-2 text-xs text-slate-500">
          <span aria-hidden="true" className="w-5 border-t border-dashed border-slate-400" />
          문제를 안 푼 날은 점을 찍지 않고 점선으로 이어요
        </p>
      )}
    </div>
  )
}

// ---- 오른쪽 창: 전체 평균 · 요일 ----

interface WeekPanelProps {
  week: SubjectWeek
  dates: string[]
}

/** 요일을 안 골랐을 때: 이 과목의 한 주 전체 평균 */
function WeekPanel({ week, dates }: WeekPanelProps) {
  const stat = week.week
  const review = sumReviews(week.reviews)
  const eyebrow = `${week.name} · 이번 주 전체 평균`
  if (!stat) {
    // 새로 푼 문제는 없고 다시 나온 오답만 푼 주
    return (
      <div>
        <p className="text-brand text-[13px] font-bold">{eyebrow}</p>
        <p className="mt-2 text-lg font-bold text-slate-900">
          이번 주에 새로 푼 {week.name} 문제가 없어요
        </p>
        <ReviewNote review={review} when="이번 주" />
      </div>
    )
  }

  const totalMinutes = sumOf(week.minutes)
  const studyDays = week.minutes.filter((minutes) => minutes > 0).length
  const solvedDays = week.days.flatMap((day, index) => (day ? [{ index, rate: day.rate }] : []))
  const best = solvedDays.reduce((top, day) => (day.rate > top.rate ? day : top))
  const worst = solvedDays.reduce((low, day) => (day.rate < low.rate ? day : low))

  return (
    <div>
      <PanelHead
        eyebrow={eyebrow}
        rate={stat.rate}
        previous={week.lastWeekRate === null ? null : { label: '지난주', rate: week.lastWeekRate }}
      >
        <p className="mt-1.5 text-[13px] text-slate-500">
          {shortDate(dates[0])} ~ {shortDate(dates[6])} · 요일을 누르면 그날 기록이 나와요
        </p>
      </PanelHead>

      <PanelSection title="정답률 · 오답률">
        <Accuracy total={stat.total} correct={stat.correct} rate={stat.rate} />
        <h4 className="mt-1 text-[13px] font-bold text-slate-700">틀린 단원 (한 주 합계)</h4>
        <WrongUnits units={stat.units} />
      </PanelSection>

      <PanelSection title="이 과목 공부 시간">
        <p className="text-2xl font-bold text-slate-900">{minutesText(totalMinutes)}</p>
        <p className="text-xs text-slate-500">
          {totalMinutes > 0
            ? `하루 평균 ${formatMinutes(Math.round(totalMinutes / 7))} · 7일 중 ${studyDays}일 공부했어요.`
            : '이번 주 이 과목 공부 기록이 없어요.'}
        </p>
      </PanelSection>

      <PanelSection title="단원별 풀이 속도 (문제당, 주간 평균)">
        <SpeedBars units={stat.units} />
      </PanelSection>

      <PanelSection title="실력 변화 분석 (이번 주 처음 → 마지막)">
        <ul className="flex flex-col gap-2">
          {stat.units.map((unit) => {
            const span = unitSpan(week, unit.name)
            return (
              <li key={unit.name} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-semibold text-slate-900">{unit.name}</span>
                <span className="flex shrink-0 items-center gap-2 text-slate-600 tabular-nums">
                  {span && span.count > 1 ? (
                    <>
                      {span.first.label} {span.first.rate}% → {span.last.label} {span.last.rate}%
                      <Delta value={span.last.rate - span.first.rate} unit="%p" />
                    </>
                  ) : (
                    `${span?.first.label ?? ''} 한 번 · ${unit.rate}%`
                  )}
                </span>
              </li>
            )
          })}
        </ul>
        {solvedDays.length > 1 && (
          <p className="text-[13px] text-slate-600">
            가장 높은 날 {WEEKDAY_LABELS[best.index]}요일 {best.rate}점 · 가장 낮은 날{' '}
            {WEEKDAY_LABELS[worst.index]}요일 {worst.rate}점
          </p>
        )}
        <ReviewNote review={review} when="이번 주" />
        <SummaryBox text={weekSummary(week)} />
      </PanelSection>
    </div>
  )
}

interface DayPanelProps {
  week: SubjectWeek
  index: number
  date: string
  onBack: () => void
}

/** 요일 하나를 골랐을 때: 그날 기록 */
function DayPanel({ week, index, date, onBack }: DayPanelProps) {
  const stat = week.days[index]
  const minutes = week.minutes[index]
  const review = week.reviews[index]
  const eyebrow = `${week.name} · ${dateLabel(date, index)}`

  if (!stat) {
    return (
      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-brand text-[13px] font-bold">{eyebrow}</p>
          <BackButton onClick={onBack} />
        </div>
        <p className="mt-2 text-lg font-bold text-slate-900">
          이날은 {week.name} 문제를 안 풀었어요
        </p>
        <p className="mt-1 text-sm text-slate-500">
          {minutes > 0
            ? `공부는 ${formatMinutes(minutes)} 했어요. 공부한 내용을 확인 문제로 풀면 여기에 그날 기록이 생겨요.`
            : '그래프에서는 점을 찍지 않고 앞뒤 날을 점선으로 이어요.'}
        </p>
        {review.of > 0 && <ReviewNote review={review} when="이날" />}
      </div>
    )
  }

  const averageMinutes = Math.round(sumOf(week.minutes) / 7)
  // 단원 이름 → 이번 주 평균(초). 시간을 잰 문제가 없는 단원(사진 채점)은 넣지 않습니다.
  const weekSeconds = new Map<string, number>()
  for (const unit of week.week?.units ?? []) {
    if (unit.seconds !== null) weekSeconds.set(unit.name, unit.seconds)
  }

  return (
    <div>
      <PanelHead
        eyebrow={eyebrow}
        rate={stat.rate}
        previous={previousScore(week, index)}
        onBack={onBack}
      />

      <PanelSection title="정답률 · 오답률">
        <Accuracy total={stat.total} correct={stat.correct} rate={stat.rate} />
        <h4 className="mt-1 text-[13px] font-bold text-slate-700">틀린 단원</h4>
        <WrongUnits units={stat.units} />
      </PanelSection>

      <PanelSection title="이 과목 공부 시간">
        <p className="text-2xl font-bold text-slate-900">{minutesText(minutes)}</p>
        <p className="text-xs text-slate-500">{compareMinutes(minutes, averageMinutes)}</p>
      </PanelSection>

      <PanelSection title="단원별 풀이 속도 (문제당)">
        <SpeedBars units={stat.units} weekSeconds={weekSeconds} />
      </PanelSection>

      <PanelSection title="실력 변화 분석">
        <ul className="flex flex-col gap-2">
          {stat.units.map((unit) => {
            const before = previousUnitRate(week, index, unit.name)
            return (
              <li key={unit.name} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-semibold text-slate-900">{unit.name}</span>
                <span className="flex shrink-0 items-center gap-2 text-slate-600 tabular-nums">
                  {before ? (
                    <>
                      {before.label} {before.rate}% → {unit.rate}%
                      <Delta value={unit.rate - before.rate} unit="%p" />
                    </>
                  ) : (
                    `이번 주 처음 · ${unit.rate}%`
                  )}
                </span>
              </li>
            )
          })}
        </ul>
        <ReviewNote review={review} when="이날" />
        <SummaryBox text={daySummary(week, index)} />
      </PanelSection>
    </div>
  )
}

/** 숫자 목록의 합 */
function sumOf(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

/** 그날 공부 시간을 이번 주 하루 평균과 비교하는 문장 */
function compareMinutes(minutes: number, averageMinutes: number): string {
  if (averageMinutes === 0) return '이번 주 이 과목 공부 기록이 없어요.'
  const diff = minutes - averageMinutes
  const average = `이번 주 하루 평균(${formatMinutes(averageMinutes)})`
  if (diff > 0) return `${average}보다 ${formatMinutes(diff)} 더 했어요.`
  if (diff < 0) return `${average}보다 ${formatMinutes(-diff)} 덜 했어요.`
  return `${average}과 같아요.`
}

interface PanelHeadProps {
  eyebrow: string
  rate: number
  /** 비교할 점수. 없으면 null */
  previous: { label: string; rate: number } | null
  /** 있으면 오른쪽 위에 [전체 평균 보기] 버튼을 답니다. (요일 화면) */
  onBack?: () => void
  children?: ReactNode
}

/** 오른쪽 창 맨 위: 과목 · 날짜, 큰 점수, 앞과 비교 */
function PanelHead({ eyebrow, rate, previous, onBack, children }: PanelHeadProps) {
  return (
    <div className="pb-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-brand text-[13px] font-bold">{eyebrow}</p>
        {onBack && <BackButton onClick={onBack} />}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <p className="text-4xl font-bold tracking-tight text-slate-900 tabular-nums">
          {rate}
          <span className="ml-0.5 text-lg font-semibold text-slate-600">점</span>
        </p>
        {previous ? (
          <>
            <Delta value={rate - previous.rate} unit="점" />
            <span className="text-[13px] text-slate-500">
              {previous.label} {previous.rate}점과 비교
            </span>
          </>
        ) : (
          <span className="text-[13px] text-slate-500">비교할 앞 기록이 없어요</span>
        )}
      </div>
      {children}
    </div>
  )
}

interface BackButtonProps {
  onClick: () => void
}

/** 요일 화면에서 전체 평균으로 돌아가는 버튼 */
function BackButton({ onClick }: BackButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-brand-light text-brand h-10 shrink-0 cursor-pointer rounded-full px-3.5 text-sm font-semibold hover:bg-indigo-100"
    >
      전체 평균 보기
    </button>
  )
}

interface PanelSectionProps {
  title: string
  children: ReactNode
}

/** 오른쪽 창의 칸 하나 (정답률 · 공부 시간 …). 칸 사이는 얇은 줄로 나눕니다. */
function PanelSection({ title, children }: PanelSectionProps) {
  return (
    <section className="flex flex-col gap-2.5 border-t border-slate-100 py-4 last:pb-0">
      <h3 className="text-[13px] font-bold text-slate-500">{title}</h3>
      {children}
    </section>
  )
}

interface AccuracyProps {
  total: number
  correct: number
  rate: number
}

/** 정답률 · 오답률 두 숫자와 막대 */
function Accuracy({ total, correct, rate }: AccuracyProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">{rate}%</p>
          <p className="text-[13px] text-slate-500">
            정답률 · {total}문제 중 {correct}개
          </p>
        </div>
        <div>
          <p className="text-2xl font-bold text-red-600 tabular-nums">{100 - rate}%</p>
          <p className="text-[13px] text-slate-500">오답률 · {total - correct}개 틀림</p>
        </div>
      </div>
      <ProgressBar value={rate} />
    </>
  )
}

interface WrongUnitsProps {
  units: UnitStat[]
}

/** 틀린 문제가 있는 단원. 정답률이 낮은 단원부터, 취약 단원에는 표시를 붙입니다. */
function WrongUnits({ units }: WrongUnitsProps) {
  const wrongUnits = units
    .filter((unit) => unit.correct < unit.total)
    .sort((a, b) => a.rate - b.rate)
  if (wrongUnits.length === 0) return <p className="text-sm text-slate-500">틀린 문제가 없어요.</p>
  return (
    <ul className="flex flex-col gap-2">
      {wrongUnits.map((unit) => (
        <li key={unit.name} className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate font-semibold text-slate-900">{unit.name}</span>
          <span className="flex shrink-0 items-center gap-2 text-slate-600 tabular-nums">
            {unit.total}문제 중 {unit.total - unit.correct}개 틀림
            {isWeakUnit(unit) && (
              <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-xs font-bold text-red-700">
                취약
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

interface SpeedBarsProps {
  units: UnitStat[]
  /** 단원 이름 → 이번 주 평균(초). 있으면 막대 위에 세로 선으로 같이 그립니다. (요일 화면) */
  weekSeconds?: Map<string, number>
}

/** 단원별로 문제 하나에 걸린 평균 시간 막대 + "빨리 풀고 틀림" 안내 */
function SpeedBars({ units, weekSeconds }: SpeedBarsProps) {
  // 풀이 시간은 채팅 확인 문제에만 있어서, 시간을 잰 단원만 그립니다. (사진 채점 칸은 빠집니다)
  const timedUnits = units.flatMap((unit) =>
    unit.seconds === null ? [] : [{ ...unit, seconds: unit.seconds }],
  )
  if (timedUnits.length === 0) {
    return <p className="text-sm text-slate-500">풀이 시간은 채팅 확인 문제를 풀어야 생겨요.</p>
  }
  // 가장 긴 값이 막대 끝에 붙지 않게 조금 여유를 둡니다.
  const longest =
    Math.max(
      1,
      ...timedUnits.map((unit) => Math.max(unit.seconds, weekSeconds?.get(unit.name) ?? 0)),
    ) * 1.1
  const fastUnits = timedUnits.filter((unit) => unit.fastWrong > 0)
  return (
    <>
      <ul className="flex flex-col gap-2.5">
        {timedUnits.map((unit) => {
          const average = weekSeconds?.get(unit.name)
          return (
            <li
              key={unit.name}
              className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm"
            >
              <span className="truncate font-semibold text-slate-900">{unit.name}</span>
              <span className="relative h-2 rounded-full bg-slate-100">
                {/* 막대 길이와 평균 선 자리가 숫자마다 달라서 style 로 줍니다. */}
                <span
                  className="bg-brand absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${(unit.seconds / longest) * 100}%` }}
                />
                {average !== undefined && (
                  <span
                    className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded bg-slate-700"
                    style={{ left: `${(average / longest) * 100}%` }}
                  />
                )}
              </span>
              <span className="text-slate-600 tabular-nums">{unit.seconds}초</span>
            </li>
          )
        })}
      </ul>
      {weekSeconds && (
        <p className="text-xs text-slate-500">세로 선은 이번 주 이 단원 평균이에요.</p>
      )}
      {fastUnits.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-slate-700">
          <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-bold text-amber-700">
            빨리 풀고 틀림
          </span>
          {fastUnits.map((unit) => `${unit.name} ${unit.fastWrong}개`).join(', ')}. 실수였는지
          해설을 다시 봐요.
        </p>
      )}
    </>
  )
}

interface ReviewNoteProps {
  review: { fixed: number; of: number }
  /** '이날' · '이번 주' */
  when: string
}

/** 다시 나온 오답을 몇 개 맞혔는지 */
function ReviewNote({ review, when }: ReviewNoteProps) {
  return (
    <p className="text-[13px] text-slate-600">
      {review.of > 0 ? (
        <>
          다시 나온 오답 {review.of}문제 중{' '}
          <b className="font-bold text-slate-900">{review.fixed}개</b>를 맞혔어요.{' '}
          <span className="text-slate-500">(점수에는 안 넣어요)</span>
        </>
      ) : (
        `${when} 다시 나온 오답은 없어요.`
      )}
    </p>
  )
}

interface SummaryBoxProps {
  text: string
}

/** 한 줄 정리. 숫자는 lib/quizReport.ts 가 계산하고, 문장도 거기서 규칙으로 만듭니다. */
function SummaryBox({ text }: SummaryBoxProps) {
  return (
    <p className="bg-brand-light rounded-xl px-3.5 py-3 text-[15px] leading-relaxed text-slate-800">
      <span className="text-brand mb-0.5 block text-xs font-bold">한 줄 정리</span>
      {text}
    </p>
  )
}

// ---- 주간 정리표 ----

interface SummaryTableProps {
  week: SubjectWeek
  dates: string[]
  selected: number | null
  onSelect: (index: number) => void
}

/** 요일마다 한 줄 + 맨 아래 주간 줄. 요일 글자를 누르면 그날을 고릅니다. */
function SummaryTable({ week, dates, selected, onSelect }: SummaryTableProps) {
  const total = week.week
  return (
    <>
      {/* 표가 화면보다 넓으면 표만 옆으로 밀어 봅니다. (화면 전체에 가로 스크롤이 생기지 않게)
          relative: 표 안의 화면 읽기용 글자(sr-only, position: absolute)가 이 칸 밖으로 빠져나가
          화면 전체를 넓히지 않게 이 칸을 기준으로 둡니다. (없으면 390px 휴대폰에서 문서 폭이 666px 이 됨) */}
      <div className="relative -mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
        {/* whitespace-nowrap: 좁은 화면에서 '100점' 이 두 줄로 꺾이지 않게 칸 글자를 한 줄로 둡니다. */}
        <table className="w-full min-w-[640px] text-sm whitespace-nowrap tabular-nums">
          <thead>
            <tr className="border-b border-slate-200 text-xs text-slate-500">
              <th scope="col" className="py-2 pr-3 text-left font-semibold">
                요일
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                점수
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                맞힌 / 푼 문제
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                오답률
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                취약 단원
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                공부 시간
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                풀이 속도
              </th>
              <th scope="col" className="py-2 pl-3 text-left font-semibold">
                점수 변화
              </th>
            </tr>
          </thead>
          <tbody>
            {dates.map((date, index) => {
              const stat = week.days[index]
              const previous = previousScore(week, index)
              return (
                <tr
                  key={date}
                  className={cn(
                    'border-b border-slate-100',
                    selected === index && 'bg-brand-light',
                  )}
                >
                  <th scope="row" className="pr-3 text-left">
                    <button
                      type="button"
                      aria-pressed={selected === index}
                      onClick={() => onSelect(index)}
                      className={cn(
                        'h-10 cursor-pointer font-semibold whitespace-nowrap hover:underline',
                        selected === index ? 'text-brand' : 'text-slate-900',
                      )}
                    >
                      {WEEKDAY_LABELS[index]}요일
                      <span className="ml-1.5 text-xs font-normal text-slate-400">
                        {shortDate(date)}
                      </span>
                    </button>
                  </th>
                  {stat ? (
                    <>
                      <td className="px-3 text-right font-bold">{stat.rate}점</td>
                      <td className="px-3 text-right">
                        {stat.correct} / {stat.total}
                      </td>
                      <td className="px-3 text-right">{100 - stat.rate}%</td>
                      <td className="px-3">
                        <WeakTags units={stat.units.filter(isWeakUnit)} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 text-right text-slate-400">–</td>
                      <td className="px-3 text-right text-slate-400">안 풂</td>
                      <td className="px-3 text-right text-slate-400">–</td>
                      <td className="px-3 text-slate-400">–</td>
                    </>
                  )}
                  <td className="px-3 text-right whitespace-nowrap">
                    {minutesText(week.minutes[index])}
                  </td>
                  <td className="px-3 text-right">
                    {stat && stat.seconds !== null ? `${stat.seconds}초` : '–'}
                  </td>
                  <td className="pl-3">
                    {stat && previous ? <Delta value={stat.rate - previous.rate} unit="점" /> : '–'}
                  </td>
                </tr>
              )
            })}
          </tbody>
          {total && (
            <tfoot>
              <tr className="font-bold">
                <th scope="row" className="py-3 pr-3 text-left">
                  주간
                </th>
                <td className="px-3 text-right">{total.rate}점</td>
                <td className="px-3 text-right">
                  {total.correct} / {total.total}
                </td>
                <td className="px-3 text-right">{100 - total.rate}%</td>
                <td className="px-3">
                  <WeakTags units={total.units.filter(isWeakUnit)} />
                </td>
                <td className="px-3 text-right whitespace-nowrap">
                  {minutesText(sumOf(week.minutes))}
                </td>
                <td className="px-3 text-right">
                  {total.seconds !== null ? `${total.seconds}초` : '–'}
                </td>
                <td className="pl-3">
                  {week.lastWeekRate === null ? (
                    '–'
                  ) : (
                    <Delta value={total.rate - week.lastWeekRate} unit="점" />
                  )}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        점수 변화는 바로 앞에 문제를 푼 날과 비교해요. 이번 주 첫 기록과 주간 줄은 지난주와
        비교해요.
      </p>
    </>
  )
}

interface WeakTagsProps {
  units: UnitStat[]
}

/** 표 칸 안의 취약 단원 이름표. 이름이 길면 줄여서 보여 줍니다. */
function WeakTags({ units }: WeakTagsProps) {
  if (units.length === 0) return <span className="text-slate-400">–</span>
  return (
    <span className="flex flex-wrap gap-1">
      {units.map((unit) => (
        <span
          key={unit.name}
          title={unit.name}
          className="max-w-32 truncate rounded-md bg-red-50 px-1.5 py-0.5 text-xs font-bold text-red-700"
        >
          {unit.name}
        </span>
      ))}
    </span>
  )
}

// ---- 작은 조각 ----

interface DeltaProps {
  value: number
  /** '점' · '%p' */
  unit: string
}

/** ▲6점 · ▼12점 · 그대로. 색만으로 알리지 않게 화살표와 글자를 같이 씁니다. */
function Delta({ value, unit }: DeltaProps) {
  if (value === 0) {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold whitespace-nowrap text-slate-500">
        그대로
      </span>
    )
  }
  const isUp = value > 0
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap tabular-nums',
        isUp ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
      )}
    >
      <span aria-hidden="true">{isUp ? '▲' : '▼'}</span>
      {Math.abs(value)}
      {unit}
      <span className="sr-only">{isUp ? ' 올랐어요' : ' 내려갔어요'}</span>
    </span>
  )
}
