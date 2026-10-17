/**
 * 가입 정보 입력 규칙과 저장하는 모양입니다. (화면은 pages/SignupPage.tsx)
 * React 없이 돌아가는 계산만 모아 두어서, 화면 없이도 규칙이 맞는지 확인할 수 있습니다.
 */
import type { School } from '@/lib/schoolSearch'
import { loadData, saveData } from '@/lib/storage'

// 저장소에 넣는 이름입니다. (실제 키는 storage.ts 가 앞에 'study-' 를 붙여서 'study-signup-info' 가 됩니다)
export const SIGNUP_STORAGE_KEY = 'signup-info'

export const NAME_MIN_LENGTH = 2
export const NAME_MAX_LENGTH = 20

export const NICKNAME_MIN_LENGTH = 2
export const NICKNAME_MAX_LENGTH = 10

export const EMAIL_MAX_LENGTH = 100

// 서버 로그인으로 들어온 기존 회원은 이 기기에 가입 정보가 없을 수 있습니다.
// 그때 "가입은 이미 마쳤다" 고 적어 두는 표시의 저장 이름입니다. (값은 true)
const SIGNUP_DONE_KEY = 'signup-done'

/**
 * 화면에 보여 주는 동의 문구의 버전입니다. 가입할 때 서버에 함께 보내고, 서버가 지금 받는 버전(BE 의 ConsentPolicy.CURRENT_VERSION)과 다르면 409 입니다.
 * 동의 문구(약관 · 개인정보 안내)를 고치면 BE 와 같이 올려야 합니다. (BE docs/API.md "개인정보 동의")
 */
export const CONSENT_VERSION = 'v1'

/** 동의 항목 세 가지. true 면 동의했다는 뜻입니다. */
export interface SignupConsents {
  /** [필수] 서비스 이용약관 */
  terms: boolean
  /** [필수] 개인정보 수집·이용 */
  privacy: boolean
  /** [선택] 일기·감정 기록을 분석에 쓰기. 동의하지 않아도 앱은 쓸 수 있습니다. */
  diaryAnalysis: boolean
}

/** 가입을 마치고 저장해 두는 정보입니다. (만 14세 미만은 가입할 수 없어서 아무것도 저장하지 않습니다) */
export interface SignupInfo {
  /** 이름 (실명) */
  name: string
  /** 앱에서 부르는 이름 */
  nickname: string
  email: string
  /** 다니는 고등학교. 고르지 않았으면 null 입니다. (졸업했거나 목록에 없는 경우) */
  school: School | null
  consents: SignupConsents
  /** 동의한 시각 (Date.now() 값) */
  agreedAt: number
}

/**
 * 가입을 마친 사람인지 알려줍니다. 로그인한 뒤 가입 화면으로 보낼지 홈으로 보낼지 정할 때 씁니다.
 *   - 이 기기에서 가입 화면을 끝까지 마쳤거나 (가입 정보가 저장돼 있음)
 *   - 서버가 "이미 가입한 회원" 이라고 알려 준 적이 있으면 (markSignupDone) true 입니다.
 */
export function hasSignupInfo(): boolean {
  return (
    loadData<unknown>(SIGNUP_STORAGE_KEY, null) !== null ||
    loadData<unknown>(SIGNUP_DONE_KEY, false) === true
  )
}

/** 설정의 계정 카드에 보여주는 내 정보입니다. 없는 칸은 빈 글자('')입니다. */
export interface SignupProfile {
  nickname: string
  email: string
  /** 고른 학교 이름. 안 골랐으면 빈 글자 */
  schoolName: string
}

/**
 * 이 기기에 저장해 둔 가입 정보에서 화면에 보여줄 것만 꺼냅니다. 가입 정보가 없으면 null 입니다.
 * 저장소의 값은 모양이 다를 수 있어서(예전에 가입해 이메일이 없는 경우 등) 하나씩 확인하고, 없는 칸은 빈 글자로 둡니다.
 *
 *   loadSignupProfile() -> { nickname: '하늘', email: 'sky@example.com', schoolName: '한국디지털미디어고등학교' }
 */
