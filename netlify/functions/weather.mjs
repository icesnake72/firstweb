// GET /api/weather?q=서울            지역 이름으로 조회
// GET /api/weather?lat=37.5&lon=127  좌표로 조회 (내 위치)
// OpenWeather 무료 API 사용: 지오코딩 + 현재 날씨 + 5일/3시간 예보 → 일별 요약
// API 키는 서버에서만 사용하고 브라우저로 보내지 않는다.
import { handler, requireEnv } from "../lib/session.mjs";

const OWM = "https://api.openweathermap.org";
const TTL_MS = 10 * 60 * 1000;
const memo = new Map();

const json = (body, status = 200, cache = true) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": cache ? "public, max-age=300" : "no-store",
      "Netlify-CDN-Cache-Control": cache ? "public, s-maxage=600, stale-while-revalidate=300" : "no-store",
    },
  });

class UpstreamError extends Error {
  constructor(status, code) { super(code); this.upstreamStatus = status; this.code = code; }
}

async function owm(path, params, key) {
  const url = new URL(path, OWM);
  url.search = new URLSearchParams({ ...params, appid: key }).toString();
  const res = await fetch(url, { headers: { "User-Agent": "firstweb-weather" } });
  if (!res.ok) {
    const code = res.status === 401 ? "invalid_key" : res.status === 429 ? "rate_limited" : res.status === 404 ? "not_found" : "upstream_error";
    console.error("[weather] openweather error", path, res.status); // 키가 포함된 URL 은 기록하지 않음
    throw new UpstreamError(res.status, code);
  }
  return res.json();
}

const hasHangul = (s) => /[가-힣]/.test(s);

function place(g) {
  return {
    name: g.local_names?.ko || g.name,
    nameEn: g.local_names?.en || g.name,
    country: g.country,
    state: g.state || null,
    lat: Math.round(g.lat * 1e4) / 1e4,
    lon: Math.round(g.lon * 1e4) / 1e4,
  };
}

const r1 = (n) => Math.round(n * 10) / 10;

/** 3시간 예보 목록 → 현지 날짜별 요약 */
function summarizeDaily(list, tz, current) {
  const days = new Map();
  for (const it of list) {
    const local = new Date((it.dt + tz) * 1000);
    const date = local.toISOString().slice(0, 10);
    const hour = local.getUTCHours();
    if (!days.has(date)) days.set(date, { date, min: Infinity, max: -Infinity, pop: 0, hum: [], pick: null, pickDist: Infinity });
    const d = days.get(date);
    d.min = Math.min(d.min, it.main.temp_min);
    d.max = Math.max(d.max, it.main.temp_max);
    d.pop = Math.max(d.pop, it.pop || 0);
    d.hum.push(it.main.humidity);
    const dist = Math.abs(hour - 13); // 한낮 날씨를 그날의 대표로
    if (dist < d.pickDist) { d.pick = it.weather[0]; d.pickDist = dist; }
  }
  // 오늘은 현재 기온도 범위에 포함
  const today = new Date((current.dt + tz) * 1000).toISOString().slice(0, 10);
  if (!days.has(today)) days.set(today, { date: today, min: Infinity, max: -Infinity, pop: 0, hum: [], pick: current.weather[0], pickDist: 0 });
  const t = days.get(today);
  t.min = Math.min(t.min, current.main.temp);
  t.max = Math.max(t.max, current.main.temp);
  if (!t.pick) t.pick = current.weather[0];

  return [...days.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      date: d.date,
      min: r1(d.min),
      max: r1(d.max),
      pop: Math.round(d.pop * 100),
      humidity: d.hum.length ? Math.round(d.hum.reduce((s, v) => s + v, 0) / d.hum.length) : null,
      icon: d.pick.icon.replace("n", "d"),
      description: d.pick.description,
    }))
    .slice(0, 6);
}

export default handler(async (req) => {
  const { OPEN_WEATHER_API_KEY: key } = requireEnv(["OPEN_WEATHER_API_KEY"]);
  const params = new URL(req.url).searchParams;
  const q = (params.get("q") || "").trim().slice(0, 80);
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const byCoords = params.has("lat") && params.has("lon") && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

  if (!q && !byCoords) return json({ ok: false, code: "missing_query" }, 400, false);

  const cacheKey = byCoords ? `c:${lat.toFixed(2)},${lon.toFixed(2)}` : `q:${q.toLowerCase()}`;
  const hit = memo.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return json(hit.body);

  try {
    // 1) 위치 찾기
    let location, candidates = [];
    if (byCoords) {
      const rev = await owm("/geo/1.0/reverse", { lat, lon, limit: 1 }, key);
      location = rev[0] ? place(rev[0]) : { name: "내 위치", nameEn: "My location", country: "", state: null, lat, lon };
      location.lat = lat; location.lon = lon;
    } else {
      const found = await owm("/geo/1.0/direct", { q, limit: 5 }, key);
      if (!found.length) return json({ ok: false, code: "not_found", q }, 404, false);
      // 한글로 검색하면 한국 결과를 먼저
      const sorted = hasHangul(q) ? [...found].sort((a, b) => (b.country === "KR") - (a.country === "KR")) : found;
      candidates = sorted.map(place);
      location = candidates[0];
    }

    // 2) 현재 날씨 + 5일 예보
    const common = { lat: location.lat, lon: location.lon, units: "metric", lang: "kr" };
    const [cur, fc] = await Promise.all([
      owm("/data/2.5/weather", common, key),
      owm("/data/2.5/forecast", common, key),
    ]);
    const tz = cur.timezone;

    const body = {
      ok: true,
      location,
      candidates: candidates.slice(1),
      timezone: tz,
      current: {
        dt: cur.dt,
        temp: r1(cur.main.temp),
        feelsLike: r1(cur.main.feels_like),
        humidity: cur.main.humidity,
        pressure: cur.main.pressure,
        windSpeed: r1(cur.wind?.speed ?? 0),
        windDeg: cur.wind?.deg ?? null,
        clouds: cur.clouds?.all ?? null,
        visibility: cur.visibility ?? null,
        sunrise: cur.sys?.sunrise ?? null,
        sunset: cur.sys?.sunset ?? null,
        icon: cur.weather[0].icon,
        description: cur.weather[0].description,
      },
      hourly: fc.list.slice(0, 8).map((it) => ({
        dt: it.dt,
        temp: r1(it.main.temp),
        pop: Math.round((it.pop || 0) * 100),
        icon: it.weather[0].icon,
        description: it.weather[0].description,
      })),
      daily: summarizeDaily(fc.list, tz, cur),
    };

    memo.set(cacheKey, { at: Date.now(), body });
    return json(body);
  } catch (err) {
    if (err instanceof UpstreamError) {
      const status = err.code === "rate_limited" ? 429 : err.code === "not_found" ? 404 : 502;
      return json({ ok: false, code: err.code }, status, false);
    }
    throw err;
  }
});

export const config = { path: "/api/weather" };
