import { RedirectWithQuery } from '@/components/layout/RedirectWithQuery'
import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ChipButton } from '@/components/ui/ChipButton'
import { SegmentedToggle } from '@/components/ui/SegmentedToggle'
import { Skeleton } from '@/components/ui/Skeleton'
import { useCalendarAlarmSync } from '@/hooks/useCalendarAlarmSync'
import { useCalendarConnect, type CalendarConnection } from '@/hooks/useCalendarConnect'
import { useCards } from '@/hooks/useCards'
import { useGoals } from '@/hooks/useGoals'
import { useIsServerData } from '@/hooks/useIsServerData'
import { useQueryParam } from '@/hooks/useQueryParam'
import { isInApp } from '@/lib/appBridge'
import { loadCardMarks } from '@/lib/cardMarks'
import { getCardsOnDate } from '@/lib/cards'
import { cn } from '@/lib/cn'
import { runDailyCareStage } from '@/lib/dailyCareRun'
import { loadAllSessions } from '@/lib/dailyRecords'
import { getTodayKey, isDateKey, moveDateKey, toDayDate } from '@/lib/date'
import { formatDday, getDaysUntil } from '@/lib/exams'
import { weekEventsQuery, type CalendarEvent } from '@/lib/googleCalendar'
import { getUpcomingMyEvents } from '@/lib/myEvents'
import { loadOnboardingAnswers } from '@/lib/onboardingSteps'
import { toDayMinutes } from '@/lib/planConflict'
import { loadRestDays } from '@/lib/restDays'
import { getWeekday, getWeekdayName } from '@/lib/routines'
import {
  daysUntilKey,
  dismissReplan,
  filterForGrade,
  getNextExamPeriod,
  gradeNumberOf,
  groupEventPeriods,
  loadDismissedReplans,
  shouldSuggestReplan,
  type SchoolEventPeriod,
} from '@/lib/schoolEvents'
import {
  isContestNotice,
  matchesFocusName,
  schoolNoticesQuery,
  type SchoolNotice,
} from '@/lib/schoolNotices'
import { dayLabelOf, loadSchoolClass, schoolTodayQuery, type SchoolClass } from '@/lib/schoolToday'
import {
  clearSettingChanges,
  describeSettingChange,
  loadSettingChanges,
  revertSettingChange,
} from '@/lib/settingChanges'
import type { SettingChange } from '@/lib/settingsMapping'
import { loadStudyFocus } from '@/lib/studyFocus'
import { COACH_PATH, handOffPlanChip } from '@/lib/chatRooms'
import {
  getTodayCardsState,
  type TodayCardItem,
  type TodayCardsState,
  type TodayCardStatus,
} from '@/lib/todayCards'
import type { Card as CardModel, StudySession } from '@/types'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

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

/** 오늘 날짜를 '10월 10일 토요일' 처럼 보여줍니다. (새벽 4시 전이면 어제 날짜를 넘겨받습니다) */
function formatToday(date: Date): string {
  return date.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })
}

// Link(주소로 이동하는 글자)를 버튼처럼 보이게 하는 클래스입니다.
// Button 은 <button> 이라서, 다른 화면으로 가는 곳에는 Link 에 이 클래스를 붙여 씁니다.
// h-12 / h-10: 손가락으로 누르기 쉽게 높이를 40px 이상으로 둡니다.
const textLinkClass =
  'inline-flex h-10 items-center text-sm font-medium text-slate-600 underline underline-offset-4'

/**
 * 홈 탭(첫 화면 "/")입니다. (2026-10-18 '오늘' 탭(/today)에서 이름 · 주소를 바꿔 첫 탭으로 올림)
 * 사용자: "일단 홈 정도도 필요하지 않나", "달력 위치도 좀 바꾸거나", "홈 화면 수정도 좀 하자"
 *
 *   ① 인사
 *   ② 학교 정보 한 묶음: 위 탭 [시간표 | 급식 | 일정 | 공지] 중 하나만 펼침 (2026-10-22, 주소 ?school=)
 *      일정 = 학교 일정 + 내 일정을 날짜 순서로 D-day 와 함께, 공지 = 학교 홈페이지 글 제목 · 대회 글은 🏆
 *      2026-10-27 시연 피드백으로 지금 할 카드 위로 올렸습니다.
 *   ③ 달력: 이번 주 7일 줄과 고른 날의 카드 · 구글 캘린더 일정 (2026-10-24, 주소 ?day=)
 *      오늘을 고르면 예전 "오늘 계획" 목록 그대로 [시작] 이 붙고, 지금 할 카드(없으면 다음 카드)에 형광펜 '지금' · '다음' 이 붙습니다.
 *      위에 크게 있던 "지금 할 카드" 묶음(카드가 없으면 [코치와 오늘 계획 짜기] · [사진으로 만들기])은 2026-10-27 시연 피드백으로 뺐습니다.
 *   맨 아래: AI 가 바꾼 설정 알림
 *
 * 숲(2026-10-24 에 뺌) · 오늘 한 줄 · 관리 모드 띠(2026-10-25 에 뺌)는 빠졌습니다. 알림 · 통화는 코치 화면 머리에, 설정은 헤더(PC 메뉴 · 모바일 오른쪽 위 톱니)에 있습니다.
 * 오늘의 미션 · AI 통화 입구 · [타이머 · 카드 없이 시작] · [카드 · 목표 모두 보기] 도 2026-10-26 에 뺐습니다. (시연 피드백)
 * 미션은 코치 채팅에, 통화는 코치 화면 머리에, 카드 · 목표는 아래 탭 [카드] 에 그대로 있습니다.
 */
export function HomePage() {
  const { search } = useLocation()
  // 예전 미션 알림은 첫 화면(/?mission=morning)을 열었습니다. 지금은 코치가 미션을 말해서 코치 화면으로 넘깁니다. (?mission= 값은 그대로)
  if (new URLSearchParams(search).has('mission')) return <RedirectWithQuery to={COACH_PATH} />
  return <HomeView />
}

