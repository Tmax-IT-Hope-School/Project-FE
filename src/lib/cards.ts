import { getWeekday } from '@/lib/routines'
import { loadData, saveData } from '@/lib/storage'
import type { Card, Routine, StudyPlan } from '@/types'

/**
 * 카드(최종 기획서 「4.3 카드」)를 읽고 옮기는 순수 함수들입니다. (#379)
 * 카드를 들고 있는 훅은 hooks/useCards.ts 입니다.
 */

// 저장소에 넣는 이름입니다. (실제 키는 storage.ts 가 앞에 'study-' 를 붙여서 'study-cards' 가 됩니다)
export const CARDS_KEY = 'cards'

/** 1회성 카드인지 (반복 요일이 없으면 1회성) */
export function isOneOffCard(card: Pick<Card, 'repeatDays'>): boolean {
  return card.repeatDays === undefined || card.repeatDays.length === 0
}

/**
 * 그 날짜에 하는 카드인지 알려 줍니다.
 *
 * - 1회성 카드: 카드 날짜와 같은 날만
 * - 반복 카드: 반복을 시작한 날짜부터 그만하는 날(endDate, 있으면)까지, 그 요일이면
 * 서버의 Card.isOnDate 와 같은 규칙입니다. (#734)
 *
 *   (2026-10-12 는 월요일)
 *   isCardOnDate({ date: '2026-10-12' }, '2026-10-12')                       -> true
 *   isCardOnDate({ date: '2026-10-12' }, '2026-10-13')                       -> false
 *   isCardOnDate({ date: '2026-10-01', repeatDays: [1, 3] }, '2026-10-12')   -> true  (월요일)
 *   isCardOnDate({ date: '2026-10-01', repeatDays: [1, 3] }, '2026-10-13')   -> false (화요일)
 *   isCardOnDate({ date: '2026-10-20', repeatDays: [1, 3] }, '2026-10-12')   -> false (시작 전)
 *   isCardOnDate({ date: '2026-10-01', repeatDays: [1, 3], endDate: '2026-10-12' }, '2026-10-12') -> true  (그날까지 함)
 *   isCardOnDate({ date: '2026-10-01', repeatDays: [1, 3], endDate: '2026-10-12' }, '2026-10-14') -> false (그만한 뒤)
 */
export function isCardOnDate(
  card: Pick<Card, 'date' | 'repeatDays' | 'endDate'>,
  dateKey: string,
): boolean {
  const repeatDays = card.repeatDays ?? []
  if (repeatDays.length === 0) return card.date === dateKey
  // 'YYYY-MM-DD' 는 글자로 비교해도 날짜 순서와 같습니다.
  const isEnded = card.endDate !== undefined && dateKey > card.endDate
  return dateKey >= card.date && !isEnded && repeatDays.includes(getWeekday(dateKey))
}

