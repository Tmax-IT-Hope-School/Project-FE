import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { useCards } from '@/hooks/useCards'
import { useIsServerData } from '@/hooks/useIsServerData'
import { useQueryParam } from '@/hooks/useQueryParam'
import { useSubjects } from '@/hooks/useSubjects'
import { answerChecksBetweenQuery } from '@/lib/answerChecksApi'
import { cn } from '@/lib/cn'
import { getTodayKey, isDateKey, moveDateKey } from '@/lib/date'
import { getWeekStart } from '@/lib/historyReport'
import { loadQuizResults } from '@/lib/studyQuiz'
import { WRONG_NOTE_PATH } from '@/lib/tabMenu'
import { buildWrongItems, testableWrongItems, type WrongItem } from '@/lib/wrongNote'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

/** ① ② ③ ④ (보기 번호) */
const CHOICE_MARKS = ['①', '②', '③', '④']

/** '2026-10-19' -> '10월 19일' */
function dateLabel(dateKey: string): string {
  const [, month, day] = dateKey.split('-').map(Number)
  return `${month}월 ${day}일`
}

/** 주의 이름 '10월 19일 ~ 10월 25일' */
function weekRangeLabel(weekStart: string): string {
  return `${dateLabel(weekStart)} ~ ${dateLabel(moveDateKey(weekStart, 6))}`
}

/**
 * 주간 오답 테스트 화면(/records/wrong-test?week=2026-10-19)입니다. 기록 탭 주간 리포트의 [테스트 풀기] 로 들어옵니다. (2026-10-26)
 *
 * - 그 주(월 ~ 일)에 틀린 문제 중 문제 글이 있는 것으로 시험지를 만듭니다. (고르는 규칙: lib/wrongNote.ts 의 testableWrongItems)
 * - 확인 문제(4지선다)는 [채점하기] 를 누르면 저절로 채점하고, 사진 채점 문제는 정답을 보여 줘서 스스로 맞음 · 틀림을 고릅니다.
 * - 푼 결과는 어디에도 저장하지 않습니다. (서버에 보내지 않음)
 * - [시험지 PDF로 저장] 은 브라우저의 인쇄 창(window.print)을 엽니다. 거기서 "PDF로 저장" 을 고르면 됩니다.
 *   인쇄할 때는 화면용 부분(print:hidden)을 숨기고, 아래 PrintSheet(hidden print:block)만 종이에 나옵니다.
 *   헤더 · 하단 탭 · 돌아가기 링크는 components/layout 쪽에서 print:hidden 으로 숨깁니다.
 */
export function WrongTestPage() {
  const [todayKey] = useState(getTodayKey)
  const thisWeekStart = getWeekStart(todayKey)
  const [weekParam] = useQueryParam('week', thisWeekStart)
  // 주소의 값은 누구나 고칠 수 있어서, 날짜가 아니거나 앞으로의 날이면 이번 주로 봅니다.
  const weekStart =
    isDateKey(weekParam) && weekParam <= todayKey ? getWeekStart(weekParam) : thisWeekStart

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 print:max-w-none">
      <div className="print:hidden">
        <h1 className="text-[28px] leading-tight font-bold tracking-tight">주간 오답 테스트</h1>
        <p className="mt-1 text-sm text-slate-500">{weekRangeLabel(weekStart)}</p>
      </div>

      <AsyncBoundary
        pendingFallback={
          <div role="status" className="flex flex-col gap-3">
            <span className="sr-only">시험지를 만드는 중이에요</span>
            <Skeleton className="h-48 w-full rounded-2xl" />
            <Skeleton className="h-48 w-full rounded-2xl" />
          </div>
        }
        errorMessage="틀린 문제를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요."
        resetKeys={[weekStart]}
      >
        {/* key: 주가 바뀌면 고른 답을 비우고 처음부터 그립니다. */}
        <WrongTestBody key={weekStart} weekStart={weekStart} todayKey={todayKey} />
      </AsyncBoundary>
    </div>
  )
}

interface WrongTestBodyProps {
  /** 그 주의 월요일 'YYYY-MM-DD' */
  weekStart: string
  todayKey: string
}

