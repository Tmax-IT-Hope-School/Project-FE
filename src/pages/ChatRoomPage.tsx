import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { MissionBar } from '@/components/ui/MissionBar'
import { NotificationsBell } from '@/components/ui/NotificationsBell'
import { PlanCard } from '@/components/ui/PlanCard'
import { ReasonChips } from '@/components/ui/ReasonChips'
import { Skeleton } from '@/components/ui/Skeleton'
import { useAuth } from '@/hooks/useAuth'
import { useCards } from '@/hooks/useCards'
import { useGoalLimit } from '@/hooks/useGoalLimit'
import { useGoals } from '@/hooks/useGoals'
import { useSendCheckIn } from '@/hooks/useCheckInSync'
import { useQueryParam } from '@/hooks/useQueryParam'
import { useStudySessions } from '@/hooks/useStudySessions'
import { requestSettingsFromText } from '@/lib/aiSettingsApi'
import { ApiError, getApiErrorMessage } from '@/lib/api'
import { finishCall, type CallLine } from '@/lib/callReview'
import { addCardMark, CARD_FAIL_CAUSES, loadCardMarks } from '@/lib/cardMarks'
import { createInstantCardNow } from '@/lib/cardSession'
import { countsForCheckCall } from '@/lib/checkCall'
import {
  MAX_CHAT_LINES,
  MAX_CHAT_TEXT_LENGTH,
  openChatSession,
  sendChatMessage,
  startChat,
  type ChatReply,
  type ChatSource,
} from '@/lib/chatApi'
import {
  clearTalkRequest,
  getChatRoom,
  handOffPlanChip,
  isChatAboutKind,
  markRoomSeen,
  peekTalkRequest,
  startTalk,
  takePlanHandoff,
  toChatRoomId,
  type ChatAbout,
  type ChatRoomId,
  type PlanHandoffChip,
  type TalkRequest,
} from '@/lib/chatRooms'
import {
  applyNotifyChange,
  buildNotifyChange,
  getNotifyChangeRows,
  loadTalkableSettings,
  notifyDoneText,
  notifyProposalText,
  notifySummaryOf,
  parseNotifyRequest,
  type NotifyChange,
  type NotifyRequest,
} from '@/lib/chatNotifySettings'
import { canSyncCheckIns, todayCheckInForCoachQuery } from '@/lib/checkInsApi'
import {
  SKIP_FOCUS_NAME_LABEL,
  buildFocusDateQuestion,
  buildFocusNameQuestion,
  buildFocusQuestion,
  buildFocusReaction,
  buildMissionBriefing,
  buildMissionProgress,
  buildMorningBriefing,
  buildSessionRecap,
  findRecapSession,
  loadPhoneLift,
  PLAN_CHIP,
  QUIZ_CHIP,
  quizChipForCard,
  replyChipsFor,
  type CoachChip,
  type CoachMessage,
} from '@/lib/coachBriefing'
import { revealSchedule, splitReply, visibleLength, type RevealSchedule } from '@/lib/chatReveal'
import { loadFocusScore } from '@/lib/focusScore'
import { formatPhoneSummary } from '@/lib/liftAlerts'
import {
  DAILY_MINUTES_OPTIONS,
  DEFAULT_DAILY_MINUTES,
  LIGHTER_REQUEST,
  MAX_LONG_PLAN_DAYS,
  MAX_PLAN_TEXT_LENGTH,
  dayPlanAskOf,
  dayPlanAskText,
  makeDemoDayPlan,
  makeDemoLongPlan,
  parseLongPlanText,
  planFromCards,
  planReviseLabels,
  planToCards,
  requestDayPlan,
  requestLongPlan,
  reviseDayPlan,
  reviseDemoPlan,
  reviseLongPlan,
  withDemoFallback,
  type CoachPlan,
  type DayPlanAsk,
  type LongPlanInput,
  type PlanReply,
  type PlanStatus,
} from '@/lib/coachPlan'
import {
  dayLabel,
  hasStudentLine,
  loadCoachThread,
  needsNewSession,
  newSessionStart,
  nextBubbleId,
  otherRoomLines,
  planTalkLines,
  saveCoachThread,
  sessionLines,
  type CoachThread,
  type ReasonCheck,
  type ThreadBubble,
} from '@/lib/coachThread'
import { cn } from '@/lib/cn'
import { runDailyCareStage } from '@/lib/dailyCareRun'
import {
  countDoneMissions,
  isMissionSlot,
  loadDailyMissions,
  nextMission,
  type Mission,
} from '@/lib/dailyMission'
import { loadAllSessions, loadStudySessions } from '@/lib/dailyRecords'
import { isServerDataToken } from '@/lib/dataMode'
import { getTodayKey, moveDateKey, toDayKey } from '@/lib/date'
import { getPlannedStartAt } from '@/lib/facts'
import { demoTopicOpener, replyDemoInRoom } from '@/lib/demoCoach'
import { YOUTH_HELP_LINE } from '@/lib/helpLines'
import { getUpcomingMyEvents, saveMyEvent } from '@/lib/myEvents'
import { loadOnboardingAnswers } from '@/lib/onboardingSteps'
import { shrinkPhoto } from '@/lib/photoCards'
import { loadLocalCheckIn, saveLocalCheckIn, saveQuickCheckIn } from '@/lib/quickCheckIn'
import { toggleReason } from '@/lib/reasons'
import { loadRestDays } from '@/lib/restDays'
import { hasCrisisText } from '@/lib/safetyBrake'
import { gradeNumberOf } from '@/lib/schoolEvents'
import { loadSchoolClass, schoolTodayOrNullQuery, todaySubjectsOf } from '@/lib/schoolToday'
import { SHORTFALL_REASONS } from '@/lib/sessionTags'
import { loadData, saveData } from '@/lib/storage'
import {
  finishGoalChat,
  openGoalChat,
  sendGoalChatMessage,
  toGoalFormDraft,
} from '@/lib/goalChatApi'
import { GOAL_DRAFT_KEY } from '@/lib/goalForm'
import { MAX_ACTIVE_GOALS } from '@/lib/goals'
import {
  FOCUS_NAME_MAX,
  cleanFocusName,
  focusLabelOf,
  loadStudyFocus,
  needsFocusName,
  saveStudyFocus,
} from '@/lib/studyFocus'
import {
  MAX_QUIZ_MATERIAL_LENGTH,
  MAX_QUIZ_TOPIC_LENGTH,
  PHOTO_QUIZ_TOPIC,
  answerQuiz,
  countCorrect,
  loadQuizResults,
  loadYesterdayWrong,
  makeDemoQuiz,
  newQuiz,
  nextQuizStep,
  parseQuizText,
  requestQuizOrDemo,
  retryOneQuestion,
  saveQuizResult,
  toQuizResult,
  wrongForReview,
  wrongQuestionsOf,
  type CoachQuiz,
  type QuizInput,
  type QuizQuestion,
  type QuizReply,
} from '@/lib/studyQuiz'
import {
  buildNudgeCoachMessage,
  daysAgoText,
  isNudgeKind,
  loadNudgeDay,
  loadStopWhip,
} from '@/lib/coachNudges'
import {
  failCauseLabels,
  quizWrongLines,
  sessionReviewLines,
  shortfallLabels,
  toFailCauses,
  toShortfallReasons,
  validReasonValues,
} from '@/lib/talkLines'
import { CHAT_PATH } from '@/lib/tabMenu'
import { getTodayCardsState } from '@/lib/todayCards'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'

// 코치가 결과를 먼저 물어본 마지막 공부 기록 번호. 같은 기록을 두 번 묻지 않으려고 저장합니다. (대화 내용이 아니라 번호만)
const RECAPPED_SESSION_KEY = 'coach-recapped-session'

// 코치가 마지막으로 알아챈 "오늘의 미션 몇 개 끝" ('2026-10-18:2' 모양). 미션을 끝내고 돌아오면 코치가 먼저 말을 겁니다.
const MISSION_PROGRESS_KEY = 'coach-mission-progress'

// 조용히 정리를 보낸 서버 채팅 번호들. 개발 모드(StrictMode)는 effect 를 두 번 돌려서, 한 번만 보내려고 둡니다.
const finishedChatIds = new Set<string>()

/** 저장해 둔 미션 진행이 오늘 몇 개였는지. 오늘 것이 아니면 null */
function loadMissionProgress(todayKey: string): number | null {
  const saved = loadData<unknown>(MISSION_PROGRESS_KEY, null)
  if (typeof saved !== 'string') return null
  const [date, done] = saved.split(':')
  const count = Number(done)
  return date === todayKey && Number.isInteger(count) ? count : null
}

/**
 * 지난 서버 세션을 조용히 정리합니다. (POST /calls/{id}/finish — 요약 · 생각 습관 · 약속이 서버에 남음)
 * 정리한 요약은 다음 세션 대본의 [지난 통화] 가 되어, AI 가 "어제 약속 지켰어?" 처럼 이어서 물어봅니다.
 * 결과 화면으로 가지 않고, 실패해도 대화방은 그대로입니다. (이미 정리됐거나 서버가 잊었으면 4xx 라서 그냥 넘어갑니다)
 */
function finishQuietly(chatId: string, lines: CallLine[]) {
  if (finishedChatIds.has(chatId) || !hasStudentLine(lines)) return
  finishedChatIds.add(chatId)
  void finishCall({ callId: chatId, lines }).catch(() => undefined)
}

/**
 * 서버가 거절한 이유를 학생이 이해할 수 있는 문장으로 바꿉니다.
 * (테스트 로그인은 서버를 안 부르고 시연용 정해진 답을 쓰므로 여기까지 오지 않습니다)
 */
function getChatErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) {
    return 'AI 코치와의 대화는 구글로 로그인한 계정에서만 쓸 수 있어요.'
  }
  return getApiErrorMessage(error)
}

/**
 * 대화방 화면("/chat/plan" · "/chat/counsel" · "/chat/tutor") — AI 와 이어서 이야기하는 방입니다. (2026-10-18, BE #238 · #307 · #330)
 * 사용자 결정: "채팅 탭은 무조건 하나", "멘토와 연속적인 대화를 한다는 느낌으로",
 * 저녁에 "📞 매일 통화 + 채팅방 3개 📅 계획 · 💬 상담 · 📚 과목 쌤", "다양한 세션에서 채팅 가능해야" (lib/chatRooms.ts, #582)
 * 방마다 기록이 따로 남고, 서버에는 어느 방인지(room)를 같이 보냅니다. 아래 1~6 은 매일 코치(💬 상담) 방 기준이고,
 * 📅 계획 · 📚 과목 쌤 방은 브리핑 · 미션 · 알림 대신 그 방의 첫 인사(코드가 정한 말)로 시작합니다.
 * 계획(5번)은 📅 계획 방에서 합니다. 다른 방에서 계획 칩을 누르면 계획 방으로 넘어가서 짭니다.
 *
 *   0. [새 대화] 를 누르면 구분선을 긋고 서버 세션을 새로 엽니다. 다른 화면의 [이야기하기] 로 오면(?talk=)
 *      그 주제(후기 · 못 한 카드 · 주간 숫자 · 틀린 문제 · 검사 결과 · 하루)로 새 세션을 열어 AI 가 먼저 말합니다.
 *      후기 · 못 한 카드 대화에서 AI 가 이유를 짐작하면 "이유: 폰 · 피곤함 — 맞아?" 로 확인받아 기록에 저장합니다.
 *   1. 지난 대화가 이 기기에 남아 있어서 다시 열면 이어서 보입니다. 날이 바뀌면 날짜 구분선이 생깁니다. (lib/coachThread.ts)
 *   2. 그날 처음 열면 코치가 먼저 말을 겁니다. (아침 브리핑: 시간표 · 급식 · 시험 D-day · 오늘 카드 · 컨디션 묻기)
 *      이 첫 말은 코드가 만듭니다(lib/coachBriefing.ts). 그래서 열기만 해서는 AI 사용량을 쓰지 않습니다.
 *      공부가 끝난 뒤 · 미션을 끝낸 뒤 · 미션 알림을 누르고 들어왔을 때도 코치가 먼저 말을 겁니다.
 *   3. 칩을 누르거나 말을 쓰면 AI 가 답합니다.
 *      - 진짜 로그인: 그때 서버 채팅을 엽니다. 서버 세션은 하루 단위이고, 날이 바뀌면 지난 세션을 조용히 정리해서
 *        요약을 남깁니다. 다음 날 AI 는 그 요약(서버 대본의 [지난 통화])으로 지난 약속을 먼저 물어봅니다.
 *      - 테스트 로그인: 서버를 못 써서 시연용 정해진 답(lib/demoCoach.ts)을 쓰고 "시연용 정해진 답" 이라고 붙입니다.
 *   4. AI 가 고른 빠른 답 · 행동이 오면 칩으로 보여 주고, 없으면 코드가 칩을 붙입니다. (핑계 · 계획 · 시험 이야기)
 *      행동 칩(시작 · 카드 만들기 · 계획 짜기)은 누를 때만 실행합니다.
 *   5. 계획 핑퐁 (2026-10-18, lib/coachPlan.ts): 코치가 오늘 계획 · 시험 날까지의 긴 계획(최대 30일)을 먼저 짜서
 *      계획 말풍선으로 보여 주고, 학생이 [줄여 줘] · [주말은 빼 줘] · 자유로운 한 줄로 고칩니다.
 *      [이대로 할게] 를 눌러야 카드로 저장합니다. 긴 계획은 교과서 · 시험 범위 사진도 넣을 수 있습니다. (사진은 저장 안 함)
 *   6. 위기 표현이 나오면 상담 전화 한 줄을 보여 줍니다. 대화는 막지 않습니다.
 *
 * 모바일에서는 화면 높이를 꽉 채웁니다. 말풍선 목록만 스크롤되고, 입력창은 아래(하단 탭 위)에 붙어 있습니다.
 * ⚠️ 대화는 서버에 저장하지 않고 이 기기에만 남깁니다(최근 14일 · 300개). console.log 로 찍지 않습니다.
 */
export function ChatRoomPage() {
  // 하루 1번 관리 단계를 판정해 저장합니다. ("통화가 없으면 다음 날 첫 진입 때", 기획서 5.4)
  // 홈과 코치 중 어디로 먼저 들어와도 판정되게 여기서도 부릅니다. 오늘 이미 판정했으면 아무것도 바꾸지 않습니다.
  useState(() => runDailyCareStage(getTodayKey(), Date.now()))
  // 주소의 방 이름(/chat/tutor 의 tutor). 모르는 이름이면 대화방 목록으로 보냅니다.
  const room = toChatRoomId(useParams().room)
  if (room === null) return <Navigate to={CHAT_PATH} replace />
  const roomInfo = getChatRoom(room)

  return (
    // flex-1 · min-h-0: Layout 이 잡아 준 높이를 꽉 채우고, 안의 목록만 스크롤되게 합니다.
    // 모바일은 바탕을 연회색으로 칠하고(-mx-4 -my-3 으로 Layout 의 여백까지 덮음), 내용은 흰 묶음으로 올립니다.
    <div className="-mx-4 -my-3 flex min-h-0 flex-1 flex-col gap-3 bg-slate-100 px-4 py-3 sm:mx-0 sm:my-0 sm:rounded-3xl sm:p-4">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          {/* 대화방 목록(채팅 탭)으로 돌아가기. 누르기 쉽게 44px */}
          <Link
            to={CHAT_PATH}
            aria-label="대화방 목록으로"
            className="flex h-11 w-9 shrink-0 items-center justify-center rounded-lg text-2xl text-slate-500 hover:bg-slate-200"
          >
            ‹
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-[22px] leading-snug font-bold tracking-tight text-slate-900 sm:text-[26px]">
              <span aria-hidden>{roomInfo.emoji}</span> {roomInfo.name}
            </h1>
            <p className="truncate text-sm text-slate-500">{roomInfo.role}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* 통화 · 알림은 탭 없이 대화방 머리에 둡니다. 통화는 매일 코치(상담) 방에만. (2026-10-18 "탭을 명확히")
              설정은 2026-10-19 에 헤더로 옮겼습니다. */}
          {roomInfo.isDailyCoach && (
            <Link to="/call" className={chipClass}>
              <span aria-hidden>📞</span> 통화
            </Link>
          )}
          <NotificationsBell />
        </div>
      </div>

      {/* 첫 말(브리핑)에 쓸 오늘 학교 정보를 받는 동안만 자리 표시를 보여 줍니다. 못 받아도 대화는 열립니다. */}
      {/* key: 다른 방으로 옮기면 대화방을 처음부터 다시 그립니다. (방마다 기록 · 입력 중인 글이 따로) */}
      <AsyncBoundary pendingFallback={<ChatSkeleton />}>
        <RoomChat key={room} room={room} />
      </AsyncBoundary>
    </div>
  )
}

function ChatSkeleton() {
  return (
    <div role="status" className="flex min-h-0 flex-1 flex-col gap-3 rounded-3xl bg-white p-4">
      <span className="sr-only">대화방을 여는 중이에요</span>
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-24 w-4/5 rounded-[20px]" />
    </div>
  )
}

/** 코치가 먼저 거는 말(브리핑 · 결과 묻기 · 미션)을 말풍선으로 만듭니다. */
function toCoachBubble(id: number, message: CoachMessage, at: number): ThreadBubble {
  return { id, speaker: 'ai', text: message.text, chips: message.chips, at }
}

/** 대화방 끝에 말풍선 하나를 더한 새 대화방 */
function withBubble(thread: CoachThread, bubble: Omit<ThreadBubble, 'id' | 'at'>): CoachThread {
  const added: ThreadBubble = { ...bubble, id: nextBubbleId(thread.bubbles), at: Date.now() }
  return { ...thread, bubbles: [...thread.bubbles, added] }
}

// ---- 계획 말풍선 (lib/coachPlan.ts, 2026-10-18 계획 핑퐁) ----

/**
 * 계획을 짜거나 고쳐 달라는 요청 하나
 *   day    — 오늘 계획 (light 면 가볍게, date 가 있으면 그날 — 밤 정리 알림의 내일 계획)
 *            ask 가 있으면 AI 가 채팅에서 학생과 정한 값(day_plan)대로 짭니다. (#695)
 *   long   — 시험 · 대회 날까지의 긴 계획 (notice 가 있으면 코치의 답 앞에 붙임)
 *   revise — 열려 있는 계획(bubbleId 의 말풍선)을 학생의 요청대로 고치기
 * planTalkLines 는 계획 방에서 오늘 나눈 말입니다. (lib/coachThread.ts 의 planTalkLines, 서버의 planTalk)
 */
type PlanRequest =
  | { type: 'day'; light: boolean; date?: string; ask?: DayPlanAsk; planTalkLines?: string[] }
  | { type: 'long'; input: LongPlanInput; notice: string | null }
  | {
      type: 'revise'
      bubbleId: number
      plan: CoachPlan
      request: string
      planTalkLines?: string[]
    }

/** 긴 계획 칸에 적는 것 */
interface LongPlanForm {
  goal: string
  /** 'YYYY-MM-DD'. 아직 안 골랐으면 '' */
  endDate: string
  dailyMinutes: number
  /** 줄인 사진(data URL). 이 화면의 기억에만 두고 어디에도 저장하지 않습니다. */
  photo: string | null
}

/** 위기 표현이 감지돼서 계획 대신 하는 말 (아래에 상담 전화 한 줄이 같이 보임) */
const PLAN_HELP_REPLY = '계획은 잠깐 미뤄 두자. 마음이 힘들면 아래 번호로 언제든 이야기해도 돼.'
/** AI 가 정한 값으로 지금 오늘 카드를 바로 고칠 때, 고치기 전 카드를 보여 주는 말 (#695) */
const BEFORE_PLAN_REPLY = '지금 오늘 계획이야. 이야기한 대로 바로 고쳐 볼게.'

