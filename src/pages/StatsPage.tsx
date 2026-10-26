import { useQueryParam } from '@/hooks/useQueryParam'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { AiAnalysisCard, AnalysisInsight } from '@/components/ui/AiAnalysisCard'
import { AnswerCheckCard } from '@/components/ui/AnswerCheckCard'
import { Card } from '@/components/ui/Card'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Skeleton } from '@/components/ui/Skeleton'
import { SubjectBadge } from '@/components/ui/SubjectBadge'
import { TalkButton } from '@/components/ui/TalkButton'
import { useCards } from '@/hooks/useCards'
import { useIsServerData } from '@/hooks/useIsServerData'
import { useServerMergedSessions } from '@/hooks/useServerMergedSessions'
import {
  buildCalendarDay,
  DAY_STATUS_INFO,
  DAY_STATUSES,
  getRecentDateKeys,
  groupSessionsByDayKey,
  summarizeRunRate,
  type CalendarDay,
  type DayStatus,
  type RunRateSummary,
} from '@/lib/calendarDay'
import { loadCheckInsByDate } from '@/lib/callSummary'
import { loadCardMarks } from '@/lib/cardMarks'
import { CARD_RESULT_LABELS } from '@/lib/cardResult'
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
import { getTodayKey, isDateKey, isMonthKey, toDayDate, toDayKey } from '@/lib/date'
import { loadFocusScores, summarizeFocusWeek } from '@/lib/focusScore'
import {
  buildMonthlyTrend,
  formatMonthLabel,
  monthlyStudyQuery,
  summarizeTrend,
  type MonthlyStudy,
} from '@/lib/monthlyTrend'
import { useSubjects } from '@/hooks/useSubjects'
import { mockSubjects } from '@/lib/mock'
import { EMOTION_OPTIONS, isEmotionTag } from '@/lib/quickCheckIn'
import { getCardDayMarkInfo, loadRestDays } from '@/lib/restDays'
import { loadRoutines } from '@/lib/routines'
import { buildCardIdByPlanId, fillSessionSubjects } from '@/lib/sessionRecords'
import { loadData, loadRecord } from '@/lib/storage'
import { dayReviewLines } from '@/lib/talkLines'
import { formatHoursMinutes, getWeeklyStudy } from '@/lib/weeklyStudy'
import { getMondayKey } from '@/lib/weeklyFacts'
import { describeScoreChange, weeklyScoreGuides, weeklyScoreQuery } from '@/lib/weeklyScoreApi'
import type { CheckIn, EmotionTag, StudyPlan, StudySession, Subject } from '@/types'

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
  /** 기록에 적힌 과목 id. 빈 글자('')면 처음부터 과목 없이 한 공부입니다 (과목을 안 고른 카드 · 카드 없이 시작) */
  subjectId: string
}

/**
 * 기록의 과목을 찾습니다. 내 과목에 없으면 예시 과목(국어 · 수학 …, lib/mock.ts)에서 한 번 더 찾습니다.
 * 시연용 가상 기록(lib/demoPersona.ts)은 예시 과목 id('math' 등)로 저장되는데,
 * 진짜 로그인(시연 코드 로그인 포함)의 과목 id 는 서버 번호라서 그대로는 못 찾기 때문입니다.
 */
function findSubject(subjects: Subject[], subjectId: string): Subject | undefined {
  return (
    subjects.find((item) => item.id === subjectId) ??
    mockSubjects.find((item) => item.id === subjectId)
  )
}

/**
 * 과목 태그.
 *   - 과목 없이 한 공부(subjectId '')면 "과목 없음"
 *   - 과목 id 는 있는데 찾을 수 없으면(과목을 지움) "삭제된 과목"
 * 둘을 한데 "삭제된 과목" 으로 보여 줘서, 과목을 지운 적이 없는데도 떴습니다. (#746)
 */
function SubjectTag({ subject, subjectId }: SubjectTagProps) {
  if (!subject) {
    return (
      <span className="inline-block max-w-full truncate rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
        {subjectId === '' ? '과목 없음' : '삭제된 과목'}
      </span>
    )
  }
  return <SubjectBadge name={subject.name} color={subject.color} />
}

/**
 * 통계 탭 화면(/stats)입니다. (2026-10-24)
 * 2026-10-24 까지 기록 탭(/records)이던 화면을 그대로 옮겼습니다. 기록 탭은 일간 · 주간 리포트(History)가 됩니다.
 *
 * 진짜 로그인이면 서버의 공부 기록(최근 6개월)도 받아서 이 기기 기록과 합쳐 봅니다. (기록 탭과 같은 방법, #659)
 * 그래서 새 기기 · 새로 로그인한 계정도 4주 실행률 · 7일 공부 시간 · 달력 · 날짜별 기록이 비어 보이지 않습니다.
 * 7일 집중도는 서버에 저장하지 않는 값이라 이 기기 기록만 씁니다. (lib/focusScore.ts)
 */
