/**
 * OpenAI Realtime API(GPT 음성)에 WebRTC(브라우저 기본 실시간 음성 연결)로 연결합니다.
 * React 를 쓰지 않는 순수 함수입니다. (연결 방법은 OpenAI 공식 문서 "Realtime API with WebRTC" 기준)
 *
 * 순서
 *  1. 우리 서버에서 "임시 키"를 받는다 (이때 오늘의 말투와 학생 카드를 같이 보내서, AI 가 내 기록에 맞게 말하게 한다)
 *  2. 마이크를 켜서 연결에 붙인다
 *  3. OpenAI 와 연결 정보(SDP)를 주고받는다
 *  4. AI 목소리를 받아 재생한다
 *
 * ⚠️ OpenAI API 키(sk-...)는 절대 이 코드나 .env 에 넣지 않습니다.
 *    브라우저는 서버가 만들어 준 짧게 쓰고 버리는 임시 키만 씁니다.
 */
import { ApiError, api } from '@/lib/api'
import type { CallCard } from '@/lib/callCard'
import {
  parseToolCallEvent,
  toolOutputEvents,
  type RealtimeTool,
  type ToolCall,
} from '@/lib/callTools'
import { createConnectionWatcher } from '@/lib/connectionWatch'
import { loadStudySignals } from '@/lib/studySignals'
import type { CallTone } from '@/lib/todayCare'
import { parseTranscriptEvent, type TranscriptEvent } from '@/lib/transcript'

// 우리 서버에서 임시 키를 받는 경로입니다. 서버 주소(VITE_API_BASE_URL) 뒤에 붙습니다. (lib/api.ts)
// 서버와 정한 약속입니다. (BE 저장소의 docs/API.md "AI 통화", BE 이슈 #27)
//   요청  POST /realtime/session   { careLevel, maxHarshness, card, studySignals, otherRooms? }
//   응답  { "value": "임시 키", "expiresAt": 끝나는 순간, "maxSeconds": 통화 최대 길이(초), "callId": "통화 기록 번호" }
//   - otherRooms(선택, #699 · BE #434): 오늘 채팅 방들에서 학생이 한 말 몇 줄 ('계획: …' 모양, 12줄 · 한 줄 200자까지)
//   - maxSeconds(#699 · BE #434, 서버 설정 · 기본 300초): 옛 서버는 이 칸 대신 maxCallSeconds(기본 180초)를 줍니다.
//     서버가 아직 배포 전이면 otherRooms 는 무시되고 maxSeconds 는 안 옵니다. 둘 다 그래도 통화는 됩니다. (readCallMaxSeconds)
//   실패  429 (오늘 통화를 다 씀) / 503 (통화가 꺼져 있음 · AI 와 연결 못 함)
//         403 CALL_LOCKED (옛 서버만. 공부 조건은 2026-10-22 에 BE 에서 뺐습니다)
//
// 임시 키는 이 BE 경로에서만 받습니다. (2026-10-22 점검 보고서 "통화 수정 1 · 4")
// 전에는 Vercel 함수(api/voice-key.ts)에서도 받을 수 있었는데, 그 길은 로그인 확인 · 하루 한도 · 내 기록으로 만든 대본 ·
// 통화 기록 번호(callId)가 없어서 통화 결과가 저장되지 않았습니다. 그래서 그 함수와 VITE_VOICE_KEY_URL 을 지웠습니다.
const SESSION_PATH = '/realtime/session'

// 말투를 넘기지 않았을 때 쓰는 값입니다. (1 = 당근, 독설 수위 3 = 설정의 기본값)
const DEFAULT_TONE: CallTone = { careLevel: 1, maxHarshness: 3 }

// 이 시간 안에 연결이 안 되면 그만둡니다. (응답이 멈췄는데 "연결 중…" 에서 끝없이 기다리지 않게)
const CONNECT_TIMEOUT_MS = 15_000

