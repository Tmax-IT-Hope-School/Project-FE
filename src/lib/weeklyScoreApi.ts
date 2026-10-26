/**
 * 주간 점수 (BE #412, FE #660) 를 받아옵니다. 본인만 보는 점수입니다.
 *
 *   GET /weekly-scores/{weekStart}   weekStart = 그 주의 월요일 'YYYY-MM-DD' (로그인 필요)
 *     -> { weekStart, inProgress, score, accuracy, planRate, correctCount, totalCount,
 *          moreQuestionsNeeded, planNeeded, lastWeekScore, scoreChange }
 *
 * 점수 = (정답률 + 공부 달성률) ÷ 2 이고, 계산은 서버가 합니다.
 *   정답률: 확인 문제(quiz_results) + 사진 채점(애매 뺌). 기록 탭의 정답률과 같은 원천 · 같은 규칙입니다.
 *   공부 달성률: 그 주 카드 길이 합 대비 실제 공부 시간 (쉬는 날 뺌). 기록 탭의 "계획 대비 %" 와 같은 규칙입니다.
 *   (2026-10-26 BE 에서 옛 study_plans · 확인 문제만 쓰던 것을 바꿨습니다. STARFLOW E4)
 * 이 파일은 받은 값의 모양만 확인하고 다시 계산하지 않습니다. (두 곳에서 계산하면 숫자가 어긋나기 쉬움)
 */
import { queryOptions } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import { isDateKey } from '@/lib/date'

/** 서버가 오래 답하지 않으면 기다리지 않습니다. (다른 *Api.ts 와 같은 10초) */
const REQUEST_TIMEOUT_MS = 10000

export interface WeeklyScore {
  /** 그 주의 월요일 'YYYY-MM-DD' */
  weekStart: string
  /** 이번 주라서 오늘까지만 계산함 → 주중에 바뀜 */
  inProgress: boolean
  /** 0~100. null 이면 점수 대신 안내를 보여 줍니다 (0 으로 그리지 않기) */
  score: number | null
  /** 정답률 0~100. 푼 문제가 10개 미만이면 null */
  accuracy: number | null
  /** 공부 달성률 0~100. 계획이 없으면 null */
  planRate: number | null
  correctCount: number
  totalCount: number
  /** 0 보다 크면 "퀴즈 N문제 더 풀면 …" */
  moreQuestionsNeeded: number
  /** true 면 "이번 주 계획을 세우면 …" */
  planNeeded: boolean
  lastWeekScore: number | null
  /** 이번 − 지난. 어느 한쪽이 null 이면 null */
  scoreChange: number | null
}