export function StatsPage() {
  // 이 기기의 공부 기록은 화면을 처음 그릴 때 한 번만 읽습니다.
  const [localSessions] = useState<StudySession[]>(loadSessions)
  const isServerData = useIsServerData()

  // 테스트 로그인은 서버가 없어서 이 기기 기록만 봅니다.
  if (!isServerData) return <StatsView sessions={localSessions} />

  // 받는 동안에는 이 기기 기록으로 먼저 그리고, 못 받으면 안내와 함께 이 기기 기록만 보여 줍니다.
  return (
    <AsyncBoundary
      pendingFallback={<StatsView sessions={localSessions} />}
      errorMessage="서버의 공부 기록을 받아오지 못했어요. 이 기기에 있는 기록만 보여 드려요."
      errorExtra={<StatsView sessions={localSessions} />}
    >
      <ServerStats localSessions={localSessions} />
    </AsyncBoundary>
  )
}

/** 서버의 공부 기록을 받아 이 기기 기록과 합친 뒤 그립니다. (hooks/useServerMergedSessions.ts) */
function ServerStats({ localSessions }: { localSessions: StudySession[] }) {
  const sessions = useServerMergedSessions(localSessions)
  return <StatsView sessions={sessions} />
}

interface StatsViewProps {
  /** 통계에 쓸 공부 기록 (노는 기록 뺀 것). 진짜 로그인이면 서버 기록까지 합친 것입니다 */
  sessions: StudySession[]
}