// OpenAI 와 SDP 를 주고받는 주소입니다. (문서의 현재 주소. 버전이 바뀌면 문서를 다시 확인하세요)
const OPENAI_CALLS_URL = 'https://api.openai.com/v1/realtime/calls'

// ---- 통화 길이 (#699) ----

/** 서버가 통화 길이를 안 알려 주거나 이상한 값을 주면 쓰는 길이(초). 예전 서버의 기본값 3분입니다. */
export const DEFAULT_CALL_SECONDS = 180
// 서버가 준 길이로 믿는 범위(초). 1분보다 짧거나 15분보다 길면 잘못 온 값으로 봅니다.
const MIN_CALL_SECONDS = 60
const MAX_CALL_SECONDS = 900

/** 정수이고 60 ~ 900 이면 true */
function isCallSeconds(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_CALL_SECONDS &&
    value <= MAX_CALL_SECONDS
  )
}

/**
 * 서버 응답에서 통화 한 번의 최대 길이(초)를 꺼냅니다.
 * 새 칸 maxSeconds → 옛 칸 maxCallSeconds → 180초 순서입니다. 둘 다 정수 60 ~ 900 일 때만 씁니다.
 *
 *   readCallMaxSeconds({ maxSeconds: 300 })                       -> 300
 *   readCallMaxSeconds({ maxSeconds: 30, maxCallSeconds: 180 })   -> 180 (30초는 이상한 값)
 *   readCallMaxSeconds({ maxSeconds: '300' })                     -> 180
 */
export function readCallMaxSeconds(record: Record<string, unknown>): number {
  if (isCallSeconds(record.maxSeconds)) return record.maxSeconds
  if (isCallSeconds(record.maxCallSeconds)) return record.maxCallSeconds
  return DEFAULT_CALL_SECONDS
}

/** 끝나기 몇 초 전에 AI 에게 "마무리해" 를 알릴지 */
export const CALL_ENDING_NOTICE_SECONDS = 30
/** 끝나기 30초 전에 AI 에게 보내는 앱 안내. 학생에게는 보이지 않고, AI 가 다음에 말할 때 이 안내를 따릅니다. */
export const CALL_ENDING_NOTICE =
  '(앱 안내) 30초 남았어. 새 질문은 하지 말고, 약속 하나로 짧게 마무리해.'

/**
 * 지금 "끝나기 30초 전" 안에 들어왔는지. (화면이 이 값이 처음 true 가 될 때 한 번만 알립니다)
 *   isCallEndingSoon(269, 300) -> false   isCallEndingSoon(270, 300) -> true   isCallEndingSoon(300, 300) -> false (이미 끝)
 */
export function isCallEndingSoon(seconds: number, maxSeconds: number): boolean {
  return seconds >= maxSeconds - CALL_ENDING_NOTICE_SECONDS && seconds < maxSeconds
}

/**
 * AI 에게 앱의 안내 한 줄을 대화에 끼워 넣는 이벤트입니다. (OpenAI Realtime 의 conversation.item.create)
 * role 은 system 입니다. 문서에 "대화 중 언제든 넣을 수 있는 시스템 메시지" 로 나와 있습니다.
 * ⚠️ response.create 는 같이 보내지 않습니다. 바로 말하게 하면 학생 말을 끊을 수 있어서, AI 가 다음 차례에 말할 때 반영됩니다.
 * ⚠️ 진짜 서버(GPT 음성)로는 아직 확인하지 못했습니다.
 */
export function appNoticeEvent(text: string): Record<string, unknown> {
  return {
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'system',
      content: [{ type: 'input_text', text }],
    },
  }
}

/**
 * 연결이 실패한 이유. 화면에서 이유별로 다른 안내를 보여주려고 나눕니다.
 *  - token: 서버에서 임시 키를 못 받음 / mic: 마이크를 쓸 수 없음(거부 등) / no-mic: 마이크 자체가 없는 기기
 *  - connect: AI 와 연결하지 못함
 */
export type RealtimeFailReason = 'token' | 'mic' | 'no-mic' | 'connect'

