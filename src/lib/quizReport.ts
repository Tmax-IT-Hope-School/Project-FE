import type { AnswerCheck } from '@/lib/answerChecksApi'
import { moveDateKey, toDayKey } from '@/lib/date'
import { mockSubjects } from '@/lib/mock'
import type { ServerQuizCount } from '@/lib/quizResultsApi'
import type { QuizResult } from '@/lib/studyQuiz'
import { getStudyMs } from '@/lib/studyTime'
import type { Card, StudySession, Subject } from '@/types'

/**
 * 문제 풀이 주간 리포트(기록 › 문제 풀이 리포트)의 숫자를 계산하는 함수들입니다. 화면은 pages/QuizReportPage.tsx 입니다.
 * React 없이 돌아가는 순수 함수라서 lib/ 에 둡니다. (2026-10-24)
 *
 * 문제 풀이 기록 세 가지를 합쳐서 셉니다.
 *   ① 채팅 확인 문제 (lib/studyQuiz.ts, 이 기기에 저장) — 문제마다 고른 답 · 걸린 시간이 있습니다.
 *   ② 사진 채점 (lib/answerChecksApi.ts, 서버에 저장) — 문제집 사진 한 장의 문제마다 맞음 · 틀림 · 애매가 있습니다.
 *   ③ 서버에만 있는 확인 문제 (lib/quizResultsApi.ts, 다른 기기에서 푼 것 등) — 과목 · 단원 · 날짜별 맞은 수만 있습니다.
 *      그래서 풀이 시간 · 다시 푼 것인지 · 찍은 것 같았는지를 몰라서, 모두 "처음 푼 문제" 로 점수에만 넣습니다. (serverAttempts)
 *
 * ■ 세는 규칙
 *   - 점수 = 그날 "처음 푼" 문제의 정답률 (100점 만점).
 *     같은 확인 문제(문제 글이 같은 것)를 다시 풀어 맞힌 것은 점수에 넣지 않고 "오답 다시 풀기" 로 따로 셉니다.
 *   - 확인 문제: 시연용 예시 문제(isDemo)는 세지 않고, 찍은 것 같다고 본 묶음(guessed)은 점수에 넣지 않습니다.
 *   - 사진 채점: 맞음 · 틀림만 셉니다. 애매는 맞았는지 몰라서 뺍니다. 풀이 시간은 없습니다.
 *   - 과목: 확인 문제는 카드에 과목 칸이 없어서 주제 · 카드 제목 글로, 사진 채점은 AI 가 읽은 과목 글로 정합니다. (subjectNameOf)
 *   - 단원: 결과에 단원이 따로 없어서, 확인 문제는 문제를 낼 때 적은 주제(보통 카드 제목)를, 사진 채점은 '사진 채점' 한 칸으로 봅니다.
 *   - 날짜: 결과에 저장된 날짜(새벽 4시 기준)를 그대로 씁니다. 공부 시간도 lib/date.ts 의 toDayKey 로 셉니다.
 */

/** 과목을 알 수 없는 문제 · 공부를 모으는 칸 */
export const OTHER_SUBJECT = '기타'
/** 이 시간(밀리초) 안에 고르고 틀렸으면 "빨리 풀고 틀림" (실수일 수 있음) */
export const FAST_WRONG_MS = 10_000
/** 정답률(%)이 이보다 낮고 2문제 이상 풀었으면 취약 단원 */
export const WEAK_RATE = 60
/** 그래프 · 표에 쓰는 요일 이름 (월요일부터) */
export const WEEKDAY_LABELS = ['월', '화', '수', '목', '금', '토', '일']
/** 사진 채점 문제는 단원을 몰라서 이 이름 한 칸에 모읍니다. */
export const PHOTO_UNIT = '사진 채점'