/** 통계 탭 화면 본체. 공부 기록만 밖에서 받고, 나머지(카드 · 체크인 · 휴식 …)는 여기서 읽습니다. */
function StatsView({ sessions }: StatsViewProps) {
  // 과목은 계획 화면에서 저장한 목록을 씁니다.
  const subjects = useSubjects()

  // 달력의 그날 감정 표시에 체크인을 씁니다.
  const [checkIns] = useState(loadCheckInsByDate)

  // 달력과 4주 실행률은 카드 결과(실행 · 지연 · 미실행 · 휴식)로 정합니다. (#410, lib/calendarDay.ts)
  const { cards } = useCards()

  // 최근 날짜가 맨 앞에 오도록 날짜별로 묶습니다.
  // 과목 없이 저장된 기록은 그 카드의 과목 → 카드 제목에 든 과목 이름으로 채워서 보여 줍니다. (#746)
  const days = groupSessionsByDate(fillSessionSubjects(sessions, cards, subjects))
  // 지금 시각은 화면을 처음 그릴 때 한 번만 읽습니다. (다시 그릴 때마다 바뀌면 결과가 흔들립니다)
  const [now] = useState(Date.now)
  // 옛 계획으로 잰 기록도 그 카드의 기록으로 보려고 "옛 계획 id → 카드 id" 표를 만듭니다. (lib/sessionRecords.ts)
  const [cardIdByPlanId] = useState(() =>
    buildCardIdByPlanId(loadRecord<StudyPlan[]>('plans'), loadRoutines()),
  )
  const sessionsByDay = groupSessionsByDayKey(sessions)
  // 쉬는 날 · 미루기 · 실패로 처리한 표시. 기록 탭(RecordsPage)과 같은 것을 읽어야 두 화면의 숫자가 같습니다.
  const [restDays] = useState(loadRestDays)
  const [marks] = useState(loadCardMarks)

  /** 그 날짜의 달력 하루 (카드마다 결과를 판정하고 칸의 상태를 정함) */
  function getCalendarDay(dateKey: string): CalendarDay {
    return buildCalendarDay({
      dateKey,
      cards,
      sessions: sessionsByDay.get(dateKey) ?? [],
      cardIdByPlanId,
      now,
      // 쉬는 날로 정한 날의 카드는 '휴식' 이 되어 실행률에서 빠집니다. (lib/historyReport.ts 와 같은 방식)
      getMark: (cardId, markDate) => {
        const info = getCardDayMarkInfo(cardId, markDate, restDays, marks)
        return info ? { mark: info.mark } : undefined
      },
    })
  }

  // 최근 4주(오늘 포함 28일)의 실행률. 연속 기록(스트릭) 카드 대신 보여줍니다.
  const recentRunRate = summarizeRunRate(getRecentDateKeys(toDayKey(now)).map(getCalendarDay))

  // 지금 펼쳐 둔 날짜. null 이면 전부 접혀 있습니다. 같은 날짜를 다시 누르면 접힙니다.
  const [openDate, setOpenDate] = useState<string | null>(null)

  function handleToggle(date: string) {
    setOpenDate((current) => (current === date ? null : date))
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[28px] leading-tight font-bold tracking-tight">통계</h1>

      {/* 오늘 푼 문제 사진 채점: [사진 올리기] → (PC) QR 창 → 폰으로 찍어 올리면 아래에 결과 카드 (2026-10-24) */}
      <AnswerCheckCard />

      {/* 이번 주 점수 (BE #412 · #660): 정답률과 공부 달성률의 평균. 서버가 계산하고 본인만 봅니다.
          못 받으면(테스트 로그인 · 서버 배포 전 · 연결 끊김) 카드를 그리지 않습니다. */}
      <AsyncBoundary pendingFallback={<Skeleton className="h-40 w-full rounded-2xl" />}>
        <WeeklyScoreCard weekStart={getMondayKey(new Date(now))} />
      </AsyncBoundary>

      {/* 묶음 순서: 매일 보는 숫자(실행률 · 7일 공부 시간) → AI 분석 (가장 자주 보는 것을 위로)
          내 숲 · 지난 통화 요약은 2026-10-24 에 뺐습니다. (lib/forest*.ts · lib/callSummary.ts 는 다른 곳이 써서 남김) */}
      {/* 최근 4주 실행률 · 최근 7일 막대그래프 · 7일 집중도. 모바일은 한 줄에 하나, PC 는 두 칸으로 카드를 놓습니다. */}
      {/* items-start: 높이가 다른 카드를 억지로 같은 높이로 늘리지 않습니다. (시안처럼) */}
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
        <RunRateCard summary={recentRunRate} />
        <WeeklyBarCard sessions={sessions} />
        <FocusWeekCard now={now} />
      </div>

      {/* 전체 기간 추세: 첫 기록의 달부터 이번 달까지 달마다 순공시간 (STARFLOW H4). 위 카드들은 최근 28일 · 7일만 봅니다. */}
      <AllTimeTrendSection sessions={sessions} now={now} />

      {/* AI 분석: 최근 28일 기록을 숫자로 묶고(코드), 서버의 AI 가 말로 풀어 줍니다. (#419) */}
      <AiAnalysisCard />

      {/* 발견 1개와 반응 버튼 [몰랐는데 맞아 · 이미 알던 거야 · 틀렸어]. 리포트 탭에 있던 것을 2026-10-23 에 옮겼습니다.
          "몰랐는데 맞아" 는 기획서 「4.6」 의 핵심 경험 지표라서, 리포트를 빼도 이 카드는 남깁니다. */}
      <section>
        <h2 className="text-[17px] font-semibold tracking-tight text-slate-900">이번 발견</h2>
        <AnalysisInsight sessions={sessions} className="mt-3" />
      </section>

      {/* 시안처럼 PC(lg)에서는 두 칸으로 나눕니다. 다른 기록 카드가 생기면 이 안에 이어서 넣으면 됩니다. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <StudyCalendar getDay={getCalendarDay} records={days} checkIns={checkIns} />

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
                        <span className="text-[15px] font-semibold text-slate-900">
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
                                subject={findSubject(subjects, record.subjectId)}
                                subjectId={record.subjectId}
                              />
                              <span className="shrink-0 text-xs text-slate-500 tabular-nums">
                                {formatMinutes(record.minutes)}
                              </span>
                            </span>
                          ))}
                        </span>
                      </span>

                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-[17px] font-bold text-slate-900 tabular-nums">
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
                        className="mb-3 flex flex-col gap-3 rounded-xl bg-slate-50 p-3"
                      >
                        {day.subjects.map((record) => (
                          <div key={record.subjectId}>
                            <div className="flex items-center justify-between gap-3">
                              <SubjectTag
                                subject={findSubject(subjects, record.subjectId)}
                                subjectId={record.subjectId}
                              />
                              <span className="shrink-0 text-sm font-semibold text-slate-900 tabular-nums">
                                {formatMinutes(record.minutes)}
                              </span>
                            </div>
                            <ul className="mt-2 flex flex-col gap-1">
                              {record.sessions.map((session) => (
                                <li
                                  // id 에 시작 시각을 붙입니다. 저장된 기록의 id 가 겹쳐도 화면이 경고 없이 둘 다 보여줍니다.
                                  key={`${session.id}-${session.startedAt}`}
                                  className="flex items-center justify-between gap-3 text-sm text-slate-600 tabular-nums"
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
    </div>
  )
}

/**
 * 상태별 색. 네 상태를 모두 같은 진하기(100)로 칠해서, 잘 된 날이 더 크게 보이지 않게 합니다.
 * 색만으로 구분하지 않도록 모양(○ △ ✕ −)과 글자를 꼭 같이 씁니다. (lib/calendarDay.ts 의 DAY_STATUS_INFO)
 */
const statusColors: Record<DayStatus, string> = {
  done: 'bg-emerald-100 text-emerald-800',
  late: 'bg-amber-100 text-amber-800',
  missed: 'bg-rose-100 text-rose-800',
  rest: 'bg-sky-100 text-sky-800',
}

interface StatusBadgeProps {
  status: DayStatus
  /** 상태 이름 대신 보일 글자 (예: '늦게 시작했어요'). 없으면 상태 이름 */
  text?: string
}

/** 상태 배지: 색 + 모양 + 글자 */
function StatusBadge({ status, text }: StatusBadgeProps) {
  const info = DAY_STATUS_INFO[status]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
        statusColors[status],
      )}
    >
      <span aria-hidden>{info.symbol}</span>
      {text ?? info.label}
    </span>
  )
}

