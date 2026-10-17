import { AsyncBoundary } from '@/components/ui/AsyncBoundary'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { getSchoolQueryError, schoolSearchQuery, type School } from '@/lib/schoolSearch'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState, type KeyboardEvent } from 'react'

interface SchoolFieldProps {
  /** 지금 골라 둔 학교. 아직 안 골랐으면 null */
  school: School | null
  /** 학교를 골랐을 때(School) 또는 고른 것을 취소했을 때(null) */
  onChange: (school: School | null) => void
}

/**
 * 고등학교를 검색해서 하나 고르는 칸입니다. (검색은 lib/schoolSearch.ts)
 * 가입 화면(pages/SignupPage.tsx)과 내 계정 화면(pages/AccountPage.tsx)이 같이 씁니다.
 *   아직 안 골랐으면 -> 검색어 칸 + "검색" 버튼 + 결과 목록
 *   골랐으면         -> 고른 학교 + "바꾸기" 버튼
 *
 * 결과를 받아오는 일은 아래의 SchoolResults 가 합니다. 이 컴포넌트는 "무엇을 찾을지" 만 정합니다.
 */
export function SchoolField({ school, onChange }: SchoolFieldProps) {
  // 입력 칸에 적고 있는 글자
  const [query, setQuery] = useState('')
  // "검색" 을 눌러 확정한 검색어. 이 값이 정해지면 SchoolResults 가 그 검색어로 받아옵니다. 아직 검색 전이면 null
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null)
  // 검색어가 너무 짧을 때 보여줄 안내. 없으면 null
  const [queryError, setQueryError] = useState<string | null>(null)
  // "검색" 을 누른 횟수. 같은 글자로 다시 눌러도 값이 바뀌어서, 실패 안내를 지우고 새로 받아오게 합니다.
  const [searchCount, setSearchCount] = useState(0)

  function handleSearch() {
    const error = getSchoolQueryError(query)
    setQueryError(error)
    // 검색어가 규칙에 맞을 때만 확정합니다. 안 맞으면 결과 자리를 비웁니다.
    setSubmittedQuery(error === null ? query : null)
    setSearchCount((count) => count + 1)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    // 이 칸은 form 안에서 쓰여서, 그냥 두면 Enter 가 "form 제출" 이 됩니다. 검색으로 바꿉니다.
    event.preventDefault()
    // 한글은 글자를 조합하는 중에도 Enter 가 한 번 들어옵니다. 조합이 끝난 Enter 에만 검색합니다.
    if (event.nativeEvent.isComposing) return
    handleSearch()
  }

  if (school !== null) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium text-slate-700">고등학교</p>
        <div className="border-brand bg-brand-light flex items-center justify-between gap-3 rounded-xl border-2 px-4 py-3">
          {/* min-w-0: 긴 학교 이름·주소가 "바꾸기" 버튼을 밀어내지 않고 줄바꿈되게 합니다. */}
          <div className="min-w-0">
            <p className="font-semibold break-keep text-slate-900">{school.name}</p>
            {/* 서버에서 받아온 학교는 이름만 있고 주소가 없습니다. 주소가 없으면 이 줄을 그리지 않습니다. */}
            {(school.address || school.region) && (
              <p className="text-sm break-keep text-slate-600">{school.address || school.region}</p>
            )}
          </div>
          <Button variant="secondary" className="shrink-0" onClick={() => onChange(null)}>
            바꾸기
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {/* items-end: 라벨이 붙은 입력 칸과 버튼의 아래쪽을 맞춥니다. */}
      <div className="flex items-end gap-2">
        <Input
          id="school"
          label="고등학교 (선택)"
          value={query}
          placeholder="예) IT희망학교"
          // 검색어를 적는 칸이라 브라우저의 자동 완성(예전에 적은 값 추천)은 끕니다.
          autoComplete="off"
          // 휴대폰 키보드의 Enter 자리에 "검색" 이 보이게 합니다.
          enterKeyHint="search"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          className="h-12 text-base"
        />
        <Button variant="secondary" size="lg" className="shrink-0 px-4" onClick={handleSearch}>
          검색
        </Button>
      </div>
      <p className="text-sm break-keep text-slate-500">
        학교 이름의 일부만 적고 검색해도 돼요. 졸업했거나 목록에 없으면 비워 두세요.
      </p>

      {/* role="alert": 안내가 뜨면 스크린리더가 바로 읽어 줍니다. */}
      {queryError !== null && (
        <p role="alert" className="text-sm break-keep text-red-600">
          {queryError}
        </p>
      )}

      {/*
        받아오는 동안에는 스켈레톤, 실패하면 안내와 "다시 시도" 를 AsyncBoundary 가 대신 보여줍니다.
        resetKeys: 실패한 뒤 다른 검색어로 찾거나, 같은 검색어로 "검색" 을 다시 눌러도 실패 안내를 지우고 새로 받아옵니다.
      */}
      {submittedQuery !== null && (
        <AsyncBoundary
          pendingFallback={<SchoolResultsSkeleton />}
          errorMessage="학교를 검색하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요."
          resetKeys={[submittedQuery, searchCount]}
        >
          <SchoolResults query={submittedQuery} onSelect={onChange} />
        </AsyncBoundary>
      )}
    </div>
  )
}

