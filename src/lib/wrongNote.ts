import type { AnswerCheck } from '@/lib/answerChecksApi'
import { moveDateKey } from '@/lib/date'
import { OTHER_SUBJECT, subjectNameOf } from '@/lib/quizReport'
import { wrongForReview, type QuizResult } from '@/lib/studyQuiz'
import type { Card, Subject } from '@/types'

/**
 * 오답노트 · 주간 오답 테스트에 쓰는 "틀린 문제 목록" 을 만드는 함수들입니다. (BE #401, 2026-10-26)
 * 화면은 pages/WrongNotePage.tsx(/records/wrong-note) 와 pages/WrongTestPage.tsx(/records/wrong-test) 입니다.
 * React 없이 돌아가는 순수 함수라서 lib/ 에 둡니다.
 *
 * ■ 틀린 문제는 두 곳에서 모읍니다.
 *   ① 사진 채점 (서버, lib/answerChecksApi.ts)
 *      - 결과가 '틀림'(WRONG)인 문제만. '애매'(UNSURE)는 틀렸는지 몰라서 넣지 않습니다.
 *      - 정답 = 학생이 직접 적은 정답, 없으면 AI 가 푼 답 (correctAnswer ?? aiAnswer)
 *      - 예전 기록은 문제 글(questionText)이 없습니다. 오답노트에는 번호만 보여 주고, 테스트에는 넣지 않습니다.
 *   ② 채팅 확인 문제 (이 기기, lib/studyQuiz.ts)
 *      - 고른 답이 정답과 다른 문제만.
 *      - 틀린 뒤에 다시 풀어서 맞힌 문제는 뺍니다. (wrongForReview 와 같은 규칙: 문제 글이 같으면 같은 문제)
 *      - AI 대신 낸 시연용 예시 문제(isDemo)는 테스트 로그인일 때만 넣습니다. (진짜 로그인이면 문제 풀이 리포트처럼 뺍니다)
 *
 * ■ 같은 문제 글은 한 번만 넣습니다. (가장 최근에 틀린 것 하나)
 * ■ 과목은 문제 풀이 리포트와 같은 규칙(subjectNameOf)으로 정합니다. 모르면 '기타' 입니다.
 */

/** 주간 오답 테스트에 넣는 문제 수의 최대값 (시험지 한두 장에 들어갈 만큼) */
export const WRONG_TEST_MAX = 20

/** 어디서 틀린 문제인지. photo = 사진 채점 · quiz = 채팅 확인 문제 */
export type WrongSource = 'photo' | 'quiz'

/** 틀린 문제 하나 */
export interface WrongItem {
  /** 화면 목록의 key 로 쓰는 이름 (겹치지 않음) */
  key: string
  source: WrongSource
  /** 틀린 날 'YYYY-MM-DD' (하루의 기준은 새벽 4시) */
  date: string
  /** 과목 이름 (예: '수학'). 모르면 '기타' */
  subject: string
  /** 단원 (예: '다항식'). 모르면 null */
  unit: string | null
  /** 문제 글. 예전 사진 채점 기록이면 null */
  questionText: string | null
  /** 확인 문제의 보기 4개. 사진 채점이면 null */
  choices: string[] | null
  /** 확인 문제의 정답 보기 번호 (0 ~ 3). 사진 채점이면 null */
  answerIndex: number | null
  /** 내가 적은(고른) 답. 모르면 null */
  myAnswer: string | null
  /** 정답. 모르면 null */
  correctAnswer: string | null
  /** 해설 (확인 문제만). 없으면 null */
  explanation: string | null
  /** 사진 채점의 문제 번호 (예: '3'). 확인 문제면 null */
  number: string | null
}

