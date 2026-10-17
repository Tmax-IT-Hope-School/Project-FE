import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { Button } from '@/components/ui/Button'
import { ChipButton } from '@/components/ui/ChipButton'
import { Modal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'
import { TermsView } from '@/components/ui/TermsView'
import { useAuth } from '@/hooks/useAuth'
import { useIsServerData } from '@/hooks/useIsServerData'
import { ApiError, getApiErrorMessage } from '@/lib/api'
import { CONSENT_REQUIRED_EVENT } from '@/lib/authStorage'
import {
  agreeToConsent,
  canAgree,
  consentStatusQuery,
  getConsentProblem,
  type ConsentChecks,
} from '@/lib/consentApi'
import { CONSENT_VERSION } from '@/lib/signup'
import { privacyConsent, serviceTerms, type TermsDocument } from '@/lib/terms'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface ConsentGateProps {
  children: ReactNode
}

/**
 * 최신 약관에 동의하지 않아 저장이 막혔을 때(서버의 403 CONSENT_REQUIRED) 다시 동의하는 팝업을 띄웁니다. (#512)
 * RequireAuth 가 로그인한 사람의 모든 화면을 이것으로 감쌉니다.
 *
 *   저장이 403 CONSENT_REQUIRED -> api.ts 가 창에 알림(CONSENT_REQUIRED_EVENT) -> 이 팝업이 뜸
 *   동의하면 팝업만 닫힙니다. 쓰던 화면과 입력한 글은 그대로라, 저장을 다시 누르면 됩니다.
 *
 * 다른 화면으로 옮기지 않고 팝업으로 띄우는 이유: 옮기면 쓰던 글이 사라지기 때문입니다.
 * 테스트 로그인은 서버를 부르지 않아서 이 팝업이 뜨지 않습니다.
 */
export function ConsentGate({ children }: ConsentGateProps) {
  const isServerData = useIsServerData()
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    function handleConsentRequired() {
      setIsOpen(true)
    }
    window.addEventListener(CONSENT_REQUIRED_EVENT, handleConsentRequired)
    return () => window.removeEventListener(CONSENT_REQUIRED_EVENT, handleConsentRequired)
  }, [])

  const handleClose = () => setIsOpen(false)

  return (
    <>
      {children}
      {isServerData && (
        <Modal isOpen={isOpen} onClose={handleClose} title="약관에 다시 동의해 주세요">
          <AsyncBoundary
            pendingFallback={<Skeleton className="h-48 w-full" />}
            errorMessage="동의 상태를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요."
          >
            <ConsentForm onClose={handleClose} />
          </AsyncBoundary>
        </Modal>
      )}
    </>
  )
}

interface ConsentFormProps {
  onClose: () => void
}

/** 동의 상태를 받아 와서, 상태에 맞는 안내나 동의 칸을 그립니다. 받아오는 부분이라 AsyncBoundary 안에서 씁니다. */
function ConsentForm({ onClose }: ConsentFormProps) {
  const { data: status } = useSuspenseQuery(consentStatusQuery())
  const queryClient = useQueryClient()
  const [checks, setChecks] = useState<ConsentChecks>({ terms: false, privacy: false })
  // 만 14세 이상인지. 아직 안 골랐으면 null, 네 = true, 아니요 = false
  const [isOver14, setIsOver14] = useState<boolean | null>(null)

  const agree = useMutation({
    mutationFn: agreeToConsent,
    // 동의한 뒤의 상태를 쿼리에 바로 넣습니다. (needsConsent 가 false 라 "동의했어요" 가 보임)
    onSuccess: (result) => queryClient.setQueryData(consentStatusQuery().queryKey, result),
    // 409 는 "이미 동의함" 이거나 "약관이 그새 바뀜" 입니다. 상태를 다시 받아서 어느 쪽인지 화면이 정합니다.
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: consentStatusQuery().queryKey })
      }
    },
  })

  const problem = getConsentProblem(status, CONSENT_VERSION)

  if (problem === 'none') {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm break-keep text-slate-700">
          {agree.isSuccess ? '동의했어요.' : '이미 최신 약관에 동의돼 있어요.'} 하던 화면에서 저장을
          다시 눌러 주세요.
        </p>
        <Button className="w-full" onClick={onClose}>
          확인
        </Button>
      </div>
    )
  }

  if (problem === 'app-outdated') {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm break-keep text-slate-700">
          약관이 새로 바뀌었어요. 화면을 새로 고치면 바뀐 약관이 보여요.
        </p>
        <Button className="w-full" onClick={() => window.location.reload()}>
          새로 고침
        </Button>
      </div>
    )
  }

  // 409 를 받았으면 상태를 다시 받는 중이라 그 에러 문장은 보여 주지 않습니다.
  const showError =
    agree.isError && !(agree.error instanceof ApiError && agree.error.status === 409)

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm break-keep text-slate-600">
        저장하려면 최신 약관에 동의해야 해요. 지금까지의 기록은 그대로 있어요.
      </p>

      <ul className="flex flex-col gap-2">
        <ConsentCheckRow
          label="[필수] 서비스 이용약관"
          terms={serviceTerms}
          checked={checks.terms}
          onChange={(checked) => setChecks({ ...checks, terms: checked })}
        />
        <ConsentCheckRow
          label="[필수] 개인정보 수집·이용"
          terms={privacyConsent}
          checked={checks.privacy}
          onChange={(checked) => setChecks({ ...checks, privacy: checked })}
        />
      </ul>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-slate-900">만 14세 이상인가요?</p>
        {/* 모바일은 위아래로, sm 부터 한 줄에 둡니다. */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <ChipButton selected={isOver14 === true} onClick={() => setIsOver14(true)}>
            네, 만 14세 이상이에요
          </ChipButton>
          <ChipButton selected={isOver14 === false} onClick={() => setIsOver14(false)}>
            아니요
          </ChipButton>
        </div>
      </div>

      {isOver14 === false ? (
        <UnderFourteenNotice onClose={onClose} />
      ) : (
        <Button
          className="w-full"
          disabled={!canAgree(checks, isOver14) || agree.isPending}
          onClick={() => agree.mutate(checks)}
        >
          {agree.isPending ? '보내는 중…' : '동의하고 계속하기'}
        </Button>
      )}

      {showError && (
        <p role="alert" className="text-sm break-keep text-red-600">
          {getApiErrorMessage(agree.error)}
        </p>
      )}

      <LeaveLinks onClose={onClose} />
    </div>
  )
}

