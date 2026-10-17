import { loadList, saveData } from '@/lib/storage'
import type { AiMessage } from '@/types'

/**
 * 알림(AI 가 보낸 메시지 + 앱이 만든 알림)을 불러오고 저장하는 함수입니다.
 * 알림 화면과 헤더(빨간 점) 두 곳에서 같이 쓰려고 여기에 모았습니다.
 * 서버가 생기면 이 파일만 api() 로 바꾸면 됩니다.
 */

const STORAGE_KEY = 'ai-messages'

/** 이미 휴대폰 알림을 보냈거나 보낼 필요가 없는 메시지의 id 를 적어 두는 저장소 이름. (hooks/useAiMessageNotifications.ts) */
export const NOTIFIED_IDS_KEY = 'ai-message-notified-ids'

/**
 * 알림 목록이 바뀌었을 때 보내는 신호의 이름입니다.
 * 헤더의 빨간 점이 이 신호를 듣고 바로 바뀝니다. (hooks/useAiMessages.ts)
 */
export const AI_MESSAGES_CHANGE_EVENT = 'ai-messages-change'

/**
 * 저장된 알림을 보낸 시각 순서(오래된 것 → 최신)로 돌려줍니다.
 * 받은 알림이 없으면(또는 저장된 값이 깨져 있으면) 빈 목록입니다.
 * 예전에는 없을 때 가짜 메시지 7개를 보여줬는데, 처음 쓰는 사람에게 안 읽은 메시지(빨간 점)가 있는 것처럼 보여서 뺐습니다.
 * (예시 메시지는 개발용 가상 데이터를 넣었을 때만 들어옵니다. lib/demoData.ts)
 */
export function loadAiMessages(): AiMessage[] {
  const messages = loadList<AiMessage>(STORAGE_KEY)
  // sort 는 원래 배열을 바꿔 버려서, 복사본([...])을 만들어 정렬합니다.
  return [...messages].sort((a, b) => a.sentAt - b.sentAt)
}

/** 알림 목록을 통째로 저장하고, 다른 화면들에게 "알림이 바뀌었어" 라고 알려 줍니다. */
export function saveAiMessages(messages: AiMessage[]): void {
  saveData(STORAGE_KEY, messages)
  window.dispatchEvent(new Event(AI_MESSAGES_CHANGE_EVENT))
}

/**
 * 알림 하나를 목록에 더합니다. 더했으면 true 입니다.
 * id 가 같은 알림이 이미 있으면 더하지 않고 false 를 돌려줍니다. (같은 알림이 두 번 쌓이지 않게)
 *
 *   addAiMessage({ id: 'alert-goalDone-2026-10-11', sentAt: Date.now(), careLevel: 1,
 *                  kind: 'event', eventLabel: '목표 달성', source: 'app',
 *                  text: '오늘 계획 4시간, 다 해냈어', read: false })
 */
export function addAiMessage(message: AiMessage): boolean {
  const messages = loadAiMessages()
  if (messages.some((saved) => saved.id === message.id)) return false

  saveAiMessages([...messages, message])
  return true
}

/** 알림을 전부 "읽음" 으로 바꿔서 저장합니다. */
export function markAllAiMessagesRead(messages: AiMessage[]): void {
  const readMessages = messages.map((message) => ({ ...message, read: true }))
  saveAiMessages(readMessages)
}

/** 안 읽은 알림이 몇 개인지 셉니다. */
export function countUnreadAiMessages(messages: AiMessage[]): number {
  return messages.filter((message) => !message.read).length
}

/**
 * 이 메시지들은 휴대폰 알림을 보내지 않은 것으로 적어 둡니다.
 * 처음 서버에서 받은 옛 메시지들이 한꺼번에 알림으로 뜨는 것을 막으려고 씁니다. (알림 화면에는 그대로 보입니다)
 */
export function markAsNotified(ids: string[]): void {
  if (ids.length === 0) return
  const notifiedIds = new Set(loadList<string>(NOTIFIED_IDS_KEY))
  for (const id of ids) notifiedIds.add(id)
  saveData(NOTIFIED_IDS_KEY, [...notifiedIds])
}
