import { Layout } from '@/components/layout/Layout'
import { OldCoachRedirect } from '@/components/layout/OldCoachRedirect'
import { RedirectWithQuery } from '@/components/layout/RedirectWithQuery'
import { RequireAuth } from '@/components/layout/RequireAuth'
import {
  ONBOARDING_CARE_PATH,
  ONBOARDING_INTRO_PATH,
  ONBOARDING_RESULT_PATH,
  ONBOARDING_RESUME_PATH,
} from '@/lib/onboardingProgress'
import { CONSENT_PATH } from '@/lib/consentApi'
import { PSYCH_TEST_PATH } from '@/lib/psychTest'
import { MANUAL_PATH, RECORDS_PATH, STATS_PATH } from '@/lib/tabMenu'
import { PageBoundary } from '@/components/layout/PageBoundary'
import { SubjectsGate } from '@/components/layout/SubjectsGate'
import { ErrorPage } from '@/pages/ErrorPage'
import { lazy } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'

/*
 * 화면 파일은 그 주소에 처음 갈 때 받아옵니다. (Lazy Load)
 * 처음에 앱 전체를 한꺼번에 받지 않아서 첫 화면이 빨리 뜹니다. 받아오는 동안의 스켈레톤과 실패 안내는 PageBoundary 가 맡습니다.
 * 화면들은 export function XxxPage 로 내보내서(named export), lazy 가 바라는 default 모양으로 바꿔 넘깁니다.
 * ErrorPage 는 에러가 났을 때 바로 떠야 해서 lazy 로 받지 않습니다.
 */
