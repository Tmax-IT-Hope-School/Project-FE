import { moveDateKey } from '@/lib/date'
import { getDaysUntil } from '@/lib/exams'
import type { RoutineCardSuggestion } from '@/lib/routineCardsApi'
import { loadData, saveData } from '@/lib/storage'
import type { Card, Goal, GoalKind, GoalTargetSnapshot } from '@/types'

/**
 * 목표(최종 기획서 「4.7 목표와 숲」, #391)를 읽고 쓰는 순수 함수들입니다.
 * 목표를 들고 있는 훅은 hooks/useGoals.ts, 만드는 화면은 pages/GoalNewPage.tsx 입니다.
 */

// 저장소에 넣는 이름입니다. (실제 키는 storage.ts 가 앞에 'study-' 를 붙여서 'study-goals' 가 됩니다)
export const GOALS_KEY = 'goals'

/** 동시에 진행할 수 있는 목표 수 */
export const MAX_ACTIVE_GOALS = 3

export const GOAL_TITLE_MAX_LENGTH = 40
export const GOAL_TEXT_MAX_LENGTH = 100

/** 유형마다 화면에 보일 이름과 예시 */
export const GOAL_KIND_OPTIONS: { value: GoalKind; label: string; example: string }[] = [
  { value: 'score', label: '점수형', example: '예: 11월 학평 수학 3등급' },
  { value: 'completion', label: '완주형', example: '예: 기말 전 영단어장 1회독' },
]

/**
 * 고를 수 있는 "내 안의 방해물" 예시. 학원·날씨처럼 내가 바꿀 수 없는 것은 넣지 않습니다. (WOOP 의 O 는 내부 원인만)
 * 여기 없는 것은 직접 적습니다.
 */
export const INNER_OBSTACLE_EXAMPLES = [
  '폰을 자꾸 보게 돼요',
  '피곤하다고 미뤄요',
  '하기 싫어서 시작을 못 해요',
  '계획을 너무 크게 잡아요',
  '딴생각이 많아요',
]

/** 진행 중인 목표만 */
export function getActiveGoals(goals: Goal[]): Goal[] {
  return goals.filter((goal) => goal.status === 'active')
}

/** 결과를 적고 마무리한 목표만, D-day 가 늦은 것부터 (카드 탭 '완료한 목표', #672) */
export function getDoneGoals(goals: Goal[]): Goal[] {
  return goals
    .filter((goal) => goal.status === 'done')
    .sort((a, b) => (a.dDay < b.dDay ? 1 : a.dDay > b.dDay ? -1 : 0))
}

/** 목표를 하나 더 만들 수 있는지 (진행 중 3개 미만) */
export function canAddGoal(goals: Goal[]): boolean {
  return getActiveGoals(goals).length < MAX_ACTIVE_GOALS
}

/** 카드 폼의 "목표 연결" 기본값 = 가장 최근에 만든 진행 중 목표. 없으면 undefined */
export function getLatestActiveGoal(goals: Goal[]): Goal | undefined {
  return getActiveGoals(goals).sort((a, b) => b.createdAt - a.createdAt)[0]
}

/**
 * 목표값(목표 한 줄 · D-day · 지금 점수 · 전체 분량)을 고칩니다. 고치기 전 값은 history 에 남깁니다.
 * 원래 목표를 지우지 않아서, 나중에 "처음엔 3등급이 목표였다" 를 보여 줄 수 있습니다. (3·7번 오류 대응)
 *
 *   changeGoalTarget({ title: '수학 3등급', history: [] }, { title: '수학 4등급' }, '시간이 모자라서', 1000)
 *     -> { title: '수학 4등급', history: [{ title: '수학 3등급', changedAt: 1000, reason: '시간이 모자라서', … }] }
 */