export interface WrongNoteInput {
  /** 사진 채점 결과 (서버에서 받은 것) */
  checks: AnswerCheck[]
  /** 이 기기의 확인 문제 결과 (loadQuizResults) */
  quizResults: QuizResult[]
  /** 확인 문제의 과목을 카드 제목으로도 찾으려고 받습니다. */
  cards: Card[]
  subjects: Subject[]
  /** 이 날부터 (포함) */
  from: string
  /** 이 날까지 (포함) */
  to: string
  todayKey: string
  /** true 면 시연용 예시 문제(isDemo)도 넣습니다. 테스트 로그인일 때 true */
  includeDemo: boolean
}

/** 사진 채점에서 틀린 문제들 (최신 결과부터) */
function photoWrongItems(input: WrongNoteInput): WrongItem[] {
  const checks = input.checks
    .filter((check) => check.date >= input.from && check.date <= input.to)
    // 같은 날이면 나중에 찍은 것이 위로 오게 합니다.
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const items: WrongItem[] = []
  for (const check of checks) {
    const subject = subjectNameOf(check.subjectText ?? '', input.subjects)
    for (const item of check.items) {
      if (item.result !== 'WRONG') continue
      items.push({
        key: `photo-${check.id}-${item.id}`,
        source: 'photo',
        date: check.date,
        subject,
        unit: item.unit,
        questionText: item.questionText,
        choices: null,
        answerIndex: null,
        myAnswer: item.myAnswer,
        correctAnswer: item.correctAnswer ?? item.aiAnswer,
        explanation: null,
        number: item.number,
      })
    }
  }
  return items
}

/** 확인 문제에서 틀린 문제들 (최신 결과부터). 틀린 뒤에 다시 풀어서 맞힌 문제는 뺍니다. */
function quizWrongItems(input: WrongNoteInput): WrongItem[] {
  const results = input.quizResults.filter((result) => input.includeDemo || !result.isDemo)

  // from 부터 오늘까지 "며칠 전" 목록 (0 = 오늘, 1 = 어제 …)
  const daysAgo: number[] = []
  for (let days = 0; moveDateKey(input.todayKey, -days) >= input.from; days++) daysAgo.push(days)
  // 아직 못 맞힌 틀린 문제의 글. 복습 알림과 같은 함수(wrongForReview)로 고릅니다.
  const stillWrong = wrongForReview(results, input.todayKey, daysAgo).map(
    (question) => question.question,
  )

  // 문제 글 → 처음 풀 때의 과목 · 단원.
  // '어제 틀린 문제' 처럼 다시 낸 문제 묶음은 주제에 과목이 없어서, 처음 풀 때의 것을 씁니다. (lib/quizReport.ts 와 같은 규칙)
  const firstSeen = new Map<string, { subject: string; unit: string }>()
  for (const result of [...results].sort((a, b) => a.at - b.at)) {
    const card = input.cards.find((item) => item.id === result.cardId)
    const subject = subjectNameOf(`${result.topic} ${card?.title ?? ''}`, input.subjects)
    // 단원은 AI 가 정한 것, 없으면 문제를 낼 때 적은 주제 (문제 풀이 리포트와 같음)
    const unit = result.unit ?? result.topic.trim()
    for (const question of result.questions) {
      if (!firstSeen.has(question.question)) firstSeen.set(question.question, { subject, unit })
    }
  }

  const items: WrongItem[] = []
  const sorted = results
    .filter((result) => result.date >= input.from && result.date <= input.to)
    .sort((a, b) => b.at - a.at)
  for (const result of sorted) {
    result.questions.forEach((question, index) => {
      const choiceIndex = result.answers[index]?.choiceIndex ?? -1
      // -1 은 안 푼 문제입니다. 맞힌 문제 · 이미 다시 풀어 맞힌 문제도 넣지 않습니다.
      if (choiceIndex < 0 || choiceIndex === question.answerIndex) return
      if (!stillWrong.includes(question.question)) return
      const first = firstSeen.get(question.question)
      items.push({
        key: `quiz-${result.id}-${index}`,
        source: 'quiz',
        date: result.date,
        subject: first?.subject ?? OTHER_SUBJECT,
        unit: first?.unit ?? null,
        questionText: question.question,
        choices: question.choices,
        answerIndex: question.answerIndex,
        myAnswer: question.choices[choiceIndex] ?? null,
        correctAnswer: question.choices[question.answerIndex] ?? null,
        explanation: question.explanation,
        number: null,
      })
    })
  }
  return items
}

