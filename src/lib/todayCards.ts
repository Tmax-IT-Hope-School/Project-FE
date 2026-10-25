/**
 * 오늘 카드 중 "지금 할 카드 · 다음 카드 · 시간이 끝났는데 처리 안 한 카드" 를 고릅니다. (홈 「4.2」, #405)
 * 타이머 대기 화면(CardTimerPage)이 대기 목록을 만드는 규칙과 같습니다.
 * React 도 저장소도 쓰지 않는 순수 함수입니다.
 *
 *   - 오늘 한 카드(공부 기록이 있는 카드)와, 미루기 · 실패로 처리한 카드는 뺍니다.
 *     단, [끝내기] 로 일찍 끝냈고 카드 시간이 아직 남은 카드는 이어서 할 수 있게 남깁니다. (#709)
 *   - 오늘을 쉰 날로 처리했으면 남은 카드가 없습니다.
 *   - 카드 시간이 끝났는데 시작도 처리도 안 했으면 '처리 안 한 카드' 입니다. (타이머에서 [미루기] / [실패로 기록])
 *   - 나머지 중 시작 시각이 지난 첫 카드가 '지금', 그 뒤 첫 카드가 '다음' 입니다. 시각이 없는 카드는 맨 뒤입니다.
 *   - 홈의 "오늘 계획" 목록(items)은 오늘 카드 전부를 시작 시각 순서로, 카드마다 상태를 붙여 돌려줍니다. (2026-10-18)
 */
import { getCardDayMark, isHandledOnDate, type CardDayMarkRecord } from '@/lib/cardMarks'
import { getCardResult } from '@/lib/cardResult'
import { getCardsOnDate } from '@/lib/cards'
import { toDayKey } from '@/lib/date'
import { getPlannedStartAt } from '@/lib/facts'
import { getSessionCardId } from '@/lib/sessionRecords'
import type { Card, StudySession } from '@/types'

export interface TodayCardsInput {
  /** 저장된 카드 전체 (오늘 하는 것만 여기서 고릅니다) */
  cards: Card[]
  /** 공부 기록 전체 */
  sessions: StudySession[]
  /** 미루기 · 실패 표시 (lib/cardMarks.ts) */
  marks: CardDayMarkRecord[]
  /** 오늘을 쉰 날로 처리했는지 (lib/restDays.ts) */
  isRestDay: boolean
  todayKey: string
  now: number
}

/**
 * 오늘 계획 목록에서 카드 한 장의 상태
 *   done      : 오늘 한 카드 (공부 기록이 있음)
 *   endedEarly: [끝내기] 로 일찍 끝냈고 카드 시간도 끝남 (카드 탭의 '중간에 끝냈어요' 와 같음)
 *   skipped   : 미루기 · 실패로 처리했거나, 오늘을 쉰 날로 처리함
 *   unhandled : 카드 시간이 끝났는데 시작도 처리도 안 함
 *   current   : 지금 할 카드
 *   waiting   : 아직 시간이 안 됐거나 시각이 없는 카드
 */
export type TodayCardStatus =
  'done' | 'endedEarly' | 'skipped' | 'unhandled' | 'current' | 'waiting'

export interface TodayCardItem {
  card: Card
  status: TodayCardStatus
  /** true 면 [끝내기] 로 일찍 끝냈지만 카드 시간이 남아서 이어서 할 수 있는 카드입니다. (상태는 current · waiting) */
  isResumable: boolean
}

export interface TodayCardsState {
  /** 오늘 하는 카드 수 */
  total: number
  /** 오늘 한 카드 수 (공부 기록이 있는 카드. 이어서 할 수 있는 카드는 아직 안 셈) */
  doneCount: number
  /** 시작 시각이 지났고 아직 카드 시간 안인 카드 — [시작] 을 크게 보여 줍니다 */
  current: Card | undefined
  /** 그다음에 할 카드 */
  next: Card | undefined
  /** 카드 시간이 끝났는데 시작도 처리도 안 한 카드 */
  unhandled: Card[]
  /** 오늘 카드 전부 (시작 시각 순서, 시각 없는 카드는 맨 뒤) + 카드마다 상태 */
  items: TodayCardItem[]
}

/** splitRecordedCards 의 결과. 모두 카드 id 입니다. */
export interface RecordedCards {
  /** 끝낸 카드 — 대기 목록에서 뺍니다 */
  finishedIds: Set<string>
  /** 끝낸 카드 중 [끝내기] 로 일찍 끝낸 카드 ('중간에 끝냄' 으로 보여 줌) */
  endedEarlyIds: Set<string>
  /** [끝내기] 로 일찍 끝냈지만 카드 시간이 남아서 이어서 할 수 있는 카드 — 대기 목록에 남깁니다 */
  resumableIds: Set<string>
}

