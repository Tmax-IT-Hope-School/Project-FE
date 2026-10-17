import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FocusUnlockScreen } from '@/components/ui/FocusUnlockScreen'
import { MinutesPicker } from '@/components/ui/MinutesPicker'
import { PlayBadge } from '@/components/ui/PlayBadge'
import { Modal } from '@/components/ui/Modal'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { SubjectBadge } from '@/components/ui/SubjectBadge'
import { VoicePledgePlayButton } from '@/components/ui/VoicePledgePlayButton'
import { useAwayDetection } from '@/hooks/useAwayDetection'
import { useFocusMode } from '@/hooks/useFocusMode'
import { useKeepScreenOn } from '@/hooks/useKeepScreenOn'
import { usePlans } from '@/hooks/usePlans'
import { useStopwatch } from '@/hooks/useStopwatch'
import { useStudySessions } from '@/hooks/useStudySessions'
import { playAlarm } from '@/lib/alarm'
import { formatAwayDuration, formatClock } from '@/lib/away'
import { getCareLimits } from '@/lib/careLimits'
import { cn } from '@/lib/cn'
import {
  DEFAULT_TARGET_MINUTES,
  MAX_TARGET_MINUTES,
  MIN_TARGET_MINUTES,
  TARGET_PRESETS,
  formatCountdown,
  getCountdownStatus,
  getTargetHint,
  normalizeTargetMinutes,
} from '@/lib/countdown'
import { DAY_START_HOUR, getTodayKey, toDayDate, toDayKey } from '@/lib/date'
import {
  canUseFocusMode,
  closeFocusLeaveNotification,
  isSafetyBrakeOnNow,
  showFocusLeaveNotification,
} from '@/lib/focusMode'
import { getNotificationPermission } from '@/lib/notifications'
import { PHONE_FOCUS_PATH } from '@/lib/phoneFocus'
import { missReasonOptions } from '@/lib/missReasons'
import { useSubjects } from '@/hooks/useSubjects'
import { getPlanProgress } from '@/lib/planProgress'
import {
  BREAK_MINUTES,
  STUDY_MINUTES,
  getPomodoroBreakSeconds,
  getPomodoroStatus,
} from '@/lib/pomodoro'
import { loadData, saveData } from '@/lib/storage'
import { getStudyMs } from '@/lib/studyTime'
import { getTargetRecommendation, type TargetRecommendation } from '@/lib/targetRecommend'
import { sortPlansForNow } from '@/lib/timeline'
import { getTimerDisplay, loadTimerMode, type TimerMode } from '@/lib/timerDisplay'
import { loadVoicePledge } from '@/lib/voicePledge'
import type {
  AwayRecord,
  MissReason,
  PomodoroPhase,
  StudyPlan,
  StudySession,
  Subject,
  SubjectColor,
} from '@/types'

// 1분 미만은 실수로 누른 것으로 보고 기록을 저장하지 않습니다.
const MIN_SAVE_SECONDS = 60

// 타이머 방식(TimerMode)과 시간 글자를 만드는 함수는 홈에서도 쓰여서 lib/timerDisplay.ts 에 있습니다.
const modeOptions: { mode: TimerMode; label: string }[] = [
  { mode: 'target', label: '목표 정하기' },
  { mode: 'pomodoro', label: '뽀모도로' },
  { mode: 'free', label: '목표 없이' },
]

// 오늘 하루 공부한 시간(분)을 '2시간 14분' / '40분' 형태로 바꿔줍니다.
function formatTotalMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours === 0) return `${minutes}분`
  return `${hours}시간 ${minutes}분`
}

/** 그 기록이 오늘 시작한 기록인지 확인합니다. */
function isToday(session: StudySession) {
  return toDayKey(session.startedAt) === getTodayKey()
}

