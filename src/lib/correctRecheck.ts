// 일간 리포트의 "맞은 문제 다시 확인" (2026-10-26, 소유자 목표 흐름 3-2 · 3-4)
//   "맞은 것은 비슷한 유형 문제를 다시 내서 다시 맞히는지 확인"
//   "일간 회고: 그날 사진으로 올린 것 중 맞은 것만 다시 내기 (제대로 알았는지 검증)"
//
// 그날 맞은 문제 몇 개를 고르고, 그 문제 글을 확인 문제 서버(/ai/quiz, similar: true)에 보내
// 같은 유형으로 숫자 · 조건을 바꾼 새 문제를 받습니다. 원래 문제를 그대로 다시 내지는 않습니다.
//
// 어디서 맞은 문제를 모으나요?
//   - 사진 채점: 그날 판정이 "맞음" 이고 AI 가 문제 글을 읽은 문제 (문제 글이 없는 예전 기록은 못 씀)
//   - 확인 문제: 그날 이 기기에서 맞힌 문제. 찍은 것 같다고 본 결과 · 이 기능으로 다시 푼 결과는 뺍니다.
//
// 비슷한 문제는 지금 있는 확인 문제 생성기를 씁니다. 변형 문제 기능(BE #394)은 주마다 심화 세트를 만드는 것이라
// "그날 맞은 문제" 를 바로 확인하는 이 기능과 따로 갑니다.

import type { AnswerCheck } from '@/lib/answerChecksApi'
import { MAX_QUIZ_MATERIAL_LENGTH, MAX_QUIZ_TOPIC_LENGTH, type QuizResult } from '@/lib/studyQuiz'

/** 다시 확인할 때 쓰는 맞은 문제 하나 */
export interface CorrectProblem {
  /** 문제 글 */
  text: string
  /** 단원 (교육과정 영역). 모르면 null */
  unit: string | null
  source: 'photo' | 'quiz'
}

/** 한 번에 몇 문제를 바탕으로 비슷한 문제를 낼지 (서버는 3문제를 냅니다) */
export const MAX_RECHECK_PROBLEMS = 3
/** 이 기능으로 푼 결과의 주제. 이 주제의 결과는 다시 고르지 않습니다. (다시 푼 것을 또 다시 내지 않게) */
export const RECHECK_TOPIC = '맞은 문제 다시 확인'

/**
 * 그날 맞은 문제들 (같은 글은 한 번만). 사진 채점이 먼저, 그다음 확인 문제(최근에 푼 것부터)입니다.
 *
 *   correctProblemsOn(채점 기록들, 확인 문제 결과들, '2026-10-26')
 *     -> [{ text: 'x^2 - 9 를 인수분해하시오.', unit: '다항식', source: 'photo' }, …]
 */
export function correctProblemsOn(
  checks: AnswerCheck[],
  results: QuizResult[],
  dateKey: string,
): CorrectProblem[] {
  const problems: CorrectProblem[] = []
  const add = (problem: CorrectProblem) => {
    if (!problems.some((saved) => saved.text === problem.text)) problems.push(problem)
  }

  for (const check of checks) {
    if (check.date !== dateKey) continue
    for (const item of check.items) {
      if (item.result === 'CORRECT' && item.questionText !== null) {
        add({ text: item.questionText, unit: item.unit, source: 'photo' })
      }
    }
  }

  // 확인 문제 결과는 오래된 것부터 있어서 뒤에서부터 봅니다. (최근에 푼 것부터)
  for (const result of [...results].reverse()) {
    if (result.date !== dateKey || result.guessed || result.topic === RECHECK_TOPIC) continue
    result.questions.forEach((question, index) => {
      if (result.answers[index]?.choiceIndex === question.answerIndex) {
        add({ text: question.question, unit: result.unit, source: 'quiz' })
      }
    })
  }
  return problems
}

/**
 * 서버에 보낼 자료 글. 번호를 붙여 한 줄에 한 문제씩, 2000자를 넘지 않게 자릅니다.
 *   -> '1. [다항식] x^2 - 9 를 인수분해하시오.\n2. x + 3 = 8 일 때 x 의 값은?'
 */
export function recheckMaterial(problems: CorrectProblem[]): string {
  const lines = problems.map((problem, index) => {
    const unit = problem.unit === null ? '' : `[${problem.unit}] `
    return `${index + 1}. ${unit}${problem.text}`
  })
  return lines.join('\n').slice(0, MAX_QUIZ_MATERIAL_LENGTH)
}

/**
 * 서버에 보낼 주제 한 줄. 단원을 알면 단원 이름으로, 모르면 '오늘 맞은 문제' 로 씁니다.
 *   -> '다항식 · 방정식과 부등식 비슷한 문제'
 */
export function recheckTopic(problems: CorrectProblem[]): string {
  const units = [
    ...new Set(problems.map((problem) => problem.unit).filter((unit) => unit !== null)),
  ]
  const head = units.length > 0 ? units.join(' · ') : '오늘 맞은 문제'
  return `${head} 비슷한 문제`.slice(0, MAX_QUIZ_TOPIC_LENGTH)
}
