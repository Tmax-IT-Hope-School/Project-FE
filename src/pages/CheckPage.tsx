import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { MissReasonPicker, type MissReasonValue } from '@/components/ui/MissReasonPicker'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { useCheckIns } from '@/hooks/useCheckIns'
import { useSendCheckIn } from '@/hooks/useCheckInSync'
import { usePlans } from '@/hooks/usePlans'
import { useStudySessions } from '@/hooks/useStudySessions'
import { useSuggestionChecks } from '@/hooks/useSuggestionChecks'
import { useSuggestions } from '@/hooks/useSuggestions'
import { getApiErrorMessage } from '@/lib/api'
import { cn } from '@/lib/cn'
import { getTodayKey, moveDateKey } from '@/lib/date'
import { getDaySummary } from '@/lib/daySummary'
import { shouldShowCrisisHelp } from '@/lib/diarySafety'
import { SUPPORT_PATH } from '@/lib/helpLines'
import { getPhoneFocusEnabled } from '@/lib/phoneFocus'
import { MOOD_OPTIONS } from '@/lib/quickCheckIn'
import {
  PROMISE_EXAMPLES,
  PROMISE_MAX_LENGTH,
  countKeptPromises,
  getAskedPromise,
  isHalfFilledPromise,
  makePromiseText,
} from '@/lib/todayPromise'
import type { CheckIn, Suggestion } from '@/types'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

/** 컨디션 버튼에 쓰는 숫자 (1 최악 ~ 5 최고) */
const CONDITION_OPTIONS = [1, 2, 3, 4, 5]

/** 오늘 예상 순공시간 버튼. 분 단위로 저장합니다. */
const EXPECTED_MINUTES_OPTIONS = [
  { minutes: 60, label: '1시간' },
  { minutes: 120, label: '2시간' },
  { minutes: 180, label: '3시간' },
  { minutes: 240, label: '4시간' },
  { minutes: 300, label: '5시간+' },
]

/** 체크인을 시작할 때 버튼이 기본으로 가리킬 값 (가운데 값으로 시작해서 그대로 눌러도 30초 안에 끝나게 합니다) */
const DEFAULT_CONDITION = 3
const DEFAULT_MOOD = 3
const DEFAULT_EXPECTED_MINUTES = 120

/*
 * 컨디션·기분·예상시간 버튼의 공통 모양입니다. (TimerPage 의 과목 선택 버튼과 같은 느낌으로 맞췄습니다)
 * 고를 때 살짝 커지고(scale) 그림자가 생겨서, 눌렀다는 게 손끝으로 느껴지게 했습니다.
 */
const CHIP_BASE =
  'flex min-h-10 min-w-0 cursor-pointer items-center justify-center rounded-xl border px-2 text-sm font-semibold shadow-sm transition-all duration-150 active:scale-95'
const CHIP_SELECTED = 'border-brand bg-brand-light text-brand scale-105 shadow-md'
const CHIP_UNSELECTED =
  'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 hover:shadow-md'