export function TimerPage() {
  // startedAt·pauseCount 는 새로고침해도 이어져야 해서 useStopwatch 안에서 같이 저장합니다.
  const {
    seconds,
    isRunning,
    isStarted,
    startedAt,
    pauseCount,
    getPausedMs,
    start,
    pause,
    autoPause,
    stop,
  } = useStopwatch()
  // sessions: 공부 기록만 (오늘 총 공부 시간 등) / allSessions: 노는 기록까지 (계획별 실제 시간)
  const { sessions, allSessions, addSession } = useStudySessions()

  // 계획 화면에서 저장한 과목 목록을 그대로 불러옵니다. (저장된 게 없으면 가짜 데이터)
  const subjects = useSubjects()
  // 고른 과목도 저장해 둡니다. 새로고침했는데 과목만 사라지면 "공부 중인데 무슨 과목인지 모르는" 상태가 되기 때문입니다.
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(() =>
    loadData<string | null>('timer-subject', null),
  )

  useEffect(() => {
    saveData('timer-subject', selectedSubjectId)
  }, [selectedSubjectId])

  const selectedSubject = subjects.find((subject) => subject.id === selectedSubjectId)

  // 지금 하고 있는 계획의 id. 계획 없이 공부하면 null 입니다. 새로고침해도 "하는 중인 계획" 이 이어지게 저장합니다.
  const [activePlanId, setActivePlanId] = useState<string | null>(() =>
    loadData<string | null>('timer-plan', null),
  )

  useEffect(() => {
    saveData('timer-plan', activePlanId)
  }, [activePlanId])

  // 목표 시간 전에 정지를 눌렀을 때 뜨는 확인 창의 단계입니다. (#233)
  //  closed: 닫힘 / confirm: "계속할까요?" 를 묻는 중 / reason: 그만하는 이유를 고르는 중
  const [stopStep, setStopStep] = useState<'closed' | 'confirm' | 'reason'>('closed')

  // 계획을 시작하지 못했을 때 보여줄 안내 (이미 다른 공부를 재는 중일 때 등)
  const [planNotice, setPlanNotice] = useState<string | null>(null)

  // 계획에서 시작하려는데 추천 목표가 있을 때, "몇 분으로 할지" 묻는 중인 계획과 추천입니다. 안 묻는 중이면 null (#246)
  const [planOffer, setPlanOffer] = useState<{
    plan: StudyPlan
    recommendation: TargetRecommendation
  } | null>(null)
  // 목표 시간 버튼(MinutesPicker)을 새로 그리게 하는 번호입니다. 추천을 받아들여 목표가 바뀌면 1 올립니다.
  const [pickerVersion, setPickerVersion] = useState(0)

  // 타이머 방식(목표 정하기·뽀모도로·목표 없이). 새로고침해도 유지되도록 저장합니다.
  const [mode, setMode] = useState<TimerMode>(loadTimerMode)

  useEffect(() => {
    saveData('timer-mode', mode)
  }, [mode])

  // 시작할 때 약속한 목표 시간(분). 이것도 바로 저장합니다.
  // 휴대폰은 뒤에 있던 탭을 버려서 돌아올 때 새로고침될 수 있는데, 그래도 목표와 남은 시간이 이어져야 하기 때문입니다.
  const [targetMinutes, setTargetMinutes] = useState(() =>
    normalizeTargetMinutes(loadData<unknown>('timer-target', DEFAULT_TARGET_MINUTES)),
  )

  useEffect(() => {
    saveData('timer-target', targetMinutes)
  }, [targetMinutes])

  const isTarget = mode === 'target'
  // 고른 목표 시간이 어느 정도 길이인지 알려 주는 한 줄. 버튼에 없는 값이면 null (lib/countdown.ts)
  const targetHint = getTargetHint(targetMinutes)
  // 고른 과목의 최근 기록으로 알맞은 목표 시간을 추천합니다. 추천할 것이 없으면 null (lib/targetRecommend.ts · #246)
  const targetRecommendation =
    selectedSubjectId === null
      ? null
      : getTargetRecommendation(allSessions, selectedSubjectId, targetMinutes)
  // 목표 정하기는 스톱워치가 센 "흐른 시간"과 목표 시간으로 남은 시간을 계산합니다. (lib/countdown.ts)
  const countdown = getCountdownStatus(seconds, targetMinutes)
  // 목표를 채웠는지. 채운 뒤에도 타이머는 멈추지 않고 "더 한 시간"을 셉니다.
  const isTargetDone = isTarget && countdown.isOver

  const isPomodoro = mode === 'pomodoro'
  // 뽀모도로는 스톱워치가 센 "흐른 시간"으로 지금이 공부인지 휴식인지 계산합니다.
  const pomodoro = getPomodoroStatus(seconds)
  const isBreak = isPomodoro && pomodoro.phase === 'break'

  // 화면에 크게 보여줄 시간 글자입니다. 홈의 "진행 중인 타이머" 와 같은 함수로 만듭니다. (lib/timerDisplay.ts)
  //  - 목표 없이: 흐른 시간이 늘어남              00:12:34
  //  - 뽀모도로: 이번 구간의 남은 시간이 줄어듦    00:24:59
  //  - 목표 정하기: 남은 시간이 줄어들고, 목표를 채우면 더 한 시간을 + 로 보여줌   37:48 → +03:12
  const { timeText } = getTimerDisplay(mode, seconds, targetMinutes)

  // 목표를 방금 채웠을 때 띄우는 안내입니다.
  const [isTargetNoticeOpen, setIsTargetNoticeOpen] = useState(false)
  // 직전에 확인했을 때 목표를 채운 상태였는지. 이 값과 비교해서 "방금 채웠는지" 알아냅니다.
  const wasTargetDone = useRef(isTargetDone)

  useEffect(() => {
    // 못 채움 → 채움 으로 바뀐 순간에만 한 번 알립니다.
    // (새로고침했을 때 이미 채운 상태라면 처음 값이 true 라서 다시 울리지 않습니다.)
    if (isTargetDone && !wasTargetDone.current) {
      setIsTargetNoticeOpen(true)
      playAlarm()
    }
    wasTargetDone.current = isTargetDone
  }, [isTargetDone])

  // 구간이 막 끝났을 때 화면에 띄울 안내입니다. (방금 끝난 게 공부인지 휴식인지 기억해 둡니다)
  const [endedPhase, setEndedPhase] = useState<PomodoroPhase | null>(null)
  // 직전에 확인한 구간 번호. 이 번호와 비교해서 "구간이 바뀌었는지" 알아냅니다.
  const lastPhaseNumber = useRef(pomodoro.phaseNumber)

  useEffect(() => {
    // 구간 번호가 커졌을 때만 = 구간이 방금 끝났을 때만 알립니다.
    // (정지하면 번호가 0 으로 줄어들고, 새로고침 직후에는 번호가 그대로라서 알리지 않습니다.)
    if (isPomodoro && pomodoro.phaseNumber > lastPhaseNumber.current) {
      // 지금이 공부 구간이면 방금 끝난 건 휴식이고, 휴식 구간이면 방금 끝난 건 공부입니다.
      setEndedPhase(pomodoro.phase === 'study' ? 'break' : 'study')
      playAlarm()
    }
    lastPhaseNumber.current = pomodoro.phaseNumber
  }, [isPomodoro, pomodoro.phase, pomodoro.phaseNumber])

  // 시작한 뒤 '정지'를 누르기 전까지는 공부 중입니다. 일시정지 중에도 같은 공부가 이어지는 것이라 포함합니다.
  // (뽀모도로의 휴식 구간도 같은 공부 흐름 안에 있어서 포함합니다.)
  const isStudying = isStarted

  // 오늘 저장된 기록만 모아서 분 단위로 더합니다. (일시정지한 시간은 뺀 순공시간입니다)
  const todayTotalMinutes = Math.floor(
    sessions.filter(isToday).reduce((sum, session) => sum + getStudyMs(session), 0) / 60000,
  )

  const { allPlans, getPlans, completePlan } = usePlans()
  const todayPlans = getPlans(getTodayKey())
  // 하는 중인 계획. 계획 없이 공부 중이거나 계획이 지워졌으면 undefined 입니다.
  const activePlan = allPlans.find((plan) => plan.id === activePlanId)
  // 노는 계획으로 타이머를 켠 상태인지. 노는 중에는 딴짓 감지 · 화면 켜 두기 · 그만하기 확인을 하지 않습니다. (#238)
  const isPlay = isStarted && activePlan?.kind === 'play'

  // 타이머가 흐르는 동안에는 휴대폰 화면이 자동으로 꺼지지 않게 합니다. (#234)
  // 책을 보느라 화면을 안 만져서 꺼지는 것까지 "나갔다" 로 세지 않기 위해서입니다. (노는 중에는 필요 없습니다)
  useKeepScreenOn(isRunning && !isPlay)

  // 공부 중에 다른 탭·앱으로 나가면 자동으로 일시정지하고, 돌아오면 안내를 띄우며 딴짓으로 기록합니다. (#22)
  // 30분 안에 돌아오면 타이머가 저절로 이어서 흐릅니다. (#234)
  // 뽀모도로 휴식 중이거나 노는 중에는 나가도 괜찮아서 isResting 으로 알려 줍니다.
  const { awayNotice, awayCountToday, dismissAwayNotice } = useAwayDetection({
    isStarted,
    isRunning,
    isResting: isBreak || isPlay,
    subjectId: selectedSubjectId,
    // 저절로 멈출 때는 일시정지 횟수를 올리지 않는 autoPause 를 씁니다. (횟수는 내가 직접 멈춘 것만 셉니다)
    pause: autoPause,
    start,
    // 집중 모드 중에 나가면 바로 "돌아와" 알림을 띄우고, 돌아오면 닫습니다. (집중 모드가 아니면 아무 일도 하지 않습니다)
    // void: 알림이 떴는지 기다리지 않습니다. 못 띄워도 타이머는 그대로 멈추고 기록됩니다.
    onLeave: () => void showFocusLeaveNotification(),
    onReturn: () => void closeFocusLeaveNotification(),
  })

  // 집중 모드(#69). 설정에서 "집중 모드 잠금 허용" 을 켰고 최대 한도가 4일 때만 버튼이 보입니다. (#59)
  const focusMode = useFocusMode()
  const [canUseFocus] = useState(() => canUseFocusMode(getCareLimits()))
  // "집중 모드 나가기" 를 눌러 해제 화면을 보고 있는지
  const [isUnlockOpen, setIsUnlockOpen] = useState(false)
  // 집중 모드를 켜지 못했을 때 보여줄 안내
  const [focusNotice, setFocusNotice] = useState<string | null>(null)

  // 타이머에서 바로 시작할 수 있는 계획 = 오늘 계획 중 아직 안 끝난 것
  const startablePlans = todayPlans.filter((plan) => !plan.done)

  // 노는 시간이 끝났을 때 권할 다음 공부 계획 = 오늘의 안 끝난 공부 계획 중 "지금 할 순서" 의 맨 앞 (lib/timeline.ts)
  // 노는 시간이 끝났을 때만 필요해서 그때만 구합니다. 없으면 undefined 입니다.
  const clockNow = new Date()
  const nextStudyPlan =
    isPlay && isTargetDone
      ? sortPlansForNow(
          todayPlans.filter((plan) => !plan.done && plan.kind !== 'play'),
          clockNow.getHours() * 60 + clockNow.getMinutes(),
        )[0]
      : undefined
  const nextSubject = subjects.find((subject) => subject.id === nextStudyPlan?.subjectId)

  // 타이머 위의 상태 표시(공부 중 · 휴식 중 · 노는 중)에 쓸 글자와 색
  let statusLabel = '공부 중'
  let statusClass = 'bg-emerald-50 text-emerald-600'
  let statusDotClass = 'bg-emerald-500'
  if (isBreak) {
    statusLabel = '휴식 중'
    statusClass = 'bg-sky-50 text-sky-600'
    statusDotClass = 'bg-sky-500'
  }
  if (isPlay) {
    statusLabel = '노는 중'
    statusClass = 'bg-slate-100 text-slate-600'
    statusDotClass = 'bg-slate-500'
  }

  // 다른 탭·앱에 다녀올 때 어떻게 되는지 알려주는 문구
  let awayHelp =
    '공부 중에는 화면이 꺼지지 않아요. 다른 탭이나 앱에 다녀오면 그 시간은 빼고 이어서 재요.'
  if (isBreak) awayHelp = '쉬는 중에는 다른 탭에 가도 괜찮아요.'
  if (isPlay) awayHelp = '노는 중에는 다른 탭이나 앱에 가도 괜찮아요. 시간은 계속 흘러요.'

  // 집중 화면에 보여줄 오늘 계획: 고른 과목의 오늘 계획 내용과 목표 시간
  const todaySubjectPlans = todayPlans.filter((plan) => plan.subjectId === selectedSubjectId)
  const todayTargetMinutes = todaySubjectPlans.reduce((sum, plan) => sum + plan.targetMinutes, 0)
  // 오늘 이 과목으로 이미 저장한 공부 + 지금 재고 있는 시간
  const todaySubjectMinutes =
    Math.floor(
      sessions
        .filter((session) => isToday(session) && session.subjectId === selectedSubjectId)
        .reduce((sum, session) => sum + getStudyMs(session), 0) / 60000,
    ) + Math.floor(seconds / 60)

  // 버튼 아래에 보여줄 안내 문구
  let helpMessage = '준비됐으면 시작을 눌러 주세요.'
  if (isTarget) {
    helpMessage = `시작하면 ${formatCountdown(targetMinutes * 60)} 에서 0 으로 줄어들어요.`
  }
  if (isPlay) helpMessage = '노는 시간도 계획이에요. 끝나면 다음 공부를 한 번에 시작할 수 있어요.'
  else if (!selectedSubject) helpMessage = '공부할 과목을 먼저 골라 주세요.'
  else if (isStudying)
    helpMessage = '공부 중에는 과목·방식·목표 시간을 바꿀 수 없어요. 바꾸려면 정지를 눌러 주세요.'

  function handleSelectSubject(subjectId: string) {
    // 공부 중에는 과목을 바꾸지 못하게 막습니다. (버튼도 disabled 지만 한 번 더 확인)
    if (isStudying) return
    setSelectedSubjectId(subjectId)
    setPlanNotice(null)
  }

  function handleChangeMode(nextMode: TimerMode) {
    // 공부 중에 모드를 바꾸면 시간이 뒤섞이므로 막습니다. (버튼도 disabled 지만 한 번 더 확인)
    if (isStudying) return
    setMode(nextMode)
  }

  function handleChangeTarget(nextMinutes: number) {
    // 시작할 때 한 약속이라, 공부 중에는 목표 시간을 바꾸지 못합니다.
    if (isStudying) return
    setTargetMinutes(normalizeTargetMinutes(nextMinutes))
  }

  /** "추천 ○분으로 하기" 를 눌렀을 때. 목표 시간만 바꾸고, 시작은 사용자가 직접 누릅니다. */
  function handleAcceptRecommendation(minutes: number) {
    handleChangeTarget(minutes)
    // MinutesPicker 는 "버튼에 없는 값(직접 입력)인지" 를 처음 그려질 때만 정합니다.
    // 번호(key)를 바꿔 새로 그리게 해야 35분 같은 값이 "직접" 칸에 제대로 보입니다.
    setPickerVersion((prev) => prev + 1)
  }

  /**
   * 이 계획을 시작할 때 권할 목표 시간을 구합니다. 권할 것이 없으면 null 입니다.
   * 노는 계획, 과목이 지워진 계획, 하다 만 계획(남은 시간만큼만 이어 하는 경우)에는 권하지 않습니다.
   */
  function getPlanRecommendation(plan: StudyPlan): TargetRecommendation | null {
    if (plan.kind === 'play') return null
    if (!subjects.some((subject) => subject.id === plan.subjectId)) return null
    if (getPlanProgress(plan, allSessions).actualMinutes > 0) return null
    return getTargetRecommendation(allSessions, plan.subjectId, plan.targetMinutes)
  }

  /** "몇 분으로 할까?" 에 답했을 때. minutes 가 null 이면 계획의 목표 그대로 시작합니다. */
  function handleAnswerPlanOffer(minutes: number | null) {
    if (planOffer === null) return
    setPlanOffer(null)
    beginPlan(planOffer.plan, minutes ?? undefined)
  }

  function handleStart() {
    // 다시 시작하면 "딴짓 감지" 안내는 할 일을 마친 것이라 지웁니다.
    dismissAwayNotice()
    start()
  }

  /** 계획 하나를 골라서 바로 시작합니다. 과목과 목표 시간을 계획에서 가져옵니다. */
  function handleStartPlan(plan: StudyPlan) {
    // 이미 다른 공부를 재는 중이면 기록이 섞이지 않게 막고 안내합니다.
    if (isStudying) {
      setPlanNotice(
        '지금 하던 걸 먼저 끝내 주세요. 정지(마치기)한 뒤에 다른 계획을 시작할 수 있어요.',
      )
      return
    }

    // 계획의 목표와 다른 추천이 있으면, 바로 시작하지 않고 몇 분으로 할지 먼저 묻습니다. (#246)
    const recommendation = getPlanRecommendation(plan)
    if (recommendation !== null) {
      setPlanOffer({ plan, recommendation })
      return
    }
    beginPlan(plan)
  }

  /**
   * 그 계획으로 타이머를 시작합니다. 지금 재는 중인지는 여기서 확인하지 않습니다. (부르는 쪽에서 먼저 정리합니다)
   * 노는 계획은 과목이 없어서 과목 없이 시작합니다. (#238)
   *
   * overrideMinutes 를 넣으면 이번 타이머의 목표만 그 값으로 합니다. 계획의 목표 시간은 바뀌지 않습니다. (#246)
   */
  function beginPlan(plan: StudyPlan, overrideMinutes?: number) {
    const isPlayPlan = plan.kind === 'play'
    if (!isPlayPlan && !subjects.some((subject) => subject.id === plan.subjectId)) {
      setPlanNotice('이 계획의 과목이 지워졌어요. 아래에서 과목을 골라 시작해 주세요.')
      return
    }

    const progress = getPlanProgress(plan, allSessions)
    setPlanNotice(null)
    setMode('target')
    setSelectedSubjectId(isPlayPlan ? null : plan.subjectId)
    // 전에 하다 만 계획이면 남은 시간만큼만, 처음이면 계획한 시간 그대로 약속합니다.
    // 추천을 받아들였으면(overrideMinutes) 그 값으로 약속합니다.
    const planMinutes =
      progress.remainingMinutes > 0 ? progress.remainingMinutes : plan.targetMinutes
    setTargetMinutes(normalizeTargetMinutes(overrideMinutes ?? planMinutes))
    setActivePlanId(plan.id)
    handleStart()
  }

  // 계획 화면의 [▶ 시작] 은 주소에 ?plan=계획id 를 붙여서 이 화면으로 옵니다. 그 계획으로 바로 시작합니다.
  const [searchParams, setSearchParams] = useSearchParams()
  const planIdFromUrl = searchParams.get('plan')

  useEffect(() => {
    if (planIdFromUrl === null) return
    // 주소의 ?plan= 은 한 번 쓰고 지웁니다. 남겨 두면 새로고침할 때마다 다시 시작하려고 하기 때문입니다.
    setSearchParams({}, { replace: true })

    const plan = allPlans.find((item) => item.id === planIdFromUrl)
    if (!plan) return
    // 그 계획을 이미 하는 중이면 그대로 둡니다.
    if (isStarted && plan.id === activePlanId) return
    handleStartPlan(plan)
    // [planIdFromUrl]: 주소의 계획이 바뀔 때만 실행합니다. 나머지 값은 그 순간의 값을 쓰면 됩니다.
  }, [planIdFromUrl])

  /** 정지 버튼을 눌렀을 때. 목표 시간이 남았으면 바로 끝내지 않고 한 번 더 묻습니다. */
  function handleStopClick() {
    // 묻는 경우: 목표 정하기로 재는 중이고, 아직 목표를 못 채웠고, 1분 넘게 한 경우
    // (목표를 채웠거나 목표 없이 재는 중이면 바로 저장하고, 1분 미만이면 지금처럼 저장 없이 끝냅니다)
    // 노는 타이머는 일찍 끝내도 묻지 않습니다. (덜 논 것을 말릴 이유가 없습니다)
    if (isTarget && !isTargetDone && seconds >= MIN_SAVE_SECONDS && !isPlay) {
      setStopStep('confirm')
      return
    }
    finishSession()
  }

  /**
   * 기록을 저장하고 타이머를 처음 상태로 돌립니다.
   * stopReason 은 목표 전에 그만둘 때 고른 이유입니다. 안 골랐으면(건너뛰기) 넘기지 않습니다.
   */
  function finishSession(stopReason?: MissReason) {
    const endedAt = Date.now()
    // 뽀모도로의 휴식 구간은 공부한 시간이 아니라서 뺍니다. (일반 모드에는 휴식 구간이 없어서 0 입니다)
    const breakSeconds = isPomodoro ? getPomodoroBreakSeconds(seconds) : 0
    const studySeconds = seconds - breakSeconds

    // 1분 미만은 실수로 누른 것으로 보고 저장하지 않습니다. (노는 기록은 과목이 없어도 저장합니다)
    if ((selectedSubject || isPlay) && startedAt !== null && studySeconds >= MIN_SAVE_SECONDS) {
      const newSession: StudySession = {
        id: `session-${endedAt}`,
        // 노는 기록은 과목이 없어서 빈 글자입니다.
        subjectId: selectedSubject?.id ?? '',
        startedAt,
        endedAt,
        pauseCount,
        // 순공시간에서 빠질 시간 = 일시정지해 있던 시간 + 뽀모도로 휴식 시간
        pausedMs: getPausedMs(endedAt) + breakSeconds * 1000,
        // 목표 정하기로 쟀을 때만 약속한 시간을 같이 남깁니다. (나중에 "목표를 채웠는지"를 이 값으로 봅니다)
        ...(isTarget ? { targetMinutes } : {}),
        // 계획에서 시작했으면 어느 계획인지 남깁니다. (계획별 실제 시간을 이 값으로 모읍니다)
        ...(activePlan ? { planId: activePlan.id } : {}),
        // 목표 전에 그만두면서 이유를 골랐으면 같이 남깁니다. (다음 날 체크인에서 다시 묻지 않기 위해서입니다)
        ...(stopReason ? { stopReason } : {}),
        // 노는 기록이라는 표시입니다. 이 표시가 있으면 순공 · 달성률 계산에서 빠집니다. (#238)
        ...(isPlay ? { kind: 'play' as const } : {}),
      }
      addSession(newSession)

      // 이 계획으로 공부한 시간이 목표를 채웠으면 계획을 자동으로 완료로 바꿉니다. (계획 화면에서 손으로 다시 풀 수 있습니다)
      if (activePlan && !activePlan.done) {
        const progress = getPlanProgress(activePlan, [...allSessions, newSession])
        if (progress.isReached) completePlan(activePlan.id)
      }
    }

    // 정지하면 구간 끝 안내·목표 달성 안내·딴짓 안내도 함께 지웁니다.
    setEndedPhase(null)
    setIsTargetNoticeOpen(false)
    setActivePlanId(null)
    setPlanNotice(null)
    setStopStep('closed')
    dismissAwayNotice()
    stop()
  }

  /** 노는 시간이 끝난 뒤 [바로 시작] 을 눌렀을 때. 노는 기록을 저장하고 곧바로 다음 계획을 시작합니다. */
  function handleStartNextPlan(plan: StudyPlan) {
    finishSession()
    beginPlan(plan)
  }

  function handleStartFocus() {
    if (!selectedSubject) return
    // 버튼이 보일 때와 설정이 달라졌을 수 있어서 누르는 순간 한 번 더 확인합니다. (허용 안 했으면 절대 안 켜짐)
    if (!canUseFocusMode(getCareLimits())) {
      setFocusNotice('설정에서 집중 모드 잠금을 허용해야 켤 수 있어요.')
      return
    }
    // 안전 브레이크(#95)가 켜져 있으면 집중 모드를 켜지 않습니다.
    if (isSafetyBrakeOnNow()) {
      setFocusNotice('지금은 쉬어 가는 게 좋아서 집중 모드를 켤 수 없어요. 일반 타이머로 해 봐요.')
      return
    }
    setFocusNotice(null)
    setIsUnlockOpen(false)
    focusMode.start()
    // 아직 시작 전이거나 일시정지 중이면 타이머도 같이 시작합니다.
    if (!isRunning) handleStart()
  }

  function handleUnlockFocus(reason: string) {
    focusMode.unlock(reason)
    setIsUnlockOpen(false)
  }

  // 집중 모드 중에는 화면 전체를 집중 화면(또는 해제 화면)이 덮습니다. 타이머는 멈추지 않고 그대로 이어집니다.
  if (focusMode.isOn) {
    if (isUnlockOpen) {
      return (
        <FocusUnlockScreen onStay={() => setIsUnlockOpen(false)} onUnlock={handleUnlockFocus} />
      )
    }
    return (
      <FocusModeScreen
        subject={selectedSubject}
        planContent={activePlan?.content ?? todaySubjectPlans[0]?.content ?? null}
        timeText={timeText}
        isRunning={isRunning}
        studiedMinutes={todaySubjectMinutes}
        targetMinutes={todayTargetMinutes}
        awayNotice={awayNotice}
        awayCountToday={awayCountToday}
        onPause={pause}
        onResume={handleStart}
        onExit={() => setIsUnlockOpen(true)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">타이머</h1>
        <p className="mt-2 text-slate-600">목표를 정하고 시작하면 남은 시간이 줄어들어요.</p>
      </div>

      <Card className="flex flex-col items-center gap-6 py-8 sm:py-10">
        {/* 타이머 방식 고르기. 공부 중에는 바꿀 수 없습니다. */}
        <div className="flex w-full max-w-sm flex-col gap-2">
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
            {modeOptions.map((option) => {
              const isSelected = option.mode === mode
              return (
                <button
                  key={option.mode}
                  type="button"
                  aria-pressed={isSelected}
                  disabled={isStudying}
                  onClick={() => handleChangeMode(option.mode)}
                  className={cn(
                    'h-10 rounded-md text-sm font-medium transition-colors',
                    'cursor-pointer disabled:cursor-not-allowed',
                    isSelected
                      ? 'text-brand bg-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-200 disabled:opacity-50',
                  )}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
          {isPomodoro && (
            <p className="text-center text-sm text-slate-500">
              {STUDY_MINUTES}분 공부 → {BREAK_MINUTES}분 휴식을 반복해요.
            </p>
          )}
        </div>

        {/* 오늘 계획에서 바로 시작하기. 누르면 그 계획의 과목·목표 시간으로 바로 시작됩니다. (시작 전에만 보입니다) */}
        {!isStudying && startablePlans.length > 0 && (
          <div className="flex w-full flex-col gap-2">
            <p className="text-sm font-medium text-slate-700">오늘 계획에서 시작</p>
            <ul className="flex flex-col gap-2">
              {startablePlans.map((plan) => {
                const subject = subjects.find((item) => item.id === plan.subjectId)
                const progress = getPlanProgress(plan, allSessions)
                return (
                  <li key={plan.id}>
                    <button
                      type="button"
                      onClick={() => handleStartPlan(plan)}
                      className="flex min-h-12 w-full cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50"
                    >
                      {subject && (
                        <SubjectBadge
                          name={subject.name}
                          color={subject.color}
                          className="shrink-0"
                        />
                      )}
                      {/* 노는 계획은 과목 대신 회색 "놀기" 태그를 보여줍니다. */}
                      {plan.kind === 'play' && <PlayBadge className="shrink-0" />}
                      {/* min-w-0 + break-words: 긴 내용이 가로 스크롤을 만들지 않게 합니다. */}
                      <span className="min-w-0 flex-1 font-medium break-words text-slate-900">
                        {plan.content}
                      </span>
                      <span className="shrink-0 text-slate-500 tabular-nums">
                        {progress.actualMinutes > 0
                          ? `남은 ${progress.remainingMinutes}분`
                          : `${plan.targetMinutes}분`}
                      </span>
                      <span className="text-brand shrink-0 font-bold">▶ 시작</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {planNotice && (
          <p role="status" className="w-full text-center text-sm break-keep text-sky-700">
            {planNotice}
          </p>
        )}

        {/* 계획에 없는 공부는 과목을 직접 골라서 시작합니다. */}
        {!isStudying && subjects.length > 0 && (
          <p className="-mb-4 w-full text-sm font-medium text-slate-700">
            {startablePlans.length > 0 ? '계획 없이 시작 (과목 고르기)' : '과목 고르기'}
          </p>
        )}

        {subjects.length === 0 ? (
          <p className="text-sm text-slate-500">
            과목이 없어요. 계획 화면의 &apos;내 과목&apos;에서 먼저 추가해 주세요.
          </p>
        ) : (
          <div className="grid w-full grid-cols-3 gap-2 sm:grid-cols-4">
            {subjects.map((subject) => {
              const isSelected = subject.id === selectedSubjectId
              return (
                <button
                  key={subject.id}
                  type="button"
                  aria-pressed={isSelected}
                  disabled={isStudying}
                  onClick={() => handleSelectSubject(subject.id)}
                  className={cn(
                    'h-10 truncate rounded-lg border px-2 text-sm font-medium transition-colors',
                    'cursor-pointer disabled:cursor-not-allowed',
                    isSelected
                      ? 'border-brand bg-brand-light text-brand'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50',
                  )}
                >
                  {subject.name}
                </button>
              )
            })}
          </div>
        )}

        {/* 목표 시간 고르기. 시작하기 전에만 보입니다. (공부 중에는 약속한 시간이 숫자 아래에 보입니다) */}
        {/* 계획에서 시작하면 목표 시간이 계획에서 오기 때문에, 과목을 직접 고르는 쪽 아래에 둡니다. */}
        {isTarget && !isStudying && (
          <div className="flex w-full max-w-sm flex-col gap-1.5">
            <MinutesPicker
              // key 가 바뀌면 React 가 이 조각을 새로 만듭니다. (handleAcceptRecommendation 참고)
              key={pickerVersion}
              label="목표 시간"
              presets={TARGET_PRESETS}
              value={targetMinutes}
              onChange={handleChangeTarget}
              min={MIN_TARGET_MINUTES}
              max={MAX_TARGET_MINUTES}
            />
            {/* 고른 시간이 어느 정도 길이인지 한 줄로 알려 줍니다. 직접 적은 값에는 설명이 없습니다. */}
            {/* aria-live: 버튼을 바꿔 설명이 바뀌면 스크린리더가 읽어 줍니다. */}
            {targetHint !== null && (
              <p aria-live="polite" className="text-sm break-keep text-slate-500">
                {targetHint}
              </p>
            )}

            {/* 최근 기록으로 권하는 목표 시간 (#246). 권하기만 하고, 누르지 않으면 아무 일도 일어나지 않습니다. */}
            {targetRecommendation !== null && (
              <div className="bg-brand-light mt-1 flex flex-col items-start gap-2 rounded-lg p-3">
                <p className="text-sm font-medium break-keep text-slate-800">
                  {targetRecommendation.reason}
                </p>
                <Button
                  variant="secondary"
                  className="bg-white hover:bg-slate-50"
                  onClick={() => handleAcceptRecommendation(targetRecommendation.minutes)}
                >
                  추천 {targetRecommendation.minutes}분으로 하기
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2">
          {/* 고른 과목을 타이머 위에 태그로 보여줍니다. */}
          {selectedSubject && (
            <SubjectBadge
              name={selectedSubject.name}
              color={selectedSubject.color}
              className="px-3 py-1 text-sm"
            />
          )}
          {isPlay && <PlayBadge className="px-3 py-1 text-sm" />}
          {/* 계획에서 시작했으면 어떤 계획을 하는 중인지 같이 보여줍니다. */}
          {isStudying && activePlan && (
            <span className="text-sm font-medium break-words text-slate-900">
              {activePlan.content}
            </span>
          )}
          {isRunning && (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium',
                statusClass,
              )}
            >
              <span className={cn('h-2 w-2 rounded-full', statusDotClass)} />
              {statusLabel}
            </span>
          )}
          {isTargetDone && (
            <span className="bg-brand-light text-brand inline-flex items-center rounded-full px-3 py-1 text-sm font-medium">
              {isPlay ? '노는 시간 끝' : '목표 달성'}
            </span>
          )}
        </div>

        {/* 노는 시간이 끝나면 나오는 안내. 놀다가 공부로 돌아오는 순간이 가장 어려워서, 다음 공부를 한 번에 시작하게 합니다. (#238) */}
        {/* 누르기 전까지는 타이머가 계속 흘러서, 계획보다 더 논 시간이 + 로 세어집니다. */}
        {isPlay && isTargetDone && (
          <div
            role="status"
            className="border-brand flex w-full flex-col gap-3 rounded-lg border-2 bg-white p-4"
          >
            <p className="text-base font-semibold break-keep text-slate-900">
              노는 시간 끝! 계획한 {targetMinutes}분을 다 놀았어요.
            </p>
            {nextStudyPlan ? (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-slate-500">다음 계획</span>
                  {nextSubject && (
                    <SubjectBadge
                      name={nextSubject.name}
                      color={nextSubject.color}
                      className="shrink-0"
                    />
                  )}
                  <span className="min-w-0 font-medium break-words text-slate-900">
                    {nextStudyPlan.content}
                  </span>
                  <span className="shrink-0 text-slate-500 tabular-nums">
                    {nextStudyPlan.startTime && `${nextStudyPlan.startTime} · `}
                    {nextStudyPlan.targetMinutes}분
                  </span>
                </div>
                <Button
                  size="lg"
                  className="w-full"
                  onClick={() => handleStartNextPlan(nextStudyPlan)}
                >
                  ▶ 바로 시작
                </Button>
              </>
            ) : (
              <p className="text-sm break-keep text-slate-600">
                오늘 남은 공부 계획이 없어요. 마치기를 누르면 노는 시간이 기록돼요.
              </p>
            )}
            <Link
              to="/planner"
              className="text-brand inline-flex h-10 items-center self-center text-sm font-medium underline underline-offset-4"
            >
              계획 화면에서 고르기
            </Link>
          </div>
        )}

        {/* 목표 시간을 채우면 나오는 안내. 소리·진동은 playAlarm 이 따로 냅니다. (노는 타이머는 위의 안내를 씁니다) */}
        {isTargetNoticeOpen && !isPlay && (
          <div
            role="status"
            className="flex w-full items-center justify-between gap-3 rounded-lg bg-indigo-50 px-4 py-2 text-sm font-medium break-keep text-indigo-800"
          >
            <p>목표 {targetMinutes}분을 채웠어요! 더 하는 시간은 + 로 세요.</p>
            <button
              type="button"
              onClick={() => setIsTargetNoticeOpen(false)}
              className="h-10 shrink-0 cursor-pointer rounded-md px-3 hover:bg-indigo-100"
            >
              확인
            </button>
          </div>
        )}

        {/* 뽀모도로에서 구간이 끝나면 나오는 안내. 소리·진동은 playAlarm 이 따로 냅니다. */}
        {isPomodoro && endedPhase && (
          <div
            role="status"
            className="flex w-full items-center justify-between gap-3 rounded-lg bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800"
          >
            <p>
              {endedPhase === 'study'
                ? `공부 구간이 끝났어요! ${BREAK_MINUTES}분 쉬어 가요.`
                : `휴식이 끝났어요! 다시 ${STUDY_MINUTES}분 집중해 볼까요?`}
            </p>
            <button
              type="button"
              onClick={() => setEndedPhase(null)}
              className="h-10 shrink-0 cursor-pointer rounded-md px-3 hover:bg-amber-100"
            >
              확인
            </button>
          </div>
        )}

        {/* 다른 탭·앱에 나갔다 돌아오면 나오는 안내. 이 기록은 딴짓 횟수로 저장돼 AI 평가에 쓰입니다. */}
        {awayNotice && (
          <div
            role="status"
            className="flex w-full items-start justify-between gap-3 rounded-lg bg-rose-50 px-4 py-3 text-sm break-keep text-rose-800"
          >
            <div className="flex flex-col gap-1">
              <p className="font-bold">
                딴짓 감지! {formatAwayDuration(awayNotice.awayMs)} 나갔다 왔어요
              </p>
              <p>
                자리 비움 {formatClock(awayNotice.leftAt)} → {formatClock(awayNotice.returnedAt)} ·
                오늘 {awayCountToday}번째예요.{' '}
                {isRunning
                  ? '그 시간은 빼고 이어서 재고 있어요.'
                  : '오래 비워서 멈춰 뒀어요. 시작을 누르면 이어서 공부해요.'}
              </p>
            </div>
            <button
              type="button"
              onClick={dismissAwayNotice}
              className="h-10 shrink-0 cursor-pointer rounded-md px-3 font-medium hover:bg-rose-100"
            >
              확인
            </button>
          </div>
        )}

        {/* tabular-nums: 숫자가 바뀌어도 폭이 흔들리지 않게 고정 폭으로 보여줍니다. */}
        <p
          className={cn(
            'font-mono text-5xl font-bold tracking-tight tabular-nums sm:text-6xl',
            isTargetDone && 'text-brand',
          )}
        >
          {timeText}
        </p>

        {/* 목표 정하기로 공부 중일 때: 약속한 시간 중 얼마나 했는지 */}
        {isTarget && isStudying && (
          <div className="flex w-full max-w-xs flex-col items-center gap-2">
            <p className="text-sm font-medium text-slate-700">
              {targetMinutes}분 중 {Math.min(targetMinutes, Math.floor(seconds / 60))}분{' '}
              {isPlay ? '놀았어요' : '했어요'}
            </p>
            <ProgressBar value={countdown.percent} />
          </div>
        )}

        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          {isRunning ? (
            <Button variant="secondary" size="lg" className="w-full sm:w-40" onClick={pause}>
              일시정지
            </Button>
          ) : (
            // 과목을 안 고르면 시작 버튼을 누를 수 없습니다. (노는 중에는 과목이 없어도 이어서 할 수 있습니다)
            <Button
              size="lg"
              className="w-full sm:w-40"
              disabled={!selectedSubject && !isPlay}
              onClick={handleStart}
            >
              시작
            </Button>
          )}
          {/* 목표를 채운 뒤에는 "마치기" 가 됩니다. 누르면 기록이 저장됩니다. */}
          {/* 시작하기 전에는 멈출 것이 없어서 눌리지 않습니다. */}
          <Button
            variant={isTargetDone ? 'primary' : 'danger'}
            size="lg"
            className="w-full sm:w-40"
            disabled={!isStarted}
            onClick={handleStopClick}
          >
            {isTargetDone ? '마치기' : '정지'}
          </Button>
        </div>

        {/* 집중 모드는 허용한 사람만, 휴식 구간이 없는 방식(목표 정하기·목표 없이)에서만 켤 수 있습니다. (노는 중에는 안 보입니다) */}
        {canUseFocus && !isPomodoro && !isPlay && (
          <div className="flex w-full flex-col items-center gap-2">
            <Button
              variant="secondary"
              size="lg"
              className="w-full sm:w-auto"
              disabled={!selectedSubject}
              onClick={handleStartFocus}
            >
              집중 모드로 시작
            </Button>
            {focusNotice && (
              <p role="status" className="text-center text-sm break-keep text-sky-700">
                {focusNotice}
              </p>
            )}
          </div>
        )}

        {/* break-keep: 한글이 단어 중간에서 끊기지 않게 합니다. */}
        <div className="flex flex-col gap-1 text-center text-sm break-keep text-slate-500">
          <p>{helpMessage}</p>
          <p>{awayHelp}</p>
        </div>

        {/* 웹은 다른 앱으로 못 나가게 막을 수 없어서, 휴대폰의 "앱 하나에 고정" 기능을 켜는 법으로 안내합니다. (#250) */}
        <Link
          to={PHONE_FOCUS_PATH}
          className="text-brand inline-flex h-10 items-center gap-1.5 text-sm font-medium underline underline-offset-4"
        >
          <span aria-hidden>🔒</span>
          다른 앱으로 못 나가게 하고 싶다면
        </Link>
      </Card>

      <Card title="오늘 총 공부 시간">
        <p className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          {formatTotalMinutes(todayTotalMinutes)}
        </p>
      </Card>

      <WeeklySubjectRatio subjects={subjects} sessions={sessions} />

      {/* 계획에서 시작할 때 추천 목표가 있으면 몇 분으로 할지 묻습니다. 닫으면(✕) 시작하지 않습니다. (#246) */}
      <Modal
        isOpen={planOffer !== null}
        onClose={() => setPlanOffer(null)}
        title="이번엔 몇 분으로 할까?"
      >
        {planOffer !== null && (
          <>
            <p className="text-sm font-medium break-keep text-slate-800">
              {planOffer.recommendation.reason}
            </p>
            <p className="mt-1 text-sm break-keep text-slate-500">
              어느 쪽을 골라도 계획은 {planOffer.plan.targetMinutes}분 그대로예요. 이번 타이머의
              목표만 달라져요.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Button
                size="lg"
                className="w-full"
                onClick={() => handleAnswerPlanOffer(planOffer.recommendation.minutes)}
              >
                {planOffer.recommendation.minutes}분으로 시작
              </Button>
              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                onClick={() => handleAnswerPlanOffer(null)}
              >
                {planOffer.plan.targetMinutes}분 그대로 시작
              </Button>
            </div>
          </>
        )}
      </Modal>

      {/* 목표 전에 정지를 누르면 뜨는 확인 창. 떠 있는 동안에도 타이머는 계속 흐릅니다. */}
      <StopConfirmModal
        step={stopStep}
        targetMinutes={targetMinutes}
        doneMinutes={Math.floor(seconds / 60)}
        remainingMinutes={Math.ceil(countdown.remainingSeconds / 60)}
        percent={countdown.percent}
        onContinue={() => setStopStep('closed')}
        onQuit={() => setStopStep('reason')}
        onFinish={finishSession}
      />
    </div>
  )
}

/* ---------- 그만하기 전에 한 번 더 (#233) ---------- */

interface StopConfirmModalProps {
  /** closed: 닫힘 / confirm: 계속할지 묻는 중 / reason: 그만하는 이유를 고르는 중 */
  step: 'closed' | 'confirm' | 'reason'
  /** 약속한 목표 시간 (분) */
  targetMinutes: number
  /** 지금까지 한 시간 (분) */
  doneMinutes: number
  /** 목표까지 남은 시간 (분) */
  remainingMinutes: number
  /** 목표 대비 진행률 (0 ~ 100) */
  percent: number
  /** "계속하기" 를 눌렀거나 창을 닫았을 때. 타이머는 그대로 이어집니다. */
  onContinue: () => void
  /** "그만하기" 를 눌렀을 때. 이유를 고르는 단계로 넘어갑니다. */
  onQuit: () => void
  /** 이유를 골랐거나(reason) 건너뛰었을 때(reason 없음). 기록을 저장하고 끝냅니다. */
  onFinish: (reason?: MissReason) => void
}

/**
 * 목표 시간이 남았는데 정지를 눌렀을 때 뜨는 확인 창입니다.
 * 그만두는 것을 막지는 않습니다. 남은 시간을 숫자로 보여주고 스스로 고르게 합니다.
 * 그만둔다면 이유를 버튼 한 번으로 받습니다. (다음 날 기억으로 묻는 것보다 그 순간에 묻는 편이 정확합니다)
 */
function StopConfirmModal({
  step,
  targetMinutes,
  doneMinutes,
  remainingMinutes,
  percent,
  onContinue,
  onQuit,
  onFinish,
}: StopConfirmModalProps) {
  // 처음에 녹음해 둔 다짐. 있으면 그만두기 전에 다시 들을 수 있게 합니다. (#241)
  // 훅(useState)은 아래의 return 보다 위에 있어야 해서 맨 위에 둡니다.
  const [voicePledge] = useState(loadVoicePledge)

  if (step === 'reason') {
    return (
      // 창을 닫으면(✕·바깥·ESC) 그만두지 않고 계속하는 것으로 봅니다.
      <Modal isOpen onClose={onContinue} title="그만하는 이유를 골라 주세요">
        <div className="flex flex-col gap-4">
          <p className="text-sm break-keep text-slate-600">
            하나만 누르면 저장하고 끝나요. 건너뛰어도 돼요.
          </p>
          {/* 글자 수가 제각각인 버튼이라 flex-wrap 으로 넘치면 다음 줄로 보냅니다. */}
          <div role="group" aria-label="그만하는 이유" className="flex flex-wrap gap-2">
            {missReasonOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => onFinish(option.key)}
                className="h-10 cursor-pointer rounded-full border border-slate-200 bg-white px-4 text-sm font-medium whitespace-nowrap text-slate-700 transition-colors hover:bg-slate-50"
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="text-sm break-keep text-slate-500">
            {doneMinutes}분은 그대로 기록돼요. 이유는 다음 계획을 맞추는 데만 써요.
          </p>
          <Button variant="ghost" className="w-full" onClick={() => onFinish()}>
            건너뛰기
          </Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      isOpen={step === 'confirm'}
      onClose={onContinue}
      title={`${targetMinutes}분 중 ${doneMinutes}분 했어요`}
    >
      <div className="flex flex-col gap-4">
        <p className="text-base break-keep text-slate-700">
          <strong className="text-slate-900">{remainingMinutes}분</strong> 남았어요. 지금 멈추면{' '}
          {percent}% 예요.
        </p>
        <ProgressBar value={percent} />
        <div className="flex flex-col gap-2">
          {/* 계속하기를 더 눈에 띄게 둡니다. 그만하기도 한 번이면 누를 수 있습니다. */}
          <Button size="lg" className="w-full" onClick={onContinue}>
            계속하기
          </Button>
          <Button variant="secondary" size="lg" className="w-full" onClick={onQuit}>
            그만하기
          </Button>
          {/* 녹음해 둔 다짐이 있을 때만 보입니다. 시키는 말이 아니라, 처음의 내가 한 말을 들려줍니다. */}
          {voicePledge?.audioDataUrl && (
            <VoicePledgePlayButton
              audioDataUrl={voicePledge.audioDataUrl}
              seconds={voicePledge.seconds}
              className="w-full"
            />
          )}
        </div>
      </div>
    </Modal>
  )
}

/* ---------- 집중 모드 화면 (#69) ---------- */

interface FocusModeScreenProps {
  subject: Subject | undefined
  /** 고른 과목의 오늘 계획 내용. 계획이 없으면 null */
  planContent: string | null
  /** 크게 보여줄 시간 글자. 타이머 화면과 같은 글자입니다 (예: '37:48', '+03:12', '00:12:34') */
  timeText: string
  isRunning: boolean
  /** 오늘 이 과목으로 공부한 시간(분). 지금 재고 있는 시간 포함 */
  studiedMinutes: number
  /** 오늘 이 과목의 계획 목표 시간(분). 계획이 없으면 0 */
  targetMinutes: number
  awayNotice: AwayRecord | null
  awayCountToday: number
  onPause: () => void
  onResume: () => void
  onExit: () => void
}

/** 집중 모드 중에 화면 전체를 덮는 어두운 화면입니다. 타이머만 보이고 메뉴는 보이지 않습니다. */
function FocusModeScreen({
  subject,
  planContent,
  timeText,
  isRunning,
  studiedMinutes,
  targetMinutes,
  awayNotice,
  awayCountToday,
  onPause,
  onResume,
  onExit,
}: FocusModeScreenProps) {
  // 알림 권한을 허용했는지. 화면이 처음 그려질 때 한 번만 확인합니다.
  const [canNotify] = useState(() => getNotificationPermission() === 'granted')
  const percent =
    targetMinutes > 0 ? Math.min(100, Math.round((studiedMinutes / targetMinutes) * 100)) : 0

  return (
    // fixed inset-0 z-50: 헤더·하단 탭(z-20)까지 덮어서 다른 메뉴로 갈 수 없게 합니다.
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900 text-white">
      <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col items-center justify-center gap-6 px-4 py-10 text-center">
        <span className="rounded-full bg-indigo-500/20 px-4 py-1.5 text-sm font-semibold text-indigo-100">
          집중 모드
        </span>

        {subject && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <SubjectBadge name={subject.name} color={subject.color} />
            {planContent && <span className="text-base font-medium break-keep">{planContent}</span>}
          </div>
        )}

        {/* tabular-nums: 숫자가 바뀌어도 폭이 흔들리지 않게 고정 폭으로 보여줍니다. */}
        <p className="font-mono text-6xl font-bold tracking-tight tabular-nums sm:text-8xl">
          {timeText}
        </p>

        {targetMinutes > 0 && (
          <div className="flex w-full max-w-md flex-col gap-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700">
              <div
                className="h-full rounded-full bg-indigo-400"
                // 너비가 숫자에 따라 바뀌어서 Tailwind 클래스로 만들 수 없어 인라인 style 을 씁니다.
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-sm text-slate-300">
              계획 {formatTotalMinutes(targetMinutes)} 중 {formatTotalMinutes(studiedMinutes)}
            </p>
          </div>
        )}

        {awayNotice && (
          <p role="status" className="text-sm break-keep text-rose-300">
            딴짓 감지! {formatAwayDuration(awayNotice.awayMs)} 나갔다 왔어요 · 오늘 {awayCountToday}
            번째예요.
          </p>
        )}

        <button
          type="button"
          onClick={isRunning ? onPause : onResume}
          className="h-12 cursor-pointer rounded-full bg-white px-8 text-base font-bold text-slate-900 transition-colors hover:bg-slate-100"
        >
          {isRunning ? '⏸ 일시정지' : '▶ 다시 시작'}
        </button>

        <p className="text-sm break-keep text-slate-400">
          화면은 꺼지지 않아. 다른 탭에 다녀오면 그 시간은 빼고 이어서 재.{' '}
          {/* 알림을 켠 사람에게만 "알려 줄게" 라고 말합니다. 안 켰으면 켜는 곳을 알려 줍니다. */}
          {canNotify
            ? '나가면 바로 알림으로 알려 줄게.'
            : '설정에서 알림을 켜면, 나갔을 때 바로 알려 줘.'}
        </p>

        <button
          type="button"
          onClick={onExit}
          className="h-10 cursor-pointer px-3 text-sm font-medium text-indigo-300 underline underline-offset-4 hover:text-indigo-200"
        >
          집중 모드 나가기
        </button>
      </div>
    </div>
  )
}

/* ---------- 이번 주 과목별 공부 시간 비율 (#44) ---------- */

// 막대 색. SubjectBadge 처럼 완성된 클래스 이름을 적어 둡니다. (`bg-${color}-500` 은 Tailwind 가 못 알아봅니다)
const barColorStyles: Record<SubjectColor, string> = {
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  green: 'bg-green-500',
  blue: 'bg-blue-500',
  purple: 'bg-purple-500',
}

// 분 단위 숫자를 '2시간 14분', '40분' 처럼 바꿔줍니다.
function formatMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}분`
  if (minutes === 0) return `${hours}시간`
  return `${hours}시간 ${minutes}분`
}

// 이번 주 월요일이 시작되는 순간(새벽 4시)을 밀리초 숫자로 돌려줍니다. (하루의 기준은 lib/date.ts)
function getThisMondayStart() {
  // 새벽 4시 전이면 아직 어제라서, 하루의 기준만큼 되돌린 날짜로 요일을 봅니다.
  const date = toDayDate(Date.now())
  // getDay(): 일요일 0, 월요일 1 ... 토요일 6. 월요일에서 며칠 지났는지 계산합니다. (일요일은 6일)
  const daysFromMonday = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - daysFromMonday)
  date.setHours(DAY_START_HOUR, 0, 0, 0)
  return date.getTime()
}

interface WeeklySubjectRatioProps {
  subjects: Subject[]
  sessions: StudySession[]
}

function WeeklySubjectRatio({ subjects, sessions }: WeeklySubjectRatioProps) {
  const mondayStart = getThisMondayStart()
  const thisWeekSessions = sessions.filter((session) => session.startedAt >= mondayStart)

  // 과목마다 이번 주에 공부한 시간(분)을 더합니다.
  const rows = subjects
    .map((subject) => {
      // 기록마다 반올림하면 합계가 어긋납니다. 밀리초로 모두 더한 뒤 마지막에 한 번만 분으로 바꿉니다.
      // (기록 화면 lib/dailyRecords.ts 와 같은 규칙이라 두 화면의 숫자가 같아집니다)
      let totalMs = 0
      for (const session of thisWeekSessions) {
        if (session.subjectId === subject.id) totalMs += getStudyMs(session)
      }
      return { subject, minutes: Math.round(totalMs / 60000) }
    })
    .filter((row) => row.minutes > 0)
    // 많이 공부한 과목이 위로 오게 정렬합니다.
    .sort((a, b) => b.minutes - a.minutes)

  const totalMinutes = rows.reduce((sum, row) => sum + row.minutes, 0)

  return (
    <Card title="이번 주 과목별 공부 시간">
      {totalMinutes === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">
          이번 주 공부 기록이 아직 없어요. 타이머로 공부를 시작해 보세요.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map(({ subject, minutes }) => {
            const percent = Math.round((minutes / totalMinutes) * 100)
            return (
              // 모바일: [과목 태그 + 시간] 한 줄, 그 아래 막대 / PC: [태그 | 막대 | 시간] 한 줄
              <li
                key={subject.id}
                className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3"
              >
                {/* sm:contents: PC 에서는 이 div 상자를 없는 셈 치고, 안의 태그·시간을 li 에 바로 놓습니다. */}
                <div className="flex items-center justify-between gap-2 sm:contents">
                  <SubjectBadge
                    name={subject.name}
                    color={subject.color}
                    className="max-w-24 sm:w-16 sm:shrink-0"
                  />
                  <span className="shrink-0 text-sm text-slate-600 tabular-nums sm:order-last sm:w-32 sm:text-right">
                    {percent}% · {formatMinutes(minutes)}
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={cn('h-full rounded-full', barColorStyles[subject.color])}
                    // 너비가 숫자에 따라 바뀌어서 Tailwind 클래스로 만들 수 없어 인라인 style 을 씁니다.
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
