import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { useState } from 'react'
import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { SegmentedToggle } from '@/components/ui/SegmentedToggle'
import { Skeleton } from '@/components/ui/Skeleton'
import { useQueryParam } from '@/hooks/useQueryParam'
import { ApiError, getApiErrorMessage } from '@/lib/api'
import { cn } from '@/lib/cn'
import { splitMathText } from '@/lib/mathText'
import {
  dailyVariantsQuery,
  levelLabel,
  reviewItemsQuery,
  reviewStatusLabel,
  shortDateLabel,
  submitVariantAttempt,
  weeklyVariantsQuery,
  type AssignmentStatus,
  type AttemptResult,
  type VariantFormat,
} from '@/lib/variantApi'

/**
 * 수학 변형 문제 화면(/variants)입니다. 통계 탭 아래에 있습니다. (BE docs/VARIANT-SPEC.md)
 *
 * 틀린 문제를 매일 조금씩 바꿔서 다시 냅니다. 문제는 서버의 AI 가 만들고, 정답을 계산으로 확인한 문제만 옵니다.
 *   오늘 문제 : 그날의 일일 과제. 답을 내면 정답 · 해설과 "내일은 어떤 문제가 나오는지" 를 보여 줍니다.
 *   주간 심화 : 매주 월요일에 지난주(월 ~ 일) 것으로 만든 심화 세트
 *   오답노트  : 연습 중 · 극복 · 심화까지 통과한 문제 목록
 * 어느 보기를 보는지는 주소의 ?tab= 에 담습니다. (오늘 문제는 주소에 적지 않습니다)
 */

type TabKey = 'daily' | 'weekly' | 'notes'

const TABS: { value: TabKey; label: string }[] = [
  { value: 'daily', label: '오늘 문제' },
  { value: 'weekly', label: '주간 심화' },
  { value: 'notes', label: '오답노트' },
]

/**
 * 주소에서 받은 값이 쓸 수 있는 탭인지 확인합니다. 아니면 오늘 문제로 봅니다.
 * (예전 월간 탭의 주소 ?tab=monthly 도 오늘 문제로 갑니다. 월간은 2026-10-24 에 주간으로 바뀌었습니다)
 */
function toTab(value: string): TabKey {
  return value === 'weekly' || value === 'notes' ? value : 'daily'
}

export function VariantPage() {
  const [tabParam, setTabParam] = useQueryParam('tab', 'daily')
  const tab = toTab(tabParam)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-[28px] leading-tight font-bold tracking-tight">수학 변형 문제</h1>
        <p className="text-sm break-keep text-slate-600">
          틀린 문제를 매일 조금씩 바꿔서 다시 풀어요. 숫자만 바꾼 문제를 맞히면 다음 날엔 조금 바꾼
          문제가 나오고, 그것까지 맞히면 극복이에요.
        </p>
      </div>

      <SegmentedToggle
        label="보기"
        options={TABS}
        value={tab}
        onChange={(next) => setTabParam(next)}
      />

      <AsyncBoundary
        pendingFallback={<ListSkeleton />}
        errorMessage="문제를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요."
        resetKeys={[tab]}
      >
        {tab === 'daily' && <DailyList />}
        {tab === 'weekly' && <WeeklyList />}
        {tab === 'notes' && <ReviewNotes />}
      </AsyncBoundary>
    </div>
  )
}

/** 불러오는 동안의 자리 표시. 문제 카드와 비슷한 크기입니다. */
function ListSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-4">
      <span className="sr-only">문제를 불러오는 중이에요</span>
      <Skeleton className="h-48 w-full rounded-2xl" />
      <Skeleton className="h-48 w-full rounded-2xl" />
    </div>
  )
}

// ---- 오늘 문제 ----

