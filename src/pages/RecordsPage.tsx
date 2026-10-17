import { useQueryParam } from '@/hooks/useQueryParam'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'
import { SubjectBadge } from '@/components/ui/SubjectBadge'
import { usePlans } from '@/hooks/usePlans'
import {
  buildCallSummaries,
  loadCheckInsByDate,
  loadEvaluationsByDate,
  type CallSummary,
} from '@/lib/callSummary'
import { careThemes } from '@/lib/careTheme'
import { cn } from '@/lib/cn'
import {
  type DailyRecord,
  formatClock,
  formatMinutes,
  groupSessionsByDate,
  isStudySession,
  sessionMinutes,
  toDateKey,
} from '@/lib/dailyRecords'
import { getTodayKey, isDateKey, isMonthKey, toDayDate } from '@/lib/date'
import { useSubjects } from '@/hooks/useSubjects'
import { loadData } from '@/lib/storage'
import { getStudyStreak, hasStudiedToday } from '@/lib/streak'
import { thinkingHabitsQuery } from '@/lib/thinkingHabits'
import { THINKING_TEST_PATH, hasThinkingTest } from '@/lib/thinkingTest'
import { formatHoursMinutes, getWeeklyStudy } from '@/lib/weeklyStudy'
import type { CareLevel, StudySession, Subject } from '@/types'

const weekdayNames = ['일', '월', '화', '수', '목', '금', '토']

/** 'YYYY-MM-DD' 를 '오늘 · 10월 10일 (토)', '어제 · …', '10월 8일 (수)' 처럼 바꿉니다. */
function formatDateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const text = `${month}월 ${day}일 (${weekdayNames[date.getDay()]})`

  // 오늘은 하루의 기준(새벽 4시)으로 정합니다. 새벽 2시면 아직 어제입니다. (lib/date.ts)
  const today = toDayDate(Date.now())
  if (dateKey === toDateKey(today)) return `오늘 · ${text}`

  // new Date(년, 월, 일) 은 일이 범위를 넘어가면 달·해를 알아서 넘겨줍니다. (-1 = 어제)
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (dateKey === toDateKey(yesterday)) return `어제 · ${text}`

  return text
}

/** 저장해 둔 공부 기록을 불러옵니다. 없으면 빈 목록입니다. (가짜 데이터로 채우지 않습니다) */
function loadSessions(): StudySession[] {
  const saved = loadData<unknown>('sessions', [])
  // 배열이 아니거나 모양이 틀린 기록은 걸러냅니다.
  const sessions: StudySession[] = Array.isArray(saved) ? saved.filter(isStudySession) : []
  // 노는 기록(kind 가 'play')은 공부 기록이 아니라서 이 화면에 보여주지 않습니다. (#238)
  return sessions.filter((session) => session.kind !== 'play')
}

interface SubjectTagProps {
  subject: Subject | undefined
}

/** 과목 태그. 과목을 지워서 찾을 수 없으면 "삭제된 과목" 으로 보여줍니다. */
function SubjectTag({ subject }: SubjectTagProps) {
  if (!subject) {
    return (
      <span className="inline-block max-w-full truncate rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
        삭제된 과목
      </span>
    )
  }
  return <SubjectBadge name={subject.name} color={subject.color} />
}

