/**
 * "공부 신호": 이 기기에만 있는 최근 7일 숫자를 AI 통화 · 채팅 대본에 실어 보냅니다. (2026-10-18)
 * 집중도 점수(lib/focusScore.ts) · 폰 든 횟수 · 확인 문제 결과(lib/studyQuiz.ts)는 아직 서버에 저장하지 않아서,
 * 통화를 걸 때(realtimeCall.ts)와 채팅을 열 때(chatApi.ts) 요청에 studySignals 로 같이 보냅니다.
 * 서버는 이 숫자로 대본 끝에 [공부 신호] 칸을 붙여 "어제 극한 문제 틀렸지?" 처럼 말하게 합니다. (BE #334)
 *
 * React 없이 돌아가는 순수 함수(buildStudySignals)와, 저장소에서 꺼내 부르는 함수(loadStudySignals)가 있습니다.
 * ⚠️ 범위는 서버(BE StudySignals)와 같게 잘라서 보냅니다. 범위를 넘으면 서버가 400 으로 통화를 막기 때문입니다.
 */
import { loadFocusScores, summarizeFocusWeek, type FocusScoreRecord } from '@/lib/focusScore'
import { loadQuizResults, PHOTO_QUIZ_TOPIC, type QuizResult } from '@/lib/studyQuiz'

/** 서버로 보내는 모양. 모르는 값은 null (0 과 "모름" 은 다릅니다) */
export interface StudySignals {
  /** 최근 7일 집중도 평균 (0 ~ 100) */
  focusScoreAvg7d: number | null
  /** 위 평균을 낸 세션 수 (0 ~ 200) */
  focusSessions7d: number | null
  /** 최근 7일 공부 중 폰을 든 횟수 (앱만, 0 ~ 1000). 웹만 쓴 사람은 알 수 없어서 null */
  phoneLifts7d: number | null
  /** 최근 7일 푼 확인 문제 수 · 맞힌 수 (각 0 ~ 500). 찍은 것 같은 결과와 시연용 문제는 뺍니다. */
  quizQuestions7d: number | null
  quizCorrect7d: number | null
  /** 최근 7일 틀린 문제의 주제 (그 뒤에 다시 맞힌 것은 뺌). 최근 것부터 3개, 한 개 30자 */
  wrongQuizTopics: string[]
}

// 며칠 치를 볼지
const DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000
// 서버(BE StudySignals)의 범위와 같게 맞춘 값들
const MAX_SESSIONS = 200
const MAX_PHONE_LIFTS = 1000
const MAX_QUIZ_COUNT = 500
const MAX_TOPICS = 3
const MAX_TOPIC_LENGTH = 30

/** 0 ~ max 사이로 자르기 */
function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(0, Math.round(value)))
}

/** 최근 7일 앱에서 잰 세션들의 폰 든 횟수 합. 앱에서 잰 세션('lift')이 없으면 null */
function countPhoneLifts(recent: FocusScoreRecord[]): number | null {
  const fromApp = recent.filter((record) => record.measuredBy === 'lift')
  if (fromApp.length === 0) return null
  return clamp(
    fromApp.reduce((sum, record) => sum + record.count, 0),
    MAX_PHONE_LIFTS,
  )
}

/**
 * 틀린 문제의 주제들. 같은 문제를 나중에 다시 풀어 맞혔으면 뺍니다. 최근 것부터, 같은 주제는 한 번만.
 * '사진 속 공부 내용' 처럼 주제를 모르는 결과는 뺍니다. (AI 가 꺼내도 뜻이 없어서)
 */