interface ConsentCheckRowProps {
  label: string
  terms: TermsDocument
  checked: boolean
  onChange: (checked: boolean) => void
}

/** 동의 칸 한 줄. [보기] 를 누르면 약관 전문이 아래에 펼쳐집니다. (팝업 위에 팝업을 또 띄우지 않으려고) */
function ConsentCheckRow({ label, terms, checked, onChange }: ConsentCheckRowProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <li className="rounded-lg border border-slate-200">
      <div className="flex items-center justify-between gap-2 px-3">
        <label className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-3 py-2">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
            className="accent-brand h-5 w-5 shrink-0"
          />
          <span className="text-sm break-keep text-slate-900">{label}</span>
        </label>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          className="h-10 shrink-0 px-2 text-sm text-slate-500 underline hover:text-slate-700"
        >
          {isOpen ? '접기' : '보기'}
        </button>
      </div>
      {isOpen && (
        // 약관이 길어서 이 칸 안에서만 스크롤되게 합니다.
        <div className="max-h-60 overflow-y-auto border-t border-slate-200 p-3">
          <TermsView terms={terms} />
        </div>
      )}
    </li>
  )
}

interface CloseProps {
  onClose: () => void
}

/** 만 14세 미만이라고 고르면 동의 버튼 대신 보이는 안내입니다. (가입 화면의 안내와 같은 내용) */
function UnderFourteenNotice({ onClose }: CloseProps) {
  return (
    <div role="status" className="flex flex-col gap-1 rounded-lg bg-slate-50 p-3">
      <p className="font-medium break-keep text-slate-900">지금은 만 14세 이상만 쓸 수 있어요</p>
      <p className="text-sm break-keep text-slate-600">
        보호자 동의 기능을 준비하고 있어요. 지금까지의 기록은{' '}
        <Link to="/settings/account" onClick={onClose} className="text-brand underline">
          설정 › 내 계정
        </Link>{' '}
        에서 탈퇴하면 모두 지워져요.
      </p>
    </div>
  )
}

/** 동의하지 않아도 나갈 수 있는 길: 로그아웃 · 탈퇴 (서버도 이 둘은 동의 없이 받아 줍니다) */
function LeaveLinks({ onClose }: CloseProps) {
  const { logout } = useAuth()

  const handleLogout = () => {
    onClose()
    // 로그아웃하면 RequireAuth 가 알아서 로그인 화면으로 보냅니다.
    logout()
  }

  return (
    <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
      <button type="button" onClick={handleLogout} className="h-10 px-2 underline">
        로그아웃
      </button>
      <span aria-hidden>·</span>
      <Link
        to="/settings/account"
        onClick={onClose}
        className="flex h-10 items-center px-2 underline"
      >
        탈퇴하기
      </Link>
    </div>
  )
}
