/**
 * 공부 기록(타이머로 한 번 잰 기록)을 서버(BE)에 저장하고, 기간별로 · 오늘 합계로 · 계획별로 받아오는 함수들입니다. (#203)
 * 화면은 지금 localStorage 의 useStudySessions 훅을 씁니다. 끝난 기록은 lib/sessionSync.ts 가 createSession 으로 서버에 보냅니다. (#516)
 * sessionsByRangeQuery · todayTotalQuery · planProgressQuery 는 아직 화면이 쓰지 않습니다.
 *
 * 서버와 정한 약속입니다. (BE 저장소의 docs/API.md "공부 기록", BE 이슈 #13 · #14) 전부 로그인이 필요합니다.
 *   타이머 기록 저장  POST /study-sessions   { subjectId?, startedAt, endedAt, pauseCount, pausedMs?, planId?, targetMinutes?, stopReason?, kind? } -> 201 StudySession
 *   기간 안의 기록    GET  /study-sessions?from=2026-10-01&to=2026-10-07   -> 200 StudySession[] (시작이 빠른 순, 없으면 [])
 *   오늘 순공 합계    GET  /study-sessions/today/total                     -> 200 { date, studyMinutes, subjects: [{ subjectId, studyMinutes }] }
 *   계획별 실제 시간  GET  /study-sessions/by-plan?date=2026-10-05         -> 200 [{ planId, actualMinutes, percent, isReached, remainingMinutes }]
 *   실패              400 값이 틀림 · 401 로그인 풀림 · 404 없는 과목·계획(남의 것 포함) · 409 이미 저장된 기록과 시간이 겹침
 *   서버가 준 message 는 사람이 읽는 한국어 문장이라 화면에 그대로 보여줘도 됩니다. (getApiErrorMessage)
 *
 * ⚠️ 이슈 #203 에는 주소가 /sessions 로 적혀 있는데, BE 가 만든 주소는 /study-sessions 입니다. BE 문서를 따랐습니다.
 *
 * ■ 서버가 주는 모양과 FE 의 StudySession 이 다른 곳 (이 파일이 바꿔 줍니다)
 *   - 값이 없으면 서버는 null, FE 의 StudySession 은 칸이 없음(undefined)입니다. (planId · targetMinutes · stopReason)
 *   - 시각(startedAt · endedAt)은 둘 다 밀리초 숫자(Date.now() 값)라 그대로 씁니다.
 *   - 순공은 서버도 같은 식입니다: 끝 − 시작 − 일시정지한 시간(pausedMs). 그리고 1분 미만은 저장하지 않습니다.
 *
 * ■ 저장에 실패해도 방금 공부한 기록이 사라지면 안 됩니다. (이슈 완료 조건)
 *   createSession 은 실패하면 에러를 던질 뿐, 보낸 값은 호출한 쪽에 그대로 있습니다.
 *   화면은 저장에 성공할 때까지 방금 잰 기록을 들고 있다가, 실패하면 같은 값으로 다시 보내게 해야 합니다.
 *   (useMutation 의 variables · mutate 를 다시 부르면 됩니다. hooks/useSessionMutations.ts)
 */
import { ApiError, api } from '@/lib/api'
import { isDateKey, toDayKey } from '@/lib/date'
import { missReasonOptions } from '@/lib/missReasons'
import { shouldRetryQuery } from '@/lib/queryRetry'
import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { PAUSE_TAGS } from '@/lib/sessionTags'
import type {
  MissReason,
  PauseTag,
  PlanKind,
  PlayTag,
  SessionEndReport,
  SessionMemo,
  SessionPause,
  StudySession,
} from '@/types'

/** 서버 응답을 기다리는 최대 시간(밀리초). 서버가 멈춰도 로딩이 영원히 끝나지 않으면 안 되기 때문입니다. */
const REQUEST_TIMEOUT_MS = 10000

/** 순공이 이보다 짧으면(1분 미만) 서버가 저장하지 않습니다. */
export const SESSION_MIN_STUDY_SECONDS = 60
/** 시작 시각이 이보다 앞서면(2020-01-01 UTC 이전) 서버가 거절합니다. (시계가 초기화된 기기의 1970년 기록 등) */
export const SESSION_MIN_STARTED_AT = Date.UTC(2020, 0, 1)
/** 기간별 목록은 한 번에 31일까지만 받을 수 있습니다. (시작일과 끝일을 모두 센 날 수) */
export const SESSION_MAX_RANGE_DAYS = 31
/**
 * "계획별 실제 시간 · 진행률" 쿼리의 이름표 앞부분입니다. 기록(sessions) 뿐 아니라 계획(plans)이 바뀔 때도 이 값을 낡게 해야 해서,
 * lib/plansApi.ts 의 invalidatePlans 도 이 이름표를 씁니다.
 */
