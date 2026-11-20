// GET /api/news?topic=ai|dev|tech|economy|world
// NewsAPI 키를 브라우저에 노출하지 않도록 서버에서 대신 호출한다.
// 무료 플랜 호출 한도(하루 100회)를 아끼려고 메모리와 CDN 양쪽에 캐시한다.
import { DEFAULT_TOPIC, TOPICS, buildUpstreamUrl, normalizeArticles, resolveTopic } from "../lib/news.mjs";
import { requireEnv } from "../lib/session.mjs";

const CACHE_TTL_MS = 10 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 8000;
const cache = new Map();

function json(body, status, cacheControl) {
  const headers = { "Cache-Control": cacheControl };
  if (status === 200) headers["Netlify-CDN-Cache-Control"] = "public, max-age=600";
  return Response.json(body, { status, headers });
}

function fail(status, code, message) {
  return json({ error: { code, message } }, status, "no-store");
}

async function fetchArticles(topicId, apiKey) {
  const res = await fetch(buildUpstreamUrl(topicId), {
    headers: { "X-Api-Key": apiKey, "User-Agent": "firstweb-news/1.0" },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.status !== "ok") {
    const err = new Error(`NewsAPI ${res.status} ${data?.code || "unknown"}`);
    err.upstreamStatus = res.status;
    throw err;
  }
  return normalizeArticles(data.articles);
}

export default async (req) => {
  if (req.method !== "GET") {
    return fail(405, "method_not_allowed", "GET 요청만 지원합니다.");
  }

  const requested = new URL(req.url).searchParams.get("topic") ?? DEFAULT_TOPIC;
  const topicId = resolveTopic(requested);
  if (!topicId) {
    return fail(400, "invalid_topic", "지원하지 않는 주제입니다.");
  }

  const cached = cache.get(topicId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return json(cached.body, 200, "public, max-age=300");
  }

  try {
    const { NEWS_API_KEY } = requireEnv(["NEWS_API_KEY"]);
    const articles = await fetchArticles(topicId, NEWS_API_KEY);
    const body = {
      topic: topicId,
      label: TOPICS[topicId].label,
      fetchedAt: new Date().toISOString(),
      articles,
    };
    cache.set(topicId, { at: Date.now(), body });
    return json(body, 200, "public, max-age=300");
  } catch (err) {
    console.error("[news]", err.message);
    // 한도 초과·장애 때는 오래된 캐시라도 보여 주는 편이 낫다
    if (cached) return json(cached.body, 200, "no-store");
    if (err.status === 500) {
      return fail(500, "not_configured", "뉴스 API 키가 설정되지 않았습니다.");
    }
    if (err.upstreamStatus === 429) {
      return fail(503, "rate_limited", "뉴스 API 호출 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.");
    }
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return fail(504, "upstream_timeout", "뉴스 서버 응답이 늦어지고 있습니다.");
    }
    return fail(502, "upstream_error", "뉴스를 불러오지 못했습니다.");
  }
};

export const config = { path: "/api/news" };