export function RecordsPage() {
  const navigate = useNavigate()
  // 설정 화면에서 켠 사람에게만 일기 메뉴를 보여줍니다. (#63)
  const isDiaryEnabled = loadData('diary-enabled', false)

  // 공부 기록은 타이머가 저장해 둔 것을 읽기만 합니다. 과목은 계획 화면에서 저장한 목록을 씁니다.
  const [sessions] = useState<StudySession[]>(loadSessions)
  const subjects = useSubjects()

  // 최근 날짜가 맨 앞에 오도록 날짜별로 묶습니다.
  const days = groupSessionsByDate(sessions)

  // 지난 통화 요약: 통화에서 나온 값은 체크인에 저장되므로, 체크인을 날짜별로 꺼내 어제 공부 기록과 합칩니다. (#45)
  const { allPlans } = usePlans()
  const [checkIns] = useState(loadCheckInsByDate)
  const [evaluations] = useState(loadEvaluationsByDate)
  const callSummaries = buildCallSummaries(checkIns, allPlans, sessions, evaluations)

  // 지금 펼쳐 둔 날짜. null 이면 전부 접혀 있습니다. 같은 날짜를 다시 누르면 접힙니다.
  const [openDate, setOpenDate] = useState<string | null>(null)

  function handleToggle(date: string) {
    setOpenDate((current) => (current === date ? null : date))
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">기록·통계</h1>

      {isDiaryEnabled && (
        <Card title="일기">
          <p className="text-sm text-slate-600">원할 때만 쓰는 자유 일기예요.</p>
          <Button className="mt-4 w-full sm:w-auto" onClick={() => navigate('/diary')}>
            일기 쓰러 가기
          </Button>
        </Card>
      )}

      {/* 연속 공부일 · 최근 7일 막대그래프 · 주간 리포트 카드. 모바일은 한 줄에 하나, PC 는 두 칸으로 카드를 놓습니다. */}
      {/* items-start: 높이가 다른 카드를 억지로 같은 높이로 늘리지 않습니다. (시안처럼) */}
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
        <StreakCard sessions={sessions} />
        <WeeklyBarCard sessions={sessions} />

        <Card title="주간 리포트">
          <p className="text-sm text-slate-600">이번 주를 숫자와 발견으로 정리해서 보여줘요.</p>
          <Button className="mt-4 w-full sm:w-auto" onClick={() => navigate('/report')}>
            주간 리포트 보기
          </Button>
        </Card>

        <Card title="시험">
          <p className="text-sm text-slate-600">
            시험 전에 예상 점수를 적어 두고, 다가오는 시험을 D-day 로 확인해요.
          </p>
          <Button className="mt-4 w-full sm:w-auto" onClick={() => navigate('/exams')}>
            시험 보러 가기
          </Button>
        </Card>
      </div>

      {/* 시안처럼 PC(lg)에서는 두 칸으로 나눕니다. 다른 기록 카드가 생기면 이 안에 이어서 넣으면 됩니다. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <StudyCalendar days={days} subjects={subjects} />

        <Card title="날짜별 기록">
          {days.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              아직 공부 기록이 없어요. 타이머로 공부하면 여기에 쌓여요.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {days.map((day) => {
                const isOpen = openDate === day.date
                const panelId = `records-${day.date}`

                return (
                  <li key={day.date}>
                    {/* 날짜 줄 전체가 버튼입니다. min-h-12(48px)라서 손가락으로 누르기 편합니다. */}
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onClick={() => handleToggle(day.date)}
                      className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 py-3 text-left"
                    >
                      {/* min-w-0: 과목이 많아도 줄이 가로로 튀어나가지 않게 합니다. */}
                      <span className="flex min-w-0 flex-col gap-1.5">
                        <span className="text-sm font-semibold text-slate-900">
                          {formatDateLabel(day.date)}
                        </span>
                        {/* 접혀 있을 때도 과목별 시간이 보입니다. */}
                        <span className="flex flex-wrap gap-x-3 gap-y-1">
                          {day.subjects.map((record) => (
                            // max-w-full: 과목 이름이 아주 길어도 화면 폭을 넘지 않게 해서, 태그의 '...' 줄임이 작동하게 합니다.
                            <span
                              key={record.subjectId}
                              className="inline-flex max-w-full items-center gap-1"
                            >
                              <SubjectTag
                                subject={subjects.find((item) => item.id === record.subjectId)}
                              />
                              <span className="shrink-0 text-xs text-slate-500">
                                {formatMinutes(record.minutes)}
                              </span>
                            </span>
                          ))}
                        </span>
                      </span>

                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">
                          {formatMinutes(day.totalMinutes)}
                        </span>
                        <span aria-hidden className="text-xs text-slate-400">
                          {isOpen ? '▲' : '▼'}
                        </span>
                      </span>
                    </button>

                    {/* 펼치면 그날의 과목별 기록(몇 시부터 몇 시까지, 몇 분)이 나옵니다. */}
                    {isOpen && (
                      <div
                        id={panelId}
                        className="mb-3 flex flex-col gap-3 rounded-lg bg-slate-50 p-3"
                      >
                        {day.subjects.map((record) => (
                          <div key={record.subjectId}>
                            <div className="flex items-center justify-between gap-3">
                              <SubjectTag
                                subject={subjects.find((item) => item.id === record.subjectId)}
                              />
                              <span className="shrink-0 text-sm font-semibold text-slate-900">
                                {formatMinutes(record.minutes)}
                              </span>
                            </div>
                            <ul className="mt-2 flex flex-col gap-1">
                              {record.sessions.map((session) => (
                                <li
                                  // id 에 시작 시각을 붙입니다. 저장된 기록의 id 가 겹쳐도 화면이 경고 없이 둘 다 보여줍니다.
                                  key={`${session.id}-${session.startedAt}`}
                                  className="flex items-center justify-between gap-3 text-sm text-slate-600"
                                >
                                  <span>
                                    {formatClock(session.startedAt)} ~{' '}
                                    {formatClock(session.endedAt)}
                                  </span>
                                  <span>{formatMinutes(sessionMinutes(session))}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      <CallSummaryCard summaries={callSummaries} />

      <Card title="자주 보이는 내 생각 습관">
        {/* 서버에서 받아오는 부분만 AsyncBoundary 로 감쌉니다. 받아오는 동안 스켈레톤, 실패하면 안내와 다시 시도 버튼 */}
        <AsyncBoundary
          pendingFallback={<ThinkingHabitsSkeleton />}
          errorMessage="생각 습관을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."
        >
          <ThinkingHabitList />
        </AsyncBoundary>
        {/* 가입 때 한 생각 습관 테스트. 했으면 결과를, 안 했으면 테스트를 엽니다. 통화에서 보인 것과 비교해 볼 수 있습니다. */}
        <Link
          to={
            hasThinkingTest()
              ? `${THINKING_TEST_PATH}?step=result&from=records`
              : `${THINKING_TEST_PATH}?from=records`
          }
          className="text-brand mt-4 inline-flex h-10 items-center text-sm font-medium underline"
        >
          {hasThinkingTest() ? '처음 한 생각 습관 테스트 결과 보기' : '생각 습관 테스트 해 보기'}
        </Link>
      </Card>
    </div>
  )
}

/** 생각 습관을 받아오는 동안 보여 주는 자리 (진짜 목록과 비슷한 크기) */
function ThinkingHabitsSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-3">
      <span className="sr-only">생각 습관을 불러오는 중이에요</span>
      <Skeleton className="h-28 w-full rounded-lg" />
    </div>
  )
}

/**
 * 통화에서 최근 2주 중 3일 넘게 보인 생각 습관(인지편향) 목록입니다. (서버가 골라 줍니다)
 * 이름은 "생각" 에 붙입니다. "너는 ~형" 처럼 사람에게 붙이지 않습니다.
 */
function ThinkingHabitList() {
  const { data: habits } = useSuspenseQuery(thinkingHabitsQuery())

  if (habits.length === 0) {
    return (
      <p className="py-6 text-center text-sm break-keep text-slate-500">
        통화에서 같은 생각 습관이 최근 2주 중 3일 넘게 보이면 여기에 알려 줄게요.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {habits.map((habit) => (
          <li key={habit.key} className="rounded-lg border border-slate-200 p-4">
            {/* 이름과 보인 날 수. 좁은 화면에서는 줄을 바꿉니다. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-base font-semibold text-slate-900">{habit.label}</p>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                최근 2주 중 {habit.days}일
              </span>
            </div>
            <p className="mt-1 text-sm break-keep text-slate-600">{habit.description}</p>
            {habit.lastEvidence !== null && (
              <p className="mt-2 text-sm break-keep text-slate-700">
                최근 통화에서: {habit.lastEvidence}
              </p>
            )}
            <div className="bg-brand/10 mt-3 rounded-lg px-3 py-2">
              <p className="text-brand-dark text-xs font-semibold">이렇게 해 볼까요?</p>
              <p className="mt-0.5 text-sm break-keep text-slate-900">{habit.solution}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-xs break-keep text-slate-500">
        생각 습관은 성격이 아니라, 알아차리면 바꿀 수 있는 버릇이에요.
      </p>
    </div>
  )
}

// 처음에 보여줄 통화 요약 개수입니다. 더 있으면 "더 보기" 로 펼칩니다.
const INITIAL_SUMMARY_COUNT = 5

/** 관리 강도 이름(색 점 옆에 적는 글자) */
const careLevelNames = ['회복', '당근', '넛지', '심리적 채찍', '강제적 채찍'] as const

/**
 * 그날의 관리 강도를 색 점 + 이름으로 보여줍니다. 색만으로 구분하지 않고 이름도 함께 적습니다.
 * 강도를 저장해 둔 곳이 아직 없어서, 지금은 보통 null(표시 없음)입니다.
 */
function getCareBadge(level: CareLevel | null): { name: string; dotClass: string } | null {
  if (level === null) return null
  // 4(강제적 채찍)는 집중 모드(#69)가 나오기 전이라 색 테마가 없어서 진한 빨강으로 따로 정합니다.
  if (level === 4) return { name: careLevelNames[4], dotClass: 'bg-red-900' }
  return { name: careThemes[level].name, dotClass: careThemes[level].avatarBackground }
}

interface CareBadgeProps {
  level: CareLevel | null
}

/** 관리 강도 색 점 + 이름. 강도를 모르면 아무것도 그리지 않습니다. */
function CareBadge({ level }: CareBadgeProps) {
  const badge = getCareBadge(level)
  if (badge === null) return null

  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600">
      <span aria-hidden className={cn('h-2.5 w-2.5 shrink-0 rounded-full', badge.dotClass)} />
      {badge.name}
    </span>
  )
}

interface CallSummaryCardProps {
  summaries: CallSummary[]
}

/** "지난 통화 요약": 날짜별 목록(최근 것이 위)과, 눌렀을 때 그날 카드를 자세히 보는 팝업 */
function CallSummaryCard({ summaries }: CallSummaryCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  // 지금 팝업으로 보고 있는 요약. null 이면 팝업이 닫혀 있습니다.
  const [selected, setSelected] = useState<CallSummary | null>(null)

  const visibleSummaries = isExpanded ? summaries : summaries.slice(0, INITIAL_SUMMARY_COUNT)

  return (
    <Card title="지난 통화 요약">
      {summaries.length === 0 ? (
        <p className="py-6 text-center text-sm break-keep text-slate-500">
          아직 통화 요약이 없어요. 매일 체크인을 하면 여기에 쌓여요.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {visibleSummaries.map((summary) => (
            <li key={summary.date}>
              {/* 줄 전체가 버튼입니다. min-h-12(48px)라서 손가락으로 누르기 편합니다. */}
              <button
                type="button"
                onClick={() => setSelected(summary)}
                className="flex min-h-12 w-full cursor-pointer flex-col gap-1 py-3 text-left"
              >
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                  {formatDateLabel(summary.date)}
                  <CareBadge level={summary.careLevel} />
                </span>
                {/* break-words: 긴 문장도 화면 폭을 넘지 않고 줄바꿈됩니다. */}
                <span className="text-sm font-semibold break-words text-slate-900">
                  {summary.headline}
                </span>
                {summary.promise && (
                  <span className="text-brand text-sm break-words">약속: {summary.promise}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {summaries.length > INITIAL_SUMMARY_COUNT && (
        <Button
          variant="ghost"
          className="mt-2 w-full"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((current) => !current)}
        >
          {isExpanded ? '접기' : `더 보기 (${summaries.length - INITIAL_SUMMARY_COUNT}개)`}
        </Button>
      )}

      <Modal
        isOpen={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? `${formatDateLabel(selected.date)} 통화 요약` : undefined}
      >
        {selected && (
          <dl className="flex flex-col gap-3">
            <CareBadge level={selected.careLevel} />
            <SummaryRow label="어제 요약" value={selected.headline} />
            <SummaryRow label="미달 원인" value={selected.missReason} emptyText="고르지 않았어요" />
            <SummaryRow
              label="오늘 예상 순공시간"
              value={formatMinutes(selected.expectedMinutes)}
            />
            <SummaryRow label="오늘의 약속" value={selected.promise} emptyText="정하지 않았어요" />
            <SummaryRow label="AI 한마디" value={selected.aiComment} emptyText="아직 없어요" />
          </dl>
        )}
      </Modal>
    </Card>
  )
}

interface SummaryRowProps {
  label: string
  /** 보여줄 내용. null 이면 emptyText 를 흐린 글씨로 보여줍니다. */
  value: string | null
  emptyText?: string
}

/** 팝업 안의 "이름 / 내용" 한 줄 */
function SummaryRow({ label, value, emptyText }: SummaryRowProps) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={cn('mt-0.5 text-sm break-words', value ? 'text-slate-900' : 'text-slate-400')}>
        {value ?? emptyText}
      </dd>
    </div>
  )
}

interface StreakCardProps {
  sessions: StudySession[]
}

/** "🔥 5일째 연속 공부 중" 을 보여주는 카드 */
function StreakCard({ sessions }: StreakCardProps) {
  const streak = getStudyStreak(sessions)
  const studiedToday = hasStudiedToday(sessions)

  // 상황에 따라 아래 작은 글씨를 바꿉니다.
  let message = '오늘 공부하면 1일째가 돼요'
  if (streak > 0 && studiedToday) {
    message = '오늘도 공부 완료! 내일도 이어가요'
  } else if (streak > 0) {
    message = `오늘도 하면 ${streak + 1}일째`
  }

  return (
    <Card className="flex items-center gap-4">
      <div
        aria-hidden
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-2xl"
      >
        🔥
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-slate-900 sm:text-2xl">
          {streak > 0 ? `${streak}일째 연속 공부 중` : '아직 연속 기록이 없어요'}
        </p>
        <p className="mt-1 text-sm text-slate-500">{message}</p>
      </div>
    </Card>
  )
}

interface WeeklyBarCardProps {
  sessions: StudySession[]
}

/** 최근 7일 공부 시간을 막대그래프로 보여주는 카드. 차트 라이브러리 없이 div + Tailwind 로 만듭니다. (#41) */
function WeeklyBarCard({ sessions }: WeeklyBarCardProps) {
  const { days, totalMinutes } = getWeeklyStudy(sessions)

  return (
    <Card>
      {/* flex-wrap: 375px 에서 합계가 길어지면 제목 아래 줄로 내려갑니다. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold text-slate-900">최근 7일 공부 시간</h3>
        <p className="text-sm text-slate-500">
          합계 {totalMinutes === 0 ? '0분' : formatMinutes(totalMinutes)}
        </p>
      </div>

      {/* grid-cols-7: 폭이 좁아도 막대 7개를 같은 폭으로 한 줄에 놓습니다. (가로 스크롤 없음) */}
      {/* pt-6: 가장 높은 막대 위에 붙는 시간 글자가 제목과 겹치지 않게 자리를 비워 둡니다. */}
      <ul className="mt-4 grid grid-cols-7 gap-2 pt-6">
        {days.map((day) => (
          <li key={day.date} className="flex flex-col items-center gap-2">
            {/* 화면에 보이는 막대·글자는 스크린리더가 따로따로 읽으면 알아듣기 어려워서, 하루를 한 문장으로 읽어 줍니다. */}
            <span className="sr-only">
              {weekdayNames[day.weekday]}요일{day.isToday ? '(오늘)' : ''}{' '}
              {day.minutes === 0 ? '공부 기록 없음' : formatMinutes(day.minutes)}
            </span>

            {/* 막대가 서는 자리. 높이 160px 이고, 막대 높이는 이 안에서의 비율(%)입니다. 넓은 화면에서는 막대가 너무 뚱뚱해지지 않게 40px 까지만. */}
            <div aria-hidden className="relative h-40 w-full max-w-10">
              {/* style 을 쓰는 이유: 높이가 계산해서 나온 비율(%)이라 Tailwind 클래스(h-1/2 같은)로 미리 적어 둘 수 없습니다. (이슈 #41 의 인라인 style 예외) */}
              {/* min-h-0.5: 공부한 날은 아주 짧아도 막대가 2px 은 보이게 합니다. 0분인 날은 막대가 없습니다. */}
              <div
                className={cn(
                  'absolute inset-x-0 bottom-0 rounded-t-md',
                  // 오늘은 아직 끝나지 않은 날이라 연한 색으로 구분합니다.
                  day.isToday ? 'bg-indigo-300' : 'bg-brand',
                  day.minutes > 0 && 'min-h-0.5',
                )}
                style={{ height: `${day.percent}%` }}
              >
                {/* bottom-full: 막대의 바로 위에 붙입니다. tabular-nums: 숫자 폭을 같게 해서 글자가 흔들리지 않게 합니다. */}
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 pb-1 text-xs whitespace-nowrap text-slate-600 tabular-nums">
                  {formatHoursMinutes(day.minutes)}
                </span>
              </div>
            </div>

            <span
              aria-hidden
              className={cn('text-sm', day.isToday ? 'text-brand font-bold' : 'text-slate-600')}
            >
              {weekdayNames[day.weekday]}
            </span>
          </li>
        ))}
      </ul>

      {/* break-keep: 375px 에서 한글이 단어 중간("중이/에요")에서 끊기지 않게 합니다. */}
      <p className="mt-4 text-sm break-keep text-slate-500">
        {totalMinutes === 0
          ? '최근 7일 동안 공부 기록이 없어요. 타이머로 공부하면 막대가 생겨요.'
          : '연한 막대가 오늘이에요. 오늘은 아직 진행 중이에요.'}
      </p>
    </Card>
  )
}

/**
 * 공부 시간(분)을 색 단계 0~3 으로 바꿉니다. (깃허브 잔디처럼 많이 할수록 진하게)
 *   0: 기록 없음 · 1: 1시간 미만 · 2: 1~3시간 · 3: 3시간 이상
 */
function getStudyLevel(minutes: number | undefined): number {
  if (minutes === undefined) return 0
  if (minutes < 60) return 1
  if (minutes < 180) return 2
  return 3
}

/** 단계별 칸 색. 배열 번호 = 단계입니다. */
const levelStyles = [
  'text-slate-400 hover:bg-slate-100',
  'bg-indigo-200 text-indigo-900 hover:bg-indigo-300',
  'bg-indigo-400 text-white hover:bg-indigo-500',
  'bg-brand text-white hover:bg-brand-dark',
]

/** 지나간 날인데 공부 기록이 없는 칸의 색 (연한 빨강) */
const missedStyle = 'bg-red-100 text-red-700 hover:bg-red-200'

/** 달력 아래 색 설명 */
const legendItems = [
  { label: '공부 안 한 날', color: 'bg-red-100' },
  { label: '1시간 미만', color: 'bg-indigo-200' },
  { label: '1~3시간', color: 'bg-indigo-400' },
  { label: '3시간 이상', color: 'bg-brand' },
]

interface StudyCalendarProps {
  days: DailyRecord[]
  subjects: Subject[]
}

/** 한 달 달력. 공부한 날을 색으로 칠하고, 날짜를 누르면 그날 기록을 아래에 보여줍니다. */
function StudyCalendar({ days, subjects }: StudyCalendarProps) {
  const todayKey = getTodayKey()

  // 고른 날짜와 보고 있는 달은 주소에 둡니다. (/records?date=2026-10-01 , /records?month=2026-09)
  // 새로고침해도 보던 날이 그대로이고, 주소를 보내면 같은 날의 기록이 열립니다.
  // replace: 날짜를 여러 번 눌러도 뒤로 가기 한 번이면 기록 화면을 떠납니다.
  const [dateParam, setDateParam] = useQueryParam('date', todayKey, { replace: true })
  // 주소는 누구나 고칠 수 있어서, 진짜 날짜가 아니면 오늘로 봅니다.
  const pickedDate = isDateKey(dateParam) ? dateParam : todayKey

  // 보고 있는 달 'YYYY-MM'. 주소에 없으면 고른 날짜가 들어 있는 달입니다. ('2026-10-01' 의 앞 7글자 = '2026-10')
  const [monthParam, setMonthParam] = useQueryParam('month', pickedDate.slice(0, 7), {
    replace: true,
  })
  const monthKey = isMonthKey(monthParam) ? monthParam : pickedDate.slice(0, 7)
  // month 는 0(1월) ~ 11(12월) 입니다. (Date 의 규칙과 같습니다)
  const view = { year: Number(monthKey.slice(0, 4)), month: Number(monthKey.slice(5, 7)) - 1 }

  // 고른 날짜가 지금 보고 있는 달에 있을 때만 "고른 날" 로 보여줍니다. 다른 달로 넘기면 아무 날도 고르지 않은 모양이 됩니다.
  const selectedDate = pickedDate.startsWith(monthKey) ? pickedDate : null

  // 날짜로 그날 기록을 바로 찾을 수 있게 Map 으로 바꿔 둡니다.
  const recordByDate = new Map(days.map((day) => [day.date, day]))

  // 처음 공부한 날. days 는 최근 날짜가 맨 앞이라 맨 뒤가 가장 오래된 날입니다. 기록이 없으면 undefined.
  const firstStudyDate = days.at(-1)?.date

  // 그 달 1일의 요일(0=일요일) 만큼 앞을 빈칸으로 채웁니다.
  const firstWeekday = new Date(view.year, view.month, 1).getDay()
  // 다음 달의 0일 = 이번 달의 마지막 날입니다.
  const lastDay = new Date(view.year, view.month + 1, 0).getDate()

  // 빈칸은 null, 날짜는 'YYYY-MM-DD' 로 칸 목록을 만듭니다.
  const cells: (string | null)[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let day = 1; day <= lastDay; day++) {
    cells.push(toDateKey(new Date(view.year, view.month, day)))
  }

  /** step 이 -1 이면 이전 달, 1 이면 다음 달로 갑니다. */
  function handleMoveMonth(step: number) {
    // new Date 가 13월·0월 같은 값을 알아서 다음 해·이전 해로 넘겨줍니다.
    const next = new Date(view.year, view.month + step, 1)
    // 'YYYY-MM' 모양으로 주소에 적습니다. 고른 날짜는 그대로 두지만, 다른 달이라 화면에서는 고르지 않은 모양이 됩니다.
    setMonthParam(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`)
  }

  function handleSelectDate(date: string) {
    setDateParam(date)
  }

  const selectedRecord = selectedDate ? recordByDate.get(selectedDate) : undefined

  return (
    // p-3: 375px 화면에서 달력 칸(7칸)이 40px 보다 작아지지 않게 모바일에서는 안쪽 여백을 줄입니다.
    <Card className="p-3 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900">
          {view.year}년 {view.month + 1}월
        </h3>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="이전 달"
            onClick={() => handleMoveMonth(-1)}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
          >
            ◀
          </button>
          <button
            type="button"
            aria-label="다음 달"
            onClick={() => handleMoveMonth(1)}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
          >
            ▶
          </button>
        </div>
      </div>

      {/* 요일 줄 */}
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {weekdayNames.map((name) => (
          <span key={name} className="py-1 text-center text-xs text-slate-500">
            {name}
          </span>
        ))}
      </div>

      {/* 날짜 칸. aspect-square 로 칸 폭만큼 높이를 맞춰서, 화면이 좁아지면 칸도 같이 작아집니다. */}
      <div className="mt-1 grid grid-cols-7 gap-1 sm:gap-2">
        {cells.map((date, index) => {
          if (date === null) return <span key={`blank-${index}`} aria-hidden />

          const record = recordByDate.get(date)
          const level = getStudyLevel(record?.totalMinutes)
          const day = Number(date.slice(8))
          // 처음 공부한 날 이후 ~ 어제 사이에 기록이 없으면 "공부 안 한 날" 입니다.
          // 첫 기록 전(앱을 쓰기 전), 오늘(아직 공부할 수 있음), 미래는 빨갛게 칠하지 않습니다.
          // ('YYYY-MM-DD' 는 글자로 비교해도 날짜 순서와 같습니다)
          const isMissed =
            !record && firstStudyDate !== undefined && date > firstStudyDate && date < todayKey

          let label = `${view.month + 1}월 ${day}일, 기록 없음`
          if (record) {
            label = `${view.month + 1}월 ${day}일, ${formatMinutes(record.totalMinutes)} 공부`
          } else if (isMissed) {
            label = `${view.month + 1}월 ${day}일, 공부 안 함`
          }

          return (
            <button
              key={date}
              type="button"
              aria-label={label}
              aria-pressed={selectedDate === date}
              onClick={() => handleSelectDate(date)}
              className={cn(
                'flex aspect-square w-full cursor-pointer items-center justify-center rounded-lg text-sm font-semibold transition-colors',
                isMissed ? missedStyle : levelStyles[level],
                // 오늘은 진한 테두리로 표시합니다.
                date === todayKey && 'border-2 border-slate-900',
                // 누른 날짜는 바깥쪽 고리로 표시합니다.
                selectedDate === date && 'ring-brand ring-2 ring-offset-2',
              )}
            >
              {day}
            </button>
          )
        })}
      </div>

      {/* 색 설명 */}
      <ul className="mt-4 flex flex-wrap gap-x-3 gap-y-1">
        {legendItems.map((item) => (
          <li key={item.label} className="flex items-center gap-1 text-xs text-slate-500">
            <span aria-hidden className={cn('h-3 w-3 rounded-sm', item.color)} />
            {item.label}
          </li>
        ))}
      </ul>

      {/* 누른 날짜의 기록. aria-live: 화면 낭독기가 바뀐 내용을 읽어줍니다. */}
      <div aria-live="polite">
        {selectedDate && (
          <div className="mt-4 rounded-lg bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-slate-900">
                {formatDateLabel(selectedDate)}
              </span>
              {selectedRecord && (
                <span className="shrink-0 text-sm font-bold text-slate-900">
                  {formatMinutes(selectedRecord.totalMinutes)}
                </span>
              )}
            </div>

            {selectedRecord ? (
              <ul className="mt-2 flex flex-col gap-2">
                {selectedRecord.subjects.map((record) => (
                  <li key={record.subjectId} className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <SubjectTag subject={subjects.find((item) => item.id === record.subjectId)} />
                    </span>
                    <span className="shrink-0 text-sm text-slate-600">
                      {formatMinutes(record.minutes)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-500">이날은 공부 기록이 없어요.</p>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
