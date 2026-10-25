import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { Button } from '@/components/ui/Button'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Skeleton } from '@/components/ui/Skeleton'
import { useCards } from '@/hooks/useCards'
import { useIsServerData } from '@/hooks/useIsServerData'
import { loadManualItems, useManualItems } from '@/hooks/useManualItems'
import { useQueryParam } from '@/hooks/useQueryParam'
import { useSubjects } from '@/hooks/useSubjects'
import { useWeeklyPicks } from '@/hooks/useWeeklyPicks'
import { answerChecksBetweenQuery, answerChecksQuery } from '@/lib/answerChecksApi'
import { loadCheckInsByDate } from '@/lib/callSummary'
import { loadCardMarks } from '@/lib/cardMarks'
import { cn } from '@/lib/cn'
import { loadStudySessions } from '@/lib/dailyRecords'
import { getTodayKey, isDateKey, moveDateKey, toDayKey } from '@/lib/date'
import {
  buildDayReports,
  buildWeekReport,
  countCompleteDaysUntil,
  dayHeadline,
  dayOfMonth,
  findWeekFinding,
  formatDuration,
  formatShortDuration,
  formatWeekLabel,
  getDayReport,
  getFirstRecordDay,
  getPickResult,
  getPlanPercent,
  getWeekDateKeys,
  getWeekStart,
  isRestWeek,
  photoMarks,
  quizMarks,
  REPORT_MIN_DAYS,
  RESTART_OPTIONS,
  serverQuizMarks,
  summarizeAccuracy,
  weekdayNameOf,
  weekHeadline,
  type DayReport,
  type HistoryInput,
  type PickOption,
  type WeekDayState,
  type WeekReport,
} from '@/lib/historyReport'
import { loadGoals } from '@/lib/goals'
import { getServerRanges, mergeServerSessions } from '@/lib/historySessions'
import { mockSubjects } from '@/lib/mock'
import { serverQuizCountsQuery } from '@/lib/quizResultsApi'
import { getCardDayMarkInfo, loadRestDays } from '@/lib/restDays'
import { buildCardIdByPlanId } from '@/lib/sessionRecords'
import { sessionsByRangeQuery } from '@/lib/sessionsApi'
import { loadSessionSyncState } from '@/lib/sessionSync'
import { loadRoutines } from '@/lib/routines'
import { loadRecord } from '@/lib/storage'
import { loadQuizResults, type QuizResult } from '@/lib/studyQuiz'
import { CHAT_PATH, MANUAL_PATH, QUIZ_REPORT_PATH } from '@/lib/tabMenu'
import { findWeeklyPick, type WeeklyPick, type WeeklyPickInput } from '@/lib/weeklyPicks'
import { getPicksRange, weeklyPicksQuery } from '@/lib/weeklyPicksApi'
import type { Card as CardData, Goal, StudyPlan, StudySession, Subject } from '@/types'
import { usePrefetchQuery, useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * 기록 탭 화면(/records) — History. (2026-10-24 History 리포트 시안)
 *
 *   [일간 리포트 | 주간 리포트]   ← ?view=weekly (주소에 둡니다. 새로고침 · 뒤로 가기에도 그대로)
 *   ‹ 10월 3주 ›  월 ~ 일         ← ?date=2026-10-17 (일간은 그날, 주간은 그 날짜가 든 주)
 *   일간: 하루 한 줄 · 잘한 것(공부 시간 · 확인 문제 정답률) · 계획 완료 · 이번 주에 고른 것
 *   주간: 이번 주 한 줄 · 잘한 것 · 계획을 끝까지 해낸 날 · 고른 것의 결과 · 다음 주에 하나만 해 볼까요?
 *         다 지난 주에 공부한 날이 2일 이하면 "쉬어 간 주" 로 숫자 비교 없이 작은 한 걸음만 보여 줍니다.
 *   기록한 날이 14일이 안 되면 리포트 대신 카운트다운을 보여 줍니다.
 *
 * 숫자 계산은 lib/historyReport.ts 가 합니다. 이 파일은 그리기만 합니다.
 * 글자 크기 · 간격 · 색은 시안(History 리포트 목업 ①~④, 390px)에 맞췄습니다. (2026-10-24)
 *   묶음 사이 28px(gap-7) · 흰 묶음은 연한 테두리 + 옅은 그림자 · 큰 숫자는 28px 굵게(800)
 * 진짜 로그인이면 서버의 공부 기록(최근 6개월)도 받아서 이 기기 기록과 합쳐 봅니다. (lib/historySessions.ts, #659)
 * 예전 기록 탭의 그래프 · AI 분석은 통계 탭(pages/StatsPage.tsx)으로 옮겼습니다.
 * 옛 주소 /report 는 여기로, /manual 은 나 사용설명서(/records/manual, pages/ManualPage.tsx)로 옵니다. (router.tsx)
 */

/**
 * 공부 기록 하나의 과목 이름을 찾습니다.
 *   1. 기록에 과목이 있으면 그 과목 (내 과목 → 예시 과목. 시연용 가상 기록은 예시 과목 id 로 저장됨)
 *   2. 기록에 과목이 없으면 그 카드의 과목 (과목을 고르기 전에 잰 기록 · 사후 입력, #652)
 *   3. 과목을 고르지 않은 옛 카드만 카드 제목 · 목표 제목에 든 과목 이름으로 찾습니다
 *      예) 카드 '수학 문제집 2쪽' → 수학 · 목표 '11월 학평 영어 2등급' 에 붙은 카드 → 영어
 *   4. 그래도 없으면 '기타'
 */
function makeSubjectOf(subjects: Subject[], cards: CardData[], goals: Goal[]) {
  const names = [...new Set([...subjects, ...mockSubjects].map((subject) => subject.name))]
  return (session: StudySession): string => {
    const card = cards.find((item) => item.id === session.cardId)
    const subjectId = session.subjectId || card?.subjectId
    const byId =
      subjects.find((item) => item.id === subjectId) ??
      mockSubjects.find((item) => item.id === subjectId)
    if (byId) return byId.name
    // 여기부터는 과목이 없는(또는 지워진) 카드라서 제목으로 짐작합니다.
    const goal = goals.find((item) => item.id === card?.goalId)
    const text = `${card?.title ?? ''} ${goal?.title ?? ''}`
    return names.find((name) => text.includes(name)) ?? '기타'
  }
}

export function RecordsPage() {
  // 이 기기의 공부 기록은 화면을 처음 그릴 때 한 번만 읽습니다.
  const [localSessions] = useState(loadStudySessions)
  const isServerData = useIsServerData()

  // 테스트 로그인은 서버가 없어서 이 기기 기록만 봅니다.
  if (!isServerData) return <HistoryView sessions={localSessions} />

  // 진짜 로그인은 서버 기록(최근 6개월)도 받아서 합칩니다. (#659)
  // 받는 동안에는 이 기기 기록으로 먼저 그리고, 못 받으면 안내와 함께 이 기기 기록만 보여 줍니다.
  return (
    <AsyncBoundary
      pendingFallback={<HistoryView sessions={localSessions} />}
      errorMessage="서버의 공부 기록을 받아오지 못했어요. 이 기기에 있는 기록만 보여 드려요."
      errorExtra={<HistoryView sessions={localSessions} />}
    >
      <ServerHistory localSessions={localSessions} />
    </AsyncBoundary>
  )
}

/**
 * 서버의 공부 기록을 31일씩 나눠 받아서(useSuspenseQueries) 이 기기 기록과 합친 뒤 그립니다.
 * 서버의 "이번 주에 고른 것"(#654)도 받습니다. 고른 것은 못 받아도 에러 대신 null 이라서,
 * 공부 기록은 그대로 보이고 고른 것만 이 기기 것으로 봅니다. (lib/weeklyPicksApi.ts)
 */
function ServerHistory({ localSessions }: { localSessions: StudySession[] }) {
  const [todayKey] = useState(getTodayKey)
  const { cards } = useCards()
  const picksRange = getPicksRange(todayKey)
  // 고른 것을 공부 기록과 "같이" 받기 시작합니다. 이 줄이 없으면 아래 useSuspenseQuery 는
  // 공부 기록을 다 받은 뒤에야 불려서, 그때부터 받기 시작하느라 늦어집니다.
  usePrefetchQuery(weeklyPicksQuery(picksRange.from, picksRange.to))
  const results = useSuspenseQueries({
    queries: getServerRanges(todayKey).map((range) => sessionsByRangeQuery(range.from, range.to)),
  })
  const { data: serverPicks } = useSuspenseQuery(weeklyPicksQuery(picksRange.from, picksRange.to))
  const sessions = mergeServerSessions({
    local: localSessions,
    server: results.flatMap((result) => result.data),
    sentServerIds: Object.values(loadSessionSyncState().sent),
    cards,
  })
  return <HistoryView sessions={sessions} serverPicks={serverPicks} />
}

interface HistoryViewProps {
  /** 리포트에 쓸 공부 기록 (노는 기록 뺀 것) */
  sessions: StudySession[]
  /** 서버에서 받은 "이번 주에 고른 것". 테스트 로그인 · 받는 중 · 못 받았으면 없음 (이 기기 것만 봅니다) */
  serverPicks?: WeeklyPick[] | null
}

/** 기록 탭 화면 본체. 공부 기록만 밖에서 받고, 나머지(카드 · 체크인 · 고른 것 …)는 여기서 읽습니다. */
function HistoryView({ sessions, serverPicks = null }: HistoryViewProps) {
  // 오늘 · 지금 시각은 화면을 처음 그릴 때 한 번만 정합니다. (다시 그릴 때마다 바뀌면 숫자가 흔들립니다)
  const [todayKey] = useState(getTodayKey)
  const [now] = useState(Date.now)

  const [view, setView] = useQueryParam('view', 'daily')
  const isWeekly = view === 'weekly'
  // ◀ ▶ 로 여러 주를 넘겨도 뒤로 가기를 그만큼 누르지 않게 replace 로 바꿉니다.
  const [dateParam, setDateParam] = useQueryParam('date', todayKey, { replace: true })
  // 주소는 누구나 고칠 수 있어서, 날짜 모양이 아니거나 미래면 오늘로 봅니다.
  const selectedDate = isDateKey(dateParam) && dateParam <= todayKey ? dateParam : todayKey
  const weekStart = getWeekStart(selectedDate)

  // 저장된 기록은 화면을 처음 그릴 때 한 번만 읽습니다. (카드 · 과목은 훅이 서버와 맞춰 줍니다)
  const [checkIns] = useState(loadCheckInsByDate)
  const [restDays] = useState(loadRestDays)
  const [marks] = useState(loadCardMarks)
  const [quizResults] = useState(loadQuizResults)
  const [cardIdByPlanId] = useState(() =>
    buildCardIdByPlanId(loadRecord<StudyPlan[]>('plans'), loadRoutines()),
  )
  // 이번 주에 고른 것. 이 기기 것 + 서버 것을 합쳐 보고, 고르면 이 기기에 저장한 뒤 서버로도 보냅니다. (#654)
  const { picks, savePick } = useWeeklyPicks({ serverPicks, todayKey })
  // 아래 "나 사용설명서" 줄에 보일 항목 수 (주간 리포트에서 넣으면 다음에 열 때 늘어납니다)
  const [manualCount] = useState(() => loadManualItems().length)
  const [goals] = useState(loadGoals)
  const { cards } = useCards()
  const subjects = useSubjects()

  const input: HistoryInput = {
    sessions,
    cards,
    cardIdByPlanId,
    getMark: (cardId, dateKey) => getCardDayMarkInfo(cardId, dateKey, restDays, marks),
    restDates: restDays.map((day) => day.date),
    checkInDates: Object.keys(checkIns),
    subjectOf: makeSubjectOf(subjects, cards, goals),
    now,
    todayKey,
  }
  const reports = buildDayReports(input)
  const firstRecordDay = getFirstRecordDay(input)

  // 기록한 날 = 공부했거나 체크인한 날 (중복 없이)
  const recordDays = new Set(
    [...sessions.map((session) => toDayKey(session.startedAt)), ...Object.keys(checkIns)].filter(
      (dateKey) => dateKey <= todayKey,
    ),
  ).size

  function handleMoveWeek(weeks: number) {
    setDateParam(
      moveDateKey(selectedDate, weeks * 7) > todayKey
        ? todayKey
        : moveDateKey(selectedDate, weeks * 7),
    )
  }

  return (
    // 시안의 위 여백(18px)에 맞추려고 Layout 의 12px 에 6px(pt-1.5)를 더합니다.
    <div className="mx-auto flex w-full max-w-xl flex-col pt-1.5 sm:pt-0">
      <h1 className="text-[28px] leading-9 font-extrabold tracking-[-0.01em] text-slate-900">
        기록
      </h1>

      <ReportKindTabs isWeekly={isWeekly} onChange={setView} />

      <WeekStrip
        weekStart={weekStart}
        selectedDate={selectedDate}
        isWeekly={isWeekly}
        todayKey={todayKey}
        firstRecordDay={firstRecordDay}
        reports={reports}
        onSelectDate={setDateParam}
        onMoveWeek={handleMoveWeek}
      />

      {/* 리포트 묶음들. 시안대로 달력 아래 · 묶음 사이를 28px 씩 띄웁니다. */}
      <div className="mt-7 flex flex-col gap-7">
        {/* 첫 리포트 전(기록 14일 미만) 카운트다운은 주간 리포트만입니다. 일간은 하루 기록만 있어도 되어서 첫날부터 보여 줍니다. */}
        {/* (목업 ④ "주간 · 첫 리포트 전", QA 2026-10-25 #749) */}
        {isWeekly && recordDays < REPORT_MIN_DAYS ? (
          <Countdown
            recordDays={recordDays}
            studyDays={[...reports.values()].filter((day) => day.studyMinutes > 0).length}
            totalMinutes={[...reports.values()].reduce((sum, day) => sum + day.studyMinutes, 0)}
          />
        ) : isWeekly ? (
          <AsyncBoundary
            pendingFallback={<ReportSkeleton />}
            errorMessage="주간 리포트를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요."
          >
            <WeeklyReport
              weekStart={weekStart}
              todayKey={todayKey}
              input={input}
              reports={reports}
              firstRecordDay={firstRecordDay}
              quizResults={quizResults}
              subjectNames={subjects.map((subject) => subject.name)}
              picks={picks}
              onSavePick={savePick}
            />
          </AsyncBoundary>
        ) : (
          <DailyReport
            day={getDayReport(reports, selectedDate)}
            isToday={selectedDate === todayKey}
            completeDays={countCompleteDaysUntil(reports, selectedDate)}
            input={input}
            quizResults={quizResults}
            subjectNames={subjects.map((subject) => subject.name)}
            pick={findWeeklyPick(picks, weekStart)}
          />
        )}
      </div>

      {/* 시안에는 없지만 기록 탭에서 들어가는 입구 두 개. 위 묶음들과 같은 테두리로 둡니다. */}
      <div className="mt-7 flex flex-col gap-3">
        {/* 문제 풀이 주간 리포트(과목별 점수 그래프 · 주간 정리표)로 가는 입구 (2026-10-24, pages/QuizReportPage.tsx)
            통계 화면에 있던 것을, 주소(/records/quiz)대로 기록 탭으로 옮겼습니다. */}
        <Link
          to={QUIZ_REPORT_PATH}
          className={cn(
            CARD_CLASS,
            'flex min-h-14 items-center justify-between gap-3 py-4 hover:bg-slate-50',
          )}
        >
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold text-slate-900">문제 풀이 리포트</span>
            <span className="mt-0.5 block text-sm text-slate-500">
              과목별 점수 변화 · 취약 단원 · 주간 정리표
            </span>
          </span>
          <span aria-hidden className="shrink-0 text-slate-400">
            ›
          </span>
        </Link>

        {/* 나 사용설명서로 가는 길. 주간 리포트에서 [사용설명서에 넣기] 한 것이 여기에 쌓입니다. */}
        <Link
          to={MANUAL_PATH}
          className={cn(
            CARD_CLASS,
            'flex min-h-14 items-center justify-between gap-3 py-4 hover:bg-slate-50',
          )}
        >
          <span className="text-[15px] font-semibold text-slate-900">나 사용설명서</span>
          <span className="flex shrink-0 items-center gap-1 text-sm text-slate-500">
            확인된 것 {manualCount}개<span aria-hidden>›</span>
          </span>
        </Link>
      </div>
    </div>
  )
}

interface ReportKindTabsProps {
  isWeekly: boolean
  onChange: (view: 'daily' | 'weekly') => void
}

/**
 * [일간 리포트 | 주간 리포트] 두 칸 스위치.
 * 시안 모양(높이 48px · 진한 회색 바탕 · 고른 칸은 흰 바탕 + 그림자 · 15px 굵은 글자)이라
 * 다른 화면의 SegmentedToggle 과 모양이 달라서, 이 화면 안에 따로 둡니다.
 */
function ReportKindTabs({ isWeekly, onChange }: ReportKindTabsProps) {
  // as const: value 를 그냥 글자(string)가 아니라 'daily' · 'weekly' 둘 중 하나로 봐 줍니다. (onChange 에 그대로 넘기려고)
  const options = [
    { value: 'daily', label: '일간 리포트', isSelected: !isWeekly },
    { value: 'weekly', label: '주간 리포트', isSelected: isWeekly },
  ] as const

  return (
    <div
      role="group"
      aria-label="리포트 종류"
      className="mt-4 grid h-12 grid-cols-2 gap-1 rounded-2xl bg-slate-200 p-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.isSelected}
          onClick={() => onChange(option.value)}
          className={cn(
            'cursor-pointer rounded-xl text-[15px] font-bold transition-colors',
            option.isSelected
              ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.1)]'
              : 'text-slate-600 hover:text-slate-900',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 주 달력
// ---------------------------------------------------------------------------

interface WeekStripProps {
  weekStart: string
  selectedDate: string
  isWeekly: boolean
  todayKey: string
  firstRecordDay: string | null
  reports: Map<string, DayReport>
  onSelectDate: (dateKey: string) => void
  onMoveWeek: (weeks: number) => void
}

/**
 * ‹ 10월 3주 › 와 월 ~ 일 7칸. 아래 점: 보라 = 리포트 있음(공부한 날) · 회색 = 쉰 날 · 없음 = 아직 안 온 날
 * 일간에서는 날짜를 눌러 그날을 고르고, 주간에서는 한 주 전체를 칠합니다.
 */
function WeekStrip({
  weekStart,
  selectedDate,
  isWeekly,
  todayKey,
  firstRecordDay,
  reports,
  onSelectDate,
  onMoveWeek,
}: WeekStripProps) {
  const canGoNext = moveDateKey(weekStart, 7) <= todayKey
  const weekLabel = formatWeekLabel(weekStart)
  // 하루하루의 모양을 미리 정리해 둡니다. (요일 · 날짜 · 점 세 줄이 같은 정보를 씁니다)
  const days = getWeekDateKeys(weekStart).map((dateKey) => {
    const isFuture = dateKey > todayKey
    const studied = (reports.get(dateKey)?.studyMinutes ?? 0) > 0
    const isToday = dateKey === todayKey
    // 기록을 시작한 뒤의 지난 날인데 공부를 안 했으면 '쉰 날'
    // 오늘은 아직 하루가 안 끝나서 '쉰 날' 로 보지 않습니다. (공부 전이면 점 없이, 시안 ④)
    const rested =
      !studied && dateKey < todayKey && firstRecordDay !== null && dateKey >= firstRecordDay
    const status = isFuture
      ? '아직 오지 않은 날'
      : studied
        ? '리포트 있음'
        : isToday
          ? '오늘'
          : rested
            ? '쉰 날'
            : ''
    return {
      dateKey,
      isFuture,
      isSelected: !isWeekly && dateKey === selectedDate,
      studied,
      rested,
      // 화면 읽기 프로그램용: '10월 17일 토요일, 리포트 있음'
      label: `${Number(dateKey.slice(5, 7))}월 ${dayOfMonth(dateKey)}일 ${weekdayNameOf(dateKey)}요일${status ? `, ${status}` : ''}`,
    }
  })

  return (
    <section
      aria-label={`${weekLabel} 달력`}
      className="mt-4 rounded-3xl bg-white px-4 pt-3.5 pb-4"
    >
      <div className="flex h-10 items-center justify-between">
        <button
          type="button"
          aria-label="지난주"
          onClick={() => onMoveWeek(-1)}
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100"
        >
          <ChevronIcon direction="left" />
        </button>
        <h2 className="text-base font-bold text-slate-900">{weekLabel}</h2>
        <button
          type="button"
          aria-label="다음 주"
          disabled={!canGoNext}
          onClick={() => onMoveWeek(1)}
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 disabled:cursor-default disabled:text-slate-300 disabled:hover:bg-transparent"
        >
          <ChevronIcon direction="right" />
        </button>
      </div>

      {/* 요일 · 날짜 · 점 세 줄은 40px 칸 7개를 양 끝에 붙여 고르게 벌립니다. (justify-between) */}
      <div aria-hidden className="mt-2 flex justify-between text-xs font-medium text-slate-500">
        {days.map((day) => (
          <span
            key={day.dateKey}
            className={cn('w-10 text-center', day.isSelected && 'text-brand font-bold')}
          >
            {weekdayNameOf(day.dateKey)}
          </span>
        ))}
      </div>

      <div className="relative mt-0.5 flex justify-between">
        {/* 주간이면 날짜 뒤에 연보라 띠를 깔아서 "이 주 전체" 를 보고 있다는 걸 보여 줍니다. */}
        {isWeekly && (
          <span
            aria-hidden
            className="bg-brand-light absolute inset-x-0 top-0.5 h-9 rounded-full"
          />
        )}
        {days.map((day) => (
          <button
            key={day.dateKey}
            type="button"
            disabled={day.isFuture || isWeekly}
            aria-pressed={isWeekly ? undefined : day.isSelected}
            aria-label={day.label}
            onClick={() => onSelectDate(day.dateKey)}
            className={cn(
              // relative: 연보라 띠(absolute)보다 위에 그려지게 합니다.
              'relative flex h-10 w-10 items-center justify-center rounded-full',
              !isWeekly && !day.isFuture && !day.isSelected && 'cursor-pointer hover:bg-slate-100',
            )}
          >
            <span
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full text-base font-bold tabular-nums',
                day.isSelected && 'bg-brand text-white',
                !day.isSelected && (isWeekly ? 'text-brand-dark' : 'text-slate-900'),
                day.isFuture && 'text-slate-400',
              )}
            >
              {dayOfMonth(day.dateKey)}
            </span>
          </button>
        ))}
      </div>

      {/* 점: 보라 = 리포트 있음(공부한 날) · 회색 = 쉰 날 · 없음 = 아직 안 온 날 */}
      <div aria-hidden className="mt-0.5 flex h-1.5 justify-between">
        {days.map((day) => (
          <span key={day.dateKey} className="flex w-10 justify-center">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                day.studied ? 'bg-brand' : day.rested ? 'bg-slate-300' : 'bg-transparent',
              )}
            />
          </span>
        ))}
      </div>

      <p className="mt-3 flex justify-center gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="bg-brand h-1.5 w-1.5 rounded-full" />
          리포트 있음
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-slate-300" />쉰 날
        </span>
      </p>
    </section>
  )
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-6 w-6"
    >
      <path d={direction === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// 공통 조각
// ---------------------------------------------------------------------------

/** 흰 묶음 모양: 연한 테두리 + 아주 옅은 그림자 (시안 그대로. 아래 입구 링크도 같은 모양을 씁니다) */
const CARD_CLASS =
  'rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]'

/** 큰 숫자(1시간 50분 · 80%) 글자 모양 */
const BIG_NUMBER_CLASS =
  'text-[28px] leading-[34px] font-extrabold tracking-[-0.02em] text-slate-900 tabular-nums'

/** 묶음 안의 큰 문장(오늘 계획을 끝까지 해냈어요 · 이번 주 4일 완료했어요) 글자 모양 */
const BIG_SENTENCE_CLASS = 'mt-2 text-lg leading-[26px] font-bold break-keep text-slate-900'

interface ReportCardProps {
  /** 묶음 제목 (없으면 제목 줄 없이 내용만) */
  title?: string
  children: ReactNode
}

/**
 * 리포트의 흰 묶음 하나. 제목은 16px 굵게.
 * 제목 아래 간격은 시안에서 묶음마다 달라서(8 · 10 · 12 · 16px), 안에 든 내용이 mt-* 로 정합니다.
 */
function ReportCard({ title, children }: ReportCardProps) {
  return (
    <section className={CARD_CLASS}>
      {title && <h2 className="text-base font-bold text-slate-900">{title}</h2>}
      {children}
    </section>
  )
}

/** 연보라 바탕의 "한 줄" 묶음 (하루 한 줄 · 이번 주 한 줄) */
function HeadlineCard({ label, text }: { label: string; text: string }) {
  return (
    <section className="bg-brand-light rounded-2xl p-5">
      <h2 className="text-brand-dark text-[13px] leading-5 font-bold tracking-[0.02em]">{label}</h2>
      <p className="mt-2 text-lg leading-[26px] font-bold break-keep text-slate-900">{text}</p>
    </section>
  )
}

/** 보라 상자: ☆ 총 100일 · 지금까지 100일 동안 계획을 성공했어요! */
function TotalSuccessBox({ days }: { days: number }) {
  return (
    <div className="bg-brand mt-4 flex items-center gap-4 rounded-2xl p-4 text-white">
      <span className="text-brand flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6"
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      </span>
      <div className="min-w-0">
        <p className="text-2xl leading-8 font-extrabold tracking-[-0.02em]">총 {days}일</p>
        <p className="text-sm break-keep text-indigo-100">
          지금까지 {days}일 동안 계획을 성공했어요!
        </p>
      </div>
    </div>
  )
}

/** 동그라미가 있는 보기 하나 (다음 주에 해 볼 것 고르기) */
function PickOptionButton({
  option,
  isSelected,
  onSelect,
}: {
  option: PickOption
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isSelected}
      onClick={onSelect}
      className={cn(
        'flex w-full cursor-pointer items-center gap-3 rounded-xl border py-2.5 pr-4 pl-3.5 text-left',
        isSelected ? 'border-brand bg-brand-light' : 'border-slate-300 bg-white hover:bg-slate-50',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
          isSelected ? 'border-brand' : 'border-slate-400',
        )}
      >
        {isSelected && <span className="bg-brand h-2.5 w-2.5 rounded-full" />}
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] leading-[22px] font-bold break-keep text-slate-900">
          {option.title}
        </span>
        <span className="block text-[13px] leading-5 break-keep text-slate-500">{option.hint}</span>
      </span>
    </button>
  )
}