export const PLAN_PROGRESS_QUERY_KEY = ['study-sessions', 'by-plan'] as const

/** 저장할 때 서버에 보내는 값. 노는 기록은 과목을 안 보냅니다. */
export interface SessionCreateInput {
  /** 공부 기록은 필수(내 과목의 id). 노는 기록이면 없거나 빈 글자 */
  subjectId?: string
  /** 시작한 시각 (Date.now() 값) */
  startedAt: number
  /** 끝낸 시각 (Date.now() 값). 시작보다 뒤이고 미래가 아니어야 합니다 */
  endedAt: number
  /** 일시정지를 누른 횟수 */
  pauseCount: number
  /** 일시정지해 있던 시간의 합 (밀리초). 안 보내면 0 */
  pausedMs?: number
  /** 어느 계획을 하려고 켠 타이머인지. 계획 없이 켰으면 없음 */
  planId?: string
  /** 시작할 때 약속한 목표 시간(분). 목표 없이 켰으면 없음 */
  targetMinutes?: number
  /** 목표 전에 그만둔 이유. 안 골랐으면 없음 */
  stopReason?: MissReason
  /** 안 보내면 서버가 공부(study)로 봅니다 */
  kind?: PlanKind

  /* 아래는 카드 기준으로 넓힌 칸입니다. (BE #224 · FE #516) 뜻은 types 의 StudySession 과 같습니다. */
  /** 어느 카드의 세션인지 — **서버의 카드 번호** (Card 의 serverId). 이 기기의 카드 id 가 아닙니다 */
  cardId?: string
  /** 잰 방법. 사후 입력(selfReport)은 이 주소로 보내지 않습니다 */
  mode?: 'normal' | 'offline'
  pauses?: SessionPause[]
  endedEarly?: boolean
  endReport?: SessionEndReport
  memos?: SessionMemo[]
  playTag?: PlayTag
  overRestMs?: number
}

/** 오늘 순공 합계 (타이머 화면의 "오늘 총 공부 시간") */
export interface TodayTotal {
  /** 서버가 "오늘" 로 본 날짜 'YYYY-MM-DD' (새벽 4시 기준) */
  date: string
  /** 오늘 순공시간(분). 노는 기록은 넣지 않습니다 */
  studyMinutes: number
  /** 과목별 순공시간(분). 과목 번호가 작은 순서. 과목별을 더한 값이 전체와 1~2분 다를 수 있습니다 */
  subjects: { subjectId: string; studyMinutes: number }[]
}

/** 계획 하나의 실제 시간과 진행률 (계획 줄의 "32 / 50분" 과 진행 막대) */
export interface ServerPlanProgress {
  planId: string
  /** 그 계획으로 켠 기록들의 순공 합(분). 1분이 안 되는 나머지는 버립니다 */
  actualMinutes: number
  /** 목표 대비 진행률 (0 ~ 100). 소수점은 버립니다 */
  percent: number
  /** 목표 시간을 채웠는지 */
  isReached: boolean
  /** 목표까지 남은 시간(분). 올림. 채웠으면 0 */
  remainingMinutes: number
}

const MISS_REASON_KEYS: string[] = missReasonOptions.map((option) => option.key)

/** 값이 유한한 숫자인지 확인합니다. (NaN · Infinity · 글자는 아닙니다) */
function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 502: 서버가 이상한 응답을 줬다는 뜻으로 씁니다. */
function badResponse(): ApiError {
  return new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
}

/**
 * 서버가 준 기록 하나를 FE 의 StudySession 으로 바꿉니다. 모양이 이상하면 502 에러입니다.
 * 값이 없을 때 서버가 주는 null 은 StudySession 에서 칸을 비워 둡니다. (planId · targetMinutes · stopReason)
 *
 *   { id: '12', subjectId: '3', startedAt, endedAt, pauseCount: 2, pausedMs: 300000, planId: '7', targetMinutes: 50, stopReason: 'phone', kind: 'study' }
 *     -> 그대로
 *   { ..., planId: null, targetMinutes: null, stopReason: null, kind: 'play' }
 *     -> planId · targetMinutes · stopReason 칸이 없는 StudySession
 */
