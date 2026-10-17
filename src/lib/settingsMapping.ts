import type { PsychScale, ScaleLevel } from '@/lib/psychTest'
import { loadData, saveData } from '@/lib/storage'
import type { CareLevel } from '@/types'

/**
 * 성향으로 설정 자동 맞추기 (최종 기획서 「6.3 설정 자동 매핑」·「4.8 설정」, #385)
 *
 * - 첫 14일은 온보딩 심리검사(척도 7개)로, 그 뒤에는 행동 데이터(「6.4」)로 설정을 맞춥니다.
 * - 설정마다 근거(검사 / 데이터 / 내가 정함)와 이유 한 줄을 남깁니다.
 * - **사용자가 직접 바꾼 설정은 잠깁니다.** AI 는 다시 바꾸지 않고 제안만 합니다.
 * - 제재 최대 한도 · 말투 수위는 여기서 바꾸지 않습니다. 온보딩에서 미리 채워 두고(proposeCareLimits) 사용자가 정합니다.
 *
 * 같은 표가 BE(Project-BE#233)에도 있습니다. 표를 고치면 같이 고칩니다.
 */

/** AI 가 맞춰 주는 설정들 (「6.3」 표의 줄) */
export interface AutoSettingValues {
  /** 5초 카운트다운 */
  countdown: boolean
  /** 알림 시점 — 정각 알림 말고 몇 분 전에 한 번 더 알릴지 (0 = 안 함) */
  earlyAlertMinutes: 0 | 10
  /** 타이머 화면 — 미니멀 / 체크리스트 */
  timerMode: 'minimal' | 'checklist'
  /** 딴생각 주차장 */
  parkingLot: boolean
  /** 체크리스트 작성 — 계속 AI 기본값 / 2주 뒤 "직접 써볼까요?" 제안 */
  checklistWriter: 'ai' | 'suggestSelf'
  /** 카드 폼의 선택 입력칸을 펼쳐 둘지 */
  optionalFieldsOpen: boolean
  /** 예상 실패 원인을 필수로 받을지 (내부 원인 1개) */
  failCauseRequired: boolean
  /** 계획 패턴 안내 — 보여 주기만 / 체크리스트 개수를 최근 달성 수에 맞춰 제안 */
  planPatternHint: 'show' | 'suggestCount'
  /** 산출물 증빙 — 선택 / 강제 제안 (4단계에서는 자동 강제, #408) */
  proof: 'optional' | 'suggestRequired'
  /** 잘 된 이유 태그를 몇 번에 1번 물을지 */
  goodReasonEvery: 2 | 3
  /** 왜곡 경향 피드백 (주에 몇 번) */
  distortionFeedbackPerWeek: 1 | 2
  /** 회복 모드 민감도 (며칠 이어지면 회복 모드인지) */
  recoverySensitivityDays: 2 | 3 | 4
  /** 실패한 카드를 나눠 넣을지 묻는 때 — 통화 때 / 실패 직후 */
  failedCardTiming: 'call' | 'rightAfter'
  /** 루틴 카드 미루기 한도 (월). 3 은 권장값이라 사용자 확인 뒤 적용 */
  postponeLimitRoutine: 3 | 5
}

export type AutoSettingKey = keyof AutoSettingValues

/** 기본값 (「6.3」 표의 '기본값' 칸) */
export const DEFAULT_AUTO_SETTINGS: AutoSettingValues = {
  countdown: false,
  earlyAlertMinutes: 0,
  timerMode: 'minimal',
  parkingLot: false,
  checklistWriter: 'ai',
  optionalFieldsOpen: false,
  failCauseRequired: false,
  planPatternHint: 'show',
  proof: 'optional',
  goodReasonEvery: 3,
  distortionFeedbackPerWeek: 1,
  recoverySensitivityDays: 3,
  failedCardTiming: 'call',
  postponeLimitRoutine: 5,
}

/** 설정 하나의 근거 — test: 검사 기준, data: 최근 데이터 기준, user: 내가 정함, default: 기본값 */
export type SettingSource = 'test' | 'data' | 'user' | 'default'

