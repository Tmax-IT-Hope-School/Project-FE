/**
 * 화면이 자동으로 꺼지지 않게 하는 브라우저 기능(Wake Lock)을 감싼 함수입니다.
 *
 * 책을 보며 공부하면 휴대폰을 안 만지게 되고, 그러면 화면이 꺼집니다.
 * 화면이 꺼지면 브라우저는 "다른 곳으로 나갔다" 고 알려서 타이머가 멈추고 딴짓으로 기록됩니다.
 * 그래서 타이머가 흐르는 동안에는 화면을 켜 둡니다.
 *
 * 지원하지 않는 브라우저거나 기기가 거절하면(배터리 절약 모드 등) 에러 없이 조용히 넘어갑니다.
 * 화면이 꺼지는 것을 못 막을 뿐, 타이머는 그대로 동작합니다. (lib/alarm.ts 와 같은 방식)
 */

// 지금 걸어 둔 "화면 꺼짐 방지". 안 걸었으면 null 입니다.
let screenLock: WakeLockSentinel | null = null
// 브라우저에게 요청을 보내 놓고 아직 답을 기다리는 중인 요청. 없으면 null 입니다.
// 기다리는 사이에 keepScreenOn 이 또 불리면(개발 모드의 StrictMode 등) 요청을 한 번 더 보내지 않고 이 요청을 같이 기다립니다.
let pendingRequest: Promise<void> | null = null
// 지금 화면을 켜 두고 싶은 상태인지. 요청을 기다리는 사이에 letScreenSleep 이 불렸으면 false 가 되어,
// 답이 늦게 도착해도 걸지 않고 바로 풉니다. (안 그러면 아무도 안 풀어 주는 잠금이 남습니다)
let isWanted = false

/** 화면이 자동으로 꺼지지 않게 합니다. 이미 걸려 있거나 거는 중이면 아무것도 새로 하지 않습니다. */
export async function keepScreenOn(): Promise<void> {
  if (!('wakeLock' in navigator)) return
  isWanted = true
  // released: 브라우저가 스스로 풀어 버렸는지. (다른 탭에 다녀오면 풀립니다)
  if (screenLock !== null && !screenLock.released) return
  if (pendingRequest !== null) return pendingRequest

  pendingRequest = (async () => {
    try {
      const lock = await navigator.wakeLock.request('screen')
      if (isWanted) {
        screenLock = lock
      } else {
        // 기다리는 사이에 "이제 꺼도 돼" 가 왔습니다. 걸지 않고 바로 풉니다.
        await lock.release().catch(() => {})
      }
    } catch {
      // 거절당해도 앱은 계속 돌아가야 합니다.
      screenLock = null
    } finally {
      pendingRequest = null
    }
  })()
  return pendingRequest
}

/** 화면 꺼짐 방지를 풉니다. 배터리를 아끼려고, 타이머가 멈추면 바로 풉니다. */
export async function letScreenSleep(): Promise<void> {
  isWanted = false
  const lock = screenLock
  screenLock = null
  if (lock === null || lock.released) return

  try {
    await lock.release()
  } catch {
    // 이미 풀렸으면 할 일이 없습니다.
  }
}
