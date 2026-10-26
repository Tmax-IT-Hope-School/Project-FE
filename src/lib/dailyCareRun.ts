/**
 * 하루 1번 관리 단계(당근/채찍)를 판정하고 저장합니다. (기획서 「5.4 관리 단계」, #384 규칙을 #405 에서 부름)
 *
 * 기획서: "매일 1회 판정 (통화 시점, 통화가 없으면 다음 날 첫 진입 때)". 홈을 처음 열 때 부릅니다.
 * 오늘 이미 판정했으면(통화 · 4단계 내림 등) 다시 판정하지 않고 저장된 것을 돌려줍니다.
 *
 * 판정 규칙은 lib/careStage.ts 의 decideCareStage 에 있고, 이 파일은 그 재료를 저장된 기록에서 모으기만 합니다.
 *   기준 단계   ← 의지력(willpower.ts: 최근 카드 기록 + 심리검사) · 관리 선호 · 시작한 지 며칠째
 *   안전 조건   ← 안전 브레이크(safetyBrake.ts: 위기 표현 · 기분 저하 · 시험 기간)
 *   회복 조건   ← 휴식·미실행만 이어진 날 · 부정 감정 태그만 이어진 날 · 절대 카드 미실행 · 회복 민감도 설정
 *   재발 신호   ← 카드 하루치 판정(cardDays.ts) → relapseSignal.ts
 *   한도        ← 내가 정한 제재 최대 한도(careLimits.ts)
 */
import { buildJudgedCardDays } from '@/lib/cardDays'
import { loadCardMarks } from '@/lib/cardMarks'
import { isMissResult } from '@/lib/cardResult'
import { loadSavedCards } from '@/lib/cards'
import { getCareLimits } from '@/lib/careLimits'
import {
  decideCareStage,
  loadLatestCareStage,
  saveCareStage,
  type CareStageInput,
  type SavedCareStage,
} from '@/lib/careStage'
import { loadCheckInsByDate } from '@/lib/callSummary'
import { loadAllSessions } from '@/lib/dailyRecords'
import { moveDateKey, toDayKey } from '@/lib/date'
import { loadExamDates, loadSavedWritings } from '@/lib/diarySafety'
import { getDaysUntil } from '@/lib/onboardingSteps'
import { getScaleLevel, loadPsychTest } from '@/lib/psychTest'
import {
  BASELINE_DAYS,
  RECENT_DAYS,
  getRelapseSignal,
  type JudgedCardDay,
} from '@/lib/relapseSignal'
import { getCardDayMarkInfo, loadRestDays } from '@/lib/restDays'
import { getSafetyBrakeResult } from '@/lib/safetyBrake'
import { loadAutoSettings } from '@/lib/settingsMapping'
import { loadData } from '@/lib/storage'
import { getBaseStage, getWillpower } from '@/lib/willpower'
import type { CheckIn, EmotionTag } from '@/types'

/** 부정 감정 태그 (회복 조건 "부정 감정 태그 3일 연속") */
const NEGATIVE_EMOTIONS: EmotionTag[] = ['STUCK', 'ANXIOUS', 'TIRED', 'ANNOYED']

/** 연속 일수를 셀 때 거슬러 올라가는 최대 날 수 (회복 민감도가 최대 4일이라 넉넉하게) */
const STREAK_LOOKBACK_DAYS = 14

/**
 * 오늘까지 "휴식이거나, 카드를 모두 못 한 날" 만 이어진 날 수. 카드가 없고 휴식도 아닌 날에서 멈춥니다.
 *
 *   10/17 미실행 · 10/16 휴식 · 10/15 실행          -> 2
 *   10/17 카드 2개 중 1개 실행                      -> 0
 */
export function countRestOrMissStreak(
  days: JudgedCardDay[],
  restDates: Set<string>,
  todayKey: string,
): number {
  let streak = 0
  for (let back = 0; back < STREAK_LOOKBACK_DAYS; back += 1) {
    const dateKey = moveDateKey(todayKey, -back)
    if (restDates.has(dateKey)) {
      streak += 1
      continue
    }
    const dayResults = days.filter((day) => day.dateKey === dateKey).map((day) => day.result)
    if (
      dayResults.length === 0 ||
      !dayResults.every((result) => result === 'rest' || isMissResult(result))
    ) {
      break
    }
    streak += 1
  }
  return streak
}

/**
 * 오늘까지 "고른 감정 태그가 모두 부정 태그(막막함·불안함·피곤함·짜증남)" 인 날이 이어진 날 수.
 * 태그를 안 고른 날(건너뜀 · 체크인 없음)에서 멈춥니다.
 */
