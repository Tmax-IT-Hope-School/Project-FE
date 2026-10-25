import { Button } from '@/components/ui/Button'
import { PlanCard } from '@/components/ui/PlanCard'
import { useAuth } from '@/hooks/useAuth'
import { useCards } from '@/hooks/useCards'
import { useIsServerData } from '@/hooks/useIsServerData'
import { careThemes, pickGreeting, type CareLevel } from '@/lib/careTheme'
import { cn } from '@/lib/cn'
import { loadCallCard } from '@/lib/callCard'
import {
  buildCallTools,
  callTalkLines,
  planOutputForAi,
  readDayPlanArgs,
  readLongPlanArgs,
  readReviseArgs,
  type ToolCall,
} from '@/lib/callTools'
import {
  makeDemoDayPlan,
  makeDemoLongPlan,
  planToCards,
  requestDayPlan,
  requestLongPlan,
  reviseDayPlan,
  reviseDemoPlan,
  reviseLongPlan,
  withDemoFallback,
  type CoachPlan,
  type PlanReply,
} from '@/lib/coachPlan'
import { getTodayKey, moveDateKey } from '@/lib/date'
import { saveMyEvent } from '@/lib/myEvents'
import { loadLocalCheckIn } from '@/lib/quickCheckIn'
import {
  CALL_ENDING_NOTICE,
  isCallEndingSoon,
  RealtimeCallError,
  startRealtimeCall,
  type RealtimeCall,
} from '@/lib/realtimeCall'
import { loadSchoolClass, schoolTodayOrNullQuery, todaySubjectsOf } from '@/lib/schoolToday'
import { FOCUS_NAME_MAX, loadStudyFocus } from '@/lib/studyFocus'
import { COACH_PATH } from '@/lib/chatRooms'
import { otherRoomLines } from '@/lib/coachThread'
import { getCallTone, getTodayCareLevel, getTodayMaxHarshness } from '@/lib/todayCare'
import { toCallLines, type CallResultState } from '@/lib/callReview'
import { applyTranscript, type SubtitleMessage } from '@/lib/transcript'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'

/**
 * 결과 화면에 넘길 값(통화 기록 번호 + 자막)을 만듭니다.
 * 서버가 통화 번호를 주지 않았으면(옛 서버 등) 정리할 수 없어서 null 입니다.
 */
function toResultState(callId: string | null, messages: SubtitleMessage[]): CallResultState | null {
  return callId === null ? null : { callId, lines: toCallLines(messages) }
}

/** 수신 화면이 넘겨준 인사말을 꺼냅니다. 없거나 모양이 다르면 null 입니다. */
function readGreeting(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) return null
  const greeting = (state as { greeting?: unknown }).greeting
  return typeof greeting === 'string' ? greeting : null
}

/** 연결 실패를 학생(사용자)이 이해할 수 있는 문구로 바꿉니다. */
function getFailMessage(error: unknown) {
  if (error instanceof RealtimeCallError) {
    if (error.reason === 'no-mic') {
      return '이 기기에서 마이크를 찾을 수 없어요. 마이크가 연결돼 있는지, 주소가 https 인지 확인해 주세요.'
    }
    if (error.reason === 'mic') return '마이크를 사용할 수 없어요. 마이크 권한을 확인해 주세요.'
    // 서버가 이유를 알려 준 경우(오늘 통화를 다 씀 · 통화가 아직 켜져 있지 않음)는 그 문장을 그대로 보여줍니다.
    if (error.userMessage) return error.userMessage
    if (error.reason === 'token') return 'AI 연결 준비에 실패했어요. 잠시 뒤에 다시 시도해 주세요.'
  }
  return 'AI 와 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.'
}

/** 연결이 안 된 경우(error)와 통화 중에 끊긴 경우(dropped)에 보여줄 글자입니다. */
const failedTexts = {
  error: {
    title: '연결에 실패했어요',
    retry: '다시 시도',
    leave: '말 대신 채팅으로 하기',
  },
  dropped: {
    title: '통화가 끊겼어요',
    retry: '다시 연결하기',
    leave: '평가 화면으로 가기',
  },
}

interface CallFailedViewProps {
  kind: 'error' | 'dropped'
  message: string
  /**
   * 마이크 때문에 실패했는지. true 면 "말 대신 채팅" 을 첫 번째(진한) 버튼으로 올립니다. (#460)
   * 마이크 권한을 바꾸기 전에는 다시 시도해도 똑같이 실패하기 때문입니다.
   */
  isMicProblem: boolean
  onRetry: () => void
  onLeave: () => void
  /** 개발 서버에서만 넘깁니다. 있으면 "연습 화면 보기" 버튼이 나옵니다. */
  onPreview?: () => void
}

