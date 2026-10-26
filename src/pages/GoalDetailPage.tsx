import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { GrowthCurveChart } from '@/components/ui/GrowthCurveChart'
import { Input } from '@/components/ui/Input'
import { useCards } from '@/hooks/useCards'
import { useGoals } from '@/hooks/useGoals'
import { useQueryParam } from '@/hooks/useQueryParam'
import { cn } from '@/lib/cn'
import { loadAllSessions } from '@/lib/dailyRecords'
import { getTodayKey, moveDateKey } from '@/lib/date'
import { formatDday, getDaysUntil } from '@/lib/exams'
import {
  CHECK_REASON_MAX_LENGTH,
  GOAL_RESULT_MAX_LENGTH,
  changeGoalOnCheck,
  finishGoal,
  getCompletionProgress,
  getCompletionResultText,
  giveUpGoal,
  isCheckReasonValid,
  isGoalCheckDue,
  isGoalResultDue,
  isGoalResultValid,
  keepGoal,
  recordDoneAmount,
  type CompletionProgress,
} from '@/lib/goalProgress'
import { getGrowthCurve } from '@/lib/growthCurve'
import type { Goal } from '@/types'
import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'

/** 목표 상태를 화면에 보여 줄 글자 */
const STATUS_LABELS: Record<Goal['status'], string> = {
  active: '진행 중',
  done: '완료',
  givenUp: '그만둠',
}

/** 완주형 진척 상태의 한 줄 */
const PACE_LABELS: Record<CompletionProgress['status'], string> = {
  ahead: '고르게 했을 때보다 앞서 있어요',
  onTrack: '고르게 하고 있어요',
  behind: '고르게 했을 때보다 뒤처져 있어요',
  done: '다 했어요',
}

/** 목표 점검에서 보고 있는 단계. 주소의 ?check= 값입니다. ('' = 점검 안 함) */
type CheckStep = '' | 'open' | 'change' | 'giveUp'

/** 주소에서 받은 ?check= 값을 단계로 바꿉니다. 모르는 값이면 점검 안 함 */
function toCheckStep(value: string): CheckStep {
  return value === 'open' || value === 'change' || value === 'giveUp' ? value : ''
}

/**
 * 목표 상세 화면입니다. (주소: /goals/:goalId, 기획서 「4.7 목표와 숲」, #403)
 * 유형별 진척(완주형: 페이스 / 점수형: 예상 성장 곡선)과 WOOP, 처음 목표값(이력), 2주 목표 점검을 보여 줍니다.
 * D-day 가 되면 2주 점검 대신 결과를 적고 '완료' 로 보관합니다. (#672)
 * 점검 단계는 주소에 둡니다. (?check=open · change · giveUp) 뒤로 가기를 누르면 앞 단계로 갑니다.
 */