/** 내일 계획이면 코치의 말을 "내일 계획" 으로 바꿉니다. (서버 · 시연용 계획의 말은 "오늘 계획을 짜 봤어" 로 정해져 있음) */
function asTomorrowReply(result: PlanReply): PlanReply {
  return result.plan
    ? { ...result, reply: '내일 계획을 짜 봤어. 고칠 곳이 있으면 말해 줘!' }
    : result
}

/** 계획 말풍선마다 pickStatus 가 돌려준 상태로 바꿉니다. (null 이면 그대로) */
function withPlanStatus(
  thread: CoachThread,
  pickStatus: (bubble: ThreadBubble) => PlanStatus | null,
): CoachThread {
  const bubbles = thread.bubbles.map((bubble) => {
    if (!bubble.plan) return bubble
    const status = pickStatus(bubble)
    return status ? { ...bubble, plan: { ...bubble.plan, status } } : bubble
  })
  return { ...thread, bubbles }
}

/** 계획을 짜거나 고친 결과를 대화방 끝에 붙입니다. */
function applyPlanReply(thread: CoachThread, result: PlanReply, request: PlanRequest): CoachThread {
  if (result.showHelp) {
    return withBubble({ ...thread, isHelpShown: true }, { speaker: 'ai', text: PLAN_HELP_REPLY })
  }
  const { before, ...rest } = result
  if (before) {
    // AI 가 정한 값으로 지금 오늘 카드를 바로 고쳤으면(#695), 지금 카드를 먼저 계획 말풍선으로 보여 주고
    // 그 말풍선을 고친 것처럼 이어 붙입니다. (못 고쳤으면 지금 카드 말풍선이 열린 채로 남아서 이어서 고칠 수 있음)
    const beforeId = nextBubbleId(thread.bubbles)
    const closed = withPlanStatus(thread, (bubble) =>
      bubble.plan?.status === 'open' ? 'closed' : null,
    )
    const shown = withBubble(closed, { speaker: 'ai', text: BEFORE_PLAN_REPLY, plan: before })
    return applyPlanReply(shown, rest, {
      type: 'revise',
      bubbleId: beforeId,
      plan: before,
      request: '',
    })
  }
  if (result.plan) {
    // 새 계획이 나오면 열려 있던 계획은 끝납니다. 고친 계획이면 그 전 것은 '고치기 전', 나머지는 '닫음'
    const closed = withPlanStatus(thread, (bubble) => {
      if (bubble.plan?.status !== 'open') return null
      return request.type === 'revise' && bubble.id === request.bubbleId ? 'replaced' : 'closed'
    })
    return withBubble(closed, {
      speaker: 'ai',
      text: result.reply,
      plan: result.plan,
      typing: true,
    })
  }
  // 새 계획이 없으면 코치의 한 줄만 붙입니다. "다 빼 줘" 로 계획이 비었으면 그 계획은 닫습니다.
  const next =
    result.cleared && request.type === 'revise'
      ? withPlanStatus(thread, (bubble) => (bubble.id === request.bubbleId ? 'closed' : null))
      : thread
  return withBubble(next, {
    speaker: 'ai',
    text: result.reply,
    typing: true,
    ...(result.isDemo ? { isDemo: true } : {}),
  })
}

// ---- 문제 말풍선 (lib/studyQuiz.ts, 2026-10-18 확인 문제) ----

/** 확인 문제 칸에 적는 것 */
interface QuizForm {
  /** 무엇에 대한 문제인지. 오늘 카드를 고르면 그 카드 제목이 들어갑니다. */
  topic: string
  /** 고른 오늘 카드 번호. 직접 적었으면 null */
  cardId: string | null
  /** 고른 카드의 체크리스트 */
  checklist: string[]
  /** 붙여 넣은 필기 · 교과서 글 (선택) */
  material: string
  /** 줄인 사진(data URL). 이 화면의 기억에만 두고 어디에도 저장하지 않습니다. */
  photo: string | null
}

/** 위기 표현이 감지돼서 문제 대신 하는 말 (아래에 상담 전화 한 줄이 같이 보임) */
const QUIZ_HELP_REPLY = '문제는 잠깐 미뤄 두자. 마음이 힘들면 아래 번호로 언제든 이야기해도 돼.'

// ---- 🎯 목표 세우기 대화 (STARFLOW D8, lib/goalChatApi.ts) ----
// 계획 방의 [🎯 목표 세우기] 를 누르면 목표 전용 서버 대화(/goal-chats)로 WOOP 를 묻고, [끝내기] 로 받은 초안을
// 목표 만들기 화면(/goals/new)에 채워 둡니다. 학생이 그 화면에서 확인하고 [목표 저장] 을 누르면 서버(POST /goals)로 갑니다.
// 칩은 글자로 알아봅니다. (계획 방 첫 인사 lib/chatRooms.ts 의 칩 글자와 같아야 합니다)
const GOAL_CHAT_LABEL = '🎯 목표 세우기'
const GOAL_FINISH_LABEL = '✅ 끝내기 · 저장 화면에 채우기'
const GOAL_STOP_LABEL = '목표는 나중에 할래'
const GOAL_OPEN_FORM_LABEL = '📝 목표 저장 화면 열기'
const GOAL_START_CHIP: CoachChip = { kind: 'say', label: GOAL_CHAT_LABEL }
/** 목표 대화 중 AI 의 말마다 붙는 칩 */
const GOAL_CHAT_CHIPS: CoachChip[] = [
  { kind: 'say', label: GOAL_FINISH_LABEL },
  { kind: 'say', label: GOAL_STOP_LABEL },
]
const GOAL_CHAT_GONE_REPLY =
  '목표 대화가 끊겼어. 오래됐거나 서버가 다시 켜졌나 봐. [🎯 목표 세우기] 를 누르면 처음부터 다시 할 수 있어.'
const GOAL_HELP_REPLY = '목표는 잠깐 미뤄 두자. 마음이 힘들면 아래 번호로 언제든 이야기해도 돼.'

/** 대화방에서 bubbleId 말풍선의 문제를 change 로 바꾼 새 대화방 */
function withQuiz(
  thread: CoachThread,
  bubbleId: number,
  change: (quiz: CoachQuiz) => CoachQuiz,
): CoachThread {
  const bubbles = thread.bubbles.map((bubble) =>
    bubble.id === bubbleId && bubble.quiz ? { ...bubble, quiz: change(bubble.quiz) } : bubble,
  )
  return { ...thread, bubbles }
}

/** 새 문제를 내기 전에, 풀다 만 문제 말풍선은 접습니다. (결과는 다 푼 것만 남음) */
function closeOpenQuizzes(thread: CoachThread): CoachThread {
  const bubbles = thread.bubbles.map((bubble) =>
    bubble.quiz && (bubble.quiz.status === 'open' || bubble.quiz.status === 'guessCheck')
      ? { ...bubble, quiz: { ...bubble.quiz, status: 'closed' as const } }
      : bubble,
  )
  return { ...thread, bubbles }
}

/**
 * 문제 말풍선을 대화방 끝에 붙입니다. (서버를 부르지 않는 "틀린 문제 다시" 도 이걸로)
 * 단원(unit)은 AI 가 낸 문제에만 있습니다. 단원이 있는 결과만 서버에 저장됩니다. (lib/quizResultsApi.ts)
 */
function withNewQuiz(
  thread: CoachThread,
  text: string,
  quiz: {
    topic: string
    cardId: string | null
    unit?: string | null
    questions: QuizQuestion[]
    isDemo: boolean
  },
): CoachThread {
  const made = newQuiz({ ...quiz, now: Date.now() })
  return withBubble(closeOpenQuizzes(thread), { speaker: 'ai', text, quiz: made, typing: true })
}

/** 문제를 받은 결과를 대화방 끝에 붙입니다. */
function applyQuizReply(thread: CoachThread, result: QuizReply, input: QuizInput): CoachThread {
  if (result.showHelp) {
    return withBubble({ ...thread, isHelpShown: true }, { speaker: 'ai', text: QUIZ_HELP_REPLY })
  }
  if (result.notStudy) {
    return withBubble(thread, {
      speaker: 'ai',
      text: '공부 자료가 아닌 것 같아. 교과서나 필기 사진으로 다시 해 볼래?',
      chips: [QUIZ_CHIP],
    })
  }
  if (result.questions === null) {
    return withBubble(thread, {
      speaker: 'ai',
      text: '이번엔 문제를 못 만들었어. 주제를 조금 더 자세히 적어 줄래?',
      chips: [QUIZ_CHIP],
    })
  }
  const lines = [
    ...(result.notice ? [result.notice] : []),
    `'${input.topic}' 문제 ${result.questions.length}개 낼게. 천천히 풀어 봐!`,
  ]
  return withNewQuiz(thread, lines.join('\n'), {
    topic: input.topic,
    cardId: input.cardId,
    unit: result.unit,
    questions: result.questions,
    isDemo: result.isDemo,
  })
}

/**
 * [이야기하기] 로 연 후기 · 못 한 카드 대화에서 AI 가 짐작한 이유가 오면 "맞아?" 칸을 만듭니다. 아니면 null
 * (주제와 저장할 곳이 맞을 때만: 후기 → 그 공부 기록, 못 한 카드 → 그 카드 하루치)
 */
function reasonCheckOf(thread: CoachThread, tags: string[]): ReasonCheck | null {
  const topic = thread.topic
  if (!topic?.target) return null
  const kind = topic.about.kind
  const fits =
    (kind === 'SESSION_REVIEW' && topic.target.type === 'session') ||
    (kind === 'CARD_FAIL' && topic.target.type === 'card')
  if (!fits) return null
  const values = validReasonValues(kind, tags)
  return values.length > 0 ? { kind, values, target: topic.target, status: 'open' } : null
}

/** 대화방에서 bubbleId 말풍선의 이유 확인 칸을 change 로 바꾼 새 대화방 */
function withReasonCheck(
  thread: CoachThread,
  bubbleId: number,
  change: (check: ReasonCheck) => ReasonCheck,
): CoachThread {
  return {
    ...thread,
    bubbles: thread.bubbles.map((bubble) =>
      bubble.id === bubbleId && bubble.reasonCheck
        ? { ...bubble, reasonCheck: change(bubble.reasonCheck) }
        : bubble,
    ),
  }
}

/** 계획 이야기인지 (매일 코치 방 등에서 누르면 계획 방으로 넘깁니다) */
const NOTIFY_HELP_REPLY = '알림은 잠깐 미뤄 두자. 마음이 힘들면 아래 번호로 언제든 이야기해도 돼.'
const NOTIFY_FAILED_REPLY = '그건 채팅으로 못 바꿨어. 설정 → 알림에서 직접 바꿔 줘.'

/** 알림 설정 변경안을 코치 말풍선으로 붙입니다. 바뀌는 칸이 없으면 그렇다고만 말합니다. (#594) */
function withNotifyProposal(thread: CoachThread, change: NotifyChange): CoachThread {
  const rows = getNotifyChangeRows(change, loadTalkableSettings())
  if (rows.length === 0) {
    return withBubble(thread, {
      speaker: 'ai',
      text: '이미 그렇게 돼 있어서 바꿀 게 없어. 설정 → 알림에서 자세히 볼 수 있어.',
    })
  }
  return withBubble(thread, {
    speaker: 'ai',
    text: notifyProposalText(notifySummaryOf(change), rows),
    chips: [
      { kind: 'notifySettings', label: '✅ 바꿀게', change },
      { kind: 'notifySettings', label: '그대로 둘게', change: null },
    ],
  })
}

function isPlanChip(chip: CoachChip): chip is PlanHandoffChip {
  return chip.kind === 'dayPlan' || chip.kind === 'longPlan' || chip.kind === 'makePlan'
}

interface RoomChatProps {
  room: ChatRoomId
}

/**
 * 대화방 하나의 대화. 방마다 하는 일이 조금 다릅니다. (lib/chatRooms.ts 의 CHAT_ROOMS)
 *   매일 코치 방(💬 상담): 아침 브리핑 · 미션 · 코치 알림 첫 말 · 공부 끝 회고
 *   계획 방(📅 계획): 오늘 계획 · 시험 날까지 계획 핑퐁. 다른 방의 계획 칩은 이 방으로 넘어와서 짭니다.
 *   그 밖의 방(📚 과목 쌤 등): 방의 첫 인사로 시작. 사진 질문 · 확인 문제
 */
