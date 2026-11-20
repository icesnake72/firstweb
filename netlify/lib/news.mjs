// 뉴스 API 프록시가 쓰는 순수 로직 (네트워크 호출 없음 → 단위 테스트 대상)
// - 주제(topic) 화이트리스트: 브라우저가 임의의 검색어를 NewsAPI 로 보내지 못하게 한다
// - NewsAPI 응답을 화면에 필요한 필드만 남겨 정리한다

const NEWS_API_BASE = "https://newsapi.org/v2";
export const PAGE_SIZE = 24;
export const DEFAULT_TOPIC = "ai";

// NewsAPI 의 top-headlines 는 country=kr 결과가 비어 있어, 한국어 뉴스는 everything 검색을 쓴다
export const TOPICS = {
  ai: { label: "AI", endpoint: "everything", params: { q: "인공지능 OR AI", language: "ko" } },
  dev: { label: "개발", endpoint: "everything", params: { q: "개발자 OR 소프트웨어 OR 프로그래밍", language: "ko" } },
  tech: { label: "IT·기술", endpoint: "everything", params: { q: "IT OR 기술 OR 반도체", language: "ko" } },
  economy: { label: "경제", endpoint: "everything", params: { q: "경제 OR 증시 OR 금융", language: "ko" } },
  world: { label: "해외 헤드라인", endpoint: "top-headlines", params: { country: "us" } },
};

export function resolveTopic(value) {
  return Object.hasOwn(TOPICS, value) ? value : null;
}

export function buildUpstreamUrl(topicId) {
  const topic = TOPICS[topicId];
  if (!topic) throw new Error(`unknown topic: ${topicId}`);
  const url = new URL(`${NEWS_API_BASE}/${topic.endpoint}`);
  const params = { ...topic.params, pageSize: String(PAGE_SIZE) };
  if (topic.endpoint === "everything") {
    params.sortBy = "publishedAt";
    params.searchIn = "title,description";
  }
  url.search = new URLSearchParams(params).toString();
  return url.toString();
}

function httpUrl(value, { httpsOnly = false } = {}) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const allowed = httpsOnly ? ["https:"] : ["https:", "http:"];
    return allowed.includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  middot: "·", hellip: "…", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
};

/** 언론사 본문에 섞여 오는 HTML 태그·엔티티를 일반 텍스트로 바꾼다 (화면에는 textContent 로만 넣는다) */
export function plainText(value) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
      if (name[0] !== "#") return NAMED_ENTITIES[name.toLowerCase()] ?? match;
      const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    });
}

function text(value, maxLength) {
  if (typeof value !== "string") return "";
  const clean = plainText(value).replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean;
}

/** NewsAPI articles → 화면용 목록 (삭제된 기사·잘못된 링크·중복 제목 제외) */
export function normalizeArticles(articles) {
  if (!Array.isArray(articles)) return [];
  const seen = new Set();
  const out = [];
  for (const article of articles) {
    if (!article || typeof article !== "object") continue;
    const title = text(article.title, 200);
    const url = httpUrl(article.url);
    if (!title || title === "[Removed]" || !url || seen.has(title)) continue;
    seen.add(title);
    const published = new Date(article.publishedAt);
    out.push({
      title,
      description: text(article.description, 300),
      url,
      // http 이미지는 https 페이지에서 차단되므로 https 만 허용
      image: httpUrl(article.urlToImage, { httpsOnly: true }),
      source: text(article.source?.name, 60),
      publishedAt: Number.isNaN(published.getTime()) ? null : published.toISOString(),
    });
  }
  return out;
}
