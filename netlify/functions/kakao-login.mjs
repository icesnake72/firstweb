// GET /auth/kakao/login
// 카카오 로그인 화면으로 보낸다. CSRF 방지용 state 값을 쿠키에 저장.
import { STATE_COOKIE, cookie, handler, isSecure, randomToken, redirect, requireEnv } from "../lib/session.mjs";

export default handler(async (req) => {
  const env = requireEnv(["KAKAO_REST_API_KEY", "KAKAO_REDIRECT_URI", "SESSION_SECRET"]);
  const state = randomToken();

  const url = new URL("https://kauth.kakao.com/oauth/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: env.KAKAO_REST_API_KEY,
    redirect_uri: env.KAKAO_REDIRECT_URI,
    state,
  }).toString();

  return redirect(url.toString(), [cookie(STATE_COOKIE, state, { maxAge: 600, secure: isSecure(req) })]);
});

export const config = { path: "/auth/kakao/login" };
