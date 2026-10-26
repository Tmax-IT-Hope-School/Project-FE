import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { ChipButton } from '@/components/ui/ChipButton'
import { CareLevelPicker, HarshnessPicker } from '@/components/ui/CareLimitPickers'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { MessageSettingsFields } from '@/components/ui/MessageSettingsFields'
import { LeaveAccountSection } from '@/components/ui/LeaveAccountSection'
import { Modal } from '@/components/ui/Modal'
import { SchoolClassPicker } from '@/components/ui/SchoolClassPicker'
import { SchoolTrackField } from '@/components/ui/SchoolTrackField'
import { Skeleton } from '@/components/ui/Skeleton'
import { useAuth } from '@/hooks/useAuth'
import { useIsServerData } from '@/hooks/useIsServerData'
import { useQueryParam } from '@/hooks/useQueryParam'
import { logoutOnServer } from '@/lib/accountApi'
import {
  SETTINGS_TEXT_MAX_LENGTH,
  applySettingsProposal,
  getSettingsChangeRows,
  requestSettingsFromText,
  type TalkableSettings,
} from '@/lib/aiSettingsApi'
import { getApiErrorMessage } from '@/lib/api'
import { isInApp } from '@/lib/appBridge'
import { deleteAllServerCards } from '@/lib/cardsApi'
import { canSyncCheckIns, deleteServerCheckIns } from '@/lib/checkInsApi'
import { CALL_TIME_STORAGE_KEY, isCallTimeInQuietHours, parseCallTime } from '@/lib/callReminder'
import { cn } from '@/lib/cn'
import {
  FOCUS_NAME_MAX,
  STUDY_FOCUS_OPTIONS,
  cleanFocusName,
  loadStudyFocus,
  needsFocusName,
  saveStudyFocus,
  type StudyFocusKind,
} from '@/lib/studyFocus'
import { getCoachStrength, STRENGTH_PRESETS, type StrengthPreset } from '@/lib/coachStrength'
import {
  NUDGE_KINDS,
  NUDGE_LABELS,
  loadNudgeSettings,
  setNudgeOn,
  type NudgeKind,
} from '@/lib/coachNudges'
import { addDemoData, isDemoSeeded, removeDemoData } from '@/lib/demoData'
import type { CareLevel } from '@/lib/careLevel'
import { careLevelInfos } from '@/lib/careLevelInfo'
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
import {
  getNotificationPermission,
  isNotificationSupported,
  requestNotificationPermission,
  toQuietHours,
} from '@/lib/notifications'
import {
  WebPushError,
  getWebPushStatus,
  turnOffWebPush,
  turnOnWebPush,
  type WebPushStatus,
} from '@/lib/webPush'
import { loadSchoolClass, saveSchoolClass, type SchoolClass } from '@/lib/schoolToday'
import { loadSchoolTrack, saveSchoolTrack, type SchoolTrack } from '@/lib/schoolTrack'
import { loadSignupProfile } from '@/lib/signup'
import { deleteServerSessions } from '@/lib/sessionsApi'
import { loadData, removeData, saveData } from '@/lib/storage'
import { testUser } from '@/lib/testLogin'