/** 글에 과목 이름이 없을 때 보는 교과 낱말 → 과목. 위에 있는 과목부터 봅니다. (예: '미적분 3단원' → 수학) */
const SUBJECT_WORDS: { name: string; words: string[] }[] = [
  { name: '국어', words: ['국어', '문학', '비문학', '독서', '문법', '화법', '작문'] },
  {
    name: '수학',
    words: ['수학', '미적분', '확률', '통계', '기하', '수열', '함수', '극한', '방정식'],
  },
  { name: '영어', words: ['영어', '영단어', '영문법', '단어장', '독해', '듣기'] },
  { name: '한국사', words: ['한국사', '역사'] },
  { name: '사회', words: ['사회', '경제', '정치', '윤리', '지리', '세계사'] },
  { name: '과학', words: ['과학', '물리', '화학', '생명', '생물'] },
]

/** 단원 하나를 푼 결과 (하루 또는 한 주) */
export interface UnitStat {
  /** 단원 이름 (지금은 문제를 낼 때 적은 주제) */
  name: string
  total: number
  correct: number
  /** 정답률 0 ~ 100 (반올림) */
  rate: number
  /** 문제 하나에 걸린 평균 시간 (초, 반올림). 시간을 잰 문제가 없으면(사진 채점만) null */
  seconds: number | null
  /** FAST_WRONG_MS 안에 고르고 틀린 문제 수 */
  fastWrong: number
}

/** 하루(또는 한 주) 동안 처음 푼 문제를 모은 결과 */
export interface QuizStat {
  total: number
  correct: number
  /** 점수 = 정답률 0 ~ 100 (반올림) */
  rate: number
  /** 문제 하나에 걸린 평균 시간 (초, 반올림). 시간을 잰 문제가 없으면(사진 채점만) null */
  seconds: number | null
  /** 단원별 결과. 처음 푼 순서대로 */
  units: UnitStat[]
}

/** 다시 나온 오답을 푼 결과: of 문제 중 fixed 문제를 맞힘 */
export interface ReviewStat {
  fixed: number
  of: number
}

/** 한 과목의 한 주 */
export interface SubjectWeek {
  /** 과목 이름. 과목을 모르면 OTHER_SUBJECT */
  name: string
  /** 월 ~ 일 7칸. 그날 처음 푼 문제가 없으면 null */
  days: (QuizStat | null)[]
  /** 월 ~ 일 7칸. 그날 다시 나온 오답을 푼 결과 */
  reviews: ReviewStat[]
  /** 월 ~ 일 7칸. 그날 이 과목을 공부한 시간 (분) */
  minutes: number[]
  /** 한 주 합계. 처음 푼 문제가 없으면 null */
  week: QuizStat | null
  /** 지난주 점수. 지난주에 처음 푼 문제가 없으면 null */
  lastWeekRate: number | null
}

/** 문제 하나를 처음 푼 기록 */
interface Attempt {
  date: string
  subject: string
  unit: string
  correct: boolean
  /** 고르기까지 걸린 시간. 사진 채점은 몰라서 null */
  ms: number | null
}

/** 전에 틀렸던 문제를 다시 푼 기록 */
interface Retry {
  date: string
  subject: string
  correct: boolean
}

/**
 * 그 날짜가 속한 주의 월요일을 돌려줍니다.
 *
 *   weekStartOf('2026-10-24') -> '2026-10-19'  (토요일 → 그 주 월요일)
 *   weekStartOf('2026-10-19') -> '2026-10-19'
 */
export function weekStartOf(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  // getDay() 는 일요일 0 ~ 토요일 6 입니다. 월요일에서 며칠 지났는지(월 0 ~ 일 6)로 바꿉니다.
  const daysFromMonday = (new Date(year, month - 1, day).getDay() + 6) % 7
  return moveDateKey(dateKey, -daysFromMonday)
}

/** 월요일부터 7일의 날짜 */
export function weekDates(weekStart: string): string[] {
  return WEEKDAY_LABELS.map((_, index) => moveDateKey(weekStart, index))
}

/**
 * 글(주제 · 카드 제목)이 어느 과목인지. 내 과목 이름이 들어 있으면 그 과목, 아니면 교과 낱말로 찾고, 없으면 '기타'.
 *
 *   subjectNameOf('수학 문제집 6쪽', 내 과목) -> '수학'
 *   subjectNameOf('아침 영단어 20쪽', 내 과목) -> '영어'
 *   subjectNameOf('일요일 한 주 점검', 내 과목) -> '기타'
 */
