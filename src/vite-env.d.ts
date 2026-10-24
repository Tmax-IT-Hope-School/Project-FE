/// <reference types="vite/client" />

/**
 * `.env` 에 넣을 수 있는 환경변수의 이름과 모양입니다. (견본은 저장소 맨 위의 .env.example)
 * 여기에 적어 두면 `import.meta.env.VITE_API_BASE_URL` 을 쓸 때 오타를 타입 검사가 잡아 줍니다.
 */
interface ImportMetaEnv {
  /** BE 서버 주소 (예: http://localhost:8080/api/v1). 비워 두면 api.ts 의 기본값을 씁니다. */
  readonly VITE_API_BASE_URL?: string
  /** 'false' 면 로그인 화면의 테스트 로그인을 숨깁니다. 비워 두면 보입니다. (lib/testLogin.ts) */
  readonly VITE_TEST_LOGIN?: string
  /** 'true' 면 로그인 화면에 "시연 코드로 로그인" 을 보여줍니다. 비워 두면 숨깁니다. (lib/demoLogin.ts) */
  readonly VITE_DEMO_CODE_LOGIN?: string
  /** 이 서버 사용자 번호로 로그인하면 가상 28일을 자동으로 넣습니다. 'all' 이면 모든 계정, 비워 두면 꺼집니다. (lib/demoAutoSeed.ts) */
  readonly VITE_DEMO_SEED_USER_ID?: string
  /** 구글 로그인 · 가입에 쓰는 OAuth 클라이언트 ID. (lib/googleClient.ts) 구글 캘린더 연동은 #417 에서 지웠습니다 */
  readonly VITE_GOOGLE_CLIENT_ID?: string
  /** 웹 푸시 공개 키(VAPID). 비우면 서버(GET /push/public-key)에서 받습니다. (lib/webPush.ts) */
  readonly VITE_VAPID_PUBLIC_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
