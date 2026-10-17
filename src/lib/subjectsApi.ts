/**
 * 과목을 서버(BE)에서 받아오고, 추가·수정·삭제하는 함수들입니다. (#201)
 * 화면은 아직 이 함수를 쓰지 않습니다. (과목 화면들은 지금 localStorage 의 loadSubjects 를 씁니다. lib/subjects.ts)
 * 화면을 서버 과목으로 옮길 때 이 파일의 subjectsQuery · createSubject · updateSubject · deleteSubject 를 씁니다.
 *
 * 서버와 정한 약속입니다. (BE 저장소의 docs/API.md "과목", BE 이슈 #10) 전부 로그인이 필요합니다.
 *   내 과목 목록  GET    /subjects                                      -> 200 Subject[] (만든 순서, 없으면 [])
 *   과목 추가     POST   /subjects        { name, color }               -> 201 Subject
 *   이름·색 바꾸기 PATCH  /subjects/:id    { name? , color? }            -> 200 Subject (바꿀 것만 보냄)
 *   과목 삭제     DELETE /subjects/:id                                  -> 204
 *   실패          400 값이 틀림 · 401 로그인 풀림 · 404 없는 과목(남의 과목 포함)
 *                 409 같은 이름이 있음 / 계획이나 공부 기록이 있는 과목을 지움
 *   서버가 준 message 는 사람이 읽는 한국어 문장이라 화면에 그대로 보여줘도 됩니다. (getApiErrorMessage)
 */
import { ApiError, api } from '@/lib/api'
import { shouldRetryQuery } from '@/lib/queryRetry'
import { SUBJECT_COLORS } from '@/lib/subjects'
import { queryOptions, type QueryClient } from '@tanstack/react-query'
import type { Subject, SubjectColor } from '@/types'

/** 서버 응답을 기다리는 최대 시간(밀리초). 서버가 멈춰도 로딩이 영원히 끝나지 않으면 안 되기 때문입니다. */
const REQUEST_TIMEOUT_MS = 10000

/** 서버가 받는 과목 색. FE 가 쓰는 색(SUBJECT_COLORS)과 같은 5가지입니다. */
export const SERVER_SUBJECT_COLORS: SubjectColor[] = SUBJECT_COLORS

/** 서버가 받는 과목 이름의 최대 글자 수 (앞뒤 공백을 지운 뒤 1 ~ 30자) */
export const SUBJECT_NAME_MAX_LENGTH = 30

/** 과목을 추가할 때 서버에 보내는 값 */
export interface SubjectCreateInput {
  name: string
  color: SubjectColor
}

/** 과목을 고칠 때 서버에 보내는 값. 바꿀 것만 적습니다. (둘 다 비면 보내지 않고 에러입니다) */
export type SubjectUpdateInput = Partial<SubjectCreateInput>

/** 서버가 준 값이 과목 모양(id · name · color)이 맞는지 확인합니다. (서버 응답도 그대로 믿지 않고 확인합니다) */
function isSubject(value: unknown): value is Subject {
  if (typeof value !== 'object' || value === null) return false
  const subject = value as Record<string, unknown>
  return (
    typeof subject.id === 'string' &&
    typeof subject.name === 'string' &&
    SUBJECT_COLORS.includes(subject.color as SubjectColor)
  )
}

/** 502: 서버가 이상한 응답을 줬다는 뜻으로 씁니다. */
function badResponse(): ApiError {
  return new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
}

async function fetchSubjects(): Promise<Subject[]> {
  const result = await api<unknown>('/subjects', {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!Array.isArray(result) || !result.every(isSubject)) throw badResponse()
  return result
}

/**
 * 내 과목 목록의 쿼리 설정입니다. 화면에서는 useSuspenseQuery(subjectsQuery()) 로 받아옵니다. (docs/DATA-FETCHING.md)
 * queryKey 에 사람을 구분하는 값이 없는 이유: 로그인한 사람의 것 하나뿐이고, 로그아웃할 때 보관함에서 지우기 때문입니다.
 */
export function subjectsQuery() {
  return queryOptions({
    queryKey: ['subjects'],
    queryFn: fetchSubjects,
    // 일시적인 문제(연결 끊김 · 시간 초과 · 서버 5xx)만 최대 2번 다시 시도하고, 400 · 404 같은 거절은 다시 시도하지 않습니다. (lib/queryRetry.ts)
    retry: shouldRetryQuery,
  })
}

/** 과목을 추가하고, 서버가 만든 과목(id 가 붙어 있음)을 돌려줍니다. 실패하면 에러를 던집니다. (같은 이름이 있으면 409) */
export async function createSubject(input: SubjectCreateInput): Promise<Subject> {
  const result = await api<unknown>('/subjects', {
    method: 'POST',
    body: JSON.stringify({ name: input.name, color: input.color }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!isSubject(result)) throw badResponse()
  return result
}

/**
 * 과목의 이름이나 색을 바꾸고, 바뀐 과목을 돌려줍니다. 실패하면 에러를 던집니다.
 * 바꿀 것만 서버에 보냅니다. 이름도 색도 없으면 서버를 부르지 않고 400 에러를 던집니다.
 *
 *   updateSubject('3', { name: '국어' })               -> PATCH /subjects/3  { "name": "국어" }
 *   updateSubject('3', { color: 'red' })               -> PATCH /subjects/3  { "color": "red" }
 *   updateSubject('3', { name: '국어', color: 'red' }) -> PATCH /subjects/3  { "name": "국어", "color": "red" }
 *   updateSubject('3', {})                             -> 서버를 부르지 않고 ApiError(400)
 */
export async function updateSubject(id: string, input: SubjectUpdateInput): Promise<Subject> {
  const body: SubjectUpdateInput = {}
  if (input.name !== undefined) body.name = input.name
  if (input.color !== undefined) body.color = input.color
  if (Object.keys(body).length === 0) {
    throw new ApiError('바꿀 이름이나 색을 정해 주세요', 400, 'VALIDATION_ERROR')
  }

  const result = await api<unknown>(`/subjects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!isSubject(result)) throw badResponse()
  return result
}

/**
 * 과목을 지웁니다. 실패하면 에러를 던집니다.
 * 계획이나 공부 기록이 있는 과목은 서버가 409 로 막습니다. (message 를 그대로 보여주면 됩니다)
 */
export async function deleteSubject(id: string): Promise<void> {
  await api<void>(`/subjects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

/**
 * 보관해 둔 과목 목록을 "낡았다" 고 표시해서, 화면이 서버에서 새 목록을 다시 받아오게 합니다.
 * 추가 · 수정 · 삭제가 성공한 뒤에 부릅니다. (hooks/useSubjectMutations.ts 가 대신 불러 줍니다)
 */
export function invalidateSubjects(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: subjectsQuery().queryKey })
}
