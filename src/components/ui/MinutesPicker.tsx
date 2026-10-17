import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/cn'
import { useState, type KeyboardEvent } from 'react'

interface MinutesPickerProps {
  /** 버튼 위에 보여줄 이름 (예: '목표 시간') */
  label: string
  /** 버튼으로 보여줄 값들 (분). 예: [30, 60, 90, 120] */
  presets: number[]
  /** 지금 고른 값 (분) */
  value: number
  /** 다른 값을 골랐을 때 호출됩니다. 쓸 수 있는 값(min ~ max 사이의 정수)일 때만 불립니다. */
  onChange: (minutes: number) => void
  /** 직접 입력할 수 있는 가장 작은 값 (분). 기본 1 */
  min?: number
  /** 직접 입력할 수 있는 가장 큰 값 (분). 기본 600 */
  max?: number
  className?: string
}

/**
 * 시간(분)을 버튼으로 고르는 조각입니다. 버튼에 없는 값은 "직접" 을 눌러 숫자로 적습니다.
 * 타이머의 목표 시간과 계획 추가의 목표 시간에서 같이 씁니다.
 *
 * <MinutesPicker label="목표 시간" presets={[30, 60, 90, 120]} value={minutes} onChange={setMinutes} />
 */
export function MinutesPicker({
  label,
  presets,
  value,
  onChange,
  min = 1,
  max = 600,
  className,
}: MinutesPickerProps) {
  // 버튼에 없는 값이면 "직접" 을 고른 상태로 시작합니다.
  const [isCustom, setIsCustom] = useState(() => !presets.includes(value))
  // input 에서 꺼낸 값은 항상 글자라서, 글자로 들고 있다가 숫자로 바꿔서 넘깁니다.
  const [customText, setCustomText] = useState(String(value))

  /** 직접 적은 글자가 쓸 수 있는 값(min ~ max 사이의 정수)인지 확인합니다. */
  function isValidText(text: string) {
    const minutes = Number(text)
    return text.trim() !== '' && Number.isInteger(minutes) && minutes >= min && minutes <= max
  }

  function handleSelectPreset(minutes: number) {
    setIsCustom(false)
    onChange(minutes)
  }

  function handleSelectCustom() {
    setIsCustom(true)
    setCustomText(String(value))
  }

  function handleChangeCustom(text: string) {
    setCustomText(text)
    // 비어 있거나 범위를 벗어난 값은 넘기지 않습니다. (입력칸 아래 안내 문구만 보여줍니다)
    if (isValidText(text)) onChange(Number(text))
  }

  // 입력칸에서 나갈 때 틀린 글자가 남아 있으면, 마지막으로 고른(쓸 수 있는) 값으로 되돌립니다.
  // 화면에 보이는 숫자와 실제로 쓰이는 값이 달라지지 않게 하기 위해서입니다.
  function handleBlurCustom() {
    if (!isValidText(customText)) setCustomText(String(value))
  }

  // 틀린 글자(범위 밖 · 빈 칸)를 둔 채 Enter 를 누르면 폼이 그대로 저장되는데, 이때 쓰이는 값은 화면에 적힌 숫자가 아니라 마지막으로 고른 값입니다.
  // 화면 숫자와 저장되는 값이 달라지지 않게, 틀린 글자가 있을 때는 Enter 로 저장되지 않게 막고 안내 문구를 그대로 둡니다.
  function handleKeyDownCustom(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && !isValidText(customText)) event.preventDefault()
  }

  const buttonClass = (isSelected: boolean) =>
    cn(
      // flex-1 + min-w-0: 버튼이 몇 개든 한 줄에서 같은 너비로 나눠 가집니다. (375px 에서도 한 줄)
      'h-10 min-w-0 flex-1 cursor-pointer rounded-lg border px-1 text-sm font-medium whitespace-nowrap transition-colors',
      isSelected
        ? 'border-brand bg-brand-light text-brand'
        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    )

  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)}>
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <div role="group" aria-label={label} className="flex gap-1.5">
        {presets.map((minutes) => {
          const isSelected = !isCustom && minutes === value
          return (
            <button
              key={minutes}
              type="button"
              aria-pressed={isSelected}
              onClick={() => handleSelectPreset(minutes)}
              className={buttonClass(isSelected)}
            >
              {minutes}분
            </button>
          )
        })}
        <button
          type="button"
          aria-pressed={isCustom}
          onClick={handleSelectCustom}
          className={buttonClass(isCustom)}
        >
          직접
        </button>
      </div>

      {isCustom && (
        <Input
          aria-label={`${label} 직접 입력 (분)`}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          placeholder="분"
          value={customText}
          onChange={(event) => handleChangeCustom(event.target.value)}
          onBlur={handleBlurCustom}
          onKeyDown={handleKeyDownCustom}
          error={isValidText(customText) ? undefined : `${min} ~ ${max} 사이의 숫자로 적어 주세요.`}
        />
      )}
    </div>
  )
}
