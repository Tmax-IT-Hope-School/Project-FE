import { useManualItems } from '@/hooks/useManualItems'
import { cn } from '@/lib/cn'
import { getTodayKey, moveDateKey } from '@/lib/date'
import { RECORDS_PATH } from '@/lib/tabMenu'
import type { ManualItem, ManualItemCategory } from '@/types'
import { useState } from 'react'
import { Link } from 'react-router-dom'

/**
 * 나 사용설명서 화면(/records/manual)입니다. (2026-10-24 History 리포트 시안 ⑤)
 * 실험 · 기록으로 확인된 것만 분류별로 쌓아 보여 줍니다. (hooks/useManualItems.ts)
 *   - 주간 리포트의 [사용설명서에 넣기] · 자기 실험의 "효과 있음" 이 여기에 올라옵니다.
 *   - 최근 7일 안에 들어온 항목에는 '새로 넣음' 표시가 붙습니다.
 *   - 항목을 누르면 [틀렸어요] 가 나옵니다. 누른 항목은 흐리게 둡니다.
 *
 * 기록 탭(History) 아래 화면이라 아래 탭은 '기록' 이 선택된 모양입니다. (lib/tabMenu.ts)
 *
 * 모양은 시안 ⑤(390px)에 맞췄습니다. (2026-10-24)
 *   모바일: 앱 헤더 대신 맨 위에 "‹ 나 사용설명서" 한 줄 (Layout 이 이 화면에서는 모바일 헤더를 숨깁니다)
 *   PC: 앱 헤더 아래에 "‹ 기록" 링크와 큰 제목 (예전 그대로)
 */

/** 흰 묶음 모양: 연한 테두리 + 아주 옅은 그림자 (기록 탭 리포트와 같은 모양) */
const CARD_CLASS =
  'rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]'

/** 분류를 보여 주는 순서와 이름 */
const CATEGORY_LABELS: { category: ManualItemCategory; label: string }[] = [
  { category: 'rhythm', label: '리듬' },
  { category: 'cautionDay', label: '주의할 날' },
  { category: 'effectiveMethod', label: '효과 있는 방법' },
  { category: 'careStyle', label: '잘 맞는 관리 방식' },
]

/** 이 날 수 안에 들어온 항목은 '새로 넣음' */
const NEW_ITEM_DAYS = 7

/** '2026-10-18' -> '10월 18일' */
function formatMonthDay(dateKey: string): string {
  const [, month, day] = dateKey.split('-').map(Number)
  return `${month}월 ${day}일`
}

