import { moveDateKey, toDayKey } from '@/lib/date'
import { DEMO_ID_PREFIX } from '@/lib/demoIds'
import { createRandom, hashSeed } from '@/lib/demoPersona'
import type { QuizQuestion, QuizResult } from '@/lib/studyQuiz'
import type { Card, StudySession } from '@/types'

/**
 * 시연 데이터의 "확인 문제" 결과를 만듭니다. lib/demoData.ts 의 addDemoData 가 부릅니다. (2026-10-24)
 * 기록 › 문제 풀이 리포트(과목별 점수 그래프)와 코치의 "틀린 문제 다시" 가 빈 화면이 아니게 하려는 것입니다.
 *
 * - 최근 2주(이번 주 · 지난주)의 공부 기록 중 영단어 · 수학 · 국어 카드에서, 공부를 끝낸 5분 뒤 3문제를 푼 것으로 둡니다.
 * - 정답률은 2주 동안 조금씩 오르고, 삼각함수가 가장 약하게 시작합니다. 영단어는 가끔 빨리 고르다 틀립니다.
 * - 그날 틀린 문제는 다음 날 아침 "어제 틀린 문제" 로 다시 풀고, 대부분 맞힙니다.
 * - 문제는 진짜 문제입니다. 시연 중에 코치가 다시 내도 이상하지 않게 하려는 것입니다.
 *   같은 문제 글이 두 번 나오면 리포트가 "다시 푼 문제" 로 세서, 처음 내는 문제는 글이 겹치지 않게 만듭니다.
 * - isDemo 는 false 로 둡니다. isDemo 는 "AI 가 꺼져서 대신 낸 예시 문제" 라는 표시라 리포트가 세지 않기 때문입니다.
 */

/** 최근 며칠의 기록에 문제를 붙일지 (이번 주 · 지난주) */
const QUIZ_DAYS = 14
const QUESTIONS_PER_QUIZ = 3
const DAY_MS = 24 * 60 * 60 * 1000

type Unit = 'sequence' | 'trig' | 'korean' | 'english'

/** 단원마다 문제 묶음의 주제 (리포트의 과목 · 단원 이름이 됩니다) */
const UNIT_TOPICS: Record<Unit, string> = {
  sequence: '수학 등차수열',
  trig: '수학 삼각함수',
  korean: '국어 어휘',
  english: '영어 영단어',
}

/** 단원마다 첫날 맞힐 확률 · 2주 동안 오르는 폭 · 한 문제에 걸리는 시간(초) */
const UNIT_SKILL: Record<Unit, { start: number; gain: number; seconds: [number, number] }> = {
  sequence: { start: 0.65, gain: 0.2, seconds: [40, 110] },
  // 삼각함수는 이번 주에도 60% 아래라 리포트의 "취약 단원" 으로 보입니다.
  trig: { start: 0.3, gain: 0.3, seconds: [60, 150] },
  korean: { start: 0.6, gain: 0.15, seconds: [15, 40] },
  english: { start: 0.6, gain: 0.2, seconds: [8, 25] },
}

/** 국어 어휘 (낱말, 뜻) */
const KOREAN_WORDS: [string, string][] = [
  ['고즈넉하다', '고요하고 아늑하다'],
  ['미쁘다', '믿음성이 있다'],
  ['곰살궂다', '성질이 부드럽고 친절하다'],
  ['시나브로', '모르는 사이에 조금씩'],
  ['데면데면하다', '친밀감 없이 무심하다'],
  ['살갑다', '마음씨가 부드럽고 다정하다'],
  ['애오라지', '겨우, 오로지'],
  ['가없다', '끝이 없다'],
  ['헤살', '일을 짓궂게 훼방함'],
  ['너나들이', '서로 터놓고 허물없이 지내는 사이'],
  ['알음알음', '서로 아는 관계를 통해 이어짐'],
  ['도린곁', '사람이 별로 가지 않는 외진 곳'],
  ['에누리', '물건 값을 깎는 일'],
  ['마뜩잖다', '마음에 들 만하지 않다'],
  ['스스럼없다', '조심스럽거나 어려워하는 마음이 없다'],
  ['어슷비슷하다', '서로 큰 차이가 없이 비슷하다'],
]

