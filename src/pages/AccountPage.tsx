import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { LeaveAccountSection } from '@/components/ui/LeaveAccountSection'
import { SchoolField } from '@/components/ui/SchoolField'
import { Skeleton } from '@/components/ui/Skeleton'
import { useAuth } from '@/hooks/useAuth'
import { getAccountErrorMessage, profileQuery, updateProfile, type Profile } from '@/lib/accountApi'
import type { School } from '@/lib/schoolSearch'
import {
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  getNicknameError,
  updateSavedSignupProfile,
} from '@/lib/signup'
import { testUser } from '@/lib/testLogin'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

/**
 * 내 계정 화면입니다. 설정의 계정 카드에서 들어옵니다. (주소 /settings/account · #296)
 *   내 정보 고치기 · 탈퇴
 * 계정은 모두 구글 계정이라 비밀번호가 없습니다. 그래서 비밀번호 바꾸기는 없고, 탈퇴는 구글로 한 번 더 확인합니다.
 *
 * 내 정보는 서버에서 받아옵니다. 받아오는 동안에는 스켈레톤, 실패하면 안내를 AsyncBoundary 가 보여줍니다.
 * 테스트 로그인으로 들어온 사람은 서버에 계정이 없어서, 서버를 부르지 않고 안내만 보여줍니다.
 */
export function AccountPage() {
  const { user } = useAuth()
  // 테스트 로그인으로 들어온 사람인지. (lib/testLogin.ts)
  const isTestUser = user?.id === testUser.id

  return (
    <div className="flex flex-col gap-6">
      <div>
        {/* h-11 = 44px: 손가락으로 누르기 쉬운 높이.
            이 화면은 헤더에 ‹ 뒤로를 두지 않고 이 링크로 설정에 돌아갑니다. (2026-10-22) */}
        <Link
          to="/settings"
          className="text-brand mb-2 inline-flex h-11 items-center gap-1 text-sm font-medium hover:underline"
        >
          <span aria-hidden>‹</span> 설정
        </Link>
        <h1 className="text-[28px] leading-snug font-bold tracking-tight sm:text-3xl">내 계정</h1>
        <p className="mt-1 text-[15px] break-keep text-slate-500">
          내 정보를 고치고, 탈퇴할 수 있어요.
        </p>
      </div>

      {isTestUser ? (
        <Card title="테스트 계정이에요">
          <p className="text-sm break-keep text-slate-600">
            테스트 계정은 서버에 계정이 없어서 고칠 정보가 없어요. 처음 화면부터 다시 보고 싶으면
            아래 [처음부터 다시 하기] 를 눌러 주세요.
          </p>
          <LeaveAccountSection isTestUser className="mt-4" />
        </Card>
      ) : (
        <AsyncBoundary
          pendingFallback={<AccountSkeleton />}
          errorMessage="내 정보를 받아오지 못했어요. 잠시 후 다시 시도해 주세요."
        >
          <AccountSections />
        </AsyncBoundary>
      )}
    </div>
  )
}

/** 내 정보를 받아오는 동안 보여주는 자리 표시입니다. 카드 두 장의 대략적인 높이로 그립니다. */
function AccountSkeleton() {
  return (
    // role="status": "받아오는 중" 이라는 것을 스크린리더에도 알려 줍니다. (회색 상자는 읽지 않습니다)
    <div role="status" className="flex flex-col gap-6">
      <span className="sr-only">내 정보를 받아오는 중이에요</span>
      <Skeleton className="h-96 w-full rounded-2xl" />
      <Skeleton className="h-32 w-full rounded-2xl" />
    </div>
  )
}

/**
 * 서버에서 내 정보를 받아와서 카드 두 장을 보여줍니다.
 * useSuspenseQuery 는 받아오는 동안 이 컴포넌트를 "잠깐 멈춰" 둡니다. 그래서 여기서는 data 가 있을 때만 그리면 됩니다.
 */
function AccountSections() {
  const { data: profile } = useSuspenseQuery(profileQuery())

  return (
    <>
      <ProfileCard profile={profile} />
      {/* 탈퇴는 설정의 계정 묶음과 같은 부품입니다. (components/ui/LeaveAccountSection.tsx) */}
      <Card title="탈퇴">
        <LeaveAccountSection isTestUser={false} />
      </Card>
    </>
  )
}

interface ProfileCardProps {
  /** 서버에서 받아온 지금의 내 정보. 입력 칸의 처음 값으로 씁니다. */
  profile: Profile
}

/**
 * 내 정보(닉네임 · 학교 · 일기 분석 동의)를 고치는 카드입니다. 이메일은 보여주기만 합니다.
 * 실명은 서버가 받지 않아서(BE #71, 실명을 모으지 않기로 함) 고치는 칸을 두지 않습니다.
 */
