import { cn } from '@/lib/cn'
import type { SubjectColor } from '@/types'

interface SubjectBadgeProps {
  /** 태그에 보여줄 과목 이름 (예: '수학') */
  name: string
  /** 태그 색. Subject 의 color 를 그대로 넘기면 됩니다. */
  color: SubjectColor
  className?: string
}

// Tailwind 는 `bg-${color}-100` 처럼 이름을 조합하면 어떤 클래스를 쓰는지 몰라서 스타일이 사라집니다.
// 그래서 완성된 클래스 이름을 그대로 적어 둡니다.
// 배경 100 + 글자 800 : 글자와 배경의 밝기 차이(대비)가 12가지 색 모두 4.5 이상이라 작은 글자도 잘 읽힙니다.
const colorStyles: Record<SubjectColor, string> = {
  red: 'bg-red-100 text-red-800',
  orange: 'bg-orange-100 text-orange-800',
  green: 'bg-green-100 text-green-800',
  blue: 'bg-blue-100 text-blue-800',
  purple: 'bg-purple-100 text-purple-800',
}

/**
 * 과목 이름을 색깔 있는 작은 태그로 보여줍니다.
 *
 * <SubjectBadge name="수학" color="blue" />
 * <SubjectBadge name={subject.name} color={subject.color} />
 */
export function SubjectBadge({ name, color, className }: SubjectBadgeProps) {
  return (
    // inline-block + max-w-full + truncate: 이름이 길면 한 줄로 줄이고 끝을 '...' 으로 보여줍니다.
    <span
      className={cn(
        'inline-block max-w-full truncate rounded px-2 py-0.5 text-xs font-semibold',
        colorStyles[color],
        className,
      )}
    >
      {name}
    </span>
  )
}
