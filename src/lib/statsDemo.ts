/**
 * 통계 탭(pages/StatsPage.tsx)에 쓰는 시연용 예시 데이터와 순수 함수입니다. (2026-10-24)
 *
 * ⚠️ 지금은 전부 예시 숫자입니다. 실제 퀴즈 결과에는 아직 '과목 · 단원' 정보가 없어서,
 *    단원 태그(서버 AI)가 준비되면 이 파일의 값을 실제 기록으로 바꿀 예정입니다.
 *
 * 점수 = 하루 끝 확인 시험 점수(정답률 %). 요일은 월 ~ 일, 배열의 0번이 월요일입니다.
 * React 를 쓰지 않아서 같은 입력이면 항상 같은 결과가 나옵니다.
 */

/** 그래프 가로축의 요일 (0 = 월요일) */
export const STATS_DAYS = ['월', '화', '수', '목', '금', '토', '일']

/** 예시 주간의 날짜 글자 (STATS_DAYS 와 같은 순서) */
export const STATS_DATES = [
  '10월 19일 (월)',
  '10월 20일 (화)',
  '10월 21일 (수)',
  '10월 22일 (목)',
  '10월 23일 (금)',
  '10월 24일 (토)',
  '10월 25일 (일)',
]

/** 예시 주간 이름 */
export const STATS_WEEK_LABEL = '10월 19일 ~ 10월 25일'

/** 이 점수(%) 보다 낮은 단원을 '취약' 으로 봅니다. */
export const WEAK_SCORE = 75

/** 단원 하나의 이번 주 기록 */
export interface StatsUnit {
  name: string
  /** 이번 주 평균 정답률 (%) */
  correct: number
  /** 이번 주 푼 문제 수 */
  solved: number
  /** 이번 주 공부 시간 (시간). 모르면 null (서버 기록에는 단원별 공부 시간이 없음) */
  hours: number | null
  /** 한 문제 푸는 데 걸린 평균 시간 (초) */
  speedSec: number
  /** 지난주보다 몇 초 달라졌는지. 음수면 빨라짐. 모르면 null */
  speedDeltaSec: number | null
  /** 그래프 선 · 막대 색 */
  color: string
  /** 요일별 점수 (월 ~ 일, 7개). 그날 푼 문제가 없으면 null */
  dailyScores: (number | null)[]
}

/** 일간 리포트 하나 */
export interface StatsReport {
  /** 몇 번째 요일인지 (0 = 월요일) */
  dayIndex: number
  /** 그날 점수 */
  score: number
  /** 전날보다 몇 점 달라졌는지 */
  delta: number
  /** AI 가 쓴 한두 문장 */
  note: string
  /** 과목마다 다른 기준의 숫자 두 개. 예) ['계산 실수', '1개'] */
  tags: [string, string][]
}

/** 과목 하나의 이번 주 기록 */
export interface StatsSubject {
  id: string
  name: string
  /** 그래프 선 · 점 색 (SVG 에 바로 씁니다) */
  color: string
  /** 요일별 점수 (월 ~ 일, 7개). 그날 푼 문제가 없으면 null */
  scores: (number | null)[]
  /** 요일별 공부 시간 (시간, 7개) */
  hours: number[]
  /** 지난주와 비교한 한 줄. 예) '지난주보다 +6점' */
  weekDelta: string
  /** AI 한 줄 정리 */
  summary: string
  /** 시간 대비 효과 */
  effect: string
  /** 이 과목의 일간 리포트가 무엇을 보는지 */
  reportFocus: string
  /** 단원 4개 (중 · 고등 공통으로 크게 나눔) */
  units: StatsUnit[]
  reports: StatsReport[]
}

/** 단원 선의 색. 과목을 골랐을 때 단원 4개를 이 순서로 칠합니다. (과목 색과 같은 4색) */
export const UNIT_COLORS = ['#e8590c', '#4f46e5', '#0c8a6c', '#d6336c']

