/**
 * 웹 푸시: 앱을 닫아 둬도 휴대폰 알림 칸에 뜨는 "푸시 알림" 을 켜고 끕니다. (BE 이슈 #32, FE #256)
 *
 * ■ 켜는 순서
 *  1. 알림 권한을 받는다 (브라우저가 "알림을 허용할까요?" 를 물어봄)
 *  2. 공개 키를 정한다. 환경변수 VITE_VAPID_PUBLIC_KEY 가 있으면 그 값, 없으면 서버에서 받는다   GET  /push/public-key
 *  3. 브라우저에 구독을 만든다 (서비스 워커의 pushManager.subscribe)
 *  4. 구독 정보를 서버에 보낸다                     POST /push/subscriptions
 *  끄면 브라우저의 구독을 지우고 서버에도 알립니다.    DELETE /push/subscriptions
 *
 * ■ 알림을 실제로 띄우는 곳은 서비스 워커(public/sw.js)의 'push' 입니다. 앱이 닫혀 있어도 서비스 워커가 깨어나 띄웁니다.
 *
 * ■ 기기마다 조건 (BE 저장소의 docs/DEPLOY.md "웹 푸시 켜기")
 *  - 아이폰·아이패드: iOS 16.4 이상, "홈 화면에 추가" 한 앱에서만 됩니다. 사파리 탭에서는 안 됩니다.
 *  - 개발 서버(pnpm run dev)는 서비스 워커를 등록하지 않아서 켤 수 없습니다. (lib/pwa.ts)
 *  - 서버에 VAPID 키가 없으면(내 컴퓨터의 BE) 공개 키가 503 이라 켤 수 없습니다.
 *
 * ⚠️ 구독 주소(endpoint)를 console.log 로 찍지 않습니다. 그 주소를 아는 사람은 이 기기로 알림을 보낼 수 있습니다.
 */
import { ApiError, api } from '@/lib/api'
import { isNotificationSupported } from '@/lib/notifications'
import { isIos, isStandalone } from '@/lib/pwa'

const REQUEST_TIMEOUT_MS = 10000

/**
 * 이 기기의 푸시 상태
 *  - unsupported   : 이 브라우저(또는 개발 서버)에서는 푸시를 쓸 수 없음
 *  - needs-install : 아이폰인데 홈 화면 앱이 아니라서, 설치해야 켤 수 있음
 *  - denied        : 알림 권한을 거부함 (휴대폰·브라우저 설정에서 직접 켜야 함)
 *  - off           : 켤 수 있지만 아직 꺼져 있음
 *  - on            : 켜져 있음
 */
export type WebPushStatus = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'

/** 켜거나 끄다가 실패했을 때. message 는 화면에 그대로 보여 줄 문장입니다. */
export class WebPushError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebPushError'
  }
}

// 지금 일하고 있는 서비스 워커. 없으면(개발 서버·오래된 브라우저) null
async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  const registration = await navigator.serviceWorker.getRegistration()
  if (registration === undefined) return null
  return navigator.serviceWorker.ready
}

/** 이 기기의 푸시 상태를 알아봅니다. (서버는 부르지 않습니다) */
export async function getWebPushStatus(): Promise<WebPushStatus> {
  // 아이폰은 홈 화면 앱이 아니면 PushManager 자체가 없어서, 이 경우를 먼저 따로 알려 줍니다.
  if (isIos() && !isStandalone()) return 'needs-install'
  if (!isNotificationSupported() || !('PushManager' in window)) return 'unsupported'
  const registration = await getRegistration()
  if (registration === null) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const subscription = await registration.pushManager.getSubscription()
  return subscription === null ? 'off' : 'on'
}

/**
 * 서버의 공개 키(base64url 글자)를 브라우저가 원하는 모양(바이트 배열)으로 바꿉니다.
 * base64url 은 + 대신 -, / 대신 _ 를 쓰고 끝의 = 를 뺀 글자라서, 원래 모양으로 되돌린 뒤 바꿉니다.
 */
function toKeyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

