/**
 * 설정의 "코치 세기" 하나로 고르는 약 · 보통 · 강 묶음입니다. (2026-10-18 설정 단순하게)
 * 예전에는 관리 강도 최대 한도 · 독설 허용 수위 · 집중 모드 잠금 · 시간 외 독촉 전화를 따로 골랐는데,
 * 학생이 헷갈려서 하나로 합쳤습니다. 고르면 그 네 칸의 값을 아래처럼 한꺼번에 바꿉니다. (lib/careLimits.ts 의 저장 값 그대로)
 *
 *   약   — 관리 강도 1(당근) · 독설 2 · 집중 모드 잠금 끔 · 시간 외 독촉 전화 끔
 *   보통 — 관리 강도 2(넛지) · 독설 3 · 집중 모드 잠금 켬 · 시간 외 독촉 전화 끔
 *   강   — 관리 강도 4(강제적 채찍) · 독설 4 · 집중 모드 잠금 켬 · 시간 외 독촉 전화 켬 (하루 1번까지)
 *
 * 네 칸을 하나씩 바꾸고 싶으면 설정의 "자세히" 를 열면 됩니다. (getCoachStrength 의 isExact)
 */
import type { CareLimits } from '@/lib/careLimits'
import type { CareLevel } from '@/lib/careLevel'

export type CoachStrength = 'soft' | 'normal' | 'strong'

export interface StrengthPreset {
  strength: CoachStrength
  label: string
  /** 고르는 칸 아래의 한 줄 설명 */
  description: string
  maxCareLevel: CareLevel
  maxHarshness: number
  allowFocusMode: boolean
  allowOffHoursCall: boolean
}

export const STRENGTH_PRESETS: StrengthPreset[] = [
  {
    strength: 'soft',
    label: '약',
    description: '칭찬 위주로 부드럽게. 잠그거나 따로 전화하지 않아요.',
    maxCareLevel: 1,
    maxHarshness: 2,
    allowFocusMode: false,
    allowOffHoursCall: false,
  },
  {
    strength: 'normal',
    label: '보통',
    description: '할 일을 콕 집어 알려 주고, 집중 모드 잠금을 써요.',
    maxCareLevel: 2,
    maxHarshness: 3,
    allowFocusMode: true,
    allowOffHoursCall: false,
  },
  {
    strength: 'strong',
    label: '강',
    description: '미루면 세게 말하고, 정한 시간 밖에도 하루 1번 독촉 전화해요.',
    maxCareLevel: 4,
    maxHarshness: 4,
    allowFocusMode: true,
    allowOffHoursCall: true,
  },
]

/**
 * 지금 저장된 한도가 어느 세기인지. 관리 강도 최대 한도(가장 큰 손잡이)로 정합니다.
 *   0 · 1 → 약 / 2 · 3 → 보통 / 4 → 강
 * 3 은 기획서 기본값이라 온보딩이 "보통 세기로 시작할게요" 라고 안내합니다. (lib/settingsMapping.ts 의 proposeCareLimits)
 * 그래서 3 도 보통으로 봅니다. 예전에는 3 을 강으로 보여서, 독촉 전화가 꺼져 있는데도 "하루 1번 독촉 전화" 라고 보였습니다. (2026-10-25 QA)
 * 온보딩 결과나 "자세히" 로 나머지 칸이 묶음과 달라도 세기는 하나 골라진 모양으로 보이고, isExact 가 false 입니다.
 * 올려 두고 아직 적용 전인 값(내일부터)이 있으면 그 값으로 봅니다. (고른 대로 보이게)
 *
 *   getCoachStrength({ maxCareLevel: 2, maxHarshness: 3, allowFocusMode: false, … }) -> { strength: 'normal', isExact: false }
 */
export function getCoachStrength(limits: CareLimits): {
  strength: CoachStrength
  isExact: boolean
} {
  const careLevel = limits.pendingMaxCareLevel ?? limits.maxCareLevel
  const harshness = limits.pendingMaxHarshness ?? limits.maxHarshness
  const strength: CoachStrength = careLevel <= 1 ? 'soft' : careLevel <= 3 ? 'normal' : 'strong'
  const preset = STRENGTH_PRESETS.find((item) => item.strength === strength)
  const isExact =
    preset !== undefined &&
    preset.maxCareLevel === careLevel &&
    preset.maxHarshness === harshness &&
    preset.allowFocusMode === limits.allowFocusMode &&
    preset.allowOffHoursCall === limits.allowOffHoursCall
  return { strength, isExact }
}
