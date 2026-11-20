// GET /api/news?category=technology  또는  /api/news?q=AI
// newsapi.org 를 서버에서 대신 호출한다 (API 키는 브라우저로 절대 보내지 않음).
// 무료 플랜은 하루 100회 제한이 있어 결과를 캐시한다.
import { handler, requireEnv } from "../lib/session.mjs";

const CATEGORIES = new Set(["general", "business", "technology", "science", "health", "sports", "entertainment"]);
const COUNTRY = "us"; // NewsAPI 는 현재 한국(kr) 헤드라인을 제공하지 않음
const PAGE_SIZE = 30;
const TTL_MS = 10 * 60 * 1000; // 함수 인스턴스 내부 캐시 10분

const memo = new Map(); // key -> { at, body }

const json = (body, status = 200, cache = true) =>
  Response.json(body, {
    status,
    headers: {
      // 브라우저 5분, Netlify CDN 15분 캐시 → API 호출 횟수 절약
      "Cache-Control": cache ? "public, max-age=300" : "no-store",
      "Netlify-CDN-Cache-Control": cache ? "public, s-maxage=900, stale-while-revalidate=300" : "no-store",
    },
  });

const toHttps = (u) => (typeof u === "string" && /^https?:\/\//.test(u) ? u.replace(/^http:\/\//, "https://") : null);

export default handler(async (req) => {
  const { NEWS_API_KEY } = requireEnv(["NEWS_API_KEY"]);
  const params = new URL(req.url).searchParams;

  const q = (params.get("q") || "").trim().slice(0, 100);
  const category = CATEGORIES.has(params.get("category")) ? params.get("category") : "general";

  const api = new URL(q ? "https://newsapi.org/v2/everything" : "https://newsapi.org/v2/top-headlines");
  if (q) {
    api.search = new URLSearchParams({ q, language: "en", sortBy: "publishedAt", pageSize: String(PAGE_SIZE) }).toString();
  } else {
    api.search = new URLSearchParams({ country: COUNTRY, category, pageSize: String(PAGE_SIZE) }).toString();
  }

  const cacheKey = api.search;
  const hit = memo.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return json(hit.body);

  const res = await fetch(api, { headers: { "X-Api-Key": NEWS_API_KEY, "User-Agent": "firstweb-news" } });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.status !== "ok") {
    // NewsAPI 오류 코드만 전달 (키 값은 포함되지 않음)
    console.error("[news] newsapi error", res.status, data.code);
    const code = data.code || "upstream_error";
    const status = code === "rateLimited" ? 429 : 502;
    return json({ ok: false, code }, status, false);
  }

  const seen = new Set();
  const articles = (data.articles || [])
    .filter((a) => a.title && a.title !== "[Removed]" && a.url && !seen.has(a.url) && seen.add(a.url))
    .map((a) => ({
      title: a.title.replace(/\s+-\s+[^-]+$/, ""), // 끝의 " - 출처명" 제거 (출처는 따로 표시)
      description: a.description && a.description !== "[Removed]" ? a.description : "",
      url: toHttps(a.url),
      image: toHttps(a.urlToImage),
      source: a.source?.name || "",
      publishedAt: a.publishedAt || null,
    }))
    .filter((a) => a.url);

  const body = { ok: true, mode: q ? "search" : "headlines", category: q ? null : category, q: q || null, country: COUNTRY, articles };
  memo.set(cacheKey, { at: Date.now(), body });
  return json(body);
});

export const config = { path: "/api/news" };
