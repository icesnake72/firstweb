import assert from "node:assert/strict";
import { test } from "node:test";

import { PAGE_SIZE, TOPICS, buildUpstreamUrl, normalizeArticles, plainText, resolveTopic } from "../netlify/lib/news.mjs";

const article = (overrides = {}) => ({
  source: { id: null, name: "Example News" },
  title: "제목",
  description: "설명",
  url: "https://example.com/a",
  urlToImage: "https://example.com/a.jpg",
  publishedAt: "2026-11-18T14:30:37Z",
  ...overrides,
});

test("resolveTopic accepts only whitelisted topics", () => {
  assert.equal(resolveTopic("ai"), "ai");
  assert.equal(resolveTopic("world"), "world");
  assert.equal(resolveTopic("__proto__"), null);
  assert.equal(resolveTopic("toString"), null);
  assert.equal(resolveTopic(""), null);
  assert.equal(resolveTopic(null), null);
});

test("buildUpstreamUrl builds an everything search for Korean topics", () => {
  const url = new URL(buildUpstreamUrl("ai"));
  assert.equal(url.origin + url.pathname, "https://newsapi.org/v2/everything");
  assert.equal(url.searchParams.get("q"), TOPICS.ai.params.q);
  assert.equal(url.searchParams.get("language"), "ko");
  assert.equal(url.searchParams.get("sortBy"), "publishedAt");
  assert.equal(url.searchParams.get("pageSize"), String(PAGE_SIZE));
  assert.equal(url.searchParams.has("apiKey"), false);
});

test("buildUpstreamUrl builds top-headlines without search-only params", () => {
  const url = new URL(buildUpstreamUrl("world"));
  assert.equal(url.pathname, "/v2/top-headlines");
  assert.equal(url.searchParams.get("country"), "us");
  assert.equal(url.searchParams.has("sortBy"), false);
});

test("buildUpstreamUrl rejects unknown topics", () => {
  assert.throws(() => buildUpstreamUrl("nope"), /unknown topic/);
});

test("normalizeArticles keeps only the fields the page needs", () => {
  const [item] = normalizeArticles([article({ author: "someone", content: "본문" })]);
  assert.deepEqual(item, {
    title: "제목",
    description: "설명",
    url: "https://example.com/a",
    image: "https://example.com/a.jpg",
    source: "Example News",
    publishedAt: "2026-11-18T14:30:37.000Z",
  });
});

test("normalizeArticles drops removed, untitled, duplicate and unsafe-link articles", () => {
  const result = normalizeArticles([
    article({ title: "[Removed]" }),
    article({ title: "   " }),
    article({ title: "링크 없음", url: null }),
    article({ title: "스크립트 링크", url: "javascript:alert(1)" }),
    article({ title: "정상" }),
    article({ title: "정상", url: "https://example.com/dup" }),
    null,
    "garbage",
  ]);
  assert.deepEqual(result.map((a) => a.title), ["정상"]);
});

test("normalizeArticles tolerates missing optional fields", () => {
  const [item] = normalizeArticles([
    article({ description: null, urlToImage: "http://example.com/insecure.jpg", source: null, publishedAt: "not-a-date" }),
  ]);
  assert.equal(item.description, "");
  assert.equal(item.image, null);
  assert.equal(item.source, "");
  assert.equal(item.publishedAt, null);
});

test("normalizeArticles collapses whitespace and truncates long text", () => {
  const [item] = normalizeArticles([article({ title: "  줄\n바꿈   제목 ", description: "가".repeat(500) })]);
  assert.equal(item.title, "줄 바꿈 제목");
  assert.equal(item.description.length, 300);
  assert.ok(item.description.endsWith("…"));
});

test("plainText decodes entities and strips tags", () => {
  assert.equal(plainText("가전&middot;에너지 등&hellip;"), "가전·에너지 등…");
  assert.equal(plainText("A &amp; B &#39;C&#39; &#x41;"), "A & B 'C' A");
  assert.equal(plainText("<b>굵게</b> 본문<br/>다음"), " 굵게  본문 다음");
  assert.equal(plainText("&unknown; &#99999999;"), "&unknown; &#99999999;");
});

test("normalizeArticles cleans markup in title and description", () => {
  const [item] = normalizeArticles([article({ title: "A&amp;B <i>속보</i>", description: "SK&middot;삼성" })]);
  assert.equal(item.title, "A&B 속보");
  assert.equal(item.description, "SK·삼성");
});

test("normalizeArticles returns an empty list for non-array input", () => {
  assert.deepEqual(normalizeArticles(undefined), []);
  assert.deepEqual(normalizeArticles({ articles: [] }), []);
});