export class RealtimeCallError extends Error {
  reason: RealtimeFailReason
  /**
   * 서버가 알려 준 안내 문장. 있으면 화면에 이 문장을 그대로 보여줍니다.
   * 예: '오늘 통화는 다 썼어요. 내일 다시 만나요' (429), 'AI 통화가 아직 켜져 있지 않아요' (503)
   */
  userMessage?: string

  constructor(reason: RealtimeFailReason, message: string, userMessage?: string) {
    super(message)
    this.name = 'RealtimeCallError'
    this.reason = reason
    this.userMessage = userMessage
  }
}

/** 연결된 통화입니다. close() 를 부르면 연결과 마이크를 모두 정리합니다. */
export interface RealtimeCall {
  close: () => void
  /** true 면 내 마이크 소리를 AI 에게 보내지 않습니다. (마이크는 켜 둔 채 소리만 끊깁니다) */
  setMuted: (muted: boolean) => void
  /** 통화 한 번의 최대 길이(초). 이 시간이 되면 화면이 통화를 끊습니다. 서버 값이 없거나 이상하면 180초 (readCallMaxSeconds) */
  maxCallSeconds: number
  /**
   * AI 에게 앱의 안내 한 줄을 보냅니다. (예: 끝나기 30초 전 "마무리해") 학생 화면 · 자막에는 나오지 않습니다.
   * AI 에게 바로 말하라고 하지는 않아서, AI 가 다음에 말할 때 따릅니다. 통로가 닫혔으면 보내지 않습니다.
   */
  sendAppNotice: (text: string) => void
  /** 서버의 통화 기록 번호. 통화가 끝나면 이 번호로 자막을 보내 결론을 받습니다. (lib/callReview.ts) 서버가 안 알려 줬으면 null */
  callId: string | null
}

// 소리가 나지 않는 아주 짧은 파일입니다. (8000Hz 모노, 100샘플 = 0.0125초, 전부 무음)
const SILENT_WAV =
  'data:audio/wav;base64,UklGRuwAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YcgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='

// AI 목소리를 재생하는 오디오 태그입니다. 통화가 시작되기 전에 미리 만들어 두고 같은 것을 계속 씁니다.
let callAudio: HTMLAudioElement | null = null

function getCallAudio(): HTMLAudioElement {
  if (callAudio === null) {
    callAudio = document.createElement('audio')
    // autoplay: 소리가 오면 바로 재생
    callAudio.autoplay = true
  }
  return callAudio
}

/**
 * 소리를 낼 수 있게 미리 허락받아 둡니다. "받기" 버튼을 누르는 그 순간(await 보다 앞)에 불러야 합니다.
 *
 * 아이폰 사파리는 사용자가 버튼을 직접 누른 순간이 아니면 소리 재생을 막습니다.
 * 그런데 AI 목소리는 받기를 누르고 한참 뒤(서버 연결 뒤)에 시작해서 막힐 수 있습니다.
 * 그래서 버튼을 누르는 순간에 무음 파일을 한 번 재생해 두면, 이 오디오 태그는 나중에도 소리를 낼 수 있습니다.
 */
export function unlockCallAudio(): void {
  const audio = getCallAudio()
  audio.src = SILENT_WAV
  audio.play().catch(() => {
    // 막혀도 통화는 계속되어야 하므로 에러를 던지지 않고 기록만 남깁니다.
    console.warn('[realtimeCall] 소리 재생 허락을 미리 받지 못했습니다.')
  })
}

/** 서버가 통화를 시작하라고 준 것 */
interface CallSession {
  /** 임시 키. 이 값으로 OpenAI 에 연결합니다. */
  key: string
  /** 통화 한 번의 최대 길이(초). 서버 값이 없거나 이상하면 180초 */
  maxCallSeconds: number
  /** 통화 기록 번호. 서버가 안 알려 줬으면 null */
  callId: string | null
}

