import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { StickyActionBar } from '@/components/ui/StickyActionBar'
import { useQueryParam } from '@/hooks/useQueryParam'
import {
  answerChecksQuery,
  runWithLimit,
  sendAnswerCheck,
  type AnswerCheckMode,
} from '@/lib/answerChecksApi'
import { ApiError, getApiErrorMessage } from '@/lib/api'
import { cn } from '@/lib/cn'
import { getTodayKey } from '@/lib/date'
import { YOUTH_HELP_LINE } from '@/lib/helpLines'
import { shrinkPhoto } from '@/lib/photoCards'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'

/** 주소의 ?mode= 값 → 서버에 보내는 값. 주소는 누구나 고칠 수 있어서, 이 두 값이 아니면 "아직 안 고름" 으로 봅니다. */
const MODE_BY_PARAM: Record<string, AnswerCheckMode> = {
  marked: 'MARKED',
  unmarked: 'UNMARKED',
}

/** 고르는 칸 두 개 */
const MODE_OPTIONS = [
  { param: 'marked', title: '채점했어요', detail: 'O · X 표시가 있는 페이지' },
  { param: 'unmarked', title: '아직 안 했어요', detail: '답만 적은 페이지, AI 가 풀어요' },
]

/** 찍기 화면의 안내 한 줄 */
const TAKE_GUIDE: Record<AnswerCheckMode, string> = {
  MARKED: '문제 번호와 O · X 표시가 한 장에 다 나오게 찍어 주세요.',
  UNMARKED: '문제와 내가 적은 답이 같이 보이게 찍어 주세요.',
}

/** 사진을 동시에 몇 장까지 보낼지. 한 장에 25초쯤 걸리는 AI 채점이 너무 겹치지 않게 2장씩만 보냅니다. */
const MAX_SENDING_AT_ONCE = 2

/**
 * 사진 한 장의 상태
 *   ready       보내기 전
 *   sending     보내는 중 (채점하는 중)
 *   graded      채점 끝
 *   notProblem  문제를 못 읽음 (graded:false · NOT_PROBLEM)
 *   unavailable 지금은 채점할 수 없음 (graded:false · UNAVAILABLE)
 *   badPhoto    서버가 사진을 받지 않음 (400: 사진 모양 · 4MB 초과) 또는 사진 파일이 아님
 *   failed      그 밖의 실패 (연결 끊김 등). 까닭은 errorText
 */
type PhotoStatus =
  'ready' | 'sending' | 'graded' | 'notProblem' | 'unavailable' | 'badPhoto' | 'failed'

/** 상태별 한 줄 (failed 는 errorText 를 씁니다) */
const STATUS_TEXT: Record<PhotoStatus, string> = {
  ready: '기다리는 중',
  sending: '채점하는 중',
  graded: '끝났어요',
  notProblem: '문제를 못 읽었어요. 다시 찍어 주세요',
  unavailable: '지금은 채점할 수 없어요. 나중에 다시 해 주세요',
  badPhoto: '이 사진은 보낼 수 없어요. 다른 사진으로 골라 주세요',
  failed: '보내지 못했어요',
}

/** 고른 사진 한 장 (이 화면의 메모리에만 있습니다) */
interface PhotoItem {
  id: string
  /** 채점이 끝나면 null 로 지웁니다. (사진은 채점 뒤 바로 버림) */
  file: File | null
  /** 미리보기 주소 (URL.createObjectURL). 채점이 끝나면 돌려주고 null */
  url: string | null
  status: PhotoStatus
  /** 이 사진의 글에 위기 표현이 있었는지 (서버의 showHelp) */
  showHelp: boolean
  /** status 가 failed 일 때 보여 줄 까닭 */
  errorText: string | null
}

