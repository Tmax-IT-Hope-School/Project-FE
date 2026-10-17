import { loadRecord, saveData } from '@/lib/storage'
import type { CheckIn } from '@/types'
import { useEffect, useState } from 'react'

/** 날짜('YYYY-MM-DD')마다 그날의 체크인을 하나씩 모아 둔 모양입니다. */
type CheckInsByDate = Record<string, CheckIn>

// 저장소에 넣는 이름입니다. (실제 키는 storage.ts 가 앞에 'study-' 를 붙여서 'study-checkins' 가 됩니다)
const STORAGE_KEY = 'checkins'

/**
 * 매일 체크인을 날짜별로 하나씩 들고 있고, 바뀔 때마다 localStorage 에 저장합니다.
 * 같은 날 다시 체크인하면 그 날의 기록을 덮어씁니다.
 *
 *   const { getCheckIn, saveCheckIn, checkIns } = useCheckIns()
 *   const todayCheckIn = getCheckIn('2026-09-28')
 */
export function useCheckIns() {
  // 처음 한 번만 저장소에서 불러옵니다. 저장된 게 없으면 빈 객체({})라서 체크인한 날이 없는 상태입니다.
  const [checkInsByDate, setCheckInsByDate] = useState<CheckInsByDate>(() =>
    loadRecord<CheckIn>(STORAGE_KEY),
  )

  // 체크인이 바뀔 때마다 저장합니다.
  useEffect(() => {
    saveData(STORAGE_KEY, checkInsByDate)
  }, [checkInsByDate])

  /** 그 날짜의 체크인을 돌려줍니다. 아직 체크인하지 않은 날은 undefined 입니다. */
  function getCheckIn(date: string): CheckIn | undefined {
    return checkInsByDate[date]
  }

  /** 그 날짜의 체크인을 저장합니다. 이미 있으면 덮어씁니다. (같은 날 다시 체크인하면 고칠 수 있는 이유) */
  function saveCheckIn(checkIn: CheckIn) {
    setCheckInsByDate((prev) => ({ ...prev, [checkIn.date]: checkIn }))
  }

  /** 저장된 체크인 전부 (날짜 순서는 보장하지 않습니다) */
  const checkIns = Object.values(checkInsByDate)

  return { getCheckIn, saveCheckIn, checkIns }
}
