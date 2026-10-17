/**
 * 하루 한 번 하는 "1탭 체크인" 의 규칙입니다. (#242)
 *
 * 그날 앱을 처음 열면 기분 하나만 묻고(components/ui/DailyCheckInScreen.tsx), 그 답으로 오늘의 체크인을 만듭니다.
 * 컨디션·예상 시간·약속까지 적는 자세한 체크인은 /check 화면(pages/CheckPage.tsx)에 그대로 있습니다.
 */
import { toDayKey } from '@/lib/date'
import { loadInitialPlan } from '@/lib/initialPlan'
import { loadData, saveData } from '@/lib/storage'
import type { CheckIn, StudyPlan } from '@/types'

// 저장소에 넣는 이름입니다. hooks/useCheckIns.ts · hooks/usePlans.ts 와 같은 값이어야 합니다.
const CHECKINS_KEY = 'checkins'
const PLANS_KEY = 'plans'

/** 기분 버튼 5개. 이모지 + 한국어 설명으로 보여줍니다. (1 이 가장 처짐, 5 가 가장 좋음) */
export const MOOD_OPTIONS = [
  { value: 1, emoji: '😞', label: '많이 처짐' },
  { value: 2, emoji: '🙁', label: '처짐' },
  { value: 3, emoji: '😐', label: '보통' },
  { value: 4, emoji: '🙂', label: '좋음' },
  { value: 5, emoji: '😄', label: '아주 좋음' },
]

/** 저장소에서 꺼낸 값이 { 날짜: 값 } 모양의 객체면 그대로, 아니면 빈 객체를 돌려줍니다. (깨진 값이 섞여도 앱이 멈추지 않게) */
function loadByDate(key: string): Record<string, unknown> {
  const saved = loadData<unknown>(key, {})
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return {}
  return saved as Record<string, unknown>
}

/**
 * 그 날짜에 체크인을 했는지 알려줍니다. 1탭 체크인이든 자세한 체크인이든 하나라도 있으면 true 입니다.
 *
 *   hasCheckIn('2026-10-10') -> true  (오늘 이미 했음)
 */
export function hasCheckIn(dateKey: string): boolean {
  const checkIn = loadByDate(CHECKINS_KEY)[dateKey]
  return typeof checkIn === 'object' && checkIn !== null
}

/**
 * 오늘 예상 순공시간(분)을 정합니다. 따로 묻지 않고 이미 있는 숫자를 씁니다.
 *   1) 오늘 공부 계획의 목표 시간을 모두 더한 값 (노는 계획은 뺍니다)
 *   2) 오늘 계획이 아직 없으면 fallbackMinutes (온보딩에서 정한 하루 목표)
 *
 *   getPlannedMinutes([수학 60분, 영어 30분, 놀기 20분], 120) -> 90
 *   getPlannedMinutes([], 120)                               -> 120
 */
export function getPlannedMinutes(plans: StudyPlan[], fallbackMinutes: number): number {
  let total = 0
  for (const plan of plans) {
    if (plan.kind !== 'play') total += plan.targetMinutes
  }
  return total > 0 ? total : fallbackMinutes
}

/**
 * 기분 하나로 체크인을 만듭니다.
 * 컨디션은 따로 묻지 않아서 기분과 같은 값으로 채웁니다. (관리 강도·안전 브레이크 계산이 그대로 돌아가게)
 *
 *   makeQuickCheckIn('2026-10-10', 4, 90)
 *   -> { date: '2026-10-10', condition: 4, mood: 4, expectedMinutes: 90, isQuick: true }
 */
export function makeQuickCheckIn(dateKey: string, mood: number, expectedMinutes: number): CheckIn {
  return { date: dateKey, condition: mood, mood, expectedMinutes, isQuick: true }
}

/**
 * 고른 기분으로 오늘의 체크인을 만들어 저장합니다. (1탭 체크인 화면에서 부릅니다)
 * 저장소를 바로 읽고 써서, 체크인 화면(/check)을 열면 방금 저장한 값이 그대로 보입니다.
 * 날짜는 새벽 4시 기준입니다. (새벽 1시에 누르면 전날의 체크인으로 저장됩니다)
 */
export function saveQuickCheckIn(mood: number, today: Date = new Date()): void {
  const dateKey = toDayKey(today)

  const todayPlans = loadByDate(PLANS_KEY)[dateKey]
  const plans = Array.isArray(todayPlans) ? (todayPlans as StudyPlan[]) : []
  const fallbackMinutes = loadInitialPlan()?.dailyMinutes ?? 0

  const checkIn = makeQuickCheckIn(dateKey, mood, getPlannedMinutes(plans, fallbackMinutes))
  saveData(CHECKINS_KEY, { ...loadByDate(CHECKINS_KEY), [dateKey]: checkIn })
}