function RoomChat({ room }: RoomChatProps) {
  const navigate = useNavigate()
  const { token, user } = useAuth()
  const isServerData = isServerDataToken(token)
  const [todayKey] = useState(getTodayKey)
  const [now] = useState(() => Date.now())
  const sendCheckIn = useSendCheckIn()
  const roomInfo = getChatRoom(room)
  // 매일 코치 방만 브리핑 · 미션 · 코치 알림 · 공부 끝 회고를 합니다.
  const isDailyCoach = roomInfo.isDailyCoach
  // 미션 알림을 누르고 들어오면 ?mission=morning 처럼 옵니다. 코치가 그 미션 이야기를 먼저 합니다.
  // 아래 넷(?mission= · ?nudge= · ?talk= · ?plan=)은 한 번 읽고 지우는 값이라 replace 로 지웁니다.
  // 지울 때 기록을 새로 쌓으면, 뒤로 가기가 지우기 전 주소로 돌아가서 또 지우고 쌓여 이 방에 갇힙니다. (#723)
  const [missionParam, setMissionParam] = useQueryParam('mission', '', { replace: true })
  // 코치 알림을 누르고 들어오면 ?nudge=evening 처럼 옵니다. 코치의 첫 말이 그 알림 글입니다. (lib/coachNudges.ts)
  const [nudgeParam, setNudgeParam] = useQueryParam('nudge', '', { replace: true })
  // 다른 화면의 [이야기하기] 로 들어오면 ?talk=SESSION_REVIEW 처럼 옵니다. 맡겨 둔 사실 줄로 그 주제의 새 대화를 엽니다.
  const [talkParam, setTalkParam] = useQueryParam('talk', '', { replace: true })
  // 후기 · 못 한 카드 대화에서 AI 가 짐작한 이유를 확인받으면 그 공부 기록에 저장합니다. (lib/talkLines.ts)
  const { updateSession } = useStudySessions()

  // 첫 말의 재료: 오늘 학교 정보(못 받으면 null) · 오늘 카드 · 오늘 체크인
  const [schoolClass] = useState(loadSchoolClass)
  const { data: school } = useSuspenseQuery(
    schoolTodayOrNullQuery(schoolClass, isServerData, todayKey),
  )
  // 다른 기기에서 이미 오늘 컨디션을 알려 줬으면 이 기기에 옮겨 적습니다. (그러면 코치가 다시 묻지 않음)
  useSuspenseQuery(todayCheckInForCoachQuery(todayKey, canSyncCheckIns(token)))
  // 오늘의 미션 (체크인 · 오늘 카드 · 공부 기록으로 끝났는지 봄). 컨디션 칩을 누르면 다시 계산합니다.
  const [missions, setMissions] = useState<Mission[]>(() => loadDailyMissions(todayKey))
  // "내가 준비하는 것" 을 묻는 중 어디까지 왔는지 (대회 · 기타일 때만 이름 → 날짜를 더 묻습니다)
  //   name: 학생이 쓴 다음 한 줄을 이름으로 저장 · date: 날짜를 고르거나 [아직 몰라] 를 기다림
  const [focusStep, setFocusStep] = useState<'name' | 'date' | null>(null)
  // 날짜 고르기 칸을 열었는지 ([📅 날짜 고르기] 칩)
  const [isPickingDate, setIsPickingDate] = useState(false)
  const [pickedDate, setPickedDate] = useState('')
  const { cards, addCard, deleteCard } = useCards()
  const [allSessions] = useState(loadAllSessions)
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
  const nowCard = todayCards.current ?? todayCards.next
  // 오늘 계획을 고칠 때 바꿀 수 있는 카드: 오늘 하루짜리이고 아직 시작 · 처리하지 않은 카드 (반복 카드는 건드리지 않음)
  // 중간에 끝내고 이어서 할 수 있는 카드는 기록이 있어서 고치지 않습니다. (#709)
  const editableTodayCards = todayCards.items
    .filter((item) => (item.status === 'waiting' || item.status === 'current') && !item.isResumable)
    .map((item) => item.card)
    .filter((card) => card.date === todayKey && !(card.repeatDays && card.repeatDays.length > 0))
  const todaySubjects = todaySubjectsOf(school)
  // 홈의 [코치와 계획 짜기] 로 들어오면 ?plan=today 로 옵니다. 코치가 바로 오늘 계획을 짜 줍니다.
  const [planParam, setPlanParam] = useQueryParam('plan', '', { replace: true })
  // 긴 계획 칸 (목표 · 날짜 · 하루 시간 · 사진). null 이면 닫혀 있습니다.
  const [longForm, setLongForm] = useState<LongPlanForm | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  // [🕖 시간 바꿔 줘] 를 눌러 시각 고르기 칸을 열었는지
  const [isPickingTime, setIsPickingTime] = useState(false)
  const [pickedTime, setPickedTime] = useState('')
  // 확인 문제 칸 (주제 · 오늘 카드 · 글 · 사진). null 이면 닫혀 있습니다.
  const [quizForm, setQuizForm] = useState<QuizForm | null>(null)
  // 확인 문제 칸에서 [📄 글 붙여 넣기] 를 눌러 글칸을 열었는지
  const [isMaterialOpen, setIsMaterialOpen] = useState(false)
  // 입력창의 📎 로 고른 사진 (줄인 data URL). 물어볼지 · 문제 · 계획 중 무엇에 쓸지 고를 때까지 이 화면의 기억에만 둡니다.
  const [chatPhoto, setChatPhoto] = useState<string | null>(null)
  const [chatPhotoError, setChatPhotoError] = useState<string | null>(null)
  // [💬 이 사진으로 물어보기] 를 고른 사진. 다음에 보내는 말에 붙여서 보내고 바로 비웁니다. (어디에도 저장하지 않음)
  const [attachedPhoto, setAttachedPhoto] = useState<string | null>(null)
  // 📎 사진 고르기 창 (과목 쌤 방의 [📎 문제 사진 보내기] 칩이 대신 눌러 엽니다)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // 처음 그릴 때 한 번만 정합니다:
  //   이 기기의 대화방을 꺼내고 → 날이 바뀌었으면 지난 서버 세션을 정리할 준비 + 오늘의 첫 말(브리핑)
  //   → 끝난 공부가 있으면 결과 묻기 → 미션 알림으로 들어왔으면 미션 이야기, 미션을 새로 끝냈으면 몇 개 끝냈는지
  const [initial] = useState(() => {
    let thread = loadCoachThread(user?.id ?? 'unknown', room)
    let staleSession: { chatId: string; lines: CallLine[] } | null = null
    if (thread.chatId !== null && needsNewSession(thread, now)) {
      staleSession = { chatId: thread.chatId, lines: sessionLines(thread) }
      // 지난 세션의 주제([이야기하기])도 그 세션과 같이 끝납니다.
      thread = { ...thread, chatId: null, lastServerAt: null, topic: null }
    }
    const add = (message: CoachMessage) => {
      const bubble = toCoachBubble(nextBubbleId(thread.bubbles), message, now)
      thread = { ...thread, bubbles: [...thread.bubbles, bubble] }
      return bubble
    }

    // [이야기하기] 로 들어왔는지 (그 주제 대화는 그리고 난 뒤 effect 가 엽니다. 여기서는 보기만 함)
    const pendingTalk = isChatAboutKind(talkParam) ? peekTalkRequest(room, talkParam, now) : null

    // 코치 알림으로 들어왔으면 그 알림 글이 코치의 첫 말입니다. (lib/coachNudges.ts — 매일 코치 방만)
    const nudgeKind = isDailyCoach && isNudgeKind(nudgeParam) ? nudgeParam : null
    const nudgeMessage = nudgeKind
      ? buildNudgeCoachMessage(
          nudgeKind,
          loadNudgeDay(todayKey, loadStopWhip(now)),
          buildMissionBriefing(missions, 'morning', nowCard).chips,
        )
      : null
    // 아침 알림으로 오늘 처음 들어왔으면 알림 글과 오늘의 첫 말(브리핑)을 한 말풍선으로 합칩니다. (같은 아침 인사가 두 번 나오지 않게)
    const isNudgeInBriefing = nudgeKind === 'morning' && nudgeMessage !== null

    const lastBubble = thread.bubbles[thread.bubbles.length - 1]
    const isFirstToday = !lastBubble || toDayKey(lastBubble.at) !== todayKey
    if (isFirstToday && !isDailyCoach && !pendingTalk) {
      // 매일 코치 방이 아니면 그 방의 첫 인사(코드가 정한 말)로 하루를 엽니다. (lib/chatRooms.ts)
      const greeting = add(roomInfo.greeting)
      if (thread.chatId === null)
        thread = { ...thread, sessionFrom: greeting.id, isHelpShown: false }
    }
    if (isFirstToday && isDailyCoach) {
      const morning = buildMorningBriefing({
        hour: new Date(now).getHours(),
        school,
        grade: schoolClass?.grade ?? gradeNumberOf(loadOnboardingAnswers()?.grade),
        cards: todayCards,
        checkIn: loadLocalCheckIn(todayKey),
        yesterdayWrongCount: loadYesterdayWrong(todayKey).length,
      })
      const briefing = add(
        isNudgeInBriefing
          ? { ...morning, text: `${nudgeMessage.text}\n\n${morning.text}` }
          : morning,
      )
      // 오늘의 서버 세션은 오늘의 첫 말부터 보냅니다. (어제 대화는 요약으로만 넘어감)
      if (thread.chatId === null)
        thread = { ...thread, sessionFrom: briefing.id, isHelpShown: false }
    }

    const lastRecapped = loadData<unknown>(RECAPPED_SESSION_KEY, null)
    const recapSession = isDailyCoach
      ? findRecapSession(
          loadStudySessions(),
          now,
          typeof lastRecapped === 'string' ? lastRecapped : null,
        )
      : null
    // 그 공부의 [코치랑 후기 나누기] 로 들어왔으면 결과 묻기 말풍선은 건너뜁니다. (후기 대화가 같은 이야기를 함)
    const isRecapInTalk =
      recapSession !== null &&
      pendingTalk?.target?.type === 'session' &&
      pendingTalk.target.sessionId === recapSession.id
    const missionSlot = isDailyCoach && isMissionSlot(missionParam) ? missionParam : null
    const doneMissions = countDoneMissions(missions)
    const lastProgress = loadMissionProgress(todayKey)
    const hasNewMissionDone = isDailyCoach && lastProgress !== null && doneMissions > lastProgress
    if (recapSession && !isRecapInTalk) {
      const recap = buildSessionRecap(
        recapSession,
        loadPhoneLift(recapSession.id),
        loadFocusScore(recapSession.id),
      )
      // 공부를 끝내서 미션이 늘었으면 같은 말풍선에 한 줄로 붙입니다. (말풍선이 너무 많아지지 않게)
      if (hasNewMissionDone && !missionSlot) {
        recap.text += `\n✅ 오늘의 미션 ${doneMissions}/${missions.length} 끝!`
      }
      // 카드로 공부했으면 그 카드로 확인 문제를 내자고 권합니다. (누를 때만 문제를 냄)
      const recapCard = cards.find((card) => card.id === recapSession.cardId)
      if (recapCard) recap.chips = [...recap.chips, quizChipForCard(recapCard)]
      // 확인 통화로 치는 공부(타이머 10분 이상)면 코치한테 말로 설명하는 통화를 권합니다. (누를 때만, lib/checkCall.ts)
      if (countsForCheckCall(recapSession)) {
        recap.chips = [...recap.chips, { kind: 'checkCall', label: '📞 코치한테 3분 설명하기' }]
      }
      // 어땠는지 말로 나누면 AI 가 이유를 짐작해 기록에 남겨 줍니다. (후기 대화, #582)
      recap.chips = [
        ...recap.chips,
        { kind: 'reviewTalk', label: '💬 후기 나누기', sessionId: recapSession.id },
      ]
      add(recap)
    }
    // 오늘 첫 말이 이미 컨디션을 묻고 있으면(미션 ①), 미션 말풍선으로 같은 걸 또 묻지 않습니다.
    const isAskingCheckIn = isFirstToday && nextMission(missions)?.kind === 'checkIn'
    if (nudgeMessage && !(isNudgeInBriefing && isFirstToday)) {
      // 고치던 계획이 열려 있으면 닫습니다. (열려 있으면 그 계획의 칩만 보여서 알림의 칩을 누를 수 없음)
      thread = withPlanStatus(thread, (bubble) =>
        bubble.plan?.status === 'open' ? 'closed' : null,
      )
      add(nudgeMessage)
    } else if (missionSlot && !isAskingCheckIn) {
      add(buildMissionBriefing(missions, missionSlot, nowCard))
    } else if (hasNewMissionDone && !recapSession) {
      add(buildMissionProgress(missions, nowCard))
    }
    return {
      thread,
      staleSession,
      recapSessionId: recapSession?.id ?? null,
      missionSlot,
      nudgeKind,
    }
  })

  const [thread, setThread] = useState<CoachThread>(initial.thread)
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  // 메신저처럼 보이는 효과(lib/chatReveal.ts)를 위한 시계. 글자가 나오는 동안만 50ms 마다 움직입니다.
  const [clock, setClock] = useState(() => Date.now())
  // 이 시각까지 받은 답은 효과 없이 바로 전체를 보여 줍니다. 처음엔 화면을 연 때라서, 새로고침 · 예전 기록 · 방을 다시 열 때는
  // 효과가 없습니다. 말풍선 목록을 누르면 지금 시각으로 바뀌어 남은 글이 바로 다 보입니다(건너뛰기).
  // 움직임 줄이기(prefers-reduced-motion)를 켠 사람은 효과를 아예 끕니다.
  const [skipBefore, setSkipBefore] = useState(() =>
    prefersReducedMotion() ? Number.POSITIVE_INFINITY : now,
  )
  // 휴대폰처럼 손가락으로 누르는 화면인지. 터치 키보드에는 Shift 가 없어서 "Shift+Enter 줄바꿈" 안내를 PC 에서만 보여 줍니다.
  const [isTouchKeyboard] = useState(isCoarsePointer)

  // 대화방이 바뀔 때마다 이 기기에 저장합니다. (다시 열면 이어서 보이게) 지금 보고 있으니 "새 말" 점도 지웁니다.
  useEffect(() => {
    saveCoachThread(thread, Date.now(), room)
    markRoomSeen(room, Date.now())
  }, [thread, room])

  // 날이 바뀌어 닫은 지난 서버 세션을 조용히 정리합니다. (진짜 로그인만)
  const staleSession = initial.staleSession
  useEffect(() => {
    if (staleSession && isServerData) finishQuietly(staleSession.chatId, staleSession.lines)
  }, [staleSession, isServerData])

  // 결과를 물어본 공부 기록 번호를 적어 둡니다. (다음에 같은 기록을 또 묻지 않게)
  useEffect(() => {
    if (initial.recapSessionId) saveData(RECAPPED_SESSION_KEY, initial.recapSessionId)
  }, [initial.recapSessionId])

  // 미션 알림으로 들어왔으면 이야기를 꺼냈으니 주소의 ?mission= 을 지웁니다. (새로고침해도 또 말하지 않게)
  // 주소에 아직 값이 남아 있을 때만 지웁니다. (지우는 함수는 그릴 때마다 새로 만들어져서, 이렇게 안 하면
  // 다른 방으로 옮기는 순간에도 다시 불려 지금 주소로 되돌려 버립니다)
  const hasMissionParam = initial.missionSlot !== null && missionParam !== ''
  useEffect(() => {
    if (hasMissionParam) setMissionParam('')
  }, [hasMissionParam, setMissionParam])

  // 코치 알림으로 들어왔을 때도 같은 이유로 ?nudge= 를 지웁니다.
  const hasNudgeParam = initial.nudgeKind !== null && nudgeParam !== ''
  useEffect(() => {
    if (hasNudgeParam) setNudgeParam('')
  }, [hasNudgeParam, setNudgeParam])

  // 코치가 알아챈 미션 진행을 적어 둡니다. 다음에 더 끝내고 돌아오면 그때 말을 겁니다. (매일 코치 방만)
  const doneMissionCount = countDoneMissions(missions)
  useEffect(() => {
    if (isDailyCoach) saveData(MISSION_PROGRESS_KEY, `${todayKey}:${doneMissionCount}`)
  }, [isDailyCoach, todayKey, doneMissionCount])

  // 진짜 로그인일 때 AI 의 답을 받습니다. 세션이 없으면 그때 처음 열고,
  // 서버가 대본을 잊었으면(409 — 서버가 다시 켜짐 등) 새로 열어서 한 번 더 보냅니다.
  // 서버 채팅은 이 방(room)과, [이야기하기] 로 연 세션이면 그 주제(about)로 엽니다. (BE #330)
  // image: 이번 말에 붙인 사진 (그 한 번만 보냄)
  const talk = useMutation({
    mutationFn: async ({
      id,
      lines,
      image,
      about,
    }: {
      id: string | null
      lines: CallLine[]
      image: string | null
      about: ChatAbout | null
    }) => {
      // 학생이 먼저 말을 보내는 길이라 AI 첫 인사 없이 채팅 번호만 받습니다. (인사는 화면에 안 쓰여서 8초쯤 버려졌음)
      const open = () => openChatSession({ room: roomInfo.serverRoom, about })
      // 오늘 다른 방에서 한 말도 같이 보내서, 이 방 AI 가 그 이야기를 이어 갑니다. (lib/coachThread.ts, 2026-10-22)
      const otherRooms = otherRoomLines(user?.id ?? 'unknown', room, todayKey)
      let openId = id ?? (await open())
      let reply: ChatReply
      try {
        reply = await sendChatMessage(openId, lines, image, otherRooms)
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 409)) throw error
        openId = await open()
        reply = await sendChatMessage(openId, lines, image, otherRooms)
      }
      return { openId, reply }
    },
    onSuccess: ({ openId, reply }, variables) => {
      // AI 가 고른 빠른 답 · 행동이 있으면 그 칩을, 없으면 코드가 칩을 붙입니다. (핑계 협상 · 계획 · 시험)
      // 위기 안내에는 칩이 없고, 계획 방에는 계획 칩이 늘 붙습니다. (lib/coachBriefing.ts)
      const studentText = variables.lines[variables.lines.length - 1]?.text ?? ''
      const chips = replyChipsFor({
        reply,
        studentText,
        isPlanner: roomInfo.isPlanner,
        nowCard,
      })
      setThread((current) => {
        const reasonCheck = reasonCheckOf(current, reply.tags)
        return {
          ...withBubble(current, {
            speaker: 'ai',
            text: reply.reply,
            chips,
            // 위기 안내는 효과 없이 바로 전체로 보여 줍니다.
            ...(reply.showHelp ? {} : { typing: true }),
            ...(reasonCheck ? { reasonCheck } : {}),
            // 과목 쌤이 웹 검색으로 찾은 출처 (없으면 넣지 않음)
            ...(reply.sources.length > 0 ? { sources: reply.sources } : {}),
          }),
          chatId: openId,
          lastServerAt: Date.now(),
          isHelpShown: current.isHelpShown || reply.showHelp,
        }
      })
      // AI 가 학생과 오늘 계획을 정했으면(day_plan) 칩을 기다리지 않고 바로 짭니다. (계획 방만, #695)
      const ask = roomInfo.isPlanner && !reply.showHelp ? dayPlanAskOf(reply.action) : null
      if (ask) startAskedPlan(ask, reply.reply)
    },
  })

  // 시각이 든 알림 부탁("밤 10시 이후엔 연락하지 마")은 서버 AI 가 변경안을 만듭니다. 바꾸는 건 [✅ 바꿀게] 를 누른 뒤입니다. (#594)
  const settingsTalk = useMutation({
    mutationFn: requestSettingsFromText,
    onSuccess: (result) => {
      setThread((current) => {
        if (result.kind === 'proposal') {
          return withNotifyProposal(current, { settings: result.proposal, nudge: null })
        }
        if (result.kind === 'help') {
          return withBubble(
            { ...current, isHelpShown: true },
            { speaker: 'ai', text: NOTIFY_HELP_REPLY },
          )
        }
        return withBubble(current, { speaker: 'ai', text: NOTIFY_FAILED_REPLY })
      })
    },
    onError: () => {
      setThread((current) => withBubble(current, { speaker: 'ai', text: NOTIFY_FAILED_REPLY }))
    },
  })

  // [이야기하기] 로 연 주제 대화: 서버가 사실 줄을 보고 첫 말을 씁니다. 그 첫 말부터가 이 세션의 대화입니다.
  const topicTalk = useMutation({
    mutationFn: (about: ChatAbout) => startChat({ room: roomInfo.serverRoom, about }),
    onSuccess: (reply) => {
      setThread((current) => {
        const reasonCheck = reasonCheckOf(current, reply.tags)
        const opened = withBubble(current, {
          speaker: 'ai',
          text: reply.reply,
          // 위기 안내에는 공부 칩을 붙이지 않습니다. (위의 talk 와 같은 규칙)
          chips: replyChipsFor({ reply, studentText: '', isPlanner: roomInfo.isPlanner, nowCard }),
          ...(reply.showHelp ? {} : { typing: true }),
          ...(reasonCheck ? { reasonCheck } : {}),
          ...(reply.sources.length > 0 ? { sources: reply.sources } : {}),
        })
        return {
          ...opened,
          chatId: reply.chatId,
          lastServerAt: Date.now(),
          sessionFrom: opened.bubbles[opened.bubbles.length - 1].id,
          isHelpShown: current.isHelpShown || reply.showHelp,
        }
      })
    },
  })

  // 계획을 짜거나 고칩니다. (lib/coachPlan.ts)
  //   진짜 로그인: 서버 AI. 서버가 아직 준비 안 됐으면(404 · 503 · 429) 시연용 예시로 대신합니다.
  //   테스트 로그인: 시연용 예시
  const planTalk = useMutation({
    mutationFn: async (request: PlanRequest): Promise<PlanReply> => {
      const focus = loadStudyFocus()
      if (request.type === 'revise') {
        // 시연용 계획은 서버가 고칠 수 없어서 시연용으로 고칩니다.
        if (!isServerData || request.plan.isDemo) {
          return reviseDemoPlan(request.plan, request.request)
        }
        return withDemoFallback(
          () =>
            request.plan.kind === 'day'
              ? reviseDayPlan(request.plan, request.request, {
                  focus,
                  subjects: todaySubjects,
                  planTalk: request.planTalkLines,
                })
              : reviseLongPlan(request.plan, request.request),
          () => reviseDemoPlan(request.plan, request.request),
        )
      }
      if (request.type === 'long') {
        const demo = () =>
          makeDemoLongPlan({
            todayKey,
            goal: request.input.goal,
            endDate: request.input.endDate,
            dailyMinutes: request.input.dailyMinutes,
            hasPhoto: request.input.image !== null,
            isEventDate: request.input.isEventDate,
          })
        const result = isServerData
          ? await withDemoFallback(() => requestLongPlan(request.input), demo)
          : demo()
        return request.notice ? { ...result, reply: `${request.notice}\n${result.reply}` } : result
      }
      // 오늘 계획(밤 정리 알림에서 오면 내일 계획): 그날 카드가 이미 있으면 새로 짜지 않고 그 카드들을 같이 고칩니다.
      const planDate = request.date ?? todayKey
      const isToday = planDate === todayKey
      const editableCards = isToday
        ? editableTodayCards
        : cards.filter((card) => card.date === planDate && !(card.repeatDays?.length ?? 0))
      if (editableCards.length > 0) {
        const current = planFromCards(editableCards)
        // AI 가 채팅에서 학생과 정한 값(day_plan)이 있으면 되묻지 않고 그 값대로 바로 고칩니다. (#695)
        // 고치는 말은 코드가 만듭니다. (예: '총 120분, 21:00부터, 수학 먼저')
        const revision = request.ask
          ? dayPlanAskText(request.ask)
          : request.light
            ? LIGHTER_REQUEST
            : null
        if (revision === null) {
          return {
            showHelp: false,
            reply: `지금 ${isToday ? '오늘' : '내일'} 계획이야. 고칠 곳을 말해 줘. (예: 영어는 빼 줘, 8시부터)`,
            plan: current,
            cleared: false,
            isDemo: false,
          }
        }
        const revised = !isServerData
          ? reviseDemoPlan(current, revision)
          : await withDemoFallback(
              () =>
                reviseDayPlan(current, revision, {
                  focus,
                  subjects: todaySubjects,
                  planTalk: request.planTalkLines,
                }),
              () => reviseDemoPlan(current, revision),
            )
        // day_plan 이면 고치기 전 지금 카드도 같이 돌려줘서 화면이 먼저 보여 줍니다. (applyPlanReply)
        return request.ask ? { ...revised, before: current } : revised
      }
      // 내일 계획은 내일 시간표 · 컨디션을 아직 몰라서 보내지 않습니다.
      const planSubjects = isToday ? todaySubjects : []
      const demo = () =>
        makeDemoDayPlan({
          todayKey: planDate,
          // 시연용 계획은 "지금" 뒤로 시각을 잡아서, 내일 계획은 내일 아침을 "지금" 으로 넘깁니다.
          now: isToday
            ? Date.now()
            : (getPlannedStartAt({ date: planDate, startTime: '07:00' }) ?? Date.now()),
          subjects: planSubjects,
          light: request.light,
        })
      if (!isServerData) return isToday ? demo() : asTomorrowReply(demo())
      // 가볍게 짜 달라면 컨디션을 2 로 보냅니다. (서버가 총량을 줄임) 아니면 오늘 체크인의 컨디션
      const todayCondition = isToday ? (loadLocalCheckIn(todayKey)?.condition ?? null) : null
      const condition = request.light ? 2 : todayCondition
      const result = await withDemoFallback(
        () =>
          requestDayPlan({
            date: planDate,
            focus,
            subjects: planSubjects,
            condition,
            // 상담 · 과목 쌤에서 오늘 한 이야기(예: 미적분 극한)를 계획에 넣게 같이 보냅니다. (2026-10-22)
            otherRooms: otherRoomLines(user?.id ?? 'unknown', room, todayKey),
            // 채팅에서 정한 총 분 · 시작 시각 · 먼저 할 것과 계획 방 대화 (#695)
            ask: request.ask,
            planTalk: request.planTalkLines,
          }),
        demo,
      )
      return isToday ? result : asTomorrowReply(result)
    },
    onSuccess: (result, request) => {
      setThread((current) => applyPlanReply(current, result, request))
    },
  })

  // 확인 문제를 받습니다. (lib/studyQuiz.ts)
  //   진짜 로그인: 서버 AI. 서버가 아직 준비 안 됐으면(404 · 503 · 429) 시연용 예시 문제로 대신합니다.
  //   테스트 로그인: 시연용 예시 문제
  const quizTalk = useMutation({
    mutationFn: async (input: QuizInput): Promise<QuizReply> =>
      isServerData ? requestQuizOrDemo(input) : makeDemoQuiz(input),
    onSuccess: (result, input) => {
      setThread((current) => applyQuizReply(current, result, input))
    },
  })
  // 🎯 목표 세우기 대화 중이면 서버 대화 번호와 지금까지 주고받은 말. 아니면 null (이 화면의 기억에만 둡니다)
  // 대화 중에 쓴 말은 보통 채팅이 아니라 목표 대화로 갑니다. (sendText)
  const [goalChat, setGoalChat] = useState<{ chatId: string; lines: CallLine[] } | null>(null)
  // 진행 중 목표가 3개면 목표 대화를 열지 않습니다. (목표 만들기 화면과 같은 기준, hooks/useGoalLimit.ts)
  const { goals } = useGoals()
  const goalLimit = useGoalLimit(goals)

  /** 목표 대화가 끊겼을 때(404: 2시간 지남 · 서버 재시작): 대화를 끝내고 다시 시작하라고 알려 줍니다. */
  function endGoneGoalChat() {
    setGoalChat(null)
    setThread((current) =>
      withBubble(current, { speaker: 'ai', text: GOAL_CHAT_GONE_REPLY, chips: [GOAL_START_CHIP] }),
    )
  }

  const goalTalk = useMutation({
    mutationFn: (input: { step: 'open' } | { step: 'send'; chatId: string; lines: CallLine[] }) =>
      input.step === 'open'
        ? openGoalChat()
        : sendGoalChatMessage(input.chatId, input.lines.slice(-MAX_CHAT_LINES)),
    onSuccess: (reply, input) => {
      if (reply.showHelp) {
        // 위기 표현이면 서버가 대화를 닫았습니다. 목표 이야기를 멈추고 상담 전화 안내를 보여 줍니다.
        setGoalChat(null)
      } else {
        setGoalChat((current) => {
          // 답을 기다리는 동안 [나중에 할래] 를 눌렀으면 다시 열지 않습니다.
          if (input.step === 'send' && current === null) return null
          const before = input.step === 'open' ? [] : (current?.lines ?? input.lines)
          return { chatId: reply.chatId, lines: [...before, { speaker: 'ai', text: reply.reply }] }
        })
      }
      setThread((current) => ({
        ...withBubble(current, {
          speaker: 'ai',
          text: reply.reply,
          ...(reply.showHelp ? {} : { chips: GOAL_CHAT_CHIPS, typing: true }),
        }),
        isHelpShown: current.isHelpShown || reply.showHelp,
      }))
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 404) endGoneGoalChat()
    },
  })

  const goalFinish = useMutation({
    mutationFn: ({ chatId, lines }: { chatId: string; lines: CallLine[] }) =>
      finishGoalChat(chatId, lines.slice(-MAX_CHAT_LINES)),
    onSuccess: (result) => {
      setGoalChat(null)
      if (result.showHelp) {
        setThread((current) =>
          withBubble({ ...current, isHelpShown: true }, { speaker: 'ai', text: GOAL_HELP_REPLY }),
        )
        return
      }
      // 초안을 목표 만들기 화면의 임시 저장 칸에 넣어 둡니다. 화면을 열면 이 값으로 채워져 있습니다. (pages/GoalNewPage.tsx)
      saveData(GOAL_DRAFT_KEY, toGoalFormDraft(result.goalDraft))
      setThread((current) =>
        withBubble(current, {
          speaker: 'ai',
          text: result.goalDraft
            ? '정리한 목표를 저장 화면에 채워 뒀어. 빈 칸만 채우고 [목표 저장] 을 누르면 목표가 저장돼.'
            : '이번 대화로는 목표를 다 정리하지 못했어. 저장 화면에서 직접 적어 줄래?',
          chips: [{ kind: 'say', label: GOAL_OPEN_FORM_LABEL }],
        }),
      )
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 404) endGoneGoalChat()
    },
  })

  // AI 의 답이나 계획 · 문제를 기다리는 중인지 (그동안은 새 말 · 칩을 막습니다)
  const isBusy =
    talk.isPending ||
    topicTalk.isPending ||
    planTalk.isPending ||
    quizTalk.isPending ||
    settingsTalk.isPending ||
    goalTalk.isPending ||
    goalFinish.isPending

  const bubbles = thread.bubbles
  const lastBubble = bubbles[bubbles.length - 1]

  /** 이 말풍선이 지금 "글자가 나오는 중" 이면 그 시간표, 아니면(다 나왔거나 효과 없음) null */
  function revealOf(bubble: ThreadBubble): ActiveReveal | null {
    if (!bubble.typing || bubble.at <= skipBefore) return null
    const parts = splitReply(bubble.text)
    const schedule = revealSchedule(parts)
    const elapsed = clock - bubble.at
    return elapsed >= schedule.totalMs ? null : { parts, schedule, elapsed }
  }
  const isRevealing = bubbles.slice(-3).some((bubble) => revealOf(bubble) !== null)

  // 글자가 나오는 동안만 시계를 움직이고, 글이 늘어나는 만큼 목록을 아래로 따라 내립니다.
  useEffect(() => {
    if (!isRevealing) return
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
    const timerId = setTimeout(() => setClock(Date.now()), 50)
    return () => clearTimeout(timerId)
  }, [isRevealing, clock])
  // 지금 고치는 중인 계획 말풍선. 있으면 학생이 쓰는 말은 이 계획을 고치는 요청이 됩니다.
  const openPlanBubble = bubbles.findLast((bubble) => bubble.plan?.status === 'open')
  // 가장 최근 문제 말풍선. 이것만 펼쳐 보이고, 앞의 문제 말풍선은 결과 한 줄로 접습니다.
  const latestQuizId = bubbles.findLast((bubble) => bubble.quiz)?.id ?? null
  // 확인 문제 칸에서 고를 수 있는 오늘 카드 (다 한 카드 · 지금 카드 · 다음 카드, 5개까지)
  const quizCardOptions = todayCards.items.map((item) => item.card).slice(0, 5)

  // 새 말풍선이 생기면 맨 아래로 내립니다.
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
  }, [bubbles, isBusy])

  // 계획 방에 이렇게 들어오면 한 번 짜 줍니다. (주소의 값은 지워서 새로고침해도 또 짜지 않게)
  //   ?plan=today — 홈의 [코치와 계획 짜기]: 오늘 계획
  //   ?plan=chip  — 다른 방에서 누른 계획 칩(내일 계획 · 긴 계획 등): 맡겨 둔 칩을 대신 눌러 줌 (lib/chatRooms.ts)
  // 개발 모드(StrictMode)는 effect 를 두 번 돌려서, 한 번만 짜려고 ref 로 표시해 둡니다.
  const planRequestParam =
    roomInfo.isPlanner && (planParam === 'today' || planParam === 'chip') ? planParam : null
  const autoPlanStarted = useRef(false)
  // 칩을 누르는 함수 · 주제 대화를 여는 함수. 화면을 그릴 때마다 새로 만들어져서, 가장 최근 것을 ref 에 둡니다.
  // (주소를 보고 한 번만 하는 일이라 effect 에서 부르는데, 함수를 effect 의 의존 목록에 넣으면 매번 다시 돌아서)
  const handleChipRef = useRef<(chip: CoachChip) => void>(() => {})
  const openTalkRef = useRef<(request: TalkRequest) => void>(() => {})
  useEffect(() => {
    handleChipRef.current = handleChip
    openTalkRef.current = openTalk
  })
  useEffect(() => {
    if (planRequestParam === null || autoPlanStarted.current) return
    autoPlanStarted.current = true
    setPlanParam('')
    // ?plan=today 는 [▷ 오늘 계획 짜 줘] 칩을, ?plan=chip 은 다른 방에서 맡긴 칩을 대신 누릅니다.
    const chip = planRequestParam === 'today' ? PLAN_CHIP : takePlanHandoff(Date.now())
    if (chip) handleChipRef.current(chip)
  }, [planRequestParam, setPlanParam])

  // 다른 화면의 [이야기하기] 로 들어오면(?talk=) 맡겨 둔 주제로 새 대화를 엽니다. (lib/chatRooms.ts 의 startTalk)
  //   열려 있던 서버 세션은 조용히 정리하고, "새 대화" 구분선 아래에 내 말(예: '💬 방금 공부 후기 나눌래')을 붙인 뒤
  //   진짜 로그인은 서버 AI 가 사실 줄을 보고 첫 말을 쓰고, 테스트 로그인은 시연용 첫 말을 씁니다.
  const handledTalkAt = useRef<number | null>(null)
  useEffect(() => {
    if (!isChatAboutKind(talkParam)) return
    setTalkParam('')
    const request: TalkRequest | null = peekTalkRequest(room, talkParam, Date.now())
    if (!request || handledTalkAt.current === request.at) return
    handledTalkAt.current = request.at
    clearTalkRequest()
    openTalkRef.current(request)
  }, [talkParam, setTalkParam, room])

  /** 맡겨 둔 [이야기하기] 요청으로 새 대화를 엽니다. (위 effect 가 부름) */
  function openTalk(request: TalkRequest) {
    const lines = sessionLines(thread)
    if (thread.chatId !== null && isServerData && hasStudentLine(lines)) {
      finishQuietly(thread.chatId, lines)
    }
    let next = closeOpenQuizzes(
      withPlanStatus(thread, (bubble) => (bubble.plan?.status === 'open' ? 'closed' : null)),
    )
    next = withBubble(next, { speaker: 'ai', text: '새 대화', isDivider: true })
    next = withBubble(next, { speaker: 'me', text: request.label })
    next = {
      ...next,
      chatId: null,
      lastServerAt: null,
      sessionFrom: nextBubbleId(next.bubbles),
      topic: { about: request.about, target: request.target },
    }
    if (!isServerData) {
      const opener = demoTopicOpener(request.about.kind)
      setThread(
        withBubble(next, {
          speaker: 'ai',
          text: opener.text,
          chips: opener.chips,
          isDemo: true,
          typing: true,
        }),
      )
      return
    }
    setThread(next)
    topicTalk.mutate(request.about)
  }

  /**
   * 준비하는 것을 다 정했을 때 코치의 한 줄 반응 (테스트 로그인에서 씀). 날짜를 받았으면 D-day 를 말하고,
   * 오늘 계획을 아직 안 정했으면 같이 정하자고 권합니다. 진짜 로그인은 그 말을 AI 에게 보내서 AI 가 반응합니다.
   */
  function focusReactionNow(): CoachMessage | null {
    const focus = loadStudyFocus()
    if (focus === null) return null
    const myEvent = focus.name
      ? getUpcomingMyEvents(todayKey, 365).find((event) => event.name === focus.name)
      : undefined
    const needsPlan = !missions.some((mission) => mission.kind === 'plan' && mission.done)
    return buildFocusReaction(focus, myEvent?.dDay ?? null, needsPlan)
  }

  /** 알림 설정을 바꿔 달라는 말에 변경안을 보여 줍니다. 모양이 뻔한 말은 코드가, 시각이 든 말은 서버 AI 가 만듭니다. (#594) */
  function askNotifyChange(request: NotifyRequest, text: string) {
    const withAsk = withBubble(thread, { speaker: 'me', text })
    if (request.type === 'ai') {
      setThread(withAsk)
      settingsTalk.mutate(text)
      return
    }
    setThread(withNotifyProposal(withAsk, buildNotifyChange(request, loadTalkableSettings())))
  }

  /** 학생의 말을 보냅니다. 진짜 로그인은 서버 AI, 테스트 로그인은 시연용 정해진 답이 답합니다. */
  function sendText(raw: string) {
    // [💬 이 사진으로 물어보기] 로 붙인 사진이 있으면 이번 말에 같이 보냅니다. 글이 없으면 정해 둔 한 줄로.
    const photo = attachedPhoto
    const typed = raw.trim().slice(0, MAX_CHAT_TEXT_LENGTH)
    const text = typed === '' && photo ? '이 사진 봐 줘' : typed
    if (text === '' || isBusy) return
    // 🎯 목표 세우기 대화 중이면 그 대화로 보냅니다. (사진은 목표 대화가 받지 않아서 보통 채팅으로)
    if (goalChat !== null && photo === null) {
      sendGoalText(text)
      return
    }
    // 위기 표현이 든 말은 계획 고치기 · 알림 · 문제 · 이름 저장으로 알아듣지 않고 보통 대화로 보냅니다.
    // 그래야 서버 AI(테스트 로그인은 시연용 답)가 상담 전화 한 줄을 같이 보여 줍니다. (#705)
    const isCrisis = hasCrisisText([text])
    // 사진을 붙인 말은 계획 · 문제 부탁으로 알아듣지 않고 바로 AI 에게 보냅니다.
    if (focusStep === null && photo === null && !isCrisis) {
      // 계획 말풍선이 열려 있으면 학생이 쓴 말은 그 계획을 고치는 요청입니다. (계획 핑퐁)
      if (openPlanBubble?.plan) {
        revisePlan(openPlanBubble, text)
        return
      }
      // "알림 좀 줄여 줘" 처럼 알림 설정을 바꿔 달라고 하면 변경안을 보여 줍니다. (#594, 상담 방만)
      const notifyRequest = isDailyCoach ? parseNotifyRequest(text) : null
      if (notifyRequest) {
        askNotifyChange(notifyRequest, text)
        return
      }
      // "11월 2일 중간고사 미적분 계획 짜 줘" 처럼 긴 계획을 부탁하면 바로 짜 줍니다.
      // 날짜를 못 알아들었으면 긴 계획 칸을 열어 날짜를 고르게 합니다.
      const longRequest = parseLongPlanText(text, todayKey)
      if (longRequest && !roomInfo.isPlanner) {
        // 계획 방이 아니면 계획 방으로 넘어가서 짭니다. (그 방에서 내가 쓴 말 대신 칩 글자가 보임)
        navigate(
          handOffPlanChip({
            kind: 'makePlan',
            label: `📅 ${text.slice(0, 40)}`,
            goal: longRequest.goal || suggestedGoal(),
            endDate: longRequest.endDate,
          }),
        )
        return
      }
      if (longRequest) {
        const goal = longRequest.goal || suggestedGoal()
        let notice: string | null = null
        if (longRequest.farEventDate && goal !== '') {
          // 30일보다 먼 날은 계획을 30일치만 짜고, 그 날은 지금 홈 일정에 D-day 로 넣어 둡니다.
          saveMyEvent({
            name: goal.slice(0, FOCUS_NAME_MAX),
            date: longRequest.farEventDate,
            kind: 'focus',
          })
          notice = `${MAX_LONG_PLAN_DAYS}일보다 먼 날이라 우선 ${MAX_LONG_PLAN_DAYS}일치만 짰어. D-day 는 홈 일정에 넣어 뒀어.`
        }
        if (longRequest.endDate && goal !== '') {
          startPlan(
            {
              type: 'long',
              input: {
                goal,
                endDate: longRequest.endDate,
                dailyMinutes: DEFAULT_DAILY_MINUTES,
                image: null,
                focus: loadStudyFocus(),
                isEventDate: longRequest.isEventDate,
              },
              notice,
            },
            text,
          )
        } else {
          openLongForm(goal, text, longRequest.endDate)
        }
        return
      }
      // "미적분 3단원 문제 내 줘" 처럼 문제를 부탁하면 바로 냅니다. 주제를 안 말했으면 주제 칸을 엽니다.
      const quizRequest = parseQuizText(text)
      if (quizRequest) {
        if (quizRequest.topic !== '') {
          startQuiz(
            {
              topic: quizRequest.topic,
              checklist: [],
              material: null,
              image: null,
              cardId: null,
            },
            text,
          )
        } else {
          openQuizForm({}, text)
        }
        return
      }
    }
    let focusReaction: CoachMessage | null = null
    if (isCrisis) {
      // 준비하는 것의 이름 · 날짜를 묻던 중이면 그 말을 저장하지 않고 묻기를 끝냅니다. (#705)
      setFocusStep(null)
      setIsPickingDate(false)
    } else if (focusStep === 'name') {
      // 대회 · 기타를 고른 뒤 쓴 첫 말은 그 이름으로 저장합니다. ([이름은 나중에] 를 누르면 이름 없이 둡니다)
      const focus = loadStudyFocus()
      const name = focus === null || text === SKIP_FOCUS_NAME_LABEL ? null : cleanFocusName(text)
      if (focus) saveStudyFocus({ ...focus, name })
      if (name) {
        // 이름을 받았으면 날짜를 한 번 더 묻습니다. (코드가 묻고, 날짜를 고르면 그때 반응 · AI)
        setFocusStep('date')
        const question = buildFocusDateQuestion(name)
        const withAnswer = withBubble(thread, { speaker: 'me', text })
        setThread(
          withBubble(withAnswer, { speaker: 'ai', text: question.text, chips: question.chips }),
        )
        return
      }
      setFocusStep(null)
      focusReaction = focusReactionNow()
    } else if (focusStep === 'date') {
      // 날짜를 골랐거나(그 날짜 글이 옴) [아직 몰라] 를 눌렀습니다. 날짜는 고를 때 이미 저장했습니다.
      setFocusStep(null)
      setIsPickingDate(false)
      focusReaction = focusReactionNow()
    }
    setAttachedPhoto(null)
    // 위기 표현이면 공부 이야기를 멈추므로, 열려 있던 계획 말풍선도 닫아서 계획 버튼을 치웁니다. (#705)
    const base = isCrisis
      ? withPlanStatus(thread, (bubble) => (bubble.plan?.status === 'open' ? 'closed' : null))
      : thread
    let next = withBubble(base, { speaker: 'me', text, ...(photo ? { hasPhoto: true } : {}) })
    if (!isServerData && focusReaction) {
      // 테스트 로그인: 준비하는 것에 대한 답이면 코드가 바뀐 미션으로 반응합니다.
      setThread(
        withBubble(next, { speaker: 'ai', text: focusReaction.text, chips: focusReaction.chips }),
      )
      return
    }
    if (!isServerData) {
      // 테스트 로그인: 방 · 주제에 맞는 시연용 정해진 답 (lib/demoCoach.ts). 위기 표현이면 효과 없이 바로 보여 줍니다.
      const reply = replyDemoInRoom({
        room,
        topicKind: next.topic?.about.kind ?? null,
        text,
        hasPhoto: photo !== null,
        context: { school, card: nowCard },
      })
      const reasonCheck = reasonCheckOf(next, reply.tags ?? [])
      next = withBubble(next, {
        speaker: 'ai',
        text: reply.text,
        chips: reply.chips,
        isDemo: true,
        ...(reply.showHelp ? {} : { typing: true }),
        ...(reasonCheck ? { reasonCheck } : {}),
      })
      setThread({ ...next, isHelpShown: next.isHelpShown || reply.showHelp })
      return
    }
    // 열린 세션이 오래됐거나 날이 바뀌었거나 길어졌으면, 정리하고 이 말 앞의 코치 말부터 새 세션으로 보냅니다.
    if (needsNewSession(next, Date.now()) && next.chatId !== null) {
      finishQuietly(next.chatId, sessionLines(thread))
      next = {
        ...next,
        chatId: null,
        lastServerAt: null,
        sessionFrom: newSessionStart(next.bubbles),
        topic: null,
      }
    }
    setThread(next)
    talk.mutate({
      id: next.chatId,
      lines: sessionLines(next),
      image: photo,
      about: next.topic?.about ?? null,
    })
  }

  // ---- 🎯 목표 세우기 대화 (STARFLOW D8) ----

  /** [🎯 목표 세우기]: 진행 중 목표가 3개 미만이면 목표 대화를 엽니다. */
  function startGoalChat() {
    if (isBusy) return
    const withAsk = withBubble(thread, { speaker: 'me', text: GOAL_CHAT_LABEL })
    if (!goalLimit.canAdd) {
      setThread(
        withBubble(withAsk, {
          speaker: 'ai',
          text: `진행 중인 목표가 벌써 ${goalLimit.activeCount}개야. 목표는 동시에 ${MAX_ACTIVE_GOALS}개까지라, 하나를 끝내거나 그만두면 새로 세울 수 있어.`,
        }),
      )
      return
    }
    setGoalChat(null)
    setThread(withAsk)
    goalTalk.mutate({ step: 'open' })
  }

  /** 목표 대화 중에 쓴 말을 보냅니다. 지금까지 주고받은 말 전체를 같이 보냅니다. (서버가 대화를 기억하지 않음) */
  function sendGoalText(text: string) {
    if (goalChat === null) return
    const lines: CallLine[] = [...goalChat.lines, { speaker: 'me', text }]
    setGoalChat({ ...goalChat, lines })
    setThread(withBubble(thread, { speaker: 'me', text }))
    goalTalk.mutate({ step: 'send', chatId: goalChat.chatId, lines })
  }

  /** [✅ 끝내기]: 대화를 끝내고 목표 초안을 받습니다. 대화가 이미 끝났으면(화면을 다시 열었음) 다시 시작하라고 합니다. */
  function finishGoal() {
    if (isBusy) return
    const withAsk = withBubble(thread, { speaker: 'me', text: GOAL_FINISH_LABEL })
    if (goalChat === null) {
      setThread(
        withBubble(withAsk, {
          speaker: 'ai',
          text: GOAL_CHAT_GONE_REPLY,
          chips: [GOAL_START_CHIP],
        }),
      )
      return
    }
    setThread(withAsk)
    goalFinish.mutate({ chatId: goalChat.chatId, lines: goalChat.lines })
  }

  /** [나중에 할래]: 목표 대화를 그만둡니다. 서버 대화는 2시간 뒤 저절로 사라집니다. */
  function stopGoal() {
    setGoalChat(null)
    const withAsk = withBubble(thread, { speaker: 'me', text: GOAL_STOP_LABEL })
    setThread(
      withBubble(withAsk, {
        speaker: 'ai',
        text: '좋아, 목표는 나중에 세워도 돼. 생각나면 [🎯 목표 세우기] 를 다시 눌러 줘.',
        chips: [GOAL_START_CHIP],
      }),
    )
  }

  // ---- 계획 말풍선 ----

  /** 계획을 짜거나 고쳐 달라고 합니다. myText 가 있으면 그 말을 내 말풍선으로 먼저 붙입니다. */
  function startPlan(request: PlanRequest, myText: string | null) {
    if (isBusy) return
    setIsPickingTime(false)
    if (myText) setThread((current) => withBubble(current, { speaker: 'me', text: myText }))
    planTalk.mutate(request)
  }

  /**
   * AI 가 채팅에서 학생과 정한 값(day_plan)으로 오늘 계획을 바로 짭니다. (#695)
   * 채팅 답을 받는 중(isBusy)에 부르므로 startPlan 을 거치지 않고 바로 부탁합니다.
   * 계획 방 대화에는 방금 받은 코치의 답(coachReply)까지 넣습니다. (thread 는 내 말까지 든 가장 최근 대화방)
   */
  function startAskedPlan(ask: DayPlanAsk, coachReply: string) {
    const withReply = withBubble(thread, { speaker: 'ai', text: coachReply })
    planTalk.mutate({
      type: 'day',
      light: false,
      ask,
      planTalkLines: planTalkLines(withReply.bubbles, todayKey),
    })
  }

  /** 열려 있는 계획을 학생의 요청(한 줄)대로 고쳐 달라고 합니다. */
  function revisePlan(bubble: ThreadBubble, request: string) {
    if (!bubble.plan) return
    startPlan(
      {
        type: 'revise',
        bubbleId: bubble.id,
        plan: bubble.plan,
        request: request.slice(0, MAX_PLAN_TEXT_LENGTH),
        // 계획 방에서 오늘 나눈 말도 같이 보내서, 채팅에서 정한 것을 지키며 고치게 합니다. (#695)
        planTalkLines: planTalkLines(thread.bubbles, todayKey),
      },
      request,
    )
  }

  /** 긴 계획의 목표 한 줄로 먼저 채워 둘 것: 준비하는 것의 이름 → 가장 가까운 내 일정 → 학교 시험 → 종류 */
  function suggestedGoal(): string {
    const focus = loadStudyFocus()
    if (focus?.name) return focus.name
    const myEvent = getUpcomingMyEvents(todayKey, MAX_LONG_PLAN_DAYS).find(
      (event) => event.dDay >= 1,
    )
    if (myEvent) return myEvent.name
    const exam = (school?.events ?? []).find((event) => event.exam && event.dDay >= 1)
    if (exam) return exam.name
    return focus ? `${focusLabelOf(focus.kind)} 준비` : ''
  }

  /**
   * 긴 계획의 날짜로 먼저 채워 둘 것: 30일 안의 내 일정 → 학교 시험 중 목표 이름과 맞는 것. 없으면 ''
   * 목표가 비었으면 가장 가까운 것을 씁니다. ('기말' 인데 중간고사 날짜를 채우지 않게 이름을 봅니다)
   */
  function suggestedEndDate(goal: string): string {
    const matches = (name: string) => goal === '' || name.includes(goal) || goal.includes(name)
    const myEvent = getUpcomingMyEvents(todayKey, MAX_LONG_PLAN_DAYS).find(
      (event) => event.dDay >= 1 && matches(event.name),
    )
    if (myEvent) return myEvent.date
    const exam = (school?.events ?? []).find(
      (event) =>
        event.exam && event.dDay >= 1 && event.dDay <= MAX_LONG_PLAN_DAYS && matches(event.name),
    )
    return exam?.date ?? ''
  }

  /**
   * 긴 계획 칸을 엽니다. 코치가 무엇을 적으면 되는지 한 줄로 알려 줍니다.
   * endDate 를 주면(채팅에서 날짜를 알아들음) 그 날로, 아니면 가까운 일정 · 시험 날로 미리 채웁니다.
   */
  function openLongForm(
    goal: string,
    myText: string,
    endDate: string | null = null,
    photo: string | null = null,
  ) {
    setPhotoError(null)
    setLongForm({
      goal,
      endDate: endDate ?? suggestedEndDate(goal),
      dailyMinutes: DEFAULT_DAILY_MINUTES,
      photo,
    })
    const withAnswer = withBubble(thread, { speaker: 'me', text: myText })
    setThread(
      withBubble(withAnswer, {
        speaker: 'ai',
        text: '좋아! 뭘 준비하는지 · 언제까지인지 아래에 알려 줘. 시험 범위표나 교과서 사진을 넣으면 그 범위로 짜 줄게.',
      }),
    )
  }

  /** 긴 계획 칸에서 사진을 고르면 줄여서 이 화면의 기억에만 둡니다. (저장하지 않음) */
  async function handleLongPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // 같은 사진을 다시 골라도 다시 읽게 비워 둡니다.
    event.target.value = ''
    if (!file) return
    setPhotoError(null)
    try {
      const photo = await shrinkPhoto(file)
      setLongForm((current) => (current ? { ...current, photo } : current))
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : '사진을 읽지 못했어요.')
    }
  }

  // 긴 계획 칸의 날짜는 내일부터 30일 뒤까지 고를 수 있습니다. (서버도 같은 범위)
  const longMinDate = moveDateKey(todayKey, 1)
  const longMaxDate = moveDateKey(todayKey, MAX_LONG_PLAN_DAYS)
  const isLongFormReady =
    longForm !== null &&
    longForm.goal.trim() !== '' &&
    longForm.endDate >= longMinDate &&
    longForm.endDate <= longMaxDate

  /** 긴 계획 칸에서 [계획 짜 줘] 를 누르면: 적은 것을 내 말풍선으로 붙이고 긴 계획을 짜 달라고 합니다. */
  function handleLongSubmit(event: FormEvent) {
    event.preventDefault()
    if (!longForm || !isLongFormReady) return
    const goal = longForm.goal.trim().slice(0, MAX_PLAN_TEXT_LENGTH)
    const [, month, day] = longForm.endDate.split('-').map(Number)
    const photoText = longForm.photo ? ' · 📎 사진 1장' : ''
    const myText = `📅 ${month}월 ${day}일까지 · ${goal} · 하루 ${longForm.dailyMinutes}분${photoText}`
    startPlan(
      {
        type: 'long',
        input: {
          goal,
          endDate: longForm.endDate,
          dailyMinutes: longForm.dailyMinutes,
          image: longForm.photo,
          focus: loadStudyFocus(),
          // 칸에서 고른 날은 시험 · 대회 날이라 저장할 때 홈 일정에 넣습니다.
          isEventDate: true,
        },
        notice: null,
      },
      myText,
    )
    setLongForm(null)
  }

  /**
   * [이대로 할게] — 계획을 카드로 저장합니다. 오늘 카드를 고친 계획이면 그 카드들을 바꿉니다.
   * 긴 계획이면 시험 · 대회 날을 내 일정(홈 "다가오는 일정")에 D-day 로 넣습니다.
   */
  function handleAcceptPlan(bubble: ThreadBubble) {
    const plan = bubble.plan
    if (!plan || isBusy) return
    setIsPickingTime(false)
    const saved = withPlanStatus(thread, (item) => (item.id === bubble.id ? 'saved' : null))
    const withAnswer = withBubble(saved, { speaker: 'me', text: '이대로 할게' })
    if (plan.fromCards) {
      // 지금 카드를 그대로 쓰기로 했으면 바꿀 것이 없습니다.
      setThread(
        withBubble(withAnswer, {
          speaker: 'ai',
          text: '좋아, 지금 계획 그대로 가자! 시간 되면 내가 알려 줄게.',
          chips: nowCard
            ? [{ kind: 'startCard', label: '▷ 지금 카드 시작', cardId: nowCard.id }]
            : [{ kind: 'say', label: '고마워!' }],
        }),
      )
      return
    }
    const now = Date.now()
    plan.replaceCardIds.forEach(deleteCard)
    const newCards = planToCards(plan, now)
    newCards.forEach(addCard)
    const lines = [`카드 ${newCards.length}장을 달력에 넣었어. 시간 되면 내가 알려 줄게!`]
    // 학생이 알려 준 시험 · 대회 날까지의 계획이면 그 날을 홈 일정에 D-day 로 넣습니다.
    if (plan.kind === 'long' && plan.spec && plan.isEventDate) {
      const name = plan.spec.goal.slice(0, FOCUS_NAME_MAX)
      saveMyEvent({ name, date: plan.spec.endDate, kind: 'focus' })
      lines.push(`📅 '${name}' D-day 도 홈 일정에 넣었어.`)
    }
    // 오늘 카드가 생겼으면 미션 ② "코치와 오늘 계획 정하기" 가 끝납니다.
    const nextMissions = loadDailyMissions(todayKey)
    if (countDoneMissions(nextMissions) > countDoneMissions(missions)) {
      lines.push(`✅ 오늘의 미션 ${countDoneMissions(nextMissions)}/${nextMissions.length} 끝!`)
    }
    setMissions(nextMissions)
    const firstToday = newCards
      .filter((card) => card.date === todayKey)
      .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))[0]
    const chips: CoachChip[] = firstToday
      ? [
          { kind: 'startCard', label: '▷ 오늘 첫 카드 시작', cardId: firstToday.id },
          { kind: 'say', label: '고마워!' },
        ]
      : [{ kind: 'say', label: '고마워!' }]
    setThread(withBubble(withAnswer, { speaker: 'ai', text: lines.join('\n'), chips }))
  }

  /** [나중에 할래] — 계획을 저장하지 않고 닫습니다. 그다음 말은 다시 AI 코치와의 대화가 됩니다. */
  function handleClosePlan(bubble: ThreadBubble) {
    if (isBusy) return
    setIsPickingTime(false)
    const closed = withPlanStatus(thread, (item) => (item.id === bubble.id ? 'closed' : null))
    const withAnswer = withBubble(closed, { speaker: 'me', text: '나중에 할래' })
    setThread(
      withBubble(withAnswer, { speaker: 'ai', text: '알겠어. 계획은 언제든 다시 짜 줄게.' }),
    )
  }

  /** 시각 고르기 칸에서 [바꾸기] 를 누르면 그 시각으로 고쳐 달라고 합니다. */
  function handlePickTime(event: FormEvent) {
    event.preventDefault()
    if (!openPlanBubble || pickedTime === '') return
    revisePlan(openPlanBubble, `시작 시각을 ${pickedTime}로 바꿔 줘`)
    setPickedTime('')
  }

  // ---- 문제 말풍선 ----

  /** 확인 문제를 내 달라고 합니다. myText 가 있으면 그 말을 내 말풍선으로 먼저 붙입니다. */
  function startQuiz(input: QuizInput, myText: string | null) {
    if (isBusy) return
    if (myText) setThread((current) => withBubble(current, { speaker: 'me', text: myText }))
    quizTalk.mutate(input)
  }

  /** 확인 문제 칸을 엽니다. 코치가 무엇을 고르면 되는지 한 줄로 알려 줍니다. */
  function openQuizForm(prefill: Partial<QuizForm>, myText: string) {
    setIsMaterialOpen(false)
    setQuizForm({ topic: '', cardId: null, checklist: [], material: '', photo: null, ...prefill })
    const withAnswer = withBubble(thread, { speaker: 'me', text: myText })
    setThread(
      withBubble(withAnswer, {
        speaker: 'ai',
        text: prefill.photo
          ? '사진으로 문제 낼게! 무슨 과목 · 단원인지 적어 주면 더 잘 맞춰 낼 수 있어.'
          : '뭘 확인해 볼까? 오늘 카드를 고르거나 주제를 적어 줘. 교과서 · 필기 사진을 넣으면 그 내용으로 낼게.',
      }),
    )
  }

  /** 확인 문제 칸에서 사진을 고르면 줄여서 이 화면의 기억에만 둡니다. (저장하지 않음) */
  async function handleQuizPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // 같은 사진을 다시 골라도 다시 읽게 비워 둡니다.
    event.target.value = ''
    if (!file) return
    setPhotoError(null)
    try {
      const photo = await shrinkPhoto(file)
      setQuizForm((current) => (current ? { ...current, photo } : current))
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : '사진을 읽지 못했어요.')
    }
  }

  // 주제를 적었거나 사진을 넣었으면 문제를 낼 수 있습니다. (사진만 있으면 '사진 속 공부 내용')
  const isQuizFormReady =
    quizForm !== null && (quizForm.topic.trim() !== '' || quizForm.photo !== null)

  /** 확인 문제 칸에서 [문제 내 줘] 를 누르면: 고른 것을 내 말풍선으로 붙이고 문제를 내 달라고 합니다. */
  function handleQuizSubmit(event: FormEvent) {
    event.preventDefault()
    if (!quizForm || !isQuizFormReady) return
    const topic = (quizForm.topic.trim() || PHOTO_QUIZ_TOPIC).slice(0, MAX_QUIZ_TOPIC_LENGTH)
    const material = quizForm.material.trim()
    const extras = [quizForm.photo ? '📎 사진 1장' : null, material ? '📄 글' : null].filter(
      Boolean,
    )
    const myText = `📝 ${topic} 문제 내 줘${extras.length > 0 ? ` · ${extras.join(' · ')}` : ''}`
    startQuiz(
      {
        topic,
        checklist: quizForm.checklist,
        material: material === '' ? null : material.slice(0, MAX_QUIZ_MATERIAL_LENGTH),
        image: quizForm.photo,
        cardId: quizForm.cardId,
      },
      myText,
    )
    setQuizForm(null)
  }

  /**
   * 문제 말풍선의 문제를 바꿉니다. 다 풀어서 처음 '끝(done)' 이 되는 순간에 결과를 이 기기에 남깁니다.
   * (학생이 누를 때만 바뀌어서, 결과는 한 번만 남습니다)
   */
  function changeQuiz(bubbleId: number, change: (quiz: CoachQuiz) => CoachQuiz) {
    const before = thread.bubbles.find((bubble) => bubble.id === bubbleId)?.quiz
    if (!before) return
    const after = change(before)
    if (before.status !== 'done' && after.status === 'done') {
      const now = Date.now()
      saveQuizResult(toQuizResult(after, now, toDayKey(now)))
    }
    setThread((current) => withQuiz(current, bubbleId, () => after))
  }

  /** [틀린 것 다시 보기] — 그 문제 말풍선에서 틀린 문제만 다시 냅니다. (서버를 부르지 않음) */
  function handleReviewWrong(bubble: ThreadBubble) {
    const quiz = bubble.quiz
    if (!quiz || isBusy) return
    const wrong = wrongQuestionsOf(quiz)
    if (wrong.length === 0) return
    const withAnswer = withBubble(thread, { speaker: 'me', text: '틀린 것 다시 볼래' })
    setThread(
      withNewQuiz(
        withAnswer,
        `틀린 ${wrong.length}문제 다시 풀어 보자. 이번엔 해설을 떠올리면서!`,
        {
          topic: quiz.topic,
          cardId: quiz.cardId,
          questions: wrong,
          isDemo: quiz.isDemo,
        },
      ),
    )
  }

  /**
   * [📝 틀린 문제 다시] — 틀린 문제를 다시 냅니다. (이 기기의 결과에서 꺼냄, 서버를 부르지 않음)
   * daysAgo 가 없으면 어제 것, 있으면 그 날들의 것 (복습 알림: 1 · 3 · 7일 전, lib/coachNudges.ts)
   */
  function startReview(label: string, daysAgo?: number[]) {
    const isYesterday = !daysAgo || (daysAgo.length === 1 && daysAgo[0] === 1)
    const days = (daysAgo ?? [1]).filter((day) => Number.isInteger(day) && day > 0)
    const wrong = wrongForReview(loadQuizResults(), todayKey, days).slice(0, 5)
    const when = isYesterday ? '어제' : `${daysAgoText(days)}에`
    const withAnswer = withBubble(thread, { speaker: 'me', text: label })
    if (wrong.length === 0) {
      setThread(
        withBubble(withAnswer, {
          speaker: 'ai',
          text: `${when} 틀린 문제는 이미 다 다시 풀었어. 오늘 공부한 걸로 새로 내 볼까?`,
          chips: [QUIZ_CHIP],
        }),
      )
      return
    }
    setThread(
      withNewQuiz(withAnswer, `${when} 틀린 ${wrong.length}문제야. 이번엔 맞혀 보자!`, {
        topic: `${when} 틀린 문제`,
        cardId: null,
        questions: wrong,
        isDemo: false,
      }),
    )
  }

  /** 입력창의 📎 로 사진을 고르면 줄여서 기억해 두고, 문제 · 계획 중 무엇에 쓸지 묻습니다. (저장하지 않음) */
  async function handleChatPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setChatPhotoError(null)
    try {
      setChatPhoto(await shrinkPhoto(file))
    } catch (error) {
      setChatPhotoError(error instanceof Error ? error.message : '사진을 읽지 못했어요.')
    }
  }

  /** 📎 사진 → [📝 이걸로 문제 내기] */
  function handlePhotoQuiz() {
    if (!chatPhoto || isBusy) return
    setLongForm(null)
    openQuizForm({ photo: chatPhoto }, '📎 이 사진으로 문제 내 줘')
    setChatPhoto(null)
  }

  /** 📎 사진 → [📅 이걸로 계획 짜기] (긴 계획 칸에 사진을 넣어 엽니다) */
  function handlePhotoPlan() {
    if (!chatPhoto || isBusy) return
    setQuizForm(null)
    openLongForm(suggestedGoal(), '📎 이 사진으로 계획 짜 줘', null, chatPhoto)
    setChatPhoto(null)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    sendText(draft)
    setDraft('')
  }

  /**
   * 입력칸의 Enter: Enter = 보내기, Shift+Enter = 줄바꿈 (사용자 요청 2026-10-18, 휴대폰도 같게 2026-10-19)
   * - 한글은 글자를 조합하는 중에도 Enter 가 한 번 들어옵니다. 조합 중에 보내면 마지막 글자가 따로 한 번 더 보내져서,
   *   조합이 끝난 Enter 에만 보냅니다. (components/ui/SchoolField.tsx 와 같은 방식)
   * - 휴대폰(터치 키보드)도 Enter 가 보내기입니다. 터치 키보드에는 Shift+Enter 가 없어서 휴대폰에서는 줄바꿈을 할 수 없습니다.
   */
  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (isBusy || (draft.trim() === '' && attachedPhoto === null)) return
    sendText(draft)
    setDraft('')
  }

  /** 칩을 누르면: 말 칩은 그 말을 보내고, 행동 칩은 그 일을 합니다. (누를 때만 실행) */
  function handleChip(chip: CoachChip) {
    // 계획 이야기는 계획 방에서 합니다. 다른 방에서 누르면 계획 방으로 넘어가서 그 칩을 대신 눌러 줍니다.
    if (!roomInfo.isPlanner && isPlanChip(chip)) {
      navigate(handOffPlanChip(chip))
      return
    }
    if (chip.kind === 'pickPhoto') {
      // 📎 사진 고르기 창을 엽니다. (고른 뒤 물어볼지 · 문제 · 계획 중 고름)
      photoInputRef.current?.click()
      return
    }
    if (chip.kind === 'reviewTalk') {
      startReviewTalk(chip.sessionId)
      return
    }
    // 계획 방의 목표 대화 칩 (진짜 로그인만. 테스트 로그인은 아래 'say' 로 시연용 답을 받습니다)
    if (chip.kind === 'say' && roomInfo.isPlanner && isServerData) {
      if (chip.label === GOAL_CHAT_LABEL) {
        startGoalChat()
        return
      }
      if (chip.label === GOAL_FINISH_LABEL) {
        finishGoal()
        return
      }
      if (chip.label === GOAL_STOP_LABEL) {
        stopGoal()
        return
      }
    }
    if (chip.kind === 'say' && chip.label === GOAL_OPEN_FORM_LABEL) {
      navigate('/goals/new?step=plan')
      return
    }
    if (chip.kind === 'say') {
      sendText(chip.label)
      return
    }
    if (chip.kind === 'notifySettings') {
      // [✅ 바꿀게] 를 누르면 그제야 이 기기의 설정에 저장하고, 무엇을 바꿨는지 코치가 한 줄로 알려 줍니다.
      const withAnswer = withBubble(thread, { speaker: 'me', text: chip.label })
      if (chip.change === null) {
        setThread(withBubble(withAnswer, { speaker: 'ai', text: '알겠어, 그대로 둘게.' }))
        return
      }
      const rows = getNotifyChangeRows(chip.change, loadTalkableSettings())
      applyNotifyChange(chip.change)
      setThread(
        withBubble(withAnswer, {
          speaker: 'ai',
          text: rows.length > 0 ? notifyDoneText(rows) : '이미 그렇게 돼 있어.',
        }),
      )
      return
    }
    if (chip.kind === 'checkIn') {
      // 오늘의 체크인으로 저장하고(서버로도), 그 말을 보내서 AI 와 이야기를 이어 갑니다. (미션 ① 끝)
      const checkIn = saveQuickCheckIn(chip.condition, chip.emotions)
      if (sendCheckIn.canSync) sendCheckIn.mutate(checkIn, { onSuccess: saveLocalCheckIn })
      setMissions(loadDailyMissions(todayKey))
      // 준비하는 것을 아직 모르면 AI 에 보내기 전에 한 번 묻습니다. (코드가 묻고, 고르면 그때 AI 와 이어 감)
      if (loadStudyFocus() === null) {
        const question = buildFocusQuestion()
        const withAnswer = withBubble(thread, { speaker: 'me', text: chip.label })
        setThread(
          withBubble(withAnswer, { speaker: 'ai', text: question.text, chips: question.chips }),
        )
        return
      }
      sendText(chip.label)
      return
    }
    if (chip.kind === 'focus') {
      // 준비하는 것은 오늘 계획을 짤 때의 재료입니다. (lib/studyFocus.ts)
      saveStudyFocus({ kind: chip.focus, name: null })
      // 대회 · 기타는 이름 한 줄(그다음 날짜)을 더 묻습니다. 내신 · 수능은 바로 반응합니다.
      if (needsFocusName(chip.focus)) {
        setFocusStep('name')
        const question = buildFocusNameQuestion(chip.focus)
        const withAnswer = withBubble(thread, { speaker: 'me', text: chip.label })
        setThread(
          withBubble(withAnswer, { speaker: 'ai', text: question.text, chips: question.chips }),
        )
        return
      }
      if (isServerData) {
        sendText(chip.label)
        return
      }
      const reaction = focusReactionNow()
      const withAnswer = withBubble(thread, { speaker: 'me', text: chip.label })
      setThread(
        reaction
          ? withBubble(withAnswer, { speaker: 'ai', text: reaction.text, chips: reaction.chips })
          : withAnswer,
      )
      return
    }
    if (chip.kind === 'pickDate') {
      setIsPickingDate(true)
      return
    }
    if (chip.kind === 'photoCards') {
      navigate('/cards/photo')
      return
    }
    if (chip.kind === 'dayPlan') {
      const date = chip.tomorrow ? moveDateKey(todayKey, 1) : undefined
      // 계획 방에서 오늘 나눈 말을 같이 보내서, 채팅에서 말한 것이 계획에 들어가게 합니다. (#695)
      const talkLines = planTalkLines(thread.bubbles, todayKey)
      startPlan(
        { type: 'day', light: chip.light === true, date, planTalkLines: talkLines },
        chip.label,
      )
      return
    }
    if (chip.kind === 'longPlan') {
      if (!isBusy) openLongForm(suggestedGoal(), chip.label)
      return
    }
    if (chip.kind === 'quiz') {
      if (isBusy) return
      // 카드로 내는 칩(공부 끝 회고)이면 바로 내고, 아니면 주제를 고르는 칸을 엽니다.
      if (chip.topic) {
        startQuiz(
          {
            topic: chip.topic,
            checklist: chip.checklist ?? [],
            material: null,
            image: null,
            cardId: chip.cardId ?? null,
          },
          chip.label,
        )
      } else {
        openQuizForm({}, chip.label)
      }
      return
    }
    if (chip.kind === 'quizReview') {
      if (!isBusy) startReview(chip.label, chip.daysAgo)
      return
    }
    if (chip.kind === 'makePlan') {
      if (isBusy) return
      // AI 가 알아들은 날짜가 짤 수 있는 범위(내일 ~ 30일 뒤)면 바로 짜고, 아니면 목표를 채운 칸을 열어 날짜를 고르게 합니다.
      const goal = chip.goal.slice(0, MAX_PLAN_TEXT_LENGTH)
      if (chip.endDate && chip.endDate >= longMinDate && chip.endDate <= longMaxDate) {
        startPlan(
          {
            type: 'long',
            input: {
              goal,
              endDate: chip.endDate,
              dailyMinutes: DEFAULT_DAILY_MINUTES,
              image: null,
              focus: loadStudyFocus(),
              // 학생이 채팅에서 말한 시험 · 대회 날이라 저장할 때 홈 일정에 넣습니다.
              isEventDate: true,
            },
            notice: null,
          },
          chip.label,
        )
      } else {
        openLongForm(goal, chip.label)
      }
      return
    }
    if (chip.kind === 'checkCall') {
      // 통화 화면이 오늘 끝낸 공부를 확인합니다. 방금 공부한 기록은 거기서 바로 서버로 보냅니다. (lib/checkCall.ts)
      navigate('/call')
      return
    }
    if (chip.kind === 'startCard') {
      navigate(`/timer?card=${encodeURIComponent(chip.cardId)}`)
      return
    }
    if (chip.kind === 'startMinutes') {
      // 정한 길이의 즉석 카드를 만들어 그 카드로 바로 시작합니다. (addCard 는 바로 저장해서 카드가 남습니다)
      const card = createInstantCardNow(todayKey, chip.minutes)
      addCard(card)
      navigate(`/timer?card=${encodeURIComponent(card.id)}`)
      return
    }
    if (chip.kind === 'startTitled') {
      // 제목을 붙인 카드(예: '미적분Ⅰ 복습' 10분)를 만들어 바로 시작합니다.
      const card = createInstantCardNow(todayKey, chip.minutes)
      addCard({
        ...card,
        title: chip.title,
        checklist: [{ id: `${card.id}-item-0`, text: chip.title }],
      })
      navigate(`/timer?card=${encodeURIComponent(card.id)}`)
      return
    }
    navigate(`/cards/new?date=${todayKey}`)
  }

  // ---- 대화방 3개 · [이야기하기] (#582) ----

  /** 공부 끝 회고의 [💬 후기 나누기] — 그 공부의 사실 줄로 후기 대화를 엽니다. (?talk= 로 같은 방이 다시 받음) */
  function startReviewTalk(sessionId: string) {
    if (isBusy) return
    const session = loadStudySessions().find((item) => item.id === sessionId)
    if (!session) return
    const phone = loadPhoneLift(session.id)
    navigate(
      startTalk({
        about: {
          kind: 'SESSION_REVIEW',
          lines: sessionReviewLines({
            session,
            card: cards.find((card) => card.id === session.cardId),
            focus: loadFocusScore(session.id),
            phoneText: phone ? formatPhoneSummary(phone) : null,
          }),
        },
        label: '💬 방금 공부 후기 나눌래',
        target: { type: 'session', sessionId: session.id },
      }),
    )
  }

  /** [＋ 새 대화] — 지금 서버 세션을 정리하고 "새 대화" 구분선 아래에서 방의 첫 인사로 다시 시작합니다. */
  function handleNewChat() {
    if (isBusy) return
    const lines = sessionLines(thread)
    if (thread.chatId !== null && isServerData && hasStudentLine(lines)) {
      finishQuietly(thread.chatId, lines)
    }
    let next = closeOpenQuizzes(
      withPlanStatus(thread, (bubble) => (bubble.plan?.status === 'open' ? 'closed' : null)),
    )
    next = withBubble(next, { speaker: 'ai', text: '새 대화', isDivider: true })
    next = withBubble(next, {
      speaker: 'ai',
      text: roomInfo.greeting.text,
      chips: roomInfo.greeting.chips,
    })
    // 방의 첫 인사부터가 새 서버 세션의 대화입니다. (주제도 없앰)
    setThread({
      ...next,
      chatId: null,
      lastServerAt: null,
      sessionFrom: next.bubbles[next.bubbles.length - 1].id,
      topic: null,
    })
    setFocusStep(null)
    setLongForm(null)
    setQuizForm(null)
    setIsPickingTime(false)
    setAttachedPhoto(null)
  }

  /** "이유: … — 맞아?" 에서 [맞아] · 고친 뒤 [저장] — 그 공부 기록 · 그 카드 하루치에 이유를 저장합니다. */
  function saveReasons(bubble: ThreadBubble, values: string[]) {
    const check = bubble.reasonCheck
    if (!check) return
    const target = check.target
    if (target.type === 'session') {
      const reasons = toShortfallReasons(values)
      const session = loadAllSessions().find((item) => item.id === target.sessionId)
      if (reasons.length === 0 || !session) return
      // 서버 칸은 하나라서 대표 이유(shortfallReason)만 서버로 갑니다. 이 기기에는 모두(shortfallReasons) 남깁니다. (#562)
      updateSession(session.id, {
        endReport: {
          ...(session.endReport ?? { checked: {} }),
          shortfallReason: reasons[0],
          shortfallReasons: reasons,
        },
      })
    } else {
      const causes = toFailCauses(values)
      if (causes.length === 0) return
      // 카드의 [코치랑 이야기하기] 로 왔으면 아직 실패로 기록하지 않았습니다. 확인받은 원인으로 이제 기록합니다. (#400)
      addCardMark({
        cardId: target.cardId,
        dateKey: target.dateKey,
        mark: 'failed',
        cause: causes[0],
        causes,
      })
    }
    setThread((current) =>
      withReasonCheck(current, bubble.id, (item) => ({ ...item, values, status: 'saved' })),
    )
  }

  /** 이유 확인 칸의 상태만 바꿉니다. ([고칠래] → 칩으로 고르기 · [넘어갈래]) */
  function changeReasonCheck(bubbleId: number, change: (check: ReasonCheck) => ReasonCheck) {
    setThread((current) => withReasonCheck(current, bubbleId, change))
  }

  /** 문제 결과의 [📚 과목 쌤한테 물어보기] — 틀린 문제를 들고 과목 쌤 방에서 새 대화를 엽니다. */
  function handleAskTutor(bubble: ThreadBubble) {
    const quiz = bubble.quiz
    if (!quiz || isBusy) return
    const wrong = quiz.questions
      .map((question, index) => ({ question, answer: quiz.answers[index] }))
      .filter(({ question, answer }) => answer && answer.choiceIndex !== question.answerIndex)
    if (wrong.length === 0) return
    navigate(
      startTalk({
        about: { kind: 'QUIZ_WRONG', lines: quizWrongLines(quiz.topic, wrong) },
        label: `📚 '${quiz.topic}' 틀린 문제 물어볼래`,
        target: null,
      }),
    )
  }

  /** 📎 사진 → [💬 이 사진으로 물어보기] (다음에 보내는 말에 붙여서 보냄) */
  function handlePhotoAsk() {
    if (!chatPhoto || isBusy) return
    setAttachedPhoto(chatPhoto)
    setChatPhoto(null)
  }

  /** 날짜 고르기 칸에서 [넣기] 를 누르면: 내 일정으로 저장하고, 그 날짜를 내 말로 보냅니다. */
  function handlePickDate(event: FormEvent) {
    event.preventDefault()
    if (pickedDate === '' || pickedDate < todayKey) return
    const focus = loadStudyFocus()
    saveMyEvent({
      name: focus?.name ?? focusLabelOf(focus?.kind ?? 'OTHER'),
      date: pickedDate,
      kind: 'focus',
    })
    const [, month, day] = pickedDate.split('-').map(Number)
    setPickedDate('')
    sendText(`📅 ${month}월 ${day}일`)
  }

  /** 미션 줄을 누르면 코치가 오늘의 미션을 보여 주고 다음 미션을 권합니다. */
  function handleShowMissions() {
    if (isBusy) return
    const message = buildMissionBriefing(missions, null, nowCard)
    setThread(withBubble(thread, { speaker: 'ai', text: message.text, chips: message.chips }))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center gap-2">
        {/* 오늘의 미션은 매일 코치 방에만 보입니다. */}
        {isDailyCoach && (
          <MissionBar missions={missions} onOpen={handleShowMissions} className="min-w-0 flex-1" />
        )}
        <button
          type="button"
          disabled={isBusy}
          onClick={handleNewChat}
          className={cn(chipClass, 'ml-auto disabled:opacity-40')}
        >
          ＋ 새 대화
        </button>
      </div>
      {/* role="log": 새 말이 생기면 화면을 읽어 주는 프로그램이 알려 줍니다.
          글자가 나오는 중에 목록을 누르면 남은 글이 바로 다 보입니다. (건너뛰기) */}
      <div
        ref={listRef}
        role="log"
        aria-label={`${roomInfo.name}와의 대화`}
        onClick={() => isRevealing && setSkipBefore(Date.now())}
        className="min-h-0 flex-1 overflow-y-auto rounded-3xl bg-white p-4"
      >
        <ul className="flex flex-col gap-3">
          {bubbles.map((bubble, index) => {
            // 날이 바뀌는 곳에 날짜 구분선을 그립니다. (하루의 기준은 새벽 4시)
            const previous = bubbles[index - 1]
            const isNewDay = !previous || toDayKey(previous.at) !== toDayKey(bubble.at)
            // 글자가 나오는 중이면 시간표, 다 나왔으면 null. 칩 · 계획 · 문제 · 이유 확인은 다 나온 뒤에 보입니다.
            const reveal = revealOf(bubble)
            return (
              <Fragment key={bubble.id}>
                {isNewDay && (
                  <li aria-hidden className="flex justify-center py-1">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
                      {dayLabel(bubble.at)}
                    </span>
                  </li>
                )}
                {bubble.isDivider ? (
                  // [새 대화] · [이야기하기] 로 새 서버 세션을 연 곳의 구분선
                  <li className="flex items-center gap-2 py-1" aria-label="새 대화">
                    <span aria-hidden className="h-px flex-1 bg-slate-200" />
                    <span className="text-xs font-medium text-slate-400">새 대화</span>
                    <span aria-hidden className="h-px flex-1 bg-slate-200" />
                  </li>
                ) : bubble.speaker === 'ai' ? (
                  <li className="flex flex-col gap-2">
                    <ReplyParts
                      bubble={bubble}
                      reveal={reveal}
                      roomName={roomInfo.name}
                      roomEmoji={roomInfo.emoji}
                    />
                    {!reveal && bubble.sources && <SourceLinks sources={bubble.sources} />}
                    {!reveal && bubble.reasonCheck && (
                      <ReasonCheckBox
                        check={bubble.reasonCheck}
                        onConfirm={() => saveReasons(bubble, bubble.reasonCheck?.values ?? [])}
                        onEdit={() =>
                          changeReasonCheck(bubble.id, (check) => ({ ...check, status: 'editing' }))
                        }
                        onSave={(values) => saveReasons(bubble, values)}
                        onDismiss={() =>
                          changeReasonCheck(bubble.id, (check) => ({
                            ...check,
                            status: 'dismissed',
                          }))
                        }
                      />
                    )}
                    {!reveal && bubble.plan && <PlanCard plan={bubble.plan} />}
                    {!reveal && bubble.quiz && (
                      <QuizCard
                        quiz={bubble.quiz}
                        isLatest={bubble.id === latestQuizId}
                        onAnswer={(choiceIndex) =>
                          changeQuiz(bubble.id, (quiz) => answerQuiz(quiz, choiceIndex, Date.now()))
                        }
                        onNext={() =>
                          changeQuiz(bubble.id, (quiz) => nextQuizStep(quiz, Date.now()))
                        }
                        onRetry={() =>
                          changeQuiz(bubble.id, (quiz) => retryOneQuestion(quiz, Date.now()))
                        }
                        onKeepResult={() =>
                          changeQuiz(bubble.id, (quiz) => ({ ...quiz, status: 'done' }))
                        }
                        onReviewWrong={() => handleReviewWrong(bubble)}
                        onAskTutor={() => handleAskTutor(bubble)}
                        onOtherTopic={() => !isBusy && openQuizForm({}, '다른 주제로 낼래')}
                      />
                    )}
                    {/* 칩은 가장 마지막 코치 말풍선 아래에만 보입니다. 답을 받는 중에는 숨깁니다.
                        계획을 고치는 중이면 그 계획의 칩([이대로 할게] · [줄여 줘] …)을 보여 줍니다.
                        문제를 푸는 중이면 문제 말풍선 안의 버튼만 씁니다. */}
                    {bubble === lastBubble &&
                      !isBusy &&
                      !reveal &&
                      !isQuizActive(bubble.quiz) &&
                      (openPlanBubble?.plan ? (
                        <PlanChips
                          bubble={openPlanBubble}
                          plan={openPlanBubble.plan}
                          onAccept={handleAcceptPlan}
                          onRevise={revisePlan}
                          onPickTime={setIsPickingTime}
                          onClose={handleClosePlan}
                        />
                      ) : (
                        bubble.chips && <ChipRow chips={bubble.chips} onPick={handleChip} />
                      ))}
                  </li>
                ) : (
                  <li className="flex justify-end">
                    {/* max-w-[80%] + break-words: 긴 말풍선도 화면 폭을 넘지 않고 안에서 줄바꿈됩니다. */}
                    <p className="bg-brand max-w-[80%] rounded-[20px] px-4 py-2.5 text-[15px] break-words whitespace-pre-wrap text-white">
                      {/* 사진은 저장하지 않아서, 보냈다는 표시만 남깁니다. */}
                      {bubble.hasPhoto && (
                        <span className="block text-sm text-white/80">📎 사진 1장</span>
                      )}
                      {bubble.text}
                    </p>
                  </li>
                )}
              </Fragment>
            )
          })}
          {(talk.isPending ||
            topicTalk.isPending ||
            settingsTalk.isPending ||
            goalTalk.isPending) && (
            <li>
              <TypingBubble
                roomName={roomInfo.name}
                roomEmoji={roomInfo.emoji}
                label={talk.variables?.image ? '사진을 보고 쓰는 중' : '쓰는 중'}
              />
            </li>
          )}
          {goalFinish.isPending && (
            <li>
              <CoachBubble
                name={roomInfo.name}
                emoji={roomInfo.emoji}
                text="목표를 정리하는 중…"
                isStatus
              />
            </li>
          )}
          {planTalk.isPending && (
            <li>
              <CoachBubble
                name={roomInfo.name}
                emoji={roomInfo.emoji}
                text={
                  planTalk.variables?.type === 'long' && planTalk.variables.input.image
                    ? '사진을 읽고 계획 짜는 중…'
                    : '계획 짜는 중…'
                }
                isStatus
              />
            </li>
          )}
          {quizTalk.isPending && (
            <li>
              <CoachBubble
                name={roomInfo.name}
                emoji={roomInfo.emoji}
                text={quizTalk.variables?.image ? '사진을 읽고 문제 만드는 중…' : '문제 만드는 중…'}
                isStatus
              />
            </li>
          )}
        </ul>
      </div>

      {/* 대회 · 기타 날짜 고르기 칸. 고르면 내 일정(홈 "다가오는 일정")에 D-day 로 뜹니다. */}
      {isPickingDate && focusStep === 'date' && (
        <form
          onSubmit={handlePickDate}
          className="flex shrink-0 flex-wrap items-center gap-2 rounded-3xl bg-white p-3"
        >
          <label htmlFor="focus-date" className="text-sm font-semibold text-slate-700">
            📅 날짜
          </label>
          <input
            id="focus-date"
            type="date"
            min={todayKey}
            value={pickedDate}
            onChange={(event) => setPickedDate(event.target.value)}
            className="focus:ring-brand/30 h-11 min-w-0 flex-1 rounded-2xl bg-slate-100 px-3 text-base focus:ring-2 focus:outline-none"
          />
          <button
            type="submit"
            disabled={pickedDate === ''}
            className="bg-brand h-11 shrink-0 cursor-pointer rounded-2xl px-4 text-[15px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            넣기
          </button>
        </form>
      )}

      {/* [🕖 시간 바꿔 줘] 를 누르면 여는 시각 고르기 칸. 고르면 그 시각부터로 고쳐 달라고 합니다. */}
      {isPickingTime && openPlanBubble && (
        <form
          onSubmit={handlePickTime}
          className="flex shrink-0 flex-wrap items-center gap-2 rounded-3xl bg-white p-3"
        >
          <label htmlFor="plan-time" className="text-sm font-semibold text-slate-700">
            🕖 몇 시부터?
          </label>
          <input
            id="plan-time"
            type="time"
            value={pickedTime}
            onChange={(event) => setPickedTime(event.target.value)}
            className="focus:ring-brand/30 h-11 min-w-0 flex-1 rounded-2xl bg-slate-100 px-3 text-base focus:ring-2 focus:outline-none"
          />
          <button
            type="submit"
            disabled={pickedTime === '' || isBusy}
            className="bg-brand h-11 shrink-0 cursor-pointer rounded-2xl px-4 text-[15px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            바꾸기
          </button>
        </form>
      )}

      {/* 긴 계획 칸: 무엇을 · 언제까지 · 하루 얼마나 · (선택) 교과서 · 범위 사진 */}
      {longForm !== null && (
        <form
          onSubmit={handleLongSubmit}
          aria-label="시험·대회 계획 짜기"
          className="flex shrink-0 flex-col gap-2 rounded-3xl bg-white p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[15px] font-semibold text-slate-900">📅 시험·대회 계획</p>
            <button
              type="button"
              aria-label="계획 칸 닫기"
              onClick={() => setLongForm(null)}
              className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
            >
              ✕
            </button>
          </div>
          <label htmlFor="long-goal" className="text-sm font-medium text-slate-600">
            뭘 준비해?
          </label>
          <input
            id="long-goal"
            value={longForm.goal}
            maxLength={MAX_PLAN_TEXT_LENGTH}
            onChange={(event) => setLongForm({ ...longForm, goal: event.target.value })}
            placeholder="예: 중간고사 미적분 1~3단원"
            className="focus:ring-brand/30 h-11 w-full min-w-0 rounded-2xl bg-slate-100 px-3 text-base placeholder:text-slate-400 focus:ring-2 focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="long-date" className="text-sm font-medium text-slate-600">
              언제까지?
            </label>
            <input
              id="long-date"
              type="date"
              min={longMinDate}
              max={longMaxDate}
              value={longForm.endDate}
              onChange={(event) => setLongForm({ ...longForm, endDate: event.target.value })}
              className="focus:ring-brand/30 h-11 min-w-0 flex-1 rounded-2xl bg-slate-100 px-3 text-base focus:ring-2 focus:outline-none"
            />
          </div>
          <div
            role="group"
            aria-label="하루 공부 시간"
            className="flex flex-wrap items-center gap-2"
          >
            <span className="text-sm font-medium text-slate-600">하루</span>
            {DAILY_MINUTES_OPTIONS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                aria-pressed={longForm.dailyMinutes === minutes}
                onClick={() => setLongForm({ ...longForm, dailyMinutes: minutes })}
                className={cn(
                  chipClass,
                  'px-3',
                  longForm.dailyMinutes === minutes &&
                    'bg-brand-light text-brand border-transparent font-semibold',
                )}
              >
                {minutes}분
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* 사진은 줄여서 이 화면의 기억에만 둡니다. 계획을 짜는 데만 서버에 보내고 저장하지 않습니다. */}
            <label className={cn(chipClass, 'focus-within:ring-brand/30 focus-within:ring-2')}>
              📎 교과서·범위 사진
              <input type="file" accept="image/*" onChange={handleLongPhoto} className="sr-only" />
            </label>
            {longForm.photo && (
              <span className="flex items-center gap-1">
                <img
                  src={longForm.photo}
                  alt="넣은 사진"
                  className="h-10 w-10 max-w-full rounded-lg object-cover"
                />
                <button
                  type="button"
                  aria-label="사진 빼기"
                  onClick={() => setLongForm({ ...longForm, photo: null })}
                  className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
                >
                  ✕
                </button>
              </span>
            )}
          </div>
          {photoError && (
            <p role="alert" className="text-sm break-keep text-red-600">
              {photoError}
            </p>
          )}
          <button
            type="submit"
            disabled={!isLongFormReady || isBusy}
            className="bg-brand h-11 w-full cursor-pointer rounded-2xl px-4 text-[15px] font-semibold text-white transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            계획 짜 줘
          </button>
          <p className="text-xs break-keep text-slate-400">
            날짜는 내일부터 {MAX_LONG_PLAN_DAYS}일 안으로 골라 줘. 사진은 저장하지 않아.
          </p>
        </form>
      )}

      {/* 확인 문제 칸: 오늘 카드 고르기 또는 주제 적기 · (선택) 글 붙여 넣기 · 교과서 · 필기 사진 */}
      {quizForm !== null && (
        <form
          onSubmit={handleQuizSubmit}
          aria-label="확인 문제 내기"
          className="flex shrink-0 flex-col gap-2 rounded-3xl bg-white p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[15px] font-semibold text-slate-900">📝 확인 문제</p>
            <button
              type="button"
              aria-label="문제 칸 닫기"
              onClick={() => setQuizForm(null)}
              className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
            >
              ✕
            </button>
          </div>
          {quizCardOptions.length > 0 && (
            <div role="group" aria-label="오늘 카드로 내기" className="flex flex-wrap gap-2">
              {quizCardOptions.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  aria-pressed={quizForm.cardId === card.id}
                  onClick={() =>
                    setQuizForm({
                      ...quizForm,
                      topic: card.title,
                      cardId: card.id,
                      checklist: card.checklist
                        .map((item) => item.text)
                        .filter((text) => text.trim() !== ''),
                    })
                  }
                  className={cn(
                    chipClass,
                    'max-w-full',
                    quizForm.cardId === card.id &&
                      'bg-brand-light text-brand border-transparent font-semibold',
                  )}
                >
                  <span className="truncate">{card.title}</span>
                </button>
              ))}
            </div>
          )}
          <label htmlFor="quiz-topic" className="text-sm font-medium text-slate-600">
            {quizCardOptions.length > 0 ? '또는 주제를 적어 줘' : '뭘 확인할까?'}
          </label>
          <input
            id="quiz-topic"
            value={quizForm.topic}
            maxLength={MAX_QUIZ_TOPIC_LENGTH}
            // 직접 고쳐 적으면 카드로 내는 게 아니게 됩니다.
            onChange={(event) =>
              setQuizForm({ ...quizForm, topic: event.target.value, cardId: null, checklist: [] })
            }
            placeholder="예: 미적분 3단원 수열의 극한"
            className="focus:ring-brand/30 h-11 w-full min-w-0 rounded-2xl bg-slate-100 px-3 text-base placeholder:text-slate-400 focus:ring-2 focus:outline-none"
          />
          {isMaterialOpen && (
            <>
              <label htmlFor="quiz-material" className="text-sm font-medium text-slate-600">
                필기 · 교과서 글 (이 안에서만 문제를 내)
              </label>
              <textarea
                id="quiz-material"
                value={quizForm.material}
                maxLength={MAX_QUIZ_MATERIAL_LENGTH}
                rows={3}
                onChange={(event) => setQuizForm({ ...quizForm, material: event.target.value })}
                placeholder="공부한 내용을 붙여 넣어 줘"
                className="focus:ring-brand/30 w-full min-w-0 resize-none rounded-2xl bg-slate-100 px-3 py-2 text-base placeholder:text-slate-400 focus:ring-2 focus:outline-none"
              />
            </>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {!isMaterialOpen && (
              <button type="button" onClick={() => setIsMaterialOpen(true)} className={chipClass}>
                📄 글 붙여 넣기
              </button>
            )}
            {/* 사진은 줄여서 이 화면의 기억에만 둡니다. 문제를 내는 데만 서버에 보내고 저장하지 않습니다. */}
            <label className={cn(chipClass, 'focus-within:ring-brand/30 focus-within:ring-2')}>
              📎 교과서·필기 사진
              <input type="file" accept="image/*" onChange={handleQuizPhoto} className="sr-only" />
            </label>
            {quizForm.photo && (
              <span className="flex items-center gap-1">
                <img
                  src={quizForm.photo}
                  alt="넣은 사진"
                  className="h-10 w-10 max-w-full rounded-lg object-cover"
                />
                <button
                  type="button"
                  aria-label="사진 빼기"
                  onClick={() => setQuizForm({ ...quizForm, photo: null })}
                  className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
                >
                  ✕
                </button>
              </span>
            )}
          </div>
          {photoError && (
            <p role="alert" className="text-sm break-keep text-red-600">
              {photoError}
            </p>
          )}
          <button
            type="submit"
            disabled={!isQuizFormReady || isBusy}
            className="bg-brand h-11 w-full cursor-pointer rounded-2xl px-4 text-[15px] font-semibold text-white transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            문제 내 줘 (3문제)
          </button>
          <p className="text-xs break-keep text-slate-400">
            푼 결과는 이 기기에만 남아. 사진은 저장하지 않아.
          </p>
        </form>
      )}

      {/* 입력창의 📎 로 고른 사진: 문제를 낼지 · 계획을 짤지 고릅니다. (고르기 전에는 아무 데도 보내지 않음) */}
      {chatPhoto && (
        <div
          role="group"
          aria-label="고른 사진으로 할 일"
          className="flex shrink-0 flex-wrap items-center gap-2 rounded-3xl bg-white p-3"
        >
          <img
            src={chatPhoto}
            alt="고른 사진"
            className="h-10 w-10 max-w-full shrink-0 rounded-lg object-cover"
          />
          <p className="min-w-0 flex-1 text-sm break-keep text-slate-600">이 사진으로 뭘 할까?</p>
          <button
            type="button"
            aria-label="사진 빼기"
            onClick={() => setChatPhoto(null)}
            className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
          >
            ✕
          </button>
          <div className="flex w-full flex-wrap gap-2">
            {/* 사진을 붙여서 이 방의 AI 에게 바로 물어봅니다. (과목 쌤: "이 문제 모르겠어") */}
            <button
              type="button"
              disabled={isBusy}
              onClick={handlePhotoAsk}
              className={cn(chipClass, 'bg-brand-light text-brand border-transparent')}
            >
              💬 이 사진으로 물어보기
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={handlePhotoQuiz}
              className={cn(chipClass, 'bg-brand-light text-brand border-transparent')}
            >
              📝 이걸로 문제 내기
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={handlePhotoPlan}
              className={cn(chipClass, 'bg-brand-light text-brand border-transparent')}
            >
              📅 이걸로 계획 짜기
            </button>
          </div>
        </div>
      )}

      {/* 위기 표현이 감지됐을 때 상담 전화 한 줄. 대화는 막지 않습니다. (누르면 바로 전화가 걸립니다) */}
      {thread.isHelpShown && (
        <a
          href={`tel:${YOUTH_HELP_LINE.number}`}
          className="flex min-h-14 shrink-0 items-center gap-3 rounded-3xl bg-white px-4 py-2"
        >
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-50"
          >
            ☎️
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-slate-900">
              {YOUTH_HELP_LINE.name} {YOUTH_HELP_LINE.number}
            </span>
            <span className="block text-sm break-keep text-slate-500">
              지금 이야기할 곳 · {YOUTH_HELP_LINE.detail}
            </span>
          </span>
          <span aria-hidden className="text-slate-400">
            ›
          </span>
        </a>
      )}

      {/* 입력창은 목록 아래에 붙습니다. 하단 탭은 Layout 이 아래 여백(pb-14)으로 비켜 줍니다. */}
      <form
        onSubmit={handleSubmit}
        className="flex shrink-0 flex-col gap-1 rounded-3xl bg-white p-2"
      >
        {talk.isError && (
          <div role="alert" className="flex flex-wrap items-center gap-2 px-2 pt-1">
            <p className="text-sm break-keep text-red-600">{getChatErrorMessage(talk.error)}</p>
            <button
              type="button"
              onClick={() => talk.variables && talk.mutate(talk.variables)}
              className={chipClass}
            >
              다시 보내기
            </button>
          </div>
        )}
        {/* 404(대화 끊김)는 말풍선으로 알려 주므로 여기서는 그 밖의 실패만 보여 줍니다. */}
        {(goalTalk.isError || goalFinish.isError) &&
          !(
            (goalTalk.error ?? goalFinish.error) instanceof ApiError &&
            ((goalTalk.error ?? goalFinish.error) as ApiError).status === 404
          ) && (
            <div role="alert" className="flex flex-wrap items-center gap-2 px-2 pt-1">
              <p className="text-sm break-keep text-red-600">
                목표 대화를 이어 가지 못했어요.{' '}
                {getChatErrorMessage(goalTalk.error ?? goalFinish.error)}
              </p>
              <button
                type="button"
                onClick={() => {
                  if (goalTalk.isError && goalTalk.variables) goalTalk.mutate(goalTalk.variables)
                  else if (goalFinish.variables) goalFinish.mutate(goalFinish.variables)
                }}
                className={chipClass}
              >
                다시 보내기
              </button>
            </div>
          )}
        {planTalk.isError && (
          <div role="alert" className="flex flex-wrap items-center gap-2 px-2 pt-1">
            <p className="text-sm break-keep text-red-600">
              계획을 못 짰어요. {getChatErrorMessage(planTalk.error)}
            </p>
            <button
              type="button"
              onClick={() => planTalk.variables && planTalk.mutate(planTalk.variables)}
              className={chipClass}
            >
              다시 보내기
            </button>
          </div>
        )}
        {quizTalk.isError && (
          <div role="alert" className="flex flex-wrap items-center gap-2 px-2 pt-1">
            <p className="text-sm break-keep text-red-600">
              문제를 못 만들었어요. {getChatErrorMessage(quizTalk.error)}
            </p>
            <button
              type="button"
              onClick={() => quizTalk.variables && quizTalk.mutate(quizTalk.variables)}
              className={chipClass}
            >
              다시 보내기
            </button>
          </div>
        )}
        {topicTalk.isError && (
          <div role="alert" className="flex flex-wrap items-center gap-2 px-2 pt-1">
            <p className="text-sm break-keep text-red-600">
              {getChatErrorMessage(topicTalk.error)}
            </p>
            <button
              type="button"
              onClick={() => topicTalk.variables && topicTalk.mutate(topicTalk.variables)}
              className={chipClass}
            >
              다시 보내기
            </button>
          </div>
        )}
        {chatPhotoError && (
          <p role="alert" className="px-2 pt-1 text-sm break-keep text-red-600">
            {chatPhotoError}
          </p>
        )}
        {/* [💬 이 사진으로 물어보기] 로 붙인 사진. 다음 말과 같이 보냅니다. (저장하지 않음) */}
        {attachedPhoto && (
          <div className="flex items-center gap-2 px-2 pt-1">
            <img
              src={attachedPhoto}
              alt="같이 보낼 사진"
              className="h-10 w-10 max-w-full shrink-0 rounded-lg object-cover"
            />
            <p className="min-w-0 flex-1 text-sm break-keep text-slate-600">
              이 사진을 다음 말과 같이 보내요
            </p>
            <button
              type="button"
              aria-label="같이 보낼 사진 빼기"
              onClick={() => setAttachedPhoto(null)}
              className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          {/* 📎 사진 넣기: 물어보기 · 교과서 · 필기 · 시험 범위 사진으로 문제를 내거나 계획을 짭니다. (저장하지 않음) */}
          <label
            aria-label="사진 넣기"
            className={cn(
              'focus-within:ring-brand/30 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-2xl bg-slate-100 text-lg focus-within:ring-2',
              isBusy && 'pointer-events-none opacity-40',
            )}
          >
            📎
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              disabled={isBusy}
              onChange={handleChatPhoto}
              className="sr-only"
            />
          </label>
          <label htmlFor="chat-input" className="sr-only">
            {roomInfo.name}에게 보낼 말
          </label>
          <textarea
            id="chat-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleDraftKeyDown}
            // 키보드가 올라왔을 때 입력창이 가려지지 않게 화면 안으로 끌어옵니다.
            onFocus={(event) => event.currentTarget.scrollIntoView({ block: 'nearest' })}
            maxLength={MAX_CHAT_TEXT_LENGTH}
            rows={1}
            disabled={isBusy}
            // Enter 가 "보내기" 라서 휴대폰 키보드의 Enter 키도 보내기 모양으로 보이게 합니다.
            enterKeyHint="send"
            // 계획을 고치는 중이면 쓰는 말이 고치는 요청이 된다고 알려 줍니다.
            placeholder={
              openPlanBubble
                ? '계획 고칠 곳을 말해 줘'
                : attachedPhoto
                  ? '사진에 대해 물어볼 말 (그냥 보내도 돼)'
                  : roomInfo.placeholder
            }
            // text-base: 아이폰은 16px 보다 작은 입력칸을 누르면 화면을 확대해서 16px 로 둡니다.
            className="focus:ring-brand/30 max-h-32 min-h-11 min-w-0 flex-1 resize-none rounded-2xl bg-slate-100 px-4 py-2.5 text-base placeholder:text-slate-400 focus:ring-2 focus:outline-none"
          />
          <button
            type="submit"
            disabled={(draft.trim() === '' && attachedPhoto === null) || isBusy}
            className="bg-brand h-11 shrink-0 cursor-pointer rounded-2xl px-4 text-[15px] font-semibold text-white transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            보내기
          </button>
        </div>
        {/* PC 에서만 키 안내. 휴대폰 키보드에는 Shift+Enter 가 없어서 안내하지 않습니다. */}
        {!isTouchKeyboard && (
          <p className="px-2 text-xs text-slate-400">Enter 보내기 · Shift+Enter 줄바꿈</p>
        )}
      </form>
    </div>
  )
}

// 작은 칩 버튼: 흰 바탕 + 옅은 테두리, 높이 40px
const chipClass =
  'flex h-10 shrink-0 cursor-pointer items-center gap-1 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-transform active:scale-[0.98]'

interface ChipRowProps {
  chips: CoachChip[]
  onPick: (chip: CoachChip) => void
}

/** 코치 말풍선 바로 아래의 빠른 답 칩 줄. 넘치면 다음 줄로 내려갑니다. 행동 칩은 brand 색으로 구분합니다. */
function ChipRow({ chips, onPick }: ChipRowProps) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {chips.map((chip) => (
        <button
          key={`${chip.kind}-${chip.label}`}
          type="button"
          onClick={() => onPick(chip)}
          className={cn(
            chipClass,
            chip.kind !== 'say' &&
              chip.kind !== 'checkIn' &&
              chip.kind !== 'focus' &&
              'bg-brand-light text-brand border-transparent',
          )}
        >
          {chip.label}
        </button>
      ))}
    </div>
  )
}

