import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { Skeleton } from '@/components/ui/Skeleton'
import { useIsServerData } from '@/hooks/useIsServerData'
import { subjectsQuery } from '@/lib/subjectsApi'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

interface SubjectsGateProps {
  children: ReactNode
}

/**
 * 과목이 필요한 화면(홈 · 계획 · 타이머 · 기록 · 시험 · 온보딩)을 열기 전에, 서버에서 과목을 미리 받아 두는 문지기입니다. (#201)
 *
 *   진짜 로그인   -> 받는 동안 스켈레톤, 못 받으면 안내 + "다시 시도". 받고 나면 children(화면)을 보여 줍니다.
 *                    화면 안에서는 useSubjects() 가 이미 받아 둔 과목을 바로 줍니다.
 *   테스트 로그인 -> 서버를 부르지 않고 바로 children 을 보여 줍니다. (과목은 이 기기에 저장돼 있습니다)
 *
 * 과목이 필요 없는 화면(설정 · 로그아웃 등)은 감싸지 않습니다. 서버가 멈춰도 설정 화면에서 로그아웃은 할 수 있어야 하기 때문입니다.
 *
 *   <SubjectsGate><Outlet /></SubjectsGate>
 */
export function SubjectsGate({ children }: SubjectsGateProps) {
  const isServerData = useIsServerData()
  if (!isServerData) return <>{children}</>

  return (
    <AsyncBoundary
      pendingFallback={<SubjectsSkeleton />}
      errorMessage="과목을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요."
    >
      <SubjectsLoader>{children}</SubjectsLoader>
    </AsyncBoundary>
  )
}

/** 과목을 받아 오는 일만 합니다. (useSuspenseQuery 는 받는 동안 이 컴포넌트를 멈춰 두고, 바깥 AsyncBoundary 가 스켈레톤을 보여 줍니다) */
function SubjectsLoader({ children }: SubjectsGateProps) {
  useSuspenseQuery(subjectsQuery())
  return <>{children}</>
}

/** 과목을 받는 동안 보여 주는 자리 표시입니다. */
function SubjectsSkeleton() {
  return (
    // role="status": "불러오는 중" 이라는 것을 스크린리더에도 알려 줍니다. (회색 상자는 읽지 않습니다)
    <div role="status" className="flex flex-col gap-4">
      <span className="sr-only">과목을 불러오는 중이에요</span>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  )
}