/** 설정 하나를 저장하는 모양 */
export interface StoredSetting<K extends AutoSettingKey = AutoSettingKey> {
  value: AutoSettingValues[K]
  source: SettingSource
  /** 이유 한 줄 ("시작 저항이 높게 나와서 켰어요") */
  reason: string
  /** 사용자가 직접 바꿨으면 true — AI 는 다시 바꾸지 않습니다 */
  locked: boolean
  /** AI 가 바꾸기 전 값 — [되돌리기] 를 누르면 이 값으로 돌아갑니다 (#390). AI 가 바꾼 적 없으면 없음 */
  before?: AutoSettingValues[K]
}

export type StoredSettings = { [K in AutoSettingKey]: StoredSetting<K> }

/** AI 가 내놓는 바꿀 안 하나 */
export interface SettingProposal<K extends AutoSettingKey = AutoSettingKey> {
  key: K
  value: AutoSettingValues[K]
  reason: string
}

/** 척도 수준 (lib/psychTest.ts 의 getScaleLevel 결과) */
export type ScaleLevels = Partial<Record<PsychScale, ScaleLevel>>

function propose<K extends AutoSettingKey>(
  key: K,
  value: AutoSettingValues[K],
  reason: string,
): SettingProposal {
  return { key, value, reason } as SettingProposal
}

/**
 * 검사 결과로 설정 안을 만듭니다 (「6.3」 '성향에 따른 자동값' 칸). 기본값과 같으면 안을 내지 않습니다.
 *
 *   proposeFromTest({ startResistance: 'high' })
 *     -> [ countdown 켬, earlyAlertMinutes 10 ]  (이유: '시작 저항이 높게 나와서 …')
 *   proposeFromTest({ failSensitivity: 'low' })
 *     -> [ recoverySensitivityDays 4, failedCardTiming 'rightAfter' ]
 *   proposeFromTest({})  -> []
 */
export function proposeFromTest(levels: ScaleLevels): SettingProposal[] {
  const out: SettingProposal[] = []
  const is = (scale: PsychScale, level: ScaleLevel) => levels[scale] === level

  if (is('startResistance', 'high')) {
    out.push(propose('countdown', true, '시작 저항이 높게 나와서 5초 카운트다운을 켰어요'))
    out.push(propose('earlyAlertMinutes', 10, '시작 저항이 높게 나와서 10분 전 알림을 더했어요'))
  }
  if (is('distraction', 'high')) {
    out.push(
      propose('timerMode', 'checklist', '주의 분산이 높게 나와서 체크리스트 화면으로 했어요'),
    )
    out.push(propose('parkingLot', true, '주의 분산이 높게 나와서 딴생각 주차장을 켰어요'))
  }
  if (is('recordBurden', 'low')) {
    out.push(
      propose(
        'checklistWriter',
        'suggestSelf',
        '기록이 부담 없다고 해서 2주 뒤 직접 써 보기를 제안할게요',
      ),
    )
    out.push(propose('optionalFieldsOpen', true, '기록이 부담 없다고 해서 선택 칸을 펼쳐 뒀어요'))
  }
  if (is('externalAttribution', 'high')) {
    out.push(
      propose('failCauseRequired', true, '원인을 밖에서 찾는 편이라 예상 실패 원인을 꼭 받을게요'),
    )
    out.push(
      propose('goodReasonEvery', 2, '원인을 밖에서 찾는 편이라 잘 된 이유를 더 자주 물을게요'),
    )
    out.push(
      propose(
        'distortionFeedbackPerWeek',
        2,
        '원인을 밖에서 찾는 편이라 생각 습관 피드백을 주 2회로 했어요',
      ),
    )
  }
  if (is('planOptimism', 'high')) {
    out.push(
      propose(
        'planPatternHint',
        'suggestCount',
        '계획을 크게 세우는 편이라 체크리스트 개수를 맞춰 제안할게요',
      ),
    )
  }
  if (is('carePreference', 'high') && is('recordBurden', 'low')) {
    out.push(
      propose(
        'proof',
        'suggestRequired',
        '따끔한 관리를 원하고 기록이 부담 없어서 산출물 증빙을 권해요',
      ),
    )
  }
  if (is('failSensitivity', 'high')) {
    out.push(
      propose(
        'recoverySensitivityDays',
        2,
        '한 번 무너지면 오래가는 편이라 회복 모드를 빨리 켤게요',
      ),
    )
  }
  if (is('failSensitivity', 'low')) {
    out.push(
      propose('recoverySensitivityDays', 4, '잘 털고 일어나는 편이라 회복 모드를 늦게 켤게요'),
    )
    out.push(
      propose(
        'failedCardTiming',
        'rightAfter',
        '잘 털고 일어나는 편이라 실패한 카드는 바로 정리할게요',
      ),
    )
  }
  if (is('startResistance', 'high') && is('carePreference', 'high')) {
    out.push(
      propose(
        'postponeLimitRoutine',
        3,
        '시작이 어렵고 따끔한 관리를 원해서 미루기를 월 3회로 권해요',
      ),
    )
  }
  return out.filter((item) => DEFAULT_AUTO_SETTINGS[item.key] !== item.value)
}

