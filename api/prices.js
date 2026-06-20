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

// Lazy Redis client — works with Vercel KV *or* Upstash Redis env naming.
// (Edge Config will NOT work here: it can't be written to per-request.)
let _kv = null, _kvTried = false;
async function kv() {
  if (_kvTried) return _kv;
  _kvTried = true;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return (_kv = null);
  try {
    const { Redis } = await import("@upstash/redis");
    _kv = new Redis({ url, token });
  } catch { _kv = null; }
  return _kv;
}

export default async function handler(req, res) {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  const { origin = "DEL", depart = "", ret = "", trip = "round" } = req.query;
  if (!token) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ fallback: true, reason: "TRAVELPAYOUTS_TOKEN not set" });
  }

  const month = depart ? depart.slice(0, 7) : "any";
  const key = `prices:${origin}:${month}:${trip}`;
  const store = await kv();

  // 1) durable cache hit
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
    const results = await Promise.all(DESTINATIONS.map(async (dest) => {
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