/** 통계 탭이 그리는 데이터 한 벌 (시연용 예시든 서버든 같은 모양) */
export interface StatsData {
  /** true 면 시연용 예시 */
  isDemo: boolean
  /** 예) '10월 19일 ~ 10월 25일' */
  weekLabel: string
  /** 요일별 날짜 글자 7개. 예) '10월 23일 (금)' */
  dateLabels: string[]
  subjects: StatsSubject[]
  /** 요일별 전체 공부 시간 (시간, 7개). 과목이 없는 카드 타이머 기록도 들어 있습니다. */
  totalHours: number[]
  all: StatsAllText
}

/** 예시 데이터를 적을 때 쓰는 단원 모양 (색 · 요일별 점수는 아래 DEMO_STATS 에서 채움) */
type DemoUnit = Omit<StatsUnit, 'color' | 'dailyScores'>
type DemoSubject = Omit<StatsSubject, 'units'> & { units: DemoUnit[] }

function unit(
  name: string,
  correct: number,
  solved: number,
  hours: number,
  speedSec: number,
  speedDeltaSec: number,
): DemoUnit {
  return { name, correct, solved, hours, speedSec, speedDeltaSec }
}

const DEMO_SUBJECTS_RAW: DemoSubject[] = [
  {
    id: 'korean',
    name: '국어',
    color: '#e8590c',
    scores: [72, 75, 74, 78, 80, 79, 82],
    hours: [1.0, 1.2, 0.8, 1.5, 1.0, 2.0, 1.5],
    weekDelta: '지난주보다 +3점',
    summary:
      '문학은 안정적이야. 비문학 지문에서 시간이 오래 걸리고 많이 틀리니까, 하루 한 지문씩 시간 재고 푸는 연습을 넣어 보자.',
    effect:
      '비문학은 4시간 공부했는데 정답률 68%로 제자리예요. 읽기만 하기보다 지문 구조 정리 방식으로 바꿔 보는 걸 추천해요.',
    reportFocus: '국어는 지문 하나를 읽고 푸는 시간과, 시간이 모자라 틀린 문제를 따로 봐요.',
    units: [
      unit('문학', 82, 34, 5.0, 70, -6),
      unit('비문학', 68, 28, 4.0, 95, 3),
      unit('문법', 74, 19, 1.5, 40, -4),
      unit('화법과 작문', 90, 20, 1.0, 50, -2),
    ],
    reports: [
      {
        dayIndex: 4,
        score: 80,
        delta: 2,
        note: '문학 개념 문제는 다 맞혔어. 비문학 긴 지문 2개에서 시간 부족으로 틀렸어.',
        tags: [
          ['지문당 풀이', '4분 20초'],
          ['시간 부족 오답', '2개'],
        ],
      },
      {
        dayIndex: 5,
        score: 79,
        delta: -1,
        note: '문법 음운 변동에서 2개 틀렸어. 내일 퀴즈에 다시 낼게.',
        tags: [
          ['지문당 풀이', '4분 5초'],
          ['개념 오답', '2개'],
        ],
      },
      {
        dayIndex: 6,
        score: 82,
        delta: 3,
        note: '이번 주 최고 점수! 비문학 풀이 시간이 지난주보다 8초 빨라졌어.',
        tags: [
          ['지문당 풀이', '3분 52초'],
          ['시간 부족 오답', '1개'],
        ],
      },
    ],
  },
  {
    id: 'math',
    name: '수학',
    color: '#4f46e5',
    scores: [68, 70, 73, 71, 76, 80, 84],
    hours: [2.0, 2.5, 1.8, 2.2, 2.5, 3.0, 2.8],
    weekDelta: '지난주보다 +6점',
    summary:
      '함수는 이미 목표를 넘었어. 확률과 통계만 잡으면 수학 80점대가 안정될 거야. 남은 기간엔 확률과 통계 비중을 늘리자.',
    effect:
      '확률과 통계는 이번 주 4시간 공부했는데 정답률이 70%로 그대로예요. 개념 다시 보기보다 틀린 유형 위주 문제 풀이로 바꾸는 걸 추천해요.',
    reportFocus: '수학은 개념을 몰라서 틀렸는지, 계산 실수인지 나눠서 봐요.',
    units: [
      unit('수와 식', 88, 15, 2.0, 55, -1),
      unit('함수', 92, 40, 6.5, 48, -5),
      unit('도형', 84, 25, 3.0, 62, -3),
      unit('확률과 통계', 70, 30, 4.0, 85, 7),
    ],
    reports: [
      {
        dayIndex: 4,
        score: 76,
        delta: 5,
        note: '함수 10문제 중 9개 정답. 확률과 통계 경우의 수에서 2개 틀렸어.',
        tags: [
          ['개념 오답', '2개'],
          ['계산 실수', '1개'],
        ],
      },
      {
        dayIndex: 5,
        score: 80,
        delta: 4,
        note: '도형 넓이 문제가 좋아졌어. 경우의 수는 아직 헷갈리는 것 같아.',
        tags: [
          ['개념 오답', '1개'],
          ['계산 실수', '1개'],
        ],
      },
      {
        dayIndex: 6,
        score: 84,
        delta: 4,
        note: '3일 연속 상승! 확률과 통계 풀이 시간이 길어서 다음 주엔 시간 재고 풀어 보자.',
        tags: [
          ['개념 오답', '1개'],
          ['계산 실수', '0개'],
        ],
      },
    ],
  },
  {
    id: 'english',
    name: '영어',
    color: '#0c8a6c',
    scores: [85, 84, 88, 86, 89, 90, 91],
    hours: [1.0, 0.8, 1.0, 1.2, 0.5, 1.5, 1.0],
    weekDelta: '지난주보다 +2점',
    summary:
      '영어는 적은 시간으로도 꾸준히 오르고 있어. 문법만 조금 보완하고, 남는 시간은 수학에 써도 괜찮아.',
    effect: '영어는 하루 1시간 안팎으로 정답률이 올랐어요. 공부 시간을 조금 줄여도 괜찮아요.',
    reportFocus: '영어는 듣기 · 독해 · 문법 · 어휘 영역별 점수와 모르는 단어 수를 봐요.',
    units: [
      unit('독해', 90, 40, 3.5, 72, -4),
      unit('듣기', 95, 20, 1.0, 30, 0),
      unit('문법', 78, 18, 1.5, 45, -2),
      unit('어휘', 92, 25, 1.0, 15, -1),
    ],
    reports: [
      {
        dayIndex: 4,
        score: 89,
        delta: 3,
        note: '듣기는 만점이야. 문법 관계대명사에서 1개 틀렸어.',
        tags: [
          ['듣기', '100%'],
          ['모르는 단어', '6개'],
        ],
      },
      {
        dayIndex: 5,
        score: 90,
        delta: 1,
        note: '빈칸 추론 독해가 빨라졌어.',
        tags: [
          ['독해', '88%'],
          ['모르는 단어', '4개'],
        ],
      },
      {
        dayIndex: 6,
        score: 91,
        delta: 1,
        note: '안정적이야. 문법만 하루 10분씩 보자.',
        tags: [
          ['문법', '75%'],
          ['모르는 단어', '3개'],
        ],
      },
    ],
  },
  {
    id: 'science',
    name: '과학',
    color: '#d6336c',
    scores: [55, 58, 54, 60, 62, 61, 66],
    hours: [0.5, 1.0, 0.8, 0.5, 1.2, 1.5, 1.8],
    weekDelta: '지난주보다 +4점',
    summary:
      '과학이 가장 급해. 물리 정답률이 58%라서, 이번 주 계획에 물리 시간을 하루 30분씩 더 넣었어.',
    effect:
      '물리는 공부 시간 대비 오르는 속도가 느려요. 공식 암기보다 기본 문제를 반복해서 푸는 방식을 추천해요.',
    reportFocus: '과학은 공식을 잘못 골랐는지, 그래프 · 자료를 잘못 읽었는지 나눠서 봐요.',
    units: [
      unit('물리', 58, 30, 4.0, 110, 5),
      unit('화학', 66, 20, 2.5, 90, -6),
      unit('생명', 72, 12, 1.0, 80, -3),
      unit('지구', 62, 8, 0.5, 100, 2),
    ],
    reports: [
      {
        dayIndex: 4,
        score: 62,
        delta: 2,
        note: '화학 개념 문제가 좋아졌어. 물리 계산에서 실수가 많았어.',
        tags: [
          ['공식 선택 오답', '2개'],
          ['자료 해석 오답', '1개'],
        ],
      },
      {
        dayIndex: 5,
        score: 61,
        delta: -1,
        note: '물리 힘과 운동 문제 3개 틀렸어. 오답노트에 넣어 뒀어.',
        tags: [
          ['공식 선택 오답', '3개'],
          ['자료 해석 오답', '1개'],
        ],
      },
      {
        dayIndex: 6,
        score: 66,
        delta: 5,
        note: '물리 기본 문제를 반복한 효과가 보여! 이 방식 계속 가자.',
        tags: [
          ['공식 선택 오답', '1개'],
          ['자료 해석 오답', '1개'],
        ],
      },
    ],
  },
]

