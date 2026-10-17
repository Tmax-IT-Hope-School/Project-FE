import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { SubjectBadge } from '@/components/ui/SubjectBadge'
import { useExams } from '@/hooks/useExams'
import { cn } from '@/lib/cn'
import {
  examTypeOptions,
  formatDday,
  formatExamDate,
  getAverageDiff,
  getDaysUntil,
  getExamTypeLabel,
  getResultHeadline,
  hasExamResult,
  parseScore,
  splitExams,
} from '@/lib/exams'
import { useSubjects } from '@/hooks/useSubjects'
import type { Exam, ExamSubjectScore, ExamType, Subject } from '@/types'
import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

/** 시험 추가·수정 폼에 적는 값. 점수는 입력 도중 빈 칸일 수 있어서 글자로 들고 있습니다. */
interface ExamFormState {
  type: ExamType
  name: string
  date: string
  /** 과목 id → 예상 점수 글자 */
  scores: Record<string, string>
}

function createEmptyForm(): ExamFormState {
  return { type: 'mock', name: '', date: '', scores: {} }
}

interface ScoreListProps {
  exam: Exam
  subjects: Subject[]
}

/** 시험의 과목별 예상 점수를 2칸 격자로 보여줍니다. (지워진 과목의 점수는 건너뜁니다) */
function ScoreList({ exam, subjects }: ScoreListProps) {
  const rows = exam.subjectScores.flatMap((score) => {
    const subject = subjects.find((item) => item.id === score.subjectId)
    return subject ? [{ subject, score }] : []
  })

  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">적어 둔 예상 점수가 없어요.</p>
  }

  return (
    <ul className="grid grid-cols-2 gap-2">
      {rows.map(({ subject, score }) => (
        <li
          key={subject.id}
          className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"
        >
          <SubjectBadge name={subject.name} color={subject.color} />
          <span className="font-semibold text-slate-900">{score.expectedScore}</span>
        </li>
      ))}
    </ul>
  )
}

