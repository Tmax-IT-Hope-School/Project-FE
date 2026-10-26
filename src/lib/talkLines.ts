/**
 * [이야기하기] 로 대화방을 열 때 서버에 보내는 "사실 줄" 을 만듭니다. (2026-10-18, #582 · BE #330 의 about.lines)
 * 서버 AI 는 이 줄을 보고 그 주제로 첫 말을 꺼냅니다. 그래서 숫자 · 카드 제목처럼 이 기기가 아는 사실만 담습니다.
 *
 * ⚠️ 이름 · 학교 같은 개인정보는 넣지 않습니다. 한 줄은 150자, 8줄까지입니다. (lib/chatRooms.ts 의 cleanAboutLines 가 자름)
 * React 를 쓰지 않는 순수 함수입니다.
 */
import { CARD_FAIL_CAUSES, type CardFailCause } from '@/lib/cardMarks'
import { CARD_RESULT_LABELS } from '@/lib/cardResult'
import { DAY_STATUS_INFO, type CalendarDay } from '@/lib/calendarDay'
import { formatClock, formatMinutes, sessionMinutes } from '@/lib/dailyRecords'
import { toDayKey } from '@/lib/date'
import type { SelfAnalysis } from '@/lib/analysisFacts'
import type { FocusScoreRecord } from '@/lib/focusScore'
import { getScaleLevel, psychScales, type PsychScale } from '@/lib/psychTest'
import type { MissedTimeDay } from '@/lib/scheduleAdjust'
import { getSessionCardId } from '@/lib/sessionRecords'
import { SHORTFALL_REASONS } from '@/lib/sessionTags'
import type { QuizAnswer, QuizQuestion } from '@/lib/studyQuiz'
import type { Card, ShortfallReason, StudySession } from '@/types'

/** 보기 번호 글자 (문제 말풍선과 같음) */
const CHOICE_MARKS = ['①', '②', '③', '④']

/** 'YYYY-MM-DD' → '10월 18일' */
function monthDay(dateKey: string): string {
  const [, month, day] = dateKey.split('-').map(Number)
  return `${month}월 ${day}일`
}

/** 다 못 한 이유 값 → 글자 (모르는 값은 뺌) */
export function shortfallLabels(values: string[]): string[] {
  return values.flatMap((value) => {
    const found = SHORTFALL_REASONS.find((reason) => reason.key === value)
    return found ? [found.label] : []
  })
}

/** 카드 실패 원인 값 → 글자 (모르는 값은 뺌) */
export function failCauseLabels(values: string[]): string[] {
  return values.flatMap((value) => {
    const found = CARD_FAIL_CAUSES.find((cause) => cause.key === value)
    return found ? [found.label] : []
  })
}

/** AI 가 준 이유 값 중 그 주제에서 쓸 수 있는 것만 (서버도 거르지만 한 번 더) */
export function validReasonValues(
  kind: 'SESSION_REVIEW' | 'CARD_FAIL',
  values: string[],
): string[] {
  const allowed: string[] =
    kind === 'SESSION_REVIEW'
      ? SHORTFALL_REASONS.map((reason) => reason.key)
      : CARD_FAIL_CAUSES.map((cause) => cause.key)
  return [...new Set(values.filter((value) => allowed.includes(value)))].slice(0, 3)
}

/** 다 못 한 이유 값 목록인지 (저장 전에 확인) */
export function toShortfallReasons(values: string[]): ShortfallReason[] {
  return validReasonValues('SESSION_REVIEW', values) as ShortfallReason[]
}

/** 카드 실패 원인 값 목록인지 (저장 전에 확인) */
export function toFailCauses(values: string[]): CardFailCause[] {
  return validReasonValues('CARD_FAIL', values) as CardFailCause[]
}

/**
 * 방금 공부 후기 (SESSION_REVIEW)
 *
 *   sessionReviewLines({ session, card, checkedCount: 2, focus: { score: 82, … }, phone: { checks: 3, … } })
 *     -> ['카드: 미적분 3단원 · 40분 공부', '체크리스트 2/3 (못 한 것: 오답 정리)', '집중도 82%', '폰 · 들었던 시간 …']
 */
