/**
 * 수학 변형 문제(오답을 매일 변형해서 다시 풀기)에서 서버를 부르는 함수들입니다. (화면은 pages/VariantPage.tsx)
 *
 * 서버(BE)와 정한 약속입니다. (BE 저장소의 docs/API.md "변형 문제", docs/VARIANT-SPEC.md) 전부 로그인이 필요합니다.
 *   그날 과제     GET  /variant/daily?date=YYYY-MM-DD           -> 200 DailyVariants
 *   답 내기       POST /variant/assignments/{id}/attempts { answer, timeSpentSec } -> 200 AttemptResult
 *   주간 세트     GET  /variant/weekly?includeAnswers=false      -> 200 WeeklyVariants (가장 최근 세트, 없으면 404)
 *   오답노트      GET  /variant/review-items?status=active       -> 200 ReviewItem[]
 *
 * ⚠️ 서버는 답을 내기 전에는 정답 · 해설을 주지 않습니다. 화면도 답을 낸 뒤에만 보여 줍니다.
 * 문제 글의 수식은 $...$ 안의 LaTeX 이고, 선지는 처음부터 LaTeX 입니다. (화면에서 KaTeX 로 그림)
 */
import { ApiError, api } from '@/lib/api'
import { queryOptions } from '@tanstack/react-query'

/** 서버 응답을 기다리는 최대 시간(밀리초) */
const REQUEST_TIMEOUT_MS = 10000

/** 과제 상태: 아직 안 풂 · 풂 · 마감 지남 */
export type AssignmentStatus = 'pending' | 'answered' | 'expired'

/** 문제 형식: 5지선다 · 단답형(1~999 자연수) */
export type VariantFormat = 'mc5' | 'short'

/** 그날의 일일 과제 하나 */
export interface DailyItem {
  assignmentId: string
  /** -1 단계별 연습 · 0 다시 풀기 · 1 바꿔 풀기 */
  level: number
  format: VariantFormat
  /** 문제 글. 수식은 $...$ */
  problemText: string
  /** 선지 LaTeX 5개 (단답형이면 빈 목록) */
  choicesLatex: string[]
  status: AssignmentStatus
}

export interface DailyVariants {
  /** 'YYYY-MM-DD' (새벽 4시 기준 날짜) */
  date: string
  items: DailyItem[]
  /** 낼 차례지만 아직 서버가 문제를 만들지 못한 수 */
  preparingCount: number
}

/** 답을 낸 뒤의 채점 결과 */
export interface AttemptResult {
  isCorrect: boolean
  /** 5지선다는 정답 번호 '0' ~ '4', 단답형은 정답 숫자 */
  correctAnswer: string
  correctAnswerLatex: string
  /** 해설. 수식은 $...$ */
  solution: string
  /** 고른 오답이 어떤 실수인지 (맞았거나 단답형이면 null) */
  chosenDistractorRationale: string | null
  /** 이 답으로 바뀐 학습 항목 (주간 (A) 를 맞히면 null) */
  reviewItem: { id: string; status: ReviewItemStatus; currentLevel: number } | null
}

export interface WeeklyItem {
  number: number
  assignmentId: string
  /** a: 맞은 문제의 대표 유형 심화 · b: 극복한 오답의 심화 */
  source: 'a' | 'b'
  format: VariantFormat
  problemText: string
  choicesLatex: string[]
  status: AssignmentStatus
}

export interface WeeklyVariants {
  /** 돌아보는 주의 월요일 'YYYY-MM-DD'. 세트는 그다음 월요일 새벽에 만들어집니다 */
  weekStart: string
  /** 마감 날 'YYYY-MM-DD' (이날까지) */
  dueDate: string
  items: WeeklyItem[]
}

/** 학습 항목 상태: 매일 연습 중 · 졸업 · 심화까지 통과 */
export type ReviewItemStatus = 'active' | 'graduated' | 'mastered'

/** 오답노트 한 줄 */
export interface ReviewItem {
  id: string
  problemText: string | null
  unitName: string | null
  typeName: string | null
  status: ReviewItemStatus
  currentLevel: number
  /** 단계별 연습에서도 계속 틀림 */
  needsAttention: boolean
  /** 다음에 나올 날 'YYYY-MM-DD' (연습 중일 때만) */
  nextDueDate: string | null
}

// ---- 서버 응답 모양 확인 (서버 응답도 그대로 믿지 않고 확인합니다) ----

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isProblemFields(value: Record<string, unknown>): boolean {
  return (
    typeof value.assignmentId === 'string' &&
    (value.format === 'mc5' || value.format === 'short') &&
    typeof value.problemText === 'string' &&
    isStringList(value.choicesLatex) &&
    (value.status === 'pending' || value.status === 'answered' || value.status === 'expired')
  )
}

