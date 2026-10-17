import { careLevelInfos } from '@/lib/careLevelInfo'
import { cn } from '@/lib/cn'
import type { CareLevel } from '@/lib/careLevel'

/**
 * 관리 강도 최대 한도와 독설 허용 수위를 고르는 화면 조각입니다. (#59)
 * 설정 화면과 온보딩 "관리 설정" 단계에서 같이 씁니다.
 * 고르기만 하고 저장은 하지 않습니다. 저장은 쓰는 쪽에서 합니다.
 * (설정 화면은 고르는 즉시 저장하고, 온보딩은 "완료" 때 처음 값으로 저장합니다)
 *
 *   <CareLevelPicker value={limits.maxCareLevel} onChange={handleChangeLevel} />
 *   <HarshnessPicker value={limits.maxHarshness} onChange={handleChangeHarshness} />
 */

/**
 * 관리 강도 단계별 이름과 한 줄 설명.
 * 홈의 "지금 관리 모드" 배너(#94)와 같은 문구를 쓰도록 lib/careLevelInfo.ts 에서 가져옵니다. 문구는 거기서 고치세요.
 */
const careLevelOptions: { level: CareLevel; label: string; description: string }[] =
  careLevelInfos.map((info) => ({
    level: info.level,
    label: `${info.level} ${info.name}`,
    description: info.description,
  }))

/** 독설 허용 수위(1~5)별 한 줄 설명 */
const harshnessDescriptions: Record<number, string> = {
  1: '부드럽게만 말해줘',
  2: '담백하게 짚어줘',
  3: '따끔하게 말해도 돼',
  4: '세게 말해도 돼',
  5: '제일 세게 말해도 돼',
}

interface CareLevelPickerProps {
  /** 지금 고른 최대 한도 (0~4) */
  value: CareLevel
  onChange: (level: CareLevel) => void
  className?: string
}

/** 관리 강도 최대 한도 고르기 (단계마다 설명 한 줄이 붙은 카드 모양 라디오 버튼) */
export function CareLevelPicker({ value, onChange, className }: CareLevelPickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label="관리 강도 최대 한도"
      className={cn('flex flex-col gap-2', className)}
    >
      {careLevelOptions.map((option) => {
        const isSelected = option.level === value
        return (
          <label
            key={option.level}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3',
              isSelected ? 'border-brand bg-brand-light' : 'border-slate-200 hover:bg-slate-50',
            )}
          >
            <input
              type="radio"
              name="maxCareLevel"
              checked={isSelected}
              onChange={() => onChange(option.level)}
              className="accent-brand mt-1 h-5 w-5 shrink-0 cursor-pointer"
            />
            <span className="flex flex-col">
              <span className="text-sm font-semibold text-slate-900">{option.label}</span>
              <span className="text-sm text-slate-500">{option.description}</span>
            </span>
          </label>
        )
      })}
    </div>
  )
}

interface HarshnessPickerProps {
  /** 지금 고른 독설 허용 수위 (1~5) */
  value: number
  onChange: (value: number) => void
  className?: string
}

/** 독설 허용 수위 고르기 (1~5 버튼 + 고른 수위의 설명 한 줄) */
export function HarshnessPicker({ value, onChange, className }: HarshnessPickerProps) {
  return (
    <div className={className}>
      <div role="group" aria-label="독설 허용 수위" className="grid grid-cols-5 gap-2">
        {[1, 2, 3, 4, 5].map((level) => {
          const isSelected = level === value
          return (
            <button
              key={level}
              type="button"
              aria-pressed={isSelected}
              // 숫자만 읽히지 않게 뜻도 같이 읽어 줍니다. 예) "3단계, 따끔하게 …"
              aria-label={`${level}단계, ${harshnessDescriptions[level]}`}
              onClick={() => onChange(level)}
              className={cn(
                'h-10 cursor-pointer rounded-lg border text-sm font-medium transition-colors',
                isSelected
                  ? 'border-brand bg-brand-light text-brand'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
              )}
            >
              {level}
            </button>
          )
        })}
      </div>

      <p className="mt-2 text-sm text-slate-500">
        {value} · {harshnessDescriptions[value]}
      </p>
    </div>
  )
}
