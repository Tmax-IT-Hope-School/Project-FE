import { useQueryParam } from '@/hooks/useQueryParam'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AiAnalysisCard, AnalysisInsight } from '@/components/ui/AiAnalysisCard'
import { AnswerCheckCard } from '@/components/ui/AnswerCheckCard'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { SubjectBadge } from '@/components/ui/SubjectBadge'
import { TalkButton } from '@/components/ui/TalkButton'
import { UnderstandingBadge } from '@/components/ui/UnderstandingBadge'
import { useCards } from '@/hooks/useCards'
import { loadManualItems } from '@/hooks/useManualItems'
import { usePlans } from '@/hooks/usePlans'
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
import {
  buildCallSummaries,
  loadCheckInsByDate,
  loadEvaluationsByDate,
  type CallSummary,
} from '@/lib/callSummary'
import { loadCallLog } from '@/lib/callLog'
import { CARD_RESULT_LABELS } from '@/lib/cardResult'
import { careThemes } from '@/lib/careTheme'
import { splitUnderstanding, type Understanding } from '@/lib/checkCall'
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
import { runDailyCareStage } from '@/lib/dailyCareRun'
import { getTodayKey, isDateKey, isMonthKey, toDayDate, toDayKey } from '@/lib/date'
import { loadFocusScores, summarizeFocusWeek } from '@/lib/focusScore'
import type { ForestState, ForestTree } from '@/lib/forest'
import { loadForestState } from '@/lib/forestData'
import { useSubjects } from '@/hooks/useSubjects'
import { mockSubjects } from '@/lib/mock'
import { EMOTION_OPTIONS, isEmotionTag } from '@/lib/quickCheckIn'
import { loadRoutines } from '@/lib/routines'
import { buildCardIdByPlanId } from '@/lib/sessionRecords'
import { loadData, loadRecord } from '@/lib/storage'
import { QUIZ_REPORT_PATH } from '@/lib/tabMenu'
import { dayReviewLines } from '@/lib/talkLines'
import { formatHoursMinutes, getWeeklyStudy } from '@/lib/weeklyStudy'
import type { CareLevel, CheckIn, EmotionTag, StudyPlan, StudySession, Subject } from '@/types'

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

