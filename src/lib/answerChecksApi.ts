/**
 * "사진 채점" 의 서버 약속 · 타입 · 함수를 모아 둔 곳입니다. (2026-10-24)
 * 화면은 pages/AnswerCheckPage.tsx(폰에서 찍어 올리기)와 components/ui/AnswerCheckCard.tsx(통계 탭의 결과)입니다.
 *
 * 흐름: PC 통계 탭에서 QR 을 띄움 → 폰으로 찍어 올림(POST) → PC 가 3초마다 오늘 결과를 물어봄(GET) → 결과 카드
 *
 * 서버와 정한 약속 (BE, 로그인 필요 · 계약 초안 v1.1) — 약속이 바뀌면 이 파일만 고치면 됩니다.
 *   POST  /answer-checks                         { mode, image: 'data:image/jpeg;base64,…', date: '2026-10-24' }
 *   GET   /answer-checks?date=2026-10-24         → AnswerCheckResponse[] (최신 먼저)
 *   PATCH /answer-checks/{id}/items/{itemId}     { result, correctAnswer: 'x = 7' | null } → AnswerCheckResponse
 *
 *   AnswerCheckResponse = { showHelp, graded, reason, id, date, mode, subjectText, counts, items, createdAt }
 *     - graded 가 false 면 채점을 못 한 것입니다. (reason: NOT_PROBLEM = 문제를 못 읽음 · UNAVAILABLE = 지금은 못 함)
 *       이때 id · items 는 null 입니다.
 *     - showHelp 가 true 면 사진의 글에 위기 표현이 있어서, 화면이 상담 전화 안내를 먼저 보여 줍니다.
 *
 * mode: MARKED = "채점했어요" (O · X 표시를 읽음) / UNMARKED = "아직 안 했어요" (AI 가 풂)
 * 사진을 여러 장 고르면 사진마다 POST 를 한 번씩 부릅니다. (사진 1장 = 채점 결과 1개, 서버 약속은 그대로)
 *
 * ⚠️ 사진은 어디에도 저장하지 않습니다. 브라우저 저장소에도 넣지 않고, 서버도 채점 뒤 버립니다.
 * 테스트 로그인(서버 없음)이면 서버 대신 시연용 예시를 이 기기(브라우저 저장소)에 만들어 씁니다. 사진은 여기에도 넣지 않습니다.
 */
import { queryOptions } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import { isServerDataMode } from '@/lib/dataMode'
import { loadData, saveData } from '@/lib/storage'

/**
 * 서버는 AI 채점을 25초까지 기다리고, "채점했어요" 에서 O · X 를 하나도 못 읽으면 한 번 더 물어봅니다. (BE #464)
 * 그래서 길면 50초쯤 걸려서, 사진을 보내는 시간까지 넉넉히 65초 기다립니다. (2026-10-27, 전에는 40초)
 */
const SEND_TIMEOUT_MS = 65_000

/** 어떤 사진인지. MARKED = 채점했어요 · UNMARKED = 아직 안 했어요 */
export type AnswerCheckMode = 'MARKED' | 'UNMARKED'

/** 문제 하나의 결과. 맞음 · 틀림 · 애매 */
export type AnswerResult = 'CORRECT' | 'WRONG' | 'UNSURE'

/** 채점을 못 한 까닭. NOT_PROBLEM = 문제를 못 읽음 · UNAVAILABLE = 지금은 채점할 수 없음 */
export type NotGradedReason = 'NOT_PROBLEM' | 'UNAVAILABLE'

/** 문제 한 줄 */
export interface AnswerCheckItem {
  id: string
  /** 문제 번호 (예: '1', '3-2') */
  number: string
  /** 내가 적은 답. 못 읽었으면 null */
  myAnswer: string | null
  /** AI 가 푼 답 (UNMARKED 만). 없으면 null */
  aiAnswer: string | null
  /** 사진에서 읽은 O · X 표시 (MARKED 만). 못 읽었으면 null */
  markRead: 'O' | 'X' | null
  result: AnswerResult
  /** 학생이 직접 적은 정답. 없으면 null */
  correctAnswer: string | null
  /** 학생이 [고치기] 로 바꾼 문제인지 */
  editedByUser: boolean
}

