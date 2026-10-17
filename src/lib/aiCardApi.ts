import { queryOptions } from '@tanstack/react-query'
import { ApiError, api } from '@/lib/api'
import { isServerDataMode } from '@/lib/dataMode'

/**
 * 카드에 쓰는 작은 AI 기능을 서버에 부탁합니다. (#413, BE `POST /ai/checklist` · `POST /ai/first-step`)
 * AI 키는 서버에만 있고, 글 모델은 gpt-6-luna 입니다. 숫자 판정에는 쓰지 않고 문장만 받습니다.
 *
 * - 테스트 로그인(가짜 토큰)이면 서버에 묻지 않고 null 을 돌려줍니다. 화면은 기본 문장(템플릿)을 씁니다.
 * - 서버가 null 을 주거나(AI 가 못 만듦 · 하루 한도) 연결이 안 되면 역시 null → 기본 문장
 * - showHelp 가 true 면 글에 위기 표현이 있어서 AI 를 쓰지 않은 것입니다. 이때는 AI_SHOW_HELP_EVENT 를 보내서
 *   도움 연결 안내(components/layout/AiHelpListener)를 띄우고 null 을 돌려줍니다.
 */

/** AI 도우미가 "글에 위기 표현이 있다(showHelp)" 고 알릴 때 보내는 이벤트 이름입니다. */
export const AI_SHOW_HELP_EVENT = 'study-ai-show-help'

/** 서버가 showHelp 를 주면 도움 안내를 띄우라고 알리고 true 를 돌려줍니다. */
function handleShowHelp(record: Record<string, unknown>): boolean {
  if (record.showHelp !== true) return false
  window.dispatchEvent(new Event(AI_SHOW_HELP_EVENT))
  return true
}

/** 서버가 GPT 를 최대 10초 기다리므로 그보다 조금 더 기다립니다. 카운트다운은 그동안 기본 문장으로 갑니다. */
const REQUEST_TIMEOUT_MS = 12000

export interface FirstStepRequest {
  /** 체크리스트 첫 항목 (100자까지) */
  item: string
  /** 카드 제목 */
  title?: string
  /** [더 작게] 를 누른 횟수 0 ~ 2 */
  level: number
  /** [더 작게] 를 누르기 전에 보여 준 행동 (40자까지) */
  previousStep?: string
}

/**
 * 체크리스트 첫 항목을 아주 작은 준비 행동 하나로 바꿔 달라고 합니다. 못 받으면 null.
 *
 *   await requestFirstStep({ item: '42~45쪽 문제 풀기', title: '수학 문제집', level: 0 })
 *     -> '수학 문제집 42쪽 펴기'   (테스트 로그인 · AI 꺼짐 · 실패면 null)
 */
