import { loadSavedCards } from '@/lib/cards'
import { getTodayKey, moveDateKey } from '@/lib/date'
import { getPlannedStartAt } from '@/lib/facts'
import {
  canWriteCalendar,
  createCardEvent,
  deleteCardEvent,
  listAppCardEvents,
  updateCardEvent,
  type AppCardEvent,
  type CardEventInput,
} from '@/lib/googleCalendar'
import { loadData, saveData } from '@/lib/storage'
import type { Card } from '@/types'

/**
 * 카드를 구글 캘린더 일정으로 맞추는 규칙입니다. (2026-10-25 #736)
 * 사용자: "계획을 구글캘린더에 만들어주거나 해야되는데 … 구글캘린더 연동이 그래서 있는 거임"
 *
 * ■ 무엇을 넣나
 *  - 오늘부터 30일 안의, 시작 시각이 있는 1회성 카드 (AI 계획 방 · 긴 계획 · 직접 만든 카드 모두 "계획" 이라 같이)
 *  - 반복(루틴) 카드는 아직 넣지 않습니다.
 *  - 서버에 올라간 카드(serverId 가 있음)만 넣습니다. 다른 기기에서 열어도 같은 번호로 짝을 지어 두 번 생기지 않게.
 *    (방금 만든 카드는 서버에 올라가 번호를 받은 뒤에 넣습니다. 보통 몇 초 뒤)
 *
 * ■ 어떻게 맞추나 (앱 → 구글 한 방향)
 *  - 구글에서 "앱이 넣은 일정" 만 받아서(lib/googleCalendar.ts 의 표시) 카드와 견줍니다.
 *  - 카드는 있는데 일정이 없으면 넣고, 제목 · 시각이 다르면 고칩니다.
 *  - 지우는 것은 두 가지만: ① 이 기기에서 지워진 카드(지울 목록에 적어 둔 것) ② 카드는 있는데 이제 넣을 카드가 아님
 *    (시각을 지웠거나 반복 카드로 바꿈). 이 기기가 모르는 카드의 일정은 건드리지 않습니다.
 *    (새 기기에서 카드를 아직 못 받았을 때 일정을 몽땅 지우는 일을 막으려고)
 */

/** 오늘부터 며칠 안의 카드를 넣을지 (긴 계획이 30일까지라서) */
export const CALENDAR_SYNC_DAYS = 30

// 지울 일정 목록(서버 카드 번호)을 넣어 두는 이름. 연결이 끝나 있을 때 지운 카드도 다음에 지우려고 저장합니다.
const PENDING_DELETE_KEY = 'calendar-pending-deletes'

/**
 * 카드 하나를 구글 일정으로 바꿉니다. 넣을 카드가 아니면 null 입니다.
 *
 *   10/25 19:00 · 50분 · 수학 오답 (서버 번호 12) -> { cardKey: '12', title: '수학 오답', start: 10/25 19:00, end: 19:50 }
 *   시작 시각 없음 · 반복 카드 · 서버 번호 없음 · 어제 카드 · 31일 뒤 카드 -> null
 */
export function toCardEvent(card: Card, todayKey: string): CardEventInput | null {
  if (!card.serverId) return null
  if (card.repeatDays && card.repeatDays.length > 0) return null
  if (card.date < todayKey || card.date > moveDateKey(todayKey, CALENDAR_SYNC_DAYS)) return null
  // 00:00 ~ 03:59 카드는 달력으로 다음 날 새벽입니다. (lib/facts.ts 규칙 8)
  const start = getPlannedStartAt(card)
  if (start === null) return null
  return {
    cardKey: card.serverId,
    title: card.title,
    start,
    end: start + card.durationMinutes * 60 * 1000,
  }
}

/** 구글에 할 일 하나 */
export type CalendarChange =
  | { kind: 'create'; event: CardEventInput }
  | { kind: 'update'; eventId: string; event: CardEventInput }
  | { kind: 'delete'; eventId: string }

/**
 * 카드와 구글의 앱 일정을 견줘서 할 일을 정합니다. React 도 인터넷도 쓰지 않는 순수 함수입니다.
 *   cards       : 이 기기의 카드 전부
 *   appEvents   : 구글에 이미 있는 앱 일정 (오늘부터 30일)
 *   deletedKeys : 이 기기에서 지워진 카드의 서버 번호들
 *
 *   카드 12(19:00) · 일정 없음                    -> create 12
 *   카드 12(20:00) · 일정 12(19:00)               -> update 12
 *   카드 12 지움(deletedKeys 에 12) · 일정 12      -> delete 12
 *   카드 12 시각을 지움 · 일정 12                  -> delete 12
 *   이 기기에 없는 카드 99 의 일정                  -> 그대로 (아무것도 안 함)
 *   같은 카드의 일정이 두 개                       -> 하나만 남기고 delete
 */