export function toStudySession(value: unknown): StudySession {
  if (typeof value !== 'object' || value === null) throw badResponse()
  const item = value as Record<string, unknown>
  if (
    typeof item.id !== 'string' ||
    typeof item.subjectId !== 'string' ||
    !isNumber(item.startedAt) ||
    !isNumber(item.endedAt) ||
    !isNumber(item.pauseCount) ||
    !isNumber(item.pausedMs) ||
    (item.planId !== null && typeof item.planId !== 'string') ||
    (item.targetMinutes !== null && !isNumber(item.targetMinutes)) ||
    (item.stopReason !== null && !MISS_REASON_KEYS.includes(item.stopReason as string)) ||
    (item.kind !== 'study' && item.kind !== 'play')
  ) {
    throw badResponse()
  }

  const session: StudySession = {
    id: item.id,
    subjectId: item.subjectId,
    startedAt: item.startedAt,
    endedAt: item.endedAt,
    pauseCount: item.pauseCount,
    pausedMs: item.pausedMs,
    kind: item.kind,
  }
  if (item.planId !== null) session.planId = item.planId
  if (item.targetMinutes !== null) session.targetMinutes = item.targetMinutes
  if (item.stopReason !== null) session.stopReason = item.stopReason as MissReason
  // 카드 기준 칸(#516). 기록 탭(History)이 서버 기록으로 카드 판정 · 발견을 할 때 씁니다. 모양이 틀리면 칸을 비웁니다.
  // ⚠️ cardId 는 "서버의 카드 번호" 입니다. 이 기기 카드 id 로 바꾸는 것은 쓰는 쪽(lib/historySessions.ts)이 합니다.
  if (typeof item.cardId === 'string') session.cardId = item.cardId
  if (item.mode === 'offline' || item.mode === 'selfReport') session.mode = item.mode
  if (item.endedEarly === true) session.endedEarly = true
  const pauses = toPauses(item.pauses)
  if (pauses.length > 0) session.pauses = pauses
  const checked = toChecked(item.endReport)
  if (checked) session.endReport = { checked }
  return session
}

/** 서버의 일시정지 목록 → SessionPause[]. 모르는 이유 태그는 '기타' 로 봅니다. 없거나 틀리면 빈 목록 */
function toPauses(value: unknown): SessionPause[] {
  if (!Array.isArray(value)) return []
  const pauses: SessionPause[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue
    const pause = raw as Record<string, unknown>
    if (!isNumber(pause.startedAt) || !isNumber(pause.endedAt)) continue
    const tag = PAUSE_TAGS.some((item) => item.key === pause.tag)
      ? (pause.tag as PauseTag)
      : 'other'
    pauses.push({ startedAt: pause.startedAt, endedAt: pause.endedAt, tag })
  }
  return pauses
}

/** 서버의 종료 팝업 답에서 체크한 항목(항목 id → 시각)만 꺼냅니다. 없으면 undefined */
function toChecked(value: unknown): Record<string, number> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const checked = (value as Record<string, unknown>).checked
  if (typeof checked !== 'object' || checked === null) return undefined
  const result: Record<string, number> = {}
  for (const [id, at] of Object.entries(checked)) {
    if (isNumber(at)) result[id] = at
  }
  return result
}

/**
 * 기간 조회의 목록을 바꿉니다. 목록이 아니면 502 에러입니다.
 * 모양이 틀린 기록 하나 때문에 목록 전체를 못 쓰게 되지 않도록, 틀린 기록은 건너뜁니다.
 */
function toStudySessions(value: unknown): StudySession[] {
  if (!Array.isArray(value)) throw badResponse()
  const sessions: StudySession[] = []
  for (const item of value) {
    try {
      sessions.push(toStudySession(item))
    } catch {
      // 건너뜁니다. (예: 서버에 새로 생긴 그만둔 이유 값을 FE 가 아직 모름)
    }
  }
  return sessions
}

/**
 * 순공 시간(초)을 셉니다. 끝 − 시작 − 일시정지한 시간입니다. (서버와 같은 식. 음수가 되면 0)
 *
 *   19:00 시작 ~ 20:10 정지, 40분 멈춤 -> 30분 = 1800초
 *   getStudySeconds({ startedAt: 0, endedAt: 4200000, pausedMs: 2400000 }) -> 1800
 */
