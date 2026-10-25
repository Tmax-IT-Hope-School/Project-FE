import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { FailCardModal } from '@/components/ui/FailCardModal'
import { ReasonChips } from '@/components/ui/ReasonChips'
import { LateEntryModal } from '@/components/ui/LateEntryModal'
import { PostponeCardModal } from '@/components/ui/PostponeCardModal'
import { useCardSession } from '@/hooks/useCardSession'
import { useCards } from '@/hooks/useCards'
import { useKeepScreenOn } from '@/hooks/useKeepScreenOn'
import { cancelPhoneFocusEarly, startPhoneFocusEarly, usePhoneLift } from '@/hooks/usePhoneLift'
import { useQueryParam } from '@/hooks/useQueryParam'
import { playAlarm } from '@/lib/alarm'
import {
  formatDuration,
  formatPhoneSummary,
  getLiftStrength,
  isFaceDownUnavailable,
  savePhoneSummary,
  type LiftStrength,
  type PhoneLiftSummary,
} from '@/lib/liftAlerts'
import { getTodayCareLevel } from '@/lib/todayCare'
import { formatClock } from '@/lib/away'
import {
  LONG_PAUSE_MINUTES,
  createInstantCardNow,
  getEndAtWithPauses,
  getRemainingMs,
  getRunMs,
  shouldAlertLongPause,
} from '@/lib/cardSession'
import { cn } from '@/lib/cn'
import { formatMinutes } from '@/lib/dailyRecords'
import { getTodayKey, moveDateKey, toDayKey } from '@/lib/date'
import { COACH_PATH, getChatRoom, startTalk, TALK_ROOM_OF } from '@/lib/chatRooms'
import { countsForCheckCall } from '@/lib/checkCall'
import { cardFailLines, sessionReviewLines } from '@/lib/talkLines'
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
  isStage4AbsoluteOn,
  isStage4Now,
  loadStage4Absolute,
  pickStage4Absolute,
  releaseStage4,
  saveStage4Absolute,
} from '@/lib/stage4'
import { CALL_TIME_STORAGE_KEY, parseCallTime } from '@/lib/callReminder'
import { buildLateEntrySession, checkLateEntry, makeLateEntryReport } from '@/lib/lateEntry'
import { loadData } from '@/lib/storage'
import { requestFirstStep, requestQuickCard, type QuickCardDraft } from '@/lib/aiCardApi'
import { YOUTH_HELP_LINE } from '@/lib/helpLines'
import { shrinkPhoto } from '@/lib/photoCards'
import { requestProofFromPhoto } from '@/lib/proofPhotoApi'
import { useIsServerData } from '@/hooks/useIsServerData'
import { SegmentedToggle } from '@/components/ui/SegmentedToggle'
import { MAX_SHRINK, getPrepStep, isCountdownOn } from '@/lib/cardAlerts'
import { loadLocalCheckIn } from '@/lib/quickCheckIn'
import { playTick } from '@/lib/tick'
import { showSystemNotification } from '@/lib/notifications'
import { isInApp, onAppMessage, sendToApp } from '@/lib/appBridge'
import {
  clearAwayTrack,
  closeAwayTrack,
  formatFocusEvidence,
  isLongAway,
  loadAwayTrack,
  saveAwayTrack,
  saveFocusScore,
  scoreEndedSession,
  type DistractionSpan,
  type FocusScoreRecord,
} from '@/lib/focusScore'
import { getSessionCardId } from '@/lib/sessionRecords'
import {
  countChecklistComplete,
  draftToInstant,
  isChecklistComplete,
  isUntitledInstantCard,
  shouldAskGoodReason,
  splitInstantLine,
} from '@/lib/endReport'
import { toReasonList, toggleReason } from '@/lib/reasons'
import {
  GOOD_REASONS,
  PAUSE_TAGS,
  SHORTFALL_REASONS,
  WITH_WHAT_OPTIONS,
  getShortfallReasons,
} from '@/lib/sessionTags'
import { loadAutoSettings } from '@/lib/settingsMapping'
import type {
  Card as CardModel,
  GoodReason,
  PauseTag,
  SessionEndReport,
  ShortfallReason,
  StudySession,
} from '@/types'