/** 그 날짜에 하는 카드를 시작 시각 순서로 돌려줍니다. 시작 시각이 없는 카드는 맨 뒤에 둡니다. */
export function getCardsOnDate(cards: Card[], dateKey: string): Card[] {
  return cards
    .filter((card) => isCardOnDate(card, dateKey))
    .sort((a, b) => (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99'))
}

/**
 * 옛 계획(StudyPlan) · 루틴(Routine)을 카드로 옮깁니다. React 도 저장소도 쓰지 않는 순수 함수입니다.
 *
 * ■ 규칙
 * 1. 루틴 한 개 → 반복 카드 한 장. 카드 id 는 루틴 id 를 그대로 씁니다.
 * 2. 루틴이 만든 계획(routineId 가 있는 것)은 그 루틴 카드가 대신하므로 옮기지 않습니다.
 *    단, 루틴이 지워져 없으면 그 계획은 1회성 카드로 옮깁니다.
 * 3. 그 밖의 공부 계획 → 1회성 카드. 카드 id 는 계획 id 를 그대로 씁니다.
 *    (옛 타이머 기록의 planId 로 카드를 찾을 수 있게 하려는 것입니다)
 * 4. 노는 계획·노는 루틴은 옮기지 않습니다. 놀기는 카드가 아니라 놀기 타이머가 맡습니다 (「4.4 타이머」).
 * 5. 체크리스트는 할 일 내용 한 줄로 만듭니다. 우선순위는 유연, 유형은 자습입니다.
 *
 * ■ 예시 (now = 1000)
 *   루틴 R(월·수 수학 60분 19:00), 계획 P1(10-12, routineId R), 계획 P2(10-13, 영어 30분)
 *   migratePlansToCards({ '2026-10-12': [P1], '2026-10-13': [P2] }, [R], 1000)
 *     -> [ { id: R.id, title: '수학', date: '2026-10-12', repeatDays: [1, 3], startTime: '19:00', durationMinutes: 60, … },
 *          { id: P2.id, title: '영어', date: '2026-10-13', durationMinutes: 30, … } ]
 */
export function migratePlansToCards(
  plansByDate: Record<string, StudyPlan[]>,
  routines: Routine[],
  now: number,
): Card[] {
  const allPlans = Object.values(plansByDate).flat()
  const routineIds = new Set(routines.map((routine) => routine.id))

  const routineCards: Card[] = routines
    .filter((routine) => routine.kind !== 'play')
    .map((routine) => ({
      ...baseCard(routine.id, routine.content, routine.targetMinutes, now),
      // 반복을 시작한 날짜는 그 루틴으로 처음 만든 계획의 날짜로 봅니다. 없으면 가장 이른 계획 날짜.
      date: firstPlanDate(allPlans, routine.id) ?? firstDate(plansByDate),
      repeatDays: [...routine.weekdays],
      ...(routine.startTime ? { startTime: routine.startTime } : {}),
    }))

  const planCards: Card[] = allPlans
    .filter((plan) => plan.kind !== 'play')
    .filter((plan) => plan.routineId === undefined || !routineIds.has(plan.routineId))
    .map((plan) => ({
      ...baseCard(plan.id, plan.content, plan.targetMinutes, now),
      date: plan.date,
      ...(plan.startTime ? { startTime: plan.startTime } : {}),
    }))

  return [...routineCards, ...planCards]
}

/** 옮긴 카드의 공통 칸 (체크리스트 = 할 일 한 줄, 유연 · 자습) */
function baseCard(id: string, content: string, minutes: number, now: number) {
  const title = content.trim() === '' ? '공부' : content.trim()
  return {
    id,
    title,
    durationMinutes: minutes,
    checklist: [{ id: `${id}-item-0`, text: title }],
    priority: 'flexible' as const,
    type: 'self' as const,
    createdAt: now,
  }
}

/** 그 루틴으로 만든 계획 중 가장 이른 날짜 */
function firstPlanDate(plans: StudyPlan[], routineId: string): string | undefined {
  const dates = plans.filter((plan) => plan.routineId === routineId).map((plan) => plan.date)
  return dates.sort()[0]
}

/** 계획이 있는 날짜 중 가장 이른 날짜. 계획이 하나도 없으면 아주 이른 날짜(모든 날에 반복) */
function firstDate(plansByDate: Record<string, StudyPlan[]>): string {
  return Object.keys(plansByDate).sort()[0] ?? '2000-01-01'
}

/** 저장소에서 꺼낸 값이 카드 모양이 맞는지 확인합니다. (체크리스트가 없는 깨진 값이 섞이면 화면이 멈춥니다) */
function isCard(value: unknown): value is Card {
  if (typeof value !== 'object' || value === null) return false
  const card = value as Record<string, unknown>
  return (
    typeof card.id === 'string' &&
    typeof card.title === 'string' &&
    typeof card.date === 'string' &&
    Array.isArray(card.checklist)
  )
}

/**
 * 저장된 카드 목록을 불러옵니다. 모양이 틀린 것은 빼고 돌려줍니다.
 * 카드를 한 번도 저장한 적이 없으면(옛 버전에서 올라온 사람) undefined 를 돌려줍니다 → 옛 계획을 옮길 차례라는 뜻입니다.
 */
export function loadSavedCards(): Card[] | undefined {
  const saved = loadData<unknown>(CARDS_KEY, undefined)
  if (saved === undefined) return undefined
  return Array.isArray(saved) ? saved.filter(isCard) : []
}

/** 카드가 저장될 때마다 보내는 이벤트 이름입니다. useCards 가 다시 읽고, useCardSync 가 서버로 보냅니다. (#516) */
export const CARDS_CHANGED_EVENT = 'study-cards-changed'

/**
 * 이벤트에 담는 값. 바뀌기 전 · 뒤의 카드 목록과 누가 바꿨는지입니다.
 * - local: 이 기기에서 사람이 바꿈 → 서버로도 보냅니다
 * - server: 서버에서 받은 것으로 맞춤(서버 번호 붙이기 · 다른 기기에서 만든 카드) → 다시 보내지 않습니다
 */
export interface CardsChangedDetail {
  prev: Card[]
  next: Card[]
  source: 'local' | 'server'
}

/**
 * 카드 목록을 저장하고, 바뀌었다고 알립니다.
 * 카드를 저장하는 곳은 모두 이 함수를 써야 서버와 맞출 수 있습니다. (lib/cardSync.ts)
 */
export function saveCards(cards: Card[], source: 'local' | 'server' = 'local'): void {
  const prev = loadSavedCards() ?? []
  saveData(CARDS_KEY, cards)
  const detail: CardsChangedDetail = { prev, next: cards, source }
  window.dispatchEvent(new CustomEvent(CARDS_CHANGED_EVENT, { detail }))
}
