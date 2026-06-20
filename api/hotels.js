// Vercel serverless function — cheapest hotel price per city via the FREE
// Hotellook (Travelpayouts) API. Returns the total price for the stay (checkIn→checkOut).
//
// NOTE: the Hotellook "Hotels data" program must be ACTIVATED on your Travelpayouts
// account (separate from flights). Until then this returns {fallback:true} and the
// frontend uses its per-night estimate. No code change needed once enabled.
//
// Docs: https://support.travelpayouts.com/hc/en-us/articles/115000343268-Hotels-data-API

const CITY = {
  KTM:"Kathmandu",CMB:"Colombo",BKK:"Bangkok",TAS:"Tashkent",KUL:"Kuala Lumpur",DOH:"Doha",
  DXB:"Dubai",HKT:"Phuket",HAN:"Hanoi",SGN:"Ho Chi Minh City",MLE:"Male",SIN:"Singapore",
  DPS:"Denpasar",IST:"Istanbul",LHR:"London",CDG:"Paris",NBO:"Nairobi",CAI:"Cairo",
  MRU:"Port Louis",JNB:"Johannesburg",JFK:"New York",YYZ:"Toronto",GRU:"Sao Paulo",SYD:"Sydney",
  ALA:"Almaty",AUH:"Abu Dhabi",MCT:"Muscat",CGK:"Jakarta",HKG:"Hong Kong",ICN:"Seoul",
  PNH:"Phnom Penh",FCO:"Rome",AMS:"Amsterdam",GYD:"Baku",TBS:"Tbilisi",ZNZ:"Zanzibar",
  SEZ:"Victoria",AKL:"Auckland",LAX:"Los Angeles",YVR:"Vancouver"
};

export default async function handler(req, res) {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  const { depart = "", ret = "", codes = "" } = req.query;
  if (!token || !depart || !ret) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ fallback: true, reason: "no token or dates" });
  }
  const wanted = codes ? codes.split(",") : Object.keys(CITY);
  try {
    const out = await Promise.all(wanted.map(async (code) => {
      const city = CITY[code]; if (!city) return null;
      const u = new URL("https://engine.hotellook.com/api/v2/cache.json");
      u.searchParams.set("location", city);
      u.searchParams.set("checkIn", depart);
      u.searchParams.set("checkOut", ret);
      u.searchParams.set("currency", "inr");
      u.searchParams.set("limit", "20");
      u.searchParams.set("token", token);
      try {
        const r = await fetch(u);
        if (!r.ok) return null;
        const arr = await r.json();
        const prices = (Array.isArray(arr) ? arr : []).map(h => h.priceFrom || h.priceAvg).filter(Boolean);
        if (!prices.length) return null;
        return { code, total: Math.round(Math.min(...prices)) }; // cheapest total for the stay
      } catch { return null; }
    }));
    const data = out.filter(Boolean);
    if (!data.length) return res.status(200).json({ fallback: true, reason: "Hotellook returned no data (program not enabled?)" });
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({ fallback: false, data });
  } catch (e) {
    return res.status(200).json({ fallback: true, reason: String(e) });
  }
}
