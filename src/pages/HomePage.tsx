import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { CareModeBanner } from '@/components/ui/CareModeBanner'
import { ExperimentSection } from '@/components/ui/ExperimentSection'
import { InsightCard } from '@/components/ui/InsightCard'
import { PlayBadge } from '@/components/ui/PlayBadge'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { SubjectBadge } from '@/components/ui/SubjectBadge'
import { VoicePledgePlayButton } from '@/components/ui/VoicePledgePlayButton'
import { WeeklyFactCard } from '@/components/ui/WeeklyFactCard'
import { loadManualItems } from '@/hooks/useManualItems'
import { usePlans } from '@/hooks/usePlans'
import { useStopwatch } from '@/hooks/useStopwatch'
import { cn } from '@/lib/cn'
import { DEFAULT_TARGET_MINUTES, normalizeTargetMinutes } from '@/lib/countdown'
import { groupSessionsByDate, loadAllSessions, loadStudySessions } from '@/lib/dailyRecords'
import { getTodayKey, toDayDate, toDayKey } from '@/lib/date'
import { dailyCoachQuery, getYesterdayLine, type YesterdayLine } from '@/lib/dailyCoach'
import { getDaySummary } from '@/lib/daySummary'
import { formatDday } from '@/lib/exams'
import { getFirstMe, type FirstMe } from '@/lib/firstMe'
import { isSafetyBrakeOnNow } from '@/lib/focusMode'
import { loadInitialPlan } from '@/lib/initialPlan'
import { getInsightsToShow } from '@/lib/insights'
import { getCareLimits } from '@/lib/careLimits'
import { useSubjects } from '@/hooks/useSubjects'
import { getDayProgress, getPlanProgress } from '@/lib/planProgress'
import { loadData } from '@/lib/storage'
import { sortPlansForNow } from '@/lib/timeline'
import { getTimerDisplay, loadTimerMode } from '@/lib/timerDisplay'
import { getTodayCareLevel, getTodayCareReason } from '@/lib/todayCare'
import { getTreeState, type TreeState } from '@/lib/tree'
import { loadVoicePledge } from '@/lib/voicePledge'
import { getMondayKey, getWeeklyFacts } from '@/lib/weeklyFacts'
import {
  getWeeklyGoalCandidates,
  getWeeklyGoalProgress,
  getWeeklyGoalReason,
  getWeeklyGoalTitle,
  loadWeeklyGoalChoices,
  saveWeeklyGoalChoice,
  type WeeklyGoalChoice,
} from '@/lib/weeklyGoal'
import { loadWeeklyReviews } from '@/lib/weeklyReview'
import type { InitialPlan, StudyPlan, StudySession, Subject } from '@/types'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

// 며칠 동안 기록이 쌓여야 첫 리포트를 보여줄지 (#85)
const FIRST_REPORT_DAYS = 14

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

