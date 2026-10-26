import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { ReasonChips } from '@/components/ui/ReasonChips'
import { Skeleton } from '@/components/ui/Skeleton'
import { UnderstandingBadge } from '@/components/ui/UnderstandingBadge'
import { useCards } from '@/hooks/useCards'
import { ApiError } from '@/lib/api'
import { loadSinceLastCall } from '@/lib/callCard'
import {
  getSplitMinuteOptions,
  loadCallCardActions,
  makeSplitCard,
  type CallCardAction,
} from '@/lib/callCardActions'
import { pastCallsQuery } from '@/lib/callHistoryApi'
import { recordFinishedCall } from '@/lib/callLog'
import {
  finishCall,
  readCallResultState,
  type CallConclusion,
  type CallResultState,
  type ThinkingHabit,
} from '@/lib/callReview'
import { loadTodayCallCard } from '@/lib/callSummary'
import { careThemes } from '@/lib/careTheme'
import { cn } from '@/lib/cn'
import { CARD_FAIL_CAUSES, addCardMark, type CardFailCause } from '@/lib/cardMarks'
import { splitUnderstanding } from '@/lib/checkCall'
import { getTodayKey, moveDateKey } from '@/lib/date'
import { isSafetyBrakeOnNow } from '@/lib/focusMode'
import { toggleReason } from '@/lib/reasons'
import { YOUTH_HELP_LINE } from '@/lib/helpLines'
import { loadAutoSettings } from '@/lib/settingsMapping'
import { getTodayCareLevel } from '@/lib/todayCare'
import type { Card as CardModel, ChecklistItem } from '@/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * 통화가 끝난 뒤 "오늘의 결론" 을 보여 주는 화면입니다. (BE 이슈 #28 · #29)
 *
 * 통화 화면이 넘겨준 통화 번호와 자막을 서버에 보내면, 서버가 정리해서 돌려줍니다. (lib/callReview.ts)
 *  - 대답에서 보인 생각 습관(인지편향): 이름 · 어떤 생각인지 · 근거 · 다음에 해 볼 행동
 *  - 통화 요약
 * 이 결론과 이 브라우저의 기록(어제 공부·오늘 체크인)을 합쳐 "오늘 통화 요약" 카드로 보여 줍니다.
 * (오늘의 약속 · 지난 약속 · 오늘 예상 순공은 v2 체크인과 함께 #417 에서 뺐습니다)
 * 위기 표현이 감지된 통화면 결론 대신 도움 안내를 먼저 보여 줍니다.
 *
 * 생각 습관의 이름은 "생각" 에 붙입니다. "너는 ~형이야" 처럼 사람에게 붙이지 않습니다.
 */
export function CallResultPage() {
  const location = useLocation()
  const navigate = useNavigate()
  // 처음 들어올 때 받은 값을 들고 있습니다. (정리가 끝나면 주소에 딸린 자막을 지우는데, 그 뒤에도 다시 시도할 수 있게)
  const [resultState] = useState(() => readCallResultState(location.state))
  // 지난 통화 이후 처리할 카드 (#415). 통화 기록을 적기 전(서버 정리 전)에 한 번만 모읍니다. (lib/callCardActions.ts)
  const [cardActions] = useState(() => loadCallCardActions(Date.now(), getTodayKey()))
  // 실패한 카드를 나눠 넣을지 묻는 때 — '통화 때' 면 여기서 묻습니다. (설정, #385)
  const [failedCardTiming] = useState(() => loadAutoSettings().failedCardTiming.value)
  // 카드 목록은 이 화면에서 한 번만 들고 아래 칸들에 넘깁니다. (칸마다 따로 들면 서로의 저장을 덮어씁니다)
  const { addCard, updateCard } = useCards()

  const queryClient = useQueryClient()
  // useMutation: 서버에 "통화를 마무리해 줘" 라고 보내는 요청입니다. 보내는 중·실패를 대신 관리해 줍니다. (docs/DATA-FETCHING.md 5장)
  const mutation = useMutation({
    mutationFn: async (state: CallResultState) => {
      const conclusion = await finishCall(state)
      // 통화가 끝났다고 적습니다. 다음 통화의 학생 카드는 이 시각 이후로 결산합니다. (#414, lib/callLog.ts)
      // 넣은 조건부 모듈은 통화를 시작할 때와 같은 기록으로 다시 계산합니다. (기록에 적기 전이라 같은 값이 나옵니다)
      recordFinishedCall(loadSinceLastCall().callModule, Date.now(), conclusion.summary)
      return { conclusion }
    },
    onSuccess: () => {
      // 지난 통화 목록(/call/history)에 방금 통화가 보이도록, 보관해 둔 목록을 "낡았다" 고 표시합니다.
      void queryClient.invalidateQueries({ queryKey: pastCallsQuery().queryKey })
      // 정리가 끝났으면 방문 기록에 남아 있는 자막을 지웁니다. (화면에 보이는 결론은 그대로입니다)
      navigate(location.pathname, { replace: true, state: null })
    },
  })
  const { mutate } = mutation

  // 화면에 들어오면 한 번만 보냅니다.
  // (개발 모드에서는 React 가 useEffect 를 두 번 부르는데, ref 는 그대로 남아서 두 번 보내지 않습니다)
  const hasSent = useRef(false)
  useEffect(() => {
    if (resultState === null || hasSent.current) return
    hasSent.current = true
    mutate(resultState)
  }, [resultState, mutate])

  function handleRetry() {
    if (resultState !== null) mutate(resultState)
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[28px] leading-snug font-bold tracking-tight sm:text-3xl">
        오늘의 통화 정리
      </h1>

      {resultState === null && (
        <Card>
          <p className="text-sm break-keep text-slate-700">
            정리할 통화가 없어요. 통화가 연결되지 않았거나, 서버에서 통화 번호를 받지 못했어요.
          </p>
        </Card>
      )}

      {resultState !== null && mutation.isPending && <ConclusionSkeleton />}

      {resultState !== null && mutation.isError && (
        <FinishError error={mutation.error} onRetry={handleRetry} />
      )}

      {mutation.isSuccess && <ConclusionView conclusion={mutation.data.conclusion} />}

      {/* 카드 처리는 위기 표현이 감지된 통화에서는 하지 않습니다. 도움 안내가 먼저입니다. */}
      {mutation.isSuccess && !mutation.data.conclusion.showHelp && (
        <>
          {cardActions.unhandled.length > 0 && (
            <UnhandledCardsSection
              items={cardActions.unhandled}
              askSplit={failedCardTiming === 'call'}
              onAddCard={addCard}
            />
          )}
          {cardActions.module === 'review4' && cardActions.missedCards.length > 0 && (
            <CardFixSection cards={cardActions.missedCards} onUpdateCard={updateCard} />
          )}
        </>
      )}

      {/* 모바일에서는 버튼을 위아래로, PC 에서는 나란히 놓습니다. */}
      {/* 정리가 끝났으면 다음 행동은 [내 기록 보기] 하나라서 이것만 채운 버튼으로 둡니다. (폰 레스토프)
          정리 중 · 실패일 때는 [다시 정리하기] 가 먼저라서 회색으로 낮춥니다. */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          size="lg"
          variant={mutation.isSuccess ? 'primary' : 'secondary'}
          className="w-full sm:w-auto"
          onClick={() => navigate('/records')}
        >
          내 기록 보기
        </Button>
        <Button
          size="lg"
          variant="ghost"
          className="w-full sm:w-auto"
          onClick={() => navigate('/call/history')}
        >
          지난 통화 보기
        </Button>
        <Button
          size="lg"
          variant="ghost"
          className="w-full sm:w-auto"
          onClick={() => navigate('/')}
        >
          홈으로
        </Button>
      </div>
    </div>
  )
}

/** 날짜를 짧게. 예: '2026-10-17' -> '10/17' */
function shortDate(dateKey: string): string {
  const [, month, day] = dateKey.split('-').map(Number)
  return `${month}/${day}`
}

/** 카드 시각 · 날짜 한 줄. 예: '10/17 19:00 · 60분' */
function cardWhenText(card: CardModel, dateKey: string): string {
  return `${shortDate(dateKey)} ${card.startTime ?? '시간 미정'} · ${card.durationMinutes}분`
}

interface UnhandledCardsSectionProps {
  /** 지난 통화 이후 아직 정리 안 한 카드 */
  items: CallCardAction[]
  /** 설정이 '통화 때' 면 실패로 기록한 뒤 나눠서 다른 날에 넣을지 묻습니다 */
  askSplit: boolean
  /** 나눈 카드를 카드 목록에 더합니다 (useCards 의 addCard) */
  onAddCard: (card: CardModel) => void
}

/**
 * 정리 안 한 카드 (#415). 원인을 1탭으로 고르면 실패로 기록합니다. (#400 과 같은 addCardMark)
 * 설정이 '통화 때' 면 이어서 "나눠서 다른 날에 넣기" 를 묻습니다.
 */
function UnhandledCardsSection({ items, askSplit, onAddCard }: UnhandledCardsSectionProps) {
  return (
    <Card title="정리 안 한 카드">
      <p className="text-sm break-keep text-slate-600">
        통화에서 이야기한 원인을 골라 주세요. 실패로 기록하고, 원인은 다음 판정에 써요.
      </p>
      <ul className="mt-3 flex flex-col gap-4">
        {items.map((item) => (
          <UnhandledCardRow
            key={`${item.card.id}-${item.dateKey}`}
            item={item}
            askSplit={askSplit}
            onAddCard={onAddCard}
          />
        ))}
      </ul>
    </Card>
  )
}

interface UnhandledCardRowProps {
  item: CallCardAction
  askSplit: boolean
  onAddCard: (card: CardModel) => void
}

function UnhandledCardRow({ item, askSplit, onAddCard }: UnhandledCardRowProps) {
  // pending: 원인 고르는 중 · split: 나눠 넣을지 묻는 중 · done: 끝
  const [step, setStep] = useState<'pending' | 'split' | 'done'>('pending')
  // 고른 원인들 (여러 개 가능, 맨 앞이 대표 원인)
  const [causes, setCauses] = useState<CardFailCause[]>([])
  const [splitDate, setSplitDate] = useState(() => moveDateKey(getTodayKey(), 1))
  const minuteOptions = getSplitMinuteOptions(item.card.durationMinutes)
  const [splitMinutes, setSplitMinutes] = useState(minuteOptions[0])
  const [message, setMessage] = useState('')

  // 서버 칸은 하나라서 대표 원인(cause)만 서버로 갑니다. 이 기기에는 모두(causes) 남깁니다.
  function handleFail() {
    addCardMark({
      cardId: item.card.id,
      dateKey: item.dateKey,
      mark: 'failed',
      cause: causes[0],
      causes,
    })
    setStep(askSplit ? 'split' : 'done')
    setMessage('실패로 기록했어요.')
  }

  function handleSplit() {
    onAddCard(makeSplitCard(item.card, splitDate, splitMinutes, Date.now()))
    setStep('done')
    setMessage(`실패로 기록하고, ${shortDate(splitDate)} 에 ${splitMinutes}분으로 다시 넣었어요.`)
  }

  const causeLabel = causes
    .map((key) => CARD_FAIL_CAUSES.find((option) => option.key === key)?.label ?? '기타')
    .join(' · ')
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="font-medium break-keep text-slate-900">{item.card.title}</p>
        <p className="text-sm text-slate-500">{cardWhenText(item.card, item.dateKey)}</p>
      </div>

      {step === 'pending' && (
        // 원인을 여러 개 고른 뒤 [실패로 기록] 을 누릅니다. 375px 에서는 두 줄로 나란히, 누르는 곳은 40px(h-10) 입니다.
        <div className="flex flex-col gap-2">
          <ReasonChips
            options={CARD_FAIL_CAUSES}
            selected={causes}
            onToggle={(key) => setCauses((prev) => toggleReason(prev, key))}
            label={`${item.card.title} 못 한 원인`}
            className="sm:grid-cols-4"
          />
          {/* 카드마다 반복되는 버튼이라 채우지 않고 선만 둡니다. (채운 버튼은 화면에 하나) */}
          {/* 되돌리기 어려운 기록이라 빨간 글자로 알려 줍니다. (2차 규칙 3) */}
          <Button
            size="sm"
            variant="outline"
            disabled={causes.length === 0}
            onClick={handleFail}
            className="text-red-700"
          >
            실패로 기록
          </Button>
        </div>
      )}

      {step === 'split' && (
        <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3">
          <p className="text-sm font-medium break-keep text-slate-800">
            실패로 기록했어요 ({causeLabel}). 나눠서 다른 날에 다시 넣을까요?
          </p>
          {/* 375px 에서는 날짜 칸이 잘리지 않게 위아래로, PC 에서는 나란히 놓습니다. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="min-w-0">
              <Input
                id={`split-date-${item.card.id}-${item.dateKey}`}
                label="넣을 날"
                type="date"
                min={moveDateKey(getTodayKey(), 1)}
                value={splitDate}
                onChange={(event) => event.target.value !== '' && setSplitDate(event.target.value)}
                className="h-10 text-base"
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">길이</span>
              <div role="group" aria-label="나눈 카드 길이" className="flex gap-1.5">
                {minuteOptions.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    aria-pressed={splitMinutes === minutes}
                    onClick={() => setSplitMinutes(minutes)}
                    className={cn(
                      'h-10 flex-1 cursor-pointer rounded-xl border text-sm font-medium tabular-nums',
                      splitMinutes === minutes
                        ? 'border-brand bg-brand-light text-brand font-bold'
                        : 'border-slate-300 bg-white text-slate-700',
                    )}
                  >
                    {minutes}분
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" className="w-full sm:w-auto" onClick={handleSplit}>
              이 날에 다시 넣기
            </Button>
            <Button variant="ghost" className="w-full sm:w-auto" onClick={() => setStep('done')}>
              안 나눌게요
            </Button>
          </div>
        </div>
      )}

      {message !== '' && step === 'done' && (
        <p role="status" className="text-sm text-emerald-700">
          {message}
        </p>
      )}
    </li>
  )
}

interface CardFixSectionProps {
  /** 지난 통화 이후 미루거나 못 한 카드 */
  cards: CardModel[]
  /** 카드를 고칩니다 (useCards 의 updateCard) */
  onUpdateCard: (cardId: string, changes: Partial<Omit<CardModel, 'id'>>) => void
}

/**
 * 4칸 회고 ④ "카드를 어떻게 고칠까?" 의 답을 카드 수정안으로 확인받습니다. (#415, 기획서 「4.5」 4칸 회고)
 * 시작 시각 · 길이 · 체크리스트를 고치고 [이대로 고치기] 를 눌러야 카드에 반영됩니다.
 * (서버가 ④ 의 답을 정리해 돌려주면 그 값으로 미리 채웁니다. 지금은 카드의 지금 값으로 시작합니다)
 */
function CardFixSection({ cards, onUpdateCard }: CardFixSectionProps) {
  const [cardId, setCardId] = useState(cards[0].id)
  const card = cards.find((item) => item.id === cardId) ?? cards[0]
  const [startTime, setStartTime] = useState(card.startTime ?? '')
  const [minutesText, setMinutesText] = useState(String(card.durationMinutes))
  const [checklist, setChecklist] = useState<ChecklistItem[]>(card.checklist)
  const [newItem, setNewItem] = useState('')
  const [message, setMessage] = useState('')

  function selectCard(next: CardModel) {
    setCardId(next.id)
    setStartTime(next.startTime ?? '')
    setMinutesText(String(next.durationMinutes))
    setChecklist(next.checklist)
    setMessage('')
  }

  function handleAddItem() {
    const text = newItem.trim()
    if (text === '') return
    setChecklist((prev) => [...prev, { id: `${card.id}-fix-${Date.now()}`, text }])
    setNewItem('')
  }

  const minutes = Number(minutesText)
  const isValid =
    Number.isInteger(minutes) && minutes >= 5 && minutes <= 600 && checklist.length > 0

  function handleApply() {
    if (!isValid) return
    onUpdateCard(card.id, {
      ...(startTime !== '' ? { startTime } : {}),
      durationMinutes: minutes,
      checklist,
    })
    setMessage('카드를 고쳤어요. 다음부터 이 카드로 해요.')
  }

  return (
    <Card title="카드 고치기 (4칸 회고)">
      <p className="text-sm break-keep text-slate-600">
        통화에서 정한 대로 카드를 고쳐요. 시간과 할 일을 확인하고 [이대로 고치기] 를 눌러 주세요.
      </p>
      {cards.length > 1 && (
        <div role="radiogroup" aria-label="고칠 카드" className="mt-3 flex flex-wrap gap-1.5">
          {cards.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={item.id === card.id}
              onClick={() => selectCard(item)}
              className={cn(
                'h-10 max-w-full cursor-pointer truncate rounded-full border px-3 text-sm font-medium',
                item.id === card.id
                  ? 'border-brand bg-brand-light text-brand font-bold'
                  : 'border-slate-300 bg-white text-slate-700',
              )}
            >
              {item.title}
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <Input
            id="fix-start"
            label="시작 시각"
            type="time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
            className="h-10 text-base"
          />
        </div>
        <div className="min-w-0">
          <Input
            id="fix-minutes"
            label="길이 (분)"
            type="number"
            inputMode="numeric"
            min={5}
            max={600}
            value={minutesText}
            onChange={(event) => setMinutesText(event.target.value)}
            className="h-10 text-base"
          />
        </div>
      </div>
      <p className="mt-3 text-sm font-medium text-slate-700">할 일</p>
      <ul className="mt-1 flex flex-col gap-1.5">
        {checklist.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0 text-sm break-keep text-slate-800">· {item.text}</span>
            <button
              type="button"
              aria-label={`${item.text} 빼기`}
              onClick={() => setChecklist((prev) => prev.filter((other) => other.id !== item.id))}
              className="h-10 shrink-0 cursor-pointer rounded-xl px-3 text-sm text-slate-500 hover:bg-slate-100"
            >
              빼기
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input
            id="fix-new-item"
            aria-label="할 일 더하기"
            value={newItem}
            maxLength={60}
            placeholder="할 일 더하기"
            onChange={(event) => setNewItem(event.target.value)}
            className="h-10 text-base"
          />
        </div>
        <Button
          variant="secondary"
          className="shrink-0"
          onClick={handleAddItem}
          disabled={newItem.trim() === ''}
        >
          더하기
        </Button>
      </div>
      {checklist.length === 0 && (
        <p className="mt-2 text-sm text-red-700">할 일이 하나는 있어야 해요.</p>
      )}
      <Button
        variant="outline"
        className="mt-4 w-full sm:w-auto"
        onClick={handleApply}
        disabled={!isValid}
      >
        이대로 고치기
      </Button>
      {message !== '' && (
        <p role="status" className="mt-2 text-sm text-emerald-700">
          {message}
        </p>
      )}
    </Card>
  )
}

/** 서버가 정리하는 동안 보여 주는 자리 (진짜 카드와 비슷한 크기) */
function ConclusionSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-4">
      <span className="text-sm text-slate-500">
        통화 내용을 정리하고 있어요. 30초쯤 걸릴 수 있어요.
      </span>
      <Skeleton className="h-48 w-full rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
    </div>
  )
}

interface FinishErrorProps {
  error: Error
  onRetry: () => void
}

/** 정리하지 못했을 때. 이미 정리한 통화(409)가 아니면 다시 시도할 수 있습니다. */
function FinishError({ error, onRetry }: FinishErrorProps) {
  if (error instanceof ApiError && error.status === 409) {
    return (
      <Card>
        <p className="text-sm break-keep text-slate-700">이미 정리한 통화예요.</p>
      </Card>
    )
  }
  // 503 은 서버가 사람이 읽을 문장을 줍니다. (AI 가 꺼져 있음 · 정리 실패) 그 밖에는 기본 문장을 씁니다.
  const message =
    error instanceof ApiError && error.status === 503
      ? error.message
      : '통화 내용을 정리하지 못했어요. 잠시 후 다시 시도해 주세요.'
  return (
    <Card>
      <p className="text-sm break-keep text-slate-700">{message}</p>
      <Button className="mt-4 w-full sm:w-auto" onClick={onRetry}>
        다시 정리하기
      </Button>
    </Card>
  )
}

interface ConclusionViewProps {
  conclusion: CallConclusion
}

/**
 * 오늘의 결론. 위기 표현이 감지됐으면 도움 안내만 보여 줍니다.
 * 안전 브레이크(#95)가 켜진 쉬는 날에는 생각 습관 교정을 빼고 요약만 부드럽게 보여 줍니다.
 */
function ConclusionView({ conclusion }: ConclusionViewProps) {
  // 처음 그릴 때 한 번만 확인합니다. (통화 화면들과 같은 기준, lib/focusMode.ts)
  const [isRestDay] = useState(isSafetyBrakeOnNow)
  if (conclusion.showHelp) return <HelpCard />

  return (
    <div className="flex flex-col gap-4">
      <SummaryCard conclusion={conclusion} />
      {isRestDay ? (
        <Card>
          <p className="text-sm break-keep text-slate-700">
            오늘은 쉬어 가는 날이라 생각 습관 얘기는 하지 않을게요. 푹 쉬고, 이야기하고 싶을 때
            언제든 다시 걸어 줘요.
          </p>
        </Card>
      ) : (
        <HabitCard habit={conclusion.bias} />
      )}
    </div>
  )
}

/**
 * "오늘 통화 요약" 카드 (#38, 시안 call-mobile.png)
 * 어제 요약은 이 브라우저의 공부 기록으로 계산하고, 미달 원인은 오늘 체크인에서 꺼냅니다.
 */
function SummaryCard({ conclusion }: ConclusionViewProps) {
  // 처음 그릴 때 한 번만 저장소에서 읽습니다.
  const [card] = useState(() => loadTodayCallCard(getTodayKey()))
  // 오늘의 관리 강도에 맞는 이름과 색입니다. (통화 수신 화면과 같은 값, lib/todayCare.ts)
  const theme = careThemes[getTodayCareLevel()]
  // 확인 통화였으면 요약 끝에 '이해도: 조금 헷갈림' 이 붙어 옵니다. 떼어 내서 배지로 크게 보여 줍니다. (BE #327)
  const parsed = conclusion.summary === null ? null : splitUnderstanding(conclusion.summary)

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[17px] font-bold text-slate-900">오늘 통화 요약</h2>
        <span
          className={cn(
            'shrink-0 rounded-full px-3 py-1 text-xs font-semibold text-white',
            theme.avatarBackground,
          )}
        >
          {theme.name} 모드
        </span>
      </div>

      {parsed?.understanding && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-slate-50 px-4 py-3">
          <span className="text-sm font-semibold text-slate-900">확인 통화 결과</span>
          <UnderstandingBadge understanding={parsed.understanding} className="text-sm" />
        </div>
      )}

      {/* 모바일은 이름 아래에 값, PC 는 이름 옆에 값 (시안과 같은 배치) */}
      <dl className="mt-3 divide-y divide-slate-100">
        <SummaryRow label="어제 요약" value={card.headline} />
        {card.missReason !== null && <SummaryRow label="못 채운 이유" value={card.missReason} />}
        {/* 서버 요약은 "~했다고 함" 같은 기록용 문장이라, AI 가 하는 말처럼 따옴표로 감싸지 않습니다. */}
        {parsed !== null && parsed.summary !== '' && (
          <SummaryRow label="대화 요약" value={parsed.summary} />
        )}
      </dl>
    </Card>
  )
}

interface SummaryRowProps {
  label: string
  value: string
}

/** 요약 카드의 한 줄 (이름 + 값) */
function SummaryRow({ label, value }: SummaryRowProps) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-xs text-slate-500 sm:w-24 sm:text-sm">{label}</dt>
      {/* leading-relaxed: 요약 문장이 두세 줄이 돼도 줄 사이가 넉넉해서 읽기 쉽습니다. */}
      <dd className="text-[15px] leading-relaxed font-semibold break-keep text-slate-900">
        {value}
      </dd>
    </div>
  )
}

interface HabitCardProps {
  habit: ThinkingHabit | null
}

/** 대답에서 보인 생각 습관(인지편향) 카드 */
function HabitCard({ habit }: HabitCardProps) {
  if (habit === null) {
    return (
      <Card title="오늘 대화에서 보인 생각 습관">
        <p className="text-sm break-keep text-slate-700">
          오늘 대화에서는 뚜렷한 생각 습관이 보이지 않았어요.
        </p>
      </Card>
    )
  }
  return (
    <Card title="오늘 대화에서 보인 생각 습관">
      <p className="text-xl font-bold text-slate-900">{habit.label}</p>
      {/* 이름은 생각에 붙입니다. "너는 ~형이야" 가 아니라 "이런 생각에 붙이는 이름이에요" */}
      <p className="mt-1 text-sm break-keep text-slate-700">
        {habit.description}에 붙이는 이름이에요.
      </p>
      {/* 할 일(다음엔 이렇게)을 먼저 보여 주고, 근거(통화에서 한 말)는 [근거 보기] 로 접어 둡니다. (점진적 공개) */}
      <div className="bg-brand-light mt-4 rounded-xl px-3 py-3">
        <p className="text-brand-dark text-sm font-semibold">다음엔 이렇게 해 볼까요?</p>
        <p className="mt-1 text-[15px] leading-relaxed break-keep text-slate-900">
          {habit.solution}
        </p>
      </div>
      {habit.evidence !== null && (
        <details className="mt-3 rounded-xl bg-slate-50 px-3">
          <summary className="flex h-10 cursor-pointer items-center text-sm font-medium text-slate-700">
            근거 보기
          </summary>
          <p className="pb-3 text-sm leading-relaxed break-keep text-slate-700">
            통화에서: {habit.evidence}
          </p>
        </details>
      )}
      <p className="mt-3 text-[13px] break-keep text-slate-500">
        한 번 보였다고 내가 그런 사람이라는 뜻은 아니에요. 생각 습관은 알아차리면 바꿀 수 있어요.
      </p>
    </Card>
  )
}

/** 위기 표현이 감지된 통화에서 보여 주는 안내. 상담 전화는 한 줄만 알려 줍니다. */
function HelpCard() {
  return (
    <Card title="오늘은 공부 이야기를 쉬어 가요">
      <p className="text-sm break-keep text-slate-700">
        힘든 이야기를 들려줘서 고마워요. 믿을 수 있는 어른에게 꼭 이야기해 주세요.
      </p>
      {/* 모바일에서는 눌러서 바로 전화가 걸립니다. 누르는 곳은 최소 40px(min-h-11 = 44px) */}
      <a
        href={`tel:${YOUTH_HELP_LINE.number}`}
        className="mt-3 flex min-h-11 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm"
      >
        <span className="break-keep text-slate-700">
          {YOUTH_HELP_LINE.name} · {YOUTH_HELP_LINE.detail}
        </span>
        <span className="text-brand font-semibold">{YOUTH_HELP_LINE.number}</span>
      </a>
    </Card>
  )
}
