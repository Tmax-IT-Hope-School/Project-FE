import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { PlayBadge } from '@/components/ui/PlayBadge'
import { SubjectBadge } from '@/components/ui/SubjectBadge'
import { getApiErrorMessage } from '@/lib/api'
import {
  checkDraftConflicts,
  getDraftProblem,
  toEditableDrafts,
  toStudyPlans,
  type EditableDraft,
} from '@/lib/planDraft'
import { VOICE_PLAN_MAX_LENGTH, parsePlans } from '@/lib/planParseApi'
import type { StudyPlan, Subject } from '@/types'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

interface VoicePlanCardProps {
  /** 초안이 들어갈 날짜 ('YYYY-MM-DD'). 지금 계획 화면에서 보고 있는 날짜입니다 */
  date: string
  /** 제목에 쓰는 날짜 이름. 예) '오늘' · '내일' · '10월 5일' */
  dateLabel: string
  /** 내 과목들. 초안의 과목은 이 안에서만 고릅니다 (새 과목을 만들지 않습니다) */
  subjects: Subject[]
  /** 그날 이미 있는 계획들. 겹침을 확인할 때 씁니다 */
  existingPlans: StudyPlan[]
  /** 서버(AI)를 쓸 수 있는지. 테스트 로그인은 서버가 모르는 토큰이라 false 입니다 */
  canUseAi: boolean
  /** [이대로 추가] 를 눌러 확인을 마친 계획들을 저장합니다 */
  onAddPlans: (plans: StudyPlan[]) => void
}

/**
 * 계획 화면의 "말로 추가" 카드입니다. (#248, 시안 docs/design/screens/plan-voice-mobile.png)
 * 한 문장을 쓰면 AI 가 계획 여러 개의 "초안" 으로 나눠 주고, 학생이 미리보기에서 고치거나 빼고 [이대로 추가] 를 눌러야 저장됩니다.
 *
 *   1) 문장 입력(200자까지) → [계획으로 바꾸기]  … 바꾸는 동안 로딩 표시, 실패하면 이유를 보여 주고 문장은 그대로 둡니다
 *   2) 미리보기 줄마다 과목 · 할 일 · 목표 시간 · 시작 시각을 고치거나 뺄 수 있습니다
 *      내 과목에 없는 과목이면 "과목을 골라 주세요" 가 뜹니다. 새 과목을 몰래 만들지 않습니다
 *   3) [이대로 추가] → 기존 계획 · 구글 일정 · 다른 초안과 시간이 겹치는지 확인(#315)하고, 겹치면 그 줄에 표시하고 저장하지 않습니다
 *   위기 표현이 있으면 서버가 AI 를 쓰지 않고 도움 안내를 먼저 보여 주라고 알려 줍니다.
 */
