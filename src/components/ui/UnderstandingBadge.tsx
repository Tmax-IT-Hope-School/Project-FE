import { UNDERSTANDING_COLORS, type Understanding } from '@/lib/checkCall'
import { cn } from '@/lib/cn'

interface UnderstandingBadgeProps {
  understanding: Understanding
  className?: string
}

/**
 * 확인 통화에서 코치가 말한 이해도 배지. (2026-10-18, lib/checkCall.ts 의 splitUnderstanding)
 * 통화 결과 화면에서 씁니다. 색만으로 구분하지 않게 글자를 같이 씁니다.
 *
 *   <UnderstandingBadge understanding="조금 헷갈림" />
 */
export function UnderstandingBadge({ understanding, className }: UnderstandingBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
        UNDERSTANDING_COLORS[understanding],
        className,
      )}
    >
      이해도 · {understanding}
    </span>
  )
}
