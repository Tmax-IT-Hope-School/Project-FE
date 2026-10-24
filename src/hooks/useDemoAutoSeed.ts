import { useAuth } from '@/hooks/useAuth'
import { useIsServerData } from '@/hooks/useIsServerData'
import { serverCardsQuery } from '@/lib/cardsApi'
import { clearAutoSeededDemo, isDemoSeedUser, seedDemoIfNeeded } from '@/lib/demoAutoSeed'
import { serverGoalsQuery } from '@/lib/goalsApi'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

// 시연 계정의 서버 사용자 번호. 비워 두면 이 기능은 꺼집니다. (.env.example 참고)
const DEMO_SEED_USER_ID = import.meta.env.VITE_DEMO_SEED_USER_ID

/**
 * 정해 둔 시연 계정으로 로그인하면, 이 기기에 "가상 사용자 28일" 을 자동으로 넣습니다. (규칙은 lib/demoAutoSeed.ts)
 * Layout 에서 useCardSync · useGoalSync 다음에 한 번만 부릅니다.
 *
 * 서버의 카드 · 목표를 다 받아서 이 기기에 맞춘 뒤에 넣습니다.
 * 먼저 넣으면 다른 기기에서 올린 카드 · 목표가 나중에 들어와서 두 벌로 겹치기 때문입니다.
 * 넣은 뒤에는 새로고침합니다. (화면들은 저장소를 처음 열 때만 읽습니다)
 *
 * 대상이 아닌 계정으로 로그인했거나 환경변수를 껐으면, 이 기기에 자동으로 넣어 둔 가상 데이터를 지우고 새로고침합니다.
 */
export function useDemoAutoSeed(): void {
  const { user } = useAuth()
  const isServerData = useIsServerData()
  const isSeedUser = isServerData && isDemoSeedUser(DEMO_SEED_USER_ID, user?.id)

  // useCardSync · useGoalSync 와 같은 쿼리라서 서버에 한 번 더 묻지 않고 같은 결과를 나눠 씁니다.
  const { data: serverCards } = useQuery({ ...serverCardsQuery(), enabled: isSeedUser })
  const { data: serverGoals } = useQuery({ ...serverGoalsQuery(), enabled: isSeedUser })

  // 대상이 아니면: 예전에 자동으로 넣어 둔 것이 있으면 지웁니다. (끄면 다음에 열 때 깨끗해집니다)
  useEffect(() => {
    if (!user || isSeedUser) return
    if (clearAutoSeededDemo()) window.location.reload()
  }, [user, isSeedUser])

  useEffect(() => {
    if (!isSeedUser || !serverCards || !serverGoals) return
    if (seedDemoIfNeeded()) window.location.reload()
  }, [isSeedUser, serverCards, serverGoals])
}
