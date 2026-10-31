/**
 * 학년 · 반을 서버(BE)와 맞춥니다. (2026-10-31)
 *
 * 예전에는 반을 이 기기(localStorage)에만 저장해서, 새 기기에서 로그인하면 홈 시간표가 안 보였습니다.
 * (설정에서 반을 한 번 더 저장해야 보였음) 이제 서버에도 저장하고, 로그인한 기기에 반이 없으면 받아 옵니다.
 *
 * 서버(BE)와 정한 약속입니다. (BE 저장소의 docs/API.md "내 학년 · 반") 로그인이 필요합니다.
 *   보기  GET /auth/school-class                       -> 200 { grade: 2, classNo: 1 }  (안 골랐으면 둘 다 null)
 *   저장  PUT /auth/school-class  { grade, classNo }   -> 200 같은 모양                  (지우려면 둘 다 null)
 *
 * 맞추는 규칙 (앱을 열 때 한 번):
 *   1. 이 기기에서 바꾼 반을 아직 못 보냈으면 → 보냅니다.
 *   2. 서버에 반이 있으면 → 이 기기에 받아 둡니다. (다른 기기에서 고른 반)
 *   3. 서버에 없고 이 기기에만 있으면 → 보냅니다. (이 기능이 생기기 전에 고른 반)
 *
 * 서버에 이 주소가 아직 없거나(404) 인터넷이 끊겨도 조용히 넘어갑니다. 이 기기의 반은 그대로라 예전처럼 동작합니다.
 * 테스트 로그인은 서버를 쓰지 않아서 부르지 않습니다. (hooks/useSchoolClassSync.ts)
 */
import { ApiError, api } from '@/lib/api'
import {
  MAX_CLASS_NO,
  isSchoolClassUnsent,
  loadSchoolClass,
  markSchoolClassSent,
  saveSchoolClass,
  type SchoolClass,
} from '@/lib/schoolToday'

/** 서버 응답을 기다리는 최대 시간(밀리초) */
const REQUEST_TIMEOUT_MS = 10000

function isWholeNumberBetween(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

/** 서버가 준 값을 학년 · 반으로 바꿉니다. 둘 다 null 이면 null, 모양이 이상하면 에러입니다. */
function schoolClassOf(value: unknown): SchoolClass | null {
  if (typeof value !== 'object' || value === null) {
    throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
  }
  const record = value as Record<string, unknown>
  if (record.grade === null && record.classNo === null) return null
  if (
    isWholeNumberBetween(record.grade, 1, 3) &&
    isWholeNumberBetween(record.classNo, 1, MAX_CLASS_NO)
  ) {
    return { grade: record.grade, classNo: record.classNo }
  }
  throw new ApiError('서버 응답 모양이 올바르지 않습니다', 502)
}

/** 서버에 저장된 내 학년 · 반. 안 골랐으면 null 입니다. 실패하면 에러를 던집니다. */
async function fetchServerSchoolClass(): Promise<SchoolClass | null> {
  const result = await api<unknown>('/auth/school-class', {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  return schoolClassOf(result)
}

/** 학년 · 반을 서버에 저장합니다. null 이면 서버의 반을 지웁니다. 실패하면 에러를 던집니다. */
async function sendSchoolClass(schoolClass: SchoolClass | null): Promise<void> {
  await api<unknown>('/auth/school-class', {
    method: 'PUT',
    body: JSON.stringify(schoolClass ?? { grade: null, classNo: null }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

/**
 * 이 기기에서 바꾼 반을 서버로 보냅니다. 보냈으면 "못 보냄" 표시를 지웁니다.
 * 실패해도 에러를 던지지 않습니다. 표시가 남아 있어서 다음에 앱을 열 때 다시 보냅니다.
 */
export async function pushSchoolClass(): Promise<void> {
  try {
    await sendSchoolClass(loadSchoolClass())
    markSchoolClassSent()
  } catch {
    // 인터넷이 끊겼거나 서버에 아직 이 주소가 없으면(404) 다음에 다시 보냅니다.
  }
}

/** 앱을 열 때 한 번, 위의 규칙대로 이 기기와 서버의 반을 맞춥니다. 실패해도 에러를 던지지 않습니다. */
export async function syncSchoolClass(): Promise<void> {
  // 1. 이 기기에서 바꾼 것이 먼저입니다.
  if (isSchoolClassUnsent()) {
    await pushSchoolClass()
    return
  }
  try {
    const serverClass = await fetchServerSchoolClass()
    const deviceClass = loadSchoolClass()
    if (serverClass) {
      // 2. 서버의 반이 이 기기와 다를 때만 저장합니다. (같으면 홈을 다시 그릴 필요가 없음)
      const isSame =
        deviceClass?.grade === serverClass.grade && deviceClass.classNo === serverClass.classNo
      if (!isSame) saveSchoolClass(serverClass, 'server')
    } else if (deviceClass) {
      // 3. 서버는 모르고 이 기기만 아는 반입니다.
      await pushSchoolClass()
    }
  } catch {
    // 서버에 아직 이 주소가 없거나(404) 인터넷이 끊겼습니다. 이 기기의 반으로 예전처럼 동작합니다.
  }
}
