import { loadData, saveData } from '@/lib/storage'
import type { ManualItem, ManualItemCategory } from '@/types'
import { useEffect, useState } from 'react'

// 저장소에 넣는 이름입니다. (실제 키는 storage.ts 가 앞에 'study-' 를 붙여서 'study-manual-items' 가 됩니다)
// "모든 기록 지우기" 가 이 키도 지웁니다. 이름을 바꾸면 src/lib/myData.ts 도 같이 바꾸세요.
const STORAGE_KEY = 'manual-items'

const CATEGORIES: ManualItemCategory[] = ['rhythm', 'cautionDay', 'effectiveMethod', 'careStyle']

// "틀렸어요" 를 누른 항목 (항목 id → 누른 시각). 실제 키는 'study-manual-disputes' 입니다. (lib/myData.ts 도 같이)
const DISPUTES_KEY = 'manual-disputes'

/** 저장된 값이 나 사용설명서 항목 한 개의 모양이 맞는지 확인합니다. (깨진 항목 하나가 화면을 멈추지 않게) */
function isManualItem(value: unknown): value is ManualItem {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    typeof item.confirmedDate === 'string' &&
    typeof item.evidence === 'string' &&
    CATEGORIES.some((category) => category === item.category)
  )
}

/** 저장소에서 사용설명서 항목들을 불러옵니다. 깨진 항목은 버립니다. */
export function loadManualItems(): ManualItem[] {
  const saved = loadData<unknown>(STORAGE_KEY, [])
  return Array.isArray(saved) ? saved.filter(isManualItem) : []
}

/** "틀렸어요" 를 누른 항목들 (항목 id → 누른 시각). 깨져 있으면 빈 객체 */
export function loadManualDisputes(): Record<string, number> {
  const saved = loadData<unknown>(DISPUTES_KEY, {})
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return {}
  const disputes: Record<string, number> = {}
  for (const [id, at] of Object.entries(saved)) {
    if (typeof at === 'number') disputes[id] = at
  }
  return disputes
}

/**
 * "나 사용설명서" 에 쌓이는 확인된 사실들을 들고 있고, 바뀔 때마다 localStorage 에 저장합니다. (#87, #93)
 * 실험에서 효과가 확인된 것과, 주간 리포트에서 [사용설명서에 넣기] 한 것이 여기에 올라옵니다.
 * "틀렸어요" 를 누른 항목(disputes)도 같이 들고 있습니다.
 *
 *   const { items, addItem, disputes, toggleDispute } = useManualItems()
 */
export function useManualItems() {
  const [items, setItems] = useState<ManualItem[]>(loadManualItems)
  const [disputes, setDisputes] = useState<Record<string, number>>(loadManualDisputes)

  useEffect(() => {
    saveData(STORAGE_KEY, items)
  }, [items])

  useEffect(() => {
    saveData(DISPUTES_KEY, disputes)
  }, [disputes])

  /** "틀렸어요" 를 누르거나 되돌립니다. */
  function toggleDispute(itemId: string) {
    setDisputes((prev) => {
      const next = { ...prev }
      if (next[itemId] === undefined) next[itemId] = Date.now()
      else delete next[itemId]
      return next
    })
  }

  /** 항목을 맨 앞에 더합니다. 같은 id 가 이미 있으면 새 내용으로 바꿉니다. (같은 개선안을 두 번 올려도 한 줄) */
  function addItem(item: ManualItem) {
    setItems((prev) => [item, ...prev.filter((existing) => existing.id !== item.id)])
  }

  return { items, addItem, disputes, toggleDispute }
}
