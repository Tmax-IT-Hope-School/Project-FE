import { getCareLimits } from '@/lib/careLimits'
import { getCareLevelInfo } from '@/lib/careLevelInfo'
import { loadLatestCareStage } from '@/lib/careStage'
import type { CareLevel } from '@/lib/careTheme'
import { getTodayKey } from '@/lib/date'
import { isSafetyBrakeOnNow } from '@/lib/focusMode'

/**
 * 오늘 화면에 쓸 관리 강도와 독설 허용 수위를 돌려줍니다.
 * 통화 화면들(수신·통화 중)이 이 함수만 부르게 해서, 나중에 진짜 값으로 바꿀 곳을 한 군데로 모았습니다.
 *
 * - 독설 허용 수위: 사용자가 설정 화면에서 정한 값을 씁니다. (#59)
 * - 관리 강도: 매일 판정(lib/careStage.ts, 최종 기획서 「5.4」)이 저장한 가장 최근 단계를 씁니다. (#384)
 *   아직 한 번도 판정하지 않았으면 기본 단계(1)입니다. 어느 쪽이든 사용자가 정한 최대 한도는 넘지 않습니다.
 *   (판정을 부르는 곳은 홈 #405 · 통화 #414 에서 붙입니다)
 */

// 진짜 계산이 붙기 전까지 쓰는 오늘의 기본 단계 (1 = 당근)
const DEFAULT_TODAY_CARE_LEVEL: CareLevel = 1

/** 색 테마는 0~3 까지만 있어서, 4단계(강제적 채찍)는 화면 색으로는 3 과 같게 보여 줍니다. (4단계의 강제 장치는 #408) */
const MAX_THEME_LEVEL = 3

/**
 * 오늘의 관리 강도 (0~3). 가장 최근 판정(lib/careStage.ts)의 단계이고, 판정이 없으면 기본 단계(1)입니다.
 * 안전 브레이크(#95, 위기 표현 · 오랜 기분 저하)가 켜져 있으면 판정과 상관없이 회복(0)입니다.
 * (통화 수신 · 통화 중 · 결과 화면의 색과 인사말이 서버로 보내는 말투와 같아지게 합니다)
 */
export function getTodayCareLevel(): CareLevel {
  // 설정에서 정한 최대 한도를 넘지 않게 맞춥니다. 한도가 0(회복)이면 오늘도 0 입니다.
  // ("정한 한도는 절대 넘지 않아요" 라고 설정 화면에서 약속했기 때문입니다)
  // 통화·홈 화면이 열릴 때 부르는 함수라서, 저장된 값이 깨져 있어도 에러를 내지 않고 기본 단계를 돌려줍니다.
  try {
    if (isSafetyBrakeOnNow()) return 0
    const saved = loadLatestCareStage(getTodayKey())
    const stage = Math.min(saved?.stage ?? DEFAULT_TODAY_CARE_LEVEL, MAX_THEME_LEVEL)
    const maxLevel = getCareLimits().maxCareLevel
    return Math.min(stage, maxLevel) as CareLevel
  } catch {
    return DEFAULT_TODAY_CARE_LEVEL
  }
}

/**
 * 왜 지금 이 관리 모드인지 알려 주는 한 줄을 돌려줍니다. (#94, 홈의 "지금 관리 모드" 배너)
 *
 * 가장 최근 판정이 저장한 이유("최근 3일 중 2일을 폰 때문에 놓쳐서 넛지 모드야")를 먼저 쓰고,
 * 판정이 없거나 한도 때문에 단계가 달라졌으면 단계별 기본 문구를 씁니다. (#384)
 */
export function getTodayCareReason(level: CareLevel): string {
  try {
    const saved = loadLatestCareStage(getTodayKey())
    if (saved && Math.min(saved.stage, MAX_THEME_LEVEL) === level) return saved.reason
  } catch {
    // 저장된 값이 깨져 있으면 기본 문구로 갑니다.
  }
  return getCareLevelInfo(level).defaultReason
}

// 저장된 값을 읽지 못할 때 쓰는 수위입니다. 설정 화면의 처음 값(careLimits.ts 의 기본값)과 같습니다.
const DEFAULT_MAX_HARSHNESS = 3

/**
 * 사용자가 허용한 독설 수위 (1~5). 설정 화면에서 정한 값입니다. (#59)
 * 아직 한 번도 설정하지 않았으면 설정 화면의 처음 값(3)이 나옵니다.
 *
 * 통화 화면이 열릴 때 부르는 함수라서, 저장된 값이 깨져 있어도 에러를 내지 않고 기본값(3)을 돌려줍니다.
 */
export function getTodayMaxHarshness(): number {
  try {
    const value = getCareLimits().maxHarshness
    return Number.isFinite(value) ? value : DEFAULT_MAX_HARSHNESS
  } catch {
    return DEFAULT_MAX_HARSHNESS
  }
}

/** 통화를 연결할 때 서버에 알려 주는 "오늘의 말투" 입니다. 서버는 이 값으로 AI 의 말투 지침을 정합니다. (#257) */
export interface CallTone {
  /** 오늘의 관리 강도 (0 회복 ~ 3). 내가 정한 최대 한도를 넘지 않습니다. */
  careLevel: CareLevel
  /** 내가 허용한 독설 수위 (1 ~ 5). AI 는 이보다 센 말을 하면 안 됩니다. */
  maxHarshness: number
}

/**
 * 지금 통화를 걸 때 쓸 말투 값을 돌려줍니다.
 *
 * ■ 규칙
 *  1. 관리 강도는 getTodayCareLevel() 의 값입니다. 이 값은 설정의 "관리 강도 최대 한도" 를 넘지 않습니다.
 *  2. 안전 브레이크(#95)가 켜져 있으면 단계와 상관없이 회복(0)입니다. 힘든 날에는 목소리도 누그러져야 합니다.
 *     (getTodayCareLevel() 이 이미 0 을 돌려줍니다)
 *  3. 독설 허용 수위는 설정에서 정한 값 그대로입니다. "여기까지는 괜찮다" 는 한도이지, 그만큼 세게 하라는 뜻이 아닙니다.
 *
 * ■ 예시
 *   한도 2, 허용 수위 3, 안전 브레이크 꺼짐  -> { careLevel: 1, maxHarshness: 3 }
 *   한도 0(회복만), 허용 수위 3              -> { careLevel: 0, maxHarshness: 3 }
 *   한도 2, 허용 수위 5, 안전 브레이크 켜짐  -> { careLevel: 0, maxHarshness: 5 }
 */
export function getCallTone(): CallTone {
  return {
    careLevel: getTodayCareLevel(),
    maxHarshness: getTodayMaxHarshness(),
  }
}
