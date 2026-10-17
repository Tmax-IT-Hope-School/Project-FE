import { Card } from '@/components/ui/Card'
import { useQueryParam } from '@/hooks/useQueryParam'
import { cn } from '@/lib/cn'
import {
  getPhoneFocusEnabled,
  phoneFocusGuides,
  setPhoneFocusEnabled,
  type PhoneKind,
} from '@/lib/phoneFocus'
import { useState } from 'react'
import { Link } from 'react-router-dom'

/** 처음 보여줄 탭을 고릅니다. 아이폰 브라우저면 아이폰, 아니면 갤럭시(안드로이드)입니다. */
function guessPhoneKind(): PhoneKind {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'iphone' : 'galaxy'
}

/**
 * 휴대폰 집중 모드 켜는 법 안내 화면입니다. (#106)
 * 웹은 다른 앱을 잠글 수 없어서, 휴대폰 기본 기능으로 직접 잠그는 방법을 단계별로 알려줍니다.
 * 아이폰·갤럭시를 탭으로 나누고, 체크인에서 "켰어?" 를 물을지 고를 수 있습니다.
 */
export function PhoneFocusGuidePage() {
  // 아이폰·갤럭시 탭은 주소에 둡니다. (/phone-focus?phone=android)
  // 주소에 없을 때는 지금 쓰는 기기를 짐작해서 엽니다.
  const [guessedKind] = useState<PhoneKind>(guessPhoneKind)
  const [kindParam, setSelectedKind] = useQueryParam('phone', guessedKind)
  // 주소는 누구나 고칠 수 있어서, 안내 목록에 없는 값이면 짐작한 기기로 봅니다.
  const selectedKind = phoneFocusGuides.some((item) => item.kind === kindParam)
    ? kindParam
    : guessedKind
  const [isCheckinOn, setIsCheckinOn] = useState(getPhoneFocusEnabled)

  const guide = phoneFocusGuides.find((item) => item.kind === selectedKind) ?? phoneFocusGuides[0]

  function handleToggleCheckin() {
    const next = !isCheckinOn
    setIsCheckinOn(next)
    setPhoneFocusEnabled(next)
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          to="/settings"
          className="text-brand inline-flex h-11 items-center gap-1 text-sm font-medium hover:underline"
        >
          <span aria-hidden>‹</span> 설정
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
          휴대폰 집중 모드 켜는 법
        </h1>
        <p className="mt-2 text-slate-600">
          이 앱은 다른 앱을 잠글 수 없어요. 휴대폰 기본 기능으로 공부 시간에 SNS 앱을 직접 잠가
          보세요. 홈 화면에 추가한 이 앱으로 열고 화면을 고정하면 다른 앱으로 나갈 수 없어요.
          (브라우저로 연 채 고정하면 그 브라우저 안에서 다른 사이트는 열 수 있어요) 고정을 푸는
          방법도 꼭 같이 봐 두세요.
        </p>
      </div>

      {/* 아이폰 · 갤럭시 탭. 좁은 화면에서는 두 칸이 반반씩 차지합니다. */}
      <div role="tablist" aria-label="휴대폰 종류" className="grid grid-cols-2 gap-2">
        {phoneFocusGuides.map((item) => {
          const isSelected = item.kind === selectedKind
          return (
            <button
              key={item.kind}
              type="button"
              role="tab"
              id={`phone-tab-${item.kind}`}
              aria-selected={isSelected}
              aria-controls="phone-guide-panel"
              onClick={() => setSelectedKind(item.kind)}
              className={cn(
                'h-11 cursor-pointer rounded-lg border text-sm font-semibold transition-colors',
                isSelected
                  ? 'border-brand bg-brand-light text-brand'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
              )}
            >
              {item.label}
            </button>
          )
        })}
      </div>

      <div
        id="phone-guide-panel"
        role="tabpanel"
        aria-labelledby={`phone-tab-${guide.kind}`}
        className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start"
      >
        {guide.methods.map((method) => (
          <Card key={method.title} title={method.title}>
            <ol className="flex flex-col gap-3">
              {method.steps.map((step, index) => (
                <li key={step} className="flex gap-3 text-sm text-slate-700">
                  <span className="bg-brand-light text-brand flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                    {index + 1}
                  </span>
                  <span className="min-w-0 break-words">{step}</span>
                </li>
              ))}
            </ol>

            {/* 앱 하나에 고정한 것을 푸는 방법. 급할 때 못 풀면 안 돼서 단계 바로 아래에 따로 보여줍니다. (#250) */}
            {method.releaseSteps && (
              <div className="mt-4 flex flex-col gap-3 rounded-lg bg-slate-50 p-3">
                <h3 className="text-sm font-semibold text-slate-900">고정을 푸는 방법</h3>
                <ol className="flex flex-col gap-2">
                  {method.releaseSteps.map((step, index) => (
                    <li key={step} className="flex gap-3 text-sm text-slate-700">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">
                        {index + 1}
                      </span>
                      <span className="min-w-0 break-words">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </Card>
        ))}
      </div>

      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm break-words text-slate-700">
        휴대폰 메뉴 이름은 기종과 OS 버전마다 조금씩 달라요. 메뉴가 안 보이면 설정 앱의 검색창에{' '}
        <strong>&quot;{guide.searchWord}&quot;</strong> 를 검색해 보세요.
      </p>

      <Card title="체크인에서 확인받기">
        <p className="text-sm text-slate-600">
          켜 두면 매일 체크인에서 &quot;어제 휴대폰 집중 모드 켰어?&quot; 를 물어봐요. 정말 켰는지는
          확인할 수 없어서, 내가 답한 대로만 기록해요.
        </p>
        {/* 켜고 끄는 스위치. 누르는 곳은 최소 44px(h-11) 입니다. */}
        <button
          type="button"
          role="switch"
          aria-checked={isCheckinOn}
          onClick={handleToggleCheckin}
          className={cn(
            'mt-4 inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-lg border px-4 text-sm font-semibold transition-colors sm:w-auto',
            isCheckinOn
              ? 'border-brand bg-brand hover:bg-brand-dark text-white'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
          )}
        >
          {isCheckinOn ? '체크인에서 확인받는 중 · 끄기' : '체크인에서 확인받기'}
        </button>
      </Card>
    </div>
  )
}
