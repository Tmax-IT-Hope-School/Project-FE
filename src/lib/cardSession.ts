import { summarizePauses } from '@/lib/sessionRecords'
import { loadData } from '@/lib/storage'
import { CARD_SESSION_KEY } from '@/lib/timerLock'
import type { Card, PauseTag, SessionMemo, SessionMode, SessionPause, StudySession } from '@/types'

/**
 * 카드 세션(타이머 한 번)을 계산하는 순수 함수들입니다. (최종 기획서 「4.4 타이머」 세션, #395)
 * 진행 중인 세션을 들고 있는 훅은 hooks/useCardSession.ts 입니다.
 */

const MS_PER_MINUTE = 60 * 1000

/** 진행 중인 카드 세션. 새로고침해도 이어지도록 저장소에 그대로 넣습니다 */
export interface ActiveCardSession {
  cardId: string
  /** 그 카드를 하는 날짜 ('YYYY-MM-DD') */
  dateKey: string
  /** 시작한 시각 */
  startedAt: number
  /**
   * 한 번도 안 멈추면 이 시각에 끝납니다 (getScheduledEndAt). 시작할 때 정하고 바꾸지 않습니다.
   * 멈춘 만큼 늦춘 진짜 끝나는 시각은 getEndAtWithPauses 로 계산합니다.
   */
  endAt: number
  /** 계획 시간 (분) — 기록의 targetMinutes 로 남깁니다 */
  plannedMinutes: number
  /** 끝난 일시정지들 */
  pauses: SessionPause[]
  /**
   * 지금 일시정지 중이면 시작한 시각과 이유. alerted: 15분 복귀 알림을 이미 보냈는지
   * tag 는 처음 고른 대표 이유, tags 는 멈춘 뒤 더 고른 것까지 모두입니다. (여러 개 고르기, 2026-10-18)
   */
  pausedNow?: {
    startedAt: number
    tag: PauseTag
    tags?: PauseTag[]
    note?: string
    alerted?: boolean
  }
  /** 체크한 체크리스트 항목 (항목 id → 체크한 시각) */
  checked: Record<string, number>
  /** 딴생각 주차장 메모 */
  memos: SessionMemo[]
  mode: SessionMode
  /** 카드의 과목 id. 시작할 때 카드에서 옮겨 두고, 끝낼 때 기록에 넣습니다 (#652) */
  subjectId?: string
}

/**
 * 세션이 끝나는 시각을 정합니다. 타이머는 **[시작] 을 누른 순간부터 카드 길이만큼** 줄어듭니다. (2026-10-18)
 * - 10분 카드면 언제 눌러도 10:00 부터 시작합니다.
 * - 늦게 시작한 것은 여기서 줄이지 않고, 시작 시각과 예정 시각의 차이로 따로 기록됩니다.
 * - 일시정지하면 시계도 멈추고, 멈춘 만큼 끝나는 시각이 늦춰집니다. (getEndAtWithPauses, 2026-10-23)
 *
 * 예전에는 "뒤 일정을 지키려고" 카드의 예정 종료 시각까지만 셌는데, 늦게 누르면 10분 카드가 9분 20초부터
 * 시작해서 버그처럼 보였습니다. (즉석 카드는 시작 시각이 분 단위라 몇십 초씩 줄었음) 사용자 결정으로 바꿨습니다.
 *
 *   (10/17 19:00 · 60분 카드)   18:50 시작 -> 19:50 에 끝   19:20 시작 -> 20:20 에 끝
 */
export function getScheduledEndAt(card: Pick<Card, 'durationMinutes'>, startedAt: number): number {
  return startedAt + card.durationMinutes * MS_PER_MINUTE
}

/**
 * 멈춘 만큼 늦춘 진짜 끝나는 시각 = 처음 정한 끝 시각(endAt) + 지금까지 멈춘 시간
 * 멈춰 있는 동안에는 1초마다 같이 늦춰집니다. 그래서 남은 시간이 줄지 않습니다.
 *
 *   19:00 시작 · 30분 카드(endAt 19:30), 19:10 ~ 19:15 멈춤      -> 19:35
 *   19:00 시작 · 30분 카드, 19:10 에 멈춰서 지금 19:12 (멈추는 중) -> 19:32
 *
 * 예전(2026-10-23 전)에는 일시정지해도 endAt 에 끝나서, 멈춰 둔 동안에도 남은 시간이 줄었습니다.
 */
export function getEndAtWithPauses(
  active: Pick<ActiveCardSession, 'endAt' | 'pauses' | 'pausedNow'>,
  now: number,
): number {
  return active.endAt + getPausedMs(active, now)
}

/**
 * 남은 시간 (밀리초, 0 밑으로는 안 내려감). 일시정지 중에는 줄지 않습니다.
 *
 *   19:00 시작 · 30분 카드, 19:10 에 멈춤 -> 지금 19:12 여도 19:20 이어도 남은 시간 20분
 */
export function getRemainingMs(
  active: Pick<ActiveCardSession, 'endAt' | 'pauses' | 'pausedNow'>,
  now: number,
): number {
  return Math.max(0, getEndAtWithPauses(active, now) - now)
}

/** 지금까지 일시정지한 시간 합 (지금 일시정지 중인 것 포함) */
export function getPausedMs(
  active: Pick<ActiveCardSession, 'pauses' | 'pausedNow'>,
  now: number,
): number {
  const done = summarizePauses(active.pauses).pausedMs
  return done + (active.pausedNow ? Math.max(0, now - active.pausedNow.startedAt) : 0)
}

