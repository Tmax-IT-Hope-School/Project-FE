/**
 * 코치 채팅의 "확인 문제(문제 말풍선)" 에 쓰는 함수들입니다. 화면은 pages/CoachPage.tsx 입니다. (2026-10-18 채팅 고도화 2단계)
 * 사용자: "제대로 공부했나 문제를 내 보기도 하면서"
 *
 * - 문제는 서버 AI 가 냅니다. POST /ai/quiz (주제 · 체크리스트 · 붙여 넣은 글 · 사진) → 문제 1 ~ 5개
 *   객관식은 수능처럼 5지선다(①~⑤)가 기본이고, 학생이 주관식을 달라고 하면 단답형(낱말 · 숫자 하나)을 섞습니다. (2026-10-31)
 *   예전에 저장한 4지선다 문제 · 결과도 그대로 읽고 채점합니다.
 * - 채점은 이 기기에서 합니다. (정답이 응답에 같이 옵니다. 시험이 아니라 스스로 확인하는 것이라 괜찮습니다)
 * - 결과는 이 기기에 남깁니다. ('study-quiz-results', 최근 100개) 틀린 문제는 다음 날 코치가 다시 꺼냅니다.
 *   진짜 로그인이면 맞은 수 · 단원만 서버에도 보냅니다. (lib/quizResultsApi.ts · hooks/useQuizResultSync.ts, #653)
 * - 서버가 아직 이 기능을 모르거나(404) · AI 가 꺼졌거나(503) · 오늘 한도를 다 썼으면(429) 시연용 예시 문제를 냅니다.
 *   테스트 로그인(서버 없음)도 시연용 예시입니다. 계획 말풍선(lib/coachPlan.ts)과 같은 방식입니다.
 * ⚠️ 사진은 서버에 보내기만 하고 어디에도 저장하지 않습니다. (lib/photoCards.ts 와 같음)
 */
import { api, ApiError } from '@/lib/api'
import { moveDateKey } from '@/lib/date'
import { loadData, saveData } from '@/lib/storage'

/** 문제 종류: 객관식(보기 고르기) · 주관식 단답형(낱말 · 숫자 하나 쓰기) */
export type QuizKind = 'choice' | 'short'

/** 문제 하나 */
export interface QuizQuestion {
  /** 문제 종류. 없으면 객관식입니다. (2026-10-31 전에 저장한 문제는 모두 객관식) */
  kind?: QuizKind
  question: string
  /** 그 문제를 풀려면 읽어야 하는 글(지문). 없으면 null 이거나 없음 */
  passage?: string | null
  /** 객관식 보기 5개 (예전 문제는 4개). 주관식이면 빈 목록 */
  choices: string[]
  /** 정답 보기의 번호 (0부터). 주관식이면 -1 */
  answerIndex: number
  /** 주관식 정답으로 인정하는 글들 (예: ['3', '삼']). 객관식이면 없음 */
  answers?: string[]
  /** 왜 그게 답인지 한두 문장 */
  explanation: string
}

/** 학생이 문제 하나에 고른 답 */
export interface QuizAnswer {
  /** 고른 보기의 번호 (0부터). 주관식이면 -1 */
  choiceIndex: number
  /** 주관식에 쓴 답. 객관식이면 없음 */
  text?: string
  /** 문제를 보고 고르기까지 걸린 시간 (밀리초) */
  ms: number
}

/**
 * 문제 말풍선의 상태
 *   open       : 푸는 중
 *   guessCheck : 다 풀었는데 찍은 것 같아서 "다시 볼까?" 를 묻는 중
 *   done       : 끝 (결과를 보여 줌)
 *   closed     : 다 안 풀고 새 문제로 넘어감 (접힘)
 */
export type QuizStatus = 'open' | 'guessCheck' | 'done' | 'closed'

/** 문제 말풍선 하나에 담는 문제 묶음 */
export interface CoachQuiz {
  /** 결과를 저장할 때의 이름 (예: 'quiz-1760760000000') */
  id: string
  /** 무엇에 대한 문제인지 (예: '미적분Ⅰ 3단원 수열의 극한') */
  topic: string
  /** 카드로 낸 문제면 그 카드 번호. 아니면 null */
  cardId: string | null
  /** AI 가 정한 큰 단원 (예: '함수'). 모르면 null 이고, 그러면 결과를 서버에 보내지 않습니다. (lib/quizResultsApi.ts) */
  unit: string | null
  questions: QuizQuestion[]
  /** 문제마다 고른 답. 아직 안 풀었으면 null (questions 와 같은 순서) */
  answers: (QuizAnswer | null)[]
  /** 지금 보여 주는 문제 번호 */
  current: number
  /** 지금 문제를 보여 주기 시작한 시각 (걸린 시간을 재는 데 씀) */
  shownAt: number
  /** "한 문제만 다시" 로 다시 푸는 문제 번호. 아니면 null */
  retryIndex: number | null
  /** true 면 다 풀었을 때 찍은 것 같다고 봤던 문제 묶음입니다. (결과 기록에 남김) */
  wasGuessed: boolean
  /** true 면 AI 가 아니라 시연용 예시 문제입니다. */
  isDemo: boolean
  status: QuizStatus
}

/** 이 기기에 남기는 결과 하나. 틀린 문제를 1 · 3 · 7일 뒤 다시 낼 수 있게 문제 전체를 남깁니다. */
export interface QuizResult {
  id: string
  /** 푼 날 'YYYY-MM-DD' (하루의 기준은 새벽 4시) */
  date: string
  /** 다 푼 시각 */
  at: number
  topic: string
  cardId: string | null
  /** AI 가 정한 큰 단원 (예: '함수'). 모르면 null (이 기능 전에 푼 결과 · 시연용 · 틀린 문제 다시) */
  unit: string | null
  questions: QuizQuestion[]
  /** 문제마다 고른 답과 걸린 시간 (questions 와 같은 순서) */
  answers: QuizAnswer[]
  /** 맞은 개수 */
  correct: number
  /** true 면 찍은 것 같다고 본 결과입니다. */
  guessed: boolean
  isDemo: boolean
}

