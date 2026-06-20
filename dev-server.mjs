// Local dev server: serves the static site AND proxies /api/prices & /api/hotels
// to Travelpayouts using a token from the TP_TOKEN env var. Mirrors the Vercel
// functions so you can test live data locally.  Run:
//   TP_TOKEN=your_token node dev-server.mjs 8753
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN = process.env.TP_TOKEN || "";
const PORT = +(process.argv[2] || 8753);
const DIR = path.dirname(fileURLToPath(import.meta.url));

const CITY = {KTM:"Kathmandu",CMB:"Colombo",BKK:"Bangkok",TAS:"Tashkent",KUL:"Kuala Lumpur",DOH:"Doha",DXB:"Dubai",HKT:"Phuket",HAN:"Hanoi",SGN:"Ho Chi Minh City",MLE:"Male",SIN:"Singapore",DPS:"Denpasar",IST:"Istanbul",LHR:"London",CDG:"Paris",NBO:"Nairobi",CAI:"Cairo",MRU:"Port Louis",JNB:"Johannesburg",JFK:"New York",YYZ:"Toronto",GRU:"Sao Paulo",SYD:"Sydney",ALA:"Almaty",AUH:"Abu Dhabi",MCT:"Muscat",CGK:"Jakarta",HKG:"Hong Kong",ICN:"Seoul",PNH:"Phnom Penh",FCO:"Rome",AMS:"Amsterdam",GYD:"Baku",TBS:"Tbilisi",ZNZ:"Zanzibar",SEZ:"Victoria",AKL:"Auckland",LAX:"Los Angeles",YVR:"Vancouver",
  GOI:"Goa",SXR:"Srinagar",IXL:"Leh",COK:"Kochi",MAA:"Chennai",BLR:"Bangalore",HYD:"Hyderabad",BOM:"Mumbai",UDR:"Udaipur",JAI:"Jaipur",VNS:"Varanasi",CCU:"Kolkata",GAU:"Guwahati",IXZ:"Port Blair"};
const CODES = Object.keys(CITY);
const AIR = {AI:"Air India",IX:"AI Express",["6E"]:"IndiGo",UK:"Vistara",SG:"SpiceJet",QR:"Qatar",EK:"Emirates",EY:"Etihad",TG:"Thai",FD:"Thai AirAsia",AK:"AirAsia",VJ:"Vietjet",SQ:"Singapore",MH:"Malaysia",UL:"SriLankan",WY:"Oman Air",TK:"Turkish",BA:"British A.",LH:"Lufthansa",AF:"Air France",KL:"KLM",KE:"Korean",CX:"Cathay",ET:"Ethiopian",KQ:"Kenya",MS:"EgyptAir",MK:"Air Mauritius",QF:"Qantas",NZ:"Air NZ",HY:"Uzbekistan",KC:"Air Astana",J2:"AZAL"};
const cache = new Map();

function hm(min){return `${Math.floor(min/60)}h ${min%60}m`}
function mapOffer(o){
  const t=(o.departure_at||"").slice(11,16);
  return {air:AIR[o.airline]||o.airline,dep:t||"—",arr:"",dur:o.duration?hm(o.duration):"varies",
    stops:o.transfers===0?"Nonstop":`${o.transfers} stop`,ns:o.transfers===0,price:o.price,
    link:"https://www.aviasales.com"+(o.link||"")};
}
async function flightsFor(origin,dest,depart,ret,oneway){
  const key=[origin,dest,depart,ret,oneway].join("|");
  if(cache.has(key))return cache.get(key);
  const u=new URL("https://api.travelpayouts.com/aviasales/v3/prices_for_dates");
  u.searchParams.set("origin",origin);u.searchParams.set("destination",dest);
  u.searchParams.set("currency","inr");u.searchParams.set("sorting","price");u.searchParams.set("limit","3");
  u.searchParams.set("one_way",oneway?"true":"false");
  if(depart)u.searchParams.set("departure_at",depart.slice(0,7));
  if(ret&&!oneway)u.searchParams.set("return_at",ret.slice(0,7));
  u.searchParams.set("token",TOKEN);
  try{const r=await fetch(u);const j=await r.json();const offers=(j.data||[]).map(mapOffer);cache.set(key,offers);return offers;}
  catch{cache.set(key,[]);return[];}
}
async function hotelFor(code,depart,ret){
  const key=["H",code,depart,ret].join("|");
  if(cache.has(key))return cache.get(key);
  const u=new URL("https://engine.hotellook.com/api/v2/cache.json");
  u.searchParams.set("location",CITY[code]);u.searchParams.set("checkIn",depart);u.searchParams.set("checkOut",ret);
  u.searchParams.set("currency","inr");u.searchParams.set("limit","20");u.searchParams.set("token",TOKEN);
  try{const r=await fetch(u);if(!r.ok){cache.set(key,null);return null;}const arr=await r.json();
    const p=(Array.isArray(arr)?arr:[]).map(h=>h.priceFrom||h.priceAvg).filter(Boolean);
    const v=p.length?Math.round(Math.min(...p)):null;cache.set(key,v);return v;}
  catch{cache.set(key,null);return null;}
}

const MIME={".html":"text/html",".js":"text/javascript",".json":"application/json",".css":"text/css",".svg":"image/svg+xml"};

http.createServer(async (req,res)=>{
  const url=new URL(req.url,"http://x");
  const q=Object.fromEntries(url.searchParams);
  if(url.pathname==="/api/prices"){
    if(!TOKEN)return j(res,{fallback:true,reason:"no TP_TOKEN"});
    const data=(await Promise.all(CODES.map(async c=>{const f=await flightsFor(q.origin||"DEL",c,q.depart||"",q.ret||"",q.trip==="oneway");return f.length?{code:c,flights:f}:null;}))).filter(Boolean);
    return j(res,{fallback:data.length===0,data});
  }
  if(url.pathname==="/api/hotels"){
    if(!TOKEN||!q.depart||!q.ret)return j(res,{fallback:true,reason:"no token/dates"});
    const data=(await Promise.all(CODES.map(async c=>{const t=await hotelFor(c,q.depart,q.ret);return t!=null?{code:c,total:t}:null;}))).filter(Boolean);
    return j(res,{fallback:data.length===0,data,reason:data.length?"":"Hotellook empty — enable Hotels program"});
  }
  // static
  let p=path.join(DIR,url.pathname==="/"?"index.html":url.pathname.slice(1));
  if(!p.startsWith(DIR))return res.writeHead(403).end();
  fs.readFile(p,(e,buf)=>{if(e){res.writeHead(404).end("not found");}else{res.writeHead(200,{"content-type":MIME[path.extname(p)]||"text/plain"}).end(buf);}});
}).listen(PORT,()=>console.log(`FareMap dev on http://localhost:${PORT}  (token: ${TOKEN?"set":"MISSING"})`));

function j(res,obj){res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"}).end(JSON.stringify(obj));}
