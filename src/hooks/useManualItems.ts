import { useIsServerData } from '@/hooks/useIsServerData'
import { ApiError } from '@/lib/api'
import {
  canSendManualItem,
  clearDisputeUnsent,
  findDisputesToUpload,
  findManualItemsToSend,
  loadUnsentDisputes,
  MANUAL_DISPUTES_UPLOADED_KEY,
  MANUAL_QUERY_KEY,
  markDisputeUnsent,
  mergeManualDisputes,
  mergeManualItems,
  saveManualDisputeToServer,
  saveManualItemToServer,
  type ServerManual,
} from '@/lib/manualApi'
import { loadData, saveData } from '@/lib/storage'
import type { ManualItem, ManualItemCategory } from '@/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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

/** 저장소에서 사용설명서 항목들을 불러옵니다. 깨진 항목은 버립니다. (이 기기 것만. 서버 항목은 저장하지 않습니다) */
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
 * 진짜 로그인이면 서버와도 맞춥니다. (#654, 규칙은 lib/manualApi.ts)
 *   - serverManual(서버에서 받은 목록)을 넘기면, 이 기기 항목과 합쳐서 보여 주고
 *     이 기기에만 있는 항목 · 처음 한 번 이 기기의 [틀렸어요] · 못 보낸 [틀렸어요] 를 서버로 올립니다.
 *   - 넣거나(addItem) [틀렸어요] 를 누르면(toggleDispute) 이 기기에 먼저 저장하고 서버로도 보냅니다.
 *   테스트 로그인이면 서버로 보내지 않고 이 기기에만 저장합니다.
 *
 *   const { items, addItem, disputes, toggleDispute } = useManualItems(serverManual)
 */
export function useManualItems(serverManual: ServerManual | null = null) {
  const isServerData = useIsServerData()
  const queryClient = useQueryClient()
  // 이 기기의 항목 · 틀렸어요. 서버 항목은 여기에 넣지 않고 화면에 보일 때만 합칩니다.
  const [localItems, setLocalItems] = useState<ManualItem[]>(loadManualItems)
  const [localDisputes, setLocalDisputes] = useState<Record<string, number>>(loadManualDisputes)
  // 아직 서버에 못 보낸 [틀렸어요]. 보내지기 전까지는 서버 값보다 이 값이 이깁니다.
  const [unsent, setUnsent] = useState<Record<string, boolean>>(loadUnsentDisputes)

  useEffect(() => {
    saveData(STORAGE_KEY, localItems)
  }, [localItems])

  useEffect(() => {
    saveData(DISPUTES_KEY, localDisputes)
  }, [localDisputes])

  /** 못 보낸 [틀렸어요] 를 적어 두고(저장소 + 화면) 서버로 보냅니다. */
  function queueDispute(itemId: string, disputed: boolean) {
    markDisputeUnsent(itemId, disputed)
    setUnsent(loadUnsentDisputes())
    sendDispute({ itemId, disputed })
  }

  const { mutate: sendDispute } = useMutation({
    mutationFn: saveManualDisputeToServer,
    onSuccess: async (_, { itemId }) => {
      // 서버 목록을 다시 받은 뒤에 "못 보냄" 을 지웁니다. 먼저 지우면 옛 서버 값이 잠깐 보입니다.
      await queryClient.invalidateQueries({ queryKey: MANUAL_QUERY_KEY })
      clearDisputeUnsent(itemId)
      setUnsent(loadUnsentDisputes())
    },
    onError: (error, { itemId }) => {
      // 서버가 "값이 틀렸다(400) · 그런 항목 없음(404)" 이라고 하면 다시 보내도 같아서 목록에서 뺍니다.
      // 그 밖(인터넷 끊김 · 서버 오류)은 "못 보냄" 에 남아서 다음에 사용설명서를 열 때 다시 보냅니다.
      if (error instanceof ApiError && (error.status === 400 || error.status === 404)) {
        clearDisputeUnsent(itemId)
        setUnsent(loadUnsentDisputes())
      }
    },
  })

  const { mutate: sendItem } = useMutation({
    mutationFn: saveManualItemToServer,
    onSuccess: (_, item) => {
      // 이 기기에서 이 항목에 [틀렸어요] 를 눌러 두었으면, 항목이 서버에 생긴 뒤에 같이 보냅니다.
      if (loadManualDisputes()[item.id] !== undefined) queueDispute(item.id, true)
      void queryClient.invalidateQueries({ queryKey: MANUAL_QUERY_KEY })
    },
    // 실패하면 이 기기에만 남고, 다음에 서버 목록을 받을 때 "이 기기에만 있는 항목" 으로 다시 올립니다.
  })

  // 서버 목록을 받으면 이 기기에만 있는 것 · 못 보낸 것을 올립니다.
  useEffect(() => {
    // 옛 서버(학생 항목 · 틀렸어요를 모름)면 보내지 않습니다. (lib/manualApi.ts 의 canWrite)
    if (serverManual === null || !serverManual.canWrite) return
    for (const item of findManualItemsToSend(loadManualItems(), serverManual.items)) sendItem(item)
    // 이 기기에 있던 [틀렸어요] 는 처음 한 번만 올립니다. 그 뒤로는 다른 기기에서 되돌린 것을 다시 적지 않게 서버 값을 믿습니다.
    if (loadData<boolean>(MANUAL_DISPUTES_UPLOADED_KEY, false) !== true) {
      for (const itemId of findDisputesToUpload(loadManualDisputes(), serverManual)) {
        markDisputeUnsent(itemId, true)
      }
      saveData(MANUAL_DISPUTES_UPLOADED_KEY, true)
      // 화면의 "못 보냄" 은 바꾸지 않습니다. 보내지면 서버 목록을 다시 받아서 틀렸어요가 보입니다.
    }
    for (const [itemId, disputed] of Object.entries(loadUnsentDisputes())) {
      sendDispute({ itemId, disputed })
    }
  }, [serverManual, sendItem, sendDispute])

  // 화면에 보일 값: 서버 목록이 있으면 합치고, 없으면 이 기기 것만
  const items = serverManual ? mergeManualItems(localItems, serverManual.items) : localItems
  const disputes = serverManual
    ? mergeManualDisputes(localDisputes, serverManual, unsent)
    : localDisputes

  // 서버로 보낼 수 있는지: 진짜 로그인이고, 서버 목록을 못 받았거나(null) 받은 서버가 새 서버일 때
  const canSend = isServerData && (serverManual === null || serverManual.canWrite)

  /** "틀렸어요" 를 누르거나 되돌립니다. */
  function toggleDispute(itemId: string) {
    const willDispute = disputes[itemId] === undefined
    setLocalDisputes((prev) => {
      const next = { ...prev }
      if (willDispute) next[itemId] = Date.now()
      else delete next[itemId]
      return next
    })
    // 서버에 있는 항목이거나 서버로 보낼 수 있는 항목이면 서버에도 적습니다. (시연 데이터는 이 기기에만)
    const isOnServer = serverManual?.items.some((item) => item.id === itemId) ?? false
    if (canSend && (isOnServer || canSendManualItem({ id: itemId }))) {
      queueDispute(itemId, willDispute)
    }
  }

  /** 항목을 맨 앞에 더합니다. 같은 id 가 이미 있으면 새 내용으로 바꿉니다. (같은 개선안을 두 번 올려도 한 줄) */
  function addItem(item: ManualItem) {
    setLocalItems((prev) => [item, ...prev.filter((existing) => existing.id !== item.id)])
    if (canSend && canSendManualItem(item)) sendItem(item)
  }

  return { items, addItem, disputes, toggleDispute }
}