/** 영단어 (단어, 뜻) */
const ENGLISH_WORDS: [string, string][] = [
  ['abandon', '버리다'],
  ['acquire', '얻다'],
  ['adequate', '충분한'],
  ['anticipate', '예상하다'],
  ['consistent', '일관된'],
  ['diminish', '줄어들다'],
  ['enhance', '높이다'],
  ['evident', '분명한'],
  ['inevitable', '피할 수 없는'],
  ['justify', '정당화하다'],
  ['obscure', '모호한'],
  ['persist', '지속되다'],
  ['reluctant', '꺼리는'],
  ['substantial', '상당한'],
  ['vulnerable', '취약한'],
  ['contemporary', '동시대의'],
]

/** sin θ = 짧은 변 / 빗변 이 되는 직각삼각형 (밑변, 높이, 빗변) */
const RIGHT_TRIANGLES: [number, number, number][] = [
  [3, 4, 5],
  [5, 12, 13],
  [8, 15, 17],
  [7, 24, 25],
  [20, 21, 29],
  [9, 40, 41],
]

/** 카드 제목으로 어느 단원 문제를 낼지 정합니다. 문제를 내지 않는 카드(듣기 · 독해 · 점검)는 null */
function unitOf(title: string): Unit | null {
  if (title.includes('영단어')) return 'english'
  if (title.includes('수학')) return /문제집|모의고사|오답/.test(title) ? 'sequence' : 'trig'
  if (title.includes('국어')) return 'korean'
  return null
}

/** 정답을 보기 4개 중 seed 번째 자리에 넣습니다. (정답이 늘 1번이면 찍어도 맞기 때문) */
function makeQuestion(
  question: string,
  answer: string,
  wrongs: string[],
  explanation: string,
  seed: number,
): QuizQuestion {
  const answerIndex = seed % 4
  const choices = wrongs.slice(0, 3)
  choices.splice(answerIndex, 0, answer)
  return { question, choices, answerIndex, explanation }
}

/** 등차수열 문제 40개. (첫째항 · 공차 · 몇째 항) 조합이 모두 달라서 문제 글이 겹치지 않습니다. */
function sequenceQuestions(): QuizQuestion[] {
  return Array.from({ length: 40 }, (_, k) => {
    const first = 2 + (k % 7)
    const diff = 3 + (k % 5)
    const n = 5 + (k % 6)
    const answer = first + (n - 1) * diff
    return makeQuestion(
      `첫째항이 ${first}, 공차가 ${diff}인 등차수열의 제${n}항은?`,
      String(answer),
      [String(answer + diff), String(answer - diff), String(answer + 1)],
      `제n항 = 첫째항 + (n−1)×공차 = ${first} + ${n - 1}×${diff} = ${answer}`,
      k,
    )
  })
}

/** 삼각함수 문제 24개. 직각삼각형 6개 × (sin 이 짧은 변 · 긴 변) × (cos · tan 묻기) */
function trigQuestions(): QuizQuestion[] {
  const list: QuizQuestion[] = []
  RIGHT_TRIANGLES.forEach(([a, b, c], index) => {
    for (const [p, q] of [
      [a, b],
      [b, a],
    ]) {
      const head = `θ가 예각이고 sin θ = ${p}/${c} 일 때`
      list.push(
        makeQuestion(
          `${head} cos θ 의 값은?`,
          `${q}/${c}`,
          [`${p}/${q}`, `${c}/${q}`, `${q}/${p}`],
          `cos θ = √(1 − sin²θ) = √(${c}² − ${p}²) / ${c} = ${q}/${c}`,
          index + p,
        ),
        makeQuestion(
          `${head} tan θ 의 값은?`,
          `${p}/${q}`,
          [`${q}/${p}`, `${q}/${c}`, `${c}/${p}`],
          `cos θ = ${q}/${c} 이라서 tan θ = sin θ / cos θ = ${p}/${q}`,
          index + q,
        ),
      )
    }
  })
  return list
}