/** 14일 뒤 데이터로 설정을 맞출 때 쓰는 숫자 (「6.4」). 계산할 수 없는 값은 null */
export interface SettingDataMetrics {
  /** 유효 카드일 수 — 14 이상일 때만 데이터 기준으로 넘어갑니다 */
  validCardDays: number
  /** 평균 시작 지연 (분) */
  averageStartDelayMinutes: number | null
  /** 시간당 일시정지 횟수 */
  pausesPerHour: number | null
  /** 실패 원인 태그 중 바깥(외부) 원인 비율 (0 ~ 1) */
  externalFailRatio: number | null
}

/** 데이터 기준으로 넘어가는 날 수 */
export const DATA_SWITCH_DAYS = 14
/** 「6.3」 '14일 뒤 데이터 기준' 칸의 숫자들 */
export const DATA_COUNTDOWN_DELAY_MINUTES = 10
export const DATA_CHECKLIST_MODE_PAUSES_PER_HOUR = 2
export const DATA_FAIL_CAUSE_EXTERNAL_RATIO = 0.6

/**
 * 14일 뒤 데이터로 설정 안을 만듭니다. 기획서 표에 숫자 기준이 있는 줄만 바꿉니다.
 * (숫자 기준이 없는 줄은 검사로 정한 값을 그대로 둡니다)
 *
 *   유효 카드일 10일                                 -> []  (아직 검사 기준)
 *   유효 카드일 14일, 평균 시작 지연 12분             -> [ countdown 켬 ]
 *   유효 카드일 14일, 시간당 일시정지 2.5회           -> [ timerMode 'checklist' ]
 *   유효 카드일 14일, 실패 원인 외부 비율 0.7         -> [ failCauseRequired 켬 ]
 */
export function proposeFromData(metrics: SettingDataMetrics): SettingProposal[] {
  if (metrics.validCardDays < DATA_SWITCH_DAYS) return []
  const out: SettingProposal[] = []
  const delay = metrics.averageStartDelayMinutes
  if (delay !== null && delay >= DATA_COUNTDOWN_DELAY_MINUTES) {
    out.push(
      propose(
        'countdown',
        true,
        `최근 시작이 평균 ${Math.round(delay)}분 늦어져서 5초 카운트다운을 켰어요`,
      ),
    )
  }
  const pauses = metrics.pausesPerHour
  if (pauses !== null && pauses >= DATA_CHECKLIST_MODE_PAUSES_PER_HOUR) {
    out.push(propose('timerMode', 'checklist', '공부 중에 자주 멈춰서 체크리스트 화면을 써 볼게요'))
  }
  const external = metrics.externalFailRatio
  if (external !== null && external >= DATA_FAIL_CAUSE_EXTERNAL_RATIO) {
    out.push(
      propose(
        'failCauseRequired',
        true,
        '못 한 이유를 밖에서 찾는 일이 많아서 예상 실패 원인을 꼭 받을게요',
      ),
    )
  }
  return out
}

/** 바로 바꾸지 않고 꼭 사용자 확인을 받는 설정 (「4.4」 "성향에 따라 AI가 루틴 한도 3회를 권할 수 있다(사용자 확인)") */
export const NEEDS_CONFIRM_KEYS: AutoSettingKey[] = ['postponeLimitRoutine']

