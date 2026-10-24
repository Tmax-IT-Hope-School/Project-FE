import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { SegmentedToggle } from '@/components/ui/SegmentedToggle'
import { Skeleton } from '@/components/ui/Skeleton'
import { useCards } from '@/hooks/useCards'
import { loadManualItems, useManualItems } from '@/hooks/useManualItems'
import { useQueryParam } from '@/hooks/useQueryParam'
import { useSubjects } from '@/hooks/useSubjects'
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
import { mockSubjects } from '@/lib/mock'
import { getCardDayMarkInfo, loadRestDays } from '@/lib/restDays'
import { buildCardIdByPlanId } from '@/lib/sessionRecords'
import { loadRoutines } from '@/lib/routines'
import { loadRecord } from '@/lib/storage'
import { loadQuizResults, type QuizResult } from '@/lib/studyQuiz'
import { CHAT_PATH, MANUAL_PATH, QUIZ_REPORT_PATH } from '@/lib/tabMenu'
import { findWeeklyPick, loadWeeklyPicks, saveWeeklyPick, type WeeklyPick } from '@/lib/weeklyPicks'
import type { Card as CardData, Goal, StudyPlan, StudySession, Subject } from '@/types'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
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
 * 예전 기록 탭의 그래프 · 숲 · AI 분석은 통계 탭(pages/StatsPage.tsx)으로 옮겼습니다.
 * 옛 주소 /report 는 여기로, /manual 은 나 사용설명서(/records/manual, pages/ManualPage.tsx)로 옵니다. (router.tsx)
 */

/**
 * 공부 기록 하나의 과목 이름을 찾습니다.
 *   1. 기록에 과목이 있으면 그 과목 (내 과목 → 예시 과목. 시연용 가상 기록은 예시 과목 id 로 저장됨)
 *   2. 카드 타이머 기록은 과목 칸이 비어 있어서(카드에 과목 칸이 아직 없음), 카드 제목 · 목표 제목에 든 과목 이름
 *      예) 카드 '수학 문제집 2쪽' → 수학 · 목표 '11월 학평 영어 2등급' 에 붙은 카드 → 영어
 *   3. 그래도 없으면 '기타'
 */
function makeSubjectOf(subjects: Subject[], cards: CardData[], goals: Goal[]) {
  const names = [...new Set([...subjects, ...mockSubjects].map((subject) => subject.name))]
  return (session: StudySession): string => {
    const byId =
      subjects.find((item) => item.id === session.subjectId) ??
      mockSubjects.find((item) => item.id === session.subjectId)
    if (byId) return byId.name
    const card = cards.find((item) => item.id === session.cardId)
    const goal = goals.find((item) => item.id === card?.goalId)
    const text = `${card?.title ?? ''} ${goal?.title ?? ''}`
    return names.find((name) => text.includes(name)) ?? '기타'
  }
}

