import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { VoicePledgePlayButton } from '@/components/ui/VoicePledgePlayButton'
import { usePlans } from '@/hooks/usePlans'
import { CALL_TIME_STORAGE_KEY, parseCallTime } from '@/lib/callReminder'
import { buildCallSummaries, loadCheckInsByDate } from '@/lib/callSummary'
import { loadStudySessions } from '@/lib/dailyRecords'
import { getTodayKey } from '@/lib/date'
import { loadData } from '@/lib/storage'
import { ANALYSIS_PATH } from '@/lib/tabMenu'
import { loadVoicePledge } from '@/lib/voicePledge'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * 상담 탭 화면(/counsel)입니다. (#406, 최종 기획서 「4.5 상담」)
 * 통화 · 채팅 · 목표 만들기 · 다짐 · 일기처럼 AI 와 이야기하는 곳을 한곳에 모읍니다.
 *
 * - 오늘의 통화: 설정에서 정한 시각, [지금 받기], 오늘 통화했는지
 * - 지난 통화 요약: 가장 최근 한 장 (전체 목록은 분석 탭)
 * - 채팅 · 목표 만들기 대화: 화면은 #416 에서 만듭니다. 그 전까지는 "곧 열려요" 로 보여 줍니다.
 * - 다짐 녹음 듣기: 없으면 '첫 목표를 만들면 녹음할 수 있어요'
 * - 일기: 설정에서 켰을 때만
 */
export function CounselPage() {
  const navigate = useNavigate()
  // 설정에서 정한 전화 받을 시간 ('HH:MM'). 안 정했거나 값이 이상하면 빈 글자입니다.
  const [callTime] = useState(() => {
    const saved = loadData<unknown>(CALL_TIME_STORAGE_KEY, '')
    return typeof saved === 'string' && parseCallTime(saved) !== null ? saved : ''
  })
  // 설정 화면에서 켠 사람에게만 일기를 보여줍니다. (#63)
  const [isDiaryEnabled] = useState(() => loadData('diary-enabled', false))
  // 처음에 녹음해 둔 다짐. 없으면 null (lib/voicePledge.ts)
  const [voicePledge] = useState(loadVoicePledge)

  // 통화에서 나온 값은 그날 체크인에 저장됩니다. 체크인으로 요약 목록을 만들어 가장 최근 한 장만 보여 줍니다. (#45)
  const { allPlans } = usePlans()
  const [checkIns] = useState(loadCheckInsByDate)
  const [sessions] = useState(loadStudySessions)
  const latestSummary = buildCallSummaries(checkIns, allPlans, sessions)[0] ?? null
  const hasCalledToday = checkIns[getTodayKey()] !== undefined

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">상담</h1>
        <p className="mt-2 text-slate-600">AI 선생님과 이야기하는 곳이에요.</p>
      </div>

      {/* 모바일은 한 줄에 하나, PC 는 두 칸으로 카드를 놓습니다. */}
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
        <Card title="오늘의 통화">
          <p className="text-sm break-keep text-slate-600">
            {callTime === ''
              ? '아직 전화 받을 시간을 정하지 않았어요. 설정에서 정하면 그 시간에 AI 선생님이 전화해요.'
              : `매일 ${callTime} 에 AI 선생님이 전화해요. 2~3분이면 끝나요.`}
          </p>
          {hasCalledToday && (
            <p role="status" className="mt-2 text-sm font-medium text-emerald-700">
              ✓ 오늘 통화를 했어요
            </p>
          )}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button className="w-full sm:w-auto" onClick={() => navigate('/call')}>
              {hasCalledToday ? '한 번 더 통화하기' : '지금 받기'}
            </Button>
            <Button
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={() => navigate('/settings')}
            >
              {callTime === '' ? '시간 정하기' : '시간 바꾸기'}
            </Button>
          </div>
        </Card>

        <Card title="지난 통화 요약">
          {latestSummary === null ? (
            <p className="text-sm break-keep text-slate-600">
              아직 통화한 기록이 없어요. 통화하면 여기에 요약이 남아요.
            </p>
          ) : (
            <div className="flex flex-col gap-1 text-sm">
              <p className="text-slate-500">{latestSummary.date}</p>
              <p className="font-medium break-keep text-slate-900">{latestSummary.headline}</p>
              {latestSummary.promise && (
                <p className="break-words text-slate-600">약속 · {latestSummary.promise}</p>
              )}
            </div>
          )}
          <Button
            variant="secondary"
            className="mt-4 w-full sm:w-auto"
            onClick={() => navigate(ANALYSIS_PATH)}
          >
            지난 요약 모두 보기
          </Button>
        </Card>

        {/* 채팅과 목표 만들기 대화는 #416 에서 만듭니다. 어디서 하게 될지 미리 알 수 있게 자리만 보여 줍니다. */}
        <Card title="채팅으로 상담하기">
          <p className="text-sm break-keep text-slate-600">
            통화를 못 받은 날은 같은 이야기를 글로 나눌 수 있어요.
          </p>
          <Button variant="secondary" className="mt-4 w-full sm:w-auto" disabled>
            곧 열려요
          </Button>
        </Card>

        <Card title="목표 만들기 대화">
          <p className="text-sm break-keep text-slate-600">
            AI 와 이야기하면서 이루고 싶은 목표를 정해요.
          </p>
          <Button variant="secondary" className="mt-4 w-full sm:w-auto" disabled>
            곧 열려요
          </Button>
        </Card>

        <Card title="처음의 다짐">
          {voicePledge?.audioDataUrl ? (
            <>
              <p className="text-sm break-keep text-slate-600">
                처음에 내 목소리로 남긴 다짐이에요.
              </p>
              <VoicePledgePlayButton
                audioDataUrl={voicePledge.audioDataUrl}
                seconds={voicePledge.seconds}
                label="다짐 듣기"
                className="mt-4 w-full sm:w-auto"
              />
            </>
          ) : (
            <p className="text-sm break-keep text-slate-600">첫 목표를 만들면 녹음할 수 있어요.</p>
          )}
          {/* 글로 남긴 다짐이 있으면 같이 보여 줍니다. */}
          {voicePledge && voicePledge.text !== '' && (
            <p className="mt-3 text-sm font-medium break-words text-slate-900">
              “{voicePledge.text}”
            </p>
          )}
        </Card>

        {isDiaryEnabled && (
          <Card title="일기">
            <p className="text-sm text-slate-600">원할 때만 쓰는 자유 일기예요.</p>
            <Button className="mt-4 w-full sm:w-auto" onClick={() => navigate('/diary')}>
              일기 쓰러 가기
            </Button>
          </Card>
        )}
      </div>
    </div>
  )
}
