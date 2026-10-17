import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { MinutesPicker } from '@/components/ui/MinutesPicker'
import { Modal } from '@/components/ui/Modal'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { CrisisHelpModal } from '@/components/ui/CrisisHelpModal'
import { FailCardModal } from '@/components/ui/FailCardModal'
import { LateEntryModal } from '@/components/ui/LateEntryModal'
import { PostponeCardModal } from '@/components/ui/PostponeCardModal'
import { useCardSession } from '@/hooks/useCardSession'
import { useCards } from '@/hooks/useCards'
import { useKeepScreenOn } from '@/hooks/useKeepScreenOn'
import { useQueryParam } from '@/hooks/useQueryParam'
import { playAlarm } from '@/lib/alarm'
import { formatClock } from '@/lib/away'
import {
  LONG_PAUSE_MINUTES,
  createInstantCardNow,
  getRemainingMs,
  getRunMs,
  shouldAlertLongPause,
} from '@/lib/cardSession'
import { cn } from '@/lib/cn'
import { formatMinutes } from '@/lib/dailyRecords'
import { getTodayKey, toDayKey } from '@/lib/date'
import {
  addCardMark,
  getCardDayMark,
  getPostponeLeft,
  getPostponedMinutesThisMonth,
  hasFalseConsensus,
  isHandledOnDate,
  loadCardMarks,
  placePostponedCardNow,
  type CardFailCause,
} from '@/lib/cardMarks'
import { getCardResult } from '@/lib/cardResult'
import { loadLatestCareStage } from '@/lib/careStage'
import { getSafetyBrakeResult } from '@/lib/safetyBrake'
import { getRunningExperimentFor, loadExperiments } from '@/lib/experiments'
import { findStrategy } from '@/lib/strategyCatalog'
import {
  REST_REASONS,
  addRestDay,
  getRestLeft,
  loadRestDays,
  needsRecoveryCheck,
  type RestReason,
} from '@/lib/restDays'
import {
  PLEDGE_GATE_SECONDS,
  isStage4AbsoluteOn,
  isStage4Now,
  loadStage4Absolute,
  pickStage4Absolute,
  releaseStage4,
  saveStage4Absolute,
} from '@/lib/stage4'
import { loadVoicePledge } from '@/lib/voicePledge'
import { CALL_TIME_STORAGE_KEY, parseCallTime } from '@/lib/callReminder'
import { buildLateEntrySession, checkLateEntry, makeLateEntryReport } from '@/lib/lateEntry'
import { loadData } from '@/lib/storage'
import { requestFirstStep, requestQuickCard, type QuickCardDraft } from '@/lib/aiCardApi'
import { useIsServerData } from '@/hooks/useIsServerData'
import { labelSessionTexts } from '@/lib/textLabels'
import { SegmentedToggle } from '@/components/ui/SegmentedToggle'
import { MAX_SHRINK, getPrepStep, isCountdownOn } from '@/lib/cardAlerts'
import { loadLocalCheckIn } from '@/lib/quickCheckIn'
import { playTick } from '@/lib/tick'
import { showSystemNotification } from '@/lib/notifications'
import { getSessionCardId } from '@/lib/sessionRecords'
import {
  countChecklistComplete,
  draftToInstant,
  isChecklistComplete,
  isUntitledInstantCard,
  shouldAskGoodReason,
  splitInstantLine,
} from '@/lib/endReport'
import {
  PLAY_MINUTE_PRESETS,
  PLAY_WARN_MINUTES,
  isPlayOver,
  shouldWarnPlayEnd,
} from '@/lib/playSession'
import {
  GOOD_REASONS,
  PAUSE_TAGS,
  PLAY_TAGS,
  SHORTFALL_REASONS,
  WITH_WHAT_OPTIONS,
} from '@/lib/sessionTags'
import { loadAutoSettings } from '@/lib/settingsMapping'
import type {
  Card as CardModel,
  PauseTag,
  PlayTag,
  SessionEndReport,
  ShortfallReason,
  StudySession,
} from '@/types'

/**
 * 타이머 탭 — 카드 기준 (최종 기획서 「4.4 타이머」, #395)
 *
 * - 세션이 없으면 **대기 화면**: 다음 카드 [시작], [지금 시작](즉석 카드)
 * - 세션이 있으면 **세션 화면**: 카드의 예정 종료 시각까지 줄어드는 시계, [일시정지] · [끝내기]
 * - 알림으로 `/timer?card=카드id` 가 열리면 묻지 않고 바로 시작합니다.
 * 진행 중인 세션은 저장돼 있어서 새로고침해도 이어집니다.
 */

// [지금 시작] 의 길이 고르기 (분). 가운데 값이 처음 골라져 있습니다.
const INSTANT_MINUTES = [25, 50, 80]
/** 즉석 카드의 한 줄을 적고 이만큼 멈추면 AI 에게 정리를 부탁합니다 (#419) */
const QUICK_CARD_WAIT_MS = 1500
const DEFAULT_INSTANT_MINUTES = 50
const MS_PER_MINUTE = 60 * 1000

/** 남은 시간(밀리초)을 '37:48' · '1:05:00' 처럼 */
function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