export async function requestFirstStep(input: FirstStepRequest): Promise<string | null> {
  if (!isServerDataMode()) return null
  const item = input.item.trim().slice(0, 100)
  if (item === '') return null
  try {
    const result = await api<unknown>('/ai/first-step', {
      method: 'POST',
      body: JSON.stringify({
        item,
        ...(input.title ? { title: input.title.slice(0, 200) } : {}),
        level: Math.min(2, Math.max(0, input.level)),
        ...(input.previousStep ? { previousStep: input.previousStep.slice(0, 40) } : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const record = (typeof result === 'object' && result !== null ? result : {}) as Record<
      string,
      unknown
    >
    if (handleShowHelp(record)) return null
    return typeof record.step === 'string' && record.step.trim() !== '' ? record.step.trim() : null
  } catch (error) {
    // 401 은 api() 가 이미 로그인 화면으로 보냅니다. 그 밖의 실패는 기본 문장으로 조용히 넘어갑니다.
    if (error instanceof ApiError && error.status === 401) throw error
    return null
  }
}

/**
 * 카드 제목(과 목표)으로 체크리스트 항목을 추천받습니다. 못 받으면 null. (카드 폼 #392 에서 씁니다)
 *
 *   await requestChecklist('수학 문제집') -> ['42~45쪽 문제 풀기', '틀린 문제 표시하기', '채점하기']
 */
export async function requestChecklist(title: string, goal?: string): Promise<string[] | null> {
  if (!isServerDataMode()) return null
  const trimmed = title.trim().slice(0, 200)
  if (trimmed === '') return null
  try {
    const result = await api<unknown>('/ai/checklist', {
      method: 'POST',
      body: JSON.stringify({ title: trimmed, ...(goal ? { goal: goal.slice(0, 100) } : {}) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const record = (typeof result === 'object' && result !== null ? result : {}) as Record<
      string,
      unknown
    >
    if (handleShowHelp(record) || !Array.isArray(record.items)) return null
    const items = record.items.filter(
      (value): value is string => typeof value === 'string' && value.trim() !== '',
    )
    return items.length > 0 ? items : null
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error
    return null
  }
}

/** 예상 실패 원인 선지 하나 (BE `POST /ai/fail-cause-options`) */
export interface FailCauseOption {
  /** 원인 이름 (체크인의 못 채운 이유와 같은 글자, 예: 'phone') */
  reason: string
  /** 이 카드에서 일어날 법한 장면 한 구절 (30자까지) */
  text: string
  /** 내 행동에서 나오는 원인인지 (폰·SNS · 하기 싫음). 코드(서버)가 정합니다 */
  inner: boolean
}

/**
 * 카드 제목으로 "이번에 못 한다면 무엇 때문일지" 선지 3개를 받습니다. (#419 표 3번)
 * 어떤 원인을 고를지는 서버가 내 최근 30일 기록으로 정하고, AI 는 문장만 씁니다.
 * 기록이 모자라거나(3일 미만) 못 받으면 null → 화면은 주관식 그대로입니다.
 *
 *   await requestFailCauseOptions('수학 문제집')
 *     -> [{ reason: 'phone', text: '문제 막힐 때 폰부터 집기', inner: true }, …]   (못 받으면 null)
 */
export async function requestFailCauseOptions(title: string): Promise<FailCauseOption[] | null> {
  if (!isServerDataMode()) return null
  const trimmed = title.trim().slice(0, 200)
  if (trimmed === '') return null
  try {
    const result = await api<unknown>('/ai/fail-cause-options', {
      method: 'POST',
      body: JSON.stringify({ title: trimmed }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const record = (typeof result === 'object' && result !== null ? result : {}) as Record<
      string,
      unknown
    >
    if (handleShowHelp(record) || !Array.isArray(record.options)) return null
    // 모양이 맞는 선지만 씁니다. (쉼표는 실패 원인 칸을 나누는 글자라 빼 둡니다)
    const options: FailCauseOption[] = []
    for (const value of record.options) {
      if (typeof value !== 'object' || value === null) continue
      const option = value as Record<string, unknown>
      if (typeof option.text !== 'string' || option.text.trim() === '') continue
      options.push({
        reason: typeof option.reason === 'string' ? option.reason : 'etc',
        text: option.text.replaceAll(',', ' ').trim(),
        inner: option.inner === true,
      })
    }
    return options.length > 0 ? options : null
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error
    return null
  }
}

/**
 * 예상 실패 원인 선지의 쿼리 설정입니다. 화면에서는 useSuspenseQuery(failCauseOptionsQuery(제목)) 로 받습니다.
 * 같은 제목이면 다시 묻지 않습니다(하루 한도가 있어서). 실패해도 null 로 끝나서 다시 시도하지 않습니다.
 */
export function failCauseOptionsQuery(title: string) {
  return queryOptions({
    queryKey: ['ai', 'fail-cause-options', title],
    queryFn: () => requestFailCauseOptions(title),
    staleTime: Infinity,
    retry: false,
  })
}

/** 한 줄을 정리한 즉석 카드 초안 (BE `POST /ai/quick-card`) */
export interface QuickCardDraft {
  /** 카드 제목 (30자까지). 지난 카드와 같은 일이면 그 제목을 그대로 씁니다 */
  title: string
  /** 체크리스트 2 ~ 4개 */
  items: string[]
}

/**
 * [지금 시작] 즉석 카드의 한 줄을 제목 + 체크리스트로 정리해 달라고 합니다. (#419 표 7번) 못 받으면 null.
 * 서버가 내 과목 이름과 최근 2주 카드 제목을 같이 봐서, 같은 일이면 지난 제목을 그대로 씁니다.
 *
 *   await requestQuickCard('수학 하자') -> { title: '수학 문제집', items: ['42쪽 펴기', '5문제 풀기'] }
 */
export async function requestQuickCard(text: string): Promise<QuickCardDraft | null> {
  if (!isServerDataMode()) return null
  const trimmed = text.trim().slice(0, 100)
  if (trimmed === '') return null
  try {
    const result = await api<unknown>('/ai/quick-card', {
      method: 'POST',
      body: JSON.stringify({ text: trimmed }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const record = (typeof result === 'object' && result !== null ? result : {}) as Record<
      string,
      unknown
    >
    if (handleShowHelp(record) || typeof record.card !== 'object' || record.card === null) {
      return null
    }
    const card = record.card as Record<string, unknown>
    if (typeof card.title !== 'string' || card.title.trim() === '' || !Array.isArray(card.items)) {
      return null
    }
    const items = card.items.filter(
      (value): value is string => typeof value === 'string' && value.trim() !== '',
    )
    if (items.length === 0) return null
    return { title: card.title.trim(), items: items.map((item) => item.trim()) }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error
    return null
  }
}

/** 글 종류마다 받을 수 있는 이름표 (BE `POST /ai/classify-text`) */
const TEXT_LABELS = {
  reason: ['inner', 'outer'],
  memo: ['contact', 'otherTask', 'worry', 'life'],
} as const

/**
 * 학생이 쓴 짧은 글 하나에 이름표를 받습니다. (#419 표 8 · 9번) 못 받으면 null.
 * - reason: 일시정지 '기타' 글 → 'inner'(내 행동) / 'outer'(바깥 일)
 * - memo: 딴생각 메모 → 'contact' / 'otherTask' / 'worry' / 'life'
 * 참고 칸이라 판정 · 집계에 쓰지 않습니다.
 *
 *   await requestTextLabel('reason', '동생이 방에 들어와서 떠들었다') -> 'outer'
 *   await requestTextLabel('memo', '엄마한테 학원비 문자 보내기')     -> 'contact'
 */
export async function requestTextLabel(
  kind: 'reason' | 'memo',
  text: string,
): Promise<string | null> {
  if (!isServerDataMode()) return null
  const trimmed = text.trim().slice(0, 100)
  if (trimmed === '') return null
  try {
    const result = await api<unknown>('/ai/classify-text', {
      method: 'POST',
      body: JSON.stringify({ kind, text: trimmed }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const record = (typeof result === 'object' && result !== null ? result : {}) as Record<
      string,
      unknown
    >
    if (handleShowHelp(record)) return null
    const allowed: readonly string[] = TEXT_LABELS[kind]
    return typeof record.label === 'string' && allowed.includes(record.label) ? record.label : null
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error
    return null
  }
}
