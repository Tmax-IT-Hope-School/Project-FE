import { isNavItemSelected, navItems } from '@/components/layout/navItems'
import { cn } from '@/lib/cn'
import { scrollToTop } from '@/lib/scroll'
import { CHAT_PATH, HOME_PATH, RECORDS_PATH, STATS_PATH } from '@/lib/tabMenu'
import type { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

/** 아이콘 하나 (라이브러리 없이 SVG 를 직접 그립니다. 선 굵기 · 크기를 탭마다 같게) */
function TabIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-6 w-6"
    >
      {children}
    </svg>
  )
}

/** 탭 주소 → 아이콘. 홈(집) · 채팅(말풍선) · 타이머(시계) · 기록(막대그래프) · 통계(꺾은선) */
const TAB_ICONS: Record<string, ReactNode> = {
  [HOME_PATH]: (
    <TabIcon>
      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
    </TabIcon>
  ),
  [CHAT_PATH]: (
    <TabIcon>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
    </TabIcon>
  ),
  '/timer': (
    <TabIcon>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2.5M9 2h6" />
    </TabIcon>
  ),
  [RECORDS_PATH]: (
    <TabIcon>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </TabIcon>
  ),
  // 통계: 꺾은선 그래프
  [STATS_PATH]: (
    <TabIcon>
      <path d="M3 3v18h18M7 15l4-4 3 3 6-6" />
    </TabIcon>
  ),
}

/**
 * 모바일 화면 아래에 고정되는 탭 메뉴입니다. (홈 · 채팅 · 타이머 · 기록 · 통계)
 * 아이콘 + 작은 글자이고, 지금 있는 탭은 brand 색 + 굵은 글자로 보여 줍니다. (2026-10-18 모바일 UI, 2026-10-22 색)
 * 비치는 효과(blur) 없이 흰 바탕 + 위 1px 선으로 구분합니다.
 * PC(sm 이상)에서는 숨기고, 대신 헤더 메뉴를 보여줍니다.
 */
export function BottomTabNav() {
  const { pathname } = useLocation()

  return (
    <nav
      aria-label="하단 메뉴"
      // pb: 아이폰 아래 홈 막대만큼 띄웁니다. (안전 영역이 없는 화면에서는 0)
      className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      {/* 탭 5개를 같은 너비로 나눕니다. */}
      <ul className="grid grid-cols-5">
        {navItems.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              // 탭을 누르면 맨 위로 올립니다. 지금 보고 있는 탭을 다시 눌러도 올라갑니다.
              onClick={scrollToTop}
              className={({ isActive }) =>
                // 홈 · 기록 아래 화면(카드 · 목표 등)에서도 그 탭이 선택된 모양이 되게 합니다.
                tabLinkClass({ isActive: isActive || isNavItemSelected(item.to, pathname) })
              }
            >
              {TAB_ICONS[item.to]}
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/* 지금 있는 탭이면 brand 색 + 굵게, 아니면 회색(slate-500, 흰 바탕에서 읽히는 대비)입니다. 글자는 12px. 누르는 동안 살짝 작아집니다. */
function tabLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex h-14 flex-col items-center justify-center gap-0.5 text-xs transition active:scale-95',
    isActive ? 'text-brand font-bold' : 'font-medium text-slate-500',
  )
}