/** 숫자이거나 null 이면 그대로, 아니면 undefined (모양이 틀림) */
function numberOrNull(value: unknown): number | null | undefined {
  if (value === null) return null
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * 서버 응답이 주간 점수 모양인지 확인합니다. 하나라도 틀리면 null 입니다.
 *
 *   toWeeklyScore({ weekStart: '2026-10-19', inProgress: true, score: 77, … }) -> { weekStart: '2026-10-19', … }
 *   toWeeklyScore({ weekStart: '2026-10-19', score: '77', … })                 -> null (점수가 글자)
 */
export function toWeeklyScore(value: unknown): WeeklyScore | null {
  if (typeof value !== 'object' || value === null) return null
  const item = value as Record<string, unknown>
  const score = numberOrNull(item.score)
  const accuracy = numberOrNull(item.accuracy)
  const planRate = numberOrNull(item.planRate)
  const lastWeekScore = numberOrNull(item.lastWeekScore)
  const scoreChange = numberOrNull(item.scoreChange)
  if (typeof item.weekStart !== 'string' || !isDateKey(item.weekStart)) return null
  if (typeof item.inProgress !== 'boolean' || typeof item.planNeeded !== 'boolean') return null
  if (
    score === undefined ||
    accuracy === undefined ||
    planRate === undefined ||
    lastWeekScore === undefined ||
    scoreChange === undefined
  ) {
    return null
  }
  if (
    typeof item.correctCount !== 'number' ||
    typeof item.totalCount !== 'number' ||
    typeof item.moreQuestionsNeeded !== 'number'
  ) {
    return null
  }
  return {
    weekStart: item.weekStart,
    inProgress: item.inProgress,
    score,
    accuracy,
    planRate,
    correctCount: item.correctCount,
    totalCount: item.totalCount,
    moreQuestionsNeeded: item.moreQuestionsNeeded,
    planNeeded: item.planNeeded,
    lastWeekScore,
    scoreChange,
  }
}

/** 그 주의 점수를 받아옵니다. 서버에 닿지 못하거나 거절하면 에러를 던집니다. */
export async function fetchWeeklyScore(weekStart: string): Promise<WeeklyScore> {
  const result = await api<unknown>(`/weekly-scores/${encodeURIComponent(weekStart)}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const score = toWeeklyScore(result)
  // 502: 서버가 이상한 모양의 답을 줬다는 뜻으로 씁니다.
  if (score === null) throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
  return score
}

/**
 * 주간 점수 쿼리 설정입니다. 화면에서는 useSuspenseQuery 로 받아옵니다. (docs/DATA-FETCHING.md)
 * 못 받으면 에러 대신 null("모름") 입니다. 그러면 화면은 점수 카드를 그리지 않습니다.
 * 테스트 로그인(서버가 모르는 토큰 → 401) · 서버 배포 전(404) · 연결 끊김에서도 통계 탭이 실패 안내로 바뀌지 않게 하려는 것입니다.
 */
export function weeklyScoreQuery(weekStart: string) {
  return queryOptions({
    queryKey: ['weekly-score', weekStart],
    queryFn: async (): Promise<WeeklyScore | null> => {
      try {
        return await fetchWeeklyScore(weekStart)
      } catch {
        return null
      }
    },
  })
}

/**
 * 지난주와의 차이 한 줄. 깎아내리지 않고 바뀐 만큼만 말합니다.
 *
 *   { score: 80, lastWeekScore: 75, scoreChange: 5 }      -> '지난주보다 +5'
 *   { score: 70, lastWeekScore: 75, scoreChange: -5 }     -> '지난주보다 -5'
 *   { score: 75, lastWeekScore: 75, scoreChange: 0 }      -> '지난주와 같아요'
 *   { score: 75, lastWeekScore: null, scoreChange: null } -> '지난주 점수는 없어요'
 *   { score: null, … }                                     -> ''   (이번 주 점수가 없으면 비교도 안 함)
 */
export function describeScoreChange(
  score: Pick<WeeklyScore, 'score' | 'lastWeekScore' | 'scoreChange'>,
): string {
  if (score.score === null) return ''
  if (score.lastWeekScore === null || score.scoreChange === null) return '지난주 점수는 없어요'
  if (score.scoreChange > 0) return `지난주보다 +${score.scoreChange}`
  if (score.scoreChange < 0) return `지난주보다 ${score.scoreChange}`
  return '지난주와 같아요'
}

/**
 * 점수가 나오려면 무엇이 더 필요한지 안내 줄들. 둘 다 모자라면 두 줄 모두입니다.
 *
 *   { moreQuestionsNeeded: 4, planNeeded: false } -> ['퀴즈 4문제 더 풀면 이번 주 점수가 나와요']
 *   { moreQuestionsNeeded: 0, planNeeded: true }  -> ['이번 주 계획을 세우면 점수가 나와요']
 *   { moreQuestionsNeeded: 0, planNeeded: false } -> []
 */
export function weeklyScoreGuides(
  score: Pick<WeeklyScore, 'moreQuestionsNeeded' | 'planNeeded'>,
): string[] {
  const lines: string[] = []
  // 정답률은 확인 문제와 사진 채점을 합쳐 세고, 달성률의 계획은 카드입니다. (BE STARFLOW E4, 기록 탭과 같은 원천)
  if (score.moreQuestionsNeeded > 0) {
    lines.push(
      `확인 문제나 사진 채점으로 ${score.moreQuestionsNeeded}문제 더 풀면 이번 주 점수가 나와요`,
    )
  }
  if (score.planNeeded) lines.push('이번 주 카드를 만들면 점수가 나와요')
  return lines
}
