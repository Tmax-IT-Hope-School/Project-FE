/**
 * "지금 쌓을 앱 알림이 있는지" 확인해서 알림 목록에 쌓는 함수입니다. (#255)
 *
 * 저장소(계획 · 공부 기록 · 설정)를 읽기 때문에 순수 함수가 아닙니다. 판단과 문구는 순수 함수가 합니다.
 *   - 보낼지 말지 : lib/eventMessage.ts 의 getEventMessage (#83)
 *   - 문구 · 말투 : lib/appAlert.ts
 * 앱이 열려 있는 동안 hooks/useAppAlerts.ts 가 10초마다 checkAppAlerts 를 부릅니다.
 * 앱이 닫혀 있으면 아무 일도 일어나지 않습니다. (닫혀 있을 때 알리려면 서버와 웹 푸시가 필요합니다 → #256)
 *
 * ■ 지키는 설정
 *  - 연락 금지 시간(#60) 안이면 아무것도 쌓지 않습니다.
 *  - 하루 메시지 수(#60)가 0 이면 아무것도 쌓지 않습니다. (0 은 "모두 끔" 입니다)
 *  - 관리 강도 최대 한도(#59)보다 센 말투로 쌓지 않습니다. 독설 허용 수위보다 센 문장도 쓰지 않습니다.
 *  - 안전 브레이크(#95)가 켜져 있으면 회복 말투로만 쌓습니다.
 *  - 같은 종류의 알림은 하루에 한 번만 쌓입니다. (지난주 목표 결과는 한 주에 한 번)
 *    알림의 id 를 'alert-종류-날짜' 로 만들어서, 같은 id 가 이미 있으면 쌓이지 않습니다.
 */
import { addAiMessage, loadAiMessages } from '@/lib/aiMessages'
import {
  appAlertLabels,
  findFinishedTimerToday,
  findFirstPlannedPlan,
  getAppAlertCareLevel,
  getAppAlertText,
  weekGoalLabels,
  type AppAlertType,
} from '@/lib/appAlert'
import { getCareLimits } from '@/lib/careLimits'
import { formatMinutes, loadAllSessions } from '@/lib/dailyRecords'
import { moveDateKey, toDayKey } from '@/lib/date'
import { getEventMessage, type EventMessageType } from '@/lib/eventMessage'
import { getFacts } from '@/lib/facts'
import { isSafetyBrakeOnNow } from '@/lib/focusMode'
import { countConsecutiveMissDays } from '@/lib/goalAdjustInput'
import { getMessageSettings } from '@/lib/messageSettings'
import { toQuietHours } from '@/lib/notifications'
import { getDayProgress } from '@/lib/planProgress'
import { isWithinQuietHours } from '@/lib/safetyBrake'
import { loadData, loadRecord } from '@/lib/storage'
import { hasStudiedToday } from '@/lib/streak'
import { getSubjectsSnapshot } from '@/lib/subjects'
import { getMondayKey } from '@/lib/weeklyFacts'
import { getWeeklyGoalProgress, loadPastWeeklyGoals } from '@/lib/weeklyGoal'
import type { StudyPlan } from '@/types'

// getEventMessage(#83)가 판단해 주는 알림 종류들
const EVENT_TYPES: EventMessageType[] = ['planLate', 'goalDone', 'missed3Days']

/** 알림의 id 를 만듭니다.  makeAlertId('goalDone', '2026-10-11') -> 'alert-goalDone-2026-10-11' */
function makeAlertId(kind: string, dateKey: string): string {
  return `alert-${kind}-${dateKey}`
}

/** 저장된 계획을 모든 날짜에서 모아 한 배열로 돌려줍니다. (usePlans 의 allPlans 와 같은 값입니다) */
function loadAllPlans(): StudyPlan[] {
  const plans: StudyPlan[] = []
  for (const dayPlans of Object.values(loadRecord<unknown>('plans'))) {
    // 저장된 값이 깨져서 배열이 아닌 날은 건너뜁니다.
    if (Array.isArray(dayPlans)) plans.push(...(dayPlans as StudyPlan[]))
  }
  return plans
}

/**
 * 알림 하나를 말투와 문구를 정해서 목록에 쌓습니다. 쌓았으면 true 입니다.
 * id 가 같은 알림이 이미 있으면 쌓이지 않습니다. (addAiMessage 가 걸러 줍니다)
 */
function pushAlert(
  type: AppAlertType,
  id: string,
  values: Record<string, string>,
  now: Date,
): boolean {
  const limits = getCareLimits()
  // 안전 브레이크가 켜져 있으면 회복 말투, 아니면 기본 말투를 내 한도 안에서 씁니다.
  const careLevel = getAppAlertCareLevel(type, limits.maxCareLevel, isSafetyBrakeOnNow())

  return addAiMessage({
    id,
    sentAt: now.getTime(),
    careLevel,
    kind: 'event',
    eventLabel: appAlertLabels[type],
    source: 'app',
    text: getAppAlertText(type, careLevel, limits.maxHarshness, values),
    read: false,
  })
}

/**
 * 지금 쌓을 알림이 있는지 확인하고, 있으면 쌓습니다. 여러 번 불러도 같은 알림이 두 번 쌓이지 않습니다.
 * now 는 "지금이 언제인지" 입니다. 평소엔 비워 두면 됩니다.
 */
