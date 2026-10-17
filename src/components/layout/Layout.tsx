import { BackToRecordsLink } from '@/components/layout/BackToRecordsLink'
import { BottomTabNav } from '@/components/layout/BottomTabNav'
import { Header } from '@/components/layout/Header'
import { IosInstallGuide } from '@/components/layout/IosInstallGuide'
import { RecordsSubNav } from '@/components/layout/RecordsSubNav'
import { FocusUnlockScreen } from '@/components/ui/FocusUnlockScreen'
import { useAiMessageNotifications } from '@/hooks/useAiMessageNotifications'
import { useAiMessageSync } from '@/hooks/useAiMessageSync'
import { useAppAlerts } from '@/hooks/useAppAlerts'
import { useAuth } from '@/hooks/useAuth'
import { useCallReminder } from '@/hooks/useCallReminder'
import { useFocusMode, useFocusModeAutoUnlock } from '@/hooks/useFocusMode'
import { useScrollToTopOnPageChange } from '@/hooks/useScrollToTopOnPageChange'
import { cn } from '@/lib/cn'
import { isRecordsCardPath, isRecordsTabPath } from '@/lib/recordsMenu'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

/**
 * 모든 페이지가 공통으로 쓰는 껍데기입니다.
 * <Outlet /> 자리에 현재 주소에 맞는 페이지가 끼워집니다.
 */
export function Layout() {
  // 앱이 열려 있는 동안 안 읽은 AI 메시지를 브라우저 알림으로 띄웁니다. (#62)
  useAiMessageSync()
  useAiMessageNotifications()
  // 앱 안에서 생긴 일(계획 시각이 지남, 목표를 채움 등)을 알림 화면에 쌓습니다. (#255)
  useAppAlerts()
  // 정해 둔 "전화 받을 시간" 이 되면 알림을 띄우고 전화 수신 화면으로 보냅니다. (앱이 열려 있을 때만)
  useCallReminder()
  // 다른 화면으로 옮기면 맨 위부터 보이게 합니다. (같은 화면 안의 탭 · 날짜 바꾸기와 뒤로 가기는 그대로 둡니다)
  useScrollToTopOnPageChange()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  // 로그인 전(로그인 화면)에는 하단 탭을 숨깁니다. 눌러도 어차피 로그인 화면으로 돌아오기 때문입니다.
  // (헤더는 로그인 전이면 스스로 "로그인" 만 보여줍니다. Header.tsx)
  const { isLoggedIn } = useAuth()

  // 집중 모드(#69). 켜진 동안 설정·안전 브레이크를 계속 확인해서, 필요하면 자동으로 풉니다.
  const focusMode = useFocusMode()
  const focusAutoUnlock = useFocusModeAutoUnlock(focusMode.isOn)
  // 집중 모드 중에 타이머가 아닌 주소로 가려고 하면(뒤로 가기·주소 직접 입력 등) 해제 화면을 먼저 보여줍니다.
  const isBlockedByFocusMode = focusMode.isOn && pathname !== '/timer'

  return (
    // pb-14: 모바일에서 하단 탭(높이 h-14)이 마지막 내용을 가리지 않도록 아래 여백을 줍니다. (하단 탭이 있을 때만)
    <div className={cn('flex min-h-screen flex-col', isLoggedIn && 'pb-14 sm:pb-0')}>
      <Header />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        {/* 아이폰에서 아직 홈 화면에 추가 안 한 사람에게만 보이는 안내입니다. (#105) */}
        {/* 홈에서만 보여줍니다. 모든 화면 맨 위에 계속 떠 있으면 방해가 되기 때문입니다. */}
        {pathname === '/' && <IosInstallGuide />}
        {/* 기록 아래 화면에는 맨 위에 하위 탭 막대(기록·리포트·사용설명서)나 "‹ 기록" 돌아가기 링크를 둡니다. (#101) */}
        {isRecordsTabPath(pathname) && <RecordsSubNav />}
        {isRecordsCardPath(pathname) && <BackToRecordsLink />}

        {/* 집중 모드가 자동으로 풀렸을 때(설정을 껐거나 안전 브레이크) 한 번 알려 줍니다. */}
        {focusAutoUnlock.message && (
          <div
            role="status"
            className="mb-6 flex items-center justify-between gap-3 rounded-lg bg-sky-50 px-4 py-2 text-sm break-keep text-sky-800"
          >
            <p>{focusAutoUnlock.message}</p>
            <button
              type="button"
              onClick={focusAutoUnlock.dismiss}
              className="h-10 shrink-0 cursor-pointer rounded-md px-3 font-medium hover:bg-sky-100"
            >
              확인
            </button>
          </div>
        )}

        {isBlockedByFocusMode ? (
          <FocusUnlockScreen onStay={() => navigate('/timer')} onUnlock={focusMode.unlock} />
        ) : (
          <Outlet />
        )}
      </main>

      <footer className="border-t border-slate-200 py-6 text-center text-sm text-slate-500">
        © 2026 Tmax IT Hope School
      </footer>

      {isLoggedIn && <BottomTabNav />}
    </div>
  )
}
