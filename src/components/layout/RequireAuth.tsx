import { ConsentGate } from '@/components/layout/ConsentGate'
import { useAuth } from '@/hooks/useAuth'
import { isPublicPath, type LoginRedirectState } from '@/lib/authRedirect'
import {
  ONBOARDING_RESUME_PATH,
  getOnboardingResumePath,
  hasOnboardingProgress,
  wasResumeAsked,
} from '@/lib/onboardingProgress'
import { hasSignupInfo } from '@/lib/signup'
import { TEST_TOKEN } from '@/lib/testLogin'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

interface RequireAuthProps {
  children: ReactNode
}

/**
 * 로그인해야 볼 수 있는 화면을 감싸는 문지기입니다. (router.tsx 에서 화면을 이걸로 감쌉니다)
 *
 *   로그인 없이 열리는 주소     -> 로그인·회원가입·도움 연결 안내는 그대로 보여줍니다. (lib/authRedirect.ts 의 PUBLIC_PATHS)
 *   로그인 안 했다             -> /login 으로 보냅니다. 가려던 주소도 같이 넘겨서, 로그인하면 거기로 돌아가게 합니다.
 *   로그인했지만 가입을 안 마쳤다 -> /signup 으로 보냅니다. 가입을 건너뛰고 앱에 들어갈 수 없습니다. (테스트 로그인은 예외)
 *   온보딩을 안 끝냈다          -> 끝나지 않은 첫 단계로 보냅니다. (lib/onboardingProgress.ts 의 STAGES 순서)
 *                                 로고·홈을 눌러도 하던 자리로 돌아옵니다. 테스트 로그인도 똑같습니다.
 *                                 하다 만 사람이 다음에 들어오면 "이어하기 / 처음부터 다시" 를 먼저 고르게 합니다.
 *   로그인했고 온보딩도 마쳤다   -> 감싼 화면을 그대로 보여줍니다.
 *   (로그인한 사람의 화면은 모두 ConsentGate 로 감싸서, 저장이 약관 동의 때문에 막히면 다시 동의하는 팝업을 띄웁니다. #512)
 *
 * "막을 주소" 가 아니라 "열어 줄 주소" 를 적어 두는 방식이라, 새 페이지를 만들어도 따로 할 일이 없습니다.
 * (깜빡하고 안 적어도 막히는 쪽이 안전합니다)
 */
export function RequireAuth({ children }: RequireAuthProps) {
  const { isLoggedIn, token } = useAuth()
  const location = useLocation()

  if (isPublicPath(location.pathname)) {
    return <>{children}</>
  }

  if (!isLoggedIn) {
    // 온보딩 주소(/onboarding…)는 기억하지 않습니다. 다시 로그인하면 아래에서 "이어하기" 를 묻거나 이어 할 자리를 다시 정하기 때문입니다.
    // (기억하면 "로그인 화면으로" 를 눌러 나갔다가 다시 로그인했을 때 고르는 화면을 건너뛰게 됩니다)
    if (location.pathname.startsWith('/onboarding')) {
      return <Navigate to="/login" replace />
    }

    // 주소 전체를 넘깁니다. ?date=... 같은 뒷부분(search)과 #... (hash)도 함께 돌아가야 하기 때문입니다.
    const redirectState: LoginRedirectState = {
      from: location.pathname + location.search + location.hash,
    }

    // replace: 막힌 주소를 기록에 남기지 않습니다. 남기면 로그인 화면에서 뒤로가기를 눌렀을 때
    // 막힌 주소로 갔다가 다시 튕겨 나오는 일이 반복됩니다.
    return <Navigate to="/login" replace state={redirectState} />
  }

  // 로그인은 했지만 가입 정보(이름·동의 등)를 아직 안 적은 사람은 가입 화면으로 보냅니다.
  // 구글로 로그인한 사람(이미 가입한 구글 계정)은 서버에 가입을 마친 회원이라, 로그인할 때 "가입 마침" 표시를 해 둡니다. (LoginPage 의 markSignupDone)
  // 테스트 로그인(lib/testLogin.ts)은 앱을 바로 둘러보려는 것이라 가입 화면으로 보내지 않습니다.
  // (테스트 로그인도 "가입 마침" 표시를 하지만, 그 표시가 생기기 전에 로그인해 둔 브라우저도 풀어 주려고 토큰으로 한 번 더 봅니다)
  const isTestLogin = token === TEST_TOKEN
  if (!hasSignupInfo() && !isTestLogin) {
    return <Navigate to="/signup" replace />
  }

  // 온보딩(앱 소개 → 학년 → 심리검사 → 자기 인식 4문항 → 관리 설정 → 결과)을 다 끝내야 앱의 다른 화면을 열어 줍니다.
  // 끝나지 않았으면 끝나지 않은 첫 단계로 보냅니다. 그래서 로고나 홈을 눌러도 하던 자리로 돌아옵니다. (lib/onboardingProgress.ts)
  // 테스트 로그인도 똑같이 거칩니다. 시연에서도 진짜 가입과 같은 흐름을 보여 주기 위해서입니다. (2026-10-17)
  // 온보딩 화면(/onboarding…)은 그 단계들 자체라 막지 않습니다.
  // 설정(/settings…)도 막지 않습니다. 로그아웃·탈퇴는 언제나 할 수 있어야 하기 때문입니다.
  // (도움 연결 안내 /support 는 RequireAuth 로 감싸지 않아서 처음부터 막히지 않습니다)
  const isOnboardingFreePath =
    location.pathname.startsWith('/onboarding') || location.pathname.startsWith('/settings')
  const resumePath = getOnboardingResumePath()
  if (resumePath !== null && !isOnboardingFreePath) {
    // 하다 만 게 있고 이번 접속에서 아직 안 물었으면(= 다음에 다시 들어왔으면) 이어서 할지 먼저 고르게 합니다.
    if (hasOnboardingProgress() && !wasResumeAsked()) {
      return <Navigate to={ONBOARDING_RESUME_PATH} replace />
    }
    return <Navigate to={resumePath} replace />
  }

  return <ConsentGate>{children}</ConsentGate>
}
