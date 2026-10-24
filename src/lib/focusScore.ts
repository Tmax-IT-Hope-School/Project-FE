/**
 * 집중도 점수 (0 ~ 100) — 묻지 않고, 타이머가 잰 숫자만으로 계산합니다. (React 없는 순수 함수, 2026-10-18)
 *
 * 계산 방법 (학생에게 설명할 때도 이대로)
 *   1. 공부한 시간 = 시작 ~ 끝에서 일시정지한 시간을 뺀 것
 *   2. 딴짓 시간   = 공부한 시간 안에서
 *        - 앱: 폰을 5초 넘게 들고 있던 시간. 들고 앱 밖으로 나간 시간도 여기 들어 있습니다.
 *              (엎어 둔 채 화면만 끈 것은 딴짓이 아니라서 "앱 밖 시간" 을 따로 더하지 않습니다)
 *              폰을 한 번도 안 엎었으면(센서가 없는 폰 · [그냥 시작]) 들었는지 알 수 없어서 앱 밖에 있던 시간을 씁니다.
 *        - 웹: 다른 탭 · 앱으로 가서 타이머 화면이 5초 넘게 안 보이던 시간
 *      일시정지 중에 폰을 든 것 · 다른 탭에 간 것은 빼고 셉니다. (쉬는 시간은 딴짓이 아님)
 *   3. 집중도 = (공부한 시간 − 딴짓 시간) ÷ 공부한 시간 × 100 을 반올림
 *   공부한 시간이 1분이 안 되면 점수를 내지 않습니다. (null)
 *
 *   공부 25분, 폰을 2분 들었음 → (25 − 2) ÷ 25 × 100 = 92
 */
import { formatDuration, type PhoneLiftSummary } from '@/lib/liftAlerts'
import { loadData, removeData, saveData } from '@/lib/storage'
import type { StudySession } from '@/types'

/** 딴짓 한 번 — 시작 시각(밀리초)과 길이(밀리초) */
export interface DistractionSpan {
  at: number
  ms: number
}

/**
 * 딴짓 시간을 무엇으로 쟀는지
 *   lift    앱: 폰을 든 시간
 *   outside 앱: 폰을 한 번도 안 엎어서 앱 밖에 있던 시간
 *   hidden  웹: 타이머 화면이 안 보이던 시간
 */
export type FocusMeasure = 'lift' | 'outside' | 'hidden'

/** 세션 하나의 집중도. 세션 번호로 저장해 두고 코치 · 통계 탭이 씁니다. */
export interface FocusScoreRecord {
  sessionId: string
  /** 공부를 시작한 시각. 시간대별 평균(오전 · 오후 · 저녁 · 밤)에 씁니다. */
  startedAt: number
  /** 0 ~ 100 */
  score: number
  /** 공부한 시간 (일시정지 뺀 것, 밀리초) */
  runMs: number
  /** 그중 딴짓 시간 (밀리초) */
  distractedMs: number
  measuredBy: FocusMeasure
  /** 딴짓 횟수 (공부 중에 폰을 든 횟수 · 화면을 떠난 횟수). 'outside' 는 0 */
  count: number
  /** 앱 밖에 있던 시간 (앱만, 근거 글에 씀). 웹은 0 */
  outsideMs: number
}

/** 5초보다 짧은 것은 셈에서 뺍니다. (폰 들림 규칙 lib/liftAlerts.ts 와 같음) */
const IGNORE_UNDER_MS = 5_000
/** 공부한 시간이 이보다 짧으면 점수를 내지 않습니다. */
const MIN_RUN_MS = 60_000

/** 두 구간 [aStart, aEnd) · [bStart, bEnd) 이 겹치는 길이 (밀리초) */
function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}

/** 딴짓 한 번 중에서 "공부한 시간" 에 들어가는 부분 (세션 밖 · 일시정지와 겹친 부분은 뺌) */
function spanInRunMs(span: DistractionSpan, session: StudySession): number {
  const spanEnd = span.at + span.ms
  let ms = overlapMs(span.at, spanEnd, session.startedAt, session.endedAt)
  for (const pause of session.pauses ?? []) {
    ms -= overlapMs(span.at, spanEnd, pause.startedAt, pause.endedAt)
  }
  return Math.max(0, ms)
}

