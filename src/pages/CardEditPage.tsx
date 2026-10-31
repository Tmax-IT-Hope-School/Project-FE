import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ChipButton } from '@/components/ui/ChipButton'
import { StickyActionBar } from '@/components/ui/StickyActionBar'
import { Input } from '@/components/ui/Input'
import { MinutesPicker } from '@/components/ui/MinutesPicker'
import { Modal } from '@/components/ui/Modal'
import { SegmentedToggle } from '@/components/ui/SegmentedToggle'
import { Skeleton } from '@/components/ui/Skeleton'
import { useCards } from '@/hooks/useCards'
import { useGoals } from '@/hooks/useGoals'
import { useIsServerData } from '@/hooks/useIsServerData'
import { useQueryParam } from '@/hooks/useQueryParam'
import { useStudySessions } from '@/hooks/useStudySessions'
import { useSubjects } from '@/hooks/useSubjects'
import { failCauseOptionsQuery, requestCardDefaults, requestChecklist } from '@/lib/aiCardApi'
import {
  ALERT_MINUTES_OPTIONS,
  ALERT_TEXT_MAX_LENGTH,
  CARD_TITLE_MAX_LENGTH,
  CHECKLIST_ITEM_MAX_LENGTH,
  EXPECTED_DONE_REASONS,
  applyCardDefaults,
  buildCard,
  cardToForm,
  createEmptyForm,
  getFilledChecklist,
  getRecentPlanAccuracy,
  isAiChecklistItem,
  mergeAiChecklist,
  shouldSuggestSelfChecklist,
  splitFailCauses,
  toggleFailCause,
  undoCardDefaults,
  validateCardForm,
  type AppliedDefaults,
  type CardFormValues,
  type DefaultField,
} from '@/lib/cardForm'
import { cn } from '@/lib/cn'
import { getTodayKey, isDateKey } from '@/lib/date'
import { NO_FIXED_BLOCKS } from '@/lib/fixedBlocks'
import { getLatestActiveGoal } from '@/lib/goals'
import { loadOnboardingAnswers } from '@/lib/onboardingSteps'
import { PLAN_MAX_MINUTES } from '@/lib/plansApi'
import { WEEKDAY_ORDER, getWeekdayName } from '@/lib/routines'
import {
  getBufferWarning,
  getSleepWindow,
  isOverlappingSleep,
  type SleepWindow,
} from '@/lib/scheduleCheck'
import { loadAutoSettings } from '@/lib/settingsMapping'
import type { Card as CardData, FixedBlock, Goal, Subject } from '@/types'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

interface CardFormProps {
  initialValues: CardFormValues
  /** 고치는 중이면 그 카드, 새 카드면 없음 */
  editingCard?: CardData
  /** 성향 설정(#385): 예상 실패 원인을 꼭 받을지 */
  failCauseRequired: boolean
  /** 성향 설정(#385): 선택 칸을 처음부터 펼쳐 둘지 */
  optionalOpenByDefault: boolean
  /** 최근 4주 계획 정확도. 기록이 모자라면 null */
  accuracy: { rate: number; samples: number } | null
  /** "목표 연결" 에서 고를 수 있는 목표 (진행 중인 목표 + 이 카드에 이미 걸린 목표) */
  goalOptions: Goal[]
  /** "과목" 에서 고를 수 있는 내 과목 (#652) */
  subjectOptions: Subject[]
  /**
   * 체크리스트 AI 추천(#413). AI 는 버튼을 눌렀을 때만 부릅니다.
   *   (2026-10-31 사용자 "시작시간 누르자마자 AI가 분석을 한다니까 AI 계획하기 버튼이 있어야되는거 아님?")
   * - 'auto': [✨ AI 로 계획하기] · [AI 추천 받기] 버튼을 보여 줍니다
   * - 'manual': 버튼은 그대로, 성향상 2주 뒤라 "직접 써 볼까요?" 한 줄을 더 보여 줍니다
   * - 'off': 테스트 로그인이라 서버에 물을 수 없습니다
   */
  aiChecklist: 'auto' | 'manual' | 'off'
  /** 수면 보호 시간. 겹치면 저장할 수 없습니다 (#393) */
  sleepWindow: SleepWindow
  /** 10분 버퍼를 볼 때 비교하는 전체 카드 · 고정 일정 (#393) */
  allCards: CardData[]
  fixedBlocks: FixedBlock[]
  onSave: (card: CardData) => void
}

interface FailCauseOptionsProps {
  /** 제목 칸에서 나갈 때 정해진 카드 제목 (글자를 칠 때마다 묻지 않으려고) */
  title: string
  /** 지금 예상 실패 원인 칸의 글 (쉼표로 나뉨) */
  value: string
  onToggle: (cause: string) => void
}

/**
 * AI 가 내 최근 30일 기록으로 만든 예상 실패 원인 선지 3개 (#419 표 3번, BE POST /ai/fail-cause-options).
 * 누르면 칸에 넣고, 다시 누르면 뺍니다. 기록이 모자라거나 못 받으면 아무것도 안 보입니다 (주관식 그대로).
 */
