import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { SubjectBadge } from '@/components/ui/SubjectBadge'
import { useExams } from '@/hooks/useExams'
import { useStudySessions } from '@/hooks/useStudySessions'
import { cn } from '@/lib/cn'
import { formatMinutes } from '@/lib/dailyRecords'
import { examThinkingGapQuery } from '@/lib/examThinkingGap'
import {
  REFLECTION_MAX_LENGTH,
  STUDY_LOOKBACK_DAYS,
  formatDiff,
  formatExamDate,
  getAverageDiff,
  getDaysUntil,
  getLargestGapScores,
  getResultHeadline,
  getScoreDiff,
  getStudyMinutesBeforeExam,
  parseScore,
} from '@/lib/exams'
import { useSubjects } from '@/hooks/useSubjects'
import { THINKING_TEST_PATH } from '@/lib/thinkingTest'
import type { Exam, ExamReflection, ExamSubjectScore, StudySession, Subject } from '@/types'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { shouldShowCrisisHelp } from '@/lib/diarySafety'
import { SUPPORT_PATH } from '@/lib/helpLines'

/** 준비 정도 버튼 1~5 */
const PREPAREDNESS_VALUES = [1, 2, 3, 4, 5]

/** 점수 차이의 글자 색. 낮아졌으면 빨강, 높아졌으면 초록, 같으면 회색입니다. */
function getDiffColor(diff: number): string {
  if (diff < 0) return 'text-red-600'
  if (diff > 0) return 'text-emerald-600'
  return 'text-slate-500'
}

interface ExamResultFormProps {
  exam: Exam
  subjects: Subject[]
  sessions: StudySession[]
  onSave: (updated: Exam) => void
}