export function GoalDetailPage() {
  const { goalId } = useParams()
  const { goals, updateGoal } = useGoals()
  const { cards } = useCards()
  const [sessions] = useState(loadAllSessions)
  const [checkParam, setCheckParam] = useQueryParam('check', '')
  const [savedMessage, setSavedMessage] = useState('')
  const todayKey = getTodayKey()

  const goal = goals.find((item) => item.id === goalId)
  if (goal === undefined) {
    return (
      <div className="flex flex-col gap-4">
        <BackToCards />
        <p className="text-slate-600">목표를 찾지 못했어요. 지워졌거나 주소가 틀렸을 수 있어요.</p>
      </div>
    )
  }

  const checkStep = goal.status === 'active' ? toCheckStep(checkParam) : ''
  // D-day 가 됐으면 결과 적기가 먼저입니다. 이때는 2주 점검을 권하지 않습니다.
  const isResultDue = isGoalResultDue(goal, todayKey)
  const isDue = isGoalCheckDue(goal, todayKey) && !isResultDue
  const daysUntil = getDaysUntil(goal.dDay)

  function finishCheck(next: Goal, message: string) {
    updateGoal(next)
    setSavedMessage(message)
    setCheckParam('')
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BackToCards />
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
            {goal.kind === 'score' ? '점수형' : '완주형'}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
            {STATUS_LABELS[goal.status]}
          </span>
        </div>
        <h1 className="mt-2 text-[28px] leading-tight font-bold tracking-tight break-keep">
          {goal.title}
        </h1>
        <p className="text-brand mt-1 text-sm font-semibold tabular-nums">
          {goal.dDay} · {formatDday(daysUntil)}
        </p>
      </div>

      {savedMessage !== '' && (
        <p role="status" className="rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {savedMessage}
        </p>
      )}

      {isResultDue && checkStep === '' && (
        <GoalResultCard
          goal={goal}
          todayKey={todayKey}
          onFinish={(result) =>
            finishCheck(
              finishGoal(goal, result),
              "목표를 마무리했어요. 카드 탭의 '완료한 목표'에 남아요.",
            )
          }
        />
      )}

      {goal.status === 'done' && (
        <Card title="결과">
          <p className="text-sm break-keep text-slate-700">{goal.result || '—'}</p>
        </Card>
      )}

      {/* 2주가 지났으면 점검을 권합니다. (통화의 조건부 모듈도 같은 함수 isGoalCheckDue 로 부릅니다) */}
      {isDue && checkStep === '' && (
        <Card className="border-amber-300 bg-amber-50">
          <p className="text-sm font-semibold text-amber-900">목표 점검할 때가 됐어요</p>
          <p className="mt-1 text-sm break-keep text-amber-900">
            2주 동안의 페이스를 보고, 이대로 갈지 · 바꿀지 · 그만둘지 정해요.
          </p>
          <Button className="mt-3 w-full sm:w-auto" onClick={() => setCheckParam('open')}>
            점검하기
          </Button>
        </Card>
      )}

      {checkStep !== '' ? (
        <GoalCheck
          goal={goal}
          step={checkStep}
          todayKey={todayKey}
          onStep={setCheckParam}
          onKeep={() => finishCheck(keepGoal(goal, Date.now()), '이대로 가기로 했어요.')}
          onChange={(changes, reason) =>
            finishCheck(
              changeGoalOnCheck(goal, changes, reason, Date.now()),
              '목표를 바꿨어요. 원래 목표는 아래 기록에 남아 있어요.',
            )
          }
          onGiveUp={(reason) =>
            finishCheck(
              giveUpGoal(goal, reason, Date.now()),
              '목표를 그만뒀어요. 지금까지의 기록은 남아요.',
            )
          }
        />
      ) : (
        <>
          {goal.kind === 'completion' ? (
            <CompletionProgressCard goal={goal} todayKey={todayKey} onSave={updateGoal} />
          ) : (
            <ScoreProgressCard goal={goal} cards={cards} sessions={sessions} todayKey={todayKey} />
          )}

          <Card title="처음에 적은 것">
            <dl className="flex flex-col gap-3 text-sm break-keep">
              <WoopLine label="이루면 좋은 점" value={goal.benefit} />
              <WoopLine label="안 하면 생길 일" value={goal.cost} />
              <WoopLine label="내 안의 방해물" value={goal.obstacle} />
              <WoopLine label="방해물이 생기면" value={goal.plan} />
            </dl>
          </Card>

          {goal.history.length > 0 && <GoalHistoryCard goal={goal} />}

          {goal.status === 'givenUp' && goal.givenUpReason && (
            <Card title="그만둔 이유">
              <p className="text-sm break-keep text-slate-700">{goal.givenUpReason}</p>
            </Card>
          )}

          {goal.status === 'active' && !isDue && !isResultDue && (
            <Button
              variant="secondary"
              className="w-full sm:w-auto sm:self-start"
              onClick={() => setCheckParam('open')}
            >
              목표 점검하기
            </Button>
          )}
        </>
      )}
    </div>
  )
}

/** 화면 위의 "‹ 카드" 돌아가기 링크 (목표 만들기 화면과 같은 모양) */
function BackToCards() {
  return (
    // h-10 = 40px: 글자는 작아도 누르는 영역은 손가락으로 누를 만하게 합니다.
    // 돌아가는 링크라 모바일 · PC 모두 둡니다. 이 화면은 헤더에 ‹ 뒤로를 두지 않습니다. (2026-10-22)
    <Link to="/cards" className="text-brand inline-flex h-10 items-center text-sm font-medium">
      ‹ 카드
    </Link>
  )
}

interface WoopLineProps {
  label: string
  value: string
}

function WoopLine({ label, value }: WoopLineProps) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-800">{value || '—'}</dd>
    </div>
  )
}

interface GoalResultCardProps {
  goal: Goal
  todayKey: string
  onFinish: (result: string) => void
}

