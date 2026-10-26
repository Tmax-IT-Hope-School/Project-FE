import { BackToTabLink } from '@/components/layout/BackToTabLink'
import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { UnderstandingBadge } from '@/components/ui/UnderstandingBadge'
import { useIsServerData } from '@/hooks/useIsServerData'
import { pastCallsQuery, type PastCall } from '@/lib/callHistoryApi'
import { getTodayKey, moveDateKey } from '@/lib/date'
import { CHAT_PATH } from '@/lib/tabMenu'
import { useSuspenseQuery } from '@tanstack/react-query'

const weekdayNames = ['일', '월', '화', '수', '목', '금', '토']

/** 'YYYY-MM-DD' → '오늘 · 10월 26일 (월)', '어제 · …', '10월 24일 (토)' */
function formatCallDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const text = `${month}월 ${day}일 (${weekdayNames[new Date(year, month - 1, day).getDay()]})`
  const todayKey = getTodayKey()
  if (dateKey === todayKey) return `오늘 · ${text}`
  if (dateKey === moveDateKey(todayKey, -1)) return `어제 · ${text}`
  return text
}

/**
 * 지난 통화 화면 (주소: /call/history, STARFLOW D19)
 *
 * 통화를 마무리하면 「오늘의 통화 정리」(/call/result)가 한 번 보이고 끝이라, 지난 통화를 다시 볼 곳이 없었습니다.
 * 서버의 내 통화 기록(GET /calls, 최근 30일)을 받아 날짜 · 요약 · 이해도 · 생각 습관을 최근 것부터 보여 줍니다.
 * 끝낸 채팅(글로 하는 통화)도 서버가 같은 목록으로 주어서 같이 보입니다. (lib/callHistoryApi.ts)
 * 채팅 탭의 「📞 매일 통화」 아래 [지난 통화 보기] 와 통화 정리 화면에서 들어옵니다.
 */
export function CallHistoryPage() {
  const isServerData = useIsServerData()

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <div>
        <BackToTabLink to={CHAT_PATH} label="채팅" />
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">지난 통화</h1>
        <p className="mt-1 text-sm break-keep text-slate-600">
          최근 30일 동안 마무리한 통화와 채팅의 정리예요. 녹음은 남기지 않고 요약만 저장해요.
        </p>
      </div>

      {isServerData ? (
        <AsyncBoundary
          pendingFallback={<CallHistorySkeleton />}
          errorMessage="지난 통화를 받아오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요."
        >
          <CallHistoryList />
        </AsyncBoundary>
      ) : (
        // 테스트 로그인은 서버에 통화 기록이 없습니다. (통화도 걸 수 없음)
        <Card>
          <p className="text-sm break-keep text-slate-600">
            테스트 로그인은 통화 기록이 서버에 남지 않아요. 구글로 로그인하면 지난 통화를 다시 볼 수
            있어요.
          </p>
        </Card>
      )}
    </div>
  )
}

/** 받는 동안 보여 줄 자리. 진짜 목록과 비슷한 크기로 그립니다. */
function CallHistorySkeleton() {
  return (
    <div role="status" className="flex flex-col gap-3">
      <span className="sr-only">지난 통화를 불러오는 중이에요</span>
      <Skeleton className="h-32 w-full rounded-2xl" />
      <Skeleton className="h-32 w-full rounded-2xl" />
    </div>
  )
}

/** 서버의 지난 통화 목록. 최근 것부터 (서버가 정렬해 줍니다) */
function CallHistoryList() {
  const { data: calls } = useSuspenseQuery(pastCallsQuery())

  if (calls.length === 0) {
    return (
      <Card>
        <p className="text-sm break-keep text-slate-600">
          아직 마무리한 통화가 없어요. 채팅 탭의 「📞 매일 통화」로 AI 선생님과 통화하면 여기에
          쌓여요.
        </p>
      </Card>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {calls.map((call) => (
        <li key={call.callId}>
          <PastCallCard call={call} />
        </li>
      ))}
    </ul>
  )
}

interface PastCallCardProps {
  call: PastCall
}

/** 지난 통화 하나: 날짜 · 이해도 · 요약 · 대답에서 보인 생각 습관 */
function PastCallCard({ call }: PastCallCardProps) {
  return (
    <Card>
      {/* flex-wrap: 375px 에서 이해도 배지가 날짜 아래 줄로 내려갑니다. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[15px] font-semibold text-slate-900">{formatCallDate(call.date)}</p>
        {call.understanding && <UnderstandingBadge understanding={call.understanding} />}
      </div>

      <p className="mt-2 text-[15px] leading-relaxed [overflow-wrap:anywhere] break-keep text-slate-700">
        {call.summary ?? '요약을 만들지 못한 통화예요.'}
      </p>

      {/* 생각 습관은 "그런 생각에 붙는 이름" 이지, 나를 그런 사람이라고 부르는 것이 아닙니다. (lib/callReview.ts) */}
      {call.bias && (
        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm break-keep">
          <p className="font-semibold text-slate-900">생각 습관 · {call.bias.label}</p>
          {call.bias.evidence && <p className="mt-1 text-slate-600">{call.bias.evidence}</p>}
          <p className="mt-1 text-slate-600">해 볼 것: {call.bias.solution}</p>
        </div>
      )}
    </Card>
  )
}