/** 서버에 보내다 실패했을 때 상태와 까닭을 정합니다. */
function toFailure(error: unknown): Pick<PhotoItem, 'status' | 'errorText'> {
  // 400 = 서버가 사진을 받지 않음 (사진 모양이 이상하거나 4MB 가 넘음)
  if (error instanceof ApiError && error.status === 400) {
    return { status: 'badPhoto', errorText: null }
  }
  // 서버에 이 기능이 아직 배포되지 않았으면 404 입니다.
  if (error instanceof ApiError && error.status === 404) {
    return {
      status: 'failed',
      errorText: '사진 채점은 서버 준비가 끝나면 열려요. 조금만 기다려 주세요.',
    }
  }
  return { status: 'failed', errorText: getApiErrorMessage(error) }
}

/** 미리보기를 돌려줍니다. (메모리가 남지 않게) */
function releasePhoto(photo: PhotoItem) {
  if (photo.url !== null) URL.revokeObjectURL(photo.url)
}

/**
 * 폰에서 사진으로 채점하기 화면입니다. (주소: /stats/answer-check · 2026-10-24)
 * PC 통계 탭의 QR 을 폰 카메라로 찍으면 이 주소가 열립니다. 로그인 안 했으면 로그인한 뒤 여기로 돌아옵니다. (RequireAuth)
 *
 *   1. 어떤 사진인지 고릅니다. (채점했어요 / 아직 안 했어요) → 주소에 ?mode= 로 둡니다.
 *   2. [사진 찍기] 또는 [앨범에서 고르기]. 앨범에서는 여러 장을 한 번에 고를 수 있고, 더 찍어서 보탤 수도 있습니다.
 *   3. 미리보기를 보고 [채점 보내기] → 사진마다 따로 보내고(2장씩), 사진마다 결과를 보여 줍니다.
 *      PC 는 끝난 사진부터 결과 카드가 하나씩 늘어납니다.
 *
 * ⚠️ 사진은 저장하지 않습니다. 미리보기도 이 화면의 메모리에만 있고, 채점이 끝난 사진은 바로 지웁니다.
 *    그래서 사진을 고른 뒤의 단계는 주소에 두지 않습니다. 새로고침하면 사진이 없어서 찍기부터 다시 하는 게 맞습니다.
 */