interface CoachBubbleProps {
  text: string
  /** 말풍선 위의 방 이름 · 아이콘 (lib/chatRooms.ts) */
  name: string
  emoji: string
  /** false 면 위의 이름 줄을 빼고 말풍선만 그립니다. (한 답을 여러 말풍선으로 나눴을 때 두 번째부터) */
  showName?: boolean
  /** true 면 "쓰는 중…" 처럼 상태를 알리는 말풍선입니다. (화면 읽기 프로그램이 읽어 줌) */
  isStatus?: boolean
  /** true 면 시연용 정해진 답이라고 아래에 붙입니다. */
  isDemo?: boolean
}

/** AI 의 말풍선. 위에 작은 방 이름과 동그란 아이콘을 둡니다. */
function CoachBubble({
  text,
  name,
  emoji,
  showName = true,
  isStatus = false,
  isDemo = false,
}: CoachBubbleProps) {
  return (
    <div className="flex flex-col items-start gap-1">
      {showName && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <span
            aria-hidden
            className="bg-brand-light flex size-6 items-center justify-center rounded-full text-[13px]"
          >
            {emoji}
          </span>
          {name}
        </p>
      )}
      <p
        role={isStatus ? 'status' : undefined}
        className={cn(
          'max-w-[85%] rounded-[20px] bg-slate-100 px-4 py-2.5 text-[15px] break-words whitespace-pre-wrap',
          isStatus ? 'text-slate-500' : 'text-slate-900',
        )}
      >
        {text}
      </p>
      {isDemo && <p className="text-xs text-amber-700">시연용 정해진 답 (AI 아님)</p>}
    </div>
  )
}

