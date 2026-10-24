import { loadData, saveData } from '@/lib/storage'

/**
 * 주간 리포트에서 고르는 "다음 주에 하나만 해 볼 것" 입니다. (2026-10-24 History 시안)
 *
 *   주간 리포트 아래 [다음 주에 하나만 해 볼까요?] → 하나 고르고 [이걸로 정하기] → 다음 주의 '이번 주에 고른 것'
 *   다음 주가 끝나면 그 주 리포트가 "공부한 5일 중 4일 했어요" 처럼 결과를 보여 주고 [1주 더 해 보기] · [사용설명서에 넣기]
 *
 * '지켰어?' 를 따로 묻지 않습니다. 그 주에 계획을 끝까지 해낸 날로 결과를 봅니다. (lib/historyReport.ts)
 * 지금은 이 기기(localStorage)에만 저장합니다. 서버에 올리려면 BE 에 새 표가 필요합니다.
 */

// 저장소 이름 (실제 키는 'study-weekly-picks'). "모든 기록 지우기" 가 이 키도 지웁니다. (lib/myData.ts)
export const WEEKLY_PICKS_KEY = 'weekly-picks'

export interface WeeklyPick {
  /** 고유 값. 시연용 가상 데이터는 'demo-' 로 시작합니다 */
  id: string
  /** 이 방법을 해 보는 주의 월요일 ('YYYY-MM-DD') */
  weekStart: string
  /** 해 볼 것 한 줄 (예: '폰을 다른 방에 두기') */
  title: string
  /** 왜 이걸 하는지 짧게 (예: '손이 안 닿으면 덜 멈춰요') */
  hint: string
  /** true 면 "이번 주는 넘어가기" 를 고른 것 (해 볼 것이 없는 주) */
  skip: boolean
  /** 고른 시각 (Date.now() 값) */
  decidedAt: number
}

/** 저장된 값이 WeeklyPick 모양인지 봅니다. (깨진 항목 하나가 화면을 멈추지 않게) */
function isWeeklyPick(value: unknown): value is WeeklyPick {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.weekStart === 'string' &&
    typeof item.title === 'string' &&
    typeof item.hint === 'string' &&
    typeof item.skip === 'boolean' &&
    typeof item.decidedAt === 'number'
  )
}

/** 저장해 둔 고른 것들. 깨진 항목은 버립니다. */
export function loadWeeklyPicks(): WeeklyPick[] {
  const saved = loadData<unknown>(WEEKLY_PICKS_KEY, [])
  return Array.isArray(saved) ? saved.filter(isWeeklyPick) : []
}

/** 그 주에 고른 것. 없으면 undefined (한 주에 하나만 둡니다) */
export function findWeeklyPick(picks: WeeklyPick[], weekStart: string): WeeklyPick | undefined {
  return picks.find((pick) => pick.weekStart === weekStart)
}

/**
 * 그 주의 고른 것을 저장합니다. 같은 주에 이미 있으면 새로 고른 것으로 바꿉니다. 바뀐 전체 목록을 돌려줍니다.
 *
 *   saveWeeklyPick({ weekStart: '2026-10-26', title: '폰을 다른 방에 두기', hint: '…', skip: false })
 */
export function saveWeeklyPick(input: Omit<WeeklyPick, 'id' | 'decidedAt'>): WeeklyPick[] {
  const pick: WeeklyPick = { ...input, id: `pick-${input.weekStart}`, decidedAt: Date.now() }
  const next = [...loadWeeklyPicks().filter((item) => item.weekStart !== input.weekStart), pick]
  saveData(WEEKLY_PICKS_KEY, next)
  return next
}
