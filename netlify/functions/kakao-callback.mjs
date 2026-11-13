// GET /auth/kakao/callback  (카카오 디벨로퍼스에 등록한 Redirect URI)
// 1) state 검증 → 2) 인가 코드를 토큰으로 교환 → 3) 사용자 정보 조회 → 4) 암호화된 세션 쿠키 발급
import {
  SESSION_COOKIE, SESSION_MAX_AGE, STATE_COOKIE,
  clearCookie, cookie, handler, isSecure, parseCookies, redirect, requireEnv, safeEqual, seal,
} from "../lib/session.mjs";

const toHttps = (u) => (u ? u.replace(/^http:\/\//, "https://") : null);

export default handler(async (req) => {
  const url = new URL(req.url);
  const secure = isSecure(req);
  const clearState = clearCookie(STATE_COOKIE, secure);
  const fail = (reason) => redirect(`/?login=error&reason=${encodeURIComponent(reason)}`, [clearState]);

  // 사용자가 동의 화면에서 취소한 경우 등
  const kakaoError = url.searchParams.get("error");
  if (kakaoError) return fail(kakaoError);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const savedState = parseCookies(req)[STATE_COOKIE];
  if (!code || !state || !savedState || !safeEqual(state, savedState)) return fail("invalid_state");

  const env = requireEnv(["KAKAO_REST_API_KEY", "KAKAO_REDIRECT_URI", "SESSION_SECRET"]);

  // 2) 토큰 교환 (Client Secret 은 콘솔에서 활성화한 경우에만 필요)
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: env.KAKAO_REST_API_KEY,
    redirect_uri: env.KAKAO_REDIRECT_URI,
    code,
  });
  if (process.env.KAKAO_CLIENT_SECRET) body.set("client_secret", process.env.KAKAO_CLIENT_SECRET);

  const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body,
  });
  if (!tokenRes.ok) {
    // 카카오의 오류 코드만 기록 (요청에 쓴 키 값은 기록하지 않음)
    const detail = await tokenRes.json().catch(() => ({}));
    console.error("[kakao-auth] token exchange failed", tokenRes.status, detail.error, detail.error_code);
    return fail("token");
  }
  const token = await tokenRes.json();

  // 3) 사용자 정보
  const meRes = await fetch("https://kapi.kakao.com/v2/user/me", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!meRes.ok) {
    console.error("[kakao-auth] user/me failed", meRes.status);
    return fail("profile");
  }
  const me = await meRes.json();
  const profile = me.kakao_account?.profile ?? {};

  // 4) 세션 (브라우저에는 암호화된 값만 저장됨)
  const maxAge = Math.min(SESSION_MAX_AGE, Number(token.expires_in) || SESSION_MAX_AGE);
  const session = {
    id: String(me.id),
    nickname: profile.nickname ?? me.properties?.nickname ?? "카카오 사용자",
    image: toHttps(profile.thumbnail_image_url ?? profile.profile_image_url ?? me.properties?.thumbnail_image),
    at: token.access_token, // 로그아웃 시 토큰 만료 처리용 (서버에서만 사용)
    exp: Date.now() + maxAge * 1000,
  };

  return redirect("/?login=success", [
    clearState,
    cookie(SESSION_COOKIE, seal(session), { maxAge, secure }),
  ]);
});

export const config = { path: "/auth/kakao/callback" };