/** 분을 "3시간 10분" 처럼 보여줍니다. 60분 미만이면 "분"만 보여줍니다. */
function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}분`
  if (minutes === 0) return `${hours}시간`
  return `${hours}시간 ${minutes}분`
}

/** 공부 기록으로 지금 나무 상태를 계산합니다. */
function calculateTree(): TreeState {
  const days = groupSessionsByDate(loadStudySessions())
  const totalStudyMinutes = days.reduce((sum, day) => sum + day.totalMinutes, 0)
  const today = days.find((day) => day.date === getTodayKey())

  return getTreeState({
    totalStudyMinutes,
    todayStudyMinutes: today?.totalMinutes ?? 0,
    careLevel: getTodayCareLevel(),
    // 잎 = 건너뛰지 않고 쓴 주간 회고의 수 (#82)
    reflectionCount: loadWeeklyReviews().filter((review) => !review.skipped).length,
    // TODO(#73): 진짜 인사이트가 아직 없어서 0 입니다. (지금 인사이트는 개발용 예시뿐입니다)
    insightCount: 0,
    // 열매 = "나 사용설명서" 에 올라간 효과가 확인된 방법의 수 (#87, #93)
    manualItemCount: loadManualItems().length,
  })
}

/** 오늘 날짜를 '10월 10일 토요일' 처럼 보여줍니다. (새벽 4시 전이면 어제 날짜를 넘겨받습니다) */
function formatToday(date: Date): string {
  return date.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })
}

// Link(주소로 이동하는 글자)를 버튼처럼 보이게 하는 클래스입니다.
// Button 은 <button> 이라서, 다른 화면으로 가는 곳에는 Link 에 이 클래스를 붙여 씁니다.
// h-12 / h-10: 손가락으로 누르기 쉽게 높이를 40px 이상으로 둡니다.
const bigLinkClass =
  'bg-brand hover:bg-brand-dark flex h-12 w-full items-center justify-center rounded-lg text-base font-semibold text-white transition-colors'
const textLinkClass =
  'text-brand inline-flex h-10 items-center text-sm font-medium underline underline-offset-4'

export function HomePage() {
  const navigate = useNavigate()
  const [tree] = useState(calculateTree)
  // 오늘의 관리 강도와, 내가 정한 최대 한도입니다. 화면이 처음 그려질 때 한 번만 읽습니다. (#94)
  const [careLevel] = useState(getTodayCareLevel)
  const [maxCareLevel] = useState(() => getCareLimits().maxCareLevel)

  const { allPlans, getPlans } = usePlans()
  // 타이머가 저장해 둔 공부 기록을 불러옵니다. 없으면 빈 목록입니다. (예시 숫자를 보여주지 않습니다)
  const [sessions] = useState<StudySession[]>(loadStudySessions)
  // 노는 기록까지 들어 있는 전체 기록입니다. 계획별 실제 시간(`12 / 50분`)은 노는 계획에도 보여야 해서 따로 읽습니다. (#238)
  const [allSessions] = useState<StudySession[]>(loadAllSessions)
  // 계획 화면에서 저장한 과목 목록입니다. 과목 태그의 이름과 색을 찾는 데 씁니다.
  const subjects = useSubjects()
  // 온보딩에서 내가 적은 시험 날짜와 공부하는 이유입니다. (lib/firstMe.ts)
  const [firstMe] = useState(() =>
    getFirstMe(loadData<unknown>('onboarding-answers', null), new Date()),
  )
  // 온보딩 마지막에 세운 처음 계획. 아직 안 세웠으면 null 입니다. (#240)
  const [initialPlan] = useState(loadInitialPlan)
  // 인사이트는 가상 데이터를 넣었을 때만 예시로 보여줍니다. (lib/insights.ts)
  const { insights, isExample: isExampleInsight } = getInsightsToShow(sessions)

  const todayKey = getTodayKey()
  const yesterdayKey = moveDateKey(todayKey, -1)

  // 오늘 계획과, 그중 아직 안 끝난 것입니다. 안 끝난 것의 맨 앞이 "지금 할 일" 입니다.
  const todayPlans = getPlans(todayKey)
  // 시작 시각이 된 계획 → 시각을 안 정한 계획 → 아직 시각이 안 된 계획 순서로 줄 세웁니다. (lib/timeline.ts)
  const now = new Date()
  const undonePlans = sortPlansForNow(
    todayPlans.filter((plan) => !plan.done),
    now.getHours() * 60 + now.getMinutes(),
  )

  // 첫 기록 날짜 = 계획과 공부 기록을 통틀어 가장 이른 날짜. 기록이 하나도 없으면 null 입니다.
  const recordDates = [
    ...allPlans.map((plan) => plan.date),
    ...sessions.map((session) => toDayKey(session.startedAt)),
  ]
  const firstRecordKey = recordDates.length === 0 ? null : [...recordDates].sort()[0]
  const daysSinceFirstRecord = firstRecordKey === null ? 0 : countDays(firstRecordKey, todayKey)
  const isFirstReportReady = firstRecordKey !== null && daysSinceFirstRecord >= FIRST_REPORT_DAYS

  const yesterdaySummary = getDaySummary(yesterdayKey, allPlans, sessions)
  // 어제 공부 계획이 있었는지. (노는 계획과 0분짜리 계획은 세지 않습니다)
  const hasYesterdayPlan = allPlans.some(
    (plan) => plan.date === yesterdayKey && plan.kind !== 'play' && plan.targetMinutes > 0,
  )

  return (
    <div className="flex flex-col gap-8">
      <section className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-slate-500">
            {formatToday(toDayDate(new Date()))}
            {firstMe.daysUntilExam !== null &&
              ` · ${firstMe.examName} ${formatDday(firstMe.daysUntilExam)}`}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            오늘도 같이 시작해 볼까?
          </h1>
        </div>
        {/* 체크인은 꼭 해야 하는 일이 아니라서, 큰 카드 대신 작은 글자로 둡니다. (#243) */}
        <Link to="/check" className={cn(textLinkClass, 'shrink-0 whitespace-nowrap')}>
          자세히 체크인
        </Link>
      </section>

      {/* 열자마자 공부를 시작할 수 있게 "지금 할 일" 을 맨 위에 둡니다. PC 에서는 "처음의 나" 와 나란히 놓입니다. (#243) */}
      {/* sm:items-start: 두 카드의 높이를 억지로 맞추지 않고 내용만큼만 차지하게 합니다. */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-start">
        <NowCard
          undonePlans={undonePlans}
          hasPlansToday={todayPlans.length > 0}
          allPlans={allPlans}
          subjects={subjects}
          sessions={allSessions}
        />
        <FirstMeCard firstMe={firstMe} initialPlan={initialPlan} />
      </section>

      {/* 지금 관리 모드와 그 이유 (#94) */}
      <CareModeBanner
        level={careLevel}
        reason={getTodayCareReason(careLevel)}
        maxLevel={maxCareLevel}
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-start">
        <TodayCard plans={todayPlans} subjects={subjects} sessions={allSessions} />

        {/* 이번 주 팩트 (#245). 묻지 않고 계획과 타이머 기록에서 계산한 숫자입니다. */}
        <WeeklyFactCard
          plans={allPlans}
          sessions={sessions}
          initialPlan={initialPlan}
          action={
            <Link to="/report" className={cn(textLinkClass, 'shrink-0 whitespace-nowrap')}>
              리포트에서 자세히
            </Link>
          }
        />

        {/* 이번 주 목표 (#247). 지난주 팩트로 하나 제안하고, 달성했는지는 타이머 기록으로 정해집니다. */}
        <WeeklyGoalCard plans={allPlans} sessions={sessions} />

        <Card title="어제 한 줄">
          {/* 숫자는 코드가 계산하고, 그 숫자를 말로 푸는 일만 AI 에게 맡깁니다. 문장 규칙은 lib/dailyCoach.ts 에 있습니다. */}
          <YesterdayLineView
            dateKey={yesterdayKey}
            line={getYesterdayLine(yesterdaySummary, hasYesterdayPlan)}
          />

          {/* 첫 리포트(14일)까지 남은 날. 시안처럼 어제 한 줄 아래에 선을 긋고 같은 카드에 둡니다. (#85) */}
          <div className="mt-4 border-t border-slate-100 pt-4">
            {firstRecordKey === null ? (
              <p className="text-sm text-slate-500">
                기록을 시작하면 첫 리포트까지 며칠 남았는지 세어줄게요.
              </p>
            ) : isFirstReportReady ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-slate-600">
                  {FIRST_REPORT_DAYS}일치 기록이 다 쌓였어요!
                </p>
                <Button onClick={() => navigate('/report')}>첫 리포트 보기</Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-base font-semibold text-slate-900">
                    첫 리포트까지 D-{FIRST_REPORT_DAYS - daysSinceFirstRecord}
                  </p>
                  <p className="shrink-0 text-sm text-slate-500">
                    {daysSinceFirstRecord} / {FIRST_REPORT_DAYS}일
                  </p>
                </div>
                <ProgressBar value={(daysSinceFirstRecord / FIRST_REPORT_DAYS) * 100} />
                <p className="text-sm text-slate-500">
                  {FIRST_REPORT_DAYS}일 동안 기록이 쌓이면 나만의 패턴을 알려줄게.
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* 내 나무 (#68) */}
        <TreeCard tree={tree} />
      </section>

      {/* 이번 주 발견 (#73) */}
      <section>
        <h2 className="text-lg font-bold text-slate-900">이번 주 발견</h2>
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

      {/* 도전 중인 실험의 진행 상황과, 끝난 실험의 결과·다음 행동 버튼 (#93) */}
      <section>
        <h2 className="text-lg font-bold text-slate-900">실험</h2>
        <ExperimentSection plans={allPlans} sessions={sessions} className="mt-3" />
      </section>
    </div>
  )
}

interface NowCardProps {
  /** 오늘의 안 끝난 계획. 맨 앞이 "지금 할 일" 입니다 */
  undonePlans: StudyPlan[]
  /** 오늘 계획이 하나라도 있는지. (없으면 "계획 세우기", 다 끝냈으면 "다 끝냈어요" 를 보여줍니다) */
  hasPlansToday: boolean
  /** 모든 날짜의 계획. 타이머가 재고 있는 계획을 id 로 찾는 데 씁니다 */
  allPlans: StudyPlan[]
  subjects: Subject[]
  /** 계획별 실제 시간을 구할 기록. 노는 기록까지 들어 있어야 합니다 */
  sessions: StudySession[]
}

/**
 * "지금 할 일" 카드. 홈을 열자마자 한 번 눌러서 공부를 시작하게 해 줍니다. (#243)
 * 타이머가 이미 돌고 있으면 같은 자리에 진행 중인 타이머를 보여줍니다.
 *
 * 스톱워치는 흐르는 동안 1초에 몇 번씩 화면을 다시 그립니다.
 * 홈 전체가 아니라 이 카드만 다시 그려지도록, useStopwatch 를 이 카드 안에서 부릅니다.
 */
function NowCard({ undonePlans, hasPlansToday, allPlans, subjects, sessions }: NowCardProps) {
  const { seconds, isStarted, isRunning } = useStopwatch()
  // 타이머 화면이 저장해 둔 값들입니다. 홈에서는 바꾸지 않고 읽기만 합니다.
  const [mode] = useState(loadTimerMode)
  const [targetMinutes] = useState(() =>
    normalizeTargetMinutes(loadData<unknown>('timer-target', DEFAULT_TARGET_MINUTES)),
  )
  const [timerPlanId] = useState(() => loadData<string | null>('timer-plan', null))
  const [timerSubjectId] = useState(() => loadData<string | null>('timer-subject', null))

  // ① 타이머가 이미 돌고 있을 때 (일시정지 중이어도 여기로 옵니다)
  if (isStarted) {
    const display = getTimerDisplay(mode, seconds, targetMinutes)
    const timerPlan = allPlans.find((plan) => plan.id === timerPlanId)
    const timerSubject = subjects.find((subject) => subject.id === timerSubjectId)

    return (
      <Card className="border-brand border-2">
        <h3 className="text-sm font-medium text-slate-500">
          {isRunning ? '타이머 진행 중' : '타이머 일시정지 중'}
        </h3>
        <div className="mt-2 flex items-center gap-2">
          {timerSubject && (
            <SubjectBadge
              name={timerSubject.name}
              color={timerSubject.color}
              className="shrink-0"
            />
          )}
          {timerPlan?.kind === 'play' && <PlayBadge className="shrink-0" />}
          <p className="min-w-0 text-lg font-semibold break-words text-slate-900">
            {timerPlan ? timerPlan.content : '계획 없이 공부'}
          </p>
        </div>
        {/* tabular-nums: 숫자 폭을 똑같이 맞춰서, 초가 바뀔 때 글자가 좌우로 흔들리지 않게 합니다. */}
        <p className="mt-3 text-4xl font-bold tracking-tight text-slate-900 tabular-nums">
          {display.timeText}
        </p>
        <p className="mt-1 text-sm text-slate-500">{display.label}</p>
        <Link to="/timer" className={cn(bigLinkClass, 'mt-4')}>
          타이머로 가기
        </Link>
      </Card>
    )
  }

  // ② 오늘 할 계획이 남아 있을 때
  const nextPlan = undonePlans[0]
  if (nextPlan) {
    const subject = subjects.find((item) => item.id === nextPlan.subjectId)
    const progress = getPlanProgress(nextPlan, sessions)
    // 그다음에 할 계획은 2개까지만 미리 보여줍니다.
    const laterPlans = undonePlans.slice(1, 3)

    return (
      <Card className="border-brand border-2">
        <h3 className="text-sm font-medium text-slate-500">지금 할 일</h3>
        <div className="mt-2 flex items-center gap-2">
          {subject && (
            <SubjectBadge name={subject.name} color={subject.color} className="shrink-0" />
          )}
          {/* 노는 계획은 과목 대신 회색 "놀기" 태그를 보여줍니다. (#238) */}
          {nextPlan.kind === 'play' && <PlayBadge className="shrink-0" />}
          <p className="min-w-0 text-lg font-semibold break-words text-slate-900">
            {nextPlan.content}
          </p>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          {nextPlan.startTime && `${nextPlan.startTime} · `}
          목표 {nextPlan.targetMinutes}분
          {progress.actualMinutes > 0 && ` · 지금까지 ${progress.actualMinutes}분 했어요`}
        </p>
        {/* 주소에 ?plan=계획id 를 붙여 보내면 타이머 화면이 그 계획으로 바로 시작합니다. (#232) */}
        <Link to={`/timer?plan=${nextPlan.id}`} className={cn(bigLinkClass, 'mt-4')}>
          ▶ {progress.actualMinutes > 0 ? '이어서 하기' : '시작'}
        </Link>
        {laterPlans.length > 0 && (
          <p className="mt-3 text-sm break-words text-slate-500">
            다음: {laterPlans.map((plan) => `${plan.content} ${plan.targetMinutes}분`).join(' · ')}
          </p>
        )}
      </Card>
    )
  }

  // ③ 오늘 계획이 없거나, 다 끝냈을 때
  return (
    <Card className="border-brand border-2">
      <h3 className="text-sm font-medium text-slate-500">지금 할 일</h3>
      <p className="mt-2 text-lg font-semibold text-slate-900">
        {hasPlansToday ? '오늘 계획을 다 끝냈어요!' : '오늘 계획이 아직 없어요.'}
      </p>
      <p className="mt-1 text-sm text-slate-600">
        {hasPlansToday
          ? '더 하고 싶으면 계획을 하나 더 세워 보세요.'
          : '할 일을 하나만 정해도 여기서 바로 시작할 수 있어요.'}
      </p>
      <Link to="/planner" className={cn(bigLinkClass, 'mt-4')}>
        {hasPlansToday ? '계획 더 세우기' : '오늘 계획 세우기'}
      </Link>
      <Link to="/timer" className={cn(textLinkClass, 'mt-1')}>
        계획 없이 바로 시작
      </Link>
    </Card>
  )
}

interface FirstMeCardProps {
  firstMe: FirstMe
  /** 온보딩 마지막에 세운 처음 계획. 안 세웠으면 null */
  initialPlan: InitialPlan | null
}

/**
 * "처음의 나" 카드. 온보딩에서 내가 직접 적은 시험 날짜와 공부하는 이유를 다시 보여줍니다. (#243)
 * 처음의 마음은 시간이 지나면 흐려지기 때문에, 가장 잘 보이는 홈 위쪽에 둡니다.
 */
function FirstMeCard({ firstMe, initialPlan }: FirstMeCardProps) {
  // 처음에 남긴 다짐(목소리·글). 없으면 null 입니다. (#241)
  const [voicePledge] = useState(loadVoicePledge)
  const hasReason = firstMe.reason !== ''
  const isEmpty = firstMe.daysUntilExam === null && !hasReason

  return (
    <Card>
      <h3 className="text-sm font-medium text-slate-500">처음의 나</h3>

      {firstMe.daysUntilExam !== null && (
        <p className="mt-2 text-2xl font-bold break-words text-slate-900">
          {firstMe.examName} {formatDday(firstMe.daysUntilExam)}
        </p>
      )}

      {hasReason && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3">
          <p className="text-base font-semibold break-words text-slate-900">“{firstMe.reason}”</p>
          <p className="mt-1 text-sm text-slate-500">처음에 내가 적은 공부하는 이유</p>
        </div>
      )}

      {/* 처음에 한 약속. 지금과 비교하는 숫자는 "이번 주 팩트"(#245)에서 보여줍니다. (#240) */}
      {initialPlan && (
        <p className="mt-3 text-sm text-slate-600">
          처음 계획: 하루 {formatMinutes(initialPlan.dailyMinutes)} · 주 {initialPlan.daysPerWeek}일
        </p>
      )}

      {/* 처음의 내가 녹음해 둔 한마디. 녹음이 있을 때만 보입니다. (#241) */}
      {voicePledge?.audioDataUrl && (
        <VoicePledgePlayButton
          audioDataUrl={voicePledge.audioDataUrl}
          seconds={voicePledge.seconds}
          className="mt-3 border border-slate-200"
        />
      )}

      {isEmpty && (
        <>
          <p className="mt-2 text-sm text-slate-600">
            시험 날짜와 공부하는 이유를 알려주면, 힘들 때 여기서 다시 보여줄게요.
          </p>
          {/* 처음 설문을 안 한 사람은 처음 설문으로, 한 사람은 남은 질문을 이어서 답하는 화면으로 보냅니다. (#239) */}
          <Link
            to={firstMe.hasAnswers ? '/onboarding/more' : '/onboarding'}
            className={cn(textLinkClass, 'mt-1')}
          >
            내 정보 더 알려주기
          </Link>
        </>
      )}
    </Card>
  )
}

interface WeeklyGoalCardProps {
  plans: StudyPlan[]
  sessions: StudySession[]
}

/**
 * 이번 주 목표 카드입니다. (#247 · 규칙은 lib/weeklyGoal.ts)
 *
 *   아직 안 골랐다 → 지난주 팩트로 만든 목표 하나를 제안합니다. [이걸로 할게] [다른 걸로] [이번 주는 쉴게]
 *   목표를 골랐다 → 지금 숫자와 진행 막대를 보여줍니다. 달성했는지는 팩트 숫자로 자동으로 정해집니다.
 *   쉬기로 했다   → 쉬어 간다는 한 줄만 보여줍니다.
 *
 * 회복 모드이거나 안전 브레이크가 켜져 있으면 새 목표를 권하지 않습니다. (카드가 보이지 않습니다)
 */
function WeeklyGoalCard({ plans, sessions }: WeeklyGoalCardProps) {
  const today = new Date()
  const mondayKey = getMondayKey(today)
  const { thisWeek, lastWeek } = getWeeklyFacts(plans, sessions, mondayKey, getTodayKey())

  // 이번 주에 이미 고른 것(목표 또는 쉬기). 아직 안 골랐으면 null 입니다.
  const [choice, setChoice] = useState<WeeklyGoalChoice | null>(
    () => loadWeeklyGoalChoices().find((item) => item.mondayKey === mondayKey) ?? null,
  )
  // "다른 걸로" 를 누른 횟수. 후보 중 몇 번째를 보여줄지 정합니다.
  const [skipCount, setSkipCount] = useState(0)
  // 회복 모드(관리 강도 0)이거나 안전 브레이크가 켜져 있으면 새 목표를 권하지 않습니다. 처음 그릴 때 한 번만 확인합니다.
  const [canSuggest] = useState(() => getTodayCareLevel() !== 0 && !isSafetyBrakeOnNow())

  function handleChoose(nextChoice: WeeklyGoalChoice) {
    saveWeeklyGoalChoice(nextChoice)
    setChoice(nextChoice)
  }

  /* ---------- 쉬기로 한 주 ---------- */
  if (choice?.type === 'rest') {
    return (
      <Card title="이번 주 목표">
        <p className="text-sm break-keep text-slate-600">
          이번 주는 목표 없이 쉬어 가요. 다음 주에 다시 제안할게요.
        </p>
      </Card>
    )
  }

  /* ---------- 목표를 고른 주 ---------- */
  if (choice?.type === 'goal') {
    const progress = getWeeklyGoalProgress(choice, thisWeek)
    const unit = choice.kind === 'startDelay' ? '분' : '%'

    // 지금 숫자 옆에 붙이는 설명. 몇 개의 기록으로 계산했는지 같이 보여줍니다.
    let detail = ''
    if (choice.kind === 'startDelay') {
      detail = `계획 ${thisWeek.startDelayMinutes.sampleCount}개 기준`
    } else if (choice.kind !== 'planRate') {
      detail = `${thisWeek.completionRate.sampleCount}번 중 ${thisWeek.completedCount}번 완주`
    }

    return (
      <Card title="이번 주 목표">
        <p className="text-lg font-bold break-keep text-slate-900">{getWeeklyGoalTitle(choice)}</p>
        <div className="mt-3 flex items-center justify-between gap-2 text-sm">
          {progress.current === null ? (
            <p className="text-slate-600">아직 이번 주 기록이 없어요</p>
          ) : (
            <p className="min-w-0 break-keep text-slate-600">
              지금{' '}
              <strong className="font-semibold text-slate-900">
                {choice.kind === 'startDelay' && '평균 '}
                {progress.current}
                {unit}
              </strong>
              {detail !== '' && ` · ${detail}`}
            </p>
          )}
          <p className="shrink-0 text-slate-500">
            목표 {choice.target}
            {unit}
          </p>
        </div>
        <ProgressBar value={progress.percent} className="mt-2" />
        <p className="mt-2 text-sm break-keep text-slate-500">
          {progress.status === 'achieved' && (
            <span className="font-semibold text-emerald-600">지금은 달성 중 · </span>
          )}
          달성했는지는 타이머 기록으로 자동으로 정해져요.
        </p>
      </Card>
    )
  }

  /* ---------- 아직 안 고른 주 ---------- */
  if (!canSuggest) return null

  const candidates = getWeeklyGoalCandidates(lastWeek)
  if (candidates.length === 0) {
    return (
      <Card title="이번 주 목표">
        <p className="text-sm break-keep text-slate-600">
          목표를 정한 타이머 기록이 한 주에 5번 이상 쌓이면, 다음 주에 해볼 만한 목표를 하나
          제안할게요.
        </p>
      </Card>
    )
  }

  // 후보를 돌아가며 보여줍니다. 마지막 후보 다음에는 처음으로 돌아옵니다. (% 는 나눈 나머지)
  const candidate = candidates[skipCount % candidates.length]

  return (
    <Card title="이번 주 목표 제안">
      <p className="text-lg font-bold break-keep text-slate-900">{getWeeklyGoalTitle(candidate)}</p>
      <p className="mt-1 text-sm break-keep text-slate-600">{getWeeklyGoalReason(candidate)}</p>
      <p className="mt-1 text-sm break-keep text-slate-500">
        달성했는지는 타이머 기록으로 자동으로 정해져요.
      </p>
      {/* flex-wrap: 좁은 화면에서는 버튼이 다음 줄로 넘어갑니다. */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => handleChoose({ ...candidate, type: 'goal', mondayKey })}>
          이걸로 할게
        </Button>
        {/* 후보가 하나뿐이면 바꿀 것이 없어서 보여주지 않습니다. */}
        {candidates.length > 1 && (
          <Button variant="secondary" onClick={() => setSkipCount((prev) => prev + 1)}>
            다른 걸로
          </Button>
        )}
        <Button variant="ghost" onClick={() => handleChoose({ type: 'rest', mondayKey })}>
          이번 주는 쉴게
        </Button>
      </div>
    </Card>
  )
}

interface TodayCardProps {
  /** 오늘 계획 전부 (끝낸 것 포함) */
  plans: StudyPlan[]
  subjects: Subject[]
  sessions: StudySession[]
}

/**
 * "오늘 계획" 카드. 끝낸 개수와 `실제 / 목표` 시간을 보여줍니다. (#243)
 * 여기서는 보기만 하고, 체크와 수정은 계획 화면에서 합니다.
 */
function TodayCard({ plans, subjects, sessions }: TodayCardProps) {
  // 끝낸 개수 · 실제 시간 · 목표 시간은 lib/planProgress.ts 가 계산합니다.
  const dayProgress = getDayProgress(plans, sessions)

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold text-slate-900">오늘 계획</h3>
        {plans.length > 0 && (
          <p className="text-sm text-slate-500">
            {dayProgress.doneCount} / {dayProgress.totalCount} 완료 ·{' '}
            {formatMinutes(dayProgress.actualMinutes)} / {formatMinutes(dayProgress.targetMinutes)}
          </p>
        )}
      </div>

      {plans.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          계획을 세우면 오늘 얼마나 했는지 여기에 보여요.
        </p>
      ) : (
        <>
          <ProgressBar value={dayProgress.percent} className="mt-3" />
          <ul className="mt-2 divide-y divide-slate-100">
            {plans.map((plan) => {
              const subject = subjects.find((item) => item.id === plan.subjectId)
              const progress = getPlanProgress(plan, sessions)

              return (
                <li key={plan.id} className="flex items-center gap-2 py-2.5">
                  {/* 끝낸 계획은 ✓, 아직인 계획은 빈 동그라미입니다. 여기서는 누를 수 없어서 체크박스(네모)로 그리지 않습니다. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-full border text-xs font-bold',
                      plan.done ? 'border-brand bg-brand text-white' : 'border-slate-300',
                    )}
                  >
                    {plan.done && '✓'}
                  </span>
                  {subject && (
                    <SubjectBadge name={subject.name} color={subject.color} className="shrink-0" />
                  )}
                  {plan.kind === 'play' && <PlayBadge className="shrink-0" />}
                  <p
                    className={cn(
                      'min-w-0 flex-1 text-sm break-words text-slate-900',
                      plan.done && 'text-slate-400 line-through',
                    )}
                  >
                    {plan.content}
                    {/* sr-only: 화면에는 안 보이고, 화면을 읽어 주는 프로그램만 읽습니다. */}
                    <span className="sr-only">{plan.done ? ' (끝냄)' : ' (아직)'}</span>
                  </p>
                  <p className="shrink-0 text-sm text-slate-500 tabular-nums">
                    {progress.actualMinutes} / {plan.targetMinutes}분
                  </p>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <Link to="/planner" className={cn(textLinkClass, 'mt-2')}>
        계획 화면에서 체크·수정하기
      </Link>
    </Card>
  )
}

interface TreeCardProps {
  tree: TreeState
}

/** "내 나무" 카드. 나무 그림 + 잎·열매 개수 + 다음 단계까지 남은 시간 */
function TreeCard({ tree }: TreeCardProps) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900">내 나무</h3>
        <p className="text-sm text-slate-500">
          {tree.stageName} · {tree.stage + 1}단계
          {tree.isWilted && <span className="font-semibold text-amber-700"> · 시듦</span>}
        </p>
      </div>

      <div className="mt-3 flex justify-center rounded-lg bg-slate-50 px-4 py-3">
        <TreeDrawing tree={tree} />
      </div>

      {tree.isWilted && (
        <p className="mt-3 text-sm text-amber-700">
          나무가 조금 시들었어. 오늘 공부를 시작하면 바로 다시 살아나.
        </p>
      )}

      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
        <span>
          <span className="font-semibold text-green-700">잎 {tree.leafCount}</span> · 회고·인사이트
        </span>
        <span>
          <span className="font-semibold text-orange-600">열매 {tree.fruitCount}</span> · 효과가
          확인된 방법
        </span>
      </p>

      <div className="mt-4 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2 text-sm text-slate-600">
          <span>다음 단계까지</span>
          <span>
            {tree.isFullGrown ? '다 자랐어!' : `${formatMinutes(tree.minutesToNextStage)} 남음`}
          </span>
        </div>
        <ProgressBar value={tree.progressPercent} />
      </div>
    </Card>
  )
}

// 큰 나무 위에 잎(작은 흰 점)과 열매(주황 동그라미)를 그릴 자리입니다. 개수가 많아도 이 자리까지만 그립니다.
const LEAF_SPOTS = [
  { x: 78, y: 52 },
  { x: 100, y: 34 },
  { x: 122, y: 50 },
  { x: 66, y: 68 },
  { x: 90, y: 60 },
  { x: 114, y: 66 },
  { x: 134, y: 70 },
  { x: 106, y: 44 },
]
const FRUIT_SPOTS = [
  { x: 118, y: 58 },
  { x: 84, y: 72 },
  { x: 100, y: 52 },
  { x: 130, y: 76 },
  { x: 70, y: 58 },
]

interface TreeDrawingProps {
  tree: TreeState
}

/** 나무 그림 (라이브러리 없이 SVG 를 직접 그립니다) */
function TreeDrawing({ tree }: TreeDrawingProps) {
  // 시들면 초록 잎이 누런 갈색으로 바뀝니다. transition-colors 로 색이 천천히 바뀝니다.
  const leafColor = tree.isWilted ? 'fill-amber-600' : 'fill-green-500'
  const darkLeafColor = tree.isWilted ? 'fill-amber-700' : 'fill-green-700'
  const label = `${tree.stageName}${tree.isWilted ? ', 시든 모습' : ''}`

  // 큰 나무가 되어야 잎·열매 점을 그립니다. (씨앗·새싹에는 붙일 자리가 없어서 개수 글자로만 보여줍니다)
  const leafSpots = tree.stage === 3 ? LEAF_SPOTS.slice(0, tree.leafCount) : []
  const fruitSpots = tree.stage === 3 ? FRUIT_SPOTS.slice(0, tree.fruitCount) : []

  return (
    <svg role="img" aria-label={label} viewBox="0 0 200 140" className="h-36 w-full max-w-full">
      {/* 땅 그림자 */}
      <ellipse cx="100" cy="128" rx="60" ry="6" className="fill-slate-200" />

      {/*
        key 가 단계마다 달라서, 단계가 바뀌면 이 묶음이 새로 그려집니다.
        starting: 는 "처음 나타날 때의 모습" 이라, 작고 투명한 상태에서 transition 으로 커지며 나타납니다.
      */}
      <g
        key={tree.stage}
        className="origin-bottom transition duration-700 ease-out [transform-box:fill-box] starting:scale-50 starting:opacity-0"
      >
        {tree.stage === 0 && <ellipse cx="100" cy="122" rx="9" ry="6" className="fill-amber-800" />}

        {tree.stage === 1 && (
          <>
            <rect x="98" y="96" width="4" height="30" rx="2" className="fill-green-800" />
            <ellipse
              cx="88"
              cy="96"
              rx="12"
              ry="6"
              className={cn('transition-colors duration-700', leafColor)}
            />
            <ellipse
              cx="112"
              cy="90"
              rx="12"
              ry="6"
              className={cn('transition-colors duration-700', darkLeafColor)}
            />
          </>
        )}

        {tree.stage === 2 && (
          <>
            <rect x="95" y="80" width="10" height="46" rx="3" className="fill-amber-800" />
            <circle
              cx="100"
              cy="64"
              r="30"
              className={cn('transition-colors duration-700', leafColor)}
            />
          </>
        )}

        {tree.stage === 3 && (
          <>
            <rect x="92" y="76" width="16" height="50" rx="4" className="fill-amber-800" />
            <circle
              cx="74"
              cy="64"
              r="26"
              className={cn('transition-colors duration-700', leafColor)}
            />
            <circle
              cx="126"
              cy="64"
              r="26"
              className={cn('transition-colors duration-700', darkLeafColor)}
            />
            <circle
              cx="100"
              cy="46"
              r="30"
              className={cn('transition-colors duration-700', leafColor)}
            />
            {leafSpots.map((spot) => (
              <ellipse
                key={`leaf-${spot.x}-${spot.y}`}
                cx={spot.x}
                cy={spot.y}
                rx="5"
                ry="3"
                className="fill-white/70"
              />
            ))}
            {fruitSpots.map((spot) => (
              <circle
                key={`fruit-${spot.x}-${spot.y}`}
                cx={spot.x}
                cy={spot.y}
                r="5"
                className="fill-orange-500"
              />
            ))}
          </>
        )}
      </g>
    </svg>
  )
}

interface YesterdayLineViewProps {
  /** 어제 날짜 ('YYYY-MM-DD'). 날이 바뀌면 새로 물어보려고 받습니다. */
  dateKey: string
  /** 기본 문장과 AI 에게 건넬 숫자 (lib/dailyCoach.ts 의 getYesterdayLine) */
  line: YesterdayLine
}

/**
 * 홈의 "어제 한 줄" 입니다.
 *   어제 기록이 없음      -> 기본 문장만 ("오늘부터 시작해 볼까?"). 말로 풀 숫자가 없어서 AI 에게 묻지 않습니다.
 *   서버가 문장을 줌      -> AI 가 쓴 문장 + "AI 가 쓴 글" 표시 + 근거가 된 숫자 한 줄
 *   서버가 없거나 못 받음 -> 숫자를 끼워 만든 기본 문장
 */
function YesterdayLineView({ dateKey, line }: YesterdayLineViewProps) {
  // 설정에서 정한 관리 강도 한도와 독설 허용 수위. 서버가 이 한도 안에서 말투를 정합니다. 처음 그릴 때 한 번만 읽습니다.
  const [limits] = useState(getCareLimits)
  const fallback = <p className="text-base font-semibold text-slate-900">{line.sentence}</p>

  if (line.evidence.length === 0) return fallback

  return (
    // 홈은 열자마자 보여야 하는 화면이라, 서버 답을 기다리는 동안 스켈레톤 대신 기본 문장을 먼저 보여줍니다.
    <AsyncBoundary pendingFallback={fallback} resetKeys={[dateKey]}>
      <YesterdayAiLine
        dateKey={dateKey}
        fallbackSentence={line.sentence}
        // 서버에는 계산된 숫자와 내가 정한 한도만 보냅니다. 계획 내용·과목 이름 같은 원문은 보내지 않습니다.
        request={{
          numbers: line.evidence,
          maxCareLevel: limits.maxCareLevel,
          maxHarshness: limits.maxHarshness,
        }}
      />
    </AsyncBoundary>
  )
}

interface YesterdayAiLineProps {
  dateKey: string
  /** 서버가 문장을 주지 못했을 때 보여줄 기본 문장 */
  fallbackSentence: string
  /** 서버에 보낼 값 */
  request: Parameters<typeof dailyCoachQuery>[1]
}

/**
 * 서버에 "어제 한 줄" 을 물어보고 보여줍니다. useSuspenseQuery 가 기다리는 동안에는 바깥의 AsyncBoundary 가 기본 문장을 보여줍니다.
 * 서버가 없거나 실패하면 data 가 null 로 와서(에러가 아닙니다) 기본 문장을 그대로 보여줍니다.
 */
function YesterdayAiLine({ dateKey, fallbackSentence, request }: YesterdayAiLineProps) {
  const { data: aiSentence } = useSuspenseQuery(dailyCoachQuery(dateKey, request))

  if (aiSentence === null) {
    return <p className="text-base font-semibold text-slate-900">{fallbackSentence}</p>
  }

  return (
    <div>
      <p className="text-base font-semibold break-keep text-slate-900">{aiSentence}</p>
      {/* 누가 쓴 글인지 꼭 밝힙니다. AI 가 쓴 글은 틀릴 수 있어서, 바로 아래에 근거가 된 숫자(기본 문장)를 같이 보여줍니다. */}
      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
        <span className="bg-brand-light text-brand rounded px-1.5 py-0.5 text-xs font-medium">
          AI 가 쓴 글
        </span>
        <span className="break-keep">{fallbackSentence}</span>
      </p>
    </div>
  )
}
