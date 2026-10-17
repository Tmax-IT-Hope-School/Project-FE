import { PlainLayout } from '@/components/layout/PlainLayout'
import { Button } from '@/components/ui/Button'
import { OnboardingExitButton } from '@/components/ui/OnboardingExitButton'
import { SubjectBadge } from '@/components/ui/SubjectBadge'
import { cn } from '@/lib/cn'
import { getTodayKey } from '@/lib/date'
import {
  DAILY_HOUR_OPTIONS,
  DAYS_PER_WEEK_OPTIONS,
  INITIAL_PLAN_KEY,
  INITIAL_ROUTINE_PREFIX,
  createRoutineDraft,
  loadInitialPlan,
} from '@/lib/initialPlan'
import { loadOnboardingAnswers } from '@/lib/onboardingSteps'
import { useSubjects } from '@/hooks/useSubjects'
import { ROUTINES_KEY, formatWeekdays, loadRoutines, markRoutinesFilled } from '@/lib/routines'
import { saveData } from '@/lib/storage'
import type { InitialPlan } from '@/types'
import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'

// 처음에 골라 두는 값
const DEFAULT_DAILY_HOURS = 3
const DEFAULT_DAYS_PER_WEEK = 5
// 처음에 골라 두는 과목 수 (앞에서부터)
const DEFAULT_SUBJECT_COUNT = 3

/**
 * 하루 목표의 처음 값을 정합니다. 온보딩에서 답한 "하루에 공부할 수 있는 시간" 이 있으면 그 값으로 시작합니다.
 * (같은 것을 두 번 묻지 않으려고 미리 골라 둡니다. 여기서 바꿀 수 있습니다)
 */
function getDefaultDailyHours(): number {
  const answers = loadOnboardingAnswers()
  const hours = Math.round(Number(answers?.dailyAvailableMinutes) / 60)
  return DAILY_HOUR_OPTIONS.includes(hours) ? hours : DEFAULT_DAILY_HOURS
}

/** 고르는 버튼(알약 모양)의 클래스. h-10 으로 누르는 높이를 40px 로 둡니다. */
function pillClass(isSelected: boolean): string {
  return cn(
    'h-10 cursor-pointer rounded-full border-2 px-4 text-sm font-medium transition-colors',
    isSelected
      ? 'border-brand bg-brand-light text-brand'
      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
  )
}

/**
 * 처음 계획을 세우는 화면입니다. (주소: /onboarding/plan) (#240)
 * 온보딩 질문이 끝난 뒤, "준비 끝" 화면 앞에 나옵니다.
 *
 * 하루 목표 · 주당 일수 · 과목을 버튼으로 고르면 첫 주 루틴 초안을 바로 보여주고,
 * [이대로 시작] 을 누르면 루틴과 "처음 계획"(이때의 약속)을 저장합니다.
 *
 * - 처음 계획은 한 번만 세웁니다. 이미 있으면 이 화면을 건너뜁니다.
 * - 설정의 "다시 세우기" 로 들어오면(주소 끝에 ?redo=1) 다시 세울 수 있습니다.
 *   이때는 전에 처음 계획이 만든 루틴만 새 초안으로 바꾸고, 내가 직접 만든 루틴과 오늘 계획은 그대로 둡니다.
 */
