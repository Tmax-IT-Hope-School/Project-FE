import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { ChipButton } from '@/components/ui/ChipButton'
import { Skeleton } from '@/components/ui/Skeleton'
import { useCards } from '@/hooks/useCards'
import { useIsServerData } from '@/hooks/useIsServerData'
import { useQueryParam } from '@/hooks/useQueryParam'
import { useSubjects } from '@/hooks/useSubjects'
import { answerChecksBetweenQuery } from '@/lib/answerChecksApi'
import { cn } from '@/lib/cn'
import { getTodayKey, moveDateKey } from '@/lib/date'
import { loadQuizResults } from '@/lib/studyQuiz'
import { buildWrongItems, groupWrongItems, type WrongItem } from '@/lib/wrongNote'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'

/** 오답노트에 보여 주는 기간 (오늘 포함 28일). 사진 채점 서버는 한 번에 31일까지 줍니다. */
const NOTE_DAYS = 28

/** '2026-10-19' -> '10월 19일' */
function dateLabel(dateKey: string): string {
  const [, month, day] = dateKey.split('-').map(Number)
  return `${month}월 ${day}일`
}

/**
 * 오답노트 화면(/records/wrong-note)입니다. 기록 탭 아래쪽 입구와 주간 리포트의 오답 테스트 묶음에서 들어옵니다. (2026-10-26)
 *
 * - 최근 4주 동안 사진 채점 · 채팅 확인 문제에서 틀린 문제를 최근 것부터 보여 줍니다. (모으는 규칙은 lib/wrongNote.ts)
 * - 과목 버튼으로 과목만 골라 봅니다. 고른 과목은 주소(?subject=수학)에 둡니다.
 * - 정답과 해설은 [정답 보기] 를 눌러야 보입니다. 먼저 스스로 떠올려 보게 하려는 것입니다.
 */
export function WrongNotePage() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <div>
        <h1 className="text-[28px] leading-tight font-bold tracking-tight">오답노트</h1>
        <p className="mt-1 text-sm break-keep text-slate-500">
          최근 4주 동안 틀린 문제를 모았어요. 한 번 더 보면 다음엔 맞힐 수 있어요.
        </p>
      </div>

      {/* 사진 채점 결과는 서버에서 받아옵니다. 받는 동안은 자리 표시, 못 받으면 다시 시도 안내가 나옵니다. */}
      <AsyncBoundary
        pendingFallback={<WrongNoteSkeleton />}
        errorMessage="틀린 문제를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요."
      >
        <WrongNoteBody />
      </AsyncBoundary>
    </div>
  )
}

function WrongNoteSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-3">
      <span className="sr-only">틀린 문제를 모으는 중이에요</span>
      <Skeleton className="h-10 w-48 rounded-full" />
      <Skeleton className="h-40 w-full rounded-2xl" />
      <Skeleton className="h-40 w-full rounded-2xl" />
    </div>
  )
}