/**
 * D-day 가 되면 결과를 적고 목표를 마무리합니다. (#672)
 * 점수형은 받은 점수·등급을 적고, 완주형은 적어 둔 분량으로 결과를 만들어서 따로 묻지 않습니다.
 */
function GoalResultCard({ goal, todayKey, onFinish }: GoalResultCardProps) {
  const [scoreText, setScoreText] = useState('')
  const result = goal.kind === 'score' ? scoreText : getCompletionResultText(goal, todayKey)
  const canFinish = isGoalResultValid(result)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // form 이 기본으로 하는 "페이지 새로고침" 을 막습니다.
    event.preventDefault()
    if (!canFinish) return
    onFinish(result)
  }

  return (
    <Card className="border-amber-300 bg-amber-50">
      <p className="text-sm font-semibold text-amber-900">
        {todayKey > goal.dDay ? 'D-day 가 지났어요' : '오늘이 D-day 예요'}
      </p>
      <p className="mt-1 text-sm break-keep text-amber-900">
        결과를 적고 목표를 마무리해요. 마무리한 목표는 카드 탭의 '완료한 목표'에 남고, 진행 중 목표
        칸이 하나 비어요.
      </p>
      <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
        {goal.kind === 'score' ? (
          <Input
            id="goal-result"
            label="받은 점수·등급"
            value={scoreText}
            maxLength={GOAL_RESULT_MAX_LENGTH}
            placeholder={goal.currentScore ? `시작할 때 ${goal.currentScore}` : '예: 4등급, 78점'}
            onChange={(event) => setScoreText(event.target.value)}
            className="h-10 bg-white text-base"
          />
        ) : (
          <p className="text-sm break-keep text-amber-900">
            결과: <b>{result || '—'}</b>
            <br />
            분량을 덜 적었다면 아래 진척에서 먼저 고쳐 주세요.
          </p>
        )}
        <Button type="submit" className="w-full sm:w-auto sm:self-start" disabled={!canFinish}>
          마무리하기
        </Button>
      </form>
    </Card>
  )
}

interface CompletionProgressCardProps {
  goal: Goal
  todayKey: string
  onSave: (goal: Goal) => void
}

/** 완주형 진척: 한 분량 / 전체, 하루 페이스, 페이스 그래프, 오늘까지 한 분량 적기 */
function CompletionProgressCard({ goal, todayKey, onSave }: CompletionProgressCardProps) {
  const progress = getCompletionProgress(goal, todayKey)
  const [amountText, setAmountText] = useState('')
  const unit = goal.amountUnit ?? ''

  if (progress === null) {
    return (
      <Card title="진척">
        <p className="text-sm text-slate-500">전체 분량이 없어서 페이스를 계산할 수 없어요.</p>
      </Card>
    )
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // form 이 기본으로 하는 "페이지 새로고침" 을 막습니다.
    event.preventDefault()
    const amount = Number(amountText)
    if (amountText.trim() === '' || !Number.isFinite(amount)) return
    onSave(recordDoneAmount(goal, todayKey, amount))
    setAmountText('')
  }

  return (
    <Card title="진척">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-2xl font-bold text-slate-900 tabular-nums">
          {progress.done}
          <span className="text-base font-medium text-slate-500">
            {' '}
            / {progress.total}
            {unit}
          </span>
        </p>
        <p
          className={cn(
            'text-sm font-semibold',
            progress.status === 'behind' ? 'text-amber-700' : 'text-brand-dark',
          )}
        >
          {PACE_LABELS[progress.status]}
        </p>
      </div>
      {progress.status !== 'done' && (
        <p className="mt-1 text-sm break-keep text-slate-600">
          남은 {progress.remaining}
          {unit} ÷ {progress.daysLeft}일 = 하루 <b>{progress.dailyPace}</b>
          {unit}
        </p>
      )}
      <PaceChart goal={goal} progress={progress} todayKey={todayKey} className="mt-4" />
      {goal.status === 'active' && (
        <form onSubmit={handleSubmit} className="mt-4 flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Input
              id="done-amount"
              label={`오늘까지 한 분량 (${unit || '개'})`}
              type="number"
              inputMode="numeric"
              min={0}
              max={progress.total}
              value={amountText}
              placeholder={String(progress.done)}
              onChange={(event) => setAmountText(event.target.value)}
              className="h-10 text-base"
            />
          </div>
          <Button type="submit" className="shrink-0" disabled={amountText.trim() === ''}>
            적기
          </Button>
        </form>
      )}
    </Card>
  )
}