function HomeView() {
  const navigate = useNavigate()
  const todayKey = getTodayKey()
  // 화면을 연 시각. 그리는 동안 Date.now() 를 여러 번 부르지 않게 한 번만 잡습니다.
  const [now] = useState(() => Date.now())

  // 하루 1번 관리 단계를 판정해 저장합니다. ("통화가 없으면 다음 날 첫 진입 때", lib/dailyCareRun.ts)
  // 홈에 보여 주던 관리 모드 띠는 2026-10-25 에 뺐지만, 판정은 남깁니다. 통화 · 채팅의 말투와
  // 안전 브레이크(위기 표현 · 기분 저하 때 0단계)가 이 값을 씁니다. 오늘 이미 판정했으면 그대로 둡니다.
  useState(() => runDailyCareStage(todayKey, now))

  const { cards } = useCards()
  const { activeGoals } = useGoals()
  // 노는 기록까지 들어 있는 전체 기록 (오늘 한 카드를 찾을 때)
  const [allSessions] = useState<StudySession[]>(loadAllSessions)
  const [marks] = useState(loadCardMarks)
  const [restDays] = useState(loadRestDays)
  const todayCards = getTodayCardsState({
    cards,
    sessions: allSessions,
    marks,
    isRestDay: restDays.some((day) => day.date === todayKey),
    todayKey,
    now,
  })

  // AI 가 바꾼 설정 기록 (#385). [되돌리기] · [확인] 을 누르면 줄어듭니다. (lib/settingChanges.ts)
  const [settingChanges, setSettingChanges] = useState(loadSettingChanges)

  // 머리글에 보여 줄 가장 가까운 목표의 D-day
  const nearestGoal = [...activeGoals].sort((a, b) => a.dDay.localeCompare(b.dDay))[0]

  function handleRevertSetting(change: SettingChange) {
    setSettingChanges(revertSettingChange(change.key))
  }

  function handleDismissSettings() {
    clearSettingChanges()
    setSettingChanges([])
  }

  return (
    // 모바일은 바탕을 연회색으로 칠하고(-mx-4 -mt-3 -mb-6 으로 Layout 의 여백까지 덮음), 내용은 흰 묶음으로 올립니다.
    <div className="-mx-4 -mt-3 -mb-6 flex flex-col gap-4 bg-slate-100 px-4 pt-3 pb-6 sm:mx-0 sm:my-0 sm:gap-6 sm:rounded-3xl sm:p-6">
      {/* ① 인사: 날짜 · 가까운 목표 D-day 한 줄 + 짧은 인사 */}
      <div className="min-w-0 px-1">
        <p className="text-[15px] text-slate-500 tabular-nums">
          {formatToday(toDayDate(new Date(now)))}
          {nearestGoal && ` · ${nearestGoal.title} ${formatDday(getDaysUntil(nearestGoal.dDay))}`}
        </p>
        <h1 className="mt-1 text-2xl leading-snug font-bold tracking-tight text-slate-900">
          오늘도 같이 시작해 볼까?
        </h1>
      </div>

      {/* ② 학교 정보 한 묶음: [시간표 | 급식 | 일정 | 공지] 중 하나만 펼칩니다. (BE GET /school/today · /school/notices)
          2026-10-27 시연 피드백으로 "지금 할 카드" 위, 인사 바로 아래로 올렸습니다. */}
      <SchoolInfoSection todayKey={todayKey} />

      {/* ③ 달력 · 오늘 계획 (위의 "지금 할 카드" 큰 묶음은 2026-10-27 시연 피드백으로 뺐습니다) */}
      <TodayPlanSection
        state={todayCards}
        cards={cards}
        todayKey={todayKey}
        onStart={(card) => navigate(`/timer?card=${encodeURIComponent(card.id)}`)}
      />

      {/* AI 가 설정을 바꿨으면 알림 줄 + [되돌리기] (#385) */}
      {settingChanges.length > 0 && (
        <SettingChangeNotice
          changes={settingChanges}
          onRevert={handleRevertSetting}
          onDismiss={handleDismissSettings}
        />
      )}
    </div>
  )
}

// 흰 묶음 카드 (토스 형식: 테두리 · 그림자 없이 둥근 흰 바탕). 모서리는 Card 와 같은 rounded-2xl 입니다.
const sectionCardClass = 'rounded-2xl bg-white p-5'
// 학교 정보(시간표 · 급식 · 일정 · 공지)는 "보고 지나가는" 정보라 여백을 한 단계 줄여 조용하게 둡니다.
const quietCardClass = 'rounded-2xl bg-white p-4'

// 동그란 배경의 이모지 자리 (목록 줄 왼쪽)
const rowIconClass =
  'flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg'
// 학교 정보 줄의 이모지 자리는 한 단계 작게 둡니다. (보고 지나가는 정보라 시선을 덜 끌게)
const quietIconClass =
  'flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-base'

/** 오늘 계획 한 줄의 상태별 이모지와 글자 */
const PLAN_STATUS_INFO: Record<TodayCardStatus, { icon: string; label: string }> = {
  current: { icon: '▶️', label: '지금' },
  waiting: { icon: '📖', label: '' },
  unhandled: { icon: '⏰', label: '시간 지남' },
  done: { icon: '✅', label: '끝' },
  // [끝내기] 로 일찍 끝냈고 카드 시간도 끝난 카드 (카드 탭의 '중간에 끝냈어요' 와 같음, #709)
  endedEarly: { icon: '⏸️', label: '중간에 끝냄' },
  // 미루기 · 실패로 처리했거나, 오늘을 쉰 날로 처리한 카드
  skipped: { icon: '⏭️', label: '넘김' },
}

/** 카드 시작 시각과 길이 한 줄. 예: '19:00 · 60분' / 시각이 없으면 '시간 미정 · 60분' */
function cardTimeText(card: CardModel): string {
  return `${card.startTime ?? '시간 미정'} · ${card.durationMinutes}분`
}

interface TodayPlanSectionProps {
  state: TodayCardsState
  /** 내 카드 전부. 달력에서 다른 날을 고르면 그날 카드를 여기서 찾습니다 */
  cards: CardModel[]
  todayKey: string
  /** 카드로 시작 — 타이머가 그 카드로 엽니다 (/timer?card=…) */
  onStart: (card: CardModel) => void
}

/**
 * ③ 달력 (「4.2」): 이번 주 7일 줄 + 고른 날의 카드 · 구글 캘린더 일정. (HomeCalendarSection)
 * 위에 크게 있던 "지금 할 카드" 묶음(brand 색, [▶ 시작])은 2026-10-27 시연 피드백으로 뺐습니다.
 * 지금 할 카드(없으면 다음 카드)는 오늘 목록에서 형광펜 '지금' · '다음' 으로 알려 줍니다.
 */
function TodayPlanSection({ state, cards, todayKey, onStart }: TodayPlanSectionProps) {
  // 오늘 목록에서 형광펜으로 표시할 카드: 지금 할 카드가 먼저, 없으면 다음 카드
  const heroCard = state.current ?? state.next
  return (
    <HomeCalendarSection
      state={state}
      cards={cards}
      todayKey={todayKey}
      heroCard={heroCard}
      onStart={onStart}
    />
  )
}

interface HomeCalendarSectionProps {
  state: TodayCardsState
  cards: CardModel[]
  todayKey: string
  /** 오늘 목록에서 형광펜 '지금' · '다음' 으로 표시할 카드 */
  heroCard: CardModel | undefined
  onStart: (card: CardModel) => void
}

// 달력 머리의 ‹ › 버튼 (누르기 쉽게 40px 정사각형)
const weekNavButtonClass =
  'flex size-10 items-center justify-center rounded-xl text-lg text-slate-600 hover:bg-slate-100'

/**
 * 달력 묶음: 이번 주 7일 줄 + 고른 날의 일정 (2026-10-24)
 * 사용자: "구글 캘린더 연동 필요 캘린더 UI도 보다 좀 더 잘 보이는 홈에 배치"
 *
 *   - 고른 날의 내 카드와 구글 캘린더 일정을 시각 순서로 한 목록에 보여 줍니다.
 *     오늘을 고르면 예전 "오늘 계획" 목록(PlanRow)과 같아서 [▶] 로 바로 시작할 수 있습니다.
 *   - 고른 날은 주소에 둡니다. (/?day=2026-10-27) 새로고침해도 보던 날이 그대로입니다.
 *   - 구글 캘린더를 연결하지 않았으면 카드만 보이고, 아래에 [구글 캘린더 연결] 이 있습니다. (lib/googleCalendar.ts)
 */