interface PickFormProps {
  /** 고른 것을 저장할 주의 월요일 */
  targetWeekStart: string
  options: PickOption[]
  picks: WeeklyPick[]
  /** 고른 것을 저장 (이 기기 + 서버, hooks/useWeeklyPicks.ts) */
  onSavePick: (input: WeeklyPickInput) => void
}

/** 보기 3개 중 하나 고르고 [이걸로 정하기]. 이미 고른 게 있으면 그것이 골라진 채로 보입니다. */
function PickForm({ targetWeekStart, options, picks, onSavePick }: PickFormProps) {
  const saved = findWeeklyPick(picks, targetWeekStart)
  // 눌렀지만 아직 저장하지 않은 보기. null 이면 저장된 것을 그대로 보여 줍니다.
  // 저장된 값을 상태로 베껴 두지 않아야, 위의 [1주 더 해 보기] 처럼 다른 곳에서 저장해도 바로 따라갑니다. (2026-10-25 QA)
  const [draftTitle, setDraftTitle] = useState<string | null>(null)
  const selectedTitle = draftTitle ?? saved?.title ?? null
  const selected = options.find((option) => option.title === selectedTitle)
  const isSaved = selected !== undefined && saved?.title === selected.title
  // 저장된 것이 이 보기들에 없을 때 (예: 지난주에 고른 것을 [1주 더 해 보기] 로 이어 감)
  const savedOutside =
    saved !== undefined && !options.some((option) => option.title === saved.title)
      ? saved
      : undefined

  function handleSave() {
    if (!selected) return
    onSavePick({
      weekStart: targetWeekStart,
      title: selected.title,
      hint: selected.hint,
      skip: selected.skip,
    })
    setDraftTitle(null)
  }

  return (
    <>
      {savedOutside && (
        <p className="mt-3 text-sm break-keep text-slate-600">
          {/* 제목 끝 글자에 따라 을/를 이 달라져서, 조사가 필요 없는 모양으로 씁니다. */}
          정해 둔 것: &ldquo;{savedOutside.title}&rdquo;. 바꾸려면 아래에서 하나 고르세요.
        </p>
      )}
      <div role="radiogroup" aria-label="해 볼 것" className="mt-3.5 flex flex-col gap-2">
        {options.map((option) => (
          <PickOptionButton
            key={option.title}
            option={option}
            isSelected={option.title === selectedTitle}
            onSelect={() => setDraftTitle(option.title)}
          />
        ))}
      </div>
      <Button
        className="mt-3.5 w-full text-base font-bold"
        disabled={!selected || isSaved}
        onClick={handleSave}
      >
        {isSaved ? '정했어요' : '이걸로 정하기'}
      </Button>
    </>
  )
}