/**
 * 서버에서 임시 키를 받습니다.
 * api() 로 부르기 때문에 서버 주소와 로그인 토큰이 자동으로 붙습니다.
 * signal 이 "그만" 을 알리면 요청을 멈춥니다.
 *
 * 오늘의 말투(tone)와 학생 카드(card)를 같이 보냅니다. 서버는 이것으로 AI 의 지침을 만들어 임시 키에 묶습니다.
 * 그래서 같은 날이라도 내 기록에 따라 AI 가 묻는 것과 말투가 달라집니다. (lib/callCard.ts)
 * 오늘 채팅 방들에서 한 말(otherRooms)도 보내서, AI 가 채팅에서 이미 한 이야기를 또 묻지 않게 합니다. (#699)
 * ⚠️ 주소 뒤(?a=b)가 아니라 본문에 담아 보냅니다. 주소는 서버 기록에 남기 쉽기 때문입니다.
 */
async function requestCallSession(
  signal: AbortSignal,
  tone: CallTone,
  card: CallCard | null,
  otherRooms: string[],
): Promise<CallSession> {
  try {
    const data = await api<unknown>(SESSION_PATH, {
      method: 'POST',
      body: JSON.stringify({
        careLevel: tone.careLevel,
        maxHarshness: tone.maxHarshness,
        card,
        // 기기에만 있는 최근 7일 집중도 · 폰 든 횟수 · 확인 문제 결과 (lib/studySignals.ts, BE #334)
        studySignals: loadStudySignals(),
        // 생각 습관 테스트(selfReportedBiases · selfReportedWeaknesses)는 #417 에서 지워서 보내지 않습니다. (서버에서 선택 칸)
        // 오늘 채팅 방들에서 한 말 (lib/coachThread.ts 의 otherRoomLines, #699). 없으면 칸을 빼고 보냅니다.
        ...(otherRooms.length > 0 ? { otherRooms } : {}),
      }),
      signal,
    })
    const record =
      typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
    const value = record.value
    if (typeof value !== 'string' || value === '') throw new Error('임시 키가 없습니다')

    // sk- 로 시작하면 서버가 진짜 API 키를 그대로 내려준 것입니다. 노출 사고이므로 절대 쓰지 않고 멈춥니다.
    if (value.startsWith('sk-')) throw new Error('서버가 API 키를 그대로 보냈습니다')

    const maxCallSeconds = readCallMaxSeconds(record)
    const callId = typeof record.callId === 'string' && record.callId !== '' ? record.callId : null
    return { key: value, maxCallSeconds, callId }
  } catch (error) {
    // 에러 안에 키가 들어 있을 수 있어서 원문 대신 이유만 남깁니다.
    const detail = error instanceof Error ? error.message : '알 수 없는 오류'
    // 429(오늘 통화를 다 씀) · 503(통화가 꺼져 있음) · 403 CALL_LOCKED(오늘 공부를 아직 안 끝냄)는
    // 서버가 사람이 읽을 문장을 줍니다. 화면에 그대로 보여주게 넘깁니다.
    const isLocked =
      error instanceof ApiError && error.status === 403 && error.code === 'CALL_LOCKED'
    const userMessage =
      error instanceof ApiError && (error.status === 429 || error.status === 503 || isLocked)
        ? error.message
        : undefined
    throw new RealtimeCallError('token', `임시 키를 받지 못했어요: ${detail}`, userMessage)
  }
}

/** 마이크를 켭니다. 거부되면 'mic' 이유로 실패합니다. */
async function openMicrophone(): Promise<MediaStream> {
  // https 주소나 localhost 가 아니면 mediaDevices 자체가 없습니다.
  if (!navigator.mediaDevices) {
    throw new RealtimeCallError('no-mic', '이 주소에서는 마이크를 쓸 수 없어요')
  }

  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (error) {
    // NotFoundError = 마이크가 아예 없는 기기
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      throw new RealtimeCallError('no-mic', '마이크를 찾을 수 없어요')
    }
    throw new RealtimeCallError('mic', '마이크를 사용할 수 없어요')
  }
}

