/**
 * 심리검사 결과를 서버(BE)에도 저장하고, 서버 AI 가 쓴 "성향 요약" 문장을 받아오는 함수들입니다.
 * (BE 저장소 docs/API.md "심리검사" · "AI 도우미 — 성향 요약", BE#219 · PR #279)
 *
 *   POST /psych-tests       { answers: { S1: 6, …, C5: 3 } }   -> 201 { id, takenAt, answers, scores, levels }
 *     35문장을 다 답했거나, 옛 기록(14문장 S1 ~ C2)을 다 답했어야 합니다. 다시 하면 서버는 새로 쌓습니다.
 *   POST /ai/profile-lines  (본문 없음)                       -> 200 { lines: string[] | null }   (BE PR #280)
 *     서버가 DB 의 가장 최근 심리검사를 읽고, 가운데(4)에서 가장 먼 척도 3개를 코드가 골라 AI 가 한 줄씩 씁니다(숫자 없음).
 *     못 만들면(AI 꺼짐 · 하루 한도 · 서버에 검사가 없음) lines 가 null 입니다.
 *
 * ■ 이 기기의 저장소(study-psych-test)는 그대로 씁니다. 이 기기에 먼저 저장하고(savePsychTest) 서버로도 보냅니다.
 *   "보냈다" 는 표시로 보낸 결과의 서명(끝낸 시각 · 답)을 적어 둡니다. 표시가 없거나 결과가 바뀌었으면 아직 안 보낸 것입니다.
 *   못 보내면 다음에 앱을 열 때 다시 보냅니다. (hooks/usePsychTestSync.ts)
 * ■ 테스트 로그인(서버가 모르는 가짜 토큰)일 때는 서버를 부르지 않습니다. (lib/dataMode.ts 의 isServerDataToken)
 */
import { ApiError, api } from '@/lib/api'
import { isDemoSetKey } from '@/lib/demoIds'
import { loadPsychTest, type PsychTestResult } from '@/lib/psychTest'
import { loadData, saveData } from '@/lib/storage'
import { queryOptions } from '@tanstack/react-query'

/** 서버 응답을 기다리는 최대 시간(밀리초) */
const REQUEST_TIMEOUT_MS = 10000
/** AI 문장을 기다리는 최대 시간(밀리초). 서버가 GPT 를 최대 10초 기다리므로 그보다 조금 더 줍니다. */
const AI_TIMEOUT_MS = 15000

/** 서버에 보낸 결과의 서명을 적어 두는 저장 키 */
export const PSYCH_TEST_SENT_KEY = 'psych-test-sent'

/** 결과 하나의 서명. 같은 결과면 같은 글자입니다. (끝낸 시각 · 답) */
export function signatureOf(result: Pick<PsychTestResult, 'takenAt' | 'answers'>): string {
  const answers = Object.keys(result.answers)
    .sort()
    .map((id) => `${id}:${result.answers[id]}`)
    .join(',')
  return `${result.takenAt}|${answers}`
}

/** 이 기기의 결과가 아직 서버에 안 갔는지. 결과가 없으면 false 입니다. */
export function needsSendingPsychTest(): boolean {
  // 시연용 가상 데이터로 넣은 결과는 서버로 보내지 않습니다. (lib/demoIds.ts)
  if (isDemoSetKey('psych-test')) return false
  const result = loadPsychTest()
  return (
    result !== undefined && loadData<unknown>(PSYCH_TEST_SENT_KEY, null) !== signatureOf(result)
  )
}

/**
 * 이 기기의 결과를 서버로 보내고, 보냈다고 표시합니다. 보낼 것이 없으면 아무것도 하지 않습니다.
 * 실패하면 에러를 던집니다. 이 기기의 결과는 그대로라서 다음에 다시 보낼 수 있습니다.
 */
export async function sendPsychTest(): Promise<void> {
  const result = loadPsychTest()
  if (result === undefined || !needsSendingPsychTest()) return
  await api<unknown>('/psych-tests', {
    method: 'POST',
    body: JSON.stringify({ answers: result.answers }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  saveData(PSYCH_TEST_SENT_KEY, signatureOf(result))
}

/** 서버가 "값이 틀렸다(400)" 고 해서 다시 보내도 소용없을 때, 이 결과는 보낸 것으로 쳐서 다시 보내지 않게 합니다. */
export function markPsychTestHandled(): void {
  const result = loadPsychTest()
  if (result !== undefined) saveData(PSYCH_TEST_SENT_KEY, signatureOf(result))
}

/** 성향 요약 결과 */
export interface ProfileLinesResult {
  /** true 면 서버가 도움 연결 안내를 먼저 보여 주라고 한 것입니다. (이 API 는 학생 글을 받지 않아서 지금은 늘 false) */
  showHelp: boolean
  /** AI 가 쓴 문장 3개. 못 받았으면 null → 화면은 코드가 고른 기본 문장(lib/onboardingCare.ts)을 씁니다 */
  lines: string[] | null
}

/** 문장이 1 ~ 3개이고, 모두 비지 않은 글자인지 */
function isLines(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 3 &&
    value.every((line) => typeof line === 'string' && line.trim() !== '')
  )
}

/**
 * 서버 AI 의 성향 요약을 받아옵니다. 서버 AI 는 서버 DB 의 검사를 읽어서, 먼저 이 기기의 결과를 보냈는지 확인합니다.
 * ⚠️ 에러를 던지지 않고 lines: null 로 돌려줍니다. 성향 요약은 기본 문장이 있어서,
 *    서버가 아직 준비 안 됐거나(404) 멈춰도 결과 화면에 빨간 에러 대신 기본 문장이 보이게 하려는 것입니다.
 */
async function fetchProfileLines(): Promise<ProfileLinesResult> {
  try {
    await sendPsychTest()
  } catch (error) {
    // 서버가 답을 거절했으면(400) 다시 보내도 같아서 보낸 것으로 칩니다. 그 밖의 실패는 AI 를 불러 봐도 서버에 검사가 없습니다.
    if (error instanceof ApiError && error.status === 400) markPsychTestHandled()
    return { showHelp: false, lines: null }
  }
  try {
    const result = await api<unknown>('/ai/profile-lines', {
      method: 'POST',
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    })
    if (typeof result !== 'object' || result === null) return { showHelp: false, lines: null }
    const record = result as Record<string, unknown>
    return {
      showHelp: record.showHelp === true,
      lines: isLines(record.lines) ? record.lines.map((line) => line.trim()) : null,
    }
  } catch {
    return { showHelp: false, lines: null }
  }
}

/**
 * 결과 화면의 성향 요약 쿼리. signature 는 지금 결과의 서명이라, 검사를 다시 하면 새로 받습니다.
 *
 *   const { data } = useSuspenseQuery(profileLinesQuery(signatureOf(result)))
 *   data.lines ?? 기본 문장
 */
export function profileLinesQuery(signature: string) {
  return queryOptions({
    queryKey: ['ai-profile-lines', signature],
    queryFn: fetchProfileLines,
    // 같은 결과면 문장이 바뀔 일이 없어서 다시 받지 않습니다. (AI 하루 한도를 아끼려는 것)
    staleTime: Infinity,
    retry: false,
  })
}