// 페이스 그래프의 SVG 좌표계. viewBox 로 정해서 실제 크기는 CSS(w-full)가 정합니다. (375px 에서도 안 넘침)
const CHART_WIDTH = 600
const CHART_HEIGHT = 200
const CHART_PAD_X = 8
const CHART_PAD_TOP = 12
const CHART_PAD_BOTTOM = 24

interface PaceChartProps {
  goal: Goal
  progress: CompletionProgress
  todayKey: string
  className?: string
}

/**
 * 완주형 페이스 그래프: 만든 날부터 D-day 까지 고르게 했을 때의 선(점선)과 내가 적은 분량(실선 + 점).
 * 차트 라이브러리를 쓰지 않고 SVG 로 그립니다. (GrowthCurveChart 와 같은 방법)
 */
function PaceChart({ goal, progress, todayKey, className }: PaceChartProps) {
  const startMs = new Date(`${progress.startKey}T12:00:00`).getTime()
  const endMs = Math.max(new Date(`${goal.dDay}T12:00:00`).getTime(), startMs + 1)
  const plotWidth = CHART_WIDTH - CHART_PAD_X * 2
  const plotHeight = CHART_HEIGHT - CHART_PAD_TOP - CHART_PAD_BOTTOM

  // 날짜 → x, 분량 → y. 그래프 밖으로 나가지 않게 0~1 로 자릅니다.
  const xOf = (dateKey: string) => {
    const ratio = (new Date(`${dateKey}T12:00:00`).getTime() - startMs) / (endMs - startMs)
    return CHART_PAD_X + Math.min(Math.max(ratio, 0), 1) * plotWidth
  }
  const yOf = (amount: number) =>
    CHART_PAD_TOP + (1 - Math.min(Math.max(amount / progress.total, 0), 1)) * plotHeight

  const points = [
    { dateKey: progress.startKey, doneAmount: 0 },
    ...(goal.progressLog ?? []).filter((entry) => entry.dateKey >= progress.startKey),
  ]
  const actualPath = points
    .map(
      (point, index) => `${index === 0 ? 'M' : 'L'}${xOf(point.dateKey)},${yOf(point.doneAmount)}`,
    )
    .join(' ')
  const todayX = xOf(todayKey)

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="h-auto w-full max-w-full"
        role="img"
        aria-label={`페이스 그래프: 고르게 했다면 오늘까지 ${progress.expectedDone}, 실제 ${progress.done}`}
      >
        {/* 바닥선 */}
        <line
          x1={CHART_PAD_X}
          x2={CHART_WIDTH - CHART_PAD_X}
          y1={yOf(0)}
          y2={yOf(0)}
          className="stroke-slate-200"
          strokeWidth={2}
        />
        {/* 오늘 */}
        <line
          x1={todayX}
          x2={todayX}
          y1={CHART_PAD_TOP}
          y2={yOf(0)}
          className="stroke-slate-300"
          strokeDasharray="4 4"
        />
        {/* 고르게 했을 때 (만든 날 0 → D-day 전체) */}
        <line
          x1={xOf(progress.startKey)}
          y1={yOf(0)}
          x2={xOf(goal.dDay)}
          y2={yOf(progress.total)}
          className="stroke-slate-400"
          strokeWidth={2}
          strokeDasharray="6 6"
        />
        {/* 내가 적은 분량 */}
        <path d={actualPath} fill="none" className="stroke-brand" strokeWidth={3} />
        {points.slice(1).map((point) => (
          <circle
            key={point.dateKey}
            cx={xOf(point.dateKey)}
            cy={yOf(point.doneAmount)}
            r={5}
            className="fill-brand"
          />
        ))}
        <text x={CHART_PAD_X} y={CHART_HEIGHT - 6} className="fill-slate-500 text-[22px]">
          시작
        </text>
        <text
          x={CHART_WIDTH - CHART_PAD_X}
          y={CHART_HEIGHT - 6}
          textAnchor="end"
          className="fill-slate-500 text-[22px]"
        >
          D-day
        </text>
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>
          <span aria-hidden className="text-brand">
            ━
          </span>{' '}
          내가 한 분량
        </span>
        <span>
          <span aria-hidden>┅</span> 고르게 했다면 (오늘까지 {progress.expectedDone})
        </span>
      </div>
    </div>
  )
}