export function AnswerCheckPage() {
  const queryClient = useQueryClient()
  const [todayKey] = useState(getTodayKey)
  const [modeParam, setModeParam] = useQueryParam('mode', '')
  const mode: AnswerCheckMode | null = MODE_BY_PARAM[modeParam] ?? null

  // 1단계에서 누른 칸 (아직 [다음] 을 누르기 전)
  const [picked, setPicked] = useState<string | null>(null)
  const [photos, setPhotos] = useState<PhotoItem[]>([])

  // 화면을 떠날 때 남은 미리보기를 모두 돌려줍니다. 정리 함수는 마지막 목록을 봐야 해서 ref 에 담아 둡니다.
  const photosRef = useRef(photos)
  useEffect(() => {
    photosRef.current = photos
  }, [photos])
  useEffect(() => {
    return () => photosRef.current.forEach(releasePhoto)
  }, [])

  /** 사진 한 장의 값을 바꿉니다. */
  function updatePhoto(id: string, changes: Partial<PhotoItem>) {
    setPhotos((current) =>
      current.map((photo) => (photo.id === id ? { ...photo, ...changes } : photo)),
    )
  }

  /** 사진 한 장을 줄여서 보내고, 결과를 그 사진에 적습니다. 실패해도 에러를 던지지 않습니다. (다음 사진을 계속 보내게) */
  async function sendOne(photo: PhotoItem, sendMode: AnswerCheckMode) {
    if (photo.file === null) return
    updatePhoto(photo.id, { status: 'sending' })

    // 1) 사진 줄이기. 사진 파일이 아니거나 읽지 못하면 보낼 수 없는 사진입니다.
    let image: string
    try {
      image = await shrinkPhoto(photo.file)
    } catch {
      updatePhoto(photo.id, { status: 'badPhoto' })
      return
    }

    // 2) 서버에 보내기
    try {
      const result = await sendAnswerCheck({ mode: sendMode, image, date: todayKey })
      if (result.check !== null) {
        // 채점이 끝난 사진은 바로 버립니다.
        releasePhoto(photo)
        updatePhoto(photo.id, {
          status: 'graded',
          showHelp: result.showHelp,
          file: null,
          url: null,
        })
      } else {
        updatePhoto(photo.id, {
          status: result.reason === 'NOT_PROBLEM' ? 'notProblem' : 'unavailable',
          showHelp: result.showHelp,
        })
      }
    } catch (error) {
      updatePhoto(photo.id, toFailure(error))
    }
  }

  // 고른 사진 전체를 2장씩 보냅니다. 장마다 sendOne 이 에러를 잡아서, 이 일 자체는 실패하지 않습니다.
  const send = useMutation({
    mutationFn: async (input: { photos: PhotoItem[]; mode: AnswerCheckMode }) => {
      await runWithLimit(input.photos, MAX_SENDING_AT_ONCE, (photo) => sendOne(photo, input.mode))
    },
    onSettled: () => {
      // 같은 폰에서 통계 탭을 열어도 새 결과가 보이게 합니다.
      void queryClient.invalidateQueries({ queryKey: answerChecksQuery(todayKey).queryKey })
    },
  })

  function handleNext() {
    if (picked !== null) setModeParam(picked)
  }

  /** 사진을 고르면 목록 뒤에 보탭니다. (앨범은 여러 장, 카메라는 한 장씩) */
  function handlePick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    // 같은 사진을 다시 골라도 다시 읽게 비워 둡니다.
    event.target.value = ''
    if (files.length === 0) return
    const now = Date.now()
    const added: PhotoItem[] = files.map((file, index) => ({
      id: `${now}-${index}-${file.name}`,
      file,
      url: URL.createObjectURL(file),
      status: 'ready',
      showHelp: false,
      errorText: null,
    }))
    setPhotos((current) => [...current, ...added])
  }

  function handleRemove(photo: PhotoItem) {
    releasePhoto(photo)
    setPhotos((current) => current.filter((item) => item.id !== photo.id))
  }

  function handleSend() {
    if (photos.length === 0 || mode === null) return
    send.mutate({ photos, mode })
  }

  /** [다시 찍기]: 고른 사진을 모두 지우고 찍기 단계로 */
  function handleRetake() {
    photos.forEach(releasePhoto)
    setPhotos([])
    send.reset()
  }

  /** [다른 사진 올리기]: 처음(어떤 사진인지 고르기)으로 */
  function handleAnother() {
    photos.forEach(releasePhoto)
    setPhotos([])
    setPicked(null)
    send.reset()
    setModeParam('')
  }

  // 보내기를 누른 뒤에는 사진마다 결과를 보여 주는 단계입니다.
  const hasStarted = !send.isIdle

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <div>
        <Link
          to="/stats"
          className="text-brand mb-1 inline-flex h-11 items-center gap-1 text-sm font-medium hover:underline"
        >
          <span aria-hidden>‹</span> 통계
        </Link>
        <h1 className="text-[28px] leading-tight font-bold tracking-tight">사진 채점</h1>
      </div>

      {/* 1. 어떤 사진인지 고르기 */}
      {mode === null && (
        <>
          <h2 className="text-[20px] font-bold tracking-tight break-keep text-slate-900">
            어떤 사진을 올릴까요?
          </h2>
          <div role="radiogroup" aria-label="올릴 사진 종류" className="flex flex-col gap-3">
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.param}
                type="button"
                role="radio"
                aria-checked={picked === option.param}
                onClick={() => setPicked(option.param)}
                className={cn(
                  'flex min-h-16 w-full cursor-pointer flex-col items-start gap-1 rounded-2xl bg-white px-5 py-4 text-left ring-1 ring-slate-200 transition',
                  picked === option.param && 'bg-brand-light ring-brand ring-2',
                )}
              >
                <span className="text-[17px] font-semibold break-keep text-slate-900">
                  {option.title}
                </span>
                <span className="text-sm break-keep text-slate-500">{option.detail}</span>
              </button>
            ))}
          </div>
          <StickyActionBar aboveTabBar>
            <Button size="lg" className="w-full" disabled={picked === null} onClick={handleNext}>
              다음
            </Button>
          </StickyActionBar>
        </>
      )}

      {/* 2. 찍기 */}
      {mode !== null && photos.length === 0 && !hasStarted && (
        <>
          <p className="rounded-2xl bg-white px-5 py-4 text-[17px] font-semibold break-keep text-slate-900">
            {TAKE_GUIDE[mode]}
          </p>
          <p className="rounded-2xl bg-slate-200/60 px-4 py-3 text-sm break-keep text-slate-600">
            🔒 사진은 채점 뒤 바로 버려요. 이름 · 학번이 보이면 가리고 찍어 주세요. 앨범에서는 여러
            장을 한 번에 고를 수 있어요.
          </p>
          <PickButtons onPick={handlePick} />
        </>
      )}

      {/* 3. 확인 · 보내기 */}
      {mode !== null && photos.length > 0 && !hasStarted && (
        <>
          <p className="text-[15px] font-semibold text-slate-900">
            고른 사진 <span className="tabular-nums">{photos.length}</span>장
          </p>
          {/* 375px 에서 세 칸. 사진마다 오른쪽 위 ✕ 로 뺄 수 있습니다. */}
          <ul className="grid grid-cols-3 gap-2">
            {photos.map((photo, index) => (
              <li key={photo.id} className="relative">
                {photo.url !== null && (
                  <img
                    src={photo.url}
                    alt={`고른 사진 ${index + 1}`}
                    className="aspect-[3/4] w-full max-w-full rounded-xl bg-white object-cover"
                  />
                )}
                <button
                  type="button"
                  onClick={() => handleRemove(photo)}
                  aria-label={`사진 ${index + 1} 빼기`}
                  className="absolute top-1 right-1 flex size-10 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white"
                >
                  <span aria-hidden>✕</span>
                </button>
              </li>
            ))}
          </ul>
          <PickButtons onPick={handlePick} isMore />
          <StickyActionBar aboveTabBar>
            <Button size="lg" className="w-full" onClick={handleSend}>
              채점 보내기 ({photos.length}장)
            </Button>
            <Button variant="outline" size="lg" className="w-full" onClick={handleRetake}>
              다시 찍기
            </Button>
          </StickyActionBar>
        </>
      )}

      {/* 4. 보낸 뒤: 사진마다 결과 */}
      {mode !== null && hasStarted && (
        <SendResults
          photos={photos}
          isDone={!send.isPending}
          onRetake={handleRetake}
          onAnother={handleAnother}
        />
      )}
    </div>
  )
}