export function CardTimerPage() {
  const { cards, getCards, addCard, updateCard } = useCards()
  const session = useCardSession()
  const { active, now, allSessions } = session
  // 방금 끝낸 기록. 있으면 종료 팝업을 띄웁니다. (#398)
  const [endedRecord, setEndedRecord] = useState<StudySession | null>(null)
  // 세션이 끝나면 '기타' 일시정지 글 · 딴생각 메모에 AI 이름표를 붙여 둡니다. (#419 표 8 · 9번)
  // 화면에는 안 보이는 참고 칸이라, 종료 팝업과 따로 뒤에서 조용히 합니다.
  const { mutate: labelTexts } = useMutation({
    mutationFn: labelSessionTexts,
    onSuccess: (changes, record) => {
      if (changes) session.updateSession(record.id, changes)
    },
  })

  function handleFinished(record: StudySession) {
    setEndedRecord(record)
    labelTexts(record)
  }
  const [cardParam, setCardParam] = useQueryParam('card', '', { replace: true })
  // 카드를 시작하기 전에 거치는 화면 — 4단계면 다짐 듣기(#408) → 카운트다운이 켜져 있으면 5초 카운트다운(#399) → 세션
  const [startFlow, setStartFlow] = useState<{
    card: CardModel
    step: 'pledge' | 'countdown'
  } | null>(null)
  const [pageSettings] = useState(loadAutoSettings)

  const todayKey = getTodayKey()
  // 오늘 이미 세션을 한 카드 (반복 카드도 오늘 것만)
  const doneTodayIds = new Set(
    allSessions
      .filter((record) => toDayKey(record.startedAt) === todayKey)
      .map((record) => getSessionCardId(record, {}))
      .filter((id): id is string => id !== undefined),
  )
  const todayCards = getCards(todayKey)
  // 미루기 · 실패 표시 (#400). 표시가 있는 카드는 처리된 것이라 대기 목록에서 뺍니다.
  const [marks, setMarks] = useState(loadCardMarks)
  const [missTarget, setMissTarget] = useState<{
    card: CardModel
    action: 'postpone' | 'fail' | 'late'
  } | null>(null)
  // 통화 시각 — 사후 입력은 다음 통화 전까지만 받습니다. (#402)
  const [callTimeMinutes] = useState(() =>
    parseCallTime(loadData<unknown>(CALL_TIME_STORAGE_KEY, null)),
  )

  /** 이 카드를 지금 나중에 적을 수 있는지 (미리 만든 카드 · 다음 통화 전 · 기록 없음) */
  function lateEntryOf(card: CardModel) {
    return checkLateEntry({
      card,
      dateKey: todayKey,
      now: listNow,
      callTimeMinutes,
      hasSession: doneTodayIds.has(card.id),
      isHandled: isHandledOnDate(card, getCardDayMark(marks, card.id, todayKey), todayKey),
    })
  }

  function handleLateEntry(
    card: CardModel,
    minutes: number,
    checkedIds: string[],
    proofText: string,
  ) {
    const record = buildLateEntrySession(
      card,
      todayKey,
      minutes,
      makeLateEntryReport(checkedIds, proofText),
      `late-${card.id}-${todayKey}`,
    )
    if (record) session.addSession(record)
    setMissTarget(null)
    setNotice(
      record?.endReport?.proof
        ? '적었어요. 증빙이 있어서 그냥 한 것과 똑같이 셀게요.'
        : "적었어요. 증빙이 없어서 '나중에 적었어요' 로 남아요.",
    )
  }
  const [notice, setNotice] = useState<string | null>(null)
  const [isCrisisOpen, setIsCrisisOpen] = useState(false)
  // 대기 화면의 '지금'. 30초마다 바꿔서 시간이 끝난 카드가 '시간이 끝난 카드' 로 옮겨 가게 합니다.
  const [listNow, setListNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setListNow(Date.now()), 30 * 1000)
    return () => clearInterval(id)
  }, [])
  // 휴식 처리한 날 (#407). 오늘을 쉰 날로 처리했으면 오늘 카드는 모두 처리된 것입니다.
  const [restDays, setRestDays] = useState(loadRestDays)
  const [isRestOpen, setIsRestOpen] = useState(false)
  const [isRecoveryCheckOpen, setIsRecoveryCheckOpen] = useState(false)
  const isTodayRest = restDays.some((day) => day.date === todayKey)
  const restLeft = getRestLeft(restDays, todayKey)
  const openCards = isTodayRest
    ? []
    : todayCards.filter(
        (card) =>
          !doneTodayIds.has(card.id) &&
          !isHandledOnDate(card, getCardDayMark(marks, card.id, todayKey), todayKey),
      )
  // 카드 시간이 끝났는데 시작도 처리도 안 한 카드 → [미루기] / [실패로 기록] 을 고르게 합니다.
  const unhandledCards = openCards.filter(
    (card) => getCardResult({ card, dateKey: todayKey, sessions: [] }, listNow) === 'unhandled',
  )
  const waitingCards = openCards.filter((card) => !unhandledCards.includes(card))
  const routinePostponeLimit = pageSettings.postponeLimitRoutine.value
  // 관리 4단계에서는 미루기가 잠깁니다. (「5.4」, 강제 장치 전체는 #408)
  const isPostponeLocked = isStage4Now(todayKey)
  // 진행 중인 자기 실험의 규칙을 카드에 붙여 보여 줍니다. (#412)
  const [experiments] = useState(loadExperiments)
  function experimentRuleOf(cardId: string): string | undefined {
    const running = getRunningExperimentFor(experiments, cardId)
    return running ? findStrategy(running.strategyId)?.rule : undefined
  }
  // 회복 모드(관리 0단계, 「4.5」): 위로 · What if · 계획 축소. 안전 조건으로 0 이 된 것도 같이 보여 줍니다.
  const latestStage = loadLatestCareStage(todayKey)
  const isRecoveryMode =
    latestStage?.stage === 0 && (latestStage.rule === 'recovery' || latestStage.rule === 'safety')

  function postponeLeft(card: CardModel): number {
    if (isPostponeLocked) return 0
    return getPostponeLeft(card, todayKey, marks, routinePostponeLimit)
  }

  function handlePostpone(card: CardModel, reason: string, newDate: string, newStartTime: string) {
    setMarks(
      addCardMark({
        cardId: card.id,
        dateKey: todayKey,
        mark: 'postponed',
        reason,
        newDate,
        newStartTime,
      }),
    )
    const placed = placePostponedCardNow(card, newDate, newStartTime)
    if ('update' in placed) updateCard(card.id, placed.update)
    else addCard(placed.create)
    setMissTarget(null)
    // 미루기 사유도 안전 브레이크가 봅니다. 위기 표현이 있으면 도움 연결 안내부터. (「4.5」 안전 브레이크)
    if (
      getSafetyBrakeResult({
        now: new Date(listNow),
        recentTexts: [reason],
        recentMoods: [],
        exams: [],
      }).stopWhip
    ) {
      setIsCrisisOpen(true)
      return
    }
    // "다들 미뤄" 같은 말이 있으면 보편성은 반박하지 않고 내 비용만 보여 줍니다. (「8.2」 허위 합의)
    if (hasFalseConsensus(reason)) {
      const minutes = getPostponedMinutesThisMonth(marks, cards, todayKey) + card.durationMinutes
      setNotice(
        `흔한 건 맞아. 근데 흔하다고 너한테 비용이 없는 건 아니야. 이번 달 미룬 시간 ${formatMinutes(minutes)}.`,
      )
    } else {
      setNotice(`${newDate.slice(5).replace('-', '/')} ${newStartTime} 로 옮겼어요.`)
    }
  }

  function handleFail(card: CardModel, cause: CardFailCause) {
    setMarks(addCardMark({ cardId: card.id, dateKey: todayKey, mark: 'failed', cause }))
    setMissTarget(null)
    setNotice('기록했어요. 다음 통화에서 같이 돌아봐요.')
  }

  // 알림으로 들어오면(?card=) 사전 질문 없이 바로 시작합니다. (「4.4」 시작)
  // 시작한 뒤에는 주소에서 card 값을 지워서, 새로고침해도 다시 시작하지 않게 합니다.
  // 카운트다운이 켜져 있으면 주소의 카드로 카운트다운 화면을 그리고(paramCountdownCard), 끝나거나 그만두면 주소를 지웁니다.
  const paramCard =
    cardParam === '' || active ? undefined : cards.find((item) => item.id === cardParam)
  const isCountdownToday = isCountdownOn(
    pageSettings.countdown.value,
    loadLocalCheckIn(todayKey)?.emotions,
  )
  // 관리 4단계(#408): 시작 전 다짐 녹음 10초 · 미루기 잠금 · 다음 반복 카드 1장 절대 · 증빙 필수
  const isStage4 = isStage4Now(todayKey)
  const pledge = isStage4 ? loadVoicePledge() : null
  const hasPledgeAudio = pledge !== null && pledge.audioDataUrl !== null
  const storedAbsolute = loadStage4Absolute()
  const stage4Absolute = !isStage4
    ? undefined
    : storedAbsolute && storedAbsolute.dateKey >= todayKey
      ? storedAbsolute
      : pickStage4Absolute(cards, todayKey, listNow, doneTodayIds)
  // 고른 절대 카드는 저장해서, 시간이 지나도 다른 카드로 바뀌지 않게 합니다.
  // (객체는 화면을 그릴 때마다 새로 만들어져서, 바뀌었는지는 'id|날짜' 글자로 봅니다)
  const stage4AbsoluteKey = stage4Absolute
    ? `${stage4Absolute.cardId}|${stage4Absolute.dateKey}`
    : ''
  useEffect(() => {
    if (stage4AbsoluteKey === '') return
    const [cardId, dateKey] = stage4AbsoluteKey.split('|')
    saveStage4Absolute({ cardId, dateKey })
  }, [stage4AbsoluteKey])

  /** 시작 전에 처음 거칠 화면. 없으면 null (바로 시작) */
  function firstStartStep(): 'pledge' | 'countdown' | null {
    if (isStage4 && hasPledgeAudio) return 'pledge'
    return isCountdownToday ? 'countdown' : null
  }
  const paramStep = paramCard ? firstStartStep() : null
  const paramFlow = paramCard && paramStep ? { card: paramCard, step: paramStep } : null
  // 거칠 화면이 있으면 그 화면이 끝날 때 시작하고, 없으면 바로 시작합니다.
  const hasParamFlow = paramFlow !== null
  useEffect(() => {
    if (cardParam === '' || hasParamFlow) return
    if (paramCard) session.start(paramCard, todayKey)
    setCardParam('')
  }, [cardParam, paramCard, hasParamFlow, session, todayKey, setCardParam])

  /**
   * 카드로 시작합니다. 4단계면 다짐 듣기부터, 5초 카운트다운이 켜져 있으면(설정 또는 오늘 막막함·불안함) 카운트다운부터.
   * [지금 시작] 즉석 카드는 할 일이 아직 없어서 바로 시작합니다.
   */
  function beginCard(card: CardModel) {
    const step = firstStartStep()
    if (step) setStartFlow({ card, step })
    else session.start(card, todayKey)
  }

  /** 4단계에서 절대가 된 카드는 화면에서 절대 카드로 보입니다 (미루기 없음 · '꼭 해야 함') */
  function withStage4(card: CardModel): CardModel {
    return isStage4AbsoluteOn(stage4Absolute, card.id, todayKey)
      ? { ...card, priority: 'absolute' }
      : card
  }

  function handleRest(reason: RestReason) {
    const next = addRestDay(todayKey, reason)
    setRestDays(next)
    setIsRestOpen(false)
    setNotice('오늘은 쉰 날로 처리했어요. 오늘 카드는 실패로 세지 않아요. 푹 쉬어요.')
    // 3일 연속이거나 이번 달 휴식을 다 썼으면 회복 모드 · 기분 점검으로 이어 줍니다.
    if (needsRecoveryCheck(next, todayKey)) setIsRecoveryCheckOpen(true)
  }

  /** 회복 모드의 '지금 할 수 있는 가장 작은 것' 으로 15분 즉석 카드를 시작합니다 */
  function handleRecoveryStart(smallStep: string) {
    const base = createInstantCardNow(todayKey, RECOVERY_MINUTES)
    const title = smallStep.trim() || '아주 작게 시작'
    const card = { ...base, title, checklist: [{ id: `${base.id}-item-0`, text: title }] }
    addCard(card)
    session.start(card, todayKey)
  }

  function handleStartNow(minutes: number) {
    const card = createInstantCardNow(todayKey, minutes)
    addCard(card)
    session.start(card, todayKey)
  }

  if (active) {
    const activeCard = cards.find((card) => card.id === active.cardId)
    return (
      <SessionView
        session={session}
        card={activeCard}
        now={now}
        experimentRule={experimentRuleOf(active.cardId)}
        onFinished={handleFinished}
      />
    )
  }

  const shownFlow = startFlow ?? paramFlow
  if (shownFlow?.step === 'pledge' && pledge?.audioDataUrl) {
    return (
      <PledgeGate
        cardTitle={shownFlow.card.title}
        audioDataUrl={pledge.audioDataUrl}
        text={pledge.text}
        onDone={() => {
          setCardParam('')
          if (isCountdownToday) setStartFlow({ card: shownFlow.card, step: 'countdown' })
          else {
            session.start(shownFlow.card, todayKey)
            setStartFlow(null)
          }
        }}
      />
    )
  }
  if (shownFlow?.step === 'countdown') {
    return (
      <CountdownView
        card={shownFlow.card}
        onDone={() => {
          session.start(shownFlow.card, todayKey)
          setStartFlow(null)
          setCardParam('')
        }}
        onCancel={() => {
          setStartFlow(null)
          setCardParam('')
        }}
      />
    )
  }

  if (session.play) {
    const nextCard = waitingCards[0]
    return (
      <PlayView
        session={session}
        now={now}
        nextCard={nextCard}
        onStartNext={() => {
          // 놀기를 끝내고(초과 휴식이 기록됨) 바로 다음 카드를 시작합니다.
          session.finishPlay()
          if (nextCard) beginCard(nextCard)
          else handleStartNow(DEFAULT_INSTANT_MINUTES)
        }}
      />
    )
  }

  const endedCard = endedRecord ? cards.find((card) => card.id === endedRecord.cardId) : undefined

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">타이머</h1>
        <p className="mt-2 text-slate-600">
          카드를 누르면 바로 시작해요. 시계는 카드가 끝나는 시각까지 줄어들어요.
        </p>
      </div>

      {isRecoveryMode && (
        <RecoveryCard reason={latestStage?.reason} onStart={handleRecoveryStart} />
      )}

      {isStage4 && (
        <Card className="border-red-200 bg-red-50">
          <p className="font-semibold text-red-800">관리 4단계 · 강제적 채찍</p>
          <p className="mt-1 text-sm break-keep text-red-800">
            {loadLatestCareStage(todayKey)?.reason}
          </p>
          <ul className="mt-2 list-disc pl-5 text-sm text-red-800">
            <li>미루기가 잠겼어요.</li>
            {stage4Absolute && (
              <li>
                '{cards.find((card) => card.id === stage4Absolute.cardId)?.title}' (
                {stage4Absolute.dateKey.slice(5).replace('-', '/')}) 은 꼭 해야 하는 카드가 됐어요.
              </li>
            )}
            <li>끝날 때 증빙이 있어야 한 것으로 쳐요.</li>
            {hasPledgeAudio && (
              <li>카드를 시작하기 전에 내 다짐을 {PLEDGE_GATE_SECONDS}초 들어요.</li>
            )}
          </ul>
          <p className="mt-2 text-sm font-medium text-red-900">
            증빙이 있는 실행을 한 번 하면 3단계로 내려가요.
          </p>
        </Card>
      )}

      {notice && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-800"
        >
          <p className="break-keep">{notice}</p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="h-10 shrink-0 rounded-md px-3 font-medium hover:bg-slate-200"
          >
            확인
          </button>
        </div>
      )}

      {unhandledCards.length > 0 && (
        <Card title="시간이 끝난 카드">
          <p className="text-sm text-slate-600">
            시작하지 못했어요. 미룰지, 못 했다고 남길지 골라요.
          </p>
          {/* 아프거나 너무 지쳐서 오늘 전체를 못 한 날은 사후에 '쉰 날' 로 처리할 수 있어요. (월 4회, #407) */}
          <button
            type="button"
            onClick={() => (restLeft > 0 ? setIsRestOpen(true) : setIsRecoveryCheckOpen(true))}
            className="mt-2 h-10 text-sm font-medium text-slate-700 underline underline-offset-2"
          >
            {restLeft > 0
              ? `아프거나 너무 지쳤어요 · 오늘은 쉰 날로 (이번 달 ${restLeft}번 남음)`
              : '이번 달 쉬는 날을 다 썼어요'}
          </button>
          <ul className="mt-3 flex flex-col gap-2">
            {unhandledCards.map(withStage4).map((card) => {
              const left = postponeLeft(card)
              return (
                <li
                  key={card.id}
                  className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{card.title}</p>
                    <p className="text-sm text-slate-600">
                      {card.startTime} · {formatMinutes(card.durationMinutes)}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:flex">
                    <Button
                      variant="secondary"
                      disabled={left === 0}
                      onClick={() => setMissTarget({ card, action: 'postpone' })}
                    >
                      {card.priority === 'absolute'
                        ? '미룰 수 없음'
                        : isPostponeLocked
                          ? '미루기 잠김'
                          : `미루기 (${left}회 남음)`}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setMissTarget({ card, action: 'fail' })}
                    >
                      실패로 기록
                    </Button>
                    {lateEntryOf(card).ok && (
                      <Button
                        variant="ghost"
                        className="col-span-2 border border-slate-300"
                        onClick={() => setMissTarget({ card, action: 'late' })}
                      >
                        폰을 내서 못 켰어요 · 나중에 적기
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Card title="오늘 남은 카드">
          {waitingCards.length === 0 ? (
            <p className="text-sm text-slate-600">
              오늘 할 카드가 없어요. 카드 없이 바로 시작해도 돼요.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {waitingCards.map(withStage4).map((card, index) => (
                <WaitingCardRow
                  key={card.id}
                  card={card}
                  isNext={index === 0}
                  postponeLeft={postponeLeft(card)}
                  experimentRule={experimentRuleOf(card.id)}
                  onStart={() => beginCard(card)}
                  onPostpone={() => setMissTarget({ card, action: 'postpone' })}
                  onFail={() => setMissTarget({ card, action: 'fail' })}
                  onStartOffline={() => session.start(card, todayKey, 'offline')}
                />
              ))}
            </ul>
          )}
        </Card>

        <InstantStart onStart={handleStartNow} />
        <PlaySetup onStart={session.startPlay} />
      </div>

      {missTarget?.action === 'postpone' && (
        <PostponeCardModal
          isOpen
          cardTitle={missTarget.card.title}
          leftCount={postponeLeft(missTarget.card)}
          defaultDate={todayKey}
          defaultTime={formatClock(listNow + 60 * MS_PER_MINUTE)}
          onClose={() => setMissTarget(null)}
          onPostpone={(reason, newDate, newTime) =>
            handlePostpone(missTarget.card, reason, newDate, newTime)
          }
        />
      )}
      {missTarget?.action === 'late' &&
        (() => {
          const check = lateEntryOf(missTarget.card)
          return check.ok ? (
            <LateEntryModal
              isOpen
              cardTitle={missTarget.card.title}
              checklist={missTarget.card.checklist}
              maxMinutes={check.maxMinutes}
              onClose={() => setMissTarget(null)}
              onSave={(minutes, checkedIds, proofText) =>
                handleLateEntry(missTarget.card, minutes, checkedIds, proofText)
              }
            />
          ) : null
        })()}
      {missTarget?.action === 'fail' && (
        <FailCardModal
          isOpen
          cardTitle={missTarget.card.title}
          onClose={() => setMissTarget(null)}
          onFail={(cause) => handleFail(missTarget.card, cause)}
        />
      )}
      <CrisisHelpModal isOpen={isCrisisOpen} onClose={() => setIsCrisisOpen(false)} />
      <Modal
        isOpen={isRestOpen}
        onClose={() => setIsRestOpen(false)}
        title="오늘은 쉰 날로 할까요?"
      >
        <p className="text-sm text-slate-700">
          어쩔 수 없이 못 한 날만 쉰 날로 해요. 쉰 날의 카드는 실패로 세지 않아요. 이번 달{' '}
          {restLeft}번 남았어요.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {REST_REASONS.map((item) => (
            <Button
              key={item.key}
              variant="secondary"
              className="h-12"
              onClick={() => handleRest(item.key)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </Modal>
      <Modal
        isOpen={isRecoveryCheckOpen}
        onClose={() => setIsRecoveryCheckOpen(false)}
        title="요즘 많이 지쳤나 봐요"
      >
        <p className="text-sm break-keep text-slate-700">
          쉬는 날이 이어지고 있어요. 앱은 회복 모드로 계획을 줄여서 갈게요. 혼자 버티기 힘들면 주변
          어른이나 상담에 이야기해 보세요.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => setIsRecoveryCheckOpen(false)}>
            알겠어요
          </Button>
          <Button
            onClick={() => {
              setIsRecoveryCheckOpen(false)
              setIsCrisisOpen(true)
            }}
          >
            도움 연결 보기
          </Button>
        </div>
      </Modal>

      {endedRecord && (
        <EndPopup
          record={endedRecord}
          card={endedCard}
          onSave={(changes) => {
            session.updateSession(endedRecord.id, changes)
            setEndedRecord({ ...endedRecord, ...changes })
          }}
          onRenameCard={(changes) => endedCard && updateCard(endedCard.id, changes)}
          onClose={() => setEndedRecord(null)}
          onRest={() => {
            setEndedRecord(null)
            document.getElementById(PLAY_SETUP_ID)?.scrollIntoView({ behavior: 'smooth' })
          }}
          proofRequired={isStage4}
          onProofSaved={() => {
            // 4단계에서 증빙이 있는 실행을 했으면 4단계를 풉니다. (「5.4」 해제 조건)
            if (isStage4) {
              releaseStage4(todayKey)
              setNotice('증빙이 있는 실행을 해서 4단계를 풀고 3단계로 내려왔어요.')
            }
          }}
        />
      )}
    </div>
  )
}

interface WaitingCardRowProps {
  card: CardModel
  isNext: boolean
  /** 남은 미루기 횟수 (0 이면 [실패로 기록] 만) */
  postponeLeft: number
  /** 이 카드에 붙은 자기 실험 규칙 (#412). 없으면 undefined */
  experimentRule?: string
  onStart: () => void
  onPostpone: () => void
  onFail: () => void
  /** 야자처럼 폰을 내야 할 때 — 폰을 내고, 돌려받은 뒤 끝냅니다 (#402) */
  onStartOffline: () => void
}

/**
 * 대기 화면의 카드 한 줄. 맨 위(다음 카드)는 크게 보입니다.
 * 미루기는 일부러 ⋯ 메뉴 안에 둡니다 (찾기 조금 불편하게, 「4.4」). 절대 카드는 미루기가 없습니다.
 */
function WaitingCardRow({
  card,
  isNext,
  postponeLeft,
  experimentRule,
  onStart,
  onPostpone,
  onFail,
  onStartOffline,
}: WaitingCardRowProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  return (
    <li
      className={cn(
        'flex items-center justify-between gap-3 rounded-lg border px-3 py-2',
        isNext ? 'border-brand bg-brand/5' : 'border-slate-200',
      )}
    >
      <div className="min-w-0">
        {isNext && <p className="text-brand text-xs font-semibold">다음 카드</p>}
        <p className="truncate font-medium text-slate-900">{card.title}</p>
        {experimentRule && (
          <p className="truncate text-xs text-violet-700">실험: {experimentRule}</p>
        )}
        <p className="text-sm text-slate-600">
          {card.startTime ?? '시간 미정'} · {formatMinutes(card.durationMinutes)}
          {card.priority === 'absolute' && ' · 꼭 해야 함'}
        </p>
      </div>
      <div className="relative flex shrink-0 items-center gap-1">
        <Button size={isNext ? 'md' : 'sm'} className="h-10" onClick={onStart}>
          시작
        </Button>
        <button
          type="button"
          aria-label={`${card.title} 메뉴`}
          aria-expanded={isMenuOpen}
          onClick={() => setIsMenuOpen((value) => !value)}
          className="h-10 w-10 rounded-lg text-lg text-slate-500 hover:bg-slate-100"
        >
          ⋯
        </button>
        {isMenuOpen && (
          <div className="absolute top-11 right-0 z-10 flex w-40 flex-col rounded-lg border border-slate-200 bg-white p-1 shadow-md">
            {card.priority !== 'absolute' && (
              <button
                type="button"
                disabled={postponeLeft === 0}
                onClick={() => {
                  setIsMenuOpen(false)
                  onPostpone()
                }}
                className="h-10 rounded-md px-3 text-left text-sm hover:bg-slate-50 disabled:text-slate-400"
              >
                미루기 ({postponeLeft}회 남음)
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(false)
                onFail()
              }}
              className="h-10 rounded-md px-3 text-left text-sm hover:bg-slate-50"
            >
              못 했다고 기록
            </button>
            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(false)
                onStartOffline()
              }}
              className="h-10 rounded-md px-3 text-left text-sm hover:bg-slate-50"
            >
              폰 내고 시작 (오프라인)
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

interface InstantStartProps {
  onStart: (minutes: number) => void
}

/** [지금 시작] — 카드 없이 시작하면 '언제 = 지금' 인 즉석 카드가 생깁니다 */
function InstantStart({ onStart }: InstantStartProps) {
  const [minutes, setMinutes] = useState(DEFAULT_INSTANT_MINUTES)
  return (
    <Card title="카드 없이 지금 시작">
      <p className="text-sm text-slate-600">제목과 할 일은 끝날 때 한 줄로 적어요.</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {INSTANT_MINUTES.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={minutes === value}
            onClick={() => setMinutes(value)}
            className={cn(
              'h-10 rounded-lg border text-sm font-medium',
              minutes === value
                ? 'border-brand bg-brand/10 text-brand'
                : 'border-slate-200 text-slate-700',
            )}
          >
            {value}분
          </button>
        ))}
      </div>
      <Button size="lg" className="mt-4 w-full" onClick={() => onStart(minutes)}>
        ▷ 지금 시작
      </Button>
    </Card>
  )
}

interface SessionViewProps {
  session: ReturnType<typeof useCardSession>
  card: CardModel | undefined
  now: number
  /** 세션이 끝나 기록을 저장한 뒤 부릅니다 (종료 팝업을 띄움) */
  onFinished: (record: StudySession) => void
  /** 이 카드에 붙은 자기 실험 규칙 (#412) */
  experimentRule?: string
}

/** 세션 화면 — 나가는 길은 [일시정지] · [끝내기] 뿐입니다 */
function SessionView({ session, card, now, onFinished, experimentRule }: SessionViewProps) {
  const active = session.active
  const [settings] = useState(loadAutoSettings)
  const [isEndOpen, setIsEndOpen] = useState(false)
  const [isPauseOpen, setIsPauseOpen] = useState(false)
  const [memo, setMemo] = useState('')
  const remainingMs = active ? getRemainingMs(active, now) : 0
  useKeepScreenOn(active !== null)

  // 예정 종료 시각이 되면 알리고 끝냅니다. (완료 기준은 예정 시간이 끝난 것)
  useEffect(() => {
    if (active && remainingMs === 0) {
      playAlarm()
      const record = session.finish()
      if (record) onFinished(record)
    }
  }, [active, remainingMs, session, onFinished])

  // 일시정지가 15분을 넘으면 복귀 알림을 한 번 보냅니다. (앱을 뒤로 보내 둔 동안에도 뜨게 시스템 알림도 씁니다)
  const isLongPause = active !== null && shouldAlertLongPause(active, now)
  useEffect(() => {
    if (!isLongPause) return
    playAlarm()
    void showSystemNotification({
      title: `${LONG_PAUSE_MINUTES}분째 멈춰 있어요`,
      body: '다시 시작할까요? 끝나는 시각은 그대로예요.',
      tag: 'card-pause-long',
      url: '/timer',
    })
    session.markLongPauseAlerted()
  }, [isLongPause, session])

  if (!active) return null
  const runMinutes = Math.floor(getRunMs(active, now) / MS_PER_MINUTE)
  const progress = (runMinutes / Math.max(1, active.plannedMinutes)) * 100
  const isPaused = active.pausedNow !== undefined
  const checklist = card?.checklist ?? []
  const checkedCount = checklist.filter((item) => active.checked[item.id]).length
  const isOffline = active.mode === 'offline'
  // 오프라인 세션은 폰을 내고 하는 것이라 체크리스트 · 주차장을 보이지 않습니다. (끝날 때 종료 팝업에서 체크)
  const showChecklist = settings.timerMode.value === 'checklist' && !isOffline

  function handleSaveMemo() {
    session.addMemo(memo)
    setMemo('')
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <Card className="flex flex-col items-center gap-4 py-8 text-center">
        <p className="max-w-full truncate text-lg font-semibold text-slate-900">
          {card?.title ?? '공부'}
        </p>
        {experimentRule && (
          <p className="rounded-full bg-violet-50 px-3 py-1 text-sm text-violet-800">
            실험 중: {experimentRule}
          </p>
        )}
        <span
          className={cn(
            'rounded-full px-3 py-1 text-sm font-medium',
            isPaused ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700',
          )}
        >
          {isPaused ? '잠깐 멈춤' : isOffline ? '● 오프라인 · 폰 내고 공부 중' : '● 공부 중'}
        </span>
        {active.pausedNow?.alerted && (
          <p className="text-sm font-medium text-amber-700">
            {LONG_PAUSE_MINUTES}분 넘게 멈춰 있어요. 준비되면 다시 시작해요.
          </p>
        )}
        <p
          className="text-6xl font-bold tracking-tight text-slate-900 tabular-nums sm:text-7xl"
          aria-live="off"
        >
          {formatRemaining(remainingMs)}
        </p>
        <p className="font-medium text-slate-700">
          {active.plannedMinutes}분 중 {runMinutes}분 했어요
        </p>
        <ProgressBar value={progress} className="w-full max-w-sm" />
        <p className="text-sm text-slate-500">
          {formatClock(active.startedAt)} 시작 · {formatClock(active.endAt)}에 끝나요 · 일시정지{' '}
          {active.pauses.length + (isPaused ? 1 : 0)}번
        </p>

        <div className="grid w-full max-w-sm grid-cols-2 gap-3">
          {isPaused ? (
            <Button size="lg" onClick={session.resume}>
              다시 시작
            </Button>
          ) : (
            <Button size="lg" variant="secondary" onClick={() => setIsPauseOpen(true)}>
              일시정지
            </Button>
          )}
          <Button
            size="lg"
            variant="ghost"
            className="border border-slate-300"
            onClick={() => setIsEndOpen(true)}
          >
            끝내기
          </Button>
        </div>
        <p className="text-xs text-slate-500">
          공부 중에는 화면이 꺼지지 않아요. 일시정지해도 끝나는 시각은 그대로예요.
        </p>
      </Card>

      {showChecklist && checklist.length > 0 && (
        <Card title={`체크리스트 ${checkedCount}/${checklist.length}`}>
          <ul className="flex flex-col gap-1">
            {checklist.map((item) => (
              <li key={item.id}>
                <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="accent-brand size-5"
                    checked={Boolean(active.checked[item.id])}
                    onChange={() => session.toggleCheck(item.id)}
                  />
                  <span
                    className={cn(
                      'text-slate-800',
                      active.checked[item.id] && 'text-slate-400 line-through',
                    )}
                  >
                    {item.text}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {settings.parkingLot.value && !isOffline && (
        <Card title="딴생각 주차장">
          <p className="text-sm text-slate-600">
            떠오른 걱정이나 할 일을 한 줄 적고 바로 돌아와요.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              maxLength={100}
              placeholder="예: 엄마한테 문자하기"
              className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm"
            />
            <Button onClick={handleSaveMemo}>적기</Button>
          </div>
          {active.memos.length > 0 && (
            <p className="mt-2 text-sm text-slate-500">{active.memos.length}개 적어 뒀어요</p>
          )}
        </Card>
      )}

      <PausePicker
        isOpen={isPauseOpen}
        onClose={() => setIsPauseOpen(false)}
        onPick={(tag, note) => {
          setIsPauseOpen(false)
          session.pause(tag, note)
        }}
      />

      <Modal isOpen={isEndOpen} onClose={() => setIsEndOpen(false)} title="지금 끝낼까요?">
        <p className="text-slate-700">
          아직 {formatMinutes(Math.ceil(remainingMs / MS_PER_MINUTE))} 남았어요. 지금 끝내면 '중간에
          끝냈어요'로 남아요.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => setIsEndOpen(false)}>
            계속하기
          </Button>
          <Button
            onClick={() => {
              setIsEndOpen(false)
              const record = session.finish()
              if (record) onFinished(record)
            }}
          >
            끝내기
          </Button>
        </div>
      </Modal>
    </div>
  )
}

interface PausePickerProps {
  isOpen: boolean
  onClose: () => void
  onPick: (tag: PauseTag, note?: string) => void
}

/**
 * 일시정지 이유 1탭 (「4.4 타이머」 일시정지, #397)
 * 누르는 순간 멈춥니다. '기타' 만 한 줄을 받고(빈칸 허용) [멈추기] 를 누릅니다.
 * 이유는 귀인(내 쪽 / 바깥)과 주의 분산을 보는 재료라서 꼭 하나를 고르게 합니다.
 */
function PausePicker({ isOpen, onClose, onPick }: PausePickerProps) {
  const [isOther, setIsOther] = useState(false)
  const [note, setNote] = useState('')

  function handleClose() {
    setIsOther(false)
    setNote('')
    onClose()
  }

  function pick(tag: PauseTag, text?: string) {
    setIsOther(false)
    setNote('')
    onPick(tag, text?.trim() || undefined)
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="왜 멈추나요?">
      {isOther ? (
        <div className="flex flex-col gap-3">
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={100}
            placeholder="한 줄로 적어요 (안 적어도 돼요)"
            className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
          />
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={() => setIsOther(false)}>
              뒤로
            </Button>
            <Button onClick={() => pick('other', note)}>멈추기</Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {PAUSE_TAGS.map((item) => (
            <Button
              key={item.key}
              variant="secondary"
              className="h-12"
              onClick={() => (item.key === 'other' ? setIsOther(true) : pick(item.key))}
            >
              {item.label}
            </Button>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">
        멈춘 시간은 한 시간에서 빠지고, 끝나는 시각은 그대로예요.
      </p>
    </Modal>
  )
}

/** 종료 팝업의 단계 — 체크리스트 → 같이 한 것 → 증빙 → (가끔) 잘 된 이유 → 다음 행동 */
type EndStep = 'checklist' | 'with' | 'proof' | 'good' | 'next'

interface EndPopupProps {
  record: StudySession
  card: CardModel | undefined
  /** 기록에 붙일 칸 (endReport) — 단계마다 저장해서, 중간에 닫아도 고른 것은 남습니다 */
  onSave: (changes: Pick<StudySession, 'endReport'>) => void
  /** 즉석 카드의 제목 · 체크리스트를 정했을 때 */
  onRenameCard: (changes: Pick<CardModel, 'title' | 'checklist'>) => void
  onClose: () => void
  /** [쉬기 → 놀기 타이머] */
  onRest: () => void
  /** 관리 4단계라 증빙이 꼭 필요한지 — 없으면 실행으로 인정하지 않습니다 (#408) */
  proofRequired: boolean
  /** 증빙을 남겼을 때 */
  onProofSaved: () => void
}

/**
 * 종료 팝업 (최종 기획서 「4.4 타이머」 종료, #398) — 산출물 말고는 모두 1탭입니다.
 * 1. 체크리스트 최종 확인 (다 못 했으면 미달 사유 1탭) · 즉석 카드면 "무엇을 했나요?" 한 줄
 * 2. 같이 한 것: 음악 / 영상 틀어둠 / 없음
 * 3. 산출물 증빙: 링크나 2~3줄 요약 (선택 — 남기면 나무가 더 자람)
 * 4. 잘 된 이유: 체크리스트를 다 했을 때 N번에 1번만
 * 5. 다음 행동
 */
function EndPopup({
  record,
  card,
  onSave,
  onRenameCard,
  onClose,
  onRest,
  proofRequired,
  onProofSaved,
}: EndPopupProps) {
  const [step, setStep] = useState<EndStep>('checklist')
  const [settings] = useState(loadAutoSettings)
  const report: SessionEndReport = record.endReport ?? { checked: {} }
  const [checked, setChecked] = useState<Record<string, number>>(report.checked)
  const [shortfall, setShortfall] = useState<ShortfallReason | undefined>(report.shortfallReason)
  const [line, setLine] = useState('')
  // 즉석 카드: AI 가 한 줄을 제목 + 체크리스트로 정리한 초안 (#419 표 7번, BE /ai/quick-card)
  const isServerData = useIsServerData()
  const [draft, setDraft] = useState<(QuickCardDraft & { line: string }) | null>(null)
  const [draftChoice, setDraftChoice] = useState<'ai' | 'mine'>('ai')
  // 같은 한 줄로 두 번 묻지 않게, 마지막으로 물어본 한 줄을 기억합니다. (하루 한도가 있어서)
  const [askedLine, setAskedLine] = useState('')
  const { mutate: askQuickCard, isPending: isAskingQuickCard } = useMutation({
    mutationFn: requestQuickCard,
    onSuccess: (result, sentLine) => {
      if (!result) return
      setDraft({ ...result, line: sentLine })
      setDraftChoice('ai')
    },
  })
  // 지금 적힌 한 줄을 정리한 초안만 씁니다. 한 줄을 고치면 예전 초안은 쓰지 않습니다.
  const currentDraft = draft !== null && draft.line === line.trim() ? draft : null
  const [proofText, setProofText] = useState('')
  const isInstant = card !== undefined && isUntitledInstantCard(card)
  const checklist = card?.checklist ?? []
  const isComplete = isInstant || isChecklistComplete(checklist, checked)

  // 즉석 카드의 한 줄을 다 적고 1.5초 멈추면 AI 에게 정리를 부탁합니다. (글자마다 묻지 않으려고 기다립니다)
  useEffect(() => {
    const trimmed = line.trim()
    if (!isInstant || !isServerData || trimmed === '' || trimmed === askedLine) return
    const timerId = setTimeout(() => {
      setAskedLine(trimmed)
      askQuickCard(trimmed)
    }, QUICK_CARD_WAIT_MS)
    return () => clearTimeout(timerId)
  }, [line, isInstant, isServerData, askedLine, askQuickCard])

  function save(changes: Partial<SessionEndReport>) {
    onSave({ endReport: { ...report, checked, ...changes } })
  }

  function handleChecklistDone() {
    let finalChecked = checked
    if (isInstant && card) {
      // AI 정리를 골랐으면 그 초안으로, 아니면 내가 쓴 한 줄 그대로 나눕니다.
      const parsed =
        currentDraft && draftChoice === 'ai'
          ? draftToInstant(currentDraft, card.id)
          : splitInstantLine(line, card.id)
      if (parsed) {
        onRenameCard(parsed)
        // 즉석 카드는 "한 것" 을 적는 것이라 적은 항목을 모두 한 것으로 봅니다.
        finalChecked = Object.fromEntries(parsed.checklist.map((item) => [item.id, record.endedAt]))
        setChecked(finalChecked)
      }
    }
    onSave({
      endReport: {
        ...report,
        checked: finalChecked,
        ...(isComplete ? {} : { shortfallReason: shortfall }),
      },
    })
    setStep('with')
  }

  function handleProofDone(skip: boolean) {
    const text = proofText.trim()
    if (!skip && text !== '') {
      const isLink = /^https?:\/\//.test(text)
      save({
        proof: isLink ? { link: text } : { summary: text },
        ...(proofRequired ? { proofRequired } : {}),
      })
      onProofSaved()
    } else if (proofRequired) {
      // 증빙 없이 끝내면 이 세션은 실행으로 치지 않습니다. (cardResult.ts 가 뺍니다)
      save({ proofRequired: true })
    }
    // 잘 된 이유는 체크리스트를 다 했을 때만, 설정의 빈도대로 가끔 묻습니다.
    const askGood =
      isComplete && shouldAskGoodReason(countChecklistComplete(), settings.goodReasonEvery.value)
    setStep(askGood ? 'good' : 'next')
  }

  const needsShortfall = !isInstant && !isComplete && shortfall === undefined
  const canFinishChecklist = isInstant ? line.trim() !== '' : !needsShortfall

  return (
    <Modal isOpen onClose={onClose} title="수고했어요! 마무리해요">
      {step === 'checklist' && (
        <div className="flex flex-col gap-3">
          {isInstant ? (
            <>
              <p className="text-sm text-slate-700">
                무엇을 했나요? 쉼표(,)로 나누면 할 일이 여러 개가 돼요.
              </p>
              <input
                value={line}
                onChange={(event) => setLine(event.target.value)}
                maxLength={100}
                placeholder="예: 수학, 문제집 42쪽, 오답 정리"
                className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
              />
              {isAskingQuickCard && <p className="text-xs text-slate-500">AI 가 정리하는 중…</p>}
              {currentDraft && (
                <div className="flex flex-col gap-2 rounded-lg bg-violet-50 px-3 py-3 text-sm">
                  <p className="break-keep text-slate-700">
                    <span className="text-xs font-semibold text-violet-700">AI 추천</span> 이렇게
                    정리할까요? 한 일과 다르면 &quot;내가 쓴 그대로&quot; 를 골라 주세요.
                  </p>
                  <p className="font-semibold break-keep text-slate-900">{currentDraft.title}</p>
                  <ul className="list-disc pl-5 text-slate-700">
                    {currentDraft.items.map((item) => (
                      <li key={item} className="break-keep">
                        {item}
                      </li>
                    ))}
                  </ul>
                  <SegmentedToggle
                    label="한 줄 정리 방법"
                    options={[
                      { value: 'ai', label: 'AI 정리' },
                      { value: 'mine', label: '내가 쓴 그대로' },
                    ]}
                    value={draftChoice}
                    onChange={setDraftChoice}
                  />
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-slate-700">체크리스트를 마지막으로 확인해요.</p>
              <ul className="flex flex-col gap-1">
                {checklist.map((item) => (
                  <li key={item.id}>
                    <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        className="accent-brand size-5"
                        checked={checked[item.id] !== undefined}
                        onChange={() =>
                          setChecked((prev) => {
                            const next = { ...prev }
                            if (next[item.id] !== undefined) delete next[item.id]
                            else next[item.id] = record.endedAt
                            return next
                          })
                        }
                      />
                      <span className="text-slate-800">{item.text}</span>
                    </label>
                  </li>
                ))}
              </ul>
              {!isComplete && (
                <div>
                  <p className="text-sm font-medium text-slate-800">다 못 한 이유는요?</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {SHORTFALL_REASONS.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        aria-pressed={shortfall === item.key}
                        onClick={() => setShortfall(item.key)}
                        className={cn(
                          'h-10 rounded-lg border text-sm',
                          shortfall === item.key
                            ? 'border-brand bg-brand/10 text-brand'
                            : 'border-slate-200 text-slate-700',
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          <Button size="lg" disabled={!canFinishChecklist} onClick={handleChecklistDone}>
            다음
          </Button>
        </div>
      )}

      {step === 'with' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-700">공부하면서 같이 한 게 있나요?</p>
          <div className="grid grid-cols-3 gap-2">
            {WITH_WHAT_OPTIONS.map((item) => (
              <Button
                key={item.key}
                variant="secondary"
                className="h-12"
                onClick={() => {
                  save({ withWhat: item.key })
                  setStep('proof')
                }}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {step === 'proof' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-700">
            {proofRequired
              ? '관리 4단계라 증빙이 꼭 필요해요. 링크나 2~3줄 요약을 남겨야 한 것으로 쳐요.'
              : '한 것을 남겨 볼까요? 링크나 2~3줄 요약이면 돼요. 남기면 나무가 더 자라요.'}
          </p>
          <textarea
            value={proofText}
            onChange={(event) => setProofText(event.target.value)}
            maxLength={300}
            rows={3}
            placeholder="예: 42~45쪽 풀고 틀린 3문제 다시 풂"
            className="w-full rounded-lg border border-slate-300 p-3 text-sm"
          />
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={() => handleProofDone(true)}>
              {proofRequired ? '증빙 없이 끝내기 (안 한 것으로)' : '건너뛰기'}
            </Button>
            <Button disabled={proofText.trim() === ''} onClick={() => handleProofDone(false)}>
              남기기
            </Button>
          </div>
        </div>
      )}

      {step === 'good' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-700">다 해냈어요! 잘 된 이유는 뭐였을까요?</p>
          <div className="grid grid-cols-2 gap-2">
            {GOOD_REASONS.map((item) => (
              <Button
                key={item.key}
                variant="secondary"
                className="h-12"
                onClick={() => {
                  save({ goodReasons: [item.key] })
                  setStep('next')
                }}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {step === 'next' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-700">다음은 무엇을 할까요?</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Button variant="secondary" onClick={onRest}>
              쉬기 → 놀기 타이머
            </Button>
            <Button onClick={onClose}>다음 카드 보기</Button>
            <Button variant="ghost" onClick={onClose}>
              닫기
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// 종료 팝업의 [쉬기] 가 놀기 고르기 카드로 내려가게 붙이는 이름
const PLAY_SETUP_ID = 'play-setup'
const DEFAULT_PLAY_MINUTES = 15

interface PlaySetupProps {
  onStart: (minutes: number, tag: PlayTag) => void
}

/** [놀기] — 놀 시간과 무엇을 할지 고르고 시작합니다 (「4.4」 놀기 타이머, #401) */
function PlaySetup({ onStart }: PlaySetupProps) {
  const [minutes, setMinutes] = useState(DEFAULT_PLAY_MINUTES)
  const [tag, setTag] = useState<PlayTag>('rest')
  return (
    <Card title="놀기" id={PLAY_SETUP_ID} className="sm:col-span-2">
      <p className="text-sm text-slate-600">
        정한 시간이 끝나면 알려 주고 다음 카드로 이어 줘요. 더 쉬면 그 시간도 기록돼요.
      </p>
      <MinutesPicker
        label="놀 시간"
        presets={PLAY_MINUTE_PRESETS}
        value={minutes}
        onChange={setMinutes}
        max={180}
        className="mt-3"
      />
      <p className="mt-3 text-sm font-medium text-slate-800">무엇을 하며 쉬나요?</p>
      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {PLAY_TAGS.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={tag === item.key}
            onClick={() => setTag(item.key)}
            className={cn(
              'h-10 rounded-lg border text-sm',
              tag === item.key
                ? 'border-brand bg-brand/10 text-brand'
                : 'border-slate-200 text-slate-700',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <Button
        size="lg"
        variant="secondary"
        className="mt-4 w-full"
        onClick={() => onStart(minutes, tag)}
      >
        놀기 시작
      </Button>
    </Card>
  )
}

interface PlayViewProps {
  session: ReturnType<typeof useCardSession>
  now: number
  nextCard: CardModel | undefined
  onStartNext: () => void
}

/**
 * 놀기 화면. 끝나기 1분 전에 한 번 알리고, 끝나면 다음 카드 시작 화면이 됩니다.
 * 끝난 뒤 [카드 시작] · [놀기 끝] 을 누를 때까지의 시간이 초과 휴식으로 보입니다.
 */
function PlayView({ session, now, nextCard, onStartNext }: PlayViewProps) {
  const play = session.play
  const isOver = play !== null && isPlayOver(play, now)
  const isWarnTime = play !== null && shouldWarnPlayEnd(play, now)
  const needsEndAlert = isOver && !play?.endAlerted
  useKeepScreenOn(play !== null)

  // 끝나기 1분 전 알림 (한 번)
  useEffect(() => {
    if (!isWarnTime) return
    playAlarm()
    void showSystemNotification({
      title: `놀기가 ${PLAY_WARN_MINUTES}분 남았어요`,
      body: '이제 슬슬 다음 카드를 준비해요.',
      tag: 'play-warn',
      url: '/timer',
    })
    session.markPlayAlert('warned')
  }, [isWarnTime, session])

  // 끝났을 때 알림 (한 번)
  useEffect(() => {
    if (!needsEndAlert) return
    playAlarm()
    void showSystemNotification({
      title: '놀기 끝!',
      body: nextCard ? `다음 카드: ${nextCard.title}` : '이제 공부를 시작해요.',
      tag: 'play-end',
      url: '/timer',
    })
    session.markPlayAlert('endAlerted')
  }, [needsEndAlert, nextCard, session])

  if (!play) return null
  const tagLabel = PLAY_TAGS.find((item) => item.key === play.tag)?.label ?? '쉬기'

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <Card className="flex flex-col items-center gap-4 py-8 text-center">
        <span className="rounded-full bg-sky-50 px-3 py-1 text-sm font-medium text-sky-700">
          {isOver ? '놀기 끝' : `놀기 중 · ${tagLabel}`}
        </span>
        {isOver ? (
          <>
            <p className="text-lg font-semibold text-slate-900">이제 다시 시작해요</p>
            <p className="text-5xl font-bold text-amber-600 tabular-nums">
              +{formatRemaining(now - play.endAt)}
            </p>
            <p className="text-sm text-slate-600">놀기가 끝난 뒤 더 쉰 시간(초과 휴식)이에요.</p>
            {nextCard && (
              <p className="max-w-full truncate text-sm text-slate-700">
                다음 카드: {nextCard.title}
              </p>
            )}
            <div className="grid w-full max-w-sm grid-cols-1 gap-3 sm:grid-cols-2">
              <Button size="lg" onClick={onStartNext}>
                {nextCard ? '다음 카드 시작' : '지금 시작'}
              </Button>
              <Button size="lg" variant="secondary" onClick={() => session.finishPlay()}>
                놀기 끝
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-6xl font-bold tracking-tight text-slate-900 tabular-nums sm:text-7xl">
              {formatRemaining(play.endAt - now)}
            </p>
            <p className="text-sm text-slate-500">{formatClock(play.endAt)}에 끝나요</p>
            <Button
              size="lg"
              variant="secondary"
              className="w-full max-w-sm"
              onClick={() => session.finishPlay()}
            >
              그만 놀기
            </Button>
          </>
        )}
      </Card>
    </div>
  )
}

// 카운트다운 길이 (초)
const COUNTDOWN_SECONDS = 5

interface CountdownViewProps {
  card: CardModel
  onDone: () => void
  onCancel: () => void
}

/**
 * 5초 카운트다운 (「4.4 타이머」 시작, #399)
 * 체크리스트 첫 항목을 아주 작은 준비 행동으로 바꿔 보여 주고, 5초 동안 째깍 소리를 낸 뒤 시작합니다.
 * [더 작게] 로 최대 2번 더 쪼갤 수 있고, 누르면 5초부터 다시 셉니다.
 * (준비 행동 문장은 지금은 기본 문장이고, AI 추천은 #413 에서 붙입니다)
 */
function CountdownView({ card, onDone, onCancel }: CountdownViewProps) {
  const [seconds, setSeconds] = useState(COUNTDOWN_SECONDS)
  const [level, setLevel] = useState(0)
  const firstItem = card.checklist[0]?.text ?? card.title
  // AI 가 만든 준비 행동 (단계마다). 받기 전이나 못 받으면 기본 문장을 씁니다. (#413, BE /ai/first-step)
  const [aiSteps, setAiSteps] = useState<Record<number, string>>({})
  const { mutate: askFirstStep } = useMutation({
    mutationFn: requestFirstStep,
    onSuccess: (step, variables) => {
      if (step) setAiSteps((prev) => ({ ...prev, [variables.level]: step }))
    },
  })
  const shownStep = aiSteps[level] ?? getPrepStep(firstItem, level)

  // 처음 한 번 0단계 준비 행동을 부탁합니다.
  useEffect(() => {
    askFirstStep({ item: firstItem, title: card.title, level: 0 })
  }, [askFirstStep, firstItem, card.title])
  // 부모 화면이 다시 그려져서 onDone 이 새 함수가 되어도 카운트가 처음부터 다시 시작하지 않게, 최신 함수를 ref 에 둡니다.
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  })

  useEffect(() => {
    if (seconds <= 0) {
      onDoneRef.current()
      return
    }
    playTick()
    const id = setTimeout(() => setSeconds((value) => value - 1), 1000)
    return () => clearTimeout(id)
  }, [seconds])

  function handleShrink() {
    const next = Math.min(MAX_SHRINK, level + 1)
    setLevel(next)
    setSeconds(COUNTDOWN_SECONDS)
    // 방금 보여 준 것보다 더 작게 만들어 달라고 부탁합니다.
    askFirstStep({ item: firstItem, title: card.title, level: next, previousStep: shownStep })
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <Card className="flex flex-col items-center gap-4 py-10 text-center">
        <p className="text-sm font-medium text-slate-500">{card.title} · 이것만 먼저 해요</p>
        <p className="text-2xl font-bold break-keep text-slate-900 sm:text-3xl">{shownStep}</p>
        {aiSteps[level] && <span className="text-xs font-semibold text-violet-700">AI 추천</span>}
        <p className="text-brand text-7xl font-bold tabular-nums" aria-live="polite">
          {Math.max(0, seconds)}
        </p>
        <div className="grid w-full max-w-sm grid-cols-2 gap-3">
          <Button
            size="lg"
            variant="secondary"
            disabled={level >= MAX_SHRINK}
            onClick={handleShrink}
          >
            더 작게
          </Button>
          <Button size="lg" variant="ghost" className="border border-slate-300" onClick={onCancel}>
            그만
          </Button>
        </div>
        <p className="text-xs text-slate-500">0 이 되면 바로 시작해요.</p>
      </Card>
    </div>
  )
}

interface PledgeGateProps {
  cardTitle: string
  audioDataUrl: string
  /** 녹음할 때 적은 다짐 글 (없으면 빈 글자) */
  text: string
  onDone: () => void
}

/**
 * 관리 4단계 — 카드 시작 전에 내 다짐 녹음을 10초 들려줍니다. 건너뛸 수 없습니다. (「5.4」 4단계, #408)
 * 녹음은 기기에만 있고 서버로 보내지 않습니다.
 */
function PledgeGate({ cardTitle, audioDataUrl, text, onDone }: PledgeGateProps) {
  const [seconds, setSeconds] = useState(PLEDGE_GATE_SECONDS)
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  })

  // 처음 한 번 재생하고, 10초가 지나면 멈춥니다.
  useEffect(() => {
    const audio = new Audio(audioDataUrl)
    void audio.play().catch(() => {
      // 브라우저가 소리를 막아도 10초는 기다립니다. (글로 된 다짐이 화면에 있음)
    })
    return () => audio.pause()
  }, [audioDataUrl])

  useEffect(() => {
    if (seconds <= 0) {
      onDoneRef.current()
      return
    }
    const id = setTimeout(() => setSeconds((value) => value - 1), 1000)
    return () => clearTimeout(id)
  }, [seconds])

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <Card className="flex flex-col items-center gap-4 py-10 text-center">
        <p className="text-sm font-medium text-red-700">관리 4단계 · {cardTitle} 시작 전에</p>
        <p className="text-lg font-semibold text-slate-900">처음에 한 내 다짐을 들어요</p>
        {text.trim() !== '' && (
          <p className="max-w-sm text-base break-keep text-slate-700">“{text}”</p>
        )}
        <p className="text-6xl font-bold text-red-600 tabular-nums" aria-live="polite">
          {Math.max(0, seconds)}
        </p>
        <p className="text-xs text-slate-500">
          {PLEDGE_GATE_SECONDS}초가 지나면 바로 시작해요. 건너뛸 수 없어요.
        </p>
      </Card>
    </div>
  )
}

// 회복 모드에서 시작하는 즉석 카드 길이 (분)
const RECOVERY_MINUTES = 15

interface RecoveryCardProps {
  /** 판정이 남긴 이유 한 줄 */
  reason: string | undefined
  onStart: (smallStep: string) => void
}

/**
 * 회복 모드 카드 (최종 기획서 「4.5 상담」 회복 모드, #407)
 * What if 기법 — 최악의 상황을 떠올린 뒤, 그래도 지금 할 수 있는 가장 작은 것 하나를 15분만 해 봅니다.
 * 회복 모드에서는 나무가 시들지 않고 채찍도 쓰지 않습니다. 다음 날 다시 평가합니다.
 */
function RecoveryCard({ reason, onStart }: RecoveryCardProps) {
  const [smallStep, setSmallStep] = useState('')
  return (
    <Card className="border-sky-200 bg-sky-50">
      <p className="font-semibold text-sky-900">회복 모드</p>
      {reason && <p className="mt-1 text-sm break-keep text-sky-900">{reason}</p>}
      <ol className="mt-3 list-decimal pl-5 text-sm break-keep text-sky-900">
        <li>오늘 최악의 경우는 뭘까? (아무것도 못 해도 괜찮아. 세상이 끝나지 않아)</li>
        <li>그래도 지금 할 수 있는 가장 작은 것 하나는?</li>
      </ol>
      <input
        value={smallStep}
        onChange={(event) => setSmallStep(event.target.value)}
        maxLength={60}
        placeholder="예: 영어 단어 10개만 보기"
        className="mt-3 h-10 w-full rounded-lg border border-sky-300 bg-white px-3 text-sm"
      />
      <Button className="mt-3 w-full" onClick={() => onStart(smallStep)}>
        {RECOVERY_MINUTES}분만 해 보기
      </Button>
      <p className="mt-2 text-xs text-sky-800">
        회복 모드에서는 나무가 시들지 않아요. 내일 다시 볼게요.
      </p>
    </Card>
  )
}
