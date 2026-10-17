import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { GoalAdjustModal } from '@/components/ui/GoalAdjustModal'
import { Input } from '@/components/ui/Input'
import { MinutesPicker } from '@/components/ui/MinutesPicker'
import { PlayBadge } from '@/components/ui/PlayBadge'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Skeleton } from '@/components/ui/Skeleton'
import { useCalendarConnect, type CalendarConnection } from '@/hooks/useCalendarConnect'
import { cn } from '@/lib/cn'
import { useGoalAdjust } from '@/hooks/useGoalAdjust'
import { getTodayKey, isDateKey, moveDateKey } from '@/lib/date'
import { usePlanCalendarSync, type PlanCalendarState } from '@/hooks/usePlanCalendarSync'
import { usePlans } from '@/hooks/usePlans'
import { useQueryParam } from '@/hooks/useQueryParam'
import { useRoutines } from '@/hooks/useRoutines'
import { useStudySessions } from '@/hooks/useStudySessions'
import { useSuggestionChecks } from '@/hooks/useSuggestionChecks'
import { useSuggestions } from '@/hooks/useSuggestions'
import { scalePlanMinutes } from '@/lib/goalAdjust'
import { getTodayCareDecision } from '@/lib/careInputs'
import { getRecentAverageMinutes } from '@/lib/goalAdjustInput'
import { loadCheckInsByDate } from '@/lib/insightEvidence'
import { SUBJECT_COLORS, SUBJECT_COLOR_LABELS, loadSubjects } from '@/lib/subjects'
import { SUBJECT_NAME_MAX_LENGTH } from '@/lib/subjectsApi'
import { getPlanProgress, getPlayProgress } from '@/lib/planProgress'
import { PLAN_RESULT_LABELS, getPlanResult, type PlanResult } from '@/lib/planResult'
import { copyPlans, getFrequentPlans, type FrequentPlan } from '@/lib/planShortcuts'
import {
  WEEKDAY_ORDER,
  formatWeekdays,
  getWeekday,
  getWeekdayName,
  markRoutinesFilled,
} from '@/lib/routines'
import { loadData, saveData } from '@/lib/storage'
import { busyTimesQuery, type BusyTime } from '@/lib/googleCalendar'
import { checkPlanSlot, NO_SLOT_PROBLEM, type PlanSlotCheck } from '@/lib/planSlotCheck'
import { formatMinutes, getNowLine, getTimeline, mergeBusyTimes } from '@/lib/timeline'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { PlanKind, Routine, StudyPlan, StudySession, Subject, SubjectColor } from '@/types'
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

/* 과목 색 → 태그 색. (#11 SubjectBadge 가 생기면 그걸로 바꾸면 됩니다) */
const subjectColorStyles: Record<SubjectColor, string> = {
  red: 'bg-red-50 text-red-600',
  orange: 'bg-orange-50 text-orange-600',
  yellow: 'bg-yellow-50 text-yellow-700',
  lime: 'bg-lime-50 text-lime-700',
  green: 'bg-green-50 text-green-600',
  teal: 'bg-teal-50 text-teal-700',
  sky: 'bg-sky-50 text-sky-700',
  blue: 'bg-blue-50 text-blue-600',
  indigo: 'bg-indigo-50 text-indigo-600',
  purple: 'bg-purple-50 text-purple-600',
  pink: 'bg-pink-50 text-pink-700',
  slate: 'bg-slate-100 text-slate-600',
}

/* 계획 결과 → 표시 색. 초록 = 했음, 노랑·주황 = 아쉬움, 회색 = 못 했어요. (빨강으로 혼내지 않습니다) 색만으로 구분하지 않도록 글자도 같이 보여줍니다. (#313) */
const planResultStyles: Record<PlanResult, string> = {
  onTime: 'bg-green-50 text-green-700',
  done: 'bg-green-50 text-green-700',
  late: 'bg-amber-50 text-amber-700',
  partial: 'bg-orange-50 text-orange-700',
  missed: 'bg-slate-100 text-slate-600',
}

/* 색 고르기 버튼에 칠할 색. 보여주는 순서는 lib/subjects.ts 의 SUBJECT_COLORS 를 따릅니다. */
const colorSwatchStyles: Record<SubjectColor, string> = {
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  yellow: 'bg-yellow-500',
  lime: 'bg-lime-500',
  green: 'bg-green-500',
  teal: 'bg-teal-500',
  sky: 'bg-sky-500',
  blue: 'bg-blue-500',
  indigo: 'bg-indigo-500',
  purple: 'bg-purple-500',
  pink: 'bg-pink-500',
  slate: 'bg-slate-500',
}
/** 과목을 새로 만들 때 처음 골라 두는 색 */
const DEFAULT_SUBJECT_COLOR: SubjectColor = 'blue'

/* 플래너 블록의 색. block = 블록의 바탕·테두리·글자 / fill = 실제로 한 만큼 진하게 채우는 색 */
const blockColorStyles: Record<SubjectColor, { block: string; fill: string }> = {
  red: { block: 'border-red-300 bg-red-50 text-red-900', fill: 'bg-red-200' },
  orange: { block: 'border-orange-300 bg-orange-50 text-orange-900', fill: 'bg-orange-200' },
  yellow: { block: 'border-yellow-300 bg-yellow-50 text-yellow-900', fill: 'bg-yellow-200' },
  lime: { block: 'border-lime-300 bg-lime-50 text-lime-900', fill: 'bg-lime-200' },
  green: { block: 'border-green-300 bg-green-50 text-green-900', fill: 'bg-green-200' },
  teal: { block: 'border-teal-300 bg-teal-50 text-teal-900', fill: 'bg-teal-200' },
  sky: { block: 'border-sky-300 bg-sky-50 text-sky-900', fill: 'bg-sky-200' },
  blue: { block: 'border-blue-300 bg-blue-50 text-blue-900', fill: 'bg-blue-200' },
  indigo: { block: 'border-indigo-300 bg-indigo-50 text-indigo-900', fill: 'bg-indigo-200' },
  purple: { block: 'border-purple-300 bg-purple-50 text-purple-900', fill: 'bg-purple-200' },
  pink: { block: 'border-pink-300 bg-pink-50 text-pink-900', fill: 'bg-pink-200' },
  slate: { block: 'border-slate-300 bg-slate-50 text-slate-900', fill: 'bg-slate-200' },
}
// 노는 계획과, 과목이 지워진 계획의 블록 색 (회색)
const defaultBlockStyle = {
  block: 'border-slate-300 bg-slate-50 text-slate-800',
  fill: 'bg-slate-200',
}

// 계획을 보는 방식. list: 체크하는 목록 / timeline: 시간 순서로 놓은 플래너 (#237)
type PlannerView = 'list' | 'timeline'

const viewOptions: { view: PlannerView; label: string }[] = [
  { view: 'list', label: '목록' },
  { view: 'timeline', label: '플래너' },
]

/** 저장해 둔 보기 방식을 읽습니다. 저장된 게 없거나 모르는 값이면 '목록' 입니다. */
function loadPlannerView(): PlannerView {
  return loadData<unknown>('planner-view', 'list') === 'timeline' ? 'timeline' : 'list'
}