export function loadSignupProfile(): SignupProfile | null {
  const saved = loadData<unknown>(SIGNUP_STORAGE_KEY, null)
  if (typeof saved !== 'object' || saved === null) return null
  const info = saved as Record<string, unknown>
  const school = info.school as Record<string, unknown> | null | undefined

  return {
    nickname: typeof info.nickname === 'string' ? info.nickname : '',
    email: typeof info.email === 'string' ? info.email : '',
    schoolName: typeof school?.name === 'string' ? school.name : '',
  }
}

/**
 * 내 계정 화면에서 고친 정보를 이 기기에 저장해 둔 가입 정보에도 반영합니다. (설정의 계정 카드가 이 값을 보여줍니다)
 * 이 기기에 가입 정보가 없으면(다른 기기에서 가입한 사람) 아무 일도 하지 않습니다.
 *
 *   updateSavedSignupProfile({ name: '김하늘', nickname: '하늘이', school: null })
 */
export function updateSavedSignupProfile(changes: {
  name: string
  nickname: string
  school: School | null
}): void {
  const saved = loadData<unknown>(SIGNUP_STORAGE_KEY, null)
  if (typeof saved !== 'object' || saved === null) return
  // 동의 내역·동의한 시각 같은 나머지 값은 그대로 두고, 고친 세 가지만 바꿉니다.
  saveData(SIGNUP_STORAGE_KEY, { ...saved, ...changes })
}

/**
 * "이 사람은 이미 가입을 마쳤다" 고 적어 둡니다. 서버 로그인에 성공한 기존 회원에게 씁니다.
 * (다른 기기에서 가입한 사람이 이 기기에서 로그인했을 때, 가입 화면을 다시 거치지 않게 하려는 것입니다)
 */
export function markSignupDone(): void {
  saveData(SIGNUP_DONE_KEY, true)
}

/**
 * 이름이 규칙에 맞는지 확인합니다. 맞으면 null, 틀리면 화면에 보여줄 안내 문구입니다.
 * 앞뒤 공백은 빼고 셉니다.
 *
 *   getNameError('')       -> '이름을 입력해 주세요.'
 *   getNameError('김')     -> '이름은 2자 이상으로 적어 주세요.'
 *   getNameError('김하늘') -> null
 */
export function getNameError(name: string): string | null {
  const length = name.trim().length

  if (length === 0) return '이름을 입력해 주세요.'
  if (length < NAME_MIN_LENGTH) return `이름은 ${NAME_MIN_LENGTH}자 이상으로 적어 주세요.`
  if (length > NAME_MAX_LENGTH) return `이름은 ${NAME_MAX_LENGTH}자 이하로 적어 주세요.`
  return null
}

// 이메일 모양: "공백·@ 가 아닌 글자들" + @ + "글자들" + . + "글자들"
// 진짜 있는 주소인지까지는 알 수 없고, 오타(@ 빠짐, 점 빠짐)를 걸러내는 정도입니다.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * 이메일이 규칙에 맞는지 확인합니다. 맞으면 null, 틀리면 화면에 보여줄 안내 문구입니다.
 *
 *   getEmailError('')                  -> '이메일을 입력해 주세요.'
 *   getEmailError('tmax')              -> '이메일 주소를 다시 확인해 주세요. (예: tmax@starflow.com)'
 *   getEmailError('tmax@starflow')     -> '이메일 주소를 다시 확인해 주세요. (예: tmax@starflow.com)'
 *   getEmailError('tmax@starflow.com') -> null
 */
export function getEmailError(email: string): string | null {
  const trimmed = email.trim()

  if (trimmed === '') return '이메일을 입력해 주세요.'
  if (trimmed.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(trimmed)) {
    return '이메일 주소를 다시 확인해 주세요. (예: tmax@starflow.com)'
  }
  return null
}

/**
 * 닉네임이 규칙에 맞는지 확인합니다.
 * 맞으면 null, 틀리면 화면에 보여줄 안내 문구를 돌려줍니다.
 * 앞뒤 공백은 빼고 셉니다.
 *
 *   getNicknameError('')              -> '닉네임을 입력해 주세요.'
 *   getNicknameError('   ')           -> '닉네임을 입력해 주세요.'  (공백만 있어도 빈 것)
 *   getNicknameError('가')            -> '닉네임은 2자 이상으로 적어 주세요.'
 *   getNicknameError('공부하는 고양이') -> null
 */
