// Vercel serverless function — live flight prices via the FREE Travelpayouts API.
//
// It holds your token server-side (never exposed to the browser) and returns
// cheapest fares per destination. If no token is set, it returns {fallback:true}
// so the frontend gracefully uses its built-in seeded demo data.
//
// SETUP (one time, free):
//   1. Create a free account at https://www.travelpayouts.com  → get your API token.
//   2. In Vercel: Project → Settings → Environment Variables → add
//        TRAVELPAYOUTS_TOKEN = <your token>
//   3. Redeploy. Done — the site now serves real cached fares.
//
// Docs: https://support.travelpayouts.com/hc/en-us/articles/203956163-Aviasales-Data-API

const DESTINATIONS = ["KTM","CMB","BKK","TAS","KUL","DOH","DXB","HKT","HAN","SGN","MLE","SIN","DPS","IST","LHR","CDG","NBO","CAI","MRU","JNB","JFK","YYZ","GRU","SYD"];

export default async function handler(req, res) {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  const { origin = "DEL", depart = "", ret = "", trip = "round" } = req.query;

  // No token yet → tell the frontend to use its seeded demo data.
  if (!token) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ fallback: true, reason: "TRAVELPAYOUTS_TOKEN not set" });
  }

  try {
    const month = depart ? depart.slice(0, 7) : undefined; // YYYY-MM
    const results = await Promise.all(DESTINATIONS.map(async (dest) => {
      const u = new URL("https://api.travelpayouts.com/aviasales/v3/prices_for_dates");
      u.searchParams.set("origin", origin);
      u.searchParams.set("destination", dest);
      u.searchParams.set("currency", "inr");
      u.searchParams.set("one_way", trip === "oneway" ? "true" : "false");
      if (depart) u.searchParams.set("departure_at", month); // month-level = more cache hits
      if (ret && trip === "round") u.searchParams.set("return_at", ret.slice(0, 7));
      u.searchParams.set("sorting", "price");
      u.searchParams.set("limit", "3");
      u.searchParams.set("token", token);

      const r = await fetch(u);
      const j = await r.json();
      const offers = (j.data || []).map(o => ({
        air: o.airline, price: o.price,
        dep: o.departure_at, dur: o.duration, stops: o.transfers === 0 ? "Nonstop" : `${o.transfers} stop`,
        ns: o.transfers === 0, link: `https://www.aviasales.com${o.link || ""}`
      }));
      return offers.length ? { code: dest, flights: offers } : null;
    }));

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400"); // cache 1h
    return res.status(200).json({ fallback: false, data: results.filter(Boolean) });
  } catch (e) {
    return res.status(200).json({ fallback: true, reason: String(e) });
  }
}