export function RecordListPage() {
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

  // 달력과 4주 실행률은 카드 결과(실행 · 지연 · 미실행 · 휴식)로 정합니다. (#410, lib/calendarDay.ts)
  const { cards } = useCards()
  // 지금 시각은 화면을 처음 그릴 때 한 번만 읽습니다. (다시 그릴 때마다 바뀌면 결과가 흔들립니다)
  const [now] = useState(Date.now)
  // 내 숲 (#404). 2026-10-18 에 홈에서 기록 탭 맨 위로 옮겼습니다.
  // 숲은 오늘 관리 단계를 읽어서, 오늘 판정이 먼저 저장돼 있어야 합니다. 오늘 이미 판정했으면 아무것도 바꾸지 않습니다. (lib/dailyCareRun.ts)
  const [forest] = useState(() => {
    const todayKey = getTodayKey()
    runDailyCareStage(todayKey, now)
    return loadForestState(todayKey, now, loadManualItems().length)
  })
  // 옛 계획으로 잰 기록도 그 카드의 기록으로 보려고 "옛 계획 id → 카드 id" 표를 만듭니다. (lib/sessionRecords.ts)
  const [cardIdByPlanId] = useState(() =>
    buildCardIdByPlanId(loadRecord<StudyPlan[]>('plans'), loadRoutines()),
  )
  const sessionsByDay = groupSessionsByDayKey(sessions)

  /** 그 날짜의 달력 하루 (카드마다 결과를 판정하고 칸의 상태를 정함) */
  function getCalendarDay(dateKey: string): CalendarDay {
    return buildCalendarDay({
      dateKey,
      cards,
      sessions: sessionsByDay.get(dateKey) ?? [],
      cardIdByPlanId,
      now,
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
      {/* 예전에는 위의 하위 탭 [기록 | 리포트] 가 화면 이름을 대신했는데, 리포트를 빼면서(2026-10-23) 제목을 보이게 했습니다. */}
      <h1 className="text-[28px] leading-tight font-bold tracking-tight">기록</h1>

      {/* 오늘 푼 문제 사진 채점: [사진 올리기] → (PC) QR 창 → 폰으로 찍어 올리면 아래에 결과 카드 (2026-10-24) */}
      <AnswerCheckCard />

      {/* 문제 풀이 주간 리포트(과목별 점수 그래프 · 주간 정리표)로 가는 입구 (2026-10-24, pages/QuizReportPage.tsx) */}
      <Link
        to={QUIZ_REPORT_PATH}
        className="flex items-center justify-between gap-3 rounded-2xl bg-white p-5 hover:bg-slate-50 active:scale-[0.99] sm:p-6"
      >
        <span className="min-w-0">
          <span className="block text-[17px] font-bold tracking-tight text-slate-900">
            문제 풀이 리포트
          </span>
          <span className="mt-0.5 block text-sm text-slate-500">
            과목별 점수 변화 · 취약 단원 · 주간 정리표
          </span>
        </span>
        <span aria-hidden="true" className="text-xl text-slate-400">
          ›
        </span>
      </Link>

      {/* 묶음 순서: 매일 보는 숫자(실행률 · 7일 공부 시간) → 내 숲 → AI 분석 (가장 자주 보는 것을 위로) */}
      {/* 최근 4주 실행률 · 최근 7일 막대그래프 · 7일 집중도. 모바일은 한 줄에 하나, PC 는 두 칸으로 카드를 놓습니다. */}
      {/* items-start: 높이가 다른 카드를 억지로 같은 높이로 늘리지 않습니다. (시안처럼) */}
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
        <RunRateCard summary={recentRunRate} />
        <WeeklyBarCard sessions={sessions} />
        <FocusWeekCard now={now} />
      </div>

      {/* 내 숲: 가운데 전체 나무 + 둘레의 목표 나무. 공부한 시간이 쌓이면 자랍니다. */}
      <ForestCard forest={forest} />

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
                              <SubjectTag subject={findSubject(subjects, record.subjectId)} />
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
                              <SubjectTag subject={findSubject(subjects, record.subjectId)} />
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

      <CallSummaryCard summaries={callSummaries} />
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

/**
 * 날짜별 통화 요약 · 이해도 (그날의 마지막 통화). 통화 결과 화면이 적어 둔 통화 기록(lib/callLog.ts)에서 꺼냅니다.
 * 확인 통화였으면 요약 끝의 '이해도: …' 를 떼어 배지로 보여 줍니다. (BE #327)
 */
function loadCallNotesByDate(): Record<
  string,
  { summary: string; understanding: Understanding | null }
> {
  const notes: Record<string, { summary: string; understanding: Understanding | null }> = {}
  // 오래된 것부터 있어서, 같은 날 통화가 여러 번이면 마지막 것이 남습니다.
  for (const entry of loadCallLog()) {
    if (typeof entry.summary === 'string' && entry.summary.trim() !== '') {
      notes[entry.dateKey] = splitUnderstanding(entry.summary.trim())
    }
  }
  return notes
}

interface DayUnderstandingProps {
  /** 그날 확인 통화의 이해도. 확인 통화가 아니었으면 없음 */
  understanding: Understanding | null | undefined
}

/** 목록 한 줄에 붙는 이해도 배지 (없으면 아무것도 안 그림) */
function DayUnderstanding({ understanding }: DayUnderstandingProps) {
  if (!understanding) return null
  return <UnderstandingBadge understanding={understanding} />
}

/** "지난 통화 요약": 날짜별 목록(최근 것이 위)과, 눌렀을 때 그날 카드를 자세히 보는 팝업 */
function CallSummaryCard({ summaries }: CallSummaryCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  // 지금 팝업으로 보고 있는 요약. null 이면 팝업이 닫혀 있습니다.
  const [selected, setSelected] = useState<CallSummary | null>(null)
  // 그날 통화의 AI 요약 · 이해도 (확인 통화)
  const [callNotes] = useState(loadCallNotesByDate)
  const selectedNote = selected ? callNotes[selected.date] : undefined

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
                  <DayUnderstanding understanding={callNotes[summary.date]?.understanding} />
                </span>
                {/* break-words: 긴 문장도 화면 폭을 넘지 않고 줄바꿈됩니다. */}
                <span className="text-[15px] leading-relaxed font-semibold break-words text-slate-900">
                  {summary.headline}
                </span>
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
            {/* 평가(evaluations)에 한마디가 없으면 그날 통화 요약을 씁니다. (이해도 줄은 뗀 것)
                통화 요약은 "~했다고 함" 같은 기록용 문장이라 이름을 "대화 요약" 으로 바꿔 보여 줍니다. */}
            <SummaryRow
              label={selected.aiComment !== null ? 'AI 한마디' : '대화 요약'}
              value={selected.aiComment ?? (selectedNote?.summary || null)}
              emptyText="아직 없어요"
            />
            {selectedNote?.understanding && (
              <div>
                <dt className="text-xs text-slate-500">확인 통화 이해도</dt>
                <dd className="mt-1">
                  <UnderstandingBadge understanding={selectedNote.understanding} />
                </dd>
              </div>
            )}
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
      <dd
        className={cn(
          'mt-0.5 text-[15px] leading-relaxed break-words',
          value ? 'text-slate-900' : 'text-slate-500',
        )}
      >
        {value ?? emptyText}
      </dd>
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

interface ForestCardProps {
  forest: ForestState
}

/** 목표 나무 아래에 보여 줄 상태 글자 */
function goalTreeStatus(tree: ForestTree): string {
  if (tree.isFinished) return '끝난 목표'
  if (tree.isWilted) return `${tree.stageName} · 시듦`
  return tree.stageName
}

/**
 * "내 숲" 카드 (#404). 가운데 전체 나무 그림 + 잎·열매 개수 + 다음 단계까지 남은 시간,
 * 그 아래 목표 나무들(진행 중인 목표 먼저, 끝난 목표는 흐리게). 목표가 없으면 전체 나무만 보입니다.
 */
function ForestCard({ forest }: ForestCardProps) {
  const { main } = forest
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[17px] font-bold tracking-tight text-slate-900">내 숲</h3>
        <p className="text-sm text-slate-500 tabular-nums">
          {main.stageName} · {main.stage + 1}단계
          {main.isWilted && <span className="font-semibold text-amber-700"> · 시듦</span>}
        </p>
      </div>

      <div className="mt-3 flex justify-center rounded-xl bg-slate-50 px-4 py-3">
        <TreeDrawing tree={main} />
      </div>

      {main.isWilted && (
        <p className="mt-3 text-sm break-keep text-amber-700">
          미루거나 못 한 카드가 이어져서 조금 시들었어. 다시 카드를 하면 살아나.
        </p>
      )}

      {/* 잎 · 열매 개수. 숫자는 크게, 무엇인지는 작게 (위계) · 한 묶음 안을 선으로 나눔 (근접성) */}
      <dl className="mt-3 grid grid-cols-2 divide-x divide-slate-200 rounded-xl bg-slate-50 py-3">
        <div className="flex min-w-0 flex-col-reverse items-center gap-0.5 px-2 text-center">
          <dt className="text-xs font-medium break-keep text-slate-500">잎 · 회고·인사이트</dt>
          <dd className="text-2xl font-bold text-green-700 tabular-nums">{main.leafCount}</dd>
        </div>
        <div className="flex min-w-0 flex-col-reverse items-center gap-0.5 px-2 text-center">
          <dt className="text-xs font-medium break-keep text-slate-500">
            열매 · 효과가 확인된 방법
          </dt>
          <dd className="text-2xl font-bold text-orange-600 tabular-nums">{main.fruitCount}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2 text-sm text-slate-600">
          <span>다음 단계까지</span>
          <span className="text-[15px] font-semibold text-slate-900 tabular-nums">
            {main.isFullGrown ? '다 자랐어!' : `${formatMinutes(main.minutesToNextStage)} 남음`}
          </span>
        </div>
        <ProgressBar value={main.progressPercent} />
      </div>

      {forest.goals.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="text-[15px] font-bold text-slate-900">목표 나무</p>
          {/* 375px 에서도 3그루가 한 줄에 들어가고, 지난 목표가 늘면 다음 줄로 내려갑니다. (가로 스크롤 없음) */}
          <ul className="mt-2 grid grid-cols-3 gap-2">
            {forest.goals.map((tree) => (
              <li
                key={tree.goalId}
                className={cn(
                  'flex min-w-0 flex-col items-center rounded-xl bg-slate-50 px-1 py-2',
                  tree.isFinished && 'opacity-60',
                )}
              >
                <TreeDrawing tree={tree} className="h-16" />
                {/* line-clamp-2: 목표 이름이 길면 두 줄까지 보여 주고 그 뒤만 '…' 로 줄입니다. */}
                <p className="mt-1 line-clamp-2 w-full text-center text-xs leading-snug font-medium text-slate-800">
                  {tree.title}
                </p>
                <p
                  className={cn(
                    'text-center text-xs',
                    tree.isWilted ? 'text-amber-700' : 'text-slate-500',
                  )}
                >
                  {goalTreeStatus(tree)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
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
  /** 그릴 나무 (전체 나무 · 목표 나무 모두 같은 모양으로 그립니다) */
  tree: Pick<ForestTree, 'stage' | 'stageName' | 'isWilted' | 'leafCount' | 'fruitCount'>
  /** 그림 높이. 기본은 h-36(전체 나무), 목표 나무는 더 작게 넘깁니다 */
  className?: string
}

/** 나무 그림 (라이브러리 없이 SVG 를 직접 그립니다) */
function TreeDrawing({ tree, className }: TreeDrawingProps) {
  // 시들면 초록 잎이 누런 갈색으로 바뀝니다. transition-colors 로 색이 천천히 바뀝니다.
  const leafColor = tree.isWilted ? 'fill-amber-600' : 'fill-green-500'
  const darkLeafColor = tree.isWilted ? 'fill-amber-700' : 'fill-green-700'
  const label = `${tree.stageName}${tree.isWilted ? ', 시든 모습' : ''}`

  // 큰 나무가 되어야 잎·열매 점을 그립니다. (씨앗·새싹에는 붙일 자리가 없어서 개수 글자로만 보여줍니다)
  const leafSpots = tree.stage === 3 ? LEAF_SPOTS.slice(0, tree.leafCount) : []
  const fruitSpots = tree.stage === 3 ? FRUIT_SPOTS.slice(0, tree.fruitCount) : []

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 200 140"
      className={cn('h-36 w-full max-w-full', className)}
    >
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