export function changeGoalTarget(
  goal: Goal,
  changes: Partial<Pick<Goal, 'title' | 'dDay' | 'currentScore' | 'totalAmount' | 'amountUnit'>>,
  reason: string,
  now: number,
): Goal {
  const snapshot: GoalTargetSnapshot = {
    title: goal.title,
    dDay: goal.dDay,
    currentScore: goal.currentScore,
    totalAmount: goal.totalAmount,
    amountUnit: goal.amountUnit,
    changedAt: now,
    reason,
  }
  return { ...goal, ...changes, history: [...goal.history, snapshot] }
}

/**
 * 완주형 목표의 하루 분량 = 전체 분량 ÷ 남은 날 수 (올림). 오늘도 하루로 셉니다.
 * D-day 가 오늘이거나 지났으면 남은 날을 1로 봅니다.
 *
 *   getDailyPace(300, '2026-10-17', '2026-10-26') -> 30   (10일: 17 ~ 26일)
 *   getDailyPace(100, '2026-10-17', '2026-10-17') -> 100
 */
export function getDailyPace(totalAmount: number, todayKey: string, dDay: string): number {
  const days = Math.max(1, getDaysUntil(dDay, dateKeyToNoon(todayKey)) + 1)
  return Math.ceil(totalAmount / days)
}