interface RunRateCardProps {
  summary: RunRateSummary
}

/**
 * 최근 4주 실행률 카드. 연속 기록(스트릭) 카드를 대신합니다. (#410)
 * 스트릭은 성공한 날만 기억하게 만들어서, 잘 된 날과 안 된 날을 같은 크기로 같이 보여줍니다.
 */
function RunRateCard({ summary }: RunRateCardProps) {
  const percent = summary.rate === null ? null : Math.round(summary.rate * 100)

  return (
    <Card>
      {/* flex-wrap: 375px 에서 카드 수가 길어지면 제목 아래 줄로 내려갑니다. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[17px] font-bold tracking-tight text-slate-900">최근 4주 실행률</h3>
        {summary.cardCount > 0 && (
          <p className="text-sm text-slate-500 tabular-nums">카드 {summary.cardCount}장</p>
        )}
      </div>

      {percent === null ? (
        <p className="mt-3 text-sm break-keep text-slate-500">
          아직 결과가 나온 카드가 없어요. 카드를 하면 계획한 시간 중 실제로 한 비율이 여기에 보여요.
        </p>
      ) : (
        <>
          {/* 숫자는 크게, 단위·설명은 작게 해서 숫자가 먼저 읽히게 합니다. */}
          <p className="mt-2 text-4xl font-bold tracking-tight text-slate-900 tabular-nums">
            {percent}
            <span className="ml-0.5 text-xl font-semibold text-slate-500">%</span>
          </p>
          <ProgressBar value={percent} className="mt-2" />
          <p className="mt-2 text-sm break-keep text-slate-500">
            계획한 시간 중 실제로 한 비율이에요. 휴식한 날은 빼고 셉니다.
          </p>
        </>
      )}

      {/* 상태별 날 수. 작은 카드 네 장 대신 한 묶음 안을 세로 선(divide-x)으로 나눕니다. (근접성)
          grid-cols-4: 375px 에서도 한 줄. 색만으로 구분하지 않게 모양(○ △ ✕ −)과 글자를 같이 씁니다. */}
      <ul className="mt-4 grid grid-cols-4 divide-x divide-slate-200 rounded-xl bg-slate-50 py-3">
        {DAY_STATUSES.map((status) => (
          <li key={status} className="flex min-w-0 flex-col items-center gap-1 px-1">
            <span className="text-xl font-bold text-slate-900 tabular-nums">
              {summary.dayCounts[status]}
              <span className="ml-0.5 text-xs font-medium text-slate-500">일</span>
            </span>
            <span className="flex items-center gap-1 text-xs font-medium text-slate-600">
              <span
                aria-hidden
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] leading-none',
                  statusColors[status],
                )}
              >
                {DAY_STATUS_INFO[status].symbol}
              </span>
              {DAY_STATUS_INFO[status].label}
            </span>
          </li>
        ))}
      </ul>
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
        <h3 className="text-[17px] font-bold tracking-tight text-slate-900">최근 7일 공부 시간</h3>
        <p className="text-sm text-slate-500">
          합계{' '}
          <span className="text-[17px] font-bold text-slate-900 tabular-nums">
            {totalMinutes === 0 ? '0분' : formatMinutes(totalMinutes)}
          </span>
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
                  // 평소 막대는 연하게, 오늘 막대만 진한 brand 로 눈에 띄게 합니다. (폰 레스토프 효과)
                  day.isToday ? 'bg-brand' : 'bg-indigo-200',
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
          : '진한 막대가 오늘이에요. 오늘은 아직 진행 중이라 더 늘 수 있어요.'}
      </p>
    </Card>
  )
}

