import { moveDateKey } from '@/lib/date'
import { SESSION_MAX_RANGE_DAYS } from '@/lib/sessionsApi'
import type { Card, StudySession } from '@/types'

/**
 * 기록 탭(History)이 서버의 공부 기록도 같이 보도록, 이 기기 기록과 서버 기록을 합치는 함수들입니다. (#659)
 *
 * 공부 기록은 이 기기에서 서버로 "보내기만" 합니다(lib/sessionSync.ts). 그래서 다른 기기에서 잰 기록이나
 * 서버에만 있는 기록은 이 기기에 없습니다. 기록 탭은 서버 기록을 받아서(최근 6개월) 이 기기 기록과 합쳐 봅니다.
 * (이 기기 저장소에 넣지는 않습니다. 화면에서 볼 때만 합칩니다)
 *
 * 서버는 한 번에 31일까지만 줍니다. (BE GET /study-sessions?from=&to=)
 */

/** 서버에서 받아 올 날 수 (오늘 포함, 약 6개월) */
export const SERVER_HISTORY_DAYS = 186

/**
 * 오늘까지 SERVER_HISTORY_DAYS 일을 31일씩 나눕니다. 오래된 것부터.
 *
 *   getServerRanges('2026-10-24') -> [{ from: '2026-04-22', to: '2026-05-22' }, …, { from: '2026-09-24', to: '2026-10-24' }]
 */
export function getServerRanges(todayKey: string): { from: string; to: string }[] {
  const ranges: { from: string; to: string }[] = []
  let to = todayKey
  for (let left = SERVER_HISTORY_DAYS; left > 0; left -= SESSION_MAX_RANGE_DAYS) {
    const days = Math.min(SESSION_MAX_RANGE_DAYS, left)
    const from = moveDateKey(to, -(days - 1))
    ranges.unshift({ from, to })
    to = moveDateKey(from, -1)
  }
  return ranges
}

export interface MergeInput {
  /** 이 기기의 공부 기록 (노는 기록 뺀 것) */
  local: StudySession[]
  /** 서버에서 받은 기록 (노는 기록이 섞여 있을 수 있음) */
  server: StudySession[]
  /** 이 기기에서 이미 서버로 보낸 기록의 서버 번호들 (session-sync 의 sent 값) */
  sentServerIds: string[]
  /** 이 기기 카드 (서버 카드 번호 → 이 기기 카드 id 를 찾는 데 씀) */
  cards: Card[]
}

/**
 * 이 기기 기록 + 서버에만 있는 기록. 같은 기록을 두 번 세지 않습니다.
 *   - 이 기기에서 보낸 기록(서버 번호가 sentServerIds 에 있음)은 이 기기 것만 씁니다.
 *   - 시작 시각이 1초 안으로 같은 기록도 이미 있는 것으로 봅니다. (보낸 표시를 잃어버린 경우)
 *   - 노는 기록은 뺍니다.
 *   - 서버 기록의 카드 번호는 이 기기 카드 id 로 바꿉니다. (못 찾으면 그대로 → 카드 판정에서 빠짐)
 *   - 이 기기 id 와 겹치지 않게 서버 기록 id 앞에 'server-' 를 붙입니다.
 */
export function mergeServerSessions(input: MergeInput): StudySession[] {
  const sent = new Set(input.sentServerIds)
  const localStarts = input.local.map((session) => session.startedAt)
  const cardIdByServerId = new Map<string, string>()
  for (const card of input.cards) {
    if (card.serverId) cardIdByServerId.set(card.serverId, card.id)
  }

  const serverOnly = input.server
    .filter((session) => session.kind !== 'play')
    .filter((session) => !sent.has(session.id))
    .filter(
      (session) => !localStarts.some((startedAt) => Math.abs(startedAt - session.startedAt) < 1000),
    )
    .map((session) => ({
      ...session,
      id: `server-${session.id}`,
      ...(session.cardId ? { cardId: cardIdByServerId.get(session.cardId) ?? session.cardId } : {}),
    }))

  return [...input.local, ...serverOnly]
}
