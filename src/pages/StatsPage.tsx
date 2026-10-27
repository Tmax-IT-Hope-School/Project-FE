import { useQueryParam } from '@/hooks/useQueryParam'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AiAnalysisCard, AnalysisInsight } from '@/components/ui/AiAnalysisCard'
import { AnswerCheckCard } from '@/components/ui/AnswerCheckCard'
import { Card } from '@/components/ui/Card'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { TalkButton } from '@/components/ui/TalkButton'
import { useCards } from '@/hooks/useCards'
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
  formatMinutes,
  groupSessionsByDate,
  isStudySession,
  toDateKey,
} from '@/lib/dailyRecords'
import { getTodayKey, isDateKey, isMonthKey, toDayDate, toDayKey } from '@/lib/date'
import { EMOTION_OPTIONS, isEmotionTag } from '@/lib/quickCheckIn'
import { getCardDayMarkInfo, loadRestDays } from '@/lib/restDays'
import { loadRoutines } from '@/lib/routines'
import { buildCardIdByPlanId } from '@/lib/sessionRecords'
import { loadData, loadRecord } from '@/lib/storage'
import { dayReviewLines } from '@/lib/talkLines'
import { formatHoursMinutes, getWeeklyStudy } from '@/lib/weeklyStudy'
import { QUIZ_REPORT_PATH } from '@/lib/tabMenu'
import type { CheckIn, EmotionTag, StudyPlan, StudySession } from '@/types'

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

/**
 * 통계 탭 화면(/stats)입니다. (2026-10-24)
 * 2026-10-24 까지 기록 탭(/records)이던 화면을 그대로 옮겼습니다. 기록 탭은 일간 · 주간 리포트(History)가 됩니다.
 * 날짜별 기록 목록 · 최근 7일 집중도 카드는 2026-10-26 에 뺐습니다. (시연 피드백. 날짜마다 보기는 달력이 합니다)
 */
export function StatsPage() {
  // 공부 기록은 타이머가 저장해 둔 것을 읽기만 합니다.
  const [sessions] = useState<StudySession[]>(loadSessions)

  // 달력의 그날 감정 표시에 체크인을 씁니다.
  const [checkIns] = useState(loadCheckInsByDate)

  // 달력과 4주 실행률은 카드 결과(실행 · 지연 · 미실행 · 휴식)로 정합니다. (#410, lib/calendarDay.ts)
  const { cards } = useCards()

  // 날짜별로 묶습니다. 달력에서 누른 날의 순공 시간을 보여 줄 때 씁니다.
  const days = groupSessionsByDate(sessions)
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

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[28px] leading-tight font-bold tracking-tight">통계</h1>

      {/* 오늘 푼 문제 사진 채점: [사진 올리기] → (PC) QR 창 → 폰으로 찍어 올리면 아래에 결과 카드 (2026-10-24) */}
      <AnswerCheckCard />

      {/* 이번 주 점수 카드(#660)는 2026-10-27 시연 피드백으로 뺐습니다. (서버 BE #412 · lib/weeklyScoreApi.ts 는 남겨 둠) */}

      {/* 문제 풀이 주간 리포트(과목별 점수 그래프 · 주간 정리표)로 가는 입구 (pages/QuizReportPage.tsx)
          기록 탭을 뺄 때(2026-10-27) 그 탭 맨 아래에 있던 것을 옮겼습니다. 확인 문제 결과를 과목 · 단원별로 자세히 봅니다. */}
      <Link
        to={QUIZ_REPORT_PATH}
        className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-white p-5 hover:bg-slate-50 sm:p-6"
      >
        <span className="min-w-0">
          <span className="block text-[17px] font-bold tracking-tight text-slate-900">
            문제 풀이 리포트
          </span>
          <span className="mt-0.5 block text-sm text-slate-500">
            과목별 점수 변화 · 취약 단원 · 주간 정리표
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-slate-400">
          ›
        </span>
      </Link>

      {/* 묶음 순서: 매일 보는 숫자(실행률 · 7일 공부 시간) → AI 분석 (가장 자주 보는 것을 위로)
          내 숲 · 지난 통화 요약은 2026-10-24 에 뺐습니다. (lib/forest*.ts · lib/callSummary.ts 는 다른 곳이 써서 남김) */}
      {/* 최근 4주 실행률 · 최근 7일 막대그래프. 모바일은 한 줄에 하나, PC 는 두 칸으로 카드를 놓습니다. */}
      {/* items-start: 높이가 다른 카드를 억지로 같은 높이로 늘리지 않습니다. (시안처럼) */}
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
        <RunRateCard summary={recentRunRate} />
        <WeeklyBarCard sessions={sessions} />
      </div>

      {/* AI 분석: 최근 28일 기록을 숫자로 묶고(코드), 서버의 AI 가 말로 풀어 줍니다. (#419) */}
      <AiAnalysisCard />

      {/* 발견 1개와 반응 버튼 [몰랐는데 맞아 · 이미 알던 거야 · 틀렸어]. 리포트 탭에 있던 것을 2026-10-23 에 옮겼습니다.
          "몰랐는데 맞아" 는 기획서 「4.6」 의 핵심 경험 지표라서, 리포트를 빼도 이 카드는 남깁니다. */}
      <section>
        <h2 className="text-[17px] font-semibold tracking-tight text-slate-900">이번 발견</h2>
        <AnalysisInsight sessions={sessions} className="mt-3" />
      </section>

      {/* PC(lg)에서는 달력을 반 폭으로 둡니다. 칸이 정사각형이라 전체 폭이면 달력이 너무 커집니다. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <StudyCalendar getDay={getCalendarDay} records={days} checkIns={checkIns} />
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
