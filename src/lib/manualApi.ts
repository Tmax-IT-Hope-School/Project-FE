/**
 * "나 사용설명서"(hooks/useManualItems.ts)와 [틀렸어요] 를 서버(BE)와 맞추는 함수들입니다. (#654, STARFLOW F7)
 *
 * 서버와 정한 약속입니다. (BE 저장소의 docs/API.md "나 사용설명서") 전부 로그인이 필요합니다.
 *   목록            GET    /manual                      -> 200 [{ id, category, title, confirmedDate, evidence, note, disputedAt }]
 *                   실험 · 인사이트에서 서버가 만든 항목 + 학생이 넣은 항목. disputedAt 은 [틀렸어요] 를 누른 시각(밀리초) 또는 null
 *   학생 항목 저장  PUT    /manual/items/{id}           { category, title, evidence, note?, confirmedDate } -> 200 항목 하나
 *                   같은 id 로 다시 보내면 덮어써서, 이 기기 항목을 처음 한 번 올리다 다시 보내도 두 줄이 되지 않습니다.
 *   틀렸어요 적기   PUT    /manual/disputes/{id}        -> 204 (내 목록에 없는 id 는 404)
 *   틀렸어요 되돌리기 DELETE /manual/disputes/{id}      -> 204
 *   실패            400 값이 틀림 · 'experiment-' · 'insight-' · 'demo-' 로 시작하는 id 를 저장하려 함 / 404 없는 항목
 *
 * ■ 이 기기(localStorage)에 먼저 저장하고, 서버에는 "같이" 저장합니다. ("이번 주에 고른 것" 과 같은 방식, lib/weeklyPicksApi.ts)
 *   - 화면은 서버 목록과 이 기기 항목을 합쳐 봅니다. (mergeManualItems) 서버 항목은 이 기기에 저장하지 않습니다.
 *     (서버가 만든 실험 · 인사이트 항목은 서버에서 바뀔 수 있어서, 옛 복사본이 남지 않게 하려는 것입니다)
 *   - 이 기기에만 있는 항목(이 기능 전에 넣은 것 등)은 서버 목록을 받을 때 서버로 올립니다. (findManualItemsToSend)
 *   - 이 기기에 있던 [틀렸어요] 는 처음 한 번 서버로 올립니다. 그 뒤로는 서버 값을 믿고, 아직 못 보낸 것만 이 기기 값이 이깁니다.
 *   - 시연용 가상 데이터('demo-' 로 시작하는 id)는 서버로 보내지 않습니다.
 *   - 테스트 로그인(서버가 모르는 가짜 토큰)이면 서버를 부르지 않고 이 기기에만 저장합니다.
 *
 * ⚠️ 서버에는 학생 항목을 지우는 주소가 없습니다. "모든 기록 지우기" 를 해도 서버에 올라간 항목은 다시 보입니다. (탈퇴하면 지워집니다)
 */
import { api, ApiError } from '@/lib/api'
import { isDateKey } from '@/lib/date'
import { DEMO_ID_PREFIX } from '@/lib/demoPersona'
import { loadData, saveData } from '@/lib/storage'
import type { ManualItem, ManualItemCategory } from '@/types'
import { queryOptions } from '@tanstack/react-query'

/** 서버 응답을 기다리는 최대 시간(밀리초). 다른 *Api.ts 와 같은 10초 */
const REQUEST_TIMEOUT_MS = 10000

/** 사용설명서 쿼리의 이름표. 서버에 저장한 뒤 이 이름표로 "낡았다" 고 표시해서 다시 받게 합니다. */
export const MANUAL_QUERY_KEY = ['manual'] as const

/** 아직 서버에 못 보낸 [틀렸어요] (항목 id → true 적기 / false 되돌리기). "모든 기록 지우기" 로 같이 지워집니다. (lib/myData.ts) */
export const MANUAL_DISPUTES_UNSENT_KEY = 'manual-disputes-unsent'

/** 이 기기에 있던 [틀렸어요] 를 서버로 한 번 올렸는지. 올렸으면 true. (lib/myData.ts 도 같이) */
export const MANUAL_DISPUTES_UPLOADED_KEY = 'manual-disputes-uploaded'

const CATEGORIES: ManualItemCategory[] = ['rhythm', 'cautionDay', 'effectiveMethod', 'careStyle']

/** 서버가 만드는 항목의 id 앞머리. 학생 항목으로 저장할 수 없습니다. (BE ManualService) */
const SERVER_ID_PREFIXES = ['experiment-', 'insight-']