/**
 * 세션 하나의 집중도를 계산합니다. 공부한 시간이 1분이 안 되면 null
 *
 *   getFocusScore(25분 세션, [{ at: 시작 + 5분, ms: 2분 }], 'lift', 0)
 *     -> { score: 92, runMs: 25분, distractedMs: 2분, count: 1, … }
 *
 * extraMs: 구간 없이 합계만 아는 딴짓 시간 ('outside' 일 때 앱 밖 시간)
 */
export function getFocusScore(
  session: StudySession,
  spans: DistractionSpan[],
  measuredBy: FocusMeasure,
  extraMs = 0,
  outsideMs = 0,
): FocusScoreRecord | null {
  const runMs = Math.max(0, session.endedAt - session.startedAt - (session.pausedMs ?? 0))
  if (runMs < MIN_RUN_MS) return null

  let spanMs = 0
  let count = 0
  for (const span of spans) {
    if (span.ms < IGNORE_UNDER_MS) continue
    const inRun = spanInRunMs(span, session)
    if (inRun > 0) {
      spanMs += inRun
      count += 1
    }
  }
  // 딴짓 시간이 공부한 시간보다 길 수는 없습니다.
  const distractedMs = Math.min(runMs, spanMs + extraMs)
  return {
    sessionId: session.id,
    startedAt: session.startedAt,
    score: Math.round(((runMs - distractedMs) / runMs) * 100),
    runMs,
    distractedMs,
    measuredBy,
    count,
    outsideMs,
  }
}

/**
 * 끝난 세션의 집중도. 앱이면 폰 기록으로, 웹이면 화면을 떠난 기록으로 계산합니다. 숫자가 없으면 null
 *
 *   phone       앱이 'focus.end' 로 준 폰 기록 (앱 밖이거나 아직 안 왔으면 null)
 *   hiddenSpans 웹에서 타이머 화면이 안 보이던 구간들 (앱 안이면 null)
 */
export function scoreEndedSession(
  session: StudySession,
  phone: PhoneLiftSummary | null,
  hiddenSpans: DistractionSpan[] | null,
): FocusScoreRecord | null {
  if (phone !== null) {
    // 한 번도 안 엎었으면 들었는지 알 수 없어서 앱 밖 시간으로 셉니다. (옛 앱은 faceDownMs 가 없어서 폰 든 시간으로)
    if (phone.faceDownMs === 0) {
      return getFocusScore(session, [], 'outside', phone.outsideMs, phone.outsideMs)
    }
    // 옛 기록처럼 구간이 없으면 든 시간 합계를 그대로 씁니다. (일시정지와 겹친 부분을 뺄 수 없음)
    const spans = phone.liftSpans ?? []
    const extraMs = phone.liftSpans === undefined ? phone.liftedMs : 0
    return getFocusScore(session, spans, 'lift', extraMs, phone.outsideMs)
  }
  if (hiddenSpans !== null) return getFocusScore(session, hiddenSpans, 'hidden')
  return null
}

// ---- 웹: 공부 중에 타이머 화면을 떠난 기록 (CardTimerPage 의 SessionView) ----

/**
 * 진행 중인 세션에서 화면을 떠난 기록. 새로고침해도 이어지게 저장해 둡니다.
 * (모바일 웹은 다른 앱에 다녀오면 페이지를 새로 불러올 때가 있어서, 떠난 시각까지 저장합니다)
 */
export interface SessionAwayTrack {
  /** 어느 세션의 기록인지 (세션을 시작한 시각) */
  sessionStartedAt: number
  /** 떠났다가 돌아온 구간들 */
  spans: DistractionSpan[]
  /** 지금 떠나 있는 중이면 떠난 시각, 아니면 null */
  hiddenSince: number | null
}

// 저장소 이름 (실제 키는 'study-session-away'). 세션이 끝나면 지웁니다.
const AWAY_TRACK_KEY = 'session-away'

