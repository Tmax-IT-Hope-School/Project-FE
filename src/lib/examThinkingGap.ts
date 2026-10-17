/**
 * 시험 전 2주의 "내 생각 vs 현실" 을 서버에서 받아옵니다. (BE PR #179)
 * 시험 결과 화면의 "내 생각 vs 시험 전 2주" 카드가 씁니다.
 *
 * 서버(BE)와 정한 약속입니다. (BE 저장소의 docs/API.md "생각 습관 테스트") 로그인이 필요합니다.
 *   GET /thinking-tests/exam-gap?examDate=2026-10-20  -> 200 ExamThinkingGap
 *                                                      -> 404 (아직 생각 습관 테스트를 하지 않음)
 *
 * 서버가 시험 14일 전 ~ 하루 전의 기록을 가장 최근 생각 습관 테스트와 견줍니다.
 *   - 테스트에서 꼽은 약점 ↔ 타이머를 멈추며 고른 이유 · 통화에서 말한 "어제 못 채운 이유"
 *   - 테스트의 "계획할 때(낙관)" ↔ 계획한 시간 중 실제로 공부한 비율
 * 숫자·판정·문장은 모두 서버의 코드가 만듭니다. (AI 안 씀) 화면은 문장(sentences)을 그대로 보여 줍니다.
 *
 * 시험 번호가 아니라 시험 날짜로 묻습니다. 시험이 아직 이 기기에만 저장돼서 서버에 시험 번호가 없기 때문입니다.
 */
import { ApiError, api } from '@/lib/api'
import { getAuthToken } from '@/lib/authStorage'
import { TEST_TOKEN } from '@/lib/testLogin'
import { queryOptions } from '@tanstack/react-query'

/** 서버 응답을 기다리는 최대 시간(밀리초) */
const REQUEST_TIMEOUT_MS = 10000

/** 시험 전 2주의 "내 생각 vs 현실". 화면에 쓰는 값만 적었습니다. (서버는 판정 목록도 함께 줍니다) */
export interface ExamThinkingGap {
  /** 견준 기간의 첫날 'YYYY-MM-DD' (시험 14일 전) */
  fromDate: string
  /** 견준 기간의 마지막 날 'YYYY-MM-DD' (시험 하루 전) */
  toDate: string
  /** 그만두거나 못 채운 이유가 3일 이상 남아 있어 판정을 믿을 만하면 true */
  enoughData: boolean
  /** 학생에게 보여 줄 문장들. 서버가 정해 둔 순서(더 지켜봐야 할 것 → 컸어 → 작았어 → 맞았어) 그대로입니다 */
  sentences: string[]
}

/** 서버가 준 값이 약속한 모양이 맞는지 확인합니다. (서버 응답도 그대로 믿지 않고 확인합니다) */
function isExamThinkingGap(value: unknown): value is ExamThinkingGap {
  if (typeof value !== 'object' || value === null) return false
  const gap = value as Record<string, unknown>
  return (
    typeof gap.fromDate === 'string' &&
    typeof gap.toDate === 'string' &&
    typeof gap.enoughData === 'boolean' &&
    Array.isArray(gap.sentences) &&
    gap.sentences.every((sentence) => typeof sentence === 'string')
  )
}

/** 받아옵니다. 아직 생각 습관 테스트를 안 했으면(404) 에러가 아니라 null 입니다. */
async function fetchExamThinkingGap(examDate: string): Promise<ExamThinkingGap | null> {
  // 테스트 로그인의 가짜 토큰은 서버가 모릅니다. 서버를 부르면 늘 401 이라, 부르지 않고 "아직 없음" 으로 둡니다.
  if (getAuthToken() === TEST_TOKEN) return null
  try {
    const result = await api<unknown>(
      `/thinking-tests/exam-gap?examDate=${encodeURIComponent(examDate)}`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    )
    // 502: 서버가 이상한 응답을 줬다는 뜻으로 씁니다.
    if (!isExamThinkingGap(result)) {
      throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
    }
    return result
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

/**
 * 시험 전 2주의 "내 생각 vs 현실" 쿼리 설정입니다. 화면에서는 useSuspenseQuery(examThinkingGapQuery(날짜)) 로 받아옵니다.
 * 시험 날짜가 다르면 다른 기간이라 queryKey 에 날짜를 넣습니다.
 */
export function examThinkingGapQuery(examDate: string) {
  return queryOptions({
    queryKey: ['exam-thinking-gap', examDate],
    queryFn: () => fetchExamThinkingGap(examDate),
    // 지난 2주의 기록이라 거의 바뀌지 않습니다. 5분 동안은 다시 받아오지 않습니다.
    staleTime: 5 * 60 * 1000,
  })
}
