# FareMap ✈️🌍

Type a city, dates and a budget → see **where in the world you can actually afford to go**, drawn as curved price-ribbons across a world map. Built for Indian travellers: the headline number is the **all-in trip cost = flight + visa + stay**, not just the airfare.

`index.html` is a self-contained working prototype (no build step). It runs on demo data today; wire the free API below to go live.

## Features
- 🌍 **All 6 continents** — 24 destinations from Asia to the Americas, Africa, Europe & Oceania.
- 💸 **Budget slider** on all-in trip cost → live "N of 24 fit · cheapest = X".
- 🧳 **Stay-aware** — nights auto-derived from your dates × an est. daily budget per city.
- ✈ **Expandable cards** → top 2 cheapest flights (airline, times, stops, price, Book).
- 🛂 **Visa panel for Indian passport** — cost, processing time, **approval probability**, type badge (visa-free / on-arrival / e-visa / embassy).
- 🎲 **Surprise me** — picks a place you can afford.
- 🔎 Filters: continent, visa-free only, nonstop only · Sort: Cheapest / Easiest visa / Fastest.

## Run locally
```bash
cd flight-price-map
python3 -m http.server 8000   # → http://localhost:8000
```

## Go live — 100% free stack
| Layer | Tool | Cost |
|---|---|---|
| Flight prices | **Travelpayouts (Aviasales) Data API** | Free (+ affiliate revenue on Book links) |
| Backend | `api/prices.js` serverless function | Free on Vercel |
| Visa data | maintained JSON in `index.html` (`DEST[].visa`) | Free (manual upkeep) |
| Hosting | **Vercel** | Free tier, public URL |

### Steps (≈10 min, two free signups)
1. **Travelpayouts** → create a free account at travelpayouts.com, copy your **API token**.
2. **Deploy** → push this folder to GitHub, import into **Vercel** (or run `npx vercel`).
3. In Vercel → Settings → Environment Variables, add `TRAVELPAYOUTS_TOKEN = <token>`, redeploy.
4. The site now serves real cached fares. Until the token is set, `api/prices.js` returns `{fallback:true}` and the map uses its built-in demo data — so it works deployed immediately either way.

> Note: account creation (Travelpayouts, Vercel) must be done by you — they require accepting terms and entering your credentials.

## Important caveats
- **Visa cost / time / approval % are indicative estimates** for Indian passport holders. Rules change often — always confirm on the official embassy/e-visa site before booking. Approval % is a heuristic, **not** a guarantee.
- The free Data API returns **cached** fares (hours–days old), not live-to-the-second. The Book/affiliate link sends users to Aviasales for the exact live price.

## Roadmap
- Hotel API for real stay cost · price-drop email alerts (free cron) · cheapest-month grid · mobile layout · more origin cities.