/** 과목 버튼 · 틀린 문제 목록. 사진 채점 결과를 받아오는(useSuspenseQuery) 부분이라 AsyncBoundary 안에 둡니다. */
function WrongNoteBody() {
  const [todayKey] = useState(getTodayKey)
  // 이 기기의 채팅 확인 문제 결과는 화면을 열 때 한 번 읽습니다.
  const [quizResults] = useState(loadQuizResults)
  const isServerData = useIsServerData()
  const subjects = useSubjects()
  const { cards } = useCards()
  const [subjectParam, setSubjectParam] = useQueryParam('subject', '', { replace: true })

  const from = moveDateKey(todayKey, -(NOTE_DAYS - 1))
  // 테스트 로그인이면 서버 대신 이 기기의 시연용 예시를 돌려줍니다. (lib/answerChecksApi.ts)
  const { data: checks } = useSuspenseQuery(answerChecksBetweenQuery(from, todayKey))

  const items = buildWrongItems({
    checks,
    quizResults,
    cards,
    subjects,
    from,
    to: todayKey,
    todayKey,
    includeDemo: !isServerData,
  })
  const groups = groupWrongItems(items)
  // 주소의 과목은 누구나 고칠 수 있어서, 목록에 있는 과목일 때만 씁니다. 아니면 전체.
  const selectedGroup = groups.find((group) => group.subject === subjectParam) ?? null
  const shownItems = selectedGroup
    ? items.filter((item) => item.subject === selectedGroup.subject)
    : items

  if (items.length === 0) {
    return (
      <section className="rounded-2xl bg-white p-5">
        <p className="font-semibold text-slate-900">최근 4주 동안 틀린 문제가 없어요</p>
        <p className="mt-1 text-sm break-keep text-slate-500">
          채팅에서 확인 문제를 풀거나 통계 탭에서 문제집 사진을 채점하면, 틀린 문제가 여기에 모여요.
        </p>
      </section>
    )
  }

  return (
    <>
      <div role="group" aria-label="과목 고르기" className="flex flex-wrap gap-2">
        <ChipButton selected={selectedGroup === null} onClick={() => setSubjectParam('')}>
          {`전체 ${items.length}`}
        </ChipButton>
        {groups.map((group) => (
          <ChipButton
            key={group.subject}
            selected={selectedGroup?.subject === group.subject}
            onClick={() => setSubjectParam(group.subject)}
          >
            {`${group.subject} ${group.count}`}
          </ChipButton>
        ))}
      </div>

      {/* 과목을 고르면 어느 단원에서 많이 틀렸는지 한 줄로 보여 줍니다. */}
      {selectedGroup && selectedGroup.units.length > 0 && (
        <p className="text-sm break-keep text-slate-600">
          단원별: {selectedGroup.units.map((unit) => `${unit.name} ${unit.count}개`).join(' · ')}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {shownItems.map((item) => (
          <li key={item.key}>
            <WrongItemCard item={item} />
          </li>
        ))}
      </ul>
    </>
  )
}

/** ① ② ③ ④ (보기 번호) */
const CHOICE_MARKS = ['①', '②', '③', '④']

/** 틀린 문제 한 장. 정답 · 해설은 [정답 보기] 를 눌러야 열립니다. */
function WrongItemCard({ item }: { item: WrongItem }) {
  const [isAnswerOpen, setIsAnswerOpen] = useState(false)

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
        <span
          className={cn(
            'rounded-full px-2 py-1',
            item.source === 'photo' ? 'bg-sky-50 text-sky-700' : 'bg-brand-light text-brand-dark',
          )}
        >
          {item.source === 'photo' ? '사진 채점' : '확인 문제'}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">{item.subject}</span>
        {item.unit && (
          <span className="max-w-full truncate rounded-full bg-slate-100 px-2 py-1 text-slate-600">
            {item.unit}
          </span>
        )}
        <span className="ml-auto font-medium text-slate-400">{dateLabel(item.date)}</span>
      </div>

      {item.questionText ? (
        <p className="mt-3 text-[15px] leading-6 font-semibold break-words whitespace-pre-line text-slate-900">
          {item.number && <span className="mr-1 text-slate-500">{item.number}번.</span>}
          {item.questionText}
        </p>
      ) : (
        <p className="mt-3 text-[15px] leading-6 text-slate-500">
          {item.number}번 · 문제 글이 없어요(예전 기록)
        </p>
      )}

      {item.choices && (
        <ol className="mt-2 flex flex-col gap-1 text-sm text-slate-700">
          {item.choices.map((choice, index) => (
            <li key={index} className="break-words">
              {CHOICE_MARKS[index]} {choice}
            </li>
          ))}
        </ol>
      )}

      <p className="mt-3 text-sm break-words text-slate-600">
        내 답:{' '}
        <span className="font-medium text-slate-800">{item.myAnswer ?? '읽지 못했어요'}</span>
      </p>

      <button
        type="button"
        aria-expanded={isAnswerOpen}
        onClick={() => setIsAnswerOpen(!isAnswerOpen)}
        className="mt-3 h-10 cursor-pointer rounded-xl bg-slate-100 px-4 text-sm font-semibold text-slate-800 hover:bg-slate-200"
      >
        {isAnswerOpen ? '정답 숨기기' : '정답 보기'}
      </button>

      {isAnswerOpen && (
        <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm break-words text-slate-800">
          <p>
            정답:{' '}
            <span className="font-semibold text-emerald-800">
              {item.correctAnswer ?? '정답이 적혀 있지 않아요'}
            </span>
          </p>
          {item.explanation && <p className="mt-1 leading-6 text-slate-700">{item.explanation}</p>}
        </div>
      )}
    </article>
  )
}