export function RecordsPage() {
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
  const [sessions] = useState(loadStudySessions)
  const [checkIns] = useState(loadCheckInsByDate)
  const [restDays] = useState(loadRestDays)
  const [marks] = useState(loadCardMarks)
  const [quizResults] = useState(loadQuizResults)
  const [cardIdByPlanId] = useState(() =>
    buildCardIdByPlanId(loadRecord<StudyPlan[]>('plans'), loadRoutines()),
  )
  const [picks, setPicks] = useState(loadWeeklyPicks)
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
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <h1 className="text-[28px] leading-tight font-bold tracking-tight">History</h1>

      <SegmentedToggle
        label="리포트 종류"
        options={[
          { value: 'daily', label: '일간 리포트' },
          { value: 'weekly', label: '주간 리포트' },
        ]}
        value={isWeekly ? 'weekly' : 'daily'}
        onChange={setView}
        // 바탕(연회색)과 구분되게 한 단계 진한 회색으로 둡니다.
        className="bg-slate-200"
      />

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

      {recordDays < REPORT_MIN_DAYS ? (
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
            onPicksChange={setPicks}
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

      {/* 문제 풀이 주간 리포트(과목별 점수 그래프 · 주간 정리표)로 가는 입구 (2026-10-24, pages/QuizReportPage.tsx)
          통계 화면에 있던 것을, 주소(/records/quiz)대로 기록 탭으로 옮겼습니다. */}
      <Link
        to={QUIZ_REPORT_PATH}
        className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-white px-5 py-4 hover:bg-slate-50"
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
        className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-white px-5 py-4 hover:bg-slate-50"
      >
        <span className="text-[15px] font-semibold text-slate-900">나 사용설명서</span>
        <span className="flex shrink-0 items-center gap-1 text-sm text-slate-500">
          확인된 것 {manualCount}개<span aria-hidden>›</span>
        </span>
      </Link>
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

  return (
    <Card className="px-3 py-4 sm:px-5">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="지난주"
          onClick={() => onMoveWeek(-1)}
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100"
        >
          <ChevronIcon direction="left" />
        </button>
        <p className="text-[17px] font-bold text-slate-900">{formatWeekLabel(weekStart)}</p>
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

      {/* 주간이면 7칸 뒤에 연보라 띠를 깔아서 "이 주 전체" 를 보고 있다는 걸 보여 줍니다. */}
      <ul className="mt-2 grid grid-cols-7">
        {getWeekDateKeys(weekStart).map((dateKey, index) => {
          const isFuture = dateKey > todayKey
          const isSelected = !isWeekly && dateKey === selectedDate
          const studied = (reports.get(dateKey)?.studyMinutes ?? 0) > 0
          // 기록을 시작한 뒤의 지난 날인데 공부를 안 했으면 '쉰 날'
          const rested =
            !studied && !isFuture && firstRecordDay !== null && dateKey >= firstRecordDay

          return (
            <li key={dateKey} className="flex flex-col items-center gap-1">
              <span className="text-xs text-slate-500">{weekdayNameOf(dateKey)}</span>
              <span
                className={cn(
                  'flex h-11 w-full items-center justify-center',
                  isWeekly && 'bg-brand-light',
                  isWeekly && index === 0 && 'rounded-l-full',
                  isWeekly && index === 6 && 'rounded-r-full',
                )}
              >
                <button
                  type="button"
                  disabled={isFuture || isWeekly}
                  aria-pressed={isSelected}
                  aria-label={`${dayOfMonth(dateKey)}일`}
                  onClick={() => onSelectDate(dateKey)}
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full text-[17px] font-bold tabular-nums',
                    !isWeekly && !isFuture && 'cursor-pointer hover:bg-slate-100',
                    isSelected && 'bg-brand hover:bg-brand text-white',
                    !isSelected && (isWeekly ? 'text-brand' : 'text-slate-900'),
                    isFuture && 'text-slate-300',
                  )}
                >
                  {dayOfMonth(dateKey)}
                </button>
              </span>
              <span
                aria-hidden
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  studied ? 'bg-brand' : rested ? 'bg-slate-300' : 'bg-transparent',
                )}
              />
            </li>
          )
        })}
      </ul>

      <p className="mt-2 flex justify-center gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="bg-brand h-1.5 w-1.5 rounded-full" />
          리포트 있음
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-slate-300" />쉰 날
        </span>
      </p>
    </Card>
  )
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <path d={direction === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// 공통 조각
// ---------------------------------------------------------------------------

/** 연보라 바탕의 "한 줄" 묶음 (하루 한 줄 · 이번 주 한 줄) */
function HeadlineCard({ label, text }: { label: string; text: string }) {
  return (
    <section className="bg-brand-light rounded-2xl p-5 sm:p-6">
      <p className="text-brand text-sm font-semibold">{label}</p>
      <p className="mt-2 text-[17px] leading-relaxed font-bold break-keep text-slate-900">{text}</p>
    </section>
  )
}

/** 보라 상자: ☆ 총 100일 · 지금까지 100일 동안 계획을 성공했어요! */
function TotalSuccessBox({ days }: { days: number }) {
  return (
    <div className="bg-brand mt-4 flex items-center gap-4 rounded-2xl p-4 text-white sm:p-5">
      <span className="text-brand flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          className="h-6 w-6"
        >
          <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z" />
        </svg>
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-bold">총 {days}일</p>
        <p className="text-sm break-keep text-white/90">
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
        'flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-left',
        isSelected ? 'border-brand bg-brand-light' : 'border-slate-200 bg-white hover:bg-slate-50',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
          isSelected ? 'border-brand' : 'border-slate-300',
        )}
      >
        {isSelected && <span className="bg-brand h-2.5 w-2.5 rounded-full" />}
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold break-keep text-slate-900">
          {option.title}
        </span>
        <span className="block text-[13px] break-keep text-slate-500">{option.hint}</span>
      </span>
    </button>
  )
}

