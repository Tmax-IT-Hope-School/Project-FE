import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { Button } from '@/components/ui/Button'
import { CareLevelPicker, HarshnessPicker } from '@/components/ui/CareLimitPickers'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { MessageSettingsFields } from '@/components/ui/MessageSettingsFields'
import { Modal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'
import { VoicePledgePlayButton } from '@/components/ui/VoicePledgePlayButton'
import { useAuth } from '@/hooks/useAuth'
import { useCalendarConnect } from '@/hooks/useCalendarConnect'
import { logoutOnServer } from '@/lib/accountApi'
import { getApiErrorMessage } from '@/lib/api'
import { canSyncCheckIns, deleteServerCheckIns } from '@/lib/checkInsApi'
import {
  CALL_TIME_STORAGE_KEY,
  isCallTimeInQuietHours,
  isIosWithoutInstall,
  parseCallTime,
} from '@/lib/callReminder'
import { cn } from '@/lib/cn'
import { getTodayKey } from '@/lib/date'
import type { CareLevel } from '@/lib/careLevel'
import { careLevelInfos } from '@/lib/careLevelInfo'
import { helpLines, SUPPORT_PATH } from '@/lib/helpLines'
import { loadInitialPlan } from '@/lib/initialPlan'
import { getUnansweredSteps, loadOnboardingAnswers } from '@/lib/onboardingSteps'
import { parseSubjectLevels } from '@/lib/subjectLevel'
import { PHONE_FOCUS_PATH } from '@/lib/phoneFocus'
import {
  getCareLimits,
  setAllowFocusMode,
  setAllowOffHoursCall,
  setMaxCareLevel,
  setMaxHarshness,
} from '@/lib/careLimits'
import {
  getMessageSettings,
  saveMessageSettings,
  type MessageSettings,
} from '@/lib/messageSettings'
import { deleteMyData, type DeleteKind } from '@/lib/myData'
import { showIosInstallGuideAgain } from '@/lib/pwa'
import {
  getNotificationPermission,
  isNotificationSupported,
  requestNotificationPermission,
  showSystemNotification,
  toQuietHours,
} from '@/lib/notifications'
import {
  WebPushError,
  getWebPushStatus,
  turnOffWebPush,
  turnOnWebPush,
  type WebPushStatus,
} from '@/lib/webPush'
import { busyTimesQuery, type CalendarStatus } from '@/lib/googleCalendar'
import { loadSignupProfile } from '@/lib/signup'
import {
  AUTO_SETTING_ROWS,
  SOURCE_LABELS,
  getOptionLabel,
  type AutoSettingRow,
} from '@/lib/autoSettingOptions'
import {
  canRevert,
  loadAutoSettings,
  revertSetting,
  saveAutoSettings,
  setByUser,
  type AutoSettingKey,
  type AutoSettingValues,
  type StoredSetting,
} from '@/lib/settingsMapping'
import { loadData, removeData, saveData } from '@/lib/storage'
import { testUser } from '@/lib/testLogin'
import { loadVoicePledge, removeVoicePledge } from '@/lib/voicePledge'

// 일기 기능을 켰는지 끄는 설정입니다. 기록이 아니라 설정값이라 "모든 기록 지우기" 로는 안 지워집니다.
const DIARY_ENABLED_KEY = 'diary-enabled'

/* 지우기 종류별 안내 문구. 새 종류가 생기면 여기에 한 줄만 더하면 됩니다. */
const deleteTexts: Record<DeleteKind, { question: string; detail: string; done: string }> = {
  diary: {
    question: '일기를 모두 지울까요?',
    detail: '쓴 일기가 전부 사라져요.',
    done: '일기를 모두 지웠어요.',
  },
  all: {
    question: '모든 기록을 지울까요?',
    detail:
      '공부 계획, 공부 기록, 진행 중인 타이머, 체크인, 주간 회고, 개선안, 시험, 일기, AI 메시지가 전부 사라져요. 서버에 저장된 체크인도 지워요. 과목 · 루틴 · 설정과 로그인 정보는 그대로 남아요.',
    done: '모든 기록을 지웠어요.',
  },
}

/** 지운 결과 안내. isSuccess 가 false 면 일부를 못 지운 것입니다. */
interface DeleteMessage {
  text: string
  isSuccess: boolean
}

// 관리 강도 한도를 이 단계 이상으로 "올릴" 때는 바로 바꾸지 않고 확인창으로 한 번 더 묻습니다. (4 = 강제적 채찍)
const CONFIRM_CARE_LEVEL = 4

export function SettingsPage() {
  const navigate = useNavigate()
  const { user, token, logout } = useAuth()
  const queryClient = useQueryClient()
  // "모든 기록 지우기" 때 서버에 저장된 체크인도 지웁니다. (#321) 테스트 로그인은 서버에 체크인이 없어서 부르지 않습니다.
  const deleteServer = useMutation({
    mutationFn: deleteServerCheckIns,
    // 보관해 둔 "오늘 체크인" 값도 낡았다고 표시합니다. (지운 체크인이 남아 보이지 않게)
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['checkins'] }),
  })
  // 계정 카드에 보여줄 닉네임·이메일·학교. 가입 정보가 이 기기에 없으면 null 입니다.
  const [profile] = useState(loadSignupProfile)
  // "로그아웃할까요?" 확인창이 열려 있는지
  const [isLogoutOpen, setIsLogoutOpen] = useState(false)

  // 닉네임이 있으면 닉네임, 없으면 로그인한 사람의 이름을 보여줍니다.
  const accountName = profile?.nickname || user?.name || '사용자'

  function handleLogout() {
    // 서버의 로그인 토큰부터 지워 달라고 합니다. 답을 기다리지 않고 바로 넘어갑니다.
    // (서버가 꺼져 있어도 로그아웃은 되어야 합니다. 이 기기의 로그인 정보를 지우기 "전에" 불러야 토큰이 같이 나갑니다)
    void logoutOnServer()
    // 로그인 화면으로 먼저 옮긴 뒤 로그인 정보를 지웁니다.
    // (순서가 반대면 문지기(RequireAuth)가 "설정으로 돌아갈 것" 을 기억해서, 다음에 로그인하면 설정 화면이 뜹니다)
    navigate('/login', { replace: true })
    logout()
  }

  // 처음 열 때 한 번 불러옵니다. (불러오면서 예약된 한도 상향이 있으면 날짜가 지났는지도 같이 확인합니다)
  const [limits, setLimits] = useState(() => getCareLimits())
  // 확인창에서 "올릴까요?" 하고 묻고 있는 단계. null 이면 확인창이 닫혀 있습니다.
  const [confirmCareLevel, setConfirmCareLevel] = useState<CareLevel | null>(null)

  function handleChangeCareLevel(level: CareLevel) {
    // 센 단계로 올릴 때만 한 번 더 묻습니다. 낮추는 건 언제나 바로 바꿉니다.
    if (level >= CONFIRM_CARE_LEVEL && level > limits.maxCareLevel) {
      setConfirmCareLevel(level)
      return
    }
    setLimits(setMaxCareLevel(level))
  }

  function handleConfirmCareLevel() {
    if (confirmCareLevel === null) return
    setLimits(setMaxCareLevel(confirmCareLevel))
    setConfirmCareLevel(null)
  }
  const [messageSettings, setMessageSettings] = useState(getMessageSettings)
  // 온보딩 마지막에 세운 처음 계획. 아직 안 세웠으면 null 입니다. (#240)
  const [initialPlan] = useState(loadInitialPlan)
  // 처음의 다짐(목소리·글). 없으면 null 입니다. 여기서 지울 수 있어서 바꿀 수 있는 상태로 둡니다. (#241)
  const [voicePledge, setVoicePledge] = useState(loadVoicePledge)

  function handleRemoveVoicePledge() {
    // 정말 지워졌을 때만 화면에서도 없앱니다.
    if (removeVoicePledge()) setVoicePledge(null)
  }
  // 온보딩 답. "내 정보 더 알려주기" 에서 남은 질문 수를 세는 데 씁니다. (#239)
  const [onboardingAnswers] = useState(loadOnboardingAnswers)

  // 지금 확인창으로 물어보고 있는 종류. null 이면 확인창이 닫혀 있습니다.
  const [pendingKind, setPendingKind] = useState<DeleteKind | null>(null)
  const [message, setMessage] = useState<DeleteMessage | null>(null)
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermission>(getNotificationPermission)

  // 전화 받을 시간 ('HH:MM'). 아직 안 정했으면 빈 글자입니다. 올바른 시간만 불러옵니다.
  const [callTime, setCallTime] = useState(() => {
    const saved = loadData<unknown>(CALL_TIME_STORAGE_KEY, '')
    return typeof saved === 'string' && parseCallTime(saved) !== null ? saved : ''
  })
  // 아이폰인데 홈 화면에 추가하지 않았는지. 이 경우에만 안내를 보여줍니다.
  const [showIosGuide] = useState(isIosWithoutInstall)

  function handleChangeCallTime(nextTime: string) {
    setCallTime(nextTime)
    // 시간을 고르면 바로 저장합니다. 시간을 지우면(빈 글자) 저장해 둔 것도 지워서 전화가 울리지 않게 합니다.
    if (nextTime === '') {
      removeData(CALL_TIME_STORAGE_KEY)
    } else {
      saveData(CALL_TIME_STORAGE_KEY, nextTime)
    }
  }

  async function handleRequestNotification() {
    const permission = await requestNotificationPermission()
    setNotificationPermission(permission)
  }

  // "알림 한 번 보내 보기" 의 결과. 아직 안 눌렀으면 null, 떴으면 true, 못 띄웠으면 false 입니다.
  const [isTestNotificationShown, setIsTestNotificationShown] = useState<boolean | null>(null)

  /** 알림이 이 기기에서 정말 뜨는지 한 번 보내 봅니다. 눌러서 바로 확인할 수 있게 둔 버튼입니다. */
  async function handleSendTestNotification() {
    const isShown = await showSystemNotification({
      title: 'STARFLOW 알림',
      body: '알림이 잘 와요. 새 소식이 생기면 이렇게 알려줄게요.',
      tag: 'test-notification',
      url: '/settings',
    })
    setIsTestNotificationShown(isShown)
  }

  // 일기 기능을 켰는지. 켜면 기록 화면에 일기 메뉴가 보입니다. (기본은 꺼짐 — #63 "원할 때만 켜는 기능")
  const [isDiaryEnabled, setIsDiaryEnabled] = useState(() => loadData(DIARY_ENABLED_KEY, false))

  useEffect(() => {
    saveData(DIARY_ENABLED_KEY, isDiaryEnabled)
  }, [isDiaryEnabled])

  function handleChangeMessageSettings(next: MessageSettings) {
    setMessageSettings(next)
    // "저장" 버튼이 따로 없어서, 바꾸는 즉시 저장합니다.
    saveMessageSettings(next)
  }

  /** 서버에 저장된 체크인을 지웁니다. 실패하면 안내와 "다시 지우기" 버튼이 보입니다. */
  function deleteServerCheckInsWithMessage(doneText: string) {
    deleteServer.mutate(undefined, {
      onSuccess: () => setMessage({ isSuccess: true, text: doneText }),
      onError: (error) =>
        setMessage({
          isSuccess: false,
          text: `이 기기의 기록은 지웠지만, 서버에 저장된 체크인은 아직 못 지웠어요. ${getApiErrorMessage(error)}`,
        }),
    })
  }

  function handleConfirm() {
    if (pendingKind === null) return

    // 이 기기에서 먼저 지웁니다. 서버에 닿지 못해도 이 기기의 기록은 지워집니다.
    // 지우고 나면 정말 사라졌는지 한 번 더 확인한 결과가 돌아옵니다.
    const { isSuccess } = deleteMyData(pendingKind)
    const doneText = isSuccess
      ? deleteTexts[pendingKind].done
      : '일부를 지우지 못했어요. 다시 시도해 주세요.'
    setMessage({ isSuccess, text: doneText })
    // 모든 기록을 지울 때는 서버에 저장된 체크인도 지웁니다. (#321)
    if (pendingKind === 'all' && canSyncCheckIns(token)) {
      setMessage({ isSuccess, text: '서버에 저장된 체크인도 지우는 중이에요…' })
      deleteServerCheckInsWithMessage(doneText)
    }
    setPendingKind(null)
    // 저장소에서는 지워졌지만 화면이 들고 있는 값은 그대로라서, 새로 읽어 옵니다.
    // (안 읽으면 새로고침하기 전까지 지운 다짐 녹음이 보이고 재생됩니다)
    setVoicePledge(loadVoicePledge())
  }

  // 온보딩에서 미뤄 둔 질문이 몇 개 남았는지 셉니다. 설문을 한 번도 안 했으면 답이 null 입니다. (#239)
  const remainingCount =
    onboardingAnswers === null ? 0 : getUnansweredSteps(onboardingAnswers).length
  // 과목별 성적·자신감을 알려 준 과목 수 (#88). 아직 이 질문에 답하지 않았으면 null, 건너뛰었으면 0 입니다.
  const subjectLevelCount =
    onboardingAnswers !== null && 'subjectLevels' in onboardingAnswers
      ? parseSubjectLevels(onboardingAnswers.subjectLevels).length
      : null
  // Link(주소로 이동하는 글자)를 버튼처럼 보이게 하는 클래스. h-10 으로 누르는 높이를 40px 로 둡니다.
  const moreLinkClass =
    'bg-brand hover:bg-brand-dark mt-3 inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium text-white transition-colors'
  const secondaryLinkClass =
    'mt-3 inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50'

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">설정</h1>
        <p className="mt-2 text-slate-600">
          AI 가 나를 얼마나 세게 챙길지 내가 정해요. 정한 한도는 절대 넘지 않아요.
        </p>
      </div>

      {/* 계정: 지금 누구로 로그인했는지 보여주고, 여기서 내 계정 화면으로 가거나 로그아웃합니다. */}
      <Card>
        {/* 모바일은 프로필 아래에 버튼을 가득 채우고, PC(sm 이상)는 오른쪽에 나란히 둡니다. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {/* 프로필 사진 대신 이름의 첫 글자를 동그라미에 넣습니다. 꾸밈이라 스크린리더는 읽지 않습니다. */}
            <div
              aria-hidden
              className="bg-brand-light text-brand flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-bold"
            >
              {accountName.slice(0, 1)}
            </div>
            {/* min-w-0 + truncate: 긴 이메일이 칸을 밀어내지 않고 '...' 으로 줄어듭니다. */}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2">
                <span className="truncate text-base font-semibold text-slate-900">
                  {accountName}
                </span>
                {user?.id === testUser.id && (
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                    테스트 계정
                  </span>
                )}
              </p>
              {profile?.email && <p className="truncate text-sm text-slate-500">{profile.email}</p>}
              {profile?.schoolName && (
                <p className="truncate text-sm text-slate-500">{profile.schoolName}</p>
              )}
            </div>
          </div>
          {/* 내 정보 고치기 · 비밀번호 바꾸기 · 탈퇴는 내 계정 화면에 있습니다. (pages/AccountPage.tsx) */}
          <Link
            to="/settings/account"
            className="inline-flex h-10 w-full shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50 sm:w-auto"
          >
            내 계정 관리
          </Link>
          <Button
            variant="secondary"
            className="w-full shrink-0 sm:w-auto"
            onClick={() => setIsLogoutOpen(true)}
          >
            로그아웃
          </Button>
        </div>
      </Card>

      {/* 시안처럼 PC(lg)에서는 두 칸으로 나눕니다. 왼쪽은 관리 강도 한도, 오른쪽은 내 데이터 등 그 밖의 설정입니다. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-6">
          {/* 온보딩에서 미뤄 둔 질문을 여기서 이어서 답합니다. (#239) */}
          <Card title="내 정보와 처음의 나">
            <h4 className="text-sm font-semibold text-slate-900">내 정보 더 알려주기</h4>
            {onboardingAnswers === null ? (
              <>
                <p className="mt-1 text-sm break-keep text-slate-500">
                  아직 처음 질문에 답하지 않았어요. 질문 몇 개면 끝나요.
                </p>
                <Link to="/onboarding" className={moreLinkClass}>
                  처음 질문 답하기
                </Link>
              </>
            ) : remainingCount > 0 ? (
              <>
                <p className="mt-1 text-sm break-keep text-slate-500">
                  남은 질문 {remainingCount}개 · 안 해도 앱은 그대로 쓸 수 있어요
                </p>
                <Link to="/onboarding/more" className={moreLinkClass}>
                  이어서 답하기
                </Link>
              </>
            ) : (
              <p className="mt-1 text-sm break-keep text-slate-500">
                질문에 다 답했어요. 알려준 만큼 더 잘 맞춰 줄게요.
              </p>
            )}

            {/*
              과목별 성적·자신감 (#88). "남은 질문" 에서는 한 번 답하거나 건너뛰면 빠져서 다시 답할 길이 없었습니다.
              여기서 언제든 다시 알려 주거나 고칠 수 있게 합니다. (온보딩 화면이 ?only=subjectLevels 로 이 질문 하나만 보여 줍니다)
            */}
            {onboardingAnswers !== null && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <h4 className="text-sm font-semibold text-slate-900">과목별 성적·자신감</h4>
                <p className="mt-1 text-sm break-keep text-slate-500">
                  {subjectLevelCount === null
                    ? '아직 알려 주지 않았어요. 과목마다 최근 성적과 자신감을 알려 주면 공부 시간을 더 잘 맞춰 줘요.'
                    : subjectLevelCount === 0
                      ? '건너뛰었어요. 알려 주고 싶을 때 언제든 알려 줄 수 있어요.'
                      : `과목 ${subjectLevelCount}개를 알려 줬어요.`}
                </p>
                <Link to="/onboarding/more?only=subjectLevels" className={secondaryLinkClass}>
                  {subjectLevelCount !== null && subjectLevelCount > 0 ? '고치기' : '알려 주기'}
                </Link>
              </div>
            )}

            {/* 처음 계획: 온보딩 마지막에 한 약속. 여기서 누를 때만 다시 세울 수 있습니다. (#240) */}
            <div className="mt-4 border-t border-slate-100 pt-4">
              <h4 className="text-sm font-semibold text-slate-900">처음 계획</h4>
              {initialPlan === null ? (
                <>
                  <p className="mt-1 text-sm break-keep text-slate-500">
                    아직 처음 계획을 세우지 않았어요.
                  </p>
                  <Link to="/onboarding/plan" className={secondaryLinkClass}>
                    처음 계획 세우기
                  </Link>
                </>
              ) : (
                <>
                  <p className="mt-1 text-sm break-keep text-slate-500">
                    하루 {initialPlan.dailyMinutes / 60}시간 · 주 {initialPlan.daysPerWeek}일 ·{' '}
                    {initialPlan.createdDate} 에 세움
                  </p>
                  <Link to="/onboarding/plan?redo=1" className={secondaryLinkClass}>
                    다시 세우기
                  </Link>
                </>
              )}
            </div>

            {/* 처음의 다짐: 내 목소리와 글 한마디. 이 기기에만 저장됩니다. (#241) */}
            <div className="mt-4 border-t border-slate-100 pt-4">
              <h4 className="text-sm font-semibold text-slate-900">처음의 다짐</h4>
              {voicePledge === null ? (
                <>
                  <p className="mt-1 text-sm break-keep text-slate-500">
                    아직 남긴 다짐이 없어요. 그만두고 싶을 때 다시 들을 한마디를 남겨 보세요.
                  </p>
                  <Link to="/onboarding/voice?from=settings" className={secondaryLinkClass}>
                    한마디 남기기
                  </Link>
                </>
              ) : (
                <>
                  <p className="mt-1 text-sm break-keep text-slate-500">
                    {voicePledge.recordedDate} 에 남김 · 이 기기에만 저장돼요
                  </p>
                  {voicePledge.text !== '' && (
                    <p className="mt-2 text-sm font-medium break-words text-slate-900">
                      “{voicePledge.text}”
                    </p>
                  )}
                  {/* flex-wrap: 좁은 화면에서는 버튼이 다음 줄로 넘어갑니다. */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {voicePledge.audioDataUrl && (
                      <VoicePledgePlayButton
                        audioDataUrl={voicePledge.audioDataUrl}
                        seconds={voicePledge.seconds}
                        label="듣기"
                        className="border border-slate-200"
                      />
                    )}
                    <Link
                      to="/onboarding/voice?from=settings"
                      className={cn(secondaryLinkClass, 'mt-0')}
                    >
                      다시 남기기
                    </Link>
                    <Button variant="ghost" onClick={handleRemoveVoicePledge}>
                      지우기
                    </Button>
                  </div>
                </>
              )}
            </div>
          </Card>

          {/* 한도 · 수위는 AI 가 바꾸지 않고 나만 바꿉니다. 낮추면 즉시, 높이면 다음 날부터예요. (「4.8 설정」, #390) */}
          <Card title="관리 강도 최대 한도">
            <p className="text-sm text-slate-500">
              낮추면 바로, 높이면 내일부터 적용돼요. AI 는 이 한도를 바꾸지 않아요.
            </p>

            {/* 올려 둔 값이 있으면 그 값을 골라 둔 것으로 보여 줍니다. 지금 값을 다시 고르면 예약이 취소돼요. */}
            <CareLevelPicker
              value={limits.pendingMaxCareLevel ?? limits.maxCareLevel}
              onChange={handleChangeCareLevel}
              className="mt-4"
            />
            {limits.pendingMaxCareLevel !== null && (
              <PendingNotice
                now={`${limits.maxCareLevel} ${careLevelInfos[limits.maxCareLevel].name}`}
                next={`${limits.pendingMaxCareLevel} ${careLevelInfos[limits.pendingMaxCareLevel].name}`}
              />
            )}
          </Card>

          <Card title="독설 허용 수위">
            <p className="text-sm text-slate-500">
              지적은 행동에만 해요. 외모·성적·능력 비하와 남과 비교는 절대 안 해요. 낮추면 바로,
              높이면 내일부터 적용돼요.
            </p>

            <HarshnessPicker
              value={limits.pendingMaxHarshness ?? limits.maxHarshness}
              onChange={(value) => setLimits(setMaxHarshness(value))}
              className="mt-4"
            />
            {limits.pendingMaxHarshness !== null && (
              <PendingNotice
                now={`${limits.maxHarshness} / 5`}
                next={`${limits.pendingMaxHarshness} / 5`}
              />
            )}
          </Card>

          <AutoSettingsSection />

          <Card title="잠금과 독촉">
            <div className="flex flex-col divide-y divide-slate-100">
              <label className="flex cursor-pointer items-center justify-between gap-3 py-3">
                <span className="flex flex-col">
                  <span className="text-sm font-semibold text-slate-900">집중 모드 잠금 허용</span>
                  <span className="text-sm text-slate-500">풀려면 10초 기다리고 이유를 적어요</span>
                </span>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center">
                  <input
                    type="checkbox"
                    checked={limits.allowFocusMode}
                    onChange={(event) => setLimits(setAllowFocusMode(event.target.checked))}
                    aria-label="집중 모드 잠금 허용"
                    className="accent-brand h-5 w-5 cursor-pointer"
                  />
                </span>
              </label>

              <label className="flex cursor-pointer items-center justify-between gap-3 py-3">
                <span className="flex flex-col">
                  <span className="text-sm font-semibold text-slate-900">
                    정해진 시간 외 독촉 전화
                  </span>
                  <span className="text-sm text-slate-500">허용해도 하루 1번까지만</span>
                </span>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center">
                  <input
                    type="checkbox"
                    checked={limits.allowOffHoursCall}
                    onChange={(event) => setLimits(setAllowOffHoursCall(event.target.checked))}
                    aria-label="정해진 시간 외 독촉 전화"
                    className="accent-brand h-5 w-5 cursor-pointer"
                  />
                </span>
              </label>
            </div>
          </Card>

          {/* 웹은 다른 앱을 못 잠가서, 휴대폰 기본 기능으로 직접 잠그는 법을 안내합니다. (#106) */}
          <Card title="휴대폰 집중 모드">
            <p className="text-sm text-slate-500">
              공부 시간에 SNS 앱을 잠그고 싶다면, 휴대폰의 스크린 타임·집중 모드를 켜는 법을
              알려줄게요.
            </p>
            {/* 집중 모드 잠금(강제적 채찍)을 허용한 사람에게는 이 안내를 한 번 더 권합니다. */}
            {limits.allowFocusMode && (
              <p className="mt-2 text-sm font-medium text-slate-700">
                집중 모드 잠금을 허용했어요. 휴대폰에서도 SNS 앱을 같이 잠가 두면 더 잘 지켜져요.
              </p>
            )}
            <Link
              to={PHONE_FOCUS_PATH}
              className="text-brand mt-2 inline-flex h-11 items-center text-sm font-medium underline"
            >
              휴대폰 집중 모드 켜는 법 보기
            </Link>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card title="전화와 메시지">
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Input
                  id="call-time"
                  type="time"
                  label="전화 받을 시간"
                  value={callTime}
                  onChange={(event) => handleChangeCallTime(event.target.value)}
                  className="h-12 text-base"
                />
                <p className="text-sm break-keep text-slate-500">
                  {callTime === ''
                    ? '시간을 고르면 매일 그 시간에 AI 선생님이 전화를 걸어요.'
                    : `매일 ${callTime} 에 전화가 와요.`}{' '}
                  앱이 열려 있을 때만 울려요. 알림은 아래 &quot;알림&quot;에서 켤 수 있어요.
                </p>
                {/* 칸은 항상 두고 글자만 바꿉니다. (화면 읽기 프로그램이 바뀐 안내를 읽게 하려는 것입니다) */}
                <p role="status" className="text-sm break-keep text-red-700">
                  {isCallTimeInQuietHours(callTime, toQuietHours(messageSettings))
                    ? `이 시간은 연락 금지 시간(${messageSettings.quietStart} ~ ${messageSettings.quietEnd})이라 전화가 울리지 않아요. 전화 시간이나 연락 금지 시간을 바꿔 주세요.`
                    : ''}
                </p>
                {showIosGuide && (
                  <p className="rounded-lg bg-slate-50 p-3 text-sm break-keep text-slate-600">
                    아이폰은 Safari 의 공유 버튼 → &apos;홈 화면에 추가&apos;로 설치한 뒤에만 알림을
                    받을 수 있어요.
                  </p>
                )}
                {/* 정해 둔 시간을 기다리지 않고 바로 전화 화면을 열어 봅니다. (수신 화면 → "받기" → 통화) */}
                <div>
                  <Link to="/call" className={secondaryLinkClass}>
                    지금 전화 받아 보기
                  </Link>
                </div>
              </div>

              <MessageSettingsFields
                value={messageSettings}
                onChange={handleChangeMessageSettings}
              />
            </div>
          </Card>

          <Card title="일기 쓰기">
            <div className="flex flex-col gap-4">
              <p className="text-sm text-slate-500">
                원할 때만 쓰는 자유 일기예요. 켜면 기록 화면에 일기 메뉴가 보여요.
              </p>

              <div className="flex gap-3">
                <Button
                  variant={isDiaryEnabled ? 'primary' : 'secondary'}
                  aria-pressed={isDiaryEnabled}
                  className="h-11 flex-1"
                  onClick={() => setIsDiaryEnabled(true)}
                >
                  켜기
                </Button>
                <Button
                  variant={!isDiaryEnabled ? 'primary' : 'secondary'}
                  aria-pressed={!isDiaryEnabled}
                  className="h-11 flex-1"
                  onClick={() => setIsDiaryEnabled(false)}
                >
                  끄기
                </Button>
              </div>
            </div>
          </Card>

          <Card title="알림">
            <div className="flex flex-col gap-4">
              {isNotificationSupported() ? (
                <>
                  <p className="text-sm text-slate-500">
                    {notificationPermission === 'granted' &&
                      '알림이 켜져 있어요. 새 메시지나 전화가 오면 브라우저 알림으로도 알려줄게요.'}
                    {notificationPermission === 'denied' &&
                      '브라우저 알림이 거부되어 있어요. 알림은 종 아이콘의 알림 화면에 그대로 쌓이고, 브라우저 알림만 안 떠요. 켜려면 브라우저 주소창 옆 설정에서 알림을 허용해 주세요.'}
                    {notificationPermission === 'default' &&
                      '알림을 켜면 앱을 안 보고 있어도 새 메시지나 전화를 브라우저 알림으로 알려줘요.'}
                  </p>
                  {notificationPermission === 'default' && (
                    <Button className="h-11 w-full sm:w-auto" onClick={handleRequestNotification}>
                      알림 켜기
                    </Button>
                  )}
                  {/* 알림을 켠 사람은 이 기기에서 정말 뜨는지 눌러서 확인할 수 있습니다. */}
                  {notificationPermission === 'granted' && (
                    <>
                      <Button
                        variant="secondary"
                        className="h-11 w-full sm:w-auto"
                        onClick={handleSendTestNotification}
                      >
                        알림 한 번 보내 보기
                      </Button>
                      {/* role="status": 화면을 읽어 주는 프로그램이 결과를 읽어 줍니다. */}
                      {isTestNotificationShown !== null && (
                        <p role="status" className="text-sm break-keep text-slate-600">
                          {isTestNotificationShown
                            ? '알림을 보냈어요. 안 보이면 휴대폰의 알림 설정(방해 금지 모드 등)을 확인해 주세요.'
                            : '이 브라우저에서는 알림을 띄우지 못했어요. 휴대폰이라면 홈 화면에 추가한 앱으로 열어 주세요.'}
                        </p>
                      )}
                    </>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-500">
                  이 브라우저는 브라우저 알림을 지원하지 않아요. 알림은 종 아이콘의 알림 화면에
                  그대로 쌓여요.
                </p>
              )}
              <WebPushSection />
            </div>
          </Card>

          <Card title="구글 캘린더">
            <GoogleCalendarSection />
          </Card>

          <Card title="내 데이터 관리">
            <div className="flex flex-col gap-4">
              <p className="text-sm text-slate-500">
                일기 원문은 나만 볼 수 있어요. 지우면 되돌릴 수 없어요.
              </p>

              {/* 모바일은 세로로 쌓고, sm 부터 가로로 나란히. 누르는 곳은 최소 40px(h-11 = 44px) */}
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  variant="secondary"
                  className="h-11 w-full sm:flex-1"
                  onClick={() => setPendingKind('diary')}
                >
                  일기만 지우기
                </Button>
                <Button
                  variant="danger"
                  className="h-11 w-full sm:flex-1"
                  onClick={() => setPendingKind('all')}
                >
                  모든 기록 지우기
                </Button>
              </div>

              {/* role="status": 지운 결과가 바뀌면 스크린리더가 읽어 줍니다. */}
              {message && (
                <p
                  role="status"
                  className={cn(
                    'text-sm font-medium',
                    message.isSuccess ? 'text-slate-900' : 'text-red-600',
                  )}
                >
                  {message.text}
                </p>
              )}
              {/* 서버에 저장된 체크인을 못 지웠을 때만 보입니다. */}
              {deleteServer.isError && (
                <Button
                  variant="secondary"
                  className="h-11 w-full sm:w-auto"
                  disabled={deleteServer.isPending}
                  onClick={() => deleteServerCheckInsWithMessage(deleteTexts.all.done)}
                >
                  서버의 체크인 다시 지우기
                </Button>
              )}
            </div>
          </Card>

          {/* 언제든 들어갈 수 있는 도움 연결. 누르면 바로 전화가 걸립니다. (#96) */}
          <Card title="힘들 때 도움받기" className="bg-slate-50">
            <p className="text-sm text-slate-500">혼자 버티기 힘들 때는 바로 이야기해 주세요.</p>
            <ul className="mt-3 flex flex-col gap-2">
              {helpLines.map((line) => (
                <li key={line.number}>
                  {/* min-h-12 = 48px: 손가락으로 누르기 쉬운 높이 */}
                  <a
                    href={`tel:${line.number}`}
                    aria-label={`${line.name} ${line.number} 전화 걸기`}
                    className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2 hover:bg-slate-100"
                  >
                    <span className="font-semibold text-slate-900">{line.name}</span>
                    <span className="text-brand text-xl font-bold">{line.number}</span>
                  </a>
                </li>
              ))}
            </ul>
            <Link
              to={SUPPORT_PATH}
              className="text-brand mt-3 inline-flex h-11 items-center text-sm font-medium underline"
            >
              도움 안내 화면 보기
            </Link>
          </Card>
        </div>
      </div>

      {/* 관리 강도 한도를 센 단계로 올리기 전에 한 번 더 물어봅니다. (올린 값은 내일부터 적용됩니다) */}
      <Modal
        isOpen={confirmCareLevel !== null}
        onClose={() => setConfirmCareLevel(null)}
        title="정말 올릴까요?"
      >
        {confirmCareLevel !== null && (
          <>
            <p className="font-medium text-slate-900">
              최대 한도를 {confirmCareLevel} {careLevelInfos[confirmCareLevel].name} 단계로
              올릴까요?
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {careLevelInfos[confirmCareLevel].description}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              올린 한도는 내일부터 적용돼요. 힘들면 언제든 다시 낮출 수 있고, 낮추는 건 바로
              적용돼요.
            </p>

            <div className="mt-5 flex gap-3">
              <Button
                variant="secondary"
                size="lg"
                className="flex-1"
                onClick={() => setConfirmCareLevel(null)}
              >
                취소
              </Button>
              <Button size="lg" className="flex-1" onClick={handleConfirmCareLevel}>
                올리기
              </Button>
            </div>
          </>
        )}
      </Modal>

      {/* 지우기 전에 한 번 더 물어봅니다. 확인 버튼은 위험한 일이라는 걸 알리려고 빨간색입니다. */}
      {/* 로그아웃하기 전에 한 번 확인합니다. 잘못 눌러서 나가는 일을 막습니다. */}
      <Modal isOpen={isLogoutOpen} onClose={() => setIsLogoutOpen(false)} title="로그아웃할까요?">
        <p className="text-sm break-keep text-slate-600">
          이 기기에 저장된 계획과 기록은 지워지지 않아요. 다시 로그인하면 이어서 볼 수 있어요.
        </p>
        <p className="mt-2 text-sm break-keep text-slate-500">
          다른 사람과 같이 쓰는 기기라면, 아래 &quot;내 데이터 관리&quot; 에서 기록을 먼저 지워
          주세요.
        </p>
        <div className="mt-5 flex gap-3">
          <Button
            variant="secondary"
            size="lg"
            className="flex-1"
            onClick={() => setIsLogoutOpen(false)}
          >
            취소
          </Button>
          <Button size="lg" className="flex-1" onClick={handleLogout}>
            로그아웃
          </Button>
        </div>
      </Modal>

      <Modal
        isOpen={pendingKind !== null}
        onClose={() => setPendingKind(null)}
        title="되돌릴 수 없어요"
      >
        {pendingKind !== null && (
          <>
            <p className="font-medium text-slate-900">{deleteTexts[pendingKind].question}</p>
            <p className="mt-2 text-sm text-slate-600">{deleteTexts[pendingKind].detail}</p>
            <p className="mt-2 text-sm font-medium text-red-600">지운 뒤에는 되돌릴 수 없어요.</p>

            <div className="mt-5 flex gap-3">
              <Button
                variant="secondary"
                size="lg"
                className="flex-1"
                onClick={() => setPendingKind(null)}
              >
                취소
              </Button>
              <Button variant="danger" size="lg" className="flex-1" onClick={handleConfirm}>
                {/* 무엇을 지우는지는 위 질문이 알려 주므로, 좁은 화면에서 글자가 꺾이지 않게 짧게 씁니다. */}
                지우기
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}

// 푸시 상태마다 보여 줄 안내 문장
interface PendingNoticeProps {
  /** 지금 적용 중인 값 */
  now: string
  /** 내일부터 적용될 값 */
  next: string
}

/** 한도 · 수위를 올렸을 때 "내일부터 적용" 안내 (#390) */
function PendingNotice({ now, next }: PendingNoticeProps) {
  return (
    <p role="status" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <strong>내일부터 적용</strong> · 오늘은 {now}, 내일부터 {next}예요. 지금 값을 다시 고르면
      취소돼요.
    </p>
  )
}

/**
 * AI 가 성향으로 맞춘 설정들 (#390, 최종 기획서 「4.8 설정」)
 * - 줄마다 근거 배지(검사 기준 / 최근 데이터 기준 / 내가 정함 / 기본값)와 이유 한 줄
 * - 내가 바꾼 설정은 🔒 잠금. AI 는 다시 바꾸지 않습니다.
 * - AI 가 바꾼 설정에는 [되돌리기] — 바꾸기 전 값으로 돌아가고 잠깁니다.
 */
function AutoSettingsSection() {
  const [settings, setSettings] = useState(loadAutoSettings)

  function handlePick<K extends AutoSettingKey>(key: K, value: AutoSettingValues[K]) {
    if (settings[key].value === value) return
    const next = setByUser(settings, key, value)
    setSettings(next)
    saveAutoSettings(next)
  }

  function handleRevert(key: AutoSettingKey) {
    const next = revertSetting(settings, key)
    setSettings(next)
    saveAutoSettings(next)
  }

  return (
    <Card title="AI 가 맞춘 설정">
      <p className="text-sm text-slate-500">
        처음 2주는 검사로, 그 뒤에는 최근 기록으로 AI 가 맞춰요. 내가 바꾼 설정은 🔒 잠겨서 AI 가
        다시 바꾸지 않아요.
      </p>
      <ul className="mt-2 flex flex-col divide-y divide-slate-100">
        {AUTO_SETTING_ROWS.map((settingRow) => (
          <AutoSettingItem
            key={settingRow.key}
            settingRow={settingRow}
            setting={settings[settingRow.key] as StoredSetting}
            onPick={(value) => handlePick(settingRow.key, value)}
            onRevert={() => handleRevert(settingRow.key)}
          />
        ))}
      </ul>
    </Card>
  )
}

interface AutoSettingItemProps {
  settingRow: AutoSettingRow
  setting: StoredSetting
  onPick: (value: AutoSettingValues[AutoSettingKey]) => void
  onRevert: () => void
}

/** "AI 가 맞춘 설정" 의 한 줄 */
function AutoSettingItem({ settingRow, setting, onPick, onRevert }: AutoSettingItemProps) {
  const isAiChanged = canRevert(setting)
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-900">{settingRow.title}</span>
        {/* 근거 배지. 색만으로 구분하지 않게 글자로 씁니다. */}
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-xs font-medium',
            setting.source === 'user' && 'bg-slate-800 text-white',
            (setting.source === 'test' || setting.source === 'data') && 'bg-brand-light text-brand',
            setting.source === 'default' && 'bg-slate-100 text-slate-600',
          )}
        >
          {setting.locked && <span aria-hidden>🔒 </span>}
          {SOURCE_LABELS[setting.source]}
          {setting.locked && <span className="sr-only"> · 잠김</span>}
        </span>
      </div>
      <p className="text-sm break-keep text-slate-500">{setting.reason}</p>
      {/* 고르기. 좁은 화면에서는 칸이 같은 폭으로 나뉩니다. */}
      <div
        role="group"
        aria-label={settingRow.title}
        className={cn(
          'grid gap-1 rounded-lg bg-slate-100 p-1',
          settingRow.options.length === 3 ? 'grid-cols-3' : 'grid-cols-2',
        )}
      >
        {settingRow.options.map((option) => {
          const isSelected = option.value === setting.value
          return (
            <button
              key={String(option.value)}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onPick(option.value)}
              className={cn(
                'h-10 cursor-pointer rounded-md px-2 text-sm font-medium break-keep transition-colors',
                isSelected ? 'text-brand bg-white shadow-sm' : 'text-slate-600 hover:bg-slate-200',
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
      {isAiChanged && (
        <Button variant="ghost" className="self-start" onClick={onRevert}>
          되돌리기 · 바꾸기 전: {getOptionLabel(settingRow, setting.before)}
        </Button>
      )}
    </li>
  )
}

const webPushMessages: Record<WebPushStatus, string> = {
  unsupported: '이 브라우저에서는 앱을 닫았을 때 오는 알림을 쓸 수 없어요.',
  'needs-install':
    '아이폰은 Safari 의 공유 버튼 → "홈 화면에 추가" 로 설치한 앱에서만 켤 수 있어요. 설치한 앱으로 열어 주세요.',
  denied: '알림이 거부되어 있어요. 휴대폰이나 브라우저 설정에서 이 앱의 알림을 허용해 주세요.',
  off: '켜면 앱을 닫아 둬도 하루 한 번 "오늘의 작전" 같은 알림이 휴대폰 알림 칸에 와요. (밤 11시 ~ 아침 7시는 보내지 않아요)',
  on: '켜져 있어요. 앱을 닫아 둬도 이 기기로 알림이 와요.',
}

/**
 * "앱을 닫아도 알림 받기" (웹 푸시) 켜기·끄기. (lib/webPush.ts)
 * 위의 "알림 켜기" 는 앱이 열려 있을 때 뜨는 알림이고, 이것은 앱을 닫아 둬도 서버가 보내는 알림입니다.
 */
function WebPushSection() {
  const navigate = useNavigate()
  // 이 기기의 지금 상태. 처음에는 알아보는 중(null)입니다.
  const [status, setStatus] = useState<WebPushStatus | null>(null)

  // 화면이 열리면 이 기기의 상태를 한 번 알아봅니다. (서버가 아니라 브라우저에게 묻는 것이라 useEffect 에서 합니다)
  useEffect(() => {
    let isCancelled = false
    void getWebPushStatus().then((next) => {
      if (!isCancelled) setStatus(next)
    })
    return () => {
      isCancelled = true
    }
  }, [])

  // 켜기·끄기는 서버의 값을 바꾸는 요청이라 useMutation 을 씁니다. (docs/DATA-FETCHING.md 5장)
  const mutation = useMutation({
    mutationFn: (turnOn: boolean) => (turnOn ? turnOnWebPush() : turnOffWebPush()),
    onSettled: async () => {
      // 성공했든 실패했든 이 기기의 실제 상태를 다시 읽어 맞춥니다.
      setStatus(await getWebPushStatus())
    },
  })

  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 pt-4">
      <p className="text-sm font-semibold text-slate-900">앱을 닫아도 알림 받기</p>
      <p className="text-sm break-keep text-slate-500">
        {status === null ? '이 기기에서 쓸 수 있는지 알아보는 중이에요…' : webPushMessages[status]}
      </p>
      {/* 아이폰인데 홈 화면 앱이 아니면, 홈의 설치 안내(#105)로 이어 줍니다. 닫아 둔 안내도 다시 보이게 합니다. */}
      {status === 'needs-install' && (
        <Button
          variant="secondary"
          className="h-11 w-full sm:w-auto"
          onClick={() => {
            showIosInstallGuideAgain()
            navigate('/')
          }}
        >
          홈 화면에 추가하는 방법 보기
        </Button>
      )}
      {status === 'off' && (
        <Button
          className="h-11 w-full sm:w-auto"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate(true)}
        >
          {mutation.isPending ? '켜는 중…' : '앱을 닫아도 알림 받기'}
        </Button>
      )}
      {status === 'on' && (
        <Button
          variant="secondary"
          className="h-11 w-full sm:w-auto"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate(false)}
        >
          {mutation.isPending ? '끄는 중…' : '끄기'}
        </Button>
      )}
      {/* 켜다가 실패하면 이유를 보여 줍니다. (서버에 푸시가 아직 꺼져 있음 · 권한 거부 등) */}
      {/* 안내 칸은 항상 화면에 두고 안의 글자만 바꿉니다. 칸이 글자와 함께 새로 생기면 화면 읽기 프로그램이 못 읽을 수 있습니다. */}
      <p role="alert" className="text-sm break-keep text-red-700">
        {mutation.isError
          ? mutation.error instanceof WebPushError
            ? mutation.error.message
            : '알림 설정을 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.'
          : ''}
      </p>
    </div>
  )
}

// 연결 상태마다 보여 줄 안내 문장
const calendarMessages: Record<CalendarStatus, string> = {
  unavailable: '아직 준비 중이에요.',
  off: '연결하면 학원·약속처럼 구글 캘린더에 있는 일정과 공부 계획이 겹치지 않게 도와줘요. 일정 제목은 가져오지 않고, 바쁜 시간만 봐요.',
  expired: '연결이 끝났어요. 구글이 한 시간마다 다시 확인해서, 다시 연결을 한 번 눌러 주세요.',
  on: '연결됐어요.',
}

/** 바쁜 시간 한 칸을 "15:00 ~ 16:30" 으로 보여 줍니다. */
function formatBusyTime(start: number, end: number): string {
  const toClock = (time: number) =>
    new Date(time).toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  return `${toClock(start)} ~ ${toClock(end)}`
}

/** 오늘 구글 캘린더의 바쁜 시간. 연결이 잘 됐는지 눈으로 확인하는 곳입니다. (AsyncBoundary 안에서 씁니다) */
function TodayBusyTimes() {
  const { data: busyTimes } = useSuspenseQuery(busyTimesQuery(getTodayKey()))

  if (busyTimes.length === 0) {
    return <p className="text-sm text-slate-500">오늘 구글 캘린더에 시간이 정해진 일정이 없어요.</p>
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-slate-500">오늘 구글 캘린더의 바쁜 시간 {busyTimes.length}개</p>
      <ul className="flex flex-wrap gap-2">
        {busyTimes.map((busy) => (
          <li
            key={`${busy.start}-${busy.end}`}
            className="rounded bg-slate-100 px-2 py-1 text-sm text-slate-700 tabular-nums"
          >
            {formatBusyTime(busy.start, busy.end)}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * 구글 캘린더 연결 · 끊기. (lib/googleCalendar.ts, #314)
 * 로그인은 이메일로 하고, 구글에서는 캘린더 권한만 받습니다.
 */
function GoogleCalendarSection() {
  // 연결 상태와 연결 · 끊기 (계획 화면과 같이 쓰는 훅, hooks/useCalendarConnect.ts)
  const { status, isReady, isConnecting, errorMessage, connect, disconnect } = useCalendarConnect()

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm break-keep text-slate-500">{calendarMessages[status]}</p>

      {status === 'on' && (
        <AsyncBoundary
          pendingFallback={<Skeleton className="h-12 w-full" />}
          errorMessage="구글 캘린더를 읽지 못했어요. 연결 끊기를 누른 뒤 다시 연결해 주세요."
        >
          <TodayBusyTimes />
        </AsyncBoundary>
      )}

      {/* 모바일은 세로로 쌓고, sm 부터 가로로 나란히. 누르는 곳은 최소 40px(h-11 = 44px) */}
      <div className="flex flex-col gap-3 sm:flex-row">
        {(status === 'off' || status === 'expired') && (
          <Button
            className="h-11 w-full sm:w-auto"
            disabled={isConnecting || !isReady}
            onClick={connect}
          >
            {isConnecting ? '연결하는 중…' : status === 'off' ? '구글 캘린더 연결' : '다시 연결'}
          </Button>
        )}
        {(status === 'on' || status === 'expired') && (
          <Button variant="secondary" className="h-11 w-full sm:w-auto" onClick={disconnect}>
            연결 끊기
          </Button>
        )}
      </div>

      {errorMessage && (
        <p role="status" className="text-sm break-keep text-red-700">
          {errorMessage}
        </p>
      )}
    </div>
  )
}
