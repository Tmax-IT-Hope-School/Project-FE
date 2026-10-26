import { isMissResult, type CardResult } from '@/lib/cardResult'
import { isDateKey, moveDateKey } from '@/lib/date'
import type { JudgedCardDay } from '@/lib/relapseSignal'
import { loadData, saveData } from '@/lib/storage'
import type { Card } from '@/types'

/**
 * 일정 조정 제안 (2026-10-26, 주인이 규칙을 고름)
 * 주인: "계속 타이머를 안 켜고 시간을 안 지키면 「목표 달성을 위해 조정하는 게 어때?」 처럼 일정 조정을 제안한다"
 *
 * ■ 규칙 — "시각을 정한 카드의 절반 넘게 제시간에 시작하지 못한 날" 이 3일 연속이면 제안합니다.
 * 1. 하루에 보는 카드 = 시작 시각이 있는 카드 중 판정이 끝난 것 (cardDays.ts 의 buildJudgedCardDays)
 *    - 쉬었어요(rest) · 나중에 적었어요(selfReport) 는 뺍니다. (쉰 것은 잘못이 아니고, 사후 입력은 시작 시각을 모름)
 * 2. "제시간에 시작하지 못함" = 늦게 시작(late, 10분 넘게 늦음) 또는 미실행(미루기 · 실패 · 정리 안 함, isMissResult)
 *    "제시간" 은 예정 시각 + 10분 안에 타이머를 켠 것입니다. (planResult.ts 의 ON_TIME_GRACE_MINUTES)
 * 3. 제시간에 시작하지 못한 카드가 그날 카드의 절반보다 많으면(딱 절반은 아님) "못 지킨 날" 입니다.
 * 4. 어제부터 하루씩 거슬러 셉니다. 오늘은 아직 안 끝나서 보지 않습니다. 최대 14일 전까지만 봅니다.
 *    - 볼 카드가 하나도 없는 날(카드 없는 날 · 쉰 날)은 건너뜁니다. 연속을 끊지도, 세지도 않습니다.
 *    - "못 지킨 날" 이 아닌 날이 나오면 거기서 멈춥니다.
 * 5. 이어진 날이 3일 이상이면 제안합니다.
 *
 * ■ 예시 (오늘 10/26)
 *   10/25 카드 3개 중 2개 늦음 · 10/24 2개 중 2개 못 함 · 10/23 카드 없음 · 10/22 4개 중 3개 늦음  -> 3일 → 제안
 *   10/25 카드 2개 중 1개 늦음 (딱 절반)                                                       -> 0일 → 제안 안 함
 *
 * React 를 쓰지 않는 순수 함수입니다. (아래 [괜찮아요] 저장만 저장소를 씁니다)
 */

/** 며칠 연속이면 제안하는지 */
export const SCHEDULE_ADJUST_STREAK_DAYS = 3
/** 연속을 셀 때 거슬러 올라가는 최대 날 수 */
export const SCHEDULE_ADJUST_LOOKBACK_DAYS = 14
/** [괜찮아요] 를 누르면 며칠 동안 숨기는지 */
export const SCHEDULE_ADJUST_HIDE_DAYS = 3

/** "못 지킨 날" 하루의 숫자 */
export interface MissedTimeDay {
  /** 'YYYY-MM-DD' */
  dateKey: string
  /** 그날 본 카드 수 (시작 시각이 있고, 쉼 · 사후 입력이 아닌 카드) */
  timedCount: number
  /** 그중 제시간(10분 안)에 시작하지 못한 카드들. 사실 줄의 예시에 씁니다 */
  notOnTime: { cardId: string; result: CardResult }[]
}

/** 제시간에 시작하지 못한 결과인지 (늦게 시작 · 미루기 · 실패 · 정리 안 함) */
function isNotOnTime(result: CardResult): boolean {
  return result === 'late' || isMissResult(result)
}

