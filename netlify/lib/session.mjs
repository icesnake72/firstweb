// 서버 함수들이 함께 쓰는 도우미
// - 세션 쿠키를 AES-256-GCM 으로 암호화 (SESSION_SECRET 사용)
// - 쿠키 읽기/쓰기, 필수 환경 변수 확인
import crypto from "node:crypto";

export const SESSION_COOKIE = "kakao_session";
export const STATE_COOKIE = "kakao_oauth_state";
export const SESSION_MAX_AGE = 60 * 60 * 6; // 6시간 (카카오 액세스 토큰 유효기간과 비슷하게)

/** 필요한 환경 변수가 비어 있으면 '이름만' 알려 주는 에러를 던진다 (값은 절대 출력하지 않음) */
export function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    const err = new Error(`환경 변수가 설정되지 않았습니다: ${missing.join(", ")}`);
    err.status = 500;
    throw err;
  }
  return Object.fromEntries(names.map((n) => [n, process.env[n]]));
}

function key() {
  const { SESSION_SECRET } = requireEnv(["SESSION_SECRET"]);
  return crypto.createHash("sha256").update(SESSION_SECRET).digest();
}

/** 객체 → 암호화된 문자열 */
export function seal(data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64url");
}

/** 암호화된 문자열 → 객체 (위조·만료 시 null) */
export function unseal(token) {
  if (!token) return null;
  try {
    const buf = Buffer.from(token, "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    const json = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
    const data = JSON.parse(json);
    if (data.exp && Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** https 일 때만 Secure 쿠키 (로컬 http://localhost 테스트도 되도록) */
export function isSecure(req) {
  const proto = req.headers.get("x-forwarded-proto");
  return (proto || new URL(req.url).protocol.replace(":", "")) === "https";
}

export function cookie(name, value, { maxAge, secure }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(name, secure) {
  return cookie(name, "", { maxAge: 0, secure });
}

/** 302 리다이렉트 응답 (Set-Cookie 여러 개 지원) */
export function redirect(location, cookies = []) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

/** 함수 본문을 감싸 설정 오류를 보기 좋게 반환 */
export function handler(fn) {
  return async (req, context) => {
    try {
      return await fn(req, context);
    } catch (err) {
      console.error("[kakao-auth]", err.message);
      return new Response(err.status === 500 ? err.message : "서버 오류가 발생했습니다.", {
        status: err.status || 500,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
  };
}