/** 글자가 나오는 중인 답 하나 (lib/chatReveal.ts) */
interface ActiveReveal {
  parts: string[]
  schedule: RevealSchedule
  /** 답을 받은 뒤 지난 시간 (밀리초) */
  elapsed: number
}

interface ReplyPartsProps {
  bubble: ThreadBubble
  /** 글자가 나오는 중이면 그 시간표, 다 나왔거나 효과가 없으면 null */
  reveal: ActiveReveal | null
  roomName: string
  roomEmoji: string
}

/**
 * AI 의 답 하나. 방금 받은 답(typing)은 메신저처럼 문장마다 말풍선 2~3개로 나눠 보여 주고,
 * 글자가 나오는 중이면 타자 치듯 보여 줍니다. 다음 말풍선을 기다리는 동안은 "입력 중" 점 세 개가 보입니다.
 */
function ReplyParts({ bubble, reveal, roomName, roomEmoji }: ReplyPartsProps) {
  const parts = bubble.typing ? splitReply(bubble.text) : [bubble.text]
  return (
    <>
      {parts.map((part, index) => {
        const isFirst = index === 0
        const isLast = index === parts.length - 1
        if (!reveal) {
          return (
            <CoachBubble
              key={index}
              name={roomName}
              emoji={roomEmoji}
              text={part}
              showName={isFirst}
              isDemo={isLast && bubble.isDemo}
            />
          )
        }
        const start = reveal.schedule.starts[index]
        if (reveal.elapsed < start) {
          // 아직 차례가 아닌 말풍선: 바로 앞 말풍선이 다 나왔으면 "입력 중" 점을, 아니면 아무것도 그리지 않습니다.
          const previousEnd =
            index > 0 ? reveal.schedule.starts[index - 1] + reveal.schedule.durations[index - 1] : 0
          return reveal.elapsed >= previousEnd ? (
            <TypingBubble
              key={index}
              roomName={roomName}
              roomEmoji={roomEmoji}
              showName={isFirst}
              label="쓰는 중"
            />
          ) : null
        }
        const shown = visibleLength(
          part.length,
          reveal.elapsed - start,
          reveal.schedule.durations[index],
        )
        return (
          <CoachBubble
            key={index}
            name={roomName}
            emoji={roomEmoji}
            text={part.slice(0, Math.max(1, shown))}
            showName={isFirst}
          />
        )
      })}
    </>
  )
}

