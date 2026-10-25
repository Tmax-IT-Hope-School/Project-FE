/**
 * "사진으로 증빙 적기" 를 서버에 부탁합니다. (#670)
 * 화면은 pages/CardTimerPage.tsx 의 종료 팝업 증빙 단계입니다.
 *
 * 공부를 끝낸 학생이 공책 · 문제집 사진을 고르면, 서버 AI 가 "이 사진으로 보아 무엇을 했는지" 를 한 줄로 써 줍니다.
 * 화면은 그 한 줄을 증빙 요약 칸에 넣고, 학생이 고친 뒤 [남기기] 를 누릅니다.
 *
 * 서버와 정한 약속 (BE POST /api/v1/ai/proof-from-photo, 로그인 필요)
 *   요청 { image: 'data:image/jpeg;base64,…', cardTitle: '수학 문제집' }   (cardTitle 은 없어도 됨)
 *   응답 200 { showHelp: boolean, summary: string | null }
 *     - summary 가 null 이면 AI 가 못 만든 것 (AI 꺼짐 · 실패 · 공부 흔적이 안 보이는 사진). 에러가 아니라 200 입니다.
 *     - showHelp 가 true 면 사진 속 글이나 카드 제목에 위기 표현이 있어서 AI 를 쓰지 않은 것입니다.
 *   400 = 사진 모양 · 종류 · 너무 큼(4MB)   (사진 줄이기는 lib/photoCards.ts 의 shrinkPhoto 를 같이 씁니다)
 *
 * ⚠️ 사진은 어디에도 저장하지 않습니다. 브라우저 저장소에도 넣지 않고, 서버도 AI 에 보낸 뒤 버립니다.
 *    남는 것은 학생이 고쳐서 [남기기] 를 누른 한 줄뿐입니다.
 */
import { ApiError, api } from '@/lib/api'
import { isServerDataMode } from '@/lib/dataMode'

/** AI 가 사진을 읽는 데 시간이 걸려서 넉넉하게 기다립니다. (서버는 25초까지 기다림, lib/photoCards.ts 와 같은 값) */
const REQUEST_TIMEOUT_MS = 40_000
/** 서버의 카드 제목 한도 (100자) */
const MAX_CARD_TITLE_LENGTH = 100

export interface ProofPhotoResult {
  /** true 면 위기 표현이 있어서 AI 를 쓰지 않은 것입니다. 화면은 도움 안내를 먼저 보여 줍니다. */
  showHelp: boolean
  /** AI 가 쓴 한 줄. 못 만들었으면 null */
  summary: string | null
}

/** 못 받았을 때의 답 (테스트 로그인 · 서버 실패 · 아직 배포 전이라 404) */
const NOT_MADE: ProofPhotoResult = { showHelp: false, summary: null }

/**
 * 줄인 사진(data URL)을 보내 "무엇을 했는지" 한 줄을 받습니다. 못 받으면 summary 가 null 입니다.
 *
 *   await requestProofFromPhoto({ image, cardTitle: '수학 문제집' })
 *     -> { showHelp: false, summary: '수학 문제집 42~45쪽 풀고 틀린 3문제 표시함' }
 *
 * - 테스트 로그인(가짜 토큰)이면 서버에 묻지 않습니다. (화면은 버튼을 숨깁니다)
 * - 서버에 아직 이 기능이 없어서 404 이거나 연결이 안 돼도, 에러 대신 summary: null 로 조용히 넘어갑니다.
 * - 401 은 api() 가 이미 로그인 화면으로 보내므로 그대로 던집니다.
 */
export async function requestProofFromPhoto(input: {
  image: string
  cardTitle?: string
}): Promise<ProofPhotoResult> {
  if (!isServerDataMode()) return NOT_MADE
  const cardTitle = input.cardTitle?.trim().slice(0, MAX_CARD_TITLE_LENGTH)
  try {
    const result = await api<unknown>('/ai/proof-from-photo', {
      method: 'POST',
      body: JSON.stringify({ image: input.image, ...(cardTitle ? { cardTitle } : {}) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    // 서버 응답도 그대로 믿지 않고 모양을 확인합니다.
    const record = (typeof result === 'object' && result !== null ? result : {}) as Record<
      string,
      unknown
    >
    if (record.showHelp === true) return { showHelp: true, summary: null }
    const summary = typeof record.summary === 'string' ? record.summary.trim() : ''
    return { showHelp: false, summary: summary === '' ? null : summary }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error
    return NOT_MADE
  }
}
