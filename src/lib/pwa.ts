import { removeData } from '@/lib/storage'

/**
 * 웹 앱을 휴대폰 홈 화면에 설치(PWA)하는 데 필요한 함수입니다. (#105)
 * React 없이 돌아가는 함수라서 lib/ 에 둡니다.
 */

/**
 * 서비스 워커(public/sw.js)를 등록합니다. 앱을 처음 열 때 main.tsx 에서 한 번 부릅니다.
 *
 * 개발 서버(pnpm run dev)에서는 등록하지 않습니다.
 * 등록해 두면 코드를 고쳐도 옛날 화면이 보이는 것처럼 헷갈릴 수 있어서입니다.
 * 확인하려면 pnpm run build → pnpm run preview 로 켜서 보세요.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  // 아주 오래된 브라우저는 서비스 워커가 없습니다. 없으면 그냥 넘어갑니다.
  if (!('serviceWorker' in navigator)) return

  // 화면을 다 그린 뒤에 등록해서, 첫 화면이 늦게 뜨지 않게 합니다.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // 등록에 실패해도 앱은 그대로 쓸 수 있습니다. 설치·오프라인 화면만 안 될 뿐입니다.
      console.warn('[pwa] 서비스 워커를 등록하지 못했습니다.')
    })
  })
}

/** 아이폰·아이패드인지 확인합니다. */
export function isIos(): boolean {
  const userAgent = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(userAgent)) return true
  // 요즘 아이패드는 자기를 맥(Macintosh)이라고 소개합니다. 화면 터치가 되면 아이패드로 봅니다.
  return userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1
}

/** 홈 화면에 설치한 앱으로 열었는지(주소창 없이 열렸는지) 확인합니다. */
export function isStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  // 아이폰 Safari 는 위 방법 대신 navigator.standalone 으로 알려줍니다. (TypeScript 기본 타입에 없어서 직접 적습니다)
  const iosNavigator = navigator as Navigator & { standalone?: boolean }
  return iosNavigator.standalone === true
}

/** 홈의 아이폰 설치 안내(components/layout/IosInstallGuide.tsx)를 닫았는지 적어 두는 저장소 이름 */
export const IOS_INSTALL_GUIDE_DISMISSED_KEY = 'ios-install-guide-dismissed'

/** 닫아 둔 아이폰 설치 안내를 다시 보이게 합니다. (설정에서 "설치 방법 보기" 를 누를 때) */
export function showIosInstallGuideAgain(): void {
  removeData(IOS_INSTALL_GUIDE_DISMISSED_KEY)
}