/** 서버에서 받은 사용설명서: 항목들과 [틀렸어요] 를 누른 항목(id → 누른 시각) */
export interface ServerManual {
  items: ManualItem[]
  disputes: Record<string, number>
  /**
   * 서버가 학생 항목 저장 · [틀렸어요] 를 받는지. 옛 서버(목록 줄에 disputedAt 칸이 없음)면 false 이고,
   * 그때는 서버로 보내지 않고 이 기기 값을 그대로 씁니다. (BE 배포 전에 FE 가 먼저 나가도 누른 것이 사라지지 않게)
   */
  canWrite: boolean
}

// ---------------------------------------------------------------------------
// 서버 부르기
// ---------------------------------------------------------------------------

/** 서버 목록의 한 줄 → 항목과 틀렸어요 시각. 모양이 틀리면 null (깨진 줄 하나가 화면을 멈추지 않게) */
function toServerRow(value: unknown): { item: ManualItem; disputedAt: number | null } | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.title !== 'string') return null
  if (typeof row.evidence !== 'string') return null
  if (typeof row.confirmedDate !== 'string' || !isDateKey(row.confirmedDate)) return null
  const category = CATEGORIES.find((item) => item === row.category)
  if (!category) return null
  const item: ManualItem = {
    id: row.id,
    category,
    title: row.title,
    confirmedDate: row.confirmedDate,
    evidence: row.evidence,
  }
  if (typeof row.note === 'string' && row.note !== '') item.note = row.note
  const disputedAt = typeof row.disputedAt === 'number' ? row.disputedAt : null
  return { item, disputedAt }
}

