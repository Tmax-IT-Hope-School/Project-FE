import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { ApiError } from '@/lib/api'
import { saveCallToCheckIn } from '@/lib/callCheckIn'
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
import { formatMinutes } from '@/lib/dailyRecords'
import { getTodayKey } from '@/lib/date'
import { isSafetyBrakeOnNow } from '@/lib/focusMode'
import { SUPPORT_PATH, helpLines } from '@/lib/helpLines'
import { getTodayCareLevel } from '@/lib/todayCare'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

/**
 * 통화가 끝난 뒤 "오늘의 결론" 을 보여 주는 화면입니다. (BE 이슈 #28 · #29)
 *
 * 통화 화면이 넘겨준 통화 번호와 자막을 서버에 보내면, 서버가 정리해서 돌려줍니다. (lib/callReview.ts)
 *  - 대답에서 보인 생각 습관(인지편향): 이름 · 어떤 생각인지 · 근거 · 다음에 해 볼 행동
 *  - 오늘의 약속, 지난 약속을 지켰는지
 *  - 통화 요약
 * 이 결론과 이 브라우저의 기록(어제 공부·오늘 체크인)을 합쳐 "오늘 통화 요약" 카드로 보여 주고,
 * 약속은 오늘 체크인에 저장합니다. (#38, lib/callCheckIn.ts)
 * 위기 표현이 감지된 통화면 결론 대신 도움 안내를 먼저 보여 줍니다.
 *
 * 생각 습관의 이름은 "생각" 에 붙입니다. "너는 ~형이야" 처럼 사람에게 붙이지 않습니다.
 */
