import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { ChipButton } from '@/components/ui/ChipButton'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import {
  GENERAL_TRACKS,
  MAJOR_NAME_MAX,
  cleanMajorName,
  schoolMajorsQuery,
  type SchoolTrack,
} from '@/lib/schoolTrack'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'

interface SchoolTrackFieldProps {
  /** 고른 학교의 번호 (NEIS 학교 번호, 예: '7530560') */
  schoolCode: string
  /** 지금 고른 학과 · 계열. 안 골랐으면 null */
  value: SchoolTrack | null
  /** 고르거나(SchoolTrack) 취소했을 때(null) */
  onChange: (next: SchoolTrack | null) => void
  className?: string
  /** "학과 이름" 입력칸에 더할 클래스. 흰 카드 없이 회색 바탕에 놓는 화면(가입)에서 칸을 흰색으로 바꿀 때 씁니다 */
  inputClassName?: string
}

/**
 * 학교 종류에 따라 학과 또는 계열을 고르는 칸입니다. (lib/schoolTrack.ts, 2026-10-19)
 * 가입 화면(pages/SignupPage.tsx)과 설정의 계정 묶음(pages/SettingsPage.tsx)이 같이 씁니다.
 *   특성화고 · 마이스터고 -> "무슨 과야?" 학과 칩 + [목록에 없어요] 를 누르면 직접 쓰기
 *   그 밖의 고등학교      -> "어느 쪽에 관심 있어?" 계열 칩 4개
 * 고르는 것은 선택입니다. 고른 칩을 다시 누르면 취소됩니다.
 *
 * 학교 종류 · 학과 목록을 받아오는 일은 아래의 TrackChoices 가 합니다.
 */
export function SchoolTrackField({
  schoolCode,
  value,
  onChange,
  className,
  inputClassName,
}: SchoolTrackFieldProps) {
  return (
    <div className={className}>
      <AsyncBoundary
        pendingFallback={
          <div role="status" className="flex flex-col gap-2">
            <span className="sr-only">우리 학교 학과 정보를 불러오는 중이에요</span>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-10 w-full" />
          </div>
        }
        errorMessage="학교 정보를 불러오지 못했어요. 다시 시도하거나, 나중에 설정에서 골라도 돼요."
        resetKeys={[schoolCode]}
      >
        <TrackChoices
          schoolCode={schoolCode}
          value={value}
          onChange={onChange}
          inputClassName={inputClassName}
        />
      </AsyncBoundary>
    </div>
  )
}

interface TrackChoicesProps {
  schoolCode: string
  value: SchoolTrack | null
  onChange: (next: SchoolTrack | null) => void
  inputClassName?: string
}

function TrackChoices({ schoolCode, value, onChange, inputClassName }: TrackChoicesProps) {
  const { data } = useSuspenseQuery(schoolMajorsQuery(schoolCode))
  // 목록에 없는 학과를 직접 쓰는 중인지. 저장된 학과가 목록에 없으면(예전에 직접 쓴 값) 처음부터 열어 둡니다.
  const [isTyping, setIsTyping] = useState(
    () => value?.kind === 'major' && !data.majors.includes(value.name),
  )

  if (!data.asksMajor) {
    return (
      <div>
        <p className="text-sm font-semibold text-slate-900">어느 쪽에 관심 있어? (선택)</p>
        <p className="mt-1 text-sm break-keep text-slate-500">
          고른 값은 이 기기에만 저장돼요. 설정 › 계정에서 언제든 바꿀 수 있어요.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {GENERAL_TRACKS.map((track) => {
            const isSelected = value?.kind === 'track' && value.name === track
            return (
              <ChipButton
                key={track}
                selected={isSelected}
                // 고른 칩을 다시 누르면 취소합니다.
                onClick={() =>
                  onChange(isSelected ? null : { schoolCode, kind: 'track', name: track })
                }
              >
                {track}
              </ChipButton>
            )
          })}
        </div>
      </div>
    )
  }

  function handleChooseMajor(major: string) {
    setIsTyping(false)
    const isSelected = value?.kind === 'major' && value.name === major
    onChange(isSelected ? null : { schoolCode, kind: 'major', name: major })
  }

  function handleStartTyping() {
    setIsTyping(true)
    // 목록에서 골라 둔 학과가 있었으면 지우고 직접 쓰게 합니다.
    if (value?.kind === 'major' && data.majors.includes(value.name)) onChange(null)
  }

  function handleType(text: string) {
    const name = cleanMajorName(text)
    onChange(name ? { schoolCode, kind: 'major', name } : null)
  }

  // 학과 목록이 비어 있으면(NEIS 에 학과가 안 올라온 학교) 바로 직접 쓰게 합니다.
  const showInput = isTyping || data.majors.length === 0

  return (
    <div>
      <p className="text-sm font-semibold text-slate-900">무슨 과야? (선택)</p>
      <p className="mt-1 text-sm break-keep text-slate-500">
        고른 값은 이 기기에만 저장돼요. 설정 › 계정에서 언제든 바꿀 수 있어요.
        {!data.complete && ' 학교에 따라 목록이 다 안 나올 수 있어요.'}
      </p>
      {data.majors.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {data.majors.map((major) => (
            <ChipButton
              key={major}
              selected={!isTyping && value?.kind === 'major' && value.name === major}
              onClick={() => handleChooseMajor(major)}
            >
              {major}
            </ChipButton>
          ))}
          <ChipButton selected={isTyping} onClick={handleStartTyping}>
            목록에 없어요
          </ChipButton>
        </div>
      )}
      {showInput && (
        <div className="mt-3">
          <Input
            label="학과 이름"
            // 직접 쓰는 중에는 저장된 값을 그대로 보여 줍니다. (목록에서 고른 값은 위에서 지웠습니다)
            defaultValue={value?.kind === 'major' ? value.name : ''}
            maxLength={MAJOR_NAME_MAX}
            onChange={(event) => handleType(event.target.value)}
            placeholder="예: 스마트전기과"
            className={cn('h-12 text-base', inputClassName)}
          />
        </div>
      )}
    </div>
  )
}
