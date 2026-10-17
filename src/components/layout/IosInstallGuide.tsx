import { Button } from '@/components/ui/Button'
import { IOS_INSTALL_GUIDE_DISMISSED_KEY, isIos, isStandalone } from '@/lib/pwa'
import { loadData, saveData } from '@/lib/storage'
import { useState } from 'react'

const DISMISSED_KEY = IOS_INSTALL_GUIDE_DISMISSED_KEY

/** 안내를 보여줄지 정합니다. 아이폰이고, 아직 홈 화면 앱으로 연 게 아니고, 닫은 적이 없을 때만 보여줍니다. */
function shouldShowGuide(): boolean {
  return isIos() && !isStandalone() && !loadData<boolean>(DISMISSED_KEY, false)
}

/**
 * 아이폰에서 아직 설치 안 한 사람에게만 "공유 → 홈 화면에 추가" 를 알려주는 안내입니다. (#105)
 * 아이폰은 홈 화면에 추가해야만 알림을 받을 수 있어서 필요합니다.
 * (안드로이드 크롬은 브라우저가 알아서 "앱 설치" 를 띄워 줘서 따로 안내하지 않습니다)
 * 홈 화면('/')에서만 보여줍니다. 어느 화면에서 보여줄지는 Layout 이 정합니다.
 */
export function IosInstallGuide() {
  const [isVisible, setIsVisible] = useState(shouldShowGuide)

  if (!isVisible) return null

  function handleClose() {
    // 한 번 닫으면 다시 보여주지 않습니다.
    saveData(DISMISSED_KEY, true)
    setIsVisible(false)
  }

  return (
    <aside
      aria-label="홈 화면에 추가 안내"
      className="border-brand/20 bg-brand-light mb-6 flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="text-sm text-slate-700">
        <p className="font-semibold text-slate-900">STARFLOW 를 홈 화면에 추가해 줘</p>
        <p className="mt-1">
          아이폰은 홈 화면에 추가해야 알림을 받을 수 있어. Safari 아래쪽 <ShareIcon />
          <span className="font-semibold">공유</span> 버튼 →{' '}
          <span className="font-semibold">홈 화면에 추가</span> 를 눌러 줘.
        </p>
      </div>
      <Button
        variant="secondary"
        onClick={handleClose}
        className="shrink-0 self-start sm:self-auto"
      >
        닫기
      </Button>
    </aside>
  )
}

/* Safari 공유 버튼 모양 (네모에서 위로 화살표). 라이브러리 없이 SVG 로 그립니다. */
function ShareIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-brand mr-0.5 inline h-4 w-4 align-text-bottom"
    >
      <path d="M12 3v12" />
      <path d="m8 7 4-4 4 4" />
      <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
    </svg>
  )
}