/** 낱말 문제 32개: 앞 16개는 "뜻 고르기", 뒤 16개는 "낱말 고르기" (한 묶음에 같은 낱말이 두 번 나오지 않게) */
function vocabQuestions(pairs: [string, string][], wordName: string): QuizQuestion[] {
  // 틀린 보기는 5 · 10 · 15 칸 떨어진 낱말에서 가져옵니다. (16개라 자기 자신과 겹치지 않음)
  const othersOf = (index: number) =>
    [5, 10, 15].map((step) => pairs[(index + step) % pairs.length])
  const meaningFirst = pairs.map(([word, meaning], index) =>
    makeQuestion(
      `'${word}'의 뜻으로 알맞은 것은?`,
      meaning,
      othersOf(index).map(([, other]) => other),
      `${word} = ${meaning}`,
      index,
    ),
  )
  const wordFirst = pairs.map(([word, meaning], index) =>
    makeQuestion(
      `'${meaning}'라는 뜻의 ${wordName}는?`,
      word,
      othersOf(index).map(([other]) => other),
      `${meaning} = ${word}`,
      index + 2,
    ),
  )
  return [...meaningFirst, ...wordFirst]
}

/** 'YYYY-MM-DD' 두 날짜가 며칠 떨어졌는지 */
function daysBetween(fromKey: string, toKey: string): number {
  return Math.round(
    (new Date(`${toKey}T12:00:00`).getTime() - new Date(`${fromKey}T12:00:00`).getTime()) / DAY_MS,
  )
}

/** 결과 하나 (QuizResult 모양) */
function toResult(input: {
  id: string
  date: string
  at: number
  topic: string
  cardId: string | null
  questions: QuizQuestion[]
  answers: { choiceIndex: number; ms: number }[]
}): QuizResult {
  const correct = input.questions.filter(
    (question, index) => input.answers[index].choiceIndex === question.answerIndex,
  ).length
  // 단원(unit)은 비워 둡니다. 시연 데이터는 서버로 보내지 않습니다. (id 가 'demo-' 로 시작, lib/quizResultsApi.ts)
  return { ...input, unit: null, correct, guessed: false, isDemo: false }
}

/**
 * 시연용 확인 문제 결과를 만듭니다. (오래된 것부터)
 *
 *   buildDemoQuizResults({ sessions: persona.sessions, cards: persona.cards, todayKey, now })
 *     -> [{ id: 'demo-quiz-…', date: '2026-10-12', topic: '수학 삼각함수', … }, …]
 */