interface PickFormProps {
  /** 고른 것을 저장할 주의 월요일 */
  targetWeekStart: string
  options: PickOption[]
  picks: WeeklyPick[]
  onPicksChange: (picks: WeeklyPick[]) => void
}

/** 보기 3개 중 하나 고르고 [이걸로 정하기]. 이미 고른 게 있으면 그것이 골라진 채로 보입니다. */
function PickForm({ targetWeekStart, options, picks, onPicksChange }: PickFormProps) {
  const saved = findWeeklyPick(picks, targetWeekStart)
  const [selectedTitle, setSelectedTitle] = useState<string | null>(saved?.title ?? null)
  const selected = options.find((option) => option.title === selectedTitle)
  const isSaved = saved !== undefined && saved.title === selectedTitle

  function handleSave() {
    if (!selected) return
    onPicksChange(
      saveWeeklyPick({
        weekStart: targetWeekStart,
        title: selected.title,
        hint: selected.hint,
        skip: selected.skip,
      }),
    )
  }

  return (
    <>
      <div role="radiogroup" aria-label="해 볼 것" className="mt-3 flex flex-col gap-2">
        {options.map((option) => (
          <PickOptionButton
            key={option.title}
            option={option}
            isSelected={option.title === selectedTitle}
            onSelect={() => setSelectedTitle(option.title)}
          />
        ))}
      </div>
      <Button
        size="lg"
        className="mt-4 w-full"
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

      <Card title="잘한 것">
        <p className="text-sm text-slate-500">공부 시간</p>
        <div className="mt-1 flex items-end justify-between gap-3">
          <p className="text-[28px] leading-tight font-bold text-slate-900 tabular-nums">
            {formatDuration(day.studyMinutes)}
          </p>
          {percent !== null && (
            <p className="text-brand shrink-0 pb-1 text-sm font-semibold">계획의 {percent}%</p>
          )}
        </div>
        {percent !== null && <ProgressBar value={percent} className="mt-3" />}
        {day.bySubject.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5">
            {day.bySubject.map((item) => (
              <li
                key={item.subject}
                className="flex justify-between gap-3 text-[15px] text-slate-700"
              >
                <span className="min-w-0 truncate">{item.subject}</span>
                <span className="shrink-0 tabular-nums">{formatDuration(item.minutes)}</span>
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
      </Card>

      <Card title="계획 완료">
        <p className="text-[17px] font-bold break-keep text-slate-900">
          {day.isComplete
            ? `${isToday ? '오늘' : '이날'} 계획을 끝까지 해냈어요`
            : day.cardCount + day.pendingCount === 0
              ? '이날은 카드가 없었어요'
              : `카드 ${day.cardCount + day.pendingCount}장 중 ${day.doneCount}장을 끝까지 했어요`}
        </p>
        <TotalSuccessBox days={completeDays} />
      </Card>

      {pick && !pick.skip && (
        <Card title="이번 주에 고른 것">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold break-keep text-slate-800">
              {pick.title}
            </span>
            <PickDayStatus day={day} isToday={isToday} />
          </div>
        </Card>
      )}
    </>
  )
}

/** 고른 것을 그날 해냈는지: 계획을 끝까지 했으면 성공, 공부는 했으면 못 채움 */
function PickDayStatus({ day, isToday }: { day: DayReport; isToday: boolean }) {
  if (day.isComplete) return <span className="shrink-0 font-bold text-emerald-700">성공</span>
  // 오늘은 하루가 아직 안 끝났으니 "못 채움" 이라고 하지 않습니다.
  if (isToday) {
    return <span className="shrink-0 font-semibold text-slate-500">하는 중</span>
  }
  if (day.studyMinutes > 0) {
    return <span className="shrink-0 font-semibold text-slate-500">못 채움</span>
  }
  return <span className="shrink-0 font-semibold text-slate-400">쉰 날</span>
}

interface DailyAccuracyProps {
  dateKey: string
  input: HistoryInput
  quizResults: QuizResult[]
  subjectNames: string[]
}

/** 그날의 확인 문제(채팅) + 사진 채점 정답률 */
function DailyAccuracy({ dateKey, input, quizResults, subjectNames }: DailyAccuracyProps) {
  const { data: checks } = useSuspenseQuery(answerChecksQuery(dateKey))
  const accuracy = summarizeAccuracy([
    ...quizMarks(quizResults, [dateKey], input, subjectNames),
    ...photoMarks(checks, [dateKey]),
  ])

  if (accuracy.percent === null) {
    return (
      <p className="mt-1 text-sm break-keep text-slate-500">
        이날 푼 확인 문제가 없어요. 채팅에서 확인 문제를 풀거나 통계 탭에서 사진 채점을 하면 여기에
        모여요.
      </p>
    )
  }

  return (
    <>
      <div className="mt-1 flex items-end justify-between gap-3">
        <p className="text-[28px] leading-tight font-bold text-slate-900 tabular-nums">
          {accuracy.percent}%
        </p>
        <p className="shrink-0 pb-1 text-sm text-slate-600">
          {accuracy.total}문제 중 {accuracy.correct}문제
        </p>
      </div>
      <ul className="mt-3 flex flex-col gap-1.5">
        {accuracy.bySubject.map((item) => (
          <li key={item.subject} className="flex justify-between gap-3 text-[15px] text-slate-700">
            <span className="min-w-0 truncate">{item.subject}</span>
            <span className="shrink-0 tabular-nums">
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
  onPicksChange: (picks: WeeklyPick[]) => void
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
  onPicksChange,
}: WeeklyReportProps) {
  const lastWeekStart = moveDateKey(weekStart, -7)
  // 사진 채점은 지난주 ~ 이번 주(14일)를 한 번에 받아 둘로 나눕니다.
  const { data: checks } = useSuspenseQuery(
    answerChecksBetweenQuery(lastWeekStart, moveDateKey(weekStart, 6)),
  )

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
        onPicksChange={onPicksChange}
      />
    )
  }

  const accuracyOf = (target: WeekReport) => {
    const dateKeys = target.days.map((day) => day.dateKey)
    return summarizeAccuracy([
      ...quizMarks(quizResults, dateKeys, input, subjectNames),
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

      <Card title="이번 주 잘한 것">
        <p className="text-sm text-slate-500">공부 시간</p>
        <div className="mt-1 flex items-start justify-between gap-3">
          <div>
            <p className="text-[28px] leading-tight font-bold text-slate-900 tabular-nums">
              {formatDuration(week.totalMinutes)}
            </p>
            <p className="text-sm text-slate-500">
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
          <p className="mt-3 text-[15px] break-keep text-slate-700">
            가장 오래 한 날은{' '}
            <strong className="text-slate-900">
              {weekdayNameOf(week.bestDay.dateKey)}요일 {formatDuration(week.bestDay.studyMinutes)}
            </strong>
            이에요.
          </p>
        )}

        <hr className="my-5 border-slate-100" />

        <p className="text-sm text-slate-500">확인 문제 정답률</p>
        {accuracy.percent === null ? (
          <p className="mt-1 text-sm break-keep text-slate-500">
            이번 주에 푼 확인 문제가 없어요. 채팅에서 확인 문제를 풀거나 통계 탭에서 사진 채점을
            하면 여기에 모여요.
          </p>
        ) : (
          <>
            <div className="mt-1 flex items-start justify-between gap-3">
              <div>
                <p className="text-[28px] leading-tight font-bold text-slate-900 tabular-nums">
                  {accuracy.percent}%
                </p>
                <p className="text-sm text-slate-500">
                  {accuracy.total}문제 중 {accuracy.correct}문제 맞힘
                </p>
              </div>
              {accuracyDiff !== null && (
                <DiffBadge diff={accuracyDiff} text={`${Math.abs(accuracyDiff)}%p`} />
              )}
            </div>
            <ul className="mt-4 flex flex-col gap-3">
              {accuracy.bySubject.map((item) => (
                <li key={item.subject}>
                  <div className="flex justify-between gap-3 text-[15px] text-slate-700">
                    <span className="min-w-0 truncate">{item.subject}</span>
                    <span className="shrink-0 tabular-nums">
                      {item.total}문제 중 {item.correct}개 ·{' '}
                      <strong className="text-slate-900">{item.percent}%</strong>
                    </span>
                  </div>
                  <ProgressBar value={item.percent} className="mt-1.5" />
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card title="계획을 끝까지 해낸 날">
        <p className="text-[17px] font-bold text-slate-900">
          {week.isCurrent ? '이번 주 지금까지 ' : '이번 주 '}
          <span className="text-brand">{week.completeDays}일</span> 완료했어요
        </p>
        <WeekDayChips week={week} />
        <p className="mt-2 text-xs break-keep text-slate-500">
          색칠한 날 = 완료 · 회색 = 못 채움 · 점선 = 쉬는 날
        </p>
        <TotalSuccessBox days={completeDaysTotal} />
      </Card>

      {pick && !pick.skip && (
        <PickResultCard
          pick={pick}
          week={week}
          lastWeek={lastWeek}
          canRepeat={canPickNext}
          nextWeekStart={nextWeekStart}
          picks={picks}
          onPicksChange={onPicksChange}
        />
      )}

      {canPickNext && (
        <Card
          title={
            nextWeekStart === currentWeekStart
              ? '이번 주에 하나만 해 볼까요?'
              : '다음 주에 하나만 해 볼까요?'
          }
        >
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-[13px] text-slate-500">이번 주 발견</p>
            <p className="mt-1 text-[15px] font-bold break-keep text-slate-900">{finding.text}</p>
          </div>
          {/* key: 주를 바꾸면 고르던 보기를 처음부터 다시 그립니다. */}
          <PickForm
            key={nextWeekStart}
            targetWeekStart={nextWeekStart}
            options={finding.options}
            picks={picks}
            onPicksChange={onPicksChange}
          />
        </Card>
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
        'shrink-0 text-right text-sm leading-snug font-semibold',
        isUp ? 'text-brand' : 'text-slate-500',
      )}
    >
      {isUp ? '▲' : '▼'} 지난주보다
      <br />
      {text}
    </p>
  )
}

/** 요일별 공부 시간 막대 (가장 오래 한 날은 진한 보라 + '최고') */
function WeekBars({ week, todayKey }: { week: WeekReport; todayKey: string }) {
  const max = Math.max(...week.days.map((day) => day.studyMinutes), 1)

  return (
    <ul className="mt-5 grid h-36 grid-cols-7 items-end gap-2" aria-label="요일별 공부 시간">
      {week.days.map((day) => {
        const isBest = week.bestDay?.dateKey === day.dateKey
        // 막대 높이는 그 주에서 가장 긴 날을 100% 로 봅니다. 0분이면 바닥에 얇은 선만.
        const percent = Math.round((day.studyMinutes / max) * 100)
        return (
          <li key={day.dateKey} className="flex h-full flex-col items-center justify-end gap-1">
            {isBest && <span className="text-brand text-[11px] font-semibold">최고</span>}
            <span className="sr-only">
              {weekdayNameOf(day.dateKey)} {formatDuration(day.studyMinutes)}
            </span>
            <span
              aria-hidden
              className={cn(
                'w-full rounded-t-md',
                isBest ? 'bg-brand' : 'bg-indigo-200',
                day.studyMinutes === 0 && 'bg-slate-200',
              )}
              // 높이가 공부 시간에 따라 계속 바뀌어서 Tailwind 클래스로 만들 수 없어 인라인 style 을 씁니다. (최소 3px)
              style={{ height: day.studyMinutes === 0 ? '3px' : `max(6px, ${percent * 0.8}%)` }}
            />
            <span
              className={cn(
                'text-xs',
                isBest ? 'text-brand font-bold' : 'text-slate-500',
                day.dateKey > todayKey && 'text-slate-300',
              )}
            >
              {weekdayNameOf(day.dateKey)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

const DAY_CHIP_STYLES: Record<WeekDayState, string> = {
  complete: 'bg-brand text-white',
  missed: 'bg-slate-100 text-slate-500',
  rest: 'border border-dashed border-slate-300 bg-white text-slate-400',
  future: 'border border-dashed border-slate-200 bg-white text-slate-300',
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
              'flex h-10 items-center justify-center rounded-lg text-sm font-semibold',
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
  onPicksChange: (picks: WeeklyPick[]) => void
}

/** 이번 주에 고른 것의 결과 + [1주 더 해 보기] [사용설명서에 넣기] */
function PickResultCard({
  pick,
  week,
  lastWeek,
  canRepeat,
  nextWeekStart,
  picks,
  onPicksChange,
}: PickResultCardProps) {
  const { items, addItem } = useManualItems()
  const result = getPickResult(pick, week)
  if (result === null) return null

  const manualId = `manual-pick-${week.weekStart}`
  const isInManual = items.some((item) => item.id === manualId)
  const isRepeated = findWeeklyPick(picks, nextWeekStart)?.title === pick.title
  const minutesGain = week.totalMinutes - lastWeek.totalMinutes

  function handleRepeat() {
    onPicksChange(
      saveWeeklyPick({ weekStart: nextWeekStart, title: pick.title, hint: pick.hint, skip: false }),
    )
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
    <Card>
      <p className="text-[17px] leading-relaxed font-bold break-keep text-slate-900">
        이번 주 고른 &lsquo;{pick.title}&rsquo;, 공부한 {result.studyDays}일 중{' '}
        {result.completeDays}일 해냈어요.
        {canRepeat && ' 다음 주에도 똑같이 해 볼까요?'}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {canRepeat && (
          <Button onClick={handleRepeat} disabled={isRepeated}>
            {isRepeated ? '1주 더 해요' : '1주 더 해 보기'}
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={handleAddToManual}
          disabled={isInManual}
          className={cn(!canRepeat && 'col-span-2')}
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
    </Card>
  )
}

interface RestWeekReportProps {
  week: WeekReport
  completeDaysTotal: number
  pick: WeeklyPick | undefined
  canPickNext: boolean
  nextWeekStart: string
  picks: WeeklyPick[]
  onPicksChange: (picks: WeeklyPick[]) => void
}

/** 쉬어 간 주: 숫자 비교와 발견 없이, 그래도 해낸 것과 다음 주의 아주 작은 한 걸음만 */
function RestWeekReport({
  week,
  completeDaysTotal,
  pick,
  canPickNext,
  nextWeekStart,
  picks,
  onPicksChange,
}: RestWeekReportProps) {
  const studiedDays = week.days.filter((day) => day.studyMinutes > 0)

  return (
    <>
      <section className="rounded-2xl bg-sky-50 p-5 sm:p-6">
        <p className="text-sm font-semibold text-sky-800">쉬어 간 주</p>
        <p className="mt-2 text-[17px] leading-relaxed font-bold break-keep text-slate-900">
          이번 주는 많이 지쳤던 것 같아요. 괜찮아요, 다시 시작하는 게 제일 중요해요.
        </p>
        <p className="mt-2 text-sm break-keep text-slate-600">
          이번 주는 숫자 비교와 발견을 쉬고, 다시 시작할 작은 한 걸음만 볼게요.
        </p>
      </section>

      <Card title="그래도 해낸 것">
        <WeekDayChips week={week} onlyStudied />
        <p className="mt-4 text-[17px] font-bold break-keep text-slate-900">
          {studiedDays.length === 0
            ? '이번 주는 푹 쉬었어요'
            : `힘든 주에도 ${studiedDays.length}번 책상에 앉았어요`}
        </p>
        {studiedDays.length > 0 && (
          <p className="mt-1 text-[15px] break-keep text-slate-600">
            {studiedDays
              .map((day) => `${weekdayNameOf(day.dateKey)}요일 ${formatDuration(day.studyMinutes)}`)
              .join(', ')}
            . 다시 시작할 힘이 남아 있다는 뜻이에요.
          </p>
        )}
        {completeDaysTotal > 0 && (
          <p className="bg-brand-light mt-4 rounded-xl p-4 text-[15px] break-keep text-slate-700">
            지금까지 계획을 성공한 날{' '}
            <strong className="text-slate-900">총 {completeDaysTotal}일</strong>. 한 주 쉬었다고
            사라지지 않아요.
          </p>
        )}
      </Card>

      {canPickNext && (
        <Card title="다음 주는 아주 작게 시작해요">
          {pick && !pick.skip && (
            <p className="text-[15px] break-keep text-slate-600">
              이번 주에 고른 &ldquo;{pick.title}&rdquo; 는 잠시 쉬어도 돼요.
            </p>
          )}
          <PickForm
            key={nextWeekStart}
            targetWeekStart={nextWeekStart}
            options={RESTART_OPTIONS}
            picks={picks}
            onPicksChange={onPicksChange}
          />
        </Card>
      )}

      <p className="rounded-2xl bg-white p-4 text-[15px] break-keep text-slate-600">
        마음이 힘들면{' '}
        <Link to={CHAT_PATH} className="text-brand font-semibold underline underline-offset-2">
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
      <Card>
        <p className="text-[15px] break-keep text-slate-600">
          아직 기록이 {REPORT_MIN_DAYS}일이 안 돼서, 리포트 대신 카운트다운을 보여줘요.
        </p>
        <div className="mt-4 flex items-end justify-between gap-3">
          <p className="text-xl font-bold text-slate-900">첫 리포트까지 D-{left}</p>
          <p className="shrink-0 text-sm text-slate-500 tabular-nums">
            {recordDays} / {REPORT_MIN_DAYS}일
          </p>
        </div>
        <ProgressBar value={(recordDays / REPORT_MIN_DAYS) * 100} className="mt-3" />
      </Card>

      <Card title="지금까지 모인 것">
        <dl className="grid grid-cols-3 gap-2">
          <div>
            <dt className="text-sm text-slate-500">기록한 날</dt>
            <dd className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{recordDays}일</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">공부한 날</dt>
            <dd className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{studyDays}일</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">총 순공</dt>
            <dd className="mt-1 text-2xl font-bold whitespace-nowrap text-slate-900 tabular-nums">
              {formatShortDuration(totalMinutes)}
            </dd>
          </div>
        </dl>
      </Card>

      <section className="rounded-2xl bg-slate-50 p-5 sm:p-6">
        <h2 className="text-[17px] font-bold text-slate-900">첫 리포트에서 볼 수 있어요</h2>
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[15px] break-keep text-slate-700">
          <li>이번 주를 한 줄로 정리한 문장</li>
          <li>공부 시간 · 확인 문제 정답률, 지난주와 비교</li>
          <li>계획을 끝까지 해낸 날과 지금까지의 총 성공 일수</li>
          <li>내 기록에서 찾은 발견 하나</li>
          <li>다음 주에 해 볼 것 하나 고르기</li>
        </ul>
        <p className="mt-3 text-sm break-keep text-slate-500">
          매일 아침 체크인을 하면 발견이 더 정확해져요.
        </p>
      </section>
    </>
  )
}
