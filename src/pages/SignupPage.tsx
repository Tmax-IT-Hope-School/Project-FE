import { PlainLayout } from '@/components/layout/PlainLayout'
import { StickyActionBar } from '@/components/ui/StickyActionBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { SchoolField } from '@/components/ui/SchoolField'
import { SchoolTrackField } from '@/components/ui/SchoolTrackField'
import { TermsView } from '@/components/ui/TermsView'
import { useAuth } from '@/hooks/useAuth'
import { getGoogleAuthErrorMessage, signupWithGoogle } from '@/lib/authApi'
import { cn } from '@/lib/cn'
import { isServerDataToken } from '@/lib/dataMode'
import { clearPendingGoogleSignup, loadPendingGoogleSignup } from '@/lib/googleSignup'
import type { School } from '@/lib/schoolSearch'
import { saveSchoolTrack, type SchoolTrack } from '@/lib/schoolTrack'
import {
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  SIGNUP_STORAGE_KEY,
  canSubmitSignup,
  getEmailError,
  getMaxSignupStep,
  getNameError,
  getNicknameError,
  hasRequiredConsents,
  hasSignupInfo,
  isAllConsented,
  makeAllConsents,
  parseSignupStep,
  type SignupConsents,
  type SignupInfo,
} from '@/lib/signup'
import { ONBOARDING_INTRO_PATH } from '@/lib/onboardingProgress'
import { saveData } from '@/lib/storage'
import { diaryAnalysisConsent, privacyConsent, serviceTerms, type TermsDocument } from '@/lib/terms'
import { testUser } from '@/lib/testLogin'
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'

/*
 * ⚠️ 이 화면의 동의 문구("쓰는 곳" 안내)와 "보기" 로 여는 약관 전문(lib/terms.ts)은 초안입니다.
 *    동의 문구는 Tmax-IT-Hope-School/Project#8 검토 뒤에 확정되니, 그때 글자를 바꾸세요.
 *    (이름·이메일·학교를 받게 되면서 "무엇을 모으나요?" 의 내용이 바뀌었습니다. 이 부분도 같이 검토받아야 합니다)
 */

type ConsentKey = keyof SignupConsents

interface ConsentItem {
  key: ConsentKey
  label: string
  isRequired: boolean
  /** 라벨 아래 작은 설명 (없어도 됩니다) */
  description?: string
  /** "보기" 를 눌렀을 때 팝업에 보여줄 안내문 (lib/terms.ts) */
  terms: TermsDocument
}

// 동의 항목. 이 순서대로 보입니다.
const consentItems: ConsentItem[] = [
  {
    key: 'terms',
    label: '서비스 이용약관',
    isRequired: true,
    terms: serviceTerms,
  },
  {
    key: 'privacy',
    label: '개인정보 수집·이용',
    isRequired: true,
    terms: privacyConsent,
  },
  {
    key: 'diaryAnalysis',
    label: '일기·감정 기록을 분석에 쓰기',
    isRequired: false,
    description: '안 해도 앱을 쓸 수 있어요. 일기 원문은 나만 봐요.',
    terms: diaryAnalysisConsent,
  },
]

// "무엇을 모으나요?" 에 보이는 안내. (펼쳐 보는 상자)
const collectedItems = [
  '공부 기록 — 타이머 시간, 계획, 달성률',
  '매일 체크인 — 컨디션, 기분, 못 한 이유, 예상 공부 시간',
  '일기·감정 — 위에서 [선택]에 동의한 경우에만',
  '쓰는 곳 — 나에게 맞는 계획과 피드백, 리포트를 만드는 데 써요',
  '가입 정보 — 이름, 닉네임, 이메일, 학교(고른 경우에만)',
  '전화번호·주소는 받지 않아요',
  '설정 › 내 데이터에서 언제든 지울 수 있어요',
]

// 가입 화면의 입력칸 모양. 이 화면은 흰 카드 없이 회색 바탕에 칸을 바로 놓아서, Input 의 기본색(연회색)이면
// 칸이 바탕과 같은 색이 되어 안 보입니다. 시안(docs/design/screens/signup-mobile.png)처럼 흰 바탕 + 회색 테두리로 그립니다. (2026-10-25 QA)
const FIELD_CLASS = 'h-12 border border-slate-200 bg-white text-base'