interface StudyCalendarProps {
  /** 그 날짜의 달력 하루 (카드 결과로 정한 상태) */
  getDay: (dateKey: string) => CalendarDay
  /** 날짜별 공부 기록. 그날 순공 시간을 보여줄 때 씁니다 */
  records: DailyRecord[]
  /** 날짜별 체크인. 그날 고른 감정 태그를 보여줄 때 씁니다 (#387) */
  checkIns: Record<string, CheckIn>
}

/**
 * 한 달 달력. 날마다 실행 · 지연 · 미실행 · 휴식을 같은 크기의 칸으로 칠하고,
 * 날짜를 누르면 그날 카드 결과와 사유, 감정 태그를 아래에 보여줍니다. (#410)
 */
function StudyCalendar({ getDay, records, checkIns }: StudyCalendarProps) {
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

  // 날짜로 그날 공부 기록을 바로 찾을 수 있게 Map 으로 바꿔 둡니다.
  const recordByDate = new Map(records.map((record) => [record.date, record]))

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

  // 고른 날의 감정 태그. 저장된 값이 깨져 있어도 멈추지 않게 아는 태그만 남깁니다.
  const selectedEmotions = selectedDate
    ? (checkIns[selectedDate]?.emotions ?? []).filter(isEmotionTag)
    : []

  return (
    // p-3: 375px 화면에서 달력 칸(7칸)이 40px 보다 작아지지 않게 모바일에서는 안쪽 여백을 줄입니다.
    <Card className="p-3 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[17px] font-bold tracking-tight text-slate-900">
          {view.year}년 {view.month + 1}월
        </h3>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="이전 달"
            onClick={() => handleMoveMonth(-1)}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-xl text-slate-600 hover:bg-slate-100"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="다음 달"
            onClick={() => handleMoveMonth(1)}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-xl text-slate-600 hover:bg-slate-100"
          >
            ›
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

      {/* 날짜 칸. aspect-square 로 칸 폭만큼 높이를 맞춰서, 화면이 좁아지면 칸도 같이 작아집니다. 네 상태 모두 같은 크기입니다. */}
      <div className="mt-1 grid grid-cols-7 gap-1 sm:gap-2">
        {cells.map((date, index) => {
          if (date === null) return <span key={`blank-${index}`} aria-hidden />

          const status = getDay(date).status
          const day = Number(date.slice(8))
          const label = `${view.month + 1}월 ${day}일, ${status ? DAY_STATUS_INFO[status].label : '카드 결과 없음'}`

          return (
            <button
              key={date}
              type="button"
              aria-label={label}
              aria-pressed={selectedDate === date}
              onClick={() => handleSelectDate(date)}
              className={cn(
                'flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg text-sm font-semibold tabular-nums transition-colors',
                status
                  ? cn(statusColors[status], 'hover:opacity-80')
                  : 'text-slate-500 hover:bg-slate-100',
                // 오늘은 진한 테두리로 표시합니다.
                date === todayKey && 'border-2 border-slate-900',
                // 누른 날짜는 바깥쪽 고리로 표시합니다.
                selectedDate === date && 'ring-brand ring-2 ring-offset-2',
              )}
            >
              <span>{day}</span>
              {/* 둘째 줄: 모바일은 모양(○ △ ✕ −), 넓은 화면은 글자. 상태가 없는 날도 자리를 비워 둬서 숫자 위치가 같습니다. */}
              <span aria-hidden className="h-3 text-xs leading-none font-medium">
                {status && (
                  <>
                    <span className="sm:hidden">{DAY_STATUS_INFO[status].symbol}</span>
                    <span className="hidden sm:inline">{DAY_STATUS_INFO[status].label}</span>
                  </>
                )}
              </span>
            </button>
          )
        })}
      </div>

      {/* 색 · 모양 설명 */}
      <ul className="mt-4 flex flex-wrap gap-x-3 gap-y-1">
        {DAY_STATUSES.map((status) => (
          <li key={status} className="flex items-center gap-1 text-xs text-slate-600">
            <span
              aria-hidden
              className={cn(
                'flex h-4 w-4 items-center justify-center rounded-sm leading-none',
                statusColors[status],
              )}
            >
              {DAY_STATUS_INFO[status].symbol}
            </span>
            {DAY_STATUS_INFO[status].label}
          </li>
        ))}
      </ul>

      {/* 누른 날짜의 카드 결과. aria-live: 화면 낭독기가 바뀐 내용을 읽어줍니다. */}
      <div aria-live="polite">
        {selectedDate && (
          <CalendarDayDetail
            day={getDay(selectedDate)}
            studyMinutes={recordByDate.get(selectedDate)?.totalMinutes}
            emotions={selectedEmotions}
          />
        )}
      </div>
    </Card>
  )
}

