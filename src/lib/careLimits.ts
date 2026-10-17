import { getTodayKey, moveDateKey } from './date'
import { loadData, saveData } from './storage'
import type { CareLevel } from '@/lib/careLevel'

/**
 * 사용자가 정한, AI 가 절대 넘으면 안 되는 한도입니다.
 * #28(관리 강도 정하기) · #32(말투·색) · #69(집중 모드) 같은 기능은
 * getCareLimits() 로 "지금 적용되는 한도"만 읽으면 됩니다.
 */
export interface CareLimits {
  /** 허용하는 관리 강도의 최댓값 (0~4) */
  maxCareLevel: CareLevel
  /** 허용하는 독설 수위 (1~5) */
  maxHarshness: number
  /** 정해진 시간 외 독촉 전화를 허용하는지 (허용해도 하루 1회까지) */
  allowOffHoursCall: boolean
  /** 집중 모드(#69) 잠금을 허용하는지 */
  allowFocusMode: boolean
  /** 한도를 올렸는데 아직 적용 전이면 바뀔 값. 없으면 null */
  pendingMaxCareLevel: CareLevel | null
  /** 수위를 올렸는데 아직 적용 전이면 바뀔 값. 없으면 null */
  pendingMaxHarshness: number | null
  /** 예약한 값(pendingMaxCareLevel · pendingMaxHarshness)이 적용되는 날짜 ('YYYY-MM-DD'). 없으면 null */
  pendingEffectiveDate: string | null
}

// 저장소에 넣는 이름입니다. (실제 키는 storage.ts 가 앞에 'study-' 를 붙여서 'study-care-limits' 가 됩니다)
const STORAGE_KEY = 'care-limits'

// 아직 한 번도 설정하지 않았으면, AI 가 가장 조심스럽게 대하도록 낮은 한도로 시작합니다.
// (더 세게 하고 싶으면 사용자가 직접 올리는 쪽이 안전합니다)
const defaultLimits: CareLimits = {
  maxCareLevel: 2,
  maxHarshness: 3,
  allowOffHoursCall: false,
  allowFocusMode: false,
  pendingMaxCareLevel: null,
  pendingMaxHarshness: null,
  pendingEffectiveDate: null,
}

/** 값이 관리 강도(0 ~ 4 의 정수)가 맞는지 확인합니다. */
function isCareLevel(value: unknown): value is CareLevel {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4
}

/** 값이 독설 수위(1 ~ 5 의 정수)가 맞는지 확인합니다. */
function isHarshness(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5
}

/**
 * 저장소에서 꺼낸 값을 한도 모양으로 맞춥니다. 모양이 틀린 칸은 기본값으로 채웁니다.
 * (저장된 값이 깨져 있으면 설정 · 홈 · 타이머 화면이 통째로 멈추기 때문에, 칸마다 확인합니다)
 */
function toCareLimits(saved: unknown): CareLimits {
  if (typeof saved !== 'object' || saved === null) return defaultLimits
  const value = saved as Record<string, unknown>

  const pendingLevel = isCareLevel(value.pendingMaxCareLevel) ? value.pendingMaxCareLevel : null
  const pendingHarshness = isHarshness(value.pendingMaxHarshness) ? value.pendingMaxHarshness : null
  const hasPending = pendingLevel !== null || pendingHarshness !== null

  return {
    maxCareLevel: isCareLevel(value.maxCareLevel) ? value.maxCareLevel : defaultLimits.maxCareLevel,
    maxHarshness: isHarshness(value.maxHarshness) ? value.maxHarshness : defaultLimits.maxHarshness,
    // 허용 여부는 true 라고 분명히 저장된 것만 허용으로 봅니다.
    allowOffHoursCall: value.allowOffHoursCall === true,
    allowFocusMode: value.allowFocusMode === true,
    pendingMaxCareLevel: pendingLevel,
    pendingMaxHarshness: pendingHarshness,
    // 예약한 값이 하나도 없으면 날짜도 의미가 없어서 비웁니다.
    pendingEffectiveDate:
      hasPending && typeof value.pendingEffectiveDate === 'string'
        ? value.pendingEffectiveDate
        : null,
  }
}

/**
 * 지금 적용되는 한도를 돌려줍니다.
 * 예약해 둔 한도 · 수위 상향의 적용 날짜가 되었으면, 지금 적용하고 저장한 뒤 돌려줍니다.
 */