async function fetchPublicKey(): Promise<string> {
  // 환경변수(VITE_VAPID_PUBLIC_KEY)에 공개 키를 넣어 두었으면 그것을 씁니다. 공개 키라 누구에게 보여도 되는 값입니다.
  // 비어 있으면 서버에 물어봅니다. (서버의 VAPID 키와 같은 값이어야 서버가 보낸 푸시를 받을 수 있습니다)
  const envKey = import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim()
  if (envKey) return envKey
  try {
    const result = await api<unknown>('/push/public-key', {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const key =
      typeof result === 'object' && result !== null
        ? (result as Record<string, unknown>).publicKey
        : undefined
    if (typeof key !== 'string' || key === '') throw new Error('공개 키가 없습니다')
    return key
  } catch (error) {
    // 503: 서버에 푸시가 아직 켜져 있지 않음. 서버가 준 문장을 그대로 보여 줍니다.
    if (error instanceof ApiError && error.status === 503) throw new WebPushError(error.message)
    throw new WebPushError('서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
}

/**
 * 이 기기의 푸시를 켭니다. 켰으면 끝나고, 못 켜면 WebPushError 를 던집니다.
 * ⚠️ 버튼을 누른 순간에 불러야 합니다. 아이폰은 사용자가 직접 누른 순간에만 권한을 물어봅니다.
 */
export async function turnOnWebPush(): Promise<void> {
  const status = await getWebPushStatus()
  if (status === 'needs-install') {
    throw new WebPushError('아이폰은 홈 화면에 추가한 앱에서만 켤 수 있어요.')
  }
  if (status === 'unsupported') {
    throw new WebPushError('이 브라우저에서는 앱을 닫았을 때 오는 알림을 쓸 수 없어요.')
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new WebPushError(
      '알림이 허용되지 않았어요. 휴대폰이나 브라우저 설정에서 알림을 허용해 주세요.',
    )
  }

  const publicKey = await fetchPublicKey()
  const registration = await getRegistration()
  if (registration === null) {
    throw new WebPushError('이 브라우저에서는 앱을 닫았을 때 오는 알림을 쓸 수 없어요.')
  }

  let subscription: PushSubscription
  try {
    // userVisibleOnly: 받은 푸시는 반드시 화면에 알림으로 띄우겠다는 약속입니다. (브라우저가 이 약속을 요구합니다)
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toKeyBytes(publicKey),
    })
  } catch {
    throw new WebPushError('알림을 켜지 못했어요. 잠시 후 다시 시도해 주세요.')
  }

  try {
    await api<void>('/push/subscriptions', {
      method: 'POST',
      body: JSON.stringify(subscription.toJSON()),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    // 서버에 못 알렸으면 브라우저의 구독도 지워서, "켜졌는데 알림이 안 오는" 상태로 남지 않게 합니다.
    await subscription.unsubscribe().catch(() => false)
    throw new WebPushError('서버에 알림 설정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
}

/**
 * 이 기기의 푸시를 끕니다. 브라우저의 구독을 지우고 서버에도 알립니다.
 * 서버에 못 알려도 브라우저 구독은 지워서, 이 기기에는 더 이상 오지 않습니다. (서버는 다음에 보낼 때 "끝난 구독" 으로 알고 지웁니다)
 */
export async function turnOffWebPush(authHeaders?: Record<string, string>): Promise<void> {
  const registration = await getRegistration()
  const subscription = registration ? await registration.pushManager.getSubscription() : null
  if (subscription === null) return

  const endpoint = subscription.endpoint
  await subscription.unsubscribe().catch(() => false)
  try {
    await api<void>('/push/subscriptions', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
      // 로그아웃처럼 로그인 정보를 곧 지우는 때는, 지우기 전에 읽어 둔 토큰을 넘겨 받습니다.
      // (이 함수는 서비스 워커를 기다리느라 늦게 서버를 부르는데, 그때는 이미 토큰이 지워져 있어서 토큰 없이 나갑니다)
      headers: authHeaders,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    // 일부러 아무것도 하지 않습니다. (위 설명)
  }
}

/**
 * 이 기기의 브라우저 푸시 구독만 지웁니다. 서버는 부르지 않습니다.
 *
 * 탈퇴하거나 로그인이 만료(401)돼서 서버를 부를 수 없을 때 씁니다. 구독이 남아 있으면 같은 기기에서
 * 다른 사람이 로그인했을 때 설정에 "켜져 있어요" 가 뜨고, 앞사람 계정에 묶인 알림이 이 기기로 옵니다.
 * 브라우저에서 구독을 지우면 서버가 다음에 보낼 때 "끝난 구독(404 · 410)" 으로 알고 스스로 지웁니다.
 * 구독이 없거나 지우지 못해도 에러를 던지지 않습니다. (로그아웃 · 탈퇴를 막으면 안 되기 때문입니다)
 */
export async function unsubscribeThisDevice(): Promise<void> {
  try {
    const registration = await getRegistration()
    const subscription = registration ? await registration.pushManager.getSubscription() : null
    await subscription?.unsubscribe()
  } catch {
    // 일부러 아무것도 하지 않습니다. (위 설명)
  }
}
