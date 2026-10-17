import { requestTextLabel } from '@/lib/aiCardApi'
import { isServerDataMode } from '@/lib/dataMode'
import type { MemoCategory, SessionMemo, SessionPause, StudySession } from '@/types'

/**
 * 세션이 끝난 뒤 '기타' 일시정지 글과 딴생각 메모에 AI 이름표를 붙입니다. (#419 표 8 · 9번)
 * 이름표는 **참고 칸**이라 판정 · 집계(관리 단계 · 재발 신호 등)에 쓰지 않고 화면에도 보이지 않습니다.
 * 다음 버전의 분석 재료입니다.
 */

/** 세션 하나에서 AI 에게 물어볼 글의 최대 개수 (작은 AI 기능은 하루 40번을 같이 써서 아껴 씁니다) */
export const MAX_LABEL_REQUESTS = 5

/** 이름표를 붙일 글 하나 */
export interface TextToLabel {
  kind: 'reason' | 'memo'
  /** pauses 또는 memos 안에서 몇 번째인지 */
  index: number
  text: string
}

/**
 * 이름표가 아직 없는 글을 고릅니다. '기타' 일시정지 글이 먼저, 그다음 메모, 합쳐서 max 개까지입니다.
 *
 *   pauses [폰(글 없음), 기타 '동생이 떠듦'], memos ['학원비 문자']
 *   getTextsToLabel(세션, 5)
 *     -> [ { kind: 'reason', index: 1, text: '동생이 떠듦' }, { kind: 'memo', index: 0, text: '학원비 문자' } ]
 */
export function getTextsToLabel(
  session: Pick<StudySession, 'pauses' | 'memos'>,
  max: number,
): TextToLabel[] {
  const texts: TextToLabel[] = []
  // entries(): [몇 번째, 값] 을 같이 꺼냅니다.
  for (const [index, pause] of (session.pauses ?? []).entries()) {
    const note = pause.note?.trim() ?? ''
    if (pause.tag === 'other' && note !== '' && !pause.aiSource) {
      texts.push({ kind: 'reason', index, text: note })
    }
  }
  for (const [index, memo] of (session.memos ?? []).entries()) {
    if (memo.text.trim() !== '' && !memo.aiCategory) {
      texts.push({ kind: 'memo', index, text: memo.text.trim() })
    }
  }
  return texts.slice(0, max)
}

/**
 * 받은 이름표를 세션의 pauses · memos 에 넣은 새 목록을 돌려줍니다. 받은 것이 하나도 없으면 null.
 * (원래 세션은 고치지 않습니다)
 *
 *   applyTextLabels(세션, [ { kind: 'reason', index: 1, label: 'outer' } ])
 *     -> { pauses: [폰, 기타 '동생이 떠듦' (aiSource 'outer')], memos: 그대로 }
 */
export function applyTextLabels(
  session: Pick<StudySession, 'pauses' | 'memos'>,
  results: (TextToLabel & { label: string | null })[],
): { pauses?: SessionPause[]; memos?: SessionMemo[] } | null {
  const labeled = results.filter((result) => result.label !== null)
  if (labeled.length === 0) return null
  const pauses = (session.pauses ?? []).map((pause, index) => {
    const result = labeled.find((item) => item.kind === 'reason' && item.index === index)
    // 이름표가 그 종류의 값인지는 requestTextLabel 이 이미 확인했습니다.
    return result ? { ...pause, aiSource: result.label as 'inner' | 'outer' } : pause
  })
  const memos = (session.memos ?? []).map((memo, index) => {
    const result = labeled.find((item) => item.kind === 'memo' && item.index === index)
    return result ? { ...memo, aiCategory: result.label as MemoCategory } : memo
  })
  return {
    ...(session.pauses ? { pauses } : {}),
    ...(session.memos ? { memos } : {}),
  }
}

/**
 * 세션의 글에 이름표를 받아 고칠 칸을 돌려줍니다. 테스트 로그인이거나 받은 것이 없으면 null.
 * 하나씩 차례로 묻습니다. (한꺼번에 보내면 하루 한도를 순식간에 씁니다)
 */
export async function labelSessionTexts(
  session: StudySession,
): Promise<{ pauses?: SessionPause[]; memos?: SessionMemo[] } | null> {
  if (!isServerDataMode()) return null
  const texts = getTextsToLabel(session, MAX_LABEL_REQUESTS)
  const results: (TextToLabel & { label: string | null })[] = []
  for (const item of texts) {
    results.push({ ...item, label: await requestTextLabel(item.kind, item.text) })
  }
  return applyTextLabels(session, results)
}