/* 지우기 종류별 안내 문구. 새 종류가 생기면 여기에 한 줄만 더하면 됩니다. */
const deleteTexts: Record<DeleteKind, { question: string; detail: string; done: string }> = {
  all: {
    question: '모든 기록을 지울까요?',
    detail:
      '공부 카드, 공부 기록, 진행 중인 타이머, 체크인, 코치와의 대화, AI 메시지가 전부 사라져요. 서버에 저장된 체크인 · 카드 · 공부 기록도 지워요. 과목 · 루틴 · 설정과 로그인 정보는 그대로 남아요.',
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

/**
 * 설정 화면(/settings). 코치 화면 머리의 톱니로 들어옵니다. (2026-10-18 "설정은 잡다한 기록이 너무 많아" → 네 묶음만)
 *   ① 계정     — 누구로 로그인했는지 · 학년 반(홈 시간표 칸과 같은 저장소) · 내가 준비하는 것 · 내 정보 고치기 · 로그아웃 ·
 *                탈퇴(테스트 계정은 처음부터 다시 하기) — 숨기지 않고 여기 바로 둡니다 (2026-10-18)
 *   ② 코치 세기 — 약 · 보통 · 강 하나로 고름 (관리 강도 한도 · 독설 수위 · 잠금 · 독촉 전화를 한꺼번에, lib/coachStrength.ts)
 *                하나씩 정하던 예전 칸은 "자세히" 안에 접어 둡니다.
 *   ③ 알림     — 코치 알림(종류별) · AI 코치 전화 시간 · 하루 메시지 횟수와 연락 금지 시간 · 말로 바꾸기(AI)
 *   ④ 내 데이터 — 모든 기록 지우기 하나
 * 시연용 가상 데이터 칸은 주소 끝에 ?demo=on 을 붙였을 때만 보입니다.
 */
export function SettingsPage() {
  const navigate = useNavigate()
  const { user, token, logout } = useAuth()
  const queryClient = useQueryClient()
  // "모든 기록 지우기" 때 서버에 저장된 체크인 · 카드 · 공부 기록도 지웁니다. (#321, #516) 테스트 로그인은 서버에 기록이 없어서 부르지 않습니다.
  const deleteServer = useMutation({
    mutationFn: async () => {
      await deleteServerCheckIns()
      await deleteAllServerCards()
      await deleteServerSessions()
    },
    // 보관해 둔 "오늘 체크인" · 서버 카드 값도 낡았다고 표시합니다. (지운 것이 남아 보이지 않게)
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['checkins'] })
      void queryClient.invalidateQueries({ queryKey: ['server-cards'] })
    },
  })
  // 서버 기록을 지우는 동안 새로고침 · 창 닫기를 하면 지우기가 중간에 끊겨서, 지운 카드 일부가 서버에 남습니다.
  // 그동안은 브라우저가 "이 페이지에서 나가시겠습니까?" 를 한 번 묻게 합니다.
  const isDeletingServer = deleteServer.isPending
  useEffect(() => {
    if (!isDeletingServer) return
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDeletingServer])
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

  // 코치 세기 (약 · 보통 · 강). 저장된 네 칸이 어느 묶음과 같은지로 고른 모양을 정합니다. (lib/coachStrength.ts)
  const { strength, isExact: isStrengthExact } = getCoachStrength(limits)
  const strengthPreset = STRENGTH_PRESETS.find((preset) => preset.strength === strength)
  // "강" 처럼 센 단계로 올릴 때 확인창으로 묻는 묶음. null 이면 확인창이 닫혀 있습니다.
  const [confirmStrength, setConfirmStrength] = useState<StrengthPreset | null>(null)

  /** 세기 묶음의 네 칸을 한꺼번에 바꿉니다. 올리는 값은 내일부터, 낮추는 값은 바로 적용됩니다. (careLimits 가 정함) */
  function applyStrength(preset: StrengthPreset) {
    setMaxCareLevel(preset.maxCareLevel)
    setMaxHarshness(preset.maxHarshness)
    setAllowFocusMode(preset.allowFocusMode)
    setLimits(setAllowOffHoursCall(preset.allowOffHoursCall))
  }

  function handlePickStrength(preset: StrengthPreset) {
    // 센 단계(4 강제적 채찍)로 올릴 때만 한 번 더 묻습니다.
    if (preset.maxCareLevel >= CONFIRM_CARE_LEVEL && preset.maxCareLevel > limits.maxCareLevel) {
      setConfirmStrength(preset)
      return
    }
    applyStrength(preset)
  }

  // 학년 · 반 (홈 시간표 칸과 같은 저장소). 저장하면 "저장했어요" 를 잠깐 보여 줍니다.
  const [schoolClass, setSchoolClass] = useState<SchoolClass | null>(loadSchoolClass)
  const [isClassSaved, setIsClassSaved] = useState(false)

  function handleSaveClass(next: SchoolClass) {
    saveSchoolClass(next)
    setSchoolClass(next)
    setIsClassSaved(true)
  }

  // 코치 알림 종류별 켜기 · 끄기 (lib/coachNudges.ts)
  const [nudgeSettings, setNudgeSettings] = useState(loadNudgeSettings)

  function handleToggleNudge(kind: NudgeKind, isOn: boolean) {
    setNudgeSettings(setNudgeOn(kind, isOn))
  }
  const [messageSettings, setMessageSettings] = useState(getMessageSettings)
  // 온보딩 마지막에 세운 처음 계획. 아직 안 세웠으면 null 입니다. (#240)

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

  function handleChangeMessageSettings(next: MessageSettings) {
    setMessageSettings(next)
    // "저장" 버튼이 따로 없어서, 바꾸는 즉시 저장합니다.
    saveMessageSettings(next)
  }

  /** "말로 바꾸기" 에서 [이렇게 바꿀게요] 를 눌렀을 때. 아래 칸들을 직접 바꾼 것과 똑같이 바로 저장합니다. */
  function handleApplyTalkedSettings(next: TalkableSettings) {
    if (next.callTime !== callTime) handleChangeCallTime(next.callTime)
    handleChangeMessageSettings(next.messageSettings)
  }

  /** 서버에 저장된 체크인 · 카드 · 공부 기록을 지웁니다. 실패하면 안내와 "다시 지우기" 버튼이 보입니다. */
  function deleteServerCheckInsWithMessage(doneText: string) {
    deleteServer.mutate(undefined, {
      onSuccess: () => setMessage({ isSuccess: true, text: doneText }),
      onError: (error) =>
        setMessage({
          isSuccess: false,
          text: `이 기기의 기록은 지웠지만, 서버에 저장된 체크인 · 카드 · 공부 기록은 아직 다 못 지웠어요. ${getApiErrorMessage(error)}`,
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
    // 모든 기록을 지울 때는 서버에 저장된 체크인 · 카드 · 공부 기록도 지웁니다. (#321, #516)
    if (pendingKind === 'all' && canSyncCheckIns(token)) {
      setMessage({
        isSuccess,
        text: '서버에 저장된 체크인 · 카드 · 공부 기록도 지우는 중이에요… 끝날 때까지 새로고침하거나 화면을 닫지 마세요.',
      })
      deleteServerCheckInsWithMessage(doneText)
    }
    setPendingKind(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[28px] leading-snug font-bold tracking-tight sm:text-3xl">설정</h1>
        <p className="mt-1 text-[15px] text-slate-500">계정 · 코치 · 알림을 여기서 바꿔요.</p>
      </div>

      {/* PC(lg)에서는 두 칸으로 나눕니다. 모바일은 한 줄로 쌓습니다. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        {/* ① 계정: 누구로 로그인했는지 · 학년 반 · 내 계정 관리 · 로그아웃 */}
        <Card title="계정">
          <div className="flex min-w-0 items-center gap-3">
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

          {/* 학년 · 반은 홈의 시간표 칸과 같은 저장소(study-school-class)를 씁니다. 서버에는 저장하지 않습니다. */}
          <SchoolClassPicker
            key={schoolClass ? `${schoolClass.grade}-${schoolClass.classNo}` : 'none'}
            initial={schoolClass}
            onSave={handleSaveClass}
            description={
              schoolClass
                ? `지금 ${schoolClass.grade}학년 ${schoolClass.classNo}반이에요. 홈 시간표와 코치가 이 반 기준으로 말해요.`
                : '학년 · 반을 알려 주면 홈에 시간표가 나오고, 코치가 오늘 배운 과목으로 말을 걸어요.'
            }
            saveLabel="반 저장"
            className="mt-5"
          />
          {isClassSaved && (
            <p role="status" className="mt-2 text-sm text-slate-600">
              저장했어요.
            </p>
          )}

          {/* 내가 준비하는 것: 코치가 대화에서 묻는 것과 같은 값입니다. 코치가 오늘 계획을 짤 때 이걸 보고 맞춰요. */}
          <StudyFocusField className="mt-5" />

          {/* 학과(특성화고 · 마이스터고) 또는 계열: 가입 때 묻는 것과 같은 칸입니다. 학교를 고른 사람만 보입니다. (2026-10-19) */}
          {profile?.schoolCode && (
            <SchoolTrackSettings schoolCode={profile.schoolCode} className="mt-5" />
          )}

          {/* 내 정보 고치기는 내 계정 화면에 있습니다. (pages/AccountPage.tsx)
              앱 설정 화면처럼 "다음 화면으로 가는 줄" 모양입니다. 로그아웃 · 탈퇴는 화면 맨 아래에 따로 둡니다. (2026-10-22) */}
          <Link
            to="/settings/account"
            className="mt-5 flex min-h-12 items-center justify-between gap-3 border-t border-slate-100 pt-3 text-[15px] font-medium text-slate-900"
          >
            내 정보 고치기
            <span aria-hidden className="text-xl text-slate-400">
              ›
            </span>
          </Link>
        </Card>

        {/* ② 코치 세기: 관리 강도 한도 · 독설 수위 · 잠금 · 독촉 전화를 약 · 보통 · 강 하나로 (lib/coachStrength.ts) */}
        <Card title="코치 세기">
          <p className="text-sm break-keep text-slate-500">
            AI 코치가 나를 얼마나 세게 챙길지 하나만 골라요. 올리면 내일부터, 낮추면 바로 적용돼요.
            AI 는 이 한도를 넘지 않아요.
          </p>
          <div role="radiogroup" aria-label="코치 세기" className="mt-4 grid grid-cols-3 gap-2">
            {STRENGTH_PRESETS.map((preset) => (
              <button
                key={preset.strength}
                type="button"
                role="radio"
                aria-checked={strength === preset.strength}
                onClick={() => handlePickStrength(preset)}
                // 고른 것은 연한 brand 바탕 + 테두리 + 굵게. 꽉 채운 brand 는 "행동 버튼" 에만 씁니다. (2차 규칙 1)
                className={cn(
                  'h-12 cursor-pointer rounded-xl border text-base transition-colors',
                  strength === preset.strength
                    ? 'border-brand bg-brand-light text-brand ring-brand font-bold ring-1'
                    : 'hover:border-brand border-slate-200 bg-white font-medium text-slate-700',
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p role="status" className="mt-3 text-sm break-keep text-slate-600">
            {strengthPreset?.description}
            {!isStrengthExact && ' (몇 칸은 "자세히" 에서 따로 정한 값이에요)'}
          </p>
          {(limits.pendingMaxCareLevel !== null || limits.pendingMaxHarshness !== null) && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <strong>내일부터 적용</strong> · 올린 값은 내일부터 바뀌어요. 지금 값을 다시 고르면
              취소돼요.
            </p>
          )}

          {/* 예전처럼 하나씩 정하고 싶은 사람을 위해 접어 둡니다. 저장 값은 위의 세기와 같습니다. */}
          <details className="mt-4 rounded-xl bg-slate-50 px-4">
            <summary className="flex h-11 cursor-pointer items-center text-sm font-medium text-slate-700">
              자세히 (하나씩 정하기)
            </summary>
            <div className="flex flex-col gap-5 pb-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">관리 강도 최대 한도</p>
                <CareLevelPicker
                  value={limits.pendingMaxCareLevel ?? limits.maxCareLevel}
                  onChange={handleChangeCareLevel}
                  className="mt-2"
                />
                {limits.pendingMaxCareLevel !== null && (
                  <PendingNotice
                    now={`${limits.maxCareLevel} ${careLevelInfos[limits.maxCareLevel].name}`}
                    next={`${limits.pendingMaxCareLevel} ${careLevelInfos[limits.pendingMaxCareLevel].name}`}
                  />
                )}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">독설 허용 수위</p>
                <p className="text-sm text-slate-500">
                  지적은 행동에만 해요. 외모·성적·능력 비하와 남과 비교는 절대 안 해요.
                </p>
                <HarshnessPicker
                  value={limits.pendingMaxHarshness ?? limits.maxHarshness}
                  onChange={(value) => setLimits(setMaxHarshness(value))}
                  className="mt-2"
                />
                {limits.pendingMaxHarshness !== null && (
                  <PendingNotice
                    now={`${limits.maxHarshness} / 5`}
                    next={`${limits.pendingMaxHarshness} / 5`}
                  />
                )}
              </div>
              {/* 「집중 모드 잠금 허용」 스위치는 숨겼습니다. 집중 모드를 켜는 곳이 아직 없어서 눌러도 달라지는 게 없었습니다.
                  (hooks/useFocusMode.ts 의 켜기를 부르는 곳이 없음) 켜는 버튼이 생기면 다시 꺼내면 됩니다.
                  켜고 끄는 칸은 스위치 모양(index.css 의 .switch). 줄 전체가 label 이라 어디를 눌러도 바뀝니다. (min-h-12 = 48px) */}
              <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3">
                <span className="flex min-w-0 flex-col">
                  <span className="text-[15px] font-semibold text-slate-900">
                    정해진 시간 외 독촉 전화
                  </span>
                  <span className="text-[13px] break-keep text-slate-500">
                    허용해도 하루 1번까지만
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={limits.allowOffHoursCall}
                  onChange={(event) => setLimits(setAllowOffHoursCall(event.target.checked))}
                  aria-label="정해진 시간 외 독촉 전화"
                  className="switch shrink-0"
                />
              </label>
            </div>
          </details>
        </Card>

        {/* ③ 알림: 코치 알림(종류별) · 전화 받을 시간 · 하루 메시지 횟수와 연락 금지 시간 */}
        <Card title="알림">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <span className="text-[15px] font-semibold text-slate-900">코치 알림</span>
              <span className="text-[13px] break-keep text-slate-500">
                하루 메시지 수만큼만 보내고, 수업 · 연락 금지 시간엔 보내지 않아요. (휴대폰 앱)
              </span>
              {/* 앱 설정처럼 줄마다 스위치 하나. 줄 사이는 얇은 선으로 나눕니다. (근접성) */}
              <div className="mt-1 flex flex-col divide-y divide-slate-100">
                {NUDGE_KINDS.map((kind) => (
                  <label
                    key={kind}
                    className="flex min-h-14 cursor-pointer items-center justify-between gap-3 py-2"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[15px] text-slate-900">{NUDGE_LABELS[kind].title}</span>
                      <span className="text-[13px] break-keep text-slate-500">
                        {NUDGE_LABELS[kind].description}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={nudgeSettings[kind]}
                      onChange={(event) => handleToggleNudge(kind, event.target.checked)}
                      aria-label={`코치 알림 — ${NUDGE_LABELS[kind].title}`}
                      className="switch shrink-0"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Input
                id="call-time"
                type="time"
                label="AI 코치 전화 받을 시간"
                value={callTime}
                onChange={(event) => handleChangeCallTime(event.target.value)}
                className="h-12 text-base"
              />
              <p className="text-sm break-keep text-slate-500">
                {callTime === ''
                  ? '시간을 고르면 매일 그 시간에 AI 코치가 전화를 걸어요.'
                  : `매일 ${callTime} 에 전화가 와요.`}
              </p>
              {/* 칸은 항상 두고 글자만 바꿉니다. (화면 읽기 프로그램이 바뀐 안내를 읽게 하려는 것입니다) */}
              <p role="status" className="text-sm break-keep text-red-700">
                {isCallTimeInQuietHours(callTime, toQuietHours(messageSettings))
                  ? `이 시간은 연락 금지 시간(${messageSettings.quietStart} ~ ${messageSettings.quietEnd})이라 전화가 울리지 않아요. 전화 시간이나 연락 금지 시간을 바꿔 주세요.`
                  : ''}
              </p>
            </div>

            <MessageSettingsFields value={messageSettings} onChange={handleChangeMessageSettings} />

            {/* AI 에게 말로 부탁해서 바꾸기 ("밤 10시 이후엔 연락하지 마" 등) */}
            <SettingsFromTextSection
              current={{ callTime, messageSettings }}
              onApply={handleApplyTalkedSettings}
            />

            {/* 휴대폰 앱 안에서는 앱의 알림을 씁니다. 웹(브라우저)에서만 브라우저 알림 켜기를 보여 줍니다. */}
            {isInApp() ? (
              <p className="text-sm break-keep text-slate-500">
                앱에서는 휴대폰 알림을 써요. 앱을 닫아 둬도 미션 · 카드 시작 · 전화 알림이 와요.
              </p>
            ) : (
              <details className="rounded-xl bg-slate-50 px-4">
                <summary className="flex h-11 cursor-pointer items-center text-sm font-medium text-slate-700">
                  브라우저 알림
                </summary>
                <div className="flex flex-col gap-4 pb-4">
                  {isNotificationSupported() ? (
                    <>
                      <p className="text-sm break-keep text-slate-500">
                        {notificationPermission === 'granted' && '브라우저 알림이 켜져 있어요.'}
                        {notificationPermission === 'denied' &&
                          '브라우저 알림이 거부되어 있어요. 켜려면 브라우저 주소창 옆 설정에서 알림을 허용해 주세요.'}
                        {notificationPermission === 'default' &&
                          '켜면 앱을 안 보고 있어도 새 메시지나 전화를 알려줘요.'}
                      </p>
                      {notificationPermission === 'default' && (
                        <Button
                          className="h-11 w-full sm:w-auto"
                          onClick={handleRequestNotification}
                        >
                          알림 켜기
                        </Button>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-slate-500">
                      이 브라우저는 브라우저 알림을 지원하지 않아요.
                    </p>
                  )}
                  <WebPushSection />
                </div>
              </details>
            )}
          </div>
        </Card>

        {/* ④ 내 데이터: 모든 기록 지우기 하나만 */}
        <Card title="내 데이터">
          <div className="flex flex-col gap-3">
            <p className="text-[13px] break-keep text-slate-500">
              이 기기와 서버의 공부 기록 · 체크인 · 코치와의 대화를 모두 지워요. 지우면 되돌릴 수
              없어요. 계정과 설정은 남겨요. 계정까지 지우려면 맨 아래{' '}
              {user?.id === testUser.id ? '[처음부터 다시 하기]' : '[탈퇴하기]'} 를 눌러 주세요.
            </p>
            {/* 되돌릴 수 없는 일이라 꽉 찬 빨간 버튼 대신 빨간 글자 + 선으로 둡니다. 누르면 확인창이 한 번 더 뜹니다. (2차 규칙 3) */}
            <Button
              variant="outline"
              className="w-full border-red-200 text-red-700 hover:bg-red-50 sm:w-auto"
              onClick={() => setPendingKind('all')}
              disabled={isDeletingServer}
            >
              {isDeletingServer ? '지우는 중…' : '모든 기록 지우기'}
            </Button>
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
          </div>
        </Card>

        {/* 발표 시연용 가상 데이터 (#418). 주소 끝에 ?demo=on 을 붙였을 때만 보입니다 */}
        <DemoDataSection isServerDeleting={isDeletingServer} />
      </div>

      {/* 로그아웃 · 탈퇴는 앱 설정 화면 관례대로 맨 아래에 따로 둡니다. 자주 누르는 칸과 멀리 두어 실수로 누르지 않게 합니다. (2026-10-22, 2차 규칙 3)
          로그아웃은 확인창, 탈퇴는 확인창 한 번(붙잡는 말 없이)입니다. */}
      <Card className="flex flex-col gap-4">
        <Button
          variant="ghost"
          className="w-full text-red-700 hover:bg-red-50"
          onClick={() => setIsLogoutOpen(true)}
        >
          로그아웃
        </Button>
        <LeaveAccountSection
          isTestUser={user?.id === testUser.id}
          className="border-t border-slate-100 pt-4"
        />
      </Card>

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

      {/* 코치 세기를 "강" 으로 올리기 전에 한 번 더 물어봅니다. (올린 값은 내일부터 적용됩니다) */}
      <Modal
        isOpen={confirmStrength !== null}
        onClose={() => setConfirmStrength(null)}
        title="정말 올릴까요?"
      >
        {confirmStrength !== null && (
          <>
            <p className="font-medium text-slate-900">
              코치 세기를 &apos;{confirmStrength.label}&apos; 으로 올릴까요?
            </p>
            <p className="mt-2 text-sm text-slate-600">{confirmStrength.description}</p>
            <p className="mt-2 text-sm text-slate-600">
              올린 한도는 내일부터 적용돼요. 힘들면 언제든 다시 낮출 수 있고, 낮추는 건 바로
              적용돼요.
            </p>
            <div className="mt-5 flex gap-3">
              <Button
                variant="secondary"
                size="lg"
                className="flex-1"
                onClick={() => setConfirmStrength(null)}
              >
                취소
              </Button>
              <Button
                size="lg"
                className="flex-1"
                onClick={() => {
                  applyStrength(confirmStrength)
                  setConfirmStrength(null)
                }}
              >
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
          다른 사람과 같이 쓰는 기기라면, 위 &quot;내 데이터&quot; 에서 기록을 먼저 지워 주세요.
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

interface SettingsFromTextSectionProps {
  /** 지금 설정 (전화 시간 · 메시지 설정) */
  current: TalkableSettings
  /** 변경안을 받아들였을 때 새 설정을 넘깁니다 */
  onApply: (next: TalkableSettings) => void
}

/**
 * 말로 설정 바꾸기 (#419 ⑩). "아침엔 알림 꺼 줘" 처럼 적으면 AI 가 변경안을 만들고,
 * 학생이 "지금 → 바꿀 값" 을 확인하고 [이렇게 바꿀게요] 를 눌러야 바뀝니다. (lib/aiSettingsApi.ts)
 * 숫자 · 시각은 코드가 검사한 값만 보여 주고, AI 의 문장은 설명 한 줄로만 씁니다.
 */
function SettingsFromTextSection({ current, onApply }: SettingsFromTextSectionProps) {
  const isServerData = useIsServerData()
  const [text, setText] = useState('')
  // 방금 바꾼 내용 한 줄. 바꾼 뒤 "바꿨어요" 안내에 씁니다.
  const [appliedSummary, setAppliedSummary] = useState('')
  // useMutation: 버튼을 눌렀을 때만 서버에 묻는 요청입니다. 기다리는 중 · 결과를 대신 들고 있습니다. (docs/DATA-FETCHING.md 5장)
  const mutation = useMutation({ mutationFn: requestSettingsFromText })
  const result = mutation.data
  const rows = result?.kind === 'proposal' ? getSettingsChangeRows(result.proposal, current) : []

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // form 이 기본으로 하는 "페이지 새로고침" 을 막습니다.
    event.preventDefault()
    if (text.trim() === '' || mutation.isPending) return
    setAppliedSummary('')
    mutation.mutate(text)
  }

  function handleApply() {
    if (result?.kind !== 'proposal') return
    onApply(applySettingsProposal(result.proposal, current))
    setAppliedSummary(result.proposal.summary)
    setText('')
    mutation.reset()
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3">
      <h4 className="text-[15px] font-semibold text-slate-900">말로 바꾸기</h4>
      <p className="text-sm break-keep text-slate-600">
        예) &quot;아침엔 알림 꺼 줘&quot; · &quot;전화는 밤 9시에 해 줘&quot;. 전화 시간 · 메시지 수
        · 연락 금지 시간만 바꿀 수 있어요.
      </p>

      {!isServerData ? (
        <p className="text-sm break-keep text-slate-500">
          구글로 로그인한 계정에서만 쓸 수 있어요. 아래에서 직접 바꿔 주세요.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Input
              id="settings-from-text"
              aria-label="바꾸고 싶은 것"
              value={text}
              maxLength={SETTINGS_TEXT_MAX_LENGTH}
              placeholder="바꾸고 싶은 것을 적어 주세요"
              onChange={(event) => setText(event.target.value)}
              className="h-10 bg-white text-base"
            />
          </div>
          {/* 설정 화면에 꽉 찬 버튼이 몰리지 않게 회색 작은 버튼으로 둡니다. (입력칸과 같은 40px 높이) */}
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            className="shrink-0 bg-white hover:bg-slate-100"
            disabled={text.trim() === '' || mutation.isPending}
          >
            변경안 보기
          </Button>
        </form>
      )}

      {/* AI 가 답하는 동안 변경안 자리에 회색 상자를 둡니다. */}
      {mutation.isPending && <Skeleton className="h-24 w-full" />}

      {result?.kind === 'proposal' && rows.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3">
          <p className="flex flex-wrap items-center gap-2 text-sm break-keep text-slate-900">
            <span className="bg-brand-light text-brand shrink-0 rounded px-1.5 py-0.5 text-xs font-medium">
              AI 추천
            </span>
            {result.proposal.summary}
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {rows.map((row) => (
              <li key={row.label} className="flex flex-wrap justify-between gap-x-3">
                <span className="text-slate-600">{row.label}</span>
                <span className="font-medium text-slate-900">
                  {row.from} → {row.to}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="w-full sm:w-auto" onClick={handleApply}>
              이렇게 바꿀게요
            </Button>
            <Button variant="ghost" className="w-full sm:w-auto" onClick={() => mutation.reset()}>
              안 바꿀게요
            </Button>
          </div>
        </div>
      )}

      {result?.kind === 'proposal' && rows.length === 0 && (
        <p role="status" className="text-sm break-keep text-slate-600">
          이미 그렇게 되어 있어요.
        </p>
      )}
      {result?.kind === 'none' && (
        <p role="status" className="text-sm break-keep text-slate-600">
          말로는 바꿀 수 없는 부탁이거나, 바꿀 것이 없었어요. 아래에서 직접 바꿔 주세요.
        </p>
      )}
      {result?.kind === 'failed' && (
        <p role="status" className="text-sm break-keep text-red-700">
          지금은 AI 가 답하지 못했어요. 잠시 뒤 다시 하거나 아래에서 직접 바꿔 주세요.
        </p>
      )}
      {/* 글에 위기 표현이 있으면 서버가 AI 를 쓰지 않습니다. 설정은 그대로 둡니다. */}
      {result?.kind === 'help' && (
        <p role="status" className="text-sm break-keep text-slate-600">
          설정은 그대로 두었어요. 오늘은 무리하지 말고 쉬어 가도 괜찮아요.
        </p>
      )}

      {appliedSummary !== '' && (
        <p role="status" className="text-sm break-keep text-emerald-700">
          바꿨어요. {appliedSummary}
        </p>
      )}
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
      {/* 아이폰인데 홈 화면 앱이 아니면 위 문구로만 알려 줍니다. 홈의 설치 안내(#105)는 2026-10-19 에 꺼서 그리로 가는 버튼도 뺐습니다. */}
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

/**
 * 발표 시연용 가상 데이터를 넣고 빼는 카드입니다. (#418, lib/demoData.ts)
 * 학생이 실수로 누르지 않도록, 설정 주소 끝에 ?demo=on 을 붙였을 때(/settings?demo=on)만 보입니다.
 * 이미 넣은 상태거나 개발 중(pnpm dev)이면 언제나 보여서 지울 수 있습니다.
 */
interface DemoDataSectionProps {
  /** "모든 기록 지우기" 가 서버 기록을 지우는 중인지. 그동안은 버튼을 잠급니다. */
  isServerDeleting: boolean
}

function DemoDataSection({ isServerDeleting }: DemoDataSectionProps) {
  const [demoParam] = useQueryParam('demo', 'off')
  const [isSeeded] = useState(isDemoSeeded)
  // 발표 화면에 잡다한 칸이 보이지 않게, 주소 끝에 ?demo=on 을 붙였을 때만 보입니다. (지울 때도 ?demo=on 으로)
  if (demoParam !== 'on') return null

  function handleAdd() {
    addDemoData()
    // 화면들은 저장소를 처음 열 때만 읽어서, 새로고침해야 새 데이터가 보입니다.
    window.location.reload()
  }

  function handleRemove() {
    removeDemoData()
    window.location.reload()
  }

  return (
    <Card title="시연용 가상 데이터" className="border-dashed bg-slate-50">
      <p className="text-sm break-keep text-slate-500">
        발표용 가상 학생의 28일(카드 · 공부 기록 · 목표 2개 · 학원 일정 · 체크인 · 관리 단계 ·
        실험)을 넣어요. 온보딩이 비어 있으면 끝낸 상태로 채워요. 지우기를 누르면 넣은 것만 빠지고 내
        기록은 남아요.
      </p>
      {/* 넣기 · 지우기는 바로 새로고침해서, 서버 기록을 지우는 중에 누르면 지우기가 끊깁니다. 그동안은 잠급니다. */}
      {isServerDeleting && (
        <p className="mt-3 text-sm break-keep text-slate-600">
          서버 기록을 다 지운 뒤에 누를 수 있어요.
        </p>
      )}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <Button className="h-11 w-full sm:flex-1" onClick={handleAdd} disabled={isServerDeleting}>
          {isSeeded ? '가상 데이터 다시 넣기' : '가상 데이터 넣기'}
        </Button>
        {isSeeded && (
          <Button
            variant="secondary"
            className="h-11 w-full sm:flex-1"
            onClick={handleRemove}
            disabled={isServerDeleting}
          >
            가상 데이터 지우기
          </Button>
        )}
      </div>
    </Card>
  )
}

interface SchoolTrackSettingsProps {
  /** 가입 때 고른 학교의 NEIS 번호 */
  schoolCode: string
  className?: string
}

/**
 * 설정 › 계정의 학과 · 계열 칸. 고르면 바로 이 기기에 저장합니다. (lib/schoolTrack.ts)
 * 고르는 칸 자체는 가입 화면과 같은 부품(components/ui/SchoolTrackField.tsx)입니다.
 */
function SchoolTrackSettings({ schoolCode, className }: SchoolTrackSettingsProps) {
  const [track, setTrack] = useState(() => loadSchoolTrack(schoolCode))
  const [isSaved, setIsSaved] = useState(false)

  function handleChange(next: SchoolTrack | null) {
    saveSchoolTrack(next)
    setTrack(next)
    setIsSaved(true)
  }

  return (
    <div className={className}>
      <SchoolTrackField schoolCode={schoolCode} value={track} onChange={handleChange} />
      {isSaved && (
        <p role="status" className="mt-2 text-sm text-slate-600">
          {track ? '저장했어요.' : '지웠어요.'}
        </p>
      )}
    </div>
  )
}

/**
 * 설정 › 계정의 "내가 준비하는 것" (내신 · 수능 · 대회·자격증 · 기타 + 이름). 이 화면에서만 써서 여기에 둡니다.
 * 코치가 대화에서 묻는 것과 같은 저장소(lib/studyFocus.ts)입니다.
 */
function StudyFocusField({ className }: { className?: string }) {
  const [focus, setFocus] = useState(loadStudyFocus)
  const [name, setName] = useState(focus?.name ?? '')
  const [isSaved, setIsSaved] = useState(false)

  function handleChoose(kind: StudyFocusKind) {
    // 대회 · 기타는 적어 둔 이름을 같이 남기고, 내신 · 수능은 이름 없이 저장합니다.
    const next = { kind, name: needsFocusName(kind) ? cleanFocusName(name) : null }
    saveStudyFocus(next)
    setFocus(next)
    setIsSaved(true)
  }

  function handleSaveName(event: FormEvent) {
    event.preventDefault()
    if (focus === null) return
    const next = { ...focus, name: cleanFocusName(name) }
    saveStudyFocus(next)
    setFocus(next)
    setIsSaved(true)
  }

  return (
    <div className={className}>
      <p className="text-[15px] font-semibold text-slate-900">내가 준비하는 것</p>
      <p className="mt-1 text-[13px] break-keep text-slate-500">
        코치가 오늘 계획을 짤 때 이걸 보고 맞춰요.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {STUDY_FOCUS_OPTIONS.map((option) => (
          <ChipButton
            key={option.kind}
            selected={focus?.kind === option.kind}
            onClick={() => handleChoose(option.kind)}
          >
            {`${option.emoji} ${option.label}`}
          </ChipButton>
        ))}
      </div>
      {focus && needsFocusName(focus.kind) && (
        <form onSubmit={handleSaveName} className="mt-3 flex items-end gap-2">
          {/* 늘어나는 것은 바깥 칸입니다. Input 의 className 은 입력칸 자체에 붙어서,
              거기에 flex-1 을 주면 높이(h-12)가 줄어 19px 이 됩니다. (2026-10-25 QA) */}
          <div className="min-w-0 flex-1">
            <Input
              label="이름"
              value={name}
              maxLength={FOCUS_NAME_MAX}
              onChange={(event) => setName(event.target.value)}
              placeholder={focus.kind === 'CONTEST' ? '예: 정보올림피아드' : '예: 코딩 공부'}
            />
          </div>
          <Button type="submit" variant="secondary" className="shrink-0">
            이름 저장
          </Button>
        </form>
      )}
      {isSaved && (
        <p role="status" className="mt-2 text-sm text-slate-600">
          저장했어요.
        </p>
      )}
    </div>
  )
}
