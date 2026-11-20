// GET /api/maps-key
// 카카오맵 JavaScript SDK 용 JavaScript 키를 브라우저에 전달한다.
// - JavaScript 키는 카카오가 '브라우저 공개용'으로 설계한 키이며,
//   카카오 디벨로퍼스 > 플랫폼 > Web 에 등록한 도메인에서만 동작한다.
// - 키를 HTML/저장소에 직접 넣지 않고 환경 변수에서 읽어 전달하기 위한 함수.
// - REST API 키, Client Secret 등 다른 비밀 값은 절대 여기서 내보내지 않는다.
import { handler, requireEnv } from "../lib/session.mjs";

export default handler(async () => {
  const { KAKAO_JAVASCRIPT_KEY } = requireEnv(["KAKAO_JAVASCRIPT_KEY"]);
  return Response.json(
    { key: KAKAO_JAVASCRIPT_KEY },
    { headers: { "Cache-Control": "private, max-age=3600" } },
  );
});

export const config = { path: "/api/maps-key" };
