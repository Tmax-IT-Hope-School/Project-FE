import type { CareAction } from '@/lib/careDecision'
import { getTodayKey } from '@/lib/date'
import { isDeclineSnoozed, proposeGoalAdjust, type GoalAdjustProposal } from '@/lib/goalAdjust'
import { loadData, saveData } from '@/lib/storage'
import { useState } from 'react'

// 저장소에 넣는 이름입니다. (실제 키는 storage.ts 가 앞에 'study-' 를 붙여서 'study-goal-adjust-declined' 가 됩니다)
const STORAGE_KEY = 'goal-adjust-declined'
// 목표 조정을 수락한 날짜를 넣어 두는 이름입니다. "모든 기록 지우기" 로 같이 지워집니다. (lib/myData.ts)
const ACCEPTED_KEY = 'goal-adjust-accepted'

interface UseGoalAdjustOptions {
  /** 분기 함수(#91) 가 정한 오늘의 대응. 아직 모르면 null */
  action: CareAction | null
  /** 오늘 계획들의 목표 시간 합계 (분) */
  currentMinutes: number
  /** 최근 실제로 공부한 하루 평균 (분). 모르면 null */
  recentAverageMinutes: number | null
  /** 목표를 올릴 때 넘을 수 없는 합계 (분). 안 정하면 제한 없음 */
  maxMinutes?: number
  /** 수락했을 때 새 목표(분)를 받아서 실제로 바꾸는 함수 */
  onAccept: (newMinutes: number) => void
}

/**
 * 분기 결과가 "목표 상향/하향" 이면 제안을 띄우고, 수락·거절을 처리합니다. (#67)
 *
 *   const { proposal, accept, decline } = useGoalAdjust({ action, currentMinutes, recentAverageMinutes, onAccept })
 *   <GoalAdjustModal proposal={proposal} onAccept={accept} onDecline={decline} />
 *
 * - 수락하면 onAccept(새 목표) 를 부르고 팝업을 닫습니다.
 * - 거절하면 오늘 날짜를 저장해서 며칠 동안(DECLINE_SNOOZE_DAYS) 다시 묻지 않습니다.
 * - 이번 화면에서 한 번 답하면 같은 화면에서는 다시 띄우지 않습니다.
 */
export function useGoalAdjust({
  action,
  currentMinutes,
  recentAverageMinutes,
  maxMinutes,
  onAccept,
}: UseGoalAdjustOptions) {
  // 거절한 날짜. 거절한 적 없으면 null
  const [declinedDate, setDeclinedDate] = useState<string | null>(() =>
    loadData<string | null>(STORAGE_KEY, null),
  )
  // 수락한 날짜. 오늘 이미 수락했으면 화면을 다시 열어도 또 묻지 않습니다.
  // (기억하지 않으면 목표를 올린 뒤 다시 들어올 때마다 "또 올릴까요?" 가 떠서 목표가 계속 올라갑니다)
  const [acceptedDate, setAcceptedDate] = useState<string | null>(() =>
    loadData<string | null>(ACCEPTED_KEY, null),
  )
  // 이번 화면에서 이미 답했는지 (수락했으면 목표가 바뀌어 같은 제안이 또 나오는 것을 막습니다)
  const [isAnswered, setIsAnswered] = useState(false)
  const isAcceptedToday = acceptedDate === getTodayKey()

  const proposal: GoalAdjustProposal | null =
    action === null || isAnswered || isAcceptedToday || isDeclineSnoozed(declinedDate)
      ? null
      : proposeGoalAdjust(action, currentMinutes, recentAverageMinutes, maxMinutes)

  /** 수락: 새 목표를 적용하고 닫습니다. */
  function accept() {
    if (proposal === null) return
    onAccept(proposal.toMinutes)
    const today = getTodayKey()
    saveData(ACCEPTED_KEY, today)
    setAcceptedDate(today)
    setIsAnswered(true)
  }

  /** 거절: 오늘 날짜를 기억해서 며칠 동안 다시 묻지 않습니다. */
  function decline() {
    const today = getTodayKey()
    saveData(STORAGE_KEY, today)
    setDeclinedDate(today)
    setIsAnswered(true)
  }

  return { proposal, accept, decline }
}
