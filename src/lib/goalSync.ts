import { ApiError } from '@/lib/api'
import { markCardsOfGoal } from '@/lib/cardSync'
import { loadGoals, saveGoals } from '@/lib/goals'
import { createServerGoal, fromServerGoal, updateServerGoal, type ServerGoal } from '@/lib/goalsApi'
import { loadData, saveData } from '@/lib/storage'
import type { Goal } from '@/types'

/**
 * 이 기기의 목표와 서버의 목표를 맞추는 규칙입니다. (#516)
 * 카드(lib/cardSync.ts)와 같은 "이 기기 먼저" 방식입니다. 서버에는 목표를 지우는 주소가 없어서 지우기는 없습니다.
 *
 *   - 목표를 저장하면 바뀐 목표를 "보낼 목록" 에 적고 서버로 보냅니다. 못 보내면 다음에 앱을 열 때 다시 보냅니다.
 *   - 앱을 열 때 서버의 목표를 받아서, 다른 기기에서 만들거나 고친 목표를 이 기기에도 반영합니다.
 *   - 목표가 서버에 올라가면, 그 목표에 연결한 카드를 다시 보내서 서버의 카드에도 목표 번호가 붙게 합니다.
 *   - 테스트 로그인은 서버를 쓰지 않습니다. (hooks/useGoalSync.ts 가 진짜 로그인일 때만 부릅니다)
 */

// 아직 서버에 못 보낸 목표를 적어 두는 이름입니다. (실제 키는 'study-goal-sync-pending')
export const GOAL_SYNC_KEY = 'goal-sync-pending'

/** 서버에 올릴 목표들 (이 기기의 목표 id) */
export function loadPendingGoals(): string[] {
  const saved = loadData<unknown>(GOAL_SYNC_KEY, [])
  return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []
}

function savePendingGoals(ids: string[]): void {
  saveData(GOAL_SYNC_KEY, [...new Set(ids)])
}

// 서버가 받지 않은(400 · 409) 목표를 적어 두는 이름입니다. (실제 키는 'study-goal-sync-rejected')
// 409 는 "진행 중인 목표는 3개까지예요" 입니다. 적어 두지 않으면 앱을 열 때마다 다시 보내서 매번 409 가 납니다.
export const GOAL_SYNC_REJECTED_KEY = 'goal-sync-rejected'

/** 서버가 받지 않은 목표들 (이 기기의 목표 id). 사람이 그 목표를 고치기 전에는 다시 보내지 않습니다. */
export function loadRejectedGoals(): string[] {
  const saved = loadData<unknown>(GOAL_SYNC_REJECTED_KEY, [])
  return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []
}

function saveRejectedGoals(ids: string[]): void {
  saveData(GOAL_SYNC_REJECTED_KEY, [...new Set(ids)])
}

/** 서버 번호를 뺀 목표 내용이 같은지 (서버 번호만 붙은 것은 "바뀐 것" 이 아닙니다) */
function isSameContent(a: Goal, b: Goal): boolean {
  return (
    JSON.stringify({ ...a, serverId: undefined }) === JSON.stringify({ ...b, serverId: undefined })
  )
}

/**
 * 바뀌기 전 · 뒤의 목표 목록에서 서버에 올릴 목표를 찾습니다.
 *
 *   prev [A], next [A(제목 바꿈), B]   -> ['A', 'B']
 *   prev [A], next [A(서버 번호만 붙음)] -> []
 */
export function diffGoalChanges(prev: Goal[], next: Goal[]): string[] {
  return next
    .filter((goal) => {
      const before = prev.find((item) => item.id === goal.id)
      return !before || !isSameContent(before, goal)
    })
    .map((goal) => goal.id)
}

/**
 * 서버에서 받은 목표로 이 기기의 목표를 맞춥니다. 저장하지 않고 결과만 돌려줍니다.
 *
 * ■ 규칙
 *   1. 서버 번호가 있는 목표
 *      - 보낼 목록에 있으면(이 기기에서 고쳤는데 못 보냄) 이 기기의 것을 둡니다.
 *      - 아니면 서버의 내용으로 맞춥니다. (다른 기기에서 고친 것. 진척 · 마지막 점검은 이 기기의 것)
 *      - 서버에 없으면 그대로 두고 서버 번호를 떼서 다시 올립니다. (서버에는 지우는 주소가 없어서, 지워진 게 아니라 서버가 모르는 것입니다)
 *   2. 서버 번호가 없는 목표는 아직 서버에 없는 목표라 그대로 두고 올릴 목록에 더합니다.
 *      단, 진행 중이 아닌 목표(끝냄 · 그만둠)와 서버가 이미 거절한 목표(rejected)는 더하지 않습니다.
 *      서버는 새 목표를 늘 "진행 중" 으로 만들어서, 끝낸 목표를 올리면 서버에서 칸(3개)을 차지하기 때문입니다.
 *   3. 이 기기에 없는 서버 목표는 다른 기기에서 만든 것이라 더합니다.
 *
 *   이 기기 [A(4), B], 서버 [4(제목 바뀜), 5]  -> goals [A(서버 제목), B, goal-s5], toUpload ['B']
 *   이 기기 [B(거절됨), C(그만둠)], 서버 []    -> toUpload []
 */