export function countNegativeMoodStreak(
  checkIns: Record<string, CheckIn>,
  todayKey: string,
): number {
  let streak = 0
  for (let back = 0; back < STREAK_LOOKBACK_DAYS; back += 1) {
    const emotions = checkIns[moveDateKey(todayKey, -back)]?.emotions ?? []
    if (emotions.length === 0 || !emotions.every((tag) => NEGATIVE_EMOTIONS.includes(tag))) break
    streak += 1
  }
  return streak
}

/** 관리를 시작한 지 며칠째인지 (0 = 첫날). 온보딩 관리 설정에 동의한 날부터, 없으면 0 */
function getDayIndex(todayKey: string): number {
  const consentAt = loadData<unknown>('onboarding-care-consent', null)
  if (typeof consentAt !== 'number') return 0
  const startKey = toDayKey(consentAt)
  const [year, month, day] = startKey.split('-').map(Number)
  return Math.max(0, getDaysUntil(todayKey, new Date(year, month - 1, day, 12)))
}

/**
 * 오늘의 관리 단계를 판정해 저장하고 돌려줍니다. 오늘 이미 판정했으면 그것을 돌려줍니다.
 * now 는 지금 시각(Date.now())입니다. 카드 시간이 끝났는지 판정하는 데 씁니다.
 */
export function runDailyCareStage(todayKey: string, now: number): SavedCareStage {
  const latest = loadLatestCareStage(todayKey)
  if (latest?.dateKey === todayKey) return latest

  const cards = loadSavedCards() ?? []
  const restDays = loadRestDays()
  const marks = loadCardMarks()
  // 재발 신호 ② 가 최근 7일과 그 앞 14일을 비교해서, 그만큼의 판정을 만듭니다. (의지력은 이 중 최근 14일을 씀)
  const fromKey = moveDateKey(todayKey, -(RECENT_DAYS + BASELINE_DAYS - 1))
  const days = buildJudgedCardDays(
    cards,
    loadAllSessions(),
    fromKey,
    todayKey,
    now,
    (cardId, dateKey) => getCardDayMarkInfo(cardId, dateKey, restDays, marks),
  )

  // 재발 신호는 지난 판정 다음 날부터 새로 생긴 미실행을 봅니다. 처음이면 최근 7일
  const sinceKey = latest
    ? moveDateKey(latest.dateKey, 1)
    : moveDateKey(todayKey, -(RECENT_DAYS - 1))
  const relapse = getRelapseSignal(days, todayKey, sinceKey)

  const scores = loadPsychTest()?.scores
  const dayIndex = getDayIndex(todayKey)
  const willpower = getWillpower(
    days.filter((day) => day.dateKey > moveDateKey(todayKey, -BASELINE_DAYS)),
    scores && {
      startResistance: scores.startResistance,
      distraction: scores.distraction,
      failSensitivity: scores.failSensitivity,
    },
  )
  const baseStage = getBaseStage(
    willpower,
    scores ? getScaleLevel(scores.carePreference) : undefined,
    dayIndex,
  )

  const { texts, moods, crisisFlagged } = loadSavedWritings()
  const brake = getSafetyBrakeResult({
    now: new Date(now),
    recentTexts: texts,
    recentMoods: moods,
    crisisFlagged,
    exams: loadExamDates(),
  })

  const input: CareStageInput = {
    previousStage: latest?.stage,
    baseStage,
    dayIndex,
    safety: { crisis: brake.stopWhip, lowMood: brake.recoveryMode && !brake.stopWhip },
    recovery: {
      restOrMissStreakDays: countRestOrMissStreak(
        days,
        new Set(restDays.map((rest) => rest.date)),
        todayKey,
      ),
      negativeMoodStreakDays: countNegativeMoodStreak(loadCheckInsByDate(), todayKey),
      absoluteMissed: relapse.reasons.includes('absoluteMiss'),
      // 대화(통화·채팅)에서 힘들다는 표현을 아직 앱에 모으지 않아서 false 입니다. (상담 채팅 #416 이후)
      hardTalk: false,
      sensitivityDays: loadAutoSettings().recoverySensitivityDays.value,
    },
    relapse,
    maxLevel: getCareLimits().maxCareLevel,
    examPeriod: brake.examPeriod,
  }
  const result = decideCareStage(input)
  const saved: SavedCareStage = { stage: result.stage, reason: result.reason, rule: result.rule }
  saveCareStage(todayKey, saved)
  return saved
}