export function ManualPage() {
  const { items, disputes, toggleDispute } = useManualItems()
  // 지금 [틀렸어요] 를 펼쳐 둔 항목. null 이면 모두 접혀 있습니다.
  const [openId, setOpenId] = useState<string | null>(null)
  const [todayKey] = useState(getTodayKey)
  const newSince = moveDateKey(todayKey, -(NEW_ITEM_DAYS - 1))

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col">
      {/* 모바일 머리: 앱 헤더 자리(맨 위, 높이 56px)에 ‹ 와 제목. 스크롤해도 위에 붙어 있습니다.
          -mx-4 -mt-3: Layout 의 여백을 덮어 화면 양 끝 · 맨 위에 붙입니다. 바탕은 앱 헤더와 같은 연회색입니다. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-3 flex h-14 items-center gap-1 bg-slate-100 pr-4 pl-2 sm:hidden">
        <Link
          to={RECORDS_PATH}
          aria-label="기록으로 돌아가기"
          className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-200"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <h1 className="text-xl font-bold text-slate-900">나 사용설명서</h1>
      </div>

      {/* PC 머리: 앱 헤더(메뉴) 아래에 "‹ 기록" 과 큰 제목 */}
      <div className="hidden sm:block">
        <Link
          to={RECORDS_PATH}
          className="text-brand mb-1 inline-flex h-11 items-center gap-1 text-sm font-medium hover:underline"
        >
          <span aria-hidden>‹</span> 기록
        </Link>
        <h1 className="text-[28px] leading-tight font-bold tracking-tight">나 사용설명서</h1>
      </div>

      <p className="mt-5 text-sm break-keep text-slate-600 sm:mt-2">
        실험과 기록으로 확인된 것만 쌓여요. 지금까지{' '}
        <strong className="font-bold text-slate-900">{items.length}개</strong>예요.
      </p>

      <div className="mt-4 flex flex-col gap-4">
        {items.length === 0 && (
          <div className={CARD_CLASS}>
            <p className="text-sm break-keep text-slate-600">
              아직 확인된 것이 없어요. 주간 리포트에서 해 본 것을 [사용설명서에 넣기] 하면 여기에
              쌓여요.
            </p>
          </div>
        )}

        {CATEGORY_LABELS.map(({ category, label }) => {
          const categoryItems = items.filter((item) => item.category === category)
          if (categoryItems.length === 0) return null
          return (
            <section key={category} className={CARD_CLASS}>
              <h2 className="text-brand-dark text-[13px] leading-5 font-bold tracking-[0.02em]">
                {label}
              </h2>
              <ul className="mt-2 divide-y divide-slate-100">
                {categoryItems.map((item) => (
                  <ManualRow
                    key={item.id}
                    item={item}
                    isNew={item.confirmedDate >= newSince}
                    isDisputed={disputes[item.id] !== undefined}
                    isOpen={openId === item.id}
                    onToggleOpen={() =>
                      setOpenId((current) => (current === item.id ? null : item.id))
                    }
                    onToggleDispute={() => toggleDispute(item.id)}
                  />
                ))}
              </ul>
            </section>
          )
        })}

        {items.length > 0 && (
          <p className="rounded-xl bg-slate-50 p-3 text-[13px] leading-5 break-keep text-slate-600">
            틀린 항목이 있으면 눌러서 &ldquo;틀렸어요&rdquo;를 알려 주세요. 틀린 항목은 흐리게
            둘게요.
          </p>
        )}
      </div>
    </div>
  )
}

interface ManualRowProps {
  item: ManualItem
  isNew: boolean
  isDisputed: boolean
  isOpen: boolean
  onToggleOpen: () => void
  onToggleDispute: () => void
}

/** 항목 한 줄. 누르면 [틀렸어요] (이미 눌렀으면 [되돌리기]) 가 펼쳐집니다. */
function ManualRow({
  item,
  isNew,
  isDisputed,
  isOpen,
  onToggleOpen,
  onToggleDispute,
}: ManualRowProps) {
  const panelId = `manual-${item.id}`

  return (
    // 항목 사이는 12px 씩, 가는 선으로 나눕니다. (묶음의 첫 · 마지막 항목은 위 · 아래 여백 없이)
    <li className="py-3 first:pt-0 last:pb-0">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={onToggleOpen}
        className={cn('w-full cursor-pointer text-left', isDisputed && 'opacity-50')}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="text-lg leading-[26px] font-bold break-keep text-slate-900">
            {item.title}
          </span>
          {isNew && !isDisputed && (
            <span className="bg-brand-light text-brand-dark mt-[3px] shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-4 font-bold">
              새로 넣음
            </span>
          )}
          {isDisputed && (
            <span className="mt-[3px] shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] leading-4 font-bold text-slate-600">
              틀렸어요
            </span>
          )}
        </span>
        <span className="mt-1 block text-sm break-keep text-slate-700">{item.evidence}</span>
        <span className="mt-2 block text-xs break-keep text-slate-500">
          {formatMonthDay(item.confirmedDate)} 확인{item.note ? ` · ${item.note}` : ''}
        </span>
      </button>

      {isOpen && (
        <div
          id={panelId}
          className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3"
        >
          <span className="text-sm break-keep text-slate-600">
            {isDisputed ? '틀렸다고 알려 줬어요.' : '이 항목이 나와 안 맞나요?'}
          </span>
          <button
            type="button"
            onClick={onToggleDispute}
            className="h-10 shrink-0 cursor-pointer rounded-xl bg-white px-4 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 hover:bg-slate-100"
          >
            {isDisputed ? '되돌리기' : '틀렸어요'}
          </button>
        </div>
      )}
    </li>
  )
}