function DailyList() {
  const { data } = useSuspenseQuery(dailyVariantsQuery())

  if (data.items.length === 0 && data.preparingCount === 0) {
    return (
      <Card>
        <p className="py-6 text-center text-sm break-keep text-slate-500">
          오늘 풀 문제가 없어요. 틀린 문제를 등록하면 다음 날부터 여기에 나와요.
        </p>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {data.preparingCount > 0 && (
        <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm break-keep text-slate-600">
          {data.preparingCount}문제는 아직 준비 중이에요. 잠시 뒤에 다시 열어 보세요.
        </p>
      )}
      {data.items.map((item, index) => (
        <ProblemCard
          key={item.assignmentId}
          number={index + 1}
          badge={levelLabel(item.level)}
          assignmentId={item.assignmentId}
          format={item.format}
          passage={item.passage}
          problemText={item.problemText}
          math={item.math}
          choicesLatex={item.choicesLatex}
          status={item.status}
        />
      ))}
    </div>
  )
}

// ---- 주간 심화 ----

function WeeklyList() {
  // 주간 세트는 매주 월요일 새벽에 지난주 것으로 만듭니다. 서버가 가장 최근 세트를 줍니다.
  const { data } = useSuspenseQuery(weeklyVariantsQuery())

  if (data === null) {
    return (
      <Card>
        <p className="py-6 text-center text-sm break-keep text-slate-500">
          아직 주간 심화 세트가 없어요. 매주 월요일에 지난주 문제로 만들어져요.
        </p>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm break-keep text-slate-600">
        {shortDateLabel(data.weekStart)} 주 심화 · {shortDateLabel(data.dueDate)} 까지
      </p>
      {data.items.map((item) => (
        <ProblemCard
          key={item.assignmentId}
          number={item.number}
          badge={item.source === 'a' ? '맞은 유형 심화' : '극복한 오답 심화'}
          assignmentId={item.assignmentId}
          format={item.format}
          passage={item.passage}
          problemText={item.problemText}
          math={item.math}
          choicesLatex={item.choicesLatex}
          status={item.status}
        />
      ))}
    </div>
  )
}

// ---- 오답노트 ----

function ReviewNotes() {
  const { data } = useSuspenseQuery(reviewItemsQuery())

  if (data.length === 0) {
    return (
      <Card>
        <p className="py-6 text-center text-sm break-keep text-slate-500">
          아직 오답노트가 비어 있어요.
        </p>
      </Card>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {data.map((item) => (
        <li key={item.id}>
          <Card className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
              <span
                className={cn(
                  'rounded-full px-2.5 py-1',
                  item.status === 'active'
                    ? 'bg-blue-50 text-blue-700'
                    : 'bg-green-50 text-green-700',
                )}
              >
                {reviewStatusLabel(item.status)}
              </span>
              {item.status === 'active' && (
                <span className="text-slate-500">{levelLabel(item.currentLevel)}</span>
              )}
              {item.needsAttention && (
                <span className="rounded-full bg-orange-50 px-2.5 py-1 text-orange-700">
                  계속 어려워하는 문제
                </span>
              )}
            </div>
            {item.typeName !== null && (
              <p className="text-xs text-slate-500">
                {item.unitName} · {item.typeName}
              </p>
            )}
            {item.problemText !== null && (
              <MathText text={item.problemText} className="text-[15px] text-slate-900" />
            )}
            {item.nextDueDate !== null && item.status === 'active' && (
              <p className="text-xs text-slate-500">다음에 나올 날: {item.nextDueDate}</p>
            )}
          </Card>
        </li>
      ))}
    </ul>
  )
}

// ---- 문제 한 장 ----

interface ProblemCardProps {
  number: number
  /** 문제 위의 작은 이름표 (예: '다시 풀기', '맞은 유형 심화') */
  badge: string
  assignmentId: string
  format: VariantFormat
  /** 문제가 기대는 지문. 없으면 null */
  passage: string | null
  problemText: string
  /** true 면 선지 · 정답이 LaTeX(수학), false 면 $...$ 만 수식인 보통 글 */
  math: boolean
  choicesLatex: string[]
  status: AssignmentStatus
}

const CHOICE_MARKS = ['①', '②', '③', '④', '⑤']

/**
 * 문제 한 장: 문제 글 → (5지선다면 선지 버튼 · 단답형이면 숫자 입력) → 답 내기 → 채점 결과.
 * 답을 낸 결과는 이 카드 안에만 둡니다. (서버는 다시 불러와도 정답을 주지 않아서, 새로고침하면 "이미 푼 문제" 로 보입니다)
 */
function ProblemCard({
  number,
  badge,
  assignmentId,
  format,
  passage,
  problemText,
  math,
  choicesLatex,
  status,
}: ProblemCardProps) {
  const queryClient = useQueryClient()
  // 고른 선지 번호(5지선다) 또는 적은 숫자(단답형)
  const [answer, setAnswer] = useState('')
  // 카드를 처음 그린 시각. 답을 낼 때 "걸린 시간" 을 셉니다.
  const [startedAt] = useState(Date.now)
  const [result, setResult] = useState<AttemptResult | null>(null)

  const mutation = useMutation({
    mutationFn: submitVariantAttempt,
    onSuccess: (data) => {
      setResult(data)
      // 과제 상태 · 오답노트가 바뀌었으니 다시 받아오게 합니다.
      void queryClient.invalidateQueries({ queryKey: ['variant'] })
    },
    onError: (error) => {
      // 이미 답했거나 마감이 지났으면(409) 목록을 다시 받아서 카드가 "이미 푼 문제" · "마감" 으로 바뀌게 합니다.
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: ['variant'] })
      }
    },
  })

  const answered = result !== null
  const locked = answered || status !== 'pending'
  const canSubmit = !locked && !mutation.isPending && isAnswerReady(format, answer)

  function handleSubmit() {
    if (!canSubmit) return
    mutation.mutate({
      assignmentId,
      answer: answer.trim(),
      // 서버는 하루(86400초)보다 길면 400 으로 거절해서, 카드를 오래 열어 뒀어도 하루로 맞춥니다.
      timeSpentSec: Math.min(86400, Math.max(0, Math.round((Date.now() - startedAt) / 1000))),
    })
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-xs font-medium">
        <span className="text-slate-500">{number}번</span>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">{badge}</span>
        {format === 'short' && <span className="text-slate-500">단답형</span>}
      </div>

      {passage !== null && (
        <MathText
          text={passage}
          className="rounded-xl bg-slate-50 p-4 text-[15px] leading-relaxed text-slate-800"
        />
      )}

      <MathText text={problemText} className="text-[16px] leading-relaxed text-slate-900" />

      {format === 'mc5' ? (
        <ul className="flex flex-col gap-2">
          {choicesLatex.map((latex, index) => {
            const value = String(index)
            const isChosen = answer === value
            const isRight = answered && result.correctAnswer === value
            const isWrongPick = answered && isChosen && !result.isCorrect
            return (
              <li key={value}>
                <button
                  type="button"
                  disabled={locked}
                  aria-pressed={isChosen}
                  onClick={() => setAnswer(value)}
                  className={cn(
                    'flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl border px-4 py-2 text-left transition-colors',
                    'disabled:cursor-default',
                    isChosen ? 'border-brand bg-brand-light' : 'border-slate-200 bg-white',
                    isRight && 'border-green-500 bg-green-50',
                    isWrongPick && 'border-red-400 bg-red-50',
                  )}
                >
                  <span className="shrink-0 text-slate-500">{CHOICE_MARKS[index]}</span>
                  <AnswerText text={latex} math={math} />
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          답 (1 ~ 999 자연수)
          <input
            type="text"
            inputMode="numeric"
            value={answer}
            disabled={locked}
            onChange={(event) => setAnswer(event.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
            className="h-12 w-full max-w-40 rounded-xl border border-slate-200 px-4 text-[16px] disabled:bg-slate-50"
          />
        </label>
      )}

      {!answered && status === 'pending' && (
        <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full sm:w-auto">
          {mutation.isPending ? '채점하는 중…' : '답 내기'}
        </Button>
      )}
      {!answered && status !== 'pending' && (
        <p className="text-sm text-slate-500">
          {status === 'answered' ? '이미 푼 문제예요.' : '마감이 지난 문제예요.'}
        </p>
      )}
      {mutation.isError && (
        <p role="alert" className="text-sm break-keep text-red-600">
          {getApiErrorMessage(mutation.error)}
        </p>
      )}

      {result !== null && <ResultPanel result={result} format={format} math={math} />}
    </Card>
  )
}

/** 답을 낼 수 있는 모양인지: 5지선다는 선지를 골랐는지, 단답형은 1 ~ 999 숫자를 적었는지 */
function isAnswerReady(format: VariantFormat, answer: string): boolean {
  if (format === 'mc5') return /^[0-4]$/.test(answer)
  const number = Number(answer)
  return /^\d{1,3}$/.test(answer) && number >= 1 && number <= 999
}

interface ResultPanelProps {
  result: AttemptResult
  format: VariantFormat
  /** 정답(correctAnswerLatex)이 LaTeX 인지 (ProblemCard 의 math 와 같음) */
  math: boolean
}

/** 채점 결과: 맞음/틀림 · 정답 · 고른 오답의 실수 · 해설 · 내일 나올 문제 */
function ResultPanel({ result, format, math }: ResultPanelProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col gap-3 rounded-xl p-4',
        result.isCorrect ? 'bg-green-50' : 'bg-red-50',
      )}
    >
      <p
        className={cn(
          'text-[17px] font-bold',
          result.isCorrect ? 'text-green-700' : 'text-red-700',
        )}
      >
        {result.isCorrect ? '맞았어요!' : '아쉬워요, 틀렸어요'}
      </p>
      {!result.isCorrect && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-800">
          정답:
          {format === 'mc5' && <span>{CHOICE_MARKS[Number(result.correctAnswer)]}</span>}
          <AnswerText text={result.correctAnswerLatex} math={math} />
        </p>
      )}
      {result.chosenDistractorRationale !== null && result.chosenDistractorRationale !== '' && (
        <p className="text-sm break-keep text-slate-700">
          고른 답은 이런 실수에서 자주 나와요: {result.chosenDistractorRationale}
        </p>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold text-slate-500">해설</p>
        <MathText text={result.solution} className="text-sm leading-relaxed text-slate-800" />
      </div>
      {result.reviewItem !== null && (
        <p className="text-sm font-medium break-keep text-slate-700">
          {nextStepText(result.reviewItem.status, result.reviewItem.currentLevel)}
        </p>
      )}
    </div>
  )
}

/** 이 답으로 바뀐 학습 항목을 보고 "다음에 무엇이 나오는지" 를 알려 줍니다. */
function nextStepText(status: string, level: number): string {
  if (status === 'graduated')
    return '극복했어요! 다음 주 월요일 주간 심화 세트에서 한 번 더 만나요.'
  if (status === 'mastered') return '심화까지 통과했어요. 이 문제는 끝!'
  if (level === 1) return '내일은 조금 바꾼 문제가 나와요.'
  if (level === -1) return '내일은 단계를 나눠서 차근차근 풀어 봐요.'
  return '내일 비슷한 문제를 한 번 더 풀어요.'
}

// ---- 수식 그리기 (KaTeX) ----

interface MathTextProps {
  /** 보통 글과 $...$ 수식이 섞인 글 */
  text: string
  className?: string
  /** true 면 <p> 대신 <span> 으로 그립니다. (버튼 · 문단 안에는 <p> 를 넣을 수 없어서) */
  inline?: boolean
}

/** 글 안의 $...$ 만 수식으로 그리고, 나머지는 글자 그대로 둡니다. */
function MathText({ text, className, inline = false }: MathTextProps) {
  const Tag = inline ? 'span' : 'p'
  return (
    <Tag className={cn('break-keep whitespace-pre-wrap', className)}>
      {splitMathText(text).map((part, index) =>
        part.math ? (
          <MathFormula key={index} latex={part.text} />
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </Tag>
  )
}

interface AnswerTextProps {
  /** 선지 하나 또는 정답 */
  text: string
  /** true 면 text 전체가 LaTeX(수학), false 면 $...$ 만 수식인 보통 글 */
  math: boolean
}

/**
 * 선지 · 정답을 그립니다. 수학이 아닌 과목의 글을 통째로 KaTeX 에 넣으면
 * 띄어쓰기가 사라지고 기울어진 글자가 돼서, math 가 false 면 MathText 로 그립니다.
 */
function AnswerText({ text, math }: AnswerTextProps) {
  if (math) return <MathFormula latex={text} />
  return <MathText text={text} inline />
}

interface MathFormulaProps {
  latex: string
}

/**
 * LaTeX 한 덩어리를 KaTeX 로 그립니다. 틀린 LaTeX 여도 화면이 깨지지 않게 빨간 글자로만 보여 줍니다(throwOnError: false).
 * dangerouslySetInnerHTML 을 쓰는 이유: KaTeX 가 수식을 HTML 글로 만들어 주기 때문입니다.
 * KaTeX 는 기본값(trust: false)에서 링크 · 스크립트 같은 명령을 막아서, 서버가 준 글을 넣어도 안전합니다.
 * 긴 수식(행렬 등)이 화면 밖으로 나가지 않게 가로로만 스크롤합니다.
 * 출력은 KaTeX 기본값(htmlAndMathml)입니다. 눈에 보이는 HTML 과 함께, 화면 읽기 프로그램이 읽는 MathML 도 숨겨서 넣습니다.
 */
function MathFormula({ latex }: MathFormulaProps) {
  const html = katex.renderToString(latex, { throwOnError: false })
  return (
    <span
      className="inline-block max-w-full overflow-x-auto align-middle"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
