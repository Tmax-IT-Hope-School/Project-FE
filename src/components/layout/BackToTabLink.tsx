import { Link } from 'react-router-dom'

interface BackToTabLinkProps {
  /** 돌아갈 탭의 주소. 예: '/stats' */
  to: string
  /** 돌아갈 탭의 이름. 예: '통계' */
  label: string
}

/**
 * 탭 아래에 묶인 화면(시험·일기) 위에 나오는 "‹ 기록" · "‹ 오늘" 돌아가기 링크입니다. (#101, #386)
 * 어느 화면에서 무엇을 보여 줄지는 Layout 이 lib/tabMenu.ts 의 getBackToTabLink 로 정합니다.
 */
export function BackToTabLink({ to, label }: BackToTabLinkProps) {
  return (
    // h-11 = 44px: 손가락으로 누르기 쉬운 높이. brand 색은 1순위 행동에만 써서, 돌아가기는 진한 회색입니다. (2026-10-22)
    <Link
      to={to}
      className="mb-2 inline-flex h-11 items-center gap-1 text-[15px] font-semibold text-slate-700 hover:underline"
    >
      <span aria-hidden>‹</span> {label}
    </Link>
  )
}
