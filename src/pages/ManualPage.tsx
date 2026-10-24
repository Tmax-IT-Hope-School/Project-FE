import { Card } from '@/components/ui/Card'
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
 *   - 항목을 누르면 [틀렸어요] 가 나옵니다. 누른 항목은 흐리게 두고, 통계 탭 나무의 열매에서 뺍니다.
 *
 * 기록 탭(History) 아래 화면이라 아래 탭은 '기록' 이 선택된 모양입니다. (lib/tabMenu.ts)
 */

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
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <div>
        <Link
          to={RECORDS_PATH}
          className="text-brand mb-1 inline-flex h-11 items-center gap-1 text-sm font-medium hover:underline"
        >
          <span aria-hidden>‹</span> 기록
        </Link>
        <h1 className="text-[28px] leading-tight font-bold tracking-tight">나 사용설명서</h1>
        <p className="mt-2 text-[15px] break-keep text-slate-600">
          실험과 기록으로 확인된 것만 쌓여요. 지금까지{' '}
          <strong className="text-slate-900">{items.length}개</strong>예요.
        </p>
      </div>

      {items.length === 0 && (
        <Card>
          <p className="text-[15px] break-keep text-slate-600">
            아직 확인된 것이 없어요. 주간 리포트에서 해 본 것을 [사용설명서에 넣기] 하면 여기에
            쌓여요.
          </p>
        </Card>
      )}

      {CATEGORY_LABELS.map(({ category, label }) => {
        const categoryItems = items.filter((item) => item.category === category)
        if (categoryItems.length === 0) return null
        return (
          <Card key={category}>
            <h2 className="text-brand text-sm font-semibold">{label}</h2>
            <ul className="divide-y divide-slate-100">
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
          </Card>
        )
      })}

      {items.length > 0 && (
        <p className="rounded-2xl bg-slate-50 p-4 text-sm break-keep text-slate-600">
          틀린 항목이 있으면 눌러서 &ldquo;틀렸어요&rdquo;를 알려 주세요. 틀린 항목은 흐리게 두고
          나무 열매에서 빼요.
        </p>
      )}
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
    <li className="py-3 first:pt-2 last:pb-0">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={onToggleOpen}
        className={cn('w-full cursor-pointer text-left', isDisputed && 'opacity-50')}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="text-[19px] leading-snug font-bold break-keep text-slate-900">
            {item.title}
          </span>
          {isNew && !isDisputed && (
            <span className="bg-brand-light text-brand shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold">
              새로 넣음
            </span>
          )}
          {isDisputed && (
            <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
              틀렸어요
            </span>
          )}
        </span>
        <span className="mt-1 block text-[15px] break-keep text-slate-700">{item.evidence}</span>
        <span className="mt-1.5 block text-[13px] break-keep text-slate-500">
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
