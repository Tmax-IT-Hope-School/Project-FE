import { loadData } from '@/lib/storage'

/**
 * 시연용 가상 데이터(lib/demoData.ts)를 알아보는 함수들입니다.
 *
 * ■ 가상 데이터는 서버로 보내지 않습니다. 이 기기(localStorage)에만 둡니다.
 *   서버에 한 번 올라가면 골라서 지울 수 없기 때문입니다.
 *     - 카드를 지워도 그 카드의 공부 기록 · 실행 표시는 서버에 남습니다.
 *     - 공부 기록은 "전부 지우기" 밖에 없어서, 가상 것만 지우면 진짜 기록까지 지워집니다.
 *     - 목표는 지우는 주소가 아예 없습니다.
 *   그래서 서버로 보내는 곳(카드 · 목표 · 공부 기록 · 실행 표시 · 휴식 · 심리검사 · 온보딩 마침)이
 *   보내기 전에 여기서 "가상 데이터인지" 묻고 건너뜁니다. 이 기기에만 있으니 removeDemoData 한 번으로 다 지워집니다.
 *
 * 이 파일은 저장소만 읽습니다. (카드 · 동기화 파일들이 불러 써서, 무거운 파일을 불러오면 서로 물고 물립니다)
 */

/** 가상 데이터 id 앞에 붙는 글자. 지울 때 · 서버로 안 보낼 때 이걸로 골라냅니다. */
export const DEMO_ID_PREFIX = 'demo-'

/** 무엇을 넣었는지 적어 두는 표의 저장 이름 (lib/demoData.ts 의 DemoManifest) */
export const DEMO_MANIFEST_KEY = 'demo-manifest'

/**
 * 가상 데이터의 id 인지 알려줍니다.
 *
 *   isDemoId('demo-card-1') -> true
 *   isDemoId('card-s7')     -> false
 */
export function isDemoId(id: string): boolean {
  return id.startsWith(DEMO_ID_PREFIX)
}

/** 표에서 이름이 name 인 목록을 꺼냅니다. 표가 없거나 모양이 틀리면 빈 목록입니다. */
function loadManifestList(name: 'restDates' | 'setKeys'): string[] {
  const manifest = loadData<unknown>(DEMO_MANIFEST_KEY, null)
  if (typeof manifest !== 'object' || manifest === null) return []
  const list = (manifest as Record<string, unknown>)[name]
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []
}

/** 가상 데이터로 넣은 휴식일인지 (휴식일은 id 가 없어서 넣은 날짜를 표에 적어 둡니다) */
export function isDemoRestDate(date: string): boolean {
  return loadManifestList('restDates').includes(date)
}

/** 가상 데이터로 통째로 넣은 저장값인지 (온보딩 답 · 심리검사처럼 하나뿐인 값) */
export function isDemoSetKey(key: string): boolean {
  return loadManifestList('setKeys').includes(key)
}
