import { getPlannedStartAt } from '@/lib/facts'
import type { Card, EmotionTag } from '@/types'

/**
 * 카드 시작 알림과 5초 카운트다운 (최종 기획서 「4.4 타이머」 시작, #399)
 *
 * 알림
 *  - 카드에 쓴 문장(없으면 기본 문구) 그대로, 카드의 '몇 분 전'(기본 정각)에 옵니다. 누르면 묻지 않고 바로 시작합니다.
 *  - 예정 시각 3분 뒤까지 시작 안 하면 현재 시각을 넣어 "6시 03분이야. 10분 기다리지 말고 지금 시작해요". [5분 뒤] 는 없습니다.
 *  - 시작 저항이 높으면(설정 earlyAlertMinutes) 10분 전에 한 번 더 알립니다.
 * 5초 카운트다운
 *  - 켜져 있으면 [시작] 뒤에 체크리스트 첫 항목을 아주 작은 준비 행동으로 바꿔 보여 주고, 5초 뒤 시작합니다.
 *  - 켜지는 조건: 설정이 켜짐 또는 그날 감정 태그가 막막함 · 불안함.
 */

const MS_PER_MINUTE = 60 * 1000

/** 예정 시각에서 몇 분 지나면 "지금 시작해요" 를 보낼지 */
export const NUDGE_AFTER_MINUTES = 3
/** 알림 시각이 지난 뒤 이 시간(분) 안에만 보냅니다. (앱을 몇 시간 뒤에 열었을 때 지난 알림이 한꺼번에 오지 않게) */
export const ALERT_WINDOW_MINUTES = 10

export type CardAlertKind = 'early' | 'start' | 'nudge' | 'missed'

/** 지금 보낼 알림 하나 */
export interface DueCardAlert {
  /** 같은 알림을 두 번 보내지 않게 쓰는 이름 (예: 'c1:2026-10-17:start') */
  key: string
  cardId: string
  kind: CardAlertKind
  title: string
  body: string
}

/** '18:03' → '6시 03분' (오후·오전 없이, 학생에게 익숙한 말로) */
export function formatSpokenTime(time: number): string {
  const date = new Date(time)
  const hour = date.getHours() % 12 === 0 ? 12 : date.getHours() % 12
  return `${hour}시 ${String(date.getMinutes()).padStart(2, '0')}분`
}

/**
 * 지금 보낼 카드 알림을 고릅니다. React 도 저장소도 쓰지 않는 순수 함수입니다.
 * - startedCardIds: 오늘 이미 시작했거나(끝냈거나) 미루기 · 실패로 처리한 카드 — 이 카드는 알리지 않습니다
 * - sentKeys: 이미 보낸 알림 이름
 * - earlyMinutes: 10분 전 알림을 더할지 (0 이면 안 함)
 *
 * ■ 예시 (10/17 19:00 수학 카드, 알림 정각)
 *   지금 18:50, earlyMinutes 10 -> [ early ]   지금 19:00 -> [ start ]   지금 19:03 -> [ nudge '7시 03분이야 …' ]
 *   지금 19:30 (start 를 못 보냄)  -> [ nudge ] (start 는 10분이 지나 버림)
 *   지금 20:00 (카드가 끝남)       -> [ missed '수학 시간이 끝났어요' ]
 *   이미 시작한 카드 · 시작 시각이 없는 카드 -> []
 */
