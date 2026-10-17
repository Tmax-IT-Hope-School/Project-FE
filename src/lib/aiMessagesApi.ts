/**
 * 서버가 만든 메시지(당근·넛지·채찍·이벤트 알림·회복)를 받아서, 알림 화면이 쓰는 저장소에 합치는 함수들입니다. (#256)
 * 알림 화면은 지금도 localStorage 의 알림(lib/aiMessages.ts)을 보여 주므로, 서버 메시지를 그 목록에 더해 주기만 하면 화면은 그대로 동작합니다.
 *
 * 서버와 정한 약속입니다. (BE 저장소의 docs/API.md "메시지") 전부 로그인이 필요합니다.
 *   목록      GET   /messages                 -> 200 ServerMessage[] (최신순, 20개씩, 없으면 [])
 *   새 것 받기 GET   /messages?after=번호       -> 그 번호보다 나중에 온 것만 (번호 자신은 빠짐)
 *   오래된 것  GET   /messages?before=번호      -> 그 번호보다 먼저 온 것만
 *   읽음 표시  PATCH /messages/:id/read         -> 200 ServerMessage (이미 읽었어도 200)
 *   번호(id)는 보낸 순서대로 커지는 숫자 모양의 글자("15")라서, 시각 대신 번호로 "어디까지 받았는지" 를 셉니다.
 *
 * ⚠️ 서버의 종류(kind)를 화면의 관리 강도(careLevel)로 바꾸는 규칙은 임시입니다. (recovery 0 · carrot 1 · nudge 2 · stick 3 · event 2)
 * 서버 문서가 stick 을 3 ~ 4, event 를 "이벤트마다 다름" 이라고만 해서, 팀이 정하면 KIND_TO_CARE_LEVEL 만 고치면 됩니다.
 */
import { ApiError, api } from '@/lib/api'
import type { AiMessage, CareLevel } from '@/types'

/** 서버 응답을 기다리는 최대 시간(밀리초). 서버가 멈춰도 알림 받기가 영원히 걸려 있으면 안 되기 때문입니다. */
const REQUEST_TIMEOUT_MS = 10000

/** 서버가 한 번에 주는 메시지 개수 (이만큼 오면 더 있을 수 있습니다) */
export const SERVER_PAGE_SIZE = 20

/** 한 번 받을 때 이어서 받는 최대 쪽 수. 오래 안 열었어도 한 번에 100개까지만 받아서 서버와 화면에 부담을 주지 않습니다. */
export const MAX_PAGES_PER_SYNC = 5

/** 서버가 보내는 메시지 하나의 모양 (readAt 은 우리 화면에서 쓰지 않아 받지 않습니다) */
export interface ServerMessage {
  id: string
  kind: 'recovery' | 'carrot' | 'nudge' | 'stick' | 'event'
  text: string
  sentAt: number
  read: boolean
}

/** 서버 종류 -> 화면의 관리 강도 (위의 ⚠️ 참고) */
const KIND_TO_CARE_LEVEL: Record<ServerMessage['kind'], CareLevel> = {
  recovery: 0,
  carrot: 1,
  nudge: 2,
  stick: 3,
  event: 2,
}

/** 서버가 준 값이 메시지 모양이 맞는지 확인합니다. (서버 응답도 그대로 믿지 않고 확인합니다) */
function isServerMessage(value: unknown): value is ServerMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Record<string, unknown>
  return (
    typeof message.id === 'string' &&
    isServerMessageId(message.id) &&
    typeof message.kind === 'string' &&
    message.kind in KIND_TO_CARE_LEVEL &&
    typeof message.text === 'string' &&
    typeof message.sentAt === 'number' &&
    Number.isFinite(message.sentAt) &&
    typeof message.read === 'boolean'
  )
}

/**
 * 서버가 준 메시지 번호처럼 숫자로만 된 글자인지 확인합니다.
 * 이 앱이 만든 알림의 번호('alert-goalDone-2026-10-11' 등)와 구분하는 데 씁니다.
 *
 *   '15' -> true     'alert-goalDone-2026-10-11' -> false     '' -> false     '1.5' -> false
 */
export function isServerMessageId(id: string): boolean {
  return /^\d+$/.test(id)
}

/**
 * 서버 메시지를 알림 화면이 쓰는 모양으로 바꿉니다.
 *
 *   { id: '15', kind: 'nudge', text: '지금 25분만 해 보자', sentAt: 1790000000000, read: false }
 *     -> { id: '15', sentAt: 1790000000000, careLevel: 2, kind: 'regular', source: 'ai', text: '…', read: false }
 *   { id: '16', kind: 'event', … }  -> kind: 'event', eventLabel: '알림'
 */
