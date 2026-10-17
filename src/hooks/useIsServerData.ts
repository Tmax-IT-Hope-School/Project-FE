import { useAuth } from '@/hooks/useAuth'
import { isServerDataToken } from '@/lib/dataMode'

/**
 * 지금 로그인으로 과목 · 계획 · 공부 기록을 서버에 저장하는지 알려 줍니다. (lib/dataMode.ts)
 * 진짜 로그인이면 true(서버), 테스트 로그인이면 false(이 기기에만 저장)입니다.
 *
 *   const isServerData = useIsServerData()
 */
export function useIsServerData(): boolean {
  const { token } = useAuth()
  return isServerDataToken(token)
}
