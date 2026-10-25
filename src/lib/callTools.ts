import { readDayPlanMinutes, TIME_PATTERN } from '@/lib/chatApi'
import { moveDateKey } from '@/lib/date'
import {
  DEFAULT_DAILY_MINUTES,
  MAX_DAILY_MINUTES,
  MAX_LONG_PLAN_DAYS,
  MAX_PLAN_TALK_LINE_LENGTH,
  MAX_PLAN_TALK_LINES,
  MAX_PLAN_TEXT_LENGTH,
  MIN_DAILY_MINUTES,
  planLineForAi,
  type DayPlanAsk,
  type PlanReply,
} from '@/lib/coachPlan'
import { WAITING_TEXT, type SubtitleMessage } from '@/lib/transcript'

/**
 * AI 통화 중에 쓰는 "도구" 입니다. (2026-10-18, 이슈 #577)
 * 학생이 통화에서 "계획 짜 줘" 라고 하면 AI 가 도구를 부르고, 앱이 계획을 짜서 통화 화면에 계획 카드를 띄웁니다.
 * 그다음 앱이 "화면에 띄웠어" 라는 결과를 AI 에게 돌려주면, AI 가 왜 이렇게 짰는지 한 문장으로 말하고 [이대로 할게] 를 누르라고 합니다.
 * (2026-10-25 #699 "통화도 마찬가지" — 계속 묻지 않게: 학생이 계획을 원하면 AI 가 묻지 말고 바로 부르고, 앱은 통화 자막을 같이 보냅니다)
 * React 를 쓰지 않는 순수 함수만 둡니다. 연결 쪽은 lib/realtimeCall.ts, 화면은 pages/CallActivePage.tsx 입니다.
 *
 * OpenAI Realtime API 의 함수 호출(function calling) 순서 (공식 문서 "Realtime conversations" 의 Function calling 기준)
 *   1. 앱 → session.update 로 도구 목록을 알림
 *   2. AI → response.function_call_arguments.done { call_id, name, arguments: 'JSON 글' }
 *   3. 앱 → conversation.item.create { item: { type: 'function_call_output', call_id, output } } → response.create
 * ⚠️ 진짜 서버(GPT 음성)로는 아직 확인하지 못했습니다. 문서와 다르면 이 파일과 realtimeCall.ts 만 고치면 됩니다.
 */