export function subjectNameOf(text: string, subjects: Subject[]): string {
  const mine = subjects.find((subject) => text.includes(subject.name))
  if (mine) return mine.name
  const byWord = SUBJECT_WORDS.find((item) => item.words.some((word) => text.includes(word)))
  return byWord ? byWord.name : OTHER_SUBJECT
}

/** 공부 기록 하나가 어느 과목인지. 과목을 골라 잰 기록은 그 과목, 카드 타이머 기록은 카드 제목으로 정합니다. */
function sessionSubjectName(session: StudySession, cards: Card[], subjects: Subject[]): string {
  // 시연 데이터의 과목 id 는 서버 과목에 없을 수 있어서 기본 과목에서도 찾습니다. (StatsPage 의 findSubject 와 같음)
  const subject =
    subjects.find((item) => item.id === session.subjectId) ??
    mockSubjects.find((item) => item.id === session.subjectId)
  if (subject) return subject.name
  const card = cards.find((item) => item.id === session.cardId)
  return card ? subjectNameOf(card.title, subjects) : OTHER_SUBJECT
}

/** 결과들을 문제 하나씩 "처음 푼 것" 과 "틀렸던 걸 다시 푼 것" 으로 나눕니다. (오래된 결과부터 봅니다) */
function splitAttempts(results: QuizResult[], cards: Card[], subjects: Subject[]) {
  const firsts: Attempt[] = []
  const retries: Retry[] = []
  // 문제 글 → 처음 풀 때의 과목과 마지막으로 풀었을 때 맞혔는지
  const seen = new Map<string, { subject: string; correct: boolean }>()
  const sorted = results.filter((result) => !result.isDemo).sort((a, b) => a.at - b.at)

  for (const result of sorted) {
    const card = cards.find((item) => item.id === result.cardId)
    const subject = subjectNameOf(`${result.topic} ${card?.title ?? ''}`, subjects)
    result.questions.forEach((question, index) => {
      const answer = result.answers[index]
      if (!answer) return
      const correct = answer.choiceIndex === question.answerIndex
      const before = seen.get(question.question)
      if (!before) {
        // 찍은 것 같은 묶음은 점수에 넣지 않습니다. (그래도 "본 문제" 로 남겨서, 다시 풀면 오답 다시 풀기로 셉니다)
        if (!result.guessed) {
          firsts.push({
            date: result.date,
            subject,
            unit: result.topic.trim(),
            correct,
            ms: answer.ms,
          })
        }
        seen.set(question.question, { subject, correct })
      } else {
        // 다시 푼 문제는 처음 풀 때의 과목으로 셉니다. ('어제 틀린 문제' 처럼 주제가 달라도)
        if (!before.correct) retries.push({ date: result.date, subject: before.subject, correct })
        seen.set(question.question, { subject: before.subject, correct })
      }
    })
  }
  return { firsts, retries }
}

/** 사진 채점 결과를 문제 하나씩 "처음 푼 것" 으로 바꿉니다. 애매(UNSURE)는 뺍니다. */
function photoAttempts(checks: AnswerCheck[], subjects: Subject[]): Attempt[] {
  return checks.flatMap((check) => {
    const subject = subjectNameOf(check.subjectText ?? '', subjects)
    return check.items
      .filter((item) => item.result !== 'UNSURE')
      .map((item) => ({
        date: check.date,
        subject,
        unit: PHOTO_UNIT,
        correct: item.result === 'CORRECT',
        ms: null,
      }))
  })
}