/** 문제를 내 달라는 요청 */
export interface QuizInput {
  /** 무엇에 대한 문제인지 (필수 · 100자) */
  topic: string
  /** 카드의 체크리스트 (5개 · 각 50자까지) */
  checklist: string[]
  /** 학생이 붙여 넣은 필기 · 교과서 글 (2000자까지). 없으면 null */
  material: string | null
  /** 교과서 · 필기 사진 (data URL). 없으면 null */
  image: string | null
  /** 카드로 낸 문제면 그 카드 번호 (서버에는 보내지 않음) */
  cardId: string | null
  /** 문제 수 1 ~ 5. "문제 5개 내 줘" 처럼 말했을 때만 있고, 없으면 QUIZ_COUNT(3)개 */
  count?: number
  /** 그중 주관식 수. 없으면 문제 수로 정합니다. (quizShortCountOf) */
  shortCount?: number
}

/** 문제를 받은 결과 */
export interface QuizReply {
  /** true 면 위기 표현이 감지돼서 문제 대신 상담 전화 한 줄을 보여 줍니다. */
  showHelp: boolean
  /** true 면 공부 자료(사진 · 주제)가 아니라서 문제를 못 냈습니다. */
  notStudy: boolean
  /** 받은 문제. null 이면 못 냈습니다. */
  questions: QuizQuestion[] | null
  /** AI 가 정한 큰 단원 하나 (예: '함수'). 결과를 서버에 저장할 때 씁니다. 못 정했으면 null */
  unit: string | null
  /** true 면 AI 가 아니라 시연용 예시 문제입니다. */
  isDemo: boolean
  /** 시연용 예시를 낸 이유 한 줄 (서버 준비 전 등). 없으면 null */
  notice: string | null
}

/** 한 번에 내는 문제 수 (서버는 1 ~ 5개를 받습니다) */
export const QUIZ_COUNT = 3
/** 한 번에 낼 수 있는 가장 많은 문제 수 (서버 StudyQuizRequest 의 count 최대) */
export const MAX_QUIZ_COUNT = 5
/** 객관식 보기 수. 수능처럼 5지선다입니다. (2026-10-31 사용자 "5지선다 아님?") */
export const QUIZ_CHOICE_COUNT = 5
/** 예전에 저장한 문제 · 아직 바뀌지 않은 서버의 보기 수 (읽을 때만 받아 줌) */
const OLD_CHOICE_COUNT = 4
/** 주관식 정답 표기 한 개의 최대 글자 수 (서버와 같음) */
const MAX_SHORT_ANSWER_LENGTH = 20
/** 주관식에 쓸 수 있는 글자 수 */
export const MAX_SHORT_INPUT_LENGTH = 30

/**
 * 문제 수를 1 ~ 5 로 맞춥니다. 없거나 숫자가 아니면 QUIZ_COUNT(3) 입니다.
 *   quizCountOf(undefined) -> 3 · quizCountOf(7) -> 5 · quizCountOf(0) -> 1
 */
export function quizCountOf(count: number | undefined): number {
  if (count === undefined || !Number.isInteger(count)) return QUIZ_COUNT
  return Math.min(MAX_QUIZ_COUNT, Math.max(1, count))
}
/** 주제 한 줄 · 붙여 넣는 글의 최대 글자 수 (서버와 같음) */
export const MAX_QUIZ_TOPIC_LENGTH = 100
export const MAX_QUIZ_MATERIAL_LENGTH = 2000
/** 사진만 넣고 주제를 안 적었을 때 쓰는 주제 */
export const PHOTO_QUIZ_TOPIC = '사진 속 공부 내용'

/**
 * 찍었는지 보는 규칙 (성향 검사의 "답이 다 같으면 의심" — BE AnswerPattern 과 같은 생각, AI 가 아니라 코드 규칙)
 *   1. 3문제 이상에서 모두 같은 번호를 골랐고, 그중 틀린 게 있음
 *      (다 맞았으면 정답이 마침 같은 번호였던 것이라 의심하지 않습니다. 서버는 정답 위치를 섞지 않습니다)
 *   2. 문제당 평균 2초도 안 걸림 (문제를 읽을 시간도 안 됨)
 */
export const GUESS_MIN_QUESTIONS = 3
export const GUESS_FAST_MS = 2000

/** 결과를 몇 개까지 남길지 */
const MAX_RESULTS = 100
// 저장소 이름 (실제 키는 storage.ts 가 앞에 'study-' 를 붙여서 'study-quiz-results')
const STORAGE_KEY = 'quiz-results'
const QUIZ_TIMEOUT_MS = 30_000
// 사진을 읽느라 오래 걸려서 넉넉하게 기다립니다. (lib/coachPlan.ts 와 같음)
const PHOTO_QUIZ_TIMEOUT_MS = 45_000

// ---- 찍기 감지 · 채점 (순수 함수) ----

/** 주관식 문제인지 */
export function isShortQuestion(question: QuizQuestion): boolean {
  return question.kind === 'short'
}

/**
 * 주관식 답을 견줄 때 쓰는 모양. 전각 글자(３ · Ａ)는 반각으로, 영어는 소문자로 바꾸고,
 * 빈칸과 끝의 문장부호를 없앱니다. 띄어쓰기 · 대소문자가 달라도 같은 답으로 봅니다.
 *
 *   normalizeShortAnswer(' Photo Synthesis. ') -> 'photosynthesis'
 *   normalizeShortAnswer('３') -> '3'
 */
export function normalizeShortAnswer(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[.。!?~]+$/, '')
}

/**
 * 이 답이 맞았는지. 객관식은 고른 번호, 주관식은 쓴 글이 정답 표기 중 하나와 같은지 봅니다. (너그럽게, normalizeShortAnswer)
 *
 *   isAnswerCorrect({ kind: 'short', answers: ['3', '삼'], … }, { choiceIndex: -1, text: ' 3 ', ms: 9000 }) -> true
 *   isAnswerCorrect({ choices: [...], answerIndex: 2, … }, { choiceIndex: 2, ms: 4000 }) -> true
 */
export function isAnswerCorrect(
  question: QuizQuestion,
  answer: QuizAnswer | null | undefined,
): boolean {
  if (!answer) return false
  if (isShortQuestion(question)) {
    if (answer.text === undefined) return false
    const mine = normalizeShortAnswer(answer.text)
    return (
      mine !== '' && (question.answers ?? []).some((right) => normalizeShortAnswer(right) === mine)
    )
  }
  return answer.choiceIndex === question.answerIndex
}

/**
 * 화면에 기호 그대로 보이는 마크다운 · LaTeX 표시를 지웁니다. (서버도 지우지만, 예전 서버 · 저장된 문제를 위해 한 번 더)
 * 곱하기 별 하나(2*3) · 빈칸 밑줄(___)은 둡니다.
 *
 *   plainQuizText('**수열**의 `극한` $x^2$') -> '수열의 극한 x^2'
 */