/** 결과(실제 점수 + 회고) 입력 폼. 시험이 정해진 뒤에 그려서, 저장된 값으로 시작할 수 있습니다. */
function ExamResultForm({ exam, subjects, sessions, onSave }: ExamResultFormProps) {
  // 화면에는 지금 과목 목록에 있는 과목만 보여줍니다. (지워진 과목의 점수는 저장할 때 그대로 둡니다)
  const rows = exam.subjectScores.flatMap((score) => {
    const subject = subjects.find((item) => item.id === score.subjectId)
    return subject ? [{ subject, score }] : []
  })

  // 입력 도중에는 빈 칸·틀린 값이 있을 수 있어서 점수를 글자로 들고 있습니다.
  const [actualTexts, setActualTexts] = useState<Record<string, string>>(() => {
    const texts: Record<string, string> = {}
    for (const score of exam.subjectScores) {
      if (score.actualScore !== undefined) texts[score.subjectId] = String(score.actualScore)
    }
    return texts
  })
  const [preparedness, setPreparedness] = useState<number | null>(
    exam.reflection?.preparedness ?? null,
  )
  const [regret, setRegret] = useState(exam.reflection?.regret ?? '')
  const [nextChange, setNextChange] = useState(exam.reflection?.nextChange ?? '')
  const [errorMessage, setErrorMessage] = useState('')
  const [savedMessage, setSavedMessage] = useState('')
  const navigate = useNavigate()

  // 지금 입력칸에 적힌 올바른 점수만 모아서 요약(평균 차이, 차이 큰 과목)을 바로바로 보여줍니다.
  const typedScores: ExamSubjectScore[] = rows.flatMap(({ score }) => {
    const actualScore = parseScore(actualTexts[score.subjectId] ?? '')
    return actualScore === null ? [] : [{ ...score, actualScore }]
  })
  const averageDiff = getAverageDiff(typedScores)
  const largestGaps = getLargestGapScores(typedScores, 2)

  /** 차이가 큰 과목의 이름과 시험 전 2주 순공 시간을 한 문장으로 만듭니다. */
  function buildGapSentence(): string | null {
    if (largestGaps.length === 0) return null
    const items = largestGaps.flatMap((score) => {
      const subject = subjects.find((item) => item.id === score.subjectId)
      if (!subject) return []
      const minutes = getStudyMinutesBeforeExam(sessions, exam.date, score.subjectId)
      return [{ name: subject.name, minutes }]
    })
    const names = items.map((item) => item.name).join('·')
    const hours = items
      .map(
        (item) => `${item.name} ${item.minutes === 0 ? '기록 없음' : formatMinutes(item.minutes)}`,
      )
      .join(', ')
    return `${names} 차이가 커. 시험 전 ${STUDY_LOOKBACK_DAYS / 7}주 순공은 ${hours}이었어.`
  }
  const gapSentence = buildGapSentence()

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSavedMessage('')

    // 1) 실제 점수: 적은 칸은 0~100 정수여야 하고, 하나 이상은 적어야 합니다.
    const parsedActuals: Record<string, number> = {}
    for (const { subject } of rows) {
      const text = actualTexts[subject.id] ?? ''
      if (text.trim() === '') continue
      const actualScore = parseScore(text)
      if (actualScore === null) {
        return setErrorMessage(`${subject.name} 실제 점수는 0~100 사이의 정수로 적어 주세요.`)
      }
      parsedActuals[subject.id] = actualScore
    }
    if (Object.keys(parsedActuals).length === 0) {
      return setErrorMessage('실제 점수를 하나 이상 적어 주세요.')
    }

    // 2) 회고: 글을 적었는데 준비 정도를 안 골랐으면 알려 줍니다. 아무것도 안 적었으면 회고는 저장하지 않습니다.
    const trimmedRegret = regret.trim()
    const trimmedNextChange = nextChange.trim()
    if (preparedness === null && (trimmedRegret !== '' || trimmedNextChange !== '')) {
      return setErrorMessage('준비가 충분했는지 1~5 중에서 골라 주세요.')
    }
    const reflection: ExamReflection | undefined =
      preparedness === null
        ? undefined
        : { preparedness, regret: trimmedRegret, nextChange: trimmedNextChange }

    // 3) 저장: 현재 과목에 있는 과목은 새 실제 점수로 바꾸고(비웠으면 지움), 지워진 과목은 그대로 둡니다.
    const subjectScores = exam.subjectScores.map((score) => {
      const isShown = rows.some(({ subject }) => subject.id === score.subjectId)
      if (!isShown) return score
      const actualScore = parsedActuals[score.subjectId]
      return {
        subjectId: score.subjectId,
        expectedScore: score.expectedScore,
        ...(actualScore !== undefined && { actualScore }),
      }
    })
    onSave({ ...exam, subjectScores, reflection })

    setErrorMessage('')
    setSavedMessage('저장했어요. 이 화면에서 다시 보고 고칠 수 있어요.')
    // 시험 직후 회고는 힘든 마음이 나오기 쉬운 때라, 위기 표현이 있으면 일기처럼 도움 안내로 보냅니다.
    if (shouldShowCrisisHelp({ texts: [trimmedRegret, trimmedNextChange], diaryMoods: [] })) {
      navigate(SUPPORT_PATH)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* 모바일은 한 줄에 하나(점수표 → 요약), PC(lg)는 점수표 · 요약을 나란히 둡니다. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <Card title="과목별 점수">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th scope="col" className="pb-2 font-medium">
                  과목
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  예상
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  실제
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  차이
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(({ subject, score }) => {
                const actualScore = parseScore(actualTexts[subject.id] ?? '')
                const diff = actualScore === null ? null : getScoreDiff({ ...score, actualScore })
                return (
                  <tr key={subject.id}>
                    <td className="py-2 pr-2">
                      <SubjectBadge name={subject.name} color={subject.color} />
                    </td>
                    <td className="py-2 text-right text-slate-700">{score.expectedScore}</td>
                    <td className="py-2 pl-2">
                      <div className="ml-auto w-16 sm:w-20">
                        <Input
                          name={`actual-${subject.id}`}
                          inputMode="numeric"
                          aria-label={`${subject.name} 실제 점수`}
                          value={actualTexts[subject.id] ?? ''}
                          onChange={(event) =>
                            setActualTexts((prev) => ({
                              ...prev,
                              [subject.id]: event.target.value,
                            }))
                          }
                          className="px-2 text-right font-semibold"
                        />
                      </div>
                    </td>
                    <td
                      className={cn(
                        'py-2 pl-2 text-right font-semibold',
                        diff === null ? 'text-slate-400' : getDiffColor(diff),
                      )}
                    >
                      {diff === null ? '-' : formatDiff(diff)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>

        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5">
          {averageDiff === null ? (
            <p className="text-sm text-slate-600">
              실제 점수를 적으면 예상과 얼마나 달랐는지 바로 알려줄게.
            </p>
          ) : (
            <>
              <h3 className="text-lg font-semibold break-words text-slate-900">
                {getResultHeadline(averageDiff)}
              </h3>
              {gapSentence && (
                <p className="mt-3 text-sm break-words text-slate-600">{gapSentence}</p>
              )}
              <p className="mt-3 text-sm text-slate-600">
                이 차이는 &apos;나는 나를 얼마나 정확히 아는가&apos; 분석에 쓰여.
              </p>
            </>
          )}
        </div>
      </div>

      <Card title="시험 후 회고 3문항">
        <div className="flex flex-col gap-5">
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-900">① 준비가 충분했나?</p>
            <div role="radiogroup" aria-label="준비 정도" className="flex gap-2">
              {PREPAREDNESS_VALUES.map((value) => {
                const isSelected = preparedness === value
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setPreparedness(value)}
                    className={cn(
                      'h-10 w-10 cursor-pointer rounded-full border text-sm font-medium transition-colors',
                      isSelected
                        ? 'border-brand bg-brand-light text-brand'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    {value}
                  </button>
                )
              })}
            </div>
            <div className="mt-1 flex max-w-[13rem] justify-between text-xs text-slate-500">
              <span>전혀</span>
              <span>충분</span>
            </div>
          </div>

          <div>
            <Input
              label="② 가장 아쉬운 점"
              name="regret"
              maxLength={REFLECTION_MAX_LENGTH}
              value={regret}
              onChange={(event) => setRegret(event.target.value)}
              placeholder="예: 탐구 개념 정리를 못 끝냄"
            />
            <p className="mt-1 text-right text-xs text-slate-500">
              {regret.length}/{REFLECTION_MAX_LENGTH}
            </p>
          </div>

          <div>
            <Input
              label="③ 다음에 바꿀 한 가지"
              name="next-change"
              maxLength={REFLECTION_MAX_LENGTH}
              value={nextChange}
              onChange={(event) => setNextChange(event.target.value)}
              placeholder="예: 시험 3주 전부터 탐구 매일 30분"
            />
            <p className="mt-1 text-right text-xs text-slate-500">
              {nextChange.length}/{REFLECTION_MAX_LENGTH}
            </p>
          </div>
        </div>
      </Card>

      {errorMessage && (
        <p role="alert" className="text-sm font-medium text-red-600">
          {errorMessage}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full">
        저장하기
      </Button>

      {savedMessage && (
        <p role="status" className="text-sm font-medium text-emerald-600">
          {savedMessage}
        </p>
      )}
    </form>
  )
}

interface ExamThinkingGapProps {
  /** 시험 날짜 'YYYY-MM-DD'. 서버가 이 날의 14일 전 ~ 하루 전 기록을 봅니다 */
  examDate: string
}

/**
 * 시험 전 2주의 기록을 생각 습관 테스트와 견준 카드입니다. ("시험을 망쳤다면, 내 생각과 실제는 어디가 달랐을까")
 * 서버에서 받아오는 부분만 AsyncBoundary 로 감쌉니다. 받아오는 동안 스켈레톤, 실패하면 안내와 다시 시도 버튼
 */
function ExamThinkingGapCard({ examDate }: ExamThinkingGapProps) {
  return (
    <Card title="내 생각 vs 시험 전 2주">
      <AsyncBoundary
        pendingFallback={<ExamThinkingGapSkeleton />}
        errorMessage="시험 전 2주의 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."
      >
        <ExamThinkingGapView examDate={examDate} />
      </AsyncBoundary>
    </Card>
  )
}

/** 받아오는 동안 보여 주는 자리 (진짜 내용과 비슷한 크기) */
function ExamThinkingGapSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-3">
      <span className="sr-only">시험 전 2주의 기록을 불러오는 중이에요</span>
      <Skeleton className="h-24 w-full rounded-lg" />
    </div>
  )
}

/**
 * 서버가 만든 문장을 그대로 보여 줍니다. 숫자와 판정은 서버의 코드가 정합니다. (AI 안 씀)
 * 생각 습관 테스트를 안 했으면(서버가 null) 테스트로 가는 길을 보여 줍니다.
 */
function ExamThinkingGapView({ examDate }: ExamThinkingGapProps) {
  const { data: gap } = useSuspenseQuery(examThinkingGapQuery(examDate))

  if (gap === null) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm break-keep text-slate-600">
          생각 습관 테스트를 하면, 시험 전 2주의 기록이 내 생각과 맞았는지 같이 볼 수 있어.
        </p>
        <Link
          to={THINKING_TEST_PATH}
          className="text-brand inline-flex h-10 items-center text-sm font-medium underline"
        >
          생각 습관 테스트 해 보기
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm break-keep text-slate-600">
        {formatExamDate(gap.fromDate)} ~ {formatExamDate(gap.toDate)}의 기록을 생각 습관 테스트와
        견줘 봤어.
      </p>
      <ul className="flex flex-col gap-2">
        {gap.sentences.map((sentence) => (
          <li
            key={sentence}
            className="rounded-lg border border-slate-200 p-3 text-sm break-keep text-slate-800"
          >
            {sentence}
          </li>
        ))}
      </ul>
      <p className="text-xs break-keep text-slate-500">
        타이머를 멈출 때 고른 이유와 통화에서 말한 이유로 셌어. 생각 습관은 성격이 아니라,
        알아차리면 바꿀 수 있는 버릇이야.
      </p>
    </div>
  )
}

export function ExamResultPage() {
  const { examId } = useParams()
  const { exams, updateExam } = useExams()
  const { sessions } = useStudySessions()
  // 과목은 계획 화면에서 저장한 목록을 읽기만 합니다. (처음 한 번은 예시 과목)
  const subjects = useSubjects()

  const exam = exams.find((item) => item.id === examId)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          to="/exams"
          className="text-brand inline-flex h-11 items-center gap-1 text-sm font-medium hover:underline"
        >
          <span aria-hidden>‹</span> 시험
        </Link>
        {exam ? (
          <>
            <h1 className="mt-1 text-2xl font-bold tracking-tight break-words sm:text-3xl">
              {exam.name} 결과
            </h1>
            <p className="mt-2 text-slate-600">
              {formatExamDate(exam.date)} · 시험 전에 적은 예상 점수와 비교해 봐
            </p>
          </>
        ) : (
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">시험 결과</h1>
        )}
      </div>

      {!exam ? (
        <Card>
          <p className="py-6 text-center text-sm text-slate-500">
            시험을 찾을 수 없어요. 지워졌거나 주소가 잘못됐을 수 있어요.
          </p>
        </Card>
      ) : getDaysUntil(exam.date) >= 0 ? (
        // 시험 날짜가 지나기 전에는 결과를 받지 않습니다. (오늘이 시험 날이어도 아직입니다)
        <Card>
          <p className="py-6 text-center text-sm text-slate-500">
            시험 날짜가 지나면 결과를 입력할 수 있어요.
          </p>
        </Card>
      ) : (
        <>
          <ExamResultForm exam={exam} subjects={subjects} sessions={sessions} onSave={updateExam} />
          <ExamThinkingGapCard examDate={exam.date} />
        </>
      )}
    </div>
  )
}