/**
 * 서버에만 있는 확인 문제 결과(다른 기기에서 푼 것 등)를 문제 하나씩 "처음 푼 것" 으로 바꿉니다.
 * 서버에는 과목 · 단원 · 날짜별 맞은 수만 있어서, 맞은 수만큼 "맞음" · 나머지는 "틀림" 으로 둡니다.
 *   - 과목은 서버의 과목 이름, 단원은 AI 가 정한 단원입니다. (이 기기의 결과는 문제를 낼 때 적은 주제가 단원)
 *   - 풀이 시간을 몰라서(null) 평균 시간 · "빨리 풀고 틀림" 에는 들어가지 않습니다.
 */
function serverAttempts(counts: ServerQuizCount[], subjects: Subject[]): Attempt[] {
  return counts.flatMap((count) => {
    const subject = subjectNameOf(count.subjectName, subjects)
    return Array.from({ length: count.total }, (_, index) => ({
      date: count.date,
      subject,
      unit: count.unit,
      correct: index < count.correct,
      ms: null,
    }))
  })
}

/** 처음 푼 기록들의 개수 · 정답률 · 평균 시간 (시간은 잰 문제만으로 냅니다) */
function countUp(attempts: Attempt[]) {
  const correct = attempts.filter((attempt) => attempt.correct).length
  const timed = attempts.flatMap((attempt) => (attempt.ms === null ? [] : [attempt.ms]))
  const totalMs = timed.reduce((sum, ms) => sum + ms, 0)
  return {
    total: attempts.length,
    correct,
    rate: Math.round((correct / attempts.length) * 100),
    seconds: timed.length > 0 ? Math.round(totalMs / timed.length / 1000) : null,
  }
}

/** 처음 푼 기록들을 단원별로 묶어 하루(또는 한 주) 결과로 만듭니다. 기록이 없으면 null */
function toStat(attempts: Attempt[]): QuizStat | null {
  if (attempts.length === 0) return null
  const byUnit = new Map<string, Attempt[]>()
  for (const attempt of attempts) {
    byUnit.set(attempt.unit, [...(byUnit.get(attempt.unit) ?? []), attempt])
  }
  const units = [...byUnit].map(([name, list]) => ({
    name,
    ...countUp(list),
    fastWrong: list.filter(
      (attempt) => !attempt.correct && attempt.ms !== null && attempt.ms < FAST_WRONG_MS,
    ).length,
  }))
  return { ...countUp(attempts), units }
}

/**
 * 과목마다 한 주의 결과를 만듭니다. 그 주에 문제를 푼 과목만 돌려줍니다. (내 과목 순서, '기타' 는 맨 뒤)
 *
 *   buildQuizWeeks({ results, answerChecks, serverCounts, sessions, cards, subjects, weekStart: '2026-10-19' })
 *     -> [{ name: '수학', days: [월 ~ 일], minutes: [50, 0, …], week: {…}, lastWeekRate: 58, … }, …]
 *
 * answerChecks · serverCounts 에는 이번 주와 지난주(지난주 점수) 것을 넣습니다.
 * serverCounts 는 서버에만 있는 확인 문제 결과입니다. 테스트 로그인 · 못 받았으면 빈 목록을 넣습니다.
 */