export function mergeServerGoals(
  local: Goal[],
  server: ServerGoal[],
  pending: string[],
  rejected: string[] = [],
): { goals: Goal[]; toUpload: string[] } {
  const goals: Goal[] = []
  const toUpload: string[] = []
  for (const goal of local) {
    const serverGoal = goal.serverId ? server.find((item) => item.id === goal.serverId) : undefined
    if (!goal.serverId || !serverGoal) {
      goals.push({ ...goal, serverId: undefined })
      if (goal.status === 'active' && !rejected.includes(goal.id)) toUpload.push(goal.id)
    } else if (pending.includes(goal.id)) {
      goals.push(goal)
    } else {
      goals.push(fromServerGoal(serverGoal, goal))
    }
  }
  for (const serverGoal of server) {
    const isLinked = local.some((goal) => goal.serverId === serverGoal.id)
    if (!isLinked) goals.push(fromServerGoal(serverGoal))
  }
  return { goals, toUpload }
}

/** 이 기기에서 목표를 바꿨을 때 보낼 목록에 적습니다. (hooks/useGoalSync.ts 가 목표 저장 이벤트를 받을 때 부릅니다) */
export function markGoalChanges(prev: Goal[], next: Goal[]): void {
  const changed = diffGoalChanges(prev, next)
  savePendingGoals([...loadPendingGoals(), ...changed])
  // 사람이 고친 목표는 한 번 더 보내 봅니다. (그사이 다른 목표를 끝내서 자리가 났을 수 있음)
  saveRejectedGoals(loadRejectedGoals().filter((id) => !changed.includes(id)))
}

/** 서버에서 받은 목표를 이 기기에 반영하고, 아직 서버에 없는 목표를 보낼 목록에 더합니다. */
export function applyServerGoals(server: ServerGoal[]): void {
  const local = loadGoals()
  const pending = loadPendingGoals()
  const { goals, toUpload } = mergeServerGoals(local, server, pending, loadRejectedGoals())
  // JSON 으로 비교할 때 서버 번호를 뗀 칸(undefined)은 빠져서, 바뀐 것이 없으면 저장하지 않습니다.
  if (JSON.stringify(goals) !== JSON.stringify(local)) saveGoals(goals, 'server')
  savePendingGoals([...pending, ...toUpload])
}

/** 보낸 목표에 서버 번호를 붙여 저장합니다. 보내는 사이에 또 고쳤으면 보낼 목록에 남겨 둡니다. */
function linkServerId(sent: Goal, serverId: string): void {
  const goals = loadGoals()
  const current = goals.find((goal) => goal.id === sent.id)
  const isNewLink = current !== undefined && current.serverId !== serverId
  if (current) {
    saveGoals(
      goals.map((goal) => (goal.id === sent.id ? { ...goal, serverId } : goal)),
      'server',
    )
  }
  if (!current || isSameContent(current, sent)) {
    savePendingGoals(loadPendingGoals().filter((id) => id !== sent.id))
  }
  saveRejectedGoals(loadRejectedGoals().filter((id) => id !== sent.id))
  // 처음 서버 번호가 붙었으면, 이 목표에 연결한 카드를 다시 보내 서버 카드에도 목표 번호를 붙입니다.
  if (isNewLink) markCardsOfGoal(sent.id)
}

/** 서버가 "받을 수 없다" 고 한 것인지. 400 값이 틀림 · 409 진행 중 목표가 이미 3개 (다시 보내도 같아서 목록에서 뺍니다) */
function isRejected(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 400 || error.status === 409)
}

// 지금 보내는 중인지. 보내는 중에 또 부르면 끝난 뒤 한 번 더 보냅니다.
let isPushing = false
let pushAgain = false

/**
 * 보낼 목록에 적힌 목표를 하나씩 서버로 보냅니다. 서버에 닿지 못하면 거기서 멈추고 남은 것은 다음에 보냅니다.
 * 서버 번호가 없으면 만들고(POST), 있으면 이 기기의 목표와 똑같이 바꿉니다(PATCH). 서버에서 사라졌으면(404) 다시 만듭니다.
 */
export async function pushPendingGoals(): Promise<void> {
  if (isPushing) {
    pushAgain = true
    return
  }
  isPushing = true
  try {
    for (const goalId of loadPendingGoals()) {
      const goal = loadGoals().find((item) => item.id === goalId)
      if (!goal) {
        savePendingGoals(loadPendingGoals().filter((id) => id !== goalId))
        continue
      }
      try {
        let saved: ServerGoal
        if (goal.serverId) {
          try {
            saved = await updateServerGoal(goal.serverId, goal)
          } catch (error) {
            if (!(error instanceof ApiError && error.status === 404)) throw error
            saved = await createServerGoal(goal)
          }
        } else if (goal.status !== 'active') {
          // 서버에 없는 끝낸 · 그만둔 목표는 올리지 않습니다. (만들면 서버에서 "진행 중" 이 되어 칸을 차지함)
          savePendingGoals(loadPendingGoals().filter((id) => id !== goalId))
          continue
        } else {
          saved = await createServerGoal(goal)
        }
        linkServerId(goal, saved.id)
      } catch (error) {
        if (!isRejected(error)) return
        savePendingGoals(loadPendingGoals().filter((id) => id !== goalId))
        // 다음에 앱을 열 때 다시 보내지 않게 적어 둡니다. (사람이 고치면 지워져서 다시 시도)
        saveRejectedGoals([...loadRejectedGoals(), goalId])
      }
    }
  } finally {
    isPushing = false
    if (pushAgain) {
      pushAgain = false
      void pushPendingGoals()
    }
  }
}