export function sessionReviewLines(input: {
  session: StudySession
  card: Card | undefined
  focus: FocusScoreRecord | null
  phoneText: string | null
}): string[] {
  const { session, card, focus, phoneText } = input
  const lines = [
    `카드: ${card?.title ?? '즉석 공부'} · ${formatMinutes(sessionMinutes(session))} 공부`,
  ]
  const checklist = card?.checklist ?? []
  if (checklist.length > 0) {
    const checked = session.endReport?.checked ?? {}
    const missed = checklist
      .filter((item) => checked[item.id] === undefined)
      .map((item) => item.text)
    const done = checklist.length - missed.length
    lines.push(
      missed.length > 0
        ? `체크리스트 ${done}/${checklist.length} (못 한 것: ${missed.slice(0, 3).join(', ')})`
        : `체크리스트 ${done}/${checklist.length} 다 함`,
    )
  }
  if (session.endedEarly) lines.push('예정보다 일찍 끝냄')
  if (focus) lines.push(`집중도 ${focus.score}%`)
  if (phoneText) lines.push(`폰: ${phoneText}`)
  if ((session.pauses?.length ?? 0) > 0) lines.push(`일시정지 ${session.pauses?.length}번`)
  return lines
}

/**
 * 못 한 카드 (CARD_FAIL)
 *
 *   cardFailLines(card, '2026-10-18', 2) -> ['카드: 영어 단어 · 30분 · 19:00 예정 (10월 18일)', '이번 주 이 카드 못 한 날 2번째']
 */
export function cardFailLines(card: Card, dateKey: string, failCountThisWeek: number): string[] {
  const time = card.startTime ? ` · ${card.startTime} 예정` : ''
  const lines = [
    `카드: ${card.title} · ${formatMinutes(card.durationMinutes)}${time} (${monthDay(dateKey)})`,
  ]
  if (card.checklist.length > 0) {
    lines.push(
      `할 일: ${card.checklist
        .map((item) => item.text)
        .slice(0, 3)
        .join(', ')}`,
    )
  }
  if (failCountThisWeek > 0) lines.push(`이번 주 이 카드 못 한 날 ${failCountThisWeek + 1}번째`)
  return lines
}

/**
 * AI 분석 카드 (WEEKLY_REPORT) — 요약 한 줄과 묶음마다 제목 한 줄
 * (리포트 화면의 주간 숫자 줄 weeklyReportLines 는 리포트를 뺀 2026-10-23 에 지웠습니다)
 *
 *   analysisLines({ summary: '저녁에 잘 되는 편', sections: [{ headline: '9시 이후 실행률 80%', … }], … })
 *     -> ['최근 28일 분석: 저녁에 잘 되는 편', '9시 이후 실행률 80%', …]
 */
export function analysisLines(analysis: SelfAnalysis, days: number): string[] {
  const lines = [`최근 ${days}일 분석: ${analysis.summary}`]
  for (const section of analysis.sections.slice(0, 5)) lines.push(section.headline)
  if (analysis.nextExperiment) {
    lines.push(`실험 제안: ${analysis.nextExperiment.ifText} → ${analysis.nextExperiment.thenText}`)
  }
  return lines
}

/**
 * 틀린 확인 문제 (QUIZ_WRONG) — 문제 / 학생 답 / 정답 / 해설을 한 문제에 한 줄씩 (3문제까지)
 *
 *   quizWrongLines('수열의 극한', [{ question: { question: 'lim 1/n 은?', choices: ['0','1','∞','없다'], answerIndex: 0, … }, answer: { choiceIndex: 1, … } }])
 *     -> ['주제: 수열의 극한', '문제: lim 1/n 은? / 학생 답: ② 1 / 정답: ① 0 / 해설: …']
 */
export function quizWrongLines(
  topic: string,
  wrong: { question: QuizQuestion; answer: QuizAnswer | null }[],
): string[] {
  const lines = [`주제: ${topic}`]
  for (const { question, answer } of wrong.slice(0, 3)) {
    const mine = answer
      ? `${CHOICE_MARKS[answer.choiceIndex]} ${question.choices[answer.choiceIndex]}`
      : '안 풂'
    const right = `${CHOICE_MARKS[question.answerIndex]} ${question.choices[question.answerIndex]}`
    lines.push(
      `문제: ${question.question} / 학생 답: ${mine} / 정답: ${right} / 해설: ${question.explanation}`,
    )
  }
  return lines
}

/**
 * 성향 검사 결과 (PSYCH_RESULT) — 척도마다 점수와 높낮이, 믿기 어려운 답이면 그 한 줄
 *
 *   psychResultLines({ startResistance: 5.6, … }, true) -> ['시작 저항 5.6 (높음)', '주의 분산 2.4 (낮음)', …]
 */