/**
 * 오늘 공부 기록이 있는 카드를 "끝낸 카드" 와 "이어서 할 수 있는 카드" 로 나눕니다. (QA 2026-10-25, #709)
 * 몇 초만 하고 [끝내기] 를 눌러도 홈에 '✅ 끝' 이 떠서 다시 시작할 길이 없어지던 것을 막습니다.
 * 이어서 다시 시작하면 기록이 더해져서, 계획한 시간을 채우면 카드 결과가 '제때 했어요' 가 됩니다. (lib/cardResult.ts 규칙 4)
 * 타이머 대기 화면(CardTimerPage)도 이 함수로 대기 목록에서 뺄 카드를 정합니다.
 *
 *   19:00 · 60분 카드, 19:00 에 10초 하고 [끝내기], 지금 19:05 -> resumableIds
 *   같은 카드, 지금 20:05 (카드 시간이 끝남)                      -> finishedIds · endedEarlyIds
 *   19:00 ~ 20:00 끝까지 함                                      -> finishedIds
 */
export function splitRecordedCards(
  todayCards: Card[],
  sessions: StudySession[],
  todayKey: string,
  now: number,
): RecordedCards {
  const todaySessions = sessions.filter(
    (session) => session.kind !== 'play' && toDayKey(session.startedAt) === todayKey,
  )
  const result: RecordedCards = {
    finishedIds: new Set(),
    endedEarlyIds: new Set(),
    resumableIds: new Set(),
  }
  for (const card of todayCards) {
    const cardSessions = todaySessions.filter(
      (session) => getSessionCardId(session, {}) === card.id,
    )
    if (cardSessions.length === 0) continue
    const isEndedEarly =
      getCardResult({ card, dateKey: todayKey, sessions: cardSessions }, now) === 'endedEarly'
    // 기록이 없다고 치고 판정했을 때 'unhandled' 면 카드 시간이 끝난 것입니다.
    const isTimeOver = getCardResult({ card, dateKey: todayKey, sessions: [] }, now) === 'unhandled'
    if (isEndedEarly && !isTimeOver) {
      result.resumableIds.add(card.id)
      continue
    }
    result.finishedIds.add(card.id)
    if (isEndedEarly) result.endedEarlyIds.add(card.id)
  }
  return result
}

/**
 * 오늘 카드 상태를 계산합니다.
 *
 *   19:00 수학(60분) · 21:00 영어, 지금 19:20  -> current 수학, next 영어
 *   지금 18:00                                -> current 없음, next 수학
 *   수학은 오늘 함, 지금 19:20                 -> current 없음, next 영어, doneCount 1
 *   수학 카드 시간이 끝났고 기록·표시 없음      -> unhandled [수학]
 *   수학을 19:00 에 10초 하고 [끝내기], 지금 19:20 -> current 수학 (이어서 할 수 있음, isResumable)
 */
export function getTodayCardsState(input: TodayCardsInput): TodayCardsState {
  const todayCards = getCardsOnDate(input.cards, input.todayKey)
  const recorded = splitRecordedCards(todayCards, input.sessions, input.todayKey, input.now)
  const doneIds = recorded.finishedIds
  const open = input.isRestDay
    ? []
    : todayCards.filter(
        (card) =>
          !doneIds.has(card.id) &&
          !isHandledOnDate(
            card,
            getCardDayMark(input.marks, card.id, input.todayKey),
            input.todayKey,
          ),
      )
  const unhandled = open.filter(
    (card) =>
      getCardResult({ card, dateKey: input.todayKey, sessions: [] }, input.now) === 'unhandled',
  )
  const waiting = open.filter((card) => !unhandled.includes(card))

  // 시작 시각이 지난 카드(카드 시간 안)가 '지금', 아직 시각이 안 된 카드 · 시각 없는 카드가 '다음' 후보입니다.
  const isStarted = (card: Card) => {
    const startAt = getPlannedStartAt({ date: input.todayKey, startTime: card.startTime })
    return startAt !== null && startAt <= input.now
  }
  const current = waiting.find(isStarted)
  const next = waiting.find((card) => card !== current && !isStarted(card))

  // 카드 한 장의 상태를 위에서 고른 목록으로 정합니다. (한 카드 → 처리 안 함 → 지금 → 남은 카드 → 그 밖은 미룸 · 실패 · 쉰 날)
  function getStatus(card: Card): TodayCardStatus {
    if (recorded.endedEarlyIds.has(card.id)) return 'endedEarly'
    if (doneIds.has(card.id)) return 'done'
    if (unhandled.includes(card)) return 'unhandled'
    if (card === current) return 'current'
    if (waiting.includes(card)) return 'waiting'
    return 'skipped'
  }

  return {
    total: todayCards.length,
    doneCount: todayCards.filter((card) => doneIds.has(card.id)).length,
    current,
    next,
    unhandled,
    items: todayCards.map((card) => ({
      card,
      status: getStatus(card),
      isResumable: recorded.resumableIds.has(card.id),
    })),
  }
}