/**
 * from ~ to 동안 틀린 문제를 모두 모읍니다. 최근에 틀린 것부터.
 * 같은 문제 글은 가장 최근 것 하나만 남깁니다. (문제 글이 없는 예전 사진 채점 기록은 모두 남깁니다)
 *
 *   buildWrongItems({ checks, quizResults, cards, subjects, from: '2026-09-29', to: '2026-10-26', … })
 *     -> [{ source: 'quiz', date: '2026-10-26', questionText: 'sin 30° 의 값은?', … }, …]
 */
export function buildWrongItems(input: WrongNoteInput): WrongItem[] {
  const all = [...quizWrongItems(input), ...photoWrongItems(input)]
  // 날짜가 늦은 것부터. 같은 날이면 위에서 정한 순서(각자 최신 것부터)를 그대로 둡니다.
  all.sort((a, b) => b.date.localeCompare(a.date))

  const seenTexts: string[] = []
  return all.filter((item) => {
    if (item.questionText === null) return true
    if (seenTexts.includes(item.questionText)) return false
    seenTexts.push(item.questionText)
    return true
  })
}

/**
 * 주간 오답 테스트에 낼 문제들. 문제 글이 있는 것만, WRONG_TEST_MAX(20)개까지.
 * 순서: 확인 문제(4지선다, 자동 채점)를 먼저, 그다음 사진 채점 문제(직접 채점).
 *       각자 안에서는 틀린 날이 이른 것부터 → 한 주를 되짚어 가듯 풀게 합니다.
 * 20개가 넘으면 뒤쪽(사진 채점의 늦은 날)부터 빠집니다.
 *
 *   testableWrongItems(그 주의 틀린 문제들) -> [확인 문제(월 → 일)…, 사진 채점(월 → 일)…]
 */
export function testableWrongItems(items: WrongItem[]): WrongItem[] {
  const withText = items.filter((item) => item.questionText !== null)
  const byDate = (a: WrongItem, b: WrongItem) => a.date.localeCompare(b.date)
  const quiz = withText.filter((item) => item.source === 'quiz').sort(byDate)
  const photo = withText.filter((item) => item.source === 'photo').sort(byDate)
  return [...quiz, ...photo].slice(0, WRONG_TEST_MAX)
}

/** 과목 하나에 모인 틀린 문제 수와 단원별 수 */
export interface WrongGroup {
  subject: string
  count: number
  /** 단원별 틀린 문제 수. 많은 단원부터 (단원을 모르는 문제는 세지 않음) */
  units: { name: string; count: number }[]
}

/**
 * 틀린 문제를 과목별 · 단원별로 셉니다. 많은 과목부터.
 *
 *   groupWrongItems(목록) -> [{ subject: '수학', count: 5, units: [{ name: '삼각함수', count: 3 }, …] }, …]
 */
export function groupWrongItems(items: WrongItem[]): WrongGroup[] {
  const groups: WrongGroup[] = []
  for (const item of items) {
    let group = groups.find((saved) => saved.subject === item.subject)
    if (!group) {
      group = { subject: item.subject, count: 0, units: [] }
      groups.push(group)
    }
    group.count += 1
    if (item.unit === null) continue
    const unit = group.units.find((saved) => saved.name === item.unit)
    if (unit) unit.count += 1
    else group.units.push({ name: item.unit, count: 1 })
  }
  for (const group of groups) group.units.sort((a, b) => b.count - a.count)
  return groups.sort((a, b) => b.count - a.count)
}