function findWrongTopics(results: QuizResult[]): string[] {
  const topics: string[] = []
  // 최근 것부터 보려고 뒤집습니다. (results 는 오래된 것부터)
  const newestFirst = [...results].sort((a, b) => b.at - a.at)
  for (const result of newestFirst) {
    const topic = result.topic.replace(/\s+/g, ' ').trim().slice(0, MAX_TOPIC_LENGTH).trim()
    if (topic === '' || result.topic === PHOTO_QUIZ_TOPIC || topics.includes(topic)) continue
    const hasStillWrong = result.questions.some((question, index) => {
      const isWrong = result.answers[index]?.choiceIndex !== question.answerIndex
      if (!isWrong) return false
      // 이 결과보다 나중에 같은 문제를 맞힌 적이 있으면 "다시 맞힌 것"
      const isRetriedRight = results.some(
        (later) =>
          later.at > result.at &&
          later.questions.some(
            (laterQuestion, laterIndex) =>
              laterQuestion.question === question.question &&
              later.answers[laterIndex]?.choiceIndex === laterQuestion.answerIndex,
          ),
      )
      return !isRetriedRight
    })
    if (hasStillWrong) topics.push(topic)
    if (topics.length === MAX_TOPICS) break
  }
  return topics
}

/**
 * 기기에 저장된 기록으로 공부 신호를 만듭니다. 보낼 값이 하나도 없으면 null (요청에 넣지 않음)
 *
 *   buildStudySignals({ focusScores: [점수 82 · 폰 2번(앱) …], quizResults: [미적분 3문제 중 2개 …], now })
 *     -> { focusScoreAvg7d: 82, focusSessions7d: 9, phoneLifts7d: 12,
 *          quizQuestions7d: 15, quizCorrect7d: 11, wrongQuizTopics: ['수열의 극한'] }
 *   기록이 하나도 없으면 -> null
 */
export function buildStudySignals(input: {
  focusScores: FocusScoreRecord[]
  quizResults: QuizResult[]
  now: number
}): StudySignals | null {
  const weekAgo = input.now - DAYS * DAY_MS
  const isRecent = (at: number) => at > weekAgo && at <= input.now

  // 집중도: 통계 탭과 같은 계산(공부한 시간 전체 중 딴짓이 아닌 비율)
  const week = summarizeFocusWeek(input.focusScores, input.now)
  const recentFocus = input.focusScores.filter((record) => isRecent(record.startedAt))

  // 확인 문제: 시연용 문제와 찍은 것 같은 결과는 정답률에서 뺍니다.
  const counted = input.quizResults.filter(
    (result) => isRecent(result.at) && !result.isDemo && !result.guessed,
  )
  const questions = counted.reduce((sum, result) => sum + result.questions.length, 0)
  const correct = counted.reduce(
    (sum, result) => sum + Math.min(result.correct, result.questions.length),
    0,
  )
  const quizQuestions7d = counted.length === 0 ? null : clamp(questions, MAX_QUIZ_COUNT)
  // 맞힌 수는 푼 수보다 클 수 없습니다. (서버가 400 으로 막음)
  const quizCorrect7d =
    quizQuestions7d === null ? null : Math.min(quizQuestions7d, clamp(correct, MAX_QUIZ_COUNT))

  const signals: StudySignals = {
    focusScoreAvg7d: week.average,
    focusSessions7d: week.average === null ? null : clamp(week.sessionCount, MAX_SESSIONS),
    phoneLifts7d: countPhoneLifts(recentFocus),
    quizQuestions7d,
    quizCorrect7d,
    wrongQuizTopics: findWrongTopics(counted),
  }
  const isEmpty =
    signals.focusScoreAvg7d === null &&
    signals.phoneLifts7d === null &&
    signals.quizQuestions7d === null &&
    signals.wrongQuizTopics.length === 0
  return isEmpty ? null : signals
}

/** 이 기기에 저장된 기록으로 공부 신호를 만듭니다. 저장된 값이 깨져 있어도 통화는 걸리게 null 을 돌려줍니다. */
export function loadStudySignals(now: number = Date.now()): StudySignals | null {
  try {
    return buildStudySignals({
      focusScores: loadFocusScores(),
      quizResults: loadQuizResults(),
      now,
    })
  } catch {
    return null
  }
}