/** 분을 '10분' · '1시간' · '1시간 30분' 처럼 보여줍니다. (플래너의 "빈 시간" 에 씁니다) */
function formatGap(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}분`
  if (minutes === 0) return `${hours}시간`
  return `${hours}시간 ${minutes}분`
}

// 계획의 종류. 노는 것도 계획에 넣을 수 있습니다. (#238)
const kindOptions: { kind: PlanKind; label: string }[] = [
  { kind: 'study', label: '공부' },
  { kind: 'play', label: '놀기' },
]

// 노는 계획에서 버튼으로 고르는 종류. 고른 이름이 그대로 계획의 내용이 됩니다.
const PLAY_TYPES = ['게임', '영상', '운동', '친구', '쉬기']
// 버튼에 없는 것을 직접 적을 때 고르는 버튼의 이름
const CUSTOM_PLAY_TYPE = '직접 입력'

/** 계획 추가 폼이 부모에게 넘기는 값 */
interface PlanInput {
  /** 공부 계획인지 노는 계획인지 */
  kind: PlanKind
  /** 과목 (Subject 의 id). 노는 계획이면 빈 글자입니다 */
  subjectId: string
  content: string
  targetMinutes: number
  /** 시작 시각 ('HH:MM'). 안 정했으면 빈 글자입니다 */
  startTime: string
  /** "매주 반복" 으로 고른 요일들 (0 = 일요일 … 6 = 토요일). 반복하지 않으면 빈 배열입니다 */
  repeatWeekdays: number[]
}

// 목표 시간 버튼에 보여줄 값(분)과, 처음에 골라 두는 값
const PLAN_MINUTES_PRESETS = [30, 60, 90, 120]
const DEFAULT_PLAN_MINUTES = 60

interface PlanAddFormProps {
  /** 고를 수 있는 과목 목록 */
  subjects: Subject[]
  /** 최근에 자주 쓴 계획. 버튼으로 보여주고, 누르면 바로 추가합니다. */
  frequentPlans: FrequentPlan[]
  /** 지금 보고 있는 날짜의 요일 (0 = 일요일 … 6 = 토요일). "매주 반복" 을 켤 때 이 요일을 미리 골라 둡니다. */
  defaultWeekday: number
  /**
   * 입력 검사를 통과했을 때, 새 계획에 들어갈 값을 부모에게 넘깁니다.
   * 부모는 시간이 다른 일정과 겹치는지 확인하고, 겹치면 계획을 넣지 않고 안내(conflictMessage)를 돌려줍니다. (#315)
   */
  onAdd: (input: PlanInput) => Promise<PlanSlotCheck>
}

/** 새 계획을 입력하는 폼입니다. (자주 쓰는 계획 · 과목 · 내용 · 시작 시각 · 목표 시간 · 매주 반복) */
function PlanAddForm({ subjects, frequentPlans, defaultWeekday, onAdd }: PlanAddFormProps) {
  // 첫 과목을 미리 골라 둡니다. 과목이 하나도 없으면 빈 값입니다.
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? '')
  // 고른 과목이 "내 과목" 에서 지워졌으면, 남아 있는 첫 과목을 고른 것으로 봅니다. 과목이 하나도 없으면 빈 글자입니다.
  // (지워진 과목의 id 로 계획이 저장되지 않게 하기 위해서입니다)
  const selectedSubjectId = subjects.some((subject) => subject.id === subjectId)
    ? subjectId
    : (subjects[0]?.id ?? '')
  // 공부 계획을 넣는 중인지 노는 계획을 넣는 중인지 (#238)
  const [kind, setKind] = useState<PlanKind>('study')
  // 노는 계획에서 고른 종류 (게임 · 영상 … 또는 '직접 입력')
  const [playType, setPlayType] = useState(PLAY_TYPES[0])
  const [content, setContent] = useState('')
  // 목표 시간은 버튼으로 고릅니다. 고른 값은 다음 계획을 넣을 때도 그대로 남습니다.
  const [minutes, setMinutes] = useState(DEFAULT_PLAN_MINUTES)
  const [contentError, setContentError] = useState('')
  // 시작 시각 ('HH:MM'). 안 정해도 됩니다. 비워 두면 "시간 미정" 계획이 됩니다. (#237)
  const [startTime, setStartTime] = useState('')
  // 시작 시각이 다른 일정과 겹쳐서 못 넣었을 때의 안내. 그리고 구글 캘린더를 못 읽었을 때의 안내 (#315)
  const [timeError, setTimeError] = useState('')
  const [timeNotice, setTimeNotice] = useState('')
  // 겹치는지 확인하는 중인지. 구글 캘린더를 받아오느라 시간이 걸릴 수 있어서, 그동안 또 눌러도 한 번만 넣습니다.
  const [isChecking, setIsChecking] = useState(false)
  // "매주 반복" 을 켰는지와, 반복할 요일들 (0 = 일요일 … 6 = 토요일)
  const [isRepeat, setIsRepeat] = useState(false)
  const [repeatWeekdays, setRepeatWeekdays] = useState<number[]>([])
  const [repeatError, setRepeatError] = useState('')

  function handleChangeKind(nextKind: PlanKind) {
    setKind(nextKind)
    setContentError('')
  }

  function handleToggleRepeat() {
    // 켤 때 아직 고른 요일이 없으면, 지금 보고 있는 날짜의 요일을 미리 골라 둡니다.
    if (!isRepeat && repeatWeekdays.length === 0) setRepeatWeekdays([defaultWeekday])
    setIsRepeat(!isRepeat)
    setRepeatError('')
  }

  function handleToggleWeekday(weekday: number) {
    // 이미 골랐으면 빼고, 아니면 더합니다.
    setRepeatWeekdays((prev) =>
      prev.includes(weekday) ? prev.filter((day) => day !== weekday) : [...prev, weekday],
    )
    setRepeatError('')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // 폼의 기본 동작(페이지 새로고침)을 막습니다.
    event.preventDefault()
    if (isChecking) return

    // 띄어쓰기만 입력한 것도 빈 내용으로 봅니다.
    const trimmedContent = content.trim()
    const isPlay = kind === 'play'
    // 놀기에서 종류 버튼(게임 · 영상 …)을 골랐으면 그 이름이 내용이 됩니다. 공부와 "직접 입력" 은 적은 글자를 씁니다.
    const usesTypedContent = !isPlay || playType === CUSTOM_PLAY_TYPE
    const finalContent = usesTypedContent ? trimmedContent : playType

    // 공부 계획은 과목이 있어야 합니다. 과목을 전부 지웠으면 추가하지 않고 알려 줍니다.
    if (!isPlay && selectedSubjectId === '') {
      setContentError('과목이 없어요. 아래 "내 과목" 에서 먼저 추가해 주세요.')
      return
    }

    // 내용이 비었으면 추가하지 않고 안내 문구만 보여 줍니다. (목표 시간은 버튼으로 골라서 항상 쓸 수 있는 값입니다)
    if (finalContent === '') {
      setContentError(isPlay ? '무엇을 하며 놀지 적어 주세요.' : '할 일을 입력해 주세요.')
      return
    }

    // 반복을 켰는데 요일을 하나도 안 골랐으면 추가하지 않습니다.
    if (isRepeat && repeatWeekdays.length === 0) {
      setRepeatError('반복할 요일을 하나 이상 골라 주세요.')
      return
    }

    setIsChecking(true)
    let result: PlanSlotCheck
    try {
      result = await onAdd({
        kind,
        // 노는 계획은 과목이 없어서 빈 글자를 넘깁니다.
        subjectId: isPlay ? '' : selectedSubjectId,
        content: finalContent,
        targetMinutes: minutes,
        startTime,
        repeatWeekdays: isRepeat ? repeatWeekdays : [],
      })
    } finally {
      setIsChecking(false)
    }

    // 시간이 다른 일정과 겹쳐서 넣지 않았습니다. 적은 내용은 그대로 두어서, 시작 시각만 고쳐 다시 누르면 됩니다. (#315)
    // 구글 캘린더를 못 읽었다면, 겹쳐서 못 넣었든 넣었든 그 안내도 같이 보여 줍니다.
    setTimeNotice(result.googleNotice ?? '')
    if (result.conflictMessage !== null) {
      setTimeError(result.conflictMessage)
      return
    }
    setTimeError('')

    // 추가했으면 내용과 시작 시각 칸을 비웁니다. (고른 과목과 목표 시간은 그대로 둡니다)
    setContent('')
    setStartTime('')
    // 반복은 꺼 둡니다. 켜 둔 채로 다음 계획을 넣다가 루틴이 실수로 생기지 않게 하기 위해서입니다.
    setIsRepeat(false)
  }

  return (
    <Card title="계획 추가">
      {/* 자주 쓰는 계획: 누르면 폼을 거치지 않고 바로 추가됩니다. 쓴 적이 없으면 보이지 않습니다. */}
      {frequentPlans.length > 0 && (
        <div className="mb-4 flex flex-col gap-1.5 border-b border-slate-100 pb-4">
          <span className="text-sm font-medium text-slate-700">자주 쓰는 계획</span>
          {/* 글자 수가 제각각인 버튼이라 flex-wrap 으로 넘치면 다음 줄로 보냅니다. */}
          <div className="flex flex-wrap gap-2">
            {frequentPlans.map((plan) => {
              const subject = subjects.find((item) => item.id === plan.subjectId)
              return (
                <button
                  key={`${plan.subjectId}|${plan.content}|${plan.targetMinutes}`}
                  type="button"
                  onClick={() =>
                    onAdd({
                      kind: 'study',
                      subjectId: plan.subjectId,
                      content: plan.content,
                      targetMinutes: plan.targetMinutes,
                      startTime: '',
                      repeatWeekdays: [],
                    })
                  }
                  // max-w-full + min-w-0: 내용이 길어도 버튼이 카드 밖으로 나가지 않게 합니다.
                  className="flex min-h-10 max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-slate-400 bg-slate-50 px-3 py-1 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100"
                >
                  <span aria-hidden className="text-brand font-bold">
                    +
                  </span>
                  {subject && (
                    <span
                      className={cn(
                        'max-w-40 min-w-0 shrink-0 truncate rounded px-2 py-0.5 text-xs font-semibold',
                        subjectColorStyles[subject.color],
                      )}
                    >
                      {subject.name}
                    </span>
                  )}
                  <span className="min-w-0 break-words">
                    {plan.content} · {plan.targetMinutes}분
                  </span>
                </button>
              )
            })}
          </div>
          <p className="text-sm text-slate-500">누르면 바로 추가돼요.</p>
        </div>
      )}

      {/* noValidate: 브라우저 기본 경고창 대신 아래 Input 의 안내 문구를 보여 주기 위해 끕니다. */}
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {/* 공부 계획인지 노는 계획인지 고릅니다. 노는 것도 계획에 있어야 계획이 현실적이 됩니다. (#238) */}
        <div role="group" aria-label="종류" className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-700">종류</span>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
            {kindOptions.map((option) => (
              <button
                key={option.kind}
                type="button"
                aria-pressed={kind === option.kind}
                onClick={() => handleChangeKind(option.kind)}
                className={cn(
                  'h-10 cursor-pointer rounded-md text-sm font-medium transition-colors',
                  kind === option.kind
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-900',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {kind === 'study' ? (
          <div role="group" aria-label="과목" className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">과목</span>
            <div className="flex flex-wrap gap-2">
              {subjects.map((subject) => (
                <Button
                  key={subject.id}
                  variant={subject.id === selectedSubjectId ? 'primary' : 'secondary'}
                  aria-pressed={subject.id === selectedSubjectId}
                  onClick={() => setSubjectId(subject.id)}
                  className="max-w-full min-w-0"
                >
                  <span className="min-w-0 truncate">{subject.name}</span>
                </Button>
              ))}
            </div>
            {subjects.length === 0 && (
              <p className="text-sm break-keep text-slate-500">
                과목이 없어요. 아래 &quot;내 과목&quot; 에서 먼저 추가해 주세요.
              </p>
            )}
          </div>
        ) : (
          // 노는 계획은 과목 대신 무엇을 하며 놀지 고릅니다.
          <div role="group" aria-label="무엇을 하며 놀지" className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">무엇을 하며 놀지</span>
            <div className="flex flex-wrap gap-2">
              {[...PLAY_TYPES, CUSTOM_PLAY_TYPE].map((type) => (
                <Button
                  key={type}
                  variant={type === playType ? 'primary' : 'secondary'}
                  aria-pressed={type === playType}
                  onClick={() => {
                    setPlayType(type)
                    setContentError('')
                  }}
                >
                  {type}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* 공부는 할 일을 적고, 놀기는 "직접 입력" 을 골랐을 때만 적습니다. */}
        {(kind === 'study' || playType === CUSTOM_PLAY_TYPE) && (
          <Input
            name="planContent"
            label={kind === 'study' ? '할 일' : '무엇을 할지 직접 적기'}
            placeholder={kind === 'study' ? '예: 수학 문제집 4단원' : '예: 농구'}
            value={content}
            onChange={(event) => {
              setContent(event.target.value)
              setContentError('')
            }}
            error={contentError}
          />
        )}

        {/* 시작 시각은 안 정해도 됩니다. 정하면 플래너 보기에서 시간 순서대로 놓입니다. (#237) */}
        <div className="flex flex-col gap-1.5">
          <Input
            name="planStartTime"
            type="time"
            label="시작 시각 (선택)"
            value={startTime}
            onChange={(event) => {
              setStartTime(event.target.value)
              setTimeError('')
              setTimeNotice('')
            }}
            // 다른 일정과 겹치면 빨간 글씨로 어느 시간과 겹쳤는지, 언제부터 비는지 알려 줍니다. (#315)
            error={timeError}
          />
          {/*
            화면 낭독기용 안내 칸입니다. 낭독기는 글자가 "새로 생기는" 칸은 잘 안 읽고 "처음부터 있던 칸의 글자가 바뀔 때" 읽습니다.
            그래서 위의 빨간 글씨와 같은 내용을 이 칸에도 넣어 두고, 이 칸은 비어 있을 때도 그려 둡니다. (눈에는 안 보입니다)
          */}
          <p role="alert" className="sr-only">
            {timeError}
          </p>
          <p
            role="status"
            className={cn('text-xs break-keep text-slate-500', timeNotice === '' && 'sr-only')}
          >
            {timeNotice}
          </p>
        </div>

        {/* 숫자를 치는 대신 버튼으로 고릅니다. 버튼에 없는 시간은 "직접" 으로 적습니다. */}
        <MinutesPicker
          label="목표 시간"
          presets={PLAN_MINUTES_PRESETS}
          value={minutes}
          onChange={setMinutes}
        />

        {/* 매주 반복: 켜면 이 계획이 루틴으로 저장되어, 고른 요일마다 자동으로 들어옵니다. (#236) */}
        <div className="flex flex-col gap-2">
          {/* label 로 감싸서 글자를 눌러도 체크됩니다. min-h-10 으로 누르는 영역을 40px 로 맞춥니다. */}
          <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={isRepeat}
              onChange={handleToggleRepeat}
              className="accent-brand h-5 w-5 cursor-pointer"
            />
            매주 반복 (루틴으로 저장)
          </label>

          {isRepeat && (
            <>
              {/* 요일 버튼 7개가 375px 에서도 한 줄에 들어갑니다. */}
              <div role="group" aria-label="반복할 요일" className="grid grid-cols-7 gap-1.5">
                {WEEKDAY_ORDER.map((weekday) => {
                  const isSelected = repeatWeekdays.includes(weekday)
                  return (
                    <button
                      key={weekday}
                      type="button"
                      aria-pressed={isSelected}
                      aria-label={`${getWeekdayName(weekday)}요일`}
                      onClick={() => handleToggleWeekday(weekday)}
                      className={cn(
                        'h-10 cursor-pointer rounded-lg border text-sm font-medium transition-colors',
                        isSelected
                          ? 'border-brand bg-brand-light text-brand'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                      )}
                    >
                      {getWeekdayName(weekday)}
                    </button>
                  )
                })}
              </div>
              <p className="text-sm break-keep text-slate-500">
                고른 요일마다 이 계획이 자동으로 들어와요.
              </p>
              {repeatError && <p className="text-xs text-red-600">{repeatError}</p>}
            </>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={isChecking}>
          {isChecking ? '시간 확인 중…' : '추가하기'}
        </Button>
      </form>
    </Card>
  )
}

interface RoutineListProps {
  /** 저장된 루틴 목록 */
  routines: Routine[]
  /** 과목 이름과 색을 찾을 때 쓰는 과목 목록 */
  subjects: Subject[]
  /** 루틴을 방금 저장했을 때 보여줄 안내. 없으면 null */
  notice: string | null
  /** 루틴의 삭제 버튼을 눌렀을 때 호출됩니다. */
  onDelete: (routine: Routine) => void
}

/** "내 루틴" 카드. 요일마다 반복되는 계획의 틀을 보고 지울 수 있습니다. (#236) */
function RoutineList({ routines, subjects, notice, onDelete }: RoutineListProps) {
  return (
    <Card title="내 루틴">
      <div className="flex flex-col gap-3">
        {notice && (
          <p role="status" className="text-sm font-medium break-keep text-indigo-700">
            {notice}
          </p>
        )}

        {routines.length === 0 ? (
          <p className="text-sm break-keep text-slate-500">
            아직 루틴이 없어요. 계획을 추가할 때 &quot;매주 반복&quot; 을 켜면 루틴이 돼요.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {routines.map((routine) => {
              const subject = subjects.find((item) => item.id === routine.subjectId)
              return (
                <li key={routine.id} className="flex items-center gap-2 py-1">
                  {/* flex-wrap: 좁은 화면에서는 요일·과목·내용이 두 줄로 나뉩니다. */}
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-sm">
                    <span className="shrink-0 font-semibold text-slate-900">
                      {formatWeekdays(routine.weekdays)}
                    </span>
                    {/* 시작 시각을 정한 루틴만 시각을 보여줍니다. */}
                    {routine.startTime && (
                      <span className="shrink-0 text-slate-500 tabular-nums">
                        {routine.startTime}
                      </span>
                    )}
                    {/* 노는 루틴은 과목 대신 회색 "놀기" 태그를 보여줍니다. */}
                    {routine.kind === 'play' && <PlayBadge className="shrink-0" />}
                    {subject && (
                      <span
                        className={cn(
                          'max-w-40 min-w-0 shrink-0 truncate rounded px-2 py-0.5 text-xs font-semibold',
                          subjectColorStyles[subject.color],
                        )}
                      >
                        {subject.name}
                      </span>
                    )}
                    <span className="min-w-0 break-words text-slate-900">{routine.content}</span>
                    <span className="shrink-0 text-slate-500">{routine.targetMinutes}분</span>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => onDelete(routine)}
                    aria-label={`${routine.content} 루틴 삭제`}
                    className="shrink-0 px-3 text-slate-500 hover:text-red-600"
                  >
                    삭제
                  </Button>
                </li>
              )
            })}
          </ul>
        )}

        <p className="text-sm break-keep text-slate-500">
          루틴은 고른 요일의 계획에 자동으로 들어와요. 그날 계획을 고치거나 지워도 루틴은
          그대로예요.
        </p>
      </div>
    </Card>
  )
}

interface SubjectManagerProps {
  /** 지금까지 등록된 과목 목록 */
  subjects: Subject[]
  /** 입력 검사를 통과했을 때, 새 과목 이름과 색을 부모에게 넘깁니다. */
  onAdd: (name: string, color: SubjectColor) => void
  /** 과목의 삭제 버튼(×)을 눌렀을 때 호출됩니다. */
  onDelete: (subject: Subject) => void
}

/** 과목을 추가·삭제하는 카드입니다. */
function SubjectManager({ subjects, onAdd, onDelete }: SubjectManagerProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState<SubjectColor>(DEFAULT_SUBJECT_COLOR)
  const [nameError, setNameError] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = name.trim()

    if (trimmedName === '') {
      setNameError('과목 이름을 입력해 주세요.')
      return
    }
    // 같은 이름의 과목이 두 개면 계획·기록에서 구분할 수 없어서 막습니다.
    if (subjects.some((subject) => subject.name === trimmedName)) {
      setNameError('이미 있는 과목이에요.')
      return
    }

    onAdd(trimmedName, color)
    setName('')
    setNameError('')
  }

  return (
    <Card title="내 과목">
      <div className="flex flex-col gap-4">
        {subjects.length === 0 ? (
          <p className="text-sm text-slate-500">아직 등록한 과목이 없어요.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {subjects.map((subject) => (
              <span
                key={subject.id}
                className={cn(
                  'inline-flex max-w-full items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold',
                  subjectColorStyles[subject.color],
                )}
              >
                <span className="min-w-0 truncate">{subject.name}</span>
                <button
                  type="button"
                  onClick={() => onDelete(subject)}
                  aria-label={`${subject.name} 삭제`}
                  // h-10 w-8: 글자(×)는 작아도 누르는 영역은 40px 로 둡니다.
                  // -my-2.5 -mr-2: 누르는 영역만 넓히고 태그의 크기는 그대로 두려고, 넓어진 만큼 바깥 여백을 뺍니다.
                  className="-my-2.5 -mr-2 inline-flex h-10 w-8 cursor-pointer items-center justify-center text-sm leading-none opacity-70 hover:opacity-100"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <Input
            name="subjectName"
            label="새 과목 이름"
            maxLength={SUBJECT_NAME_MAX_LENGTH}
            placeholder="예: 한국사"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setNameError('')
            }}
            error={nameError}
          />

          <div className="flex flex-col gap-1.5">
            {/* 색만으로는 구분하기 어려운 사람도 있어서, 고른 색의 이름을 글자로도 보여줍니다. */}
            <span className="text-sm font-medium text-slate-700">
              색 <span className="font-normal text-slate-500">· {SUBJECT_COLOR_LABELS[color]}</span>
            </span>
            {/* 12개가 한 줄에 안 들어가면 flex-wrap 으로 다음 줄로 넘어갑니다. (375px 에서는 6개씩 두 줄) */}
            <div role="group" aria-label="과목 색" className="flex flex-wrap gap-2">
              {SUBJECT_COLORS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setColor(item)}
                  aria-label={`${SUBJECT_COLOR_LABELS[item]} 색`}
                  aria-pressed={color === item}
                  className={cn(
                    'h-10 w-10 cursor-pointer rounded-full',
                    colorSwatchStyles[item],
                    color === item && 'ring-2 ring-slate-900 ring-offset-2',
                  )}
                />
              ))}
            </div>
          </div>

          <Button type="submit" className="w-full">
            과목 추가
          </Button>
        </form>

        <p className="text-sm text-slate-500">과목 색은 계획·타이머·기록에서 같이 쓰여요.</p>
      </div>
    </Card>
  )
}

interface PlanRowProps {
  plan: StudyPlan
  /** 그 계획의 과목. 과목이 지워졌으면 undefined 입니다 */
  subject: Subject | undefined
  /** 공부 기록. 이 계획으로 실제 공부한 시간을 구하는 데 씁니다 */
  sessions: StudySession[]
  /** 오늘 계획인지. 오늘의 안 끝난 계획에만 [▶ 시작] 이 보입니다 */
  isToday: boolean
  /** 오늘 날짜 (새벽 4시 기준). 그날이 끝났는지 보고 결과(덜 함·안 함)를 정하는 데 씁니다 */
  todayKey: string
  onToggleDone: (planId: string) => void
  /**
   * 시작 시각을 바꿨을 때 호출됩니다. 지우면 빈 글자('')를 넘깁니다.
   * 다른 일정과 겹치면 시각을 바꾸지 않고 안내(conflictMessage)를 돌려줍니다. (#315)
   */
  onChangeStartTime: (planId: string, startTime: string) => Promise<PlanSlotCheck>
  onDelete: (plan: StudyPlan) => void
  /** 구글 캘린더 상태 (#316). 구글 캘린더를 연결하지 않았거나 맞출 계획이 아니면 없음 */
  calendarState?: PlanCalendarState
  /** [구글 캘린더에 넣기] 를 눌렀을 때 */
  onAddToCalendar?: (plan: StudyPlan) => void
}

/**
 * 계획 한 줄입니다. 목록 보기와, 플래너 보기의 "시간 미정" 에서 같이 씁니다.
 * 윗줄: 체크 · 과목 · 내용 · 시작 버튼 / 아랫줄: 시작 시각 · 진행 막대 · 실제/목표 · 삭제
 * 시작 시각을 누르면 그 아래에 시각을 고치는 칸이 펼쳐집니다. (#237)
 */
function PlanRow({
  plan,
  subject,
  sessions,
  isToday,
  todayKey,
  onToggleDone,
  onChangeStartTime,
  onDelete,
  calendarState,
  onAddToCalendar,
}: PlanRowProps) {
  // 시작 시각을 고치는 칸을 펼쳤는지
  const [isTimeOpen, setIsTimeOpen] = useState(false)
  // 시작 시각을 바꾸려다 다른 일정과 겹쳐서 못 바꿨을 때의 안내. 그리고 구글 캘린더를 못 읽었을 때의 안내 (#315)
  const [timeError, setTimeError] = useState('')
  const [timeNotice, setTimeNotice] = useState('')

  // 시각 칸에 고치는 중인 값. null 이면 고치는 중이 아니라서 계획의 시작 시각을 그대로 보여 줍니다.
  // 키보드로 시각을 고치면 시 · 분을 한 칸씩 바꿀 때마다 값이 바뀌는데(예: 15:00 → 15:30 으로 가는 길에 15:3x),
  // 그때마다 겹침을 확인하면 중간 값에서 겹침에 걸려 원하는 시각으로 못 갑니다. 그래서 다 고친 뒤(칸을 벗어나거나 Enter)에 한 번만 확인합니다.
  const [draftTime, setDraftTime] = useState<string | null>(null)

  /** 시작 시각을 바꾸고, 겹쳤으면 안내를 보여 줍니다. */
  async function handleChangeTime(startTime: string) {
    const result = await onChangeStartTime(plan.id, startTime)
    setTimeError(result.conflictMessage ?? '')
    setTimeNotice(result.googleNotice ?? '')
  }

  /**
   * 고치던 시각을 확정합니다. 칸을 벗어났을 때와 Enter 를 눌렀을 때 부릅니다.
   * 시 · 분 중 일부만 적어서 값이 비어 보이면(예: "15:--") 아직 적는 중이라, 바꾸지 않고 원래 값으로 돌립니다.
   * (그대로 확정하면 "시작 시각 지우기" 가 되어 버립니다)
   */
  function handleCommitTime(input: HTMLInputElement) {
    if (draftTime === null) return
    const next = draftTime
    setDraftTime(null)
    if (next === '' && input.validity.badInput) return
    if (next !== (plan.startTime ?? '')) void handleChangeTime(next)
  }
  // 이 계획에서 타이머를 시작해 공부한 시간. "32 / 50분" 과 진행 막대에 씁니다. (lib/planProgress.ts)
  const progress = getPlanProgress(plan, sessions)
  // 계획한 시간에 실제로 했는지 (제때 함·늦게 함·덜 함 …). 아직 판정할 수 없으면 null 입니다. (lib/planResult.ts)
  const result = getPlanResult(plan, sessions, todayKey)

  return (
    <li className="flex flex-col py-1">
      <div className="flex items-center gap-2">
        {/* label 로 감싸서 체크박스 주변 40px 전체를 눌러도 체크됩니다. */}
        <label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            checked={plan.done}
            onChange={() => onToggleDone(plan.id)}
            aria-label={`${plan.content} 완료`}
            className="accent-brand h-5 w-5 cursor-pointer"
          />
        </label>

        {/* 노는 계획은 과목 대신 회색 "놀기" 태그를 보여줍니다. (#238) */}
        {plan.kind === 'play' && <PlayBadge className="shrink-0" />}
        {/* 과목을 지운 뒤에 남은 계획은, 무슨 과목이었는지 알 수 없어서 "삭제된 과목" 으로 표시합니다. */}
        {!subject && plan.kind !== 'play' && (
          <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
            삭제된 과목
          </span>
        )}
        {subject && (
          <span
            className={cn(
              'max-w-40 min-w-0 shrink-0 truncate rounded px-2 py-0.5 text-xs font-semibold',
              subjectColorStyles[subject.color],
            )}
          >
            {subject.name}
          </span>
        )}

        {/* min-w-0 + break-words: 긴 내용이 가로 스크롤을 만들지 않게 합니다. */}
        <span
          className={cn(
            'min-w-0 flex-1 text-sm break-words text-slate-900',
            plan.done && 'text-slate-400 line-through',
          )}
        >
          {plan.content}
        </span>

        {/* 루틴이 넣어 준 계획이라는 표시 */}
        {plan.routineId && (
          <span className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
            반복
          </span>
        )}

        {result && (
          <span
            className={cn(
              'max-w-40 min-w-0 shrink-0 truncate rounded px-2 py-0.5 text-xs font-semibold',
              planResultStyles[result],
            )}
          >
            {PLAN_RESULT_LABELS[result]}
          </span>
        )}

        {/* 오늘의 안 끝난 계획만 바로 시작할 수 있습니다. 누르면 타이머가 이 계획의 과목·목표 시간으로 시작됩니다. */}
        {isToday && !plan.done && (
          <Link
            to={`/timer?plan=${plan.id}`}
            aria-label={`${plan.content} 타이머 시작`}
            className="bg-brand hover:bg-brand-dark inline-flex h-10 shrink-0 items-center rounded-full px-3 text-sm font-medium text-white transition-colors"
          >
            ▶ {progress.actualMinutes > 0 ? '이어서' : '시작'}
          </Link>
        )}
      </div>

      {/* pl-12: 체크박스(40px) + 간격(8px)만큼 들여써서 과목 태그와 줄을 맞춥니다. */}
      <div className="flex items-center gap-2 pl-12">
        {/* 시작 시각. 누르면 아래에 고치는 칸이 펼쳐집니다. 안 정했으면 "시간 미정" 입니다. */}
        <button
          type="button"
          aria-expanded={isTimeOpen}
          aria-label={`${plan.content} 시작 시각 ${plan.startTime ?? '정하기'}`}
          onClick={() => {
            setIsTimeOpen(!isTimeOpen)
            // 접거나 다시 펼 때는 지난 안내를 지웁니다.
            setTimeError('')
            setTimeNotice('')
          }}
          className="h-10 shrink-0 cursor-pointer text-sm text-slate-500 tabular-nums underline decoration-dotted underline-offset-4 hover:text-slate-900"
        >
          {plan.startTime ?? '시간 미정'}
        </button>
        <ProgressBar value={progress.percent} className="min-w-0 flex-1" />
        {/* 아주 큰 숫자가 와도 줄을 넘지 않게 break-all 로 줄바꿈을 허용합니다. */}
        <span className="min-w-0 text-sm break-all text-slate-500 tabular-nums">
          {progress.actualMinutes} / {plan.targetMinutes}분
        </span>
        <Button
          variant="ghost"
          onClick={() => onDelete(plan)}
          aria-label={`${plan.content} 삭제`}
          className="shrink-0 px-3 text-slate-500 hover:text-red-600"
        >
          삭제
        </Button>
      </div>

      {/* 구글 캘린더에 들어갔는지 (#316). pl-12: 위 줄과 같은 들여쓰기 */}
      {calendarState && (
        <div className="flex items-center pl-12 text-sm text-slate-500">
          {calendarState === 'synced' && <span className="py-1">구글 캘린더에 있어요</span>}
          {calendarState === 'syncing' && (
            <span role="status" className="py-1">
              구글 캘린더에 넣는 중…
            </span>
          )}
          {calendarState === 'missing' && (
            <button
              type="button"
              onClick={() => onAddToCalendar?.(plan)}
              className="text-brand inline-flex h-10 items-center font-medium underline underline-offset-4"
            >
              구글 캘린더에 넣기
            </button>
          )}
        </div>
      )}

      {isTimeOpen && (
        <>
          {/* items-end: 입력칸 위에 이름표(label)가 있어서, 버튼을 입력칸 높이에 맞추려고 아래로 붙입니다. */}
          <div className="flex items-end gap-2 pb-2 pl-12">
            <Input
              name={`startTime-${plan.id}`}
              type="time"
              label="시작 시각"
              value={draftTime ?? plan.startTime ?? ''}
              onChange={(event) => {
                // 고치는 동안에는 값만 바꿔 두고, 확정할 때(칸을 벗어나거나 Enter) 겹침을 확인합니다.
                setDraftTime(event.target.value)
                setTimeError('')
                setTimeNotice('')
              }}
              onBlur={(event) => handleCommitTime(event.currentTarget)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleCommitTime(event.currentTarget)
              }}
            />
            <Button
              variant="ghost"
              disabled={!plan.startTime}
              onClick={() => {
                setDraftTime(null)
                void handleChangeTime('')
              }}
              className="shrink-0 px-3"
            >
              지우기
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setIsTimeOpen(false)
                setDraftTime(null)
                setTimeError('')
                setTimeNotice('')
              }}
              className="shrink-0 px-3"
            >
              닫기
            </Button>
          </div>
          {/*
            다른 일정과 겹쳐서 시각을 못 바꿨을 때. 어느 시간과 겹쳤는지, 언제부터 비는지 알려 줍니다. (#315)
            화면 낭독기가 읽으려면 안내 칸이 글자가 들어오기 전부터 화면에 있어야 해서, 비어 있을 때도 그려 둡니다.
          */}
          <p
            role="alert"
            className={cn('text-sm break-keep text-red-600', timeError !== '' && 'pb-2 pl-12')}
          >
            {timeError}
          </p>
          <p
            role="status"
            className={cn('text-sm break-keep text-slate-500', timeNotice !== '' && 'pb-2 pl-12')}
          >
            {timeNotice}
          </p>
        </>
      )}
    </li>
  )
}

interface PlanTimelineProps {
  /** 카드 제목. 예) '오늘 플래너' */
  title: string
  /** 그날 계획 전부. 시작 시각이 있는 것만 블록으로 그립니다 */
  plans: StudyPlan[]
  subjects: Subject[]
  sessions: StudySession[]
  /** 오늘이면 "지금" 선을 그리고, 블록을 눌러 타이머를 시작할 수 있습니다 */
  isToday: boolean
  /** 같은 날의 구글 캘린더 일정. 회색 블록으로 같이 그립니다 (#323). 연결 안 했으면 빈 배열 */
  busyTimes: BusyTime[]
}

/**
 * 플래너 보기. 하루 계획을 시작 시각 순서로 놓고, 목표 시간만큼의 높이로 그립니다. (#237)
 * 블록 안쪽은 실제로 공부한 만큼 위에서부터 진하게 채워서, 계획과 실제가 한눈에 보입니다.
 * 계산(순서 · 높이 · 빈 시간 · 겹침 · "지금" 선의 자리)은 lib/timeline.ts 가 합니다.
 */
function PlanTimeline({ title, plans, subjects, sessions, isToday, busyTimes }: PlanTimelineProps) {
  // "지금" 선을 1분마다 다시 그리려고 현재 시각을 들고 있습니다.
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const intervalId = setInterval(() => setNow(new Date()), 60 * 1000)
    // 화면을 떠날 때 정리합니다.
    return () => clearInterval(intervalId)
  }, [])

  const { blocks } = getTimeline(plans)
  // 내 계획 블록 사이로 구글 일정을 섞어 한 줄로 세웁니다. 빈 시간과 겹침도 구글 일정까지 보고 다시 셉니다. (#323)
  const items = mergeBusyTimes(blocks, busyTimes)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  // "지금" 선은 오늘 날짜에만 그립니다.
  const nowLine = isToday
    ? getNowLine(
        items.map((item) => item.block),
        nowMinutes,
      )
    : null
  // '19:05' 처럼 두 자리로 맞춘 지금 시각
  const nowText = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const hasOverlap = items.some((item) => item.kind === 'plan' && item.block.isOverlapping)

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {isToday && blocks.length > 0 && (
          <p className="text-sm text-slate-500">지금 {nowText} · 블록을 누르면 바로 시작</p>
        )}
      </div>

      {items.length === 0 ? (
        <p className="mt-3 text-sm break-keep text-slate-500">
          {plans.length === 0
            ? '이 날은 계획이 없어요. "목록" 보기에서 계획을 추가해 보세요.'
            : '시작 시각을 정한 계획이 아직 없어요. "시간 미정" 에서 시각을 정하면 여기에 놓여요.'}
        </p>
      ) : (
        <>
          {/* 겹쳐도 막지는 않고 알려주기만 합니다. */}
          {hasOverlap && (
            <p className="mt-2 text-sm font-medium break-keep text-amber-700">
              시간이 겹치는 계획이 있어요. (구글 일정과 겹친 것도 포함) 시작 시각이나 목표 시간을
              확인해 보세요.
            </p>
          )}

          <ol className="mt-3 flex flex-col gap-2">
            {items.map((item, index) => {
              // "지금" 선. 왼쪽 시각 칸에 지금 시각을, 블록 위에 가로선을 그립니다.
              // 선의 자리(top)는 시각에 따라 바뀌는 숫자라 style 을 씁니다. pointer-events-none: 선이 블록 누르는 것을 막지 않게 합니다.
              const nowLineMark = nowLine?.blockIndex === index && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 z-10 flex -translate-y-1/2 items-center gap-2"
                  style={{ top: `${nowLine.percent}%` }}
                >
                  <span className="w-11 shrink-0 rounded-full bg-slate-900 py-0.5 text-center text-xs font-semibold text-white tabular-nums">
                    {nowText}
                  </span>
                  <span className="h-0.5 flex-1 bg-slate-900" />
                </div>
              )
              // pl-13: 시각 칸(44px) + 간격(8px)만큼 들여써서 블록과 줄을 맞춥니다.
              const gapLine = item.block.gapBeforeMinutes > 0 && (
                <p className="pl-13 text-xs text-slate-500">
                  빈 시간 {formatGap(item.block.gapBeforeMinutes)}
                </p>
              )

              // 구글 캘린더 일정: 내 계획이 아니라서 누를 수 없고, 회색 점선 블록 + "구글 일정" 글자로 구분합니다. (#323)
              if (item.kind === 'busy') {
                const { startMinutes, endMinutes, heightPx } = item.block
                return (
                  <li
                    key={`busy-${startMinutes}-${endMinutes}-${index}`}
                    className="flex flex-col gap-2"
                  >
                    {gapLine}
                    <div className="relative flex gap-2">
                      <span className="w-11 shrink-0 pt-2 text-sm text-slate-400 tabular-nums">
                        {formatMinutes(startMinutes)}
                      </span>
                      {/* 블록 높이는 일정 길이에 비례해서 바뀌는 숫자라 style 을 씁니다. */}
                      <div
                        className="flex min-w-0 flex-1 items-start justify-between gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500"
                        style={{ height: heightPx }}
                      >
                        <span className="font-medium">구글 일정</span>
                        <span className="shrink-0 tabular-nums">
                          {formatMinutes(startMinutes)} ~ {formatMinutes(endMinutes)}
                        </span>
                      </div>
                      {nowLineMark}
                    </div>
                  </li>
                )
              }

              const block = item.block
              const { plan } = block
              const subject = subjects.find((item) => item.id === plan.subjectId)
              const progress = getPlanProgress(plan, sessions)
              const colors = subject ? blockColorStyles[subject.color] : defaultBlockStyle
              // 오늘의 안 끝난 계획만 눌러서 바로 시작할 수 있습니다. (목록의 [▶ 시작] 과 같은 규칙)
              const canStart = isToday && !plan.done
              // 한 것이 있으면 "12 / 50분", 아직이면 "50분"
              const timeLabel =
                plan.done || progress.actualMinutes > 0
                  ? `${progress.actualMinutes} / ${plan.targetMinutes}분`
                  : `${plan.targetMinutes}분`
              const blockClass = cn(
                'relative block w-full overflow-hidden rounded-lg border',
                colors.block,
                canStart && 'cursor-pointer hover:brightness-95',
              )

              // 블록 안에 그릴 내용. 누를 수 있는 블록(Link)과 아닌 블록(div)이 같이 씁니다.
              const blockContent = (
                <>
                  {/* 실제로 한 만큼 위에서부터 진하게 채웁니다. 높이가 진행률(%)에 따라 바뀌는 숫자라 style 을 씁니다. */}
                  <span
                    aria-hidden="true"
                    className={cn('absolute inset-x-0 top-0', colors.fill)}
                    style={{ height: `${progress.percent}%` }}
                  />
                  {/* relative: 위의 채운 색보다 글자가 앞에 보이게 합니다. */}
                  <span className="relative flex items-start justify-between gap-2 px-3 py-2 text-sm">
                    {/* truncate: 글자가 길면 한 줄에서 … 으로 줄입니다. (짧은 블록에서 넘치지 않게) */}
                    <span className="min-w-0 truncate">
                      {subject && <span className="mr-1.5 font-semibold">{subject.name}</span>}
                      {plan.kind === 'play' && <span className="mr-1.5 font-semibold">놀기</span>}
                      <span className={cn(plan.done && 'line-through')}>{plan.content}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 font-medium tabular-nums">
                      {block.isOverlapping && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                          겹침
                        </span>
                      )}
                      {timeLabel}
                      {plan.done && ' · 끝냄'}
                    </span>
                  </span>
                </>
              )

              return (
                <li key={plan.id} className="flex flex-col gap-2">
                  {gapLine}

                  <div className="relative flex gap-2">
                    <span className="w-11 shrink-0 pt-2 text-sm text-slate-500 tabular-nums">
                      {plan.startTime}
                    </span>

                    {/* 블록 높이는 목표 시간에 비례해서 바뀌는 숫자라 Tailwind 클래스로 만들 수 없어서 style 을 씁니다. */}
                    <div className="min-w-0 flex-1">
                      {canStart ? (
                        <Link
                          to={`/timer?plan=${plan.id}`}
                          aria-label={`${plan.startTime} ${plan.content} 타이머 시작`}
                          className={blockClass}
                          style={{ height: block.heightPx }}
                        >
                          {blockContent}
                        </Link>
                      ) : (
                        <div className={blockClass} style={{ height: block.heightPx }}>
                          {blockContent}
                        </div>
                      )}
                    </div>

                    {nowLineMark}
                  </div>
                </li>
              )
            })}
          </ol>

          <p className="mt-3 text-sm break-keep text-slate-500">
            블록 높이는 계획한 시간, 진하게 채워진 부분은 실제로 한 만큼이에요.
            {isToday && ' 검은 선은 지금 시각이에요.'}
            {busyTimes.length > 0 && ' 점선 블록은 구글 캘린더 일정이에요.'}
          </p>
        </>
      )}
    </Card>
  )
}

/** 보고 있는 날짜의 바로 전날을 부르는 이름입니다. 오늘을 보고 있으면 '어제', 내일을 보고 있으면 '오늘', 그 밖에는 '전날' */
function getDayBeforeLabel(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return '어제'
  if (dateKey === moveDateKey(todayKey, 1)) return '오늘'
  return '전날'
}

interface PlanTimelineWithGoogleProps extends Omit<PlanTimelineProps, 'busyTimes'> {
  /** 구글 일정을 받아올 날짜 ('YYYY-MM-DD') */
  dayKey: string
}

/** 그날 구글 일정을 받아와 플래너에 섞어 그립니다. 받아오는 부분이라 AsyncBoundary 안에서 씁니다. (#323) */
function PlanTimelineWithGoogle({ dayKey, ...timelineProps }: PlanTimelineWithGoogleProps) {
  const { data: busyTimes } = useSuspenseQuery(busyTimesQuery(dayKey))
  return <PlanTimeline {...timelineProps} busyTimes={busyTimes} />
}

/** 시각(Date.now() 값)을 '15:00' 처럼 보여줍니다. */
function formatClock(time: number): string {
  const date = new Date(time)
  return formatMinutes(date.getHours() * 60 + date.getMinutes())
}

interface GoogleDayChipsProps {
  /** 구글 일정을 받아올 날짜 ('YYYY-MM-DD') */
  dayKey: string
}

/** 그날 구글 캘린더 일정의 시간 칩. 받아오는 부분이라 AsyncBoundary 안에서 씁니다. (#323) */
function GoogleDayChips({ dayKey }: GoogleDayChipsProps) {
  const { data: busyTimes } = useSuspenseQuery(busyTimesQuery(dayKey))

  if (busyTimes.length === 0) {
    return <p className="py-1 text-sm text-slate-600">이 날은 구글 캘린더 일정이 없어요.</p>
  }
  return (
    // flex-wrap: 일정이 많으면 다음 줄로 넘어가서 가로 스크롤이 생기지 않습니다.
    <div className="flex flex-wrap items-center gap-2 py-1">
      <span className="text-sm font-medium text-slate-700">구글 일정 {busyTimes.length}개</span>
      {busyTimes.map((busy) => (
        <span
          key={`${busy.start}-${busy.end}`}
          className="rounded bg-white px-2 py-1 text-sm text-slate-700 tabular-nums ring-1 ring-slate-200"
        >
          {formatClock(busy.start)} ~ {formatClock(busy.end)}
        </span>
      ))}
    </div>
  )
}

interface GoogleCalendarStripProps {
  /** 구글 캘린더 연결 상태와 연결하기 (hooks/useCalendarConnect.ts) */
  connection: CalendarConnection
  /** 보고 있는 날짜 ('YYYY-MM-DD') */
  dayKey: string
}

/**
 * 계획 화면 위쪽의 구글 캘린더 한 줄입니다. (#323) 설정까지 가지 않아도 여기서 연결하고 그날 일정을 봅니다.
 *   연결 안 함 -> 안내 + [구글 캘린더 연결] / 연결이 끝남 -> [다시 연결] / 연결됨 -> 그날 구글 일정 시간 칩
 * 클라이언트 ID 가 없으면(lib/googleClient.ts) 아무것도 그리지 않습니다. 연결 끊기는 설정에 있습니다.
 */
function GoogleCalendarStrip({ connection, dayKey }: GoogleCalendarStripProps) {
  const { status, isReady, isConnecting, errorMessage, connect } = connection
  if (status === 'unavailable') return null

  return (
    <div className="mt-3 flex flex-col gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      {status === 'on' ? (
        <AsyncBoundary
          pendingFallback={<Skeleton className="h-10 w-full" />}
          errorMessage="구글 캘린더 일정을 불러오지 못했어요."
          // 날짜를 넘기면 실패 안내를 지우고 새 날짜로 다시 받아옵니다.
          resetKeys={[dayKey]}
        >
          <GoogleDayChips dayKey={dayKey} />
        </AsyncBoundary>
      ) : (
        // 모바일은 위아래로, sm 부터 글과 버튼을 한 줄에 둡니다.
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm break-keep text-slate-600">
            {status === 'off'
              ? '구글 캘린더를 연결하면 학원 · 약속 일정이 계획 옆에 같이 보이고, 계획도 캘린더에 들어가요.'
              : '구글 캘린더 연결이 끝났어요. 구글이 한 시간마다 다시 확인해요.'}
          </p>
          <Button
            variant="secondary"
            className="shrink-0 bg-white"
            disabled={isConnecting || !isReady}
            onClick={connect}
          >
            {isConnecting ? '연결하는 중…' : status === 'off' ? '구글 캘린더 연결' : '다시 연결'}
          </Button>
        </div>
      )}
      {errorMessage && (
        <p role="status" className="text-sm break-keep text-red-700">
          {errorMessage}
        </p>
      )}
    </div>
  )
}

export function PlannerPage() {
  const todayKey = getTodayKey()

  // 계획은 날짜별로 localStorage 에 저장돼서 새로고침해도 남습니다. (usePlans 훅)
  const {
    allPlans,
    getPlans,
    addPlan,
    addPlans,
    fillRoutines,
    toggleDone,
    changeStartTime,
    deletePlan,
    replaceDayPlans,
    setGoogleEventId,
  } = usePlans()
  // 루틴 = 요일마다 반복되는 계획의 틀 (#236)
  const { routines, addRoutine, deleteRoutine } = useRoutines()
  // 루틴을 방금 저장했을 때 보여줄 안내
  const [routineNotice, setRoutineNotice] = useState<string | null>(null)
  // sessions: 공부 기록만 / allSessions: 노는 기록까지.
  // 계획별 실제 시간은 노는 계획에도 보여야 해서 allSessions 로 구합니다. (#238)
  const { sessions, allSessions } = useStudySessions()
  // 보고 있는 날짜는 주소에 둡니다. (/planner = 오늘, /planner?date=2026-10-11 = 그날)
  // replace: ◀ ▶ 를 여러 번 눌러도 뒤로 가기 한 번이면 계획 화면을 떠납니다.
  const [dateParam, setSelectedDate] = useQueryParam('date', todayKey, { replace: true })
  // 주소는 누구나 고칠 수 있어서, 진짜 날짜가 아니면 오늘로 봅니다.
  const selectedDate = isDateKey(dateParam) ? dateParam : todayKey

  // 목록으로 볼지 플래너로 볼지도 주소에 둡니다. (/planner?view=timeline) (#237)
  // 주소에 없을 때는 지난번에 고른 보기(저장해 둔 값)로 엽니다.
  const [savedView] = useState<PlannerView>(loadPlannerView)
  const [viewParam, setViewParam] = useQueryParam('view', savedView)
  const view: PlannerView =
    viewParam === 'timeline' ? 'timeline' : viewParam === 'list' ? 'list' : savedView

  /** 보기를 바꿉니다. 주소를 바꾸고, 다음에 열 때도 그대로이도록 저장해 둡니다. */
  function handleChangeView(nextView: PlannerView) {
    saveData('planner-view', nextView)
    setViewParam(nextView)
  }

  // 새로고침해도 과목 목록이 유지되도록 localStorage 에서 불러옵니다. (처음 한 번은 예시 과목으로 시작)
  const [subjects, setSubjects] = useState<Subject[]>(loadSubjects)

  useEffect(() => {
    saveData('subjects', subjects)
  }, [subjects])

  // 계획을 만들고 옮기고 지울 때 구글 캘린더도 같이 바꿉니다. (연결했을 때만, #316)
  const calendar = usePlanCalendarSync({ subjects, setGoogleEventId })
  // 구글 캘린더 연결 상태. 위쪽 띠에서 연결하면 이 화면 전체가 다시 그려져서 계획 줄 · 플래너도 바로 바뀝니다. (#323)
  const calendarConnection = useCalendarConnect()

  // 보고 있는 날짜에 아직 안 넣은 루틴이 있으면 계획으로 넣습니다. (오늘과 앞으로의 날짜만, 한 날짜에 한 번만)
  // [selectedDate, routines]: 날짜를 옮기거나 루틴이 바뀔 때 다시 확인합니다.
  useEffect(() => {
    fillRoutines(selectedDate, routines)
  }, [selectedDate, routines])

  // 화면에는 고른 날짜의 계획만 보여 줍니다.
  const plans = getPlans(selectedDate)
  const isToday = selectedDate === todayKey
  // 플래너 보기에서 시작 시각을 안 정한 계획은 "시간 미정" 카드에 따로 모읍니다. (lib/timeline.ts)
  const { unscheduledPlans } = getTimeline(plans)
  // 그날의 노는 계획과 실제로 논 시간. 순공에는 넣지 않지만 숫자로는 보여줍니다. (#238)
  const playProgress = getPlayProgress(plans, allSessions)

  // ---- 원터치 계획 (#235) ----
  // 지워진 과목의 계획은 가져오기와 자주 쓰는 계획에서 뺍니다.
  const subjectIds = subjects.map((subject) => subject.id)
  // 최근 14일 동안 자주 쓴 "과목 + 할 일 + 시간" 조합 (많이 쓴 순, 5개까지)
  const frequentPlans = getFrequentPlans(allPlans, todayKey, subjectIds)
  // 계획이 비어 있는 날에 보여줄 "가져오기" 후보: 바로 전날과 지난주 같은 요일
  const importSources = [
    { label: getDayBeforeLabel(selectedDate, todayKey), date: moveDateKey(selectedDate, -1) },
    {
      label: `지난주 ${getWeekdayName(getWeekday(selectedDate))}요일`,
      date: moveDateKey(selectedDate, -7),
    },
  ]
    .map((source) => ({
      ...source,
      // 가져올 수 있는 계획 수 (지워진 과목의 계획은 빼고 셉니다)
      count: copyPlans(getPlans(source.date), selectedDate, subjectIds, 0).length,
    }))
    // 가져올 계획이 없는 날은 버튼을 보여주지 않습니다.
    .filter((source) => source.count > 0)

  // 목표 조정 제안 (#67, #205): 오늘의 대응이 "목표 상향/하향" 이면 팝업으로 물어봅니다.
  // 대응은 기간이 끝난 개선안의 이행·효과 판정, 체크인의 기분·미달 원인, 연속 미달 일수로 정합니다.
  // (기간이 끝난 개선안이 아직 없으면 대응이 정해지지 않아 팝업이 뜨지 않습니다. 자세한 건 lib/careInputs.ts)
  const todayPlans = getPlans(todayKey)
  // 노는 계획은 공부 목표가 아니라서 합계에서 뺍니다. (#238)
  const todayGoalMinutes = todayPlans
    .filter((plan) => plan.kind !== 'play')
    .reduce((sum, plan) => sum + plan.targetMinutes, 0)
  const { suggestions } = useSuggestions()
  const { checks: suggestionChecks } = useSuggestionChecks()
  // 체크인은 화면이 처음 그려질 때 한 번만 읽습니다. (이 화면에서는 체크인을 바꾸지 않습니다)
  const [checkIns] = useState(loadCheckInsByDate)
  const careDecision = getTodayCareDecision({
    suggestions,
    suggestionChecks,
    checkIns,
    plans: allPlans,
    sessions,
  })
  const { proposal, accept, decline } = useGoalAdjust({
    action: careDecision?.action ?? null,
    currentMinutes: todayGoalMinutes,
    recentAverageMinutes: getRecentAverageMinutes(allPlans, sessions),
    // 수락하면 오늘 계획들의 목표 시간을 새 목표에 맞춰 같은 비율로 바꿉니다.
    // 구글 캘린더에 넣은 계획은 일정의 끝 시각도 같이 옮깁니다.
    onAccept: (newMinutes) => {
      const scaledPlans = scalePlanMinutes(todayPlans, newMinutes)
      replaceDayPlans(todayKey, scaledPlans)
      for (const plan of scaledPlans) {
        if (plan.googleEventId) calendar.onPlanChanged(plan, todayKey)
      }
    },
  })

  // 'ko-KR' 로 바꾸면 "10월 5일 일요일" 처럼 한국어 날짜가 됩니다.
  // 'YYYY-MM-DD' 문자열은 영국 시간으로 읽히므로, 년·월·일을 쪼개서 우리 시간대로 만듭니다.
  const [year, month, day] = selectedDate.split('-').map(Number)
  const dateLabel = new Date(year, month - 1, day).toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  // window.confirm 은 브라우저 기본 확인창입니다. "확인" 을 누르면 true, "취소" 면 false 를 돌려줍니다.
  function handleDelete(target: StudyPlan) {
    const isConfirmed = window.confirm(`"${target.content}" 계획을 정말 지울까요?`)
    if (!isConfirmed) return
    deletePlan(target.id)
    calendar.onPlanDeleted(target)
  }

  // 시작 시각을 바꿉니다. 구글 캘린더에 넣은 계획이면 일정도 옮기고, 시각을 지우면 일정도 지웁니다.
  // 바꾸려는 시간이 그날의 다른 계획이나 구글 일정과 겹치면 바꾸지 않고, 겹친 안내를 돌려줍니다. (#315)
  async function handleChangeStartTime(planId: string, startTime: string): Promise<PlanSlotCheck> {
    const plan = allPlans.find((item) => item.id === planId)
    if (!plan) return NO_SLOT_PROBLEM

    const check = await checkPlanSlot({
      dayKey: plan.date,
      startTime,
      targetMinutes: plan.targetMinutes,
      plans: getPlans(plan.date),
      ignorePlanId: plan.id, // 자기 자신과는 겹침을 보지 않습니다
    })
    if (check.conflictMessage !== null) return check

    changeStartTime(planId, startTime)
    calendar.onPlanChanged(
      { ...plan, startTime: startTime === '' ? undefined : startTime },
      todayKey,
    )
    return check
  }

  // 폼에서 받은 값으로 새 계획을 만들어 저장합니다. 지금 보고 있는 날짜의 계획이 됩니다.
  // repeatWeekdays 가 비어 있지 않으면 "매주 반복" 을 켠 것입니다. 루틴도 같이 저장합니다.
  // 시작 시각이 그날의 다른 계획이나 구글 일정과 겹치면 아무것도 저장하지 않고(루틴도), 겹친 안내를 돌려줍니다. (#315)
  async function handleAdd({
    kind,
    subjectId,
    content,
    targetMinutes,
    startTime,
    repeatWeekdays,
  }: PlanInput): Promise<PlanSlotCheck> {
    // "매주 반복" 에서 지금 보고 있는 날짜의 요일을 안 골랐으면, 이 날짜에는 계획이 들어가지 않습니다. (아래의 return check)
    // 들어가지도 않는 날짜의 계획들과 겹치는지 검사하면 엉뚱하게 막히므로, 이때는 겹침을 확인하지 않습니다.
    const isAddedToday =
      repeatWeekdays.length === 0 || repeatWeekdays.includes(getWeekday(selectedDate))
    const check = isAddedToday
      ? await checkPlanSlot({
          dayKey: selectedDate,
          startTime,
          targetMinutes,
          plans: getPlans(selectedDate),
        })
      : NO_SLOT_PROBLEM
    if (check.conflictMessage !== null) return check

    const now = Date.now()
    const newPlan: StudyPlan = {
      // 추가한 시각(밀리초)을 붙여서 다른 계획과 겹치지 않는 id 를 만듭니다.
      id: `plan-${now}`,
      date: selectedDate,
      subjectId,
      content,
      targetMinutes,
      done: false,
      kind,
    }
    // 시작 시각은 정했을 때만 넣습니다. (없으면 "시간 미정" 계획입니다)
    if (startTime !== '') newPlan.startTime = startTime

    if (repeatWeekdays.length > 0) {
      const routine: Routine = {
        id: `routine-${now}`,
        weekdays: repeatWeekdays,
        kind,
        subjectId,
        content,
        targetMinutes,
      }
      // 루틴에도 시작 시각을 넣어 두면, 그 요일마다 같은 시각의 계획으로 들어옵니다.
      if (startTime !== '') routine.startTime = startTime
      addRoutine(routine)
      // 이 날짜는 아래에서 직접 넣거나(요일이 맞을 때) 넣지 않기로 한 것이라, 루틴이 같은 계획을 또 넣지 않게 표시해 둡니다.
      markRoutinesFilled(selectedDate, [routine.id])
      setRoutineNotice(`루틴을 저장했어요. ${formatWeekdays(repeatWeekdays)}마다 계획에 들어와요.`)

      // 고른 요일에 지금 보고 있는 날짜가 없으면, 이 날짜에는 계획을 넣지 않습니다.
      if (!repeatWeekdays.includes(getWeekday(selectedDate))) return check
      newPlan.routineId = routine.id
    }

    // 그날 목록의 맨 뒤에 붙습니다. (목록은 이 순서대로 보여 주므로 맨 아래에 나옵니다)
    addPlan(newPlan)
    // 구글 캘린더를 연결했으면 일정으로도 넣습니다. (#316)
    calendar.onPlanAdded(newPlan, todayKey)
    return check
  }

  // 루틴을 지웁니다. 이미 만들어진 날의 계획은 그대로 남습니다.
  function handleDeleteRoutine(target: Routine) {
    const message = `"${target.content}" 루틴을 지울까요? 이미 들어간 계획은 그대로 남아요.`
    if (!window.confirm(message)) return
    deleteRoutine(target.id)
    setRoutineNotice(null)
  }

  // 다른 날의 계획을 지금 보고 있는 날짜로 가져옵니다. 완료 표시는 지우고, 원래 날의 계획은 그대로 둡니다.
  function handleImport(sourceDate: string) {
    const copiedPlans = copyPlans(getPlans(sourceDate), selectedDate, subjectIds, Date.now())
    addPlans(copiedPlans)
    for (const plan of copiedPlans) calendar.onPlanAdded(plan, todayKey)
  }

  // 새 과목을 목록 맨 뒤에 추가합니다.
  function handleAddSubject(name: string, color: SubjectColor) {
    const newSubject: Subject = { id: `subject-${Date.now()}`, name, color }
    setSubjects((prev) => [...prev, newSubject])
  }

  // 그 과목으로 등록된 계획이 있으면(날짜 상관없이) 몇 개인지 알려주고 한 번 더 확인합니다.
  function handleDeleteSubject(target: Subject) {
    // 지금 타이머로 재고 있는 과목은 지우지 못하게 합니다.
    // 지우면 타이머 화면에서 과목이 사라지고, 정지를 눌러도 기록이 저장되지 않기 때문입니다.
    const timer = loadData<{ startedAt?: unknown } | null>('timer', null)
    const isTimerStarted = typeof timer?.startedAt === 'number'
    if (isTimerStarted && loadData<unknown>('timer-subject', null) === target.id) {
      window.alert(
        `"${target.name}" 과목으로 타이머를 재는 중이에요. 타이머를 정지한 뒤에 지워 주세요.`,
      )
      return
    }

    const relatedCount = allPlans.filter((plan) => plan.subjectId === target.id).length
    const message =
      relatedCount > 0
        ? `"${target.name}" 과목으로 등록된 계획이 ${relatedCount}개 있어요. 계획은 남고 "삭제된 과목" 으로 표시돼요. 그래도 삭제할까요?`
        : `"${target.name}" 과목을 삭제할까요?`

    if (!window.confirm(message)) return
    setSubjects((prev) => prev.filter((subject) => subject.id !== target.id))
  }

  // 플래너 보기에 넘기는 값. 구글 일정을 섞을 때와 아닐 때 똑같이 씁니다.
  const timelineProps = {
    title: isToday ? '오늘 플래너' : `${month}월 ${day}일 플래너`,
    plans,
    subjects,
    sessions: allSessions,
    isToday,
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        {/* 제목 옆에 "목록 | 플래너" 전환 버튼을 둡니다. 화면이 좁으면 flex-wrap 으로 다음 줄로 내려갑니다. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">공부 계획</h1>
          <div role="group" aria-label="보기 방식" className="flex rounded-lg bg-slate-100 p-1">
            {viewOptions.map((option) => (
              <button
                key={option.view}
                type="button"
                aria-pressed={view === option.view}
                onClick={() => handleChangeView(option.view)}
                className={cn(
                  'h-10 cursor-pointer rounded-md px-4 text-sm font-medium transition-colors',
                  view === option.view
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-900',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* 날짜 이동: ◀ 어제 / 날짜 / 내일 ▶ / 오늘로 돌아가기 */}
        <div className="mt-3 flex items-center gap-1">
          <Button
            variant="secondary"
            onClick={() => setSelectedDate(moveDateKey(selectedDate, -1))}
            aria-label="어제로 이동"
            className="w-10 shrink-0 px-0"
          >
            ◀
          </Button>
          <p className="min-w-0 flex-1 text-center text-sm font-semibold whitespace-nowrap text-slate-900 sm:text-base">
            {dateLabel}
          </p>
          <Button
            variant="secondary"
            onClick={() => setSelectedDate(moveDateKey(selectedDate, 1))}
            aria-label="내일로 이동"
            className="w-10 shrink-0 px-0"
          >
            ▶
          </Button>
          <Button
            variant="ghost"
            onClick={() => setSelectedDate(todayKey)}
            disabled={isToday}
            className="text-brand shrink-0 px-3"
          >
            오늘
          </Button>
        </div>

        {/* 노는 계획이 있는 날에만: 계획한 노는 시간과 실제로 논 시간 (#238) */}
        {playProgress.count > 0 && (
          <p className="mt-2 text-sm break-keep text-slate-500">
            노는 계획 {playProgress.targetMinutes}분 · 실제 {playProgress.actualMinutes}분. 노는
            시간은 순공에 넣지 않아요.
          </p>
        )}

        {/* 구글 캘린더: 연결하기 · 그날 구글 일정 (#323) */}
        <GoogleCalendarStrip connection={calendarConnection} dayKey={selectedDate} />
      </div>

      {view === 'timeline' ? (
        <>
          {/* 플래너 보기: 왼쪽에 시간 순서 블록, 오른쪽(모바일은 아래)에 시작 시각을 안 정한 계획 */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
            {/* 구글 캘린더를 연결했으면 구글 일정도 섞어 그립니다. 받는 동안 · 실패해도 내 계획 플래너는 보입니다. (#323) */}
            {calendarConnection.status === 'on' ? (
              <AsyncBoundary
                pendingFallback={<PlanTimeline {...timelineProps} busyTimes={[]} />}
                errorMessage="구글 캘린더 일정을 불러오지 못해서 내 계획만 보여 줘요."
                errorExtra={<PlanTimeline {...timelineProps} busyTimes={[]} />}
                resetKeys={[selectedDate]}
              >
                <PlanTimelineWithGoogle {...timelineProps} dayKey={selectedDate} />
              </AsyncBoundary>
            ) : (
              <PlanTimeline {...timelineProps} busyTimes={[]} />
            )}

            <Card title="시간 미정">
              {unscheduledPlans.length === 0 ? (
                <p className="text-sm break-keep text-slate-500">
                  시작 시각을 안 정한 계획이 없어요.
                </p>
              ) : (
                <>
                  <ul className="divide-y divide-slate-100">
                    {unscheduledPlans.map((plan) => (
                      <PlanRow
                        key={plan.id}
                        plan={plan}
                        subject={subjects.find((item) => item.id === plan.subjectId)}
                        sessions={allSessions}
                        isToday={isToday}
                        todayKey={todayKey}
                        onToggleDone={toggleDone}
                        onChangeStartTime={handleChangeStartTime}
                        onDelete={handleDelete}
                      />
                    ))}
                  </ul>
                  <p className="mt-2 text-sm break-keep text-slate-500">
                    &quot;시간 미정&quot; 을 눌러 시작 시각을 정하면 플래너에 놓여요.
                  </p>
                </>
              )}
            </Card>
          </div>

          <p className="text-sm break-keep text-slate-500">
            계획 추가와 루틴 · 과목 관리는 &quot;목록&quot; 보기에서 해요.
          </p>
        </>
      ) : (
        <>
          {/* 모바일은 세로로 쌓고, PC(lg)에서는 시안처럼 왼쪽 목록 · 오른쪽 추가 폼으로 나눕니다. */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
            <Card title={isToday ? '오늘 계획' : `${month}월 ${day}일 계획`}>
              {plans.length === 0 ? (
                <div className="flex flex-col gap-3 py-4">
                  <p className="text-center text-sm text-slate-500">
                    {isToday ? '오늘' : '이 날'} 계획을 세워 보세요
                  </p>
                  {/* 계획이 비어 있는 날에만 보이는 "가져오기". 한 번 누르면 그날의 계획이 그대로 들어옵니다. */}
                  {importSources.map((source) => (
                    <Button
                      key={source.date}
                      variant="secondary"
                      className="h-auto min-h-10 w-full py-2 break-keep"
                      onClick={() => handleImport(source.date)}
                    >
                      {source.label} 계획 가져오기 · {source.count}개
                    </Button>
                  ))}
                  {importSources.length > 0 && (
                    <p className="text-center text-sm break-keep text-slate-500">
                      완료 표시는 지워져서 들어와요. 가져온 뒤에 고치거나 지울 수 있어요.
                    </p>
                  )}
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {/* 계획 한 줄은 PlanRow 가 그립니다. (플래너 보기의 "시간 미정" 과 같이 씁니다) */}
                  {plans.map((plan) => (
                    <PlanRow
                      key={plan.id}
                      plan={plan}
                      subject={subjects.find((item) => item.id === plan.subjectId)}
                      sessions={allSessions}
                      isToday={isToday}
                      todayKey={todayKey}
                      onToggleDone={toggleDone}
                      onChangeStartTime={handleChangeStartTime}
                      onDelete={handleDelete}
                      calendarState={calendar.getPlanState(plan, todayKey)}
                      onAddToCalendar={calendar.addToCalendar}
                    />
                  ))}
                </ul>
              )}
              {/* 구글 캘린더에 실패했을 때의 안내. 앱의 계획은 실패와 상관없이 그대로입니다. (#316) */}
              {calendar.notice !== null && (
                <p role="status" className="mt-2 text-sm break-keep text-red-600">
                  {calendar.notice}
                </p>
              )}
            </Card>

            <PlanAddForm
              subjects={subjects}
              frequentPlans={frequentPlans}
              defaultWeekday={getWeekday(selectedDate)}
              onAdd={handleAdd}
            />
          </div>

          <RoutineList
            routines={routines}
            subjects={subjects}
            notice={routineNotice}
            onDelete={handleDeleteRoutine}
          />

          <SubjectManager
            subjects={subjects}
            onAdd={handleAddSubject}
            onDelete={handleDeleteSubject}
          />
        </>
      )}

      <GoalAdjustModal proposal={proposal} onAccept={accept} onDecline={decline} />
    </div>
  )
}
