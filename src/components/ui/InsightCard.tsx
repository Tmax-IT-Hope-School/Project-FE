import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/cn'
import { formatMinutes } from '@/lib/dailyRecords'
import { buildEvidenceRows, formatShortDate, loadCheckInsByDate } from '@/lib/insightEvidence'
import {
  getInsightResponses,
  insightResponseOptions,
  saveInsightResponse,
} from '@/lib/insightResponses'
import type { Insight, InsightResponse, StudySession } from '@/types'
import { loadInsightDisputes } from '@/lib/insightDisputes'
import { useId, useState } from 'react'

interface InsightCardProps {
  insight: Insight
  /** 근거 보기에서 날짜별 순공시간을 계산하는 데 쓰는 공부 기록 */
  sessions: StudySession[]
  /** true 면 내 기록으로 만든 발견이 아니라 미리 보기용 예시입니다. "예시" 표시가 붙습니다. */
  isExample?: boolean
  /** 한 문장 아래에 붙이는 풀이 (AI 분석의 본문 등). 없으면 한 문장만 */
  detail?: string
  /** true 면 AI 가 쓴 문장입니다. "AI 가 쓴 글" 표시가 붙습니다. (#419 AI 분석) */
  isAiWritten?: boolean
  className?: string
}

/**
 * "나를 잘 아는" 인사이트를 한 문장 카드로 보여줍니다. (#73)
 *
 * - 근거 보기 (#84): 누르면 이 결론이 나온 날짜마다 그날의 순공시간과 컨디션이 펼쳐집니다.
 * - 반응 버튼 2개 (#84): [몰랐는데 맞아] [이미 알던 거야] 중 하나만 고를 수 있고,
 *   다시 눌러 바꿀 수 있습니다. 고른 반응은 저장됩니다.
 * - [틀렸어] 는 숨겼습니다. 눌러도 실험으로 확인하는 곳이 없어서(가설·실험 탭은 2026-10-18 에 지움) 결과가 바뀌지 않았습니다.
 *   예전에 자기 실험으로 확인한 결과가 있으면 "AI가 틀렸어요" / "맞았어요" 는 그대로 붙입니다. (lib/insightDisputes.ts, #411)
 *
 * <InsightCard insight={insight} sessions={sessions} />
 * <InsightCard insight={insight} sessions={sessions} isExample />   // 예시일 때
 */
export function InsightCard({
  insight,
  sessions,
  isExample = false,
  detail,
  isAiWritten = false,
  className,
}: InsightCardProps) {
  const evidenceId = useId()
  const [isEvidenceOpen, setIsEvidenceOpen] = useState(false)
  // 처음에는 저장해 둔 반응을 불러옵니다. 저장된 게 없으면 인사이트가 들고 온 반응, 그것도 없으면 아직 안 고른 상태입니다.
  const [response, setResponse] = useState<InsightResponse | null>(
    () => getInsightResponses()[insight.id] ?? insight.response ?? null,
  )
  // 컨디션은 체크인에 저장돼 있어서 카드가 처음 그려질 때 한 번만 읽어 옵니다.
  const [checkIns] = useState(loadCheckInsByDate)
  // [틀렸어] 를 누른 뒤 실험으로 확인한 결과 (#411)
  const [dispute] = useState(() => loadInsightDisputes()[insight.id])

  const evidenceRows = buildEvidenceRows(insight.evidenceDates, sessions, checkIns)

  function handleSelectResponse(selected: InsightResponse) {
    setResponse(selected)
    saveInsightResponse(insight.id, selected)
  }

  return (
    <Card className={className}>
      {/* 표시(예시 · AI · 가설)가 하나라도 있을 때만 줄을 그립니다.
          "이번 주 발견" 같은 작은 머리 글자는 바깥 제목(통계 화면의 h2 '이번 발견')과 겹쳐서 뺐습니다. (2026-10-22) */}
      {(isExample || isAiWritten || insight.isHypothesis) && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {/* 예시는 내 기록으로 만든 문장이 아니라는 것을 먼저 알려줍니다. */}
          {isExample && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
              예시
            </span>
          )}
          {isAiWritten && (
            <span className="bg-brand-light text-brand rounded-full px-2 py-0.5 text-xs font-semibold">
              AI 가 쓴 글
            </span>
          )}
          {insight.isHypothesis && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
              가설
            </span>
          )}
        </div>
      )}

      <p
        className={cn(
          'text-[17px] leading-relaxed font-semibold break-keep text-slate-900',
          dispute?.outcome === 'aiWrong' && 'text-slate-500 line-through',
        )}
      >
        {insight.sentence}
      </p>
      {detail && <p className="mt-1 text-sm leading-relaxed break-keep text-slate-600">{detail}</p>}
      {dispute?.outcome === 'aiWrong' && (
        <p className="mt-1 text-sm font-medium text-violet-700">
          실험해 보니 AI가 틀렸어요. 이 발견은 철회했어요.
        </p>
      )}
      {dispute?.outcome === 'aiRight' && (
        <p className="mt-1 text-sm font-medium text-emerald-700">
          실험으로 확인했어요. 이 발견이 맞았어요.
        </p>
      )}

      {/* h-11 = 44px: 손가락으로 누르기 쉬운 높이 */}
      <button
        type="button"
        aria-expanded={isEvidenceOpen}
        aria-controls={evidenceId}
        onClick={() => setIsEvidenceOpen((prev) => !prev)}
        className="text-brand mt-1 inline-flex h-11 cursor-pointer items-center text-sm font-medium underline"
      >
        {isEvidenceOpen ? '근거 접기' : '근거 보기'} · {evidenceRows.length}일 기록
      </button>

      {isEvidenceOpen && (
        <ul
          id={evidenceId}
          className="mb-2 flex flex-col divide-y divide-slate-200 rounded-xl bg-slate-50 px-3"
        >
          {evidenceRows.map((row) => (
            <li
              key={row.date}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm tabular-nums"
            >
              <span className="font-medium text-slate-700">{formatShortDate(row.date)}</span>
              <span className="text-slate-600">
                {row.studyMinutes > 0 ? formatMinutes(row.studyMinutes) : '공부 기록 없음'}
                {' · '}
                {row.condition === null ? '체크인 없음' : `컨디션 ${row.condition}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* 375px 에서 한 줄에 안 들어가면 줄이 바뀝니다. (flex-wrap) */}
      <div
        role="radiogroup"
        aria-label="이 발견에 대한 내 반응"
        className="mt-2 flex flex-wrap gap-2"
      >
        {/* [틀렸어] 는 결과에 반영되지 않아서 뺍니다. (위 설명 참고) */}
        {insightResponseOptions
          .filter((option) => option.value !== 'wrong')
          .map((option) => {
            const isSelected = response === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => handleSelectResponse(option.value)}
                className={cn(
                  // 고르는 칩이라 rounded-full. 고른 것은 brand 테두리 + 굵은 글자로 또렷하게 보입니다.
                  'h-10 cursor-pointer rounded-full border px-4 text-sm font-medium transition-colors',
                  isSelected
                    ? 'border-brand bg-brand-light text-brand font-semibold'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                )}
              >
                {option.label}
              </button>
            )
          })}
      </div>
    </Card>
  )
}
