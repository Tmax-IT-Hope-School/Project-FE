import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ChipButton } from '@/components/ui/ChipButton'
import { Input } from '@/components/ui/Input'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { SegmentedToggle } from '@/components/ui/SegmentedToggle'
import { StickyActionBar } from '@/components/ui/StickyActionBar'
import { useCards } from '@/hooks/useCards'
import { useGoalLimit } from '@/hooks/useGoalLimit'
import { useGoals } from '@/hooks/useGoals'
import { useIsServerData } from '@/hooks/useIsServerData'
import { useQueryParam } from '@/hooks/useQueryParam'
import { cn } from '@/lib/cn'
import { getTodayKey } from '@/lib/date'
import {
  GOAL_DRAFT_KEY,
  GOAL_STEPS,
  buildGoal,
  createGoalWithCards,
  getFirstIncompleteStep,
  getStepErrors,
  isGoalStep,
  loadGoalDraft,
  type GoalDraft,
  type GoalStep,
} from '@/lib/goalForm'
import {
  GOAL_KIND_OPTIONS,
  GOAL_TEXT_MAX_LENGTH,
  GOAL_TITLE_MAX_LENGTH,
  INNER_OBSTACLE_EXAMPLES,
  MAX_ACTIVE_GOALS,
  suggestRoutineCards,
  toRoutineCards,
} from '@/lib/goals'
import { fetchRoutineCards, type RoutineCardSuggestion } from '@/lib/routineCardsApi'
import { formatWeekdays } from '@/lib/routines'
import { removeData, saveData } from '@/lib/storage'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'

/** 단계 이름 → 몇 번째인지 (0 부터) */
function getStepIndex(step: GoalStep): number {
  return GOAL_STEPS.findIndex((item) => item.step === step)
}

/**
 * 목표 만들기 화면 (주소: /goals/new?step=wish, 최종 기획서 「4.7 목표와 숲」, #391)
 *
 * WOOP 순서로 한 화면에 한 단계씩 받습니다. W 소망 → O 결과 → O 방해물 → P 계획.
 * - 지금 단계는 주소의 ?step= 에 둡니다. 새로고침하거나 뒤로 가기를 눌러도 자연스럽습니다.
 * - 적던 내용은 이 기기에 임시로 넣어 둡니다('study-goal-draft'). 저장하면 지웁니다.
 * - 마지막에 P 계획을 루틴 카드 2장으로 바꿔 제안하고, 고른 카드는 카드 탭에 들어갑니다.
 * - 저장한 뒤 카드 탭으로 갑니다. (첫 목표 뒤의 다짐 녹음은 2026-10-18 에 지웠습니다)
 * - 진행 중 목표가 이미 3개면 만들 수 없다고 알려 줍니다.
 */