export function getDueCardAlerts(
  cards: Card[],
  dateKey: string,
  now: number,
  sentKeys: Set<string>,
  startedCardIds: Set<string>,
  earlyMinutes: number,
): DueCardAlert[] {
  const due: DueCardAlert[] = []
  for (const card of cards) {
    if (startedCardIds.has(card.id)) continue
    const startAt = getPlannedStartAt({ date: dateKey, startTime: card.startTime })
    if (startAt === null) continue
    const endAt = startAt + card.durationMinutes * MS_PER_MINUTE
    const key = (kind: CardAlertKind) => `${card.id}:${dateKey}:${kind}`
    // 알림 시각 ~ 그 뒤 10분 (또는 카드가 끝날 때까지) 안이면 보낼 때입니다.
    // (카드가 끝난 뒤의 'missed' 알림은 아래에서 따로 봅니다)
    const isDue = (at: number, until = at + ALERT_WINDOW_MINUTES * MS_PER_MINUTE) =>
      now >= at && now < Math.min(until, endAt)

    const minutesBefore = card.alert?.minutesBefore ?? 0
    const startAlertAt = startAt - minutesBefore * MS_PER_MINUTE
    if (earlyMinutes > minutesBefore && !sentKeys.has(key('early'))) {
      if (isDue(startAt - earlyMinutes * MS_PER_MINUTE, startAlertAt)) {
        due.push({
          key: key('early'),
          cardId: card.id,
          kind: 'early',
          title: `${earlyMinutes}분 뒤 시작`,
          body: `${card.title} 준비해요.`,
        })
      }
    }
    if (!sentKeys.has(key('start')) && isDue(startAlertAt)) {
      const text = card.alert?.text?.trim() || `${card.title} 시작할 시간이에요.`
      due.push({ key: key('start'), cardId: card.id, kind: 'start', title: card.title, body: text })
    }
    const nudgeAt = startAt + NUDGE_AFTER_MINUTES * MS_PER_MINUTE
    if (!sentKeys.has(key('nudge')) && isDue(nudgeAt, endAt)) {
      due.push({
        key: key('nudge'),
        cardId: card.id,
        kind: 'nudge',
        title: card.title,
        body: `${formatSpokenTime(now)}이야. 10분 기다리지 말고 지금 시작해요.`,
      })
    }
    // 카드 시간이 끝날 때까지 시작하지 않았으면: 미룰지 · 못 했다고 남길지 고르러 오게 합니다. (#400)
    if (
      !sentKeys.has(key('missed')) &&
      now >= endAt &&
      now < endAt + ALERT_WINDOW_MINUTES * MS_PER_MINUTE
    ) {
      due.push({
        key: key('missed'),
        cardId: card.id,
        kind: 'missed',
        title: `${card.title} 시간이 끝났어요`,
        body: '미룰지, 못 했다고 남길지 골라요.',
      })
    }
  }
  return due
}

/** 카운트다운을 켜는 감정 태그 */
const COUNTDOWN_EMOTIONS: EmotionTag[] = ['STUCK', 'ANXIOUS']

/**
 * 5초 카운트다운을 켤지 — 설정이 켜져 있거나 그날 감정 태그에 막막함 · 불안함이 있으면
 * 단, 설정 화면에서 사용자가 직접 고른 값(isUserChoice)이면 감정과 상관없이 그 값을 따릅니다.
 *
 *   isCountdownOn(false, ['CALM'], false) -> false   isCountdownOn(false, ['STUCK'], false) -> true
 *   isCountdownOn(true, [], false) -> true          isCountdownOn(false, ['STUCK'], true) -> false (직접 끔)
 */
export function isCountdownOn(
  settingOn: boolean,
  todayEmotions: EmotionTag[] | undefined,
  isUserChoice: boolean,
): boolean {
  if (isUserChoice) return settingOn
  return settingOn || (todayEmotions ?? []).some((tag) => COUNTDOWN_EMOTIONS.includes(tag))
}

/** [더 작게] 를 누를 수 있는 횟수 */
export const MAX_SHRINK = 2

/**
 * 체크리스트 첫 항목을 아주 작은 준비 행동으로 바꿉니다. AI 가 만든 문장(#413)이 없을 때 쓰는 기본 문장입니다.
 * level 0 → 1 → 2 로 갈수록 더 작아집니다.
 *
 *   getPrepStep('수학 문제집 42쪽', 0) -> '수학 문제집 42쪽 펼쳐 두기'
 *   getPrepStep('수학 문제집 42쪽', 1) -> '수학 문제집 42쪽 첫 줄만 읽기'
 *   getPrepStep('수학 문제집 42쪽', 2) -> '책상에 앉아서 연필 쥐기'
 */
export function getPrepStep(firstItem: string, level: number): string {
  const item = firstItem.trim() || '오늘 할 것'
  if (level <= 0) return `${item} 펼쳐 두기`
  if (level === 1) return `${item} 첫 줄만 읽기`
  return '책상에 앉아서 연필 쥐기'
}