interface ScoreProgressCardProps {
  goal: Goal
  cards: { id: string; goalId?: string }[]
  sessions: ReturnType<typeof loadAllSessions>
  todayKey: string
}

/** 점수형 진척: 지금 점수와, 이 목표 카드의 공부 기록으로 그린 예상 성장 곡선 (lib/growthCurve.ts) */
function ScoreProgressCard({ goal, cards, sessions, todayKey }: ScoreProgressCardProps) {
  const goalCardIds = new Set(
    cards.filter((card) => card.goalId === goal.id).map((card) => card.id),
  )
  const goalSessions = sessions.filter(
    (session) => session.kind !== 'play' && session.cardId && goalCardIds.has(session.cardId),
  )
  const curve = getGrowthCurve([], goalSessions, todayKey, goal.dDay)

  return (
    <Card title="진척">
      <p className="text-sm text-slate-600">
        시작할 때 점수: <b className="text-slate-900">{goal.currentScore || '—'}</b>
      </p>
      {curve.hasEnoughData ? (
        <GrowthCurveChart curve={curve} examLabel="D-day" className="mt-4" />
      ) : (
        <p className="mt-3 text-sm break-keep text-slate-500">
          이 목표에 연결한 카드로 7일 넘게 공부하면, D-day 까지의 예상 성장 곡선을 보여 줄게요.
        </p>
      )}
    </Card>
  )
}

interface GoalHistoryCardProps {
  goal: Goal
}

/** 목표값을 바꾼 기록. 원래 목표를 잊지 않게 보여 줍니다. (3번 · 7번 오류 대응) */
function GoalHistoryCard({ goal }: GoalHistoryCardProps) {
  return (
    <Card title="목표를 바꾼 기록">
      <ul className="flex flex-col gap-3 text-sm break-keep">
        {goal.history.map((snapshot) => (
          <li key={snapshot.changedAt}>
            <p className="text-slate-800">
              <span className="text-slate-500">원래:</span> {snapshot.title} · {snapshot.dDay}
              {snapshot.totalAmount !== undefined &&
                ` · ${snapshot.totalAmount}${snapshot.amountUnit ?? ''}`}
            </p>
            <p className="mt-0.5 text-slate-500">바꾼 이유: {snapshot.reason}</p>
          </li>
        ))}
      </ul>
    </Card>
  )
}

interface GoalCheckProps {
  goal: Goal
  step: Exclude<CheckStep, ''>
  todayKey: string
  onStep: (step: string) => void
  onKeep: () => void
  onChange: (changes: Partial<Pick<Goal, 'title' | 'dDay' | 'totalAmount'>>, reason: string) => void
  onGiveUp: (reason: string) => void
}

/**
 * 2주 목표 점검: 페이스를 보여 주고 유지 / 수정 / 포기를 고릅니다.
 * 수정 · 포기 때는 처음 적은 '이루면 좋은 점' 을 먼저 보여 주고, 이유를 적어야 저장됩니다.
 */