export function getStudySeconds(
  input: Pick<SessionCreateInput, 'startedAt' | 'endedAt' | 'pausedMs'>,
): number {
  return Math.max(0, Math.floor((input.endedAt - input.startedAt - (input.pausedMs ?? 0)) / 1000))
}

/**
 * 이 기록을 저장해도 되는지(순공이 1분 이상인지) 알려 줍니다. 타이머가 "저장할지 버릴지" 정할 때 씁니다.
 *
 *   순공 59초 -> false   /   순공 60초 -> true
 */
export function isSavableSession(
  input: Pick<SessionCreateInput, 'startedAt' | 'endedAt' | 'pausedMs'>,
): boolean {
  return getStudySeconds(input) >= SESSION_MIN_STUDY_SECONDS
}

/**
 * 저장할 기록을 서버가 받는 모양으로 만듭니다.
 *   - 노는 기록은 과목을 보내지 않습니다. (보내도 서버가 비웁니다)
 *   - 없는 값(undefined · 빈 글자)은 보내지 않습니다.
 *
 *   { subjectId: '3', startedAt, endedAt, pauseCount: 2, pausedMs: 300000, planId: '7', targetMinutes: 50, stopReason: 'phone' }
 *     -> 그대로
 *   { subjectId: '', startedAt, endedAt, pauseCount: 0, planId: '', kind: 'play' }
 *     -> { startedAt, endedAt, pauseCount: 0, kind: 'play' }
 */
export function toCreateBody(input: SessionCreateInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    pauseCount: input.pauseCount,
  }
  if (input.kind !== undefined) body.kind = input.kind
  if (input.kind !== 'play' && input.subjectId !== undefined && input.subjectId !== '') {
    body.subjectId = input.subjectId
  }
  if (input.pausedMs !== undefined) body.pausedMs = input.pausedMs
  if (input.planId !== undefined && input.planId !== '') body.planId = input.planId
  if (input.targetMinutes !== undefined) body.targetMinutes = input.targetMinutes
  if (input.stopReason !== undefined) body.stopReason = input.stopReason
  // 카드 기준으로 넓힌 칸 (#516). 서버의 한도를 넘는 것은 잘라서 보냅니다. (넘으면 서버가 400 으로 기록 전체를 거절합니다)
  if (input.cardId !== undefined && input.cardId !== '') body.cardId = input.cardId
  if (input.mode !== undefined) body.mode = input.mode
  if (input.endedEarly !== undefined) body.endedEarly = input.endedEarly
  if (input.pauses !== undefined) body.pauses = toPausesBody(input)
  if (input.endReport !== undefined) body.endReport = toEndReportBody(input.endReport)
  if (input.memos !== undefined && input.memos.length > 0) body.memos = toMemosBody(input.memos)
  if (input.kind === 'play' && input.playTag !== undefined) body.playTag = input.playTag
  if (input.kind === 'play' && input.overRestMs !== undefined) {
    body.overRestMs = Math.max(0, Math.round(input.overRestMs))
  }
  return body
}

// 서버가 받는 한도 (BE docs/API.md 「공부 기록 · 저장」)
const MAX_PAUSES = 200
const MAX_NOTE_LENGTH = 100
const MAX_CHECKED = 20
const MAX_CHECKED_ID_LENGTH = 40
const MAX_PROOF_LENGTH = 300
const MAX_GOOD_REASONS = 6
const MAX_MEMOS = 50
const MAX_MEMO_LENGTH = 100

/** 서버가 받는 시각인지 (2020년 이후이고 미래가 아님) */
function isValidMoment(at: number): boolean {
  return at >= SESSION_MIN_STARTED_AT && at <= Date.now()
}

/**
 * 일시정지 목록. 서버는 기록의 시작 ~ 끝 밖의 일시정지를 거절해서, 그 사이로 맞춥니다.
 * 이유는 대표 이유(tag, 처음 고른 것) 하나만 보냅니다. 서버 칸이 하나라서, 여러 개(tags)는 이 기기에만 있습니다. (lib/reasons.ts)
 */