export function plainQuizText(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\$/g, '')
    .replace(/\\[()[\]]/g, '')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .trim()
}

/**
 * 찍은 것 같은지 봅니다. (questions 와 answers 는 같은 순서, 다 푼 뒤)
 * "모두 같은 번호" 는 객관식끼리만 봅니다. 주관식은 번호가 없어서 평균 시간만 셉니다.
 *
 *   보기 3문제 다 ①인데 틀린 게 있음 -> true · 다 ①이지만 다 맞음 -> false
 *   평균 1.5초 -> true · 객관식 2 + 주관식 1 -> 같은 번호는 안 봄 (객관식이 3개보다 적음)
 */
export function isGuessed(questions: QuizQuestion[], answers: QuizAnswer[]): boolean {
  if (answers.length === 0) return false
  const averageMs = answers.reduce((sum, answer) => sum + answer.ms, 0) / answers.length
  if (averageMs < GUESS_FAST_MS) return true
  const choicePairs = questions
    .map((question, index) => ({ question, answer: answers[index] }))
    .filter((pair) => pair.answer !== undefined && !isShortQuestion(pair.question))
  if (choicePairs.length < GUESS_MIN_QUESTIONS) return false
  const firstPick = choicePairs[0].answer.choiceIndex
  const isAllSame = choicePairs.every((pair) => pair.answer.choiceIndex === firstPick)
  const hasWrong = choicePairs.some((pair) => !isAnswerCorrect(pair.question, pair.answer))
  return isAllSame && hasWrong
}

/** 맞은 개수 */
export function countCorrect(quiz: CoachQuiz): number {
  return quiz.answers.filter((answer, index) => isAnswerCorrect(quiz.questions[index], answer))
    .length
}

/** 틀린 문제들 */
export function wrongQuestionsOf(quiz: Pick<CoachQuiz, 'questions' | 'answers'>): QuizQuestion[] {
  return quiz.questions.filter((question, index) => {
    const answer = quiz.answers[index]
    return answer !== null && answer !== undefined && !isAnswerCorrect(question, answer)
  })
}

/** 새 문제 말풍선. 단원(unit)은 AI 가 낸 문제에만 있습니다. ("틀린 문제 다시" 는 없음) */
export function newQuiz(input: {
  topic: string
  cardId: string | null
  unit?: string | null
  questions: QuizQuestion[]
  isDemo: boolean
  now: number
}): CoachQuiz {
  return {
    id: `quiz-${input.now}`,
    topic: input.topic,
    cardId: input.cardId,
    unit: input.unit ?? null,
    questions: input.questions,
    answers: input.questions.map(() => null),
    current: 0,
    shownAt: input.now,
    retryIndex: null,
    wasGuessed: false,
    isDemo: input.isDemo,
    status: 'open',
  }
}

/** 지금 문제에 답을 고릅니다. 이미 골랐으면 그대로 둡니다. (한 번 고르면 바꿀 수 없음) */
export function answerQuiz(quiz: CoachQuiz, choiceIndex: number, now: number): CoachQuiz {
  if (quiz.status !== 'open' || quiz.answers[quiz.current] !== null) return quiz
  const answers = [...quiz.answers]
  answers[quiz.current] = { choiceIndex, ms: Math.max(0, now - quiz.shownAt) }
  return { ...quiz, answers }
}

/** 지금 주관식 문제에 쓴 답을 냅니다. 빈 답이거나 이미 냈으면 그대로 둡니다. (한 번 내면 바꿀 수 없음) */
export function answerQuizText(quiz: CoachQuiz, text: string, now: number): CoachQuiz {
  const trimmed = text.trim().slice(0, MAX_SHORT_INPUT_LENGTH)
  if (trimmed === '' || quiz.status !== 'open' || quiz.answers[quiz.current] !== null) return quiz
  const answers = [...quiz.answers]
  answers[quiz.current] = { choiceIndex: -1, text: trimmed, ms: Math.max(0, now - quiz.shownAt) }
  return { ...quiz, answers }
}

/**
 * [다음] · [결과 보기]: 다음 문제로 가거나, 마지막이면 끝냅니다.
 * 처음 다 풀었을 때 찍은 것 같으면 결과 대신 "다시 볼까?" 를 묻습니다. (다시 푼 뒤에는 묻지 않음)
 */
export function nextQuizStep(quiz: CoachQuiz, now: number): CoachQuiz {
  if (quiz.status !== 'open' || quiz.answers[quiz.current] === null) return quiz
  // "한 문제만 다시" 를 풀었으면 바로 결과입니다.
  if (quiz.retryIndex !== null) return { ...quiz, retryIndex: null, status: 'done' }
  if (quiz.current < quiz.questions.length - 1) {
    return { ...quiz, current: quiz.current + 1, shownAt: now }
  }
  const answers = quiz.answers.filter((answer) => answer !== null)
  const guessed = isGuessed(quiz.questions, answers)
  return guessed ? { ...quiz, wasGuessed: true, status: 'guessCheck' } : { ...quiz, status: 'done' }
}

/** [다시 풀기]: 틀린 첫 문제(없으면 첫 문제) 하나만 다시 풉니다. */
export function retryOneQuestion(quiz: CoachQuiz, now: number): CoachQuiz {
  const wrongIndex = quiz.questions.findIndex(
    (question, index) => !isAnswerCorrect(question, quiz.answers[index]),
  )
  const index = wrongIndex === -1 ? 0 : wrongIndex
  const answers = [...quiz.answers]
  answers[index] = null
  return { ...quiz, answers, current: index, shownAt: now, retryIndex: index, status: 'open' }
}

/** 결과 기록으로 바꿉니다. (다 풀었을 때) */
export function toQuizResult(quiz: CoachQuiz, now: number, todayKey: string): QuizResult {
  return {
    id: quiz.id,
    date: todayKey,
    at: now,
    topic: quiz.topic,
    cardId: quiz.cardId,
    unit: quiz.unit,
    questions: quiz.questions,
    answers: quiz.answers.map((answer) => answer ?? { choiceIndex: -1, ms: 0 }),
    correct: countCorrect(quiz),
    guessed: quiz.wasGuessed,
    isDemo: quiz.isDemo,
  }
}

/**
 * 코치(AI)에게 보내는 대화에 붙이는 한 줄. AI 가 어떤 문제를 풀었는지 알고 이어서 이야기하게 합니다.
 *   -> '[확인 문제] 미적분Ⅰ 3단원 · 3개 중 2개 맞음 · 틀린 문제: lim 1/n 의 값은?'
 */
