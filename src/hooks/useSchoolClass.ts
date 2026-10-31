import { makeKey } from '@/lib/storage'
import {
  CLASS_STORAGE_KEY,
  SCHOOL_CLASS_CHANGED_EVENT,
  loadSchoolClass,
  type SchoolClass,
} from '@/lib/schoolToday'
import { useEffect, useState } from 'react'

/**
 * 이 기기에 저장된 학년 · 반입니다. 바뀌면 다시 읽어서 화면이 바로 따라갑니다. (2026-10-31)
 * 로그인 직후 서버에서 반을 받아 오면(hooks/useSchoolClassSync.ts) 홈 시간표가 새로고침 없이 나옵니다.
 * 예전에는 화면이 처음 열릴 때 한 번만 읽어서, 설정을 다녀와야 시간표가 보였습니다.
 *
 *   const schoolClass = useSchoolClass()   // { grade: 2, classNo: 1 } 또는 null
 */
export function useSchoolClass(): SchoolClass | null {
  const [schoolClass, setSchoolClass] = useState(loadSchoolClass)

  useEffect(() => {
    function handleChanged() {
      setSchoolClass(loadSchoolClass())
    }
    // 다른 탭에서 바꾼 것은 'storage' 이벤트로 옵니다. (실제 키 'study-school-class' 로 옴)
    function handleStorage(event: StorageEvent) {
      if (event.key === makeKey(CLASS_STORAGE_KEY)) handleChanged()
    }
    window.addEventListener(SCHOOL_CLASS_CHANGED_EVENT, handleChanged)
    window.addEventListener('storage', handleStorage)
    // 화면을 떠날 때 듣기를 멈춥니다.
    return () => {
      window.removeEventListener(SCHOOL_CLASS_CHANGED_EVENT, handleChanged)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  return schoolClass
}