export function buildQuizWeeks(input: {
  results: QuizResult[]
  answerChecks: AnswerCheck[]
  serverCounts: ServerQuizCount[]
  sessions: StudySession[]
  cards: Card[]
  subjects: Subject[]
  weekStart: string
}): SubjectWeek[] {
  const { results, answerChecks, serverCounts, sessions, cards, subjects, weekStart } = input
  const split = splitAttempts(results, cards, subjects)
  const firsts = [
    ...split.firsts,
    ...photoAttempts(answerChecks, subjects),
    ...serverAttempts(serverCounts, subjects),
  ]
  const retries = split.retries
  const dates = weekDates(weekStart)
  const lastWeekDates = weekDates(moveDateKey(weekStart, -7))
  // 공부 기록은 이번 주 것만 날짜 · 과목을 한 번씩 정해 둡니다.
  const weekSessions = sessions
    .map((session) => ({ session, date: toDayKey(session.startedAt) }))
    .filter((item) => dates.includes(item.date))
    .map((item) => ({ ...item, subject: sessionSubjectName(item.session, cards, subjects) }))
  const names = [
    ...new Set([
      ...subjects.map((subject) => subject.name),
      ...SUBJECT_WORDS.map((item) => item.name),
      OTHER_SUBJECT,
    ]),
  ]

  const weeks: SubjectWeek[] = []
  for (const name of names) {
    const mine = firsts.filter((attempt) => attempt.subject === name)
    const thisWeek = mine.filter((attempt) => dates.includes(attempt.date))
    const reviews = dates.map((date) => {
      const list = retries.filter((retry) => retry.subject === name && retry.date === date)
      return { fixed: list.filter((retry) => retry.correct).length, of: list.length }
    })
    if (thisWeek.length === 0 && reviews.every((review) => review.of === 0)) continue

    // 밀리초로 모두 더한 뒤 마지막에 한 번만 분으로 반올림합니다. (lib/dailyRecords.ts 와 같은 규칙)
    const minutes = dates.map((date) => {
      const ms = weekSessions
        .filter((item) => item.date === date && item.subject === name)
        .reduce((sum, item) => sum + getStudyMs(item.session), 0)
      return Math.round(ms / 60000)
    })
    const lastWeek = toStat(mine.filter((attempt) => lastWeekDates.includes(attempt.date)))
    weeks.push({
      name,
      days: dates.map((date) => toStat(thisWeek.filter((attempt) => attempt.date === date))),
      reviews,
      minutes,
      week: toStat(thisWeek),
      lastWeekRate: lastWeek ? lastWeek.rate : null,
    })
  }
  return weeks
}

// ---- 비교 · 판단 ----

/** 취약 단원인지: 2문제 이상 풀었고 정답률이 WEAK_RATE 보다 낮음 */
export function isWeakUnit(unit: UnitStat): boolean {
  return unit.total >= 2 && unit.rate < WEAK_RATE
}

/** 다시 나온 오답 결과를 모두 더합니다. */
export function sumReviews(reviews: ReviewStat[]): ReviewStat {
  return {
    fixed: reviews.reduce((sum, review) => sum + review.fixed, 0),
    of: reviews.reduce((sum, review) => sum + review.of, 0),
  }
}

/**
 * index 번째 날과 비교할 점수: 바로 앞에 문제를 푼 날. 이번 주에 없으면 지난주 점수. 둘 다 없으면 null
 *
 *   previousScore(수학 주, 4) -> { label: '목요일', rate: 50 }
 */
export function previousScore(
  week: SubjectWeek,
  index: number,
): { label: string; rate: number } | null {
  for (let day = index - 1; day >= 0; day--) {
    const stat = week.days[day]
    if (stat) return { label: `${WEEKDAY_LABELS[day]}요일`, rate: stat.rate }
  }
  return week.lastWeekRate === null ? null : { label: '지난주', rate: week.lastWeekRate }
}

/** 이 단원을 index 번째 날 전에 마지막으로 푼 날(요일)과 그때 정답률. 이번 주에 처음이면 null */
export function previousUnitRate(
  week: SubjectWeek,
  index: number,
  unitName: string,
): { label: string; rate: number } | null {
  for (let day = index - 1; day >= 0; day--) {
    const unit = week.days[day]?.units.find((item) => item.name === unitName)
    if (unit) return { label: WEEKDAY_LABELS[day], rate: unit.rate }
  }
  return null
}

/** 이번 주에 이 단원을 처음 · 마지막으로 푼 날(요일)과 그때 정답률. 푼 적이 없으면 null */
export function unitSpan(week: SubjectWeek, unitName: string) {
  const seen: { label: string; rate: number }[] = []
  week.days.forEach((stat, day) => {
    const unit = stat?.units.find((item) => item.name === unitName)
    if (unit) seen.push({ label: WEEKDAY_LABELS[day], rate: unit.rate })
  })
  if (seen.length === 0) return null
  return { first: seen[0], last: seen[seen.length - 1], count: seen.length }
}

// ---- 한 줄 정리: 숫자는 위 함수들이 계산하고, 여기서는 규칙으로 문장만 만듭니다 ----