export function quizLineForAi(quiz: CoachQuiz): string {
  if (quiz.status !== 'done') return `[확인 문제] ${quiz.topic} · 푸는 중`
  const wrong = wrongQuestionsOf(quiz).map((question) => question.question)
  const wrongText = wrong.length > 0 ? ` · 틀린 문제: ${wrong.join(' / ')}` : ''
  const guessText = quiz.wasGuessed ? ' · 찍은 것 같다고 봄' : ''
  return `[확인 문제] ${quiz.topic} · ${quiz.questions.length}개 중 ${countCorrect(quiz)}개 맞음${guessText}${wrongText}`
}

// ---- 채팅에서 문제를 부탁하는 말 ----

/** 문제 수를 말하는 부분: "3개" · "세 개" · "5문제" · "하나" · "몇 개" */
const COUNT_WORDS = '(?:\\d+|하나|한|둘|두|셋|세|넷|네|다섯|몇)\\s*(?:개|문제)?'

/**
 * "문제 내 줘" · "한국사 문제 3개 내 줘" · "문제 세 개만 만들어 줘" · "퀴즈 풀래" 처럼 문제를 부탁하는 말
 * - '문제' 뒤에 (문제 수) (만 · 좀 · 더 · 를 · 을) 이 와도 되고, 그다음에 내 · 만들어 · 출제 · 풀래 · 줘 가 와야 합니다.
 * - '내가 · 내용 · 내일' 의 '내' 는 부탁이 아닙니다. ("이 문제 내가 푼 거 맞아?") '만들어' 의 '만' 은 '~만' 이 아닙니다.
 * - "이 문제 풀어 줘" 는 문제를 내 달라는 게 아니라 풀어 달라는 말이라서 AI 에게 보냅니다. (2026-10-31)
 */
const QUIZ_REQUEST_PATTERN = new RegExp(
  `(문제|퀴즈)\\s*(${COUNT_WORDS})?(\\s*(만(?!들)|좀|더|를|을))*\\s*(내(?![가용일])|만들어|출제|풀래|풀고\\s*싶|풀어\\s*볼래|줘|주라|줄래|주세요)`,
)
/** 부탁하는 말에서 주제만 남기려고 지우는 글 (문제 수 · 부탁하는 말) */
const QUIZ_REQUEST_WORDS = new RegExp(
  `(확인\\s*)?(${COUNT_WORDS}\\s*)?(문제|퀴즈)\\s*(${COUNT_WORDS})?(\\s*(만(?!들)|좀|더|를|을))*\\s*(내|만들어|출제해|출제|풀래|풀고\\s*싶어|풀어\\s*볼래)?\\s*(줘|주라|줄래|볼래|래|봐|줄 수 있어|주세요)?[?.!]*`,
  'g',
)
/** 숫자 대신 글로 쓴 문제 수 */
const COUNT_BY_WORD: Record<string, number> = {
  하나: 1,
  한: 1,
  둘: 2,
  두: 2,
  셋: 3,
  세: 3,
  넷: 4,
  네: 4,
  다섯: 5,
}

/**
 * 부탁하는 말에 든 문제 수. 말하지 않았거나 "몇 개" 면 null
 *   requestedQuizCountOf('문제 5개 내 줘') -> 5 · requestedQuizCountOf('세 문제만') -> 3 · requestedQuizCountOf('미적분 3단원 문제 내 줘') -> null
 */
export function requestedQuizCountOf(text: string): number | null {
  const match = text.match(/(\d+|하나|한|둘|두|셋|세|넷|네|다섯)\s*(개|문제)/)
  if (!match) return null
  const count = /^\d+$/.test(match[1]) ? Number(match[1]) : COUNT_BY_WORD[match[1]]
  return quizCountOf(count)
}

/**
 * 문제 종류를 말하는 낱말(과 앞의 '다 · 전부 · 모두', 뒤의 '으로 · 로 · 도 · 만'). 부탁을 알아듣기 전에 지웁니다.
 * ('수학 문제 객관식으로 내 줘' -> '수학 문제 내 줘', '한국사 주관식만 문제 내 줘' -> 주제 '한국사')
 */
const QUIZ_STYLE_WORDS =
  /((^|\s)(다|전부|모두)\s*)?(객관식|주관식|단답형?|서술형|[45]\s*지\s*선다형?|섞어서|섞어)(으로|로)?(도|만(?!들))?/g

/**
 * 한 묶음에 주관식(단답형)을 몇 개 넣을지 코드가 정합니다.
 * (2026-10-31 사용자 "기본적으로 객관식으로 내거나 주관식도 문제 내달라하면 섞거나")
 * - 기본은 모두 객관식입니다. 한 문제씩 ①~⑤ 를 눌러 풉니다.
 * - "주관식 · 단답 · 섞어" 를 말하면 섞습니다. 문제 수의 3분의 1(적어도 1개)이 주관식입니다. (3문제 -> 객관식 2 + 주관식 1)
 * - "주관식만 · 다 주관식" 처럼 주관식만 달라고 하면 모두 주관식입니다.
 *
 *   quizShortCountOf('', 3) -> 0 · quizShortCountOf('주관식도 내 줘', 3) -> 1 · quizShortCountOf('주관식만 내 줘', 3) -> 3
 */
export function quizShortCountOf(text: string, count: number): number {
  if (!/(주관식|단답|서술형|섞어)/.test(text)) return 0
  const isShortOnly =
    /(주관식|단답형?|서술형)\s*(으로|로)?\s*만(?!들)/.test(text) ||
    /(^|\s)(다|전부|모두)\s*(주관식|단답|서술형)/.test(text)
  if (isShortOnly) return count
  return Math.min(count, Math.max(1, Math.floor(count / 3)))
}

/**
 * 학생이 쓴 말이 문제를 내 달라는 부탁이면 주제(와 문제 수)를 꺼냅니다. 아니면 null
 *
 *   parseQuizText('미적분 3단원 문제 내 줘')   -> { topic: '미적분 3단원', count: null }
 *   parseQuizText('한국사 문제 3개 내 줘')     -> { topic: '한국사', count: 3 }
 *   parseQuizText('퀴즈 내 줘')               -> { topic: '', count: null }   (주제를 고르는 칸을 엶)
 *   parseQuizText('오늘 문제 많이 풀었어')      -> null                        ("내 줘" 가 아님)
 *   parseQuizText('이 문제 풀어 줘')           -> null                        (풀어 달라는 말 → AI 가 설명)
 */
