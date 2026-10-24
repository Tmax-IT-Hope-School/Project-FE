import { useIsServerData } from '@/hooks/useIsServerData'
import { ApiError } from '@/lib/api'
import {
  loadWeeklyPicks,
  saveWeeklyPick,
  type WeeklyPick,
  type WeeklyPickInput,
} from '@/lib/weeklyPicks'
import {
  canSendPick,
  clearPickUnsent,
  findPicksToSend,
  getPicksRange,
  loadUnsentPickWeeks,
  markPickUnsent,
  mergeServerPicks,
  saveWeeklyPickToServer,
  WEEKLY_PICKS_QUERY_KEY,
} from '@/lib/weeklyPicksApi'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

interface UseWeeklyPicksInput {
  /** 서버에서 받은 고른 것. 테스트 로그인이거나, 아직 못 받았거나, 못 받았으면 null (이 기기 것만 씁니다) */
  serverPicks: WeeklyPick[] | null
  /** 오늘 ('YYYY-MM-DD'). 서버에서 받아 온 기간(getPicksRange)을 정하는 데 씁니다. */
  todayKey: string
}

/**
 * 기록 탭의 "이번 주에 고른 것" 목록과, 새로 고를 때 부르는 함수를 줍니다. (#654, 규칙은 lib/weeklyPicksApi.ts)
 *
 *   const { picks, savePick } = useWeeklyPicks({ serverPicks, todayKey })
 *   savePick({ weekStart: '2026-10-26', title: '폰을 다른 방에 두기', hint: '…', skip: false })
 *
 * 1) 고르면 이 기기에 먼저 저장해서 화면이 바로 바뀝니다. 진짜 로그인이면 서버로도 보냅니다. (useMutation)
 *    보내기 전에 그 주를 "못 보냄" 으로 적어 두고, 보내지면 지웁니다. 그래서 보내다 실패하거나 앱을 닫아도 다음에 다시 보냅니다.
 * 2) 서버 목록을 받으면, 못 보낸 것과 이 기기에만 있는 것을 서버로 올립니다.
 * 테스트 로그인이면 서버로 보내지 않고 이 기기에만 저장합니다.
 */
export function useWeeklyPicks({ serverPicks, todayKey }: UseWeeklyPicksInput) {
  const isServerData = useIsServerData()
  const queryClient = useQueryClient()

  // 화면을 처음 그릴 때 한 번만 합칩니다. 그 뒤로는 고를 때마다 이 목록을 바꿉니다.
  const [picks, setPicks] = useState(() =>
    serverPicks === null
      ? loadWeeklyPicks()
      : mergeServerPicks(loadWeeklyPicks(), serverPicks, loadUnsentPickWeeks()),
  )

  const { mutate: sendPick } = useMutation({
    mutationFn: saveWeeklyPickToServer,
    onSuccess: (saved) => {
      clearPickUnsent(saved.weekStart)
      // 서버 목록이 바뀌었으니 다시 받게 합니다. 다음에 기록 탭을 열 때 옛 목록을 보지 않게 하려는 것입니다.
      void queryClient.invalidateQueries({ queryKey: WEEKLY_PICKS_QUERY_KEY })
    },
    onError: (error, pick) => {
      // 서버가 "값이 틀렸다(400)" 고 하면 다시 보내도 같아서 목록에서 뺍니다. 이 기기의 것은 그대로 둡니다.
      // 그 밖(인터넷 끊김 · 서버 오류)은 "못 보냄" 에 남아서 다음에 기록 탭을 열 때 다시 보냅니다.
      if (error instanceof ApiError && error.status === 400) clearPickUnsent(pick.weekStart)
    },
  })

  // 서버 목록을 받으면 못 보낸 것 · 이 기기에만 있는 것을 올립니다. (같은 주를 두 번 보내도 서버가 덮어써서 괜찮습니다)
  useEffect(() => {
    if (serverPicks === null) return
    const toSend = findPicksToSend(
      loadWeeklyPicks(),
      serverPicks,
      loadUnsentPickWeeks(),
      getPicksRange(todayKey),
    )
    for (const pick of toSend) sendPick(pick)
  }, [serverPicks, todayKey, sendPick])

  function savePick(input: WeeklyPickInput) {
    // 1) 이 기기에 먼저 저장하고, 화면의 목록에서 그 주를 새로 고른 것으로 바꿉니다.
    const saved = saveWeeklyPick(input)
    setPicks((prev) => [...prev.filter((pick) => pick.weekStart !== saved.weekStart), saved])
    // 2) 진짜 로그인이면 서버로도 보냅니다.
    if (isServerData && canSendPick(saved)) {
      markPickUnsent(saved.weekStart)
      sendPick(saved)
    }
  }

  return { picks, savePick }
}
