/**
 * 아래 탭(홈·카드·채팅·통계·기록) 하나에 어떤 주소들이 묶이는지 한 곳에 모아 둔 파일입니다. (#386, 2026-10-24 5탭)
 *
 * 탭에는 화면이 다 들어갈 자리가 없어서, 탭에 없는 화면은 가까운 탭 아래에 묶습니다.
 * 이 주소들에 있을 때는 그 탭이 선택된 모양이어야 합니다.
 *
 *   홈 탭:   / (첫 화면). 2026-10-18 에 '오늘'(/today) 에서 이름 · 주소를 바꿨습니다.
 *   카드 탭: /cards + 목표 화면(/goals…) + 타이머(/timer). 타이머는 카드를 실행하는 화면이라 카드 탭에 묶습니다.
 *            (2026-10-24 시안대로 타이머 탭을 빼고 카드 탭을 다시 넣었습니다)
 *   채팅 탭: /chat (대화방 목록) + 방 3개 /chat/plan · /chat/counsel · /chat/tutor (lib/chatRooms.ts, #582)
 *            2026-10-18 저녁에 '코치' 탭(/coach) 하나를 대화방 3개로 나누며 이름 · 주소를 바꿨습니다.
 *            예전 /coach · /counsel 은 계획 이야기(?plan=)면 계획 방, 그 밖은 상담 방으로 넘깁니다. (router.tsx)
 *   통계 탭: /stats. 2026-10-24 까지 기록 탭에 있던 숫자 · 그래프 · AI 분석 · 사진 채점을 옮겼습니다. (내 숲 · 지난 통화 요약은 뺌)
 *   기록 탭: /records. 2026-10-24 부터 일간 · 주간 리포트(History) 화면입니다.
 */

/** 홈 탭(첫 화면)의 주소 */
export const HOME_PATH = '/'

/** 채팅 탭(대화방 목록)의 주소 */
export const CHAT_PATH = '/chat'

// 대화방 하나하나의 주소(상담 방 COACH_PATH · 계획 방 PLAN_CHAT_PATH)는 방 목록과 같이 lib/chatRooms.ts 에 있습니다.

/** 카드 탭(카드 목록)의 주소 */
export const CARDS_PATH = '/cards'

/** 통계 탭의 주소 */
export const STATS_PATH = '/stats'

/** 기록 탭(일간 · 주간 리포트)의 주소 */
export const RECORDS_PATH = '/records'

/** 문제 풀이 주간 리포트 주소 (2026-10-24, pages/QuizReportPage.tsx) */
export const QUIZ_REPORT_PATH = '/records/quiz'

/** 나 사용설명서 (2026-10-24, pages/ManualPage.tsx). 화면 안에 "‹ 기록" 링크가 따로 있습니다. */
export const MANUAL_PATH = `${RECORDS_PATH}/manual`

/** 기록 탭 아래에 묶인 화면. 위에 "‹ 기록" 돌아가기 링크가 나옵니다. (시험은 2026-10-18 에 지웠습니다) */
const recordsChildPaths: string[] = [QUIZ_REPORT_PATH]

/** 카드 탭 아래에 묶인 화면. 목표는 카드 목록에서, 타이머는 카드의 [시작] 에서 들어갑니다. */
const cardsChildPaths = ['/goals', '/timer']

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
 * 지금 주소가 "카드" 탭에 속하는지. 목표 · 타이머 화면에 있을 때도 "카드" 를 선택된 모양으로 둡니다.
 *
 *   isCardsPath('/cards')            -> true
 *   isCardsPath('/cards/new')        -> true
 *   isCardsPath('/goals/abc')        -> true
 *   isCardsPath('/timer')            -> true
 *   isCardsPath('/')                 -> false
 */
export function isCardsPath(pathname: string): boolean {
  return isUnder(pathname, CARDS_PATH) || cardsChildPaths.some((path) => isUnder(pathname, path))
}

/**
 * 지금 주소가 "통계" 탭에 속하는지. 사진 채점(/stats/answer-check)에서도 "통계" 가 선택된 모양입니다.
 *
 *   isStatsPath('/stats')                -> true
 *   isStatsPath('/stats/answer-check')   -> true
 *   isStatsPath('/records')              -> false
 */
export function isStatsPath(pathname: string): boolean {
  return isUnder(pathname, STATS_PATH)
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
