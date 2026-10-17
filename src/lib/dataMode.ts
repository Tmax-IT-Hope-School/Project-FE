import { getAuthToken } from '@/lib/authStorage'
import { TEST_TOKEN } from '@/lib/testLogin'

/**
 * 과목 · 계획 · 공부 기록을 "서버" 에 저장할지, "이 기기(localStorage)" 에 저장할지 정하는 함수입니다. (#201 ~ #203)
 *
 *   진짜 로그인(서버가 준 토큰)   -> 서버에 저장합니다.
 *   테스트 로그인(가짜 토큰)      -> 서버가 모르는 토큰이라 서버 저장이 안 되어서, 지금처럼 이 기기에만 저장합니다.
 *
 *   isServerDataToken('abc')          -> true    (진짜 토큰)
 *   isServerDataToken('fake-token')   -> false   (테스트 로그인)
 *   isServerDataToken(null)           -> false   (로그인 전)
 */
export function isServerDataToken(token: string | null): boolean {
  return token !== null && token !== TEST_TOKEN
}

/** 지금 저장된 로그인 정보로 서버 저장을 쓰는지 확인합니다. (React 밖의 함수에서 씁니다. 화면에서는 hooks/useIsServerData 를 씁니다) */
export function isServerDataMode(): boolean {
  return isServerDataToken(getAuthToken())
}

/**
 * 과목 목록이 있어야 열리는 화면의 주소인지 확인합니다. (components/layout/Layout.tsx 가 이 화면들만 SubjectsGate 로 감쌉니다)
 * 설정 · 계정처럼 과목이 필요 없는 화면은 뺍니다. 서버가 멈춰도 거기서 로그아웃은 할 수 있어야 하기 때문입니다.
 *
 *   needsSubjectsPath('/planner')           -> true
 *   needsSubjectsPath('/')                  -> true   (홈)
 *   needsSubjectsPath('/exams/abc/result')  -> true
 *   needsSubjectsPath('/settings')          -> false
 */
export function needsSubjectsPath(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/planner' ||
    pathname === '/timer' ||
    pathname === '/records' ||
    pathname === '/exams' ||
    /^\/exams\/[^/]+\/result$/.test(pathname)
  )
}