export function CallResultPage() {
  const location = useLocation()
  const navigate = useNavigate()
  // 처음 들어올 때 받은 값을 들고 있습니다. (정리가 끝나면 주소에 딸린 자막을 지우는데, 그 뒤에도 다시 시도할 수 있게)
  const [resultState] = useState(() => readCallResultState(location.state))

  // useMutation: 서버에 "통화를 마무리해 줘" 라고 보내는 요청입니다. 보내는 중·실패를 대신 관리해 줍니다. (docs/DATA-FETCHING.md 5장)
  const mutation = useMutation({
    // 결론을 받으면 바로 오늘 체크인에 저장합니다. (#38) 저장했는지도 같이 돌려줘서 화면이 안내 문장을 고릅니다.
    mutationFn: async (state: CallResultState) => {
      const conclusion = await finishCall(state)
      return { conclusion, isSavedToCheckIn: saveCallToCheckIn(conclusion) }
    },
    onSuccess: () => {
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
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">오늘의 통화 정리</h1>

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

      {mutation.isSuccess && (
        <ConclusionView
          conclusion={mutation.data.conclusion}
          isSavedToCheckIn={mutation.data.isSavedToCheckIn}
        />
      )}

      {/* 모바일에서는 버튼을 위아래로, PC 에서는 나란히 놓습니다. */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          variant="secondary"
          className="w-full sm:w-auto"
          onClick={() => navigate('/analysis')}
        >
          내 기록 보기
        </Button>
        <Button variant="ghost" className="w-full sm:w-auto" onClick={() => navigate('/')}>
          홈으로
        </Button>
      </div>
    </div>
  )
}

/** 서버가 정리하는 동안 보여 주는 자리 (진짜 카드와 비슷한 크기) */
function ConclusionSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-4">
      <span className="text-sm text-slate-500">
        통화 내용을 정리하고 있어요. 30초쯤 걸릴 수 있어요.
      </span>
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
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
        <p className="text-sm break-keep text-slate-700">
          이미 정리한 통화예요. 내 기록에서 다시 볼 수 있어요.
        </p>
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
  /** 통화 결과를 오늘 체크인에 저장했는지 (lib/callCheckIn.ts) */
  isSavedToCheckIn: boolean
}

/**
 * 오늘의 결론. 위기 표현이 감지됐으면 도움 안내만 보여 줍니다.
 * 안전 브레이크(#95)가 켜진 쉬는 날에는 생각 습관 교정 · 오늘의 약속을 빼고 요약만 부드럽게 보여 줍니다.
 */
function ConclusionView({ conclusion, isSavedToCheckIn }: ConclusionViewProps) {
  // 처음 그릴 때 한 번만 확인합니다. (통화 화면들과 같은 기준, lib/focusMode.ts)
  const [isRestDay] = useState(isSafetyBrakeOnNow)
  if (conclusion.showHelp) return <HelpCard />

  return (
    <div className="flex flex-col gap-4">
      <SummaryCard
        conclusion={conclusion}
        isSavedToCheckIn={isSavedToCheckIn}
        isRestDay={isRestDay}
      />
      {isRestDay ? (
        <Card>
          <p className="text-sm break-keep text-slate-700">
            오늘은 쉬어 가는 날이라 생각 습관이나 약속 얘기는 하지 않을게요. 푹 쉬고, 이야기하고
            싶을 때 언제든 다시 걸어 줘요.
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
 * 어제 요약은 이 브라우저의 공부 기록으로 계산하고, 미달 원인·오늘 예상은 오늘 체크인에서 꺼냅니다.
 * 약속은 통화에서 정한 것을 먼저 보여 주고, 없으면 체크인에 적어 둔 약속을 보여 줍니다.
 */
interface SummaryCardProps extends ConclusionViewProps {
  /** 안전 브레이크가 켜진 쉬는 날이면 true — 오늘의 약속을 보여 주지 않습니다 */
  isRestDay: boolean
}

function SummaryCard({ conclusion, isSavedToCheckIn, isRestDay }: SummaryCardProps) {
  // 처음 그릴 때 한 번만 저장소에서 읽습니다. (체크인 저장이 끝난 뒤에 이 화면이 그려집니다)
  const [card] = useState(() => loadTodayCallCard(getTodayKey()))
  // 오늘의 관리 강도에 맞는 이름과 색입니다. (통화 수신 화면과 같은 값, lib/todayCare.ts)
  const theme = careThemes[getTodayCareLevel()]

  const callPromise =
    conclusion.promiseIf !== null && conclusion.promiseThen !== null
      ? `만약 ${conclusion.promiseIf} → ${conclusion.promiseThen}`
      : null
  const promise = callPromise ?? card.promise

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">오늘 통화 요약</h2>
        <span
          className={cn(
            'shrink-0 rounded-full px-3 py-1 text-xs font-semibold text-white',
            theme.avatarBackground,
          )}
        >
          {theme.name} 모드
        </span>
      </div>

      {/* 모바일은 이름 아래에 값, PC 는 이름 옆에 값 (시안과 같은 배치) */}
      <dl className="mt-3 divide-y divide-slate-100">
        <SummaryRow label="어제 요약" value={card.headline} />
        {card.missReason !== null && <SummaryRow label="못 채운 이유" value={card.missReason} />}
        {conclusion.promiseKept !== null && (
          <SummaryRow label="지난 약속" value={conclusion.promiseKept ? '지켰어' : '못 지켰어'} />
        )}
        {/* 0분이면 formatMinutes 가 '1분 미만' 이라고 써서, 정해진 시간이 있을 때만 보여 줍니다. */}
        {card.expectedMinutes !== null && card.expectedMinutes > 0 && (
          <SummaryRow label="오늘 예상" value={formatMinutes(card.expectedMinutes)} />
        )}
        {promise !== null && !isRestDay && <SummaryRow label="오늘의 약속" value={promise} />}
        {conclusion.summary !== null && (
          <SummaryRow label="AI 한마디" value={`"${conclusion.summary}"`} />
        )}
      </dl>

      {isSavedToCheckIn ? (
        <p className="mt-3 text-xs break-keep text-slate-500">
          통화 내용은 오늘 체크인으로 자동 저장됐어요.
        </p>
      ) : (
        <div className="mt-3">
          <p className="text-xs break-keep text-slate-500">
            오늘 체크인을 아직 안 해서 통화 내용을 저장하지 못했어요.
          </p>
          {/* 누르는 곳은 최소 40px(h-10) */}
          <Link
            to="/check"
            className="text-brand inline-flex h-10 items-center text-sm font-medium underline"
          >
            체크인하러 가기
          </Link>
        </div>
      )}
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
      <dd className="text-sm font-semibold break-keep text-slate-900">{value}</dd>
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
      {habit.evidence !== null && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm break-keep text-slate-700">
          통화에서: {habit.evidence}
        </p>
      )}
      <div className="bg-brand/10 mt-4 rounded-lg px-3 py-3">
        <p className="text-brand-dark text-sm font-semibold">다음엔 이렇게 해 볼까요?</p>
        <p className="mt-1 text-sm break-keep text-slate-900">{habit.solution}</p>
      </div>
      <p className="mt-3 text-xs break-keep text-slate-500">
        한 번 보였다고 내가 그런 사람이라는 뜻은 아니에요. 생각 습관은 알아차리면 바꿀 수 있어요.
      </p>
    </Card>
  )
}

/** 위기 표현이 감지된 통화에서 보여 주는 도움 안내 */
function HelpCard() {
  return (
    <Card title="혼자 힘들어하지 않아도 돼요">
      <p className="text-sm break-keep text-slate-700">
        힘든 이야기를 들려줘서 고마워요. 오늘은 공부 이야기는 잠시 내려놓아도 괜찮아요. 믿을 수 있는
        어른에게 꼭 이야기해 주고, 이야기할 곳이 필요하면 아래로 언제든 연락해 보세요. 무료이고
        비밀이 지켜져요.
      </p>
      {/* 모바일에서는 눌러서 바로 전화가 걸립니다. 누르는 곳은 최소 40px(h-11 = 44px) */}
      <div className="mt-4 flex flex-col gap-2">
        {helpLines.map((line) => (
          <a
            key={line.number}
            href={`tel:${line.number}`}
            className="bg-brand hover:bg-brand-dark flex h-11 items-center justify-center rounded-lg px-4 text-sm font-medium text-white"
          >
            {line.name} {line.number}
          </a>
        ))}
      </div>
      <Link
        to={SUPPORT_PATH}
        className="mt-3 flex h-10 items-center justify-center text-sm font-medium text-slate-700 underline"
      >
        도움받을 수 있는 곳 더 보기
      </Link>
    </Card>
  )
}
