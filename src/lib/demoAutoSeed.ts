import { loadSavedCards, saveCards } from '@/lib/cards'
import { addDemoData, isDemoSeeded } from '@/lib/demoData'
import { DEMO_ID_PREFIX, buildDemoPersona } from '@/lib/demoPersona'
import { getTodayKey } from '@/lib/date'
import type { Card } from '@/types'

/**
 * 시연용 계정 하나에 "가상 사용자 28일" 을 자동으로 넣는 규칙입니다. (lib/demoData.ts 의 addDemoData 를 그대로 씁니다)
 * 통계 탭은 공부 기록을 이 기기(localStorage)에서만 읽어서, DB 에 넣어도 화면에 안 보입니다. (lib/sessionSync.ts)
 * 그래서 정해 둔 계정으로 로그인하면, 그 기기에 가상 데이터가 없을 때 이 기기에 넣어 줍니다.
 * 어느 기기에서 로그인해도 한 달치 기록이 보이게 됩니다. (화면은 hooks/useDemoAutoSeed.ts)
 *
 * ■ 어느 계정인지: 환경변수 VITE_DEMO_SEED_USER_ID 에 서버의 사용자 번호(users.id)를 적습니다.
 *   비워 두면 이 기능은 꺼집니다. 이메일 대신 번호를 쓰는 이유: VITE_ 값은 누구나 볼 수 있는 빌드 파일에 들어가서입니다.
 * ■ 다른 기기에서 넣은 가상 카드: 서버로 올라가 있다가 이 기기에는 'card-s번호' 같은 다른 id 로 들어옵니다.
 *   그대로 두고 새로 넣으면 카드가 두 벌이 되므로, 가상 카드와 제목이 같은 카드를 먼저 지우고 새로 넣습니다.
 *   (지운 것은 서버에도 지웠다고 보내서, 서버의 카드도 한 벌만 남습니다)
 */

/**
 * 지금 로그인한 사람이 자동으로 넣을 시연 계정인지 알려줍니다. envValue 는 VITE_DEMO_SEED_USER_ID 의 값입니다.
 *
 *   isDemoSeedUser(undefined, '12') -> false  (안 적음 = 꺼짐)
 *   isDemoSeedUser('12', '12')      -> true
 *   isDemoSeedUser(' 12 ', '12')    -> true   (앞뒤 공백은 무시)
 *   isDemoSeedUser('12', '7')       -> false
 */
export function isDemoSeedUser(envValue: string | undefined, userId: string | undefined): boolean {
  const seedUserId = envValue?.trim()
  if (!seedUserId || !userId) return false
  return seedUserId === userId
}

/**
 * 이 기기에 가상 데이터를 넣어야 하는지 알려줍니다.
 * 넣은 표시가 없거나, 표시는 있는데 가상 카드('demo-' 로 시작)가 하나도 없으면 넣습니다.
 * (다른 기기에서 다시 넣으면 이 기기의 가상 카드는 서버에서 지워져서 사라집니다. 그때 다시 넣습니다)
 *
 *   needsDemoSeed([], false)                    -> true   (처음 로그인한 기기)
 *   needsDemoSeed([{ id: 'demo-card-1' }], true) -> false  (이미 넣음)
 *   needsDemoSeed([{ id: 'card-s7' }], true)     -> true   (가상 카드가 사라짐)
 */
export function needsDemoSeed(cards: Pick<Card, 'id'>[], isSeeded: boolean): boolean {
  if (!isSeeded) return true
  return !cards.some((card) => card.id.startsWith(DEMO_ID_PREFIX))
}

/**
 * 다른 기기에서 넣어 서버를 거쳐 들어온 가상 카드를 뺀 카드 목록을 돌려줍니다.
 * 이 기기의 가상 카드('demo-' 로 시작)는 addDemoData 가 알아서 빼므로 여기서는 건드리지 않습니다.
 *
 *   withoutOtherDeviceDemoCards([{ id: 'card-s7', title: '아침 영단어 20쪽' }], ['아침 영단어 20쪽']) -> []
 *   withoutOtherDeviceDemoCards([{ id: 'card-1', title: '내 카드' }], ['아침 영단어 20쪽'])        -> 그대로
 */
export function withoutOtherDeviceDemoCards<T extends Pick<Card, 'id' | 'title'>>(
  cards: T[],
  demoTitles: string[],
): T[] {
  return cards.filter(
    (card) => card.id.startsWith(DEMO_ID_PREFIX) || !demoTitles.includes(card.title),
  )
}

/** 이 기기에 가상 데이터가 필요하면 넣습니다. 넣었으면 true 를 돌려줍니다. (넣은 뒤 새로고침해야 화면에 보입니다) */
export function seedDemoIfNeeded(): boolean {
  const cards = loadSavedCards() ?? []
  if (!needsDemoSeed(cards, isDemoSeeded())) return false

  // 가상 카드의 제목 목록 (날짜와 상관없이 제목은 늘 같습니다)
  const demoTitles = buildDemoPersona(getTodayKey(), Date.now()).cards.map((card) => card.title)
  const cleaned = withoutOtherDeviceDemoCards(cards, demoTitles)
  if (cleaned.length !== cards.length) saveCards(cleaned)

  addDemoData()
  return true
}