/**
 * 어제부터 거슬러 "못 지킨 날" 이 이어진 날들을 돌려줍니다. (최근 날이 앞)
 * 돌려준 목록의 길이가 연속 일수입니다. 3 이상이면 제안합니다. (shouldSuggestScheduleAdjust)
 *
 *   getMissedTimeStreak(판정 목록, 카드들, '2026-10-26')
 *     -> [{ dateKey: '2026-10-25', timedCount: 3, notOnTime: [2개] }, { dateKey: '2026-10-24', … }, …]
 */
export function getMissedTimeStreak(
  judgedDays: JudgedCardDay[],
  cards: Card[],
  todayKey: string,
): MissedTimeDay[] {
  // 시작 시각이 있는 카드 id 만 모아 둡니다.
  const timedCardIds = new Set(cards.filter((card) => card.startTime).map((card) => card.id))

  const streak: MissedTimeDay[] = []
  // back = 1 이 어제입니다. 오늘(back = 0)은 아직 안 끝나서 보지 않습니다.
  for (let back = 1; back <= SCHEDULE_ADJUST_LOOKBACK_DAYS; back += 1) {
    const dateKey = moveDateKey(todayKey, -back)
    const timedDays = judgedDays.filter(
      (day) =>
        day.dateKey === dateKey &&
        timedCardIds.has(day.cardId) &&
        day.result !== 'rest' &&
        day.result !== 'selfReport',
    )
    // 볼 카드가 없는 날은 건너뜁니다. (연속을 끊지도 세지도 않음)
    if (timedDays.length === 0) continue

    const notOnTime = timedDays
      .filter((day) => isNotOnTime(day.result))
      .map((day) => ({ cardId: day.cardId, result: day.result }))
    // 절반보다 많아야 "못 지킨 날" 입니다. (3개 중 2개 → 맞음, 2개 중 1개 → 아님)
    const isMissedDay = notOnTime.length * 2 > timedDays.length
    if (!isMissedDay) break

    streak.push({ dateKey, timedCount: timedDays.length, notOnTime })
  }
  return streak
}

/** 이어진 날이 3일 이상이면 제안합니다. */
export function shouldSuggestScheduleAdjust(streak: MissedTimeDay[]): boolean {
  return streak.length >= SCHEDULE_ADJUST_STREAK_DAYS
}

// ---- [괜찮아요] 로 3일 숨기기 ----

// 저장 이름 (실제 키는 'study-schedule-adjust-dismissed'). [괜찮아요] 를 누른 날짜('YYYY-MM-DD')를 둡니다.
const DISMISSED_KEY = 'schedule-adjust-dismissed'

/** [괜찮아요] 를 누른 날짜. 없거나 모양이 틀리면 null (깨진 값 때문에 영영 숨지 않게 날짜인지 확인) */
export function loadScheduleAdjustDismissed(): string | null {
  const saved = loadData<unknown>(DISMISSED_KEY, null)
  return typeof saved === 'string' && isDateKey(saved) ? saved : null
}

/** 오늘 [괜찮아요] 를 눌렀다고 적어 둡니다. */
export function dismissScheduleAdjust(todayKey: string): void {
  saveData(DISMISSED_KEY, todayKey)
}

/**
 * [괜찮아요] 를 누른 날부터 3일 동안은 숨깁니다.
 *
 *   isScheduleAdjustHidden('2026-10-24', '2026-10-26') -> true  (누른 날 · 다음 날 · 그다음 날)
 *   isScheduleAdjustHidden('2026-10-24', '2026-10-27') -> false
 *   isScheduleAdjustHidden(null, '2026-10-26')         -> false
 */
export function isScheduleAdjustHidden(dismissedKey: string | null, todayKey: string): boolean {
  if (dismissedKey === null) return false
  return todayKey < moveDateKey(dismissedKey, SCHEDULE_ADJUST_HIDE_DAYS)
}