function FailCauseOptions({ title, value, onToggle }: FailCauseOptionsProps) {
  const { data: options } = useSuspenseQuery(failCauseOptionsQuery(title))
  if (!options) return null
  const picked = splitFailCauses(value)
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs break-keep text-slate-500">
        <span className="font-semibold text-violet-700">AI 추천</span> 내 기록으로 고른 선지예요.
        눌러서 넣어요.
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <ChipButton
            key={option.text}
            selected={picked.includes(option.text)}
            onClick={() => onToggle(option.text)}
          >
            {/* 내 행동에서 나오는 원인은 글자로도 표시합니다 */}
            {option.inner ? `${option.text} · 내 쪽` : option.text}
          </ChipButton>
        ))}
      </div>
    </div>
  )
}

/** AI 가 체크리스트를 만들어 달라는 부탁 하나 ([✨ AI 로 계획하기] · [AI 추천 받기] 를 눌렀을 때) */
interface ChecklistAsk {
  title: string
  goal?: string
}

/** 카드 만들기 · 고치기 폼 */
function CardForm({
  initialValues,
  editingCard,
  failCauseRequired,
  optionalOpenByDefault,
  accuracy,
  goalOptions,
  subjectOptions,
  aiChecklist,
  sleepWindow,
  allCards,
  fixedBlocks,
  onSave,
}: CardFormProps) {
  const [values, setValues] = useState<CardFormValues>(initialValues)
  // 저장을 한 번 눌러 본 뒤부터 틀린 칸을 빨갛게 보여 줍니다. (처음부터 빨가면 겁이 납니다)
  const [triedSave, setTriedSave] = useState(false)
  // 편집 화면을 연 시각. 저장할 때까지 걸린 시간을 planningMs 로 남깁니다. (「4.3」 계획 시간 측정)
  const [openedAt] = useState(() => Date.now())

  // 선택 칸을 펼쳤는지는 주소에 둡니다. (/cards/new?more=open) 새로고침해도 그대로입니다.
  const [moreParam, setMoreParam] = useQueryParam(
    'more',
    optionalOpenByDefault ? 'open' : 'closed',
    { replace: true },
  )
  const isMoreOpen = moreParam === 'open'

  const errors = validateCardForm(values, { failCauseRequired })
  const shownErrors = triedSave ? errors : {}

  // 체크리스트 AI 추천 (#413, BE POST /ai/checklist). 실패해도 저장은 그대로 됩니다.
  const [aiNotice, setAiNotice] = useState('')
  const { mutate: askChecklist, isPending: isAskingChecklist } = useMutation({
    mutationFn: (ask: ChecklistAsk) => requestChecklist(ask.title, ask.goal),
    onSuccess: (items) => {
      if (!items) {
        setAiNotice('지금은 AI 추천을 못 받았어요. 직접 적어 주세요.')
        return
      }
      setAiNotice('')
      const stamp = Date.now()
      // 다시 누르면 지난번 AI 항목(내가 안 고친 것)은 새 추천으로 바꿉니다. 내가 적거나 고친 항목은 그대로 둡니다.
      setValues((prev) => ({
        ...prev,
        checklist: mergeAiChecklist(
          prev.checklist.filter((item) => !isAiChecklistItem(item)),
          items,
          stamp,
        ),
      }))
    },
  })
  const goalTitle = goalOptions.find((goal) => goal.id === values.goalId)?.title

  // 카드 기본값 AI 추천 (#419 표 2번, BE POST /ai/card-defaults). 새 카드에서 [✨ AI 로 계획하기] 를 누르면
  // 내가 아직 안 건드린 목표 · 유형 · 길이를 AI 가 채워 둡니다. 마음에 안 들면 [되돌리기].
  const [touchedDefaults, setTouchedDefaults] = useState<DefaultField[]>([])
  const [aiDefaults, setAiDefaults] = useState<(AppliedDefaults & { evidence: string }) | null>(
    null,
  )
  // 길이 고르기(MinutesPicker)는 처음 값으로 "버튼 / 직접" 을 정해 둡니다. AI 가 길이를 바꾸면
  // 이 숫자를 올려서 다시 그립니다. 그래야 50분처럼 버튼에 없는 값이 '직접' 칸에 보입니다.
  const [minutesPickerKey, setMinutesPickerKey] = useState(0)
  const { mutate: askDefaults, isPending: isAskingDefaults } = useMutation({
    mutationFn: requestCardDefaults,
    onSuccess: (suggestion) => {
      // 못 받았으면(AI 꺼짐 · 한도 · 실패) 조용히 넘어갑니다. 칸은 원래 값 그대로입니다.
      if (!suggestion) return
      // 서버는 목표를 서버 번호(serverId)로 알려 줍니다. 폼은 이 기기의 목표 id 를 쓰므로 바꿔 줍니다. (#516)
      const goal = goalOptions.find(
        (option) => option.serverId === suggestion.goalId || option.id === suggestion.goalId,
      )
      const result = applyCardDefaults(
        values,
        { ...suggestion, goalId: goal?.id ?? null },
        {
          touched: touchedDefaults,
          goalIds: goalOptions.map((goal) => goal.id),
          maxMinutes: PLAN_MAX_MINUTES,
        },
      )
      if (Object.keys(result.applied).length === 0) return
      // AI 가 채운 칸만 덮습니다. 그사이 체크리스트 추천 등으로 바뀐 다른 칸은 그대로 둡니다.
      setValues((prev) => ({ ...prev, ...result.applied }))
      if (result.applied.durationMinutes !== undefined) setMinutesPickerKey((key) => key + 1)
      setAiDefaults((prev) => ({
        applied: { ...prev?.applied, ...result.applied },
        // 두 번째 추천이 와도 되돌릴 값은 AI 가 처음 채우기 전의 값입니다.
        previous: { ...result.previous, ...prev?.previous },
        evidence: suggestion.evidence,
      }))
    },
  })

  // 예상 실패 원인 선지(#419)는 제목 칸에서 나갈 때 정해진 제목으로 묻습니다.
  const [committedTitle, setCommittedTitle] = useState(initialValues.title.trim())
  // 테스트 로그인이면 서버의 AI 를 쓸 수 없습니다.
  const isAiEnabled = aiChecklist !== 'off'
  // 체크리스트 AI 에는 내가 고른 목표나 AI 가 제목을 보고 고른 목표만 알려 줍니다.
  // 새 카드에 저절로 걸린 목표(가장 최근 목표)는 이 카드와 상관없을 수 있어서 보내지 않습니다.
  // (2026-10-31 '한국사 풀기' 카드에 '수학 3등급' 목표가 저절로 걸려서 수학 체크리스트가 나옴)
  const isGoalChosen =
    touchedDefaults.includes('goalId') ||
    (aiDefaults?.applied.goalId !== undefined && aiDefaults.applied.goalId === values.goalId)
  const checklistGoal = isGoalChosen ? goalTitle : undefined

  function handleTitleBlur() {
    setCommittedTitle(values.title.trim())
  }

  /**
   * [✨ AI 로 계획하기] 제목을 보고 AI 가 목표 · 유형 · 길이(새 카드만)와 체크리스트를 채웁니다.
   * 제목 칸에서 나갈 때 저절로 부르지 않고, 이 버튼을 눌렀을 때만 부릅니다.
   */
  function handlePlanWithAi() {
    const title = values.title.trim()
    if (title === '') return
    setCommittedTitle(title)
    setAiNotice('')
    // 기본값 추천은 새 카드에서만 받습니다. (고치는 카드의 목표 · 유형 · 길이는 내가 이미 정한 값입니다)
    if (!editingCard) askDefaults(title)
    askChecklist({ title, goal: checklistGoal })
  }

  function handleAskChecklist() {
    setAiNotice('')
    askChecklist({ title: values.title.trim(), goal: checklistGoal })
  }
  const isPlanningWithAi = isAskingDefaults || isAskingChecklist
  const filledCount = getFilledChecklist(values.checklist).length
  // 체크리스트를 비워 두면 제목 한 줄로 채우므로, 예상 개수의 최댓값은 최소 1개입니다.
  const checklistTotal = Math.max(1, filledCount)
  const expectedDone =
    values.expectedDone === null ? checklistTotal : Math.min(values.expectedDone, checklistTotal)
  const isLowered = expectedDone < checklistTotal

  // 수면 보호 시간과 겹치면 저장 버튼을 막습니다. (「4.3」 규칙, 겹침 계산은 lib/scheduleCheck.ts)
  const isSleepBlocked = isOverlappingSleep(values.startTime, values.durationMinutes, sleepWindow)
  // 앞뒤 카드 · 고정 일정과 10분 여유가 없으면 경고만 합니다. (저장은 됩니다)
  const bufferWarning = getBufferWarning({
    date: values.date,
    repeatDays: values.repeat ? values.repeatDays : [],
    startTime: values.startTime,
    durationMinutes: values.durationMinutes,
    cards: allCards,
    blocks: fixedBlocks,
    ignoreCardId: editingCard?.id,
  })

  /** 한 칸만 바꿉니다. */
  function change<K extends keyof CardFormValues>(key: K, value: CardFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }))
    if (key === 'goalId' || key === 'type' || key === 'durationMinutes') {
      markTouched(key as DefaultField)
    }
  }

  /** 사람이 목표 · 유형 · 길이를 직접 고쳤습니다. AI 추천이 다시 와도 이 칸은 덮지 않습니다. */
  function markTouched(field: DefaultField) {
    setTouchedDefaults((prev) => (prev.includes(field) ? prev : [...prev, field]))
    setAiDefaults((prev) => {
      if (!prev || prev.applied[field] === undefined) return prev
      const applied = { ...prev.applied }
      delete applied[field]
      // AI 가 채운 칸이 하나도 안 남으면 안내를 닫습니다.
      return Object.keys(applied).length === 0 ? null : { ...prev, applied }
    })
  }

  function handleKeepDefaults() {
    setAiDefaults(null)
  }

  function handleUndoDefaults() {
    if (!aiDefaults) return
    setValues((prev) => undoCardDefaults(prev, aiDefaults))
    if (aiDefaults.applied.durationMinutes !== undefined) setMinutesPickerKey((key) => key + 1)
    setAiDefaults(null)
  }

  // 안내에 보여 줄 "AI 가 채운 것" 한 줄. 예) "목표 '수학 내신' · 인강 · 60분"
  const aiDefaultsSummary = aiDefaults
    ? [
        aiDefaults.applied.goalId !== undefined &&
          `목표 '${goalOptions.find((goal) => goal.id === aiDefaults.applied.goalId)?.title ?? ''}'`,
        aiDefaults.applied.type !== undefined &&
          (aiDefaults.applied.type === 'lecture' ? '인강' : '자습'),
        aiDefaults.applied.durationMinutes !== undefined &&
          `${aiDefaults.applied.durationMinutes}분`,
      ]
        .filter(Boolean)
        .join(' · ')
    : ''

  function handleToggleWeekday(weekday: number) {
    setValues((prev) => ({
      ...prev,
      repeatDays: prev.repeatDays.includes(weekday)
        ? prev.repeatDays.filter((day) => day !== weekday)
        : [...prev.repeatDays, weekday],
    }))
  }

  function handleChangeChecklistItem(itemId: string, text: string) {
    setValues((prev) => ({
      ...prev,
      // 사람이 고친 항목은 AI 추천 표시(aiSuggested)를 뺍니다. id 는 그대로 둡니다 (지난 기록의 체크가 이 id 를 가리킵니다)
      checklist: prev.checklist.map((item) => (item.id === itemId ? { id: item.id, text } : item)),
    }))
  }

  function handleAddChecklistItem() {
    setValues((prev) => ({
      ...prev,
      checklist: [...prev.checklist, { id: `item-${Date.now()}`, text: '' }],
    }))
  }

  function handleDeleteChecklistItem(itemId: string) {
    setValues((prev) => ({
      ...prev,
      checklist: prev.checklist.filter((item) => item.id !== itemId),
    }))
  }

  /** 예상 달성 개수를 바꿉니다. 전부로 되돌리면 이유는 지웁니다. */
  function handleChangeExpectedDone(next: number) {
    const clamped = Math.min(Math.max(next, 0), checklistTotal)
    setValues((prev) => ({
      ...prev,
      expectedDone: clamped >= checklistTotal ? null : clamped,
      expectedDoneReason: clamped >= checklistTotal ? '' : prev.expectedDoneReason,
    }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // 버튼이 막혀 있어도 엔터로 제출될 수 있어서 한 번 더 막습니다.
    if (isSleepBlocked) return
    setTriedSave(true)
    if (Object.keys(errors).length > 0) {
      // 접힌 칸에 틀린 곳이 있으면 펼쳐서 보여 줍니다.
      if (errors.expectedDoneReason || (errors.failCauses && !failCauseRequired)) {
        setMoreParam('open')
      }
      return
    }
    // 고치는 카드는 전에 쓴 계획 시간에 이번에 쓴 시간을 더합니다.
    const planningMs = (editingCard?.planningMs ?? 0) + (Date.now() - openedAt)
    const card = buildCard(values, {
      id: editingCard?.id ?? `card-${Date.now()}`,
      createdAt: editingCard?.createdAt ?? Date.now(),
      planningMs,
    })
    onSave(card)
  }

  // 예상 실패 원인 칸. 성향상 꼭 받아야 하면 필수 칸 쪽에, 아니면 접힌 칸 안에 둡니다.
  const failCauseField = (
    <div className="flex flex-col gap-2">
      <Input
        id="card-fail-causes"
        label={failCauseRequired ? '예상 실패 원인 (필수)' : '예상 실패 원인'}
        value={values.failCauses}
        onChange={(event) => change('failCauses', event.target.value)}
        placeholder="예: 폰을 책상에 두면 계속 보게 돼요"
        error={shownErrors.failCauses}
      />
      {isAiEnabled && committedTitle !== '' && (
        <AsyncBoundary
          pendingFallback={<Skeleton className="h-10 w-full rounded-lg" />}
          resetKeys={[committedTitle]}
        >
          <FailCauseOptions
            title={committedTitle}
            value={values.failCauses}
            onToggle={(cause) => change('failCauses', toggleFailCause(values.failCauses, cause))}
          />
        </AsyncBoundary>
      )}
    </div>
  )

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      {/* 계획 정확도 한 줄. 내 계획이 얼마나 맞는지 먼저 보고 쓰게 합니다. (더닝-크루거 대응) */}
      <p className="rounded-xl bg-white px-4 py-3 text-[13px] break-keep text-slate-600">
        {accuracy ? (
          <>
            최근 4주 계획 정확도{' '}
            <strong className="text-slate-900 tabular-nums">
              {Math.round(accuracy.rate * 100)}%
            </strong>{' '}
            · 체크리스트를 계획한 만큼 해낸 비율이에요 (카드 {accuracy.samples}번)
          </>
        ) : (
          '카드를 5번 끝내면 최근 4주 계획 정확도를 보여 줄게요.'
        )}
      </p>

      {/* 필수 묶음: 생각하는 순서대로 ① 무엇을 → ② 언제 → ③ 체크리스트. 칸 사이는 선(divide-y)으로 나눕니다. */}
      <Card title="꼭 적을 것">
        <div className="flex flex-col divide-y divide-slate-100">
          <div className="flex flex-col gap-5 pb-6">
            <Input
              id="card-title"
              label="무엇을 할까요?"
              value={values.title}
              onChange={(event) => change('title', event.target.value)}
              onBlur={handleTitleBlur}
              maxLength={CARD_TITLE_MAX_LENGTH}
              placeholder="예: 수학 문제집"
              error={shownErrors.title}
            />
            {isAiEnabled && (
              <div className="flex flex-col gap-1">
                <Button
                  variant="secondary"
                  onClick={handlePlanWithAi}
                  disabled={values.title.trim() === '' || isPlanningWithAi}
                  className="w-full bg-violet-50 text-violet-700 hover:bg-violet-100"
                >
                  {isPlanningWithAi ? 'AI 가 계획하는 중…' : '✨ AI 로 계획하기'}
                </Button>
                <p className="text-xs break-keep text-slate-500">
                  {editingCard
                    ? '제목을 보고 체크리스트를 채워 줘요.'
                    : '제목을 보고 길이 · 목표 · 체크리스트를 채워 줘요.'}
                </p>
              </div>
            )}

            {/* 카드 기본값 AI 추천 (#419 표 2번). 목표 · 유형은 "더 보기" 안에 있어서, 무엇을 채웠는지 여기서 한 줄로 알려 줍니다. */}
            {aiDefaults && (
              <div className="flex flex-col gap-2 rounded-xl bg-violet-50 px-4 py-3">
                <p className="text-sm break-keep text-slate-700">
                  <span className="font-semibold text-violet-700">AI 추천</span>으로 채워 뒀어요:{' '}
                  <strong className="text-slate-900">{aiDefaultsSummary}</strong>
                </p>
                {aiDefaults.evidence && (
                  <p className="text-xs break-keep text-slate-500">{aiDefaults.evidence}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    onClick={handleKeepDefaults}
                  >
                    이대로 할게
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    onClick={handleUndoDefaults}
                  >
                    되돌리기
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* 언제: 1회성 / 반복 · 날짜 · 시작 시각 · 길이 */}
          <div className="flex flex-col gap-5 py-6">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-slate-700">언제 할까요?</p>
              <SegmentedToggle
                label="반복 여부"
                options={[
                  { value: 'once', label: '한 번만' },
                  { value: 'repeat', label: '요일마다 반복' },
                ]}
                value={values.repeat ? 'repeat' : 'once'}
                onChange={(next) => change('repeat', next === 'repeat')}
              />
              {values.repeat && (
                <div className="grid grid-cols-7 gap-1">
                  {WEEKDAY_ORDER.map((weekday) => (
                    <button
                      key={weekday}
                      type="button"
                      aria-pressed={values.repeatDays.includes(weekday)}
                      onClick={() => handleToggleWeekday(weekday)}
                      className={cn(
                        'h-10 cursor-pointer rounded-xl border text-sm font-medium transition-colors',
                        values.repeatDays.includes(weekday)
                          ? 'border-brand bg-brand-light text-brand ring-brand font-semibold ring-1'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                      )}
                    >
                      {getWeekdayName(weekday)}
                    </button>
                  ))}
                </div>
              )}
              {shownErrors.repeatDays && (
                <p className="text-xs text-red-600">{shownErrors.repeatDays}</p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                id="card-date"
                type="date"
                label={values.repeat ? '반복 시작 날짜' : '날짜'}
                value={values.date}
                // 날짜를 지우면 저장할 수 없으니, 빈 값은 받지 않습니다.
                onChange={(event) => {
                  if (isDateKey(event.target.value)) change('date', event.target.value)
                }}
              />
              <Input
                id="card-start-time"
                type="time"
                label="시작 시각"
                value={values.startTime}
                onChange={(event) => change('startTime', event.target.value)}
                error={shownErrors.startTime}
              />
            </div>

            <MinutesPicker
              key={minutesPickerKey}
              label="길이"
              presets={[30, 60, 90, 120]}
              value={values.durationMinutes}
              onChange={(minutes) => change('durationMinutes', minutes)}
              max={PLAN_MAX_MINUTES}
            />
          </div>

          {/* 체크리스트: 개수 자유, 중요도 구분 없음 */}
          <div className="flex flex-col gap-2 py-6 last:pb-0">
            <p className="text-sm font-semibold text-slate-700">체크리스트</p>
            <ul className="flex flex-col gap-2">
              {values.checklist.map((item, index) => (
                <li key={item.id} className="flex items-center gap-2">
                  <input
                    value={item.text}
                    onChange={(event) => handleChangeChecklistItem(item.id, event.target.value)}
                    maxLength={CHECKLIST_ITEM_MAX_LENGTH}
                    aria-label={`체크리스트 ${index + 1}번`}
                    placeholder="예: 42~45쪽 풀기"
                    className="focus:ring-brand/40 h-12 min-w-0 flex-1 rounded-xl border-0 bg-slate-100 px-4 text-base outline-none placeholder:text-slate-400 focus:bg-white focus:ring-2"
                  />
                  {isAiChecklistItem(item) && (
                    <span className="shrink-0 text-xs font-semibold text-violet-700">AI 추천</span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteChecklistItem(item.id)}
                    aria-label={`체크리스트 ${index + 1}번 지우기`}
                    className="w-10 shrink-0 px-0 text-slate-500"
                  >
                    ✕
                  </Button>
                </li>
              ))}
            </ul>
            {aiChecklist === 'manual' && (
              <p className="text-sm break-keep text-slate-600">
                이번엔 직접 써 볼까요? 막히면 [AI 추천 받기] 를 눌러도 돼요.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={handleAddChecklistItem}>
                + 항목 더하기
              </Button>
              {aiChecklist !== 'off' && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleAskChecklist}
                  disabled={values.title.trim() === '' || isAskingChecklist}
                >
                  {isAskingChecklist ? 'AI 가 만드는 중…' : 'AI 추천 받기'}
                </Button>
              )}
            </div>
            {aiNotice && <p className="text-xs break-keep text-slate-500">{aiNotice}</p>}
            <p className="text-xs break-keep text-slate-500">
              비워 두면 제목으로 한 줄 채워요.
              {aiChecklist !== 'off' && ' AI 가 넣은 항목도 고치거나 지울 수 있어요.'}
            </p>
          </div>

          {failCauseRequired && <div className="pt-6">{failCauseField}</div>}
        </div>
      </Card>

      {/* 선택 칸: 성향에 따라 펼쳐 두거나 접어 둡니다 (#385)
          필수 묶음(흰 바탕)보다 한 단계 낮게 보이도록, 바탕 없이 선만 둘렀습니다. */}
      <Card className="border border-slate-200 bg-transparent">
        <button
          type="button"
          aria-expanded={isMoreOpen}
          onClick={() => setMoreParam(isMoreOpen ? 'closed' : 'open')}
          className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 text-left"
        >
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold text-slate-700">더 정하기 (선택)</span>
            <span className="block truncate text-xs text-slate-500">
              과목 · 목표 · 우선순위 · 유형 · 예상 달성 개수 · 알림
            </span>
          </span>
          <span aria-hidden className="shrink-0 text-slate-400">
            {isMoreOpen ? '▲' : '▼'}
          </span>
        </button>

        {isMoreOpen && (
          <div className="mt-5 flex flex-col gap-5">
            {/* 과목: 고르면 이 카드로 잰 공부 시간이 기록 탭에서 그 과목으로 묶입니다. 안 골라도 저장돼요 (#652) */}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-slate-700">과목</p>
              <div className="flex flex-wrap gap-2">
                <ChipButton
                  selected={values.subjectId === ''}
                  onClick={() => change('subjectId', '')}
                >
                  과목 없음
                </ChipButton>
                {subjectOptions.map((subject) => (
                  <ChipButton
                    key={subject.id}
                    selected={values.subjectId === subject.id}
                    onClick={() => change('subjectId', subject.id)}
                    className="max-w-full truncate"
                  >
                    {subject.name}
                  </ChipButton>
                ))}
              </div>
            </div>

            {/* 목표 연결: 카테고리 대신 목표로 카드를 묶습니다. 기본은 가장 최근 목표 (「4.3」) */}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-slate-700">목표</p>
              <div className="flex flex-wrap gap-2">
                <ChipButton selected={values.goalId === ''} onClick={() => change('goalId', '')}>
                  목표 없음
                </ChipButton>
                {goalOptions.map((goal) => (
                  <ChipButton
                    key={goal.id}
                    selected={values.goalId === goal.id}
                    onClick={() => change('goalId', goal.id)}
                    className="max-w-full truncate"
                  >
                    {goal.title}
                  </ChipButton>
                ))}
              </div>
              {goalOptions.length === 0 && (
                <Link to="/goals/new" className="text-brand inline-flex h-10 items-center text-sm">
                  + 목표 만들기
                </Link>
              )}
            </div>

            {/* 우선순위: 드래그 대신 절대/유연 토글 (「4.3」 규칙) */}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-slate-700">우선순위</p>
              <SegmentedToggle
                label="우선순위"
                options={[
                  { value: 'flexible', label: '유연' },
                  { value: 'absolute', label: '절대' },
                ]}
                value={values.priority}
                onChange={(next) => change('priority', next)}
              />
              <p className="text-xs break-keep text-slate-500">
                {values.priority === 'absolute'
                  ? '절대 카드에는 미루기 버튼이 없어요. 과제 제출처럼 꼭 그 시간에 해야 할 때 골라요.'
                  : '유연 카드는 미루거나 줄일 수 있어요. 절대로 바꾸면 미루기 버튼이 없어져요.'}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-slate-700">유형</p>
              <SegmentedToggle
                label="유형"
                options={[
                  { value: 'self', label: '자습' },
                  { value: 'lecture', label: '인강' },
                ]}
                value={values.type}
                onChange={(next) => change('type', next)}
              />
            </div>

            {/* 예상 달성 개수: 그대로 두면 "전부" 라는 예측으로 저장됩니다 */}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-slate-700">몇 개까지 할 수 있을 것 같나요?</p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleChangeExpectedDone(expectedDone - 1)}
                  disabled={expectedDone <= 0}
                  aria-label="예상 개수 줄이기"
                  className="w-10 shrink-0 px-0"
                >
                  −
                </Button>
                <p className="min-w-0 flex-1 text-center text-sm font-semibold text-slate-900 tabular-nums">
                  {expectedDone} / {checklistTotal}개{isLowered ? '' : ' (전부)'}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleChangeExpectedDone(expectedDone + 1)}
                  disabled={!isLowered}
                  aria-label="예상 개수 늘리기"
                  className="w-10 shrink-0 px-0"
                >
                  +
                </Button>
              </div>
              {isLowered && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-slate-500">왜 낮췄나요? (하나)</p>
                  <div className="flex flex-wrap gap-2">
                    {EXPECTED_DONE_REASONS.map((reason) => (
                      <ChipButton
                        key={reason}
                        selected={values.expectedDoneReason === reason}
                        onClick={() => change('expectedDoneReason', reason)}
                      >
                        {reason}
                      </ChipButton>
                    ))}
                  </div>
                  {shownErrors.expectedDoneReason && (
                    <p className="text-xs text-red-600">{shownErrors.expectedDoneReason}</p>
                  )}
                </div>
              )}
            </div>

            {!failCauseRequired && failCauseField}
            <p className="-mt-3 text-xs break-keep text-slate-500">
              쉼표로 여러 개 적을 수 있어요. 내 행동에서 나오는 원인을 하나는 넣어 주세요.
            </p>

            {/* 알림: 방식 · 몇 분 전 · 문구 */}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-slate-700">알림</p>
              <SegmentedToggle
                label="알림 방식"
                options={[
                  { value: 'message', label: '메시지' },
                  { value: 'call', label: 'AI 전화' },
                ]}
                value={values.alertMethod}
                onChange={(next) => change('alertMethod', next)}
              />
              <div className="flex flex-wrap gap-2">
                {ALERT_MINUTES_OPTIONS.map((minutes) => (
                  <ChipButton
                    key={minutes}
                    selected={values.alertMinutesBefore === minutes}
                    onClick={() => change('alertMinutesBefore', minutes)}
                  >
                    {minutes === 0 ? '정각' : `${minutes}분 전`}
                  </ChipButton>
                ))}
              </div>
              <Input
                value={values.alertText}
                onChange={(event) => change('alertText', event.target.value)}
                maxLength={ALERT_TEXT_MAX_LENGTH}
                aria-label="알림 문구"
                placeholder="알림 문구 (비우면 기본 문구)"
              />
            </div>
          </div>
        )}
      </Card>

      {isSleepBlocked && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm break-keep text-red-700">
          수면 보호 시간({sleepWindow.label})과 겹쳐서 저장할 수 없어요. 시작 시각이나 길이를 바꿔
          주세요.
        </p>
      )}
      {!isSleepBlocked && bufferWarning && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm break-keep text-amber-800">
          {bufferWarning} (저장은 돼요)
        </p>
      )}

      {/* 이 화면의 채운 버튼은 [저장] 하나. 긴 폼이라 모바일에서는 하단 탭 바로 위(엄지 자리)에 붙여 둡니다. (피츠의 법칙)
          취소는 붙이지 않고 맨 끝에 조용한 글자 버튼으로 둡니다. */}
      {/* sticky 는 감싼 상자 안에서만 붙어 있어서, 폼(form)의 바로 아래 자식으로 둡니다. */}
      <StickyActionBar aboveTabBar>
        <Button type="submit" size="lg" disabled={isSleepBlocked} className="w-full">
          {editingCard ? '고친 내용 저장' : '카드 저장'}
        </Button>
      </StickyActionBar>
      {/* -mt-4: 폼 간격(gap-6)을 줄여 [저장] 바로 아래에 붙여 보이게 합니다. */}
      <Link
        to={`/cards?date=${values.date}`}
        className="-mt-4 inline-flex h-12 w-full items-center justify-center rounded-xl px-6 text-[15px] font-medium text-slate-700 hover:bg-slate-200/60"
      >
        취소
      </Link>
    </form>
  )
}

/**
 * 카드 만들기 · 고치기 화면 (최종 기획서 「4.3 카드」, #392)
 * - /cards/new?date=2026-10-17  → 그 날짜로 새 카드
 * - /cards/카드id/edit          → 그 카드 고치기
 * 필수는 제목 · 언제 · 체크리스트뿐이고, 나머지는 "더 정하기" 안에 접어 둡니다.
 */
export function CardEditPage() {
  const { cardId } = useParams()
  const navigate = useNavigate()
  const todayKey = getTodayKey()
  const { cards, addCard, updateCard, deleteCard } = useCards()
  const { sessions } = useStudySessions()
  // "과목" 칸에서 고를 내 과목 (진짜 로그인은 서버의 과목, 테스트 로그인은 이 기기의 과목)
  const subjects = useSubjects()
  // "이 카드를 지울까요?" 확인창이 열려 있는지
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  // 주소의 ?date= 는 누구나 고칠 수 있어서, 진짜 날짜가 아니면 오늘로 봅니다.
  const [dateParam] = useQueryParam('date', todayKey)
  const startDate = isDateKey(dateParam) ? dateParam : todayKey
  // 성향 설정(#385)은 화면을 열 때 한 번만 읽습니다.
  const [settings] = useState(loadAutoSettings)
  const [now] = useState(() => Date.now())
  const isServerData = useIsServerData()
  // 수면 보호 시간은 온보딩에서 답한 취침 · 기상 시각으로 만듭니다. (화면을 열 때 한 번만 읽습니다)
  const [sleepWindow] = useState(() => {
    const answers = loadOnboardingAnswers()
    return getSleepWindow(answers?.sleepTime, answers?.wakeUpTime)
  })

  const editingCard = cardId ? cards.find((card) => card.id === cardId) : undefined
  const accuracy = getRecentPlanAccuracy(cards, sessions, todayKey)
  // 목표 연결 칸: 진행 중인 목표 + (고치는 카드에 이미 끝난 목표가 걸려 있으면) 그 목표
  const { goals, activeGoals } = useGoals()
  const linkedGoal = goals.find((goal) => goal.id === editingCard?.goalId)
  const goalOptions =
    linkedGoal && !activeGoals.includes(linkedGoal) ? [...activeGoals, linkedGoal] : activeGoals
  // 새 카드의 목표 기본값은 가장 최근에 만든 진행 중 목표입니다.
  const defaultGoalId = getLatestActiveGoal(goals)?.id ?? ''
  // 체크리스트 AI 추천(#413): 테스트 로그인이면 끄고, 성향상 2주가 지났으면 버튼으로만 받습니다.
  const aiChecklist = !isServerData
    ? 'off'
    : shouldSuggestSelfChecklist(settings.checklistWriter.value, cards, now)
      ? 'manual'
      : 'auto'

  function handleSave(card: CardData) {
    if (editingCard) {
      // 고친 카드는 id 가 같아서 모든 칸을 그대로 덮어씁니다.
      updateCard(card.id, card)
    } else {
      addCard(card)
    }
    navigate(`/cards?date=${card.date}`)
  }

  /**
   * 확인창에서 [지우기] 를 누르면 카드를 지우고 카드 화면으로 돌아갑니다.
   * useCards 의 deleteCard 가 저장하면서 서버에도 "지웠다" 를 보냅니다. (hooks/useCardSync.ts)
   * 이 카드로 잰 공부 기록은 지우지 않고 남깁니다.
   */
  function handleDelete() {
    if (!editingCard) return
    deleteCard(editingCard.id)
    setIsDeleteOpen(false)
    navigate(`/cards?date=${editingCard.date}`)
  }

  if (cardId && !editingCard) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[28px] leading-tight font-bold tracking-tight">
          카드를 찾을 수 없어요
        </h1>
        <p className="text-slate-600">지워졌거나 주소가 틀렸어요.</p>
        <Link to="/cards" className="text-brand inline-flex h-10 items-center font-medium">
          카드로 돌아가기
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        {/* 보던 날짜(?date=)로 돌아가는 링크라 모바일 · PC 모두 둡니다. 이 화면은 헤더에 ‹ 뒤로를 두지 않습니다. (2026-10-22) */}
        <Link
          to={`/cards?date=${editingCard?.date ?? startDate}`}
          className="mb-2 inline-flex h-10 items-center text-sm text-slate-500"
        >
          ← 카드
        </Link>
        <h1 className="text-[28px] leading-tight font-bold tracking-tight">
          {editingCard ? '카드 고치기' : '새 카드'}
        </h1>
        <p className="mt-2 text-[15px] break-keep text-slate-600">
          언제 할지와 체크리스트만 정하면 돼요.
        </p>
      </div>

      <CardForm
        // 다른 카드로 옮겨 가면 폼을 처음부터 다시 그립니다.
        key={cardId ?? 'new'}
        initialValues={
          editingCard ? cardToForm(editingCard) : createEmptyForm(startDate, now, defaultGoalId)
        }
        editingCard={editingCard}
        failCauseRequired={settings.failCauseRequired.value}
        optionalOpenByDefault={settings.optionalFieldsOpen.value}
        accuracy={accuracy}
        goalOptions={goalOptions}
        subjectOptions={subjects}
        aiChecklist={aiChecklist}
        sleepWindow={sleepWindow}
        allCards={cards}
        // 고정 일정 입력은 2026-10-18 에 지웠습니다. 겹침 검사는 앞뒤 카드만 봅니다. (lib/fixedBlocks.ts)
        fixedBlocks={NO_FIXED_BLOCKS}
        onSave={handleSave}
      />

      {/* 고칠 때만 보입니다. 되돌릴 수 없는 일이라 [저장] 과 멀리, 빨간 글자 + 선으로 둡니다. 누르면 확인창이 한 번 더 뜹니다. (설정의 "모든 기록 지우기" 와 같은 모양) */}
      {editingCard && (
        <Button
          variant="outline"
          size="md"
          className="w-full border-red-200 text-red-700 hover:bg-red-50 sm:w-auto sm:self-start"
          onClick={() => setIsDeleteOpen(true)}
        >
          카드 지우기
        </Button>
      )}

      <Modal isOpen={isDeleteOpen} onClose={() => setIsDeleteOpen(false)} title="카드를 지울까요?">
        {editingCard && (
          <>
            <p className="font-medium break-keep text-slate-900">
              &apos;{editingCard.title}&apos; 카드를 지워요.
            </p>
            <p className="mt-2 text-sm break-keep text-slate-600">
              {/* 반복 카드는 카드 하나가 여러 날에 보이는 것이라, 지우면 모든 날에서 사라집니다. */}
              {(editingCard.repeatDays?.length ?? 0) > 0 &&
                '반복 카드라서 모든 요일에서 사라져요. '}
              이 카드로 잰 공부 기록은 남아요.
            </p>
            <p className="mt-2 text-sm font-medium text-red-600">지운 뒤에는 되돌릴 수 없어요.</p>

            <div className="mt-5 flex gap-3">
              <Button
                variant="secondary"
                size="lg"
                className="flex-1"
                onClick={() => setIsDeleteOpen(false)}
              >
                취소
              </Button>
              <Button variant="danger" size="lg" className="flex-1" onClick={handleDelete}>
                지우기
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
