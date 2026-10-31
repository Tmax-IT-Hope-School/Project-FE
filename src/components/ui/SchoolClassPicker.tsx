import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { Skeleton } from '@/components/ui/Skeleton'
import { useIsServerData } from '@/hooks/useIsServerData'
import { cn } from '@/lib/cn'
import {
  classNosOf,
  getDefaultGrade,
  schoolClassOptionsQuery,
  type SchoolClass,
} from '@/lib/schoolToday'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'

interface SchoolClassPickerProps {
  /** 처음에 골라 둘 학년 · 반. 없으면 온보딩에서 고른 학년 · 1반 */
  initial: SchoolClass | null
  /** [저장] 을 누르면 고른 학년 · 반을 알려 줍니다. 저장(saveSchoolClass)은 쓰는 쪽에서 합니다. */
  onSave: (next: SchoolClass) => void
  /** 칸 위의 안내 한 줄 */
  description: string
  /** 버튼 글자. 예) '시간표 보기' · '저장' */
  saveLabel: string
  className?: string
}

/**
 * 학년 · 반을 고르는 작은 칸입니다. 고른 반은 이 기기와 서버에 저장합니다. (lib/schoolToday.ts · lib/schoolClassSync.ts)
 * 설정의 계정 묶음이 씁니다. 홈 시간표와 같은 저장소(study-school-class)를 씁니다.
 * 반 칸에는 우리 학교 그 학년에 실제로 있는 반만 나옵니다. (NEIS 학급정보, 2026-10-23) 목록을 받는 동안은 회색 칸입니다.
 *
 *   <SchoolClassPicker initial={schoolClass} onSave={handleSave} description="몇 학년 몇 반이야?" saveLabel="저장" />
 */
export function SchoolClassPicker({
  initial,
  onSave,
  description,
  saveLabel,
  className,
}: SchoolClassPickerProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <p className="text-[13px] break-keep text-slate-500">{description}</p>
      <AsyncBoundary pendingFallback={<Skeleton className="h-11 w-full rounded-xl" />}>
        <ClassFields initial={initial} onSave={onSave} saveLabel={saveLabel} />
      </AsyncBoundary>
    </div>
  )
}

interface ClassFieldsProps {
  initial: SchoolClass | null
  onSave: (next: SchoolClass) => void
  saveLabel: string
}

/** 학년 · 반 · 저장 한 줄. 학교의 반 목록을 받은 뒤에 그립니다. (AsyncBoundary 안) */
function ClassFields({ initial, onSave, saveLabel }: ClassFieldsProps) {
  const isServerData = useIsServerData()
  // 못 받으면 1 ~ 30반이 와서 에러가 나지 않습니다. (lib/schoolToday.ts)
  const { data: classNosByGrade } = useSuspenseQuery(schoolClassOptionsQuery(isServerData))
  const [grade, setGrade] = useState(initial?.grade ?? getDefaultGrade())
  const [classNo, setClassNo] = useState(initial?.classNo ?? 1)

  const classNos = classNosOf(classNosByGrade, grade)
  // 고른 반이 이 학년 목록에 없으면(예전에 고른 30반 · 학년을 바꿈) 첫 반을 골라 둔 것으로 보여 줍니다.
  const isMissing = !classNos.includes(classNo)
  const shownClassNo = isMissing ? (classNos[0] ?? 1) : classNo
  // 저장해 둔 반이 우리 학교에 없는 반이면 알려 줍니다. 이 반이면 홈 시간표가 늘 비어 있었습니다.
  const isSavedClassMissing =
    isMissing && initial !== null && initial.grade === grade && initial.classNo === classNo

  return (
    <>
      {/* 학년 · 반 · 저장을 한 줄에 둡니다. 저장은 자주 누르는 행동이 아니라서 꽉 찬 brand 버튼 대신 선만 있는 버튼입니다. (2026-10-22)
          학년 · 반 칸은 브라우저 기본 화살표가 칸 오른쪽 끝에 붙어서(여백 px-3 을 무시함), 기본 화살표를 끄고(appearance-none)
          안쪽(right-3)에 화살표를 직접 그립니다. 글자가 화살표에 닿지 않게 오른쪽 여백은 pr-9 입니다. (2026-10-23) */}
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="school-grade">
          학년
        </label>
        <div className="relative min-w-0 flex-1">
          <select
            id="school-grade"
            value={grade}
            onChange={(event) => setGrade(Number(event.target.value))}
            className="h-11 w-full cursor-pointer appearance-none rounded-xl bg-slate-100 pr-9 pl-3 text-base text-slate-900"
          >
            {[1, 2, 3].map((value) => (
              <option key={value} value={value}>
                {value}학년
              </option>
            ))}
          </select>
          <SelectArrow />
        </div>
        <label className="sr-only" htmlFor="school-class-no">
          반
        </label>
        <div className="relative min-w-0 flex-1">
          <select
            id="school-class-no"
            value={shownClassNo}
            onChange={(event) => setClassNo(Number(event.target.value))}
            className="h-11 w-full cursor-pointer appearance-none rounded-xl bg-slate-100 pr-9 pl-3 text-base text-slate-900"
          >
            {classNos.map((value) => (
              <option key={value} value={value}>
                {value}반
              </option>
            ))}
          </select>
          <SelectArrow />
        </div>
        <button
          type="button"
          onClick={() => onSave({ grade, classNo: shownClassNo })}
          className="h-11 shrink-0 cursor-pointer rounded-xl border border-slate-200 bg-white px-4 text-[15px] font-semibold text-slate-900 transition hover:bg-slate-50 active:scale-[0.98]"
        >
          {saveLabel}
        </button>
      </div>
      {isSavedClassMissing && (
        <p className="text-[13px] font-medium break-keep text-amber-700">
          {`${classNo}반은 우리 학교 ${grade}학년에 없어요. 맞는 반을 골라 [${saveLabel}]을 눌러 주세요.`}
        </p>
      )}
    </>
  )
}

/** 학년 · 반 칸 오른쪽 안쪽의 ▾ 화살표. 누르는 건 아래의 select 가 받도록 pointer-events-none 입니다. */
function SelectArrow() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-slate-500"
    >
      <path d="M5 7.5 10 12.5 15 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