/** 'YYYY-MM-DD' 의 그날 낮 12시 (하루 기준 시각 새벽 4시와 헷갈리지 않게 낮으로 잡습니다) */
function dateKeyToNoon(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

/**
 * P 계획을 루틴 카드 2장으로 바꾼 기본 제안입니다. (서버의 AI 제안 BE#239 가 생기기 전까지 이 2장을 씁니다)
 *
 * 1. 평일 루틴 — 체크리스트 첫 줄이 "방해물이 생겼을 때의 대처" 입니다. 완주형이면 둘째 줄이 하루 분량입니다.
 * 2. 주말 점검 — 밀린 분량을 채우고 다음 주를 정합니다.
 *
 *   suggestRoutineCards({ id: 'g1', title: '영단어장 1회독', kind: 'completion', totalAmount: 300, amountUnit: '쪽',
 *                         dDay: '2026-10-26', plan: '폰을 다른 방에 두기', … }, '2026-10-17', 1000)
 *     -> [ { title: '영단어장 1회독 루틴', repeatDays: [1,2,3,4,5], startTime: '19:00', checklist: ['폰을 다른 방에 두기', '30쪽 하기'] … },
 *          { title: '영단어장 1회독 주말 점검', repeatDays: [6], startTime: '10:00', … } ]
 */
export function suggestRoutineCards(goal: Goal, todayKey: string, now: number): Card[] {
  const plan = goal.plan.trim()
  const amountItem =
    goal.kind === 'completion' && goal.totalAmount
      ? `${getDailyPace(goal.totalAmount, todayKey, goal.dDay)}${goal.amountUnit ?? ''} 하기`
      : '오늘 분량 끝내기'
  const weekdayChecklist = plan !== '' ? [plan, amountItem] : [amountItem]

  // 내일부터 시작합니다. 오늘 저녁 시간이 이미 지났을 수 있어서입니다.
  const startDate = moveDateKey(todayKey, 1)
  const base = {
    date: startDate,
    goalId: goal.id,
    priority: 'flexible' as const,
    type: 'self' as const,
    createdAt: now,
  }
  const weekdayId = `card-${now}-routine`
  const weekendId = `card-${now}-weekend`

  return [
    {
      ...base,
      id: weekdayId,
      title: `${goal.title} 루틴`,
      repeatDays: [1, 2, 3, 4, 5],
      startTime: '19:00',
      durationMinutes: 50,
      checklist: weekdayChecklist.map((text, index) => ({
        id: `${weekdayId}-item-${index}`,
        text,
      })),
    },
    {
      ...base,
      id: weekendId,
      title: `${goal.title} 주말 점검`,
      repeatDays: [6],
      startTime: '10:00',
      durationMinutes: 60,
      checklist: ['이번 주 밀린 분량 채우기', '다음 주 분량 정하기'].map((text, index) => ({
        id: `${weekendId}-item-${index}`,
        text,
      })),
    },
  ]
}

/**
 * AI 가 제안한 루틴 카드(lib/routineCardsApi.ts)를 그 목표의 카드로 바꿉니다. 기본 제안과 같이 내일부터 시작합니다.
 * 요일 · 시각 · 길이는 서버 코드가 정한 값 그대로이고, 우선순위는 유연 · 유형은 자습입니다.
 *
 *   toRoutineCards([{ title: '영단어 30쪽', repeatDays: [1,2,3,4,5], startTime: '19:00', durationMinutes: 50,
 *                     checklist: ['폰을 다른 방에 두고 오기'] }], { id: 'g1', … }, '2026-10-17', 1000)
 *     -> [ { id: 'card-1000-ai-0', title: '영단어 30쪽', date: '2026-10-18', goalId: 'g1',
 *            checklist: [{ id: 'card-1000-ai-0-item-0', text: '폰을 다른 방에 두고 오기' }], … } ]
 */
export function toRoutineCards(
  suggestions: RoutineCardSuggestion[],
  goal: Goal,
  todayKey: string,
  now: number,
): Card[] {
  return suggestions.map((suggestion, cardIndex) => {
    const id = `card-${now}-ai-${cardIndex}`
    return {
      id,
      title: suggestion.title,
      date: moveDateKey(todayKey, 1),
      repeatDays: [...suggestion.repeatDays],
      startTime: suggestion.startTime,
      durationMinutes: suggestion.durationMinutes,
      checklist: suggestion.checklist.map((text, index) => ({ id: `${id}-item-${index}`, text })),
      goalId: goal.id,
      priority: 'flexible',
      type: 'self',
      createdAt: now,
    }
  })
}

/** 저장소에서 꺼낸 값이 목표 모양이 맞는지 확인합니다. (깨진 값이 섞이면 화면이 멈춥니다) */
function isGoal(value: unknown): value is Goal {
  if (typeof value !== 'object' || value === null) return false
  const goal = value as Record<string, unknown>
  return (
    typeof goal.id === 'string' &&
    typeof goal.title === 'string' &&
    typeof goal.dDay === 'string' &&
    typeof goal.status === 'string' &&
    Array.isArray(goal.history)
  )
}

/** 저장된 목표 목록을 불러옵니다. 모양이 틀린 것은 빼고 돌려줍니다. */
export function loadGoals(): Goal[] {
  const saved = loadData<unknown>(GOALS_KEY, [])
  return Array.isArray(saved) ? saved.filter(isGoal) : []
}

/** 목표가 저장될 때마다 보내는 이벤트 이름입니다. useGoals 가 다시 읽고, useGoalSync 가 서버로 보냅니다. (#516) */
export const GOALS_CHANGED_EVENT = 'study-goals-changed'

/**
 * 이벤트에 담는 값. 바뀌기 전 · 뒤의 목표 목록과 누가 바꿨는지입니다. (카드의 CardsChangedDetail 과 같은 약속)
 * - local: 이 기기에서 사람이 바꿈 → 서버로도 보냅니다
 * - server: 서버에서 받은 것으로 맞춤 → 다시 보내지 않습니다
 */
export interface GoalsChangedDetail {
  prev: Goal[]
  next: Goal[]
  source: 'local' | 'server'
}

/** 목표 목록을 저장하고, 바뀌었다고 알립니다. 목표를 저장하는 곳은 모두 이 함수를 씁니다. (lib/goalSync.ts) */
export function saveGoals(goals: Goal[], source: 'local' | 'server' = 'local'): void {
  const prev = loadGoals()
  saveData(GOALS_KEY, goals)
  const detail: GoalsChangedDetail = { prev, next: goals, source }
  window.dispatchEvent(new CustomEvent(GOALS_CHANGED_EVENT, { detail }))
}