function ProfileCard({ profile }: ProfileCardProps) {
  const queryClient = useQueryClient()
  const { user, token, login } = useAuth()

  // 고치는 중인 값입니다. 받아온 값을 그대로 보여주는 것이 아니라 "입력 칸의 상태" 라서 따로 둡니다.
  const [nickname, setNickname] = useState(profile.nickname)
  const [school, setSchool] = useState<School | null>(
    // 서버는 학교의 번호와 이름만 가지고 있습니다. 주소는 없어서 빈 글자로 둡니다.
    profile.schoolCode !== null && profile.schoolName !== null
      ? { code: profile.schoolCode, name: profile.schoolName, region: '', address: '' }
      : null,
  )
  const [diaryAnalysis, setDiaryAnalysis] = useState(profile.diaryAnalysis)
  // 저장에 성공했는지. 성공 안내를 보여주고, 값을 다시 고치기 시작하면 지웁니다.
  const [isSaved, setIsSaved] = useState(false)

  const nicknameError = getNicknameError(nickname)

  // useMutation: 서버의 값을 "바꾸는" 요청에 씁니다. isPending(보내는 중)과 error(실패)를 대신 관리해 줍니다. (docs/DATA-FETCHING.md 5장)
  const mutation = useMutation({
    mutationFn: updateProfile,
    onSuccess: (updated) => {
      // 보관해 둔 내 정보를 "낡았다" 고 표시해서 다시 받아오게 합니다.
      void queryClient.invalidateQueries({ queryKey: profileQuery().queryKey })
      // 이 기기에 저장해 둔 가입 정보와 로그인한 사람의 이름도 맞춥니다. (설정의 계정 카드가 이 값을 보여줍니다)
      updateSavedSignupProfile({ nickname: updated.nickname, school })
      if (user !== null && token !== null) login({ ...user, name: updated.nickname }, token)
      setIsSaved(true)
    },
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // form 이 기본으로 하는 "페이지 새로고침" 을 막습니다.
    event.preventDefault()
    if (nicknameError !== null || mutation.isPending) return
    setIsSaved(false)
    mutation.mutate({
      // 예전 서버와 맞추려고 자리만 남긴 값입니다. 서버는 읽지 않고 버립니다.
      name: profile.name,
      nickname: nickname.trim(),
      schoolCode: school?.code ?? null,
      schoolName: school?.name ?? null,
      diaryAnalysis,
    })
  }

  return (
    <Card title="내 정보">
      {/* noValidate: 브라우저의 기본 안내 풍선 대신, 아래의 우리 안내 문구를 씁니다. */}
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-slate-700">이메일</p>
          {/* break-all: 긴 이메일이 화면 밖으로 나가지 않게 줄바꿈합니다. */}
          <p className="text-base break-all text-slate-900">{profile.email}</p>
          <p className="text-sm break-keep text-slate-500">
            로그인에 쓰는 구글 계정 주소라서 바꿀 수 없어요.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Input
            id="account-nickname"
            label="닉네임"
            value={nickname}
            maxLength={NICKNAME_MAX_LENGTH}
            autoComplete="nickname"
            error={nicknameError ?? undefined}
            onChange={(event) => {
              setNickname(event.target.value)
              setIsSaved(false)
            }}
            className="h-12 text-base"
          />
          <p className="text-sm text-slate-500">
            앱에서 부르는 이름이에요. ({NICKNAME_MIN_LENGTH}~{NICKNAME_MAX_LENGTH}자)
          </p>
        </div>

        <SchoolField
          school={school}
          onChange={(next) => {
            setSchool(next)
            setIsSaved(false)
          }}
        />

        {/* 선택 동의는 언제든 켜고 끌 수 있어야 합니다. min-h-12: 줄 전체가 누르는 영역입니다. 스위치 모양은 index.css 의 .switch */}
        <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <span className="flex min-w-0 flex-col">
            <span className="text-[15px] font-semibold text-slate-900">
              일기·감정 기록을 분석에 쓰기 (선택)
            </span>
            <span className="text-[13px] break-keep text-slate-500">
              끄면 일기와 기분은 나만 보고, 분석에는 쓰지 않아요.
            </span>
          </span>
          <input
            type="checkbox"
            checked={diaryAnalysis}
            onChange={(event) => {
              setDiaryAnalysis(event.target.checked)
              setIsSaved(false)
            }}
            aria-label="일기·감정 기록을 분석에 쓰기"
            className="switch shrink-0"
          />
        </label>

        {/* role="alert": 안내가 뜨면 스크린리더가 바로 읽어 줍니다. */}
        {mutation.isError && (
          <p role="alert" className="text-sm break-keep text-red-600">
            {getAccountErrorMessage(mutation.error)}
          </p>
        )}
        {isSaved && (
          <p role="status" className="text-sm font-medium break-keep text-emerald-700">
            저장했어요.
          </p>
        )}

        <Button
          type="submit"
          size="lg"
          className="w-full sm:w-auto sm:self-end"
          disabled={nicknameError !== null || mutation.isPending}
        >
          {mutation.isPending ? '저장하는 중…' : '저장'}
        </Button>
      </form>
    </Card>
  )
}
