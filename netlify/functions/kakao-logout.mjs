// POST /auth/kakao/logout
// 카카오 액세스 토큰을 만료시키고 세션 쿠키를 지운 뒤 Logout Redirect URI 로 이동
import { SESSION_COOKIE, clearCookie, handler, isSecure, parseCookies, redirect, unseal } from "../lib/session.mjs";

export default handler(async (req) => {
  // 다른 사이트가 링크로 로그아웃시키지 못하도록 POST 만 허용
  if (req.method !== "POST") return redirect("/");

  const session = unseal(parseCookies(req)[SESSION_COOKIE]);
  if (session?.at) {
    try {
      await fetch("https://kapi.kakao.com/v1/user/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.at}` },
      });
    } catch (err) {
      console.error("[kakao-auth] kakao logout failed", err.message); // 실패해도 로컬 세션은 지움
    }
  }

  const target = process.env.KAKAO_LOGOUT_REDIRECT_URI || "/";
  return redirect(target, [clearCookie(SESSION_COOKIE, isSecure(req))]);
});

export const config = { path: "/auth/kakao/logout" };