/**
 * 실제 음성 연결이 끝날 때까지 기다립니다. (#458)
 * 연결 정보(SDP)를 주고받은 뒤에도, 브라우저는 소리가 오갈 길(ICE)을 따로 찾습니다.
 * 학교·회사 방화벽처럼 그 길이 막힌 곳에서는 연결 정보는 오가도 소리는 안 납니다.
 *  - 연결 상태(connectionState)가 'connected' 가 되면 끝납니다.
 *  - 'failed' · 'closed' 가 되거나, 그만두라는 신호(signal: 화면을 떠남 · 15초 제한)가 오면 실패합니다.
 */
function waitUntilConnected(peerConnection: RTCPeerConnection, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    // 끝나면 듣던 것을 모두 떼어 냅니다. (안 떼면 통화가 끝난 뒤에도 계속 불립니다)
    function cleanUp() {
      peerConnection.removeEventListener('connectionstatechange', handleStateChange)
      signal.removeEventListener('abort', handleAbort)
    }
    function handleStateChange() {
      const state = peerConnection.connectionState
      if (state === 'connected') {
        cleanUp()
        resolve()
      } else if (state === 'failed' || state === 'closed') {
        cleanUp()
        reject(new Error(`connection ${state}`))
      }
    }
    function handleAbort() {
      cleanUp()
      reject(new Error('aborted'))
    }

    if (signal.aborted) {
      reject(new Error('aborted'))
      return
    }
    // onconnectionstatechange 는 끊김을 지켜보는 쪽(createConnectionWatcher)이 이미 쓰고 있어서, 덮어쓰지 않게 addEventListener 로 하나 더 붙입니다.
    peerConnection.addEventListener('connectionstatechange', handleStateChange)
    signal.addEventListener('abort', handleAbort)
    // 기다리기 시작하기 전에 이미 연결됐을 수도 있어서 한 번 확인합니다.
    handleStateChange()
  })
}

/** 통화를 시작할 때 넘길 수 있는 설정입니다. */
export interface StartCallOptions {
  /** 대화 글자(자막) 이벤트가 올 때마다 불립니다. (AI 말 · 내 말) */
  onTranscript?: (event: TranscriptEvent) => void
  /**
   * 연결이 끊어졌을 때 한 번 불립니다. wasConnected 가 true 면 통화 중에 끊긴 것이고,
   * false 면 처음부터 연결이 안 된 것입니다. (직접 close() 한 뒤에는 불리지 않습니다)
   */
  onDisconnect?: (wasConnected: boolean) => void
  /**
   * 연결을 그만두라는 신호입니다. 연결하는 도중에 화면을 떠나면 abort() 를 불러 주세요.
   * 기다리던 요청을 멈추고, 이미 켠 마이크를 끕니다.
   */
  signal?: AbortSignal
  /** 오늘의 말투(관리 강도 · 독설 허용 수위). 임시 키를 요청할 때 서버에 같이 보냅니다. (lib/todayCare.ts 의 getCallTone) */
  tone?: CallTone
  /** 학생 카드(내 기록을 숫자로 정리한 것). 서버가 이것으로 질문과 말투를 정합니다. 기록이 없으면 null (lib/callCard.ts) */
  card?: CallCard | null
  /** 오늘 채팅 방들에서 학생이 한 말 몇 줄 ('계획: …' 모양, lib/coachThread.ts 의 otherRoomLines). 없으면 보내지 않습니다. (#699) */
  otherRooms?: string[]
  /** AI 가 통화 중에 부를 수 있는 도구 (예: 계획 짜서 화면에 띄우기, lib/callTools.ts). 없으면 알리지 않습니다. */
  tools?: RealtimeTool[]
  /**
   * AI 가 도구를 부르면 불립니다. 돌려준 글이 AI 에게 결과로 전해지고, AI 가 이어서 말합니다.
   * 실패하면(던지면) "하지 못했어" 를 대신 전합니다.
   */
  onToolCall?: (call: ToolCall) => Promise<string>
}

