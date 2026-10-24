import {
  CARDS_PATH,
  CHAT_PATH,
  HOME_PATH,
  isCardsPath,
  isRecordsPath,
  isStatsPath,
  RECORDS_PATH,
  STATS_PATH,
} from '@/lib/tabMenu'

/**
 * 앱의 주요 메뉴 목록입니다. (2026-10-24 시안대로 5탭: 홈 · 카드 · 채팅 · 통계 · 기록)
 * 예전 4탭(홈 · 채팅 · 타이머 · 기록)에서 타이머 탭을 빼고 카드 · 통계 탭을 넣었습니다.
 * 타이머는 카드의 [시작] 으로 들어가고, 예전 기록 탭의 그래프 · AI 분석은 통계 탭으로 옮겼습니다.
 * 채팅은 대화방 목록입니다(📞 매일 통화 · 📅 계획 · 💬 상담 · 📚 과목 쌤, lib/chatRooms.ts).
 * PC 헤더 메뉴와 모바일 하단 탭이 이 목록을 같이 씁니다.
 * 메뉴를 추가·변경하려면 여기 한 곳만 고치면 됩니다.
 * 설정 · 알림은 탭에 없습니다. 설정은 헤더(PC 메뉴 맨 오른쪽 "설정" · 모바일 오른쪽 위 톱니 SettingsLink), 알림은 헤더의 종입니다.
 */
export const navItems = [
  { to: HOME_PATH, label: '홈' },
  { to: CARDS_PATH, label: '카드' },
  { to: CHAT_PATH, label: '채팅' },
  { to: STATS_PATH, label: '통계' },
  { to: RECORDS_PATH, label: '기록' },
]

/**
 * 지금 주소에서 이 메뉴를 "선택된 모양" 으로 보여줄지 알려줍니다.
 * NavLink 는 주소가 똑같거나 그 아래일 때만 선택되므로, "카드" 처럼 다른 주소(목표 · 타이머)가
 * 묶인 메뉴는 여기서 따로 확인합니다. (NavLink 의 isActive 와 함께 씁니다)
 */
export function isNavItemSelected(to: string, pathname: string): boolean {
  if (to === CARDS_PATH) return isCardsPath(pathname)
  if (to === STATS_PATH) return isStatsPath(pathname)
  if (to === RECORDS_PATH) return isRecordsPath(pathname)
  return false
}