/** 연결 실패·끊김 안내 화면입니다. 다시 시도하거나 다른 화면으로 갈 수 있습니다. */
function CallFailedView({
  kind,
  message,
  isMicProblem,
  onRetry,
  onLeave,
  onPreview,
}: CallFailedViewProps) {
  const texts = failedTexts[kind]
  // 위에 오는 버튼이 진한(primary) 버튼입니다.
  const retryButton = (
    <Button
      size="lg"
      variant={isMicProblem ? 'secondary' : 'primary'}
      className="w-full"
      onClick={onRetry}
    >
      {texts.retry}
    </Button>
  )
  const leaveButton = (
    <Button
      size="lg"
      variant={isMicProblem ? 'primary' : 'secondary'}
      className="w-full"
      onClick={onLeave}
    >
      {texts.leave}
    </Button>
  )

  return (
    <div className="flex min-h-screen flex-col items-center bg-white px-4 py-10 text-slate-900 sm:px-6">
      <div className="flex w-full max-w-md flex-1 flex-col items-center text-center">
        <div
          aria-hidden
          className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-100 text-4xl"
        >
          📞
        </div>
        <h1 className="mt-5 text-2xl font-bold tracking-tight break-keep sm:text-3xl">
          {texts.title}
        </h1>
        {/* role="alert": 실패하면 화면을 읽어 주는 프로그램이 바로 알려 줍니다. */}
        <p role="alert" className="mt-3 break-keep text-slate-600">
          {message}
        </p>

        {/* mt-auto: 버튼을 화면 아래로 밀어냅니다. */}
        <div className="mt-auto flex w-full flex-col gap-3 pt-10">
          {/* 마이크 문제면 "말 대신 체크인" 이 위(진한 버튼), 아니면 "다시 시도" 가 위입니다. */}
          {isMicProblem ? (
            <>
              {leaveButton}
              {retryButton}
            </>
          ) : (
            <>
              {retryButton}
              {leaveButton}
            </>
          )}
          {onPreview && (
            <Button size="sm" variant="ghost" className="w-full" onClick={onPreview}>
              (개발용) 연습 화면 보기
            </Button>
          )}
          <p className="text-sm break-keep text-slate-500">
            연결이 계속 안 되면 와이파이나 데이터를 확인해 줘.
          </p>
        </div>
      </div>
    </div>
  )
}

// 개발 중에 서버가 없어서 AI 와 연결이 안 될 때, 말풍선 모양을 확인하려고 쓰는 연습용 대화입니다.
// 개발 서버(pnpm run dev)에서만 쓰이고, 실제로 배포한 화면에서는 절대 나오지 않습니다.
const sampleConversation: Omit<SubtitleMessage, 'id'>[] = [
  { speaker: 'ai', text: '어제 순공 3시간 10분, 계획의 80%야.' },
  { speaker: 'me', text: '응… 폰 때문에 좀 늦게 시작했어.' },
  { speaker: 'ai', text: '괜찮아. 오늘은 몇 시간 할 것 같아?' },
  { speaker: 'me', text: '4시간은 하고 싶은데 학원 끝나고 나면 피곤해서 잘 모르겠어.' },
  { speaker: 'ai', text: '그럼 오늘 약속 하나 정해볼까? 만약 ~하면 → ~한다 로.' },
  { speaker: 'me', text: '학원에서 오면 폰을 거실에 두고 들어갈게.' },
]

interface SubtitleListProps {
  messages: SubtitleMessage[]
}