/** 서버의 사용설명서를 받습니다. 목록이 아니면 502 에러를 던집니다. */
export async function fetchServerManual(): Promise<ServerManual> {
  const result = await api<unknown>('/manual', { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!Array.isArray(result)) throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
  // 줄이 하나라도 있으면 disputedAt 칸이 있는지로 새 서버인지 봅니다. 줄이 없으면 알 수 없어서 새 서버로 봅니다.
  const canWrite = result.every(
    (value) => typeof value === 'object' && value !== null && 'disputedAt' in value,
  )
  const manual: ServerManual = { items: [], disputes: {}, canWrite }
  for (const value of result) {
    const row = toServerRow(value)
    if (row === null) continue
    manual.items.push(row.item)
    if (row.disputedAt !== null) manual.disputes[row.item.id] = row.disputedAt
  }
  return manual
}

/**
 * 사용설명서 쿼리. 못 받으면(인터넷 끊김 · 서버 배포 전) 에러 대신 null 이라서, 화면은 이 기기 것만 보여 줍니다.
 * (나 사용설명서는 서버가 없어도 이 기기 항목으로 볼 수 있어야 해서 실패 안내를 띄우지 않습니다)
 */
export function manualQuery() {
  return queryOptions({
    queryKey: MANUAL_QUERY_KEY,
    queryFn: async (): Promise<ServerManual | null> => {
      try {
        return await fetchServerManual()
      } catch {
        return null
      }
    },
  })
}

/** 학생이 넣은 항목 하나를 서버에 저장합니다. (같은 id 면 서버가 덮어씀) */
export async function saveManualItemToServer(item: ManualItem): Promise<void> {
  await api<unknown>(`/manual/items/${encodeURIComponent(item.id)}`, {
    method: 'PUT',
    body: JSON.stringify({
      category: item.category,
      title: item.title,
      evidence: item.evidence,
      note: item.note ?? null,
      confirmedDate: item.confirmedDate,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

/** [틀렸어요] 를 서버에 적거나(disputed: true) 되돌립니다(false). */
export async function saveManualDisputeToServer(input: {
  itemId: string
  disputed: boolean
}): Promise<void> {
  await api<unknown>(`/manual/disputes/${encodeURIComponent(input.itemId)}`, {
    method: input.disputed ? 'PUT' : 'DELETE',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

// ---------------------------------------------------------------------------
// 보낼지 정하기 · 합치기 (React 없는 순수 함수)
// ---------------------------------------------------------------------------

/**
 * 이 항목을 학생 항목으로 서버에 보내도 되는지.
 *   시연용 가상 데이터('demo-') · 서버가 만드는 항목('experiment-' · 'insight-') · 서버가 받지 않는 모양의 id 는 보내지 않습니다.
 *
 *   canSendManualItem({ id: 'manual-pick-2026-10-12', … }) -> true
 *   canSendManualItem({ id: 'demo-manual-1', … })          -> false
 */
export function canSendManualItem(item: Pick<ManualItem, 'id'>): boolean {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(item.id)) return false
  if (item.id.startsWith(DEMO_ID_PREFIX)) return false
  return !SERVER_ID_PREFIXES.some((prefix) => item.id.startsWith(prefix))
}

/**
 * 이 기기 항목 + 서버에만 있는 항목. 같은 id 는 서버 것을 씁니다. 최근에 확인된 것부터.
 *
 *   mergeManualItems([{ id: 'manual-pick-a' }, { id: 'demo-1' }], [{ id: 'experiment-3' }, { id: 'manual-pick-a' }])
 *     -> [experiment-3, manual-pick-a(서버 것), demo-1]   (확인한 날이 최근인 순)
 */
export function mergeManualItems(local: ManualItem[], server: ManualItem[]): ManualItem[] {
  const serverIds = new Set(server.map((item) => item.id))
  const merged = [...server, ...local.filter((item) => !serverIds.has(item.id))]
  // 날짜 글자('YYYY-MM-DD')는 글자 순서가 곧 날짜 순서입니다. 최근 날짜가 앞에 오게 뒤집어 비교합니다.
  return merged.sort((a, b) => b.confirmedDate.localeCompare(a.confirmedDate))
}

/**
 * 화면에 보일 [틀렸어요] (항목 id → 누른 시각).
 *   - 서버에 있는 항목: 아직 못 보낸 것(unsent)이 있으면 그 값, 없으면 서버 값
 *   - 이 기기에만 있는 항목: 이 기기 값
 *
 *   mergeManualDisputes({ a: 1, demo-1: 2 }, { items: [a, b], disputes: { b: 3 }, canWrite: true }, { a: false })
 *     -> { b: 3, demo-1: 2 }   (a 는 되돌린 것을 아직 못 보냄 → 안 누른 것으로)
 */
export function mergeManualDisputes(
  local: Record<string, number>,
  server: ServerManual,
  unsent: Record<string, boolean>,
): Record<string, number> {
  // 옛 서버는 틀렸어요를 모르니 이 기기 값을 그대로 씁니다.
  if (!server.canWrite) return local
  const serverIds = new Set(server.items.map((item) => item.id))
  const result: Record<string, number> = {}
  for (const id of serverIds) {
    const pending = unsent[id]
    if (pending === undefined) {
      if (server.disputes[id] !== undefined) result[id] = server.disputes[id]
    } else if (pending) {
      result[id] = local[id] ?? Date.now()
    }
  }
  for (const [id, at] of Object.entries(local)) {
    if (!serverIds.has(id)) result[id] = at
  }
  return result
}

/** 이 기기에만 있고 서버로 보내도 되는 항목들 (서버 목록을 받을 때 한 번 올립니다) */
export function findManualItemsToSend(local: ManualItem[], server: ManualItem[]): ManualItem[] {
  const serverIds = new Set(server.map((item) => item.id))
  return local.filter((item) => !serverIds.has(item.id) && canSendManualItem(item))
}

/**
 * 처음 한 번 서버로 올릴 [틀렸어요]: 이 기기에서 눌렀고, 서버에 있는 항목인데 서버에는 안 눌린 것.
 * (이 기기에만 있는 항목의 틀렸어요는 그 항목을 올린 뒤에 같이 보냅니다)
 */
export function findDisputesToUpload(
  local: Record<string, number>,
  server: ServerManual,
): string[] {
  const serverIds = new Set(server.items.map((item) => item.id))
  return Object.keys(local).filter((id) => serverIds.has(id) && server.disputes[id] === undefined)
}

// ---------------------------------------------------------------------------
// 못 보낸 [틀렸어요] 적어 두기 (localStorage)
// ---------------------------------------------------------------------------

/** 못 보낸 [틀렸어요] (항목 id → 적기 true / 되돌리기 false). 깨져 있으면 빈 객체 */
export function loadUnsentDisputes(): Record<string, boolean> {
  const saved = loadData<unknown>(MANUAL_DISPUTES_UNSENT_KEY, {})
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return {}
  const unsent: Record<string, boolean> = {}
  for (const [id, disputed] of Object.entries(saved)) {
    if (typeof disputed === 'boolean') unsent[id] = disputed
  }
  return unsent
}

/** 보내기 전에 적어 둡니다. 보내다 실패하거나 앱을 닫아도 다음에 다시 보냅니다. */
export function markDisputeUnsent(itemId: string, disputed: boolean): void {
  saveData(MANUAL_DISPUTES_UNSENT_KEY, { ...loadUnsentDisputes(), [itemId]: disputed })
}

/** 서버에 보내졌으면(또는 다시 보내도 소용없으면) 지웁니다. */
export function clearDisputeUnsent(itemId: string): void {
  const unsent = loadUnsentDisputes()
  delete unsent[itemId]
  saveData(MANUAL_DISPUTES_UNSENT_KEY, unsent)
}
