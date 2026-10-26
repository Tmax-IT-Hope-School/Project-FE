/**
 * 채팅에서 위기 표현이 감지됐다는 "신호" 를 이 기기에 적어 두고 읽는 곳입니다. (기획서 「4.5 안전 브레이크」)
 *
 * 채팅 글은 서버가 검사하고(BE CrisisText + GPT), 위기면 답에 showHelp: true 를 실어 보내면서
 * 7일 동안 보호 조치를 합니다(BE SafetyService). 그런데 FE 의 독촉 알림 · 전화는 이 기기의 글만 읽어서
 * (lib/diarySafety.ts 의 loadSavedWritings) 채팅에서 위기가 나와도 멈추지 않았습니다.
 * 그래서 아래 두 가지 중 하나라도 있으면 "최근 위기 신호가 있다" 고 봅니다.
 *   ① 이 기기에서 받은 채팅 답이 showHelp: true 였다 (markChatCrisis 가 적어 둔 시각)
 *   ② 서버가 보낸 회복 메시지 중 상담 전화(1388) 안내가 있다 (서버가 보호 조치를 켤 때 보내는 메시지.
 *      다른 기기의 채팅 · 통화에서 감지된 것도 알림 목록에 들어오면 같이 잡힙니다)
 * 기간은 서버와 같이 "오늘을 포함해 7일" 입니다. (BE SafetyService.isActive)
 *
 * 다른 사람이 같은 기기로 로그인해도 7일 동안은 독촉을 멈춘 채로 둡니다. (멈추는 쪽이 안전해서)
 */
import { loadAiMessages } from '@/lib/aiMessages'
import { isServerMessageId } from '@/lib/aiMessagesApi'
import { moveDateKey, toDayKey } from '@/lib/date'
import { loadData, saveData } from '@/lib/storage'

// 저장소에 넣는 이름입니다. (실제 키는 'study-chat-crisis-at'). 값은 마지막으로 감지된 시각(Date.now() 값)
const CHAT_CRISIS_KEY = 'chat-crisis-at'

/** 위기 신호를 며칠 동안 볼지 (오늘 포함). 서버의 보호 조치 기간과 같습니다. */
export const CRISIS_SIGNAL_DAYS = 7

/** 서버가 보호 조치를 켤 때 보내는 안내에 들어 있는 상담 전화 번호 (BE SafetyService.HELP_MESSAGE) */
const HELP_LINE_NUMBER = '1388'

/** 채팅 답이 showHelp: true 로 왔을 때 부릅니다. 감지된 시각을 적어 둡니다. (lib/chatApi.ts) */
export function markChatCrisis(now: number): void {
  saveData(CHAT_CRISIS_KEY, now)
}

/**
 * 최근 7일(오늘 포함) 안에 위기 신호가 있었는지 알려줍니다. 있으면 독촉 · 채찍을 멈춥니다.
 *
 *   오늘 채팅에서 showHelp 를 받음        -> true
 *   6일 전에 서버가 1388 회복 메시지를 보냄 -> true
 *   8일 전에만 있었음                    -> false
 */
export function hasRecentCrisisSignal(now: number): boolean {
  // 7일째 되는 날의 날짜. 이 날짜 이후(같은 날 포함)에 생긴 신호만 봅니다.
  const fromKey = moveDateKey(toDayKey(now), -(CRISIS_SIGNAL_DAYS - 1))
  const isRecent = (time: number) => toDayKey(time) >= fromKey

  const chatCrisisAt = loadData<unknown>(CHAT_CRISIS_KEY, null)
  if (typeof chatCrisisAt === 'number' && isRecent(chatCrisisAt)) return true

  return loadAiMessages().some(
    (message) =>
      isServerMessageId(message.id) &&
      message.careLevel === 0 &&
      message.text.includes(HELP_LINE_NUMBER) &&
      isRecent(message.sentAt),
  )
}