/**
 * 타이머 탭 — 카드 기준 (최종 기획서 「4.4 타이머」, #395)
 *
 * - 세션이 없으면 **대기 화면**: 다음 카드 [시작], [지금 시작](즉석 카드)
 * - 세션이 있으면 **세션 화면**: [시작] 을 누른 순간부터 카드 길이만큼 줄어드는 시계, [일시정지] · [끝내기]
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
  const navigate = useNavigate()
  const { cards, getCards, addCard, updateCard } = useCards()
  const session = useCardSession()
  const { active, now, allSessions } = session
  // 방금 끝낸 기록. 있으면 종료 팝업을 띄웁니다. (#398)
  const [endedRecord, setEndedRecord] = useState<StudySession | null>(null)
  // 방금 끝난 세션의 폰 기록 (앱 안에서만 옴). 종료 팝업에 한 줄로 보여 줍니다.
  const [endedPhone, setEndedPhone] = useState<PhoneLiftSummary | null>(null)
  // 끝난 세션과 폰 기록이 둘 다 오면 세션 번호로 저장해 둡니다. (코치 채팅 · 분석이 "폰을 몇 번 들었어" 처럼 씀)
  const endedRecordId = endedRecord?.id
  useEffect(() => {
    if (endedRecordId !== undefined && endedPhone !== null) {
      savePhoneSummary(endedRecordId, endedPhone)
    }
  }, [endedRecordId, endedPhone])
  // 방금 끝난 세션에서 타이머 화면이 안 보이던 구간들 (웹에서만. 앱 안이면 null)
  const [endedHidden, setEndedHidden] = useState<DistractionSpan[] | null>(null)
  // 집중도 점수 (lib/focusScore.ts). 앱은 폰 기록이 온 뒤, 웹은 끝나자마자 계산됩니다.
  const endedFocus = endedRecord ? scoreEndedSession(endedRecord, endedPhone, endedHidden) : null
  // 계산되면 세션 번호로 저장합니다. (코치의 "집중도 92%" · 기록 탭 카드가 씀)
  // 종료 팝업에서 답을 고를 때마다 기록이 바뀌어 다시 불리지만, 같은 세션 번호면 덮어써서 괜찮습니다.
  useEffect(() => {
    if (endedRecord === null) return
    const focus = scoreEndedSession(endedRecord, endedPhone, endedHidden)
    if (focus !== null) saveFocusScore(focus)
  }, [endedRecord, endedPhone, endedHidden])
  const [cardParam, setCardParam] = useQueryParam('card', '', { replace: true })
  // 카드를 시작하기 전에 거치는 화면 — 카운트다운이 켜져 있으면 5초 카운트다운(#399) → (앱 안이면) 폰 엎기 → 세션
  // (4단계의 다짐 듣기는 다짐 녹음과 함께 2026-10-18 에 지웠습니다)
  const [startFlow, setStartFlow] = useState<{
    card: CardModel
    step: 'countdown' | 'flip'
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
    // 미루기 사유도 안전 브레이크가 봅니다. 위기 표현이 있으면 비용을 따지는 말은 하지 않습니다. (「4.5」 안전 브레이크)
    if (
      getSafetyBrakeResult({
        now: new Date(listNow),
        recentTexts: [reason],
        recentMoods: [],
        exams: [],
      }).stopWhip
    ) {
      setNotice('미뤘어요. 오늘은 무리하지 말고 쉬어 가도 괜찮아요.')
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

  // 원인은 여러 개 고를 수 있습니다. 처음 고른 것이 대표 원인(cause)이고, 서버에는 대표 원인만 갑니다. (lib/reasons.ts)
  function handleFail(card: CardModel, causes: CardFailCause[]) {
    setMarks(
      addCardMark({
        cardId: card.id,
        dateKey: todayKey,
        mark: 'failed',
        cause: causes[0],
        causes,
      }),
    )
    setMissTarget(null)
    setNotice('기록했어요. 다음 통화에서 같이 돌아봐요.')
  }

  /**
   * 실패 창의 [코치랑 이야기하며 정하기] — 아직 실패로 기록하지 않고 상담 방에서 "왜 못 했는지" 이야기합니다.
   * AI 가 짐작한 원인을 학생이 [맞아] 로 확인하면 그때 실패로 기록합니다. (pages/ChatRoomPage.tsx, #582)
   */
  function handleFailTalk(card: CardModel) {
    const weekStart = moveDateKey(todayKey, -6)
    const failsThisWeek = marks.filter(
      (mark) => mark.cardId === card.id && mark.mark === 'failed' && mark.dateKey >= weekStart,
    ).length
    setMissTarget(null)
    navigate(
      startTalk({
        about: { kind: 'CARD_FAIL', lines: cardFailLines(card, todayKey, failsThisWeek) },
        label: `💬 '${card.title}' 못 한 이야기할래`,
        target: { type: 'card', cardId: card.id, dateKey: todayKey },
      }),
    )
  }

  /** 종료 팝업의 [코치랑 후기 나누기] — 팝업을 닫고 상담 방에서 방금 공부 후기를 말로 나눕니다. (#582) */
  function handleReviewTalk(record: StudySession) {
    const phone = endedPhone
    setEndedRecord(null)
    setEndedPhone(null)
    setEndedHidden(null)
    navigate(
      startTalk({
        about: {
          kind: 'SESSION_REVIEW',
          lines: sessionReviewLines({
            session: record,
            card: endedCard,
            focus: endedFocus,
            phoneText: phone ? formatPhoneSummary(phone) : null,
          }),
        },
        label: '💬 방금 공부 후기 나눌래',
        target: { type: 'session', sessionId: record.id },
      }),
    )
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
  // 관리 4단계(#408): 미루기 잠금 · 다음 반복 카드 1장 절대 · 증빙 필수
  const isStage4 = isStage4Now(todayKey)
  // 폰 들림 경고 세기: 오늘의 관리 강도로 정합니다. (회복 · 당근이면 안내만, 채찍이면 빠르게) (lib/liftAlerts.ts)
  const liftStrength = getLiftStrength(getTodayCareLevel(), isStage4)
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

  /**
   * 시작 전에 처음 거칠 화면. 없으면 null (바로 시작)
   * 카운트다운이 켜져 있으면 카운트다운, 아니면 앱 안에서는 폰 엎기 화면입니다. (웹은 엎은 걸 알 수 없어서 바로 시작)
   */
  function firstStartStep(): 'countdown' | 'flip' | null {
    if (isCountdownToday) return 'countdown'
    return isInApp() ? 'flip' : null
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
   * 카드로 시작합니다. 5초 카운트다운이 켜져 있으면(설정 또는 오늘 막막함·불안함) 카운트다운부터.
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
    // 앱 안이면 [지금 시작] 도 폰을 엎는 순간 시작합니다.
    if (isInApp()) setStartFlow({ card, step: 'flip' })
    else session.start(card, todayKey)
  }

  if (active) {
    const activeCard = cards.find((card) => card.id === active.cardId)
    return (
      <SessionView
        session={session}
        card={activeCard}
        now={now}
        experimentRule={experimentRuleOf(active.cardId)}
        onFinished={(record, hiddenSpans) => {
          setEndedPhone(null)
          setEndedHidden(hiddenSpans)
          setEndedRecord(record)
        }}
        liftStrength={liftStrength}
        onPhoneSummary={setEndedPhone}
      />
    )
  }

  const shownFlow = startFlow ?? paramFlow
  if (shownFlow?.step === 'countdown') {
    return (
      <CountdownView
        card={shownFlow.card}
        onDone={() => {
          // 앱 안이면 카운트다운 다음에 폰 엎기 화면, 웹이면 바로 시작합니다.
          if (isInApp()) setStartFlow({ card: shownFlow.card, step: 'flip' })
          else {
            session.start(shownFlow.card, todayKey)
            setStartFlow(null)
          }
          setCardParam('')
        }}
        onCancel={() => {
          setStartFlow(null)
          setCardParam('')
        }}
      />
    )
  }
  if (shownFlow?.step === 'flip') {
    return (
      <PhoneFlipView
        card={shownFlow.card}
        liftStrength={liftStrength}
        onStart={() => {
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

  const endedCard = endedRecord ? cards.find((card) => card.id === endedRecord.cardId) : undefined

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[28px] leading-tight font-bold tracking-tight">타이머</h1>
        <p className="mt-2 max-w-prose text-[15px] break-keep text-slate-600">
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
                  className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{card.title}</p>
                    <p className="text-sm text-slate-600 tabular-nums">
                      {card.startTime} · {formatMinutes(card.durationMinutes)}
                    </p>
                  </div>
                  {/* 자주 쓰는 [미루기] 를 위에, 되돌리기 어려운 [실패로 기록] 은 맨 아래 빨간 글자로 떨어뜨려 둡니다. (2차 규칙 3) */}
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                    <Button
                      variant="outline"
                      disabled={left === 0}
                      onClick={() => setMissTarget({ card, action: 'postpone' })}
                    >
                      {card.priority === 'absolute'
                        ? '미룰 수 없음'
                        : isPostponeLocked
                          ? '미루기 잠김'
                          : `미루기 (${left}회 남음)`}
                    </Button>
                    {lateEntryOf(card).ok && (
                      <Button
                        variant="outline"
                        onClick={() => setMissTarget({ card, action: 'late' })}
                      >
                        폰을 내서 못 켰어요 · 나중에 적기
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      className="text-red-700 hover:bg-red-50"
                      onClick={() => setMissTarget({ card, action: 'fail' })}
                    >
                      실패로 기록
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {/* 이 화면의 1순위 행동은 "다음 카드 시작" 하나입니다. 맨 위 카드만 brand 색 블록으로 크게, 나머지는 목록 행으로 작게 둡니다. (2026-10-22)
          PC 에서는 왼쪽에 카드, 오른쪽에 "카드 없이 지금 시작" 을 나란히 둡니다. */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:items-start">
        {waitingCards.length === 0 ? (
          <Card title="오늘 남은 카드">
            <p className="text-sm text-slate-600">
              오늘 할 카드가 없어요. 카드 없이 바로 시작해도 돼요.
            </p>
          </Card>
        ) : (
          // 눈에 보이는 제목은 없지만, 화면 낭독기가 목록 이름을 읽도록 aria-label 을 둡니다.
          <ul aria-label="오늘 남은 카드" className="flex flex-col gap-3">
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

        <InstantStart onStart={handleStartNow} />
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
          onFail={(causes) => handleFail(missTarget.card, causes)}
          onTalk={() => handleFailTalk(missTarget.card)}
        />
      )}
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
        <div className="mt-4">
          <Button className="w-full" onClick={() => setIsRecoveryCheckOpen(false)}>
            알겠어요
          </Button>
        </div>
      </Modal>

      {endedRecord && (
        <EndPopup
          record={endedRecord}
          card={endedCard}
          phone={endedPhone}
          focus={endedFocus}
          onSave={(changes) => {
            session.updateSession(endedRecord.id, changes)
            setEndedRecord({ ...endedRecord, ...changes })
          }}
          onTalk={(changes) => {
            // 체크한 것까지 저장하고(이유는 대화에서 정함) 후기 대화로 갑니다.
            session.updateSession(endedRecord.id, changes)
            handleReviewTalk({ ...endedRecord, ...changes })
          }}
          onRenameCard={(changes) => endedCard && updateCard(endedCard.id, changes)}
          onClose={() => {
            setEndedRecord(null)
            setEndedPhone(null)
            setEndedHidden(null)
          }}
          onCall={() => {
            // 팝업을 닫고 통화 화면으로 갑니다. 통화 화면이 방금 기록을 서버로 먼저 보낸 뒤 묻습니다. (lib/checkCall.ts)
            setEndedRecord(null)
            setEndedPhone(null)
            setEndedHidden(null)
            navigate('/call')
          }}
          onQuiz={
            endedCard && !isUntitledInstantCard(endedCard)
              ? () => {
                  // 팝업을 닫고 코치 방으로 갑니다. 코치 방이 ?quiz= 를 보고 이 카드로 문제를 냅니다. (pages/ChatRoomPage.tsx)
                  setEndedRecord(null)
                  setEndedPhone(null)
                  setEndedHidden(null)
                  navigate(`${COACH_PATH}?quiz=${encodeURIComponent(endedCard.id)}`)
                }
              : null
          }
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

  // ⋯ 메뉴 (미루기 · 못 했다고 기록 · 폰 내고 시작). 다음 카드 블록과 목록 행이 같이 씁니다.
  const menu = (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label={`${card.title} 메뉴`}
        aria-expanded={isMenuOpen}
        onClick={() => setIsMenuOpen((value) => !value)}
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-xl text-lg',
          isNext ? 'text-white hover:bg-white/15' : 'text-slate-500 hover:bg-slate-100',
        )}
      >
        <span aria-hidden>⋯</span>
      </button>
      {isMenuOpen && (
        <div className="absolute top-11 right-0 z-10 flex w-44 flex-col rounded-xl border border-slate-200 bg-white p-1 text-slate-900 shadow-md">
          {card.priority !== 'absolute' && (
            <button
              type="button"
              disabled={postponeLeft === 0}
              onClick={() => {
                setIsMenuOpen(false)
                onPostpone()
              }}
              className="h-10 rounded-lg px-3 text-left text-sm hover:bg-slate-50 disabled:text-slate-400"
            >
              미루기 ({postponeLeft}회 남음)
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setIsMenuOpen(false)
              onStartOffline()
            }}
            className="h-10 rounded-lg px-3 text-left text-sm hover:bg-slate-50"
          >
            폰 내고 시작 (오프라인)
          </button>
          {/* 되돌리기 어려운 기록은 메뉴 맨 아래, 선으로 떨어뜨리고 빨간 글자로 둡니다. (2차 규칙 3) */}
          <button
            type="button"
            onClick={() => {
              setIsMenuOpen(false)
              onFail()
            }}
            className="mt-1 h-10 rounded-lg border-t border-slate-100 px-3 text-left text-sm text-red-700 hover:bg-red-50"
          >
            못 했다고 기록
          </button>
        </div>
      )}
    </div>
  )

  // 다음 카드: 앱의 얼굴인 brand 색 블록. 형광펜 "다음" 칩 · 큰 제목 · 폭 전체 흰 [▶ 시작] (홈의 "지금 할 카드" 와 같은 모양)
  if (isNext) {
    return (
      <li className="bg-brand rounded-2xl p-5 text-white sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="bg-now inline-flex h-6 items-center rounded-full px-2.5 text-[13px] font-semibold text-slate-900">
              다음
            </span>
            <p className="mt-3 text-[24px] leading-snug font-bold tracking-tight break-keep sm:text-[28px]">
              {card.title}
            </p>
          </div>
          {menu}
        </div>
        <p className="mt-2 text-[15px] text-white/85 tabular-nums">
          {card.startTime ?? '시간 미정'} · {formatMinutes(card.durationMinutes)}
          {card.priority === 'absolute' && ' · 꼭 해야 함'}
        </p>
        {experimentRule && (
          <p className="mt-1 truncate text-[13px] text-white/85">실험: {experimentRule}</p>
        )}
        <Button variant="inverse" size="lg" className="mt-5 w-full" onClick={onStart}>
          ▶ 시작
        </Button>
      </li>
    )
  }

  // 그다음 카드들: 흰 목록 행 + 작은 선 버튼. 같은 무게의 큰 버튼을 여러 개 두지 않습니다. (힉의 법칙)
  return (
    <li className="flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200">
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold text-slate-900">{card.title}</p>
        {experimentRule && (
          <p className="truncate text-xs text-violet-700">실험: {experimentRule}</p>
        )}
        <p className="text-[13px] text-slate-500 tabular-nums">
          {card.startTime ?? '시간 미정'} · {formatMinutes(card.durationMinutes)}
          {card.priority === 'absolute' && ' · 꼭 해야 함'}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="outline" size="sm" onClick={onStart}>
          시작
        </Button>
        {menu}
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
    // 보조 경로라서 채운 버튼 대신 선 버튼(outline)을 씁니다. 화면의 채운 버튼은 "다음 카드" 의 [▶ 시작] 하나입니다.
    <Card title="카드 없이 지금 시작">
      <p className="text-sm text-slate-600">제목과 할 일은 끝날 때 한 줄로 적어요.</p>
      <div role="group" aria-label="공부할 시간" className="mt-3 grid grid-cols-3 gap-2">
        {INSTANT_MINUTES.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={minutes === value}
            onClick={() => setMinutes(value)}
            className={cn(
              'h-10 rounded-full border text-sm font-medium tabular-nums transition active:scale-[0.97]',
              minutes === value
                ? 'border-brand bg-brand-light text-brand ring-brand font-semibold ring-1'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
            )}
          >
            {value}분
          </button>
        ))}
      </div>
      <Button variant="outline" className="mt-4 w-full" onClick={() => onStart(minutes)}>
        ▷ {minutes}분 지금 시작
      </Button>
    </Card>
  )
}

interface SessionViewProps {
  session: ReturnType<typeof useCardSession>
  card: CardModel | undefined
  now: number
  /**
   * 세션이 끝나 기록을 저장한 뒤 부릅니다 (종료 팝업을 띄움)
   * hiddenSpans: 웹에서 타이머 화면이 안 보이던 구간들 (집중도 점수용). 앱 안이면 null
   */
  onFinished: (record: StudySession, hiddenSpans: DistractionSpan[] | null) => void
  /** 이 카드에 붙은 자기 실험 규칙 (#412) */
  experimentRule?: string
  /** 폰 들림 경고 세기 (lib/liftAlerts.ts) */
  liftStrength: LiftStrength
  /** 세션이 끝나 앱이 잰 폰 기록을 받았을 때 (앱 안에서만) */
  onPhoneSummary: (summary: PhoneLiftSummary) => void
}

/**
 * 세션이 끝날 때, 웹에서 화면을 떠난 구간들을 마무리하고 저장해 둔 기록을 지웁니다. (집중도용)
 * 떠나 있는 채로 끝났으면 그 구간도 끝 시각까지 넣습니다. 앱 안이면 null (앱의 폰 기록을 씀)
 */
function finishAwayTrack(record: StudySession, inApp: boolean): DistractionSpan[] | null {
  if (inApp) return null
  const track = closeAwayTrack(loadAwayTrack(record.startedAt), record.endedAt)
  clearAwayTrack()
  return track.spans
}

/** 세션 화면 — 나가는 길은 [일시정지] · [끝내기] 뿐입니다 */
function SessionView({
  session,
  card,
  now,
  onFinished,
  experimentRule,
  liftStrength,
  onPhoneSummary,
}: SessionViewProps) {
  const active = session.active
  const [settings] = useState(loadAutoSettings)
  const [isEndOpen, setIsEndOpen] = useState(false)
  const [isPauseOpen, setIsPauseOpen] = useState(false)
  const [memo, setMemo] = useState('')
  const remainingMs = active ? getRemainingMs(active, now) : 0
  useKeepScreenOn(active !== null)

  // 앱 안이면 폰을 엎어 뒀는지 재고, 들고 있는 시간에 따라 경고 단계를 정합니다. (hooks/usePhoneLift.ts)
  const phone = usePhoneLift({
    isActive: active !== null,
    isPaused: active?.pausedNow !== undefined,
    now,
    strength: liftStrength,
    onEnd: onPhoneSummary,
  })
  // 웹(앱 밖)에서는 다른 탭 · 앱으로 가서 이 화면이 안 보인 구간을 적어 둡니다. 집중도 점수의 딴짓 시간입니다. (lib/focusScore.ts)
  // 앱 안에서는 앱이 앱 밖 시간(outsideMs)을 재므로 겹쳐 세지 않게 여기서는 재지 않습니다.
  // 새로고침해도 이어지게 저장해 두고, 돌아왔을 때 5초 넘게 떠나 있었으면 "다른 화면에 2분 있었어" 를 보여 줍니다.
  const [awayMs, setAwayMs] = useState<number | null>(null)
  const sessionStartedAt = active?.startedAt ?? null
  const isPausedNow = active?.pausedNow !== undefined
  useEffect(() => {
    if (phone.isAvailable || sessionStartedAt === null) return
    const startedAt = sessionStartedAt
    function handleReturn() {
      const track = loadAwayTrack(startedAt)
      if (track.hiddenSince === null) return
      const returnedAt = Date.now()
      saveAwayTrack(closeAwayTrack(track, returnedAt))
      // 쉬는 중(일시정지)에 다녀온 것은 딴짓이 아니라서 안내하지 않습니다.
      const awayFor = returnedAt - track.hiddenSince
      if (!isPausedNow && isLongAway(awayFor)) setAwayMs(awayFor)
    }
    function handleVisibilityChange() {
      if (!document.hidden) {
        handleReturn()
        return
      }
      // 이미 떠나 있는 중이면(페이지를 닫을 때 한 번 더 불림) 처음 떠난 시각을 그대로 둡니다.
      const track = loadAwayTrack(startedAt)
      if (track.hiddenSince === null) saveAwayTrack({ ...track, hiddenSince: Date.now() })
    }
    // 떠나 있는 동안 페이지가 새로 불렸으면(모바일 웹에서 가끔), 지금 돌아온 것으로 닫습니다.
    if (!document.hidden) handleReturn()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [phone.isAvailable, sessionStartedAt, isPausedNow])

  // 3단계: 폰을 너무 오래 들고 있으면 세션을 멈추고 '폰 확인' 으로 남깁니다. (돌아와서 [다시 시작])
  const shouldAutoPause = phone.stage === 3 && active !== null && active.pausedNow === undefined
  useEffect(() => {
    if (shouldAutoPause) session.pause(['phone'], '폰을 오래 들고 있어서 저절로 멈췄어요')
  }, [shouldAutoPause, session])
  // 채찍 단계(강)에서는 화면 전체 경고 때 소리도 냅니다.
  const shouldRing = phone.stage === 2 && liftStrength === 'strong'
  useEffect(() => {
    if (shouldRing) playAlarm()
  }, [shouldRing])

  // 예정 종료 시각이 되면 알리고 끝냅니다. (완료 기준은 예정 시간이 끝난 것)
  useEffect(() => {
    if (active && remainingMs === 0) {
      playAlarm()
      const record = session.finish()
      if (record) onFinished(record, finishAwayTrack(record, phone.isAvailable))
    }
  }, [active, remainingMs, session, onFinished, phone.isAvailable])

  // 일시정지가 15분을 넘으면 복귀 알림을 한 번 보냅니다. (앱을 뒤로 보내 둔 동안에도 뜨게 시스템 알림도 씁니다)
  // 휴대폰 앱 안에서는 앱이 같은 알림을 미리 예약해 두므로(lib/cardAlarms.ts 의 buildSessionAlarms) 소리만 냅니다.
  // (BRIDGE.md 3-1 "앱 안에서는 웹이 같은 일을 하는 자기 알림을 따로 띄우지 않습니다")
  const isLongPause = active !== null && shouldAlertLongPause(active, now)
  useEffect(() => {
    if (!isLongPause) return
    playAlarm()
    if (!isInApp()) {
      void showSystemNotification({
        title: `${LONG_PAUSE_MINUTES}분째 멈춰 있어요`,
        body: '다시 시작할까요? 남은 시간은 멈춘 그대로예요.',
        tag: 'card-pause-long',
        url: '/timer',
      })
    }
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
    // pb-28: 모바일에서 화면 아래에 고정된 일시정지 · 끝내기 막대가 마지막 내용을 가리지 않게 비워 둡니다.
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 pb-28 sm:pb-0">
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
        {/* 웹: 다른 탭 · 앱에 다녀왔으면 한 줄 안내 (다음에 다녀오면 새 시간으로 바뀜) */}
        {awayMs !== null && (
          <div
            role="status"
            className="flex w-full max-w-sm items-center gap-2 rounded-2xl bg-amber-50 py-1 pr-1 pl-4 text-left"
          >
            <p className="min-w-0 flex-1 text-sm font-medium break-keep text-amber-800">
              다른 화면에 {formatDuration(awayMs)} 있었어. 다시 이어 가자!
            </p>
            <button
              type="button"
              onClick={() => setAwayMs(null)}
              className="h-10 shrink-0 rounded-xl px-3 text-sm font-medium text-amber-800 hover:bg-amber-100"
            >
              닫기
            </button>
          </div>
        )}
        {active.pausedNow &&
          toReasonList(active.pausedNow.tags, active.pausedNow.tag).includes('phone') &&
          phone.isAvailable && (
            <p className="text-sm font-medium break-keep text-amber-700">
              폰을 오래 들고 있어서 잠깐 멈췄어요. 폰을 엎어 두고 다시 시작해요.
            </p>
          )}
        {/* 남은 시간이 이 화면의 주인공입니다. 숫자 폭이 바뀌어도 흔들리지 않게 tabular-nums. */}
        <p
          className="text-[76px] leading-none font-semibold tracking-tight text-slate-900 tabular-nums sm:text-8xl"
          aria-live="off"
        >
          {formatRemaining(remainingMs)}
        </p>
        <p className="font-medium text-slate-700 tabular-nums">
          {active.plannedMinutes}분 중 {runMinutes}분 했어요
        </p>
        <ProgressBar value={progress} className="w-full max-w-sm" />
        {/* 끝나는 시각은 멈춘 만큼 늦춰집니다. 멈춰 있는 동안에는 이 시각이 같이 늦어져요. */}
        <p className="text-sm text-slate-500 tabular-nums">
          {formatClock(active.startedAt)} 시작 · {formatClock(getEndAtWithPauses(active, now))}에
          끝나요 · 일시정지 {active.pauses.length + (isPaused ? 1 : 0)}번
        </p>

        <p className="text-xs text-slate-500">
          공부 중에는 화면이 꺼지지 않아요. 일시정지하면 시계도 멈추고, 멈춘 만큼 늦게 끝나요.
        </p>
        {phone.isAvailable && (
          <p className="text-xs break-keep text-slate-500">
            폰을 화면이 바닥을 보게 엎어 두면, 들 때마다 코치가 알려 줘요.
          </p>
        )}
        {/* 관리 강도 '강' 이면 방해 금지를 켭니다(안드로이드). 권한이 없으면 한 번 열어 달라고 안내합니다. */}
        {phone.dndState === 'on' && (
          <p className="text-xs break-keep text-slate-500">🔕 공부하는 동안 방해 금지를 켰어요.</p>
        )}
        {phone.dndState === 'noPermission' && (
          <button
            type="button"
            onClick={phone.openDndSettings}
            className="h-10 rounded-xl bg-slate-100 px-4 text-xs font-medium break-keep text-slate-700"
          >
            🔕 방해 금지를 켜려면 권한이 필요해요 · 권한 열기
          </button>
        )}
      </Card>

      {/* 일시정지 · 끝내기는 엄지가 닿는 화면 아래쪽에 붙여 둡니다. (피츠의 법칙)
          모바일: 내용 길이와 상관없이 늘 화면 맨 아래에 고정(fixed). 세션 중에는 하단 탭이 숨어 있어 겹치지 않습니다. PC: 시계 묶음 바로 아래.
          끝내기는 되돌릴 수 없어서 일시정지보다 작고 조용하게(글자 버튼) 두고, 누르면 확인 창이 뜹니다. */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-slate-100 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:pt-0 sm:pb-0">
        <div className="mx-auto grid w-full max-w-xl grid-cols-3 gap-2">
          {isPaused ? (
            <Button size="lg" className="col-span-2" onClick={session.resume}>
              ▶ 다시 시작
            </Button>
          ) : (
            <Button
              size="lg"
              variant="outline"
              className="col-span-2"
              onClick={() => setIsPauseOpen(true)}
            >
              ❚❚ 일시정지
            </Button>
          )}
          <Button size="lg" variant="ghost" onClick={() => setIsEndOpen(true)}>
            끝내기
          </Button>
        </div>
      </div>

      {phone.stage === 1 && (
        <PhoneLiftNotice seconds={phone.liftedSeconds} onDismiss={phone.dismiss} />
      )}
      {phone.stage === 2 && (
        <PhoneLiftOverlay
          seconds={phone.liftedSeconds}
          repeatText={phone.repeatText}
          onDismiss={phone.dismiss}
        />
      )}

      {showChecklist && checklist.length > 0 && (
        <Card title={`체크리스트 ${checkedCount}/${checklist.length}`}>
          <ul className="flex flex-col gap-1">
            {checklist.map((item) => (
              <li key={item.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 py-1 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="accent-brand size-5 shrink-0"
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
              className="h-10 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 text-base sm:text-sm"
            />
            <Button variant="secondary" size="sm" onClick={handleSaveMemo}>
              적기
            </Button>
          </div>
          {active.memos.length > 0 && (
            <p className="mt-2 text-sm text-slate-500">{active.memos.length}개 적어 뒀어요</p>
          )}
        </Card>
      )}

      <PausePicker
        isOpen={isPauseOpen}
        onClose={() => setIsPauseOpen(false)}
        onFirstPick={(tag) => session.pause([tag])}
        onChange={(tags, note) => session.setPauseReasons(tags, note)}
      />

      <Modal isOpen={isEndOpen} onClose={() => setIsEndOpen(false)} title="지금 끝낼까요?">
        <p className="text-slate-700">
          아직 {formatMinutes(Math.ceil(remainingMs / MS_PER_MINUTE))} 남았어요. 지금 끝내면 '중간에
          끝냈어요'로 남아요.
        </p>
        {/* 되돌릴 수 없는 [끝내기] 보다 [계속하기] 를 1순위(채운 버튼)로 둡니다. */}
        <div className="mt-5 flex flex-col gap-2">
          <Button className="w-full" onClick={() => setIsEndOpen(false)}>
            계속하기
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setIsEndOpen(false)
              const record = session.finish()
              if (record) onFinished(record, finishAwayTrack(record, phone.isAvailable))
            }}
          >
            지금 끝내기
          </Button>
        </div>
      </Modal>
    </div>
  )
}

interface PausePickerProps {
  isOpen: boolean
  onClose: () => void
  /** 첫 이유를 누른 순간 — 여기서 바로 멈춥니다 */
  onFirstPick: (tag: PauseTag) => void
  /** 멈춘 뒤 이유를 더 고르거나 '기타' 글을 쓰고 창을 닫을 때 — 고른 이유 모두(맨 앞이 대표)와 글 */
  onChange: (tags: PauseTag[], note?: string) => void
}

/**
 * 일시정지 이유 (「4.4 타이머」 일시정지, #397 · 여러 개 고르기 2026-10-18)
 * 1. 처음 고르는 이유를 누르는 순간 멈춥니다. (멈추기는 지금처럼 1탭)
 * 2. 멈춘 뒤 "이유가 더 있으면 더 골라요" — 칩을 더 누르거나 뺄 수 있고, '기타' 를 고르면 한 줄을 받습니다(빈칸 허용).
 * 이유는 귀인(내 쪽 / 바깥)과 주의 분산을 보는 재료라서 꼭 하나 이상 남깁니다. (마지막 하나는 뺄 수 없음)
 */
function PausePicker({ isOpen, onClose, onFirstPick, onChange }: PausePickerProps) {
  const [tags, setTags] = useState<PauseTag[]>([])
  const [note, setNote] = useState('')

  // 창을 닫을 때(확인 · 바깥 누르기 모두) 고른 이유와 글을 세션에 남기고 처음 모양으로 되돌립니다.
  function handleClose() {
    if (tags.length > 0) {
      const text = tags.includes('other') ? note.trim() : ''
      onChange(tags, text || undefined)
    }
    setTags([])
    setNote('')
    onClose()
  }

  function handleToggle(tag: PauseTag) {
    if (tags.length === 0) {
      setTags([tag])
      onFirstPick(tag)
      return
    }
    const next = toggleReason(tags, tag)
    if (next.length > 0) setTags(next)
  }

  const isPaused = tags.length > 0
  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={isPaused ? '멈췄어요 ⏸' : '왜 멈추나요?'}>
      {isPaused && (
        <p className="mb-3 text-sm break-keep text-slate-700">
          이유가 더 있으면 더 골라요. 여러 개 골라도 돼요.
        </p>
      )}
      <ReasonChips
        options={PAUSE_TAGS}
        selected={tags}
        onToggle={handleToggle}
        label="일시정지 이유"
      />
      {tags.includes('other') && (
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={100}
          placeholder="기타 이유를 한 줄로 적어요 (안 적어도 돼요)"
          aria-label="기타 이유"
          className="mt-3 h-11 w-full rounded-xl border border-slate-300 px-3 text-base sm:text-sm"
        />
      )}
      {isPaused && (
        <Button className="mt-5 w-full" onClick={handleClose}>
          확인
        </Button>
      )}
      <p className="mt-3 text-xs text-slate-500">
        멈춘 동안은 시계도 멈춰요. 다시 시작하면 남은 시간부터 이어 가요.
      </p>
    </Modal>
  )
}

/** 증빙 요약 칸의 최대 글자 수 (아래 textarea 의 maxLength · 서버 endReport.proof.summary 와 같음) */
const MAX_PROOF_LENGTH = 300
/** [📷 사진으로 적기] 가 한 줄을 못 받았을 때의 안내 (#670) */
const PROOF_PHOTO_FAIL_NOTICE = '사진에서 공부한 내용을 못 찾았어요. 직접 적어 주세요.'

/** 종료 팝업의 단계 — 체크리스트 → 같이 한 것 → 증빙 → (가끔) 잘 된 이유 → 다음 행동 */
type EndStep = 'checklist' | 'with' | 'proof' | 'good' | 'next'

interface EndPopupProps {
  record: StudySession
  card: CardModel | undefined
  /** 기록에 붙일 칸 (endReport) — 단계마다 저장해서, 중간에 닫아도 고른 것은 남습니다 */
  onSave: (changes: Pick<StudySession, 'endReport'>) => void
  /** [💬 코치랑 후기 나누기] — 체크한 것까지 저장하고 상담 방에서 후기를 말로 나눕니다. (#582) */
  onTalk: (changes: Pick<StudySession, 'endReport'>) => void
  /** 즉석 카드의 제목 · 체크리스트를 정했을 때 */
  onRenameCard: (changes: Pick<CardModel, 'title' | 'checklist'>) => void
  onClose: () => void
  /** [📞 확인 통화 받기] — 팝업을 닫고 통화 화면으로 갑니다. 10분 넘게 공부했을 때만 보입니다. (통화 수정 7) */
  onCall: () => void
  /**
   * [📝 확인 문제 풀어 볼래?] — 팝업을 닫고 코치 방에서 이 카드로 확인 문제를 바로 냅니다. (#650)
   * 제목이 없는 즉석 카드처럼 문제를 낼 주제가 없으면 null 이고, 버튼을 보이지 않습니다.
   */
  onQuiz: (() => void) | null
  /** 관리 4단계라 증빙이 꼭 필요한지 — 없으면 실행으로 인정하지 않습니다 (#408) */
  proofRequired: boolean
  /** 증빙을 남겼을 때 */
  onProofSaved: () => void
  /** 앱이 잰 이번 세션의 폰 기록. 앱 밖이거나 아직 안 왔으면 null */
  phone: PhoneLiftSummary | null
  /** 이번 세션의 집중도 (lib/focusScore.ts). 너무 짧았거나 숫자가 아직 안 왔으면 null */
  focus: FocusScoreRecord | null
}

/**
 * 종료 팝업 (최종 기획서 「4.4 타이머」 종료, #398) — 이유는 여러 개 고를 수 있고, 나머지는 1탭입니다.
 * 1. 체크리스트 최종 확인 (다 못 했으면 미달 사유, 여러 개 가능) · 즉석 카드면 "무엇을 했나요?" 한 줄
 * 2. 같이 한 것: 음악 / 영상 틀어둠 / 없음
 * 3. 산출물 증빙: 링크나 2~3줄 요약 (선택 — 관리 4단계에서는 꼭 필요). [📷 사진으로 적기] 로 AI 가 한 줄을 채워 줄 수 있음
 * 4. 잘 된 이유: 체크리스트를 다 했을 때 N번에 1번만
 * 5. 다음 행동
 */
function EndPopup({
  record,
  card,
  onSave,
  onTalk,
  onRenameCard,
  onClose,
  onCall,
  onQuiz,
  proofRequired,
  onProofSaved,
  phone,
  focus,
}: EndPopupProps) {
  const [step, setStep] = useState<EndStep>('checklist')
  const [settings] = useState(loadAutoSettings)
  const report: SessionEndReport = record.endReport ?? { checked: {} }
  const [checked, setChecked] = useState<Record<string, number>>(report.checked)
  // 다 못 한 이유 — 여러 개 고를 수 있고, 맨 앞(처음 고른 것)이 대표 이유입니다.
  const [shortfalls, setShortfalls] = useState<ShortfallReason[]>(() => getShortfallReasons(report))
  // 잘 된 이유 — 여러 개 고를 수 있습니다.
  const [goodPicks, setGoodPicks] = useState<GoodReason[]>([])
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
  // [📷 사진으로 적기] (#670): 사진을 줄여 서버 AI 에 보내고 받은 한 줄을 요약 칸에 넣습니다.
  // ⚠️ 사진은 서버 · 기기 어디에도 저장하지 않습니다. 이 함수 안에서 보내고 끝입니다.
  const [proofPhotoNotice, setProofPhotoNotice] = useState<string | null>(null)
  const [isProofHelpShown, setIsProofHelpShown] = useState(false)
  const { mutate: readProofPhoto, isPending: isReadingProofPhoto } = useMutation({
    mutationFn: async (file: File) => {
      const image = await shrinkPhoto(file)
      // 제목을 아직 안 정한 즉석 카드("지금 시작한 공부")면 제목은 보내지 않습니다.
      const cardTitle = card && !isUntitledInstantCard(card) ? card.title : undefined
      return requestProofFromPhoto({ image, cardTitle })
    },
    onSuccess: (result) => {
      if (result.showHelp) {
        setIsProofHelpShown(true)
        return
      }
      const summary = result.summary
      if (summary === null) {
        setProofPhotoNotice(PROOF_PHOTO_FAIL_NOTICE)
        return
      }
      // 이미 적어 둔 글이 있으면 지우지 않고 다음 줄에 붙입니다.
      setProofText((current) =>
        (current.trim() === '' ? summary : `${current.trimEnd()}\n${summary}`).slice(
          0,
          MAX_PROOF_LENGTH,
        ),
      )
    },
    // 사진을 줄이지 못했을 때(사진 파일이 아님 등)도 같은 안내로 넘어갑니다.
    onError: () => setProofPhotoNotice(PROOF_PHOTO_FAIL_NOTICE),
  })
  // 다 못 했을 때: 이유 칩은 접어 두고 [💬 코치랑 후기 나누기] 를 먼저 보여 줍니다. [이유만 고르기] 를 누르면 펼칩니다. (#582)
  const [isPickingReasons, setIsPickingReasons] = useState(false)
  // 후기를 나눌 대화방 (lib/chatRooms.ts — 방 이름이 바뀌어도 여기는 그대로)
  const talkRoom = getChatRoom(TALK_ROOM_OF.SESSION_REVIEW)
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
        // 서버 칸은 하나라서 대표 이유(shortfallReason)만 서버로 갑니다. 이 기기에는 모두(shortfallReasons) 남깁니다.
        ...(isComplete ? {} : { shortfallReason: shortfalls[0], shortfallReasons: shortfalls }),
      },
    })
    setStep('with')
  }

  function handleProofPhotoPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // 같은 사진을 다시 골라도 다시 읽게 비워 둡니다.
    event.target.value = ''
    if (!file) return
    setProofPhotoNotice(null)
    setIsProofHelpShown(false)
    readProofPhoto(file)
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

  const needsShortfall = !isInstant && !isComplete && shortfalls.length === 0
  const canFinishChecklist = isInstant ? line.trim() !== '' : !needsShortfall
  // 이 공부가 확인 통화로 확인할 만한지 (10분 넘게 앱이 잰 공부, lib/checkCall.ts)
  // 복습 통화는 공부 직후에 해야 해서, 마지막 단계의 첫 버튼으로 바로 보냅니다. (통화 수정 7)
  const canCheckCall = countsForCheckCall(record)

  /** [💬 코치랑 후기 나누기] — 체크한 것까지 저장하고 대화방으로 갑니다. 다 못 한 이유는 대화에서 AI 가 짐작해 확인받습니다. */
  function handleTalk() {
    onTalk({ endReport: { ...report, checked } })
  }

  return (
    <Modal isOpen onClose={onClose} title="수고했어요! 마무리해요">
      {/* 집중도: 타이머가 잰 숫자로 계산한 점수와 근거 한 줄 (lib/focusScore.ts) */}
      {focus ? (
        <div className="mb-3 rounded-2xl bg-slate-100 px-4 py-3">
          <p className="text-[28px] leading-tight font-bold tracking-tight text-slate-900">
            집중도 <span className="text-brand tabular-nums">{focus.score}%</span>
          </p>
          <p className="mt-1 text-sm break-keep text-slate-700">{formatFocusEvidence(focus)}</p>
        </div>
      ) : (
        // 점수가 없으면(1분이 안 됨) 앱 안에서 잰 폰 기록만 한 줄로 보여 줍니다. (lib/liftAlerts.ts)
        phone && (
          <p className="mb-3 rounded-2xl bg-slate-100 px-4 py-3 text-sm break-keep text-slate-700">
            📱 {formatPhoneSummary(phone)}
          </p>
        )
      )}
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
                className="h-11 w-full rounded-xl border border-slate-300 px-3 text-base sm:text-sm"
              />
              {isAskingQuickCard && <p className="text-xs text-slate-500">AI 가 정리하는 중…</p>}
              {currentDraft && (
                <div className="flex flex-col gap-2 rounded-xl bg-violet-50 px-3 py-3 text-sm">
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
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 py-1 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        className="accent-brand size-5 shrink-0"
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
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium text-slate-800">다 못 한 건 왜 그랬을까요?</p>
                  {/* 이유를 칩으로 고르는 대신 코치와 말로 나누면, AI 가 이유를 짐작해서 "맞아?" 로 확인받습니다. */}
                  {/* 이유를 직접 고르는 중이면 [다음] 이 1순위라서, 이 버튼은 선 버튼으로 낮춥니다. */}
                  <Button
                    size="lg"
                    variant={isPickingReasons ? 'outline' : 'primary'}
                    onClick={handleTalk}
                  >
                    💬 {talkRoom.name} 방에서 후기 나누기
                  </Button>
                  <button
                    type="button"
                    aria-expanded={isPickingReasons}
                    onClick={() => setIsPickingReasons((open) => !open)}
                    className="h-10 cursor-pointer text-sm font-medium text-slate-500 underline-offset-2 hover:underline"
                  >
                    {isPickingReasons ? '이유 고르기 접기' : '이유만 고를래'}
                  </button>
                  {isPickingReasons && (
                    <>
                      <p className="text-xs text-slate-500">여러 개 골라도 돼요</p>
                      <ReasonChips
                        options={SHORTFALL_REASONS}
                        selected={shortfalls}
                        onToggle={(key) => setShortfalls((prev) => toggleReason(prev, key))}
                        label="다 못 한 이유"
                      />
                    </>
                  )}
                </div>
              )}
            </>
          )}
          {/* 다 했거나 즉석 카드면 바로 [다음], 다 못 했으면 이유를 고를 때만 [다음] 이 보입니다. */}
          {(isInstant || isComplete || isPickingReasons) && (
            <Button size="lg" disabled={!canFinishChecklist} onClick={handleChecklistDone}>
              다음
            </Button>
          )}
        </div>
      )}

      {step === 'with' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-700">공부하면서 같이 한 게 있나요?</p>
          <div className="grid grid-cols-2 gap-2">
            {WITH_WHAT_OPTIONS.map((item) => (
              <Button
                key={item.key}
                variant="outline"
                className="h-12 px-2"
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
          <p className="text-sm break-keep text-slate-700">
            {proofRequired
              ? '관리 4단계라 증빙이 꼭 필요해요. 링크나 2~3줄 요약을 남겨야 한 것으로 쳐요.'
              : '한 것을 남겨 볼까요? 링크나 2~3줄 요약이면 돼요. 적어 두면 이 공부 기록에 같이 남아요.'}
          </p>
          <textarea
            value={proofText}
            onChange={(event) => setProofText(event.target.value)}
            maxLength={300}
            rows={3}
            placeholder="예: 42~45쪽 풀고 틀린 3문제 다시 풂"
            className="w-full rounded-xl border border-slate-300 p-3 text-base sm:text-sm"
          />
          {/* [📷 사진으로 적기] (#670) — 진짜 로그인일 때만. 테스트 로그인은 서버 AI 를 못 불러서 숨깁니다. */}
          {isServerData && (
            <div className="flex flex-col gap-2">
              <label
                aria-busy={isReadingProofPhoto}
                className={cn(
                  'flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-[15px] font-semibold text-slate-900 transition hover:bg-slate-50 active:scale-[0.98]',
                  'focus-within:ring-brand/30 focus-within:ring-2',
                  isReadingProofPhoto && 'pointer-events-none opacity-50',
                )}
              >
                {isReadingProofPhoto ? '사진을 읽는 중…' : '📷 사진으로 적기'}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={isReadingProofPhoto}
                  onChange={handleProofPhotoPick}
                />
              </label>
              <p className="text-xs break-keep text-slate-500">
                사진은 저장하지 않아요. AI 가 한 일을 한 줄로 적어 주면, 고쳐서 남기면 돼요.
              </p>
              {proofPhotoNotice && (
                <p role="status" className="text-sm break-keep text-amber-800">
                  {proofPhotoNotice}
                </p>
              )}
              {/* 사진 속 글이나 카드 제목에 위기 표현이 있었을 때 — 도움 안내 한 줄 (CardsFromPhotoPage 와 같음) */}
              {isProofHelpShown && (
                <a
                  href={`tel:${YOUTH_HELP_LINE.number}`}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-2xl bg-amber-50 px-4 py-2 text-sm"
                >
                  <span className="break-keep text-slate-700">
                    지금 이야기할 곳: {YOUTH_HELP_LINE.name} · {YOUTH_HELP_LINE.detail}
                  </span>
                  <span className="text-brand font-semibold">{YOUTH_HELP_LINE.number}</span>
                </a>
              )}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Button
              className="w-full"
              disabled={proofText.trim() === ''}
              onClick={() => handleProofDone(false)}
            >
              남기기
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => handleProofDone(true)}>
              {proofRequired ? '증빙 없이 끝내기 (안 한 것으로)' : '건너뛰기'}
            </Button>
          </div>
        </div>
      )}

      {step === 'good' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-700">
            다 해냈어요! 잘 된 이유는 뭐였을까요?{' '}
            <span className="text-slate-500">(여러 개 골라도 돼요)</span>
          </p>
          <ReasonChips
            options={GOOD_REASONS}
            selected={goodPicks}
            onToggle={(key) => setGoodPicks((prev) => toggleReason(prev, key))}
            label="잘 된 이유"
          />
          <Button
            size="lg"
            className="w-full"
            disabled={goodPicks.length === 0}
            onClick={() => {
              save({ goodReasons: goodPicks })
              setStep('next')
            }}
          >
            다음
          </Button>
        </div>
      )}

      {step === 'next' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-700">다음은 무엇을 할까요?</p>
          {/* 채운 버튼은 1순위 하나(확인 통화, 없으면 다음 카드)만. 나머지는 선 · 글자 버튼입니다. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {canCheckCall && (
              <Button size="lg" onClick={onCall} className="sm:col-span-2">
                📞 확인 통화 받기
              </Button>
            )}
            <Button
              size={canCheckCall ? 'md' : 'lg'}
              variant={canCheckCall ? 'outline' : 'primary'}
              className={cn(!canCheckCall && 'sm:col-span-2')}
              onClick={onClose}
            >
              다음 카드 보기
            </Button>
            {/* 다 한 공부도 어땠는지 말로 나누면 코치가 다음 계획에 씁니다. (#582) */}
            <Button
              variant="outline"
              className={cn(!canCheckCall && 'sm:col-span-2')}
              onClick={handleTalk}
            >
              💬 {talkRoom.name} 방에서 후기 나누기
            </Button>
            {/* 방금 공부한 카드로 확인 문제를 권합니다. 맞힌 · 틀린 문제는 변형 문제로 다시 나옵니다. (#650) */}
            {onQuiz && (
              <Button variant="outline" onClick={onQuiz} className="sm:col-span-2">
                📝 확인 문제 풀어 볼래?
              </Button>
            )}
            <Button variant="ghost" onClick={onClose} className="sm:col-span-2">
              닫기
            </Button>
          </div>
        </div>
      )}
    </Modal>
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
        <p
          className="text-brand text-8xl leading-none font-semibold tabular-nums"
          aria-live="polite"
        >
          {Math.max(0, seconds)}
        </p>
        <div className="grid w-full max-w-sm grid-cols-2 gap-3">
          <Button size="lg" variant="outline" disabled={level >= MAX_SHRINK} onClick={handleShrink}>
            더 작게
          </Button>
          <Button size="lg" variant="ghost" onClick={onCancel}>
            그만
          </Button>
        </div>
        <p className="text-xs text-slate-500">0 이 되면 바로 시작해요.</p>
      </Card>
    </div>
  )
}

// 폰 엎기 화면에서 이만큼 기다려도 안 엎으면 진동하고 "아직 안 엎었어!" 를 보여 줍니다.
const FLIP_HINT_MS = 10_000

interface PhoneFlipViewProps {
  card: CardModel
  /** 폰 들림 경고 세기. 센서를 켤 때 같이 보내는 알림 문구 · 방해 금지가 이것으로 정해집니다. */
  liftStrength: LiftStrength
  /** 폰을 엎었거나 [그냥 시작] 을 눌렀을 때 */
  onStart: () => void
  onCancel: () => void
}

/**
 * 폰 엎기 화면 (앱 안에서만, 2026-10-18) — "폰을 화면이 바닥을 보게 엎어 줘"
 * 앱의 센서를 먼저 켜 두고, 엎는 순간(앱이 'focus.down' 을 보냄) 진동 한 번과 함께 세션을 시작합니다.
 * 이때 켠 센서는 세션이 그대로 이어받습니다. (hooks/usePhoneLift.ts 의 startPhoneFocusEarly)
 * 10초 안에 안 엎으면 진동하고 "아직 안 엎었어!" 를 보여 줍니다.
 * 센서가 없는 폰도 있어서 [그냥 시작] 은 처음부터 늘 보입니다.
 */
function PhoneFlipView({ card, liftStrength, onStart, onCancel }: PhoneFlipViewProps) {
  const [isLate, setIsLate] = useState(false)
  // 이 폰에 엎기 센서가 없으면 true (앱의 'focus.start' 답으로 앎)
  const [hasNoSensor, setHasNoSensor] = useState(false)
  // 세션을 시작했는지. 시작했으면 이 화면이 닫혀도 센서를 끄지 않습니다. (세션이 이어받음)
  const hasStarted = useRef(false)
  // 부모가 다시 그려져서 onStart 가 새 함수가 되어도 센서를 다시 켜지 않게, 최신 함수를 ref 에 둡니다.
  const onStartRef = useRef(onStart)
  useEffect(() => {
    onStartRef.current = onStart
  })

  useEffect(() => {
    void startPhoneFocusEarly(liftStrength).then((reply) => {
      if (isFaceDownUnavailable(reply)) setHasNoSensor(true)
    })
    // 엎은 순간 시작합니다. (처음 엎으면 liftedMs 0 으로 옴. 들었다가 다시 엎은 것도 엎은 것으로 봅니다)
    const stopListening = onAppMessage((message) => {
      if (message.type !== 'focus.down' || hasStarted.current) return
      hasStarted.current = true
      sendToApp('haptics', { kind: 'success' })
      onStartRef.current()
    })
    const hintId = setTimeout(() => {
      setIsLate(true)
      sendToApp('haptics', { kind: 'warning' })
    }, FLIP_HINT_MS)
    return () => {
      stopListening()
      clearTimeout(hintId)
      // 엎지 않고 이 화면을 떠났으면([취소] · 다른 탭으로 이동) 켜 둔 센서를 끕니다.
      if (!hasStarted.current) cancelPhoneFocusEarly()
    }
  }, [liftStrength])

  function handleJustStart() {
    hasStarted.current = true
    onStart()
  }

  return (
    // 화면 전체를 덮습니다. (아래 탭 막대도 가림) 휴대폰 위 · 아래 안전 영역만큼 띄웁니다.
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-100 px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-5 text-center">
        <p className="max-w-full truncate text-sm font-medium text-slate-500">{card.title}</p>
        <span
          className="flex size-28 items-center justify-center rounded-3xl bg-white text-7xl shadow-sm"
          aria-hidden
        >
          📱
        </span>
        <h1 className="text-[26px] leading-snug font-bold tracking-tight break-keep sm:text-3xl">
          폰을 화면이 바닥을 보게 엎어 줘 📱
        </h1>
        <p className="break-keep text-slate-600">
          엎는 순간 타이머가 시작돼요. 공부하다 폰을 들면 코치가 알려 줘요.
        </p>
        {hasNoSensor ? (
          <p className="rounded-2xl bg-white px-4 py-3 text-sm break-keep text-slate-700">
            이 폰은 엎었는지 알 수 없어요. 아래 [그냥 시작] 을 눌러 줘.
          </p>
        ) : (
          isLate && (
            <p
              role="status"
              className="rounded-2xl bg-amber-50 px-4 py-3 font-semibold break-keep text-amber-800"
            >
              아직 안 엎었어! 화면이 바닥을 보게 평평하게 내려놔 줘.
            </p>
          )
        )}
      </div>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-2">
        {/* 바탕이 회색이라 버튼은 흰색으로 둡니다. */}
        <Button size="lg" variant="outline" className="w-full" onClick={handleJustStart}>
          그냥 시작
        </Button>
        <Button variant="ghost" className="w-full" onClick={onCancel}>
          취소
        </Button>
      </div>
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
 * 회복 모드에서는 채찍(재촉하는 말·알림)을 쓰지 않습니다. 다음 날 다시 평가합니다.
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
        회복 모드에서는 재촉하지 않아요. 내일 다시 볼게요.
      </p>
    </Card>
  )
}

interface PhoneLiftAlertProps {
  /** 폰을 들고 있은 시간 (초) */
  seconds: number
  /** [괜찮아] — 이번에 든 것은 더 경고하지 않음 */
  onDismiss: () => void
}

/** 폰 들림 1단계: 화면 위에 작게 "다시 엎어 둘까?" (진동은 usePhoneLift 가 앱에 부탁함) */
function PhoneLiftNotice({ seconds, onDismiss }: PhoneLiftAlertProps) {
  return (
    // 하단 탭과 겹치지 않게 화면 위쪽에 띄웁니다. 375px 에서도 양옆 16px 여백을 둡니다.
    <div
      role="status"
      className="fixed inset-x-4 top-4 z-40 mx-auto flex max-w-xl items-center gap-3 rounded-2xl bg-white p-4 shadow-lg ring-1 ring-slate-200"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xl">
        📱
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-bold text-slate-900">다시 엎어 둘까?</p>
        <p className="text-sm text-slate-500">들고 있은 지 {seconds}초</p>
      </div>
      <Button variant="secondary" size="sm" className="h-10 shrink-0" onClick={onDismiss}>
        괜찮아
      </Button>
    </div>
  )
}

interface PhoneLiftOverlayProps extends PhoneLiftAlertProps {
  /** 들림을 반복했을 때 붙이는 한 줄 ('벌써 3번째야. …'). 아니면 null */
  repeatText: string | null
}

/** 폰 들림 2단계: 코치 말투 경고를 화면 전체에. 폰을 다시 엎으면 저절로 사라집니다. */
function PhoneLiftOverlay({ seconds, repeatText, onDismiss }: PhoneLiftOverlayProps) {
  return (
    <div
      role="alertdialog"
      aria-labelledby="phone-lift-title"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-slate-900/95 px-6 text-center text-white"
    >
      <span className="text-6xl" aria-hidden>
        📱
      </span>
      <h2 id="phone-lift-title" className="text-[26px] leading-snug font-bold tracking-tight">
        공부 중이야.
        <br />폰 내려놓고 다시 엎어 두자
      </h2>
      {/* 같은 세션에서 3번째 들림부터: 횟수를 알려 줍니다. (lib/liftAlerts.ts 의 getRepeatLiftText) */}
      {repeatText && (
        <p className="rounded-2xl bg-white/10 px-4 py-2 text-lg font-semibold break-keep text-amber-300">
          {repeatText}
        </p>
      )}
      <p className="text-base text-slate-300">
        들고 있은 지 {seconds}초 · 조금 더 지나면 세션이 멈춰요
      </p>
      <p className="text-sm text-slate-400">폰을 다시 엎으면 이 화면은 저절로 사라져요.</p>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-4 h-12 rounded-2xl px-5 text-sm font-medium text-slate-300 underline-offset-4 hover:underline"
      >
        공부에 필요해서 든 거야 (이번만)
      </button>
    </div>
  )
}