/** '전체' 를 골랐을 때 보여 주는 글의 모양 */
export interface StatsAllText {
  weekDelta: string
  summary: string
  effect: string
  reportFocus: string
  reports: StatsReport[]
}

/** '전체' 를 골랐을 때 보여 주는 글 (모든 과목을 합쳐서 본 것) */
export const DEMO_STATS_ALL: StatsAllText = {
  weekDelta: '지난주보다 +4점',
  summary:
    '이번 주는 네 과목 모두 올랐어! 영어 · 수학은 목표에 가깝고, 과학이 가장 급해. 다음 주 계획은 과학 비중을 늘리고 영어는 조금 줄였어.',
  effect:
    '수학은 공부 시간이 가장 길고 점수도 가장 많이 올랐어요. 과학은 시간을 늘렸는데 아직 60점대라 공부 방법을 바꿔 볼 때예요.',
  reportFocus: '전체는 그날 가장 많이 오른 과목과 가장 주의할 과목을 보여 줘요.',
  reports: [
    {
      dayIndex: 4,
      score: 77,
      delta: 3,
      note: '수학 함수 문제를 거의 다 맞혔어. 과학 물리 계산 실수가 아쉬워.',
      tags: [
        ['가장 오른 과목', '수학 +5'],
        ['주의 과목', '과학'],
      ],
    },
    {
      dayIndex: 5,
      score: 78,
      delta: 1,
      note: '국어 · 과학이 조금 내려갔지만 수학이 계속 오르는 중이야.',
      tags: [
        ['가장 오른 과목', '수학 +4'],
        ['주의 과목', '국어'],
      ],
    },
    {
      dayIndex: 6,
      score: 81,
      delta: 3,
      note: '이번 주 최고 점수! 네 과목 모두 올랐어.',
      tags: [
        ['가장 오른 과목', '과학 +5'],
        ['주의 과목', '과학'],
      ],
    },
  ],
}

