import { queryOptions } from '@tanstack/react-query'
import {
  ANALYSIS_GROUPS,
  type AnalysisExperiment,
  type AnalysisFact,
  type AnalysisGroup,
  type AnalysisSection,
  type SelfAnalysis,
} from '@/lib/analysisFacts'
import { ApiError, api } from '@/lib/api'
import { isServerDataMode } from '@/lib/dataMode'
import { loadData, saveData } from '@/lib/storage'

/**
 * AI 자기 분석을 서버에 부탁합니다. (#419 표 14번, BE `POST /ai/analysis`)
 * AI 키는 서버에만 있고, 글 모델은 gpt-6-luna 입니다. 보내는 것은 lib/analysisFacts.ts 가 계산한 숫자뿐입니다.
 *
 * - 테스트 로그인(가짜 토큰)이면 서버에 묻지 않고 null 을 돌려줍니다. 화면은 기본 문장(buildCodeAnalysis)을 씁니다.
 * - 서버가 analysis: null 을 주거나(AI 꺼짐 · 하루 한도 · 쓸 수 없는 답) 연결이 안 되면 analysis 가 null → 기본 문장
 * - showHelp 가 true 면 카드 이름 같은 글에 위기 표현이 있어서 AI 를 쓰지 않은 것입니다. 이때도 null 입니다.
 * - 같은 날 같은 숫자면 다시 묻지 않습니다. 받은 답을 저장해 둡니다. ('study-ai-analysis')
 */

/** 서버가 답을 25초까지 기다리므로 그보다 조금 더 기다립니다. 그동안 화면은 기본 문장을 보여 줍니다. */
const REQUEST_TIMEOUT_MS = 30000

/** 서버가 준 AI 분석. 요약 · 실험 제안만 못 쓴 경우 그 칸이 null 입니다 */
export interface AiAnalysis {
  summary: string | null
  sections: AnalysisSection[]
  nextExperiment: AnalysisExperiment | null
}

export interface AiAnalysisResult {
  /** 서버가 DB 에서 읽어 더한 숫자 (예: 통화에서 자주 보인 생각 습관) */
  serverFacts: AnalysisFact[]
  /** AI 가 쓴 분석. 못 썼으면 null */
  analysis: AiAnalysis | null
}

const GROUP_NAMES = ANALYSIS_GROUPS.map((item) => item.group)