interface CalendarDayDetailProps {
  day: CalendarDay
  /** 그날 순공 시간(분). 공부 기록이 없으면 undefined */
  studyMinutes: number | undefined
  /** 그날 고른 감정 태그 */
  emotions: EmotionTag[]
}

/** 달력에서 누른 날: 상태 · 감정 태그 · 순공 · 카드마다 결과와 사유 */
function CalendarDayDetail({ day, studyMinutes, emotions }: CalendarDayDetailProps) {
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-xl bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-900">{formatDateLabel(day.dateKey)}</span>
        {day.status && <StatusBadge status={day.status} />}
      </div>

      {/* 체크인에서 고른 감정 태그 (#387). 안 골랐으면 줄을 비웁니다. */}
      {emotions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-500">감정</span>
          {emotions.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200"
            >
              {EMOTION_OPTIONS.find((option) => option.tag === tag)?.label}
            </span>
          ))}
        </div>
      )}

      {studyMinutes !== undefined && (
        <p className="text-xs text-slate-500">
          이날 순공{' '}
          <span className="text-[15px] font-bold text-slate-900 tabular-nums">
            {formatMinutes(studyMinutes)}
          </span>
        </p>
      )}

      {day.cards.length === 0 ? (
        <p className="text-sm break-keep text-slate-500">
          {day.pendingCount > 0
            ? '카드 시간이 끝나면 결과가 보여요.'
            : '이날은 결과를 볼 카드가 없어요.'}
        </p>
      ) : (
        // 카드 결과를 작은 상자 여러 개 대신 흰 묶음 하나 안에서 선(divide-y)으로 나눕니다. (근접성)
        <ul className="flex flex-col divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-slate-200">
          {day.cards.map((item) => (
            <li key={item.card.id} className="p-3">
              {/* 카드 이름과 결과. 좁은 화면에서는 결과가 아래 줄로 내려갑니다. */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 text-sm font-semibold break-words text-slate-900">
                  {item.card.title}
                </span>
                <StatusBadge status={item.status} text={CARD_RESULT_LABELS[item.result]} />
              </div>
              {/* 휴식한 카드는 집계에서 빠지므로 실행률을 보여주지 않습니다. */}
              {item.status !== 'rest' && (
                <p className="mt-1 text-xs text-slate-500 tabular-nums">
                  {item.card.startTime ?? '시간 미정'} · {formatMinutes(item.card.durationMinutes)}{' '}
                  · 실행률 {Math.round(item.runRate * 100)}% · 체크리스트 {item.checkedCount}/
                  {item.card.checklist.length}
                </p>
              )}
              {item.reasons.length > 0 && (
                <p className="mt-1 text-sm break-keep text-slate-700">{item.reasons.join(' · ')}</p>
              )}
            </li>
          ))}
          {day.pendingCount > 0 && (
            <li className="p-3 text-xs text-slate-500">
              아직 결과가 나오지 않은 카드 {day.pendingCount}장
            </li>
          )}
        </ul>
      )}

      {/* 이 날 숫자를 들고 상담 방에서 무엇이 잘 됐고 아쉬웠는지 이야기합니다. (#582) 기록이 있는 날만 */}
      {(day.cards.length > 0 || studyMinutes !== undefined) && (
        <TalkButton
          about={{ kind: 'DAY_REVIEW', lines: dayReviewLines(day, studyMinutes) }}
          label={`💬 ${formatDateLabel(day.dateKey)} 이야기할래`}
          className="self-start"
        />
      )}
    </div>
  )
}

interface FocusWeekCardProps {
  now: number
}

/**
 * 최근 7일 집중도 카드 — 평균 한 줄과 시간대(오전 · 오후 · 저녁 · 밤)별 집중도. (lib/focusScore.ts)
 * 집중도 = 공부한 시간 중 폰을 들거나 다른 탭에 가 있지 않은 비율. 묻지 않고 타이머가 잰 숫자만 씁니다.
 */