export function toAiMessage(message: ServerMessage): AiMessage {
  const isEvent = message.kind === 'event'
  return {
    id: message.id,
    sentAt: message.sentAt,
    careLevel: KIND_TO_CARE_LEVEL[message.kind],
    kind: isEvent ? 'event' : 'regular',
    // 서버가 이벤트의 이름을 따로 주지 않아서, 이벤트일 때는 공통 이름을 붙입니다.
    ...(isEvent ? { eventLabel: '알림' } : {}),
    source: 'ai',
    text: message.text,
    read: message.read,
  }
}

/**
 * 지금 가진 알림 중 서버에서 온 것의 가장 큰 번호를 찾습니다. 서버에서 받은 적이 없으면 null 입니다.
 * 서버 번호가 아닌 알림(이 앱이 만든 것)은 세지 않습니다.
 *
 *   [{ id: '3' }, { id: '15' }, { id: 'alert-x-2026-10-11' }] -> '15'
 *   [{ id: 'alert-x-2026-10-11' }]                           -> null
 */
export function getLatestServerMessageId(messages: AiMessage[]): string | null {
  let latest: bigint | null = null
  for (const message of messages) {
    if (!isServerMessageId(message.id)) continue
    const id = BigInt(message.id)
    if (latest === null || id > latest) latest = id
  }
  return latest === null ? null : latest.toString()
}

/** 문자 번호 두 개 중 작은 것을 돌려줍니다. (숫자가 아주 커도 틀리지 않게 BigInt 로 비교) */
function smallerId(a: string, b: string): string {
  return BigInt(a) < BigInt(b) ? a : b
}

async function fetchMessagesPage(query: string): Promise<ServerMessage[]> {
  const result = await api<unknown>(`/messages${query}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!Array.isArray(result) || !result.every(isServerMessage)) {
    throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
  }
  return result
}

/**
 * 서버에서 새 메시지를 받아 옵니다.
 *   - latestId 가 없으면(처음 받는 것): 가장 최근 20개만 받습니다. 옛날 메시지까지 한꺼번에 쌓지 않으려는 것입니다.
 *   - latestId 가 있으면: 그 번호보다 나중에 온 것을 받습니다. 20개가 꽉 차 있으면 더 있을 수 있어서,
 *     받은 것 중 가장 작은 번호를 before 로 넣어 이어서 받습니다. (최대 MAX_PAGES_PER_SYNC 쪽)
 */
export async function fetchNewServerMessages(latestId: string | null): Promise<ServerMessage[]> {
  if (latestId === null) return fetchMessagesPage('')

  const collected: ServerMessage[] = []
  let before: string | null = null
  for (let page = 0; page < MAX_PAGES_PER_SYNC; page++) {
    const query: string =
      before === null ? `?after=${latestId}` : `?after=${latestId}&before=${before}`
    const messages = await fetchMessagesPage(query)
    collected.push(...messages)
    // 20개보다 적게 왔으면 다 받은 것입니다.
    if (messages.length < SERVER_PAGE_SIZE) break
    before = messages.map((message) => message.id).reduce(smallerId)
  }
  return collected
}

/**
 * 받아 온 서버 메시지를 지금 알림 목록에 합칩니다. 합친 목록을 돌려주고, 바뀐 게 없으면 null 입니다.
 *   - 같은 번호가 이미 있으면 더하지 않습니다. 이미 "읽음" 으로 바꾼 것을 서버의 안 읽음이 되돌리지 않게, 읽음은 하나라도 true 면 true 로 둡니다.
 *   - 이 앱이 만든 알림은 그대로 둡니다.
 */
export function mergeServerMessages(
  current: AiMessage[],
  received: ServerMessage[],
): AiMessage[] | null {
  const byId = new Map(current.map((message) => [message.id, message]))
  let changed = false

  for (const server of received) {
    const converted = toAiMessage(server)
    const saved = byId.get(converted.id)
    if (!saved) {
      byId.set(converted.id, converted)
      changed = true
    } else if (!saved.read && converted.read) {
      byId.set(converted.id, { ...saved, read: true })
      changed = true
    }
  }
  return changed ? [...byId.values()] : null
}

/** 서버에 "이 메시지를 읽었어" 라고 알립니다. (읽은 시각은 서버가 지금으로 적습니다) */
export async function markMessageReadOnServer(id: string): Promise<void> {
  await api<unknown>(`/messages/${encodeURIComponent(id)}/read`, {
    method: 'PATCH',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

/**
 * 다음 번 받기까지 기다릴 시간(밀리초)을 정합니다. 잘 되면 1분마다, 연달아 실패하면 2배씩 늘려 최대 10분까지입니다.
 *
 *   연달아 실패 0번 -> 60000 (1분)    1번 -> 120000    2번 -> 240000    4번 이상 -> 600000 (10분)
 */
export function nextPollDelayMs(failures: number): number {
  const base = 60_000
  const max = 600_000
  return Math.min(max, base * 2 ** Math.max(0, failures))
}