/** 대화 내용을 말풍선으로 쌓아 보여줍니다. 새 말풍선이 생기면 맨 아래로 자동 스크롤됩니다. */
function SubtitleList({ messages }: SubtitleListProps) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    // 목록 안쪽만 맨 아래로 내립니다. (scrollIntoView 는 화면 전체가 같이 움직일 수 있어서 쓰지 않습니다)
    list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
    // messages 전체를 지켜봅니다. AI 말이 조금씩 이어 붙어서 말풍선이 길어질 때도 따라 내려가야 하기 때문입니다.
  }, [messages])

  return (
    // role="log": 새 글자가 생기면 화면을 읽어 주는 프로그램이 알려 줍니다.
    <div
      ref={listRef}
      role="log"
      aria-label="대화 자막"
      className="mt-6 h-56 w-full overflow-y-auto rounded-2xl bg-white/10 p-3 text-left sm:h-64"
    >
      {messages.length === 0 ? (
        <p className="py-8 text-center text-sm text-indigo-100">
          AI 선생님이 말하면 여기에 글자로 나와요.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {messages.map((message) => (
            <li
              key={message.id}
              className={cn('flex', message.speaker === 'me' ? 'justify-end' : 'justify-start')}
            >
              {/* max-w-[80%] + break-words: 긴 말풍선도 화면 폭을 넘지 않고 안에서 줄바꿈됩니다. */}
              <p
                className={cn(
                  // 15px · leading-relaxed: 움직이는 통화 중에도 자막을 한 번에 읽을 수 있게 줄 사이를 넉넉히 둡니다.
                  'max-w-[85%] rounded-2xl px-4 py-2 text-[15px] leading-relaxed break-words sm:text-base',
                  message.speaker === 'me' ? 'bg-brand text-white' : 'bg-white/20 text-white',
                )}
              >
                {message.text}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface AiAvatarProps {
  careLevel: CareLevel
}

/** AI 선생님 얼굴입니다. 관리 강도(careLevel)에 따라 표정과 색이 바뀝니다. */
function AiAvatar({ careLevel }: AiAvatarProps) {
  const theme = careThemes[careLevel]

  return (
    // 바깥 동그라미는 숨 쉬듯 깜빡여서 "말하는 중" 느낌을 줍니다.
    <div className={cn('animate-pulse rounded-full p-3', theme.avatarGlow)}>
      <div
        role="img"
        aria-label={theme.avatarLabel}
        className={cn(
          'flex h-28 w-28 items-center justify-center rounded-full text-5xl sm:h-32 sm:w-32',
          theme.avatarBackground,
        )}
      >
        {theme.avatarEmoji}
      </div>
    </div>
  )
}

/** 지난 초를 "02:14" 모양으로 바꿉니다. */
function formatCallTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * 통화 중 화면입니다. (탭·헤더 없이 화면 전체를 씁니다)
 * 통화 시간이 1초마다 올라가고, 끊기를 누르면 평가 결과 화면으로 갑니다.
 */
export function CallActivePage() {
  const navigate = useNavigate()
  const location = useLocation()
  // 오늘 채팅 방들의 대화를 꺼낼 때 "누구의 대화방인지" 를 맞추려고 씁니다. (lib/coachThread.ts)
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [seconds, setSeconds] = useState(0)
  // 통화 한 번의 최대 길이(초). 연결된 뒤에 서버 값으로 정해집니다. (서버 값이 없거나 이상하면 180초, lib/realtimeCall.ts)
  // 연결 전에는 null 입니다.
  const [maxCallSeconds, setMaxCallSeconds] = useState<number | null>(null)
  // 끝나기 30초 전 "마무리해" 안내를 이번 통화에서 이미 AI 에게 보냈는지. (한 통화에 한 번만, 다시 시도하면 새 통화라 다시 보냄)
  const hasSentEndingNoticeRef = useRef(false)
  const [isMuted, setIsMuted] = useState(false)
  // 오늘의 관리 강도입니다. 아직 진짜 값이 없어서 고정값이에요. (자세한 건 todayCare.ts)
  // 0~3 으로 바꿔 보면 색·표정·인사말이 달라집니다.
  const careLevel = getTodayCareLevel()
  const theme = careThemes[careLevel]
  // 수신 화면에서 "받기" 를 눌러서 온 것인지. (받기를 누르면 인사말을 같이 넘겨줍니다)
  // 주소를 직접 쳐서 들어온 경우에는 통화를 시작하지 않고 수신 화면으로 돌려보냅니다.
  // 받기를 거치지 않으면 원하지 않는 통화가 걸리고(비용), 아이폰에서는 AI 목소리가 안 나올 수 있기 때문입니다.
  const cameFromAnswer = readGreeting(location.state) !== null
  // 수신 화면에서 보여준 인사말을 그대로 이어서 씁니다. (없으면 새로 고릅니다)
  // useState 안에서 한 번만 정합니다. (그냥 호출하면 1초마다 화면이 다시 그려질 때 인사말이 바뀝니다)
  const [greeting] = useState(
    () => readGreeting(location.state) ?? pickGreeting(careLevel, getTodayMaxHarshness()),
  )
  // AI 와의 연결 상태. 연결 중 → 연결됨. 처음부터 안 되면 error, 통화 중에 끊기면 dropped (안내 문구는 errorMessage)
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'error' | 'dropped'>(
    'connecting',
  )
  const [errorMessage, setErrorMessage] = useState('')
  // 마이크(권한이 막힘 · 마이크가 없음) 때문에 실패했는지. 실패 화면의 버튼 순서를 정하는 데 씁니다. (#460)
  const [isMicFailure, setIsMicFailure] = useState(false)
  // "다시 시도"를 누를 때마다 1 씩 올라갑니다. 이 숫자가 바뀌면 아래 useEffect 가 연결을 처음부터 다시 시작합니다.
  const [attempt, setAttempt] = useState(0)
  // 개발 서버에서 서버가 없어도 통화 화면(말풍선 등)을 볼 수 있게 하는 스위치입니다. 배포한 화면에서는 쓰이지 않습니다.
  const [isPreview, setIsPreview] = useState(false)
  // 연결된 통화를 들고 있습니다. 음소거 버튼이 이 통화의 마이크를 끄고 켜야 해서 useEffect 밖에서도 접근합니다.
  const callRef = useRef<RealtimeCall | null>(null)
  // 화면에 보이는 자막 말풍선들. AI 와 내 말이 오는 대로 쌓입니다.
  const [messages, setMessages] = useState<SubtitleMessage[]>([])
  // 서버의 통화 기록 번호. 연결되면 정해집니다. 통화가 끝나면 결과 화면이 이 번호로 자막을 보내 결론을 받습니다.
  const [callId, setCallId] = useState<string | null>(null)

  // ---- 통화 중 계획 (2026-10-18, 이슈 #577 · lib/callTools.ts) ----
  // 학생이 "계획 짜 줘" 라고 하면 AI 가 도구를 부르고, 이 화면이 계획을 짜서 카드로 띄웁니다. 저장은 [이대로 할게] 를 눌러야 합니다.
  const isServerData = useIsServerData()
  const { addCard } = useCards()
  // 화면에 띄운 계획과 코치의 한 줄. 없으면 null
  const [shownPlan, setShownPlan] = useState<{ plan: CoachPlan; reply: string } | null>(null)
  // 계획을 짜는 중인지 · 저장한 뒤의 한 줄
  const [isPlanBusy, setIsPlanBusy] = useState(false)
  const [planNote, setPlanNote] = useState<string | null>(null)

  /**
   * AI 가 부른 도구를 실행합니다. 계획을 짜거나 고쳐서 화면에 띄우고, AI 에게 돌려줄 글을 돌려줍니다.
   * 진짜 로그인은 서버 AI 로, 테스트 로그인 · 서버 준비 전(404 · 503 · 429)은 시연용 예시로 짭니다. (코치 채팅과 같음)
   */
  async function handleToolCall(call: ToolCall): Promise<string> {
    const todayKey = getTodayKey()
    const focus = loadStudyFocus()
    // 통화에서 오간 말 최근 8줄 ('나: …' / '코치: …'). "2시간만 · 9시부터 · 수학 먼저" 같은 말이 계획에 들어가게 같이 보냅니다. (#699)
    const planTalk = callTalkLines(messages)
    let result: PlanReply
    setIsPlanBusy(true)
    try {
      if (call.name === 'show_day_plan') {
        // 채팅 계획 방과 같은 재료: 오늘 시간표 과목 · 오늘 체크인 컨디션 · 오늘 채팅 방들의 이야기 · 대화(planTalk)
        // 시간표는 채팅 방이 이미 받아 둔 것이 있으면 그것을 쓰고(통화 중에 다시 기다리지 않게), 없으면 받아 옵니다.
        // 못 받으면 null 이라 과목 없이 짭니다.
        const school = await queryClient.ensureQueryData(
          schoolTodayOrNullQuery(loadSchoolClass(), isServerData, todayKey),
        )
        const subjects = todaySubjectsOf(school)
        const condition = loadLocalCheckIn(todayKey)?.condition ?? null
        const demo = () => makeDemoDayPlan({ todayKey, now: Date.now(), subjects, light: false })
        result = isServerData
          ? await withDemoFallback(
              () =>
                requestDayPlan({
                  date: todayKey,
                  focus,
                  subjects,
                  condition,
                  otherRooms: otherRoomLines(user?.id ?? 'unknown', null, todayKey),
                  // AI 가 통화에서 들은 총 분 · 시작 시각 (없으면 보내지 않음)
                  ask: readDayPlanArgs(call.args),
                  planTalk,
                }),
              demo,
            )
          : demo()
      } else if (call.name === 'show_long_plan') {
        const args = readLongPlanArgs(call.args, todayKey)
        if (args === null) {
          return '무엇을 언제까지 준비하는지 못 알아들었어. 내일부터 30일 안의 날짜로 다시 물어봐.'
        }
        const input = {
          goal: args.goal,
          endDate: args.endDate,
          // 학생이 통화에서 말한 하루 분 (말하지 않았으면 60분)
          dailyMinutes: args.dailyMinutes,
          image: null,
          focus,
          // 학생이 통화에서 말한 시험 · 대회 날이라 저장할 때 홈 일정에 넣습니다.
          isEventDate: true,
        }
        const demo = () => makeDemoLongPlan({ ...input, todayKey, hasPhoto: false })
        result = isServerData ? await withDemoFallback(() => requestLongPlan(input), demo) : demo()
      } else if (call.name === 'revise_plan') {
        const request = readReviseArgs(call.args)
        const current = shownPlan?.plan.status === 'open' ? shownPlan.plan : null
        if (current === null) return '아직 화면에 고칠 계획이 없어. 먼저 계획을 짜 줄지 물어봐.'
        if (request === null) return '어떻게 고칠지 못 알아들었어. 다시 물어봐.'
        const demo = () => reviseDemoPlan(current, request)
        result =
          !isServerData || current.isDemo
            ? demo()
            : await withDemoFallback(
                () =>
                  current.kind === 'day'
                    ? reviseDayPlan(current, request, { focus, subjects: [], planTalk })
                    : reviseLongPlan(current, request),
                demo,
              )
      } else {
        return '그런 도구는 없어. 학생에게 채팅에서 해 보자고 해.'
      }
    } finally {
      setIsPlanBusy(false)
    }
    if (result.plan) {
      setShownPlan({ plan: result.plan, reply: result.reply })
      setPlanNote(null)
    } else if (result.cleared) {
      setShownPlan(null)
    }
    return planOutputForAi(result)
  }

  // 연결은 시도마다 한 번 만들어지므로, 도구를 부를 때는 이 ref 로 "지금 화면의" 처리 함수를 씁니다. (화면이 다시 그려질 때마다 바꿔 둠)
  const toolHandlerRef = useRef(handleToolCall)
  useEffect(() => {
    toolHandlerRef.current = handleToolCall
  })

  /** [이대로 할게] — 화면의 계획을 카드로 저장합니다. 긴 계획이면 시험 · 대회 날을 홈 일정에 D-day 로 넣습니다. */
  function handleAcceptPlan() {
    if (!shownPlan || shownPlan.plan.status !== 'open') return
    const plan = shownPlan.plan
    const newCards = planToCards(plan, Date.now())
    newCards.forEach(addCard)
    const lines = [`카드 ${newCards.length}장을 달력에 넣었어.`]
    if (plan.kind === 'long' && plan.spec && plan.isEventDate) {
      const name = plan.spec.goal.slice(0, FOCUS_NAME_MAX)
      saveMyEvent({ name, date: plan.spec.endDate, kind: 'focus' })
      lines.push(`'${name}' D-day 도 홈 일정에 넣었어.`)
    }
    setShownPlan({ ...shownPlan, plan: { ...plan, status: 'saved' } })
    setPlanNote(lines.join(' '))
  }

  // 화면이 열리면 AI 와 음성 연결을 시작하고, 화면을 떠나면(끊기·뒤로가기) 연결과 마이크를 정리합니다.
  // attempt 가 바뀌면(다시 시도) 이전 연결을 정리하고 새로 연결합니다.
  useEffect(() => {
    // 받기를 누르지 않고 들어왔으면 연결하지 않습니다. (아래에서 수신 화면으로 돌려보냅니다)
    if (!cameFromAnswer) return

    let isCancelled = false
    let hasDisconnected = false
    let call: RealtimeCall | null = null
    // 연결하는 도중에 화면을 떠나면 기다리던 요청을 멈추고 마이크를 끄라고 알리는 신호입니다.
    const controller = new AbortController()

    startRealtimeCall({
      signal: controller.signal,
      // 오늘의 관리 강도와 독설 허용 수위를 서버에 알려서, AI 의 말투가 내가 정한 한도를 넘지 않게 합니다. (#257)
      tone: getCallTone(),
      // 내 기록을 숫자로 정리한 "학생 카드" 를 같이 보냅니다. AI 가 이걸 보고 묻는 것과 말투를 바꿉니다. (lib/callCard.ts)
      card: loadCallCard(),
      // 오늘 채팅 방(계획 · 상담 · 과목 쌤)에서 한 말 몇 줄. 통화는 어느 방도 아니라서 모든 방의 말을 모읍니다. (#699)
      // AI 가 채팅에서 이미 정한 것을 또 묻지 않게 합니다.
      otherRooms: otherRoomLines(user?.id ?? 'unknown', null, getTodayKey()),
      // 대화 글자가 올 때마다 말풍선 목록에 반영합니다.
      onTranscript: (event) => setMessages((prev) => applyTranscript(prev, event)),
      // 통화 중 "계획 짜 줘" 를 위한 도구 (오늘 날짜를 알려 줘야 AI 가 날짜를 셀 수 있음)
      tools: buildCallTools(getTodayKey()),
      onToolCall: (toolCall) => toolHandlerRef.current(toolCall),
      // 연결이 끊어지면 마이크를 끄고, 안내 화면을 보여줍니다.
      onDisconnect: (wasConnected) => {
        if (isCancelled) return
        hasDisconnected = true
        call?.close()
        callRef.current = null
        setConnection(wasConnected ? 'dropped' : 'error')
        setErrorMessage(
          wasConnected
            ? '인터넷이 끊겼을 수 있어요. 다시 연결하거나 평가 화면으로 갈 수 있어요.'
            : getFailMessage(null),
        )
      },
    })
      .then((startedCall) => {
        // 연결되는 사이에 이미 화면을 떠났거나 끊겼다면 바로 정리합니다.
        if (isCancelled || hasDisconnected) {
          startedCall.close()
          return
        }
        call = startedCall
        callRef.current = startedCall
        setMaxCallSeconds(startedCall.maxCallSeconds)
        setCallId(startedCall.callId)
        setConnection('connected')
      })
      .catch((error: unknown) => {
        if (isCancelled) return
        setConnection('error')
        setErrorMessage(getFailMessage(error))
        setIsMicFailure(
          error instanceof RealtimeCallError &&
            (error.reason === 'mic' || error.reason === 'no-mic'),
        )
      })

    return () => {
      isCancelled = true
      callRef.current = null
      // 아직 연결 중이면 기다리던 요청을 멈춥니다. (이미 연결됐으면 아래 close 가 정리합니다)
      controller.abort()
      call?.close()
    }
  }, [attempt])

  // 음소거 상태를 실제 마이크에 반영합니다.
  // 연결되기 전에 음소거를 눌렀어도, 연결이 끝나는 순간(connection 이 바뀔 때) 다시 적용됩니다.
  useEffect(() => {
    callRef.current?.setMuted(isMuted)
  }, [isMuted, connection])

  // 연습용: 개발 서버에서 "연습 화면 보기"를 눌렀을 때만, 미리 적어 둔 말을 3초마다 하나씩 보여줍니다.
  // (import.meta.env.DEV 는 배포한 화면에서는 false 라서 실제 사용자에게는 보이지 않습니다)
  useEffect(() => {
    if (!import.meta.env.DEV || !isPreview) return

    const timerId = setInterval(() => {
      setMessages((prev) => {
        if (prev.length >= sampleConversation.length) return prev
        return [...prev, { id: `sample-${prev.length}`, ...sampleConversation[prev.length] }]
      })
    }, 3000)

    return () => clearInterval(timerId)
  }, [isPreview])

  // 통화 시간은 실제로 연결된 동안에만 셉니다. (연결 중이거나 실패 화면일 때는 세지 않습니다)
  // 연습 화면 보기(개발용)는 연결 없이 통화 화면을 보는 것이라 같이 셉니다.
  const isCounting = connection === 'connected' || isPreview
  useEffect(() => {
    if (!isCounting) return

    const startedAt = Date.now()

    // 1초마다 +1 하면 탭이 백그라운드일 때 느려질 수 있어서, 시작 시각과의 차이로 계산합니다.
    const timerId = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)

    // 연결이 끊기거나 화면을 떠나면 타이머를 꼭 멈춥니다.
    return () => clearInterval(timerId)
  }, [isCounting])

  // 결과 화면으로 갑니다. 서버의 통화 기록 번호와 자막을 같이 넘겨서, 결과 화면이 "오늘의 결론" 을 받아 오게 합니다.
  // replace: 이 화면을 방문 기록에서 지웁니다. 결과 화면에서 뒤로가기를 눌러도 통화가 다시 걸리지 않습니다.
  function goToResult() {
    navigate('/call/result', { replace: true, state: toResultState(callId, messages) })
  }

  // 끝나기 30초 전에 AI 에게 "새 질문 말고 약속 하나로 마무리해" 를 한 번 알립니다. (#699)
  // 말 중간에 갑자기 끊기지 않게, AI 가 미리 마무리하게 하려는 것입니다. 바로 말하게 하지는 않아서 학생 말을 끊지 않습니다.
  useEffect(() => {
    if (connection !== 'connected' || maxCallSeconds === null) return
    if (hasSentEndingNoticeRef.current || !isCallEndingSoon(seconds, maxCallSeconds)) return
    hasSentEndingNoticeRef.current = true
    callRef.current?.sendAppNotice(CALL_ENDING_NOTICE)
  }, [connection, maxCallSeconds, seconds])

  // 서버가 정한 최대 길이가 되면 통화를 끊고 결과 화면으로 갑니다. 음성 통화는 길수록 돈이 많이 들기 때문입니다.
  // (화면을 떠나면 위 useEffect 의 정리 코드가 연결과 마이크를 끕니다)
  useEffect(() => {
    if (connection !== 'connected' || maxCallSeconds === null) return
    if (seconds < maxCallSeconds) return
    navigate('/call/result', { replace: true, state: toResultState(callId, messages) })
  }, [connection, maxCallSeconds, seconds, navigate, callId, messages])

  function handleToggleMute() {
    setIsMuted((prev) => !prev)
  }

  function handleHangUp() {
    // 화면을 떠나면 위 useEffect 의 정리 코드가 연결과 마이크를 끕니다.
    // 통화가 연결된 적이 없으면 평가할 내용이 없어서, 결과 화면 대신 코치 화면(통화를 건 곳)으로 갑니다.
    if (isCounting) {
      goToResult()
      return
    }
    navigate(COACH_PATH, { replace: true })
  }

  // 다시 시도: "연결 중"으로 돌려놓고 attempt 를 올리면 위 useEffect 가 새로 연결합니다.
  function handleRetry() {
    setConnection('connecting')
    // 새 통화라서 통화 시간과 지난 대화 말풍선을 처음으로 돌립니다. (끝나기 전 안내도 새 통화에서 다시 보냄)
    setSeconds(0)
    setMessages([])
    hasSentEndingNoticeRef.current = false
    setAttempt((prev) => prev + 1)
  }

  // 받기를 누르지 않고 들어왔으면 수신 화면으로 보냅니다.
  // 이 줄은 모든 훅(useState·useEffect)보다 아래에 있어야 합니다.
  if (!cameFromAnswer) return <Navigate to="/call" replace />

  // 연결에 실패했거나 끊겼으면(연습 화면 보기 중이 아니면) 안내 화면을 보여줍니다.
  // 이 줄도 모든 훅(useState·useEffect)보다 아래에 있어야 합니다.
  if ((connection === 'error' || connection === 'dropped') && !isPreview) {
    return (
      <CallFailedView
        kind={connection}
        message={errorMessage}
        // 끊긴 경우(dropped)는 이미 마이크를 쓰고 있었으니 마이크 문제가 아닙니다.
        isMicProblem={connection === 'error' && isMicFailure}
        onRetry={handleRetry}
        // 끊긴 경우는 평가 화면으로, 처음부터 안 된 경우는 말 대신 같은 대본의 채팅으로 보냅니다. (「4.5」)
        // replace: 떠난 뒤 뒤로가기를 눌러도 이 화면으로 돌아와 전화가 다시 걸리지 않게 합니다.
        onLeave={() => {
          if (connection === 'dropped') {
            goToResult()
            return
          }
          navigate(COACH_PATH, { replace: true })
        }}
        onPreview={import.meta.env.DEV ? () => setIsPreview(true) : undefined}
      />
    )
  }

  return (
    <div
      className={cn(
        'flex min-h-screen flex-col items-center px-4 py-10 text-white sm:px-6',
        theme.pageBackground,
      )}
    >
      <div className="flex w-full max-w-md flex-1 flex-col items-center text-center">
        <p className="text-sm text-indigo-100 sm:text-base">
          AI 선생님 · {connection === 'connecting' ? '연결 중…' : '통화 중'}
        </p>
        {/* tabular-nums: 숫자 폭을 똑같이 해서 시간이 올라갈 때 글자가 흔들리지 않습니다. */}
        <h1 className="mt-3 text-4xl font-bold tracking-tight tabular-nums sm:text-5xl">
          {formatCallTime(seconds)}
        </h1>
        {/* 통화가 갑자기 끊기는 것처럼 느끼지 않게, 최대 길이를 미리 알려 줍니다. */}
        {maxCallSeconds !== null && (
          <p className="mt-2 text-sm text-indigo-100">
            {formatCallTime(maxCallSeconds)} 이 되면 통화가 끝나요
          </p>
        )}

        <div className="mt-8">
          <AiAvatar careLevel={careLevel} />
        </div>

        <p className="mt-8 max-w-[22em] text-lg leading-relaxed break-keep sm:text-xl">
          &quot;{greeting}&quot;
        </p>

        {/* 통화 중에 짠 계획 (AI 가 도구를 불렀을 때). 저장은 [이대로 할게] 를 눌러야 합니다. */}
        {(shownPlan !== null || isPlanBusy || planNote !== null) && (
          <section aria-label="통화 중 계획" className="mt-6 w-full text-left">
            {isPlanBusy && (
              <p role="status" className="text-sm text-indigo-100">
                계획 짜는 중…
              </p>
            )}
            {shownPlan && (
              <>
                <p className="text-sm break-keep text-indigo-50">{shownPlan.reply}</p>
                <PlanCard plan={shownPlan.plan} className="sm:max-w-none" />
                {shownPlan.plan.status === 'open' && (
                  // 색 바탕 위라서 [이대로 할게] 는 흰 버튼(inverse), [닫기] 는 글자만 있는 버튼으로 둡니다. (채운 버튼은 하나)
                  <div className="mt-2 flex gap-2">
                    <Button variant="inverse" className="flex-1" onClick={handleAcceptPlan}>
                      ✅ 이대로 할게
                    </Button>
                    <Button
                      variant="ghost"
                      className="flex-1 text-white hover:bg-white/10"
                      onClick={() => setShownPlan(null)}
                    >
                      닫기
                    </Button>
                  </div>
                )}
              </>
            )}
            {planNote && <p className="mt-2 text-sm break-keep text-indigo-50">{planNote}</p>}
          </section>
        )}

        <SubtitleList messages={messages} />

        {/* 개발 서버의 연습 화면에서만: AI 가 도구를 부른 것처럼 흉내 내서 계획 카드를 확인합니다. (배포 화면에는 없음) */}
        {import.meta.env.DEV && isPreview && (
          <div className="mt-3 flex w-full flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void handleToolCall({
                  callId: 'dev-long',
                  name: 'show_long_plan',
                  args: {
                    goal: '중간고사 미적분 1~3단원',
                    endDate: moveDateKey(getTodayKey(), 14),
                  },
                })
              }
            >
              (개발용) 도구: 긴 계획
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void handleToolCall({
                  callId: 'dev-revise',
                  name: 'revise_plan',
                  args: { request: '주말은 빼 줘' },
                })
              }
            >
              (개발용) 도구: 주말 빼기
            </Button>
          </div>
        )}

        {/* mt-auto: 버튼을 화면 아래(엄지가 닿는 곳)로 밀어냅니다. 채운 버튼은 [끊기] 하나, 음소거는 선만 있는 버튼입니다. */}
        <div className="mt-auto flex w-full items-end justify-around pt-12 pb-2">
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={handleToggleMute}
              aria-pressed={isMuted}
              aria-label={isMuted ? '음소거 해제' : '음소거'}
              className={cn(
                'flex h-16 w-16 cursor-pointer items-center justify-center rounded-full border-2 border-white/60 text-2xl transition-transform active:scale-95',
                isMuted ? 'bg-white text-slate-900' : 'bg-transparent text-white hover:bg-white/10',
              )}
            >
              <span aria-hidden>{isMuted ? '🔇' : '🎤'}</span>
            </button>
            <span className="text-sm font-medium">{isMuted ? '음소거 중' : '음소거'}</span>
          </div>

          <div className="flex flex-col items-center gap-2">
            {/* 끊기는 1순위라서 조금 더 크게(80px) 둡니다. (피츠의 법칙) */}
            <button
              type="button"
              onClick={handleHangUp}
              aria-label="끊기"
              className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-full bg-red-600 text-3xl text-white transition-transform hover:bg-red-700 active:scale-95"
            >
              <span aria-hidden>✕</span>
            </button>
            <span className="text-sm font-semibold">끊기</span>
          </div>
        </div>
      </div>
    </div>
  )
}