function HomeCalendarSection({
  state,
  cards,
  todayKey,
  heroCard,
  onStart,
}: HomeCalendarSectionProps) {
  // replace: 날짜를 여러 번 눌러도 뒤로 가기 한 번이면 홈을 떠납니다. (학교 탭 ?school= 와 같게)
  const [dayParam, setDayParam] = useQueryParam('day', todayKey, { replace: true })
  // 주소는 누구나 고칠 수 있어서, 진짜 날짜가 아니면 오늘로 봅니다.
  const selectedKey = isDateKey(dayParam) ? dayParam : todayKey
  // 고른 날이 들어 있는 주의 일요일 (getWeekday: 0 = 일요일)
  const weekStartKey = moveDateKey(selectedKey, -getWeekday(selectedKey))
  const connection = useCalendarConnect()
  // 연결돼 있으면 앞으로 7일 일정을 서버에 올려서, 시작 10분 전에 푸시가 오게 합니다. (2026-10-24)
  useCalendarAlarmSync(connection.status === 'on')

  // 달력 몸통(7일 줄 + 목록)에 똑같이 넘기는 값. 구글 일정만 상황마다 달라집니다.
  const bodyProps: Omit<CalendarBodyProps, 'googleEvents'> = {
    state,
    cards,
    todayKey,
    selectedKey,
    weekStartKey,
    heroCard,
    onStart,
    onSelectDay: setDayParam,
  }

  return (
    // p-4: 375px 화면에서 7일 칸이 40px 보다 좁아지지 않게 모바일은 안쪽 여백을 한 단계 줄입니다.
    <section className={cn(sectionCardClass, 'p-4 sm:p-5')}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[17px] font-bold text-slate-900 tabular-nums">
          <span className="sr-only">달력, </span>
          {formatWeekRange(weekStartKey)}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          {selectedKey !== todayKey && (
            <Button
              variant="ghost"
              size="sm"
              className="px-3"
              onClick={() => setDayParam(todayKey)}
            >
              오늘
            </Button>
          )}
          <button
            type="button"
            aria-label="지난주"
            className={weekNavButtonClass}
            onClick={() => setDayParam(moveDateKey(selectedKey, -7))}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="다음 주"
            className={weekNavButtonClass}
            onClick={() => setDayParam(moveDateKey(selectedKey, 7))}
          >
            ›
          </button>
        </div>
      </div>

      {/* 구글 캘린더를 연결했을 때만 구글 일정을 받아옵니다. 받는 동안 · 실패해도 내 카드는 그대로 보입니다. */}
      {connection.status === 'on' ? (
        <AsyncBoundary
          pendingFallback={<CalendarBody {...bodyProps} googleEvents={[]} isGoogleLoading />}
          errorMessage="구글 일정을 불러오지 못했어요. 계속 안 되면 아래 연결 끊기를 누른 뒤 다시 연결해 주세요."
          errorExtra={<CalendarBody {...bodyProps} googleEvents={[]} />}
          resetKeys={[weekStartKey]}
        >
          <GoogleCalendarBody {...bodyProps} />
        </AsyncBoundary>
      ) : (
        <CalendarBody {...bodyProps} googleEvents={[]} />
      )}

      {/* 시간이 끝났는데 처리 안 한 카드가 있으면 알려 줍니다. (예전에는 할 카드가 없을 때 위 큰 묶음이 대신 보여 줬습니다) */}
      {selectedKey === todayKey && state.unhandled.length > 0 && (
        <Link
          to="/timer"
          className="mt-3 flex min-h-10 items-center rounded-xl bg-amber-50 px-3 text-sm break-keep text-amber-900"
        >
          시간이 끝난 카드 {state.unhandled.length}개 — 타이머에서 미루거나 실패로 남겨요 ›
        </Link>
      )}

      <GoogleConnectRow connection={connection} />
    </section>
  )
}

/** 구글 일정을 받아와서 달력 몸통에 넘깁니다. (AsyncBoundary 안에서 씁니다) */
function GoogleCalendarBody(props: Omit<CalendarBodyProps, 'googleEvents'>) {
  const { data: googleEvents } = useSuspenseQuery(weekEventsQuery(props.weekStartKey))
  return <CalendarBody {...props} googleEvents={googleEvents} />
}

interface CalendarBodyProps {
  state: TodayCardsState
  cards: CardModel[]
  todayKey: string
  /** 고른 날 'YYYY-MM-DD' */
  selectedKey: string
  /** 보고 있는 주의 일요일 'YYYY-MM-DD' */
  weekStartKey: string
  heroCard: CardModel | undefined
  onStart: (card: CardModel) => void
  onSelectDay: (dateKey: string) => void
  /** 이번 주 구글 일정. 연결 안 했거나 받는 중이면 빈 목록 */
  googleEvents: CalendarEvent[]
  /** 구글 일정을 받는 중인지 */
  isGoogleLoading?: boolean
}

/** 달력 목록 한 줄. 오늘 카드(시작 버튼 있음) · 다른 날 카드 · 구글 일정 셋 중 하나입니다 */
type DayRow =
  | { kind: 'today'; order: number; item: TodayCardItem }
  | { kind: 'card'; order: number; card: CardModel }
  | { kind: 'google'; order: number; event: CalendarEvent }

/**
 * 목록 순서에 쓰는 숫자. 하루 종일 일정이 맨 위, 그다음 시작 시각 순서, 시각이 없는 카드는 맨 아래입니다.
 * 하루는 새벽 4시에 시작해서, 새벽 1시 일정은 밤 11시 일정보다 뒤에 놓입니다. (toDayMinutes)
 */
function getRowOrder(startTime: string | null | undefined, isAllDay = false): number {
  if (isAllDay) return -1
  return toDayMinutes(startTime ?? undefined) ?? Number.MAX_SAFE_INTEGER
}