export function parseQuizText(text: string): { topic: string; count: number | null } | null {
  // "객관식으로 · 섞어서" 같은 말은 먼저 지워서, '문제 3개 객관식으로 내 줘' 도 부탁으로 알아듣게 합니다.
  const plain = text.replace(QUIZ_STYLE_WORDS, ' ').replace(/\s+/g, ' ')
  const isRequest =
    QUIZ_REQUEST_PATTERN.test(plain) && !/(풀었|냈|만들었)/.test(plain.replace(/\s/g, ''))
  if (!isRequest) return null
  const topic = plain
    .replace(QUIZ_REQUEST_WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // 끝에 남은 '로 · 으로 · 관련' 같은 말을 지웁니다. ('수열로 문제 내 줘' -> '수열')
    .replace(/\s*(으로|로|에 대해|관련)$/, '')
    .trim()
    .slice(0, MAX_QUIZ_TOPIC_LENGTH)
  return { topic, count: requestedQuizCountOf(plain) }
}

// ---- 결과 저장 ----

function isText(value: unknown): value is string {
  return typeof value === 'string'
}

/**
 * 서버 · 저장소에서 꺼낸 문제 하나를 확인합니다. 모양이 틀리면 null
 * - 객관식: 보기 5개(예전 문제 · 예전 서버는 4개) · 정답 번호가 보기 안
 * - 주관식: 서버는 type: 'SHORT', 이 기기는 kind: 'short'. 정답 표기(answers) 1 ~ 5개
 * - 마크다운 · LaTeX 기호는 지웁니다. (plainQuizText) 지문(passage)은 그대로 둡니다.
 */
export function toQuizQuestion(value: unknown): QuizQuestion | null {
  if (typeof value !== 'object' || value === null) return null
  const item = value as Record<string, unknown>
  if (!isText(item.question) || plainQuizText(item.question) === '') return null
  const question = plainQuizText(item.question)
  const explanation = isText(item.explanation) ? plainQuizText(item.explanation) : ''
  const passage = isText(item.passage) && item.passage.trim() !== '' ? item.passage.trim() : null
  if (item.kind === 'short' || item.type === 'SHORT') {
    if (!Array.isArray(item.answers)) return null
    const answers = item.answers
      .filter(isText)
      .map((answer) => plainQuizText(answer).slice(0, MAX_SHORT_ANSWER_LENGTH))
      .filter((answer) => answer !== '')
      .slice(0, 5)
    if (answers.length === 0) return null
    return { kind: 'short', question, passage, choices: [], answerIndex: -1, answers, explanation }
  }
  if (!Array.isArray(item.choices)) return null
  const size = item.choices.length
  if (size !== QUIZ_CHOICE_COUNT && size !== OLD_CHOICE_COUNT) return null
  if (!item.choices.every((choice) => isText(choice) && plainQuizText(choice) !== '')) return null
  const answerIndex = item.answerIndex
  if (typeof answerIndex !== 'number' || !Number.isInteger(answerIndex)) return null
  if (answerIndex < 0 || answerIndex >= size) return null
  return {
    kind: 'choice',
    question,
    passage,
    choices: (item.choices as string[]).map(plainQuizText),
    answerIndex,
    explanation,
  }
}

function toQuizAnswer(value: unknown): QuizAnswer | null {
  if (typeof value !== 'object' || value === null) return null
  const answer = value as Record<string, unknown>
  if (typeof answer.choiceIndex !== 'number' || typeof answer.ms !== 'number') return null
  return isText(answer.text)
    ? { choiceIndex: answer.choiceIndex, text: answer.text, ms: answer.ms }
    : { choiceIndex: answer.choiceIndex, ms: answer.ms }
}

/** 서버 · 저장소에서 꺼낸 단원. 글자가 아니거나 비었으면 null ('  함수 ' -> '함수') */
function toUnit(value: unknown): string | null {
  return isText(value) && value.trim() !== '' ? value.trim() : null
}

function toQuizResultRecord(value: unknown): QuizResult | null {
  if (typeof value !== 'object' || value === null) return null
  const item = value as Record<string, unknown>
  if (!isText(item.id) || !isText(item.date) || !isText(item.topic)) return null
  if (typeof item.at !== 'number' || !Array.isArray(item.questions)) return null
  if (!Array.isArray(item.answers)) return null
  const questions = item.questions.map(toQuizQuestion)
  const answers = item.answers.map(toQuizAnswer)
  if (questions.some((question) => question === null) || answers.some((a) => a === null)) {
    return null
  }
  return {
    id: item.id,
    date: item.date,
    at: item.at,
    topic: item.topic,
    cardId: isText(item.cardId) ? item.cardId : null,
    unit: toUnit(item.unit),
    questions: questions as QuizQuestion[],
    answers: answers as QuizAnswer[],
    correct: typeof item.correct === 'number' ? item.correct : 0,
    guessed: item.guessed === true,
    isDemo: item.isDemo === true,
  }
}

/** 이 기기에 남긴 결과들 (오래된 것부터). 깨진 것은 버립니다. */
export function loadQuizResults(): QuizResult[] {
  const saved = loadData<unknown>(STORAGE_KEY, [])
  if (!Array.isArray(saved)) return []
  return saved.map(toQuizResultRecord).filter((result) => result !== null)
}

/** 결과를 남길 때마다 보내는 이벤트 이름입니다. hooks/useQuizResultSync.ts 가 듣고 서버로 보냅니다. (#653) */
export const QUIZ_RESULTS_CHANGED_EVENT = 'study-quiz-results-changed'

/** 결과 하나를 남깁니다. 같은 번호가 있으면 바꾸고, 100개를 넘으면 오래된 것부터 지웁니다. */
export function saveQuizResult(result: QuizResult): void {
  const others = loadQuizResults().filter((saved) => saved.id !== result.id)
  saveData(STORAGE_KEY, [...others, result].slice(-MAX_RESULTS))
  window.dispatchEvent(new Event(QUIZ_RESULTS_CHANGED_EVENT))
}

/**
 * 그날 푼 결과에서 틀린 문제들 (같은 문제는 한 번만). 다음 날 코치가 "어제 틀린 문제" 로 다시 냅니다.
 * 나중에 복습 알림(1 · 3 · 7일 뒤)도 이 함수로 그날 틀린 문제를 꺼냅니다.
 *
 *   wrongQuestionsOn(결과들, '2026-10-17') -> [{ question: 'lim 1/n 의 값은?', … }]
 */
export function wrongQuestionsOn(results: QuizResult[], dateKey: string): QuizQuestion[] {
  const wrong: QuizQuestion[] = []
  for (const result of results) {
    if (result.date !== dateKey) continue
    for (const question of wrongQuestionsOf(result)) {
      if (!wrong.some((saved) => saved.question === question.question)) wrong.push(question)
    }
  }
  return wrong
}

/** 그날 다시 풀어서 맞힌 문제 글들 */
function rightQuestionsOn(results: QuizResult[], dateKey: string): string[] {
  const right: string[] = []
  for (const result of results) {
    if (result.date !== dateKey) continue
    result.questions.forEach((question, index) => {
      if (isAnswerCorrect(question, result.answers[index])) right.push(question.question)
    })
  }
  return right
}

/** 어제 틀린 문제들. 오늘 다시 풀어서 맞힌 문제는 뺍니다. */
export function loadYesterdayWrong(todayKey: string): QuizQuestion[] {
  return wrongForReview(loadQuizResults(), todayKey, [1])
}

/**
 * 복습할 틀린 문제들 — daysAgo 일 전(예: 1 · 3 · 7일 전)에 틀린 문제를 모읍니다. (같은 문제는 한 번만)
 * 틀린 날 뒤로 오늘까지 다시 풀어서 맞힌 문제는 뺍니다. 복습 알림(lib/coachNudges.ts)과 코치의 [📝 틀린 문제 다시] 가 씁니다.
 *
 *   wrongForReview(결과들, '2026-10-19', [1, 3, 7])
 *     -> 10-18 · 10-16 · 10-12 에 틀린 문제 중 그 뒤에 맞힌 적 없는 것들
 */
export function wrongForReview(
  results: QuizResult[],
  todayKey: string,
  daysAgo: number[],
): QuizQuestion[] {
  const wrong: QuizQuestion[] = []
  for (const days of daysAgo) {
    const wrongDate = moveDateKey(todayKey, -days)
    // 틀린 다음 날부터 오늘까지 맞힌 문제 글
    const rightAfter: string[] = []
    for (let day = days - 1; day >= 0; day--) {
      rightAfter.push(...rightQuestionsOn(results, moveDateKey(todayKey, -day)))
    }
    for (const question of wrongQuestionsOn(results, wrongDate)) {
      const isRetried = rightAfter.includes(question.question)
      const isAdded = wrong.some((saved) => saved.question === question.question)
      if (!isRetried && !isAdded) wrong.push(question)
    }
  }
  return wrong
}

// ---- 서버 ----

/**
 * 확인 문제를 내 달라고 합니다. (진짜 로그인일 때만)
 *   요청 { topic, checklist, material?, image?, count }
 *   응답 { showHelp, questions: [{ question, choices[4], answerIndex, explanation }] | null, unit: '함수' | null, reason: null | 'NOT_STUDY' }
 */
export async function requestQuiz(input: QuizInput): Promise<QuizReply> {
  const result = await api<unknown>('/ai/quiz', {
    method: 'POST',
    body: JSON.stringify({
      topic: input.topic.trim().slice(0, MAX_QUIZ_TOPIC_LENGTH),
      checklist: input.checklist.slice(0, 5).map((item) => item.slice(0, 50)),
      material: input.material ? input.material.slice(0, MAX_QUIZ_MATERIAL_LENGTH) : null,
      image: input.image,
      count: quizCountOf(input.count),
      // 보기 수 · 주관식 수를 모르는 예전 서버는 이 두 칸을 넘기고 4지선다 · 객관식만 줍니다. (그래도 읽을 수 있음)
      choiceCount: QUIZ_CHOICE_COUNT,
      shortCount: shortCountOf(input),
    }),
    signal: AbortSignal.timeout(input.image ? PHOTO_QUIZ_TIMEOUT_MS : QUIZ_TIMEOUT_MS),
  })
  if (typeof result !== 'object' || result === null) {
    throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
  }
  const record = result as Record<string, unknown>
  const empty = {
    showHelp: false,
    notStudy: false,
    questions: null,
    unit: null,
    isDemo: false,
    notice: null,
  }
  if (record.showHelp === true) return { ...empty, showHelp: true }
  if (record.reason === 'NOT_STUDY') return { ...empty, notStudy: true }
  if (!Array.isArray(record.questions)) return empty
  const questions = record.questions
    .map(toQuizQuestion)
    .filter((question) => question !== null)
    .slice(0, quizCountOf(input.count))
  if (questions.length === 0) return empty
  return { ...empty, questions, unit: toUnit(record.unit) }
}

/**
 * 서버가 문제를 못 내는 이유가 "아직 준비 안 됨" 이면 시연용 예시 앞에 붙일 한 줄, 아니면 null
 *   404 — 서버에 이 기능이 아직 배포되지 않음 · 503 — AI 가 꺼짐 · 429 — 오늘 AI 한도를 다 씀
 */
function fallbackNoticeOf(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null
  if (error.status === 404)
    return '문제 서버가 아직 준비 중이라 시연용 예시 문제를 낼게. 서버 준비가 끝나면 진짜로 내 줄게.'
  if (error.status === 503) return '지금 AI 가 꺼져 있어서 시연용 예시 문제를 낼게.'
  if (error.status === 429)
    return '오늘 AI 를 다 써서 시연용 예시 문제를 낼게. 내일은 진짜로 내 줄게.'
  return null
}

/**
 * 서버로 문제를 받아 보고, 아직 준비가 안 됐으면(404 · 503 · 429) 시연용 예시로 대신합니다.
 * 그 밖의 실패(연결 끊김 · 400 등)는 그대로 던져서 화면이 [다시 보내기] 를 보여 줍니다.
 */
export async function requestQuizOrDemo(input: QuizInput): Promise<QuizReply> {
  try {
    return await requestQuiz(input)
  } catch (error) {
    const notice = fallbackNoticeOf(error)
    if (notice === null) throw error
    return { ...makeDemoQuiz(input), notice }
  }
}

/** 이번 요청의 주관식 수. 따로 정하지 않았으면 문제 수로 정합니다. (quizShortCountOf) */
function shortCountOf(input: Pick<QuizInput, 'count' | 'shortCount'>): number {
  const count = quizCountOf(input.count)
  const wanted = input.shortCount ?? quizShortCountOf('', count)
  return Math.min(count, Math.max(0, Math.floor(wanted)))
}

// ---- 시연용 예시 문제 (테스트 로그인 · 서버 준비 전) ----

/**
 * 주제 낱말 → 예시 문제 묶음. 위에서부터 맞는 것을 고릅니다. 사실이 틀리지 않게 교과 기본 개념만 넣었습니다.
 * questions 는 5지선다, short 는 섞어 낼 때 쓰는 주관식 단답형 하나입니다. (2026-10-31)
 */
const DEMO_SETS: { words: string[]; questions: QuizQuestion[]; short: QuizQuestion }[] = [
  {
    words: ['미적분', '수열', '극한', '함수', '미분', '수학', '확률', '기하'],
    questions: [
      {
        question: 'lim (n→∞) 1/n 의 값은?',
        choices: ['1', '0', '∞', '정할 수 없다', '-1'],
        answerIndex: 1,
        explanation: 'n 이 한없이 커지면 1/n 은 0 에 한없이 가까워져.',
      },
      {
        question: '수열 aₙ = (1/2)ⁿ 의 극한은?',
        choices: ['1/2', '1', '0', '발산한다', '1/4'],
        answerIndex: 2,
        explanation: '공비의 절댓값이 1 보다 작은 등비수열은 0 으로 수렴해.',
      },
      {
        question: 'f(x) = x² 일 때 f′(3) 의 값은?',
        choices: ['6', '3', '9', '2', '12'],
        answerIndex: 0,
        explanation: 'f′(x) = 2x 라서 f′(3) = 6 이야.',
      },
    ],
    short: {
      kind: 'short',
      question: 'lim (n→∞) 2/n 의 값을 숫자로 써 봐.',
      choices: [],
      answerIndex: -1,
      answers: ['0', '영'],
      explanation: 'n 이 한없이 커지면 2/n 도 0 에 한없이 가까워져.',
    },
  },
  {
    words: ['영어', '단어', '문법', '독해', 'english'],
    questions: [
      {
        question: "'abundant' 와 뜻이 가장 가까운 것은?",
        choices: ['scarce', 'tiny', 'plentiful', 'empty', 'rare'],
        answerIndex: 2,
        explanation: "abundant 는 '풍부한' 이라는 뜻이라 plentiful 과 가까워.",
      },
      {
        question: 'She has lived here ___ 2020. 빈칸에 알맞은 것은?',
        choices: ['since', 'for', 'during', 'while', 'until'],
        answerIndex: 0,
        explanation: '시작한 때(2020) 앞에는 since, 기간(3년) 앞에는 for 를 써.',
      },
      {
        question: '다음 중 수동태 문장은?',
        choices: [
          'Tom wrote the letter.',
          'Tom is writing a letter.',
          'Tom will write a letter.',
          'The letter was written by Tom.',
          'Tom has written a letter.',
        ],
        answerIndex: 3,
        explanation: 'be동사 + 과거분사(was written) 모양이 수동태야.',
      },
    ],
    short: {
      kind: 'short',
      question: "'풍부한' 이라는 뜻의 영어 낱말을 써 봐. (a 로 시작)",
      choices: [],
      answerIndex: -1,
      answers: ['abundant'],
      explanation: "abundant 는 '풍부한', 반대말은 scarce 야.",
    },
  },
  {
    words: ['국어', '문학', '시', '소설', '문법', '독서'],
    questions: [
      {
        question: '직유법이 쓰인 것은?',
        choices: [
          '내 마음은 호수요',
          '구름처럼 흘러가는 시간',
          '님은 갔습니다',
          '산에는 꽃 피네',
          '바람이 속삭인다',
        ],
        answerIndex: 1,
        explanation: "'~처럼 · ~같이' 로 직접 빗대면 직유법이야. '내 마음은 호수요' 는 은유법.",
      },
      {
        question: '시 안에서 말하는 사람을 무엇이라 할까?',
        choices: ['작가', '독자', '화자', '청자', '편집자'],
        answerIndex: 2,
        explanation: '시 속에서 말하는 이는 화자야. 시를 쓴 작가와 같지 않을 수 있어.',
      },
      {
        question: "'먹었다' 의 '-었-' 이 나타내는 것은?",
        choices: ['과거 시제', '높임', '부정', '추측', '미래 시제'],
        answerIndex: 0,
        explanation: "'-었-' 은 일이 이미 일어났음을 나타내는 과거 시제 선어말 어미야.",
      },
    ],
    short: {
      kind: 'short',
      question: '시 속에서 말하는 사람을 두 글자로 써 봐.',
      choices: [],
      answerIndex: -1,
      answers: ['화자'],
      explanation: '시 속에서 말하는 이는 화자야. 시를 쓴 작가와 같지 않을 수 있어.',
    },
  },
  {
    words: ['과학', '물리', '화학', '생명', '생물', '지구'],
    questions: [
      {
        question: '가속도가 힘에 비례하고 질량에 반비례한다는 법칙은?',
        choices: [
          '관성 법칙',
          '뉴턴 운동 제2법칙',
          '작용 반작용 법칙',
          '만유인력 법칙',
          '에너지 보존 법칙',
        ],
        answerIndex: 1,
        explanation: 'F = ma 로 쓰는 뉴턴 운동 제2법칙(가속도 법칙)이야.',
      },
      {
        question: '광합성이 일어나는 세포 소기관은?',
        choices: ['미토콘드리아', '핵', '리보솜', '엽록체', '골지체'],
        answerIndex: 3,
        explanation: '빛에너지로 포도당을 만드는 광합성은 엽록체에서 일어나.',
      },
      {
        question: '물(H₂O) 분자 하나에 들어 있는 수소 원자는 몇 개?',
        choices: ['2개', '1개', '3개', '4개', '0개'],
        answerIndex: 0,
        explanation: 'H₂O 의 H 옆 숫자 2 가 수소 원자 2개라는 뜻이야.',
      },
    ],
    short: {
      kind: 'short',
      question: '물(H₂O) 분자 하나에 들어 있는 산소 원자는 몇 개? 숫자로 써 봐.',
      choices: [],
      answerIndex: -1,
      answers: ['1', '1개', '하나', '한개'],
      explanation: 'O 옆에 숫자가 없으면 1개라는 뜻이야.',
    },
  },
  {
    words: ['한국사', '역사', '사회', '세계사', '정치', '경제'],
    questions: [
      {
        question: '훈민정음을 만든 왕은?',
        choices: ['태조', '세종', '정조', '영조', '광해군'],
        answerIndex: 1,
        explanation: '조선의 세종이 1443년에 훈민정음을 만들고 1446년에 펴냈어.',
      },
      {
        question: '3·1 운동이 일어난 해는?',
        choices: ['1910년', '1945년', '1919년', '1950년', '1905년'],
        answerIndex: 2,
        explanation: '3·1 운동은 1919년 3월 1일에 일어났어.',
      },
      {
        question: '우리나라 국회의원의 임기는?',
        choices: ['4년', '5년', '6년', '2년', '3년'],
        answerIndex: 0,
        explanation: '국회의원의 임기는 4년이야. (대통령은 5년 단임)',
      },
    ],
    short: {
      kind: 'short',
      question: '훈민정음을 만든 조선의 왕은? 두 글자로 써 봐.',
      choices: [],
      answerIndex: -1,
      answers: ['세종', '세종대왕'],
      explanation: '조선의 세종이 1443년에 훈민정음을 만들고 1446년에 펴냈어.',
    },
  },
]

/** 어떤 주제에도 맞지 않을 때 섞어 내는 주관식 (공부 방법) */
const DEMO_DEFAULT_SHORT: QuizQuestion = {
  kind: 'short',
  question: '안 보고 스스로 떠올려 보는 공부법을 무슨 연습이라고 할까? 두 글자로 써 봐. (○○ 연습)',
  choices: [],
  answerIndex: -1,
  answers: ['인출', '인출연습'],
  explanation: '배운 것을 안 보고 꺼내 보는 인출 연습이 다시 읽기보다 오래 남아.',
}

/** 어떤 주제에도 맞지 않을 때의 예시 (공부 방법) */
const DEMO_DEFAULT: QuizQuestion[] = [
  {
    question: '공부한 내용을 오래 기억하는 데 가장 도움이 되는 방법은?',
    choices: [
      '형광펜으로 여러 번 칠하기',
      '안 보고 스스로 떠올려 보기',
      '교과서를 다시 읽기만 하기',
      '밤새 한 번에 몰아서 보기',
      '정리 노트를 예쁘게 꾸미기',
    ],
    answerIndex: 1,
    explanation: '안 보고 떠올려 보는 것(인출 연습)이 다시 읽기보다 오래 남아.',
  },
  {
    question: '같은 양을 공부할 때 더 오래 기억에 남는 것은?',
    choices: [
      '하루에 몰아서 하기',
      '시험 전날만 보기',
      '며칠에 나눠서 복습하기',
      '한 번 보고 끝내기',
      '음악을 크게 틀고 보기',
    ],
    answerIndex: 2,
    explanation: '며칠에 나눠서 보면(분산 학습) 한 번에 몰아서 볼 때보다 오래 기억해.',
  },
  {
    question: '틀린 문제를 다시 볼 때 가장 좋은 방법은?',
    choices: [
      '왜 틀렸는지 적고 다시 풀기',
      '정답만 외우기',
      '틀린 문제는 건너뛰기',
      '해설만 읽기',
      '친구 답을 베끼기',
    ],
    answerIndex: 0,
    explanation: '틀린 이유를 적고 다시 풀어야 같은 실수를 덜 해.',
  },
]

/**
 * 시연용 예시 문제. 주제 · 체크리스트 낱말로 과목을 골라 그 과목의 기본 문제를 냅니다.
 * 주관식은 묶음마다 하나라서 1개까지만 섞습니다. (객관식 먼저, 주관식은 끝에)
 *
 *   makeDemoQuiz({ topic: '미적분 3단원', … }) -> 수학 5지선다 2문제 + 주관식 1문제
 *   makeDemoQuiz({ topic: '오늘 배운 것', count: 2, … }) -> 공부 방법 5지선다 2문제
 */
export function makeDemoQuiz(
  input: Pick<QuizInput, 'topic' | 'checklist' | 'count' | 'shortCount'>,
): QuizReply {
  const text = `${input.topic} ${input.checklist.join(' ')}`.toLowerCase()
  const set = DEMO_SETS.find((item) => item.words.some((word) => text.includes(word)))
  const count = quizCountOf(input.count)
  const shortCount = Math.min(1, shortCountOf(input))
  const choiceQuestions = (set?.questions ?? DEMO_DEFAULT).slice(0, count - shortCount)
  const shortQuestions = shortCount > 0 ? [set?.short ?? DEMO_DEFAULT_SHORT] : []
  return {
    showHelp: false,
    notStudy: false,
    questions: [...choiceQuestions, ...shortQuestions],
    // 시연용 예시는 단원을 정하지 않습니다. (서버에도 보내지 않음)
    unit: null,
    isDemo: true,
    notice: null,
  }
}

// ---- 대화방 저장용 확인 ----

/** 저장소에서 꺼낸 문제 말풍선이 쓸 수 있는 모양인지 확인합니다. (lib/coachThread.ts 가 씀) 깨졌으면 null */
export function toCoachQuiz(value: unknown): CoachQuiz | null {
  if (typeof value !== 'object' || value === null) return null
  const quiz = value as Record<string, unknown>
  if (!isText(quiz.id) || !isText(quiz.topic) || !Array.isArray(quiz.questions)) return null
  const questions = quiz.questions.map(toQuizQuestion)
  if (questions.length === 0 || questions.some((question) => question === null)) return null
  const rawAnswers = Array.isArray(quiz.answers) ? quiz.answers : []
  const answers = questions.map((_, index) => toQuizAnswer(rawAnswers[index]))
  const statuses: QuizStatus[] = ['open', 'guessCheck', 'done', 'closed']
  const status = statuses.includes(quiz.status as QuizStatus)
    ? (quiz.status as QuizStatus)
    : 'closed'
  const current = typeof quiz.current === 'number' ? quiz.current : 0
  const retryIndex = typeof quiz.retryIndex === 'number' ? quiz.retryIndex : null
  return {
    id: quiz.id,
    topic: quiz.topic,
    cardId: isText(quiz.cardId) ? quiz.cardId : null,
    unit: toUnit(quiz.unit),
    questions: questions as QuizQuestion[],
    answers,
    current: Math.min(Math.max(0, current), questions.length - 1),
    shownAt: typeof quiz.shownAt === 'number' ? quiz.shownAt : 0,
    retryIndex: retryIndex !== null && retryIndex < questions.length ? retryIndex : null,
    wasGuessed: quiz.wasGuessed === true,
    isDemo: quiz.isDemo === true,
    status,
  }
}