export interface AnswerCheckCounts {
  correct: number
  wrong: number
  unsure: number
}

/** 채점 결과 한 장 (사진 한 장 = 결과 한 장) */
export interface AnswerCheck {
  id: string
  /** 'YYYY-MM-DD' */
  date: string
  mode: AnswerCheckMode
  /** AI 가 읽은 과목 (예: '수학'). 못 읽었으면 null */
  subjectText: string | null
  counts: AnswerCheckCounts
  items: AnswerCheckItem[]
  /** 서버가 만든 시각 (ISO) */
  createdAt: string
}

/** 사진을 보낸 뒤의 답 */
export interface AnswerCheckSendResult {
  /** true 면 상담 전화 안내를 먼저 보여 줍니다. */
  showHelp: boolean
  /** 채점한 결과. 채점을 못 했으면 null */
  check: AnswerCheck | null
  /** 채점을 못 한 까닭. 채점했으면 null */
  reason: NotGradedReason | null
}

// ---------------------------------------------------------------------------
// 서버 응답 확인 (서버가 준 값도 그대로 믿지 않고 모양을 확인합니다)
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** 글자면 앞뒤 빈칸을 지워서, 빈 글자 · 글자가 아니면 null */
function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** 숫자(123)로 와도 글자('123')로 바꿉니다. id 를 글자로 통일하려는 것입니다. */
function asId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return asText(value)
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

function isResult(value: unknown): value is AnswerResult {
  return value === 'CORRECT' || value === 'WRONG' || value === 'UNSURE'
}

function toItem(value: unknown): AnswerCheckItem | null {
  const record = asRecord(value)
  const id = asId(record.id)
  const number = asId(record.number)
  if (id === null || number === null || !isResult(record.result)) return null
  return {
    id,
    number,
    myAnswer: asText(record.myAnswer),
    aiAnswer: asText(record.aiAnswer),
    markRead: record.markRead === 'O' || record.markRead === 'X' ? record.markRead : null,
    result: record.result,
    correctAnswer: asText(record.correctAnswer),
    editedByUser: record.editedByUser === true,
  }
}