export function GoalNewPage() {
  const navigate = useNavigate()
  const todayKey = getTodayKey()
  const { goals, addGoal } = useGoals()
  const goalLimit = useGoalLimit(goals)
  const { addCard } = useCards()
  const [draft, setDraft] = useState<GoalDraft>(loadGoalDraft)
  // [다음] 을 한 번 눌러 본 뒤부터 틀린 칸을 빨갛게 보여 줍니다.
  const [triedNext, setTriedNext] = useState(false)
  // 루틴 카드 제안 중 고른 것 (0번 · 1번). 처음엔 둘 다 골라 둡니다.
  const [picked, setPicked] = useState<number[]>([0, 1])
  const [now] = useState(() => Date.now())
  const [stepParam, setStepParam] = useQueryParam('step', 'wish')
  // 진짜 로그인일 때만 서버(AI)를 쓸 수 있습니다. 테스트 로그인의 가짜 토큰은 서버가 모릅니다.
  const isServerData = useIsServerData()
  // AI 가 제안한 루틴 카드 (BE#239). 아직 안 받았거나 못 받았으면 null 이고, 그때는 기본 제안을 씁니다.
  const [aiSuggestions, setAiSuggestions] = useState<RoutineCardSuggestion[] | null>(null)
  // AI 제안을 못 받았을 때의 안내
  const [aiNotice, setAiNotice] = useState<string | null>(null)

  const routineAi = useMutation({
    mutationFn: () => fetchRoutineCards(buildGoal(draft, 'preview', now)),
    onSuccess: (result) => {
      // 글에 위기 표현이 있으면(showHelp) 서버가 AI 를 쓰지 않습니다. 못 받았을 때처럼 기본 제안으로 갑니다.
      if (result.showHelp || result.cards === null) {
        setAiNotice('AI 가 지금은 카드를 만들지 못해서 기본 제안을 보여 줘요.')
        return
      }
      setAiNotice(null)
      setAiSuggestions(result.cards)
      // 받은 카드는 처음엔 모두 골라 둡니다.
      setPicked(result.cards.map((_, index) => index))
    },
    onError: () => setAiNotice('AI 제안을 받지 못해서 기본 제안을 보여 줘요.'),
  })

  // 적을 때마다 임시 저장합니다. (새로고침해도 이어서 쓰게)
  useEffect(() => {
    saveData(GOAL_DRAFT_KEY, draft)
  }, [draft])

  // 주소는 누구나 고칠 수 있어서, 단계 이름이 아니면 첫 단계로 봅니다.
  const requestedStep: GoalStep = isGoalStep(stepParam) ? stepParam : 'wish'
  // 앞 단계를 다 채우지 않았으면 주소로 건너뛰어 와도 그 단계를 보여 줍니다.
  const firstIncomplete = getFirstIncompleteStep(draft, todayKey)
  const step =
    firstIncomplete !== null && getStepIndex(firstIncomplete) < getStepIndex(requestedStep)
      ? firstIncomplete
      : requestedStep
  const stepIndex = getStepIndex(step)
  const stepInfo = GOAL_STEPS[stepIndex]
  const errors = triedNext ? getStepErrors(draft, step, todayKey) : {}

  // P 계획 단계에서 보여 줄 루틴 카드 제안. AI 제안이 있으면 그것, 없으면 기본 제안입니다. (저장할 때 진짜 목표 id 로 다시 만듭니다)
  const previewGoal = buildGoal(draft, 'preview', now)
  const previewCards = aiSuggestions
    ? toRoutineCards(aiSuggestions, previewGoal, todayKey, now)
    : suggestRoutineCards(previewGoal, todayKey, now)

  /** 한 칸만 바꿉니다. */
  function change<K extends keyof GoalDraft>(key: K, value: GoalDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  function handleNext() {
    if (Object.keys(getStepErrors(draft, step, todayKey)).length > 0) {
      setTriedNext(true)
      return
    }
    setTriedNext(false)
    setStepParam(GOAL_STEPS[stepIndex + 1].step)
  }

  function handlePrev() {
    setTriedNext(false)
    setStepParam(GOAL_STEPS[stepIndex - 1].step)
  }

  /** 대처를 고치면 앞서 받은 AI 제안은 맞지 않으니 기본 제안으로 돌아갑니다. */
  function handleChangePlan(text: string) {
    change('plan', text)
    setAiSuggestions(null)
    setAiNotice(null)
    setPicked([0, 1])
  }

  function handleTogglePick(index: number) {
    setPicked((prev) =>
      prev.includes(index) ? prev.filter((item) => item !== index) : [...prev, index],
    )
  }

  function handleSave() {
    if (Object.keys(getStepErrors(draft, step, todayKey)).length > 0) {
      setTriedNext(true)
      return
    }
    const { goal, cards } = createGoalWithCards(draft, picked, todayKey, aiSuggestions)
    if (!addGoal(goal)) return
    for (const card of cards) addCard(card)
    removeData(GOAL_DRAFT_KEY)
    navigate('/cards')
  }

  /** [다음] · [목표 저장] (입력칸에서 Enter 를 눌러도 여기로 옵니다) */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (step === 'plan') handleSave()
    else handleNext()
  }

  // 진행 중 목표가 이미 3개면 만들 수 없다고 알려 줍니다. (서버에만 있는 목표까지 셉니다, hooks/useGoalLimit.ts)
  // 이렇게 미리 막지 않으면 이 기기에는 저장되지만 서버가 "3개까지예요"(409)로 거절해서 이 기기에만 남습니다.
  if (!goalLimit.canAdd) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <h1 className="text-[28px] leading-tight font-bold tracking-tight break-keep">
          목표는 동시에 {MAX_ACTIVE_GOALS}개까지예요
        </h1>
        <p className="text-[15px] break-keep text-slate-600">
          진행 중인 목표가 이미 {goalLimit.activeCount}개예요. 끝내거나 그만둔 목표가 생기면 새로
          만들 수 있어요.
        </p>
        {goalLimit.serverOnlyCount > 0 && (
          <p className="text-sm break-keep text-slate-500">
            다른 기기나 예전 기록으로 서버에만 있는 목표가 {goalLimit.serverOnlyCount}개 있어요.
          </p>
        )}
        <Link to="/cards" className="text-brand inline-flex h-10 items-center font-medium">
          카드로 돌아가기
        </Link>
      </div>
    )
  }

  // 주소의 단계가 앞서 있으면 주소도 지금 보여 주는 단계로 고칩니다.
  // (그대로 두면 칸 하나를 채우는 순간 [다음] 을 안 눌러도 앞 단계로 넘어가 버립니다)
  if (step !== requestedStep) {
    return <Navigate to={`/goals/new?step=${step}`} replace />
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="mx-auto flex w-full max-w-xl flex-col gap-6"
    >
      <div>
        {/* 돌아가는 링크라 모바일 · PC 모두 둡니다. 이 화면은 헤더에 ‹ 뒤로를 두지 않습니다. (2026-10-22) */}
        <Link to="/cards" className="mb-2 inline-flex h-10 items-center text-sm text-slate-500">
          ← 카드
        </Link>
        <h1 className="text-[28px] leading-tight font-bold tracking-tight">목표 만들기</h1>
        {/* 몇 단계 중 몇 번째인지. 끝이 보이면 끝까지 가게 됩니다. (목표 기울기 효과) */}
        <p className="mt-3 flex items-baseline justify-between text-[13px]">
          <span className="font-semibold text-slate-900">
            {stepInfo.letter} {stepInfo.label}
          </span>
          <span className="text-slate-500 tabular-nums">
            {stepIndex + 1} / {GOAL_STEPS.length} 단계
          </span>
        </p>
        <ProgressBar value={((stepIndex + 1) / GOAL_STEPS.length) * 100} className="mt-2" />
      </div>

      <Card>
        {step === 'wish' && (
          <div className="flex flex-col gap-5">
            <h2 className="text-[17px] font-semibold break-keep text-slate-900">
              D-day 까지 이루고 싶은 게 뭐예요?
            </h2>
            <SegmentedToggle
              label="목표 유형"
              options={GOAL_KIND_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              value={draft.kind}
              onChange={(next) => change('kind', next)}
            />
            <Input
              id="goal-title"
              label="목표"
              value={draft.title}
              onChange={(event) => change('title', event.target.value)}
              maxLength={GOAL_TITLE_MAX_LENGTH}
              placeholder={GOAL_KIND_OPTIONS.find((option) => option.value === draft.kind)?.example}
              error={errors.title}
            />
            <Input
              id="goal-dday"
              type="date"
              label="D-day"
              value={draft.dDay}
              onChange={(event) => change('dDay', event.target.value)}
              error={errors.dDay}
            />
            {draft.kind === 'score' ? (
              <Input
                id="goal-current-score"
                label="지금 점수·등급"
                value={draft.currentScore}
                onChange={(event) => change('currentScore', event.target.value)}
                maxLength={20}
                placeholder="예: 5등급, 62점"
                error={errors.currentScore}
              />
            ) : (
              <div className="grid grid-cols-[1fr_6rem] gap-3">
                <Input
                  id="goal-total-amount"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  label="전체 분량"
                  value={draft.totalAmount}
                  onChange={(event) => change('totalAmount', event.target.value)}
                  placeholder="예: 300"
                  error={errors.totalAmount}
                />
                <Input
                  id="goal-amount-unit"
                  label="단위"
                  value={draft.amountUnit}
                  onChange={(event) => change('amountUnit', event.target.value)}
                  maxLength={5}
                  placeholder="쪽"
                  error={errors.amountUnit}
                />
              </div>
            )}
          </div>
        )}

        {step === 'outcome' && (
          <div className="flex flex-col gap-5">
            <h2 className="text-[17px] font-semibold break-keep text-slate-900">
              「{draft.title.trim()}」 를 이루면 어떻게 될까요?
            </h2>
            <Input
              id="goal-benefit"
              label="이루면 좋은 점"
              value={draft.benefit}
              onChange={(event) => change('benefit', event.target.value)}
              maxLength={GOAL_TEXT_MAX_LENGTH}
              placeholder="예: 원하는 반에 들어갈 수 있어요"
              error={errors.benefit}
            />
            <Input
              id="goal-cost"
              label="안 하면 생길 일"
              value={draft.cost}
              onChange={(event) => change('cost', event.target.value)}
              maxLength={GOAL_TEXT_MAX_LENGTH}
              placeholder="예: 겨울방학에 처음부터 다시 해야 해요"
              error={errors.cost}
            />
          </div>
        )}

        {step === 'obstacle' && (
          <div className="flex flex-col gap-4">
            <h2 className="text-[17px] font-semibold break-keep text-slate-900">
              나를 가장 많이 막는 건 뭐예요?
            </h2>
            <p className="text-sm break-keep text-slate-600">
              학원·날씨처럼 내가 바꿀 수 없는 것 말고, <strong>내 안에서 나오는 것 하나</strong>만
              골라요. 바꿀 수 있는 것이어야 대처를 세울 수 있어요.
            </p>
            <div className="flex flex-wrap gap-2">
              {INNER_OBSTACLE_EXAMPLES.map((example) => (
                <ChipButton
                  key={example}
                  selected={draft.obstacle === example}
                  onClick={() => change('obstacle', example)}
                >
                  {example}
                </ChipButton>
              ))}
            </div>
            <Input
              id="goal-obstacle"
              label="직접 적기"
              value={draft.obstacle}
              onChange={(event) => change('obstacle', event.target.value)}
              maxLength={GOAL_TEXT_MAX_LENGTH}
              placeholder="예: 학원 다녀오면 눕고 싶어져요"
              error={errors.obstacle}
            />
          </div>
        )}

        {step === 'plan' && (
          <div className="flex flex-col gap-5">
            <h2 className="text-[17px] font-semibold break-keep text-slate-900">
              「{draft.obstacle.trim()}」 일 때 어떻게 할까요?
            </h2>
            <Input
              id="goal-plan"
              label="그럴 때 나는"
              value={draft.plan}
              onChange={(event) => handleChangePlan(event.target.value)}
              maxLength={GOAL_TEXT_MAX_LENGTH}
              placeholder="예: 폰을 다른 방에 두고 시작해요"
              error={errors.plan}
            />

            {/* 대처를 루틴 카드로 바꾼 제안. 고른 카드만 카드 탭에 들어갑니다 */}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-slate-700">
                {aiSuggestions ? 'AI 가 이렇게 제안했어요' : '이렇게 카드로 만들어 둘까요?'}
              </p>
              {/* AI 제안 (BE#239). 진짜 로그인일 때만. 못 받으면 기본 제안을 그대로 씁니다 */}
              {isServerData && (
                <Button
                  variant="secondary"
                  onClick={() => routineAi.mutate()}
                  disabled={draft.plan.trim() === '' || routineAi.isPending}
                  className="self-start"
                >
                  {routineAi.isPending
                    ? 'AI 가 카드를 만드는 중…'
                    : aiSuggestions
                      ? 'AI 에게 다시 제안 받기'
                      : 'AI 에게 카드 제안 받기'}
                </Button>
              )}
              {aiNotice && (
                <p role="status" className="text-xs break-keep text-slate-500">
                  {aiNotice}
                </p>
              )}
              <ul className="flex flex-col gap-2">
                {previewCards.map((card, index) => (
                  <li key={card.id}>
                    <button
                      type="button"
                      aria-pressed={picked.includes(index)}
                      onClick={() => handleTogglePick(index)}
                      className={cn(
                        'flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                        // 고른 카드는 연한 brand 바탕 + 테두리 (2차 규칙 1)
                        picked.includes(index)
                          ? 'border-brand bg-brand-light ring-brand ring-1'
                          : 'border-slate-200 hover:border-slate-300',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs',
                          picked.includes(index)
                            ? 'border-brand text-brand bg-white font-bold'
                            : 'border-slate-300',
                        )}
                      >
                        {picked.includes(index) ? '✓' : ''}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium break-keep text-slate-900">
                          {card.title}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {formatWeekdays(card.repeatDays ?? [])} {card.startTime} ·{' '}
                          {card.durationMinutes}분
                        </span>
                        <span className="block text-xs break-keep text-slate-500">
                          {card.checklist.map((item) => item.text).join(' · ')}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-xs break-keep text-slate-500">
                고른 카드는 내일부터 카드 탭에 들어가요. 나중에 고칠 수 있어요.
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* 1순위 [다음] · [목표 저장] 은 모바일에서 하단 탭 바로 위(엄지 자리)에 붙여 둡니다. (피츠의 법칙) */}
      <StickyActionBar aboveTabBar className="flex-row gap-2">
        {stepIndex > 0 && (
          <Button variant="ghost" size="lg" className="shrink-0" onClick={handlePrev}>
            이전
          </Button>
        )}
        <Button type="submit" size="lg" className="min-w-0 flex-1">
          {step === 'plan' ? '목표 저장' : '다음'}
        </Button>
      </StickyActionBar>
    </form>
  )
}
