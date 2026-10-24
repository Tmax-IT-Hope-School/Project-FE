import { isNavItemSelected, navItems } from '@/components/layout/navItems'
import { NotificationsBell } from '@/components/ui/NotificationsBell'
import { SettingsLink } from '@/components/ui/SettingsLink'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/cn'
import { scrollToTop } from '@/lib/scroll'
import type { ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'

interface HeaderProps {
  /** true 면 메뉴를 숨깁니다. (로그인·가입·온보딩처럼 탭 없이 뜨는 화면에서 씁니다) */
  hideNav?: boolean
  /** 메뉴를 숨겼을 때 오른쪽에 대신 보여줄 것. 예) "나중에 하기" 링크 */
  action?: ReactNode
  /** true 면 모바일에서 헤더를 숨깁니다. (대화방처럼 화면이 자기 머리를 따로 그릴 때) */
  hideOnMobile?: boolean
}

// 아래 탭 5개의 첫 화면. 여기서는 로고를, 그 밖의 하위 화면(설정 · 알림 · 타이머 등)에서는 모바일에 ‹ 뒤로 를 보여 줍니다. (2026-10-22 앱 기준, 2026-10-24 5탭)
const TAB_ROOT_PATHS = ['/', '/cards', '/chat', '/stats', '/records']

/**
 * 화면 안에 자기 돌아가기 링크("← 카드" · "‹ 설정")가 있는 화면입니다. 헤더에 ‹ 뒤로를 또 두지 않고 로고를 보여 줍니다.
 * (그 링크는 보던 날짜 ?date= 까지 챙겨서 돌아갑니다)
 *
 *   hasOwnBackLink('/cards/new')        -> true
 *   hasOwnBackLink('/goals/abc')        -> true
 *   hasOwnBackLink('/settings')         -> false
 */
function hasOwnBackLink(pathname: string): boolean {
  return (
    pathname.startsWith('/cards/') ||
    pathname.startsWith('/goals') ||
    pathname.startsWith('/settings/') ||
    // 사진 채점(/stats/answer-check)은 폰에서 QR 로 바로 열려 "바로 전 화면" 이 없어서, 화면 안의 "‹ 통계" 로 돌아갑니다.
    pathname.startsWith('/stats/') ||
    // 나 사용설명서(/records/manual)는 화면 안의 "‹ 기록" 으로 돌아갑니다.
    pathname.startsWith('/records/')
  )
}

/**
 * ‹ 뒤로를 눌렀을 때 늘 같은 곳으로 가야 하는 화면과 그 위 화면입니다. 없으면 null(바로 전 화면으로).
 * 통화 화면은 전화 울림 화면으로 되돌아가지 않게 채팅 목록으로 갑니다.
 * (카드 목록은 2026-10-24 부터 카드 탭의 첫 화면이라 ‹ 뒤로 가 없습니다)
 *
 *   getFixedParentPath('/call/result')  -> '/chat'
 *   getFixedParentPath('/settings')     -> null
 */
function getFixedParentPath(pathname: string): string | null {
  if (pathname.startsWith('/call')) return '/chat'
  return null
}

/*
 * 헤더 오른쪽에는 셋 중 하나가 보입니다.
 *   hideNav           -> action 만 (온보딩의 "나중에 하기" 등). 없으면 앱 이름만 보입니다.
 *                         로그인·가입·온보딩처럼 탭 없이 뜨는 화면(PlainLayout)이라, 로그인 전이어도 "로그인" 을 띄우지 않습니다.
 *   로그인 전          -> "로그인" 하나만 (처음 온 사람도 로그인 화면에서 시작하면 가입으로 이어지기 때문입니다, #319)
 *   로그인             -> PC 는 탭 5개(홈 · 카드 · 채팅 · 통계 · 기록) 메뉴 + 맨 오른쪽 "설정", 모바일은 오른쪽 위 ⚙️ 톱니(하단 탭은 5개 그대로)
 * 설정은 아래 탭에 넣지 않고 헤더에 따로 둡니다. 로그아웃 · 탈퇴가 설정에 있어서 어느 화면에서든 찾을 수 있게. (2026-10-19)
 * 알림 종도 휴대폰 앱처럼 늘 오른쪽 위(설정 옆)에 둡니다. 전에는 채팅 목록 · 대화방에만 있어서 홈에서 찾을 수 없었습니다. (2026-10-22)
 * 모바일 하위 화면(탭 첫 화면이 아닌 곳)은 로고 자리에 ‹ 뒤로 버튼이 나옵니다. (2026-10-22)
 */

export function Header({ hideNav = false, action, hideOnMobile = false }: HeaderProps) {
  const { isLoggedIn } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  // 로그인해서 탭이 있는 화면인데 탭 첫 화면이 아니고, 자기 돌아가기 링크도 없으면 "하위 화면" 입니다.
  const isSubPage =
    isLoggedIn && !hideNav && !TAB_ROOT_PATHS.includes(pathname) && !hasOwnBackLink(pathname)
  // 대화방은 자기 머리에 종이 있어서(PC 에서도 보임) 헤더의 종은 숨깁니다. 종이 두 개 보이지 않게.
  const isChatRoom = pathname.startsWith('/chat/')

  function handleBack() {
    const fixedParent = getFixedParentPath(pathname)
    if (fixedParent) {
      navigate(fixedParent)
      return
    }
    // 설정 · 알림처럼 어디서든 들어오는 화면은 바로 전 화면으로 갑니다. (React Router 가 기록마다 idx 를 0, 1, 2… 로 붙입니다)
    // 주소를 바로 열어서 돌아갈 기록이 없으면 홈으로 갑니다.
    const historyIndex = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (historyIndex > 0) {
      navigate(-1)
    } else {
      navigate('/', { replace: true })
    }
  }

  return (
    // 바탕과 같은 연회색(비치는 효과 없이). 모바일은 선 없이, PC 는 흰 바탕 + 아래 선으로 구분합니다. (2026-10-22)
    <header
      className={cn(
        'sticky top-0 z-20 bg-slate-100 sm:border-b sm:border-slate-200 sm:bg-white',
        hideOnMobile && 'hidden sm:block',
      )}
    >
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
        {/* 모바일 하위 화면: 왼쪽 위 ‹ 뒤로 (휴대폰 앱의 관례). 44px 정사각형으로 엄지가 닿기 쉽게. */}
        {isSubPage && (
          <button
            type="button"
            onClick={handleBack}
            aria-label="뒤로"
            className="-ml-2 flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl text-slate-800 hover:bg-slate-200 active:scale-95 sm:hidden"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-6 w-6"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
        )}
        {/* whitespace-nowrap: 좁은 화면에서도 앱 이름이 두 줄로 꺾이지 않게 합니다. h-10: 누르는 영역을 40px 로.
            하위 화면에서는 모바일에서 뒤로 버튼에 자리를 내주고 PC 에서만 보입니다. */}
        <NavLink
          to="/"
          className={cn(
            'text-brand -ml-2 flex h-10 items-center rounded-xl px-2 text-base font-bold whitespace-nowrap sm:text-lg',
            isSubPage && 'hidden sm:flex',
          )}
        >
          STARFLOW
        </NavLink>

        {hideNav ? (
          // 메뉴를 숨기는 화면(로그인·가입·온보딩 등)에서는 종 아이콘도 숨기고 action 만 보여줍니다.
          action
        ) : !isLoggedIn ? (
          // 로그인 전에는 로그인만 보여줍니다. 모바일에서도 그대로 보입니다. (하단 탭이 없어서)
          // 회원가입은 따로 두지 않습니다. 로그인 화면에서 시작하면 처음인 사람은 가입으로 이어집니다. (#319)
          <nav aria-label="로그인 메뉴" className="flex items-center gap-1">
            <NavLink to="/login" className={guestLinkClass}>
              로그인
            </NavLink>
          </nav>
        ) : (
          <div className="flex items-center gap-1 sm:gap-2">
            {/* 데스크톱(sm 이상)에서만 보이는 가로 메뉴. 모바일은 하단 탭(BottomTabNav)을 씁니다. (같은 5개) */}
            <nav className="hidden gap-1 sm:flex">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  // 메뉴를 누르면 맨 위로 올립니다. 지금 보고 있는 메뉴를 다시 눌러도 올라갑니다. (하단 탭과 같은 규칙)
                  onClick={scrollToTop}
                  className={({ isActive }) =>
                    // 카드 · 통계 아래 화면(목표 · 타이머 · 사진 채점)에서도 그 탭이 선택된 모양이 되게 합니다.
                    navLinkClass({ isActive: isActive || isNavItemSelected(item.to, pathname) })
                  }
                >
                  {item.label}
                </NavLink>
              ))}
              {/* 설정은 탭 5개 뒤 맨 오른쪽에 따로 둡니다. /settings/account(내 계정)에서도 선택된 모양입니다. */}
              <NavLink to="/settings" onClick={scrollToTop} className={navLinkClass}>
                설정
              </NavLink>
            </nav>
            {/* 알림 종은 모바일 · PC 모두 오른쪽 위에. 모바일은 그 옆 톱니로 설정에 갑니다. (PC 는 위 메뉴의 "설정") */}
            {!isChatRoom && <NotificationsBell />}
            <SettingsLink className="-mr-2 sm:hidden" />
          </div>
        )}
      </div>
    </header>
  )
}

/* NavLink 는 현재 주소와 일치하면 isActive 를 true 로 넘겨줍니다. */
function navLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex h-10 items-center rounded-full px-4 text-[15px] font-semibold transition-colors',
    isActive ? 'bg-brand-light text-brand' : 'text-slate-500 hover:bg-slate-100',
  )
}

/* 로그인 전에 보이는 "로그인" 링크. 손가락으로 누르기 쉽게 높이 40px(h-10) 입니다. */
function guestLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex h-10 items-center rounded-xl px-3 text-sm font-medium whitespace-nowrap transition-colors',
    isActive ? 'bg-brand-light text-brand' : 'text-slate-600 hover:bg-slate-100',
  )
}