function toPausesBody(input: SessionCreateInput): Record<string, unknown>[] {
  return (input.pauses ?? []).slice(0, MAX_PAUSES).map((pause) => {
    const startedAt = Math.min(Math.max(pause.startedAt, input.startedAt), input.endedAt)
    const endedAt = Math.min(Math.max(pause.endedAt, startedAt), input.endedAt)
    const note = pause.note?.trim().slice(0, MAX_NOTE_LENGTH)
    return note
      ? { startedAt, endedAt, tag: pause.tag, note }
      : { startedAt, endedAt, tag: pause.tag }
  })
}

/** 종료 팝업에서 받은 것. 이 기기에만 쓰는 칸(proofRequired)은 보내지 않습니다. (사후 입력 lib/markSync.ts 도 씁니다) */
export function toEndReportBody(report: SessionEndReport): Record<string, unknown> {
  const checked = Object.fromEntries(
    Object.entries(report.checked)
      .filter(
        ([id, at]) => id.length >= 1 && id.length <= MAX_CHECKED_ID_LENGTH && isValidMoment(at),
      )
      .slice(0, MAX_CHECKED),
  )
  const body: Record<string, unknown> = { checked }
  // 서버 칸은 하나라서 대표 이유(처음 고른 것)만 보냅니다. 여러 개(shortfallReasons)는 이 기기에만 있습니다. (lib/reasons.ts)
  if (report.shortfallReason !== undefined) body.shortfallReason = report.shortfallReason
  if (report.withWhat !== undefined) body.withWhat = report.withWhat
  if (report.goodReasons !== undefined)
    body.goodReasons = report.goodReasons.slice(0, MAX_GOOD_REASONS)
  const link = report.proof?.link?.trim().slice(0, MAX_PROOF_LENGTH) ?? ''
  const summary = report.proof?.summary?.trim().slice(0, MAX_PROOF_LENGTH) ?? ''
  if (link !== '' || summary !== '') {
    body.proof = { ...(link !== '' ? { link } : {}), ...(summary !== '' ? { summary } : {}) }
  }
  return body
}

/** 딴생각 주차장 메모. 빈 메모와 시각이 이상한 메모는 뺍니다. */
function toMemosBody(memos: SessionMemo[]): Record<string, unknown>[] {
  return memos
    .map((memo) => ({ at: memo.at, text: memo.text.trim().slice(0, MAX_MEMO_LENGTH) }))
    .filter((memo) => memo.text !== '' && isValidMoment(memo.at))
    .slice(0, MAX_MEMOS)
}

/**
 * 타이머 기록 하나를 저장하고, 서버가 저장한 기록(id 가 붙어 있음)을 돌려줍니다. 실패하면 에러를 던집니다.
 *
 * 순공이 1분 미만이면 서버를 부르지 않고 400 에러를 던집니다. (서버도 400 인 같은 규칙. 헛된 요청을 줄입니다)
 * 이미 저장된 내 기록과 시간이 겹치면 서버가 409 를 줍니다. (끝과 시작이 딱 붙은 것은 괜찮습니다)
 * 실패해도 보낸 값은 호출한 쪽에 그대로 있으니, 같은 값으로 다시 보내면 됩니다.
 *
 * ■ 시간 초과로 실패한 뒤 다시 보내도 안전합니다. (같은 기록을 두 번 저장하지 않습니다)
 *   "시간 초과" 는 서버가 못 받은 게 아니라 답이 늦은 것일 수 있어서, 첫 요청이 실제로는 저장됐을 수 있습니다.
 *   그때 같은 값으로 다시 보내면 서버가 "이미 저장된 기록과 겹쳐요(409)" 라고 답합니다.
 *   그래서 409 가 오면, 그날의 기록 중 시작 · 끝 시각이 똑같은 것이 있는지 찾아보고 있으면 "이미 저장됨" 으로 보고
 *   그 기록을 성공으로 돌려줍니다. (겹치는 기록은 못 저장하니까, 시작 · 끝이 같은 기록은 방금 보낸 그 기록입니다)
 *   찾지 못하면(진짜로 다른 기록과 겹침) 서버가 준 409 를 그대로 던집니다.
 */
