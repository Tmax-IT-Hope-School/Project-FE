import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { SchoolEventsCard } from '@/components/ui/SchoolEventsCard'
import { SegmentedToggle } from '@/components/ui/SegmentedToggle'
import { StickyActionBar } from '@/components/ui/StickyActionBar'
import { useCards } from '@/hooks/useCards'
import { useGoals } from '@/hooks/useGoals'
import { useQueryParam } from '@/hooks/useQueryParam'
import { useStudySessions } from '@/hooks/useStudySessions'
import { CARD_RESULT_LABELS } from '@/lib/cardResult'
import { loadCardMarks } from '@/lib/cardMarks'
import { getCardsOnDate } from '@/lib/cards'
import { NO_FIXED_BLOCKS } from '@/lib/fixedBlocks'
import {
  formatDayClock,
  formatWeekLabel,
  getCardDayStatus,
  getDayTimeline,
  getFlexibleCardsToShrink,
  getTimelineBlockHeight,
  getWeekDateKeys,
} from '@/lib/cardTimeline'
import { cn } from '@/lib/cn'
import { getTodayKey, isDateKey, moveDateKey } from '@/lib/date'
import { formatDday, getDaysUntil } from '@/lib/exams'
import { MAX_ACTIVE_GOALS } from '@/lib/goals'
import { getCardDayMarkInfo, loadRestDays } from '@/lib/restDays'
import { getWeekday, getWeekdayName } from '@/lib/routines'
import type { Card as CardData, FixedBlock, Goal, StudySession } from '@/types'
import { useState } from 'react'
import { Link } from 'react-router-dom'

