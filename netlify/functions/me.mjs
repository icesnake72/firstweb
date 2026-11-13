// GET /api/me
// 로그인 상태와 공개해도 되는 프로필 정보만 돌려준다 (액세스 토큰은 절대 포함하지 않음)
import { SESSION_COOKIE, handler, parseCookies, unseal } from "../lib/session.mjs";

export default handler(async (req) => {
  const session = unseal(parseCookies(req)[SESSION_COOKIE]);
  const body = session
    ? { loggedIn: true, user: { id: session.id, nickname: session.nickname, image: session.image } }
    : { loggedIn: false };

  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
});

export const config = { path: "/api/me" };