/** 설정이 하나 바뀐 기록 — 홈의 "…켰어요 [되돌리기]" 에 씁니다 */
export interface SettingChange {
  key: AutoSettingKey
  from: AutoSettingValues[AutoSettingKey]
  to: AutoSettingValues[AutoSettingKey]
  reason: string
  source: SettingSource
}

/** 아무것도 정하지 않은 처음 상태 (모두 기본값) */
export function createDefaultSettings(): StoredSettings {
  const entries = Object.entries(DEFAULT_AUTO_SETTINGS).map(([key, value]) => [
    key,
    { value, source: 'default', reason: '기본값이에요', locked: false },
  ])
  return Object.fromEntries(entries) as StoredSettings
}

/**
 * AI 의 안을 적용합니다. React 도 저장소도 쓰지 않는 순수 함수입니다.
 * - 잠긴(사용자가 바꾼) 설정과 확인이 필요한 설정(NEEDS_CONFIRM_KEYS)은 바꾸지 않고
 *   suggestions 로 돌려줍니다 (화면에서 "이렇게 바꿔 볼까요?")
 * - 값이 같으면 바꾸지 않습니다 (근거·이유도 그대로)
 *
 *   잠기지 않은 countdown 끔 + 안 '켬'    -> next.countdown 켬(source 'test'), changes 1개
 *   잠긴 countdown 끔(user) + 안 '켬'     -> next 그대로, suggestions 1개
 */
export function applyProposals(
  current: StoredSettings,
  proposals: SettingProposal[],
  source: 'test' | 'data',
): { next: StoredSettings; changes: SettingChange[]; suggestions: SettingProposal[] } {
  const next = { ...current } as Record<AutoSettingKey, StoredSetting>
  const changes: SettingChange[] = []
  const suggestions: SettingProposal[] = []
  for (const proposal of proposals) {
    const setting = next[proposal.key]
    if (setting.value === proposal.value) continue
    if (setting.locked || NEEDS_CONFIRM_KEYS.includes(proposal.key)) {
      suggestions.push(proposal)
      continue
    }
    next[proposal.key] = {
      value: proposal.value,
      source,
      reason: proposal.reason,
      locked: false,
      before: setting.value,
    }
    changes.push({
      key: proposal.key,
      from: setting.value,
      to: proposal.value,
      reason: proposal.reason,
      source,
    })
  }
  return { next: next as StoredSettings, changes, suggestions }
}

/**
 * 사용자가 직접 바꿉니다 ([되돌리기] 포함). 바꾼 설정은 잠겨서 AI 가 다시 바꾸지 않습니다.
 *
 *   setByUser(settings, 'countdown', false) -> countdown { value: false, source: 'user', locked: true }
 */
export function setByUser<K extends AutoSettingKey>(
  current: StoredSettings,
  key: K,
  value: AutoSettingValues[K],
): StoredSettings {
  return { ...current, [key]: { value, source: 'user', reason: '내가 정했어요', locked: true } }
}

/** AI 가 바꾼 설정이라 [되돌리기] 를 보여 줄지 */
export function canRevert(setting: StoredSetting): boolean {
  return (setting.source === 'test' || setting.source === 'data') && setting.before !== undefined
}

/**
 * [되돌리기] — AI 가 바꾸기 전 값으로 돌리고 잠급니다. (#390, 「4.8 설정」)
 * 되돌린 것도 사용자가 정한 것이라 AI 는 다시 바꾸지 않습니다.
 *
 *   countdown { value: true, source: 'test', before: false } -> { value: false, source: 'user', locked: true }
 *   AI 가 바꾼 적 없는 설정                                    -> 그대로
 */
export function revertSetting(current: StoredSettings, key: AutoSettingKey): StoredSettings {
  const setting = current[key] as StoredSetting
  if (!canRevert(setting)) return current
  return {
    ...current,
    [key]: { value: setting.before, source: 'user', reason: '되돌렸어요', locked: true },
  }
}

/** 온보딩에서 미리 채워 둘 제재 최대 한도 · 말투 수위 (사용자가 꼭 확인합니다, 「4.1」 5번) */
export interface CareLimitProposal {
  maxCareLevel: CareLevel
  maxHarshness: number
  reason: string
}