function FocusWeekCard({ now }: FocusWeekCardProps) {
  const [records] = useState(loadFocusScores)
  const summary = summarizeFocusWeek(records, now)

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[17px] font-bold tracking-tight text-slate-900">최근 7일 집중도</h3>
        {summary.average !== null && (
          <p className="text-3xl font-bold tracking-tight text-slate-900 tabular-nums">
            {summary.average}
            <span className="ml-0.5 text-lg font-semibold text-slate-500">%</span>
          </p>
        )}
      </div>
      {summary.average === null ? (
        <p className="mt-2 text-sm break-keep text-slate-500">
          타이머로 1분 넘게 공부하면, 폰을 들거나 다른 탭에 간 시간을 빼고 집중도를 보여 줘요.
        </p>
      ) : (
        // 시간대별 집중도. 한 묶음 안을 세로 선으로 나눕니다. (근접성) grid-cols-4: 375px 에서도 한 줄
        <ul className="mt-3 grid grid-cols-4 divide-x divide-slate-200 rounded-xl bg-slate-50 py-3">
          {summary.bands.map((band) => (
            <li key={band.key} className="flex min-w-0 flex-col items-center gap-1 px-1">
              <span className="text-lg font-bold text-slate-900 tabular-nums">
                {band.average === null ? '–' : `${band.average}%`}
              </span>
              <span className="text-xs font-medium text-slate-500">{band.label}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

interface WeeklyScoreCardProps {
  /** 이번 주 월요일 'YYYY-MM-DD' (하루는 새벽 4시 기준, lib/weeklyFacts.ts) */
  weekStart: string
}

/**
 * 이번 주 점수 카드 (#660). 숫자는 서버(BE #412)가 준 그대로 보여 주고 다시 계산하지 않습니다.
 * 점수가 없으면 0 을 그리지 않고 무엇이 더 필요한지 안내합니다. 순위 · 남과의 비교는 보여 주지 않습니다.
 */
function WeeklyScoreCard({ weekStart }: WeeklyScoreCardProps) {
  const { data: score } = useSuspenseQuery(weeklyScoreQuery(weekStart))
  if (score === null) return null

  const guides = weeklyScoreGuides(score)
  const change = describeScoreChange(score)
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* 옆에 "진행 중" 표시를 두려고 Card 의 title 대신 같은 모양의 제목을 직접 씁니다. */}
        <h3 className="text-[17px] font-bold tracking-tight text-slate-900">이번 주 점수</h3>
        {score.inProgress && (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
            진행 중 · 오늘까지
          </span>
        )}
      </div>

      {score.score !== null && (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-4xl font-bold text-slate-900 tabular-nums">
            {score.score}
            <span className="ml-0.5 text-base font-medium text-slate-500">점</span>
          </p>
          {change !== '' && <p className="text-sm text-slate-600">{change}</p>}
        </div>
      )}

      {guides.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 rounded-xl bg-slate-50 p-3 text-sm break-keep text-slate-700">
          {guides.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {/* 점수가 어떻게 나왔는지: 두 값. 모르는 값은 '—' (0 으로 쓰지 않기) */}
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-slate-50 p-3">
          <dt className="text-xs text-slate-500">정답률</dt>
          <dd className="mt-0.5 font-semibold text-slate-900 tabular-nums">
            {score.accuracy === null ? '—' : `${score.accuracy}%`}
          </dd>
          <dd className="text-xs text-slate-500 tabular-nums">
            {score.totalCount}문제 중 {score.correctCount}개
          </dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <dt className="text-xs text-slate-500">공부 달성률</dt>
          <dd className="mt-0.5 font-semibold text-slate-900 tabular-nums">
            {score.planRate === null ? '—' : `${score.planRate}%`}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs break-keep text-slate-500">
        점수는 정답률과 공부 달성률의 평균이에요. 나만 볼 수 있어요.
      </p>
    </Card>
  )
}

interface AllTimeTrendSectionProps {
  /** 화면이 가진 공부 기록. 서버 값을 못 받을 때 이것으로 셉니다 */
  sessions: StudySession[]
  now: number
}

/**
 * 「전체 기간 추세」 묶음. 진짜 로그인은 서버가 내 기록 전체로 센 값을 받고(lib/monthlyTrend.ts),
 * 테스트 로그인은 이 기기 기록으로 셉니다.
 */
function AllTimeTrendSection({ sessions, now }: AllTimeTrendSectionProps) {
  const isServerData = useIsServerData()
  const todayKey = toDayKey(now)
  if (!isServerData) return <AllTimeTrendCard months={buildMonthlyTrend(sessions, todayKey)} />
  return (
    <AsyncBoundary pendingFallback={<Skeleton className="h-64 w-full rounded-2xl" />}>
      <ServerTrend sessions={sessions} todayKey={todayKey} />
    </AsyncBoundary>
  )
}

/** 서버의 달마다 합계를 받아 그립니다. 서버가 아직 이 주소를 모르면(배포 전) 화면이 가진 기록으로 셉니다. */
function ServerTrend({ sessions, todayKey }: { sessions: StudySession[]; todayKey: string }) {
  const { data: serverMonths } = useSuspenseQuery(monthlyStudyQuery())
  return <AllTimeTrendCard months={serverMonths ?? buildMonthlyTrend(sessions, todayKey)} />
}

interface AllTimeTrendCardProps {
  /** 첫 기록의 달부터 이번 달까지 (오래된 달부터) */
  months: MonthlyStudy[]
}

/** 달마다 순공시간 막대그래프. 차트 라이브러리 없이 div + Tailwind 로 만듭니다. (최근 7일 막대와 같은 방식) */
function AllTimeTrendCard({ months }: AllTimeTrendCardProps) {
  const summary = summarizeTrend(months)
  const maxMinutes = Math.max(0, ...months.map((month) => month.studyMinutes))
  // 달이 많아지면 막대 아래 글자가 겹쳐서, 6달 넘게 쌓이면 몇 달 건너 하나씩만 씁니다. (맨 끝 달은 늘 씀)
  const labelStep = Math.max(1, Math.ceil(months.length / 6))

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[17px] font-bold tracking-tight text-slate-900">전체 기간 추세</h3>
        {summary.monthCount > 0 && (
          <p className="text-sm text-slate-500 tabular-nums">{summary.monthCount}개월째</p>
        )}
      </div>

      {summary.totalMinutes === 0 ? (
        <p className="mt-3 text-sm break-keep text-slate-500">
          아직 공부 기록이 없어요. 타이머로 공부하면 처음 공부한 달부터 달마다 쌓여요.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-slate-600">
            지금까지{' '}
            <span className="text-[17px] font-bold text-slate-900 tabular-nums">
              {formatMinutes(summary.totalMinutes)}
            </span>{' '}
            · 공부한 날 <span className="font-semibold tabular-nums">{summary.totalDays}일</span>
          </p>

          {/* pt-6: 가장 높은 막대 위 시간 글자가 위 줄과 겹치지 않게 자리를 비워 둡니다. flex-1: 달이 늘어도 한 줄 안에서 같은 폭으로 나눕니다 (가로 스크롤 없음) */}
          <ul className="mt-4 flex gap-1 pt-6 sm:gap-2">
            {months.map((month, index) => {
              const percent = maxMinutes === 0 ? 0 : (month.studyMinutes / maxMinutes) * 100
              const isLast = index === months.length - 1
              const showLabel = isLast || (months.length - 1 - index) % labelStep === 0
              return (
                <li key={month.month} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                  <span className="sr-only">
                    {formatMonthLabel(month.month, true)}{' '}
                    {month.studyMinutes === 0
                      ? '공부 기록 없음'
                      : `${formatMinutes(month.studyMinutes)}, 공부한 날 ${month.studyDays}일`}
                  </span>
                  <div aria-hidden className="relative h-32 w-full max-w-10">
                    {/* style 을 쓰는 이유: 높이가 계산해서 나온 비율(%)이라 Tailwind 클래스로 미리 적어 둘 수 없습니다. (최근 7일 막대와 같은 예외) */}
                    <div
                      className={cn(
                        'absolute inset-x-0 bottom-0 rounded-t-md',
                        // 이번 달만 진한 brand 로, 나머지는 연하게 칠합니다.
                        isLast ? 'bg-brand' : 'bg-indigo-200',
                        month.studyMinutes > 0 && 'min-h-0.5',
                      )}
                      style={{ height: `${percent}%` }}
                    />
                  </div>
                  <span
                    aria-hidden
                    className={cn(
                      'text-xs whitespace-nowrap',
                      isLast ? 'text-brand font-bold' : 'text-slate-600',
                      !showLabel && 'invisible',
                    )}
                  >
                    {formatMonthLabel(month.month)}
                  </span>
                </li>
              )
            })}
          </ul>

          <p className="mt-4 text-sm break-keep text-slate-500">
            {summary.bestMonth &&
              `가장 많이 한 달은 ${formatMonthLabel(summary.bestMonth.month, true)}(${formatMinutes(summary.bestMonth.studyMinutes)})이에요. `}
            진한 막대가 이번 달이고, 공부를 안 한 달도 빼지 않고 보여 줘요.
          </p>
        </>
      )}
    </Card>
  )
}
