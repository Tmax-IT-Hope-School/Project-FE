import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { SegmentedToggle } from '@/components/ui/SegmentedToggle'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  answerChecksQuery,
  countResults,
  fixAnswerCheckItem,
  type AnswerCheck,
  type AnswerCheckItem,
  type AnswerResult,
} from '@/lib/answerChecksApi'
import { getApiErrorMessage } from '@/lib/api'
import { cn } from '@/lib/cn'
import { getTodayKey } from '@/lib/date'

/** 폰에서 여는 주소 (QR 에 담깁니다) */
const ANSWER_CHECK_PATH = '/stats/answer-check'
/** QR 창이 열린 동안(과 창이 닫힌 뒤 남은 사진을 기다리는 동안) 오늘 결과를 다시 묻는 간격 */
const POLL_INTERVAL_MS = 3000
/** 이만큼 지나도 폰이 안 올리면 기다리기를 멈춥니다. (10분) */
const WAIT_LIMIT_MS = 10 * 60 * 1000
/**
 * 첫 결과가 와서 QR 창이 닫힌 뒤에도, 폰이 나머지 사진을 보내는 동안 결과를 계속 받아옵니다.
 * 이만큼 새 결과가 없으면 다 보낸 것으로 보고 멈춥니다. (2분 · 사진 한 장이 최대 25초 + 보내는 시간)
 */
const FOLLOW_QUIET_MS = 2 * 60 * 1000

/** 결과별 이름 · 모양 · 색. 색만으로 나누지 않도록 모양(○ ✕ △)과 글자를 같이 씁니다. */
const RESULT_INFO: Record<AnswerResult, { label: string; symbol: string; className: string }> = {
  CORRECT: { label: '맞음', symbol: '○', className: 'bg-emerald-100 text-emerald-800' },
  WRONG: { label: '틀림', symbol: '✕', className: 'bg-rose-100 text-rose-800' },
  UNSURE: { label: '애매', symbol: '△', className: 'bg-amber-100 text-amber-800' },
}

const RESULT_OPTIONS = (['CORRECT', 'WRONG', 'UNSURE'] as const).map((value) => ({
  value,
  label: RESULT_INFO[value].label,
}))

/** '2026-10-24' → '10월 24일' */
function formatDate(dateKey: string): string {
  const [, month, day] = dateKey.split('-').map(Number)
  return `${month}월 ${day}일`
}

/**
 * 통계 탭 맨 위의 "오늘 푼 문제 채점" 카드와 오늘 채점 결과입니다. (2026-10-24)
 * 통계 화면 파일(pages/StatsPage.tsx)이 이미 아주 길어서, AI 분석 카드처럼 따로 둡니다.
 *
 *   PC: [사진 올리기] → QR 창 → 폰으로 찍어 올리면 창이 닫히고 아래에 결과 카드가 생깁니다.
 *       폰이 사진을 여러 장 보내면, 창이 닫힌 뒤에도 끝난 사진부터 결과 카드가 하나씩 늘어납니다.
 *   폰: QR 을 찍을 수 없으니 [사진 올리기] 가 바로 찍기 화면(/stats/answer-check)으로 갑니다.
 */
export function AnswerCheckCard() {
  // 오늘 날짜는 화면을 처음 그릴 때 한 번만 정합니다. (새벽 4시 기준, lib/date.ts)
  const [todayKey] = useState(getTodayKey)
  const [isQrOpen, setIsQrOpen] = useState(false)
  // QR 창이 닫힌 뒤에도 남은 사진의 결과를 계속 받아오는 중인지
  const [isFollowing, setIsFollowing] = useState(false)
  // 아래 TodayResults 의 useEffect 가 이 함수를 지켜봐서, 다시 그릴 때마다 새로 만들지 않습니다.
  const stopFollowing = useCallback(() => setIsFollowing(false), [])

  /** QR 창을 연 뒤에 생긴 첫 결과를 찾았을 때: 창을 닫고, 나머지 사진의 결과를 이어서 받아옵니다. */
  function handleFound() {
    setIsQrOpen(false)
    setIsFollowing(true)
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title="오늘 푼 문제 채점">
        <p className="text-[15px] break-keep text-slate-600">
          채점한 페이지도, 아직 안 한 페이지도 폰으로 찍어 올릴 수 있어요.
        </p>
        {/* 폰(좁은 화면)은 바로 찍기 화면으로, PC 는 QR 창을 엽니다. */}
        <Link
          to={ANSWER_CHECK_PATH}
          className="bg-brand mt-4 flex h-14 w-full items-center justify-center rounded-2xl text-[17px] font-semibold text-white active:scale-[0.98] sm:hidden"
        >
          사진 올리기
        </Link>
        <Button
          size="lg"
          className="mt-4 hidden w-full sm:inline-flex sm:w-auto"
          onClick={() => setIsQrOpen(true)}
        >
          사진 올리기
        </Button>
      </Card>

      <Modal isOpen={isQrOpen} onClose={() => setIsQrOpen(false)} title="폰으로 QR 찍기">
        <AsyncBoundary
          pendingFallback={<Skeleton className="mx-auto size-48 rounded-2xl" />}
          errorMessage="오늘 채점 결과를 불러오지 못했어요. 다시 시도해 주세요."
        >
          <QrWaiting todayKey={todayKey} onFound={handleFound} />
        </AsyncBoundary>
      </Modal>

      <AsyncBoundary
        pendingFallback={<Skeleton className="h-40 w-full rounded-2xl" />}
        errorMessage="오늘 채점 결과를 불러오지 못했어요. 다시 시도해 주세요."
      >
        <TodayResults todayKey={todayKey} isFollowing={isFollowing} onQuiet={stopFollowing} />
      </AsyncBoundary>
    </div>
  )
}