export async function createSession(input: SessionCreateInput): Promise<StudySession> {
  if (!isSavableSession(input)) {
    throw new ApiError('1분 미만의 기록은 저장하지 않아요', 400, 'VALIDATION_ERROR')
  }
  try {
    const result = await api<unknown>('/study-sessions', {
      method: 'POST',
      body: JSON.stringify(toCreateBody(input)),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return toStudySession(result)
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      const saved = await findAlreadySaved(input)
      if (saved !== null) return saved
    }
    throw error
  }
}

/**
 * 같은 시작 · 끝 시각으로 이미 저장된 내 기록이 있으면 돌려줍니다. 없거나 찾지 못하면 null 입니다.
 * (시간 초과로 실패했다고 안내받은 기록을 다시 보냈을 때, 사실은 저장돼 있었는지 확인하는 데 씁니다)
 *
 *   이미 저장된 기록 { startedAt: 100, endedAt: 200 }, 다시 보낸 { startedAt: 100, endedAt: 200 } -> 그 기록
 *   겹치지만 시작이 다른 기록 { startedAt: 100, endedAt: 200 }, 보낸 { startedAt: 150, endedAt: 250 } -> null
 */
async function findAlreadySaved(input: SessionCreateInput): Promise<StudySession | null> {
  try {
    // 서버는 하루를 새벽 4시 기준으로 세므로, 시작 시각이 속한 "그 날" 하루만 조회합니다.
    const day = toDayKey(input.startedAt)
    const sessions = await fetchSessionsByRange(day, day)
    return (
      sessions.find(
        (session) => session.startedAt === input.startedAt && session.endedAt === input.endedAt,
      ) ?? null
    )
  } catch {
    // 찾는 데 실패하면 원래의 409 를 그대로 보여 줍니다. (여기서 또 에러를 던지지 않습니다)
    return null
  }
}

/** 'YYYY-MM-DD' 두 날짜 사이의 날 수(시작일과 끝일을 모두 센 것)입니다. 같은 날이면 1 입니다. */
function countDaysInclusive(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const ms = new Date(ty, tm - 1, td).getTime() - new Date(fy, fm - 1, fd).getTime()
  return Math.round(ms / (24 * 60 * 60 * 1000)) + 1
}

/** 날짜 모양이 아니면 서버를 부르지 않고 400 에러를 던집니다. */
function assertDate(date: string): void {
  if (!isDateKey(date)) throw new ApiError('날짜를 다시 확인해 주세요', 400, 'VALIDATION_ERROR')
}

/**
 * 기간(from ~ to, 둘 다 포함)이 서버가 받는 기간인지 확인합니다. 아니면 서버를 부르지 않고 400 에러를 던집니다.
 *   날짜 모양이 틀림 · from 이 to 보다 늦음 · 31일보다 김
 */
function assertRange(from: string, to: string): void {
  assertDate(from)
  assertDate(to)
  if (from > to) {
    throw new ApiError('시작 날짜는 끝 날짜보다 늦을 수 없어요', 400, 'VALIDATION_ERROR')
  }
  if (countDaysInclusive(from, to) > SESSION_MAX_RANGE_DAYS) {
    throw new ApiError(
      `한 번에 ${SESSION_MAX_RANGE_DAYS}일까지만 조회할 수 있어요`,
      400,
      'VALIDATION_ERROR',
    )
  }
}

/** 기간 안의 내 기록 목록 (31일까지). 서버 기록을 이 기기로 받아 올 때도 씁니다. (lib/serverHistoryPull.ts) */
export async function fetchSessionsByRange(from: string, to: string): Promise<StudySession[]> {
  assertRange(from, to)
  const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  const result = await api<unknown>(`/study-sessions?${query}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  return toStudySessions(result)
}

/**
 * 기간 안의 내 기록 목록의 쿼리 설정입니다. 화면에서는 useSuspenseQuery(sessionsByRangeQuery('2026-10-01', '2026-10-07')) 로 받아옵니다.
 * (docs/DATA-FETCHING.md) from · to 는 그날도 포함하고, 하루는 새벽 4시 기준입니다.
 * 시작이 빠른 순서(오래된 것이 앞)로 옵니다. 최근 날짜를 위에 보여주려면 화면에서 뒤집어 씁니다.
 * 노는 기록(kind: 'play')도 들어 있으니, 순공을 셀 때는 빼야 합니다.
 */
export function sessionsByRangeQuery(from: string, to: string) {
  return queryOptions({
    queryKey: ['study-sessions', 'range', from, to],
    queryFn: () => fetchSessionsByRange(from, to),
    // 일시적인 문제(연결 끊김 · 시간 초과 · 서버 5xx)만 최대 2번 다시 시도하고, 400 · 404 같은 거절은 다시 시도하지 않습니다. (lib/queryRetry.ts)
    retry: shouldRetryQuery,
  })
}

async function fetchTodayTotal(): Promise<TodayTotal> {
  const result = await api<unknown>('/study-sessions/today/total', {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (typeof result !== 'object' || result === null) throw badResponse()
  const total = result as Record<string, unknown>
  if (
    typeof total.date !== 'string' ||
    !isDateKey(total.date) ||
    !isNumber(total.studyMinutes) ||
    !Array.isArray(total.subjects) ||
    !total.subjects.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).subjectId === 'string' &&
        isNumber((item as Record<string, unknown>).studyMinutes),
    )
  ) {
    throw badResponse()
  }
  return {
    date: total.date,
    studyMinutes: total.studyMinutes,
    subjects: (total.subjects as { subjectId: string; studyMinutes: number }[]).map((item) => ({
      subjectId: item.subjectId,
      studyMinutes: item.studyMinutes,
    })),
  }
}

/**
 * 오늘 순공시간과 과목별 합계의 쿼리 설정입니다. 타이머 화면의 "오늘 총 공부 시간" 이 씁니다.
 * "오늘" 도 하루의 기준(새벽 4시)을 따라서, 자정을 넘겨 공부해도 날짜가 안 바뀝니다. (서버가 정한 날짜가 date 로 옵니다)
 * 기록을 저장하면 바뀌어야 해서 30초만 보관합니다. (저장한 뒤에는 invalidateSessions 로 바로 낡게 합니다)
 */
export function todayTotalQuery() {
  return queryOptions({
    queryKey: ['study-sessions', 'today-total'],
    queryFn: fetchTodayTotal,
    staleTime: 30 * 1000,
    retry: shouldRetryQuery,
  })
}

async function fetchPlanProgress(date: string): Promise<ServerPlanProgress[]> {
  assertDate(date)
  const result = await api<unknown>(`/study-sessions/by-plan?date=${encodeURIComponent(date)}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!Array.isArray(result)) throw badResponse()
  return result.map((value) => {
    if (typeof value !== 'object' || value === null) throw badResponse()
    const item = value as Record<string, unknown>
    if (
      typeof item.planId !== 'string' ||
      !isNumber(item.actualMinutes) ||
      !isNumber(item.percent) ||
      typeof item.isReached !== 'boolean' ||
      !isNumber(item.remainingMinutes)
    ) {
      throw badResponse()
    }
    return {
      planId: item.planId,
      actualMinutes: item.actualMinutes,
      percent: item.percent,
      isReached: item.isReached,
      remainingMinutes: item.remainingMinutes,
    }
  })
}

/**
 * 그날 계획마다 실제 시간과 진행률의 쿼리 설정입니다. 계획 줄의 "32 / 50분" 과 진행 막대에 씁니다.
 * 계획 번호 순서로 오고, 기록이 없는 계획도 actualMinutes 0 으로 들어 있습니다. 계획이 없는 날은 [] 입니다.
 * 노는 계획의 실제 시간은 노는 기록의 길이입니다.
 */
export function planProgressQuery(date: string) {
  return queryOptions({
    queryKey: [...PLAN_PROGRESS_QUERY_KEY, date],
    queryFn: () => fetchPlanProgress(date),
    retry: shouldRetryQuery,
  })
}

/**
 * 보관해 둔 기록 관련 값(기간별 목록 · 오늘 합계 · 계획별 실제 시간)을 모두 "낡았다" 고 표시해서,
 * 화면이 서버에서 새로 받아오게 합니다. 기록 저장이 성공한 뒤에 부릅니다. (hooks/useSessionMutations.ts 가 대신 불러 줍니다)
 * 세 가지가 모두 같은 기록에서 계산돼서 한꺼번에 낡게 합니다.
 */
export function invalidateSessions(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: ['study-sessions'] })
}
/**
 * 서버에 저장된 내 공부 기록을 모두 지웁니다. 설정의 "모든 기록 지우기" 가 부릅니다. (#516)
 * ⚠️ BE 의 `DELETE /study-sessions` 가 배포돼야 지워집니다. 그 전에는 실패해서 "아직 다 못 지웠어요" 안내가 나옵니다.
 */
export async function deleteServerSessions(): Promise<void> {
  await api<void>('/study-sessions', {
    method: 'DELETE',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}
