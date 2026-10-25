/**
 * 확인 문제 결과를 "변형 문제" 의 원본으로 서버에 보냅니다. (BE docs/VARIANT-SPEC.md 5-1, 이슈 #650)
 *   틀린 문제 → 서버가 오답으로 저장해 매일 변형 문제(검증)로 다시 냅니다.
 *   맞힌 문제 → 서버가 저장해 두었다가 주마다 심화 문제로 냅니다.
 *
 * 규칙
 *   - 시연용 예시 문제(isDemo)는 보내지 않습니다.
 *   - 찍은 것 같다고 본 결과(guessed)는 틀린 문제만 보냅니다. (찍어서 맞힌 것은 '아는 문제' 로 치지 않음)
 *   - 고르지 않은 문제(choiceIndex -1)는 뺍니다. 보낼 문제가 없으면 부르지 않습니다.
 *   - 화면은 기다리지 않습니다. 실패해도(아직 배포 전이라 404 등) 조용히 넘어가고, 이 기기의 결과(lib/studyQuiz.ts)는 그대로입니다.
 *   - 맞았는지는 서버가 고른 번호와 정답 번호로 다시 셉니다. 그래서 판정은 보내지 않고 두 번호를 보냅니다.
 */
import { api } from '@/lib/api'
import type { QuizResult } from '@/lib/studyQuiz'

/** 서버로 보내는 문제 하나 */
export interface VariantQuizQuestion {
  question: string
  /** 그 문제가 기대는 지문. 없으면 null */
  passage: string | null
  /** 보기 4개 */
  choices: string[]
  /** 정답 보기의 번호 (0 ~ 3) */
  answerIndex: number
  /** 학생이 고른 보기의 번호 (0 ~ 3) */
  chosenIndex: number
}

/** POST /variant/quiz-results 의 본문 */
export interface VariantQuizResultsBody {
  topic: string
  /** 다 푼 시각 (밀리초) */
  solvedAt: number
  guessed: boolean
  questions: VariantQuizQuestion[]
}

// 서버가 한 번에 받는 문제 수 (확인 문제 최대 개수와 같음)
const MAX_QUESTIONS = 5
// 보내기를 기다리는 최대 시간. 화면은 기다리지 않지만, 요청이 끝없이 남지 않게 끊습니다.
const SEND_TIMEOUT_MS = 10_000

/**
 * 결과를 서버로 보낼 모양으로 바꿉니다. 보낼 것이 없으면 null.
 *   toVariantQuizResults({ topic: '수열의 극한', at: 1792841400000, guessed: false, isDemo: false,
 *                          questions: [문제1, 문제2], answers: [{ choiceIndex: 0 }, { choiceIndex: 2 }], … })
 *   -> { topic: '수열의 극한', solvedAt: 1792841400000, guessed: false,
 *        questions: [{ question, passage, choices, answerIndex, chosenIndex: 0 }, { …, chosenIndex: 2 }] }
 */
export function toVariantQuizResults(result: QuizResult): VariantQuizResultsBody | null {
  if (result.isDemo) return null
  const answered: VariantQuizQuestion[] = []
  result.questions.forEach((question, index) => {
    const chosenIndex = result.answers[index]?.choiceIndex ?? -1
    if (chosenIndex < 0 || chosenIndex >= question.choices.length) return
    answered.push({
      question: question.question,
      passage: question.passage ?? null,
      choices: question.choices,
      answerIndex: question.answerIndex,
      chosenIndex,
    })
  })
  const questions = result.guessed
    ? answered.filter((question) => question.chosenIndex !== question.answerIndex)
    : answered
  if (questions.length === 0) return null
  return {
    topic: result.topic,
    solvedAt: result.at,
    guessed: result.guessed,
    questions: questions.slice(0, MAX_QUESTIONS),
  }
}

/**
 * 결과를 서버로 보냅니다. (진짜 로그인일 때만 부르세요)
 * 기다리지 않고 부르는 함수라서, 실패는 여기서 끝냅니다. 이 기기의 결과는 이미 저장돼 있어서 잃는 것이 없습니다.
 */
export async function sendVariantQuizResults(result: QuizResult): Promise<void> {
  const body = toVariantQuizResults(result)
  if (!body) return
  await api<unknown>('/variant/quiz-results', {
    method: 'POST',
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  }).catch(() => {
    // 아직 서버에 이 주소가 없거나(404) 연결이 끊겨도 학생이 할 일은 없습니다. 다음 확인 문제는 또 보냅니다.
  })
}