export function buildDemoQuizResults(input: {
  sessions: StudySession[]
  cards: Card[]
  todayKey: string
  now: number
}): QuizResult[] {
  const firstDay = moveDateKey(input.todayKey, -(QUIZ_DAYS - 1))
  const pools: Record<Unit, QuizQuestion[]> = {
    sequence: sequenceQuestions(),
    trig: trigQuestions(),
    korean: vocabQuestions(KOREAN_WORDS, '낱말'),
    english: vocabQuestions(ENGLISH_WORDS, '영어 단어'),
  }
  // 단원마다 몇 번째 문제까지 냈는지
  const used: Record<Unit, number> = { sequence: 0, trig: 0, korean: 0, english: 0 }
  const results: QuizResult[] = []
  // 날짜 → 그날 처음 풀어서 틀린 문제 (다음 날 아침에 다시 풉니다)
  const wrongByDate: Record<string, QuizQuestion[]> = {}

  const studySessions = input.sessions
    .filter((session) => session.kind !== 'play' && toDayKey(session.startedAt) >= firstDay)
    .sort((a, b) => a.startedAt - b.startedAt)

  for (const session of studySessions) {
    const card = input.cards.find((item) => item.id === session.cardId)
    const unit = card ? unitOf(card.title) : null
    if (!card || !unit) continue
    const random = createRandom(hashSeed(`quiz|${session.id}`))
    // 공부를 끝낼 때마다 문제를 푸는 건 아니라서 넷 중 셋만 풉니다.
    if (random() > 0.75) continue
    const questions = pools[unit].slice(used[unit], used[unit] + QUESTIONS_PER_QUIZ)
    if (questions.length < QUESTIONS_PER_QUIZ) continue
    used[unit] += QUESTIONS_PER_QUIZ

    const date = toDayKey(session.startedAt)
    // 0(2주 전) ~ 1(오늘): 날이 갈수록 조금씩 더 맞힙니다.
    const progress = daysBetween(firstDay, date) / (QUIZ_DAYS - 1)
    const skill = UNIT_SKILL[unit]
    // 맞힐 개수: 3 × (그날 실력) 을 반올림하되 ±0.5 만큼 흔들어 날마다 조금씩 다르게 합니다.
    const rightCount = Math.min(
      QUESTIONS_PER_QUIZ,
      Math.max(
        0,
        Math.round(QUESTIONS_PER_QUIZ * (skill.start + skill.gain * progress) + random() - 0.5),
      ),
    )
    // 틀릴 문제는 firstWrong 번째부터 차례로 고릅니다. (늘 마지막 문제만 틀리지 않게)
    const firstWrong = Math.floor(random() * QUESTIONS_PER_QUIZ)
    const wrongIndexes = Array.from(
      { length: QUESTIONS_PER_QUIZ - rightCount },
      (_, order) => (firstWrong + order) % QUESTIONS_PER_QUIZ,
    )
    const answers = questions.map((question, index) => {
      const isRight = !wrongIndexes.includes(index)
      // 영단어는 가끔 문제를 다 안 읽고 빨리 고르다 틀립니다. (리포트의 "빨리 풀고 틀림" 이 보이게)
      const isRush = !isRight && unit === 'english' && random() < 0.8
      const [min, max] = skill.seconds
      const seconds = isRush ? 4 + random() * 4 : min + random() * (max - min)
      return {
        choiceIndex: isRight ? question.answerIndex : (question.answerIndex + 1) % 4,
        ms: Math.round(seconds * 1000),
      }
    })
    const result = toResult({
      id: `${DEMO_ID_PREFIX}quiz-${session.id}`,
      date,
      at: session.endedAt + 5 * 60 * 1000,
      topic: UNIT_TOPICS[unit],
      cardId: card.id,
      questions,
      answers,
    })
    results.push(result)
    const wrong = questions.filter(
      (question, index) => answers[index].choiceIndex !== question.answerIndex,
    )
    wrongByDate[date] = [...(wrongByDate[date] ?? []), ...wrong]
  }

  // 틀린 문제는 다음 날 아침 7시 30분에 다시 풉니다. 아직 오지 않은 아침은 만들지 않습니다.
  for (const [date, wrong] of Object.entries(wrongByDate)) {
    if (wrong.length === 0) continue
    const nextDay = moveDateKey(date, 1)
    const at = new Date(`${nextDay}T07:30:00`).getTime()
    if (at > input.now) continue
    const random = createRandom(hashSeed(`quiz-retry|${date}`))
    const answers = wrong.map((question) => ({
      choiceIndex: random() < 0.75 ? question.answerIndex : (question.answerIndex + 2) % 4,
      ms: Math.round((15 + random() * 25) * 1000),
    }))
    results.push(
      toResult({
        id: `${DEMO_ID_PREFIX}quiz-retry-${nextDay}`,
        date: nextDay,
        at,
        topic: '어제 틀린 문제',
        cardId: null,
        questions: wrong,
        answers,
      }),
    )
  }

  return results.sort((a, b) => a.at - b.at)
}