/**
 * 숫자들의 평균을 반올림해서 돌려줍니다. 빈 배열이면 0
 *
 *   average([70, 80, 90]) -> 80
 */
export function average(values: number[]): number {
  if (values.length === 0) return 0
  const total = values.reduce((sum, value) => sum + value, 0)
  return Math.round(total / values.length)
}

/** 숫자들을 다 더합니다. */
export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

/**
 * 모든 과목의 요일별 평균 점수 (그래프의 검은 '전체 평균' 선)
 *
 * 그날 점수가 있는 과목만 평균 냅니다. 아무 과목도 없으면 null
 *
 *   allSubjectsAverage(예시 과목들) -> [70, 72, 72, 74, 77, 78, 81]
 */
export function allSubjectsAverage(subjects: StatsSubject[]): (number | null)[] {
  return STATS_DAYS.map((_, dayIndex) => {
    const scores = subjects.map((s) => s.scores[dayIndex]).filter((score) => score !== null)
    return scores.length > 0 ? average(scores) : null
  })
}

/** 점수 목록에서 null 을 빼고 평균. 하나도 없으면 null */
export function averageOrNull(values: (number | null)[]): number | null {
  const numbers = values.filter((value) => value !== null)
  return numbers.length > 0 ? average(numbers) : null
}

