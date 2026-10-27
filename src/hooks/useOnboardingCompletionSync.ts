import { useAuth } from '@/hooks/useAuth'
import { isServerDataToken } from '@/lib/dataMode'
import { isDemoSetKey } from '@/lib/demoIds'
import { sendOnboardingCompletion } from '@/lib/onboardingCompletionApi'
import { hasFinishedAllStages, isOnboardingDoneOnServer } from '@/lib/onboardingProgress'
import { useEffect } from 'react'

/**
 * 이 기기에서 온보딩을 다 끝냈는데 서버에는 아직 안 알렸으면, 앱을 열 때 한 번 알립니다. (lib/onboardingCompletionApi.ts)
 * 온보딩 결과 화면을 본 뒤 처음 열리는 홈에서 보내지고, 이 기능이 생기기 전에 온보딩을 끝낸 사람도 여기서 보냅니다.
 * Layout 에서 한 번만 부릅니다. 실패하면 다음에 앱을 열 때 또 보냅니다.
 */
export function useOnboardingCompletionSync(): void {
  const { token } = useAuth()
  const canSync = isServerDataToken(token)

  useEffect(() => {
    if (!canSync || isOnboardingDoneOnServer() || !hasFinishedAllStages()) return
    // 시연용 가상 데이터가 채운 온보딩이면 서버에 "마쳤다" 고 알리지 않습니다. (lib/demoIds.ts)
    if (isDemoSetKey('onboarding-answers')) return
    void sendOnboardingCompletion().catch(() => {
      // 서버에 닿지 못했거나 로그인이 풀렸으면, 다음에 앱을 열 때 다시 보냅니다. 이 기기의 온보딩 기록은 그대로입니다.
    })
  }, [canSync])
}
