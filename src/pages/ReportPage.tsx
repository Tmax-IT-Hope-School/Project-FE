import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ExperimentSection } from '@/components/ui/ExperimentSection'
import { GrowthCurveChart } from '@/components/ui/GrowthCurveChart'
import { InsightCard } from '@/components/ui/InsightCard'
import { Input } from '@/components/ui/Input'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Skeleton } from '@/components/ui/Skeleton'
import { WeeklyFactCard } from '@/components/ui/WeeklyFactCard'
import { usePlans } from '@/hooks/usePlans'
import { useQueryParam } from '@/hooks/useQueryParam'
import { getCareLimits } from '@/lib/careLimits'
import { cn } from '@/lib/cn'
import { formatClock, loadAwayRecords } from '@/lib/away'
import { getAwaySummary } from '@/lib/awaySummary'
import { loadStudySessions } from '@/lib/dailyRecords'
import { getTodayKey, toDayDate, toDayKey } from '@/lib/date'
import { loadUnlockRecords } from '@/lib/focusMode'
import { getDaySummary } from '@/lib/daySummary'
import { addDemoData, removeDemoData } from '@/lib/demoData'
import { getFacts } from '@/lib/facts'
import { EXTRA_MINUTES_PER_DAY, getGrowthCurve } from '@/lib/growthCurve'
import { loadInitialPlan } from '@/lib/initialPlan'
import { getInsightsToShow } from '@/lib/insights'
import { loadOnboardingAnswers } from '@/lib/onboardingSteps'
import {
  MIN_SAMPLES_FOR_COACH,
  MONTH_WORDS,
  getCoachSummary,
  monthlyCoachQuery,
  weeklyCoachQuery,
  type CoachCommentRequest,
  type CoachEvidence,
  type CoachQuery,
  type WeeklyCoachRequest,
} from '@/lib/weeklyCoach'
import { getWeeklyFacts } from '@/lib/weeklyFacts'
import { getWeeklyGoalProgress, getWeeklyGoalTitle, loadPastWeeklyGoals } from '@/lib/weeklyGoal'
import { REVIEW_MAX_LENGTH, findWeeklyReview, saveWeeklyReview } from '@/lib/weeklyReview'
import type { StudyPlan, StudySession, WeeklyReview } from '@/types'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

const WEEKDAY_SHORT = ['일', '월', '화', '수', '목', '금', '토']
// 월간 리포트는 6주차(42일)부터 볼 수 있습니다. (#86)
const MIN_DAYS_FOR_MONTHLY = 42

// 며칠 동안 기록이 쌓여야 첫 리포트를 보여줄지 (#85)
const FIRST_REPORT_DAYS = 14
// "지난 목표" 에 보여줄 주의 수 (#247)
const PAST_GOAL_COUNT = 8

/** Date 를 'YYYY-MM-DD' 모양으로 만듭니다. (toISOString() 은 영국 시간 기준이라 쓰지 않습니다) */
function toDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** 'YYYY-MM-DD' 날짜에서 days 일 만큼 이동한 날짜를 돌려줍니다. */
function moveDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  return toDateKey(new Date(year, month - 1, day + days))
}

/** fromKey 부터 toKey 까지 며칠째인지 셉니다. (같은 날이면 1일째) */
function countDays(fromKey: string, toKey: string): number {
  const [fromYear, fromMonth, fromDay] = fromKey.split('-').map(Number)
  const [toYear, toMonth, toDay] = toKey.split('-').map(Number)
  const msPerDay = 24 * 60 * 60 * 1000
  const diffMs =
    new Date(toYear, toMonth - 1, toDay).getTime() -
    new Date(fromYear, fromMonth - 1, fromDay).getTime()
  return Math.round(diffMs / msPerDay) + 1
}

/** weeksAgo 번째 이전 주의 월요일 날짜를 돌려줍니다. (0 = 이번 주) */
function getMondayKey(weeksAgo: number): string {
  // 오늘은 하루의 기준(새벽 4시)으로 정합니다. 월요일 새벽 2시면 아직 일요일(지난주)입니다. (lib/date.ts)
  const date = toDayDate(Date.now())
  // getDay(): 일요일 0, 월요일 1 ... 토요일 6. 월요일에서 며칠 지났는지 계산합니다. (일요일은 6일 지난 것으로 봅니다)
  const daysFromMonday = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - daysFromMonday - weeksAgo * 7)
  return toDateKey(date)
}

/** 'YYYY-MM-DD' 를 "10월 5일 (일)" 처럼 보여줍니다. */
function formatShortDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return `${month}월 ${day}일 (${WEEKDAY_SHORT[date.getDay()]})`
}

/** 'YYYY-MM-DD' 를 "10월 5일" 처럼 요일 없이 보여줍니다. (월간 리포트 날짜 범위용) */
function formatMonthDay(dateKey: string): string {
  const [, month, day] = dateKey.split('-').map(Number)
  return `${month}월 ${day}일`
}