export function checkAppAlerts(now: Date = new Date()): void {
  const settings = getMessageSettings()
  const quietHours = toQuietHours(settings)
  // 연락 금지 시간이거나 메시지를 모두 끈 상태면 아무것도 쌓지 않습니다.
  if (isWithinQuietHours(now, quietHours) || settings.dailyCount <= 0) return

  const todayKey = toDayKey(now)
  // 이미 쌓은 알림의 id 들. 같은 알림을 또 계산하지 않으려고 먼저 모아 둡니다.
  const sentIds = new Set(loadAiMessages().map((message) => message.id))

  const allPlans = loadAllPlans()
  const allSessions = loadAllSessions()
  // 노는 기록·노는 계획은 공부가 아니라서 뺍니다.
  const sessions = allSessions.filter((session) => session.kind !== 'play')
  const todayPlans = allPlans.filter((plan) => plan.date === todayKey && plan.kind !== 'play')
  const subjects = getSubjectsSnapshot()

  /* ---------- 1) 타이머 목표 시간을 채워서 끝냈을 때 ---------- */
  const timerDoneId = makeAlertId('timerDone', todayKey)
  if (!sentIds.has(timerDoneId)) {
    const finished = findFinishedTimerToday(sessions, todayKey)
    if (finished !== null) {
      const subject = subjects.find((item) => item.id === finished.subjectId)
      pushAlert(
        'timerDone',
        timerDoneId,
        { subject: subject?.name ?? '공부', minutes: String(finished.targetMinutes) },
        now,
      )
    }
  }

  /* ---------- 2) 계획 시각 지남 · 오늘 계획 다 채움 · 3일 연속 미달 (#83 이 판단) ---------- */
  const firstPlan = findFirstPlannedPlan(todayPlans)
  // 가장 이른 계획의 시작 시각이 정말 지났을 때만 그 시각을 넘깁니다.
  // (getEventMessage 는 시각을 자정 기준으로 비교해서, 새벽 1시 계획을 저녁에 "지났다" 고 볼 수 있기 때문입니다)
  const isPlanTimePassed = firstPlan !== null && firstPlan.startAt <= now.getTime()
  const progress = getDayProgress(todayPlans, allSessions)
  // 타이머 화면이 저장해 둔 스톱워치 상태입니다. 시작한 뒤 정지하기 전이면 startedAt 이 숫자입니다. (hooks/useStopwatch.ts)
  const timer = loadData<{ startedAt?: unknown } | null>('timer', null)

  const eventType = getEventMessage({
    now,
    quietHours,
    dailyCount: settings.dailyCount,
    alreadySentToday: EVENT_TYPES.filter((type) => sentIds.has(makeAlertId(type, todayKey))),
    plannedStartTime: isPlanTimePassed ? (firstPlan.plan.startTime ?? null) : null,
    isTimerRunning: typeof timer?.startedAt === 'number',
    hasStudiedToday: hasStudiedToday(sessions, now),
    // 계획에서 시작한 타이머로 공부한 시간의 합입니다. 홈의 "오늘 계획" 카드와 같은 숫자입니다.
    todayStudyMinutes: progress.actualMinutes,
    todayTargetMinutes: progress.targetMinutes,
    consecutiveMissDays: countConsecutiveMissDays(allPlans, sessions, now),
  })

  if (eventType === 'planLate' && firstPlan !== null) {
    const { plan } = firstPlan
    const subject = subjects.find((item) => item.id === plan.subjectId)
    pushAlert(
      'planLate',
      makeAlertId('planLate', todayKey),
      {
        time: plan.startTime ?? '',
        plan: subject ? `${subject.name} ${plan.content}` : plan.content,
      },
      now,
    )
  } else if (eventType === 'goalDone') {
    pushAlert(
      'goalDone',
      makeAlertId('goalDone', todayKey),
      { target: formatMinutes(progress.targetMinutes) },
      now,
    )
  } else if (eventType === 'missed3Days') {
    pushAlert('missed3Days', makeAlertId('missed3Days', todayKey), {}, now)
  }

  /* ---------- 3) 지난주에 고른 목표의 결과가 나왔을 때 (#247) ---------- */
  const thisMonday = getMondayKey(now)
  const lastMonday = moveDateKey(thisMonday, -7)
  // 달성이든 미달이든 한 주에 하나만 쌓이도록 id 를 같게 둡니다.
  const weekGoalId = makeAlertId('weekGoal', lastMonday)
  if (!sentIds.has(weekGoalId)) {
    const goal = loadPastWeeklyGoals(thisMonday).find((item) => item.mondayKey === lastMonday)
    if (goal !== undefined) {
      // 주간 리포트의 "지난 목표" 와 같은 방법으로, 그 주 월요일 ~ 일요일의 팩트로 결과를 판정합니다.
      const weekFacts = getFacts(allPlans, sessions, lastMonday, moveDateKey(lastMonday, 6))
      const result = getWeeklyGoalProgress(goal, weekFacts)
      // 기록이 없어서 결과를 알 수 없는 주는 알리지 않습니다.
      if (result.current !== null) {
        const { label, unit } = weekGoalLabels[goal.kind]
        pushAlert(
          result.status === 'achieved' ? 'weekGoalAchieved' : 'weekGoalMissed',
          weekGoalId,
          {
            label,
            before: `${goal.baseline}${unit}`,
            after: `${result.current}${unit}`,
            target: `${goal.target}${unit}`,
          },
          now,
        )
      }
    }
  }
}