/** 서버의 결과 한 장을 확인합니다. 채점하지 못한 것(id 없음)이거나 모양이 틀리면 null */
function toAnswerCheck(value: unknown): AnswerCheck | null {
  const record = asRecord(value)
  const id = asId(record.id)
  const date = asText(record.date)
  if (id === null || date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  if (record.mode !== 'MARKED' && record.mode !== 'UNMARKED') return null
  if (!Array.isArray(record.items)) return null
  const counts = asRecord(record.counts)
  return {
    id,
    date,
    mode: record.mode,
    subjectText: asText(record.subjectText),
    counts: {
      correct: asCount(counts.correct),
      wrong: asCount(counts.wrong),
      unsure: asCount(counts.unsure),
    },
    items: record.items.map(toItem).filter((item): item is AnswerCheckItem => item !== null),
    createdAt: asText(record.createdAt) ?? '',
  }
}

/** POST 의 답을 확인합니다. */
function toSendResult(value: unknown): AnswerCheckSendResult {
  const record = asRecord(value)
  const showHelp = record.showHelp === true
  const check = record.graded === true ? toAnswerCheck(record) : null
  if (check !== null) return { showHelp, check, reason: null }
  // 채점을 못 했습니다. 모르는 까닭이면 "지금은 못 함" 으로 봅니다.
  const reason: NotGradedReason = record.reason === 'NOT_PROBLEM' ? 'NOT_PROBLEM' : 'UNAVAILABLE'
  return { showHelp, check: null, reason }
}

// ---------------------------------------------------------------------------
// 화면에서 쓰는 계산
// ---------------------------------------------------------------------------

/** 문제들의 맞음 · 틀림 · 애매 개수를 셉니다. ([고치기] 중에 바꾼 값으로 바로 다시 셀 때 씁니다) */
export function countResults(results: AnswerResult[]): AnswerCheckCounts {
  return {
    correct: results.filter((result) => result === 'CORRECT').length,
    wrong: results.filter((result) => result === 'WRONG').length,
    unsure: results.filter((result) => result === 'UNSURE').length,
  }
}

// ---------------------------------------------------------------------------
// 테스트 로그인(서버 없음)용 시연 예시
// ---------------------------------------------------------------------------

/** 시연 예시를 날짜별로 넣어 두는 저장소 이름. 사진은 넣지 않고, 정해 둔 예시 결과만 넣습니다. */
const DEMO_STORAGE_KEY = 'answer-checks-demo'

function loadDemoChecks(): Record<string, AnswerCheck[]> {
  const saved = loadData<unknown>(DEMO_STORAGE_KEY, {})
  const byDate: Record<string, AnswerCheck[]> = {}
  for (const [date, list] of Object.entries(asRecord(saved))) {
    if (!Array.isArray(list)) continue
    byDate[date] = list.map(toAnswerCheck).filter((check): check is AnswerCheck => check !== null)
  }
  return byDate
}

/** 정해 둔 시연용 결과 한 장을 만듭니다. (사진은 읽지 않습니다) */
function makeDemoCheck(mode: AnswerCheckMode, date: string): AnswerCheck {
  const id = `demo-${Date.now()}`
  const items: AnswerCheckItem[] =
    mode === 'MARKED'
      ? [
          { number: '1', markRead: 'O' as const, result: 'CORRECT' as const },
          { number: '2', markRead: 'O' as const, result: 'CORRECT' as const },
          { number: '3', markRead: 'X' as const, result: 'WRONG' as const },
          { number: '4', markRead: null, result: 'UNSURE' as const },
        ].map((item, index) => ({
          ...item,
          id: `${id}-${index}`,
          myAnswer: null,
          aiAnswer: null,
          correctAnswer: null,
          editedByUser: false,
        }))
      : [
          { number: '1', myAnswer: 'x = 5', aiAnswer: 'x = 5', result: 'CORRECT' as const },
          { number: '2', myAnswer: 'x = 6', aiAnswer: 'x = 7', result: 'WRONG' as const },
          { number: '3', myAnswer: '12', aiAnswer: '12', result: 'CORRECT' as const },
          { number: '4', myAnswer: '-3', aiAnswer: null, result: 'UNSURE' as const },
        ].map((item, index) => ({
          ...item,
          id: `${id}-${index}`,
          markRead: null,
          correctAnswer: null,
          editedByUser: false,
        }))
  return {
    id,
    date,
    mode,
    subjectText: '수학',
    counts: countResults(items.map((item) => item.result)),
    items,
    createdAt: new Date().toISOString(),
  }
}

/** 시연 예시도 진짜처럼 잠깐 기다렸다가 답합니다. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// 서버 부르기
// ---------------------------------------------------------------------------

/**
 * 여러 일을 limit 개까지만 동시에 합니다. 하나가 끝나면 남은 것 중 다음 것을 시작합니다.
 * 사진 여러 장을 한꺼번에 보내면 장마다 25초쯤 걸리는 AI 채점이 겹치고 폰 데이터도 몰려서, 몇 장씩만 보냅니다.
 * task 가 에러를 던지지 않게 쓰는 쪽에서 장마다 잡아야, 한 장이 실패해도 나머지를 계속 보냅니다.
 *
 *   runWithLimit([사진1, 사진2, 사진3], 2, sendOne)
 *   → 사진1 · 사진2 를 보내고, 둘 중 먼저 끝난 자리에서 사진3 을 보냅니다.
 */
export async function runWithLimit<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  // 다음에 보낼 차례 (여러 일꾼이 같이 보고 하나씩 가져갑니다)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < items.length) {
      const item = items[nextIndex]
      nextIndex += 1
      await task(item)
    }
  }
  const workerCount = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
}

/** 찍은 사진(줄인 data URL)을 보내 채점을 부탁합니다. */
export async function sendAnswerCheck(input: {
  mode: AnswerCheckMode
  image: string
  date: string
}): Promise<AnswerCheckSendResult> {
  if (!isServerDataMode()) {
    await wait(1500)
    const check = makeDemoCheck(input.mode, input.date)
    const byDate = loadDemoChecks()
    byDate[input.date] = [check, ...(byDate[input.date] ?? [])]
    saveData(DEMO_STORAGE_KEY, byDate)
    return { showHelp: false, check, reason: null }
  }

  const result = await api<unknown>('/answer-checks', {
    method: 'POST',
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  })
  return toSendResult(result)
}