export function ExamsPage() {
  const navigate = useNavigate()
  const { exams, addExam, updateExam, deleteExam } = useExams()
  // 과목은 계획 화면에서 저장한 목록을 읽기만 합니다. (처음 한 번은 예시 과목)
  const subjects = useSubjects()

  const [form, setForm] = useState<ExamFormState>(createEmptyForm)
  // 고치는 중인 시험의 id. null 이면 새로 추가하는 중입니다.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [savedMessage, setSavedMessage] = useState('')
  // 지우기 전에 확인창으로 물어보고 있는 시험. null 이면 확인창이 닫혀 있습니다.
  const [deleteTarget, setDeleteTarget] = useState<Exam | null>(null)
  const formRef = useRef<HTMLDivElement>(null)

  const { upcoming, past } = splitExams(exams)

  function handleChangeScore(subjectId: string, value: string) {
    setForm((prev) => ({ ...prev, scores: { ...prev.scores, [subjectId]: value } }))
  }

  /** 고치기: 그 시험의 값을 폼에 채우고 폼으로 스크롤합니다. */
  function handleStartEdit(exam: Exam) {
    const scores: Record<string, string> = {}
    for (const score of exam.subjectScores) {
      scores[score.subjectId] = String(score.expectedScore)
    }
    setForm({ type: exam.type, name: exam.name, date: exam.date, scores })
    setEditingId(exam.id)
    setErrorMessage('')
    setSavedMessage('')
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function handleCancelEdit() {
    setForm(createEmptyForm())
    setEditingId(null)
    setErrorMessage('')
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSavedMessage('')

    const name = form.name.trim()
    if (name === '') return setErrorMessage('시험 이름을 적어 주세요.')
    if (form.date === '') return setErrorMessage('시험 날짜를 골라 주세요.')

    // 적은 점수만 모읍니다. 빈 칸은 "이 과목은 안 적음" 이라 건너뛰고, 0~100 이 아니면 알려 줍니다.
    const subjectScores: ExamSubjectScore[] = []
    for (const subject of subjects) {
      const text = form.scores[subject.id] ?? ''
      // 고치는 중이면 이 과목에 전에 적어 둔 점수를 찾습니다. (처음 추가할 때는 없습니다)
      const oldScore = exams
        .find((exam) => exam.id === editingId)
        ?.subjectScores.find((score) => score.subjectId === subject.id)

      if (text.trim() === '') {
        // 예상 점수 칸을 비우면 그 과목의 점수가 통째로 빠집니다.
        // 실제 점수까지 말없이 사라지지 않게, 실제 점수가 있는 과목은 비우지 못하게 막고 알려 줍니다.
        if (oldScore?.actualScore !== undefined) {
          return setErrorMessage(
            `${subject.name}은(는) 실제 점수가 있어서 예상 점수를 비울 수 없어요.`,
          )
        }
        continue
      }

      const expectedScore = parseScore(text)
      if (expectedScore === null) {
        return setErrorMessage(`${subject.name} 점수는 0~100 사이의 정수로 적어 주세요.`)
      }

      // 고치는 중이면 이미 입력된 실제 점수(#81)는 그대로 지켜 줍니다.
      subjectScores.push({
        subjectId: subject.id,
        expectedScore,
        ...(oldScore?.actualScore !== undefined && { actualScore: oldScore.actualScore }),
      })
    }
    if (subjectScores.length === 0) {
      return setErrorMessage('과목 하나 이상에 예상 점수를 적어 주세요.')
    }

    if (editingId === null) {
      addExam({ id: `exam-${Date.now()}`, type: form.type, name, date: form.date, subjectScores })
    } else {
      const oldExam = exams.find((exam) => exam.id === editingId)
      if (oldExam) {
        // 현재 과목 목록에 없는 과목(지워진 과목)의 점수도 잃지 않게 그대로 이어 붙입니다.
        const keptScores = oldExam.subjectScores.filter(
          (score) => !subjects.some((subject) => subject.id === score.subjectId),
        )
        updateExam({
          ...oldExam,
          type: form.type,
          name,
          date: form.date,
          subjectScores: [...subjectScores, ...keptScores],
        })
      }
    }

    setSavedMessage(editingId === null ? '시험을 저장했어요.' : '시험을 고쳤어요.')
    setForm(createEmptyForm())
    setEditingId(null)
    setErrorMessage('')
  }

  function handleConfirmDelete() {
    if (deleteTarget === null) return
    deleteExam(deleteTarget.id)
    // 고치던 시험을 지웠으면 폼도 비웁니다.
    if (deleteTarget.id === editingId) handleCancelEdit()
    setDeleteTarget(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">시험</h1>
        <p className="mt-2 text-slate-600">
          시험 전에 예상 점수를 적어 두면, 끝나고 실제 점수와 비교해 줄게.
        </p>
      </div>

      <p className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm break-words text-slate-700">
        🛡️ 시험 직전 3일·직후 2일은 채찍이 자동으로 약해져.
      </p>

      {/* 모바일은 한 줄에 하나(목록 → 폼 순서), PC(lg)는 왼쪽 시험 목록 · 오른쪽 시험 추가로 나눕니다. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-6">
          <Card title="다가오는 시험">
            {upcoming.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">
                다가오는 시험이 없어요. 시험을 추가해 보세요.
              </p>
            ) : (
              <ul className="flex flex-col gap-5">
                {upcoming.map((exam) => (
                  <li key={exam.id} className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-lg font-semibold break-words text-slate-900">
                          {exam.name}
                        </p>
                        <p className="text-sm text-slate-500">
                          {getExamTypeLabel(exam.type)} · {formatExamDate(exam.date)}
                        </p>
                      </div>
                      <span className="bg-brand shrink-0 rounded-full px-3 py-1 text-xs font-bold text-white">
                        {formatDday(getDaysUntil(exam.date))}
                      </span>
                    </div>

                    <ScoreList exam={exam} subjects={subjects} />

                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button
                        variant="secondary"
                        className="h-11 w-full sm:flex-1"
                        onClick={() => handleStartEdit(exam)}
                      >
                        예상 점수 고치기
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-11 w-full text-slate-500 hover:text-red-600 sm:w-auto"
                        onClick={() => setDeleteTarget(exam)}
                        aria-label={`${exam.name} 지우기`}
                      >
                        지우기
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="지난 시험">
            {past.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">아직 지난 시험이 없어요.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {past.map((exam) => {
                  const hasResult = hasExamResult(exam)
                  const averageDiff = getAverageDiff(exam.subjectScores)
                  return (
                    <li
                      key={exam.id}
                      className={cn(
                        'rounded-lg border p-3',
                        hasResult
                          ? 'border-transparent bg-slate-50'
                          : 'border-amber-200 bg-amber-50',
                      )}
                    >
                      <p className="font-semibold break-words text-slate-900">{exam.name}</p>
                      <p className="text-sm text-slate-500">
                        {formatExamDate(exam.date)} · {formatDday(getDaysUntil(exam.date))}
                      </p>
                      <p
                        className={cn(
                          'mt-1 text-sm',
                          hasResult ? 'text-slate-500' : 'text-amber-800',
                        )}
                      >
                        {!hasResult
                          ? '아직 결과를 안 넣었어요.'
                          : averageDiff === null
                            ? '회고를 저장했어요.'
                            : getResultHeadline(averageDiff, true)}
                      </p>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          variant={hasResult ? 'secondary' : 'primary'}
                          className="h-11"
                          onClick={() => navigate(`/exams/${exam.id}/result`)}
                        >
                          {hasResult ? '결과 보기' : '결과 입력'}
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-11 px-3"
                          onClick={() => handleStartEdit(exam)}
                          aria-label={`${exam.name} 고치기`}
                        >
                          고치기
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-11 px-3 text-slate-500 hover:text-red-600"
                          onClick={() => setDeleteTarget(exam)}
                          aria-label={`${exam.name} 지우기`}
                        >
                          지우기
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>

        <div ref={formRef}>
          <Card title={editingId === null ? '시험 추가' : '시험 고치기'}>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <p className="mb-1.5 text-sm font-medium text-slate-700">종류</p>
                {/* 종류 버튼은 한 칸에 하나만 고릅니다. 좁은 화면에서는 줄이 바뀝니다. */}
                <div role="radiogroup" aria-label="시험 종류" className="flex flex-wrap gap-2">
                  {examTypeOptions.map((option) => {
                    const isSelected = form.type === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => setForm((prev) => ({ ...prev, type: option.value }))}
                        className={cn(
                          'h-10 cursor-pointer rounded-full border px-4 text-sm font-medium transition-colors',
                          isSelected
                            ? 'border-brand bg-brand-light text-brand'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                        )}
                      >
                        {option.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label="시험 이름"
                  name="exam-name"
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="예: 11월 모의고사"
                />
                <Input
                  label="날짜"
                  name="exam-date"
                  type="date"
                  value={form.date}
                  onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))}
                />
              </div>

              <div>
                <p className="text-sm font-medium text-slate-700">과목별 예상 점수</p>
                <p className="mt-1 text-sm text-slate-500">
                  솔직하게 적을수록 &apos;나를 아는 정도&apos;를 정확히 알려줄 수 있어.
                </p>
                {/* 과목이 하나도 없으면 점수 칸이 없어서 시험을 추가할 수 없습니다. 이유와 갈 곳을 알려 줍니다. */}
                {subjects.length === 0 && (
                  <p className="mt-3 text-sm break-keep text-slate-600">
                    과목이 없어서 점수를 적을 수 없어요.{' '}
                    <Link
                      to="/planner"
                      className="text-brand inline-flex h-10 items-center font-medium underline underline-offset-4"
                    >
                      계획 화면에서 과목 추가하기
                    </Link>
                  </p>
                )}
                <ul className="mt-3 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                  {subjects.map((subject) => (
                    <li key={subject.id} className="flex items-center gap-2">
                      <span className="w-14 shrink-0">
                        <SubjectBadge name={subject.name} color={subject.color} />
                      </span>
                      <Input
                        name={`score-${subject.id}`}
                        inputMode="numeric"
                        aria-label={`${subject.name} 예상 점수`}
                        value={form.scores[subject.id] ?? ''}
                        onChange={(event) => handleChangeScore(subject.id, event.target.value)}
                        placeholder="0~100"
                        className="text-right"
                      />
                    </li>
                  ))}
                </ul>
              </div>

              {errorMessage && (
                <p role="alert" className="text-sm font-medium text-red-600">
                  {errorMessage}
                </p>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="submit" size="lg" className="w-full sm:flex-1">
                  {editingId === null ? '시험 저장' : '고친 내용 저장'}
                </Button>
                {editingId !== null && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="lg"
                    className="w-full sm:w-auto"
                    onClick={handleCancelEdit}
                  >
                    취소
                  </Button>
                )}
              </div>

              {savedMessage && (
                <p role="status" className="text-sm font-medium text-emerald-600">
                  {savedMessage}
                </p>
              )}
            </form>
          </Card>
        </div>
      </div>

      {/* 지우기 전에 한 번 더 물어봅니다. */}
      <Modal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="시험을 지울까요?"
      >
        {deleteTarget !== null && (
          <>
            <p className="font-medium break-words text-slate-900">{deleteTarget.name}</p>
            {/* 결과(실제 점수·회고)까지 적은 시험이면, 그것도 같이 사라진다고 알려 줍니다. */}
            <p className="mt-2 text-sm break-keep text-slate-600">
              {hasExamResult(deleteTarget)
                ? '적어 둔 예상 점수와 실제 점수·회고도 함께 사라지고, 되돌릴 수 없어요.'
                : '적어 둔 예상 점수도 함께 사라지고, 되돌릴 수 없어요.'}
            </p>

            <div className="mt-5 flex gap-3">
              <Button
                variant="secondary"
                size="lg"
                className="flex-1"
                onClick={() => setDeleteTarget(null)}
              >
                취소
              </Button>
              <Button variant="danger" size="lg" className="flex-1" onClick={handleConfirmDelete}>
                지우기
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