/** 문제 풀기 · 채점 · 인쇄용 시험지. 사진 채점 결과를 받아오는(useSuspenseQuery) 부분이라 AsyncBoundary 안에 둡니다. */
function WrongTestBody({ weekStart, todayKey }: WrongTestBodyProps) {
  const [quizResults] = useState(loadQuizResults)
  const isServerData = useIsServerData()
  const subjects = useSubjects()
  const { cards } = useCards()
  const weekEnd = moveDateKey(weekStart, 6)
  // 기록 탭 주간 리포트와 같은 범위(지난주 ~ 이번 주)로 받아서, 이미 받아 둔 결과를 다시 씁니다. 쓰는 것은 이 주 7일뿐입니다.
  const { data: checks } = useSuspenseQuery(
    answerChecksBetweenQuery(moveDateKey(weekStart, -7), weekEnd),
  )

  const items = testableWrongItems(
    buildWrongItems({
      checks,
      quizResults,
      cards,
      subjects,
      from: weekStart,
      to: weekEnd,
      todayKey,
      includeDemo: !isServerData,
    }),
  )

  // 확인 문제에서 고른 보기 번호 (문제 key → 0 ~ 3)
  const [choices, setChoices] = useState<Record<string, number>>({})
  // 사진 채점 문제에 적은 답 (문제 key → 글)
  const [texts, setTexts] = useState<Record<string, string>>({})
  // 사진 채점 문제를 스스로 채점한 것 (문제 key → 맞음 true / 틀림 false)
  const [selfMarks, setSelfMarks] = useState<Record<string, boolean>>({})
  const [isGraded, setIsGraded] = useState(false)

  if (items.length === 0) {
    return (
      <section className="rounded-2xl bg-white p-5 print:hidden">
        <p className="font-semibold text-slate-900">이 주에는 다시 풀 틀린 문제가 없어요</p>
        <p className="mt-1 text-sm break-keep text-slate-500">
          문제 글이 남은 틀린 문제만 시험지에 넣어요. 지난 틀린 문제는 오답노트에서 볼 수 있어요.
        </p>
        <Link
          to={WRONG_NOTE_PATH}
          className="mt-3 inline-flex h-10 items-center rounded-xl bg-slate-100 px-4 text-sm font-semibold text-slate-800 hover:bg-slate-200"
        >
          오답노트 보기
        </Link>
      </section>
    )
  }

  // 맞힌 문제 수: 확인 문제는 저절로, 사진 채점 문제는 스스로 고른 "맞음" 만 셉니다.
  const quizRight = items.filter(
    (item) => item.source === 'quiz' && choices[item.key] === item.answerIndex,
  ).length
  const photoRight = items.filter((item) => selfMarks[item.key] === true).length
  const photoUnmarked = items.filter(
    (item) => item.source === 'photo' && selfMarks[item.key] === undefined,
  ).length
  const right = quizRight + photoRight

  function handleReset() {
    setChoices({})
    setTexts({})
    setSelfMarks({})
    setIsGraded(false)
  }

  return (
    <>
      {/* 화면에서 푸는 부분. 인쇄할 때는 숨깁니다. */}
      <div className="flex flex-col gap-4 print:hidden">
        <p className="text-sm break-keep text-slate-600">
          이 주에 틀린 문제 {items.length}개로 시험지를 만들었어요. 천천히 다시 풀어 봐요.
        </p>

        <ol className="flex flex-col gap-3">
          {items.map((item, index) => (
            <li key={item.key} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <QuestionHead item={item} order={index + 1} />
              {item.source === 'quiz' ? (
                <ChoiceQuestion
                  item={item}
                  chosen={choices[item.key]}
                  isGraded={isGraded}
                  onChoose={(choice) => setChoices({ ...choices, [item.key]: choice })}
                />
              ) : (
                <PhotoQuestion
                  item={item}
                  text={texts[item.key] ?? ''}
                  isGraded={isGraded}
                  selfMark={selfMarks[item.key]}
                  onChangeText={(text) => setTexts({ ...texts, [item.key]: text })}
                  onSelfMark={(isRight) => setSelfMarks({ ...selfMarks, [item.key]: isRight })}
                />
              )}
            </li>
          ))}
        </ol>

        {isGraded && (
          <section aria-live="polite" className="bg-brand-light rounded-2xl p-5">
            <p className="text-lg font-bold text-slate-900">
              {items.length}문제 중 {right}문제 맞혔어요
            </p>
            <p className="mt-1 text-sm break-keep text-slate-700">
              {photoUnmarked > 0
                ? `사진 문제 ${photoUnmarked}개는 정답과 비교해서 맞음 · 틀림을 골라 주세요.`
                : right === items.length
                  ? '이 주에 틀렸던 문제를 모두 맞혔어요. 잘했어요!'
                  : '다시 틀린 문제는 해설을 읽고 한 번 더 보면 돼요.'}
            </p>
          </section>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          {isGraded ? (
            <Button variant="outline" className="sm:flex-1" onClick={handleReset}>
              처음부터 다시 풀기
            </Button>
          ) : (
            <Button className="sm:flex-1" onClick={() => setIsGraded(true)}>
              채점하기
            </Button>
          )}
          <Button variant="outline" className="sm:flex-1" onClick={() => window.print()}>
            시험지 PDF로 저장
          </Button>
        </div>
        <p className="text-xs break-keep text-slate-500">
          인쇄 창이 열리면 대상(프린터)을 「PDF로 저장」으로 고르세요. 이름은 시험지에 적히지
          않아요.
        </p>

        <Link
          to={WRONG_NOTE_PATH}
          className="inline-flex h-10 items-center self-start text-sm font-semibold text-slate-700 hover:underline"
        >
          오답노트 보기 ›
        </Link>
      </div>

      <PrintSheet items={items} weekStart={weekStart} />
    </>
  )
}

/** 문제 번호 · 출처 · 단원 · 문제 글 */
function QuestionHead({ item, order }: { item: WrongItem; order: number }) {
  return (
    <>
      <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-500">
        <span>{item.source === 'photo' ? '사진 채점' : '확인 문제'}</span>
        <span aria-hidden>·</span>
        <span>{item.subject}</span>
        {item.unit && (
          <>
            <span aria-hidden>·</span>
            <span className="max-w-full truncate">{item.unit}</span>
          </>
        )}
      </p>
      <p className="mt-2 text-[15px] leading-6 font-semibold break-words whitespace-pre-line text-slate-900">
        {order}. {item.questionText}
      </p>
    </>
  )
}

interface ChoiceQuestionProps {
  item: WrongItem
  /** 고른 보기 번호. 안 골랐으면 undefined */
  chosen: number | undefined
  isGraded: boolean
  onChoose: (choice: number) => void
}

/** 확인 문제: 보기 4개 중 하나를 고르는 버튼(라디오처럼). 채점하면 정답 · 내가 고른 것을 색으로 보여 줍니다. */
function ChoiceQuestion({ item, chosen, isGraded, onChoose }: ChoiceQuestionProps) {
  return (
    <>
      <div role="radiogroup" aria-label="보기 고르기" className="mt-3 flex flex-col gap-2">
        {(item.choices ?? []).map((choice, index) => {
          const isChosen = chosen === index
          const isAnswer = item.answerIndex === index
          return (
            <button
              key={index}
              type="button"
              role="radio"
              aria-checked={isChosen}
              disabled={isGraded}
              onClick={() => onChoose(index)}
              className={cn(
                'flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-left text-[15px] break-words transition disabled:cursor-default',
                isChosen
                  ? 'border-brand bg-brand-light font-semibold text-slate-900'
                  : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300',
                // 채점한 뒤: 정답은 초록, 고른 오답은 빨강
                isGraded && isAnswer && 'border-emerald-500 bg-emerald-50 text-emerald-900',
                isGraded && isChosen && !isAnswer && 'border-red-400 bg-red-50 text-red-900',
              )}
            >
              <span aria-hidden className="shrink-0">
                {CHOICE_MARKS[index]}
              </span>
              <span className="min-w-0">{choice}</span>
            </button>
          )
        })}
      </div>
      {isGraded && (
        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm break-words text-slate-700">
          <p className="font-semibold text-slate-900">
            {chosen === item.answerIndex
              ? '맞았어요'
              : chosen === undefined
                ? `안 골랐어요 · 정답은 ${CHOICE_MARKS[item.answerIndex ?? 0]}`
                : `정답은 ${CHOICE_MARKS[item.answerIndex ?? 0]}`}
          </p>
          {item.explanation && <p className="mt-1 leading-6">{item.explanation}</p>}
        </div>
      )}
    </>
  )
}

interface PhotoQuestionProps {
  item: WrongItem
  text: string
  isGraded: boolean
  /** 스스로 채점한 결과. 아직 안 골랐으면 undefined */
  selfMark: boolean | undefined
  onChangeText: (text: string) => void
  onSelfMark: (isRight: boolean) => void
}

/** 사진 채점 문제: 짧은 답 칸. 채점하면 정답을 보여 주고, 맞음 · 틀림을 스스로 고릅니다. */
function PhotoQuestion({
  item,
  text,
  isGraded,
  selfMark,
  onChangeText,
  onSelfMark,
}: PhotoQuestionProps) {
  return (
    <>
      <Input
        aria-label={`${item.questionText ?? '문제'} 답`}
        placeholder="답을 적어 보세요"
        maxLength={100}
        value={text}
        disabled={isGraded}
        onChange={(event) => onChangeText(event.target.value)}
        className="mt-3"
      />
      {isGraded && (
        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm break-words text-slate-700">
          <p>
            정답:{' '}
            <span className="font-semibold text-slate-900">
              {item.correctAnswer ?? '정답이 적혀 있지 않아요. 교재 답지로 확인해 주세요.'}
            </span>
          </p>
          <div role="group" aria-label="스스로 채점" className="mt-2 flex gap-2">
            <SelfMarkButton isSelected={selfMark === true} onClick={() => onSelfMark(true)}>
              맞음
            </SelfMarkButton>
            <SelfMarkButton isSelected={selfMark === false} onClick={() => onSelfMark(false)}>
              틀림
            </SelfMarkButton>
          </div>
        </div>
      )}
    </>
  )
}

interface SelfMarkButtonProps {
  isSelected: boolean
  onClick: () => void
  children: string
}

function SelfMarkButton({ isSelected, onClick, children }: SelfMarkButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      onClick={onClick}
      className={cn(
        'h-10 flex-1 cursor-pointer rounded-xl border px-4 text-sm font-semibold sm:flex-none',
        isSelected
          ? 'border-brand bg-brand-light text-brand-dark'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100',
      )}
    >
      {children}
    </button>
  )
}

interface PrintSheetProps {
  items: WrongItem[]
  weekStart: string
}

/**
 * 인쇄(PDF로 저장)할 때만 나오는 시험지입니다. 화면에서는 숨깁니다. (hidden print:block)
 *   1쪽~: 제목 · 기간 · 이름 / 날짜 빈칸 · 문제(보기 ①②③④) · 답 빈칸
 *   새 쪽: 정답과 해설 (print:break-before-page 로 쪽을 넘깁니다)
 * 이름 칸은 비워 둡니다. 내 이름을 종이에 찍지 않으려는 것입니다.
 */
function PrintSheet({ items, weekStart }: PrintSheetProps) {
  return (
    <div className="hidden text-black print:block">
      <h1 className="text-center text-2xl font-bold">주간 오답 테스트</h1>
      <p className="mt-1 text-center text-sm">{weekRangeLabel(weekStart)}</p>
      <div className="mt-6 flex justify-end gap-8 text-sm">
        <p>
          이름 <span className="inline-block w-32 border-b border-black" />
        </p>
        <p>
          날짜 <span className="inline-block w-32 border-b border-black" />
        </p>
      </div>

      <ol className="mt-8 flex flex-col gap-6">
        {items.map((item, index) => (
          // break-inside-avoid: 문제 하나가 두 쪽으로 잘리지 않게 합니다.
          <li key={item.key} className="break-inside-avoid">
            <p className="text-[15px] leading-6 font-semibold break-words whitespace-pre-line">
              {index + 1}. {item.questionText}
            </p>
            <p className="mt-0.5 text-xs text-slate-600">
              {item.subject}
              {item.unit ? ` · ${item.unit}` : ''}
            </p>
            {item.choices && (
              <ol className="mt-2 flex flex-col gap-1 pl-4 text-sm">
                {item.choices.map((choice, choiceIndex) => (
                  <li key={choiceIndex} className="break-words">
                    {CHOICE_MARKS[choiceIndex]} {choice}
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-3 pl-4 text-sm">
              답 <span className="inline-block w-48 border-b border-black" />
            </p>
          </li>
        ))}
      </ol>

      <section className="print:break-before-page">
        <h2 className="text-xl font-bold">정답과 해설</h2>
        <ol className="mt-4 flex flex-col gap-3 text-sm">
          {items.map((item, index) => (
            <li key={item.key} className="break-inside-avoid break-words">
              <p className="font-semibold">
                {index + 1}.{' '}
                {item.source === 'quiz'
                  ? `${CHOICE_MARKS[item.answerIndex ?? 0]} ${item.correctAnswer ?? ''}`
                  : (item.correctAnswer ?? '정답이 적혀 있지 않아요 (교재 답지로 확인)')}
              </p>
              {item.explanation && <p className="mt-0.5 leading-6">{item.explanation}</p>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