interface SourceLinksProps {
  sources: ChatSource[]
}

/**
 * 과목 쌤이 웹 검색으로 찾은 출처. 답 아래에 작은 링크로 둡니다. (BE #342)
 * 새 창(탭)으로 열고, 우리 앱 정보를 넘기지 않게 noopener · noreferrer 를 붙입니다.
 */
function SourceLinks({ sources }: SourceLinksProps) {
  return (
    <div className="flex max-w-[85%] flex-wrap items-center gap-1.5">
      <span className="text-xs text-slate-500">출처</span>
      {sources.map((source) => (
        <a
          key={source.url}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          // h-10: 손가락으로 누르기 쉽게 40px. 제목이 길면 말줄임(안쪽 span 의 truncate)
          className="inline-flex h-10 max-w-full min-w-0 items-center rounded-full bg-slate-100 px-3 text-xs text-slate-600 underline-offset-2 hover:underline"
        >
          <span className="truncate">{source.title}</span>
        </a>
      ))}
    </div>
  )
}

interface TypingBubbleProps {
  roomName: string
  roomEmoji: string
  /** 화면 읽기 프로그램이 읽을 글 (예: '쓰는 중') */
  label: string
  showName?: boolean
}

/** "입력 중" 점 세 개 말풍선. 움직임 줄이기를 켠 사람에게는 점이 움직이지 않습니다. (motion-safe) */
function TypingBubble({ roomName, roomEmoji, label, showName = true }: TypingBubbleProps) {
  return (
    <div className="flex flex-col items-start gap-1">
      {showName && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <span
            aria-hidden
            className="bg-brand-light flex size-6 items-center justify-center rounded-full text-[13px]"
          >
            {roomEmoji}
          </span>
          {roomName}
        </p>
      )}
      <p role="status" className="flex h-10 items-center gap-1 rounded-[20px] bg-slate-100 px-4">
        <span className="sr-only">{label}</span>
        <span aria-hidden className="size-2 rounded-full bg-slate-400 motion-safe:animate-bounce" />
        <span
          aria-hidden
          className="size-2 rounded-full bg-slate-400 motion-safe:animate-bounce motion-safe:[animation-delay:150ms]"
        />
        <span
          aria-hidden
          className="size-2 rounded-full bg-slate-400 motion-safe:animate-bounce motion-safe:[animation-delay:300ms]"
        />
      </p>
    </div>
  )
}