export function getCareLimits(): CareLimits {
  const saved = toCareLimits(loadData<unknown>(STORAGE_KEY, null))

  const canApplyPending =
    saved.pendingEffectiveDate !== null && saved.pendingEffectiveDate <= getTodayKey()

  if (!canApplyPending) return saved

  const applied: CareLimits = {
    ...saved,
    maxCareLevel: saved.pendingMaxCareLevel ?? saved.maxCareLevel,
    maxHarshness: saved.pendingMaxHarshness ?? saved.maxHarshness,
    pendingMaxCareLevel: null,
    pendingMaxHarshness: null,
    pendingEffectiveDate: null,
  }
  saveData(STORAGE_KEY, applied)
  return applied
}

/** 예약 날짜를 정합니다. 예약이 하나라도 남아 있으면 내일, 없으면 null 입니다. */
function withPendingDate(limits: CareLimits): CareLimits {
  const hasPending = limits.pendingMaxCareLevel !== null || limits.pendingMaxHarshness !== null
  return { ...limits, pendingEffectiveDate: hasPending ? moveDateKey(getTodayKey(), 1) : null }
}

/**
 * 관리 강도 최대 한도를 바꿉니다. (최종 기획서 「4.8 설정」 — 낮추면 즉시, 높이면 다음 날부터)
 * - 낮추거나 지금 값을 다시 고르면 바로 적용하고, 예약해 둔 상향은 지웁니다.
 * - 높이면 지금 값은 그대로 두고 내일 바뀌도록 예약합니다.
 * 4단계로 올릴 때 "정말 올릴까요?" 하고 한 번 더 묻는 건 설정 화면(SettingsPage)이 합니다.
 *
 *   지금 2, setMaxCareLevel(1) -> maxCareLevel 1 (바로)
 *   지금 2, setMaxCareLevel(3) -> maxCareLevel 2, pendingMaxCareLevel 3, 내일 날짜
 */
export function setMaxCareLevel(nextLevel: CareLevel): CareLimits {
  const current = getCareLimits()
  const isRaise = nextLevel > current.maxCareLevel
  const next = withPendingDate({
    ...current,
    maxCareLevel: isRaise ? current.maxCareLevel : nextLevel,
    pendingMaxCareLevel: isRaise ? nextLevel : null,
  })
  saveData(STORAGE_KEY, next)
  return next
}

/** 온보딩에서 한도를 처음 정할 때 씁니다. 관리 강도와 독설 수위를 한 번에 바로 적용합니다. */
export function setInitialCareLimits(maxCareLevel: CareLevel, maxHarshness: number): CareLimits {
  const next: CareLimits = {
    ...getCareLimits(),
    maxCareLevel,
    maxHarshness,
    pendingMaxCareLevel: null,
    pendingMaxHarshness: null,
    pendingEffectiveDate: null,
  }
  saveData(STORAGE_KEY, next)
  return next
}

/**
 * 독설 허용 수위(1~5)를 바꿉니다. 한도와 같은 규칙입니다 — 낮추면 즉시, 높이면 다음 날부터.
 *
 *   지금 3, setMaxHarshness(2) -> maxHarshness 2 (바로)
 *   지금 3, setMaxHarshness(5) -> maxHarshness 3, pendingMaxHarshness 5, 내일 날짜
 */
export function setMaxHarshness(value: number): CareLimits {
  const current = getCareLimits()
  const isRaise = value > current.maxHarshness
  const next = withPendingDate({
    ...current,
    maxHarshness: isRaise ? current.maxHarshness : value,
    pendingMaxHarshness: isRaise ? value : null,
  })
  saveData(STORAGE_KEY, next)
  return next
}

/** 정해진 시간 외 독촉 전화 허용 여부를 바꿉니다. 바로 적용됩니다. */
export function setAllowOffHoursCall(allow: boolean): CareLimits {
  const next: CareLimits = { ...getCareLimits(), allowOffHoursCall: allow }
  saveData(STORAGE_KEY, next)
  return next
}

/** 집중 모드 잠금 허용 여부를 바꿉니다. 바로 적용됩니다. */
export function setAllowFocusMode(allow: boolean): CareLimits {
  const next: CareLimits = { ...getCareLimits(), allowFocusMode: allow }
  saveData(STORAGE_KEY, next)
  return next
}