function isGroup(value: unknown): value is AnalysisGroup {
  return typeof value === 'string' && (GROUP_NAMES as string[]).includes(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** 서버의 숫자 한 줄을 확인해서 돌려줍니다. 모양이 틀리면 null */
function toFact(value: unknown): AnalysisFact | null {
  const record = asRecord(value)
  const key = asText(record.key)
  const label = asText(record.label)
  const text = asText(record.value)
  if (!key || !label || !text || !isGroup(record.group)) return null
  return { key, group: record.group, label, value: text, basis: asText(record.basis) ?? '' }
}

/** 서버의 분석을 확인해서 돌려줍니다. 쓸 수 있는 묶음이 하나도 없으면 null */
function toAnalysis(value: unknown): AiAnalysis | null {
  const record = asRecord(value)
  if (!Array.isArray(record.sections)) return null
  const sections: AnalysisSection[] = []
  for (const item of record.sections) {
    const section = asRecord(item)
    const headline = asText(section.headline)
    const body = asText(section.body)
    if (!isGroup(section.group) || !headline || !body) continue
    const evidenceKeys = Array.isArray(section.evidenceKeys)
      ? section.evidenceKeys.filter((key): key is string => typeof key === 'string')
      : []
    sections.push({ group: section.group, headline, body, evidenceKeys })
  }
  if (sections.length === 0) return null

  const experiment = asRecord(record.nextExperiment)
  const ifText = asText(experiment.ifText)
  const thenText = asText(experiment.thenText)
  const why = asText(experiment.why)
  return {
    summary: asText(record.summary),
    sections,
    nextExperiment: ifText && thenText && why ? { ifText, thenText, why } : null,
  }
}

/**
 * 숫자를 보내고 AI 분석을 받습니다. 못 받으면 null.
 *
 *   await requestAnalysis([{ key: 'slotRate', group: 'tendency', label: '시간대별 실행률', value: '아침 95% · 밤 63%', basis: '카드 64번' }])
 *     -> { serverFacts: [], analysis: { summary: '아침에 더 잘 되는 편이야', sections: [ … ], nextExperiment: { … } } }
 *        (테스트 로그인 · 연결 실패 · 위기 표현이면 null)
 */
export async function requestAnalysis(facts: AnalysisFact[]): Promise<AiAnalysisResult | null> {
  if (!isServerDataMode() || facts.length === 0) return null
  try {
    const result = await api<unknown>('/ai/analysis', {
      method: 'POST',
      body: JSON.stringify({ facts }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const record = asRecord(result)
    if (record.showHelp === true) return null
    const serverFacts = Array.isArray(record.serverFacts)
      ? record.serverFacts.map(toFact).filter((fact): fact is AnalysisFact => fact !== null)
      : []
    return { serverFacts, analysis: toAnalysis(record.analysis) }
  } catch (error) {
    // 401 은 api() 가 이미 로그인 화면으로 보냅니다. 그 밖의 실패는 기본 문장으로 조용히 넘어갑니다.
    if (error instanceof ApiError && error.status === 401) throw error
    return null
  }
}

// ── 같은 날 같은 숫자면 다시 묻지 않기 ── (실제 키는 'study-ai-analysis')
export const AI_ANALYSIS_KEY = 'ai-analysis'

interface SavedAnalysis {
  dateKey: string
  /** 보낸 숫자의 지문 (getFactsSignature) */
  signature: string
  result: AiAnalysisResult
}

/**
 * 숫자 묶음의 짧은 지문입니다. 숫자가 하나라도 바뀌면 지문도 바뀝니다. (djb2 라는 간단한 방법)
 *
 *   getFactsSignature([사실 A]) === getFactsSignature([사실 A])   // true
 */
export function getFactsSignature(facts: AnalysisFact[]): string {
  const text = JSON.stringify(facts)
  let hash = 5381
  for (let i = 0; i < text.length; i++) hash = (hash * 33 + text.charCodeAt(i)) >>> 0
  return hash.toString(36)
}

function loadSavedAnalysis(dateKey: string, signature: string): AiAnalysisResult | null {
  const saved = loadData<SavedAnalysis | null>(AI_ANALYSIS_KEY, null)
  if (!saved || saved.dateKey !== dateKey || saved.signature !== signature) return null
  return saved.result
}

/**
 * AI 분석의 쿼리 설정입니다. 화면에서는 useSuspenseQuery(aiAnalysisQuery(숫자, 오늘)) 로 받습니다.
 * 오늘 같은 숫자로 받은 답이 있으면 서버에 묻지 않습니다. (하루 한도가 있어서)
 * 실패해도 null 로 끝나서 다시 시도하지 않습니다.
 */
export function aiAnalysisQuery(facts: AnalysisFact[], todayKey: string) {
  const signature = getFactsSignature(facts)
  return queryOptions({
    queryKey: ['ai', 'analysis', todayKey, signature],
    queryFn: async () => {
      const saved = loadSavedAnalysis(todayKey, signature)
      if (saved) return saved
      const result = await requestAnalysis(facts)
      // AI 가 쓴 분석을 받았을 때만 저장합니다. (못 받았으면 다음에 열 때 다시 물어봅니다)
      if (result?.analysis) {
        saveData<SavedAnalysis>(AI_ANALYSIS_KEY, { dateKey: todayKey, signature, result })
      }
      return result
    },
    staleTime: Infinity,
    retry: false,
  })
}

/** 화면에 보여 줄 분석 한 벌과, 누가 썼는지 */
export interface AnalysisView {
  analysis: SelfAnalysis
  /** ai: AI 가 씀 · code: 기본 문장 · loading: AI 를 기다리는 동안 보여 주는 기본 문장 */
  source: 'ai' | 'code' | 'loading'
  /** 근거를 찾아볼 숫자 전부 (보낸 숫자 + 서버가 더한 숫자) */
  facts: AnalysisFact[]
}

/**
 * AI 분석과 기본 분석을 합칩니다. AI 가 못 쓴 칸(요약 · 실험 제안)만 기본 문장으로 채웁니다.
 * 근거 숫자가 하나도 없는 묶음은 AI 가 써 왔어도 뺍니다. 예측 · 실험을 만드는 곳이 없어서(FE #666)
 * 일반 계정은 '생각과 실제' 의 예측 숫자가 비어 있는데, 그 묶음이 "아직 기록이 없어요" 같은 빈 글로 보이지 않게 하려는 것입니다.
 *
 *   mergeAnalysis(기본, 사실, null)                           -> { analysis: 기본, source: 'code', … }
 *   mergeAnalysis(기본, 사실, { analysis: { summary: null, … } }) -> 요약만 기본 문장, source: 'ai'
 *   사실에 'distortion' 묶음 숫자가 없음                         -> AI 가 쓴 '생각과 실제' 묶음은 빠짐
 */
export function mergeAnalysis(
  code: SelfAnalysis,
  facts: AnalysisFact[],
  result: AiAnalysisResult | null,
): AnalysisView {
  const allFacts = [...facts, ...(result?.serverFacts ?? [])]
  if (!result?.analysis) return { analysis: code, source: 'code', facts: allFacts }
  const groupsWithFacts = new Set(allFacts.map((fact) => fact.group))
  const sections = result.analysis.sections.filter((section) => groupsWithFacts.has(section.group))
  // 남는 묶음이 없으면 AI 글 대신 기본 분석을 그대로 씁니다.
  if (sections.length === 0) return { analysis: code, source: 'code', facts: allFacts }
  return {
    analysis: {
      summary: result.analysis.summary ?? code.summary,
      sections,
      nextExperiment: result.analysis.nextExperiment ?? code.nextExperiment,
    },
    source: 'ai',
    facts: allFacts,
  }
}