/** 받침이 있으면 withFinal, 없으면 withoutFinal 을 붙입니다. (은/는, 이/가) 한글로 안 끝나면 '은(는)' 처럼 둘 다 씁니다. */
function attachParticle(word: string, withFinal: string, withoutFinal: string): string {
  const code = word.charCodeAt(word.length - 1)
  if (code < 0xac00 || code > 0xd7a3) return `${word}${withFinal}(${withoutFinal})`
  return word + ((code - 0xac00) % 28 === 0 ? withoutFinal : withFinal)
}

/** "목요일보다 28점 올랐어." 처럼 앞과 비교하는 문장 */
function compareSentence(rate: number, previous: { label: string; rate: number }): string {
  const diff = rate - previous.rate
  if (diff > 0) return `${previous.label}보다 ${diff}점 올랐어.`
  if (diff < 0) return `${previous.label}보다 ${-diff}점 내려갔어.`
  return `${previous.label}랑 같은 점수야.`
}

/** 요일 하나를 고른 화면의 한 줄 정리 */
export function daySummary(week: SubjectWeek, index: number): string {
  const stat = week.days[index]
  if (!stat) return ''
  const previous = previousScore(week, index)
  const parts = [previous ? compareSentence(stat.rate, previous) : `오늘은 ${stat.rate}점이야.`]

  for (const unit of stat.units) {
    const before = previousUnitRate(week, index, unit.name)
    if (before && unit.rate - before.rate >= 25) {
      parts.push(
        `${attachParticle(unit.name, '이', '가')} ${before.rate}%에서 ${unit.rate}%로 올랐어.`,
      )
      break
    }
  }

  const weak = stat.units.filter(isWeakUnit).sort((a, b) => a.rate - b.rate)[0]
  const fast = stat.units.find((unit) => unit.fastWrong > 0)
  if (weak && weak.fastWrong > 0) {
    parts.push(`${attachParticle(weak.name, '은', '는')} 빨리 풀다 틀렸어. 끝까지 읽고 고르자.`)
  } else if (weak) {
    parts.push(
      `${attachParticle(weak.name, '은', '는')} ${weak.total}문제 중 ${weak.correct}개라 다시 나올 거야.`,
    )
  } else if (fast) {
    parts.push(`${fast.name}에서 빨리 풀다 틀린 게 있어. 끝까지 읽고 고르자.`)
  } else if (stat.correct === stat.total) {
    parts.push('틀린 문제 없이 다 맞혔어.')
  }
  return parts.join(' ')
}

/** 요일을 안 고른(전체 평균) 화면의 한 줄 정리 */
export function weekSummary(week: SubjectWeek): string {
  if (!week.week) return ''
  const parts = [
    week.lastWeekRate === null
      ? `이번 주 평균은 ${week.week.rate}점이야.`
      : `이번 주 평균 ${week.week.rate}점, ${compareSentence(week.week.rate, { label: '지난주', rate: week.lastWeekRate })}`,
  ]

  let risen = ''
  for (const unit of week.week.units) {
    const span = unitSpan(week, unit.name)
    if (span && span.count > 1 && span.last.rate - span.first.rate >= 25) {
      parts.push(
        `${attachParticle(unit.name, '이', '가')} ${span.first.rate}%에서 ${span.last.rate}%로 올랐어.`,
      )
      risen = unit.name
      break
    }
  }

  const weak = week.week.units
    .filter((unit) => isWeakUnit(unit) && unit.name !== risen)
    .sort((a, b) => a.rate - b.rate)[0]
  const fast = week.week.units
    .filter((unit) => unit.fastWrong >= 3)
    .sort((a, b) => b.fastWrong - a.fastWrong)[0]
  if (weak)
    parts.push(`${attachParticle(weak.name, '은', '는')} 아직 ${weak.rate}%라 다음 주에 더 보자.`)
  else if (fast)
    parts.push(`${fast.name}에서 빨리 풀다 틀린 게 ${fast.fastWrong}번이야. 끝까지 읽고 고르자.`)
  return parts.join(' ')
}