interface ReasonCheckBoxProps {
  check: ReasonCheck
  /** [맞아] — AI 가 짐작한 그대로 저장 */
  onConfirm: () => void
  /** [고칠래] — 칩으로 고르기 */
  onEdit: () => void
  /** 칩으로 고른 뒤 [저장] */
  onSave: (values: string[]) => void
  /** [넘어갈래] — 저장하지 않음 */
  onDismiss: () => void
}

/**
 * AI 가 학생 말로 짐작한 이유를 확인받는 칸. "이유: 폰 · 피곤함 — 맞아?" [맞아] [고칠래] [넘어갈래]
 * 학생이 누를 때만 기록에 저장합니다. (AI 가 정한 걸 그대로 남기지 않음)
 */
function ReasonCheckBox({ check, onConfirm, onEdit, onSave, onDismiss }: ReasonCheckBoxProps) {
  const isReview = check.kind === 'SESSION_REVIEW'
  const labels = isReview ? shortfallLabels(check.values) : failCauseLabels(check.values)
  const [picked, setPicked] = useState<string[]>(check.values)

  if (check.status === 'dismissed') return null
  if (check.status === 'saved') {
    return (
      <p className="w-full rounded-[20px] bg-emerald-50 px-3 py-2 text-sm break-keep text-emerald-800 sm:max-w-md">
        ✅ {isReview ? '다 못 한 이유를' : '못 한 원인을'} 기록했어: {labels.join(' · ')}
      </p>
    )
  }
  if (check.status === 'editing') {
    return (
      <div className="flex w-full flex-col gap-2 rounded-[20px] border border-slate-200 bg-white p-3 sm:max-w-md">
        <p className="text-sm font-medium text-slate-800">이유를 골라 줘. 여러 개 골라도 돼.</p>
        {isReview ? (
          <ReasonChips
            options={SHORTFALL_REASONS}
            selected={toShortfallReasons(picked)}
            onToggle={(key) => setPicked((prev) => toggleReason(prev, key))}
            label="다 못 한 이유"
          />
        ) : (
          <ReasonChips
            options={CARD_FAIL_CAUSES}
            selected={toFailCauses(picked)}
            onToggle={(key) => setPicked((prev) => toggleReason(prev, key))}
            label="못 한 원인"
          />
        )}
        <button
          type="button"
          disabled={picked.length === 0}
          onClick={() => onSave(picked)}
          className="bg-brand h-10 w-full cursor-pointer rounded-2xl px-4 text-[15px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          저장
        </button>
      </div>
    )
  }
  return (
    <div className="flex w-full flex-col gap-2 rounded-[20px] border border-slate-200 bg-white p-3 sm:max-w-md">
      <p className="text-[15px] break-keep text-slate-800">
        이유: <span className="font-semibold">{labels.join(' · ')}</span> — 맞아?
      </p>
      {/* 세 버튼은 같은 모양 · 같은 크기 (어느 쪽으로도 몰지 않음) */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className={cn(chipClass, 'flex-1 justify-center')}
        >
          맞아
        </button>
        <button type="button" onClick={onEdit} className={cn(chipClass, 'flex-1 justify-center')}>
          고칠래
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className={cn(chipClass, 'flex-1 justify-center')}
        >
          넘어갈래
        </button>
      </div>
    </div>
  )
}

/** 움직임 줄이기(prefers-reduced-motion)를 켰는지. 켰으면 타자 효과를 끕니다. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  )
}

/**
 * 손가락으로 누르는 화면(휴대폰 · 태블릿)인지. 이런 화면의 터치 키보드에는 Shift 가 없어서,
 * Enter 를 "보내기" 로 바꾸면 줄바꿈을 할 수 없게 됩니다. 그래서 휴대폰은 Enter = 줄바꿈, 보내기는 버튼입니다.
 */
function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true
}