/** 그날의 채점 결과를 최신 것부터 받아옵니다. */
export async function fetchAnswerChecks(date: string): Promise<AnswerCheck[]> {
  if (!isServerDataMode()) return loadDemoChecks()[date] ?? []

  try {
    const result = await api<unknown>(`/answer-checks?date=${encodeURIComponent(date)}`)
    if (!Array.isArray(result)) throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
    return result.map(toAnswerCheck).filter((check): check is AnswerCheck => check !== null)
  } catch (error) {
    // 서버에 이 기능이 아직 배포되지 않았으면 404 입니다. 통계 탭 전체에 실패 안내를 띄우지 않고 "결과 없음" 으로 봅니다.
    if (error instanceof ApiError && error.status === 404) return []
    throw error
  }
}

/**
 * from ~ to(둘 다 포함) 동안의 채점 결과를 한 번에 받아옵니다. 기록 탭의 주간 리포트(정답률)가 씁니다.
 * 서버는 한 번에 31일까지 줍니다. (BE GET /answer-checks?from=&to=, Project-BE#377)
 * 기간 조회가 아직 배포되지 않은 서버(400 · 404)면 리포트 전체에 실패 안내를 띄우지 않고 "결과 없음" 으로 봅니다.
 */
export async function fetchAnswerChecksBetween(from: string, to: string): Promise<AnswerCheck[]> {
  if (!isServerDataMode()) {
    const byDate = loadDemoChecks()
    return Object.entries(byDate)
      .filter(([date]) => date >= from && date <= to)
      .flatMap(([, checks]) => checks)
  }

  try {
    const result = await api<unknown>(
      `/answer-checks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    )
    if (!Array.isArray(result)) throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
    return result.map(toAnswerCheck).filter((check): check is AnswerCheck => check !== null)
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 404)) return []
    throw error
  }
}

/** 문제 하나의 결과를 학생이 고칩니다. 고친 뒤의 결과 한 장을 돌려줍니다. */
export async function fixAnswerCheckItem(input: {
  checkId: string
  itemId: string
  result: AnswerResult
  correctAnswer: string | null
}): Promise<AnswerCheck | null> {
  if (!isServerDataMode()) {
    const byDate = loadDemoChecks()
    let fixed: AnswerCheck | null = null
    for (const date of Object.keys(byDate)) {
      byDate[date] = byDate[date].map((check) => {
        if (check.id !== input.checkId) return check
        const items = check.items.map((item) =>
          item.id === input.itemId
            ? {
                ...item,
                result: input.result,
                correctAnswer: input.correctAnswer,
                editedByUser: true,
              }
            : item,
        )
        fixed = { ...check, items, counts: countResults(items.map((item) => item.result)) }
        return fixed
      })
    }
    saveData(DEMO_STORAGE_KEY, byDate)
    return fixed
  }

  const result = await api<unknown>(
    `/answer-checks/${encodeURIComponent(input.checkId)}/items/${encodeURIComponent(input.itemId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ result: input.result, correctAnswer: input.correctAnswer }),
    },
  )
  return toAnswerCheck(result)
}

/** 그날 채점 결과 쿼리. 통계 탭의 결과 카드와 QR 창(3초마다 다시 묻기)이 같이 씁니다. */
export function answerChecksQuery(date: string) {
  return queryOptions({
    queryKey: ['answer-checks', date],
    queryFn: () => fetchAnswerChecks(date),
  })
}

/** 기간 채점 결과 쿼리. 기록 탭의 주간 리포트가 지난주 ~ 이번 주(14일)를 한 번에 받습니다. */
export function answerChecksBetweenQuery(from: string, to: string) {
  return queryOptions({
    queryKey: ['answer-checks', from, to],
    queryFn: () => fetchAnswerChecksBetween(from, to),
  })
}