/** 분을 '10분' · '1시간' · '1시간 30분' 처럼 보여줍니다. (플래너의 "빈 시간" 에 씁니다) */
function formatGap(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}분`
  if (minutes === 0) return `${hours}시간`
  return `${hours}시간 ${minutes}분`
}

interface GoalListProps {
  /** 진행 중인 목표 (보통 최대 3개. 서버 · 시연 데이터 때문에 더 많을 수도 있음) */
  goals: Goal[]
}

/** 진행 중인 목표 목록과 [목표 만들기] 버튼 (최종 기획서 3장 카드 탭 「목표 목록(최대 3개)」, #391) */
function GoalList({ goals }: GoalListProps) {
  const isFull = goals.length >= MAX_ACTIVE_GOALS
  // 서버나 시연 데이터로 진행 중 목표가 3개보다 많이 들어올 수 있습니다.
  // 그때 '목표 9/3' 은 헷갈려서, 개수만 '목표 9개' 로 보여 주고 아래에 권하는 수를 한 줄로 적습니다. (#672)
  const isOverMax = goals.length > MAX_ACTIVE_GOALS
  const title = isOverMax ? `목표 ${goals.length}개` : `목표 ${goals.length}/${MAX_ACTIVE_GOALS}`
  return (
    <Card title={title}>
      {goals.length === 0 ? (
        <p className="text-[15px] break-keep text-slate-500">
          아직 목표가 없어요. 목표를 세우면 카드를 목표별로 묶어서 볼 수 있어요.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100">
          {goals.map((goal) => (
            <li key={goal.id}>
              {/* 누르면 목표 상세(진척 · 2주 점검, #403)로 갑니다. */}
              <Link
                to={`/goals/${goal.id}`}
                className="-mx-2 flex min-h-11 items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50"
              >
                <span className="text-brand w-14 shrink-0 text-sm font-semibold tabular-nums">
                  {formatDday(getDaysUntil(goal.dDay))}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-slate-900">
                  {goal.title}
                </span>
                <span className="shrink-0 text-xs text-slate-500">
                  {goal.kind === 'score' ? '점수형' : '완주형'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {isFull ? (
        <p className="mt-3 text-xs break-keep text-slate-500">
          {isOverMax
            ? `목표는 동시에 ${MAX_ACTIVE_GOALS}개까지 권해요.`
            : `목표는 동시에 ${MAX_ACTIVE_GOALS}개까지예요.`}
        </p>
      ) : (
        <Link
          to="/goals/new"
          className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-xl bg-slate-100 px-4 text-sm font-semibold text-slate-900 hover:bg-slate-200 active:scale-[0.98]"
        >
          + 목표 만들기
        </Link>
      )}
    </Card>
  )
}

/** 일 · 주 타임라인 보기 (#394). 주소의 ?period= 에 둡니다 */
type CardPeriod = 'day' | 'week'

const periodOptions: { value: CardPeriod; label: string }[] = [
  { value: 'day', label: '일' },
  { value: 'week', label: '주' },
]

/**
 * 목표별 블록 색. 진행 중인 목표의 순서(최대 3개)대로 씁니다.
 * 색만으로 구분하지 않게 블록 안에 목표 이름도 글자로 씁니다.
 */
const GOAL_BLOCK_STYLES = [
  'border-blue-300 bg-blue-50 text-blue-900',
  'border-violet-300 bg-violet-50 text-violet-900',
  'border-amber-300 bg-amber-50 text-amber-900',
]
const GOAL_DOT_STYLES = ['bg-blue-400', 'bg-violet-400', 'bg-amber-400']
/** 목표가 없거나 끝난 목표의 카드 */
const NO_GOAL_BLOCK_STYLE = 'border-slate-200 bg-white text-slate-900'

interface CardTimelineProps {
  cards: CardData[]
  fixedBlocks: FixedBlock[]
  /** 진행 중인 목표 (색 순서) */
  goals: Goal[]
  /** 공부 기록. 블록에 그날 한 시간과 결과를 붙입니다 */
  sessions: StudySession[]
  dateKey: string
  todayKey: string
  period: CardPeriod
  onChangePeriod: (period: CardPeriod) => void
  onSelectDate: (dateKey: string) => void
}

/**
 * 카드 탭의 일 · 주 타임라인 (최종 기획서 「4.3 카드」, #394).
 * 목표별 색 + 목표 이름, 절대 카드는 "절대" 글자, 학교·학원 고정 일정은 회색 블록입니다.
 * 계산(순서 · 빈 시간 · 겹침 · 높이)은 lib/cardTimeline.ts 가 합니다.
 */
function CardTimeline({
  cards,
  fixedBlocks,
  goals,
  sessions,
  dateKey,
  todayKey,
  period,
  onChangePeriod,
  onSelectDate,
}: CardTimelineProps) {
  // 결과(제때 했어요 · 미뤘어요 …)를 정할 지금 시각과 휴식·미루기 표시는 화면을 열 때 한 번만 읽습니다.
  const [now] = useState(() => Date.now())
  const [restDays] = useState(loadRestDays)
  const [cardMarks] = useState(loadCardMarks)
  const weekKeys = getWeekDateKeys(dateKey)

  function getGoalIndex(card: CardData): number {
    return goals.findIndex((goal) => goal.id === card.goalId)
  }

  /** 하루치 블록 목록. 일 보기와 모바일 주 보기(고른 날)가 같이 씁니다. */
  function renderDay(dayKey: string) {
    const { items, unscheduled } = getDayTimeline(cards, fixedBlocks, dayKey)
    const cardsToShrink = getFlexibleCardsToShrink(items)
    if (items.length === 0 && unscheduled.length === 0) {
      return (
        <p className="text-[15px] break-keep text-slate-500">
          이 날은 카드가 없어요. 아래 [+ 카드 만들기] 로 하나 만들어 볼까요?
        </p>
      )
    }
    return (
      <div className="flex flex-col gap-3">
        {/* 일정이 넘치면(시간이 겹치면) 유연 카드부터 줄여 보자고 합니다. 절대 카드는 그대로 둡니다. (「4.3」) */}
        {cardsToShrink.length > 0 && (
          // 경고는 노란 바탕 + 진한 노란 선 + ⚠ 로 한눈에 보이게. 고치기 버튼은 흰 선 버튼(outline)입니다.
          <div
            role="status"
            className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm break-keep text-amber-900"
          >
            <p className="flex items-start gap-2 font-semibold">
              <span aria-hidden>⚠</span>
              <span>시간이 겹쳐요. 유연 카드부터 줄여 볼까요?</span>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {cardsToShrink.map((card) => (
                <Link
                  key={card.id}
                  to={`/cards/${card.id}/edit`}
                  className="inline-flex h-10 max-w-full items-center rounded-xl border border-amber-300 bg-white px-3 font-medium text-slate-900 hover:bg-amber-100 active:scale-[0.98]"
                >
                  <span className="truncate">{card.title} 고치기</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        <ol className="flex flex-col gap-2">
          {items.map((item) => {
            const height = getTimelineBlockHeight(item)
            const timeRange = `${formatDayClock(item.start)}~${formatDayClock(item.end)}`
            return (
              <li
                key={item.kind === 'card' ? item.card.id : item.block.id}
                className="flex flex-col gap-2"
              >
                {/* pl-14: 시각 칸(48px) + 간격(8px)만큼 들여써서 블록과 줄을 맞춥니다. */}
                {item.gapBeforeMinutes > 0 && (
                  <p className="pl-14 text-xs text-slate-500">
                    빈 시간 {formatGap(item.gapBeforeMinutes)}
                  </p>
                )}
                <div className="flex gap-2">
                  <span className="w-12 shrink-0 pt-2 text-sm text-slate-500 tabular-nums">
                    {formatDayClock(item.start)}
                  </span>
                  {item.kind === 'fixed' ? (
                    // 고정 일정: 타이머가 없어서 누를 수 없는 회색 블록입니다. 최소 높이는 계산한 숫자라 style 을 씁니다.
                    <div
                      className="flex min-w-0 flex-1 items-start justify-between gap-2 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500"
                      style={{ minHeight: height }}
                    >
                      <span className="min-w-0 truncate font-medium">
                        고정 · {item.block.title}
                      </span>
                      <span className="shrink-0 tabular-nums">{timeRange}</span>
                    </div>
                  ) : (
                    renderCardBlock(item.card, dayKey, timeRange, item.isOverlapping, height)
                  )}
                </div>
              </li>
            )
          })}
        </ol>

        {unscheduled.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-slate-700">시간 미정</p>
            {unscheduled.map((card) => (
              <div key={card.id} className="flex">
                {renderCardBlock(card, dayKey, `${card.durationMinutes}분`, false, undefined)}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  /** 카드 블록 하나. 누르면 고치는 화면으로 갑니다. */
  function renderCardBlock(
    card: CardData,
    dayKey: string,
    timeRange: string,
    isOverlapping: boolean,
    height: number | undefined,
  ) {
    const goalIndex = getGoalIndex(card)
    const status = getCardDayStatus(
      card,
      dayKey,
      sessions,
      now,
      getCardDayMarkInfo(card.id, dayKey, restDays, cardMarks)?.mark,
    )
    // 한 것이 있으면 "45 / 60분", 아직이면 시간만
    const doneText =
      status.doneMinutes > 0 ? ` · ${status.doneMinutes} / ${card.durationMinutes}분` : ''
    return (
      <Link
        to={`/cards/${card.id}/edit`}
        className={cn(
          'flex min-h-12 min-w-0 flex-1 flex-col gap-1 rounded-xl border px-3 py-2 text-sm hover:brightness-95',
          goalIndex >= 0 ? GOAL_BLOCK_STYLES[goalIndex] : NO_GOAL_BLOCK_STYLE,
          isOverlapping && 'border-2 border-amber-500',
        )}
        // 블록 높이는 카드 길이와 비례하는 숫자라 style 을 씁니다.
        // height 대신 minHeight: 짧은 카드라도 글자 두 줄이 잘리지 않고 블록이 늘어납니다.
        style={height === undefined ? undefined : { minHeight: height }}
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-semibold">{card.title}</span>
          {card.priority === 'absolute' && (
            <span className="shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
              절대
            </span>
          )}
        </span>
        {/* 결과까지 다 보이게 줄을 바꿔 씁니다. (블록은 minHeight 라서 같이 늘어납니다) */}
        <span className="text-xs break-keep tabular-nums opacity-80">
          {goalIndex >= 0 ? `${goals[goalIndex].title} · ` : ''}
          {timeRange}
          {doneText}
          {status.result ? ` · ${CARD_RESULT_LABELS[status.result]}` : ''}
          {isOverlapping ? ' · 시간 겹침' : ''}
        </span>
      </Link>
    )
  }

  /** PC 주 보기의 한 칸 (요일 한 칸에 그날 블록을 짧게) */
  function renderWeekColumn(dayKey: string) {
    const { items, unscheduled } = getDayTimeline(cards, fixedBlocks, dayKey)
    return (
      <ul className="flex flex-col gap-1">
        {items.map((item) =>
          item.kind === 'fixed' ? (
            <li
              key={item.block.id}
              className="truncate rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-xs text-slate-500 tabular-nums"
            >
              {formatDayClock(item.start)} 고정 · {item.block.title}
            </li>
          ) : (
            <li key={item.card.id}>{renderWeekCard(item.card, formatDayClock(item.start))}</li>
          ),
        )}
        {unscheduled.map((card) => (
          <li key={card.id}>{renderWeekCard(card, '시간 미정')}</li>
        ))}
      </ul>
    )
  }

  function renderWeekCard(card: CardData, timeText: string) {
    const goalIndex = getGoalIndex(card)
    return (
      <Link
        to={`/cards/${card.id}/edit`}
        className={cn(
          'flex flex-col rounded-lg border px-2 py-1 text-xs hover:brightness-95',
          goalIndex >= 0 ? GOAL_BLOCK_STYLES[goalIndex] : NO_GOAL_BLOCK_STYLE,
        )}
      >
        <span className="tabular-nums opacity-80">
          {timeText}
          {card.priority === 'absolute' && <strong className="ml-1 text-red-700">절대</strong>}
        </span>
        <span className="truncate font-medium">{card.title}</span>
      </Link>
    )
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] font-semibold text-slate-900">카드 일정</h2>
        <SegmentedToggle
          label="타임라인 보기"
          options={periodOptions}
          value={period}
          onChange={onChangePeriod}
          className="w-36"
        />
      </div>

      {/* 목표 색 안내. 블록 안에도 목표 이름을 씁니다. */}
      {goals.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
          {goals.map((goal, index) => (
            <li key={goal.id} className="flex min-w-0 items-center gap-1">
              <span
                aria-hidden="true"
                className={cn('h-2.5 w-2.5 shrink-0 rounded-full', GOAL_DOT_STYLES[index])}
              />
              <span className="truncate">{goal.title}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        {period === 'day' ? (
          renderDay(dateKey)
        ) : (
          <>
            {/* 모바일 · 태블릿: 요일 한 줄 + 고른 날 목록. 가로 스크롤 없이 375px 에 들어갑니다. */}
            <div className="flex flex-col gap-4 lg:hidden">
              <div role="group" aria-label="요일 고르기" className="grid grid-cols-7 gap-1">
                {weekKeys.map((key) => {
                  const count = getCardsOnDate(cards, key).length
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={key === dateKey}
                      onClick={() => onSelectDate(key)}
                      className={cn(
                        'flex min-h-12 cursor-pointer flex-col items-center justify-center rounded-xl border text-xs',
                        key === dateKey
                          ? 'border-brand bg-brand-light text-brand ring-brand font-semibold ring-1'
                          : 'border-slate-200 bg-white text-slate-600',
                      )}
                    >
                      <span>
                        {getWeekdayName(getWeekday(key))}
                        {key === todayKey ? '·오늘' : ''}
                      </span>
                      <span className="tabular-nums">{count > 0 ? `${count}개` : '-'}</span>
                    </button>
                  )
                })}
              </div>
              {renderDay(dateKey)}
            </div>

            {/* PC: 요일 7칸 */}
            <div className="hidden lg:grid lg:grid-cols-7 lg:gap-2">
              {weekKeys.map((key) => (
                <div key={key} className="flex min-w-0 flex-col gap-2">
                  <button
                    type="button"
                    aria-pressed={key === dateKey}
                    onClick={() => onSelectDate(key)}
                    className={cn(
                      'h-10 cursor-pointer rounded-xl text-sm tabular-nums',
                      key === dateKey
                        ? 'bg-brand-light text-brand ring-brand font-semibold ring-1'
                        : 'text-slate-600 hover:bg-slate-50',
                    )}
                  >
                    {getWeekdayName(getWeekday(key))} {Number(key.slice(8))}
                    {key === todayKey ? ' · 오늘' : ''}
                  </button>
                  {renderWeekColumn(key)}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Card>
  )
}

/**
 * 카드 탭 화면(/cards)입니다. 옛 주소 /planner 로 들어와도 여기로 옵니다. (router.tsx)
 * 목표 목록(#391) → 카드 일·주 타임라인(#394) 순서입니다. (최종 기획서 「3 앱 구조」 카드 탭)
 * 계획 패턴 안내(#394)는 시연 범위 밖이라 2026-10-18 에 지웠습니다.
 */
export function CardsPage() {
  const todayKey = getTodayKey()
  // 카드 (최종 기획서 「4.3」, #392)
  const { cards } = useCards()
  // 목표 (최종 기획서 「4.7」, #391)
  const { activeGoals } = useGoals()
  // 공부 기록. 블록의 "한 시간" · 결과와 계획 패턴에 씁니다.
  const { sessions } = useStudySessions()

  // 보고 있는 날짜는 주소에 둡니다. (/cards = 오늘, /cards?date=2026-10-11 = 그날)
  // replace: ◀ ▶ 를 여러 번 눌러도 뒤로 가기 한 번이면 카드 화면을 떠납니다.
  const [dateParam, setSelectedDate] = useQueryParam('date', todayKey, { replace: true })
  // 주소는 누구나 고칠 수 있어서, 진짜 날짜가 아니면 오늘로 봅니다.
  const selectedDate = isDateKey(dateParam) ? dateParam : todayKey
  // 카드 타임라인을 하루로 볼지 한 주로 볼지도 주소에 둡니다. (/cards?period=week) (#394)
  const [periodParam, setPeriodParam] = useQueryParam('period', 'day', { replace: true })
  const period: CardPeriod = periodParam === 'week' ? 'week' : 'day'
  // ◀ ▶ 는 일 보기에서 하루, 주 보기에서 한 주씩 옮깁니다.
  const dateStep = period === 'week' ? 7 : 1
  const isToday = selectedDate === todayKey

  // 'ko-KR' 로 바꾸면 "10월 5일 일요일" 처럼 한국어 날짜가 됩니다.
  // 'YYYY-MM-DD' 문자열은 영국 시간으로 읽히므로, 년·월·일을 쪼개서 우리 시간대로 만듭니다.
  const [year, month, day] = selectedDate.split('-').map(Number)
  const dateLabel = new Date(year, month - 1, day).toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })
  // 주 보기에서는 "10월 12일 ~ 18일" 처럼 그 주의 월요일 ~ 일요일을 보여 줍니다.
  const weekLabel = formatWeekLabel(getWeekDateKeys(selectedDate))

  return (
    <div className="flex flex-col gap-6">
      <div>
        {/* 제목 줄: 왼쪽 "카드", 오른쪽 [오늘] (다른 날을 보고 있을 때 돌아오는 길) */}
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[28px] leading-tight font-bold tracking-tight">카드</h1>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedDate(todayKey)}
            disabled={isToday}
            className="text-brand shrink-0 px-3"
          >
            오늘
          </Button>
        </div>

        {/* 날짜 이동: ‹ / 날짜(주 보기면 그 주) / › */}
        {/* ‹ › 는 40px 네모 버튼(h-10 w-10)이라 엄지로 누르기 쉽습니다. (피츠의 법칙) */}
        <div className="mt-3 flex items-center gap-2 rounded-2xl bg-white p-1 ring-1 ring-slate-200">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedDate(moveDateKey(selectedDate, -dateStep))}
            aria-label={period === 'week' ? '지난주로 이동' : '어제로 이동'}
            className="w-10 shrink-0 px-0"
          >
            <span aria-hidden className="text-lg leading-none">
              ‹
            </span>
          </Button>
          <p className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold text-slate-900 tabular-nums sm:text-[17px]">
            {period === 'week' ? weekLabel : dateLabel}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedDate(moveDateKey(selectedDate, dateStep))}
            aria-label={period === 'week' ? '다음 주로 이동' : '내일로 이동'}
            className="w-10 shrink-0 px-0"
          >
            <span aria-hidden className="text-lg leading-none">
              ›
            </span>
          </Button>
        </div>
      </div>

      {/* 묶음 순서는 "매일 보는 것 → 가끔 보는 것" 입니다. (서열 위치 효과)
          날짜 이동 바로 아래에 그날 카드, 그다음 목표, 맨 아래에 학교 일정입니다. */}
      {/* 카드 일·주 타임라인 (#394). 타이머 대기 화면이 이 카드를 보여 줍니다 */}
      <CardTimeline
        cards={cards}
        // 고정 일정 입력은 2026-10-18 에 지웠습니다. 학교 시간표(NEIS)를 붙이면 여기에 넣습니다. (lib/fixedBlocks.ts)
        fixedBlocks={NO_FIXED_BLOCKS}
        goals={activeGoals}
        sessions={sessions}
        dateKey={selectedDate}
        todayKey={todayKey}
        period={period}
        onChangePeriod={setPeriodParam}
        onSelectDate={setSelectedDate}
      />

      {/* 진행 중인 목표 (#391) */}
      <GoalList goals={activeGoals} />

      {/* 학교 학사일정 · 시험이 다가오면 계획 다시 짜기 (#508) */}
      <SchoolEventsCard />

      {/* 1순위 [+ 카드 만들기] 는 모바일에서 하단 탭 바로 위(엄지 자리)에 붙여 둡니다. (피츠의 법칙) */}
      <StickyActionBar aboveTabBar className="flex-row gap-2">
        <Link
          to={`/cards/new?date=${selectedDate}`}
          className="bg-brand hover:bg-brand-dark inline-flex h-12 min-w-0 flex-1 items-center justify-center rounded-xl px-5 text-[15px] font-semibold text-white active:scale-[0.98]"
        >
          + 카드 만들기
        </Link>
        {/* 시험 범위표 · 학습지를 찍으면 AI 가 카드 여러 장을 나눠 줍니다. (pages/CardsFromPhotoPage.tsx) */}
        <Link
          to="/cards/photo"
          className="inline-flex h-12 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-[15px] font-semibold text-slate-900 hover:bg-slate-50 active:scale-[0.98]"
        >
          📸 사진으로
        </Link>
      </StickyActionBar>
    </div>
  )
}