/** 기획서 기본값: 제재 최대 한도 3, 말투 수위 2 */
export const PLAN_DEFAULT_MAX_CARE_LEVEL: CareLevel = 3
export const PLAN_DEFAULT_HARSHNESS = 2

/**
 * 검사 결과로 제재 최대 한도 · 말투 수위를 미리 채웁니다 (「6.3」 마지막 두 줄).
 * - 한도: 실패 민감도 높음 → 2 / 관리 선호 높음 + 실패 민감도 보통 이하 → 4 / 그 밖 3
 * - 수위: 관리 선호 높음 → 3, 그런데 실패 민감도 높음이면 최대 2 / 그 밖 2
 *
 *   proposeCareLimits({})                                               -> { 3, 2 }
 *   proposeCareLimits({ failSensitivity: 'high' })                      -> { 2, 2 }
 *   proposeCareLimits({ carePreference: 'high' })                       -> { 4, 3 }
 *   proposeCareLimits({ carePreference: 'high', failSensitivity: 'high' }) -> { 2, 2 }
 */
export function proposeCareLimits(levels: ScaleLevels): CareLimitProposal {
  const failHigh = levels.failSensitivity === 'high'
  const careHigh = levels.carePreference === 'high'

  let maxCareLevel: CareLevel = PLAN_DEFAULT_MAX_CARE_LEVEL
  if (failHigh) maxCareLevel = 2
  else if (careHigh) maxCareLevel = 4

  let maxHarshness = careHigh ? 3 : PLAN_DEFAULT_HARSHNESS
  if (failHigh) maxHarshness = Math.min(maxHarshness, 2)

  const reason = failHigh
    ? '한 번 무너지면 오래가는 편이라 조금 부드럽게 시작할게요'
    : careHigh
      ? '따끔한 관리를 원한다고 해서 조금 세게 시작할게요'
      : '처음에는 보통 세기로 시작할게요'
  return { maxCareLevel, maxHarshness, reason }
}

// ── 저장 ──

// 저장소에 넣는 이름입니다. (실제 키는 'study-auto-settings')
export const AUTO_SETTINGS_KEY = 'auto-settings'
// 홈에 보여 줄 "AI 가 바꾼 설정" 기록. 사용자가 보고 닫으면 지웁니다.
export const SETTING_CHANGES_KEY = 'auto-setting-changes'

/** 저장된 설정을 불러옵니다. 없는 칸 · 모양이 틀린 칸은 기본값으로 채웁니다. */
export function loadAutoSettings(): StoredSettings {
  const saved = loadData<unknown>(AUTO_SETTINGS_KEY, null)
  const base = createDefaultSettings() as Record<AutoSettingKey, StoredSetting>
  if (typeof saved !== 'object' || saved === null) return base as StoredSettings
  for (const key of Object.keys(base) as AutoSettingKey[]) {
    const item = (saved as Record<string, unknown>)[key] as Partial<StoredSetting> | undefined
    if (item && typeof item === 'object' && typeof item.value === typeof base[key].value) {
      base[key] = {
        value: item.value as AutoSettingValues[AutoSettingKey],
        source: item.source ?? 'default',
        reason: typeof item.reason === 'string' ? item.reason : base[key].reason,
        locked: item.locked === true,
        // 되돌릴 값도 모양이 맞을 때만 씁니다.
        ...(typeof item.before === typeof base[key].value
          ? { before: item.before as AutoSettingValues[AutoSettingKey] }
          : {}),
      }
    }
  }
  return base as StoredSettings
}

/** 설정을 저장합니다. 바뀐 기록이 있으면 홈 알림 목록에도 붙입니다. */
export function saveAutoSettings(settings: StoredSettings, changes: SettingChange[] = []): void {
  saveData(AUTO_SETTINGS_KEY, settings)
  if (changes.length === 0) return
  const prev = loadData<unknown>(SETTING_CHANGES_KEY, [])
  const list = Array.isArray(prev) ? (prev as SettingChange[]) : []
  saveData(SETTING_CHANGES_KEY, [...list, ...changes])
}