function GoalCheck({ goal, step, todayKey, onStep, onKeep, onChange, onGiveUp }: GoalCheckProps) {
  const progress = goal.kind === 'completion' ? getCompletionProgress(goal, todayKey) : null
  const [title, setTitle] = useState(goal.title)
  const [dDay, setDDay] = useState(goal.dDay)
  const [totalText, setTotalText] = useState(goal.totalAmount?.toString() ?? '')
  const [reason, setReason] = useState('')
  // 서버는 바꾼 D-day 를 내일 이후만 받습니다. (BE GoalService.checkDDay, 새 목표 만들기와 같은 규칙)
  // D-day 를 그대로 두면(이미 지났어도) 검사하지 않습니다.
  const minDDay = moveDateKey(todayKey, 1)
  const dDayError =
    dDay !== '' && dDay !== goal.dDay && dDay < minDDay ? 'D-day 는 내일 이후로 골라 주세요' : null

  const total = Number(totalText)
  const changes: Partial<Pick<Goal, 'title' | 'dDay' | 'totalAmount'>> = {}
  if (title.trim() !== '' && title.trim() !== goal.title) changes.title = title.trim()
  if (dDay !== '' && dDay !== goal.dDay) changes.dDay = dDay
  if (
    goal.kind === 'completion' &&
    Number.isInteger(total) &&
    total > 0 &&
    total !== goal.totalAmount
  ) {
    changes.totalAmount = total
  }
  const hasChange = Object.keys(changes).length > 0
  const isReasonOk = isCheckReasonValid(reason)

  return (
    <Card title="목표 점검">
      {/* 지금 페이스 */}
      <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm break-keep text-slate-700">
        {progress !== null ? (
          <>
            {progress.done}/{progress.total}
            {goal.amountUnit ?? ''} · {PACE_LABELS[progress.status]}
            {progress.status !== 'done' &&
              ` · 남은 기간 하루 ${progress.dailyPace}${goal.amountUnit ?? ''}`}
          </>
        ) : (
          <>
            D-day 까지 {formatDday(getDaysUntil(goal.dDay))} · 시작할 때 점수{' '}
            {goal.currentScore || '—'}
          </>
        )}
      </div>

      {step === 'open' && (
        <div className="mt-4 flex flex-col gap-2">
          <Button className="w-full" onClick={onKeep}>
            이대로 갈게요
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => onStep('change')}>
            목표를 바꿀래요
          </Button>
          {/* 되돌리기 어려운 길은 맨 아래 빨간 글자로 둡니다. (2차 규칙 3) */}
          <Button
            variant="ghost"
            className="w-full text-red-700 hover:bg-red-50"
            onClick={() => onStep('giveUp')}
          >
            그만둘래요
          </Button>
        </div>
      )}

      {(step === 'change' || step === 'giveUp') && (
        <div className="mt-4 flex flex-col gap-4">
          {/* 바꾸거나 그만두기 전에, 처음 적은 이루면 좋은 점을 먼저 보여 줍니다. */}
          <div className="bg-brand-light rounded-xl px-3 py-3">
            <p className="text-brand-dark text-sm font-semibold">처음에 적은 '이루면 좋은 점'</p>
            <p className="mt-1 text-sm break-keep text-slate-900">{goal.benefit || '—'}</p>
            {step === 'giveUp' && goal.cost && (
              <>
                <p className="text-brand-dark mt-3 text-sm font-semibold">'안 하면 생길 일'</p>
                <p className="mt-1 text-sm break-keep text-slate-900">{goal.cost}</p>
              </>
            )}
          </div>

          {step === 'change' && (
            <div className="flex flex-col gap-3">
              <Input
                id="goal-title"
                label="목표"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <Input
                id="goal-dday"
                label="D-day"
                type="date"
                min={minDDay}
                value={dDay}
                error={dDayError ?? undefined}
                onChange={(event) => setDDay(event.target.value)}
              />
              {goal.kind === 'completion' && (
                <Input
                  id="goal-total"
                  label={`전체 분량 (${goal.amountUnit || '개'})`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={totalText}
                  onChange={(event) => setTotalText(event.target.value)}
                />
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="check-reason" className="text-sm font-medium text-slate-700">
              {step === 'change' ? '왜 바꾸나요? (꼭 적어요)' : '왜 그만두나요? (꼭 적어요)'}
            </label>
            <textarea
              id="check-reason"
              value={reason}
              maxLength={CHECK_REASON_MAX_LENGTH}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              className="focus:border-brand w-full rounded-xl border border-slate-300 px-3 py-2 text-base outline-none"
            />
            <p className="text-xs text-slate-500">
              {reason.trim().length} / {CHECK_REASON_MAX_LENGTH}자 · 원래 목표는 지우지 않고
              기록으로 남겨요.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            {step === 'change' ? (
              <Button
                className="w-full sm:w-auto"
                disabled={!hasChange || !isReasonOk || dDayError !== null}
                onClick={() => onChange(changes, reason)}
              >
                이렇게 바꿀게요
              </Button>
            ) : (
              // 목표를 그만두는 것은 되돌리기 어려워서 빨간 버튼입니다. (2차 규칙 3)
              <Button
                variant="danger"
                className="w-full sm:w-auto"
                disabled={!isReasonOk}
                onClick={() => onGiveUp(reason)}
              >
                그만둘게요
              </Button>
            )}
            <Button variant="ghost" className="w-full sm:w-auto" onClick={() => onStep('open')}>
              ← 다시 고르기
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