interface PickButtonsProps {
  onPick: (event: ChangeEvent<HTMLInputElement>) => void
  /** 이미 고른 사진이 있어서 "더" 보태는 버튼이면 true (작고 흰 버튼) */
  isMore?: boolean
}

/** [사진 찍기] · [앨범에서 고르기]. label 로 감싸서 버튼처럼 누르면 파일 고르기가 열립니다. */
function PickButtons({ onPick, isMore = false }: PickButtonsProps) {
  const baseClass =
    'flex cursor-pointer items-center justify-center rounded-2xl px-3 font-semibold whitespace-nowrap active:scale-[0.98]'
  return (
    <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
      {/* capture 는 [사진 찍기] 에만 (바로 카메라, 한 장씩) */}
      <label
        className={cn(
          baseClass,
          isMore
            ? 'h-12 border border-slate-200 bg-white text-[15px] text-slate-900'
            : 'bg-brand h-14 text-[17px] text-white',
        )}
      >
        📷 {isMore ? '더 찍기' : '사진 찍기'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={onPick}
        />
      </label>
      {/* multiple: 앨범에서 여러 장을 한 번에 고릅니다. (개수 제한 없음) */}
      <label
        className={cn(
          baseClass,
          'border border-slate-200 bg-white text-slate-900',
          isMore ? 'h-12 text-[15px]' : 'h-14 text-[17px]',
        )}
      >
        🖼 {isMore ? '앨범에서 더 고르기' : '앨범에서 고르기'}
        <input type="file" accept="image/*" multiple className="sr-only" onChange={onPick} />
      </label>
    </div>
  )
}

interface SendResultsProps {
  photos: PhotoItem[]
  /** 모든 사진을 다 보냈는지 */
  isDone: boolean
  onRetake: () => void
  onAnother: () => void
}

/**
 * 보낸 뒤 사진마다의 결과.
 * 한 장이라도 위기 표현이 있었으면 상담 전화 안내를 맨 위에 먼저 보여 줍니다. (사진으로 카드 만들기와 같은 한 줄)
 */
function SendResults({ photos, isDone, onRetake, onAnother }: SendResultsProps) {
  const finishedCount = photos.filter(
    (photo) => photo.status !== 'ready' && photo.status !== 'sending',
  ).length
  const gradedCount = photos.filter((photo) => photo.status === 'graded').length
  const needsHelp = photos.some((photo) => photo.showHelp)

  return (
    <>
      {needsHelp && (
        <a
          href={`tel:${YOUTH_HELP_LINE.number}`}
          className="flex min-h-11 items-center justify-between gap-3 rounded-2xl bg-amber-50 px-4 py-2 text-sm"
        >
          <span className="break-keep text-slate-700">
            지금 이야기할 곳: {YOUTH_HELP_LINE.name} · {YOUTH_HELP_LINE.detail}
          </span>
          <span className="text-brand font-semibold">{YOUTH_HELP_LINE.number}</span>
        </a>
      )}

      {/* 전체 진행. 다 끝났고 한 장이라도 채점했으면 PC 를 보라고 알려 줍니다. */}
      <p
        role="status"
        className="rounded-2xl bg-white px-5 py-5 text-center text-[20px] font-bold break-keep text-slate-900"
      >
        {!isDone ? (
          <>
            채점하는 중{' '}
            <span className="tabular-nums">
              ({finishedCount}/{photos.length}장)
            </span>
            <span className="mt-1 block text-sm font-normal text-slate-500">한 장에 최대 25초</span>
          </>
        ) : gradedCount > 0 ? (
          '끝났어요. PC 화면을 보세요'
        ) : (
          '채점한 사진이 없어요'
        )}
      </p>

      <ul className="flex flex-col gap-2">
        {photos.map((photo, index) => (
          <li key={photo.id} className="flex items-center gap-3 rounded-2xl bg-white p-3">
            {photo.url !== null ? (
              <img
                src={photo.url}
                alt={`사진 ${index + 1}`}
                className="size-12 max-w-full shrink-0 rounded-lg object-cover"
              />
            ) : (
              <span
                aria-hidden
                className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-lg"
              >
                ✓
              </span>
            )}
            <div className="flex min-w-0 flex-col">
              <span className="text-sm font-semibold text-slate-900 tabular-nums">
                사진 {index + 1}
              </span>
              <span
                className={cn(
                  'text-sm break-keep',
                  photo.status === 'graded' && 'text-emerald-700',
                  (photo.status === 'ready' || photo.status === 'sending') && 'text-slate-500',
                  (photo.status === 'notProblem' ||
                    photo.status === 'unavailable' ||
                    photo.status === 'badPhoto' ||
                    photo.status === 'failed') &&
                    'text-amber-700',
                )}
              >
                {photo.status === 'failed' && photo.errorText !== null
                  ? photo.errorText
                  : STATUS_TEXT[photo.status]}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {isDone && (
        <StickyActionBar aboveTabBar>
          {gradedCount === 0 ? (
            <Button size="lg" className="w-full" onClick={onRetake}>
              다시 찍기
            </Button>
          ) : (
            <Button variant="outline" size="lg" className="w-full" onClick={onAnother}>
              다른 사진 올리기
            </Button>
          )}
        </StickyActionBar>
      )}
    </>
  )
}