export function getNicknameError(nickname: string): string | null {
  const length = nickname.trim().length

  if (length === 0) return '닉네임을 입력해 주세요.'
  if (length < NICKNAME_MIN_LENGTH) {
    return `닉네임은 ${NICKNAME_MIN_LENGTH}자 이상으로 적어 주세요.`
  }
  if (length > NICKNAME_MAX_LENGTH) {
    return `닉네임은 ${NICKNAME_MAX_LENGTH}자 이하로 적어 주세요.`
  }
  return null
}

/** 필수 동의(서비스 이용약관, 개인정보 수집·이용)를 둘 다 했는지 알려줍니다. 선택 동의는 보지 않습니다. */
export function hasRequiredConsents(consents: SignupConsents): boolean {
  return consents.terms && consents.privacy
}

/** 동의 세 가지를 모두 했는지 알려줍니다. ("전체 동의" 체크 모양을 정할 때 씁니다) */
export function isAllConsented(consents: SignupConsents): boolean {
  return consents.terms && consents.privacy && consents.diaryAnalysis
}

/** "전체 동의" 를 눌렀을 때의 값입니다. 체크하면 셋 다 true, 해제하면 셋 다 false 입니다. */
export function makeAllConsents(isChecked: boolean): SignupConsents {
  return { terms: isChecked, privacy: isChecked, diaryAnalysis: isChecked }
}

/** 가입 화면의 단계 수. 1 계정 정보 → 2 학교·나이 → 3 약관 동의 */
export const SIGNUP_STEP_COUNT = 3

/**
 * 주소의 ?step= 값을 단계 번호(1 ~ 3)로 바꿉니다. 없거나 이상한 값이면 1 입니다.
 *
 *   parseSignupStep(null)  -> 1   (/signup 처럼 step 이 없을 때)
 *   parseSignupStep('2')   -> 2
 *   parseSignupStep('9')   -> 1
 *   parseSignupStep('abc') -> 1
 */
export function parseSignupStep(value: string | null): number {
  const step = Number(value)
  return Number.isInteger(step) && step >= 1 && step <= SIGNUP_STEP_COUNT ? step : 1
}

/**
 * 지금 입력으로 갈 수 있는 가장 먼 단계를 알려줍니다. 앞 단계를 다 채워야 다음 단계를 열 수 있습니다.
 * 주소를 직접 고쳐서 ?step=3 으로 들어오거나, 새로고침으로 입력이 사라졌을 때 앞 단계로 돌려보내는 데 씁니다.
 *
 *   getMaxSignupStep(false, false) -> 1   (계정 정보를 아직 못 채움)
 *   getMaxSignupStep(true, false)  -> 2   (계정 정보는 채웠고, 만 14세 확인은 아직)
 *   getMaxSignupStep(true, true)   -> 3
 */
export function getMaxSignupStep(isAccountReady: boolean, isAgeReady: boolean): number {
  if (!isAccountReady) return 1
  if (!isAgeReady) return 2
  return SIGNUP_STEP_COUNT
}

/** 가입 화면에 지금 입력해 둔 값입니다. (학교는 안 골라도 되어서 여기에 없습니다) */
export interface SignupForm {
  name: string
  nickname: string
  email: string
  /** 만 14세 이상인지. 아직 안 골랐으면 null, 네 = true, 아니요 = false */
  isOver14: boolean | null
  consents: SignupConsents
}

/**
 * "다음 · 온보딩 시작" 을 누를 수 있는 상태인지 알려줍니다.
 * 세 가지가 모두 맞아야 합니다.
 *  1) 이름·닉네임·이메일이 규칙에 맞는다
 *  2) 만 14세 이상이라고 답했다 (아직 안 골랐으면 null, 아니라고 했으면 false 라서 안 됩니다)
 *  3) 필수 동의 둘을 모두 체크했다
 */
export function canSubmitSignup(form: SignupForm): boolean {
  return (
    getNameError(form.name) === null &&
    getNicknameError(form.nickname) === null &&
    getEmailError(form.email) === null &&
    form.isOver14 === true &&
    hasRequiredConsents(form.consents)
  )
}
