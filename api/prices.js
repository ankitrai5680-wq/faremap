// Vercel serverless function — live flight prices via the FREE Travelpayouts API.
//
// Holds your token server-side and returns the cheapest fares per destination.
// Two caching layers keep us under Travelpayouts' 100 req/hour/IP limit:
//   1. CDN cache via Cache-Control (per-URL, automatic on Vercel).
//   2. Optional Vercel KV (durable, shared across regions) keyed by origin+month+trip.
//      Enable by creating a free KV store in Vercel → it auto-injects KV_REST_API_* envs.
//      Without KV configured, the function still works (CDN cache only).
//
// SETUP:
//   1. Travelpayouts token → env TRAVELPAYOUTS_TOKEN.
//   2. (recommended) Vercel → Storage → Create KV store → connect to this project.
// Docs: https://support.travelpayouts.com/hc/en-us/articles/203956163-Aviasales-Data-API

const DESTINATIONS = ["KTM","CMB","BKK","TAS","KUL","DOH","DXB","HKT","HAN","SGN","MLE","SIN","DPS","IST","LHR","CDG","NBO","CAI","MRU","JNB","JFK","YYZ","GRU","SYD","ALA","AUH","MCT","CGK","HKG","ICN","PNH","FCO","AMS","GYD","TBS","ZNZ","SEZ","AKL","LAX","YVR","GOI","SXR","IXL","COK","MAA","BLR","HYD","BOM","UDR","JAI","VNS","CCU","GAU","IXZ"];
const TTL = 21600; // 6h

// Lazy cache client — supports REST or TCP Redis. ?debug=1 exposes which path was tried.
let _kv = null, _kvTried = false, _kvDiag = "untried";
async function kv() {
  if (_kvTried) return _kv;
  _kvTried = true;
  const restUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const restTok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (restUrl && restTok) {
    try {
      const { Redis } = await import("@upstash/redis");
      const c = new Redis({ url: restUrl, token: restTok });
      _kv = { get: k => c.get(k), set: (k, v, opt) => c.set(k, v, opt) };
      _kvDiag = "rest:ok"; return _kv;
    } catch (e) { _kvDiag = "rest:err:" + (e.message || e); }
  }
  const tcpUrl = process.env.REDIS_URL || process.env.KV_URL;
  if (tcpUrl) {
    try {
      const mod = await import("redis").catch(e => { _kvDiag = "tcp:noPkg:" + (e.message || e); return null; });
      if (!mod) return (_kv = null);
      const c = mod.createClient({ url: tcpUrl, socket: { connectTimeout: 4000 } });
      c.on("error", () => {});
      await c.connect();
      _kv = {
        get: async k => { const v = await c.get(k); try { return v ? JSON.parse(v) : null; } catch { return null; } },
        set: async (k, v, opt) => { await c.set(k, JSON.stringify(v), opt?.ex ? { EX: opt.ex } : undefined); }
      };
      _kvDiag = "tcp:ok"; return _kv;
    } catch (e) { _kvDiag = "tcp:err:" + (e.message || e); }
  } else { _kvDiag = "no-env-vars"; }
  return (_kv = null);
}
function envSummary() {
  return {
    hasToken: !!process.env.TRAVELPAYOUTS_TOKEN,
    hasRedisUrl: !!process.env.REDIS_URL,
    hasKvUrl: !!process.env.KV_URL,
    hasRestUrl: !!(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL),
    hasRestTok: !!(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN),
    kvDiag: _kvDiag,
  };
}

export default async function handler(req, res) {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  const { origin = "DEL", depart = "", ret = "", trip = "round" } = req.query;
  if (!token) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ fallback: true, reason: "TRAVELPAYOUTS_TOKEN not set" });
  }

  const month = depart ? depart.slice(0, 7) : "any";
  // Optional ?codes=A,B,C limits work to a specific subset (for zoom-to-refetch).
  const codesParam = (req.query.codes || "").toString().toUpperCase().split(",").filter(Boolean).slice(0, 30);
  const targets = codesParam.length ? codesParam : DESTINATIONS;
  const keySuffix = codesParam.length ? `:codes:${codesParam.sort().join(",")}` : "";
  const key = `prices:${origin}:${month}:${trip}${keySuffix}`;
  const store = await kv();
  if (req.query.debug === "1") return res.status(200).json({ diag: envSummary() });

  if (store) {
    try {
      const hit = await store.get(key);
      if (hit) {
        res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
        return res.status(200).json({ fallback: false, cached: "kv", data: hit });
      }
    } catch {}
  }

  try {
    const results = await Promise.all(targets.map(async (dest) => {
      const u = new URL("https://api.travelpayouts.com/aviasales/v3/prices_for_dates");
      u.searchParams.set("origin", origin);
      u.searchParams.set("destination", dest);
      u.searchParams.set("currency", "inr");
      u.searchParams.set("one_way", trip === "oneway" ? "true" : "false");
      if (depart) u.searchParams.set("departure_at", month);
      if (ret && trip === "round") u.searchParams.set("return_at", ret.slice(0, 7));
      u.searchParams.set("sorting", "price");
      u.searchParams.set("limit", "3");
      u.searchParams.set("token", token);
      const r = await fetch(u);
      const j = await r.json();
      const offers = (j.data || []).map(o => ({
        air: o.airline, price: o.price, dep: o.departure_at, dur: o.duration,
        stops: o.transfers === 0 ? "Nonstop" : `${o.transfers} stop`,
        ns: o.transfers === 0, link: `https://www.aviasales.com${o.link || ""}`
      }));
      return offers.length ? { code: dest, flights: offers } : null;
    }));
    const data = results.filter(Boolean);

    if (store && data.length) { try { await store.set(key, data, { ex: TTL }); } catch {} }
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({ fallback: data.length === 0, cached: "miss", data });
  } catch (e) {
    return res.status(200).json({ fallback: true, reason: String(e) });
  }
}