export function psychResultLines(
  scores: Record<PsychScale, number>,
  isReliable: boolean,
): string[] {
  const levelNames = { high: '높음', mid: '보통', low: '낮음' }
  const lines = (Object.keys(psychScales) as PsychScale[]).map(
    (scale) =>
      `${psychScales[scale].label} ${scores[scale].toFixed(1)} (${levelNames[getScaleLevel(scores[scale])]})`,
  )
  if (!isReliable) lines.push('답이 거의 다 같아서 믿기 어려움 — 단정하지 말기')
  return lines.slice(0, 8)
}

/**
 * 달력의 하루 (DAY_REVIEW)
 *
 *   dayReviewLines(day, 95) -> ['10월 17일 · 실행', '순공 1시간 35분', '미적분 문제집: 다 함 · 체크리스트 3/3', …]
 */
export function dayReviewLines(day: CalendarDay, studyMinutes: number | undefined): string[] {
  const status = day.status ? ` · ${DAY_STATUS_INFO[day.status].label}` : ''
  const lines = [`${monthDay(day.dateKey)}${status}`]
  if (studyMinutes !== undefined) lines.push(`순공 ${formatMinutes(studyMinutes)}`)
  for (const item of day.cards.slice(0, 5)) {
    const reasons = item.reasons.length > 0 ? ` (${item.reasons.join(', ')})` : ''
    lines.push(
      `${item.card.title}: ${CARD_RESULT_LABELS[item.result]} · 체크리스트 ${item.checkedCount}/${item.card.checklist.length}${reasons}`,
    )
  }
  if (day.pendingCount > 0) lines.push(`아직 결과 안 나온 카드 ${day.pendingCount}장`)
  return lines
}

/**
 * 일정 조정 제안 (SCHEDULE_ADJUST, 2026-10-26) — 첫 줄은 무엇이 이어졌는지, 그 뒤는 하루에 한 줄 (7일까지)
 * 하루 줄의 괄호에는 그날 제시간에 시작하지 못한 카드 중 가장 이른 카드 하나를 예로 적습니다.
 *
 *   scheduleAdjustLines([{ dateKey: '2026-10-24', timedCount: 3, notOnTime: [영어 단어 late, …] }, …], cards, sessions)
 *     -> ['최근 3일 연속, 시각을 정한 카드의 절반 넘게 제시간(10분 안)에 시작하지 못했어요',
 *         '10/24: 카드 3개 중 2개 늦게 시작하거나 못 함 (영어 단어 19:00 계획 → 19:40 시작)', …]
 */
export function scheduleAdjustLines(
  streak: MissedTimeDay[],
  cards: Card[],
  sessions: StudySession[],
): string[] {
  const lines = [
    `최근 ${streak.length}일 연속, 시각을 정한 카드의 절반 넘게 제시간(10분 안)에 시작하지 못했어요`,
  ]
  for (const day of streak.slice(0, 7)) {
    const [, month, date] = day.dateKey.split('-').map(Number)
    const head = `${month}/${date}: 카드 ${day.timedCount}개 중 ${day.notOnTime.length}개 늦게 시작하거나 못 함`

    // 예로 들 카드: 제시간에 못 시작한 카드 중 시작 시각이 가장 이른 것
    const examples = day.notOnTime
      .map((item) => ({ ...item, card: cards.find((card) => card.id === item.cardId) }))
      .filter((item) => item.card?.startTime)
      .sort((a, b) => (a.card?.startTime ?? '').localeCompare(b.card?.startTime ?? ''))
    const example = examples[0]
    if (!example?.card) {
      lines.push(head)
      continue
    }

    // 늦게 시작했으면 처음 켠 시각, 아니면 결과 글자(미뤘어요 · 못 했어요 · 아직 정리 안 했어요)
    const firstStartAt = firstCardStartAt(sessions, example.cardId, day.dateKey)
    const what =
      example.result === 'late' && firstStartAt !== null
        ? `${formatClock(firstStartAt)} 시작`
        : CARD_RESULT_LABELS[example.result]
    lines.push(`${head} (${example.card.title} ${example.card.startTime} 계획 → ${what})`)
  }
  return lines
}

/** 그 카드 · 그 날짜에 처음 타이머를 켠 시각. 노는 기록은 빼고, 없으면 null */
function firstCardStartAt(
  sessions: StudySession[],
  cardId: string,
  dateKey: string,
): number | null {
  let first: number | null = null
  for (const session of sessions) {
    if (session.kind === 'play') continue
    if (getSessionCardId(session, {}) !== cardId) continue
    if (toDayKey(session.startedAt) !== dateKey) continue
    if (first === null || session.startedAt < first) first = session.startedAt
  }
  return first
}