/** 분을 "3시간 10분" 처럼 보여줍니다. 60분 미만이면 "분"만 보여줍니다. */
function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}분`
  if (minutes === 0) return `${hours}시간`
  return `${hours}시간 ${minutes}분`
}

/** 자정부터 몇 분 지났는지(0~1439)를 "19:25" 처럼 보여줍니다. 기록이 없으면 '-' 입니다. */
// 하루는 1440분입니다.
const MINUTES_PER_DAY = 24 * 60
// 이 시각(새벽 4시) 전에 시작한 공부는 전날 밤의 연장으로 봅니다.
const LATE_NIGHT_END_MINUTES = 4 * 60

function formatStartTime(minutesFromMidnight: number | null): string {
  if (minutesFromMidnight === null) return '-'
  // 자정을 넘긴 값(예: 24:30)은 하루(1440분)를 빼서 00:30 으로 보여줍니다.
  const minutesOfDay = minutesFromMidnight % MINUTES_PER_DAY
  const hour = Math.floor(minutesOfDay / 60)
  const minute = minutesOfDay % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

interface RangeStats {
  /** 기간 순공시간 합계(분) */
  studyMinutes: number
  /** 기간 계획 목표 시간 합계(분). 달성률을 "합계 ÷ 합계" 로 구하려고 따로 들고 있습니다. */
  targetMinutes: number
  /** 기간 계획 달성률 (0 ~ 100). 계획이 하나도 없으면 0 */
  achievementRate: number
  /** 공부를 시작한 날들의, 자정부터 몇 분 지나서 시작했는지 평균. 기록이 없으면 null */
  averageStartMinutes: number | null
}

/** startKey 부터 days 일치를 getDaySummary 로 더해서 기간 통계를 만듭니다. (주간·월간이 같이 씁니다) */
function getRangeStats(
  startKey: string,
  days: number,
  plans: StudyPlan[],
  sessions: StudySession[],
): RangeStats {
  let studyMinutes = 0
  let targetMinutes = 0
  const startMinutesList: number[] = []

  for (let i = 0; i < days; i++) {
    const dateKey = moveDateKey(startKey, i)
    const summary = getDaySummary(dateKey, plans, sessions)
    studyMinutes += summary.studyMinutes
    // 노는 계획은 공부 목표가 아니라서 뺍니다. (#238)
    targetMinutes += plans
      .filter((plan) => plan.date === dateKey && plan.kind !== 'play')
      .reduce((sum, plan) => sum + plan.targetMinutes, 0)

    if (summary.firstStartAt !== null) {
      const start = new Date(summary.firstStartAt)
      const minutes = start.getHours() * 60 + start.getMinutes()
      // 새벽 4시 전에 시작한 것은 "전날 밤 늦게" 로 봅니다. (24시간을 더해서 25시, 26시처럼 셉니다)
      // 그냥 평균 내면 23:00 과 00:30 의 평균이 낮 11:45 로 나오기 때문입니다.
      startMinutesList.push(minutes < LATE_NIGHT_END_MINUTES ? minutes + MINUTES_PER_DAY : minutes)
    }
  }

  // 순공시간 ÷ 목표 시간을 "날짜별로 평균" 내지 않고 "합계 ÷ 합계" 로 구합니다. (하루 계산과 같은 방식)
  const achievementRate =
    targetMinutes > 0 ? Math.min(100, Math.floor((studyMinutes * 100) / targetMinutes)) : 0

  const averageStartMinutes =
    startMinutesList.length === 0
      ? null
      : Math.round(
          startMinutesList.reduce((sum, minutes) => sum + minutes, 0) / startMinutesList.length,
        )

  return { studyMinutes, targetMinutes, achievementRate, averageStartMinutes }
}

/** 월요일 날짜(mondayKey)부터 7일치 통계. (주간 리포트용) */
function getWeekStats(mondayKey: string, plans: StudyPlan[], sessions: StudySession[]): RangeStats {
  return getRangeStats(mondayKey, 7, plans, sessions)
}

/** "지난주보다 2시간 10분 ↑" 처럼 차이를 보여줍니다. periodLabel 로 "지난주"/"지난달"을 고릅니다. */
function formatMinutesDelta(current: number, previous: number, periodLabel: string): string | null {
  const diff = current - previous
  if (diff === 0) return null
  const arrow = diff > 0 ? '↑' : '↓'
  return `${periodLabel}보다 ${formatMinutes(Math.abs(diff))} ${arrow}`
}

/** "지난주보다 8%p ↑" 처럼 달성률 차이를 보여줍니다. */
function formatRateDelta(current: number, previous: number, periodLabel: string): string | null {
  const diff = current - previous
  if (diff === 0) return null
  const arrow = diff > 0 ? '↑' : '↓'
  return `${periodLabel}보다 ${Math.abs(diff)}%p ${arrow}`
}

/** "지난주보다 25분 빨라짐" 처럼 시작 시각 차이를 보여줍니다. 둘 중 하나라도 기록이 없으면 비교하지 않습니다. */
function formatStartDelta(
  current: number | null,
  previous: number | null,
  periodLabel: string,
): string | null {
  if (current === null || previous === null) return null
  const diff = current - previous
  if (diff === 0) return null
  return `${periodLabel}보다 ${Math.abs(diff)}분 ${diff < 0 ? '빨라짐' : '느려짐'}`
}

/** 계획·공부 기록을 통틀어 가장 이른 날짜부터 todayKey 까지 며칠째인지 셉니다. 기록이 없으면 0. */
function countRecordDays(plans: StudyPlan[], sessions: StudySession[], todayKey: string): number {
  const recordDates = [
    ...plans.map((plan) => plan.date),
    ...sessions.map((session) => toDayKey(session.startedAt)),
  ]
  if (recordDates.length === 0) return 0
  const firstRecordKey = [...recordDates].sort()[0]
  return countDays(firstRecordKey, todayKey)
}

export function ReportPage() {
  // 주간·월간 탭은 주소에 둡니다. (/report = 주간, /report?view=monthly = 월간)
  // 새로고침해도 보던 탭이 그대로이고, 뒤로 가기로 앞에 보던 탭에 돌아갑니다.
  const [viewParam, setView] = useQueryParam('view', 'weekly')
  // 주소는 누구나 고칠 수 있어서, 'monthly' 가 아닌 값은 모두 주간으로 봅니다.
  const view = viewParam === 'monthly' ? 'monthly' : 'weekly'

  const { allPlans } = usePlans()
  // 타이머가 저장해 둔 공부 기록을 불러옵니다. 없으면 빈 목록입니다. (예시 숫자를 보여주지 않습니다)
  const [sessions] = useState<StudySession[]>(loadStudySessions)

  return (
    <div className="flex flex-col gap-8">
      <div>
        {/* h-10: 글자는 작아도 누르는 영역은 40px 로 둡니다. */}
        <Link
          to="/records"
          className="inline-flex h-10 items-center text-sm text-slate-500 hover:text-slate-700"
        >
          ‹ 기록
        </Link>

        {/* 주간 / 월간 탭. 같은 /report 주소에서 바꿔 봅니다. (#86) */}
        <div className="mt-2 inline-flex rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            aria-pressed={view === 'weekly'}
            onClick={() => setView('weekly')}
            className={cn(
              'h-10 cursor-pointer rounded-md px-4 text-sm font-medium transition-colors',
              view === 'weekly' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
            )}
          >
            주간
          </button>
          <button
            type="button"
            aria-pressed={view === 'monthly'}
            onClick={() => setView('monthly')}
            className={cn(
              'h-10 cursor-pointer rounded-md px-4 text-sm font-medium transition-colors',
              view === 'monthly' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
            )}
          >
            월간
          </button>
        </div>
      </div>

      {view === 'weekly' ? (
        <WeeklyReport allPlans={allPlans} sessions={sessions} />
      ) : (
        <MonthlyReport allPlans={allPlans} sessions={sessions} />
      )}

      {/* 개발할 때만 보이는 가상 데이터 버튼. 배포한 화면에서는 import.meta.env.DEV 가 false 라서 안 보입니다. */}
      {import.meta.env.DEV && <DemoDataCard />}
    </div>
  )
}

/** 9주치 가상 계획·공부 기록을 넣거나 빼는 카드. 리포트를 미리 확인하는 용도입니다. */
function DemoDataCard() {
  function handleAdd() {
    addDemoData()
    // 계획과 기록은 화면이 처음 열릴 때만 저장소에서 읽어서, 새로고침해야 새 데이터가 보입니다.
    window.location.reload()
  }

  function handleRemove() {
    removeDemoData()
    window.location.reload()
  }

  return (
    <Card title="개발용: 가상 데이터" className="border-dashed bg-slate-50">
      <p className="text-sm text-slate-500">
        최근 9주치 계획과 공부 기록을 넣어서 주간·월간 리포트를 미리 볼 수 있어요. 내가 직접 만든
        기록은 지워지지 않아요.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <Button className="h-11 w-full sm:flex-1" onClick={handleAdd}>
          가상 데이터 넣기
        </Button>
        <Button variant="secondary" className="h-11 w-full sm:flex-1" onClick={handleRemove}>
          가상 데이터 지우기
        </Button>
      </div>
    </Card>
  )
}

interface ReportSectionProps {
  allPlans: StudyPlan[]
  sessions: StudySession[]
}

/** 주간 리포트 (#72) */
function WeeklyReport({ allPlans, sessions }: ReportSectionProps) {
  // 0 = 이번 주, 1 = 지난 주, 2 = 지지난 주 ... 주소에 둡니다. (/report?weeksAgo=1)
  // replace: ‹ › 를 여러 번 눌러도 뒤로 가기 한 번이면 리포트 화면을 떠납니다.
  const [weeksAgoParam, setWeeksAgoParam] = useQueryParam('weeksAgo', '0', { replace: true })
  // 주소의 값이 0 이상의 정수가 아니면 이번 주(0)로 봅니다.
  const weeksAgo = /^\d{1,3}$/.test(weeksAgoParam) ? Number(weeksAgoParam) : 0
  // 온보딩에서 세운 처음 계획. 팩트 카드의 "처음 계획 · 하루 평균" 줄에 씁니다. 안 세웠으면 null (#240)
  const [initialPlan] = useState(loadInitialPlan)
  // 이미 끝난 주들에 골랐던 "이번 주 목표" (#247). 이번 주 목표는 아직 진행 중이라 홈에서만 보여줍니다.
  const [pastGoals] = useState(() => loadPastWeeklyGoals(getMondayKey(0)).slice(0, PAST_GOAL_COUNT))

  const mondayKey = getMondayKey(weeksAgo)
  const previousMondayKey = getMondayKey(weeksAgo + 1)

  const thisWeek = getWeekStats(mondayKey, allPlans, sessions)
  const previousWeek = getWeekStats(previousMondayKey, allPlans, sessions)

  // 인사이트는 가상 데이터를 넣었을 때만 예시로 보여줍니다. (lib/insights.ts)
  const { insights, isExample: isExampleInsight } = getInsightsToShow(sessions)

  // 계획도 공부 기록도 하나 없는 주는 "기록 없음" 안내로 바꿉니다.
  const hasRecord = thisWeek.targetMinutes > 0 || thisWeek.studyMinutes > 0

  // 첫 기록 날짜 = 계획과 공부 기록을 통틀어 가장 이른 날짜. 기록이 하나도 없으면 null 입니다.
  const recordDates = [
    ...allPlans.map((plan) => plan.date),
    ...sessions.map((session) => toDayKey(session.startedAt)),
  ]
  const firstRecordKey = recordDates.length === 0 ? null : [...recordDates].sort()[0]
  const daysSinceFirstRecord =
    firstRecordKey === null ? 0 : countDays(firstRecordKey, getTodayKey())
  // 이번 주를 보는 중이고, 아직 14일치 기록이 안 쌓였으면 리포트 대신 카운트다운을 보여줍니다.
  // (예전 주로 넘겨 보는 중이면 그 주의 기록을 그대로 보여줍니다)
  const isBeforeFirstReport =
    weeksAgo === 0 && firstRecordKey !== null && daysSinceFirstRecord < FIRST_REPORT_DAYS

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">주간 리포트</h1>
          <p className="mt-1 text-slate-600">
            {formatShortDate(mondayKey)} ~ {formatShortDate(moveDateKey(mondayKey, 6))}
          </p>
        </div>

        <div className="flex gap-1">
          <Button
            variant="secondary"
            aria-label="지난 주로 이동"
            className="w-10 shrink-0 px-0"
            onClick={() => setWeeksAgoParam(String(weeksAgo + 1))}
          >
            ‹
          </Button>
          <Button
            variant="secondary"
            aria-label="다음 주로 이동"
            disabled={weeksAgo === 0}
            className="w-10 shrink-0 px-0"
            onClick={() => setWeeksAgoParam(String(Math.max(0, weeksAgo - 1)))}
          >
            ›
          </Button>
        </div>
      </div>

      {/* 이 주의 팩트 숫자 (#245). 기록이 14일 안 됐어도 계획과 타이머에서 나온 숫자는 그대로 보여줍니다. */}
      <WeeklyFactCard
        plans={allPlans}
        sessions={sessions}
        initialPlan={initialPlan}
        mondayKey={mondayKey}
        isPastWeek={weeksAgo > 0}
      />

      {/* 위의 숫자를 말로 풀어 주는 코치 한 문단 (#249). 서버가 없으면 숫자를 끼운 기본 문장이 나옵니다. */}
      <WeeklyCoachCard plans={allPlans} sessions={sessions} mondayKey={mondayKey} />

      {/* 이 주에 공부하다 나간 기록과 집중 모드를 푼 기록. 하나도 없으면 카드가 보이지 않습니다. */}
      <FocusRecordCard mondayKey={mondayKey} />

      {/* 지난 목표와 결과 (#247). 달성했는지는 그 주의 팩트 숫자로 정해집니다. 스스로 "지켰다" 고 답하지 않습니다. */}
      {pastGoals.length > 0 && (
        <Card title="지난 목표">
          <ul className="flex flex-col divide-y divide-slate-100">
            {pastGoals.map((goal) => {
              // 그 주 월요일 ~ 일요일의 팩트로 결과를 판정합니다.
              const weekFacts = getFacts(
                allPlans,
                sessions,
                goal.mondayKey,
                moveDateKey(goal.mondayKey, 6),
              )
              const progress = getWeeklyGoalProgress(goal, weekFacts)
              const unit = goal.kind === 'startDelay' ? '분' : '%'
              return (
                <li
                  key={goal.mondayKey}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500">{formatMonthDay(goal.mondayKey)} 주</p>
                    <p className="font-medium break-keep text-slate-900">
                      {getWeeklyGoalTitle(goal)}
                    </p>
                  </div>
                  {/* 미달은 빨간색으로 겁주지 않고 회색으로 둡니다. */}
                  <p
                    className={cn(
                      'shrink-0 font-semibold',
                      progress.status === 'achieved' ? 'text-emerald-600' : 'text-slate-500',
                    )}
                  >
                    {progress.status === 'unknown'
                      ? '기록 없음'
                      : `${progress.current}${unit} · ${progress.status === 'achieved' ? '달성' : '미달'}`}
                  </p>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {isBeforeFirstReport ? (
        <Card>
          <p className="text-sm text-slate-600">
            아직 기록이 {FIRST_REPORT_DAYS}일이 안 돼서, 리포트 대신 카운트다운을 보여줘요.
          </p>
          <div className="mt-4 flex items-center justify-between gap-2">
            <p className="text-lg font-semibold text-slate-900">
              첫 리포트까지 D-{FIRST_REPORT_DAYS - daysSinceFirstRecord}
            </p>
            <p className="shrink-0 text-sm text-slate-500">
              {daysSinceFirstRecord} / {FIRST_REPORT_DAYS}일
            </p>
          </div>
          <ProgressBar value={(daysSinceFirstRecord / FIRST_REPORT_DAYS) * 100} className="mt-2" />
        </Card>
      ) : !hasRecord ? (
        <Card>
          <p className="py-6 text-center text-sm text-slate-500">
            이 주는 계획도 공부 기록도 없어요.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card>
              <p className="text-sm text-slate-500">순공시간</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {formatMinutes(thisWeek.studyMinutes)}
              </p>
              {formatMinutesDelta(thisWeek.studyMinutes, previousWeek.studyMinutes, '지난주') && (
                <p className="text-brand mt-1 text-sm font-medium">
                  {formatMinutesDelta(thisWeek.studyMinutes, previousWeek.studyMinutes, '지난주')}
                </p>
              )}
            </Card>

            <Card>
              <p className="text-sm text-slate-500">계획 달성률</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{thisWeek.achievementRate}%</p>
              {formatRateDelta(
                thisWeek.achievementRate,
                previousWeek.achievementRate,
                '지난주',
              ) && (
                <p className="text-brand mt-1 text-sm font-medium">
                  {formatRateDelta(
                    thisWeek.achievementRate,
                    previousWeek.achievementRate,
                    '지난주',
                  )}
                </p>
              )}
            </Card>

            <Card>
              <p className="text-sm text-slate-500">첫 시작 평균</p>
              <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">
                {formatStartTime(thisWeek.averageStartMinutes)}
              </p>
              {formatStartDelta(
                thisWeek.averageStartMinutes,
                previousWeek.averageStartMinutes,
                '지난주',
              ) && (
                <p className="text-brand mt-1 text-sm font-medium">
                  {formatStartDelta(
                    thisWeek.averageStartMinutes,
                    previousWeek.averageStartMinutes,
                    '지난주',
                  )}
                </p>
              )}
            </Card>
          </div>

          {/* 발견은 지금까지의 기록으로 만든 것이라, 지난 주를 볼 때는 제목만 맞게 바꿉니다. */}
          <section>
            <h2 className="text-lg font-bold text-slate-900">
              {weeksAgo === 0 ? '이번 주 발견' : '지금까지의 발견'}
            </h2>
            {insights.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                아직 데이터가 모자라요. 기록이 쌓이면 발견이 생겨요.
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {insights.map((insight) => (
                  <InsightCard
                    key={insight.id}
                    insight={insight}
                    sessions={sessions}
                    isExample={isExampleInsight}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* 도전 중인 실험의 진행 상황과, 끝난 실험의 결과·다음 행동 버튼 (#93) */}
      <section>
        <h2 className="text-lg font-bold text-slate-900">실험</h2>
        <ExperimentSection plans={allPlans} sessions={sessions} className="mt-3" />
      </section>

      {/* 개선안은 개선안 고르기 화면에서 고릅니다. 여기서는 그리로 안내만 합니다. */}
      <section>
        <h2 className="text-lg font-bold text-slate-900">다음 주 개선안</h2>
        <p className="mt-2 text-sm break-keep text-slate-500">
          다음 주에 해 볼 개선안은{' '}
          <Link to="/suggestions" className="text-brand font-semibold hover:underline">
            개선안 고르기
          </Link>
          에서 고를 수 있어.
        </p>
      </section>

      {/* 주간 회고 (#82). 위에서 고른 주의 회고를 보여줍니다. ‹ › 로 지난 주를 고르면 지난 회고를 다시 볼 수 있습니다. */}
      <section>
        <h2 className="text-lg font-bold text-slate-900">주간 회고</h2>
        <p className="mt-1 text-sm text-slate-500">3문항이면 끝나. 쓰기 싫은 주는 건너뛰어도 돼.</p>
        {/* key 가 주마다 달라서, 주를 바꾸면 입력하던 내용이 그 주의 회고로 새로 채워집니다. */}
        <WeeklyReviewCard key={mondayKey} weekStart={mondayKey} />
      </section>
    </>
  )
}

/** 월간 리포트 (#86). 4주를 한 달로 봅니다 (예: 9/8~10/5 · 4주). */
interface FocusRecordCardProps {
  /** 보고 있는 주의 월요일 ('YYYY-MM-DD') */
  mondayKey: string
}

/**
 * 주간 리포트의 "집중 기록" 카드입니다. 공부하다 다른 탭·앱으로 나간 기록(딴짓)과 집중 모드를 직접 푼 기록을 보여줍니다.
 * 웹 앱은 다른 앱을 잠글 수 없어서, 대신 "언제 얼마나 나갔는지" 를 스스로 볼 수 있게 합니다. (계산: lib/awaySummary.ts)
 * 이 주에 기록이 하나도 없으면 아무것도 그리지 않습니다.
 */
function FocusRecordCard({ mondayKey }: FocusRecordCardProps) {
  // 저장된 기록은 이 화면이 열릴 때 한 번만 읽습니다. (리포트를 보는 동안에는 기록이 늘지 않습니다)
  const [awayRecords] = useState(loadAwayRecords)
  const [unlockRecords] = useState(loadUnlockRecords)

  const summary = getAwaySummary(awayRecords, unlockRecords, mondayKey, moveDateKey(mondayKey, 6))
  if (summary.awayCount === 0 && summary.unlockCount === 0) return null

  return (
    <Card title="집중 기록">
      <p className="text-sm break-keep text-slate-500">
        벌점이 아니에요. 내가 어느 시간대에 약한지 알아보는 기록이에요.
      </p>

      {/* 모바일은 한 줄에 하나, sm 부터 세 칸으로 나란히 */}
      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-slate-50 p-3">
          <dt className="text-xs text-slate-500">공부하다 나간 횟수</dt>
          <dd className="mt-1 text-lg font-bold text-slate-900">
            {summary.awayCount}번
            {summary.awayCount > 0 && (
              <span className="ml-1 text-sm font-medium text-slate-500">
                · 합쳐서 {formatMinutes(summary.awayMinutes)}
              </span>
            )}
          </dd>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <dt className="text-xs text-slate-500">가장 자주 나간 시간</dt>
          <dd className="mt-1 text-lg font-bold text-slate-900">
            {summary.peakHour === null ? (
              '없음'
            ) : (
              <>
                {summary.peakHour.hour}시대
                <span className="ml-1 text-sm font-medium text-slate-500">
                  · {summary.peakHour.count}번
                </span>
              </>
            )}
          </dd>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <dt className="text-xs text-slate-500">집중 모드를 푼 횟수</dt>
          <dd className="mt-1 text-lg font-bold text-slate-900">{summary.unlockCount}번</dd>
        </div>
      </dl>

      {summary.recentUnlocks.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-semibold text-slate-900">집중 모드를 풀 때 적은 이유</p>
          <ul className="mt-2 flex flex-col divide-y divide-slate-100">
            {summary.recentUnlocks.map((unlock) => (
              <li
                key={unlock.id}
                className="flex items-baseline justify-between gap-3 py-2 text-sm"
              >
                {/* min-w-0 + break-words: 이유가 길어도 카드 밖으로 넘치지 않게 합니다. */}
                <span className="min-w-0 break-words text-slate-700">{unlock.reason}</span>
                <span className="shrink-0 text-xs text-slate-500">
                  {formatMonthDay(toDayKey(unlock.unlockedAt))} {formatClock(unlock.unlockedAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

interface WeeklyCoachCardProps {
  plans: StudyPlan[]
  sessions: StudySession[]
  /** 보여줄 주의 월요일 ('YYYY-MM-DD') */
  mondayKey: string
}

/**
 * 주간 리포트의 "코치 한마디" 카드입니다. (#249 · 규칙은 lib/weeklyCoach.ts)
 *
 * 숫자는 코드가 계산하고(lib/facts.ts), 그 숫자를 말로 푸는 일만 AI 에게 맡깁니다.
 *   기록이 모자란 주  -> "기록이 더 쌓이면 이야기해 줄게"
 *   서버가 문단을 줌  -> AI 가 쓴 문단 ("AI 가 쓴 글" 표시)
 *   서버가 없거나 실패 -> 숫자를 끼워 만든 기본 문장
 * 문단 아래의 "근거 숫자 보기" 에서 문단에 쓰인 숫자를 그대로 확인할 수 있습니다.
 */
function WeeklyCoachCard({ plans, sessions, mondayKey }: WeeklyCoachCardProps) {
  // 설정에서 정한 관리 강도 한도와 독설 허용 수위. 서버가 이 한도 안에서 말투를 정합니다. 처음 그릴 때 한 번만 읽습니다.
  const [limits] = useState(getCareLimits)
  const { thisWeek, lastWeek } = getWeeklyFacts(plans, sessions, mondayKey, getTodayKey())
  const summary = getCoachSummary(thisWeek, lastWeek)

  if (summary === null) {
    return (
      <Card title="코치 한마디">
        <p className="text-sm break-keep text-slate-600">
          기록이 더 쌓이면 이야기해 줄게. 목표를 정한 타이머가 한 주에 {MIN_SAMPLES_FOR_COACH}번은
          있어야 해. (이 주는 {thisWeek.completionRate.sampleCount}번)
        </p>
      </Card>
    )
  }

  // 서버에는 계산된 숫자와 내가 정한 한도만 보냅니다. 계획 내용·일기 같은 원문은 보내지 않습니다.
  const request: WeeklyCoachRequest = {
    mondayKey,
    numbers: summary.evidence,
    maxCareLevel: limits.maxCareLevel,
    maxHarshness: limits.maxHarshness,
  }

  return (
    <Card title="코치 한마디">
      {/* 서버에 물어보는 동안에는 스켈레톤을 보여줍니다. resetKeys: 다른 주로 넘기면 새로 받아옵니다. */}
      <AsyncBoundary pendingFallback={<CoachSkeleton />} resetKeys={[mondayKey]}>
        <CoachParagraph query={weeklyCoachQuery(request)} fallbackSentences={summary.sentences} />
      </AsyncBoundary>

      <CoachEvidenceDetails evidence={summary.evidence} />
    </Card>
  )
}

interface MonthlyCoachCardProps {
  plans: StudyPlan[]
  sessions: StudySession[]
  /** 보고 있는 4주의 첫 날과 마지막 날 ('YYYY-MM-DD') */
  startKey: string
  endKey: string
  /** 비교할 그 전 4주의 첫 날 */
  previousStartKey: string
}

/**
 * 월간 리포트의 "코치 한마디" 카드입니다. 주간과 같은 규칙(lib/weeklyCoach.ts)을 4주 단위로 씁니다.
 * 달라지는 것은 숫자를 계산하는 기간과, 문장에서 기간을 부르는 말("이 4주 · 그 전 4주 · 다음 달")뿐입니다.
 */
function MonthlyCoachCard({
  plans,
  sessions,
  startKey,
  endKey,
  previousStartKey,
}: MonthlyCoachCardProps) {
  const [limits] = useState(getCareLimits)
  // 아직 오지 않은 날의 계획까지 넣으면 "계획 대비 실제" 가 낮게 보여서, 오늘까지만 계산합니다. (주간과 같은 규칙)
  // 'YYYY-MM-DD' 는 글자로 비교해도 날짜 순서와 같습니다.
  const todayKey = getTodayKey()
  const thisMonth = getFacts(plans, sessions, startKey, endKey < todayKey ? endKey : todayKey)
  const previousMonth = getFacts(
    plans,
    sessions,
    previousStartKey,
    moveDateKey(previousStartKey, 27),
  )
  const summary = getCoachSummary(thisMonth, previousMonth, MONTH_WORDS)

  if (summary === null) {
    return (
      <Card title="코치 한마디">
        <p className="text-sm break-keep text-slate-600">
          기록이 더 쌓이면 이야기해 줄게. 목표를 정한 타이머가 4주에 {MIN_SAMPLES_FOR_COACH}번은
          있어야 해. (이 4주는 {thisMonth.completionRate.sampleCount}번)
        </p>
      </Card>
    )
  }

  // 서버에는 계산된 숫자와 내가 정한 한도만 보냅니다. 계획 내용·일기 같은 원문은 보내지 않습니다.
  const request: CoachCommentRequest = {
    numbers: summary.evidence,
    maxCareLevel: limits.maxCareLevel,
    maxHarshness: limits.maxHarshness,
  }

  return (
    <Card title="코치 한마디">
      {/* resetKeys: 다른 4주로 넘기면 새로 받아옵니다. */}
      <AsyncBoundary pendingFallback={<CoachSkeleton />} resetKeys={[startKey]}>
        <CoachParagraph
          query={monthlyCoachQuery(startKey, request)}
          fallbackSentences={summary.sentences}
        />
      </AsyncBoundary>

      <CoachEvidenceDetails evidence={summary.evidence} />
    </Card>
  )
}

interface CoachEvidenceDetailsProps {
  /** 문단에 쓰인 숫자들 */
  evidence: CoachEvidence[]
}

/** 코치 문단 아래의 "근거 숫자 보기" 입니다. 문단에 쓰인 숫자를 그대로 확인할 수 있습니다. (주간 · 월간이 같이 씁니다) */
function CoachEvidenceDetails({ evidence }: CoachEvidenceDetailsProps) {
  return (
    // details/summary: 눌러서 접고 펼 수 있는 HTML 기본 부품입니다. 처음에는 접혀 있습니다.
    <details className="group mt-4 rounded-lg bg-slate-50 px-3">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between text-sm font-medium text-slate-700 [&::-webkit-details-marker]:hidden">
        근거 숫자 보기
        <span aria-hidden className="text-slate-500 transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <ul className="flex flex-col divide-y divide-slate-200 pb-2 text-sm">
        {evidence.map((item) => (
          <li key={item.label} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0 break-keep text-slate-600">{item.label}</span>
            <span className="shrink-0 text-right">
              <strong className="font-semibold text-slate-900">{item.value}</strong>
              <span className="ml-2 text-xs text-slate-500">{item.basis}</span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

interface CoachParagraphProps {
  /** 서버에 물어볼 쿼리 설정 (lib/weeklyCoach.ts 의 weeklyCoachQuery · monthlyCoachQuery) */
  query: CoachQuery
  /** 서버가 문단을 주지 못했을 때 보여줄 기본 문장들 */
  fallbackSentences: string[]
}

/**
 * 코치 문단을 보여줍니다. useSuspenseQuery 가 서버 답을 기다리는 동안에는 바깥의 AsyncBoundary 가 스켈레톤을 보여줍니다.
 * 서버가 없거나 실패하면 data 가 null 로 와서(에러가 아닙니다) 기본 문장을 보여줍니다.
 */
function CoachParagraph({ query, fallbackSentences }: CoachParagraphProps) {
  const { data: aiParagraph } = useSuspenseQuery(query)
  const isAiWritten = aiParagraph !== null

  return (
    <div>
      {/* 누가 쓴 글인지 꼭 밝힙니다. AI 가 쓴 글은 틀릴 수 있어서, 아래 근거 숫자와 맞춰 볼 수 있어야 합니다. */}
      <span
        className={cn(
          'inline-block rounded px-1.5 py-0.5 text-xs font-medium',
          isAiWritten ? 'bg-brand-light text-brand' : 'bg-slate-100 text-slate-600',
        )}
      >
        {isAiWritten ? 'AI 가 쓴 글' : '숫자로 만든 기본 문장'}
      </span>
      <p className="mt-2 text-base leading-relaxed break-keep text-slate-800">
        {aiParagraph ?? fallbackSentences.join(' ')}
      </p>
    </div>
  )
}

/** 코치 문단을 받아오는 동안 보여주는 자리 표시입니다. 문단 세 줄쯤의 높이로 그립니다. */
function CoachSkeleton() {
  return (
    // role="status": "쓰는 중" 이라는 것을 스크린리더에도 알려 줍니다.
    <div role="status" className="flex flex-col gap-2">
      <span className="sr-only">코치가 한마디를 쓰는 중이에요</span>
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-2/3" />
    </div>
  )
}

function MonthlyReport({ allPlans, sessions }: ReportSectionProps) {
  // 0 = 가장 최근 4주, 1 = 그 전 4주 ...
  const [monthWeeksAgo, setMonthWeeksAgo] = useState(0)

  const todayKey = getTodayKey()
  const recordDays = countRecordDays(allPlans, sessions, todayKey)

  if (recordDays < MIN_DAYS_FOR_MONTHLY) {
    return (
      <Card>
        <p className="py-6 text-center text-sm text-slate-500">
          월간 리포트는 6주차부터 볼 수 있어요.
        </p>
      </Card>
    )
  }

  // 이번 블록의 가장 최근 주(월요일)부터, 4주 전 주(월요일)까지.
  const latestMondayKey = getMondayKey(monthWeeksAgo * 4)
  const earliestMondayKey = getMondayKey(monthWeeksAgo * 4 + 3)
  const blockEndKey = moveDateKey(latestMondayKey, 6)

  const thisMonth = getRangeStats(earliestMondayKey, 28, allPlans, sessions)
  const previousMonthStart = getMondayKey(monthWeeksAgo * 4 + 7)
  const previousMonth = getRangeStats(previousMonthStart, 28, allPlans, sessions)

  // 1주(가장 오래된 주) ~ 4주(가장 최근 주) 순서로 보여줍니다.
  const weekBlocks = [1, 2, 3, 4].map((weekIndex) => {
    const weeksAgoForThisWeek = monthWeeksAgo * 4 + (4 - weekIndex)
    const weekStats = getWeekStats(getMondayKey(weeksAgoForThisWeek), allPlans, sessions)
    return { weekIndex, studyMinutes: weekStats.studyMinutes }
  })
  const maxWeekMinutes = Math.max(1, ...weekBlocks.map((week) => week.studyMinutes))

  // 월 이름은 이 4주가 끝나는 날(가장 최근 주의 일요일) 기준입니다.
  const [, blockEndMonth] = blockEndKey.split('-').map(Number)

  // 예상 성장 곡선(#71). "지금까지 전체" 기준이라 보고 있는 4주 구간과 상관없이 항상 같은 값입니다.
  // D-day 와 시험 이름은 온보딩(#58)에서 받습니다. 온보딩을 아직 안 했으면 둘 다 빈 글자입니다.
  const onboardingAnswers = loadOnboardingAnswers() ?? {}
  const examDateKey = onboardingAnswers.targetExamDate || null
  const examLabel = onboardingAnswers.targetExam || '시험일'
  // 시험 날짜가 이미 지났으면 "시험까지" 를 그릴 수 없습니다. (그래프의 오늘이 시험 날보다 오른쪽으로 나가서 깨집니다)
  // 'YYYY-MM-DD' 는 글자로 비교해도 날짜 순서와 같습니다.
  const isExamPassed = examDateKey !== null && examDateKey < todayKey
  const growthCurve =
    examDateKey === null || isExamPassed
      ? null
      : getGrowthCurve(allPlans, sessions, todayKey, examDateKey)

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {blockEndMonth}월 리포트
          </h1>
          <p className="mt-1 text-slate-600">
            {formatMonthDay(earliestMondayKey)} ~ {formatMonthDay(blockEndKey)} · 4주
          </p>
        </div>

        <div className="flex gap-1">
          <Button
            variant="secondary"
            aria-label="지난달로 이동"
            className="w-10 shrink-0 px-0"
            onClick={() => setMonthWeeksAgo((prev) => prev + 4)}
          >
            ‹
          </Button>
          <Button
            variant="secondary"
            aria-label="다음달로 이동"
            disabled={monthWeeksAgo === 0}
            className="w-10 shrink-0 px-0"
            onClick={() => setMonthWeeksAgo((prev) => Math.max(0, prev - 4))}
          >
            ›
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-slate-500">이번 달 순공</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {formatMinutes(thisMonth.studyMinutes)}
          </p>
          {formatMinutesDelta(thisMonth.studyMinutes, previousMonth.studyMinutes, '지난달') && (
            <p className="text-brand mt-1 text-sm font-medium">
              {formatMinutesDelta(thisMonth.studyMinutes, previousMonth.studyMinutes, '지난달')}
            </p>
          )}
        </Card>

        <Card>
          <p className="text-sm text-slate-500">평균 달성률</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{thisMonth.achievementRate}%</p>
          {formatRateDelta(thisMonth.achievementRate, previousMonth.achievementRate, '지난달') && (
            <p className="text-brand mt-1 text-sm font-medium">
              {formatRateDelta(thisMonth.achievementRate, previousMonth.achievementRate, '지난달')}
            </p>
          )}
        </Card>

        <Card>
          <p className="text-sm text-slate-500">평균 첫 시작</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">
            {formatStartTime(thisMonth.averageStartMinutes)}
          </p>
          {formatStartDelta(
            thisMonth.averageStartMinutes,
            previousMonth.averageStartMinutes,
            '지난달',
          ) && (
            <p className="text-brand mt-1 text-sm font-medium">
              {formatStartDelta(
                thisMonth.averageStartMinutes,
                previousMonth.averageStartMinutes,
                '지난달',
              )}
            </p>
          )}
        </Card>
      </div>

      {/* 위의 숫자를 말로 풀어 주는 코치 한 문단. 주간과 같은 규칙을 4주 단위로 씁니다. 서버가 없으면 기본 문장이 나옵니다. */}
      <MonthlyCoachCard
        plans={allPlans}
        sessions={sessions}
        startKey={earliestMondayKey}
        endKey={blockEndKey}
        previousStartKey={previousMonthStart}
      />

      <Card title="주별 순공">
        <ul className="flex flex-col gap-3">
          {weekBlocks.map((week) => (
            <li key={week.weekIndex} className="flex items-center gap-3">
              <span className="w-8 shrink-0 text-sm text-slate-500">{week.weekIndex}주</span>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="bg-brand h-full rounded-full"
                  // 막대 너비가 숫자(공부 시간)에 따라 계속 바뀌어서 Tailwind 클래스로 만들 수 없어 인라인 style 을 씁니다.
                  style={{ width: `${Math.round((week.studyMinutes / maxWeekMinutes) * 100)}%` }}
                />
              </div>
              <span className="w-16 shrink-0 text-right text-sm font-medium text-slate-700">
                {formatMinutes(week.studyMinutes)}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <section>
        <h2 className="text-lg font-bold text-slate-900">예상 성장 곡선</h2>
        {examDateKey === null ? (
          <p className="mt-3 text-sm text-slate-500">
            온보딩에서 목표 시험 날짜를 정하면 보여드릴게요.{' '}
            <Link to="/onboarding" className="text-brand font-semibold hover:underline">
              온보딩 하러 가기
            </Link>
          </p>
        ) : isExamPassed ? (
          <p className="mt-3 text-sm break-keep text-slate-500">
            {examLabel} 날짜가 지났어요. 다음 시험 날짜가 정해지면 다시 보여드릴게요.
          </p>
        ) : !growthCurve?.hasEnoughData ? (
          <p className="mt-3 text-sm text-slate-500">기록이 더 쌓이면 보여드릴게요.</p>
        ) : (
          <Card className="mt-3">
            <GrowthCurveChart curve={growthCurve} examLabel={examLabel} />
            <p className="mt-4 text-base font-semibold text-slate-900">
              지금 페이스면 {examLabel}까지 누적{' '}
              {formatMinutes(growthCurve.currentPaceTotalMinutes)}, 하루 {EXTRA_MINUTES_PER_DAY}분
              더하면 {formatMinutes(growthCurve.withExtraTotalMinutes)}야.
            </p>
            {growthCurve.hasFourWeekComparison && (
              <p className="mt-1 text-sm text-slate-500">
                4주 전보다 하루 평균 {Math.abs(growthCurve.dailyMinutesChangeFromFourWeeksAgo)}분{' '}
                {growthCurve.dailyMinutesChangeFromFourWeeksAgo >= 0 ? '늘었어.' : '줄었어.'}
              </p>
            )}
          </Card>
        )}
      </section>

      {/* 실험 결과는 주간 리포트의 \"실험\" 에서 확인합니다. 여기서는 그리로 안내만 합니다. */}
      <section>
        <h2 className="text-lg font-bold text-slate-900">이번 달 판정된 실험</h2>
        <p className="mt-2 text-sm break-keep text-slate-500">
          실험 결과는{' '}
          <Link to="/report?view=weekly" className="text-brand font-semibold hover:underline">
            주간 리포트
          </Link>
          의 &quot;실험&quot; 에서 확인할 수 있어.
        </p>
      </section>
    </>
  )
}

type ReviewField = 'best' | 'regret' | 'change'
type ReviewAnswers = Record<ReviewField, string>

// 회고 질문 3개. 질문을 바꾸고 싶으면 여기만 고치면 됩니다.
const reviewQuestions: { field: ReviewField; label: string; placeholder: string }[] = [
  {
    field: 'best',
    label: '① 이번 주 가장 잘한 것은?',
    placeholder: '예) 3일 연속 7시 전에 시작했다',
  },
  { field: 'regret', label: '② 가장 아쉬운 것은?', placeholder: '예) 주말에 폰을 너무 오래 봤다' },
  {
    field: 'change',
    label: '③ 다음 주에 바꿀 한 가지는?',
    placeholder: '예) 공부할 땐 폰을 다른 방에 둔다',
  },
]

const emptyAnswers: ReviewAnswers = { best: '', regret: '', change: '' }

interface WeeklyReviewCardProps {
  /** 회고를 쓸 주의 월요일 날짜 'YYYY-MM-DD' */
  weekStart: string
}

/**
 * 주간 회고 카드. 상태가 세 가지입니다.
 * - 아직 안 씀 → 입력 칸 + 저장하기 / 건너뛰기
 * - 저장함 → 쓴 답을 보여주고 "고치기"
 * - 건너뜀 → 건너뛰었다는 안내 + "지금 쓰기"
 */
function WeeklyReviewCard({ weekStart }: WeeklyReviewCardProps) {
  // 이 주에 저장된 회고. 없으면 undefined
  const [saved, setSaved] = useState<WeeklyReview | undefined>(() => findWeeklyReview(weekStart))
  // 아직 저장한 게 없으면 처음부터 입력 칸을 보여줍니다.
  const [isEditing, setIsEditing] = useState(saved === undefined)
  const [answers, setAnswers] = useState<ReviewAnswers>(() =>
    saved && !saved.skipped
      ? { best: saved.best, regret: saved.regret, change: saved.change }
      : emptyAnswers,
  )

  // 세 칸이 모두 비어 있으면 저장할 게 없어서 저장 버튼을 막습니다. (안 쓸 거면 건너뛰기)
  const hasAnyAnswer = Object.values(answers).some((answer) => answer.trim() !== '')

  /** 회고를 저장하고 화면을 "저장함/건너뜀" 모습으로 바꿉니다. */
  function save(nextAnswers: ReviewAnswers, skipped: boolean) {
    const review: WeeklyReview = { weekStart, ...nextAnswers, skipped, savedAt: Date.now() }
    saveWeeklyReview(review)
    // 저장 함수가 다듬은 값(앞뒤 공백 제거 등)을 그대로 보여주려고 다시 읽습니다.
    setSaved(findWeeklyReview(weekStart))
    setIsEditing(false)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // form 의 기본 동작(페이지 새로고침)을 막습니다.
    event.preventDefault()
    if (!hasAnyAnswer) return
    save(answers, false)
  }

  function handleSkip() {
    save(emptyAnswers, true)
    setAnswers(emptyAnswers)
  }

  function handleEdit() {
    setIsEditing(true)
  }

  function handleCancel() {
    // 고치던 내용을 버리고 저장된 답으로 되돌립니다.
    if (saved && !saved.skipped) {
      setAnswers({ best: saved.best, regret: saved.regret, change: saved.change })
    } else {
      setAnswers(emptyAnswers)
    }
    setIsEditing(false)
  }

  if (!isEditing && saved?.skipped) {
    return (
      <Card className="mt-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-600">이 주는 회고를 건너뛰었어요.</p>
          <Button variant="secondary" onClick={handleEdit} className="self-start sm:self-auto">
            지금 쓰기
          </Button>
        </div>
      </Card>
    )
  }

  if (!isEditing && saved) {
    return (
      <Card className="mt-3">
        <dl className="flex flex-col gap-4">
          {reviewQuestions.map((question) => (
            <div key={question.field}>
              <dt className="text-sm font-semibold text-slate-900">{question.label}</dt>
              <dd
                className={cn(
                  'mt-1 text-sm break-words',
                  saved[question.field] ? 'text-slate-700' : 'text-slate-400',
                )}
              >
                {saved[question.field] || '안 썼어요'}
              </dd>
            </div>
          ))}
        </dl>
        <Button variant="secondary" onClick={handleEdit} className="mt-4">
          고치기
        </Button>
      </Card>
    )
  }

  return (
    <Card className="mt-3">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {reviewQuestions.map((question) => (
          <div key={question.field} className="flex flex-col gap-1">
            <Input
              id={`review-${question.field}`}
              label={question.label}
              placeholder={question.placeholder}
              maxLength={REVIEW_MAX_LENGTH}
              value={answers[question.field]}
              onChange={(event) =>
                setAnswers((prev) => ({ ...prev, [question.field]: event.target.value }))
              }
            />
            <p className="text-right text-xs text-slate-400 tabular-nums">
              {answers[question.field].length} / {REVIEW_MAX_LENGTH}
            </p>
          </div>
        ))}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          {/* 이미 저장한 회고를 고치는 중이면 "취소", 처음 쓰는 중이면 "건너뛰기" 를 보여줍니다. */}
          {saved ? (
            <Button variant="ghost" onClick={handleCancel}>
              취소
            </Button>
          ) : (
            <Button variant="ghost" onClick={handleSkip}>
              건너뛰기
            </Button>
          )}
          <Button type="submit" disabled={!hasAnyAnswer}>
            저장하기
          </Button>
        </div>
      </form>
    </Card>
  )
}