/**
 * 지금까지 실제로 한 시간 (일시정지 뺌)
 *
 *   19:00 시작, 19:20 ~ 19:25 일시정지, 지금 19:40 -> 35분
 */
export function getRunMs(
  active: Pick<ActiveCardSession, 'startedAt' | 'pauses' | 'pausedNow'>,
  now: number,
): number {
  return Math.max(0, now - active.startedAt - getPausedMs(active, now))
}

/**
 * 진행 중인 세션을 끝내고 저장할 기록을 만듭니다.
 * - endedAt: 끝낸 시각. 끝나는 시각을 넘겨서 끝내도 끝나는 시각까지만 셉니다 (자리를 비운 시간이 실행으로 들어가지 않게)
 *   끝나는 시각은 멈춘 만큼 늦춘 시각입니다. (getEndAtWithPauses)
 * - 일시정지 중에 끝내면 그 일시정지도 끝난 것으로 넣습니다.
 * - 끝나는 시각 전에 끝내면 endedEarly (중도 종료)
 */
export function finishActiveSession(
  active: ActiveCardSession,
  now: number,
  id: string,
): StudySession {
  const endAt = getEndAtWithPauses(active, now)
  const endedAt = Math.min(now, endAt)
  const pauses = active.pausedNow
    ? [
        ...active.pauses,
        closePause(active.pausedNow, Math.max(active.pausedNow.startedAt, endedAt)),
      ]
    : active.pauses
  return {
    id,
    // 카드에 과목이 있으면 기록에도 넣습니다. 그래야 기록 탭의 과목별 시간이 맞습니다. (#652)
    subjectId: active.subjectId ?? '',
    startedAt: active.startedAt,
    endedAt,
    ...summarizePauses(pauses),
    targetMinutes: active.plannedMinutes,
    kind: 'study',
    cardId: active.cardId,
    mode: active.mode,
    pauses,
    endedEarly: endedAt < endAt,
    endReport: { checked: active.checked },
    ...(active.memos.length > 0 ? { memos: active.memos } : {}),
  }
}

/** 지금의 일시정지를 끝난 일시정지로 바꿉니다. 알림을 보냈는지(alerted)는 기록에 남기지 않습니다 */
export function closePause(
  pausedNow: NonNullable<ActiveCardSession['pausedNow']>,
  endedAt: number,
): SessionPause {
  return {
    startedAt: pausedNow.startedAt,
    endedAt,
    tag: pausedNow.tag,
    ...(pausedNow.tags && pausedNow.tags.length > 0 ? { tags: pausedNow.tags } : {}),
    ...(pausedNow.note ? { note: pausedNow.note } : {}),
  }
}

/**
 * 저장된 진행 중 세션. 없거나 모양이 틀리면 null
 * hooks/useCardSession.ts(화면)와 lib/cardAlarms.ts(앱 예약 알림)가 같이 읽습니다.
 */
export function loadActiveCardSession(): ActiveCardSession | null {
  const saved = loadData<unknown>(CARD_SESSION_KEY, null)
  if (typeof saved !== 'object' || saved === null) return null
  const value = saved as Partial<ActiveCardSession>
  const isValid =
    typeof value.cardId === 'string' &&
    typeof value.startedAt === 'number' &&
    typeof value.endAt === 'number' &&
    Array.isArray(value.pauses)
  return isValid ? (saved as ActiveCardSession) : null
}

/** 일시정지가 이만큼(분) 넘으면 복귀 알림을 한 번 보냅니다 (「4.4」 일시정지) */
export const LONG_PAUSE_MINUTES = 15

/**
 * 복귀 알림을 보낼 때인지 — 일시정지 중이고, 15분이 지났고, 아직 안 보냈으면 true
 *
 *   19:20 에 멈춤, 지금 19:34 -> false     지금 19:35 -> true     이미 보냄 -> false
 */
export function shouldAlertLongPause(
  active: Pick<ActiveCardSession, 'pausedNow'>,
  now: number,
): boolean {
  const paused = active.pausedNow
  if (!paused || paused.alerted) return false
  return now - paused.startedAt >= LONG_PAUSE_MINUTES * MS_PER_MINUTE
}

/** 시각을 'HH:MM' 으로 (카드의 startTime 모양) */
function toTimeText(time: number): string {
  const date = new Date(time)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 지금 시각으로 즉석 카드를 만듭니다. (화면 코드가 Date.now() 를 직접 부르지 않게 여기서 시각을 찍습니다) */
export function createInstantCardNow(dateKey: string, minutes: number): Card {
  const now = Date.now()
  return createInstantCard(`card-${now}`, dateKey, now, minutes)
}

/**
 * [지금 시작] 으로 만드는 즉석 카드 — '언제 = 지금' 입니다 (「4.2 홈」).
 * 제목과 체크리스트는 종료 팝업에서 한 줄로 받으므로 처음에는 '지금 시작한 공부' 한 줄입니다.
 * 모든 세션이 카드에 붙어 있어야 분석이 깨지지 않기 때문에 만듭니다.
 */
export function createInstantCard(id: string, dateKey: string, now: number, minutes: number): Card {
  return {
    id,
    title: '지금 시작한 공부',
    date: dateKey,
    startTime: toTimeText(now),
    durationMinutes: minutes,
    checklist: [{ id: `${id}-item-0`, text: '지금 시작한 공부' }],
    priority: 'flexible',
    type: 'self',
    createdAt: now,
  }
}
