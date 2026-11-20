// POST /api/chat   body: { messages: [{ role: "user" | "assistant", content: "..." }, ...] }
// Claude 응답을 줄 단위 JSON(NDJSON)으로 스트리밍한다.
//   {"type":"text","text":"..."}       본문 조각
//   {"type":"done","stop":"end_turn"}   완료 (stop: end_turn | max_tokens | refusal)
//   {"type":"error","code":"..."}       오류
// ANTHROPIC_API_KEY 는 서버에서만 사용하며 브라우저로 보내지 않는다.
import Anthropic from "@anthropic-ai/sdk";
import { requireEnv } from "../lib/session.mjs";

const MODEL = "claude-opus-5-5";
const MAX_TOKENS = 8000;         // 공개 페이지라 비용 상한을 둠 (긴 답변은 이어서 요청 가능)
const MAX_MESSAGES = 30;         // 대화 기록 최대 개수
const MAX_CHARS_PER_MSG = 4000;  // 메시지 하나 최대 글자 수
const MAX_TOTAL_CHARS = 40000;   // 전체 대화 최대 글자 수

// 간단한 IP별 요청 제한 (함수 인스턴스 메모리 기준, 최선 노력 방식)
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 20;
const hits = new Map();

const SYSTEM_PROMPT = `당신은 한 소프트웨어 개발자의 포트폴리오 웹사이트에 있는 친절한 AI 도우미입니다.
- 기본적으로 한국어로 답하고, 사용자가 다른 언어로 물으면 그 언어로 답하세요.
- 프로그래밍, 웹 개발, AI, 일반적인 질문을 도와주세요.
- 답변은 핵심부터 간결하게 쓰고, 필요할 때만 목록이나 코드 블록(\`\`\`언어)을 사용하세요.
- 사이트 주인(개발자)의 개인 정보나 경력 세부 사항은 알지 못하므로 추측하지 말고, 사이트의 경력·기술 섹션을 참고하라고 안내하세요.
- 확실하지 않은 정보는 모른다고 말하세요.`;

const client = new Anthropic(); // ANTHROPIC_API_KEY 환경 변수에서 키를 읽음

function jsonError(status, code) {
  return Response.json({ type: "error", code }, { status, headers: { "Cache-Control": "no-store" } });
}

function clientIp(req, context) {
  return context?.ip || req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}

function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_MAX) { hits.set(ip, list); return true; }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear(); // 메모리 보호
  return false;
}

/** 브라우저에서 온 대화 기록을 검증해 API 형식으로 변환 */
function validate(body) {
  const msgs = body?.messages;
  if (!Array.isArray(msgs) || msgs.length === 0 || msgs.length > MAX_MESSAGES) return null;
  let total = 0;
  const out = [];
  for (const [i, m] of msgs.entries()) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return null;
    const content = m.content.trim();
    if (!content || content.length > MAX_CHARS_PER_MSG) return null;
    // user 로 시작하고 user/assistant 가 번갈아 와야 함
    if (m.role !== (i % 2 === 0 ? "user" : "assistant")) return null;
    total += content.length;
    out.push({ role: m.role, content });
  }
  if (total > MAX_TOTAL_CHARS || out[out.length - 1].role !== "user") return null;
  return out;
}

export default async (req, context) => {
  if (req.method !== "POST") return jsonError(405, "method_not_allowed");
  try { requireEnv(["ANTHROPIC_API_KEY"]); } catch { return jsonError(500, "missing_api_key"); }

  if (rateLimited(clientIp(req, context))) return jsonError(429, "rate_limited");

  let body;
  try { body = await req.json(); } catch { return jsonError(400, "bad_request"); }
  const messages = validate(body);
  if (!messages) return jsonError(400, "bad_request");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      let claude;
      try {
        claude = client.beta.messages.stream(
          {
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: SYSTEM_PROMPT,
            // 대화형 챗봇은 응답 속도가 중요해 effort 를 low 로 (Opus 5.5 기본값은 medium)
            output_config: { effort: "low" },
            // 안전 분류기가 요청을 거절하면 서버가 대체 모델로 자동 재시도
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            messages,
          },
          { signal: req.signal }, // 사용자가 '중지'하거나 창을 닫으면 요청도 중단
        );

        for await (const event of claude) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            send({ type: "text", text: event.delta.text });
          }
        }
        const final = await claude.finalMessage();
        send({ type: "done", stop: final.stop_reason });
      } catch (err) {
        if (req.signal.aborted) { /* 사용자가 중지함 */ }
        else if (err instanceof Anthropic.RateLimitError) send({ type: "error", code: "upstream_rate_limited" });
        else if (err instanceof Anthropic.AuthenticationError) send({ type: "error", code: "invalid_api_key" });
        else if (err instanceof Anthropic.BadRequestError) { console.error("[chat] bad request", err.status, err.message); send({ type: "error", code: "bad_request" }); }
        else if (err instanceof Anthropic.APIError) { console.error("[chat] api error", err.status); send({ type: "error", code: "upstream_error" }); }
        else { console.error("[chat] error", err?.message); send({ type: "error", code: "upstream_error" }); }
      } finally {
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
};

export const config = { path: "/api/chat" };