export function VoicePlanCard({
  date,
  dateLabel,
  subjects,
  existingPlans,
  canUseAi,
  onAddPlans,
}: VoicePlanCardProps) {
  const [text, setText] = useState('')
  // 미리보기에서 고치는 초안들. 아직 바꾸기 전이거나 저장한 뒤에는 null 입니다.
  const [drafts, setDrafts] = useState<EditableDraft[] | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  // 겹침 때문에 저장하지 못한 줄의 key → 안내 문장. 구글 캘린더를 못 읽었을 때의 안내
  const [conflicts, setConflicts] = useState<Record<string, string>>({})
  const [googleNotice, setGoogleNotice] = useState<string | null>(null)
  // 지금 고치는 줄의 key
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [savedCount, setSavedCount] = useState<number | null>(null)

  const parse = useMutation({
    mutationFn: ({ targetDate, sentence }: { targetDate: string; sentence: string }) =>
      parsePlans(targetDate, sentence),
    onSuccess: (result) => {
      setShowHelp(result.showHelp)
      setSavedCount(null)
      setConflicts({})
      setGoogleNotice(null)
      setEditingKey(null)
      const subjectIds = subjects.map((subject) => subject.id)
      setDrafts(result.drafts.length === 0 ? [] : toEditableDrafts(result.drafts, subjectIds))
    },
  })

  const trimmed = text.trim()
  const canParse = canUseAi && trimmed !== '' && !parse.isPending && !isSaving

  function handleParse() {
    if (!canParse) return
    parse.mutate({ targetDate: date, sentence: trimmed })
  }

  function updateDraft(key: string, patch: Partial<EditableDraft>) {
    setDrafts(
      (prev) => prev?.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)) ?? null,
    )
    // 고친 줄은 겹침 안내를 지웁니다. 다시 [이대로 추가] 를 누를 때 새로 확인합니다.
    setConflicts((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function removeDraft(key: string) {
    setDrafts((prev) => prev?.filter((draft) => draft.key !== key) ?? null)
    setConflicts((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    if (editingKey === key) setEditingKey(null)
  }

  const hasProblem = drafts !== null && drafts.some((draft) => getDraftProblem(draft) !== null)
  const canAdd = drafts !== null && drafts.length > 0 && !hasProblem && !isSaving

  async function handleAdd() {
    if (drafts === null || !canAdd) return
    setIsSaving(true)
    const result = await checkDraftConflicts(drafts, date, existingPlans)
    setGoogleNotice(result.googleNotice)
    if (Object.keys(result.messages).length > 0) {
      // 겹치는 줄이 있으면 아무것도 저장하지 않습니다. 그 줄을 빼거나 시각을 고치게 합니다.
      setConflicts(result.messages)
      setIsSaving(false)
      return
    }
    onAddPlans(toStudyPlans(drafts, date, Date.now()))
    setSavedCount(drafts.length)
    setDrafts(null)
    setText('')
    setConflicts({})
    setEditingKey(null)
    setIsSaving(false)
  }

  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]))

  return (
    <>
      <Card title="말로 추가" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="voice-plan-text" className="text-sm font-semibold text-slate-800">
            하고 싶은 걸 한 문장으로
          </label>
          <span className="text-sm text-slate-500 tabular-nums">
            {text.length} / {VOICE_PLAN_MAX_LENGTH}자
          </span>
        </div>
        <textarea
          id="voice-plan-text"
          rows={3}
          maxLength={VOICE_PLAN_MAX_LENGTH}
          value={text}
          disabled={!canUseAi}
          onChange={(event) => setText(event.target.value)}
          placeholder="예) 학원 끝나고 수학 문제집 2시간, 영어 단어 30분, 그다음 게임 1시간"
          className="focus:border-brand focus:ring-brand/30 w-full resize-y rounded-lg border border-slate-300 p-3 text-sm placeholder:text-slate-400 focus:ring-2 focus:outline-none disabled:bg-slate-50"
        />
        <p className="text-sm break-keep text-slate-500">
          {canUseAi
            ? '키보드의 마이크(받아쓰기)로 말해도 돼요. 시각을 말하면("3시부터") 시작 시각도 채워 줘요.'
            : 'AI 로 계획을 만드는 것은 구글로 로그인했을 때 쓸 수 있어요. 테스트 모드에서는 쓸 수 없어요.'}
        </p>

        <Button className="h-11 w-full" disabled={!canParse} onClick={handleParse}>
          {parse.isPending ? '계획으로 바꾸는 중…' : '계획으로 바꾸기'}
        </Button>

        {/* 바꾸는 동안과 실패했을 때의 안내. 칸은 항상 두고 글자만 바꿔서 화면 읽기 프로그램이 읽게 합니다. */}
        <p role="status" className="text-sm text-slate-500">
          {parse.isPending ? 'AI 가 문장을 계획으로 나누는 중이에요. 잠시만 기다려 주세요.' : ''}
        </p>
        <p role="alert" className="text-sm break-keep text-red-600">
          {parse.isError
            ? `${getApiErrorMessage(parse.error)} 문장은 그대로 남겨 뒀어요. 직접 추가해도 돼요.`
            : ''}
        </p>
        <p role="status" className="text-sm break-keep text-emerald-700">
          {savedCount !== null ? `계획 ${savedCount}개를 추가했어요.` : ''}
        </p>
      </Card>

      {/* 위기 표현이 있었을 때: 초안 대신 도움 안내를 먼저 보여 줍니다. */}
      {showHelp && (
        <Card title="먼저 이야기하고 싶어요" className="flex flex-col gap-2">
          <p className="text-sm break-keep text-slate-700">
            쓴 글을 읽고 걱정이 됐어요. 계획보다 지금 마음이 먼저예요. 혼자 견디지 않아도 돼요.
          </p>
          <Link
            to="/support"
            className="bg-brand inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-medium text-white"
          >
            도움받을 곳 보기
          </Link>
        </Card>
      )}

      {/* 문장에서 계획을 하나도 못 찾았을 때 */}
      {!showHelp && drafts !== null && drafts.length === 0 && (
        <Card className="flex flex-col gap-1">
          <p className="text-sm break-keep text-slate-700">
            문장에서 계획을 찾지 못했어요. 시간과 할 일을 같이 적어 보거나, 아래 &quot;계획
            추가&quot;로 직접 추가해 주세요.
          </p>
        </Card>
      )}

      {!showHelp && drafts !== null && drafts.length > 0 && (
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900">{dateLabel} 계획 초안</h3>
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
              AI 가 만든 초안
            </span>
          </div>

          <ul className="flex flex-col divide-y divide-slate-100">
            {drafts.map((draft) => {
              const problem = getDraftProblem(draft)
              const conflict = conflicts[draft.key]
              const subject = subjectById.get(draft.subjectId)
              const isEditing = editingKey === draft.key
              return (
                <li key={draft.key} className="flex flex-col gap-2 py-3">
                  <div className="flex items-center gap-2">
                    {draft.kind === 'play' ? (
                      <PlayBadge className="shrink-0" />
                    ) : subject ? (
                      <SubjectBadge
                        name={subject.name}
                        color={subject.color}
                        className="shrink-0"
                      />
                    ) : (
                      <span className="shrink-0 rounded bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-700 ring-1 ring-orange-200">
                        과목 없음
                      </span>
                    )}
                    <span className="min-w-0 flex-1 text-sm break-words text-slate-900">
                      {draft.startTime !== '' && (
                        <span className="mr-1.5 text-slate-500 tabular-nums">
                          {draft.startTime}
                        </span>
                      )}
                      {draft.content}
                    </span>
                    <span className="shrink-0 text-sm text-slate-700 tabular-nums">
                      {draft.targetMinutes}분
                    </span>
                    <button
                      type="button"
                      aria-label={`${draft.content} 고치기`}
                      aria-expanded={isEditing}
                      onClick={() => setEditingKey(isEditing ? null : draft.key)}
                      className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      aria-label={`${draft.content} 빼기`}
                      onClick={() => removeDraft(draft.key)}
                      className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                    >
                      ×
                    </button>
                  </div>

                  {/* 공부 계획인데 과목이 없거나 고치는 중이면 과목 버튼을 보여 줍니다. */}
                  {draft.kind === 'study' && (isEditing || draft.subjectId === '') && (
                    <div className="flex flex-col gap-2">
                      {draft.subjectId === '' && (
                        <p className="text-sm font-medium break-keep text-orange-700">
                          내 과목에 없어요. 과목을 골라 주세요.
                        </p>
                      )}
                      {subjects.length === 0 ? (
                        <p className="text-sm break-keep text-slate-500">
                          등록한 과목이 없어요. 아래 &quot;내 과목&quot;에서 먼저 과목을 추가해
                          주세요.
                        </p>
                      ) : (
                        <div role="group" aria-label="과목 고르기" className="flex flex-wrap gap-2">
                          {subjects.map((item) => (
                            <Button
                              key={item.id}
                              variant={item.id === draft.subjectId ? 'primary' : 'secondary'}
                              aria-pressed={item.id === draft.subjectId}
                              onClick={() => updateDraft(draft.key, { subjectId: item.id })}
                              className="max-w-full"
                            >
                              <span title={item.name} className="min-w-0 truncate">
                                {item.name}
                              </span>
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {isEditing && (
                    <div className="grid grid-cols-1 gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-3">
                      <Input
                        label="할 일"
                        maxLength={200}
                        value={draft.content}
                        onChange={(event) =>
                          updateDraft(draft.key, { content: event.target.value })
                        }
                      />
                      <Input
                        label="목표 시간(분)"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={600}
                        value={Number.isFinite(draft.targetMinutes) ? draft.targetMinutes : ''}
                        onChange={(event) =>
                          updateDraft(draft.key, {
                            targetMinutes:
                              event.target.value === '' ? Number.NaN : Number(event.target.value),
                          })
                        }
                      />
                      <Input
                        label="시작 시각 (선택)"
                        type="time"
                        value={draft.startTime}
                        onChange={(event) =>
                          updateDraft(draft.key, { startTime: event.target.value })
                        }
                      />
                    </div>
                  )}

                  {/* 줄의 문제(고칠 곳)와 겹침 안내. 과목 없음은 위에서 따로 안내해서 여기서는 뺍니다. */}
                  {problem !== null && !(draft.kind === 'study' && draft.subjectId === '') && (
                    <p role="alert" className="text-sm break-keep text-red-600">
                      {problem}
                    </p>
                  )}
                  {conflict && (
                    <p role="alert" className="text-sm font-medium break-keep text-red-600">
                      {conflict} 이 줄을 빼거나 시작 시각을 고쳐 주세요.
                    </p>
                  )}
                </li>
              )
            })}
          </ul>

          {googleNotice !== null && (
            <p role="status" className="text-sm break-keep text-amber-700">
              {googleNotice}
            </p>
          )}

          <Button className="h-12 w-full" disabled={!canAdd} onClick={() => void handleAdd()}>
            {isSaving ? '확인하는 중…' : `+ 이대로 추가 · ${drafts.length}개`}
          </Button>
          <p className="text-sm break-keep text-slate-500">
            {hasProblem
              ? '고칠 곳이 남아 있어요. 고치거나 빼면 추가할 수 있어요.'
              : '눌러야 저장돼요. 저장 전에 고치거나 뺄 수 있어요.'}
          </p>
        </Card>
      )}
    </>
  )
}