// 가입의 세 단계입니다. 주소의 ?step=1 · 2 · 3 과 순서가 같습니다.
const signupSteps = [
  { label: '계정 정보', title: '반가워요! 계정 정보를 알려주세요', description: '' },
  {
    label: '학교',
    title: '다니는 고등학교를 알려주세요',
    description: '학교는 고르지 않아도 돼요. 고등학생인지는 꼭 확인해 주세요.',
  },
  {
    label: '약관 동의',
    title: '마지막이에요. 약관에 동의해 주세요',
    description: '[필수] 두 가지에 동의하면 가입할 수 있어요. "보기" 를 누르면 전문이 보여요.',
  },
]

interface SignupStepsProps {
  /** 지금 단계 (1 ~ 3) */
  current: number
}

/** "1 계정 정보 / 2 학교·나이 / 3 약관 동의" 처럼 지금 어느 단계인지 보여주는 막대입니다. */
function SignupSteps({ current }: SignupStepsProps) {
  return (
    <ol className="grid grid-cols-3 gap-1 text-[13px]">
      {signupSteps.map((step, index) => {
        const number = index + 1
        // done: 지나온 단계 / current: 지금 단계 / next: 아직 안 온 단계
        const state = number < current ? 'done' : number === current ? 'current' : 'next'
        return (
          <li
            key={step.label}
            // aria-current: 스크린리더에 "지금 단계" 라고 알려 줍니다.
            aria-current={state === 'current' ? 'step' : undefined}
            className="flex flex-col gap-2"
          >
            <span
              // 온보딩 단계 막대(OnboardingStepper)와 같은 굵기 · 색으로 맞춥니다.
              className={cn('h-1.5 rounded-full', state === 'next' ? 'bg-slate-200' : 'bg-brand')}
            />
            <span
              className={cn(
                'break-keep',
                state === 'current' && 'font-bold text-slate-900',
                state === 'done' && 'text-slate-700',
                state === 'next' && 'text-slate-500',
              )}
            >
              {number} {step.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * 가입 정보를 받는 화면입니다. 두 가지 경우에 옵니다. (이메일 가입은 2026-10-15 에 뺐습니다. 새 가입은 구글로만 받습니다)
 *   - 구글로 처음 온 사람(로그인 화면의 [Google로 시작하기], #319): 이름·이메일은 구글 값으로 채우고 비밀번호 없이 받습니다.
 *     마지막에 서버에 구글로 가입하면 바로 로그인돼서 온보딩으로 갑니다. (lib/googleSignup.ts)
 *   - 테스트 로그인을 한 채로 온 사람: 이미 로그인된 상태라 비밀번호 없이 가입 정보만 받습니다.
 *     (테스트 로그인은 가입을 건너뛰고 홈으로 가기 때문에, 이 주소를 직접 열었을 때만 여기에 옵니다)
 *   둘 다 아니면(로그인도 안 했고 구글로 시작하지도 않음) 로그인 화면으로 돌려보냅니다.
 *
 * 세 단계로 나눠서 받고, 지금 단계는 주소에 보입니다. (/signup?step=1 계정 정보 → 2 학교 → 3 약관 동의)
 * 주소에 두었기 때문에 뒤로 가기를 누르면 앞 단계로 돌아갑니다. 앞 단계를 안 채우고 뒤 단계의 주소를 열면 앞 단계로 돌려보냅니다.
 * 입력한 값은 이 화면이 들고 있어서, 새로고침하면 사라지고 1단계부터 다시 시작합니다.
 *  1) 이름·닉네임·이메일  2) 고등학교(선택) · 고등학생(만 14세 이상)인지 확인  3) 개인정보 수집·이용 동의
 * 다 마치면 정보를 저장하고 온보딩(/onboarding)으로 갑니다.
 *
 * 이 앱은 고등학생만 씁니다. 고등학생이면 만 14세 이상이라, 만 14세 확인은 "고등학생이에요" 체크 하나로 받습니다. (2026-10-17)
 * 학년·목표 시험 등은 온보딩에서 받습니다.
 */
export function SignupPage() {
  const navigate = useNavigate()
  // useSearchParams: 주소의 ?step=2 같은 값을 읽고 바꿉니다.
  const [searchParams, setSearchParams] = useSearchParams()
  const { user, token, isLoggedIn, login, logout } = useAuth()
  // 구글로 처음 온 사람이면 구글이 준 정보(신분증·이름·이메일). 아니면 null (lib/googleSignup.ts)
  // 아래 값들은 화면이 처음 그려질 때 한 번만 정합니다. 가입하는 도중에 로그인 상태가 바뀌어도 화면이 달라지지 않게 하려는 것입니다.
  const [googleSignup] = useState(() => (isLoggedIn ? null : loadPendingGoogleSignup()))
  // 로그인했고 가입도 이미 마친 사람인지. (주소창에 /signup 을 직접 친 경우)
  // 처음 한 번만 정하는 이유: 가입을 막 마친 순간에도 가입 정보가 생기는데, 그때 홈으로 튕기면 안 되기 때문입니다.
  // 서버가 준 진짜 토큰이 있으면 이 기기에 가입 정보가 없어도 이미 가입한 사람입니다. (서버는 가입을 마친 사람에게만 토큰을 줍니다)
  const [isAlreadySignedUp] = useState(
    () => isLoggedIn && (hasSignupInfo() || isServerDataToken(token)),
  )
  const [name, setName] = useState(googleSignup?.name ?? '')
  const [nickname, setNickname] = useState('')
  const [email, setEmail] = useState(googleSignup?.email ?? '')
  // 고른 고등학교. 안 골라도 가입할 수 있어서 null 로 시작합니다.
  const [school, setSchool] = useState<School | null>(null)
  // 고른 학교의 학과(특성화고 · 마이스터고) 또는 계열(그 밖의 학교). 선택이라 null 로 시작합니다. (lib/schoolTrack.ts)
  const [schoolTrack, setSchoolTrack] = useState<SchoolTrack | null>(null)
  // 학교를 바꾸면 예전 학교에서 고른 학과 · 계열은 쓰지 않습니다.
  const currentTrack =
    school !== null && schoolTrack?.schoolCode === school.code ? schoolTrack : null
  // 칸을 한 번이라도 건드렸는지. 처음 열었을 때부터 빨간 글씨를 보여주지 않으려고 씁니다.
  const [isNameTouched, setIsNameTouched] = useState(false)
  const [isNicknameTouched, setIsNicknameTouched] = useState(false)
  const [isEmailTouched, setIsEmailTouched] = useState(false)
  // 서버에 가입을 보내고 답을 기다리는 중인지, 실패했을 때 보여줄 안내
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // "고등학생이에요 (만 14세 이상)" 에 체크했는지. 서버에는 만 14세 확인(over14)으로 보냅니다.
  const [isOver14, setIsOver14] = useState(false)
  // 2단계에서 체크하지 않고 "다음" 을 눌렀는지. 눌렀을 때만 빨간 안내를 보여줍니다.
  const [isAgeMissing, setIsAgeMissing] = useState(false)
  const [consents, setConsents] = useState<SignupConsents>(makeAllConsents(false))
  // "보기" 로 열어 둔 동의 항목. 아무것도 안 열었으면 null
  const [openedKey, setOpenedKey] = useState<ConsentKey | null>(null)

  // 로그인도 안 했고 구글로 시작하지도 않았으면 가입할 방법이 없습니다. 로그인 화면에서 [Google로 시작하기] 를 누르게 합니다.
  // (이 탭의 구글 정보가 지워졌을 때도 여기로 옵니다. 예: 탭을 닫았다 다시 열기)
  if (!isLoggedIn && googleSignup === null) return <Navigate to="/login" replace />

  // 이미 가입한 사람은 다시 가입할 수 없습니다. 그대로 두면 닉네임·동의 기록(agreedAt 포함)을 새 값으로 덮어써 버립니다.
  // 홈으로 보내면, 온보딩을 다 안 끝낸 사람은 문지기(RequireAuth)가 하던 단계로 다시 보내 줍니다.
  // 내 정보를 바꾸는 곳은 설정 → 내 계정(/settings/account) 입니다.
  if (isAlreadySignedUp) return <Navigate to="/" replace />

  // 테스트 로그인으로 들어온 사람인지. (lib/testLogin.ts)
  const isTestUser = user?.id === testUser.id
  const nameError = isNameTouched ? getNameError(name) : null
  const nicknameError = isNicknameTouched ? getNicknameError(nickname) : null
  const emailError = isEmailTouched ? getEmailError(email) : null
  const canSubmit = canSubmitSignup({ name, nickname, email, isOver14, consents })
  const openedItem = consentItems.find((item) => item.key === openedKey)

  // 단계마다 다 채웠는지
  const isAccountReady =
    getNameError(name) === null &&
    getNicknameError(nickname) === null &&
    getEmailError(email) === null
  const isAgeReady = isOver14

  // 주소가 가리키는 단계와, 지금 입력으로 갈 수 있는 가장 먼 단계 (lib/signup.ts)
  const requestedStep = parseSignupStep(searchParams.get('step'))
  const maxStep = getMaxSignupStep(isAccountReady, isAgeReady)
  // 앞 단계를 안 채우고 뒤 단계의 주소를 열었으면(주소를 직접 고쳤거나 새로고침한 경우) 채울 단계로 돌려보냅니다.
  // replace: 못 가는 주소를 기록에 남기지 않습니다.
  if (requestedStep > maxStep) return <Navigate to={`/signup?step=${maxStep}`} replace />
  const step = requestedStep

  /** 주소의 단계를 바꿉니다. 기록에 남아서 뒤로 가기로 돌아올 수 있습니다. */
  function goToStep(nextStep: number) {
    setSearchParams({ step: String(nextStep) })
    // 새 단계는 맨 위부터 보이게 합니다.
    window.scrollTo(0, 0)
  }

  /** "다음" 을 눌렀을 때. 지금 단계를 다 채웠으면 다음 단계로, 아니면 빠진 것을 알려 줍니다. */
  function handleNext() {
    if (step === 1) {
      if (!isAccountReady) {
        // 빈 칸·틀린 칸에 빨간 안내가 뜨도록 전부 "건드린 것" 으로 표시합니다.
        setIsNameTouched(true)
        setIsNicknameTouched(true)
        setIsEmailTouched(true)
        return
      }
      goToStep(2)
      return
    }
    if (!isAgeReady) {
      setIsAgeMissing(true)
      return
    }
    goToStep(3)
  }

  /** 구글로 온 사람이 "다른 방법으로 시작하기" 를 눌렀을 때. 잠깐 들고 있던 구글 정보를 지우고 로그인 화면으로 갑니다. */
  function handleLeaveGoogleSignup() {
    clearPendingGoogleSignup()
    navigate('/login', { replace: true })
  }

  /** 로그인한 채로 이 화면에 온 사람이 "로그아웃" 을 눌렀을 때 */
  function handleLogout() {
    // 로그인 화면으로 먼저 옮긴 뒤 로그인 정보를 지웁니다. (설정 화면의 로그아웃과 같은 순서)
    navigate('/login', { replace: true })
    logout()
  }

  function handleChangeConsent(key: ConsentKey, isChecked: boolean) {
    setConsents((prev) => ({ ...prev, [key]: isChecked }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // form 이 기본으로 하는 "페이지 새로고침" 을 막습니다.
    event.preventDefault()
    // 1 · 2단계에서는 제출(Enter 포함)이 "다음" 입니다. 마지막 단계에서만 가입합니다.
    if (step < 3) {
      handleNext()
      return
    }
    if (!canSubmit || isSubmitting) return

    // 이 기기에 저장해 두는 가입 정보입니다. 비밀번호는 넣지 않습니다.
    const info: SignupInfo = {
      name: name.trim(),
      nickname: nickname.trim(),
      email: email.trim(),
      school,
      consents,
      agreedAt: Date.now(),
    }

    // 구글 가입: 서버에 계정을 만들면 바로 로그인 정보를 받습니다. (lib/authApi.ts)
    if (googleSignup !== null) {
      setIsSubmitting(true)
      setSubmitError(null)
      try {
        const result = await signupWithGoogle({
          credential: googleSignup.credential,
          name: info.name,
          nickname: info.nickname,
          school,
          consents,
          isOver14,
        })
        // 다 썼으니 구글 신분증을 지우고, 가입 정보를 저장한 뒤 로그인합니다. (가입 정보가 있어야 가입 화면으로 다시 오지 않습니다)
        clearPendingGoogleSignup()
        saveData(SIGNUP_STORAGE_KEY, info)
        saveSchoolTrack(currentTrack)
        login(result.user, result.token)
        // 가입하면 온보딩의 맨 처음(앱 소개)으로 갑니다.
        // replace: 뒤로 가기로 가입 화면에 돌아오지 않게 합니다.
        navigate(ONBOARDING_INTRO_PATH, { replace: true })
      } catch (error) {
        setSubmitError(getGoogleAuthErrorMessage(error))
        setIsSubmitting(false)
      }
      return
    }

    // 테스트 로그인으로 이미 로그인한 사람은 바로 온보딩으로 갑니다. (맨 처음은 앱 소개)
    saveData(SIGNUP_STORAGE_KEY, info)
    saveSchoolTrack(currentTrack)
    navigate(ONBOARDING_INTRO_PATH)
  }

  return (
    <PlainLayout>
      <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <SignupSteps current={step} />

        <div>
          <h1 className="text-[28px] leading-tight font-bold tracking-tight break-keep">
            {signupSteps[step - 1].title}
          </h1>
          {step !== 1 ? (
            <p className="mt-2 max-w-prose text-[15px] break-keep text-slate-600">
              {signupSteps[step - 1].description}
            </p>
          ) : googleSignup !== null ? (
            <p className="mt-2 text-[15px] break-keep text-slate-600">
              구글 계정으로 가입해요.{' '}
              {/* type="button": form 안의 버튼이라, 적지 않으면 눌렀을 때 가입 제출이 돼 버립니다. */}
              <button
                type="button"
                onClick={handleLeaveGoogleSignup}
                className="text-brand inline-flex h-10 items-center font-medium underline underline-offset-4"
              >
                다른 방법으로 시작하기
              </button>
            </p>
          ) : (
            // 로그인한 채로 온 사람에게는 지금 로그인 상태라는 것과 나가는 길(로그아웃)을 같이 보여줍니다.
            // 안 그러면 "로그인도 안 했는데 왜 가입 화면이지?" 하고 헷갈립니다. (예전 테스트 로그인이 남아 있는 경우)
            <p className="mt-2 text-[15px] break-keep text-slate-600">
              {isTestUser
                ? '테스트 계정으로 로그인했어요. 적은 정보는 이 브라우저에만 저장돼요.'
                : '이미 로그인한 상태예요.'}{' '}
              {/* type="button": form 안의 버튼이라, 적지 않으면 눌렀을 때 가입 제출이 돼 버립니다. */}
              <button
                type="button"
                onClick={handleLogout}
                className="text-brand inline-flex h-10 items-center font-medium underline underline-offset-4"
              >
                로그아웃
              </button>
            </p>
          )}
        </div>

        {/* ---------- 1단계: 계정 정보 ---------- */}
        {step === 1 && (
          <>
            <div className="flex flex-col gap-2">
              <Input
                id="name"
                label="이름"
                value={name}
                maxLength={NAME_MAX_LENGTH}
                placeholder="예) 티맥스"
                // autoComplete: 브라우저가 저장해 둔 내 이름을 추천해 줍니다.
                autoComplete="name"
                error={nameError ?? undefined}
                onChange={(event) => setName(event.target.value)}
                // 다 적고 칸을 떠났을 때부터 검사합니다. (적는 중에 빨간 글씨가 뜨지 않게)
                onBlur={() => setIsNameTouched(true)}
                className={FIELD_CLASS}
              />
              <p className="text-[13px] text-slate-500">
                실제 이름을 적어 주세요. ({NAME_MIN_LENGTH}~{NAME_MAX_LENGTH}자) 이 기기에만 남고
                서버에는 저장하지 않아요.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Input
                id="nickname"
                label="닉네임"
                value={nickname}
                maxLength={NICKNAME_MAX_LENGTH}
                placeholder="예) 김티맥"
                autoComplete="nickname"
                error={nicknameError ?? undefined}
                onChange={(event) => {
                  setNickname(event.target.value)
                  setIsNicknameTouched(true)
                }}
                onBlur={() => setIsNicknameTouched(true)}
                className={FIELD_CLASS}
              />
              <p className="text-[13px] text-slate-500">
                앱에서 부르는 이름이에요. ({NICKNAME_MIN_LENGTH}~{NICKNAME_MAX_LENGTH}자)
              </p>
            </div>

            <Input
              id="email"
              // type="email": 휴대폰에서 @ 가 있는 키보드가 뜹니다.
              type="email"
              label="이메일"
              value={email}
              maxLength={EMAIL_MAX_LENGTH}
              placeholder="예) tmax@starflow.com"
              autoComplete="email"
              error={emailError ?? undefined}
              // 구글로 온 사람의 이메일은 구글이 확인한 값이라 고칠 수 없습니다. (서버도 구글 값을 씁니다)
              readOnly={googleSignup !== null}
              onChange={(event) => setEmail(event.target.value)}
              onBlur={() => setIsEmailTouched(true)}
              // 고칠 수 없는 칸은 테두리를 빼고 회색으로 낮춰서, 적는 칸(흰색)과 다르게 보이게 합니다.
              className={cn(
                FIELD_CLASS,
                googleSignup !== null &&
                  'border-transparent bg-slate-200 text-slate-500 focus:bg-slate-200',
              )}
            />
          </>
        )}

        {/* ---------- 2단계: 학교 ---------- */}
        {step === 2 && (
          <>
            <SchoolField school={school} onChange={setSchool} inputClassName={FIELD_CLASS} />
            {/* 학교를 고르면 학교 종류에 따라 학과(특성화고 · 마이스터고) 또는 계열을 묻습니다. 선택입니다. */}
            {school !== null && (
              <SchoolTrackField
                schoolCode={school.code}
                value={currentTrack}
                onChange={setSchoolTrack}
                inputClassName={FIELD_CLASS}
              />
            )}

            <div className="flex flex-col gap-2">
              <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-4 py-2 font-medium">
                <input
                  type="checkbox"
                  checked={isOver14}
                  onChange={(event) => {
                    setIsOver14(event.target.checked)
                    setIsAgeMissing(false)
                  }}
                  className="accent-brand h-5 w-5 shrink-0"
                />
                <span className="break-keep">
                  <span className="font-semibold text-slate-900">[필수]</span> 고등학생이에요 (만
                  14세 이상)
                </span>
              </label>
              <p className="text-sm break-keep text-slate-500">만 14세 미만은 가입할 수 없어요.</p>
              {/* 체크하지 않고 "다음" 을 눌렀을 때만 보입니다. */}
              {isAgeMissing && (
                <p role="alert" className="text-sm break-keep text-red-600">
                  고등학생만 가입할 수 있어요. 고등학생이면 체크해 주세요.
                </p>
              )}
            </div>
          </>
        )}

        {/* ---------- 3단계: 약관 동의 ---------- */}
        {step === 3 && (
          <>
            <fieldset className="overflow-hidden rounded-xl border border-slate-200">
              <legend className="sr-only">약관 동의</legend>

              <label className="flex min-h-14 cursor-pointer items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 font-semibold">
                <input
                  type="checkbox"
                  checked={isAllConsented(consents)}
                  onChange={(event) => setConsents(makeAllConsents(event.target.checked))}
                  className="accent-brand h-5 w-5 shrink-0"
                />
                전체 동의
              </label>

              <ul className="divide-y divide-slate-100">
                {consentItems.map((item) => (
                  <li key={item.key} className="flex items-start justify-between gap-3 px-4 py-3">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={consents[item.key]}
                        onChange={(event) => handleChangeConsent(item.key, event.target.checked)}
                        className="accent-brand mt-0.5 h-5 w-5 shrink-0"
                      />
                      <span className="min-w-0 break-keep">
                        <span
                          className={cn(
                            'font-semibold',
                            item.isRequired ? 'text-slate-900' : 'text-slate-500',
                          )}
                        >
                          {item.isRequired ? '[필수]' : '[선택]'}
                        </span>{' '}
                        {item.label}
                        {item.description && (
                          <span className="mt-1 block text-[13px] text-slate-500">
                            {item.description}
                          </span>
                        )}
                      </span>
                    </label>
                    {/* h-10 = 40px. 글자는 작아도 누르는 영역은 손가락으로 누를 만하게 합니다. */}
                    <button
                      type="button"
                      onClick={() => setOpenedKey(item.key)}
                      aria-label={`${item.label} 보기`}
                      className="text-brand h-10 shrink-0 cursor-pointer rounded-xl px-3 text-[13px] font-semibold hover:bg-slate-100"
                    >
                      보기
                    </button>
                  </li>
                ))}
              </ul>
            </fieldset>

            {/* details/summary: 따로 코드를 쓰지 않아도 눌러서 접고 펼 수 있는 HTML 기본 부품입니다. 처음에는 접혀 있습니다. */}
            <details className="group rounded-xl bg-slate-50 p-4">
              <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between font-semibold [&::-webkit-details-marker]:hidden">
                무엇을 모으나요?
                {/* group-open: 펼쳐졌을 때만 화살표를 뒤집습니다. */}
                <span
                  aria-hidden
                  className="text-slate-500 transition-transform group-open:rotate-180"
                >
                  ▾
                </span>
              </summary>
              <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm break-keep text-slate-700 sm:text-base">
                {collectedItems.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </details>
          </>
        )}

        {/* 1순위 [다음] · [가입하기] 는 화면 아래 엄지 자리에 붙여 둡니다. (피츠의 법칙) */}
        <StickyActionBar>
          {/* 서버가 가입을 거절했거나 연결하지 못했을 때의 안내 (구글 가입) */}
          {submitError !== null && (
            <p role="alert" className="text-center text-sm break-keep text-red-600">
              {submitError}
            </p>
          )}
          {/* 구글 확인은 한 시간이면 끝나서, 실패하면 로그인 화면에서 다시 시작하는 길을 같이 보여줍니다. */}
          {submitError !== null && googleSignup !== null && (
            <button
              type="button"
              onClick={handleLeaveGoogleSignup}
              className="text-brand inline-flex h-10 items-center justify-center text-sm font-medium underline underline-offset-4"
            >
              로그인 화면에서 다시 Google로 시작하기
            </button>
          )}
          <div className="flex gap-2">
            {/* 2 · 3단계에는 앞 단계로 돌아가는 버튼이 있습니다. (브라우저의 뒤로 가기와 같은 곳으로 갑니다) */}
            {step > 1 && (
              <Button
                variant="ghost"
                size="lg"
                className="shrink-0"
                onClick={() => goToStep(step - 1)}
              >
                이전
              </Button>
            )}
            {step < 3 ? (
              // type="submit": 누르거나 입력 칸에서 Enter 를 치면 handleSubmit 이 "다음" 으로 처리합니다.
              <Button type="submit" size="lg" className="min-w-0 flex-1">
                다음
              </Button>
            ) : (
              // 필수 동의 둘을 체크해야 눌립니다.
              <Button
                type="submit"
                size="lg"
                className="min-w-0 flex-1"
                disabled={!canSubmit || isSubmitting}
              >
                {isSubmitting
                  ? '가입하는 중…'
                  : googleSignup !== null
                    ? '가입하기'
                    : '다음 · 온보딩 시작'}
              </Button>
            )}
          </div>
          {step === 3 && !hasRequiredConsents(consents) && (
            <p className="text-center text-[13px] break-keep text-slate-500">
              [필수] 두 가지에 동의하면 눌러져요.
            </p>
          )}
        </StickyActionBar>
      </form>

      <Modal
        isOpen={openedItem !== undefined}
        onClose={() => setOpenedKey(null)}
        title={openedItem?.label}
      >
        {openedItem && <TermsView terms={openedItem.terms} />}
        <Button className="mt-5 w-full" onClick={() => setOpenedKey(null)}>
          닫기
        </Button>
      </Modal>
    </PlainLayout>
  )
}