interface QrWaitingProps {
  todayKey: string
  /** 창을 연 뒤에 생긴 결과를 찾았을 때 */
  onFound: () => void
}

/**
 * QR 창의 안쪽. 3초마다 오늘 결과를 다시 물어서, 창을 연 뒤에 생긴 결과가 보이면 onFound 를 부릅니다.
 * 10분이 지나면 묻기를 멈추고 [다시 열기] 를 보여 줍니다.
 */
function QrWaiting({ todayKey, onFound }: QrWaitingProps) {
  // [다시 열기] 를 누를 때마다 바뀌는 번호. key 로 넘겨서 기다리기를 처음부터 다시 합니다.
  const [round, setRound] = useState(0)
  return (
    <QrWaitingRound
      key={round}
      todayKey={todayKey}
      onFound={onFound}
      onRestart={() => setRound((n) => n + 1)}
    />
  )
}

interface QrWaitingRoundProps extends QrWaitingProps {
  onRestart: () => void
}

function QrWaitingRound({ todayKey, onFound, onRestart }: QrWaitingRoundProps) {
  const [isExpired, setIsExpired] = useState(false)
  const { data } = useSuspenseQuery({
    ...answerChecksQuery(todayKey),
    // 기다리는 동안에만 3초마다 다시 묻습니다. 다른 탭에 가 있으면 브라우저가 쉬게 둡니다(기본값).
    refetchInterval: isExpired ? false : POLL_INTERVAL_MS,
  })

  // 창을 열 때 이미 화면에 있던 결과들. 여기에 없는 결과가 생기면 "폰이 방금 올린 것" 입니다.
  // (PC 와 서버의 시계가 조금 달라도 틀리지 않게, 시각 대신 id 로 비교합니다)
  const [seenIds] = useState(() => new Set(data.map((check) => check.id)))
  const newCheckId = data.find((check) => !seenIds.has(check.id))?.id ?? null

  useEffect(() => {
    if (newCheckId !== null) onFound()
  }, [newCheckId, onFound])

  // 10분이 지나면 기다리기를 멈춥니다.
  useEffect(() => {
    const timer = setTimeout(() => setIsExpired(true), WAIT_LIMIT_MS)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-[15px] break-keep text-slate-600">
        폰 기본 카메라로 찍어 주세요. 같은 계정으로 로그인돼 있어야 해요.
      </p>
      {/* 흰 테두리(marginSize)를 남겨야 카메라가 QR 을 잘 읽습니다. */}
      <QRCodeSVG
        value={`${window.location.origin}${ANSWER_CHECK_PATH}`}
        size={192}
        marginSize={2}
        title="사진 채점 화면 주소 QR"
        className={cn('max-w-full rounded-xl', isExpired && 'opacity-30')}
      />
      {isExpired ? (
        <>
          <p className="text-sm break-keep text-slate-500">10분이 지나서 기다리기를 멈췄어요.</p>
          <Button variant="outline" onClick={onRestart}>
            다시 열기
          </Button>
        </>
      ) : (
        <p role="status" className="flex items-center gap-2 text-sm text-slate-500">
          <span aria-hidden className="bg-brand size-2 animate-pulse rounded-full" />
          폰을 기다리는 중
        </p>
      )}
    </div>
  )
}

interface TodayResultsProps {
  todayKey: string
  /** true 면 3초마다 다시 받아옵니다. (폰이 남은 사진을 보내는 중) */
  isFollowing: boolean
  /** 받아오는 동안 FOLLOW_QUIET_MS 만큼 새 결과가 없을 때 */
  onQuiet: () => void
}

/** 오늘 채점 결과 카드들 (최신 것이 위). 없으면 아무것도 그리지 않습니다. */
function TodayResults({ todayKey, isFollowing, onQuiet }: TodayResultsProps) {
  const { data } = useSuspenseQuery({
    ...answerChecksQuery(todayKey),
    refetchInterval: isFollowing ? POLL_INTERVAL_MS : false,
  })

  // 새 결과가 생길 때마다(개수가 바뀔 때마다) 2분을 처음부터 다시 셉니다. 2분 동안 그대로면 멈춥니다.
  useEffect(() => {
    if (!isFollowing) return
    const timer = setTimeout(onQuiet, FOLLOW_QUIET_MS)
    return () => clearTimeout(timer)
  }, [isFollowing, data.length, onQuiet])

  if (data.length === 0) return null
  return (
    <>
      {data.map((check) => (
        <ResultCard key={check.id} check={check} todayKey={todayKey} />
      ))}
    </>
  )
}

/** 고치는 중인 문제 하나의 값 */
interface ItemDraft {
  result: AnswerResult
  /** 정답 입력칸 (UNMARKED 만). 비우면 null 로 보냅니다. */
  correctAnswer: string
}

interface ResultCardProps {
  check: AnswerCheck
  todayKey: string
}

/** 결과 한 장. [고치기] 를 누르면 문제마다 맞음 · 틀림 · 애매를 바꿀 수 있습니다. */
function ResultCard({ check, todayKey }: ResultCardProps) {
  const queryClient = useQueryClient()
  // null 이면 보기, 값이 있으면 고치는 중 (문제 id → 고친 값)
  const [drafts, setDrafts] = useState<Record<string, ItemDraft> | null>(null)
  const isUnmarked = check.mode === 'UNMARKED'

  /** 고치는 중에 이 문제가 처음 값과 달라졌는지 */
  function isChanged(item: AnswerCheckItem): boolean {
    const draft = drafts?.[item.id]
    if (!draft) return false
    if (draft.result !== item.result) return true
    return isUnmarked && draft.correctAnswer.trim() !== (item.correctAnswer ?? '')
  }

  const changedItems = check.items.filter(isChanged)
  // 고치는 중이면 바꾼 값으로 바로 다시 셉니다.
  const counts =
    drafts === null
      ? check.counts
      : countResults(check.items.map((item) => drafts[item.id]?.result ?? item.result))

  const save = useMutation({
    mutationFn: async (items: AnswerCheckItem[]) => {
      // 바뀐 문제만 하나씩 차례로 보냅니다. (서버가 개수를 다시 셀 때 서로 엉키지 않게)
      for (const item of items) {
        const draft = drafts?.[item.id]
        if (!draft) continue
        const correctAnswer = isUnmarked ? draft.correctAnswer.trim() : ''
        await fixAnswerCheckItem({
          checkId: check.id,
          itemId: item.id,
          result: draft.result,
          correctAnswer: correctAnswer === '' ? null : correctAnswer,
        })
      }
    },
    onSuccess: () => setDrafts(null),
    // 성공해도, 중간에 실패해도(앞의 몇 개는 저장됐을 수 있음) 서버의 값을 다시 받아옵니다.
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: answerChecksQuery(todayKey).queryKey }),
  })

  function handleStartEdit() {
    const next: Record<string, ItemDraft> = {}
    for (const item of check.items) {
      next[item.id] = { result: item.result, correctAnswer: item.correctAnswer ?? '' }
    }
    save.reset()
    setDrafts(next)
  }

  function updateDraft(itemId: string, changes: Partial<ItemDraft>) {
    setDrafts((current) =>
      current === null ? current : { ...current, [itemId]: { ...current[itemId], ...changes } },
    )
  }

  function handleSave() {
    if (changedItems.length === 0) {
      setDrafts(null)
      return
    }
    save.mutate(changedItems)
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-[17px] font-bold tracking-tight text-slate-900">오늘 채점 결과</h3>
        <span className="bg-brand-light text-brand-dark rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap">
          {isUnmarked ? 'AI 가 풀었어요' : '내 채점 읽음'}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        {formatDate(check.date)}
        {check.subjectText && ` · ${check.subjectText}`}
      </p>

      {/* 맞음 · 틀림 · 애매 개수. 세 칸을 같은 크기로 놓습니다. (320px 에서도 한 줄) */}
      <ul className="mt-4 grid grid-cols-3 gap-2">
        {(['CORRECT', 'WRONG', 'UNSURE'] as const).map((result) => {
          const count =
            result === 'CORRECT'
              ? counts.correct
              : result === 'WRONG'
                ? counts.wrong
                : counts.unsure
          return (
            <li
              key={result}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-xl py-2 text-xs font-semibold',
                RESULT_INFO[result].className,
              )}
            >
              <span className="whitespace-nowrap">
                <span aria-hidden>{RESULT_INFO[result].symbol}</span> {RESULT_INFO[result].label}
              </span>
              <span className="text-base tabular-nums">{count}</span>
            </li>
          )
        })}
      </ul>

      <ul className="mt-4 divide-y divide-slate-100">
        {check.items.map((item) => {
          const draft = drafts?.[item.id]
          const isEdited = item.editedByUser || isChanged(item)
          return (
            <li key={item.id} className="flex flex-col gap-2 py-3">
              <div className="flex items-start gap-3">
                <span className="w-10 shrink-0 pt-0.5 text-sm font-bold whitespace-nowrap text-slate-900 tabular-nums">
                  {item.number}번
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  {/* 조각마다 한 덩어리(flex 칸)라서 조각 사이에서만 줄이 바뀝니다. 아주 긴 답은 break-words 로 칸 안에서 접힙니다. */}
                  <p className="flex flex-wrap gap-x-1.5 text-sm text-slate-700">
                    {describeItem(item, isUnmarked).map((part, index) => (
                      <span key={part} className="max-w-full break-words">
                        {index > 0 && (
                          <span aria-hidden className="mr-1.5 text-slate-300">
                            ·
                          </span>
                        )}
                        {part}
                      </span>
                    ))}
                  </p>
                  {isEdited && (
                    <span className="self-start rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-slate-600">
                      직접 고침
                    </span>
                  )}
                </div>
                {draft === undefined && <ResultChip result={item.result} />}
              </div>

              {draft !== undefined && (
                <div className="flex flex-col gap-2 sm:pl-13">
                  <SegmentedToggle
                    label={`${item.number}번 결과`}
                    options={RESULT_OPTIONS}
                    value={draft.result}
                    onChange={(result) => updateDraft(item.id, { result })}
                  />
                  {isUnmarked && (
                    <label className="flex items-center gap-2">
                      <span className="shrink-0 text-sm whitespace-nowrap text-slate-600">
                        정답
                      </span>
                      <input
                        value={draft.correctAnswer}
                        maxLength={50}
                        onChange={(event) =>
                          updateDraft(item.id, { correctAnswer: event.target.value })
                        }
                        placeholder="선택 · 예: x = 7"
                        className="focus:ring-brand/30 h-11 w-full min-w-0 rounded-xl bg-slate-100 px-3 text-base placeholder:text-slate-400 focus:ring-2 focus:outline-none"
                      />
                    </label>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {isUnmarked && (
        <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-sm break-keep text-slate-600">
          AI 도 틀릴 수 있어요. AI 답이 이상하면 직접 확인해 보세요.
        </p>
      )}

      {save.isError && (
        <p role="alert" className="mt-3 text-sm break-keep text-red-600">
          {getApiErrorMessage(save.error)}
        </p>
      )}

      {drafts === null ? (
        <Button variant="outline" className="mt-4 w-full sm:w-auto" onClick={handleStartEdit}>
          고치기
        </Button>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex">
          <Button disabled={save.isPending} onClick={handleSave}>
            {save.isPending ? '저장하는 중' : '저장'}
          </Button>
          <Button variant="outline" disabled={save.isPending} onClick={() => setDrafts(null)}>
            취소
          </Button>
        </div>
      )}
    </Card>
  )
}

/**
 * 문제 한 줄의 설명 조각들. MARKED 는 읽은 표시, UNMARKED 는 내 답 · AI 답 (· 정답)
 * 조각으로 나누는 까닭: 좁은 화면에서 'x =' 와 '6' 처럼 답 한가운데서 줄이 바뀌지 않게, 조각 사이에서만 줄을 바꿉니다.
 */
function describeItem(item: AnswerCheckItem, isUnmarked: boolean): string[] {
  if (!isUnmarked) {
    if (item.markRead === 'O') return ['O 표시를 읽었어요']
    if (item.markRead === 'X') return ['X 표시를 읽었어요']
    return ['표시를 읽지 못했어요']
  }
  const parts = [`내 답 ${item.myAnswer ?? '(못 읽음)'}`, `AI 답 ${item.aiAnswer ?? '(없음)'}`]
  if (item.correctAnswer !== null) parts.push(`정답 ${item.correctAnswer}`)
  return parts
}

interface ResultChipProps {
  result: AnswerResult
}

/** 맞음 · 틀림 · 애매 작은 표시 */
function ResultChip({ result }: ResultChipProps) {
  const info = RESULT_INFO[result]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        info.className,
      )}
    >
      <span aria-hidden>{info.symbol}</span>
      {info.label}
    </span>
  )
}
