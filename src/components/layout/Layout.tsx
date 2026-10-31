import { BackToTabLink } from '@/components/layout/BackToTabLink'
import { BottomTabNav } from '@/components/layout/BottomTabNav'
import { Header } from '@/components/layout/Header'
import { PageBoundary } from '@/components/layout/PageBoundary'
import { SubjectsGate } from '@/components/layout/SubjectsGate'
import { FocusUnlockScreen } from '@/components/ui/FocusUnlockScreen'
import { useAiMessageNotifications } from '@/hooks/useAiMessageNotifications'
import { useAiMessageSync } from '@/hooks/useAiMessageSync'
import { useAppAlerts } from '@/hooks/useAppAlerts'
import { useAuth } from '@/hooks/useAuth'
import { useCallReminder } from '@/hooks/useCallReminder'
import { useCardAlerts } from '@/hooks/useCardAlerts'
import { useCardSync } from '@/hooks/useCardSync'
import { useDemoAutoSeed } from '@/hooks/useDemoAutoSeed'
import { useUnsentCheckInRetry } from '@/hooks/useCheckInSync'
import { useFocusMode, useFocusModeAutoUnlock } from '@/hooks/useFocusMode'
import { useGoalCardEnds } from '@/hooks/useGoalCardEnds'
import { useGoalSync } from '@/hooks/useGoalSync'
import { useMarkSync } from '@/hooks/useMarkSync'
import { useOnboardingCompletionSync } from '@/hooks/useOnboardingCompletionSync'
import { usePsychTestSync } from '@/hooks/usePsychTestSync'
import { useQuizResultSync } from '@/hooks/useQuizResultSync'
import { useSchoolClassSync } from '@/hooks/useSchoolClassSync'
import { useScrollToTopOnPageChange } from '@/hooks/useScrollToTopOnPageChange'
import { useServerHistoryPull } from '@/hooks/useServerHistoryPull'
import { useSessionSync } from '@/hooks/useSessionSync'
import { useTimerLock } from '@/hooks/useTimerLock'
import { cn } from '@/lib/cn'
import { needsSubjectsPath } from '@/lib/dataMode'
import { CHAT_PATH, getBackToTabLink, MANUAL_PATH } from '@/lib/tabMenu'
import { TIMER_PATH } from '@/lib/timerLock'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'

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
  // 카드 시작 알림 (카드에 쓴 문장 · 3분 뒤 '지금 시작해요' · 10분 전). 누르면 그 카드로 바로 시작합니다. (#399)
  useCardAlerts()
  // 진짜 로그인이면 이 기기의 카드를 서버와 맞춥니다. (못 보낸 것은 다시 보내고, 다른 기기에서 바뀐 것은 받아 옵니다, #516)
  useCardSync()
  // 진짜 로그인이면 목표도 서버와 맞춥니다. (카드의 목표 번호가 서버에서도 맞게, #516)
  useGoalSync()
  // 목표를 그만두거나 D-day 가 지나면 그 목표의 루틴 카드를 그날까지만 하게 합니다. (#734)
  useGoalCardEnds()
  // 시연 계정(VITE_DEMO_SEED_USER_ID)으로 로그인하면 이 기기에 가상 28일을 넣습니다. 카드 · 목표를 받아 맞춘 뒤라서 이 자리입니다.
  useDemoAutoSeed()
  // 진짜 로그인이면 서버의 공부 기록 · 미루기/실패 · 휴식 · 체크인 중 이 기기에 없는 것을 받아 옵니다. 카드를 받아 맞춘 뒤라서 이 자리입니다.
  useServerHistoryPull()
  // 진짜 로그인이면 끝난 공부 기록을 서버로 보냅니다. (끝나고 10분 뒤. 받아 오는 것은 바로 위 useServerHistoryPull, #516)
  useSessionSync()
  // 진짜 로그인이면 미루기 · 실패 · 휴식 · 사후 입력도 서버로 보냅니다. (한도 · 기한은 서버가 다시 봅니다, #516)
  useMarkSync()
  // 진짜 로그인이면 채팅 확인 문제의 결과(맞은 수 · 단원)도 서버로 보냅니다. (그날 푼 것만, #653)
  useQuizResultSync()
  // 예전에 서버로 못 보낸 체크인 · 심리검사 결과 · 온보딩 마침 표시를 앱을 열 때 다시 보냅니다.
  // (예전에는 화면 맨 위의 "오늘 컨디션" 한 줄이 맡았는데, 2026-10-18 에 그 한 줄을 없애서 여기로 옮겼습니다)
  useUnsentCheckInRetry()
  usePsychTestSync()
  useOnboardingCompletionSync()
  // 진짜 로그인이면 학년 · 반을 서버와 맞춥니다. 새 기기에서 로그인해도 홈 시간표가 바로 나옵니다. (2026-10-31)
  useSchoolClassSync()
  // 다른 화면으로 옮기면 맨 위부터 보이게 합니다. (같은 화면 안의 탭 · 날짜 바꾸기와 뒤로 가기는 그대로 둡니다)
  useScrollToTopOnPageChange()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  // 로그인 전에는 하단 탭을 숨깁니다. 눌러도 어차피 로그인 화면으로 돌아오기 때문입니다.
  // (로그인 화면은 Layout 밖의 PlainLayout 을 씁니다. 헤더는 로그인 전이면 스스로 "로그인" 만 보여줍니다. Header.tsx)
  const { isLoggedIn } = useAuth()

  // 집중 모드(#69). 켜진 동안 설정·안전 브레이크를 계속 확인해서, 필요하면 자동으로 풉니다.
  const focusMode = useFocusMode()
  const focusAutoUnlock = useFocusModeAutoUnlock(focusMode.isOn)
  // 집중 모드 중에 타이머가 아닌 주소로 가려고 하면(뒤로 가기·주소 직접 입력 등) 해제 화면을 먼저 보여줍니다.
  const isBlockedByFocusMode = focusMode.isOn && pathname !== '/timer'
  // 탭 아래에 묶인 화면(시험·일기 등)이면 맨 위에 "‹ 기록" 같은 돌아가기 링크를 둡니다. 아니면 null (lib/tabMenu.ts)
  const backToTab = getBackToTabLink(pathname)
  // 과목이 필요한 화면인지. 그렇다면 열기 전에 서버에서 과목을 받아 둡니다. (진짜 로그인일 때만)
  const needsSubjects = needsSubjectsPath(pathname)
  // 타이머 잠금(#396): 공부 세션 중이면 탭을 숨기고, 다른 주소로 가도 타이머로 돌려보냅니다.
  // (뒤로 가기 · 주소 직접 입력 · 알림 눌러 들어오기 모두 여기서 막힙니다)
  const isTimerLocked = useTimerLock()
  const isOutsideTimer = isTimerLocked && pathname !== TIMER_PATH
  // 대화방(/chat/plan 등) 화면은 화면 높이를 꽉 채우고, 말풍선 목록만 스크롤되게 합니다. (입력창이 늘 아래에 보이게)
  // h-dvh: 모바일 주소창 · 키보드에 맞춰 바뀌는 "지금 보이는 높이" 입니다. 그 밖의 화면은 내용만큼 길어집니다(min-h-screen).
  // 대화방 목록(/chat)은 보통 화면처럼 내용만큼 길어집니다.
  const isCoach = pathname.startsWith(`${CHAT_PATH}/`)

  return (
    // 모바일에서 하단 탭이 마지막 내용을 가리지 않도록 아래 여백을 줍니다. (하단 탭이 있을 때만)
    <div
      className={cn(
        'flex flex-col',
        isCoach ? 'h-dvh' : 'min-h-screen',
        // 하단 탭(높이 h-14 + 아이폰 홈 막대 안전 영역)이 마지막 내용을 가리지 않게 아래를 비웁니다.
        // 대화방은 모바일에서 하단 탭을 숨기므로(아래) 이 여백도 두지 않습니다.
        isLoggedIn &&
          !isTimerLocked &&
          !isCoach &&
          'pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:pb-0',
      )}
    >
      {/* 대화방은 모바일에서 자기 머리(‹ · 방 이름 · 통화 · 종)만 보여 주고 이 헤더는 숨깁니다. 메신저 앱처럼 화면 전체를 대화에. (2026-10-22) */}
      {/* 나 사용설명서도 모바일에서는 자기 머리(‹ 나 사용설명서)를 맨 위에 그려서 이 헤더를 숨깁니다. (시안 ⑤, pages/ManualPage.tsx) */}
      <Header hideNav={isTimerLocked} hideOnMobile={isCoach || pathname === MANUAL_PATH} />

      <main
        className={cn(
          'mx-auto w-full max-w-5xl flex-1 px-4 sm:px-6',
          // min-h-0: 안의 채팅 목록이 넘칠 때 화면이 늘어나지 않고 목록 안에서 스크롤되게 합니다.
          // 모바일 위 여백은 12px(pt-3)입니다. 24px 는 헤더 아래가 비어 보여서 줄였습니다. (2026-10-19)
          isCoach ? 'flex min-h-0 flex-col py-3 sm:py-4' : 'pt-3 pb-6 sm:py-10',
        )}
      >
        {/* 아이폰 "홈 화면에 추가" 안내(components/layout/IosInstallGuide.tsx, #105)는 2026-10-19 에 껐습니다.
            시연을 모바일 웹 · 앱(WebView)으로 하기로 해서입니다. 다시 켜려면 홈('/')일 때 <IosInstallGuide /> 를 여기에 그립니다. */}
        {backToTab && <BackToTabLink to={backToTab.to} label={backToTab.label} />}

        {/* 집중 모드가 자동으로 풀렸을 때(설정을 껐거나 안전 브레이크) 한 번 알려 줍니다. */}
        {focusAutoUnlock.message && (
          <div
            role="status"
            className="mb-6 flex items-center justify-between gap-3 rounded-xl bg-sky-50 px-4 py-2 text-sm break-keep text-sky-800"
          >
            <p>{focusAutoUnlock.message}</p>
            <button
              type="button"
              onClick={focusAutoUnlock.dismiss}
              className="h-10 shrink-0 cursor-pointer rounded-xl px-3 font-medium hover:bg-sky-100"
            >
              확인
            </button>
          </div>
        )}

        {isOutsideTimer ? (
          <Navigate to={TIMER_PATH} replace />
        ) : isBlockedByFocusMode ? (
          <FocusUnlockScreen onStay={() => navigate('/timer')} onUnlock={focusMode.unlock} />
        ) : (
          // 화면 파일을 받는 동안에는 이 본문 칸에만 스켈레톤을 보여줍니다. 헤더 · 하단 탭은 그대로입니다. (PageBoundary)
          <PageBoundary>
            {/* 과목이 필요한 화면은 열기 전에 서버에서 과목을 받아 둡니다. (진짜 로그인일 때만. components/layout/SubjectsGate.tsx) */}
            {needsSubjects ? (
              <SubjectsGate>
                <Outlet />
              </SubjectsGate>
            ) : (
              <Outlet />
            )}
          </PageBoundary>
        )}
      </main>

      {/* 코치 화면은 높이를 꽉 채우는 채팅이라 아래 글을 숨깁니다.
          모바일(앱)에서는 웹 사이트의 꼬리말이 어색해서 PC 에서만 보여 줍니다. (2026-10-22) */}
      {!isCoach && (
        <footer className="hidden border-t border-slate-200 py-6 text-center text-sm text-slate-500 sm:block">
          © 2026 Tmax IT Hope School
        </footer>
      )}

      {/* 세션 중에는 하단 탭을 숨깁니다. 나가는 길은 세션 화면의 [일시정지] · [끝내기] 뿐입니다.
          대화방에서도 숨깁니다(입력창이 화면 맨 아래 엄지 자리에 오게). 방 머리의 ‹ 로 목록에 돌아갑니다. (2026-10-22) */}
      {isLoggedIn && !isTimerLocked && !isCoach && <BottomTabNav />}
    </div>
  )
}