function isDailyVariants(value: unknown): value is DailyVariants {
  return (
    isObject(value) &&
    typeof value.date === 'string' &&
    typeof value.preparingCount === 'number' &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) => isObject(item) && typeof item.level === 'number' && isProblemFields(item),
    )
  )
}

function isWeeklyVariants(value: unknown): value is WeeklyVariants {
  return (
    isObject(value) &&
    typeof value.weekStart === 'string' &&
    typeof value.dueDate === 'string' &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        isObject(item) &&
        typeof item.number === 'number' &&
        (item.source === 'a' || item.source === 'b') &&
        isProblemFields(item),
    )
  )
}

function isAttemptResult(value: unknown): value is AttemptResult {
  return (
    isObject(value) &&
    typeof value.isCorrect === 'boolean' &&
    typeof value.correctAnswer === 'string' &&
    typeof value.correctAnswerLatex === 'string' &&
    typeof value.solution === 'string'
  )
}

function isReviewItems(value: unknown): value is ReviewItem[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isObject(item) &&
        typeof item.id === 'string' &&
        typeof item.status === 'string' &&
        typeof item.currentLevel === 'number',
    )
  )
}

/** 서버가 이상한 응답을 줬을 때 (502 를 그런 뜻으로 씁니다) */
function badResponse(): ApiError {
  return new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
}

// ---- 부르는 함수 ----

async function fetchDaily(): Promise<DailyVariants> {
  const result = await api<unknown>('/variant/daily', {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!isDailyVariants(result)) throw badResponse()
  return result
}

/** 오늘의 일일 과제 쿼리. (오늘 것만 보여 주므로 queryKey 에 날짜 대신 'today' 를 둡니다) */
export function dailyVariantsQuery() {
  return queryOptions({
    queryKey: ['variant', 'daily', 'today'],
    queryFn: fetchDaily,
    retry: false,
  })
}

/**
 * 가장 최근 주간 세트. 아직 하나도 만들어지지 않았으면(404) null 입니다. (없는 것은 실패가 아니라 "아직 없음" 이라서)
 * 주(week)를 보내지 않으면 서버가 가장 최근 세트를 줍니다. 그래서 화면이 요일 · 날짜를 계산하지 않아도 됩니다.
 */
async function fetchWeekly(): Promise<WeeklyVariants | null> {
  try {
    const result = await api<unknown>('/variant/weekly?includeAnswers=false', {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!isWeeklyVariants(result)) throw badResponse()
    return result
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

/** 가장 최근 주간 세트 쿼리 */
export function weeklyVariantsQuery() {
  return queryOptions({
    queryKey: ['variant', 'weekly', 'latest'],
    queryFn: fetchWeekly,
    retry: false,
  })
}

async function fetchReviewItems(): Promise<ReviewItem[]> {
  const result = await api<unknown>('/variant/review-items', {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!isReviewItems(result)) throw badResponse()
  return result
}

/** 오답노트 현황 (상태 전부) */
export function reviewItemsQuery() {
  return queryOptions({
    queryKey: ['variant', 'review-items'],
    queryFn: fetchReviewItems,
    retry: false,
  })
}

export interface AttemptInput {
  assignmentId: string
  /** 5지선다는 '0' ~ '4', 단답형은 숫자 글자 */
  answer: string
  /** 문제를 연 뒤 답을 낼 때까지 걸린 초 */
  timeSpentSec: number
}

/** 답을 내고 채점 결과를 받습니다. 실패하면 에러를 던집니다. (이미 답함 · 마감 지남은 409) */
export async function submitVariantAttempt(input: AttemptInput): Promise<AttemptResult> {
  const result = await api<unknown>(
    `/variant/assignments/${encodeURIComponent(input.assignmentId)}/attempts`,
    {
      method: 'POST',
      body: JSON.stringify({ answer: input.answer, timeSpentSec: input.timeSpentSec }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  )
  if (!isAttemptResult(result)) throw badResponse()
  return result
}

/** 레벨을 학생이 읽는 이름으로 */
export function levelLabel(level: number): string {
  if (level === -1) return '단계별 연습'
  if (level === 0) return '다시 풀기'
  if (level === 1) return '바꿔 풀기'
  return '심화'
}

/** 학습 항목 상태를 학생이 읽는 이름으로 */
export function reviewStatusLabel(status: ReviewItemStatus): string {
  if (status === 'graduated') return '극복'
  if (status === 'mastered') return '심화까지 통과'
  return '연습 중'
}

/**
 * 'YYYY-MM-DD' 를 'M월 D일' 로. 주간 세트의 주 · 마감 날을 보여 줄 때 씁니다.
 *
 *   shortDateLabel('2026-10-19') -> '10월 19일'
 */
export function shortDateLabel(dateKey: string): string {
  const [, month, day] = dateKey.split('-')
  return `${Number(month)}월 ${Number(day)}일`
}