/** 그 세션의 화면을 떠난 기록. 없거나 다른 세션 것이면 빈 기록 */
export function loadAwayTrack(sessionStartedAt: number): SessionAwayTrack {
  const empty: SessionAwayTrack = { sessionStartedAt, spans: [], hiddenSince: null }
  const saved = loadData<unknown>(AWAY_TRACK_KEY, null)
  if (typeof saved !== 'object' || saved === null) return empty
  const track = saved as Partial<SessionAwayTrack>
  const isValid =
    track.sessionStartedAt === sessionStartedAt &&
    Array.isArray(track.spans) &&
    (track.hiddenSince === null || typeof track.hiddenSince === 'number')
  return isValid ? (track as SessionAwayTrack) : empty
}

export function saveAwayTrack(track: SessionAwayTrack): void {
  saveData(AWAY_TRACK_KEY, track)
}

export function clearAwayTrack(): void {
  removeData(AWAY_TRACK_KEY)
}

/**
 * 화면에 돌아왔을 때 떠나 있던 구간을 닫습니다. 떠나 있지 않았으면 그대로 돌려줍니다.
 *
 *   closeAwayTrack({ spans: [], hiddenSince: 1000, … }, 61000)
 *     -> { spans: [{ at: 1000, ms: 60000 }], hiddenSince: null, … }
 */
export function closeAwayTrack(track: SessionAwayTrack, now: number): SessionAwayTrack {
  if (track.hiddenSince === null) return track
  return {
    ...track,
    spans: [...track.spans, { at: track.hiddenSince, ms: Math.max(0, now - track.hiddenSince) }],
    hiddenSince: null,
  }
}

/** 돌아왔을 때 "다른 화면에 2분 있었어" 안내를 띄울 만큼 오래 떠나 있었는지 (5초 넘게) */
export function isLongAway(ms: number): boolean {
  return ms >= IGNORE_UNDER_MS
}

/** 밀리초 → '25분' (1분보다 짧아도 1분) */
function formatRunMinutes(ms: number): string {
  return `${Math.max(1, Math.round(ms / 60_000))}분`
}

/**
 * 종료 팝업에서 점수 밑에 보여 주는 근거 한 줄.
 *
 *   -> '공부한 25분 중 폰 든 시간 2분 (1번) · 앱 밖 40초'
 *   -> '공부한 25분 동안 폰을 한 번도 안 들었어요 👏'
 *   -> '공부한 25분 중 다른 탭·앱에 있던 시간 3분 (2번)'
 */
export function formatFocusEvidence(focus: FocusScoreRecord): string {
  const run = `공부한 ${formatRunMinutes(focus.runMs)}`
  if (focus.measuredBy === 'outside') {
    return focus.distractedMs === 0
      ? `${run} 동안 앱 밖으로 안 나갔어요 (폰을 안 엎어서 앱 밖 시간으로 셌어요)`
      : `${run} 중 앱 밖에 있던 시간 ${formatDuration(focus.distractedMs)} (폰을 안 엎어서 앱 밖 시간으로 셌어요)`
  }
  if (focus.measuredBy === 'hidden') {
    return focus.count === 0
      ? `${run} 동안 다른 탭·앱으로 안 갔어요 👏`
      : `${run} 중 다른 탭·앱에 있던 시간 ${formatDuration(focus.distractedMs)} (${focus.count}번)`
  }
  const outside = focus.outsideMs > 0 ? ` · 앱 밖 ${formatDuration(focus.outsideMs)}` : ''
  return focus.count === 0
    ? `${run} 동안 폰을 한 번도 안 들었어요 👏${outside}`
    : `${run} 중 폰 든 시간 ${formatDuration(focus.distractedMs)} (${focus.count}번)${outside}`
}

// 저장소 이름 (실제 키는 storage.ts 가 앞에 'study-' 를 붙여서 'study-focus-scores')
const STORAGE_KEY = 'focus-scores'
// 최근 세션 몇 개까지 남길지
const MAX_SAVED = 200