/** 분을 "3시간 10분" 처럼 보여줍니다. 60분 미만이면 "분"만, 딱 떨어지면 "시간"만 보여줍니다. */
function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}분`
  if (minutes === 0) return `${hours}시간`
  return `${hours}시간 ${minutes}분`
}

/**
 * 그 날짜에 도전 중이던 개선안인지 알려줍니다.
 * 도전을 시작한 날(startDate)부터 실험 기간(days)이 끝나기 전날까지가 도전 기간입니다.
 *   예) 10월 1일 시작, 14일 → 10월 1일 ~ 10월 14일
 * 오늘 막 고른 개선안은 "어제" 가 도전 기간이 아니라서 묻지 않습니다.
 */
function isActiveOn(suggestion: Suggestion, dateKey: string): boolean {
  if (suggestion.status !== 'active' || suggestion.startDate === undefined) return false
  // 'YYYY-MM-DD' 는 글자로 비교해도 날짜 순서와 같습니다.
  if (dateKey < suggestion.startDate) return false
  if (suggestion.days === undefined) return true
  return dateKey < moveDateKey(suggestion.startDate, suggestion.days)
}

/** 어제 달성률에 맞춰 짧은 응원 한마디를 보여줍니다. (계획이 없던 날은 달성률 대신 안내만 합니다) */
function getEncouragement(targetMinutes: number, rate: number): string {
  if (targetMinutes === 0) return '어제는 계획이 없었어요. 오늘부터 다시 시작해 봐요 🙂'
  if (rate >= 100) return '어제 계획을 다 채웠어요! 최고예요 🎉'
  if (rate >= 70) return '거의 다 왔어요, 잘하고 있어요 👏'
  if (rate >= 40) return '절반 넘게 해냈어요, 오늘은 조금만 더 해봐요 💪'
  return '오늘은 다르게 가 봐요, 할 수 있어요 🌱'
}

export function CheckPage() {
  const todayKey = getTodayKey()
  const yesterdayKey = moveDateKey(todayKey, -1)

  const navigate = useNavigate()
  const { getCheckIn, saveCheckIn, checkIns } = useCheckIns()
  // 오늘 체크인을 서버로도 보냅니다. (#321) 테스트 로그인이면 send.canSync 가 false 라 보내지 않습니다.
  const send = useSendCheckIn()
  const { getPlans } = usePlans()
  // 타이머가 저장해 둔 진짜 공부 기록입니다. 기록이 없으면 빈 목록이라 어제 순공은 0분으로 보입니다.
  const { sessions } = useStudySessions()
  const { suggestions } = useSuggestions()
  const { getCheck, saveCheck } = useSuggestionChecks()

  // 어제 도전 중이던 개선안 (최대 2개). 이 개선안들만 "어제 지켰어?" 를 묻습니다.
  const yesterdaySuggestions = suggestions.filter((suggestion) =>
    isActiveOn(suggestion, yesterdayKey),
  )

  const existingCheckIn = getCheckIn(todayKey)
  // 하루 첫 한 줄(컨디션·감정 태그)만 한 날은 자세한 체크인을 아직 안 한 것이라, 완료 표시와 "다시 저장" 을 붙이지 않습니다.
  const isCheckedInToday = existingCheckIn !== undefined && existingCheckIn.isQuick !== true

  // 이미 체크인한 날이면 그 값을 보여 줘서 고칠 수 있게 하고, 처음이면 가운데 기본값으로 시작합니다.
  const [condition, setCondition] = useState(existingCheckIn?.condition ?? DEFAULT_CONDITION)
  const [mood, setMood] = useState(existingCheckIn?.mood ?? DEFAULT_MOOD)
  const [expectedMinutes, setExpectedMinutes] = useState(
    existingCheckIn?.expectedMinutes ?? DEFAULT_EXPECTED_MINUTES,
  )

  // 어제 못 채운 이유. 체크인에 이미 있으면 그 값으로 시작합니다. 아직 안 골랐으면 null 입니다.
  const [missReason, setMissReason] = useState<MissReasonValue | null>(() =>
    existingCheckIn?.missReason
      ? { reason: existingCheckIn.missReason, note: existingCheckIn.missReasonNote ?? '' }
      : null,
  )

  // 개선안마다 고른 답. { 'suggestion-1': true } 처럼 개선안 id → 지켰는지 입니다.
  // 이미 적어 둔 기록이 있으면 그 답으로 시작해서, 잘못 눌렀으면 다시 골라 고칠 수 있습니다.
  const [keptById, setKeptById] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    for (const suggestion of yesterdaySuggestions) {
      const saved = getCheck(suggestion.id, yesterdayKey)
      if (saved) initial[suggestion.id] = saved.kept
    }
    return initial
  })

  function handleSelectKept(suggestionId: string, kept: boolean) {
    setKeptById((prev) => ({ ...prev, [suggestionId]: kept }))
  }

  // 오늘의 약속 (#79). "만약 ~하면" / "~한다" 두 칸입니다. 선택 항목이라 비워도 체크인을 끝낼 수 있습니다.
  // 이미 체크인한 날이면 적어 둔 약속으로 시작해서 고칠 수 있습니다.
  const [promiseIf, setPromiseIf] = useState(existingCheckIn?.promiseIf ?? '')
  const [promiseThen, setPromiseThen] = useState(existingCheckIn?.promiseThen ?? '')

  // 어제 정한 약속 (#79). 있을 때만 "지켰어 / 못 지켰어" 를 묻습니다.
  // 이미 답한 적이 있으면 그 답으로 시작하고, 아직 안 골랐으면 null 입니다.
  const yesterdayCheckIn = getCheckIn(yesterdayKey)
  const askedPromise = getAskedPromise(yesterdayCheckIn)
  // 최근 7일 동안 답한 약속 중 지킨 횟수. 답이 쌓였는데 어디에도 안 보이면 답할 이유가 없어서, 이 카드에 보여 줍니다.
  const keptCount = countKeptPromises(checkIns, todayKey)
  const [promiseKept, setPromiseKept] = useState<boolean | null>(
    yesterdayCheckIn?.promiseKept ?? null,
  )

  // 휴대폰 집중 모드 확인 (#106). 안내 화면에서 "체크인에서 확인받기" 를 켠 사람에게만 묻습니다.
  // 이미 답한 체크인이면 그 답으로 시작하고, 아직 안 골랐으면 null 입니다.
  const [isPhoneFocusAsked] = useState(getPhoneFocusEnabled)
  const [phoneFocusKept, setPhoneFocusKept] = useState<boolean | null>(
    existingCheckIn?.phoneFocusKept ?? null,
  )

  // 어제 계획 달성률 = 어제 실제로 공부한 시간 ÷ 어제 계획한 목표 시간
  // 노는 계획은 공부 목표가 아니라서 뺍니다. (#238)
  const yesterdayPlans = getPlans(yesterdayKey).filter((plan) => plan.kind !== 'play')
  const targetMinutes = yesterdayPlans.reduce((sum, plan) => sum + plan.targetMinutes, 0)

  // 어제 시작한 공부 기록의 순공시간(일시정지한 시간은 뺌)입니다. 노는 기록은 공부가 아니라서 들어가지 않습니다. (lib/daySummary.ts 규칙 10)
  const actualMinutes = getDaySummary(yesterdayKey, yesterdayPlans, sessions).studyMinutes

  // 달성률은 소수점을 버립니다. (99.5% 를 100% 로 보여주면서 "다 못 채웠어?" 를 묻는 일이 없게)
  // lib/daySummary.ts 의 규칙 5 와 같습니다.
  const achievementRate =
    targetMinutes === 0 ? 0 : Math.min(100, Math.floor((actualMinutes * 100) / targetMinutes))

  // 계획이 있었는데 다 못 채운 날에만 "왜 못 했어?" 를 묻습니다. (계획이 없던 날은 못 채운 게 아닙니다)
  const needsMissReason = targetMinutes > 0 && achievementRate < 100

  // 방금 저장했는지. 버튼 위에 "저장했어요" 를 보여주는 데 씁니다.
  const [isSaved, setIsSaved] = useState(false)

  function handleSubmit() {
    const checkIn: CheckIn = {
      date: todayKey,
      condition,
      mood,
      expectedMinutes,
    }

    // 못 채운 날에 이유를 골랐을 때만 저장합니다. '기타' 일 때만 적은 한 줄도 같이 저장합니다.
    if (needsMissReason && missReason !== null) {
      checkIn.missReason = missReason.reason
      const note = missReason.note.trim()
      if (missReason.reason === 'etc' && note !== '') {
        checkIn.missReasonNote = note
      }
    }
    // 하루 첫 한 줄에서 고른 감정 태그는 이 화면에서 묻지 않으니 그대로 이어 둡니다. (덮어쓰기로 지워지지 않게, #387)
    if (existingCheckIn?.emotions !== undefined) {
      checkIn.emotions = existingCheckIn.emotions
    }
    // 물어봤고 답을 골랐을 때만 저장합니다. 안 골랐으면 "안 켰다" 가 아니라 "모름" 이라 남기지 않습니다.
    if (isPhoneFocusAsked && phoneFocusKept !== null) {
      checkIn.phoneFocusKept = phoneFocusKept
    }
    // 두 칸을 모두 적었을 때만 약속으로 저장합니다. 한 칸만 적었거나 비웠으면 저장하지 않습니다. (#79)
    const promise = makePromiseText(promiseIf, promiseThen)
    if (promise !== null) {
      checkIn.promiseIf = promise.promiseIf
      checkIn.promiseThen = promise.promiseThen
    }
    // 이 기기에 먼저 저장하고, 서버로도 보냅니다. 서버에 못 보내도 이 기기의 체크인은 그대로입니다.
    saveCheckIn(checkIn)
    sendToServer(checkIn)
    // 적은 글(기타 사유 · 오늘의 약속)에 위기 표현이 있거나 기분이 오래 낮으면 도움 안내로 보냅니다. (일기와 같은 규칙)
    const needsHelp = shouldShowCrisisHelp({
      texts: [checkIn.missReasonNote ?? '', checkIn.promiseIf ?? '', checkIn.promiseThen ?? ''],
      diaryMoods: [{ date: todayKey, mood }],
    })

    // 어제 약속에 답했으면, 약속을 정한 어제 체크인에 그 답을 적습니다. 안 골랐으면 "모름" 이라 남기지 않습니다. (#79)
    if (yesterdayCheckIn !== undefined && askedPromise !== null && promiseKept !== null) {
      saveCheckIn({ ...yesterdayCheckIn, promiseKept })
    }

    // 답한 개선안만 저장합니다. 답하지 않은 개선안은 기록을 남기지 않습니다. ("못 지킴" 이 아니라 "모름")
    for (const suggestion of yesterdaySuggestions) {
      const kept = keptById[suggestion.id]
      if (kept !== undefined) {
        saveCheck({ suggestionId: suggestion.id, date: yesterdayKey, kept })
      }
    }
    setIsSaved(true)
    if (needsHelp) navigate(SUPPORT_PATH)
  }

  /**
   * 체크인을 서버로 보냅니다. 이 화면에서 고친 그대로 보냅니다. (lib/checkInsApi.ts 의 sendCheckIn)
   * 어제 약속을 지켰는지 · 휴대폰 집중 모드는 서버에 칸이 없어서 이 기기에만 남습니다.
   */
  function sendToServer(checkIn: CheckIn) {
    if (send.canSync) send.mutate(checkIn)
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">자세히 체크인</h1>
          {isCheckedInToday && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-600">
              ✓ 오늘 체크인 완료
            </span>
          )}
        </div>
        {/* 컨디션·감정은 그날 첫 화면 맨 위의 한 줄로 받습니다. (#387) 이 화면은 더 적고 싶은 날에만 씁니다. */}
        <p className="mt-2 break-keep text-slate-600">
          컨디션과 감정은 그날 첫 화면 맨 위에서 골라요. 기분·예상 시간·약속까지 적고 싶은 날에만
          하면 돼요.
        </p>
      </div>

      <Card title="어제 요약" className="rounded-2xl">
        <div className="flex flex-wrap gap-6">
          <div>
            <p className="text-sm text-slate-500">순공시간</p>
            <p className="text-xl font-bold text-slate-900">{formatMinutes(actualMinutes)}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">계획 달성률</p>
            <p className="text-xl font-bold text-slate-900">{achievementRate}%</p>
          </div>
        </div>

        <ProgressBar value={achievementRate} className="mt-4" />

        <p className="mt-2 text-sm text-slate-500">
          계획 {formatMinutes(targetMinutes)} 중 {formatMinutes(actualMinutes)}
        </p>
        <p className="mt-3 text-sm font-medium text-slate-600">
          {getEncouragement(targetMinutes, achievementRate)}
        </p>
      </Card>

      <Card title="오늘 컨디션은?" className="rounded-2xl">
        <div className="grid grid-cols-5 gap-2">
          {CONDITION_OPTIONS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={condition === value}
              onClick={() => setCondition(value)}
              className={cn(CHIP_BASE, condition === value ? CHIP_SELECTED : CHIP_UNSELECTED)}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-sm text-slate-500">
          <span>최악</span>
          <span>최고</span>
        </div>
      </Card>

      <Card title="기분은 어때?" className="rounded-2xl">
        <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
          {MOOD_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={mood === option.value}
              aria-label={option.label}
              onClick={() => setMood(option.value)}
              className={cn(
                CHIP_BASE,
                'min-h-16 flex-col gap-1 px-1 py-2 text-center text-xs',
                mood === option.value ? CHIP_SELECTED : CHIP_UNSELECTED,
              )}
            >
              <span className="text-2xl">{option.emoji}</span>
              <span className="leading-tight break-keep">{option.label}</span>
            </button>
          ))}
        </div>
      </Card>

      {needsMissReason && (
        <MissReasonPicker
          achievementRate={achievementRate}
          value={missReason}
          onChange={setMissReason}
          className="rounded-2xl"
        />
      )}

      <Card title="오늘은 몇 시간 할 것 같아?" className="rounded-2xl">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {EXPECTED_MINUTES_OPTIONS.map((option) => (
            <button
              key={option.minutes}
              type="button"
              aria-pressed={expectedMinutes === option.minutes}
              onClick={() => setExpectedMinutes(option.minutes)}
              className={cn(
                CHIP_BASE,
                expectedMinutes === option.minutes ? CHIP_SELECTED : CHIP_UNSELECTED,
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </Card>

      {/* 어제 도전 중이던 개선안이 있을 때만 보여줍니다. */}
      {yesterdaySuggestions.length > 0 && (
        <Card title="도전 중인 개선안, 어제 지켰어?" className="rounded-2xl">
          <ul className="flex flex-col gap-4">
            {yesterdaySuggestions.map((suggestion) => {
              const kept = keptById[suggestion.id]
              return (
                <li key={suggestion.id}>
                  <p className="text-sm font-medium break-keep text-slate-800 sm:text-base">
                    <span className="text-brand">만약</span> {suggestion.ifText} →{' '}
                    {suggestion.thenText}
                  </p>
                  {/* 지켰어 / 못 지켰어 중 하나만 고릅니다. 다시 누르면 다른 쪽으로 바꿀 수 있습니다. */}
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      aria-pressed={kept === true}
                      onClick={() => handleSelectKept(suggestion.id, true)}
                      className={cn(CHIP_BASE, kept === true ? CHIP_SELECTED : CHIP_UNSELECTED)}
                    >
                      지켰어
                    </button>
                    <button
                      type="button"
                      aria-pressed={kept === false}
                      onClick={() => handleSelectKept(suggestion.id, false)}
                      className={cn(CHIP_BASE, kept === false ? CHIP_SELECTED : CHIP_UNSELECTED)}
                    >
                      못 지켰어
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {/* 어제 정한 약속이 있을 때만 보여줍니다. 지켰어 / 못 지켰어로 예·아니오 하나만 답합니다. (#79) */}
      {askedPromise !== null && (
        <Card title="어제의 약속, 지켰어?" className="rounded-2xl">
          <p className="text-sm font-medium break-keep text-slate-800 sm:text-base">
            <span className="text-brand">만약</span> {askedPromise.promiseIf} →{' '}
            {askedPromise.promiseThen}
          </p>
          {/* 다시 누르면 다른 쪽으로 바꿀 수 있습니다. */}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-pressed={promiseKept === true}
              onClick={() => setPromiseKept(true)}
              className={cn(CHIP_BASE, promiseKept === true ? CHIP_SELECTED : CHIP_UNSELECTED)}
            >
              지켰어
            </button>
            <button
              type="button"
              aria-pressed={promiseKept === false}
              onClick={() => setPromiseKept(false)}
              className={cn(CHIP_BASE, promiseKept === false ? CHIP_SELECTED : CHIP_UNSELECTED)}
            >
              못 지켰어
            </button>
          </div>
          {keptCount.answered > 0 && (
            <p className="mt-3 text-sm break-keep text-slate-500">
              최근 7일 동안 답한 약속 {keptCount.answered}개 중 {keptCount.kept}개를 지켰어.
            </p>
          )}
        </Card>
      )}

      {/* 휴대폰 집중 모드 확인을 켠 사람에게만 보여줍니다. (#106) */}
      {isPhoneFocusAsked && (
        <Card title="어제 휴대폰 집중 모드 켰어?" className="rounded-2xl">
          {/* 켰어 / 못 켰어 중 하나만 고릅니다. 다시 누르면 다른 쪽으로 바꿀 수 있습니다. */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-pressed={phoneFocusKept === true}
              onClick={() => setPhoneFocusKept(true)}
              className={cn(CHIP_BASE, phoneFocusKept === true ? CHIP_SELECTED : CHIP_UNSELECTED)}
            >
              켰어
            </button>
            <button
              type="button"
              aria-pressed={phoneFocusKept === false}
              onClick={() => setPhoneFocusKept(false)}
              className={cn(CHIP_BASE, phoneFocusKept === false ? CHIP_SELECTED : CHIP_UNSELECTED)}
            >
              못 켰어
            </button>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            내가 답한 대로만 기록해요. 정말 켰는지는 확인하지 않아요.
          </p>
        </Card>
      )}

      {/* 오늘의 약속 (#79). 선택 항목이라 비워도 됩니다. 두 칸을 모두 적어야 약속으로 저장됩니다. */}
      <Card title="오늘의 약속" className="rounded-2xl">
        <p className="text-sm break-keep text-slate-600">
          &quot;만약 ~하면 → ~한다&quot; 로 적으면, 내일 체크인에서 지켰는지 물어봐요. (선택)
        </p>

        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Input
              name="promiseIf"
              label="만약 ~하면"
              placeholder="예) 학원에서 돌아오면"
              maxLength={PROMISE_MAX_LENGTH}
              value={promiseIf}
              onChange={(event) => setPromiseIf(event.target.value)}
              className="h-11 text-base"
            />
            {/* 글자 수. 적을 수 있는 최대는 40자입니다. */}
            <p className="text-right text-xs text-slate-500 tabular-nums">
              {promiseIf.length}/{PROMISE_MAX_LENGTH}
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <Input
              name="promiseThen"
              label="→ 그러면 ~한다"
              placeholder="예) 씻기 전에 영어 단어 20개를 본다"
              maxLength={PROMISE_MAX_LENGTH}
              value={promiseThen}
              onChange={(event) => setPromiseThen(event.target.value)}
              className="h-11 text-base"
            />
            <p className="text-right text-xs text-slate-500 tabular-nums">
              {promiseThen.length}/{PROMISE_MAX_LENGTH}
            </p>
          </div>
        </div>

        {/* 한 칸만 적었으면 약속으로 저장되지 않는다는 것을 알려 줍니다. 체크인은 그대로 끝낼 수 있습니다. */}
        {isHalfFilledPromise(promiseIf, promiseThen) && (
          <p role="status" className="mt-2 text-xs break-keep text-amber-700">
            두 칸을 모두 적어야 약속으로 저장돼요. 지금은 저장되지 않아요.
          </p>
        )}

        {/* 눌러서 칸을 채우는 예시. 두 칸이 한꺼번에 채워집니다. */}
        <div className="mt-4 flex flex-col gap-2">
          <span className="text-sm font-medium text-slate-700">예시로 채우기</span>
          <div className="flex flex-wrap gap-2">
            {PROMISE_EXAMPLES.map((example) => (
              <button
                key={example.ifText}
                type="button"
                onClick={() => {
                  setPromiseIf(example.ifText)
                  setPromiseThen(example.thenText)
                }}
                // max-w-full + text-left: 긴 문장도 버튼이 카드 밖으로 나가지 않고 줄바꿈됩니다.
                className="min-h-10 max-w-full cursor-pointer rounded-lg border border-dashed border-slate-400 bg-slate-50 px-3 py-2 text-left text-sm break-keep text-slate-700 transition-colors hover:bg-slate-100"
              >
                {example.ifText} → {example.thenText}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* 저장한 직후에 버튼 바로 위에 알려 줍니다. (모바일은 맨 위의 "체크인 완료" 표시가 화면 밖이라 안 보입니다) */}
      {isSaved && (
        <p role="status" className="text-center text-sm font-medium text-emerald-700">
          저장했어요. 내용을 고치고 다시 저장할 수도 있어요.
        </p>
      )}
      {/* 서버에 못 보냈을 때. 이 기기에는 저장됐고, 다시 보낼 수 있습니다. (안 눌러도 다음에 앱을 열 때 다시 보냅니다) */}
      {isSaved && send.isError && send.variables !== undefined && (
        <div role="alert" className="flex flex-col items-center gap-2 text-center">
          <p className="text-sm break-keep text-amber-700">
            이 기기에는 저장했지만 서버에는 아직 못 보냈어요. {getApiErrorMessage(send.error)}
          </p>
          <Button
            variant="secondary"
            onClick={() => send.variables !== undefined && sendToServer(send.variables)}
          >
            서버에 다시 보내기
          </Button>
        </div>
      )}

      <Button
        size="lg"
        className="w-full gap-2 rounded-xl text-base shadow-sm transition-transform hover:shadow-md active:scale-[0.98]"
        onClick={handleSubmit}
      >
        {isCheckedInToday ? '✏️ 체크인 다시 저장' : '✅ 체크인 완료'}
      </Button>
    </div>
  )
}