function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-label="리포트를 불러오는 중">
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-64 w-full rounded-2xl" />
      <Skeleton className="h-40 w-full rounded-2xl" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// 일간 리포트
// ---------------------------------------------------------------------------

interface DailyReportProps {
  day: DayReport
  isToday: boolean
  /** 그날까지 계획을 끝까지 해낸 날 수 */
  completeDays: number
  input: HistoryInput
  quizResults: QuizResult[]
  subjectNames: string[]
  /** 그 주에 고른 것 */
  pick: WeeklyPick | undefined
}

function DailyReport({
  day,
  isToday,
  completeDays,
  input,
  quizResults,
  subjectNames,
  pick,
}: DailyReportProps) {
  const percent = getPlanPercent(day)

  return (
    <>
      <HeadlineCard label="하루 한 줄" text={dayHeadline(day, completeDays, isToday)} />

      <ReportCard title="잘한 것">
        <p className="mt-4 text-sm text-slate-500">공부 시간</p>
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <p className={BIG_NUMBER_CLASS}>{formatDuration(day.studyMinutes)}</p>
          {percent !== null && (
            <p className="text-brand shrink-0 text-sm font-medium">계획의 {percent}%</p>
          )}
        </div>
        {percent !== null && <ProgressBar value={percent} className="mt-2" />}
        {day.bySubject.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5 text-sm">
            {day.bySubject.map((item) => (
              <li key={item.subject} className="flex justify-between gap-3">
                <span className="min-w-0 truncate text-slate-700">{item.subject}</span>
                <span className="shrink-0 text-slate-600 tabular-nums">
                  {formatDuration(item.minutes)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <hr className="my-5 border-slate-100" />

        <p className="text-sm text-slate-500">확인 문제 정답률</p>
        {/* 사진 채점 결과는 서버에서 받아옵니다. 받는 동안 이 칸만 자리 표시를 보여 줍니다. */}
        <AsyncBoundary
          pendingFallback={<Skeleton className="mt-2 h-16 w-full" />}
          errorMessage="사진 채점 결과를 불러오지 못했어요."
        >
          <DailyAccuracy
            dateKey={day.dateKey}
            input={input}
            quizResults={quizResults}
            subjectNames={subjectNames}
          />
        </AsyncBoundary>
      </ReportCard>

      <ReportCard title="계획 완료">
        <p className={BIG_SENTENCE_CLASS}>
          {day.isComplete
            ? `${isToday ? '오늘' : '이날'} 계획을 끝까지 해냈어요`
            : day.cardCount + day.pendingCount === 0
              ? '이날은 카드가 없었어요'
              : `카드 ${day.cardCount + day.pendingCount}장 중 ${day.doneCount}장을 끝까지 했어요`}
        </p>
        <TotalSuccessBox days={completeDays} />
      </ReportCard>

      {pick && !pick.skip && (
        <ReportCard title="이번 주에 고른 것">
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <span className="min-w-0 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold break-keep text-slate-700">
              {pick.title}
            </span>
            <PickDayStatus day={day} isToday={isToday} />
          </div>
        </ReportCard>
      )}
    </>
  )
}

/** 고른 것을 그날 해냈는지: 계획을 끝까지 했으면 성공, 공부는 했으면 못 채움 */
function PickDayStatus({ day, isToday }: { day: DayReport; isToday: boolean }) {
  if (day.isComplete) {
    return <span className="shrink-0 text-sm font-bold text-emerald-700">성공</span>
  }
  // 오늘은 하루가 아직 안 끝났으니 "못 채움" 이라고 하지 않습니다.
  if (isToday) {
    return <span className="shrink-0 text-sm font-semibold text-slate-500">하는 중</span>
  }
  if (day.studyMinutes > 0) {
    return <span className="shrink-0 text-sm font-semibold text-slate-500">못 채움</span>
  }
  return <span className="shrink-0 text-sm font-semibold text-slate-400">쉰 날</span>
}

interface DailyAccuracyProps {
  dateKey: string
  input: HistoryInput
  quizResults: QuizResult[]
  subjectNames: string[]
}

/** 그날의 확인 문제(채팅, 이 기기 + 서버에만 있는 것) + 사진 채점 정답률 */
function DailyAccuracy({ dateKey, input, quizResults, subjectNames }: DailyAccuracyProps) {
  // 사진 채점과 서버의 확인 문제 결과를 같이 받습니다. 확인 문제는 주간 리포트와 같은 14일치라 한 번 받으면 같이 씁니다.
  // 서버의 확인 문제 결과는 못 받아도 에러 대신 null 이라서, 이 기기의 결과만으로 셉니다. (lib/quizResultsApi.ts)
  const [{ data: checks }, { data: serverCounts }] = useSuspenseQueries({
    queries: [answerChecksQuery(dateKey), serverQuizCountsQuery(getWeekStart(dateKey))],
  })
  const accuracy = summarizeAccuracy([
    ...quizMarks(quizResults, [dateKey], input, subjectNames),
    ...serverQuizMarks(serverCounts ?? [], [dateKey]),
    ...photoMarks(checks, [dateKey]),
  ])

  if (accuracy.percent === null) {
    return (
      <p className="mt-2 text-sm break-keep text-slate-500">
        이날 푼 확인 문제가 없어요. 채팅에서 확인 문제를 풀거나 통계 탭에서 사진 채점을 하면 여기에
        모여요.
      </p>
    )
  }

  return (
    <>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <p className={BIG_NUMBER_CLASS}>{accuracy.percent}%</p>
        <p className="shrink-0 text-sm text-slate-600">
          {accuracy.total}문제 중 {accuracy.correct}문제
        </p>
      </div>
      <ul className="mt-3 flex flex-col gap-1.5 text-sm">
        {accuracy.bySubject.map((item) => (
          <li key={item.subject} className="flex justify-between gap-3">
            <span className="min-w-0 truncate text-slate-700">{item.subject}</span>
            <span className="shrink-0 text-slate-600 tabular-nums">
              {item.total}문제 중 {item.correct}개
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

// ---------------------------------------------------------------------------
// 주간 리포트
// ---------------------------------------------------------------------------

interface WeeklyReportProps {
  weekStart: string
  todayKey: string
  input: HistoryInput
  reports: Map<string, DayReport>
  firstRecordDay: string | null
  quizResults: QuizResult[]
  subjectNames: string[]
  picks: WeeklyPick[]
  onSavePick: (input: WeeklyPickInput) => void
}

function WeeklyReport({
  weekStart,
  todayKey,
  input,
  reports,
  firstRecordDay,
  quizResults,
  subjectNames,
  picks,
  onSavePick,
}: WeeklyReportProps) {
  const lastWeekStart = moveDateKey(weekStart, -7)
  // 사진 채점 · 서버의 확인 문제 결과는 지난주 ~ 이번 주(14일)를 한 번에 받아 둘로 나눕니다.
  // 서버의 확인 문제 결과는 못 받아도 에러 대신 null 이라서, 이 기기의 결과만으로 셉니다. (lib/quizResultsApi.ts)
  const [{ data: checks }, { data: serverCounts }] = useSuspenseQueries({
    queries: [
      answerChecksBetweenQuery(lastWeekStart, moveDateKey(weekStart, 6)),
      serverQuizCountsQuery(weekStart),
    ],
  })

  const week = buildWeekReport(reports, weekStart, todayKey)
  const lastWeek = buildWeekReport(reports, lastWeekStart, todayKey)
  // 그 주가 끝난 날(이번 주면 오늘)까지의 계획 성공 날 수
  const weekEnd = moveDateKey(weekStart, 6)
  const completeDaysTotal = countCompleteDaysUntil(reports, weekEnd < todayKey ? weekEnd : todayKey)
  const pick = findWeeklyPick(picks, weekStart)
  // 다음 주에 해 볼 것은 이번 주 · 지난주 리포트에서만 고릅니다. (더 지난 주에서 고르면 이미 지나간 주가 됨)
  const currentWeekStart = getWeekStart(todayKey)
  const nextWeekStart = moveDateKey(weekStart, 7)
  const canPickNext = nextWeekStart >= currentWeekStart

  if (isRestWeek(week, firstRecordDay)) {
    return (
      <RestWeekReport
        week={week}
        completeDaysTotal={completeDaysTotal}
        pick={pick}
        canPickNext={canPickNext}
        nextWeekStart={nextWeekStart}
        picks={picks}
        onSavePick={onSavePick}
      />
    )
  }

  const accuracyOf = (target: WeekReport) => {
    const dateKeys = target.days.map((day) => day.dateKey)
    return summarizeAccuracy([
      ...quizMarks(quizResults, dateKeys, input, subjectNames),
      ...serverQuizMarks(serverCounts ?? [], dateKeys),
      ...photoMarks(checks, dateKeys),
    ])
  }
  const accuracy = accuracyOf(week)
  const lastAccuracy = accuracyOf(lastWeek)
  const accuracyDiff =
    accuracy.percent !== null && lastAccuracy.percent !== null
      ? accuracy.percent - lastAccuracy.percent
      : null
  const finding = findWeekFinding(input.sessions, week)

  return (
    <>
      <HeadlineCard
        label="이번 주 한 줄"
        text={weekHeadline({ week, lastWeek, accuracyDiff, completeDaysTotal })}
      />

      <ReportCard title="이번 주 잘한 것">
        <p className="mt-4 text-sm text-slate-500">공부 시간</p>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div>
            <p className={BIG_NUMBER_CLASS}>{formatDuration(week.totalMinutes)}</p>
            <p className="text-[13px] leading-5 text-slate-500">
              하루 평균 {formatDuration(week.averageMinutes)}
            </p>
          </div>
          {lastWeek.totalMinutes > 0 && (
            <DiffBadge
              diff={week.totalMinutes - lastWeek.totalMinutes}
              text={formatDuration(Math.abs(week.totalMinutes - lastWeek.totalMinutes))}
            />
          )}
        </div>
        <WeekBars week={week} todayKey={todayKey} />
        {week.bestDay && (
          <p className="mt-2.5 text-sm break-keep text-slate-700">
            가장 오래 한 날은{' '}
            <strong className="font-bold text-slate-900">
              {weekdayNameOf(week.bestDay.dateKey)}요일 {formatDuration(week.bestDay.studyMinutes)}
            </strong>
            이에요.
          </p>
        )}

        <hr className="my-5 border-slate-100" />

        <p className="text-sm text-slate-500">확인 문제 정답률</p>
        {accuracy.percent === null ? (
          <p className="mt-2 text-sm break-keep text-slate-500">
            이번 주에 푼 확인 문제가 없어요. 채팅에서 확인 문제를 풀거나 통계 탭에서 사진 채점을
            하면 여기에 모여요.
          </p>
        ) : (
          <>
            <div className="mt-2 flex items-end justify-between gap-3">
              <div>
                <p className={BIG_NUMBER_CLASS}>{accuracy.percent}%</p>
                <p className="text-[13px] leading-5 text-slate-500">
                  {accuracy.total}문제 중 {accuracy.correct}문제 맞힘
                </p>
              </div>
              {accuracyDiff !== null && (
                <DiffBadge diff={accuracyDiff} text={`${Math.abs(accuracyDiff)}%p`} />
              )}
            </div>
            <ul className="mt-3.5 flex flex-col gap-2.5">
              {accuracy.bySubject.map((item) => (
                <li key={item.subject}>
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-slate-700">{item.subject}</span>
                    <span className="shrink-0 text-slate-600 tabular-nums">
                      {item.total}문제 중 {item.correct}개 ·{' '}
                      <strong className="font-bold text-slate-900">{item.percent}%</strong>
                    </span>
                  </div>
                  <ProgressBar value={item.percent} className="mt-1.5" />
                </li>
              ))}
            </ul>
          </>
        )}
      </ReportCard>

      <ReportCard title="계획을 끝까지 해낸 날">
        <p className={BIG_SENTENCE_CLASS}>
          {week.isCurrent ? '이번 주 지금까지 ' : '이번 주 '}
          <span className="text-brand">{week.completeDays}일</span> 완료했어요
        </p>
        <WeekDayChips week={week} />
        <p className="mt-2 text-[13px] leading-5 break-keep text-slate-500">
          색칠한 날 = 완료 · 회색 = 못 채움 · 점선 = 쉬는 날
        </p>
        <TotalSuccessBox days={completeDaysTotal} />
      </ReportCard>

      {pick && !pick.skip && (
        <PickResultCard
          pick={pick}
          week={week}
          lastWeek={lastWeek}
          canRepeat={canPickNext}
          nextWeekStart={nextWeekStart}
          picks={picks}
          onSavePick={onSavePick}
        />
      )}

      {canPickNext && (
        <ReportCard
          title={
            nextWeekStart === currentWeekStart
              ? '이번 주에 하나만 해 볼까요?'
              : '다음 주에 하나만 해 볼까요?'
          }
        >
          <div className="mt-3 rounded-xl bg-slate-50 p-3">
            <p className="text-[13px] leading-5 font-semibold text-slate-500">이번 주 발견</p>
            <p className="mt-[3px] text-[15px] leading-[22px] font-bold break-keep text-slate-900">
              {finding.text}
            </p>
          </div>
          {/* key: 주를 바꾸면 고르던 보기를 처음부터 다시 그립니다. */}
          <PickForm
            key={nextWeekStart}
            targetWeekStart={nextWeekStart}
            options={finding.options}
            picks={picks}
            onSavePick={onSavePick}
          />
        </ReportCard>
      )}
    </>
  )
}

/** ▲ 지난주보다 1시간 38분 / ▼ 지난주보다 7%p */
function DiffBadge({ diff, text }: { diff: number; text: string }) {
  if (diff === 0) return <p className="shrink-0 text-sm text-slate-500">지난주와 같아요</p>
  const isUp = diff > 0
  return (
    <p
      className={cn(
        'shrink-0 text-right text-sm leading-5 font-semibold',
        isUp ? 'text-brand' : 'text-slate-500',
      )}
    >
      {isUp ? '▲' : '▼'} 지난주보다
      <br />
      {text}
    </p>
  )
}

/** 가장 긴 막대의 높이(px). 그 위에 '최고'(16px) + 간격(4px)이 올라가서 그래프 칸은 110px 입니다. */
const BAR_MAX_HEIGHT = 90

/** 요일별 공부 시간 막대 (가장 오래 한 날은 진한 보라 + '최고'). 요일 글자는 막대 아래 따로 한 줄. */
function WeekBars({ week, todayKey }: { week: WeekReport; todayKey: string }) {
  const max = Math.max(...week.days.map((day) => day.studyMinutes), 1)

  return (
    <div className="mt-4">
      <ul className="grid h-[110px] grid-cols-7 items-end gap-1.5" aria-label="요일별 공부 시간">
        {week.days.map((day) => {
          const isBest = week.bestDay?.dateKey === day.dateKey
          // 막대 높이는 그 주에서 가장 긴 날을 90px 로 봅니다. (너무 낮아 안 보이지 않게 최소 6px)
          const height = Math.max(6, Math.round((day.studyMinutes / max) * BAR_MAX_HEIGHT))
          return (
            <li key={day.dateKey} className="flex flex-col items-center gap-1">
              {isBest && <span className="text-brand text-[11px] leading-4 font-bold">최고</span>}
              <span className="sr-only">
                {weekdayNameOf(day.dateKey)} {formatDuration(day.studyMinutes)}
              </span>
              {day.studyMinutes === 0 ? (
                // 0분인 날은 바닥에 얇은 회색 선만 둡니다.
                <span aria-hidden className="h-1 w-full rounded-full bg-slate-200" />
              ) : (
                <span
                  aria-hidden
                  className={cn(
                    'w-full rounded-t-lg rounded-b',
                    isBest ? 'bg-brand' : 'bg-indigo-200',
                  )}
                  // 높이가 공부 시간에 따라 계속 바뀌어서 Tailwind 클래스로 만들 수 없어 인라인 style 을 씁니다.
                  style={{ height: `${height}px` }}
                />
              )}
            </li>
          )
        })}
      </ul>
      <div aria-hidden className="mt-2 grid grid-cols-7 gap-1.5 text-center text-xs text-slate-500">
        {week.days.map((day) => (
          <span
            key={day.dateKey}
            className={cn(
              week.bestDay?.dateKey === day.dateKey && 'text-brand font-bold',
              day.dateKey > todayKey && 'text-slate-300',
            )}
          >
            {weekdayNameOf(day.dateKey)}
          </span>
        ))}
      </div>
    </div>
  )
}

const DAY_CHIP_STYLES: Record<WeekDayState, string> = {
  complete: 'bg-brand font-bold text-white',
  missed: 'bg-slate-100 font-semibold text-slate-600',
  rest: 'border-[1.5px] border-dashed border-slate-300 bg-white text-slate-500',
  future: 'border-[1.5px] border-dashed border-slate-200 bg-white text-slate-300',
}

const DAY_CHIP_LABELS: Record<WeekDayState, string> = {
  complete: '완료',
  missed: '못 채움',
  rest: '쉬는 날',
  future: '아직',
}

/** 월 ~ 일 일곱 칸. 색칠 = 완료 · 회색 = 못 채움 · 점선 = 쉬는 날 */
function WeekDayChips({ week, onlyStudied = false }: { week: WeekReport; onlyStudied?: boolean }) {
  return (
    <ul className="mt-3 grid grid-cols-7 gap-1.5">
      {week.days.map((day, index) => {
        // 쉬어 간 주에는 "책상에 앉은 날" 만 색칠합니다. (완료가 아니어도)
        const state: WeekDayState = onlyStudied
          ? day.studyMinutes > 0
            ? 'complete'
            : 'rest'
          : week.dayStates[index]
        return (
          <li
            key={day.dateKey}
            className={cn(
              // 누르는 칸이 아니라 보여 주기만 하는 칸이라 시안대로 36px(h-9)입니다.
              'flex h-9 items-center justify-center rounded-[10px] text-[13px]',
              DAY_CHIP_STYLES[state],
            )}
          >
            {weekdayNameOf(day.dateKey)}
            <span className="sr-only">
              {' '}
              {onlyStudied && state === 'complete' ? '공부함' : DAY_CHIP_LABELS[state]}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

interface PickResultCardProps {
  pick: WeeklyPick
  week: WeekReport
  lastWeek: WeekReport
  /** [1주 더 해 보기] 를 보여 줄지 (다음 주가 이미 지난 주면 안 보임) */
  canRepeat: boolean
  nextWeekStart: string
  picks: WeeklyPick[]
  onSavePick: (input: WeeklyPickInput) => void
}

/** 이번 주에 고른 것의 결과 + [1주 더 해 보기] [사용설명서에 넣기] */
function PickResultCard({
  pick,
  week,
  lastWeek,
  canRepeat,
  nextWeekStart,
  picks,
  onSavePick,
}: PickResultCardProps) {
  const { items, addItem } = useManualItems()
  const result = getPickResult(pick, week)
  if (result === null) return null

  const manualId = `manual-pick-${week.weekStart}`
  const isInManual = items.some((item) => item.id === manualId)
  const isRepeated = findWeeklyPick(picks, nextWeekStart)?.title === pick.title
  const minutesGain = week.totalMinutes - lastWeek.totalMinutes

  function handleRepeat() {
    onSavePick({ weekStart: nextWeekStart, title: pick.title, hint: pick.hint, skip: false })
  }

  function handleAddToManual() {
    if (result === null) return
    // 확인한 날은 그 주의 일요일. 이번 주라 아직 일요일이 안 왔으면 오늘입니다.
    const weekEnd = moveDateKey(week.weekStart, 6)
    const todayKey = getTodayKey()
    addItem({
      id: manualId,
      category: 'effectiveMethod',
      title: pick.title,
      confirmedDate: weekEnd < todayKey ? weekEnd : todayKey,
      evidence:
        minutesGain > 0
          ? `공부한 ${result.studyDays}일 중 ${result.completeDays}일 해냈고, 그 주 공부 시간이 ${formatDuration(minutesGain)} 늘었어요.`
          : `공부한 ${result.studyDays}일 중 ${result.completeDays}일 해냈어요.`,
      note: '주간 리포트에서 넣음',
    })
  }

  return (
    <ReportCard>
      {/* 시안대로 제목 없이 문장만, 위를 12px 더 띄웁니다. 숫자는 그 주 기록에서 셉니다. */}
      <p className="mt-3 text-base font-bold break-keep text-slate-900">
        이번 주 계획을 공부한 {result.studyDays}일 중 {result.completeDays}일 했어요.
        {canRepeat && (
          <>
            <br />
            다음 주에도 똑같이 해 볼까요?
          </>
        )}
      </p>
      {/* 버튼 두 개는 시안대로 44px · 14px 굵게 (Button 기본보다 조금 작게) */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {canRepeat && (
          <Button
            onClick={handleRepeat}
            disabled={isRepeated}
            className="h-11 px-2 text-sm font-bold"
          >
            {isRepeated ? '1주 더 해요' : '1주 더 해 보기'}
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={handleAddToManual}
          disabled={isInManual}
          className={cn('h-11 px-2 text-sm font-bold', !canRepeat && 'col-span-2')}
        >
          {isInManual ? '사용설명서에 넣었어요' : '사용설명서에 넣기'}
        </Button>
      </div>
      {isInManual && (
        <Link
          to={MANUAL_PATH}
          className="text-brand mt-3 inline-flex h-10 items-center text-sm font-semibold hover:underline"
        >
          사용설명서 보기 ›
        </Link>
      )}
    </ReportCard>
  )
}

/** 쉬어 간 주에 쓰는 우리말 횟수: 1 -> '한 번', 2 -> '두 번' (쉬어 간 주는 공부한 날이 2일 이하라 작은 수만 나옵니다) */
const COUNT_WORDS = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱']

function timesInWords(count: number): string {
  if (count > 0 && count < COUNT_WORDS.length) return `${COUNT_WORDS[count]} 번`
  return `${count}번`
}

interface RestWeekReportProps {
  week: WeekReport
  completeDaysTotal: number
  pick: WeeklyPick | undefined
  canPickNext: boolean
  nextWeekStart: string
  picks: WeeklyPick[]
  onSavePick: (input: WeeklyPickInput) => void
}

/** 쉬어 간 주: 숫자 비교와 발견 없이, 그래도 해낸 것과 다음 주의 아주 작은 한 걸음만 */
function RestWeekReport({
  week,
  completeDaysTotal,
  pick,
  canPickNext,
  nextWeekStart,
  picks,
  onSavePick,
}: RestWeekReportProps) {
  const studiedDays = week.days.filter((day) => day.studyMinutes > 0)

  return (
    <>
      <section className="rounded-2xl bg-sky-50 p-5">
        <h2 className="text-[13px] leading-5 font-bold tracking-[0.02em] text-sky-800">
          쉬어 간 주
        </h2>
        <p className="mt-2 text-lg leading-[26px] font-bold break-keep text-slate-900">
          {/* 줄 바꿈은 시안 그대로 ("제일 중요해요" 를 한 줄에 따로) */}
          이번 주는 많이 지쳤던 것 같아요.
          <br />
          괜찮아요, 다시 시작하는 게
          <br />
          제일 중요해요.
        </p>
        <p className="mt-2 text-sm break-keep text-slate-600">
          이번 주는 숫자 비교와 발견을 쉬고, 다시 시작할 작은 한 걸음만 볼게요.
        </p>
      </section>

      <ReportCard title="그래도 해낸 것">
        <WeekDayChips week={week} onlyStudied />
        <p className="mt-3 text-base font-bold break-keep text-slate-900">
          {studiedDays.length === 0
            ? '이번 주는 푹 쉬었어요'
            : `힘든 주에도 ${timesInWords(studiedDays.length)} 책상에 앉았어요`}
        </p>
        {studiedDays.length > 0 && (
          <p className="text-sm break-keep text-slate-500">
            {studiedDays
              .map((day) => `${weekdayNameOf(day.dateKey)}요일 ${formatDuration(day.studyMinutes)}`)
              .join(', ')}
            . 다시 시작할 힘이 남아 있다는 뜻이에요.
          </p>
        )}
        {completeDaysTotal > 0 && (
          <p className="bg-brand-light mt-3.5 rounded-xl px-3 py-2.5 text-sm break-keep text-indigo-900">
            지금까지 계획을 성공한 날{' '}
            <strong className="font-bold">총 {completeDaysTotal}일</strong>. 한 주 쉬었다고 사라지지
            않아요.
          </p>
        )}
      </ReportCard>

      {canPickNext && (
        <ReportCard title="다음 주는 아주 작게 시작해요">
          {/* 이 주에 해 보기로 한 것(지난주 리포트에서 고른 것) */}
          {pick && !pick.skip && (
            <p className="mt-1 text-sm break-keep text-slate-500">
              지난주에 고른 &ldquo;{pick.title}&rdquo;는 잠시 쉬어도 돼요.
            </p>
          )}
          <PickForm
            key={nextWeekStart}
            targetWeekStart={nextWeekStart}
            options={RESTART_OPTIONS}
            picks={picks}
            onSavePick={onSavePick}
          />
        </ReportCard>
      )}

      <p className="rounded-xl bg-slate-50 p-3 text-sm break-keep text-slate-600">
        마음이 힘들면{' '}
        <Link to={CHAT_PATH} className="text-brand font-bold underline underline-offset-[3px]">
          채팅
        </Link>{' '}
        탭에서 이야기해도 돼요.
      </p>
    </>
  )
}

// ---------------------------------------------------------------------------
// 첫 리포트 전 카운트다운
// ---------------------------------------------------------------------------

interface CountdownProps {
  recordDays: number
  studyDays: number
  totalMinutes: number
}

/** 기록한 날이 14일이 안 되면 리포트 대신 보여 줍니다. */
function Countdown({ recordDays, studyDays, totalMinutes }: CountdownProps) {
  const left = REPORT_MIN_DAYS - recordDays

  return (
    <>
      <ReportCard>
        <p className="text-sm break-keep text-slate-600">
          아직 기록이 {REPORT_MIN_DAYS}일이 안 돼서, 리포트 대신
          <br />
          카운트다운을 보여줘요.
        </p>
        <div className="mt-4 flex items-baseline justify-between gap-3">
          <h2 className="text-lg leading-[26px] font-bold text-slate-900">
            첫 리포트까지 D-{left}
          </h2>
          <span className="shrink-0 text-sm text-slate-500 tabular-nums">
            {recordDays} / {REPORT_MIN_DAYS}일
          </span>
        </div>
        <ProgressBar value={(recordDays / REPORT_MIN_DAYS) * 100} className="mt-2" />
      </ReportCard>

      <ReportCard title="지금까지 모인 것">
        <dl className="mt-3 grid grid-cols-3 gap-3">
          <div>
            <dt className="text-[13px] leading-5 text-slate-500">기록한 날</dt>
            <dd className={COUNT_NUMBER_CLASS}>{recordDays}일</dd>
          </div>
          <div>
            <dt className="text-[13px] leading-5 text-slate-500">공부한 날</dt>
            <dd className={COUNT_NUMBER_CLASS}>{studyDays}일</dd>
          </div>
          <div>
            <dt className="text-[13px] leading-5 text-slate-500">총 순공</dt>
            <dd className={cn(COUNT_NUMBER_CLASS, 'whitespace-nowrap')}>
              {formatShortDuration(totalMinutes)}
            </dd>
          </div>
        </dl>
      </ReportCard>

      <section className="rounded-2xl bg-slate-50 p-5">
        <h2 className="text-base font-bold text-slate-900">첫 리포트에서 볼 수 있어요</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm break-keep text-slate-700">
          {FIRST_REPORT_PREVIEW.map((text) => (
            <li key={text} className="flex items-start gap-3">
              {/* 5px 동그라미 점. 글이 두 줄이 되어도 첫 줄 가운데에 오게 mt-2 */}
              <span
                aria-hidden
                className="mt-2 h-[5px] w-[5px] shrink-0 rounded-full bg-slate-700"
              />
              {text}
            </li>
          ))}
        </ul>
        <p className="mt-3.5 text-[13px] leading-5 break-keep text-slate-500">
          매일 아침 체크인을 하면 발견이 더 정확해져요.
        </p>
      </section>
    </>
  )
}

/** 카운트다운의 "지금까지 모인 것" 숫자(9일 · 8h 10m) 글자 모양 */
const COUNT_NUMBER_CLASS =
  'mt-1 text-2xl leading-8 font-extrabold tracking-[-0.02em] text-slate-900 tabular-nums'

/** 첫 리포트에서 볼 수 있는 것 */
const FIRST_REPORT_PREVIEW = [
  '이번 주를 한 줄로 정리한 문장',
  '공부 시간 · 확인 문제 정답률, 지난주와 비교',
  '계획을 끝까지 해낸 날과 지금까지의 총 성공 일수',
  '내 기록에서 찾은 발견 하나',
  '다음 주에 해 볼 것 하나 고르기',
]