interface SchoolResultsProps {
  /** 찾을 검색어 */
  query: string
  /** 목록에서 학교를 눌렀을 때 */
  onSelect: (school: School) => void
}

/**
 * 검색어로 학교를 받아와서 목록으로 보여줍니다.
 *
 * useSuspenseQuery 는 받아오는 동안 이 컴포넌트를 "잠깐 멈춰" 둡니다. 그동안 바깥의 AsyncBoundary 가 스켈레톤을 보여주고,
 * 실패하면 안내를 보여줍니다. 그래서 여기서는 로딩 중·실패를 if 로 나누지 않고, data 가 "있을 때" 만 그리면 됩니다.
 * 같은 검색어를 다시 찾으면 보관해 둔 결과를 바로 씁니다. (lib/schoolSearch.ts 의 schoolSearchQuery)
 */
function SchoolResults({ query, onSelect }: SchoolResultsProps) {
  const { data: result } = useSuspenseQuery(schoolSearchQuery(query))

  return (
    // aria-live: 검색 결과가 나오면 스크린리더가 알려 줍니다.
    <div aria-live="polite" className="flex flex-col gap-2">
      {result.schools.length === 0 ? (
        <p className="text-sm break-keep text-slate-600">
          찾은 고등학교가 없어요. 줄임말 대신 학교 이름의 일부를 적어 보세요. (예: 디미고 →
          디지털미디어)
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {result.schools.map((item) => (
            <li key={item.code}>
              {/* min-h-14 = 56px. 주소가 두 줄이 되어도 버튼이 같이 커집니다. */}
              <button
                type="button"
                onClick={() => onSelect(item)}
                className="hover:border-brand flex min-h-14 w-full cursor-pointer flex-col items-start justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-left"
              >
                <span className="font-medium break-keep text-slate-900">{item.name}</span>
                <span className="text-sm break-keep text-slate-500">
                  {item.address || item.region}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* 인증키 없이는 5곳까지만 받을 수 있어서, 더 있으면 알려 줍니다. */}
      {result.totalCount > result.schools.length && (
        <p className="text-sm break-keep text-slate-500">
          {result.totalCount}곳 중 {result.schools.length}곳만 보여요. 이름을 더 자세히 적으면 찾기
          쉬워요.
        </p>
      )}
    </div>
  )
}

/** 학교 목록을 받아오는 동안 보여주는 자리 표시입니다. 진짜 목록의 한 줄(56px)과 같은 높이로 3줄을 그립니다. */
function SchoolResultsSkeleton() {
  return (
    // role="status": "찾는 중" 이라는 것을 스크린리더에도 알려 줍니다. (회색 상자는 읽지 않습니다)
    <div role="status" className="flex flex-col gap-2">
      <span className="sr-only">학교를 찾는 중이에요</span>
      <Skeleton className="h-14 w-full rounded-xl" />
      <Skeleton className="h-14 w-full rounded-xl" />
      <Skeleton className="h-14 w-full rounded-xl" />
    </div>
  )
}