/** 7일 줄 + 고른 날의 카드 · 구글 일정 목록 */
function CalendarBody({
  state,
  cards,
  todayKey,
  selectedKey,
  weekStartKey,
  heroCard,
  onStart,
  onSelectDay,
  googleEvents,
  isGoogleLoading = false,
}: CalendarBodyProps) {
  const weekKeys = Array.from({ length: 7 }, (_, i) => moveDateKey(weekStartKey, i))
  const isToday = selectedKey === todayKey

  // 고른 날의 줄. 오늘이면 오늘 계획(시작 버튼 · 상태가 붙음)을, 다른 날이면 그날 카드를 씁니다.
  const cardRows: DayRow[] = isToday
    ? state.items.map((item) => ({
        kind: 'today' as const,
        order: getRowOrder(item.card.startTime),
        item,
      }))
    : getCardsOnDate(cards, selectedKey).map((card) => ({
        kind: 'card' as const,
        order: getRowOrder(card.startTime),
        card,
      }))
  const googleRows: DayRow[] = googleEvents
    .filter((event) => event.dayKey === selectedKey)
    .map((event) => ({
      kind: 'google' as const,
      order: getRowOrder(event.startTime, event.isAllDay),
      event,
    }))
  // 시각이 같으면 카드가 먼저 옵니다. (sort 는 순서가 같은 것끼리 원래 순서를 지킵니다)
  const rows = [...cardRows, ...googleRows].sort((a, b) => a.order - b.order)

  return (
    <>
      <ul className="mt-3 grid grid-cols-7 gap-1">
        {weekKeys.map((dateKey) => {
          const cardCount = getCardsOnDate(cards, dateKey).length
          const googleCount = googleEvents.filter((event) => event.dayKey === dateKey).length
          const isSelected = dateKey === selectedKey
          const weekday = getWeekday(dateKey)
          return (
            <li key={dateKey}>
              <button
                type="button"
                aria-pressed={isSelected}
                aria-label={`${formatDayTitle(dateKey, todayKey)}, 카드 ${cardCount}개, 구글 일정 ${googleCount}개`}
                onClick={() => onSelectDay(dateKey)}
                className={cn(
                  'flex h-16 w-full flex-col items-center justify-center gap-0.5 rounded-xl text-slate-700 hover:bg-slate-100',
                  isSelected && 'bg-slate-900 text-white hover:bg-slate-900',
                )}
              >
                <span
                  className={cn(
                    'text-xs',
                    !isSelected && weekday === 0 && 'text-red-500',
                    !isSelected && weekday !== 0 && 'text-slate-500',
                  )}
                >
                  {getWeekdayName(weekday)}
                </span>
                <span
                  className={cn(
                    'text-[15px] font-semibold tabular-nums',
                    // 오늘은 고르지 않았을 때도 brand 색 글자로 알아보게 합니다.
                    dateKey === todayKey && !isSelected && 'text-brand font-bold',
                  )}
                >
                  {Number(dateKey.slice(8, 10))}
                </span>
                {/* 점: 파랑 = 내 카드가 있는 날, 초록 = 구글 일정이 있는 날 (글자는 aria-label 이 읽어 줌) */}
                <span aria-hidden className="flex h-1.5 gap-0.5">
                  {cardCount > 0 && (
                    <span
                      className={cn('bg-brand size-1.5 rounded-full', isSelected && 'bg-white')}
                    />
                  )}
                  {googleCount > 0 && <span className="size-1.5 rounded-full bg-emerald-500" />}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {/* 점 색 안내. 구글 일정이 한 개라도 있을 때만 (점이 두 가지일 때만 헷갈립니다) */}
      {googleEvents.length > 0 && (
        <p aria-hidden className="mt-2 flex justify-end gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <span className="bg-brand size-1.5 rounded-full" /> 내 카드
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-emerald-500" /> 구글 일정
          </span>
        </p>
      )}

      <div className="mt-4 flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-bold text-slate-900">
          {formatDayTitle(selectedKey, todayKey)}
        </h3>
        {isToday && state.total > 0 && (
          <p className="shrink-0 text-sm text-slate-500 tabular-nums">
            {state.doneCount}/{state.total} 끝
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="py-3 text-sm text-slate-500">
          {isToday ? '오늘은 카드도 일정도 없어요.' : '이 날은 카드도 일정도 없어요.'}
        </p>
      ) : (
        // 줄 사이를 1px 선으로 나눠, 줄마다 따로 떠 보이지 않게 합니다.
        <ul className="mt-1 flex flex-col divide-y divide-slate-100">
          {rows.map((row) => {
            if (row.kind === 'today') {
              return (
                <PlanRow
                  key={row.item.card.id}
                  item={row.item}
                  isHero={row.item.card === heroCard}
                  onStart={onStart}
                />
              )
            }
            if (row.kind === 'card') return <CardDayRow key={row.card.id} card={row.card} />
            // 며칠짜리 하루 종일 일정은 같은 id 가 날마다 나와서, 날짜를 붙여 구분합니다.
            return <GoogleEventRow key={`${row.event.id}-${row.event.dayKey}`} event={row.event} />
          })}
        </ul>
      )}

      {isGoogleLoading && (
        <p role="status" className="mt-2 text-sm text-slate-500">
          구글 일정을 불러오는 중이에요…
        </p>
      )}
    </>
  )
}

/** 오늘이 아닌 날의 카드 한 줄 (시작 버튼 없이 보기만) */
function CardDayRow({ card }: { card: CardModel }) {
  return (
    <li className="flex min-h-14 items-center gap-3 py-2">
      <span aria-hidden className={rowIconClass}>
        📖
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-slate-900">
          {card.title}
        </span>
        <span className="block text-sm text-slate-500 tabular-nums">{cardTimeText(card)}</span>
      </span>
    </li>
  )
}

/** 구글 캘린더 일정 한 줄. 카드와 헷갈리지 않게 📅 와 '구글 캘린더' 글자를 붙입니다 */
function GoogleEventRow({ event }: { event: CalendarEvent }) {
  // 예) '하루 종일' / '18:00~20:00' / 끝 시각이 없으면 '18:00'
  const timeText = event.isAllDay
    ? '하루 종일'
    : event.endTime
      ? `${event.startTime}~${event.endTime}`
      : (event.startTime ?? '')
  return (
    <li className="flex min-h-14 items-center gap-3 py-2">
      <span aria-hidden className={rowIconClass}>
        📅
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-slate-700">
          {event.title}
        </span>
        <span className="block text-sm text-slate-500 tabular-nums">{timeText} · 구글 캘린더</span>
      </span>
    </li>
  )
}

interface GoogleConnectRowProps {
  connection: CalendarConnection
}

/**
 * 달력 아래 구글 캘린더 연결 줄. (hooks/useCalendarConnect.ts)
 *   - 클라이언트 ID 가 없으면(구글 설정 전) 아무것도 안 보입니다.
 *   - 앱(WebView) 안에서는 구글이 연결 창을 막아서, 버튼 대신 안내만 보입니다.
 */
function GoogleConnectRow({ connection }: GoogleConnectRowProps) {
  const { status, isReady, isConnecting, errorMessage, connect, disconnect } = connection
  const isServerData = useIsServerData()
  if (status === 'unavailable') return null
  if (isInApp()) {
    return (
      <p className="mt-3 text-[13px] break-keep text-slate-500">
        구글 캘린더 연결은 지금은 웹 브라우저에서만 돼요.
      </p>
    )
  }

  return (
    <div className="mt-3 rounded-xl bg-slate-50 p-3">
      {status === 'on' ? (
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 text-sm break-keep text-slate-600">
            구글 캘린더 연결됨
            {/* 시작 10분 전 푸시는 서버가 보내서, 진짜 로그인일 때만 안내합니다. (테스트 로그인은 서버를 안 씀) */}
            {isServerData && (
              <span className="block text-[13px] text-slate-500">
                일정 시작 10분 전에 알림을 보내요. 설정에서 푸시 알림을 켜 두세요.
              </span>
            )}
          </p>
          <button
            type="button"
            className="h-10 shrink-0 px-2 text-sm font-medium text-slate-500 underline underline-offset-4"
            onClick={disconnect}
          >
            연결 끊기
          </button>
        </div>
      ) : (
        // 모바일은 글 아래에 버튼을 꽉 차게, PC 는 한 줄에 나란히 둡니다.
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm break-keep text-slate-600">
            {status === 'off'
              ? '구글 캘린더를 연결하면 학원 · 약속 같은 일정이 여기 같이 보여요.'
              : '구글 연결은 한 시간마다 끝나요. 다시 연결하면 일정을 다시 불러와요.'}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 sm:flex-none"
              disabled={isConnecting || !isReady}
              onClick={connect}
            >
              {isConnecting ? '연결하는 중…' : status === 'off' ? '구글 캘린더 연결' : '다시 연결'}
            </Button>
            {status === 'expired' && (
              <Button variant="ghost" size="sm" onClick={disconnect}>
                연결 끊기
              </Button>
            )}
          </div>
        </div>
      )}
      {errorMessage && (
        <p role="status" className="mt-2 text-sm break-keep text-red-700">
          {errorMessage}
        </p>
      )}
    </div>
  )
}

/** 'YYYY-MM-DD' → '오늘 · 10월 24일 금요일' / '내일 · …' / '10월 27일 월요일' */
function formatDayTitle(dateKey: string, todayKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const text = new Date(year, month - 1, day).toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })
  if (dateKey === todayKey) return `오늘 · ${text}`
  if (dateKey === moveDateKey(todayKey, 1)) return `내일 · ${text}`
  return text
}

/** 주의 일요일 → '10월 19일 ~ 25일' / 달이 바뀌면 '10월 26일 ~ 11월 1일' */
function formatWeekRange(startKey: string): string {
  const endKey = moveDateKey(startKey, 6)
  const [, startMonth, startDay] = startKey.split('-').map(Number)
  const [, endMonth, endDay] = endKey.split('-').map(Number)
  return startMonth === endMonth
    ? `${startMonth}월 ${startDay}일 ~ ${endDay}일`
    : `${startMonth}월 ${startDay}일 ~ ${endMonth}월 ${endDay}일`
}

interface PlanRowProps {
  item: TodayCardItem
  /** 지금 할 카드(없으면 다음 카드)인지. 맞으면 형광펜 글자로만 짧게 표시합니다. */
  isHero: boolean
  onStart: (card: CardModel) => void
}

/** 오늘 계획 한 줄: 상태 이모지 · 카드 이름 · 시각과 길이 · 오른쪽에 작은 ▶ 버튼 */
function PlanRow({ item, isHero, onStart }: PlanRowProps) {
  const { card, status } = item
  const info = PLAN_STATUS_INFO[status]
  // 지금 할 카드와 아직 시간이 안 된 카드만 시작할 수 있습니다.
  const canStart = status === 'current' || status === 'waiting'
  // 끝냈거나 넘긴 카드는 흐리게 보여 줍니다.
  const isFinished = status === 'done' || status === 'endedEarly' || status === 'skipped'
  // 지금 할 카드(없으면 다음 카드)는 '지금' · '다음' 을 형광펜으로, 나머지는 상태 글자(시간 지남 · 끝 · 넘김)를 그대로 씁니다.
  // 중간에 끝냈지만 카드 시간이 남은 카드는 '이어 하기' 로 알려 줍니다. (#709)
  const label = isHero
    ? status === 'current'
      ? '지금'
      : '다음'
    : item.isResumable
      ? '이어 하기'
      : info.label
  return (
    <li className={cn('flex min-h-14 items-center gap-3 py-2', isFinished && 'opacity-60')}>
      <span aria-hidden className={rowIconClass}>
        {info.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-[15px] font-semibold text-slate-900',
            // 줄긋기는 끝낸 카드에만. 넘긴(미룸 · 실패) 카드는 흐리게만 해서 "끝냈다" 로 보이지 않게 합니다.
            status === 'done' && 'line-through decoration-slate-400',
          )}
        >
          {card.title}
        </span>
        <span className="flex flex-wrap items-center gap-x-1.5 text-sm text-slate-500 tabular-nums">
          {cardTimeText(card)}
          {label &&
            (isHero ? (
              <span className="bg-now rounded px-1.5 text-xs font-bold text-slate-900">
                {label}
              </span>
            ) : (
              <span
                className={cn(
                  'font-semibold',
                  status === 'unhandled' && 'text-amber-700',
                  status === 'done' && 'text-emerald-700',
                )}
              >
                · {label}
              </span>
            ))}
        </span>
      </span>
      {canStart && (
        // 줄마다 큰 [시작] 을 달면 고를 것이 많아 보여서(힉의 법칙), 40px 아이콘 버튼으로 낮춥니다.
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onStart(card)}
          aria-label={`${card.title} 시작`}
          className="w-10 shrink-0 px-0"
        >
          <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
            <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
          </svg>
        </Button>
      )}
    </li>
  )
}
interface SettingChangeNoticeProps {
  changes: SettingChange[]
  onRevert: (change: SettingChange) => void
  onDismiss: () => void
}