export function planCalendarChanges(
  cards: Card[],
  appEvents: AppCardEvent[],
  deletedKeys: string[],
  todayKey: string,
): CalendarChange[] {
  const wanted = new Map<string, CardEventInput>()
  const knownKeys = new Set<string>()
  for (const card of cards) {
    if (card.serverId) knownKeys.add(card.serverId)
    const event = toCardEvent(card, todayKey)
    if (event) wanted.set(event.cardKey, event)
  }
  const deleted = new Set(deletedKeys)

  const changes: CalendarChange[] = []
  const handledKeys = new Set<string>()
  for (const appEvent of appEvents) {
    const event = wanted.get(appEvent.cardKey)
    if (deleted.has(appEvent.cardKey) && !event) {
      changes.push({ kind: 'delete', eventId: appEvent.eventId })
    } else if (event) {
      if (handledKeys.has(appEvent.cardKey)) {
        // 같은 카드의 일정이 또 있으면(두 기기가 동시에 넣음) 하나만 남깁니다.
        changes.push({ kind: 'delete', eventId: appEvent.eventId })
        continue
      }
      handledKeys.add(appEvent.cardKey)
      const isSame =
        appEvent.title === event.title &&
        appEvent.start === event.start &&
        appEvent.end === event.end
      if (!isSame) changes.push({ kind: 'update', eventId: appEvent.eventId, event })
    } else if (knownKeys.has(appEvent.cardKey)) {
      // 카드는 있는데 이제 넣을 카드가 아닙니다. (시각을 지움 · 반복 카드로 바꿈 · 날짜를 30일 밖으로 옮김)
      changes.push({ kind: 'delete', eventId: appEvent.eventId })
    }
  }
  for (const event of wanted.values()) {
    if (!handledKeys.has(event.cardKey)) changes.push({ kind: 'create', event })
  }
  return changes
}

/**
 * 카드 목록이 바뀌기 전 · 뒤를 견줘서 사라진 카드의 서버 번호를 돌려줍니다.
 *   prev [12, 13] · next [12] -> ['13']
 */
export function removedCardKeys(prev: Card[], next: Card[]): string[] {
  const nextKeys = new Set(next.map((card) => card.serverId).filter(Boolean))
  return prev
    .map((card) => card.serverId)
    .filter((key): key is string => key !== undefined && key !== '' && !nextKeys.has(key))
}

function loadPendingDeletes(): string[] {
  const saved = loadData<unknown>(PENDING_DELETE_KEY, [])
  return Array.isArray(saved) ? saved.filter((key): key is string => typeof key === 'string') : []
}

/** 지워진 카드의 서버 번호를 지울 목록에 더합니다. (다음 맞추기 때 구글 일정도 지움) */
export function addPendingDeletes(keys: string[]): void {
  if (keys.length === 0) return
  saveData(PENDING_DELETE_KEY, [...new Set([...loadPendingDeletes(), ...keys])])
}

/**
 * 이 기기의 카드를 구글 캘린더와 한 번 맞춥니다. 연결이 안 됐거나 쓰기 권한이 없으면 아무것도 안 합니다.
 * 하나씩 차례로 보냅니다. (구글이 한꺼번에 많이 보내면 막아서)
 */
export async function syncCardsToCalendar(): Promise<void> {
  if (!canWriteCalendar()) return
  const todayKey = getTodayKey()
  const deletedKeys = loadPendingDeletes()
  const appEvents = await listAppCardEvents(todayKey, CALENDAR_SYNC_DAYS + 1)
  const changes = planCalendarChanges(loadSavedCards() ?? [], appEvents, deletedKeys, todayKey)
  for (const change of changes) {
    if (change.kind === 'create') await createCardEvent(change.event)
    else if (change.kind === 'update') await updateCardEvent(change.eventId, change.event)
    else await deleteCardEvent(change.eventId)
  }
  // 끝까지 보냈으면 지울 목록을 비웁니다. (중간에 실패하면 남겨 두고 다음에 다시)
  const left = loadPendingDeletes().filter((key) => !deletedKeys.includes(key))
  saveData(PENDING_DELETE_KEY, left)
}