export function OnboardingPlanPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // 설정의 "다시 세우기" 로 들어왔는지
  const isRedo = searchParams.get('redo') === '1'
  // 이미 세운 처음 계획. 없으면 null 입니다.
  const [savedPlan] = useState(loadInitialPlan)
  // 계획 화면에서 저장한 과목 목록 (저장된 게 없으면 예시 과목)
  const subjects = useSubjects()

  const [dailyHours, setDailyHours] = useState(getDefaultDailyHours)
  const [daysPerWeek, setDaysPerWeek] = useState(DEFAULT_DAYS_PER_WEEK)
  // 고른 과목의 id 들. 앞의 과목 3개를 미리 골라 둡니다.
  const [subjectIds, setSubjectIds] = useState<string[]>(() =>
    subjects.slice(0, DEFAULT_SUBJECT_COUNT).map((subject) => subject.id),
  )

  // 처음 계획은 한 번만 세웁니다. 이미 있으면 "준비 끝" 으로 넘깁니다. (다시 세우기는 예외)
  if (savedPlan !== null && !isRedo) return <Navigate to="/onboarding/done" replace />

  // 끝나고 갈 곳: 온보딩 중이면 "준비 끝", 설정에서 왔으면 설정
  const exitPath = isRedo ? '/settings' : '/onboarding/done'
  const dailyMinutes = dailyHours * 60
  // 과목 목록의 순서대로 고른 과목만 남깁니다.
  const selectedSubjects = subjects.filter((subject) => subjectIds.includes(subject.id))
  // 화면에 보여줄 초안. 버튼을 바꿀 때마다 다시 만들어집니다. (lib/initialPlan.ts)
  const draft = createRoutineDraft(selectedSubjects, dailyMinutes, daysPerWeek, 0)

  function handleToggleSubject(subjectId: string) {
    // 이미 골랐으면 빼고, 아니면 더합니다.
    setSubjectIds((prev) =>
      prev.includes(subjectId) ? prev.filter((id) => id !== subjectId) : [...prev, subjectId],
    )
  }

  function handleStart() {
    const now = Date.now()
    const todayKey = getTodayKey()
    const newRoutines = createRoutineDraft(selectedSubjects, dailyMinutes, daysPerWeek, now)

    // 전에 처음 계획이 만든 루틴은 빼고(다시 세울 때), 내가 직접 만든 루틴은 그대로 둡니다.
    const keptRoutines = loadRoutines().filter(
      (routine) => !routine.id.startsWith(INITIAL_ROUTINE_PREFIX),
    )
    saveData(ROUTINES_KEY, [...keptRoutines, ...newRoutines])

    const initialPlan: InitialPlan = { createdDate: todayKey, dailyMinutes, daysPerWeek }
    saveData(INITIAL_PLAN_KEY, initialPlan)

    // 다시 세울 때는 오늘 계획을 건드리지 않습니다. 새 루틴은 "오늘은 이미 넣었다" 고 적어 두어서 내일부터 들어옵니다.
    // (처음 세울 때는 적지 않아서, 홈을 열면 오늘 요일의 루틴이 오늘 계획에 바로 들어옵니다)
    if (isRedo) {
      markRoutinesFilled(
        todayKey,
        newRoutines.map((routine) => routine.id),
      )
    }

    // 처음 세웠을 때는 "준비 끝" 으로, 다시 세울 때는 설정으로 돌아갑니다.
    // ("처음의 나에게 한마디"(#241)는 가입 직후 맨 처음에 이미 지나왔습니다)
    navigate(exitPath)
  }

  return (
    <PlainLayout
      headerAction={
        // 처음 세울 때는 온보딩의 마지막 단계라 건너뛸 수 없어서 "나중에 하기" 대신 "로그인 화면으로" 를 둡니다. 답은 남아서 다음에 이어 할 수 있습니다. (RequireAuth)
        isRedo ? (
          // h-10 = 40px. 글자는 작아도 누르는 영역은 손가락으로 누를 만하게 합니다.
          <Link
            to={exitPath}
            className="text-brand inline-flex h-10 items-center text-sm font-medium underline"
          >
            그만하고 설정으로
          </Link>
        ) : (
          <OnboardingExitButton />
        )
      }
    >
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <div>
          <p className="text-brand text-sm font-semibold">처음 계획</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight break-keep sm:text-3xl">
            {isRedo ? '처음 계획을 다시 세워 볼까?' : '처음 계획을 세워 볼까?'}
          </h1>
          <p className="mt-2 text-sm break-keep text-slate-600 sm:text-base">
            지금의 약속이 나중에 &quot;처음의 나&quot; 가 돼요. 루틴은 언제든 바꿀 수 있어요.
          </p>
        </div>

        <div role="group" aria-label="하루에 얼마나 할까?" className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-slate-900">하루에 얼마나 할까?</span>
          {/* flex-wrap: 좁은 화면에서는 버튼이 다음 줄로 내려갑니다. */}
          <div className="flex flex-wrap gap-2">
            {DAILY_HOUR_OPTIONS.map((hours) => (
              <button
                key={hours}
                type="button"
                aria-pressed={hours === dailyHours}
                onClick={() => setDailyHours(hours)}
                className={pillClass(hours === dailyHours)}
              >
                {hours}시간
              </button>
            ))}
          </div>
        </div>

        <div role="group" aria-label="일주일에 며칠?" className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-slate-900">일주일에 며칠?</span>
          <div className="flex flex-wrap gap-2">
            {DAYS_PER_WEEK_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                aria-pressed={days === daysPerWeek}
                onClick={() => setDaysPerWeek(days)}
                className={pillClass(days === daysPerWeek)}
              >
                {days}일
              </button>
            ))}
          </div>
        </div>

        <div role="group" aria-label="어떤 과목?" className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-slate-900">어떤 과목?</span>
          <div className="flex flex-wrap gap-2">
            {subjects.map((subject) => {
              const isSelected = subjectIds.includes(subject.id)
              return (
                <button
                  key={subject.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => handleToggleSubject(subject.id)}
                  className={pillClass(isSelected)}
                >
                  {subject.name}
                </button>
              )
            })}
          </div>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h2 className="text-base font-semibold text-slate-900">첫 주 루틴 초안</h2>
            <p className="text-sm text-slate-500">
              하루 {dailyHours}시간 × 주 {daysPerWeek}일 = 주 {dailyHours * daysPerWeek}시간
            </p>
          </div>

          {draft.length === 0 ? (
            <p className="mt-3 text-sm break-keep text-slate-500">
              과목을 하나 이상 고르면 초안을 만들어 줄게요.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {draft.map((routine) => {
                const subject = subjects.find((item) => item.id === routine.subjectId)
                return (
                  <li key={routine.id} className="flex items-center gap-2 py-3 text-sm">
                    <span className="shrink-0 font-semibold text-slate-900">
                      {formatWeekdays(routine.weekdays)}
                    </span>
                    {subject && (
                      <SubjectBadge
                        name={subject.name}
                        color={subject.color}
                        className="shrink-0"
                      />
                    )}
                    {/* min-w-0 + break-words: 과목 이름이 길어도 가로 스크롤이 생기지 않게 합니다. */}
                    <span className="min-w-0 flex-1 break-words text-slate-900">
                      {routine.content}
                    </span>
                    <span className="shrink-0 text-slate-500 tabular-nums">
                      {routine.targetMinutes}분
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* 과목을 하나도 안 고르면 루틴을 만들 수 없어서 눌리지 않습니다. */}
        <Button size="lg" className="w-full" disabled={draft.length === 0} onClick={handleStart}>
          이대로 시작
        </Button>

        <p className="text-center text-sm break-keep text-slate-500">
          {isRedo
            ? '처음 계획이 만든 루틴만 새 초안으로 바뀌어요. 직접 만든 루틴과 오늘 계획은 그대로예요.'
            : '처음 계획은 따로 기억해 두었다가, 나중에 지금과 비교해서 보여줄게요.'}
        </p>
      </div>
    </PlainLayout>
  )
}