/** AI 에게 알려 주는 도구 하나 (Realtime API 의 tools 칸 모양) */
export interface RealtimeTool {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** AI 가 부른 도구 하나 */
export interface ToolCall {
  /** 결과를 돌려줄 때 같이 보내는 번호 */
  callId: string
  name: string
  /** AI 가 채운 값 (JSON 글을 읽은 것). 읽지 못했으면 빈 객체 */
  args: Record<string, unknown>
}

/**
 * 통화에서 쓰는 도구 3개. 오늘 날짜를 알려 줘야 AI 가 "다음 주 금요일" 같은 말을 날짜로 바꿀 수 있습니다.
 *   show_day_plan  — 오늘 계획을 짜서 화면에 띄움 (학생이 말한 총 분 · 시작 시각이 있으면 같이)
 *   show_long_plan — 시험 · 대회 날까지의 계획(최대 30일)을 짜서 화면에 띄움 (하루 분이 있으면 같이)
 *   revise_plan    — 화면에 띄운 계획을 학생 말대로 고침
 * 설명마다 "묻지 말고 바로 불러" 를 넣었습니다. 앱이 통화 자막을 같이 보내서, 학생이 말한 것은 계획에 들어갑니다. (#699)
 */
export function buildCallTools(todayKey: string): RealtimeTool[] {
  return [
    {
      type: 'function',
      name: 'show_day_plan',
      description:
        '학생이 오늘 공부 계획을 원하면 묻지 말고 바로 부른다. 앱이 통화 내용 · 오늘 시간표 · 컨디션으로 오늘 계획을 짜서 학생 화면에 띄운다. 학생이 이미 말한 총 공부 시간 · 시작 시각만 넣고, 모르는 값은 비워 둔다. 값을 채우려고 되묻지 않는다.',
      parameters: {
        type: 'object',
        properties: {
          totalMinutes: {
            type: 'integer',
            description: '학생이 말한 오늘 총 공부 시간 (분, 20~600). 말하지 않았으면 비워 둔다',
          },
          startTime: {
            type: 'string',
            description: '학생이 말한 시작 시각 HH:mm (예: 21:00). 말하지 않았으면 비워 둔다',
          },
        },
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'show_long_plan',
      description: `학생이 시험 · 대회 · 수행평가 같은 날까지의 계획을 원하면 묻지 말고 바로 부른다. 무엇을 · 언제까지는 꼭 있어야 해서, 통화에서 아직 안 나온 것 하나만 짧게 묻는다. 오늘은 ${todayKey} 이고, 날짜는 내일부터 ${MAX_LONG_PLAN_DAYS}일 뒤까지만 된다. 앱이 계획을 짜서 학생 화면에 띄운다.`,
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: '준비하는 것 한 줄 (예: 중간고사 미적분 1~3단원)',
          },
          endDate: { type: 'string', description: '시험 · 마감 날 YYYY-MM-DD' },
          dailyMinutes: {
            type: 'integer',
            description: `학생이 말한 하루 공부 시간 (분, ${MIN_DAILY_MINUTES}~${MAX_DAILY_MINUTES}). 말하지 않았으면 비워 둔다 (앱이 ${DEFAULT_DAILY_MINUTES}분으로 짠다)`,
          },
        },
        required: ['goal', 'endDate'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'revise_plan',
      description:
        '화면에 띄운 계획을 학생이 고쳐 달라고 하면 묻지 말고 바로 부른다. 예: 주말은 빼 줘, 하루 30분으로, 8시부터, 영어는 빼 줘.',
      parameters: {
        type: 'object',
        properties: {
          request: { type: 'string', description: '학생의 요청 한 줄' },
        },
        required: ['request'],
        additionalProperties: false,
      },
    },
  ]
}

/**
 * 데이터 채널로 온 이벤트가 "도구를 불렀다" 는 이벤트면 꺼냅니다. 아니면 null
 *
 *   { type: 'response.function_call_arguments.done', call_id: 'c1', name: 'show_day_plan', arguments: '{}' }
 *   -> { callId: 'c1', name: 'show_day_plan', args: {} }
 */
export function parseToolCallEvent(data: unknown): ToolCall | null {
  if (typeof data !== 'string') return null
  let event: unknown
  try {
    event = JSON.parse(data)
  } catch {
    return null
  }
  if (typeof event !== 'object' || event === null) return null
  const record = event as Record<string, unknown>
  if (record.type !== 'response.function_call_arguments.done') return null
  if (typeof record.call_id !== 'string' || typeof record.name !== 'string') return null
  let args: Record<string, unknown> = {}
  if (typeof record.arguments === 'string') {
    try {
      const parsed: unknown = JSON.parse(record.arguments)
      if (typeof parsed === 'object' && parsed !== null) args = parsed as Record<string, unknown>
    } catch {
      args = {}
    }
  }
  return { callId: record.call_id, name: record.name, args }
}

/**
 * show_day_plan 의 값을 확인합니다. 총 분은 정수 20 ~ 600, 시작 시각은 'HH:mm' 일 때만 쓰고, 아니면 null 입니다.
 * (채팅 답의 day_plan 과 같은 규칙, lib/chatApi.ts) 먼저 할 것은 통화 자막(planTalk)에 들어 있어서 따로 받지 않습니다.
 * 시가 한 자리인 '9:00' 은 '09:00' 으로 맞춥니다.
 *
 *   readDayPlanArgs({ totalMinutes: 120, startTime: '21:00' }) -> { totalMinutes: 120, startTime: '21:00', firstTask: null }
 *   readDayPlanArgs({ totalMinutes: 5, startTime: '9시' })      -> { totalMinutes: null, startTime: null, firstTask: null }
 */
export function readDayPlanArgs(args: Record<string, unknown>): DayPlanAsk {
  const raw = typeof args.startTime === 'string' ? args.startTime.trim() : ''
  const time = /^\d:\d{2}$/.test(raw) ? `0${raw}` : raw
  const startTime = TIME_PATTERN.test(time) ? time : null
  return { totalMinutes: readDayPlanMinutes(args.totalMinutes), startTime, firstTask: null }
}

/**
 * show_long_plan 의 값을 확인합니다. 목표가 비었거나 날짜가 내일 ~ 30일 뒤가 아니면 null
 * 하루 분은 숫자면 30 ~ 300 안으로 맞추고, 없거나 숫자가 아니면 60분입니다.
 *
 *   readLongPlanArgs({ goal: '중간고사 미적분', endDate: '2026-11-02' }, '2026-10-18')
 *     -> { goal, endDate, dailyMinutes: 60 }
 *   readLongPlanArgs({ goal: '중간고사', endDate: '2026-11-02', dailyMinutes: 90 }, '2026-10-18')
 *     -> { goal, endDate, dailyMinutes: 90 }
 *   readLongPlanArgs({ goal: '중간고사', endDate: '2026-12-25' }, '2026-10-18') -> null (30일 넘음)
 */
export function readLongPlanArgs(
  args: Record<string, unknown>,
  todayKey: string,
): { goal: string; endDate: string; dailyMinutes: number } | null {
  const goal = typeof args.goal === 'string' ? args.goal.trim().slice(0, MAX_PLAN_TEXT_LENGTH) : ''
  const endDate = typeof args.endDate === 'string' ? args.endDate.trim() : ''
  if (goal === '' || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return null
  if (endDate < moveDateKey(todayKey, 1) || endDate > moveDateKey(todayKey, MAX_LONG_PLAN_DAYS)) {
    return null
  }
  const dailyMinutes =
    typeof args.dailyMinutes === 'number' && Number.isFinite(args.dailyMinutes)
      ? Math.min(MAX_DAILY_MINUTES, Math.max(MIN_DAILY_MINUTES, Math.round(args.dailyMinutes)))
      : DEFAULT_DAILY_MINUTES
  return { goal, endDate, dailyMinutes }
}

/** revise_plan 의 요청 한 줄. 비었으면 null */
export function readReviseArgs(args: Record<string, unknown>): string | null {
  const request =
    typeof args.request === 'string' ? args.request.trim().slice(0, MAX_PLAN_TEXT_LENGTH) : ''
  return request === '' ? null : request
}

/**
 * 통화 자막을 계획 요청에 같이 보낼 줄로 만듭니다. (서버의 planTalk, #699)
 * 채팅 계획 방의 planTalkLines(lib/coachThread.ts)와 같은 모양이라, 통화에서 말한 "2시간만 · 9시부터 · 수학 먼저" 가 계획에 들어갑니다.
 * - 한 줄은 '나: …' / '코치: …' 모양이고 200자까지, 최근 8줄을 시간 순서로 돌려줍니다.
 * - 빼는 것: 빈 말 · 아직 글자로 안 바뀐 내 말('…')
 *
 *   [나 '오늘 2시간만 할래' · 코치 '좋아, 몇 시부터?' · 나 '…']
 *   -> ['나: 오늘 2시간만 할래', '코치: 좋아, 몇 시부터?']
 */
export function callTalkLines(messages: SubtitleMessage[]): string[] {
  const lines: string[] = []
  for (const message of messages) {
    const text = message.text.replace(/\s+/g, ' ').trim()
    if (text === '' || text === WAITING_TEXT) continue
    const line = `${message.speaker === 'me' ? '나' : '코치'}: ${text}`
    // 이모지가 반으로 잘리지 않게 글자(코드 포인트) 단위로 자릅니다.
    lines.push(Array.from(line).slice(0, MAX_PLAN_TALK_LINE_LENGTH).join(''))
  }
  return lines.slice(-MAX_PLAN_TALK_LINES)
}

/**
 * 계획을 짜거나 고친 결과를 AI 에게 돌려줄 글. AI 는 이 글을 보고 이어서 말합니다.
 * 고칠 곳을 되묻지 않게, "왜 이렇게 짰는지 한 문장 + 괜찮으면 [이대로 할게]" 로 끝냅니다. (#699)
 * 버튼 이름 [이대로 할게] 는 통화 화면(pages/CallActivePage.tsx)의 버튼과 같아야 합니다.
 *
 *   -> '학생 화면에 계획을 띄웠어: [계획 초안] 카드 2장 · 총 90분 — 10/25 21:00 수학 문제 풀기 50분, …
 *       앱이 이렇게 짠 이유: 오늘 시간표 과목으로 짰어요. 카드가 왜 이렇게 들어갔는지 한 문장으로 말하고, …'
 */
export function planOutputForAi(result: PlanReply): string {
  if (result.showHelp) {
    return '계획은 미루자. 학생이 힘든 이야기를 했으니 공부 이야기는 그만하고 마음을 먼저 들어 줘.'
  }
  if (result.plan === null) {
    return `계획을 화면에 띄우지 못했어. 앱이 한 말: "${result.reply}" 학생에게 다르게 말해 달라고 해.`
  }
  // 서버 · 시연용 예시가 준 "왜 이렇게 짰는지" (최대 2개). AI 가 이걸 보고 한 문장으로 설명합니다.
  const reasons = result.plan.evidence.slice(0, 2).join(' / ')
  return [
    `학생 화면에 계획을 띄웠어: ${planLineForAi(result.plan)}.`,
    reasons === '' ? '' : `앱이 이렇게 짠 이유: ${reasons}.`,
    '카드가 왜 이렇게 들어갔는지 한 문장으로 말하고, 괜찮으면 화면의 [이대로 할게] 를 누르라고 해. 고칠 곳을 따로 묻지 마.',
  ]
    .filter((part) => part !== '')
    .join(' ')
}

/** AI 에게 도구 결과를 돌려주는 이벤트 2개 (결과 → 이어서 말하기) */
export function toolOutputEvents(callId: string, output: string): Record<string, unknown>[] {
  return [
    {
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output },
    },
    { type: 'response.create' },
  ]
}
