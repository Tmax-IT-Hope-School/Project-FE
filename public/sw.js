/**
 * STARFLOW 서비스 워커 (#105)
 *
 * 서비스 워커는 웹 페이지와 따로, 브라우저 뒤에서 돌아가는 작은 프로그램입니다.
 * 지금 하는 일은 세 가지입니다.
 *   - 인터넷이 끊긴 상태에서 화면을 열면, 미리 저장해 둔 오프라인 안내 화면(offline.html)을 보여줍니다.
 *   - 서버가 보낸 푸시(웹 푸시 #256)를 받아 알림으로 띄웁니다. 앱을 완전히 닫아 둬도 이 파일이 깨어나 띄웁니다.
 *     (알림을 켜고 끄는 쪽은 src/lib/webPush.ts 입니다)
 *   - 휴대폰·컴퓨터에 뜬 알림을 누르면, 그 알림에 적힌 화면을 엽니다.
 *     (앱이 열려 있을 때 띄우는 알림은 src/lib/notifications.ts 의 showSystemNotification 입니다)
 *
 * 앱 화면(JS·CSS)은 일부러 저장하지 않습니다. 저장해 두면 새로 배포해도 옛날 화면이 계속 보일 수 있어서입니다.
 *
 * ⚠️ 이 파일을 고치면 아래 CACHE_NAME 의 숫자를 올려 주세요. 그래야 예전 저장본이 지워집니다.
 */

const CACHE_NAME = 'starflow-offline-v5'
const OFFLINE_URL = '/offline.html'

// 오프라인 화면과 그 화면에 나오는 아이콘을 미리 저장합니다.
const PRECACHE_URLS = [OFFLINE_URL, '/icons/icon-192.png']

// 1) 설치: 오프라인 화면을 미리 저장해 둡니다.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)))
  // 새 버전이 설치되면 기다리지 않고 바로 바꿔 끼웁니다.
  self.skipWaiting()
})

// 2) 활성화: 이름이 다른 예전 저장본을 지웁니다.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  )
})

// 3) 요청 가로채기: "화면 열기" 요청만 봅니다. 인터넷이 되면 그대로, 끊겼으면 오프라인 화면을 줍니다.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(OFFLINE_URL).then((cached) => cached || Response.error()),
    ),
  )
})

/**
 * 알림에 붙은 주소를 "우리 앱 안의 주소" 로 바꿔 줍니다. 우리 앱 주소가 아니면 홈('/')입니다.
 *
 * 예전 검사는 "맨 앞 글자가 / 인지" 하나였는데, '//evil.example/login' 도 / 로 시작해서 통과했습니다.
 * 브라우저는 '//evil.example' 을 'https://evil.example' 로 읽기 때문에, 알림을 누르면 외부 사이트(로그인 화면으로 꾸민 피싱 등)가 열릴 수 있었습니다.
 * 그래서 앱 주소를 기준으로 실제 주소를 만들어 보고, 주소의 출처(origin)가 우리 앱과 같을 때만 쓰고, 경로 부분(경로 + ?뒤 + #뒤)만 돌려줍니다.
 *
 *   '/timer'                  -> '/timer'
 *   '/timer?tab=focus'        -> '/timer?tab=focus'
 *   '//evil.example/login'    -> '/'              (다른 사이트)
 *   'https://evil.example/x'  -> '/'              (다른 사이트)
 *   'https://우리앱/notifications' -> '/notifications'   (우리 앱이면 경로만)
 *   '/\evil.example'          -> '/'              (브라우저가 \ 를 / 로 읽어 다른 사이트가 됨)
 *   'javascript:alert(1)'     -> '/'
 *   undefined · 글자가 아님    -> '/'
 */
function toSafePath(value) {
  if (typeof value !== 'string') return '/'
  try {
    const parsed = new URL(value, self.location.origin)
    if (parsed.origin !== self.location.origin) return '/'
    return parsed.pathname + parsed.search + parsed.hash
  } catch {
    return '/'
  }
}

// 4) 푸시를 받았을 때: 서버가 보낸 내용으로 알림을 띄웁니다. (BE 의 WebPushSender.Payload)
//    서버가 보내는 모양: { "title": "오늘의 작전", "body": "…", "url": "/timer" }  (url 이 없으면 메시지함 /notifications)
//    브라우저와 약속(userVisibleOnly)했기 때문에, 받은 푸시는 내용이 이상해도 반드시 알림을 띄웁니다.
self.addEventListener('push', (event) => {
  let content = {}
  try {
    content = event.data ? event.data.json() : {}
  } catch {
    // JSON 이 아니면 기본 문장으로 띄웁니다.
  }
  const title = typeof content.title === 'string' ? content.title : 'STARFLOW'
  const body = typeof content.body === 'string' ? content.body : '새 소식이 있어요.'
  // 서버가 주소를 안 보냈으면 메시지함(알림 화면)을 엽니다. 보냈으면 그 주소(우리 앱 안의 주소일 때만)를 엽니다.
  const url = typeof content.url === 'string' ? toSafePath(content.url) : '/notifications'

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      // 같은 이름표(tag)의 알림은 새로 쌓이지 않고 하나로 바뀝니다. (하루 한 번 "오늘의 작전" 이 쌓이지 않게)
      tag: 'push-' + title,
      // 아래 'notificationclick' 이 이 주소를 엽니다.
      data: { url },
    }),
  )
})

// 5) 알림을 눌렀을 때: 알림에 붙어 있는 주소(data.url)의 화면을 엽니다.
self.addEventListener('notificationclick', (event) => {
  // 누른 알림은 닫습니다.
  event.notification.close()

  // 알림을 띄울 때 붙여 둔 주소입니다. 없으면 홈을 엽니다. (예: '/notifications', '/call')
  const data = event.notification.data
  // 알림에 붙여 둔 주소도 누르는 순간 다시 확인합니다. (알림을 띄울 때 확인했어도, 믿을 수 있는 건 지금 이 검사뿐입니다)
  const path = toSafePath(data && data.url)

  event.waitUntil(openAppAt(path))
})

/**
 * 앱 창을 앞으로 가져와서 path 화면을 엽니다.
 *  - 이미 열려 있는 앱 창이 있으면 그 창을 씁니다. (창이 계속 늘어나지 않게)
 *  - 없으면 새 창을 엽니다.
 */
async function openAppAt(path) {
  // 지금 열려 있는 우리 앱의 창(탭)들을 찾습니다.
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const opened = windows[0]
  if (!opened) return self.clients.openWindow(path)

  try {
    const focused = await opened.focus()
    // 이미 그 화면을 보고 있으면 그대로 둡니다. (다시 열면 화면이 새로고침됩니다)
    // 주소 뒤의 ?tab=focus 같은 부분(search)까지 같이 비교합니다. (#해시는 화면을 다시 열지 않으니 비교하지 않습니다)
    const current = new URL(focused.url)
    const target = new URL(path, self.location.origin)
    if (current.pathname + current.search === target.pathname + target.search) return focused
    return await focused.navigate(path)
  } catch {
    // 창을 못 옮기는 경우(브라우저가 막음)에는 새 창으로 엽니다.
    return self.clients.openWindow(path)
  }
}
