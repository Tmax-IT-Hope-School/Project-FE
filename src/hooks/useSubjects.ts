import { useIsServerData } from '@/hooks/useIsServerData'
import { useSubjectMutations } from '@/hooks/useSubjectMutations'
import { getApiErrorMessage } from '@/lib/api'
import { loadSubjects } from '@/lib/subjects'
import { subjectsQuery } from '@/lib/subjectsApi'
import { saveData } from '@/lib/storage'
import type { Subject, SubjectColor } from '@/types'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

/**
 * 내 과목 목록입니다. 읽기만 하는 화면(홈 · 타이머 · 기록 · 시험 · 온보딩)이 씁니다. (#201)
 *
 *   진짜 로그인   -> 서버에서 받아온 과목 (components/layout/SubjectsGate.tsx 가 화면을 열기 전에 미리 받아 둡니다)
 *   테스트 로그인 -> 이 기기에 저장된 과목 (lib/subjects.ts 의 loadSubjects)
 *
 *   const subjects = useSubjects()
 */
export function useSubjects(): Subject[] {
  const isServerData = useIsServerData()
  const { data } = useQuery({ ...subjectsQuery(), enabled: isServerData })
  // 테스트 로그인의 과목은 화면을 열 때 한 번만 읽습니다. (바꾸는 화면은 아래 useSubjectManager)
  const [localSubjects] = useState<Subject[]>(loadSubjects)

  return isServerData ? (data ?? []) : localSubjects
}

/** 과목을 추가·삭제한 결과. 실패했으면 화면에 보여 줄 한국어 문장, 성공했으면 null 입니다. */
type ActionError = string | null

interface SubjectManager {
  subjects: Subject[]
  /** 서버에 요청을 보내는 중인지 (버튼을 잠급니다). 테스트 로그인은 늘 false */
  isWorking: boolean
  addSubject: (name: string, color: SubjectColor) => Promise<ActionError>
  removeSubject: (id: string) => Promise<ActionError>
  /** 과목 이름을 바꿉니다. 실패하면 이유 문장, 성공하면 null */
  renameSubject: (id: string, name: string) => Promise<ActionError>
}

/**
 * 과목을 보고, 추가하고, 지우는 훅입니다. 계획 화면의 "내 과목" 이 씁니다. (#201)
 *
 *   진짜 로그인   -> 서버에 추가·삭제하고, 성공하면 목록을 서버에서 다시 받습니다.
 *                    서버가 거절하면(같은 이름 · 계획이 붙은 과목 …) 서버가 준 이유 문장을 돌려줍니다.
 *   테스트 로그인 -> 이 기기(localStorage)에 저장합니다. (지금까지처럼)
 *
 *   const { subjects, addSubject, removeSubject, renameSubject, isWorking } = useSubjectManager()
 *   const error = await addSubject('수학', 'blue')   // null 이면 성공, 문장이면 실패 이유
 */
export function useSubjectManager(): SubjectManager {
  const isServerData = useIsServerData()
  const { data } = useQuery({ ...subjectsQuery(), enabled: isServerData })
  const { create, update, remove } = useSubjectMutations()

  // 테스트 로그인의 과목. 바뀔 때마다 이 기기에 저장합니다. (진짜 로그인에서는 저장소를 건드리지 않습니다)
  const [localSubjects, setLocalSubjects] = useState<Subject[]>(loadSubjects)
  useEffect(() => {
    if (!isServerData) saveData('subjects', localSubjects)
  }, [isServerData, localSubjects])

  async function addSubject(name: string, color: SubjectColor): Promise<ActionError> {
    if (!isServerData) {
      const newSubject: Subject = { id: `subject-${Date.now()}`, name, color }
      setLocalSubjects((prev) => [...prev, newSubject])
      return null
    }
    try {
      await create.mutateAsync({ name, color })
      return null
    } catch (error) {
      return getApiErrorMessage(error)
    }
  }

  async function removeSubject(id: string): Promise<ActionError> {
    if (!isServerData) {
      setLocalSubjects((prev) => prev.filter((subject) => subject.id !== id))
      return null
    }
    try {
      await remove.mutateAsync(id)
      return null
    } catch (error) {
      return getApiErrorMessage(error)
    }
  }

  async function renameSubject(id: string, name: string): Promise<ActionError> {
    if (!isServerData) {
      setLocalSubjects((prev) =>
        prev.map((subject) => (subject.id === id ? { ...subject, name } : subject)),
      )
      return null
    }
    try {
      await update.mutateAsync({ id, input: { name } })
      return null
    } catch (error) {
      return getApiErrorMessage(error)
    }
  }

  return {
    subjects: isServerData ? (data ?? []) : localSubjects,
    isWorking: create.isPending || update.isPending || remove.isPending,
    addSubject,
    removeSubject,
    renameSubject,
  }
}
