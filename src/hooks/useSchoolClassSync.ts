import { useAuth } from '@/hooks/useAuth'
import { isServerDataToken } from '@/lib/dataMode'
import { pushSchoolClass, syncSchoolClass } from '@/lib/schoolClassSync'
import { SCHOOL_CLASS_CHANGED_EVENT, isSchoolClassUnsent } from '@/lib/schoolToday'
import { useEffect } from 'react'

/**
 * 진짜 로그인이면 학년 · 반을 서버와 맞춥니다. (lib/schoolClassSync.ts, 2026-10-31)
 * - 앱을 열 때 한 번: 이 기기에 반이 없으면 서버의 반을 받아 옵니다. 그러면 홈 시간표가 바로 나옵니다.
 * - 설정 · 온보딩에서 반을 바꾸면 바로 서버로 보냅니다.
 * Layout 에서 한 번만 부릅니다. 테스트 로그인은 서버를 쓰지 않아서 아무것도 하지 않습니다.
 */
export function useSchoolClassSync(): void {
  const { token } = useAuth()
  const canSync = isServerDataToken(token)

  useEffect(() => {
    if (!canSync) return
    void syncSchoolClass()

    // 이 기기에서 바꾼 반만 보냅니다. (서버에서 받아 저장한 것은 "못 보냄" 표시가 없어서 다시 보내지 않음)
    function handleSchoolClassChanged() {
      if (isSchoolClassUnsent()) void pushSchoolClass()
    }
    window.addEventListener(SCHOOL_CLASS_CHANGED_EVENT, handleSchoolClassChanged)
    // 로그아웃하거나 화면을 떠날 때 듣기를 멈춥니다.
    return () => window.removeEventListener(SCHOOL_CLASS_CHANGED_EVENT, handleSchoolClassChanged)
  }, [canSync])
}