/**
 * AI 와 음성 통화를 시작합니다. 연결되면 AI 가 먼저 인사합니다.
 * 실제로 소리가 오갈 수 있게 연결된 뒤에야 끝납니다. 그래서 이 함수가 끝나면 화면을 "통화 중" 으로 바꿔도 됩니다. (#458)
 * 중간에 실패하면 이미 켠 마이크·연결을 모두 정리하고 RealtimeCallError 를 던집니다.
 */
export async function startRealtimeCall(options: StartCallOptions = {}): Promise<RealtimeCall> {
  // "그만" 신호를 하나로 모읍니다. 화면을 떠났거나(options.signal), 15초 안에 연결이 안 되면 멈춥니다.
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS)
  if (options.signal?.aborted) controller.abort()
  options.signal?.addEventListener('abort', () => controller.abort())
  const signal = controller.signal

  let session: CallSession
  let microphone: MediaStream
  try {
    session = await requestCallSession(
      signal,
      options.tone ?? DEFAULT_TONE,
      options.card ?? null,
      options.otherRooms ?? [],
    )
    microphone = await openMicrophone()
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }

  // 마이크 허락을 기다리는 사이에 그만두라는 신호가 왔으면, 방금 켠 마이크를 바로 끄고 멈춥니다.
  if (signal.aborted) {
    clearTimeout(timeoutId)
    microphone.getTracks().forEach((track) => track.stop())
    throw new RealtimeCallError('connect', 'AI 와 연결하지 못했어요')
  }

  const peerConnection = new RTCPeerConnection()
  // 화면에는 안 보이고 소리만 나는 오디오 태그입니다. (unlockCallAudio 가 미리 만들어 둔 것과 같은 태그입니다)
  const audioElement = getCallAudio()

  // 연결을 끝낼 때 한 곳에서 전부 정리합니다. (여러 번 불러도 안전합니다)
  let dataChannel: RTCDataChannel | null = null
  // 연결이 끊기는지 지켜봅니다. 우리가 직접 끝낼 때(close)는 지켜보기를 멈춰서 "끊겼다"고 알리지 않습니다.
  const watcher = createConnectionWatcher((wasConnected) => options.onDisconnect?.(wasConnected))
  function close() {
    watcher.stop()
    dataChannel?.close()
    microphone.getTracks().forEach((track) => track.stop())
    peerConnection.close()
    audioElement.srcObject = null
  }

  try {
    // 연결 상태가 바뀔 때마다 지켜보는 쪽에 알려줍니다.
    peerConnection.onconnectionstatechange = () => {
      watcher.handleStateChange(peerConnection.connectionState)
    }

    // AI 목소리가 들어오면 오디오 태그에 연결합니다.
    peerConnection.ontrack = (event) => {
      audioElement.srcObject = event.streams[0]
      // autoplay 만 믿지 않고 한 번 더 재생을 시킵니다. (사파리 대비. 막혀도 통화는 계속됩니다)
      audioElement.play().catch(() => {
        console.warn('[realtimeCall] AI 목소리를 재생하지 못했습니다.')
      })
    }

    // 내 마이크 소리를 연결에 붙입니다.
    microphone.getTracks().forEach((track) => peerConnection.addTrack(track, microphone))

    // 이벤트(글자·명령)를 주고받는 통로입니다. 이름 'oai-events' 는 OpenAI 가 정해 둔 값입니다.
    dataChannel = peerConnection.createDataChannel('oai-events')
    const channel = dataChannel
    // 통로가 열리면 AI 에게 "말을 시작해"라고 알려서 첫 인사가 나오게 합니다.
    // (공식 문서에 인사 방법이 따로 없어서 response.create 이벤트를 쓴 것입니다. 실제 서버로 확인이 필요합니다)
    // 내 말을 글자로 바꾸는 설정(자막)과 AI 의 지침은 서버가 임시 키를 만들 때 이미 넣었습니다. 여기서 다시 보내지 않습니다.
    channel.addEventListener('open', () => {
      // 도구가 있으면 인사 전에 알립니다. 지침 · 자막 설정은 서버가 정했으니 tools 칸만 보냅니다.
      // (session.update 는 보낸 칸만 바꾼다고 문서에 있습니다. 실제 서버로 확인이 필요합니다)
      if (options.tools && options.tools.length > 0) {
        channel.send(
          JSON.stringify({
            type: 'session.update',
            session: { type: 'realtime', tools: options.tools, tool_choice: 'auto' },
          }),
        )
      }
      channel.send(JSON.stringify({ type: 'response.create' }))
    })

    // AI 가 부른 도구를 실행하고 결과를 돌려줍니다. 통로가 닫혔으면(통화가 끝남) 보내지 않습니다.
    function answerToolCall(call: ToolCall) {
      const run = options.onToolCall ?? (() => Promise.reject(new Error('도구 없음')))
      run(call)
        .catch(() => '앱이 이 일을 하지 못했어. 학생에게 채팅에서 다시 해 보자고 해.')
        .then((output) => {
          if (channel.readyState !== 'open') return
          toolOutputEvents(call.callId, output).forEach((item) =>
            channel.send(JSON.stringify(item)),
          )
        })
    }

    // 서버가 보내는 이벤트 중 대화 글자와 도구 부르기만 골라서 처리합니다.
    channel.addEventListener('message', (event: MessageEvent) => {
      const transcriptEvent = parseTranscriptEvent(event.data)
      if (transcriptEvent) options.onTranscript?.(transcriptEvent)
      const toolCall = parseToolCallEvent(event.data)
      if (toolCall) answerToolCall(toolCall)
    })

    // 연결 정보(SDP)를 만들어 OpenAI 에 보내고, 받은 답을 적용합니다.
    const offer = await peerConnection.createOffer()
    await peerConnection.setLocalDescription(offer)

    const answerResponse = await fetch(OPENAI_CALLS_URL, {
      method: 'POST',
      body: offer.sdp,
      // 그만두라는 신호가 오면 이 요청도 멈춥니다. (멈추면 아래 catch 가 마이크와 연결을 정리합니다)
      signal,
      headers: {
        Authorization: `Bearer ${session.key}`,
        'Content-Type': 'application/sdp',
      },
    })
    if (!answerResponse.ok) throw new Error(`status ${answerResponse.status}`)

    await peerConnection.setRemoteDescription({ type: 'answer', sdp: await answerResponse.text() })

    // 연결 정보를 주고받은 것만으로는 아직 소리가 오가지 않습니다. 실제 음성 길이 열릴 때까지 기다립니다. (#458)
    // 여기서 기다리지 않으면, 방화벽에 막혀 소리가 안 나는데도 화면은 "통화 중" 이 됩니다.
    await waitUntilConnected(peerConnection, signal)
  } catch {
    close()
    throw new RealtimeCallError('connect', 'AI 와 연결하지 못했어요')
  } finally {
    // 연결이 됐든 실패했든 제한 시간 타이머는 끕니다.
    clearTimeout(timeoutId)
  }

  // 마이크 트랙의 enabled 를 false 로 하면 연결은 그대로 두고 소리만 무음으로 바뀝니다.
  function setMuted(muted: boolean) {
    microphone.getAudioTracks().forEach((track) => {
      track.enabled = !muted
    })
  }

  // AI 에게 앱의 안내 한 줄을 보냅니다. 통화가 끝나 통로가 닫혔으면 보내지 않습니다.
  function sendAppNotice(text: string) {
    if (dataChannel === null || dataChannel.readyState !== 'open') return
    dataChannel.send(JSON.stringify(appNoticeEvent(text)))
  }

  return {
    close,
    setMuted,
    sendAppNotice,
    maxCallSeconds: session.maxCallSeconds,
    callId: session.callId,
  }
}
