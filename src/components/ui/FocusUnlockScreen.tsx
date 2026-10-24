import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import {
  QUICK_UNLOCK_REASONS,
  UNLOCK_REASON_MAX_LENGTH,
  UNLOCK_WAIT_SECONDS,
  isValidUnlockReason,
} from '@/lib/focusMode'
import { useEffect, useState } from 'react'

interface FocusUnlockScreenProps {
  /** "계속 집중하기" 를 눌렀을 때 */
  onStay: () => void
  /** 10초를 기다리고 이유를 적어 "해제하기" 를 눌렀을 때. 적은 이유를 넘겨줍니다. */
  onUnlock: (reason: string) => void
}

/**
 * 집중 모드(#69)를 풀 때 나오는 "마찰형" 해제 화면입니다. 화면 전체를 덮습니다.
 * 10초 카운트다운이 끝나야 이유 입력칸이 열리고, 이유를 적어야 해제할 수 있습니다.
 * 타이머 화면의 "집중 모드 나가기" 와, 집중 모드 중에 다른 주소로 가려고 할 때(Layout) 같이 씁니다.
 *
 * <FocusUnlockScreen onStay={...} onUnlock={(reason) => ...} />
 */
export function FocusUnlockScreen({ onStay, onUnlock }: FocusUnlockScreenProps) {
  // 남은 기다림(초). 0 이 되면 이유를 쓸 수 있습니다.
  const [secondsLeft, setSecondsLeft] = useState(UNLOCK_WAIT_SECONDS)
  const [reason, setReason] = useState('')

  const isWaiting = secondsLeft > 0
  const canUnlock = !isWaiting && isValidUnlockReason(reason)

  useEffect(() => {
    if (secondsLeft <= 0) return
    // 1초 뒤에 1 줄입니다. 숫자가 바뀌면 이 effect 가 다시 돌면서 다음 1초를 셉니다.
    const timeoutId = setTimeout(() => setSecondsLeft((prev) => prev - 1), 1000)
    return () => clearTimeout(timeoutId)
  }, [secondsLeft])

  function handleUnlock() {
    // 버튼이 disabled 라도 한 번 더 확인합니다.
    if (!canUnlock) return
    onUnlock(reason.trim())
  }

  return (
    // fixed inset-0: 헤더·하단 탭까지 덮습니다. 내용이 길면 이 화면 안에서만 세로로 스크롤됩니다.
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="focus-unlock-title"
      className="fixed inset-0 z-50 overflow-y-auto bg-white"
    >
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col px-4 py-10">
        <div className="flex flex-col items-center gap-4 text-center">
          {/* 카운트다운 동그라미. 스크린 리더가 1초마다 읽지 않도록 숫자는 aria-hidden, 안내 문장만 읽게 합니다. */}
          <div
            aria-hidden
            className={cn(
              'flex h-28 w-28 items-center justify-center rounded-full border-8 text-3xl font-bold tabular-nums',
              isWaiting ? 'border-slate-200 text-slate-500' : 'border-brand text-slate-900',
            )}
          >
            {secondsLeft}초
          </div>
          <h2 id="focus-unlock-title" className="text-[28px] font-bold text-slate-900">
            정말 나갈 거야?
          </h2>
          <p className="text-[15px] break-keep text-slate-600">
            {isWaiting
              ? `${UNLOCK_WAIT_SECONDS}초만 기다려 줘. 그동안 한 번 더 생각해 봐.`
              : `${UNLOCK_WAIT_SECONDS}초 기다렸어. 이제 이유를 적으면 나갈 수 있어.`}
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-2">
          <p className="text-sm font-semibold text-slate-700">빠르게 고르기</p>
          {/* 글자 수가 제각각이라 flex-wrap 으로 넘치면 다음 줄로 보냅니다. */}
          <div className="flex flex-wrap gap-2">
            {QUICK_UNLOCK_REASONS.map((quickReason) => (
              <button
                key={quickReason}
                type="button"
                disabled={isWaiting}
                aria-pressed={reason === quickReason}
                onClick={() => setReason(quickReason)}
                className={cn(
                  'h-10 cursor-pointer rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  reason === quickReason
                    ? 'border-brand bg-brand-light text-brand ring-brand font-semibold ring-1'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                )}
              >
                {quickReason}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <label htmlFor="focus-unlock-reason" className="text-sm font-semibold text-slate-700">
            나가는 이유
          </label>
          <textarea
            id="focus-unlock-reason"
            rows={3}
            disabled={isWaiting}
            maxLength={UNLOCK_REASON_MAX_LENGTH}
            placeholder={isWaiting ? '카운트다운이 끝나면 쓸 수 있어요' : '한 줄로 적어 주세요'}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={cn(
              'w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-base',
              'placeholder:text-slate-400 disabled:bg-slate-50',
              'focus:border-brand focus:ring-brand/30 focus:ring-2 focus:outline-none',
            )}
          />
          <p className="text-right text-xs text-slate-500">
            {reason.length}/{UNLOCK_REASON_MAX_LENGTH}
          </p>
        </div>

        {/* mt-auto: 버튼을 화면 아래쪽으로 밀어 둡니다. (시안처럼) */}
        <div className="mt-auto flex flex-col gap-3 pt-8">
          {/* 1순위 [계속 집중하기] 는 엄지 자리에 h-14 로 크게, 나가는 [해제하기] 는 낮은 빨간 글자 버튼으로 둡니다. (2차 규칙 3) */}
          <Button size="lg" className="w-full" onClick={onStay}>
            계속 집중하기
          </Button>
          <Button
            variant="ghost"
            className="w-full text-red-700 hover:bg-red-50"
            disabled={!canUnlock}
            onClick={handleUnlock}
          >
            해제하기
          </Button>
          <p className="text-[13px] break-keep text-slate-500">
            해제 기록은 벌이 아니라 나를 알기 위한 데이터야. 어떤 시간에 약한지 통계 탭에서
            보여줄게.
          </p>
        </div>
      </div>
    </div>
  )
}