// 단원별 요일 점수의 오르내림 모양입니다. (예시 데이터라 단원의 주간 평균에서 만들어 냅니다)
const UNIT_WAVES = [
  [-5, -3, -2, 0, 1, 3, 6],
  [-2, -1, 0, 1, 0, 1, 2],
  [-4, -2, -3, 0, 2, 3, 4],
  [-6, -4, -5, -1, 1, 2, 5],
]

/**
 * 단원 하나의 요일별 점수를 만듭니다. 평균이 단원의 정답률(correct)과 비슷하게 나옵니다. (예시용)
 * unitIndex 는 과목 안에서 몇 번째 단원인지 (0 ~ 3)
 */
export function unitDailyScores(unitData: Pick<StatsUnit, 'correct'>, unitIndex: number): number[] {
  const wave = UNIT_WAVES[unitIndex % UNIT_WAVES.length]
  const waveAverage = sum(wave) / wave.length
  return wave.map((offset) =>
    Math.max(0, Math.min(100, Math.round(unitData.correct + offset - waveAverage))),
  )
}

/**
 * 시간(소수)을 'N시간 M분' 글자로 바꿉니다.
 *
 *   formatHours(2.5)  -> '2시간 30분'
 *   formatHours(3)    -> '3시간'
 *   formatHours(0.25) -> '15분'
 */
export function formatHours(hours: number): string {
  const totalMinutes = Math.round(hours * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m}분`
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`
}

/**
 * 풀이 속도가 지난주보다 어떻게 달라졌는지 글자로 바꿉니다.
 *
 *   formatSpeedDelta(-5) -> '5초 빨라짐'
 *   formatSpeedDelta(3)  -> '3초 느려짐'
 *   formatSpeedDelta(0)  -> '그대로'
 */
export function formatSpeedDelta(deltaSec: number): string {
  if (deltaSec === 0) return '그대로'
  return deltaSec < 0 ? `${Math.abs(deltaSec)}초 빨라짐` : `${deltaSec}초 느려짐`
}

/** 시연용 예시 과목 (단원마다 색과 요일별 점수를 채운 것) */
export const DEMO_STATS_SUBJECTS: StatsSubject[] = DEMO_SUBJECTS_RAW.map((subject) => ({
  ...subject,
  units: subject.units.map((item, index) => ({
    ...item,
    color: UNIT_COLORS[index % UNIT_COLORS.length],
    dailyScores: unitDailyScores(item, index),
  })),
}))

/** 통계 탭의 시연용 예시 한 벌 (테스트 로그인) */
export const DEMO_STATS: StatsData = {
  isDemo: true,
  weekLabel: STATS_WEEK_LABEL,
  dateLabels: STATS_DATES,
  subjects: DEMO_STATS_SUBJECTS,
  totalHours: STATS_DAYS.map((_, dayIndex) =>
    sum(DEMO_STATS_SUBJECTS.map((subject) => subject.hours[dayIndex])),
  ),
  all: DEMO_STATS_ALL,
}