/** AI 가 바꾼 설정 알림 줄 + [되돌리기] (「4.2」 · 「4.8」, #385). 되돌린 설정은 잠겨서 AI 가 다시 바꾸지 않습니다. */
function SettingChangeNotice({ changes, onRevert, onDismiss }: SettingChangeNoticeProps) {
  return (
    <Card className="border-sky-200 bg-sky-50">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-sky-900">AI 가 설정을 맞췄어요</p>
        <button
          type="button"
          onClick={onDismiss}
          className="h-10 shrink-0 cursor-pointer rounded-xl px-3 text-sm font-medium text-sky-900 hover:bg-sky-100"
        >
          확인
        </button>
      </div>
      <ul className="mt-2 flex flex-col gap-3">
        {changes.map((change) => {
          const { title, to } = describeSettingChange(change)
          return (
            <li key={change.key} className="flex items-start justify-between gap-3">
              <div className="min-w-0 text-sm break-keep">
                <p className="font-medium text-slate-900">
                  {title}: {to}
                </p>
                <p className="text-slate-600">{change.reason}</p>
              </div>
              <button
                type="button"
                onClick={() => onRevert(change)}
                className="h-10 shrink-0 cursor-pointer rounded-xl border border-sky-300 bg-white px-3 text-sm font-medium text-sky-900 hover:bg-sky-100"
              >
                되돌리기
              </button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/** 학교 정보 묶음 위 세그먼트 탭. 주소 ?school= 에 이 value 가 들어갑니다. (/?school=meal) */
type SchoolTab = 'timetable' | 'meal' | 'events' | 'notices'

const SCHOOL_TABS: { value: SchoolTab; label: string }[] = [
  { value: 'timetable', label: '시간표' },
  { value: 'meal', label: '급식' },
  { value: 'events', label: '일정' },
  { value: 'notices', label: '공지' },
]

/** 주소의 값은 누구나 고칠 수 있어서, 아는 탭 이름이 아니면 시간표로 봅니다. */
function toSchoolTab(value: string): SchoolTab {
  return SCHOOL_TABS.find((tab) => tab.value === value)?.value ?? 'timetable'
}

// 학교를 아직 안 골랐을 때 어느 탭에서나 보여 주는 안내
const SCHOOL_MISSING_TEXT =
  '가입할 때 학교를 고르면 시간표 · 급식 · 학교 일정 · 공지가 여기에 떠요.'

// 시연 예시 · 출처 안내. 학교 묶음 안의 작은 회색 한 줄로 둡니다. (눈에 띌 필요가 없는 정보)
const schoolNoteClass = 'mt-3 text-[13px] break-keep text-slate-500'

interface SchoolInfoSectionProps {
  todayKey: string
}

/**
 * ② 학교 정보 한 묶음: 위의 세그먼트 탭(시간표 | 급식 | 일정 | 공지)으로 하나만 펼칩니다. (2026-10-22, 2026-10-27 맨 위로)
 * 학교 정보는 "보고 지나가는" 정보라, 네 칸을 다 쌓지 않고 하나만 보여 줘서 홈을 짧게 합니다. (힉의 법칙)
 * 고른 탭은 주소에 둡니다. (/?school=meal) 새로고침해도 보던 탭이 그대로입니다.
 */
function SchoolInfoSection({ todayKey }: SchoolInfoSectionProps) {
  // replace: 탭을 여러 번 바꿔도 뒤로 가기 한 번이면 홈을 떠납니다. (공지 칩 ?notice= 와 같게)
  const [schoolParam, setSchoolParam] = useQueryParam('school', 'timetable', {
    replace: true,
  })
  const tab = toSchoolTab(schoolParam)

  return (
    <section className={quietCardClass}>
      {/* 탭 이름이 묶음 제목을 대신해서, 제목은 화면 낭독기에만 읽어 줍니다. */}
      <h2 className="sr-only">학교 정보</h2>
      <SegmentedToggle
        label="학교 정보 고르기"
        options={SCHOOL_TABS}
        value={tab}
        onChange={setSchoolParam}
      />
      <div className="mt-3">
        {/* 공지는 시간표 · 급식과 서버 주소가 달라서 따로 받습니다. */}
        {tab === 'notices' ? (
          <SchoolNoticesSection todayKey={todayKey} />
        ) : (
          <SchoolTodaySection todayKey={todayKey} tab={tab} />
        )}
      </div>
    </section>
  )
}

interface SchoolTodaySectionProps {
  todayKey: string
  /** 펼친 탭 (공지 탭은 SchoolNoticesSection 이 그림) */
  tab: Exclude<SchoolTab, 'notices'>
}

/**
 * 오늘 시간표 · 급식 · 다가오는 일정입니다. 서버에서 받는 동안은 스켈레톤, 못 받으면 안내를 보여 줍니다. (AsyncBoundary)
 * 홈은 시간표를 보여 주기만 합니다. 학년 · 반은 설정의 계정 묶음에서 정합니다. (2026-10-19 "반 저장도 설정에서 해, 홈에선 시간표만")
 * 반을 아직 안 정했으면 시간표 자리에 설정으로 가는 링크가 나옵니다. 반은 이 기기에만 저장합니다. (lib/schoolToday.ts)
 */
function SchoolTodaySection({ todayKey, tab }: SchoolTodaySectionProps) {
  const isServerData = useIsServerData()
  // 설정에서 정한 반. 홈에서는 바꾸지 않아서 처음에 한 번만 읽습니다.
  const [schoolClass] = useState(loadSchoolClass)

  return (
    <AsyncBoundary
      pendingFallback={<SchoolInfoSkeleton text="학교 정보를 불러오는 중이에요" />}
      errorMessage="학교 정보를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요."
      resetKeys={[schoolClass?.grade, schoolClass?.classNo]}
    >
      <SchoolTodayView
        todayKey={todayKey}
        tab={tab}
        isServerData={isServerData}
        schoolClass={schoolClass}
      />
    </AsyncBoundary>
  )
}

interface SchoolInfoSkeletonProps {
  /** 화면 낭독기에 읽어 줄 글 */
  text: string
}

/** 학교 묶음 안을 받는 동안 보여 주는 회색 상자 */
function SchoolInfoSkeleton({ text }: SchoolInfoSkeletonProps) {
  return (
    <div role="status">
      <span className="sr-only">{text}</span>
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  )
}

interface SchoolTodayViewProps {
  todayKey: string
  tab: Exclude<SchoolTab, 'notices'>
  isServerData: boolean
  schoolClass: SchoolClass | null
}

function SchoolTodayView({ todayKey, tab, isServerData, schoolClass }: SchoolTodayViewProps) {
  const { data } = useSuspenseQuery(schoolTodayQuery(schoolClass, isServerData, todayKey))
  // 내 일정(대회 등, 코치 채팅에서 날짜를 알려 주면 생김 · lib/myEvents.ts)도 학교 일정과 같은 목록에 보여 줍니다.
  const [myEvents] = useState(() => getUpcomingMyEvents(todayKey, 60))
  // [괜찮아요] 로 닫은 시험들. 닫은 시험은 그 시험 동안 다시 제안하지 않습니다. (lib/schoolEvents.ts)
  const [dismissedReplans, setDismissedReplans] = useState(loadDismissedReplans)
  const myRows: UpcomingRow[] = myEvents.map((event) => ({
    key: `mine-${event.name}`,
    name: event.name,
    start: event.date,
    end: event.date,
    kind: 'mine',
    dDay: event.dDay,
  }))

  if (data.school === null) {
    return (
      <>
        {/* 학교가 없어도 내 일정은 일정 탭에서 볼 수 있습니다. */}
        {tab === 'events' && myRows.length > 0 && <UpcomingList rows={myRows} />}
        <p className="text-[15px] break-keep text-slate-500">{SCHOOL_MISSING_TEXT}</p>
      </>
    )
  }

  // 시연 예시는 반을 안 골라도 시간표를 보여 줍니다. (서버 없이 바로 시연되게)
  const needsClass = !data.isDemo && schoolClass === null
  // 같은 이름이 이어지는 날(시험 3일 등)은 한 줄로 묶고, 내 학년 행사만 남깁니다.
  const periods = groupEventPeriods(
    filterForGrade(
      data.events.map((event) => ({ ...event, content: null })),
      schoolClass?.grade ?? gradeNumberOf(loadOnboardingAnswers()?.grade),
    ),
  )
  // 학교 일정과 내 일정을 남은 날 순서로 합쳐 5개까지 보여 줍니다.
  const rows: UpcomingRow[] = [
    ...periods.map((period): UpcomingRow => ({
      key: `school-${period.start}-${period.name}`,
      name: period.name,
      start: period.start,
      end: period.end,
      kind: period.exam ? 'exam' : 'school',
      dDay: countDays(todayKey, period.start) - 1,
    })),
    ...myRows,
  ]
    .sort((a, b) => a.dDay - b.dDay)
    .slice(0, 5)
  // 다음 시험이 14일 안이면 시험 계획을 짜자고 제안합니다. 시험은 중요해서 어느 탭을 펼쳐도 위에 보여 줍니다.
  // (카드 탭의 "학교 일정" 칸에 있던 것을 홈으로 옮겼습니다. 학사일정 목록은 이 묶음의 [일정] 탭에 이미 있습니다, #739)
  const nextExam = getNextExamPeriod(periods, todayKey)
  const showReplan = shouldSuggestReplan(nextExam, todayKey, dismissedReplans)

  return (
    <>
      {showReplan && nextExam && (
        <ExamPlanSuggestion
          exam={nextExam}
          todayKey={todayKey}
          onDismiss={() => setDismissedReplans(dismissReplan(nextExam))}
        />
      )}
      {tab === 'timetable' &&
        (needsClass ? (
          <>
            <p className="text-[15px] break-keep text-slate-500">
              설정에서 학년 · 반을 정하면 오늘 시간표가 여기에 떠요.
            </p>
            <Link to="/settings" className={textLinkClass}>
              설정에서 반 정하기 ›
            </Link>
          </>
        ) : data.timetable === null || data.timetable.length === 0 ? (
          <>
            <p className="text-[15px] text-slate-500">오늘은 수업이 없어요.</p>
            {/* 우리 학교에 없는 반(예: 예전에 고른 30반)이면 늘 비어 보여서, 반을 확인하는 길을 둡니다. (2026-10-23) */}
            {schoolClass && !data.isDemo && (
              <Link to="/settings" className={textLinkClass}>
                {schoolClass.grade}학년 {schoolClass.classNo}반이 맞는지 설정에서 확인하기 ›
              </Link>
            )}
          </>
        ) : (
          <>
            {/* 주말에는 서버가 다음 월요일 시간표를 줘서 "월요일 시간표" 로 적습니다. (schoolDay, 2026-10-22) */}
            <p className="mb-2 text-[13px] font-semibold text-slate-500">
              {dayLabelOf(data.schoolDay, todayKey)} 시간표
            </p>
            {/* 자리를 덜 차지하게 두 칸으로 놓습니다. 교시 번호가 있어서 순서는 번호로 읽습니다. (1 2 / 3 4 / …) */}
            <ol className="grid grid-cols-2 gap-x-3 gap-y-1">
              {data.timetable.map((period) => (
                <li key={period.period} className="flex min-h-9 min-w-0 items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600 tabular-nums">
                    {period.period}
                  </span>
                  <span className="min-w-0 truncate text-[15px] text-slate-900">
                    {period.subject}
                  </span>
                </li>
              ))}
            </ol>
            {/* 어느 반 시간표인지 글자로만 보여 줍니다. 반은 설정에서 바꿉니다. */}
            <p className="mt-2 text-[13px] break-keep text-slate-500">
              {data.schoolDay !== data.date && '주말이라 다음 수업일 시간표를 미리 보여 줘요. '}
              {schoolClass && !data.isDemo
                ? `${schoolClass.grade}학년 ${schoolClass.classNo}반 시간표예요.`
                : '반 시간표 기준이에요.'}{' '}
              선택과목은 다를 수 있어요.
              {data.timetablePartial && ' 지금은 5교시까지만 보여요.'}
            </p>
          </>
        ))}

      {tab === 'meal' &&
        (data.meals.length === 0 ? (
          <p className="text-[15px] text-slate-500">오늘 · 내일 급식 정보가 없어요.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100">
            {data.meals.map((meal) => (
              <li
                key={`${meal.date}-${meal.kind}`}
                className="flex min-h-12 items-center gap-3 py-2"
              >
                <span aria-hidden className={quietIconClass}>
                  🍚
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-slate-900">
                    {dayLabelOf(meal.date, todayKey)} {meal.kind}
                  </span>
                  <span className="line-clamp-2 block text-sm break-keep text-slate-500">
                    {meal.dishes.join(' · ')}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ))}

      {tab === 'events' && <UpcomingList rows={rows} />}

      {data.isDemo && (
        <p className={schoolNoteClass}>
          시연용 예시 — 테스트 로그인이라 서버 대신 정해 둔 학교 정보를 보여 줘요
        </p>
      )}
    </>
  )
}

/** "다가오는 일정" 한 줄: 학교 일정(시험 · 행사) 또는 내 일정 */
interface UpcomingRow {
  key: string
  name: string
  start: string
  end: string
  kind: 'exam' | 'school' | 'mine'
  /** 오늘부터 며칠 남았는지 (오늘이면 0) */
  dDay: number
}

interface UpcomingListProps {
  rows: UpcomingRow[]
}

/** 다가오는 일정 목록. 시험 · 내 일정은 D-day 를 진한 글자로, 학교 행사는 회색으로 보여 줍니다. */
interface ExamPlanSuggestionProps {
  exam: SchoolEventPeriod
  todayKey: string
  /** [괜찮아요] 를 눌렀을 때 */
  onDismiss: () => void
}

/** 시험이 14일 안일 때 "시험 계획 짜기" 제안. 누르면 계획 방이 시험 날까지의 긴 계획을 바로 짭니다. */
function ExamPlanSuggestion({ exam, todayKey, onDismiss }: ExamPlanSuggestionProps) {
  const navigate = useNavigate()
  const daysLeft = Math.max(0, daysUntilKey(exam.start, todayKey))

  function handlePlan() {
    // 계획 방에 "시험 이름 · 시험 시작 날" 로 긴 계획 칩을 맡깁니다. (계획 방이 열리면서 대신 눌러 줌)
    navigate(
      handOffPlanChip({
        kind: 'makePlan',
        label: `📅 ${exam.name} 계획 짜 줘`,
        goal: exam.name,
        endDate: exam.start,
      }),
    )
  }

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm break-keep text-amber-900">
        {exam.name}까지 {daysLeft}일 남았어요. 시험 범위에 맞춰 계획을 짜 볼까요?
      </p>
      {/* 모바일은 버튼 두 개를 꽉 채워 나란히, sm 부터는 왼쪽에 모읍니다. */}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={handlePlan}>
          📅 시험 계획 짜기
        </Button>
        <Button variant="ghost" size="sm" className="flex-1 sm:flex-none" onClick={onDismiss}>
          괜찮아요
        </Button>
      </div>
    </div>
  )
}

function UpcomingList({ rows }: UpcomingListProps) {
  if (rows.length === 0) {
    return <p className="text-[15px] text-slate-500">30일 안에 일정이 없어요.</p>
  }
  return (
    <ul className="flex flex-col divide-y divide-slate-100">
      {rows.map((row) => (
        <li key={row.key} className="flex min-h-12 items-center gap-3 py-2">
          <span aria-hidden className={quietIconClass}>
            {row.kind === 'exam' ? '📝' : row.kind === 'mine' ? '⭐' : '📅'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-slate-900">
              {row.name}
            </span>
            <span className="block text-[13px] text-slate-500 tabular-nums">
              {formatMonthDay(row.start)}
              {row.end !== row.start && ` ~ ${formatMonthDay(row.end)}`}
              {row.kind === 'mine' && ' · 내 일정'}
            </span>
          </span>
          <span
            className={cn(
              'shrink-0 text-[15px] font-bold tabular-nums',
              row.kind === 'school' ? 'text-slate-500' : 'text-slate-900',
            )}
          >
            {row.dDay === 0 ? '오늘' : `D-${row.dDay}`}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** 홈에서 처음에 보여 줄 공지 개수. 더 있으면 [n개 더 보기] 를 붙입니다. */
const NOTICE_PREVIEW_COUNT = 5

interface SchoolNoticesSectionProps {
  todayKey: string
}

/**
 * 학교 공지 탭. 서버가 학교 홈페이지에서 하루 한 번 받아 둔 가정통신문 · 공지사항 제목입니다. (lib/schoolNotices.ts)
 * 사용자: "학교 공지도 보여주게 해야 되는데", "내가 참여할 대회? 관심있는 대회?" (2026-10-19)
 * NEIS 공개 API 에는 공지가 없어서 서버가 홈페이지를 직접 읽습니다.
 */
function SchoolNoticesSection({ todayKey }: SchoolNoticesSectionProps) {
  return (
    <AsyncBoundary
      pendingFallback={<SchoolInfoSkeleton text="학교 공지를 불러오는 중이에요" />}
      errorMessage="학교 공지를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요."
    >
      <SchoolNoticesView todayKey={todayKey} />
    </AsyncBoundary>
  )
}

/** 화면에 그릴 공지 한 줄 (대회 글인지 · 내가 준비하는 대회인지를 붙임) */
interface NoticeRow extends SchoolNotice {
  isContest: boolean
  isMine: boolean
}

interface SchoolNoticesViewProps {
  todayKey: string
}

function SchoolNoticesView({ todayKey }: SchoolNoticesViewProps) {
  const isServerData = useIsServerData()
  const { data } = useSuspenseQuery(schoolNoticesQuery(isServerData, todayKey))
  // [전체] · [🏆 대회] 중 무엇을 보는지, 더 보기를 펼쳤는지는 주소에 둡니다. (/?school=notices&notice=contest&noticeMore=open)
  const [noticeParam, setNoticeParam] = useQueryParam('notice', 'all', {
    replace: true,
  })
  const [moreParam, setMoreParam] = useQueryParam('noticeMore', 'closed', {
    replace: true,
  })
  // "내가 준비하는 것" 을 대회·자격증으로 골랐으면 그 이름(예: 정보올림피아드)이 들어간 글을 맨 위로 올립니다. (lib/studyFocus.ts)
  const [focusName] = useState(() => {
    const focus = loadStudyFocus()
    return focus?.kind === 'CONTEST' ? focus.name : null
  })

  // 학교를 안 골랐으면 다른 탭과 같은 안내를 보여 줍니다.
  if (data.school === null) {
    return <p className="text-[15px] break-keep text-slate-500">{SCHOOL_MISSING_TEXT}</p>
  }

  const rows: NoticeRow[] = data.notices.map((notice) => {
    const isMine = matchesFocusName(notice.title, focusName)
    // 내가 준비하는 대회·자격증 글은 제목에 '대회' 가 없어도 대회 글로 봅니다. (예: '컴퓨터활용능력 시험 안내')
    return {
      ...notice,
      isContest: isMine || isContestNotice(notice.title),
      isMine,
    }
  })
  // 내 대회 글을 먼저, 나머지는 서버가 준 순서(최근 글 먼저) 그대로 둡니다.
  const sortedRows = [...rows.filter((row) => row.isMine), ...rows.filter((row) => !row.isMine)]
  const contestCount = rows.filter((row) => row.isContest).length
  // 주소는 누구나 고칠 수 있어서, 'contest' 이면서 대회 글이 하나라도 있을 때만 대회 글만 보여 줍니다.
  const isContestOnly = noticeParam === 'contest' && contestCount > 0
  const visibleRows = isContestOnly ? sortedRows.filter((row) => row.isContest) : sortedRows
  const isMoreOpen = moreParam === 'open'
  const shownRows = isMoreOpen ? visibleRows : visibleRows.slice(0, NOTICE_PREVIEW_COUNT)

  return (
    <>
      {rows.length === 0 ? (
        <p className="text-[15px] break-keep text-slate-500">
          {data.fetchedAt === null
            ? '아직 학교 홈페이지에서 공지를 못 가져왔어요. 홈페이지 모양이 달라서 못 읽는 학교일 수도 있어요.'
            : '최근 30일 동안 올라온 공지가 없어요.'}
        </p>
      ) : (
        <>
          {/* 대회 글이 있을 때만 고르는 버튼을 보여 줍니다. (flex-wrap: 좁은 화면에서 넘치면 다음 줄로) */}
          {contestCount > 0 && (
            <div role="group" aria-label="공지 고르기" className="mb-1 flex flex-wrap gap-2">
              <ChipButton selected={!isContestOnly} onClick={() => setNoticeParam('all')}>
                {`전체 ${rows.length}`}
              </ChipButton>
              <ChipButton selected={isContestOnly} onClick={() => setNoticeParam('contest')}>
                {`🏆 대회 ${contestCount}`}
              </ChipButton>
            </div>
          )}

          <ul className="flex flex-col divide-y divide-slate-100">
            {shownRows.map((row, index) => (
              <NoticeRowItem key={`${row.kind}-${row.date}-${row.title}-${index}`} row={row} />
            ))}
          </ul>

          {visibleRows.length > NOTICE_PREVIEW_COUNT && (
            <button
              type="button"
              onClick={() => setMoreParam(isMoreOpen ? 'closed' : 'open')}
              className="mt-1 h-10 w-full cursor-pointer rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-100"
            >
              {isMoreOpen ? '접기' : `${visibleRows.length - NOTICE_PREVIEW_COUNT}개 더 보기`}
            </button>
          )}
        </>
      )}

      <p className={schoolNoteClass}>
        학교 홈페이지에서 하루 한 번 제목만 가져와요.
        {data.isDemo && ' 지금은 시연용 예시예요.'}
      </p>
    </>
  )
}
interface NoticeRowItemProps {
  row: NoticeRow
}

/** 공지 한 줄: 이모지 · 제목 · 날짜와 게시판. 주소가 있으면 누를 때 학교 홈페이지 글이 새 창으로 열립니다. */
function NoticeRowItem({ row }: NoticeRowItemProps) {
  const icon = row.isContest ? '🏆' : row.kind === '가정통신문' ? '📄' : '📢'
  const content = (
    <>
      <span aria-hidden className={quietIconClass}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block text-[15px] font-semibold break-keep text-slate-900">
          {row.title}
        </span>
        <span className="block text-sm text-slate-500">
          {formatMonthDay(row.date)} · {row.kind}
          {row.isMine && (
            <span className="font-semibold text-slate-700"> · 내가 준비하는 대회</span>
          )}
        </span>
      </span>
      {row.url && (
        <span aria-hidden className="shrink-0 text-slate-400">
          ›
        </span>
      )}
    </>
  )

  return (
    <li>
      {row.url ? (
        // 학교 홈페이지는 우리 앱 밖이라 새 창으로 엽니다. noopener: 열린 창이 우리 화면을 건드리지 못하게 합니다.
        <a
          href={row.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-12 items-center gap-3 rounded-xl py-1 active:bg-slate-50"
        >
          {content}
        </a>
      ) : (
        <div className="flex min-h-12 items-center gap-3 py-1">{content}</div>
      )}
    </li>
  )
}

/** 'YYYY-MM-DD' → '11월 2일' */
function formatMonthDay(dateKey: string): string {
  const [, month, day] = dateKey.split('-').map(Number)
  return `${month}월 ${day}일`
}