const AccountPage = lazy(() =>
  import('@/pages/AccountPage').then((m) => ({ default: m.AccountPage })),
)
const RecordsPage = lazy(() =>
  import('@/pages/RecordsPage').then((m) => ({ default: m.RecordsPage })),
)
const StatsPage = lazy(() => import('@/pages/StatsPage').then((m) => ({ default: m.StatsPage })))
const QuizReportPage = lazy(() =>
  import('@/pages/QuizReportPage').then((m) => ({ default: m.QuizReportPage })),
)
const ManualPage = lazy(() => import('@/pages/ManualPage').then((m) => ({ default: m.ManualPage })))
const CallActivePage = lazy(() =>
  import('@/pages/CallActivePage').then((m) => ({ default: m.CallActivePage })),
)
const CallPage = lazy(() => import('@/pages/CallPage').then((m) => ({ default: m.CallPage })))
const ChatListPage = lazy(() =>
  import('@/pages/ChatListPage').then((m) => ({ default: m.ChatListPage })),
)
const ChatRoomPage = lazy(() =>
  import('@/pages/ChatRoomPage').then((m) => ({ default: m.ChatRoomPage })),
)
const CallHistoryPage = lazy(() =>
  import('@/pages/CallHistoryPage').then((m) => ({ default: m.CallHistoryPage })),
)
const CallResultPage = lazy(() =>
  import('@/pages/CallResultPage').then((m) => ({ default: m.CallResultPage })),
)
const CardEditPage = lazy(() =>
  import('@/pages/CardEditPage').then((m) => ({ default: m.CardEditPage })),
)
const CardsPage = lazy(() => import('@/pages/CardsPage').then((m) => ({ default: m.CardsPage })))
const AnswerCheckPage = lazy(() =>
  import('@/pages/AnswerCheckPage').then((m) => ({ default: m.AnswerCheckPage })),
)
const CardsFromPhotoPage = lazy(() =>
  import('@/pages/CardsFromPhotoPage').then((m) => ({ default: m.CardsFromPhotoPage })),
)
const GoalDetailPage = lazy(() =>
  import('@/pages/GoalDetailPage').then((m) => ({ default: m.GoalDetailPage })),
)
const GoalNewPage = lazy(() =>
  import('@/pages/GoalNewPage').then((m) => ({ default: m.GoalNewPage })),
)
const HomePage = lazy(() => import('@/pages/HomePage').then((m) => ({ default: m.HomePage })))
const LoginPage = lazy(() => import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })))
const NotFoundPage = lazy(() =>
  import('@/pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
)
const NotificationsPage = lazy(() =>
  import('@/pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })),
)
const OnboardingCarePage = lazy(() =>
  import('@/pages/OnboardingCarePage').then((m) => ({ default: m.OnboardingCarePage })),
)
const OnboardingResultPage = lazy(() =>
  import('@/pages/OnboardingResultPage').then((m) => ({ default: m.OnboardingResultPage })),
)
const OnboardingIntroPage = lazy(() =>
  import('@/pages/OnboardingIntroPage').then((m) => ({ default: m.OnboardingIntroPage })),
)
const OnboardingPage = lazy(() =>
  import('@/pages/OnboardingPage').then((m) => ({ default: m.OnboardingPage })),
)
const OnboardingPsychTestPage = lazy(() =>
  import('@/pages/OnboardingPsychTestPage').then((m) => ({ default: m.OnboardingPsychTestPage })),
)
const OnboardingResumePage = lazy(() =>
  import('@/pages/OnboardingResumePage').then((m) => ({ default: m.OnboardingResumePage })),
)
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
const SignupPage = lazy(() => import('@/pages/SignupPage').then((m) => ({ default: m.SignupPage })))
const ConsentPage = lazy(() =>
  import('@/pages/ConsentPage').then((m) => ({ default: m.ConsentPage })),
)
const CardTimerPage = lazy(() =>
  import('@/pages/CardTimerPage').then((m) => ({ default: m.CardTimerPage })),
)

/**
 * 페이지(주소)를 추가하려면 위의 lazy 목록에 한 줄, children 배열에 한 줄 추가하면 됩니다.
 *   const TodoPage = lazy(() => import('@/pages/TodoPage').then((m) => ({ default: m.TodoPage })))
 *   { path: 'todo', element: <TodoPage /> }  ->  http://localhost:5173/todo
 *
 * 로그인 안 한 사람은 RequireAuth 가 /login 으로 보냅니다. 새 페이지는 따로 할 일 없이 자동으로 막힙니다.
 * 로그인 없이 열려야 하는 주소(로그인·회원가입·도움 연결 안내)만 lib/authRedirect.ts 의 PUBLIC_PATHS 에 적어 둡니다.
 */
// errorElement: 그 주소의 화면을 그리다가 에러가 나면 대신 보여줄 화면입니다. (저장된 값이 깨져 있을 때 등)
export const router = createBrowserRouter([
  {
    path: '/',
    errorElement: <ErrorPage />,
    // Layout 안의 모든 주소를 RequireAuth 가 지켜 줍니다.
    // 그날 컨디션(체크인)은 화면을 막지 않고 코치가 채팅에서 칩으로 묻습니다. (2026-10-18, pages/ChatRoomPage.tsx 의 상담 방)
    element: (
      <RequireAuth>
        <Layout />
      </RequireAuth>
    ),
    children: [
      // 첫 화면은 홈입니다. 오늘의 미션 · 오늘 계획 · 시간표 · 급식 · 일정을 한눈에 봅니다. (2026-10-18 홈 · 채팅 · 타이머 · 기록)
      { index: true, element: <HomePage /> },
      // 채팅 탭: 대화방 목록(📞 매일 통화 · 📅 계획 · 💬 상담 · 📚 과목 쌤)과 방 하나. (2026-10-18 저녁, lib/chatRooms.ts · #582)
      { path: 'chat', element: <ChatListPage /> },
      { path: 'chat/:room', element: <ChatRoomPage /> },
      // 예전 코치 탭 주소. 계획 이야기(?plan=)면 계획 방, 그 밖은 상담 방으로 넘깁니다.
      { path: 'coach', element: <OldCoachRedirect /> },
      // 홈의 옛 주소(/today, 2026-10-18 '오늘' 탭). 주소 뒤의 값(?a=b)은 그대로 가져갑니다.
      { path: 'today', element: <RedirectWithQuery to="/" /> },
      // 앱 소개 페이지(/about)는 #417 에서 지웠습니다. (앱 소개는 온보딩 첫 화면이 합니다)
      { path: 'about', element: <Navigate to="/" replace /> },
      // 아래 탭 5개: 홈 · 카드 · 타이머 · 상담 · 분석 (기획서 3장, #386)
      { path: 'cards', element: <CardsPage /> },
      // 카드 만들기 · 고치기 (#392). /cards/new?date=2026-10-17 · /cards/카드id/edit
      { path: 'cards/new', element: <CardEditPage /> },
      // 시험 범위 사진으로 카드 만들기 (2026-10-18). 사진은 저장하지 않고 AI 가 읽고 버립니다.
      { path: 'cards/photo', element: <CardsFromPhotoPage /> },
      { path: 'cards/:cardId/edit', element: <CardEditPage /> },
      // 고정 일정(학교·학원) 입력(#393)은 시연 범위 밖이라 2026-10-18 에 지웠습니다. 옛 링크는 카드 탭으로 보냅니다.
      { path: 'cards/fixed', element: <Navigate to="/cards" replace /> },
      // 목표 만들기 (WOOP, #391). 카드 탭에서 들어옵니다. /goals/new?step=wish
      { path: 'goals/new', element: <GoalNewPage /> },
      // 목표 상세 (진척 · 2주 목표 점검, #403). 카드 탭의 목표 목록에서 들어옵니다.
      { path: 'goals/:goalId', element: <GoalDetailPage /> },
      // 카드 타이머 (최종 기획서 「4.4 타이머」, #395). 옛 계획 타이머(?plan=)는 #417 에서 지웠습니다.
      { path: 'timer', element: <CardTimerPage /> },
      // 상담 탭(/counsel) · 상담 채팅(/counsel/chat)은 2026-10-18 에 AI 코치로 합쳤습니다. 옛 주소는 채팅의 상담 방으로 보냅니다.
      { path: 'counsel', element: <OldCoachRedirect /> },
      { path: 'counsel/chat', element: <OldCoachRedirect /> },
      // 통계 탭 (2026-10-24). 예전 기록 탭의 실행률 · 그래프 · AI 분석 · 사진 채점을 옮겼습니다. (내 숲 · 지난 통화 요약은 같은 날 뺐습니다)
      { path: 'stats', element: <StatsPage /> },
      // 사진 채점 (2026-10-24). PC 통계 탭의 QR 을 폰으로 찍으면 열립니다. 사진은 저장하지 않고 채점 뒤 버립니다.
      { path: 'stats/answer-check', element: <AnswerCheckPage /> },
      // 기록 탭 (일간 · 주간 리포트). 2026-10-24 시안대로 History 화면으로 바뀝니다.
      { path: 'records', element: <RecordsPage /> },
      // 문제 풀이 주간 리포트 (과목별 점수 그래프 · 주간 정리표, 2026-10-24). 기록 탭의 입구에서 들어옵니다.
      { path: 'records/quiz', element: <QuizReportPage /> },
      // 나 사용설명서 (2026-10-24 History 시안 ⑤). 기록 탭 아래쪽 줄과 주간 리포트의 [사용설명서에 넣기] 뒤에서 들어옵니다.
      { path: 'records/manual', element: <ManualPage /> },
      // 사진 채점의 옛 주소(통계 탭으로 옮기기 전). 이미 띄워 둔 QR 로 열어도 같은 화면이 나오게 넘겨 줍니다.
      { path: 'records/answer-check', element: <RedirectWithQuery to="/stats/answer-check" /> },
      // v2 체크인(/check)은 #417 에서 지웠습니다. 옛 링크 · 즐겨찾기로 오면 홈으로 보냅니다. (그날 컨디션은 코치가 채팅에서 묻습니다)
      { path: 'check', element: <Navigate to="/" replace /> },
      // 일기 · 성찰일기는 최종 기획서 MVP 밖이라 #417 에서 지웠습니다. 옛 링크는 홈으로 보냅니다.
      { path: 'diary', element: <Navigate to="/" replace /> },
      { path: 'diary/reflection', element: <Navigate to="/" replace /> },
      // 시험 기록(/exams · 시험 결과)은 시연 범위 밖이라 2026-10-18 에 지웠습니다. 시험 날짜는 학교 학사일정(NEIS)이 알려 줍니다.
      // 옛 링크는 기록 탭으로 보냅니다.
      { path: 'exams', element: <Navigate to={RECORDS_PATH} replace /> },
      { path: 'exams/:examId/result', element: <Navigate to={RECORDS_PATH} replace /> },
      // 휴대폰 집중 모드 안내(/phone-focus)는 #417 에서 지웠습니다. (OS 앱 잠금은 다음 버전)
      { path: 'phone-focus', element: <Navigate to="/settings" replace /> },
      { path: 'call/result', element: <CallResultPage /> },
      // 지난 통화 목록 (STARFLOW D19). 채팅 탭 · 통화 정리 화면에서 들어옵니다.
      { path: 'call/history', element: <CallHistoryPage /> },
      // 만약-그러면 처방 카드(/suggestions)는 #417 에서 지웠습니다. 옛 링크는 기록 탭으로 보냅니다. (가설·실험 탭도 2026-10-18 에 지움)
      { path: 'suggestions', element: <Navigate to={RECORDS_PATH} replace /> },
      { path: 'settings', element: <SettingsPage /> },
      // 내 계정(내 정보 고치기 · 비밀번호 바꾸기 · 탈퇴). 설정의 계정 카드에서 들어옵니다. (#296)
      { path: 'settings/account', element: <AccountPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      // 예전 주소(/messages)로 들어오면 새 주소로 넘겨 줍니다. 저장해 둔 주소나 예전 알림을 눌러도 열리게 하려는 것입니다.
      { path: 'messages', element: <Navigate to="/notifications" replace /> },
      // 도움 연결 안내 화면(/support)은 시연 범위 밖이라 2026-10-18 에 지웠습니다. 옛 링크는 홈으로 보냅니다.
      // (AI 채팅에서 위기 표현이 나오면 채팅 안에서 상담 전화 한 줄만 알려 줍니다)
      { path: 'support', element: <Navigate to="/" replace /> },
      // 탭 이름을 바꾸기 전의 옛 주소들. ?date= 같은 값은 그대로 가져갑니다. (#386)
      { path: 'planner', element: <RedirectWithQuery to="/cards" /> },
      // 탭 이름을 '분석' 에서 '기록' 으로 바꾸기 전 주소(2026-10-18). 분석 내용은 지금 통계 탭에 있습니다.
      { path: 'analysis', element: <RedirectWithQuery to={STATS_PATH} /> },
      // 리포트(/report · /records?tab=report)는 2026-10-23 에 뺐습니다. 옛 링크로 오면 기록 화면이 보입니다.
      { path: 'report', element: <RedirectWithQuery to={RECORDS_PATH} /> },
      { path: 'manual', element: <RedirectWithQuery to={MANUAL_PATH} /> },
      // 없는 주소는 404 화면으로. 이 줄은 항상 맨 마지막에 둡니다.
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  // Layout 밖의 화면은 하나씩 RequireAuth 로 감쌉니다.
  // 화면 파일을 받는 동안의 스켈레톤·실패 안내도 Layout 이 없으니 하나씩 PageBoundary(fullScreen) 로 감쌉니다.
  // 전화 화면은 헤더·하단 탭 없이 화면 전체를 쓰므로 Layout 밖에 둡니다.
  {
    path: '/call',
    errorElement: <ErrorPage />,
    element: (
      <RequireAuth>
        <PageBoundary fullScreen>
          <CallPage />
        </PageBoundary>
      </RequireAuth>
    ),
  },
  {
    path: '/call/active',
    errorElement: <ErrorPage />,
    element: (
      <RequireAuth>
        <PageBoundary fullScreen>
          <CallActivePage />
        </PageBoundary>
      </RequireAuth>
    ),
  },
  // 온보딩과 가입은 메뉴·하단 탭 없이 앱 이름만 있는 틀(PlainLayout)을 쓰므로 Layout 밖에 둡니다.
  // 온보딩 순서(앱 소개 → 학년 → 심리검사 → 자기 인식 4문항 → 관리 설정 → 결과)는 lib/onboardingProgress.ts 의 STAGES 가 정합니다. (#388 · #389)
  {
    path: ONBOARDING_INTRO_PATH,
    errorElement: <ErrorPage />,
    element: (
      <RequireAuth>
        <PageBoundary fullScreen>
          <OnboardingIntroPage />
        </PageBoundary>
      </RequireAuth>
    ),
  },
  // 학년 (OnboardingPage 의 basic 묶음)
  {
    path: '/onboarding',
    errorElement: <ErrorPage />,
    element: (
      <RequireAuth>
        <PageBoundary fullScreen>
          <SubjectsGate>
            <OnboardingPage />
          </SubjectsGate>
        </PageBoundary>
      </RequireAuth>
    ),
  },
  // 자기 인식 4문항(내 가설)은 2026-10-18 에 지웠습니다. 옛 주소로 오면 RequireAuth 가 남은 온보딩 단계로 보냅니다.
  { path: '/onboarding/hypotheses', element: <Navigate to="/" replace /> },
  // 관리 설정 동의 → 결과 (#389). 심리검사 다음에 나옵니다.
  {
    path: ONBOARDING_CARE_PATH,
    errorElement: <ErrorPage />,
    element: (
      <RequireAuth>
        <PageBoundary fullScreen>
          <OnboardingCarePage />
        </PageBoundary>
      </RequireAuth>
    ),
  },
  {
    path: ONBOARDING_RESULT_PATH,
    errorElement: <ErrorPage />,
    element: (
      <RequireAuth>
        <PageBoundary fullScreen>
          <OnboardingResultPage />
        </PageBoundary>
      </RequireAuth>
    ),
  },
  // 온보딩을 하다 만 사람이 다음에 들어왔을 때 "이어하기 / 처음부터 다시" 를 고르는 화면. RequireAuth 가 보냅니다.
  {
    path: ONBOARDING_RESUME_PATH,
    errorElement: <ErrorPage />,
    element: (
      <RequireAuth>
        <PageBoundary fullScreen>
          <OnboardingResumePage />
        </PageBoundary>
      </RequireAuth>
    ),
  },
  // 설정의 "내 정보 더 알려주기"(/onboarding/more)와 생각 습관 테스트(/onboarding/thinking)는 #417 에서 지웠습니다. 옛 링크는 설정 · 홈으로 보냅니다.
  { path: '/onboarding/more', element: <Navigate to="/settings" replace /> },
  { path: '/onboarding/thinking', element: <Navigate to="/" replace /> },
  // 온보딩 심리검사. 학년 다음, 자기 인식 4문항 앞에 나옵니다. (lib/psychTest.ts)
  {
    path: PSYCH_TEST_PATH,
    errorElement: <ErrorPage />,
    element: (
      <RequireAuth>
        <PageBoundary fullScreen>
          <OnboardingPsychTestPage />
        </PageBoundary>
      </RequireAuth>
    ),
  },
  // 처음 계획(/onboarding/plan) · 옛 온보딩 끝 화면(/onboarding/done)은 #417 에서 지웠습니다. 옛 링크는 설정 · 홈으로 보냅니다.
  { path: '/onboarding/plan', element: <Navigate to="/settings" replace /> },
  { path: '/onboarding/done', element: <Navigate to="/" replace /> },
  // 처음의 다짐 녹음(/onboarding/voice)은 시연 범위 밖이라 2026-10-18 에 지웠습니다. 옛 링크는 홈으로 보냅니다.
  { path: '/onboarding/voice', element: <Navigate to="/" replace /> },
  // 로그인 화면도 메뉴·하단 탭 없이 앱 이름만 있는 틀(PlainLayout)을 써서 Layout 밖에 둡니다.
  // 로그인 없이 열려야 해서 RequireAuth 로 감싸지 않습니다. (PUBLIC_PATHS 에도 있습니다)
  {
    path: '/login',
    errorElement: <ErrorPage />,
    element: (
      <PageBoundary fullScreen>
        <LoginPage />
      </PageBoundary>
    ),
  },
  // 가입 화면은 로그인 없이 열려야 해서 RequireAuth 로 감싸지 않습니다. (PUBLIC_PATHS 에도 있습니다)
  {
    path: '/signup',
    errorElement: <ErrorPage />,
    element: (
      <PageBoundary fullScreen>
        <SignupPage />
      </PageBoundary>
    ),
  },
  // 다시 동의 화면 (#512). 저장이 403 CONSENT_REQUIRED 로 막히면 여기로 옵니다. 가입 화면처럼 메뉴 없이 뜹니다.
  {
    path: CONSENT_PATH,
    errorElement: <ErrorPage />,
    element: (
      <RequireAuth>
        <PageBoundary fullScreen>
          <ConsentPage />
        </PageBoundary>
      </RequireAuth>
    ),
  },
])