/** 저장소에서 꺼낸 값이 집중도 기록 모양이 맞는지 (깨진 값이 섞여도 화면이 멈추지 않게) */
function isFocusScoreRecord(value: unknown): value is FocusScoreRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.sessionId === 'string' &&
    ['startedAt', 'score', 'runMs', 'distractedMs', 'count', 'outsideMs'].every(
      (key) => typeof record[key] === 'number',
    ) &&
    (record.measuredBy === 'lift' ||
      record.measuredBy === 'outside' ||
      record.measuredBy === 'hidden')
  )
}

/** 저장해 둔 집중도 기록 전부 (오래된 것부터). 없거나 깨져 있으면 빈 목록 */
export function loadFocusScores(): FocusScoreRecord[] {
  const saved = loadData<unknown>(STORAGE_KEY, [])
  return Array.isArray(saved) ? saved.filter(isFocusScoreRecord) : []
}

/** 그 세션의 집중도. 없으면 null */
export function loadFocusScore(sessionId: string): FocusScoreRecord | null {
  return loadFocusScores().find((record) => record.sessionId === sessionId) ?? null
}

/** 세션 하나의 집중도를 저장합니다. 같은 세션 번호면 덮어써서, 여러 번 불려도 하나만 남습니다. 최근 200개까지 */
export function saveFocusScore(record: FocusScoreRecord): void {
  const others = loadFocusScores().filter((saved) => saved.sessionId !== record.sessionId)
  saveData(STORAGE_KEY, [...others, record].slice(-MAX_SAVED))
}

/** 시간대 이름. 공부를 시작한 시각으로 나눕니다. (하루는 새벽 4시에 바뀜 — lib/date.ts) */
export const FOCUS_TIME_BANDS = [
  { key: 'morning', label: '오전', fromHour: 4, toHour: 12 },
  { key: 'afternoon', label: '오후', fromHour: 12, toHour: 18 },
  { key: 'evening', label: '저녁', fromHour: 18, toHour: 22 },
  { key: 'night', label: '밤', fromHour: 22, toHour: 28 },
] as const

export interface FocusWeekSummary {
  /** 최근 7일 집중도 (0 ~ 100). 기록이 없으면 null */
  average: number | null
  /** 점수가 있는 세션 수 */
  sessionCount: number
  /** 시간대별 집중도. 그 시간대 기록이 없으면 average 가 null */
  bands: { key: string; label: string; average: number | null }[]
}

/** 여러 세션을 합친 집중도 = 공부한 시간 전체 중 딴짓이 아닌 비율 (길게 한 세션이 더 많이 반영됨) */
function combinedScore(records: FocusScoreRecord[]): number | null {
  const runMs = records.reduce((sum, record) => sum + record.runMs, 0)
  if (runMs === 0) return null
  const distractedMs = records.reduce((sum, record) => sum + record.distractedMs, 0)
  return Math.round(((runMs - distractedMs) / runMs) * 100)
}

/**
 * 통계 탭 카드에 쓰는 최근 7일 집중도와 시간대별 집중도.
 *
 *   summarizeFocusWeek(기록들, 지금)
 *     -> { average: 88, sessionCount: 6, bands: [{ label: '오전', average: 92 }, { label: '오후', average: null }, …] }
 */
export function summarizeFocusWeek(records: FocusScoreRecord[], now: number): FocusWeekSummary {
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000
  const recent = records.filter((record) => record.startedAt > weekAgo && record.startedAt <= now)
  const bands = FOCUS_TIME_BANDS.map((band) => {
    const inBand = recent.filter((record) => {
      // 새벽 0 ~ 4시는 24 ~ 28시로 봐서 '밤' 에 넣습니다.
      const hour = new Date(record.startedAt).getHours()
      const dayHour = hour < 4 ? hour + 24 : hour
      return dayHour >= band.fromHour && dayHour < band.toHour
    })
    return { key: band.key, label: band.label, average: combinedScore(inBand) }
  })
  return { average: combinedScore(recent), sessionCount: recent.length, bands }
}