// ---- 계획 말풍선 ----
// 계획 카드(PlanCard)는 AI 통화 화면에서도 써서 components/ui/PlanCard.tsx 에 있습니다. 칩은 코치 화면에서만 씁니다.

interface PlanChipsProps {
  /** 계획이 붙은 말풍선 */
  bubble: ThreadBubble
  plan: CoachPlan
  onAccept: (bubble: ThreadBubble) => void
  /** 칩 글자를 그대로 고치는 요청으로 보냅니다. */
  onRevise: (bubble: ThreadBubble, request: string) => void
  /** 시각 고르기 칸을 엽니다. (true) */
  onPickTime: (isOpen: boolean) => void
  onClose: (bubble: ThreadBubble) => void
}

/** 고치는 중인 계획의 칩: [이대로 할게] · [줄여 줘] · [주말은 빼 줘] · [시간 바꿔 줘] · [나중에 할래] */
function PlanChips({ bubble, plan, onAccept, onRevise, onPickTime, onClose }: PlanChipsProps) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onAccept(bubble)}
        className={cn(chipClass, 'bg-brand border-transparent font-semibold text-white')}
      >
        ✅ 이대로 할게
      </button>
      {planReviseLabels(plan).map((label) => (
        <button
          key={label}
          type="button"
          onClick={() => onRevise(bubble, label)}
          className={chipClass}
        >
          {label}
        </button>
      ))}
      <button type="button" onClick={() => onPickTime(true)} className={chipClass}>
        🕖 시간 바꿔 줘
      </button>
      <button type="button" onClick={() => onClose(bubble)} className={chipClass}>
        나중에 할래
      </button>
    </div>
  )
}

// ---- 문제 말풍선 ----
// 지금은 코치 화면에서만 써서 이 파일에 둡니다. AI 통화 화면에서도 쓰게 되면 components/ui/ 로 뺍니다.

/** 푸는 중인 문제인지 (푸는 중 · 찍기 확인 중) */
function isQuizActive(quiz: CoachQuiz | undefined): boolean {
  return quiz !== undefined && (quiz.status === 'open' || quiz.status === 'guessCheck')
}

/** 보기 번호 글자 */
const CHOICE_MARKS = ['①', '②', '③', '④']

interface QuizCardProps {
  quiz: CoachQuiz
  /** true 면 가장 최근 문제 말풍선입니다. 아니면 결과 한 줄로 접습니다. */
  isLatest: boolean
  onAnswer: (choiceIndex: number) => void
  /** [다음] · [결과 보기] */
  onNext: () => void
  /** 찍은 것 같을 때 [다시 풀기] — 한 문제만 다시 */
  onRetry: () => void
  /** 찍은 것 같을 때 [괜찮아] — 그대로 결과 보기 */
  onKeepResult: () => void
  onReviewWrong: () => void
  /** [📚 과목 쌤한테 물어보기] — 틀린 문제를 들고 과목 쌤 방에서 대화 (#582) */
  onAskTutor: () => void
  onOtherTopic: () => void
}

/**
 * 코치 말풍선 아래의 문제 카드. 한 문제씩 보여 주고, 고르면 정답 · 오답 색과 해설을 보여 줍니다.
 * 다 풀면 "3개 중 2개 맞았어" 와 [틀린 것 다시 보기] · [다른 주제로] 를 보여 줍니다.
 */
function QuizCard({
  quiz,
  isLatest,
  onAnswer,
  onNext,
  onRetry,
  onKeepResult,
  onReviewWrong,
  onAskTutor,
  onOtherTopic,
}: QuizCardProps) {
  const total = quiz.questions.length
  const correct = countCorrect(quiz)
  const wrongCount = wrongQuestionsOf(quiz).length
  const isDone = quiz.status === 'done'

  // 지난 문제 말풍선 · 풀다 만 문제는 결과 한 줄로 접습니다.
  if (!isLatest || quiz.status === 'closed') {
    return (
      <p className="mt-2 w-full rounded-[20px] border border-slate-200 bg-white px-3 py-2 text-sm break-words text-slate-500 sm:max-w-md">
        📝 {quiz.topic} · {isDone ? `${total}개 중 ${correct}개 맞음` : '풀다 말았어'}
      </p>
    )
  }

  const question = quiz.questions[quiz.current]
  const answer = quiz.answers[quiz.current]
  const isLastStep = quiz.retryIndex !== null || quiz.current === total - 1

  return (
    <div className="mt-2 w-full rounded-[20px] border border-slate-200 bg-white p-3 sm:max-w-md">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-[15px] font-bold break-words text-slate-900">📝 {quiz.topic}</p>
        {quiz.status === 'open' && (
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 tabular-nums">
            {quiz.current + 1}/{total}
          </span>
        )}
      </div>

      {quiz.status === 'open' && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-[15px] break-words whitespace-pre-wrap text-slate-900">
            {question.question}
          </p>
          <div role="group" aria-label="보기" className="flex flex-col gap-2">
            {question.choices.map((choice, index) => {
              const isAnswer = index === question.answerIndex
              const isPicked = answer?.choiceIndex === index
              return (
                <button
                  key={index}
                  type="button"
                  disabled={answer !== null}
                  onClick={() => onAnswer(index)}
                  className={cn(
                    'flex min-h-10 w-full cursor-pointer items-start gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-left text-[15px] break-words text-slate-800 disabled:cursor-default',
                    // 고른 뒤: 정답은 초록, 내가 고른 오답은 빨강, 나머지는 흐리게
                    answer !== null &&
                      isAnswer &&
                      'border-emerald-300 bg-emerald-50 text-emerald-800',
                    answer !== null &&
                      isPicked &&
                      !isAnswer &&
                      'border-red-300 bg-red-50 text-red-700',
                    answer !== null && !isAnswer && !isPicked && 'opacity-60',
                  )}
                >
                  <span aria-hidden className="shrink-0">
                    {CHOICE_MARKS[index]}
                  </span>
                  <span className="min-w-0 flex-1">{choice}</span>
                </button>
              )
            })}
          </div>
          {answer !== null && (
            <>
              <p
                role="status"
                className={cn(
                  'text-[15px] font-semibold',
                  answer.choiceIndex === question.answerIndex ? 'text-emerald-700' : 'text-red-600',
                )}
              >
                {answer.choiceIndex === question.answerIndex ? '⭕ 맞았어!' : '❌ 아쉽다'}
              </p>
              {question.explanation && (
                <p className="text-sm break-words text-slate-600">{question.explanation}</p>
              )}
              <button
                type="button"
                onClick={onNext}
                className="bg-brand h-10 w-full cursor-pointer rounded-2xl px-4 text-[15px] font-semibold text-white transition-transform active:scale-[0.98]"
              >
                {isLastStep ? '결과 보기' : '다음'}
              </button>
            </>
          )}
        </div>
      )}

      {/* 찍은 것 같을 때: 혼내지 않고 한 문제만 다시 볼지 묻습니다. 두 버튼은 같은 모양 · 같은 크기 */}
      {quiz.status === 'guessCheck' && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-[15px] break-keep text-slate-800">
            찍은 것 같은데? 한 문제만 다시 볼까?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onRetry}
              className={cn(chipClass, 'flex-1 justify-center')}
            >
              다시 풀기
            </button>
            <button
              type="button"
              onClick={onKeepResult}
              className={cn(chipClass, 'flex-1 justify-center')}
            >
              괜찮아
            </button>
          </div>
        </div>
      )}

      {isDone && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-[15px] font-semibold text-slate-900">
            {total}개 중 {correct}개 맞았어{correct === total ? '! 👏' : '.'}
          </p>
          <ul className="flex flex-col gap-1">
            {quiz.questions.map((item, index) => {
              const isRight = quiz.answers[index]?.choiceIndex === item.answerIndex
              return (
                <li key={index} className="flex gap-2 text-sm text-slate-600">
                  <span aria-label={isRight ? '맞음' : '틀림'} className="shrink-0">
                    {isRight ? '⭕' : '❌'}
                  </span>
                  <span className="min-w-0 flex-1 break-words">{item.question}</span>
                </li>
              )
            })}
          </ul>
          {wrongCount > 0 && (
            <p className="text-xs break-keep text-slate-400">
              틀린 문제는 내일 코치가 한 번 더 물어볼게.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {wrongCount > 0 && (
              <button
                type="button"
                onClick={onReviewWrong}
                className={cn(chipClass, 'bg-brand-light text-brand border-transparent')}
              >
                틀린 것 다시 보기
              </button>
            )}
            {wrongCount > 0 && (
              <button type="button" onClick={onAskTutor} className={chipClass}>
                📚 과목 쌤한테 물어보기
              </button>
            )}
            <button type="button" onClick={onOtherTopic} className={chipClass}>
              다른 주제로
            </button>
          </div>
        </div>
      )}
      {quiz.isDemo && <p className="mt-1 text-xs text-amber-700">시연용 예시 문제 (AI 아님)</p>}
    </div>
  )
}
