/**
 * 아래 탭(홈·채팅·타이머·기록) 하나에 어떤 주소들이 묶이는지 한 곳에 모아 둔 파일입니다. (#386, 2026-10-18 4탭)
 *
 * 탭에는 화면이 다 들어갈 자리가 없어서, 탭에 없는 화면은 가까운 탭 아래에 묶습니다.
 * 이 주소들에 있을 때는 그 탭이 선택된 모양이어야 합니다.
 *
 *   홈 탭:   / (첫 화면) + 카드 · 목표 화면(/cards… · /goals…). 2026-10-18 에 '오늘'(/today) 에서 이름 · 주소를 바꿨습니다.
 *   채팅 탭: /chat (대화방 목록) + 방 3개 /chat/plan · /chat/counsel · /chat/tutor (lib/chatRooms.ts, #582)
 *            2026-10-18 저녁에 '코치' 탭(/coach) 하나를 대화방 3개로 나누며 이름 · 주소를 바꿨습니다.
 *            예전 /coach · /counsel 은 계획 이야기(?plan=)면 계획 방, 그 밖은 상담 방으로 넘깁니다. (router.tsx)
 *   기록 탭: /records. 2026-10-18 에 '분석' 에서 이름을 바꾸며 주소도 맞췄습니다.
 *   (하위 탭은 사용설명서 · 가설·실험을 2026-10-18 에, 리포트를 2026-10-23 에 지워서 이제 없습니다)
 */

/** 홈 탭(첫 화면)의 주소 */
export const HOME_PATH = '/'

/** 채팅 탭(대화방 목록)의 주소 */
export const CHAT_PATH = '/chat'

// 대화방 하나하나의 주소(상담 방 COACH_PATH · 계획 방 PLAN_CHAT_PATH)는 방 목록과 같이 lib/chatRooms.ts 에 있습니다.

/** 기록 탭의 주소 */
export const RECORDS_PATH = '/records'

/** 문제 풀이 주간 리포트 주소 (2026-10-24, pages/QuizReportPage.tsx) */
export const QUIZ_REPORT_PATH = '/records/quiz'

/** 기록 탭 아래에 묶인 화면. 위에 "‹ 기록" 돌아가기 링크가 나옵니다. (시험은 2026-10-18 에 지웠습니다) */
const recordsChildPaths: string[] = [QUIZ_REPORT_PATH]

/** 홈 탭 아래에 묶인 화면. 카드 탭이 아래 탭에서 빠져서 카드 · 목표 화면은 홈 탭에서 들어갑니다. */
const homeCardPaths = ['/cards', '/goals']

/**
 * pathname 이 base 이거나 그 아래 주소인지 봅니다.
 * 앞부분만 같은 다른 주소(/cards-old)는 아닙니다. (그래서 '/' 를 붙여서 비교합니다)
 *
 *   isUnder('/cards', '/cards')           -> true
 *   isUnder('/cards/new', '/cards')       -> true
 *   isUnder('/cards-old', '/cards')       -> false
 */
function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`)
}

/**
 * 지금 주소가 "기록" 탭에 속하는지. 하단 탭·헤더에서 "기록" 을 선택된 모양으로 만들 때 씁니다.
 *
 *   isRecordsPath('/records')         -> true
 *   isRecordsPath('/')                -> false
 */
export function isRecordsPath(pathname: string): boolean {
  return (
    isUnder(pathname, RECORDS_PATH) || recordsChildPaths.some((path) => isUnder(pathname, path))
  )
}

/**
 * 지금 주소가 "홈" 탭에 속하는지. 카드 · 목표 화면에 있을 때도 "홈" 을 선택된 모양으로 둡니다.
 * 홈 주소 '/' 는 모든 주소의 앞부분이라 isUnder 로 보면 안 되고, 딱 '/' 일 때만 봅니다.
 *
 *   isHomePath('/')                  -> true
 *   isHomePath('/cards/new')         -> true
 *   isHomePath('/goals/abc')         -> true
 *   isHomePath('/chat/counsel')      -> false
 */
export function isHomePath(pathname: string): boolean {
  return pathname === HOME_PATH || homeCardPaths.some((path) => isUnder(pathname, path))
}

/**
 * 화면 위에 보여 줄 돌아가기 링크. 탭 아래에 묶인 화면에서만 있고, 나머지는 null 입니다.
 * (카드 · 목표 화면은 자기 화면에 돌아가기 링크가 있습니다)
 *
 *   getBackToTabLink('/records/quiz') -> { to: '/records', label: '기록' }
 *   getBackToTabLink('/timer')        -> null
 */
export function getBackToTabLink(pathname: string): { to: string; label: string } | null {
  if (recordsChildPaths.some((path) => isUnder(pathname, path))) {
    return { to: RECORDS_PATH, label: '기록' }
  }
  return null
}
