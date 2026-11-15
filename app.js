/* Agro · interfaccia. Il modello gira in un Web Worker (model.js); qui si disegna e si parla con il consulente. */
"use strict";
const AM = self.AgroModel, Y0 = AM.Y0, T = AM.T, RHO = [0, 0.05, 0.15, 0.4], RHO_N = ["Piena", "Buona", "Media", "Bassa"];
const $ = id => document.getElementById(id);
const DEF = { example: true, nome: "Azienda di esempio", tipo: "campo", zona: "sud_costa", regione: "Campania", coltura: "pomodoro", ettari: 40, irr: "goccia", resa: 80, prezzo: 140, costo: 7500, acqua: 0.25,
  specie: "bufala", capi: 180, auto: 60, cool: "vent", prod: 2300, prezzoL: 1.75, costoC: 2900, seed: 2026, giovane: false, bio: false, forma: "Ditta individuale", nomeSede: "Sede principale", comune: "Villa Literno", provincia: "", lat: null, lon: null, quota: null, suolo: "medio", giacitura: "pianura", meteo: null, clima: null, mercato: null, volPrezzo: null, sedi: [], sede: 0,
  prefs: { prudenza: 0.4, acqua: 0.05, co2: 30, bio: null, fiducia: 1, budget: null, acquaMax: null }, osservazioni: [], contributi: {}, inverno: { tw: 0, pioggia: 0 } };
const REGIONI = ["Abruzzo", "Basilicata", "Calabria", "Campania", "Emilia-Romagna", "Friuli-Venezia Giulia", "Lazio", "Liguria", "Lombardia", "Marche", "Molise", "Piemonte", "Puglia", "Sardegna", "Sicilia", "Toscana", "Trentino-Alto Adige", "Umbria", "Valle d'Aosta", "Veneto"];

/* ---------- Stato ---------- */
let P = load(), R = null, SE = null, SIM = null, IA = false, lastPlan = null, planChanged = null;
const V = { sc: -1, h: 14, metric: "m", sim: { flex: { v: 0, cal: 0, soil: 0, ipm: 0, sens: 0, ins: 0 }, mask: 0 }, evento: "incendio", quota: 30, reimp: false };
function load() { try { const s = JSON.parse(localStorage.getItem("agro.azienda")); if (s && s.tipo) return merge(s); } catch (e) {} return merge({}); }
/* Sedi: ogni sede ha le sue specifiche. Quella di riferimento è copiata nei campi di P, che tutto il resto usa. */
function SFK() { return ["nomeSede", "comune", "provincia", "lat", "lon", "quota", "regione", "zona", "tipo", "coltura", "ettari", "irr", "resa", "prezzo", "costo", "acqua", "specie", "capi", "auto", "cool", "prod", "prezzoL", "costoC", "suolo", "giacitura", "osservazioni", "contributi", "meteo", "inverno", "clima", "mercato", "volPrezzo", "gps", "stazione", "strumenti", "confini", "collegati", "intervento"]; }
function pickSite(p) { const o = {}; for (const k of SFK()) o[k] = p[k] && typeof p[k] === "object" ? JSON.parse(JSON.stringify(p[k])) : p[k]; return o; }
function merge(s) { const p = Object.assign({}, DEF, s); p.prefs = Object.assign({}, DEF.prefs, s.prefs || {}); p.inverno = Object.assign({}, DEF.inverno, s.inverno || {}); p.osservazioni = s.osservazioni || []; p.contributi = s.contributi || {};
  if (s.tipo && s.comune === undefined && !s.example) p.comune = ""; p.sedi = Array.isArray(s.sedi) && s.sedi.length ? s.sedi : [pickSite(p)]; p.sede = Math.min(Math.max(0, s.sede || 0), p.sedi.length - 1); return p; }
function switchSite(i) { P.sedi[P.sede] = pickSite(P); P.sede = i; Object.assign(P, JSON.parse(JSON.stringify(P.sedi[i]))); resetViews(); save(); recompute(true); }
const zonaAuto = (lat, quota) => lat < 41.7 ? (quota < 150 ? "sud_costa" : "sud_collina") : lat < 44 ? "centro" : "nord";
async function findPlace(nome) { const j = await (await fetch("api/luogo?nome=" + encodeURIComponent(nome))).json(); return j.luoghi || []; }
function applyPlace(l) { P.comune = l.nome; P.provincia = l.provincia; P.lat = l.lat; P.lon = l.lon; P.quota = Math.round(l.quota || 0); if (REGIONI.includes(l.regione)) P.regione = l.regione; P.zona = zonaAuto(l.lat, P.quota); P.meteo = null; P.gps = false; }
/* Dati esterni della sede, letti in automatico: clima storico e ultimi 90 giorni (Open-Meteo, ERA5-Land), previsione a 16 giorni, prezzi Eurostat */
const MKT = { grano: ["apri_ap_crpouta", "01120000", 10, "€/t"], mais: ["apri_ap_crpouta", "01500000", 10, "€/t"], pomodoro: ["apri_ap_crpouta", "04121000", 0], agrumi: ["apri_ap_crpouta", "06210000", 0], olivo: ["apri_ap_crpouta", "08100000", 0],
  bufala: ["apri_ap_anouta", "12112000", 0], bovino: ["apri_ap_anouta", "12112000", 0.01, "€/kg"], ovino: ["apri_ap_anouta", "12112000", 0], carne: ["apri_ap_anouta", "11110000", 0.01, "€/kg"] };   // vino e latte ovino: Eurostat non ha la serie italiana; per bufala e ovini si usa la variabilità del latte bovino
let FCAST = null;
async function meteoLoad() {
  FCAST = null;
  try { if (P.comune && P.lat == null) { const l = await findPlace(P.comune); if (l[0]) applyPlace(l[0]); } } catch (e) {}
  const jobs = [];
  if (P.lat != null) { jobs.push(fetch("api/clima?lat=" + P.lat + "&lon=" + P.lon).then(r => r.json()).then(j => { if (j.errore) throw new Error(j.errore); P.clima = j.clima; P.meteo = j.meteo; if (P.stazione && P.stazione.oggi && P.clima && P.clima.oggi) { P.stazione.rian = { T: (P.clima.oggi.T || []).slice(), H: P.clima.oggi.H }; Object.assign(P.clima.oggi, P.stazione.oggi); } const sg = j.meteo.segnale.inverno; P.inverno = { tw: +(sg.perGrado * j.meteo.dT).toFixed(2), pioggia: 0 }; }).catch(() => { if (!P.meteo) P.inverno = { tw: 0, pioggia: 0 }; }));
    jobs.push(fetch("api/previsioni?lat=" + P.lat + "&lon=" + P.lon).then(r => r.json()).then(j => { if (!j.errore) FCAST = j; }).catch(() => {})); }
  else { P.meteo = null; P.clima = null; P.inverno = { tw: 0, pioggia: 0 }; }
  const mk = MKT[P.tipo === "campo" ? P.coltura : P.specie];
  if (mk) jobs.push(fetch("api/prezzi?ds=" + mk[0] + "&code=" + mk[1]).then(r => r.json()).then(j => { if (j.errore) throw new Error(j.errore); P.mercato = { chiave: P.tipo === "campo" ? P.coltura : P.specie, anno: j.anno, vol: j.vol, dal: j.dal, valore: mk[2] ? +(j.ultimo * mk[2]).toFixed(2) : null, unita: mk[3] || "", nome: j.nome }; P.volPrezzo = j.vol; }).catch(() => { P.mercato = null; P.volPrezzo = null; }));
  await Promise.all(jobs);
}
function save() { P.sedi[P.sede] = pickSite(P); try { localStorage.setItem("agro.azienda", JSON.stringify(P)); } catch (e) {}
  fetch("api/azienda", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(P) }).catch(() => {}); }

/* ---------- Formati ---------- */
const nf = (v, d = 0) => new Intl.NumberFormat("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: "always" }).format(v);
function eur(v) { const a = Math.abs(v); if (a >= 1e6) return nf(v / 1e6, 2) + " mln €"; if (a >= 1e4) return nf(Math.round(v / 100) * 100) + " €"; return nf(Math.round(v / 10) * 10) + " €"; }
const seur = v => (v > 0 ? "+" : "") + eur(v);
const pct = (v, sign) => { const r = Math.round(v * 100); return (sign && r > 0 ? "+" : "") + nf(r === 0 ? 0 : r) + "%"; };
const deg = v => { const r = Math.round(v * 10) / 10; return (r > 0 ? "+" : "") + nf(r === 0 ? 0 : r, 1) + " °C"; };
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
function dateOf(doy) { const d = new Date(2027, 0, 1); d.setDate(Math.round(doy)); return d.getDate() + " " + MESI[d.getMonth()]; }
const giorni = n => { const a = Math.abs(Math.round(n)); return a === 1 ? "1 giorno" : a + " giorni"; };
const field = () => P.tipo === "campo";
const hu = k => ({ capi: "capo", posti: "posto", scrofe: "scrofa", vacche: "vacca", pecore: "pecora", fattrici: "fattrice", alveari: "alveare" })[AM.HERDS[k].u];
const subject = () => field() ? AM.CROPS[P.coltura].name + ", " + nf(P.ettari) + " ha" : AM.HERDS[P.specie].name + ", " + nf(P.capi) + " " + AM.HERDS[P.specie].u;
const L = () => AM.LEVERS(P.tipo);
const SHORT = () => field() ? { W: "Acqua", C: "Riconversione", P: "Protezioni", G: "Nuovo appezzamento" } : { W: "Acqua per i foraggi", C: "Foraggi resistenti", P: "Raffrescamento", G: "Terreni freschi" };
function descId(id) { const f = AM.flexOf(Math.floor(id / 16)), m = id % 16, l = L(), a = []; for (const k of AM.FLEX) if (f[k]) a.push(k === "cal" ? "Calendario " + l.cal.opts[f.cal].toLowerCase() : l[k].name); AM.INV.forEach((k, i) => { if (m & (1 << i)) a.push(l[k].name); }); return a.length ? a : ["Assetto attuale"]; }
function modelPrefs() { const q = P.prefs, ric = R ? R.oggi.ricavo : 0; return { pesi: [10 * (1 - q.prudenza), 10 * q.prudenza], prezzi: { acqua: q.acqua, co2: q.co2, bio: q.bio == null ? Math.round(ric * 0.0005) : q.bio }, rho: RHO[q.fiducia], budget: q.budget, acquaMax: q.acquaMax }; }

/* ---------- Worker ---------- */
const worker = new Worker("model.js"); let seq = 0; const pend = {};
worker.onmessage = e => { const d = e.data, h = pend[d.id]; if (!h) return; if (d.progress != null) { h.prog && h.prog(d.progress); return; } delete pend[d.id]; d.ok ? h.ok(d.result) : h.ko(new Error(d.error)); };
const call = (cmd, data, prog) => new Promise((ok, ko) => { const id = ++seq; pend[id] = { ok, ko, prog }; worker.postMessage(Object.assign({ cmd, id }, data)); });
/* Riscontro immediato: ricordo l'ultimo comando toccato e gli metto una rotella finché il calcolo non finisce */
let lastCtl = null, lastAt = 0;
const touch = e => { const c = e.target.closest && e.target.closest(".seg button,.pick button,button,a.btn,label.switch,label.ctl,select"); if (c) { lastCtl = c; lastAt = Date.now(); } };
addEventListener("pointerdown", touch, true); addEventListener("change", touch, true); addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") touch(e); }, true);
function busy(on, text) { const s = $("status"); s.classList.toggle("busy", on); s.lastElementChild.textContent = on ? (text || "Ricalcolo…") : "Pronto · " + nf(AM.N) + " futuri simulati";
  document.body.classList.toggle("working", on); const w = $("work-t"); if (w && on) w.textContent = text === "Simulo…" ? "Sto simulando…" : "Sto ricalcolando…";
  document.querySelectorAll(".pending").forEach(x => x.classList.remove("pending"));
  if (on && lastCtl && Date.now() - lastAt < 2000 && document.contains(lastCtl)) lastCtl.classList.add("pending"); }
/* Cursori: la parte piena segue il valore */
const fillRange = r => r.style.setProperty("--f", ((r.value - r.min) / ((r.max - r.min) || 1) * 100) + "%");
addEventListener("input", e => { if (e.target.type === "range") fillRange(e.target); }, true);
new MutationObserver(() => document.querySelectorAll("input[type=range]").forEach(fillRange)).observe(document.documentElement, { childList: true, subtree: true });
let job = 0;
async function recompute(full) {
  const my = ++job; busy(true, full ? "Simulo…" : "Ricalcolo…");
  try {
    if (full) { const b = $("boot"); b.classList.remove("off"); b.style.setProperty("--p", 0.05); $("boot-t").textContent = "Leggo clima, meteo e prezzi della sede…"; await meteoLoad(); save();
      await call("init", { P }, f => { b.style.setProperty("--p", f); $("boot-t").textContent = "Provo " + nf(1536) + " combinazioni di scelte su " + nf(AM.N) + " futuri… " + nf(f * 100) + "%"; });
      R = null; }
    if (my !== job) return;
    if (!R) R = await call("solve", { prefs: { pesi: [6, 4], prezzi: {}, rho: 0 }, oss: P.osservazioni });   // prima passata: serve il ricavo per i prezzi di default
    R = await call("solve", { prefs: modelPrefs(), oss: P.osservazioni });
    if (my !== job) return;
    planChanged = lastPlan == null ? null : lastPlan !== R.scelta.id; lastPlan = R.scelta.id;
    $("boot").classList.add("off");
    await seasonCalc(); renderAll();
  } catch (e) { console.error(e); $("boot-t").textContent = "Errore nel calcolo: " + e.message; }
  if (my === job) busy(false);
}
async function seasonCalc() { SE = await call("season", { obs: { tw: P.inverno.tw, pioggia: P.inverno.pioggia }, flex: R.scelta.leve, mask: 0 }); }
let deb = 0; const later = (fn, ms) => { clearTimeout(deb); deb = setTimeout(fn, ms || 350); };

/* ---------- Grafici ---------- */
function ticks(lo, hi, n) { const raw = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(raw || 1))), m = raw / p, st = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p, a = []; for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) a.push(Math.abs(v) < st / 1e6 ? 0 : v); return { a, st }; }
const fmtAx = { eur: (v, st) => v === 0 ? "0" : Math.abs(st) >= 1e6 ? nf(v / 1e6, 1) + " mln" : Math.abs(st) >= 1000 ? nf(v / 1000) + " mila" : nf(v), pct: v => nf(v * 100) + "%", gg: v => nf(v), data: v => dateOf(v), num: v => nf(v) };
/* Ventaglio: fascia 10°-90° percentile, linea mediana, linea di confronto tratteggiata */
function fan(rows, get, base, o) {
  const W = o.w || 760, H = o.h || 290, Lm = o.w ? 58 : 64, Rm = 16, Tp = 14, B = 30, n = rows.length;
  let lo = Infinity, hi = -Infinity; rows.forEach((r, i) => { const g = get(r); lo = Math.min(lo, g[0]); hi = Math.max(hi, g[2]); if (base) { lo = Math.min(lo, base[i]); hi = Math.max(hi, base[i]); } });
  if (o.zero) lo = Math.min(lo, 0); const pad = (hi - lo) * 0.07 || 1; hi += pad; lo -= o.zero && lo >= 0 ? 0 : pad;
  const x = i => Lm + (W - Lm - Rm) * i / (n - 1), y = v => Tp + (H - Tp - B) * (1 - (v - lo) / (hi - lo)), tk = ticks(lo, hi, 4), fa = o.w && o.fmt === "data" ? v => dateOf(v).replace(/ (\w{3})\w*/, " $1") : fmtAx[o.fmt];
  let g = ""; for (const v of tk.a) g += `<line x1="${Lm}" x2="${W - Rm}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="${v === 0 ? 1.6 : 1}"/><text x="${Lm - 8}" y="${y(v) + 4}" text-anchor="end">${fa(v, tk.st)}</text>`;
  for (const i of [3, 13, 23]) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${Y0 + 1 + i}</text>`;
  const up = rows.map((r, i) => `${x(i)},${y(get(r)[2])}`), dn = rows.map((r, i) => `${x(i)},${y(get(r)[0])}`).reverse(), ln = a => a.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const col = o.color || "var(--accent)", bw = (W - Lm - Rm) / (n - 1);
  let hit = ""; rows.forEach((r, i) => { const q = get(r); hit += `<rect class="hit" x="${x(i) - bw / 2}" y="${Tp}" width="${bw}" height="${H - Tp - B}" data-tip="${Y0 + 1 + i}\n${o.tip(q[1])} nell'anno tipico\nTra ${o.tip(q[0])} e ${o.tip(q[2])} 8 volte su 10${base ? "\n" + (o.baseName || "Confronto") + ": " + o.tip(base[i]) : ""}"/>`; });
  const hx = o.mark != null ? x(o.mark) : null;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || "Andamento simulato")}">${g}
  <polygon class="fadein" points="${up.concat(dn).join(" ")}" fill="${col}" fill-opacity=".16" stroke="${col}" stroke-opacity=".35"/>
  ${base ? `<path class="draw" d="${ln(base)}" fill="none" stroke="var(--muted)" stroke-width="1.7" stroke-dasharray="5 5" style="stroke-dasharray:5 5;stroke-dashoffset:0;animation:fade 1s both"/>` : ""}
  <path class="draw" d="${ln(rows.map(r => get(r)[1]))}" fill="none" stroke="${col}" stroke-width="2.7" stroke-linejoin="round"/>
  ${hx != null ? `<line x1="${hx}" x2="${hx}" y1="${Tp}" y2="${H - B}" stroke="var(--est)" stroke-dasharray="2 4"/><circle cx="${hx}" cy="${y(get(rows[o.mark])[1])}" r="5.5" fill="var(--est)" stroke="var(--surface)" stroke-width="2"><animate attributeName="r" values="5.5;8;5.5" dur="2.4s" repeatCount="indefinite"/></circle>` : ""}${hit}</svg>`;
}
/* Curva del margine atteso al variare della data (scheda Stagione) */
/* Periodo principale di raccolta e vendita per coltura: [mese di inizio, mese di fine, mesi di conservazione]. Mesi da 0 (gennaio) a 11. */
const VEND = { grano: [5, 6, 10], tenero: [5, 6, 10], orzo: [5, 5, 10], mais: [8, 9, 10], riso: [8, 9, 10], sorgo: [8, 9, 10], soia: [8, 9, 10], girasole: [7, 8, 10], colza: [5, 6, 10], bietola: [7, 9, 0], legumi: [5, 6, 10], favino: [5, 6, 10], medica: [4, 8, 8],
  pomodoro: [6, 8, 0], patata: [5, 7, 6], melone: [5, 7, 0], peperone: [5, 8, 0], zucchina: [4, 7, 0], insalata: [3, 5, 0], cipolla: [5, 7, 6], carciofo: [1, 3, 0], cavolo: [10, 1, 0], finocchio: [10, 2, 0], fragola: [2, 4, 0],
  olivo: [9, 11, 10], vite: [7, 9, 0], tavola: [6, 9, 1], agrumi: [10, 2, 1], melo: [7, 9, 7], pero: [7, 8, 5], pesco: [5, 7, 0], albicocco: [4, 5, 0], ciliegio: [4, 5, 0], susino: [5, 7, 0], kiwi: [9, 10, 5], nocciolo: [7, 8, 10], mandorlo: [7, 8, 10], castagno: [8, 9, 1] };
function vendCard(se) {
  const v = VEND[P.coltura]; if (!v) return ""; if (V.vendK !== P.coltura) { V.vendK = P.coltura; V.vendOff = 0; }
  const [a, b, cons] = v, n = ((b - a + 12) % 12) + 1, M0 = se.migliore.medio, ric = R.oggi.ricavo, secco = cons >= 8, par = secco ? [0.010, 0.007, 0.001] : cons >= 5 ? [0.030, 0.020, 0.008] : [0.020, 0.025, 0.020];
  const month = m => { const k = (m - a + 12) % 12; if (k < n) { const f = cons <= 1 && n > 1 ? (k === 0 ? 0.06 : k === n - 1 ? -0.04 : 0) : 0; return { tipo: "main", val: M0 + ric * f, nota: f > 0 ? "Inizio campagna: prezzi più alti" : f < 0 ? "Fine campagna: prezzi più bassi" : "Raccolta e vendita" }; }
    const st = k - n + 1; if (st <= cons) return { tipo: "mag", val: M0 + ric * st * (par[0] - par[1] - par[2]), nota: "Vendita da magazzino, " + st + (st === 1 ? " mese" : " mesi") + " dopo" }; return { tipo: "no", val: null, nota: "Nessun prodotto da vendere" }; };
  const all = Array.from({ length: 12 }, (_, m) => month(m)), top = Math.max(...all.filter(x => x.val != null).map(x => Math.abs(x.val)), 1), mid = (a + Math.floor((n - 1) / 2) + (V.vendOff || 0) + 1200) % 12, vis = [-2, -1, 0, 1, 2].map(d => (mid + d + 12) % 12);
  const cap = m => MESI[m][0].toUpperCase() + MESI[m].slice(1), per = n === 1 ? MESI[a] : "da " + MESI[a] + " a " + MESI[b], rc = Math.round(se.raccolta || 0);
  return `<div class="card" id="vend"><div class="card-h"><h2>Margine atteso secondo il periodo di vendita</h2><div class="seg" id="vend-nav" style="width:auto"><button type="button" data-k="-1" aria-label="Mesi precedenti">‹ Prima</button><button type="button" data-k="0" class="${V.vendOff ? "" : "on"}">Periodo principale</button><button type="button" data-k="1" aria-label="Mesi successivi">Dopo ›</button></div></div>
    <p class="note">Per ${esc(AM.CROPS[P.coltura].name.toLowerCase())} il periodo principale di raccolta e vendita va ${per}.${Math.abs(rc) >= 3 ? ` Quest'anno la raccolta è attesa circa ${giorni(rc)} ${rc < 0 ? "prima" : "dopo"} del solito.` : ""} Con «Prima» e «Dopo» guardi gli altri mesi.</p>
    <div class="months">${vis.map(m => { const x = all[m]; return `<div class="mo ${x.tipo}"><div class="mo-bar"><i style="height:${x.val == null ? 0 : Math.max(6, Math.round(Math.abs(x.val) / top * 100))}%;${x.val != null && x.val < 0 ? "background:var(--crit)" : ""}"></i></div><b>${cap(m)}</b><span class="num">${x.val == null ? "—" : eur(x.val)}</span><span class="note">${x.nota}</span></div>`; }).join("")}</div>
    <p class="note">Come leggerlo: ogni colonna è il margine dell'anno se il grosso del prodotto si vende in quel mese. ${cons > 1 ? `Dopo la raccolta il prodotto si conserva fino a ${cons} mesi: il prezzo di solito sale, ma magazzino e cali di peso costano.` : "È un prodotto fresco: fuori dal periodo di raccolta non c'è nulla da vendere."} I premi di prezzo e i costi di conservazione sono valori tipici, da correggere con quelli della tua azienda.</p></div>`;
}
function curve(se) {
  const c = se.curva, W = 760, H = 250, Lm = 64, Rm = 16, Tp = 16, B = 34; let lo = Infinity, hi = -Infinity; c.forEach(r => { lo = Math.min(lo, r.p10); hi = Math.max(hi, r.medio); }); const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const x = i => Lm + (W - Lm - Rm) * i / (c.length - 1), y = v => Tp + (H - Tp - B) * (1 - (v - lo) / (hi - lo)), tk = ticks(lo, hi, 4);
  let g = ""; for (const v of tk.a) g += `<line x1="${Lm}" x2="${W - Rm}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${Lm - 8}" y="${y(v) + 4}" text-anchor="end">${fmtAx.eur(v, tk.st)}</text>`;
  c.forEach((r, i) => { if (i % 3 === 0) g += `<text x="${x(i)}" y="${H - 10}" text-anchor="middle">${dateOf(r.giorno).replace(/ (\w{3})\w*/, " $1")}</text>`; });
  const ln = k => c.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join(""), bi = c.indexOf(se.migliore), ui = c.indexOf(se.abituale), bw = (W - Lm - Rm) / (c.length - 1);
  const area = c.map((r, i) => `${x(i)},${y(r.medio)}`).concat(c.map((r, i) => `${x(i)},${y(r.p10)}`).reverse()).join(" ");
  let hit = ""; c.forEach((r, i) => hit += `<rect class="hit" x="${x(i) - bw / 2}" y="${Tp}" width="${bw}" height="${H - Tp - B}" data-tip="${dateOf(r.giorno)}\nMargine atteso ${eur(r.medio)}\nIn un caso su dieci sotto ${eur(r.p10)}\nRischio di gelo ${pct(r.pGelo)}"/>`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Margine atteso al variare della data">${g}<polygon class="fadein" points="${area}" fill="var(--pri)" fill-opacity=".15"/>
  <path class="draw" d="${ln("medio")}" fill="none" stroke="var(--pri)" stroke-width="2.7"/><path d="${ln("p10")}" fill="none" stroke="var(--muted)" stroke-width="1.4" stroke-dasharray="4 5"/>
  <line x1="${x(ui)}" x2="${x(ui)}" y1="${Tp}" y2="${H - B}" stroke="var(--muted)" stroke-dasharray="2 4"/><text x="${x(ui)}" y="${Tp - 3}" text-anchor="middle">Di solito</text>
  <circle cx="${x(bi)}" cy="${y(se.migliore.medio)}" r="6.5" fill="var(--est)" stroke="var(--surface)" stroke-width="2"><animate attributeName="r" values="6.5;9.5;6.5" dur="2s" repeatCount="indefinite"/></circle>${hit}</svg>`;
}
/* Fronte di Pareto: valore atteso contro casi peggiori */
function scatter() {
  const W = 760, H = 320, Lm = 70, Rm = 18, Tp = 14, B = 40, all = R.nuvola.concat(R.pareto, [R.scelta, R.attuale.sintesi].map(s => ({ medio: s.medio, peggiori: s.peggiori })));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; const lim = R.attuale.sintesi.peggiori - 2.5 * Math.abs(R.scelta.peggiori - R.attuale.sintesi.peggiori) - Math.abs(R.attuale.sintesi.peggiori) * 0.3;
  const pts = all.filter(p => p.peggiori >= lim); pts.forEach(p => { x0 = Math.min(x0, p.peggiori); x1 = Math.max(x1, p.peggiori); y0 = Math.min(y0, p.medio); y1 = Math.max(y1, p.medio); });
  const px = (x1 - x0) * 0.06 || 1, py = (y1 - y0) * 0.08 || 1; x0 -= px; x1 += px; y0 -= py; y1 += py;
  const X = v => Lm + (W - Lm - Rm) * (v - x0) / (x1 - x0), Y = v => Tp + (H - Tp - B) * (1 - (v - y0) / (y1 - y0)), tx = ticks(x0, x1, 5), ty = ticks(y0, y1, 4);
  let g = ""; for (const v of ty.a) g += `<line x1="${Lm}" x2="${W - Rm}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${Lm - 8}" y="${Y(v) + 4}" text-anchor="end">${fmtAx.eur(v, ty.st)}</text>`;
  for (const v of tx.a) g += `<text x="${X(v)}" y="${H - 20}" text-anchor="middle">${fmtAx.eur(v, tx.st)}</text>`;
  g += `<text x="${(Lm + W - Rm) / 2}" y="${H - 3}" text-anchor="middle">Più a destra: perdi meno quando va male →</text>`;
  const tipOf = p => `${descId(p.id).join("\n")}\n\nGuadagno medio ${eur(p.medio)}\nNei futuri peggiori ${eur(p.peggiori)}\nInvestimento ${eur(p.inv)}`;
  let d = ""; R.nuvola.filter(p => p.peggiori >= lim).forEach(p => d += `<circle class="dot" cx="${X(p.peggiori)}" cy="${Y(p.medio)}" r="3" fill="var(--muted)" opacity=".28" data-tip="${esc(tipOf(p))}"/>`);
  R.pareto.filter(p => p.peggiori >= lim).forEach((p, i) => d += `<circle class="dot fadein" style="animation-delay:${0.04 * i}s" cx="${X(p.peggiori)}" cy="${Y(p.medio)}" r="5.5" fill="var(--inv)" opacity=".85" data-id="${p.id}" data-tip="${esc("Sul fronte: nessuna scelta la batte su tutti gli obiettivi\n" + tipOf(p))}"/>`);
  const a = R.attuale.sintesi, s = R.scelta;
  d += `<circle cx="${X(a.peggiori)}" cy="${Y(a.medio)}" r="6" fill="var(--surface)" stroke="var(--muted)" stroke-width="2.5" data-tip="Assetto attuale\nGuadagno medio ${eur(a.medio)}\nNei futuri peggiori ${eur(a.peggiori)}"/><text x="${X(a.peggiori) + 10}" y="${Y(a.medio) + 4}">Oggi</text>`;
  d += `<circle cx="${X(s.peggiori)}" cy="${Y(s.medio)}" r="8" fill="var(--est)" stroke="var(--surface)" stroke-width="2.5" data-tip="${esc("Piano consigliato\n" + tipOf({ id: s.id, medio: s.medio, peggiori: s.peggiori, inv: s.investimento }))}"><animate attributeName="r" values="8;11;8" dur="2.2s" repeatCount="indefinite"/></circle><text x="${X(s.peggiori) + 13}" y="${Y(s.medio) + 4}" style="font-weight:600;fill:var(--ink)">Piano</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Scelte possibili: valore atteso contro casi peggiori">${g}${d}</svg>`;
}
/* Albero delle decisioni a tappe */
function treeSvg() {
  const pc = R.percorso, sh = SHORT(), W = 780, H = 350, nm = a => a.length ? a.map(k => sh[k]).join(" + ") : null;
  const box = (x, y, w, h, t1, t2, col, tip) => `<g class="tnode" data-tip="${esc(tip)}"><rect x="${x}" y="${y - h / 2}" width="${w}" height="${h}" rx="10" fill="var(--surface)" stroke="${col}" stroke-width="2"/><text x="${x + 10}" y="${y - 3}" style="font-weight:600;fill:var(--ink)">${esc(t1)}</text><text x="${x + 10}" y="${y + 13}">${esc(t2)}</text></g>`;
  const link = (x1, y1, x2, y2, col, w) => `<path class="flow" d="M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" opacity=".8"/>`;
  const cols = ["var(--pri)", "var(--est)", "var(--aut)"], ys = [78, 185, 292]; let s = "", flexN = AM.FLEX.filter(k => pc.leve[k]).length;
  pc.nodi.forEach((n, i) => { s += link(206, 185, 300, ys[i], cols[i], 1.5 + 5 * n.prob);
    n.rami.forEach((r, j) => { const y = ys[i] + (j ? 26 : -26); s += link(486, ys[i], 560, y, cols[i], 1.2 + 6 * r.prob);
      s += box(560, y, 204, 40, r.nome + " · " + pct(r.prob), nm(r.aggiungi) ? "Aggiungi: " + nm(r.aggiungi) : "Niente da aggiungere", cols[i], `2036 · ${n.nome}, ${r.nome.toLowerCase()}\n${r.aggiungi.length ? "Aggiungi: " + r.aggiungi.map(k => L()[k].name).join("; ") : "Nessun nuovo investimento"}`); });
    s += box(300, ys[i], 186, 46, n.nome + " · " + pct(n.prob), nm(n.aggiungi) ? "Aggiungi: " + nm(n.aggiungi) : "Non investire ancora", cols[i], `2031 · ${n.nome}\n${n.aggiungi.length ? "Aggiungi: " + n.aggiungi.map(k => L()[k].name).join("; ") : "Nessun nuovo investimento: continua a misurare"}`); });
  s += box(16, 185, 190, 58, "Ora", nm(pc.ora) ? "Investi: " + nm(pc.ora) : flexN + " mosse reversibili", "var(--accent)", `2027\n${pc.ora.length ? "Investi subito: " + pc.ora.map(k => L()[k].name).join("; ") + "\n" : ""}Più ${flexN} mosse reversibili, riviste ogni anno`);
  s += `<text x="16" y="16" style="font-weight:600">2027</text><text x="300" y="16" style="font-weight:600">2031</text><text x="560" y="16" style="font-weight:600">2036</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Percorso a tappe">${s}</svg>`;
}
const bar = (name, frac, val, col, neg, tip) => `<div class="bar" ${tip ? `data-tip="${esc(tip)}"` : ""}><span>${name}</span><span class="t"><i class="${neg ? "neg" : ""}" style="${neg ? "right:0" : "left:0"};width:${Math.max(1.5, Math.min(100, frac * 100))}%;--c:${col || "var(--accent)"}"></i></span><b class="num">${val}</b></div>`;
const tile = (k, v, s, chipCls, chipTxt, c) => `<div class="card tile" style="--c:${c || "var(--line)"}"><span class="k">${k}</span><span class="v num">${v}</span><span class="s">${chipTxt ? `<span class="chip ${chipCls}">${chipTxt}</span>` : ""}${s || ""}</span></div>`;
const sev = (v, a, b) => v < a ? "good" : v < b ? "warn" : "crit";
function seg(id, items, cur, on) { const el = $(id); if (!el) return; el.innerHTML = items.map(([k, l]) => `<button type="button" data-k="${k}" class="${String(k) === String(cur) ? "on" : ""}">${l}</button>`).join(""); el.onclick = e => { const b = e.target.closest("button"); if (!b) return; el.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); on(b.dataset.k); }; }
const ICO = [
  `<svg class="ico" viewBox="0 0 44 44"><g stroke="var(--inv)" stroke-width="2.4" stroke-linecap="round"><g class="spin"><path d="M22 6v32M8 14l28 16M8 30l28-16"/></g></g><circle class="fall" cx="8" cy="8" r="1.8" fill="var(--inv)"/><circle class="fall b" cx="36" cy="10" r="1.8" fill="var(--inv)"/><circle class="fall c" cx="30" cy="4" r="1.5" fill="var(--inv)"/></svg>`,
  `<svg class="ico" viewBox="0 0 44 44"><path d="M6 38h32" stroke="var(--muted)" stroke-width="2.4" stroke-linecap="round"/><g class="sprout"><path d="M22 38V16" stroke="var(--pri)" stroke-width="2.8" stroke-linecap="round"/><path d="M22 26c-9-1-12-7-12-11 7 0 12 4 12 11zM22 20c8-1 11-6 11-10-6.5 0-11 4-11 10z" fill="var(--pri)"/></g></svg>`,
  `<svg class="ico" viewBox="0 0 44 44"><circle cx="22" cy="22" r="8" fill="var(--est)"/><g class="spin" stroke="var(--est)" stroke-width="2.6" stroke-linecap="round"><path d="M22 4v6M22 34v6M4 22h6M34 22h6M9.3 9.3l4.2 4.2M30.5 30.5l4.2 4.2M9.3 34.7l4.2-4.2M30.5 13.5l4.2-4.2"/></g></svg>`,
  `<svg class="ico" viewBox="0 0 44 44"><path d="M22 4v10" stroke="var(--muted)" stroke-width="2.2" stroke-linecap="round"/><g class="leaf"><path d="M22 14c10 4 12 14 6 22-10-2-14-12-6-22z" fill="var(--aut)"/><path d="M22 14c1 8 2 14 6 22" stroke="var(--surface)" stroke-width="1.4" fill="none"/></g><path class="fall b" d="M8 10l4 3-4 2z" fill="var(--aut)"/></svg>`];
const SC = ["var(--inv)", "var(--pri)", "var(--est)", "var(--aut)"];

/* ---------- Viste ---------- */
function renderAll() { $("farmline").innerHTML = esc(P.nome) + " · " + (P.sedi.length > 1 ? `<select id="sede-sel" aria-label="Sede di riferimento" style="padding:3px 6px;font-size:13px">${P.sedi.map((x, i) => `<option value="${i}" ${i === P.sede ? "selected" : ""}>${esc(x.nomeSede || "Sede " + (i + 1))}</option>`).join("")}</select>` : esc(P.nomeSede)) + " · " + esc(subject()) + (P.comune ? " · " + esc(P.comune) : "") + (P.example ? " · Dati di esempio" : "");
  if ($("sede-sel")) $("sede-sel").onchange = e => switchSite(+e.target.value);
  vStagione(); vPrevisione(); vSim(); vPiano(); vPerche(); vRobustezza(); vDati(); vDiagnosi(); vImprevisti(); vBandi(); vAzienda(); vSensori(); chips(); if (!$("msgs").children.length) intro(); }
const exb = () => P.example ? `<div class="card" style="border-style:dashed;border-color:var(--est);flex-direction:row;justify-content:space-between;flex-wrap:wrap;align-items:center"><span>Stai guardando un'azienda di esempio. I risultati cambiano con i tuoi numeri.</span>${logged() ? `<a href="#azienda" class="btn ghost">Inserisci i tuoi dati</a>` : `<a href="#registrati" class="btn">Crea il tuo account</a>`}</div>` : "";

function vStagione() {
  const se = SE, b = se.migliore, k = se.tipo, fase = se.fase.toLowerCase(), on = se.inizio.m, early = Math.round(-on);
  const quando = early >= 2 ? `<em>${giorni(early)} prima</em> del solito` : early <= -2 ? `<em>${giorni(early)} dopo</em> il solito` : `<em>nella norma</em>`;
  let verdict;
  if (k === "spring") verdict = Math.abs(b.spost) >= 3 ? `Primavera attesa ${quando}: ${fase} intorno al <em>${dateOf(b.giorno)}</em> invece del ${dateOf(se.normale)}.` : `Primavera attesa ${quando}: tieni la data abituale, ${fase} intorno al <em>${dateOf(se.normale)}</em>.`;
  else { const nat = b.giorno - b.spost; verdict = `Primavera attesa ${quando}: ${fase} intorno al <em>${dateOf(nat)}</em>${Math.abs(nat - se.normale) >= 3 ? `, di solito il ${dateOf(se.normale)}` : ""}.${Math.abs(b.spost) >= 3 ? ` Conviene ${b.spost > 0 ? "ritardarlo" : "anticiparlo"} di <em>${giorni(b.spost)}</em>.` : ""}`; }
  const act = [];
  if (k === "spring" && Math.abs(b.spost) >= 3) act.push(`Prepara terreno e piantine per il ${dateOf(b.giorno)}. Rispetto alla data abituale il margine atteso sale di ${eur(se.guadagno)}, in media.`);
  if (k === "tree") act.push(b.spost > 2 ? `Ritarda la potatura di ${giorni(b.spost)} per frenare il germogliamento: con una primavera precoce le gemme restano esposte al gelo più a lungo.` : `Non serve cambiare la potatura: il germogliamento atteso resta lontano dal periodo delle gelate.`);
  if (k === "winter" && field()) act.push(b.spost < -2 ? `Scegli una varietà a ciclo più corto di circa ${giorni(b.spost)}: la spigatura anticipata evita il caldo di fine primavera.` : `Mantieni il ciclo abituale.`);
  if (!field()) act.push(`Primo sfalcio dei foraggi atteso intorno al ${dateOf(b.giorno)}. In estate sono attesi ${nf(se.caldo.m)} giorni sopra 32 °C contro i ${nf(se.caldoNormale)} normali: controlla ventilazione e punti d'acqua entro maggio.`);
  if (b.pGelo > 0.08) act.push(`Rischio di gelo dopo ${fase}: ${pct(b.pGelo)}. Tieni pronta una protezione e guarda le minime previste nella settimana.`);
  if (se.stagioni[2].pSecco > 0.45) act.push(`Estate probabilmente secca: ${pct(se.stagioni[2].pSecco)} di probabilità di piogge sotto l'80% del normale. Prenota i turni irrigui e controlla l'impianto prima di giugno.`);
  if (field() && se.caldo.m > se.caldoNormale + 4) act.push(`Attesi ${nf(se.caldo.m)} giorni sopra 32 °C contro i ${nf(se.caldoNormale)} normali: ombreggia dove puoi e irriga nelle ore fresche.`);
  if (se.acqua.m < 0.92) act.push(`Acqua irrigua attesa al ${pct(se.acqua.m)} del normale: decidi adesso quali appezzamenti hanno la precedenza.`);
  if (Math.abs(se.raccolta) >= 4) act.push(`Raccolta attesa circa ${giorni(se.raccolta)} ${se.raccolta < 0 ? "prima" : "dopo"} del solito: avvisa chi ritira il prodotto e la manodopera.`);
  if (field()) act.push(`Una settimana prima di ${fase} riapri questa pagina: con la previsione a 16 giorni la data può spostarsi di qualche giorno.`);
  if (field()) act.push(`Prima dell'estate controlla impianto irriguo e scorte d'acqua: sono attesi ${nf(se.pioggiaNormale[2] * (1 + se.stagioni[2].pioggia))} mm di pioggia estiva, contro i ${nf(se.pioggiaNormale[2])} di un'estate normale.`);
  else act.push(`Prima dell'estate verifica le scorte di foraggio e gli accordi di acquisto: con il caldo la produzione dei prati cala.`);
  act.push(`A fine stagione registra cosa è successo in <a href="#dati">Dati da raccogliere</a>: il piano di lungo periodo si aggiorna.`);
  const gl = b.pGelo, cl0 = P.clima && P.clima.oggi && P.clima.oggi.T ? P.clima.oggi : null;
  $("v-stagione").innerHTML = `${exb()}
  <div><p class="eyebrow" style="--c:var(--pri)">Stagione ${se.anno} · ${esc(subject())}</p><h1 class="verdict">${verdict}</h1></div>
  ${meteoCard()}
  ${fcCard()}
  <div class="grid g4">
    ${tile("Inizio della primavera", dateOf(se.inizioNormale + on), `Tra il ${dateOf(se.inizioNormale + se.inizio.p10)} e il ${dateOf(se.inizioNormale + se.inizio.p90)}`, early >= 2 ? "acc" : "calm", early >= 2 ? giorni(early) + " prima" : early <= -2 ? giorni(early) + " dopo" : "Nella norma", "var(--pri)")}
    ${tile("Ultima notte sotto 2 °C", dateOf(se.gelata.m), `Fino al ${dateOf(se.gelata.p90)} in un caso su dieci`, sev(gl, 0.05, 0.15), gl < 0.05 ? "Rischio basso" : gl < 0.15 ? "Da seguire" : "Rischio alto", "var(--inv)")}
    ${tile("Giorni sopra 32 °C in estate", nf(se.caldo.m), `Normale ${nf(se.caldoNormale)}`, sev(se.caldo.m - se.caldoNormale, 3, 8), se.caldo.m - se.caldoNormale < 3 ? "Nella norma" : "Più caldo", "var(--est)")}
    ${tile("Acqua irrigua disponibile", pct(se.acqua.m), `Tra ${pct(se.acqua.p10)} e ${pct(se.acqua.p90)}`, sev(1 - se.acqua.m, 0.06, 0.15), se.acqua.m > 0.94 ? "Regolare" : "Scarsa", "var(--aut)")}
  </div>
  <div class="card"><div class="card-h"><h2>${k === "spring" ? "Margine atteso secondo la data di " + fase : "Margine atteso secondo l'anticipo o il ritardo del ciclo"}</h2>
    <div class="legend"><span><i class="sw l" style="border-color:var(--pri)"></i>Margine medio</span><span><i class="sw d"></i>Un caso su dieci va peggio di così</span><span><i style="display:inline-block;width:11px;height:11px;border-radius:50%;background:var(--est);margin-right:6px;vertical-align:-1px"></i>Data consigliata: ${dateOf(b.giorno)}</span></div></div>
    <div class="chart">${curve(se)}</div>
    <p class="note">${k === "spring" ? `Le date provate dipendono dalla coltura. Per ${esc(AM.CROPS[P.coltura].name.toLowerCase())} la data abituale di ${fase} in questa zona è il ${dateOf(se.normale)}: provo una data ogni ${se.finestra.passo} giorni, da ${se.finestra.prima} giorni prima a ${se.finestra.dopo} giorni dopo, cioè dal ${dateOf(se.curva[0].giorno)} al ${dateOf(se.curva[se.curva.length - 1].giorno)}. Guardo più indietro che avanti perché la domanda utile è quanto si può anticipare senza prendere il gelo.` : `Le date provate dipendono dalla coltura. Qui ${fase} non si sceglie: segue la stagione. Quello che puoi spostare è il ciclo, con la potatura o con la varietà, e solo di pochi giorni: per questo provo da ${se.finestra.prima} giorni prima a ${se.finestra.dopo} giorni dopo la data attesa, dal ${dateOf(se.curva[0].giorno)} al ${dateOf(se.curva[se.curva.length - 1].giorno)}.`} Il pallino giallo è la data che dà il miglior equilibrio tra margine medio e annate peggiori; la linea tratteggiata verticale è la data abituale.</p></div>
  ${field() ? vendCard(se) : ""}
  <div class="card" style="gap:6px"><h2>Le quattro stagioni del ${se.anno}</h2><p class="note">Ogni riquadro confronta la stagione attesa con una stagione normale, cioè ${cl0 ? `la media delle stesse stagioni dal 2016 al 2025 a ${esc(P.comune)}` : "il clima tipico della zona"}. Esempio: «10% di pioggia in meno» vuol dire che, dove di solito cadono 100 mm, ne sono attesi 90. In basso c'è la probabilità che la stagione sia nettamente più calda (almeno 0,4 °C) o più secca (almeno il 20% di pioggia in meno).</p></div>
  <div class="seasons">${se.stagioni.map((s, i) => { const un = ["un inverno", "una primavera", "un'estate", "un autunno"][i] + " normale", mm = se.pioggiaNormale[i], pp = Math.round(s.pioggia * 100);
    return `<div class="card season" style="--c:${SC[i]}"><h3>${s.nome}${ICO[i]}</h3>
    <div class="kv" style="grid-template-columns:1fr;gap:10px"><span><b class="num">${deg(s.temp)}</b>${Math.abs(s.temp) < 0.05 ? "Temperatura come al solito" : s.temp > 0 ? "Più caldo del solito" : "Più freddo del solito"}${cl0 ? `<br><span class="d calm">${nf(cl0.T[i] + s.temp, 1)} °C attesi, contro ${nf(cl0.T[i], 1)} °C di ${un}</span>` : ""}</span>
    <span><b class="num">${pp === 0 ? "0%" : (pp > 0 ? "+" : "−") + Math.abs(pp) + "%"}</b>${pp === 0 ? "Pioggia come al solito" : pp > 0 ? "Più pioggia del solito" : "Meno pioggia del solito"}<br><span class="d calm">${nf(mm * (1 + s.pioggia))} mm attesi, contro ${nf(mm)} mm di ${un}</span></span></div>
    <div class="tags"><span class="chip ${s.pCaldo > 0.55 ? "warn" : "calm"}">Più calda: ${pct(s.pCaldo)}</span><span class="chip ${s.pSecco > 0.45 ? "warn" : "calm"}">Più secca: ${pct(s.pSecco)}</span></div></div>`; }).join("")}</div>
  <div class="card"><h2>${act.length > 1 ? "Cosa fare, in ordine" : "Cosa fare"}</h2><ol class="list"${act.length > 1 ? "" : ' style="list-style:none;padding-left:0"'}>${act.map(a => `<li>${a}</li>`).join("")}</ol></div>
  <p class="note">Come nasce la previsione: tra i ${nf(AM.N)} futuri simulati per il ${se.anno} tengo quelli compatibili con il meteo rilevato (circa ${nf(se.campione)} pesano davvero) e provo ogni data su ciascuno. È un'indicazione statistica dimostrativa, non un bollettino meteo.</p>`;
  bindVend();
}
function bindVend() { const nv = $("vend-nav"); if (!nv) return; nv.onclick = e => { const b = e.target.closest("button"); if (!b) return; const k = +b.dataset.k; V.vendOff = k ? Math.max(-6, Math.min(6, (V.vendOff || 0) + k)) : 0; $("vend").outerHTML = vendCard(SE); bindVend(); }; }
function meteoCard() { const m = P.meteo, fd = d => new Date(d).toLocaleDateString("it-IT", { day: "numeric", month: "long" });
  if (!m) return `<div class="card" style="border-style:dashed"><div class="card-h"><h2>Meteo della sede non ancora rilevato</h2><a class="btn ghost" href="#azienda">Indica il comune della sede</a></div><p class="note">Con il comune della sede leggiamo da soli clima, temperature e piogge. Per ora la previsione parte da una stagione nella norma.</p></div>`;
  const sg = m.segnale, r = Math.abs(sg.inverno.r), forza = r < 0.25 ? "quasi nulla" : r < 0.5 ? "debole" : "buona";
  return `<div class="card" style="border-top:3px solid var(--inv)"><div class="card-h"><h2>Meteo rilevato in automatico a ${esc(P.comune)}</h2><span class="chip acc">Si aggiorna da solo</span></div>
    <div class="kv"><span><b class="num">${deg(m.dT)}</b>Temperatura rispetto agli ultimi dieci anni<br><span class="d calm">${deg(m.dT30)} rispetto al 1991-2020</span></span><span><b class="num">${(m.pioggia > 0 ? "+" : "") + m.pioggia}%</b>Piogge rispetto agli ultimi dieci anni<br><span class="d calm">${(m.pioggia30 > 0 ? "+" : "") + m.pioggia30}% rispetto al 1991-2020</span></span><span><b class="num">${m.giorni} giorni</b>Dal ${fd(m.dal)} al ${fd(m.al)}: ${nf(m.temp, 1)} °C in media, ${nf(m.mm)} mm</span></div>
    <p class="note">Quanto conta per la primavera: negli ultimi ${sg.anni} anni, in questa sede, lo stesso periodo ha anticipato l'inverno successivo in modo <b>${forza}</b> (correlazione ${nf(sg.inverno.r, 2)}). ${r < 0.25 ? "Per questo oggi la previsione resta vicina alla norma: diventa utile da gennaio-febbraio, quando si misura l'inverno vero." : "Il segnale entra nella previsione in proporzione a questa forza."} Fonte: Open-Meteo, rianalisi ERA5-Land e ERA5.</p></div>`; }
function fcCard() { const f = FCAST; if (!f) return ""; const n = f.giorni.length, W = 760, H = 190, Lm = 40, Rm = 12, Tp = 12, B = 26, lo = Math.min(...f.min) - 1, hi = Math.max(...f.max) + 1, pm = Math.max(...f.pioggia, 5);
  const x = i => Lm + (W - Lm - Rm) * (i + 0.5) / n, y = v => Tp + (H - Tp - B) * (1 - (v - lo) / (hi - lo)), bw = (W - Lm - Rm) / n, ln = a => a.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(""), fd = d => { const q = new Date(d); return q.getDate() + "/" + (q.getMonth() + 1); };
  let g = ""; f.giorni.forEach((d, i) => { const hh = (H - Tp - B) * 0.5 * f.pioggia[i] / pm; g += `<rect x="${x(i) - bw * 0.3}" y="${H - B - hh}" width="${bw * 0.6}" height="${hh}" rx="2" fill="var(--inv)" opacity=".45"/>${i % 3 === 0 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${fd(d)}</text>` : ""}<rect class="hit" x="${x(i) - bw / 2}" y="${Tp}" width="${bw}" height="${H - Tp - B}" data-tip="${new Date(d).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}\nMinima ${nf(f.min[i], 1)} °C, massima ${nf(f.max[i], 1)} °C\nPioggia ${nf(f.pioggia[i], 1)} mm\nEvapotraspirazione ${nf(f.et0[i], 1)} mm"/>`; });
  for (const v of [Math.ceil(lo / 5) * 5, Math.floor(hi / 5) * 5]) g += `<line x1="${Lm}" x2="${W - Rm}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${Lm - 6}" y="${y(v) + 4}" text-anchor="end">${v}°</text>`;
  const imin = f.min.indexOf(Math.min(...f.min)), cold = f.min.filter(v => v < 2).length, hot = f.max.filter(v => v > 32).length, rain = f.pioggia.reduce((a, b) => a + b, 0), et = f.et0.reduce((a, b) => a + b, 0), bil = rain - et;
  return `<div class="card"><div class="card-h"><h2>I prossimi ${n} giorni</h2><div class="legend"><span><i class="sw l" style="border-color:var(--aut)"></i>Massima</span><span><i class="sw l" style="border-color:var(--inv)"></i>Minima</span><span><i class="sw" style="background:var(--inv);opacity:.45;border:0"></i>Pioggia</span></div></div>
    <div class="kv" style="grid-template-columns:repeat(4,minmax(0,1fr))"><span><b class="num">${nf(f.min[imin], 1)} °C</b>Minima più bassa, il ${fd(f.giorni[imin])}</span><span><b class="num ${cold ? "crit" : ""}">${cold}</b>Notti sotto 2 °C</span><span><b class="num">${nf(rain)} mm</b>Pioggia prevista</span><span><b class="num ${bil < -15 ? "warn" : ""}">${(bil > 0 ? "+" : "") + nf(bil)} mm</b>Pioggia meno evapotraspirazione</span></div>
    <div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Previsione a ${n} giorni">${g}<path class="draw" d="${ln(f.max)}" fill="none" stroke="var(--aut)" stroke-width="2.4"/><path class="draw" d="${ln(f.min)}" fill="none" stroke="var(--inv)" stroke-width="2.4"/></svg></div>
    <p class="note">${cold ? "Sono previste notti fredde: proteggi le colture sensibili. " : ""}${hot ? "Previsti " + hot + " giorni sopra 32 °C. " : ""}${field() && bil < -15 ? "Il suolo perde più acqua di quanta ne riceve: tieni conto di circa " + nf(-bil) + " mm da reintegrare dove irrighi. " : ""}Fonte: Open-Meteo Forecast.</p></div>`; }
function vPrevisione() {
  const s = V.sc, rows = s < 0 ? R.attuale.anni : R.attuale.perScenario[s], plan = s < 0 ? R.percorso.anni : R.percorso.perScenario[s], cl = s < 0 ? R.clima.tutti : R.clima.scenari[s], h = V.h, y = rows[h - 1], yr = Y0 + h, c = cl[h - 1], f = field();
  const m0 = rows[0].p50, dM = m0 ? y.p50 / m0 - 1 : 0, lw = rows.slice(Math.max(0, h - 5), h).reduce((a, r) => a + r.loss, 0) / Math.min(5, h);
  const on = Math.round(-c.on[1]);
  $("v-previsione").innerHTML = `<div><p class="eyebrow" style="--c:var(--inv)">Previsione · Che cosa potrebbe accadere</p>
    <h1 class="verdict">Se non cambi nulla, nel ${yr} il margine di un anno tipico è <em>${eur(y.p50)}</em> e la primavera inizia <em>${on > 0 ? giorni(on) + " prima" : "come oggi"}</em>.</h1></div>
  <div class="controls"><div class="ctl">Traiettoria delle emissioni<div class="seg" id="seg-sc"></div></div><div class="ctl">Orizzonte<div class="seg" id="seg-h"></div></div></div>
  <div class="grid g4">
    ${tile("Margine annuo nel " + yr, eur(y.p50), "Nel " + (Y0 + 1) + ": " + eur(m0), sev(-dM, 0.05, 0.2), pct(dM, true), "var(--accent)")}
    ${tile("Rischio di chiudere l'anno in perdita", pct(lw), `Media ${yr - 4}-${yr}`, sev(lw, 0.1, 0.25), lw < 0.1 ? "Basso" : lw < 0.25 ? "Da seguire" : "Alto", "var(--aut)")}
    ${f ? tile("Fabbisogno d'acqua non coperto", pct(y.def), `Nel ${Y0 + 1}: ${pct(rows[0].def)}`, sev(y.def - rows[0].def, 0.03, 0.08), y.def - rows[0].def < 0.03 ? "Stabile" : "In aumento", "var(--inv)") : tile("Giorni sopra 32 °C", nf(c.hot[1]), `Oggi ${nf(R.normali.caldo)}`, sev(c.hot[1] - R.normali.caldo, 5, 12), c.hot[1] - R.normali.caldo < 5 ? "Stabile" : "In aumento", "var(--est)")}
    ${tile((f ? "Resa" : "Produzione per capo") + " nel " + yr, pct(y.y50 - 1, true), "Rispetto a oggi", sev(1 - y.y50, 0.04, 0.12), 1 - y.y50 < 0.04 ? "Tiene" : "In calo", "var(--pri)")}
  </div>
  <div class="card"><div class="card-h"><h2>${V.metric === "m" ? "Margine annuo" : f ? "Resa rispetto a oggi" : "Produzione per capo rispetto a oggi"}, ${Y0 + 1}-${Y0 + T}</h2><div class="seg" id="seg-m"></div></div>
    <div class="legend"><span><i class="sw l"></i>Se non cambi nulla: anno tipico</span><span><i class="sw"></i>Dove cade 8 volte su 10</span><span><i class="sw d"></i>Con il piano consigliato</span></div>
    <p class="note">Come leggerlo: la linea è l'anno tipico, la fascia mostra quanto può andare meglio o peggio. Sotto lo zero l'anno chiude in perdita. Il pallino segna l'anno scelto in alto.</p>
    <div class="chart">${fan(rows, V.metric === "m" ? r => [r.p10, r.p50, r.p90] : r => [r.y10, r.y50, r.y90], plan.map(r => V.metric === "m" ? r.p50 : r.y50), { fmt: V.metric === "m" ? "eur" : "pct", zero: V.metric === "m", mark: h - 1, tip: V.metric === "m" ? eur : v => pct(v - 1, true), baseName: "Con il piano" })}</div></div>
  <div class="card"><h2>Le stagioni che si spostano</h2><p class="note">Stessa lettura: linea per l'anno tipico, fascia per 8 anni su 10. Se la linea scende, la data arriva prima.</p>
    <div class="grid g3">
      <div><h3 style="margin-bottom:6px">Inizio della primavera</h3><div class="chart sm">${fan(cl, r => r.on.map(v => R.normali.inizio + v), null, { fmt: "data", w: 380, h: 230, color: "var(--pri)", mark: h - 1, tip: dateOf })}</div></div>
      <div><h3 style="margin-bottom:6px">Ultima notte sotto 2 °C</h3><div class="chart sm">${fan(cl, r => r.fr, null, { fmt: "data", w: 380, h: 230, color: "var(--inv)", mark: h - 1, tip: dateOf })}</div></div>
      <div><h3 style="margin-bottom:6px">Giorni sopra 32 °C</h3><div class="chart sm">${fan(cl, r => r.hot, null, { fmt: "gg", w: 380, h: 230, color: "var(--est)", mark: h - 1, tip: v => nf(v) + " giorni" })}</div></div>
    </div>
    <div class="tablewrap"><table><thead><tr><th>Anno</th><th>Inverno</th><th>Primavera</th><th>Estate</th><th>Autunno</th><th>Pioggia di primavera</th><th>Pioggia d'estate</th><th>Acqua irrigua</th></tr></thead><tbody>
    ${[4, 14, 24].map(i => { const q = cl[i - 1], t = k => deg(q[k][1]); return `<tr><td>${Y0 + i}</td><td class="num">${t("Tw")}</td><td class="num">${t("Ts")}</td><td class="num">${t("Tu")}</td><td class="num">${t("Ta")}</td><td class="num">${pct(q.Rs[1] / R.normali.pioggia[1] - 1, true)}</td><td class="num">${pct(q.Ru[1] / R.normali.pioggia[2] - 1, true)}</td><td class="num">${pct(q.av[1])}</td></tr>`; }).join("")}</tbody></table></div></div>
  ${climaCard()}
  <p class="note">Da dove vengono i numeri: ${nf(R.traiettorie)} futuri possibili, ognuno lungo ${T} anni. ${R.normali.daDati ? "Il clima di partenza è misurato sulla storia della sede; come cambierà è un'ipotesi." : "Il clima di partenza è quello tipico della zona; come cambierà è un'ipotesi."} I futuri differiscono per emissioni (${R.scenari.map(x => x.nome.toLowerCase().replace("emissioni ", "") + " " + pct(x.peso)).join(", ")}), modello climatico, risposta della coltura, meteo dell'anno e prezzi.</p>`;
  seg("seg-sc", [[-1, "Tutte"]].concat(R.scenari.map((x, i) => [i, x.nome.replace("Emissioni ", "")])), V.sc, k => { V.sc = +k; vPrevisione(); });
  seg("seg-h", [[4, "2030"], [14, "2040"], [24, "2050"]], h, k => { V.h = +k; vPrevisione(); });
  seg("seg-m", [["m", "Margine"], ["y", f ? "Resa" : "Produzione"]], V.metric, k => { V.metric = k; vPrevisione(); });
}

function climaCard() { const c = P.clima; if (!c) return ""; const o = c.oggi, r = c.riferimento, ip = R.normali.ipotesiEstate, on = r.O - o.O;
  return `<div class="card" style="border-top:3px solid var(--est)"><div class="card-h"><h2>Il clima di ${esc(P.comune)}, dai dati</h2><span class="note">Media 2016-2025 a confronto con 1991-2020 · ERA5-Land</span></div>
    <div class="kv" style="grid-template-columns:repeat(4,minmax(0,1fr))"><span><b class="num">${deg(o.T[2] - r.T[2])}</b>Estate già più calda: ${nf(o.T[2], 1)} °C contro ${nf(r.T[2], 1)}</span><span><b class="num">${nf(o.H)} giorni</b>Sopra 32 °C all'anno, erano ${nf(r.H)}</span><span><b class="num">${on > 0 ? giorni(on) + " prima" : on < 0 ? giorni(on) + " dopo" : "Invariato"}</b>Inizio della primavera: ${dateOf(o.O)} contro ${dateOf(r.O)}</span><span><b class="num">${nf(o.R.reduce((a, b) => a + b, 0))} mm</b>Pioggia all'anno, erano ${nf(r.R.reduce((a, b) => a + b, 0))}</span></div>
    <div class="bars">${["Inverno", "Primavera", "Estate", "Autunno"].map((n, k) => bar(n + ": tendenza misurata " + c.periodo[0] + "-" + c.periodo[1], Math.abs(c.tendenzaT[k]) / 1, deg(c.tendenzaT[k]).replace(" °C", "") + " °C ogni dieci anni", SC[k])).join("")}</div>
    <p class="note">Qui la temperatura estiva è salita di ${nf(c.tendenzaT[2], 2)} °C ogni dieci anni. Per il futuro il modello ipotizza ${nf(ip[0], 2)}, ${nf(ip[1], 2)} e ${nf(ip[2], 2)} °C ogni dieci anni nei tre scenari: ${c.tendenzaT[2] > ip[1] * 1.2 ? "la tendenza misurata è più vicina allo scenario alto." : c.tendenzaT[2] < ip[1] * 0.8 ? "la tendenza misurata è più vicina allo scenario basso." : "la tendenza misurata è vicina allo scenario intermedio."} Ogni grado in più tra inverno e primavera sposta l'inizio della primavera di ${giorni(c.inizio.perGrado)} (misurato sulla sede).</p></div>`; }
function leverCard(d, body, extra) { return `<div class="card dom" style="--c:${["", "var(--pri)", "var(--pri)", "var(--aut)", "var(--inv)", "var(--aut)", "var(--est)", "var(--est)", "var(--inv)", "var(--muted)"][d]}"><h3><span>${d}</span>${AM.DOMAINS[d]}</h3>${body}${extra || ""}</div>`; }
function vSim() {
  const l = L(), sm = V.sim, sw = (k, inv) => `<label class="switch"><input type="checkbox" data-k="${k}" data-inv="${inv ? 1 : 0}" ${(inv ? sm.mask & (1 << AM.INV.indexOf(k)) : sm.flex[k]) ? "checked" : ""}>${esc(l[k].name)}</label>`;
  const doms = [leverCard(1, sw("v") + sw("C", 1)), leverCard(2, `<div class="ctl">${esc(l.cal.name)}<div class="seg" id="sim-cal"></div></div>`), leverCard(3, sw("G", 1)), leverCard(4, sw("W", 1)), leverCard(5, sw("soil")), leverCard(6, sw("ipm")), leverCard(7, sw("sens") + sw("P", 1)), leverCard(8, sw("ins")),
    leverCard(9, `<p class="lede" style="font-size:14px">Nessuna leva tua: dipende dai vicini e dal bacino. Il ${pct(R.territorio.quotaAcquaBacino)} dell'incertezza sul tuo risultato viene dall'acqua disponibile nel territorio.</p>`)];
  const s = SIM, a = R.attuale.sintesi, d = (v, b, inv) => { const x = v - b, ok = inv ? x <= 0 : x >= 0; return `<span class="d ${Math.abs(x) < 1e-6 ? "calm" : ok ? "good" : "crit"}">`; };
  const res = s ? `<div class="kv">
      <span><b class="num">${eur(s.medio)}</b>Guadagno medio in 30 anni ${d(s.medio, a.medio)}${seur(s.medio - a.medio)}</span></span>
      <span><b class="num">${eur(s.peggiori)}</b>Nei futuri peggiori (1 su 10) ${d(s.peggiori, a.peggiori)}${seur(s.peggiori - a.peggiori)}</span></span>
      <span><b class="num">${nf(s.batteAttuale * 100)} su 100</b>Volte in cui va meglio di oggi</span>
      <span><b class="num">${eur(s.investimento)}</b>Investimento iniziale</span>
      <span><b class="num">${nf(s.acqua)} m³</b>Acqua all'anno ${d(s.acqua, a.acqua, 1)}${(s.acqua > a.acqua ? "+" : "") + nf(s.acqua - a.acqua)}</span></span>
      <span><b class="num">${nf(s.emissioni)} t CO₂e</b>Emissioni all'anno ${d(s.emissioni, a.emissioni, 1)}${(s.emissioni > a.emissioni ? "+" : "") + nf(s.emissioni - a.emissioni)}</span></span>
      <span><b class="num">${nf(s.biodiversita)} / 100</b>Indice di biodiversità ${d(s.biodiversita, a.biodiversita)}${(s.biodiversita > a.biodiversita ? "+" : "") + nf(s.biodiversita - a.biodiversita)}</span></span></div>
    <div class="chart">${fan(s.anni, r => [r.p10, r.p50, r.p90], R.attuale.anni.map(r => r.p50), { fmt: "eur", zero: true, tip: eur, baseName: "Assetto attuale", h: 240 })}</div>` : `<p class="note">Calcolo…</p>`;
  $("v-simulazione").innerHTML = `<div><p class="eyebrow" style="--c:var(--pri)">Simulazione · Che cosa accadrebbe se</p><h1 class="verdict">Accendi le scelte che hai in mente e guarda cosa cambia, prima di spendere.</h1></div>
  <div class="card" id="sim-res"><div class="card-h"><h2>Risultato della tua combinazione</h2><div class="tags"><button class="btn ghost" id="sim-plan" type="button">Carica il piano consigliato</button><button class="btn ghost" id="sim-zero" type="button">Azzera</button></div></div>${res}</div>
  <div class="grid g3">${doms.join("")}</div>`;
  seg("sim-cal", l.cal.opts.map((o, i) => [i, o]), sm.flex.cal, k => { sm.flex.cal = +k; simRun(); });
  $("v-simulazione").onchange = e => { const t = e.target; if (!t.dataset.k) return; if (t.dataset.inv === "1") { const b = 1 << AM.INV.indexOf(t.dataset.k); sm.mask = t.checked ? sm.mask | b : sm.mask & ~b; } else sm.flex[t.dataset.k] = t.checked ? 1 : 0; simRun(); };
  $("sim-plan").onclick = () => { sm.flex = Object.assign({}, R.scelta.leve); sm.mask = R.scelta.invest; simRun(); };
  $("sim-zero").onclick = () => { sm.flex = { v: 0, cal: 0, soil: 0, ipm: 0, sens: 0, ins: 0 }; sm.mask = 0; simRun(); };
  if (!SIM) simRun();
}
let simJob = 0;
async function simRun() { const my = ++simJob; busy(true); try { const r = await call("sim", { prefs: modelPrefs(), flex: V.sim.flex, mask: V.sim.mask }); if (my !== simJob) return; SIM = r; vSim(); } catch (e) { console.error(e); } if (my === simJob) busy(false); }

function vPiano() {
  const s = R.scelta, a = R.attuale.sintesi, pc = R.percorso, l = L(), q = P.prefs, mp = modelPrefs(), byDom = {};
  for (const k of AM.FLEX) if (s.leve[k]) (byDom[l[k].dom] = byDom[l[k].dom] || []).push({ n: k === "cal" ? l.cal.opts[s.leve.cal] : l[k].name, rev: l[k].rev, t: "Da subito, rivista ogni anno" });
  pc.ora.forEach(k => (byDom[l[k].dom] = byDom[l[k].dom] || []).push({ n: l[k].name, rev: l[k].rev, t: "Investimento da fare ora" }));
  R.opzioni.filter(o => o.quando === "condizionale").forEach(o => (byDom[l[o.id].dom] = byDom[l[o.id].dom] || []).push({ n: o.nome, rev: o.rev, t: `Solo se serve: ${pct(o.prob)} dei futuri`, cond: 1 }));
  const nM = AM.FLEX.filter(k => s.leve[k]).length + pc.ora.length, ps = pc.sintesi;
  const cmp = (lab, v, b, f, inv) => { const x = v - b, ok = inv ? x <= 0 : x >= 0; return `<span><b class="num">${f(v)}</b>${lab} <span class="d ${Math.abs(x) < 1e-6 ? "calm" : ok ? "good" : "crit"}">${f === eur ? seur(x) : (x > 0 ? "+" : "") + nf(x)} rispetto a oggi</span></span>`; };
  const sp = R.sprechi, WL = [["hl", "Caldo"], ["wl", f => "Sete"], ["pl", "Parassiti e malattie"], ["fl", "Gelo e partenze a freddo"], ["xl", "Grandine e altri eventi estremi"], ["tr", "Acqua e trattamenti pagati"]], mx = Math.max(...WL.map(w => sp.attuale[w[0]]), 1);
  const gr = Object.entries(P.contributi).filter(e => e[1] > 0);
  $("v-piano").innerHTML = `<div><p class="eyebrow" style="--c:var(--est)">Ottimizzazione · Quale strategia conviene</p>
    <h1 class="verdict">${nM ? `Il piano che regge meglio ha <em>${nM} ${nM === 1 ? "mossa" : "mosse"}</em>: batte l'assetto attuale in <em>${nf(ps.batteAttuale * 100)} futuri su 100</em>.` : `Per ora conviene <em>non cambiare assetto</em>: nessuna alternativa ripaga il suo costo.`}</h1>
    ${planChanged ? `<p class="lede" style="margin-top:8px"><span class="chip warn">Piano aggiornato</span> Con le ultime modifiche la scelta consigliata è cambiata.</p>` : ""}</div>
  <div class="grid g2">
    <div class="card"><h2>Le mosse, dominio per dominio</h2>${Object.keys(byDom).length ? Object.keys(byDom).sort().map(dk => `<div><p class="eyebrow" style="margin:6px 0 4px">${dk}. ${AM.DOMAINS[dk]}</p>${byDom[dk].map(m => `<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:3px 0"><span style="font-weight:500">${esc(m.n)}</span><span class="tags"><span class="chip ${m.cond ? "warn" : "acc"} plain">${m.t}</span><span class="chip calm plain">${m.rev}</span></span></div>`).join("")}</div>`).join("") : `<p class="lede">Nessuna mossa consigliata con queste preferenze.</p>`}
      <div class="kv" style="margin-top:8px">${cmp("Guadagno medio in 30 anni", ps.medio, a.medio, eur)}${cmp("Nei futuri peggiori (1 su 10)", ps.peggiori, a.peggiori, eur)}<span><b class="num">${eur(s.investimento)}</b>Investimento iniziale</span>
      ${cmp("m³ d'acqua all'anno", s.acqua, a.acqua, nf, 1)}${cmp("t CO₂e all'anno", s.emissioni, a.emissioni, nf, 1)}${cmp("Biodiversità su 100", s.biodiversita, a.biodiversita, nf)}</div></div>
    <div class="card"><h2>Cosa conta per te</h2>
      <label class="ctl">Guadagno medio o protezione nelle annate peggiori: <b>${q.prudenza < 0.2 ? "Punto al guadagno" : q.prudenza < 0.55 ? "Equilibrio" : q.prudenza < 0.8 ? "Prudente" : "Molto prudente"}</b><input type="range" id="p-prud" min="0" max="1" step="0.05" value="${q.prudenza}"></label>
      <label class="ctl">Quanto vale per te un m³ d'acqua risparmiato: <b>${nf(q.acqua, 2)} €</b><input type="range" id="p-acq" min="0" max="0.5" step="0.01" value="${q.acqua}"></label>
      <label class="ctl">Quanto vale una tonnellata di CO₂ evitata: <b>${nf(q.co2)} €</b><input type="range" id="p-co2" min="0" max="150" step="1" value="${q.co2}"></label>
      <label class="ctl">Quanto vale un punto di biodiversità all'anno: <b>${nf(mp.prezzi.bio)} €</b><input type="range" id="p-bio" min="0" max="${Math.max(100, Math.round(R.oggi.ricavo * 0.003 / 10) * 10)}" step="5" value="${mp.prezzi.bio}"></label>
      <div class="ctl">Fiducia nelle probabilità del modello<div class="seg" id="p-fid"></div></div>
      <div class="grid g2"><label class="ctl">Tetto di investimento (€)<input type="number" id="p-bud" min="0" step="1000" placeholder="Nessun limite" value="${q.budget == null ? "" : q.budget}"></label>
      <label class="ctl">Tetto d'acqua (% del consumo di oggi)<input type="number" id="p-wat" min="10" step="5" placeholder="Nessun limite" value="${q.acquaMax == null ? "" : Math.round(q.acquaMax * 100)}"></label></div>
      ${gr.length ? `<div class="tags">${gr.map(e => `<span class="chip acc plain">Contributo ${e[1]}% su ${esc((l[e[0]] || { name: e[0] }).name.toLowerCase())}</span>`).join("")}<button class="btn ghost" type="button" id="p-nogr" style="padding:3px 10px;font-size:12.5px">Togli i contributi</button></div>` : ""}</div>
  </div>
  <div class="card"><div class="card-h"><h2>Il piano a confronto con tutte le alternative</h2><div class="legend"><span><i style="width:10px;height:10px;border-radius:50%;background:var(--inv);display:inline-block"></i>Le ${R.pareto.length} migliori alternative</span><span><i style="width:10px;height:10px;border-radius:50%;background:var(--est);display:inline-block"></i>Piano</span></div></div>
    <div class="chart">${scatter()}</div><p class="note">Ogni punto è una combinazione di mosse. Più in alto: guadagna di più in media. Più a destra: perde meno quando va male. I punti blu sono le alternative che nessun'altra supera su entrambi i fronti. Passa il mouse su un punto per leggerlo.</p></div>
  <div class="card"><div class="card-h"><h2>Cosa decidere ora e cosa più avanti</h2><span class="note">Nel 2031 guardi: ${esc(pc.indicatore.toLowerCase())}. Soglie: ${field() ? pct(pc.soglie2031[0]) + " e " + pct(pc.soglie2031[1]) : nf(pc.soglie2031[0]) + " e " + nf(pc.soglie2031[1]) + " giorni"}</span></div>
    <div class="chart tree">${treeSvg()}</div>
    <p class="lede" style="font-size:14px">Come leggerlo: a sinistra quello che fai subito. Nel 2031 e nel 2036 guardi come sono andati gli anni e segui il ramo corrispondente; le percentuali dicono quanto è probabile ogni ramo. Gli investimenti che non si possono disfare si decidono solo a quel punto. ${pc.valoreFlessibilita > 1 ? `Poter decidere a tappe vale <b>${eur(pc.valoreFlessibilita)}</b> in più rispetto a decidere tutto oggi.` : `In questo caso decidere tutto oggi o a tappe dà lo stesso risultato.`}</p></div>
  <div class="card"><h2>Investire subito o aspettare?</h2><div class="tablewrap"><table><thead><tr><th>Investimento</th><th>Costo</th><th>Quando</th><th>Cosa cambia se aspetti</th><th>Quanto vale poterlo fare più avanti</th></tr></thead><tbody>
    ${R.opzioni.map(o => `<tr><td>${esc(o.nome)}<br><span class="note">${o.rev}</span></td><td class="num">${eur(o.costo)}</td><td><span class="chip ${o.quando === "ora" ? "good" : o.quando === "condizionale" ? "warn" : "calm"}">${o.quando === "ora" ? "Ora" : o.quando === "condizionale" ? "Solo se serve" : "Non conviene"}</span></td><td class="num ${o.valoreAttesa > 0 ? "good" : "crit"}">${seur(o.valoreAttesa)}</td><td class="num">${eur(Math.max(0, o.valoreOpzione))}</td></tr>`).join("")}</tbody></table></div></div>
  <div class="card"><div class="card-h"><h2>Dove perdi soldi oggi, e quanto ne recupera il piano</h2><span class="note">Euro all'anno, media dei primi dieci anni. In nero la perdita di oggi, a colori quanto cambia con il piano.</span></div><div class="bars">
    ${WL.map(w => { const nm = typeof w[1] === "function" ? (field() ? "Sete" : "Foraggio che manca") : w[1], av = sp.attuale[w[0]], pv = sp.piano[w[0]]; return bar(nm, av / mx, eur(av) + ` <span class="d ${pv <= av ? "good" : "crit"}">${seur(pv - av)}</span>`, null, false, `${nm}\nOggi ${eur(av)} all'anno\nCon il piano ${eur(pv)} all'anno`); }).join("")}</div></div>`;
  const pr = (id, fn, lab) => { const el = $(id); el.oninput = e => { fn(e.target.value); el.parentNode.querySelector("b").textContent = lab(+e.target.value); }; el.onchange = () => { save(); recompute(false); }; };
  pr("p-prud", v => q.prudenza = +v, v => v < 0.2 ? "Punto al guadagno" : v < 0.55 ? "Equilibrio" : v < 0.8 ? "Prudente" : "Molto prudente"); pr("p-acq", v => q.acqua = +v, v => nf(v, 2) + " €"); pr("p-co2", v => q.co2 = +v, v => nf(v) + " €"); pr("p-bio", v => q.bio = +v, v => nf(v) + " €");
  $("p-bud").onchange = e => { q.budget = e.target.value === "" ? null : Math.max(0, +e.target.value); save(); recompute(false); };
  $("p-wat").onchange = e => { q.acquaMax = e.target.value === "" ? null : Math.max(0.1, +e.target.value / 100); save(); recompute(false); };
  seg("p-fid", RHO_N.map((n, i) => [i, n]), q.fiducia, k => { q.fiducia = +k; save(); recompute(false); });
  if ($("p-nogr")) $("p-nogr").onclick = () => { P.contributi = {}; save(); recompute(true); };
}

const INC = { Climatica: "var(--inv)", Agronomica: "var(--pri)", Osservativa: "var(--est)", Economica: "var(--aut)", Strutturale: "var(--accent)" };
function vPerche() {
  const sp = R.spiegazione, lv = sp.leve.slice().sort((a, b) => a.dValore - b.dValore), mx = Math.max(...lv.map(x => Math.abs(x.dValore)), 1), mc = Math.max(...sp.cause.map(c => c.quota), 0.01), top = sp.cause[0], vin = sp.vincoli, om = sp.ombra;
  const act = lv.filter(x => x.attiva), key = act[0];
  $("v-perche").innerHTML = `<div><p class="eyebrow" style="--c:var(--aut)">Spiegazione · Perché questo piano</p>
    <h1 class="verdict">${key ? `La mossa che pesa di più è <em>${esc(key.nome.toLowerCase())}</em>. Il risultato dipende soprattutto da <em>${esc(top.nome.toLowerCase())}</em>.` : `Nessuna mossa attiva: il risultato dipende soprattutto da <em>${esc(top.nome.toLowerCase())}</em>.`}</h1></div>
  <div class="grid g2">
    <div class="card"><h2>Cosa succede se cambi una mossa</h2><p class="note">Ogni barra dice quanto vale in meno il piano se togli una mossa scelta o ne aggiungi una scartata. Più lunga la barra, più quella scelta conta.</p><div class="bars">
      ${lv.map(x => bar(`${x.attiva ? "Togli" : "Aggiungi"}: ${esc(x.nome)}`, Math.abs(x.dValore) / mx, seur(x.dValore), x.dValore < 0 ? "var(--crit)" : "var(--good)", false, `${x.attiva ? "Mossa attiva nel piano" : "Mossa non scelta"}\nGuadagno medio ${seur(x.dMedio)}\nNei futuri peggiori ${seur(x.dPeggiori)}${x.ammessa ? "" : "\nFuori dai tuoi vincoli"}`)).join("")}</div></div>
    <div class="card"><h2>Da cosa dipende il risultato</h2><p class="note">Quanto pesa ogni fonte di incertezza sul risultato finale. Più lunga la barra, più conta.</p><div class="bars">
      ${sp.cause.map(c => bar(`<span class="chip plain" style="color:${INC[c.inc]}">${c.inc}</span> ${esc(c.nome)}`, c.quota / mc, pct(c.quota), INC[c.inc])).join("")}</div>
      <p class="note">L'errore delle misure non compare qui: è già dentro le decisioni.</p></div>
  </div>
  <div class="grid g2">
    <div class="card"><h2>I tuoi limiti di spesa e di acqua</h2>
      ${vin.budget ? `<p>Tetto di investimento: usati <b>${eur(vin.budget.usato)}</b> su ${eur(vin.budget.limite)}. ${om.budget && om.budget.cambia ? `Con il 20% in più il piano cambierebbe e il valore atteso salirebbe di <b>${eur(om.budget.delta)}</b>.` : "Alzarlo del 20% non cambierebbe la scelta: non è il vincolo che ti limita."}</p>` : `<p class="lede" style="font-size:14px">Nessun tetto di investimento impostato.</p>`}
      ${vin.acqua ? `<p>Tetto d'acqua: usati <b>${nf(vin.acqua.usato)} m³</b> su ${nf(vin.acqua.limite)}. ${om.acqua && om.acqua.cambia ? `Con il 20% in più il valore atteso salirebbe di <b>${eur(om.acqua.delta)}</b>.` : "Non è il vincolo che ti limita."}</p>` : `<p class="lede" style="font-size:14px">Nessun tetto d'acqua impostato.</p>`}
      <p class="note">I tetti si impostano nella scheda Piano.</p></div>
    <div class="card"><h2>Tracciabilità</h2><div class="kv"><span><b class="num">v${R.versione}</b>Versione del modello</span><span><b class="num">${R.seme}</b>Seme casuale</span><span><b class="num">${nf(R.traiettorie)} × ${R.anni}</b>Futuri × anni</span>
      <span><b class="num">${nf(R.campioneEfficace)}</b>Futuri che pesano dopo le tue osservazioni</span><span><b class="num">${nf(R.sconto * 100)}%</b>Tasso di sconto</span><span><b class="num">${nf(R.tempoCalcolo / 1000, 1)} s</b>Tempo di calcolo</span></div>
      <p class="note">Limiti: parametri illustrativi; cinque modelli climatici sintetici, non dati CMIP6; risposta colturale semplificata sul modello dei coefficienti FAO. Le frasi «in N futuri su 100» valgono dentro queste simulazioni.</p></div>
  </div>`;
}

function vRobustezza() {
  const rb = R.robustezza, same = rb.livelli.every(x => x.stessa), st = rb.stress, mx = Math.max(...st.map(s => Math.max(Math.abs(s.piano), Math.abs(s.attuale))), 1), worst = rb.rimpianto.slice().sort((a, b) => b.rimpianto - a.rimpianto)[0];
  $("v-robustezza").innerHTML = `<div><p class="eyebrow" style="--c:var(--inv)">Robustezza · E se il modello sbaglia?</p>
    <h1 class="verdict">${same ? `Il piano <em>non cambia</em> nemmeno se le probabilità che uso sono sbagliate.` : `Con meno fiducia nel modello il piano <em>cambia</em>: guarda a quale livello.`} Il caso in cui lascia più soldi sul tavolo: <em>${esc(worst.caso)}</em>.</h1></div>
  <div class="card"><div class="card-h"><h2>Fiducia nelle probabilità del modello</h2><div class="seg" id="r-fid"></div></div>
    <p class="note">Meno ti fidi delle probabilità del modello, più peso do ai futuri sfavorevoli. La tabella dice se il piano cambia e quanto vale in quella prova.</p>
    <div class="tablewrap"><table><thead><tr><th>Fiducia</th><th>Severità della prova</th><th>Piano scelto</th><th>Quanto vale nella prova</th></tr></thead><tbody>
    ${rb.livelli.map((x, i) => `<tr><td>${RHO_N[i]}${i === P.prefs.fiducia ? ` <span class="chip acc">In uso</span>` : ""}</td><td class="num">${nf(x.raggio, 2)}</td><td style="white-space:normal;text-align:left">${x.stessa ? "Lo stesso piano" : esc(x.descrizione.join("; ") || "Assetto attuale")}</td><td class="num">${eur(x.valoreCasoPeggiore)}</td></tr>`).join("")}</tbody></table></div></div>
  <div class="card"><h2>Se sapessi già quale futuro arriva</h2><p class="note">Per ogni futuro possibile: quanto rende il piano, quanto rende restare come oggi e quanto avresti guadagnato in più con la scelta perfetta per quel caso. Più l'occasione persa è bassa, più il piano va bene comunque.</p>
    <div class="tablewrap"><table><thead><tr><th>Cosa non sappiamo</th><th>Caso</th><th>Probabilità</th><th>Piano</th><th>Come oggi</th><th>Occasione persa</th></tr></thead><tbody>
    ${rb.rimpianto.map(x => `<tr><td>${esc(x.gruppo)}</td><td style="text-align:left">${esc(x.caso)}</td><td class="num">${pct(x.peso)}</td><td class="num">${eur(x.piano)}</td><td class="num">${eur(x.attuale)}</td><td class="num"><span class="chip ${sev(x.rimpianto / Math.max(1, Math.abs(x.piano)), 0.05, 0.15)}">${eur(x.rimpianto)}</span></td></tr>`).join("")}</tbody></table></div></div>
  <div class="card"><div class="card-h"><h2>Prove di stress: se succede il peggio</h2><div class="legend"><span><i class="sw" style="background:var(--accent);border:0"></i>Piano</span><span><i class="sw" style="background:var(--muted);border:0"></i>Come oggi</span></div></div><p class="note">Per ogni prova: guadagno in 30 anni con il piano e restando come oggi. In rosso se si chiude in perdita.</p>
    ${st.map(s => `<div style="display:flex;flex-direction:column;gap:5px;padding:6px 0"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${esc(s.nome)}</b><span class="chip ${s.vince > 0.6 ? "good" : s.vince > 0.4 ? "warn" : "crit"}">Il piano vince in ${nf(s.vince * 100)} futuri su 100</span></div>
      <div class="bars">${bar("Piano", Math.abs(s.piano) / mx, eur(s.piano), s.piano < 0 ? "var(--crit)" : "var(--accent)", false, `Nei futuri peggiori ${eur(s.pianoPeggiori)}`)}${bar("Come oggi", Math.abs(s.attuale) / mx, eur(s.attuale), s.attuale < 0 ? "var(--crit)" : "var(--muted)", false, `Nei futuri peggiori ${eur(s.attualePeggiori)}`)}</div></div>`).join("")}</div>`;
  seg("r-fid", RHO_N.map((n, i) => [i, n]), P.prefs.fiducia, k => { P.prefs.fiducia = +k; save(); recompute(false); });
}

function vDati() {
  const vi = R.informazione, red = vi.voci.filter(v => v.riducibile).sort((a, b) => b.valoreStimato - a.valoreStimato), non = vi.voci.filter(v => !v.riducibile), best = red.find(v => v.valoreStimato > v.costo), o = P.osservazioni;
  $("v-dati").innerHTML = `<div><p class="eyebrow" style="--c:var(--pri)">Valore dell'informazione · Cosa conviene misurare</p>
    <h1 class="verdict">${best ? `Prima di investire conviene raccogliere un dato: <em>${esc(best.misura.toLowerCase())}</em>.` : `Con le scelte in gioco <em>nessuna misura in più ripaga il suo costo</em>: puoi decidere con quello che sai.`}</h1></div>
  <div class="card"><div class="card-h"><h2>Misure che puoi fare tu</h2><span class="note">Sapere tutto in anticipo varrebbe al massimo ${eur(vi.evpi)}</span></div>
    <div class="tablewrap"><table><thead><tr><th>Misura</th><th>Cosa chiarisce</th><th>Costo indicativo</th><th>Quanto può valere</th><th>Esito</th></tr></thead><tbody>
    ${red.map(v => `<tr><td>${esc(v.misura)}</td><td style="text-align:left"><span class="chip plain" style="color:${INC[v.inc]}">${v.inc}</span> ${esc(v.nome)}</td><td class="num">${eur(v.costo)}</td><td class="num">${eur(v.valoreStimato)}</td><td><span class="chip ${v.valoreStimato > v.costo ? "good" : "calm"}">${v.valoreStimato > v.costo ? "Conviene" : "Non ripaga"}</span></td></tr>`).join("")}</tbody></table></div>
    <p class="note">«Quanto può valere» è il guadagno medio in più che avresti decidendo con quel dato in mano, ridotto del 30% perché nessuna misura è perfetta. Conviene quando supera il costo.</p></div>
  <div class="card"><h2>Cose che non puoi misurare tu</h2><div class="bars">${non.map(v => bar(`<span class="chip plain" style="color:${INC[v.inc]}">${v.inc}</span> ${esc(v.nome)}`, v.valoreMassimo / Math.max(1, vi.evpi), eur(v.valoreMassimo), INC[v.inc])).join("")}</div>
    <p class="note">La barra dice quanto varrebbe conoscerle in anticipo. Non si possono misurare: ci si protegge con un piano che regge (Robustezza) e decidendo a tappe (Piano).</p></div>
  <div class="card"><div class="card-h"><h2>Aggiorna il piano con quello che è successo</h2>${o.length ? `<span class="chip ${R.campioneEfficace < 15 ? "crit" : "acc"}">${nf(R.campioneEfficace)} futuri restano compatibili</span>` : ""}</div>
    <p class="lede" style="font-size:14px">A fine stagione inserisci cosa hai osservato. Do più peso ai futuri che somigliano alla tua annata e ricalcolo il piano: applichi solo il primo passo, poi si ripete.</p>
    <form id="obs" class="controls"><label class="ctl">Anno<select id="o-anno">${Array.from({ length: 10 }, (_, i) => `<option>${Y0 + 1 + i}</option>`).join("")}</select></label>
      <label class="ctl">Inverno (°C sul normale)<input type="number" id="o-tw" step="0.1" style="width:120px" placeholder="es. 1,2"></label>
      <label class="ctl">Inizio primavera (giorni, − prima)<input type="number" id="o-on" step="1" style="width:140px" placeholder="es. -9"></label>
      <label class="ctl">Pioggia dell'anno (%)<input type="number" id="o-pi" step="5" style="width:120px" placeholder="es. -20"></label>
      <label class="ctl">${field() ? "Resa" : "Produzione"} sul normale (%)<input type="number" id="o-re" step="1" style="width:130px" placeholder="es. -8"></label>
      <button class="btn" type="submit">Aggiungi e ricalcola</button></form>
    ${o.length ? `<div class="tablewrap"><table><thead><tr><th>Anno</th><th>Inverno</th><th>Inizio primavera</th><th>Pioggia</th><th>${field() ? "Resa" : "Produzione"}</th><th></th></tr></thead><tbody>${o.map((r, i) => `<tr><td>${r.anno}</td><td class="num">${r.tw == null ? "—" : (r.tw > 0 ? "+" : "") + nf(r.tw, 1) + " °C"}</td><td class="num">${r.onset == null ? "—" : r.onset + " giorni"}</td><td class="num">${r.pioggia == null ? "—" : r.pioggia + "%"}</td><td class="num">${r.resa == null ? "—" : r.resa + "%"}</td><td><button class="btn ghost" type="button" data-del="${i}" style="padding:3px 10px;font-size:12.5px">Togli</button></td></tr>`).join("")}</tbody></table></div>
      ${R.campioneEfficace < 15 ? `<p class="note crit">Pochissimi futuri simulati somigliano a queste osservazioni: è un segnale che il modello potrebbe non descrivere bene la tua azienda. Prendi il piano con più cautela e abbassa la fiducia nel modello.</p>` : ""}${planChanged ? `<p class="note"><span class="chip warn">Piano aggiornato</span> Dopo l'ultima osservazione la scelta consigliata è cambiata: guardala nella scheda Piano.</p>` : planChanged === false ? `<p class="note">L'ultima modifica non ha cambiato la scelta consigliata.</p>` : ""}` : `<p class="note">Nessuna osservazione inserita. Le prime utili saranno quelle del ${Y0 + 1}.</p>`}</div>`;
  $("obs").onsubmit = e => { e.preventDefault(); const g = id => $(id).value === "" ? null : +$(id).value, r = { anno: +$("o-anno").value, tw: g("o-tw"), onset: g("o-on"), pioggia: g("o-pi"), resa: g("o-re") };
    if (r.tw == null && r.onset == null && r.pioggia == null && r.resa == null) return; P.osservazioni = o.filter(x => x.anno !== r.anno).concat([r]).sort((a, b) => a.anno - b.anno); save(); recompute(false); };
  $("v-dati").onclick = e => { const b = e.target.closest("[data-del]"); if (b) { P.osservazioni.splice(+b.dataset.del, 1); save(); recompute(false); } };
}

/* ---------- Intelligenza artificiale: consulente, foto, bandi ---------- */
async function ai(prompt, extra) {
  const r = await fetch("api/ia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ prompt, attesa: true }, extra || {})) });
  let j; try { j = await r.json(); } catch (e) { throw new Error("il server non ha risposto in tempo"); } if (!r.ok) throw new Error(j.errore || "errore");
  if (!j.id) return j.text;
  for (let i = 0; i < 200; i++) { await new Promise(ok => setTimeout(ok, 2500)); let e; try { e = await (await fetch("api/ia/esito?id=" + j.id)).json(); } catch (x) { continue; }
    if (e.stato === "fatto") return e.text; if (e.stato === "errore" || e.errore) throw new Error(e.errore || "errore"); }
  throw new Error("la richiesta ha superato il tempo massimo");
}
function parseJSON(t) { t = String(t || "").replace(/```[a-zA-Z]*/g, ""); const a = t.indexOf("{"), b = t.lastIndexOf("}"); if (a < 0 || b <= a) return null; const raw = t.slice(a, b + 1);
  const fix = x => x.replace(/[\u201C\u201D]/g, '"').replace(/,\s*([}\]])/g, "$1").replace(/"(?:[^"\\]|\\.)*"/g, m => m.replace(/\n/g, "\\n").replace(/\r/g, "").replace(/\t/g, " "));
  for (const x of [raw, fix(raw)]) { try { return JSON.parse(x); } catch (e) {} } return null; }
/* Parole chiave: l'IA le segna con **doppio asterisco**, qui diventano grassetto colorato */
const kw = t => esc(t == null ? "" : String(t)).replace(/\*\*(.+?)\*\*/g, '<b class="kw">$1</b>').replace(/\*\*/g, "");
const liK = a => (Array.isArray(a) ? a : a ? [a] : []).filter(Boolean).map(x => `<li>${kw(x)}</li>`).join("") || "<li>Nessuna indicazione.</li>";
/* Testo libero dell'IA mostrato in modo leggibile quando non arriva un JSON valido */
const proseHtml = t => String(t || "").replace(/```[a-zA-Z]*/g, "").split(/\n+/).map(x => x.trim()).filter(Boolean).map(x => /^[-•*]\s+/.test(x) ? `<li>${kw(x.replace(/^[-•*]\s+/, ""))}</li>` : `<p>${kw(x.replace(/^#+\s*/, ""))}</p>`).join("");
const noIA = `<div class="card" style="border-style:dashed"><h3>Funzione non attiva</h3><p class="lede" style="font-size:14px">Questa parte usa il consulente IA tramite Claude Code installato sul computer dove gira Agro. Qui non l'ho trovato: le simulazioni funzionano comunque.</p></div>`;
const ctx = () => `AZIENDA: ${P.nome}; ${subject()}; zona ${AM.ZONES[P.zona].name}; regione ${P.regione}; ${field() ? "irrigazione " + P.irr : "foraggi autoprodotti " + P.auto + "%"}; forma giuridica ${P.forma}; ${P.giovane ? "titolare sotto i 41 anni; " : ""}${P.bio ? "azienda biologica; " : ""}ricavo annuo indicativo ${R ? eur(R.oggi.ricavo) : "n.d."}. Data di oggi: ${new Date().toLocaleDateString("it-IT")}.`;

/* Diagnosi da foto o video */
let shots = [];
function vDiagnosi() {
  $("v-diagnosi").innerHTML = `<div><p class="eyebrow" style="--c:var(--est)">Diagnosi da foto e video</p><h1 class="verdict">Fotografa la pianta, la foglia, il terreno o l'animale: ti dico <em>cosa vedo, le cause probabili e cosa fare</em>.</h1></div>
  ${IA ? "" : noIA}
  <div class="card scan" id="dg-card"><label class="drop" id="dg-drop"><b>Trascina qui foto o un video, oppure clicca per sceglierli</b><span class="note">Fino a 6 foto. Da un video prendo quattro fotogrammi. Foto ravvicinate e nitide, con luce naturale, danno risposte migliori.</span><input type="file" id="dg-file" accept="image/*,video/*" multiple hidden></label>
    <div class="thumbs" id="dg-th"></div>
    <label class="ctl">Cosa hai notato, da quando, e su quanta parte del campo<textarea id="dg-nota" rows="2" placeholder="Es. macchie scure sulle foglie basse da una settimana, dopo le piogge, su un filare"></textarea></label>
    <div><button class="btn" id="dg-go" type="button" ${IA ? "" : "disabled"}>Analizza</button></div></div>
  <div id="dg-out"></div>`;
  const th = () => { $("dg-th").innerHTML = shots.map(s => `<img src="${s}" alt="Immagine caricata">`).join(""); };
  th();
  const take = async files => { for (const f of files) { if (shots.length >= 6) break; try { if (f.type.startsWith("video/")) (await frames(f)).forEach(x => shots.length < 6 && shots.push(x)); else if (f.type.startsWith("image/")) shots.push(await shrink(f)); } catch (e) {} } th(); };
  $("dg-file").onchange = e => take(e.target.files);
  const dz = $("dg-drop"); dz.ondragover = e => { e.preventDefault(); dz.classList.add("over"); }; dz.ondragleave = () => dz.classList.remove("over"); dz.ondrop = e => { e.preventDefault(); dz.classList.remove("over"); take(e.dataTransfer.files); };
  $("dg-go").onclick = async () => {
    if (!shots.length) { $("dg-out").innerHTML = `<p class="note crit">Aggiungi almeno una foto o un video.</p>`; return; }
    $("dg-card").classList.add("busy"); $("dg-go").disabled = true; $("dg-out").innerHTML = `<p class="note">Guardo le immagini… può volerci fino a un minuto.</p>`;
    const prompt = `Sei un fitopatologo e agronomo di campo (o veterinario zootecnico, se le immagini mostrano animali). Guarda le immagini indicate in fondo e fai una diagnosi prudente, breve e schematica.\n${ctx()}\nNOTA DELL'AGRICOLTORE: ${$("dg-nota").value.trim() || "nessuna"}\n\nRispondi SOLO con un oggetto JSON valido, in italiano, senza testo prima o dopo e senza blocchi di codice, con queste chiavi:\n{"problema":"nome del problema più probabile in massimo 6 parole, o 'Non riconoscibile dalle immagini'","confidenza":"alta|media|bassa","urgenza":"alta|media|bassa","cosa_vedo":["massimo 3 punti"],"cause":[{"causa":"massimo 5 parole","probabilita":"alta|media|bassa","perche":"una frase"}],"controlli":["massimo 3 punti"],"cura":{"subito":["massimo 3 punti"],"prossime_settimane":["massimo 3 punti"],"prevenzione":["massimo 3 punti"]},"intervento_agro":"una frase: in quale caso conviene chiedere il sopralluogo di un tecnico Agro","limiti":"una frase"}\nStile: massimo 3 cause; ogni punto e ogni frase al massimo 14 parole, senza giri di parole; in ogni punto metti tra doppi asterischi (**così**) le 1-3 parole chiave, cioè il sintomo, la causa o l'azione da fare.\nRegole: descrivi solo ciò che si vede; se l'immagine non basta dillo e abbassa la confidenza; distingui cause biotiche (funghi, batteri, virus, insetti) da abiotiche (sete, ristagno, carenze, sale, caldo, gelo, fitotossicità); per i trattamenti indica la categoria di intervento e le pratiche agronomiche, senza nomi commerciali né dosi, e ricorda di seguire l'etichetta del prodotto. Non dire mai di chiamare o consultare un tecnico, un agronomo o un veterinario esterno: l'assistenza tecnica la dà Agro. Se serve una visita in azienda, scrivi che si può chiedere l'intervento di un tecnico Agro (per gli animali, del veterinario Agro).`;
    try { const t = await ai(prompt, { immagini: shots }), j = parseJSON(t); $("dg-out").innerHTML = j && j.problema ? diagHtml(j) : `<div class="card diag" style="--kc:var(--est);border-top:4px solid var(--est)"><h2>Cosa vedo</h2>${proseHtml(t)}</div>${agroHelp("", "")}`; }
    catch (e) { $("dg-out").innerHTML = `<p class="note crit">Non sono riuscito ad analizzare le immagini: ${esc(e.message)}. Riprova tra poco.</p>`; }
    $("dg-card").classList.remove("busy"); $("dg-go").disabled = false;
  };
}
const lvl = v => ({ alta: "crit", media: "warn", bassa: "good" }[String(v).toLowerCase()] || "calm");
const li = a => (a || []).filter(Boolean).map(x => `<li>${esc(x)}</li>`).join("") || "<li>Nessuna indicazione.</li>";
function diagHtml(j) { const c = j.cura || {}, col = (t, v, items) => `<div class="card diag" style="--kc:var(${v});border-top:4px solid var(${v})"><h3>${t}</h3><ul class="list">${liK(items)}</ul></div>`;
  return `<div class="card diag" style="--kc:var(--est);border-top:4px solid var(--est)"><div class="card-h"><h2>${kw(j.problema)}</h2><div class="tags"><span class="chip ${j.confidenza === "alta" ? "good" : j.confidenza === "media" ? "warn" : "calm"}">Confidenza ${esc(j.confidenza)}</span><span class="chip ${lvl(j.urgenza)}">Urgenza ${esc(j.urgenza)}</span></div></div><ul class="list">${liK(j.cosa_vedo)}</ul></div>
  <div class="grid g2"><div class="card diag" style="--kc:var(--aut)"><h3>Cause probabili</h3>${(j.cause || []).slice(0, 3).map(x => `<div class="cause"><span class="chip ${x.probabilita === "alta" ? "crit" : x.probabilita === "media" ? "warn" : "calm"}">${esc(x.probabilita)}</span><div><b class="kw">${esc(String(x.causa || "").replace(/\*\*/g, ""))}</b><span class="note">${kw(x.perche)}</span></div></div>`).join("")}</div>
  ${col("Come averne la conferma", "--inv", j.controlli)}</div>
  <div class="steps3">${col("Subito", "--aut", c.subito)}${col("Nelle prossime settimane", "--est", c.prossime_settimane)}${col("Per non ricaderci", "--pri", c.prevenzione)}</div>
  ${agroHelp(j.intervento_agro || j.quando_chiamare_un_tecnico, j.limiti)}`; }
/* L'assistenza la dà Agro: richiesta di intervento, simulata in questa versione */
function agroHelp(quando, limiti) { return `<div class="card diag" style="--kc:var(--pri);border-top:4px solid var(--pri)"><div class="card-h"><h3>Se serve, interveniamo noi</h3><span class="chip acc">Assistenza Agro</span></div>
  ${quando ? `<p>${kw(quando)}</p>` : ""}<p class="note">${limiti ? kw(limiti) + " " : ""}Una foto orienta. Se non basta, un tecnico Agro viene in azienda a guardare.</p>
  <div id="ag-help">${P.intervento ? `<p class="note"><b class="kw">Richiesta registrata il ${esc(P.intervento)}.</b> Un tecnico Agro ti contatta entro 24 ore lavorative.</p>` : `<button class="btn" type="button" data-agro-help>Chiedi l'intervento di un tecnico Agro</button>`}</div></div>`; }
addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-agro-help]"); if (!b) return; P.intervento = new Date().toLocaleDateString("it-IT", { day: "numeric", month: "long" }) + " alle " + new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }); save();
  b.parentNode.innerHTML = `<p class="note"><b class="kw">Richiesta registrata il ${esc(P.intervento)}.</b> Un tecnico Agro ti contatta entro 24 ore lavorative.</p>`; });
function shrink(src) { return new Promise((ok, ko) => { const img = new Image(), u = typeof src === "string" ? src : URL.createObjectURL(src); img.onload = () => { const k = Math.min(1, 1400 / Math.max(img.width, img.height)), c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); ok(c.toDataURL("image/jpeg", 0.85)); }; img.onerror = ko; img.src = u; }); }
function frames(file) { return new Promise((ok, ko) => { const v = document.createElement("video"); v.muted = true; v.preload = "auto"; v.src = URL.createObjectURL(file); const out = [], at = [0.15, 0.4, 0.65, 0.9]; let i = 0;
  v.onloadedmetadata = () => { v.currentTime = v.duration * at[0]; };
  v.onseeked = () => { const k = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight)), c = document.createElement("canvas"); c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k); c.getContext("2d").drawImage(v, 0, 0, c.width, c.height); out.push(c.toDataURL("image/jpeg", 0.82)); i++; if (i < at.length) v.currentTime = v.duration * at[i]; else ok(out); };
  v.onerror = () => ko(new Error("video non leggibile")); setTimeout(() => out.length ? ok(out) : ko(new Error("video non leggibile")), 20000); }); }

/* Imprevisti: per ogni tipo di problema una risposta in tre tempi */
const EV = [
  { id: "incendio", nome: "Incendio", per: "tutti", perdita: 1, alberi: true, leve: ["ins", "soil"],
    sub: ["Mettiti al sicuro e chiama il 112 o il 115. Non rientrare finché i vigili del fuoco non danno il via libera.", "Prima di toccare qualsiasi cosa, fotografa e filma tutto: piante, impianti, recinzioni, mezzi, scorte.", "Avvisa subito l'assicurazione e chiedi al Comune se viene aperta la segnalazione dei danni per calamità.", "Controlla impianto irriguo e linee elettriche prima di ridare corrente o acqua."],
    rec: ["Il legno bruciato si può vendere o usare come legna da ardere, cippato per biomassa o carbone vegetale: fatti fare un preventivo da chi lo ritira prima di pagare lo smaltimento.", "Le piante solo scottate possono ricacciare: per olivo, vite e agrumi aspetta la ripresa vegetativa prima di estirpare.", "La cenere apporta potassio ma alza il pH: fai un'analisi del suolo prima di concimare.", "Tieni da parte fatture e stime: servono per assicurazione, contributi e detrazioni."],
    rip: ["Se il fuoco ha toccato bosco o pascolo, chiedi al Comune quali vincoli valgono sulle aree percorse dal fuoco prima di cambiare uso al terreno.", "Semina subito una copertura erbacea sui terreni nudi in pendenza: dopo un incendio la prima pioggia forte porta via il suolo.", "Fasce tagliafuoco lavorate o pascolate lungo i confini e punti d'acqua accessibili ai mezzi.", "Valuta nella scheda Simulazione assicurazione e colture di copertura."] },
  { id: "grandine", nome: "Grandine", per: "campo", perdita: 0.6, leve: ["ins", "P"],
    sub: ["Fotografa il danno entro 24 ore, con riferimenti di data e appezzamento.", "Denuncia il sinistro all'assicurazione nei termini della polizza e non raccogliere prima della perizia.", "Sulle ferite fresche di arboree e orticole valuta con il tecnico Agro un intervento cicatrizzante e disinfettante."],
    rec: ["Il prodotto segnato ma sano può andare all'industria di trasformazione invece che al fresco: chiama subito i ritiri.", "Su colture giovani verifica se una risemina o un secondo trapianto è ancora nei tempi.", "Frutti e residui non vendibili possono andare a compost, biogas o alimentazione animale, se ammessi."],
    rip: ["Pota e riequilibra le arboree colpite per salvare la produzione dell'anno dopo.", "Valuta reti antigrandine sulle superfici di maggior valore e l'assicurazione parametrica.", "Controlla nelle settimane successive le infezioni che entrano dalle ferite."] },
  { id: "gelata", nome: "Gelata tardiva", per: "campo", perdita: 0.5, leve: ["cal", "P", "ins"],
    sub: ["Non potare e non concimare subito: aspetta 7-10 giorni per vedere quali gemme e germogli ripartono.", "Documenta con foto datate e segna le zone più colpite: sono le più fredde anche l'anno prossimo.", "Avvisa l'assicurazione."],
    rec: ["Su arboree le gemme secondarie possono dare una produzione parziale: regola diradamento e concimazione su quel carico.", "Su orticole e semine primaverili valuta risemina o nuovo trapianto se il calendario lo consente.", "Riduci irrigazione e concime in proporzione alla produzione rimasta: è spesa che non rientra."],
    rip: ["Usa la scheda Stagione ogni anno a fine inverno: con primavera precoce il rischio di gelo sulle fasi sensibili sale.", "Potatura tardiva e varietà a germogliamento tardivo nelle zone basse e fredde.", "Protezione antibrina sulle superfici di maggior valore."] },
  { id: "alluvione", nome: "Alluvione o allagamento", per: "tutti", perdita: 0.7, alberi: true, leve: ["soil", "ins"],
    sub: ["Non entrare con i mezzi sul terreno saturo: compatti il suolo per anni.", "Apri scoline e fossi e libera gli scarichi per far defluire l'acqua il prima possibile.", "Fotografa i livelli d'acqua e i danni. Tieni gli animali lontani da acqua e foraggi contaminati.", "Segnala i danni a Comune e assicurazione."],
    rec: ["Il prodotto venuto a contatto con acqua di piena non va venduto per consumo fresco: chiedi al tecnico Agro cosa si può destinare ad altri usi.", "Foraggi bagnati: valuta l'insilamento rapido solo se non contaminati da fango.", "Se resta tempo nella stagione, una coltura a ciclo breve o da sovescio recupera parte dell'anno."],
    rip: ["Analisi del suolo dopo l'evento: sedimenti, sale, contaminanti.", "Ripristina la rete di scolo e valuta baulature o drenaggi nelle zone che si allagano.", "Colture di copertura per ricostruire struttura e sostanza organica."] },
  { id: "siccita", nome: "Siccità grave", per: "tutti", perdita: 0.45, leve: ["W", "v", "C", "ins"],
    sub: ["Decidi subito le priorità: l'acqua che c'è va alle superfici e alle fasi che rendono di più.", "Irriga di notte o all'alba e controlla perdite e uniformità dell'impianto.", "In allevamento garantisci prima l'acqua di abbeverata e l'ombra."],
    rec: ["Raccolta anticipata dove la qualità sta scendendo: meglio un prodotto minore che nessuno.", "Colture compromesse possono diventare foraggio o insilato invece di andare perse.", "Acquista ora i foraggi mancanti: i prezzi salgono quando tutta la zona è a secco."],
    rip: ["Guarda nella scheda Piano quando conviene investire in accumulo e irrigazione efficiente.", "Varietà tolleranti e quota di superficie a colture meno esigenti.", "Sostanza organica e coperture: il suolo trattiene più acqua."] },
  { id: "caldo", nome: "Ondata di calore", per: "tutti", perdita: 0.25, leve: ["P", "cal", "sens"],
    sub: ["Irriga nelle ore fresche e con turni più ravvicinati e brevi.", "Sospendi trattamenti e lavorazioni nelle ore calde.", "In stalla: ventilazione al massimo, docce a cicli, acqua fresca sempre disponibile, razione spostata alla sera."],
    rec: ["Raccogli al mattino presto e raffredda subito il prodotto.", "Anticipa la raccolta dei frutti vicini alla maturazione.", "Riduci il carico di frutti sulle piante più stressate."],
    rip: ["Reti ombreggianti o raffrescamento dove il danno si ripete.", "Calendario adattivo: anticipare il ciclo sposta le fasi sensibili fuori dal picco.", "Sensori di temperatura e umidità per intervenire prima."] },
  { id: "malattia", nome: "Attacco di parassiti o malattia delle piante", per: "campo", perdita: 0.35, leve: ["ipm", "sens", "C"],
    sub: ["Fotografa i sintomi e usa la scheda Diagnosi da foto per un primo orientamento.", "Delimita il focolaio e lavora quella zona per ultima, pulendo attrezzi e mezzi.", "Chiedi l'intervento del tecnico Agro prima di trattare: un prodotto sbagliato costa e non risolve. Se sospetti un organismo da quarantena, avvisa il servizio fitosanitario regionale."],
    rec: ["Raccogli prima la parte sana e tienila separata.", "Il prodotto colpito ma non pericoloso può avere sbocchi diversi dal fresco.", "Elimina i residui infetti secondo le indicazioni del tecnico Agro per non lasciare inoculo."],
    rip: ["Rotazioni più lunghe e varietà resistenti dove esistono.", "Difesa integrata con monitoraggio: trappole, modelli previsionali, soglie di intervento.", "Diversifica: una sola coltura su tutta la superficie è il rischio più grande."] },
  { id: "stalla", nome: "Malattia o moria in allevamento", per: "allev", perdita: 0.4, leve: ["ipm", "ins"],
    sub: ["Isola gli animali con sintomi e chiama subito il veterinario aziendale.", "Per le malattie soggette a denuncia l'avviso al servizio veterinario dell'ASL è obbligatorio: lo fa il veterinario o lo fai tu.", "Ferma entrate e uscite di animali, mezzi e persone non necessarie. Disinfetta gli accessi.", "Annota capi colpiti, date e sintomi: servono per indennizzi e assicurazione."],
    rec: ["Per gli abbattimenti disposti dall'autorità sanitaria esistono indennizzi: chiedi subito tempi e documenti.", "Smaltisci le carcasse solo tramite ditta autorizzata.", "Rivedi la razione per i capi sani per sostenere la produzione."],
    rip: ["Piano di biosicurezza scritto: quarantena per i nuovi ingressi, percorsi separati, lotta a insetti e roditori.", "Piano vaccinale concordato con il veterinario.", "Assicurazione sul bestiame e fondo di mutualità, se disponibili."] },
  { id: "guasto", nome: "Guasto di un impianto", per: "tutti", perdita: 0.15, leve: ["sens"],
    sub: ["Metti in sicurezza: togli corrente e pressione prima di intervenire.", "Attiva subito la soluzione di riserva: autobotte, gruppo elettrogeno, mungitura o irrigazione a turni ridotti.", "Chiama l'assistenza e chiedi tempi certi per i ricambi."],
    rec: ["Concentra acqua o energia disponibile sulle superfici e sui capi più sensibili.", "Verifica garanzia e copertura assicurativa del guasto.", "Tieni traccia delle ore di fermo e delle perdite."],
    rip: ["Manutenzione programmata prima della stagione critica.", "Ricambi essenziali in magazzino e un contatto di assistenza sempre reperibile.", "Sensori e allarmi su pressione, portata e temperatura."] },
  { id: "prezzi", nome: "Crollo dei prezzi", per: "tutti", perdita: 0.3, leve: ["C", "ins"],
    sub: ["Calcola il prezzo sotto il quale conviene non raccogliere o non vendere: costo di raccolta e trasporto contro prezzo offerto.", "Senti più acquirenti, organizzazione di produttori e cooperativa prima di accettare.", "Verifica se puoi conservare o trasformare e vendere più avanti."],
    rec: ["Trasformazione, vendita diretta o canali locali per una parte del prodotto.", "Ritiri dal mercato e misure di crisi tramite l'organizzazione di produttori, quando attivate.", "Rinegozia scadenze con fornitori e banca prima di andare in difficoltà di cassa."],
    rip: ["Contratti di filiera con prezzo minimo per una quota della produzione.", "Diversifica le colture: guarda la riconversione nella scheda Simulazione.", "Tieni una riserva di liquidità pari ad almeno una stagione di costi."] }
];
const REPL = { olivo: { c: 9000, y: 5 }, vite: { c: 25000, y: 3 }, tavola: { c: 40000, y: 3 }, agrumi: { c: 15000, y: 4 }, melo: { c: 40000, y: 3 }, pero: { c: 35000, y: 4 }, pesco: { c: 20000, y: 3 }, albicocco: { c: 18000, y: 3 }, ciliegio: { c: 30000, y: 4 }, susino: { c: 18000, y: 3 }, kiwi: { c: 35000, y: 3 }, nocciolo: { c: 9000, y: 5 }, mandorlo: { c: 10000, y: 4 }, castagno: { c: 8000, y: 7 } };
function vImprevisti() {
  const evs = EV.filter(e => e.per === "tutti" || e.per === P.tipo); if (!evs.find(e => e.id === V.evento)) V.evento = evs[0].id;
  const ev = evs.find(e => e.id === V.evento), q = V.quota / 100, ric = R.oggi.ricavo, tree = field() && REPL[P.coltura], canRe = ev.alberi && tree;
  const num = () => { const q = V.quota / 100; let dan = q * ev.perdita * ric, extra = 0; if (canRe && V.reimp) extra = q * P.ettari * tree.c + q * ric * tree.y * 0.9; return `<div class="kv"><span><b class="num">${eur(dan)}</b>${extra ? "Ricavo perso quest'anno" : "Danno stimato: ricavo perso quest'anno"}</span>${extra ? `<span><b class="num">${eur(extra)}</b>Reimpianto e anni senza produzione</span>` : ""}${extra ? `<span><b class="num">${eur(dan + extra)}</b>Danno totale stimato</span>` : `<span><b class="num">${pct(q * ev.perdita)}</b>Quota del ricavo di un anno</span>`}</div>
    <p class="note">Stima di massima: ricavo annuo (${eur(ric)}) × quota colpita × perdita tipica per questo evento (${pct(ev.perdita)})${canRe && V.reimp ? `, con ${nf(tree.c)} € per ettaro di reimpianto e ${tree.y} anni prima della piena produzione` : ""}. Serve a decidere quanto vale la pena spendere per recuperare, non per la denuncia dei danni.</p>`; };
  const l = L();
  $("v-imprevisti").innerHTML = `<div><p class="eyebrow" style="--c:var(--aut)">Imprevisti</p><h1 class="verdict">Quando succede qualcosa che nessuno aveva previsto: <em>cosa fare subito, cosa si può ancora salvare, come ripartire</em>.</h1></div>
  <div class="card"><h2>Cos'è successo?</h2><div class="pick" id="ev-pick">${evs.map(e => `<button type="button" data-e="${e.id}" class="${e.id === ev.id ? "on" : ""}">${e.nome}</button>`).join("")}</div>
    <div class="grid g2"><label class="ctl">Quota di ${field() ? "superficie" : "allevamento"} colpita: <b>${V.quota}%</b><input type="range" id="ev-q" min="5" max="100" step="1" value="${V.quota}"></label>
    ${canRe ? `<label class="switch"><input type="checkbox" id="ev-re" ${V.reimp ? "checked" : ""}>Le piante sono da reimpiantare</label>` : "<span></span>"}</div>
    <div id="ev-num" style="display:flex;flex-direction:column;gap:10px">${num()}</div></div>
  <div class="steps3">
    <div class="card" style="border-top:4px solid var(--aut)"><h3>Subito, nelle prime 48 ore</h3><ol class="list">${ev.sub.map(x => `<li>${x}</li>`).join("")}</ol></div>
    <div class="card" style="border-top:4px solid var(--est)"><h3>Cosa si può ancora salvare</h3><ol class="list">${ev.rec.map(x => `<li>${x}</li>`).join("")}</ol></div>
    <div class="card" style="border-top:4px solid var(--pri)"><h3>Come ripartire più protetto</h3><ol class="list">${ev.rip.map(x => `<li>${x}</li>`).join("")}</ol></div></div>
  <div class="card"><div class="card-h"><h2>Mosse del piano che riducono questo rischio</h2><a class="btn ghost" href="#simulazione">Provale in Simulazione</a></div>
    <div class="tags">${ev.leve.map(k => `<span class="chip ${(k in R.scelta.leve ? R.scelta.leve[k] : R.scelta.invest & (1 << AM.INV.indexOf(k)) || R.percorso.ora.includes(k)) ? "good" : "calm"}">${esc(k === "cal" ? l.cal.name + " adattivo" : l[k].name)}</span>`).join("")}</div>
    <p class="note">In verde le mosse già nel piano consigliato.</p>
    <label class="ctl">Racconta il tuo caso a My Agro<textarea id="ev-t" rows="2" placeholder="Es. si sono bruciati 2 ettari di oliveto di 30 anni vicino alla strada, l'impianto a goccia è fuso"></textarea></label>
    <div><button class="btn" id="ev-ask" type="button">Chiedi una soluzione per il mio caso</button></div></div>`;
  $("ev-pick").onclick = e => { const b = e.target.closest("button"); if (b) { V.evento = b.dataset.e; vImprevisti(); } };
  $("ev-q").oninput = e => { V.quota = +e.target.value; e.target.parentNode.querySelector("b").textContent = V.quota + "%"; $("ev-num").innerHTML = num(); };
  if ($("ev-re")) $("ev-re").onchange = e => { V.reimp = e.target.checked; vImprevisti(); };
  $("ev-ask").onclick = () => { const t = $("ev-t").value.trim(); ask(`Imprevisto: ${ev.nome.toLowerCase()} sul ${V.quota}% ${field() ? "della superficie" : "dell'allevamento"}. ${t} Cosa faccio adesso, cosa posso recuperare o trasformare in valore e come riparto?`); if (!wide.matches) location.hash = "consulente"; };
}

/* Bandi: cerca quelli aperti, legge un bando e dice se l'azienda può partecipare */
let bando = null, bandi = null, bPdf = null;
const BJSON = `{"titolo":"","ente":"","scadenza":"data o 'non indicata'","contributo":"percentuale, massimali, forma dell'aiuto","esito":"si|probabile|no|non_chiaro","motivo":"una frase","requisiti":[{"requisito":"","stato":"ok|manca|da_verificare","nota":""}],"spese_ammissibili":[{"voce":"","leva":"W|C|P|G|sens|v|soil|ipm|ins|nessuna","percentuale":0}],"passi":["cosa fare, in ordine"],"attenzione":["vincoli, impegni, scadenze, incompatibilità"]}`;
function vBandi() {
  const l = L(), lev = Object.keys(l).filter(k => k !== "cal").map(k => `${k} = ${l[k].name}`).join("; ");
  $("v-bandi").innerHTML = `<div><p class="eyebrow" style="--c:var(--inv)">Bandi e contributi</p><h1 class="verdict">Cerco i bandi aperti per la tua azienda, <em>leggo il testo e ti dico se puoi partecipare</em> e quali investimenti del piano copre.</h1></div>
  ${IA ? "" : noIA}
  <div class="grid g2">
    <div class="card scan" id="b-c1"><h2>Cerca bandi aperti</h2><p class="lede" style="font-size:14px">Cerco sul web i bandi per ${esc(P.regione)} adatti a ${esc(subject().toLowerCase())}${P.giovane ? ", titolare giovane" : ""}${P.bio ? ", biologico" : ""}. Regione e profilo si cambiano in Azienda.</p>
      <div><button class="btn" id="b-find" type="button" ${IA ? "" : "disabled"}>Cerca adesso</button></div></div>
    <div class="card scan" id="b-c2"><h2>Leggi un bando</h2>
      <label class="drop" id="b-drop" style="padding:14px"><b id="b-pdfn">Carica il PDF del bando</b><input type="file" id="b-file" accept="application/pdf" hidden></label>
      <label class="ctl">Oppure incolla l'indirizzo della pagina o il testo<textarea id="b-txt" rows="3" placeholder="https://… oppure il testo del bando"></textarea></label>
      <div><button class="btn" id="b-read" type="button" ${IA ? "" : "disabled"}>Posso partecipare?</button></div></div>
  </div>
  <div id="b-out">${bando ? bandoHtml(bando) : ""}${bandi ? bandiHtml(bandi) : ""}</div>`;
  $("b-file").onchange = e => { const f = e.target.files[0]; if (!f) return; if (f.size > 25e6) { $("b-pdfn").textContent = "File troppo grande: massimo 25 MB"; return; } const rd = new FileReader(); rd.onload = () => { bPdf = { nome: f.name, b64: String(rd.result).split(",")[1] }; $("b-pdfn").textContent = "Caricato: " + f.name; }; rd.readAsDataURL(f); };
  $("b-find").onclick = async () => { $("b-c1").classList.add("busy"); $("b-find").disabled = true; $("b-out").innerHTML = `<p class="note">Cerco i bandi aperti… può volerci qualche minuto.</p>`;
    const prompt = `Sei un consulente di finanza agevolata per l'agricoltura in Italia. Usa la ricerca sul web per trovare bandi e contributi pubblici APERTI oggi o di prossima apertura adatti a questa azienda (Complemento di sviluppo rurale della regione, PNRR agricoltura, ISMEA, INAIL ISI agricoltura, OCM di settore, bandi regionali e camerali).\n${ctx()}\nINVESTIMENTI CHE L'AZIENDA STA VALUTANDO: ${R.scelta.descrizione.join("; ") || "nessuno"}; possibili: ${R.opzioni.map(o => o.nome).join("; ")}.\n\nRispondi SOLO con un oggetto JSON valido in italiano:\n{"bandi":[{"titolo":"","ente":"","scadenza":"data letta nella fonte o 'da verificare'","contributo":"","link":"indirizzo della pagina ufficiale trovata","perche_adatto":"","esito":"si|probabile|no|non_chiaro"}],"nota":""}\nRegole: elenca solo bandi che hai trovato davvero nella ricerca, con il link della fonte; non inventare scadenze o percentuali: se non le hai lette scrivi 'da verificare'; al massimo 6, i più pertinenti; preferisci fonti ufficiali (regione, ministero, ISMEA, INAIL).`;
    try { const j = parseJSON(await ai(prompt, { web: true })); bandi = j && Array.isArray(j.bandi) ? j : { bandi: [], nota: "La ricerca non ha restituito un elenco leggibile. Riprova." }; bando = null; }
    catch (e) { bandi = { bandi: [], nota: "Ricerca non riuscita: " + e.message }; }
    vBandi(); };
  $("b-read").onclick = async () => { const t = $("b-txt").value.trim(), isUrl = /^https?:\/\/\S+$/i.test(t); if (!bPdf && !t) { $("b-out").innerHTML = `<p class="note crit">Carica un PDF oppure incolla indirizzo o testo del bando.</p>`; return; }
    $("b-c2").classList.add("busy"); $("b-read").disabled = true; $("b-out").innerHTML = `<p class="note">Leggo il bando… può volerci un paio di minuti.</p>`;
    const prompt = `Sei un consulente di finanza agevolata per l'agricoltura. Leggi il bando ${bPdf ? "nel file PDF indicato in fondo" : isUrl ? "a questo indirizzo: " + t : "riportato sotto"} e valuta se questa azienda può partecipare.\n${ctx()}\nLEVE DEL PIANO (codice = investimento): ${lev}.\n${!bPdf && !isUrl ? "\nTESTO DEL BANDO:\n" + t.slice(0, 60000) + "\n" : ""}\nRispondi SOLO con un oggetto JSON valido in italiano:\n${BJSON}\nRegole: basati solo sul testo del bando; per ogni requisito di ammissibilità indica se l'azienda lo soddisfa con i dati che hai (ok), non lo soddisfa (manca) o servono dati che non hai (da_verificare); in spese_ammissibili collega ogni voce alla leva del piano corrispondente e riporta la percentuale di contributo scritta nel bando per questa azienda (numero, oppure null se non indicata); non inventare nulla che non sia nel testo; se il documento non è un bando dillo in "motivo" con esito "non_chiaro".`;
    try { const tx = await ai(prompt, { pdf: bPdf, web: !bPdf && isUrl }), j = parseJSON(tx); bando = j || { titolo: "Risposta", esito: "non_chiaro", motivo: tx, requisiti: [], spese_ammissibili: [], passi: [], attenzione: [] }; bandi = null; }
    catch (e) { bando = { titolo: "Lettura non riuscita", esito: "non_chiaro", motivo: e.message, requisiti: [], spese_ammissibili: [], passi: [], attenzione: [] }; }
    vBandi(); };
  const ap = $("b-apply"); if (ap) ap.onclick = () => { for (const s of bando.spese_ammissibili || []) if (["W", "C", "P", "G", "sens"].includes(s.leva) && s.percentuale > 0) P.contributi[s.leva] = Math.max(P.contributi[s.leva] || 0, Math.min(90, Math.round(s.percentuale))); P.example = P.example; save(); location.hash = "piano"; recompute(true); };
  $("b-out").onclick = e => { const b = e.target.closest("[data-read]"); if (b) { $("b-txt").value = b.dataset.read; $("b-read").click(); } };
}
const ES = { si: ["good", "Puoi partecipare"], probabile: ["warn", "Probabilmente sì"], no: ["crit", "Non puoi partecipare"], non_chiaro: ["calm", "Da chiarire"] };
function bandoHtml(b) { const es = ES[b.esito] || ES.non_chiaro, l = L(), sp = (b.spese_ammissibili || []), ok = sp.some(s => ["W", "C", "P", "G", "sens"].includes(s.leva) && s.percentuale > 0), st = { ok: ["good", "C'è"], manca: ["crit", "Manca"], da_verificare: ["warn", "Da verificare"] };
  return `<div class="card" style="border-top:4px solid var(--inv)"><div class="card-h"><h2>${esc(b.titolo)}</h2><span class="chip ${es[0]}">${es[1]}</span></div><p>${esc(b.motivo)}</p>
    <div class="kv"><span><b>${esc(b.ente || "—")}</b>Ente</span><span><b>${esc(b.scadenza || "—")}</b>Scadenza</span><span><b style="font-size:14px">${esc(b.contributo || "—")}</b>Contributo</span></div></div>
  <div class="grid g2"><div class="card"><h3>Requisiti</h3>${(b.requisiti || []).map(r => { const s = st[r.stato] || st.da_verificare; return `<div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0"><span>${esc(r.requisito)}${r.nota ? `<br><span class="note">${esc(r.nota)}</span>` : ""}</span><span class="chip ${s[0]}">${s[1]}</span></div>`; }).join("") || `<p class="note">Nessun requisito estratto.</p>`}</div>
  <div class="card"><h3>Spese ammissibili e mosse del piano</h3>${sp.map(s => `<div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0"><span>${esc(s.voce)}${l[s.leva] ? `<br><span class="note">Nel piano: ${esc(l[s.leva].name.toLowerCase())}</span>` : ""}</span><b class="num">${s.percentuale > 0 ? nf(s.percentuale) + "%" : "—"}</b></div>`).join("") || `<p class="note">Nessuna spesa estratta.</p>`}
    ${ok ? `<div><button class="btn" id="b-apply" type="button">Applica il contributo e ricalcola il piano</button></div><p class="note">Riduco il costo di quegli investimenti della percentuale indicata e rifaccio tutte le simulazioni.</p>` : ""}</div></div>
  <div class="grid g2"><div class="card"><h3>Cosa fare, in ordine</h3><ol class="list">${li(b.passi)}</ol></div><div class="card"><h3>A cosa stare attento</h3><ul class="list">${li(b.attenzione)}</ul></div></div>
  <p class="note">Lettura automatica del testo: prima di presentare domanda verifica requisiti e scadenze sul bando ufficiale o con il tuo centro di assistenza agricola.</p>`; }
function bandiHtml(b) { return `<div class="card"><h2>Bandi trovati</h2>${b.bandi.length ? b.bandi.map(x => { const es = ES[x.esito] || ES.non_chiaro, okL = /^https?:\/\//i.test(x.link || ""); return `<div style="border-top:1px solid var(--line);padding:10px 0;display:flex;flex-direction:column;gap:4px"><div class="card-h"><b>${esc(x.titolo)}</b><span class="chip ${es[0]}">${es[1]}</span></div>
    <span class="note">${esc(x.ente || "")} · Scadenza: ${esc(x.scadenza || "da verificare")} · ${esc(x.contributo || "")}</span><span>${esc(x.perche_adatto || "")}</span>
    <div class="tags">${okL ? `<a class="btn ghost" href="${esc(x.link)}" target="_blank" rel="noopener" style="padding:4px 10px;font-size:13px">Apri la fonte</a><button class="btn ghost" type="button" data-read="${esc(x.link)}" style="padding:4px 10px;font-size:13px">Leggilo e dimmi se posso partecipare</button>` : ""}</div></div>`; }).join("") : ""}
    <p class="note">${esc(b.nota || "")} Elenco da ricerca sul web: scadenze e percentuali vanno sempre controllate sulla pagina ufficiale.</p></div>`; }

/* Azienda e sedi */
const LIM = { stagione: 1, azienda: 3, impresa: 12 };
const sedeLim = () => logged() ? (LIM[A.piano] || 3) : 3;
function vAzienda() {
  const opt = (o, cur) => Object.keys(o).map(k => `<option value="${k}" ${k === cur ? "selected" : ""}>${o[k].name}</option>`).join(""), f = field(), lim = sedeLim(), full = P.sedi.length >= lim, pl = logged() ? (PLANS.find(p => p.id === A.piano) || PLANS[1]) : null;
  const subj = x => x.tipo === "campo" ? AM.CROPS[x.coltura].name + ", " + nf(x.ettari) + " ha" : AM.HERDS[x.specie].name + ", " + nf(x.capi) + " " + AM.HERDS[x.specie].u;
  $("v-azienda").innerHTML = `<div><p class="eyebrow">La tua azienda</p><h1 class="verdict">Ogni sede ha le sue specifiche: scegli quella di riferimento e <em>tutte le analisi si aggiornano</em>.</h1></div>
  <form class="farm card" id="co" style="max-width:none">
    <label>Ragione sociale<input type="text" id="c-nome" maxlength="80" value="${esc(P.nome)}"></label>
    <label>Partita IVA<input type="text" value="${logged() && A.piva ? esc(A.piva) + (A.daVies ? " · verificata nel registro VIES" : "") : "Si inserisce creando l'account"}" disabled></label>
    <label>Forma giuridica<select id="c-forma">${["Ditta individuale", "Società agricola", "Cooperativa"].map(r => `<option ${r === P.forma ? "selected" : ""}>${r}</option>`).join("")}</select></label>
    <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center"><label class="row"><input type="checkbox" id="c-giovane" ${P.giovane ? "checked" : ""}>Titolare sotto i 41 anni</label><label class="row"><input type="checkbox" id="c-bio" ${P.bio ? "checked" : ""}>Azienda biologica</label></div>
    <div class="full"><button class="btn ghost" type="submit">Salva i dati aziendali</button></div>
  </form>
  <div class="card" style="flex-direction:row;justify-content:space-between;flex-wrap:wrap;align-items:center;border-top:3px solid var(--inv)"><span><b>Sensori e dati automatici</b><br><span class="note">${P.gps ? "Posizione da GPS" : "Posizione dal comune"} · ${P.stazione ? "stazione caricata" : "nessuna stazione"} · ${Object.keys(P.collegati || {}).length} strumenti collegati</span></span><a class="btn ghost" href="#sensori">Collega GPS, stazione e sensori</a></div>
  <div class="card"><div class="card-h"><h2>Sedi</h2><span class="note">${P.sedi.length} di ${lim} ${pl ? "incluse nel piano " + pl.nome : "nella prova"}</span></div>
    <div id="sedi">${P.sedi.map((x, i) => { const cur = i === P.sede, y = cur ? pickSite(P) : x; return `<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;padding:10px 0;border-top:1px solid var(--line)"><span><b>${esc(y.nomeSede || "Sede " + (i + 1))}</b><br><span class="note">${esc(y.comune || "Comune da indicare")}${y.provincia ? " (" + esc(y.provincia) + ")" : ""}${y.quota != null ? " · " + nf(y.quota) + " m" : ""} · ${esc(subj(y))}</span></span>
      <span class="tags">${cur ? `<span class="chip good">Sede di riferimento</span>` : `<button class="btn ghost" type="button" data-use="${i}" style="padding:5px 12px">Usa come riferimento</button>`}${P.sedi.length > 1 ? `<button class="btn ghost" type="button" data-rm="${i}" style="padding:5px 12px">Togli</button>` : ""}</span></div>`; }).join("")}</div>
    <div class="card-h"><button class="btn" type="button" id="sede-add">Aggiungi una sede</button><span id="sede-msg" class="note"></span></div></div>
  <form class="farm card" id="farm" style="max-width:none"><h2 class="full">Specifiche di «${esc(P.nomeSede)}»</h2>
    <label>Nome della sede<input type="text" id="f-nomeSede" maxlength="50" value="${esc(P.nomeSede)}"></label>
    <label>Comune<input type="text" id="f-comune" maxlength="60" value="${esc(P.comune)}" placeholder="Es. Villa Literno"></label>
    <div class="full tags" id="f-luogo">${P.lat != null ? `<span class="chip acc plain">${esc(P.comune)}${P.provincia ? " (" + esc(P.provincia) + ")" : ""}</span><span class="chip calm plain">${nf(P.quota)} m di quota</span><span class="chip calm plain">${esc(P.regione)}</span><span class="chip calm plain">Clima: ${AM.ZONES[P.zona].name}</span><span class="note">Posizione, quota, regione e clima li ricaviamo dal comune.</span> <button class="linkb" type="button" id="f-alt">Non è il posto giusto?</button>` : `<span class="note">Scrivi il comune: posizione, quota, regione, clima e meteo li ricaviamo noi.</span>`}</div>
    <label>Cosa gestisci qui<select id="f-tipo"><option value="campo" ${f ? "selected" : ""}>Campo coltivato</option><option value="allev" ${f ? "" : "selected"}>Allevamento</option></select></label>
    <label>Terreno<select id="f-suolo"><option value="sabbioso">Sciolto, sabbioso: trattiene poca acqua</option><option value="medio">Medio impasto</option><option value="argilloso">Argilloso: trattiene molta acqua</option></select></label>
    <label>Giacitura<select id="f-giacitura"><option value="pianura">Pianura</option><option value="collina">Collina dolce</option><option value="pendenza">Pendenza marcata</option></select></label>
    <label data-for="campo">Coltura principale<select id="f-coltura">${[...new Set(Object.values(AM.CROPS).map(c => c.cat))].map(g => `<optgroup label="${g}">${Object.keys(AM.CROPS).filter(k => AM.CROPS[k].cat === g).map(k => `<option value="${k}" ${k === P.coltura ? "selected" : ""}>${AM.CROPS[k].name}</option>`).join("")}</optgroup>`).join("")}</select></label>
    <label data-for="campo">Superficie (ettari)<input type="number" id="f-ettari" min="1" step="1" value="${P.ettari}"></label>
    <label data-for="campo">Irrigazione<select id="f-irr"><option value="no">Nessuna, solo pioggia</option><option value="asp">Aspersione</option><option value="goccia">A goccia</option></select></label>
    <label data-for="campo">Prezzo dell'acqua (€/m³)<input type="number" id="f-acqua" min="0" step="0.01" value="${P.acqua}"></label>
    <label data-for="campo">Resa di oggi (t/ha)<input type="number" id="f-resa" min="0.1" step="0.1" value="${P.resa}"></label>
    <label data-for="campo">Prezzo di vendita (€/t)<input type="number" id="f-prezzo" min="1" step="1" value="${P.prezzo}"></label>
    <label data-for="campo">Costi per ettaro, acqua esclusa (€/ha)<input type="number" id="f-costo" min="0" step="10" value="${P.costo}"></label>
    <label data-for="allev">Specie<select id="f-specie">${[...new Set(Object.values(AM.HERDS).map(c => c.cat))].map(g => `<optgroup label="${g}">${Object.keys(AM.HERDS).filter(k => AM.HERDS[k].cat === g).map(k => `<option value="${k}" ${k === P.specie ? "selected" : ""}>${AM.HERDS[k].name}</option>`).join("")}</optgroup>`).join("")}</select></label>
    <label data-for="allev"><span id="l-capi">Numero di ${AM.HERDS[P.specie].u}</span><input type="number" id="f-capi" min="1" step="1" value="${P.capi}"></label>
    <label data-for="allev">Foraggi e mangimi autoprodotti (%)<input type="number" id="f-auto" min="0" max="100" step="5" value="${P.auto}"></label>
    <label data-for="allev">Raffrescamento del ricovero<select id="f-cool"><option value="no">Nessuno</option><option value="vent">Ventilazione</option><option value="docce">Ventilazione e docce</option></select></label>
    <label data-for="allev"><span id="l-prod">Venduto all'anno per ${hu(P.specie)} (kg di ${AM.HERDS[P.specie].what})</span><input type="number" id="f-prod" min="0.1" step="any" value="${P.prod}"></label>
    <label data-for="allev">Prezzo di vendita (€/kg)<input type="number" id="f-prezzoL" min="0.01" step="0.01" value="${P.prezzoL}"></label>
    <label data-for="allev"><span id="l-costoC">Costi all'anno per ${hu(P.specie)}, alimentazione compresa (€)</span><input type="number" id="f-costoC" min="0" step="any" value="${P.costoC}"></label>
    <p class="err full" id="f-err" hidden></p>
    <div class="full" style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" type="submit">Salva la sede e ricalcola</button>${logged() ? "" : `<button class="btn ghost" type="button" id="f-reset">Torna ai dati di esempio</button>`}</div>
    <p class="note full">Resa, prezzi e costi proposti sono valori di partenza: sostituiscili con quelli dei tuoi registri.${P.mercato ? ` Prezzi alla produzione in Italia (Eurostat, ${P.mercato.dal}-${P.mercato.anno}): da un anno all'altro variano in media del ${nf(P.mercato.vol * 100)}%${P.mercato.valore ? `; ultimo valore ${nf(P.mercato.valore, P.mercato.valore < 10 ? 2 : 0)} ${P.mercato.unita} nel ${P.mercato.anno}` : ""}. Usiamo questa variabilità nelle simulazioni.` : ""}</p>
  </form>`;
  $("f-irr").value = P.irr; $("f-cool").value = P.cool; $("f-suolo").value = P.suolo; $("f-giacitura").value = P.giacitura;
  const show = () => { const t = $("f-tipo").value; document.querySelectorAll("#farm [data-for]").forEach(x => x.hidden = x.dataset.for !== t); }; show();
  $("f-tipo").onchange = show;
  $("f-coltura").onchange = e => { const c = AM.CROPS[e.target.value]; $("f-resa").value = c.y; $("f-prezzo").value = c.price; $("f-costo").value = c.cost; };
  $("f-specie").onchange = e => { const k = e.target.value, h = AM.HERDS[k]; $("f-prod").value = h.prod; $("f-prezzoL").value = h.price; $("f-costoC").value = h.cost; $("l-capi").textContent = "Numero di " + h.u; $("l-prod").textContent = "Venduto all'anno per " + hu(k) + " (kg di " + h.what + ")"; $("l-costoC").textContent = "Costi all'anno per " + hu(k) + ", alimentazione compresa (€)"; };
  $("co").onsubmit = e => { e.preventDefault(); P.nome = $("c-nome").value.trim() || P.nome; P.forma = $("c-forma").value; P.giovane = $("c-giovane").checked; P.bio = $("c-bio").checked; save(); renderAll(); };
  $("farm").onsubmit = async e => { e.preventDefault(); const num = (k, min) => { const v = parseFloat($("f-" + k).value); return isFinite(v) && v >= min ? v : DEF[k]; }, er = $("f-err"), com = $("f-comune").value.trim(); er.hidden = true;
    if (com && (com.toLowerCase() !== (P.comune || "").toLowerCase() || P.lat == null)) { try { const l = await findPlace(com); if (!l.length) { er.textContent = "Non trovo il comune «" + com + "». Controlla come è scritto."; er.hidden = false; return; } applyPlace(l[0]); } catch (x) { er.textContent = "Non riesco a cercare il comune in questo momento. Riprova tra poco."; er.hidden = false; return; } }
    else if (!com) { P.comune = ""; P.lat = P.lon = P.quota = null; P.provincia = ""; P.meteo = null; }
    Object.assign(P, { example: false, nomeSede: $("f-nomeSede").value.trim() || "Sede", tipo: $("f-tipo").value, suolo: $("f-suolo").value, giacitura: $("f-giacitura").value,
      coltura: $("f-coltura").value, irr: $("f-irr").value, specie: $("f-specie").value, cool: $("f-cool").value, ettari: num("ettari", 1), acqua: num("acqua", 0), resa: num("resa", 0.1), prezzo: num("prezzo", 1), costo: num("costo", 0),
      capi: num("capi", 1), auto: Math.min(100, num("auto", 0)), prod: num("prod", 1), prezzoL: num("prezzoL", 0.01), costoC: num("costoC", 0) });
    P.prefs.bio = null; P.osservazioni = []; resetViews(); save(); location.hash = "stagione"; recompute(true); };
  if ($("f-alt")) $("f-alt").onclick = async () => { const box = $("f-luogo"); box.innerHTML = `<span class="note"><span class="spinner"></span> Cerco…</span>`; let l = []; try { l = await findPlace($("f-comune").value.trim() || P.comune); } catch (x) {}
    box.innerHTML = l.length ? `<span class="note">Scegli il posto giusto:</span>` + l.map((q, i) => `<button class="btn ghost" type="button" data-pl="${i}" style="padding:4px 10px;font-size:13px">${esc(q.nome)} (${esc(q.provincia)}), ${nf(q.quota || 0)} m</button>`).join("") : `<span class="note">Nessun altro posto trovato con questo nome.</span>`;
    box.onclick = e => { const b = e.target.closest("[data-pl]"); if (b) { applyPlace(l[+b.dataset.pl]); resetViews(); save(); recompute(true); } }; };
  if ($("f-reset")) $("f-reset").onclick = () => { P = merge({}); resetViews(); save(); recompute(true); };
  $("sedi").onclick = e => { const u = e.target.closest("[data-use]"), r = e.target.closest("[data-rm]"); if (u) switchSite(+u.dataset.use);
    if (r) { const i = +r.dataset.rm; P.sedi[P.sede] = pickSite(P); P.sedi.splice(i, 1); const ni = i === P.sede ? 0 : P.sede > i ? P.sede - 1 : P.sede; P.sede = ni; Object.assign(P, JSON.parse(JSON.stringify(P.sedi[ni]))); resetViews(); save(); recompute(true); } };
  $("sede-add").onclick = () => { if (full) { const nx = logged() ? PLANS[PLANS.findIndex(p => p.id === A.piano) + 1] : null;
      $("sede-msg").innerHTML = nx ? `Il piano ${pl.nome} include ${lim} ${lim === 1 ? "sede" : "sedi"}. <button class="linkb" id="up" type="button">Passa a ${nx.nome}: ${nf(Math.round(nx.m * (ciclo === "anno" ? 10 / 12 : 1)))} € al mese, fino a ${LIM[nx.id]} sedi</button>` : logged() ? `Hai raggiunto le ${lim} sedi del piano ${pl.nome}: ogni sede in più costa 25 € al mese.` : `Nella prova senza account puoi tenere ${lim} sedi. <a href="#registrati">Crea l'account</a>`;
      if ($("up")) $("up").onclick = () => { A.piano = nx.id; saveA(); acctUI(); vAzienda(); $("sede-msg").innerHTML = `<span class="good">Certo, sei passato al piano ${nx.nome}.</span>`; }; return; }
    P.sedi[P.sede] = pickSite(P); const n = Object.assign(pickSite(merge({})), { nomeSede: "Sede " + (P.sedi.length + 1), comune: "", provincia: "", lat: null, lon: null, quota: null, meteo: null, regione: P.regione, zona: P.zona, tipo: P.tipo, coltura: P.coltura, specie: P.specie, osservazioni: [], contributi: {} });
    P.sedi.push(n); P.sede = P.sedi.length - 1; Object.assign(P, JSON.parse(JSON.stringify(n))); P.example = false; resetViews(); save(); recompute(true); location.hash = "azienda"; };
}
function resetViews() { SIM = null; lastPlan = null; planChanged = null; bando = null; bandi = null; V.sim = { flex: { v: 0, cal: 0, soil: 0, ipm: 0, sens: 0, ins: 0 }, mask: 0 }; $("msgs").innerHTML = ""; chat = []; }

/* ---------- Sensori e dati automatici ---------- */
/* Cosa Agro legge davvero oggi: posizione GPS del dispositivo, file della stazione o dei sensori (CSV), confini dei campi (GeoJSON o KML).
   Il collegamento diretto alle marche di sensori non c'è ancora: è dichiarato nella pagina. */
const TOOLS = [
  { id: "stazione", nome: "Stazione meteo aziendale", c: "--inv", stato: "file", misura: "Temperatura e umidità dell'aria, pioggia, vento, radiazione solare; a richiesta bagnatura fogliare.", spec: ["Un dato ogni 10-15 minuti", "Pannello solare e batteria", "Rete mobile o LoRaWAN", "Esporta in CSV o via API"], costo: "500-2.500 € più eventuale canone dati", agro: "Clima della sede: piogge per stagione, giorni sopra 32 °C, ultima notte fredda, inizio della primavera.", vant: "La rianalisi che uso senza stazione ha maglie di 9 km e smussa gelate e picchi di caldo. La stazione misura quelli del tuo campo." },
  { id: "suolo", nome: "Sensori di umidità del suolo", c: "--aut", stato: "file", misura: "Acqua nel terreno a due o tre profondità e temperatura del suolo.", spec: ["Sonde capacitive o tensiometri", "Un dato ogni 15-60 minuti", "Batteria da 2 a 5 anni", "Un punto ogni zona omogenea di terreno"], costo: "150-600 € a punto di misura", agro: "Umidità media e minima del periodo, a disposizione di My Agro per i consigli sull'irrigazione.", vant: "Irrighi quando serve alla pianta e non a calendario. Nel piano è la mossa «Sensori di suolo e centralina meteo»." },
  { id: "salinita", nome: "Sonda di salinità e pH del suolo", c: "--est", stato: "no", misura: "Conducibilità elettrica (sali) e acidità del terreno.", spec: ["Sonda fissa o misure periodiche con strumento portatile", "Utile con acque di falda vicino al mare", "Da affiancare all'analisi di laboratorio"], costo: "200-800 € la sonda; 30-80 € l'analisi", agro: "Oggi non la leggo. Servirà a correggere il rischio di salinità che nelle zone di costa stimo a calcolo.", vant: "Vedi per tempo se l'irrigazione sta accumulando sali." },
  { id: "contatore", nome: "Contatore d'acqua sull'impianto", c: "--inv", stato: "no", misura: "Metri cubi distribuiti per settore e per turno.", spec: ["Contatore a impulsi o flussimetro", "Lettura a mano o trasmessa", "Uno per settore irriguo"], costo: "100-500 € a punto", agro: "Oggi non lo leggo. Darà il consumo reale al posto di quello stimato nella scheda Piano.", vant: "Sai quanta acqua usi davvero e quanto ti costa a ettaro." },
  { id: "gps", nome: "GPS del telefono", c: "--pri", stato: "ok", misura: "Posizione di dove ti trovi.", spec: ["Precisione di 3-10 metri", "Nessun costo", "Basta essere in azienda con il telefono"], costo: "Gratis", agro: "Coordinate esatte della sede: clima e meteo vengono letti su quel punto e non sul centro del comune.", vant: "In collina o lontano dal paese il clima cambia in pochi chilometri." },
  { id: "trattore", nome: "GPS e guida satellitare del trattore", c: "--pri", stato: "file", misura: "Confini dei campi, superfici lavorate, tracce, ore macchina.", spec: ["1-3 metri senza correzione", "2-30 centimetri con correzione RTK", "Esporta i confini in file"], costo: "Da 1.000 € il ricevitore; fino a 10.000 € e oltre con guida automatica", agro: "Leggo il file dei confini (GeoJSON o KML) e calcolo gli ettari reali della sede.", vant: "Rese, costi e acqua per ettaro si calcolano sulla superficie vera, non su quella catastale." },
  { id: "stalla", nome: "Sensori di temperatura e umidità in stalla", c: "--est", stato: "file", misura: "Temperatura e umidità nel ricovero: da qui l'indice di stress da caldo.", spec: ["Un dato ogni 10-30 minuti", "Un punto ogni ambiente", "Batteria o rete elettrica"], costo: "100-400 € a punto", agro: "Giorni caldi misurati dentro il ricovero, non all'aperto.", vant: "Vedi se ventilazione e docce bastano, prima che cali la produzione." },
  { id: "collari", nome: "Collari e sensori sugli animali", c: "--aut", stato: "no", misura: "Attività, ruminazione, calori, primi segni di malattia.", spec: ["Un sensore per capo", "Antenna in stalla", "Avvisi sul telefono"], costo: "80-150 € a capo più il sistema di lettura", agro: "Oggi non li leggo.", vant: "Interventi sanitari più precoci e fecondazioni al momento giusto." },
  { id: "trappole", nome: "Trappole elettroniche e captaspore", c: "--aut", stato: "no", misura: "Catture di insetti con foto giornaliera; spore di funghi nell'aria.", spec: ["Fotocamera e rete mobile", "Conteggio automatico", "Una ogni 2-5 ettari per coltura"], costo: "300-1.500 € l'una", agro: "Oggi non le leggo. Sostituiranno la pressione dei parassiti che ora stimo dal clima.", vant: "Tratti quando la soglia è superata, non a calendario." },
  { id: "satellite", nome: "Immagini da satellite", c: "--pri", stato: "no", misura: "Vigore della vegetazione campo per campo.", spec: ["Sentinel-2: un passaggio ogni 5 giorni circa", "Dettaglio di 10 metri", "Non serve installare nulla"], costo: "Dati gratuiti", agro: "Oggi non le leggo. Servono i confini dei campi, che puoi già caricare.", vant: "Trovi le zone che soffrono prima di vederle a occhio." }
];
const STATO = { ok: ["good", "Agro lo legge già"], file: ["acc", "Agro lo legge da file"], no: ["calm", "Non ancora collegato"] };
const DOY = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
function parseDay(v) { let m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/.exec(v); if (m) return [+m[1], +m[2], +m[3]]; m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/.exec(v); return m ? [+m[3], +m[2], +m[1]] : null; }
/* Legge un CSV di stazione o sensori: una riga per giorno o più righe al giorno. Colonne riconosciute dal nome. */
function readCsv(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(l => l.trim()); if (lines.length < 2) throw new Error("il file è vuoto");
  const del = [";", "\t", ","].map(d => [d, lines[0].split(d).length]).sort((a, b) => b[1] - a[1])[0][0], head = lines[0].split(del).map(h => h.trim().toLowerCase().replace(/["']/g, ""));
  const find = (...re) => { for (const r of re) { const i = head.findIndex(h => r.test(h)); if (i >= 0) return i; } return -1; };
  const cD = find(/^(data|date|giorno|time|timestamp|datetime|data e ora)/), cN = find(/t.*min|min.*temp|^min/), cX = find(/t.*max|max.*temp|^max/), cM = find(/t.*(med|mean|avg)|temp.*(aria|air)|^temp|^t$/), cR = find(/piogg|rain|prec|^mm/), cS = find(/umid.*(suolo|terr)|soil|vwc/);
  if (cD < 0) throw new Error("non trovo la colonna della data"); if (cN < 0 && cX < 0 && cM < 0 && cR < 0 && cS < 0) throw new Error("non trovo colonne di temperatura, pioggia o umidità del suolo");
  const num = v => { if (v == null) return NaN; v = String(v).trim().replace(/["']/g, ""); if (v === "") return NaN; return +(del === "," ? v : v.replace(",", ".")); }, D = {};
  for (let i = 1; i < lines.length; i++) { const c = lines[i].split(del), d = parseDay((c[cD] || "").trim().replace(/["']/g, "")); if (!d) continue; const k = d[0] * 10000 + d[1] * 100 + d[2], o = D[k] || (D[k] = { y: d[0], doy: DOY[d[1] - 1] + d[2] - 1, lo: Infinity, hi: -Infinity, ts: 0, tn: 0, r: 0, rn: 0, s: 0, sn: 0 });
    const n = num(c[cN]), x = num(c[cX]), m = num(c[cM]), r = num(c[cR]), s = num(c[cS]);
    for (const v of [n, x, m]) if (isFinite(v) && v > -40 && v < 60) { o.lo = Math.min(o.lo, v); o.hi = Math.max(o.hi, v); }
    if (isFinite(m)) { o.ts += m; o.tn++; } else if (isFinite(n) && isFinite(x)) { o.ts += (n + x) / 2; o.tn++; }
    if (isFinite(r) && r >= 0) { o.r += r; o.rn++; } if (isFinite(s)) { o.s += s; o.sn++; } }
  const keys = Object.keys(D).map(Number).sort((a, b) => a - b); if (!keys.length) throw new Error("non riesco a leggere le date");
  const days = keys.map(k => { const o = D[k]; return { k, y: o.y, doy: o.doy, t: o.tn ? o.ts / o.tn : null, n: isFinite(o.lo) ? o.lo : null, x: isFinite(o.hi) ? o.hi : null, p: o.rn ? o.r : null, s: o.sn ? o.s / o.sn : null }; });
  const fmt = k => new Date(Math.floor(k / 10000), Math.floor(k / 100) % 100 - 1, k % 100).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
  const has = f => days.filter(d => d[f] != null).length, out = { giorni: days.length, dal: fmt(keys[0]), al: fmt(keys[keys.length - 1]), temp: has("t"), pioggia: has("p"), suolo: has("s"), anni: [], oggi: null };
  if (out.suolo) { const v = days.filter(d => d.s != null).map(d => d.s); out.suoloMedia = +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1); out.suoloMin = +Math.min(...v).toFixed(1); }
  const byY = {}; days.forEach(d => (byY[d.y] = byY[d.y] || []).push(d));
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null, sum = a => a.reduce((x, y) => x + y, 0), rng = (a, lo, hi, f) => a.filter(d => d.doy >= lo && d.doy < hi && d[f] != null).map(d => d[f]);
  for (const y of Object.keys(byY).map(Number)) { const a = byY[y], pv = byY[y - 1] || []; if (a.filter(d => d.t != null).length < 330) continue;
    let g = 0, on = null, fr = null; a.forEach(d => { if (d.t != null) { g += Math.max(0, d.t - 5); if (on == null && g >= 350) on = d.doy + 1; } if (d.n != null && d.doy < 182 && d.n < 2) fr = d.doy + 1; });
    const wT = rng(pv, 334, 366, "t").concat(rng(a, 0, 59, "t")), wP = rng(pv, 334, 366, "p").concat(rng(a, 0, 59, "p")), rain = a.filter(d => d.p != null).length >= 330;
    out.anni.push({ anno: y, T: [mean(wT), mean(rng(a, 59, 151, "t")), mean(rng(a, 151, 243, "t")), mean(rng(a, 243, 334, "t"))], R: rain ? [sum(wP) * (pv.length ? 1 : 90 / 59), sum(rng(a, 59, 151, "p")), sum(rng(a, 151, 243, "p")), sum(rng(a, 243, 334, "p"))] : null, H: a.filter(d => d.x != null && d.x > 32).length, O: on, F: fr }); }
  if (out.anni.length >= 3) { const A = out.anni, col = f => A.map(r => r[f]).filter(v => v != null), R = A.filter(r => r.R);
    out.oggi = { T: [0, 1, 2, 3].map(i => +mean(A.map(r => r.T[i]).filter(v => v != null)).toFixed(2)), H: +mean(col("H")).toFixed(1) }; if (col("O").length) out.oggi.O = Math.round(mean(col("O"))); if (col("F").length) out.oggi.F = Math.round(mean(col("F")));
    if (R.length >= 3) { const rr = [0, 1, 2, 3].map(i => Math.round(mean(R.map(r => r.R[i])))); if (rr.every(v => v > 0)) out.oggi.R = rr; } }
  return out;
}
/* Area di un file di confini: GeoJSON oppure KML. Risultato in ettari. */
function areaHa(text) {
  const rings = []; text = text.trim();
  if (text[0] === "{" || text[0] === "[") { const walk = g => { if (!g) return; if (g.type === "FeatureCollection") g.features.forEach(f => walk(f.geometry)); else if (g.type === "Feature") walk(g.geometry); else if (g.type === "GeometryCollection") g.geometries.forEach(walk); else if (g.type === "Polygon") rings.push(g.coordinates); else if (g.type === "MultiPolygon") g.coordinates.forEach(p => rings.push(p)); }; walk(JSON.parse(text)); }
  else { const re = /<Polygon[\s\S]*?<\/Polygon>/g, cr = /<(outerBoundaryIs|innerBoundaryIs)>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g; let m; while ((m = re.exec(text))) { const poly = [[], []]; let c; cr.lastIndex = 0; const s = m[0]; while ((c = cr.exec(s))) { const pts = c[2].trim().split(/\s+/).map(q => q.split(",").map(Number)).filter(q => q.length >= 2 && isFinite(q[0]) && isFinite(q[1])); if (c[1] === "outerBoundaryIs") poly[0] = pts; else poly.push(pts); } if (poly[0].length) rings.push([poly[0]].concat(poly.slice(2))); } }
  if (!rings.length) throw new Error("non trovo poligoni nel file");
  const ring = r => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += (q[0] - p[0]) * Math.PI / 180 * (2 + Math.sin(p[1] * Math.PI / 180) + Math.sin(q[1] * Math.PI / 180)); } return Math.abs(a * 6378137 * 6378137 / 2); };
  let m2 = 0; for (const p of rings) { m2 += ring(p[0]); for (let i = 1; i < p.length; i++) m2 -= ring(p[i]); }
  return { ha: m2 / 10000, campi: rings.length };
}
/* Le quattro famiglie di strumenti. Le foto vengono da Wikimedia Commons, con licenza libera e autore indicato. */
const SENS = [
  { id: "meteo", nome: "Stazione meteo", img: "img/meteo.jpg", foto: "Stazione Sencrop in campo. Foto: Philip Halling, CC BY-SA 2.0", cosa: "Pioggia, temperatura, umidità e vento misurati nel tuo campo.", da: "Clima della sede, gelate, giorni caldi, piogge", file: ".csv,.txt,.tsv", fileTxt: "Carica un file CSV", modelli: ["Davis Vantage Pro2", "Pessl iMetos 3.3", "Sencrop Raincrop", "Netatmo Weather Station", "Ecowitt GW2000", "Altro modello"] },
  { id: "suolo", nome: "Sensori del terreno", img: "img/suolo.jpg", foto: "Misuratore di umidità del suolo. Foto: Sealman, CC BY-SA 4.0", cosa: "Acqua nel terreno a più profondità, temperatura e salinità del suolo.", da: "Quando e quanto irrigare", file: ".csv,.txt,.tsv", fileTxt: "Carica un file CSV", modelli: ["METER Teros 12", "Irrometer Watermark 200SS", "Sentek Drill & Drop", "Pessl iMetos ECO D3", "Altro modello"] },
  { id: "gps", nome: "GPS e trattore", img: "img/gps.jpg", foto: "John Deere 8295 R con ricevitore StarFire. Foto: bdk, CC BY-SA 3.0", cosa: "Posizione esatta, confini dei campi, superfici lavorate, ore macchina.", da: "Posizione della sede ed ettari reali", file: ".geojson,.json,.kml", fileTxt: "Carica i confini (GeoJSON, KML)", modelli: ["John Deere StarFire 7000", "Trimble NAV-900", "Topcon AGS-2", "CNH AFS e PLM", "Altro modello"] },
  { id: "stalla", nome: "Sensori in stalla e sugli animali", img: "img/stalla.jpg", foto: "Bovine con collare a transponder. Foto: Blonder1984, CC BY-SA 3.0", cosa: "Temperatura e umidità nel ricovero, attività e ruminazione dei capi.", da: "Stress da caldo misurato in stalla", file: ".csv,.txt,.tsv", fileTxt: "Carica un file CSV", modelli: ["Allflex SenseHub", "Lely Qwes", "Nedap CowControl", "Sonda di temperatura e umidità", "Altro modello"] }
];
let snTimer = 0, snOpen = null, snBusy = null;
/* Letture dimostrative: plausibili per stagione, ora e sede, ma generate dal programma */
function snRead(id) {
  const now = new Date(), h = now.getHours() + now.getMinutes() / 60, doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 864e5), cl = P.clima && P.clima.oggi && P.clima.oggi.T, q = doy < 59 || doy >= 334 ? 0 : doy < 151 ? 1 : doy < 243 ? 2 : 3;
  const base = cl ? cl[q] : 16 + 9 * Math.sin((doy - 110) / 365 * 2 * Math.PI), wob = (k, a) => a * Math.sin(now.getTime() / 9000 + k * 1.7), t = base + 4.5 * Math.sin((h - 9) / 24 * 2 * Math.PI) + wob(1, 0.25), rh = Math.max(35, Math.min(96, 72 - 2.2 * (t - base) + wob(2, 1.5)));
  if (id === "meteo") return [["Temperatura dell'aria", nf(t, 1) + " °C"], ["Umidità dell'aria", nf(rh) + "%"], ["Pioggia di oggi", nf(q === 2 ? 0 : 1.4, 1) + " mm"], ["Vento", nf(9 + wob(3, 2.5)) + " km/h"], ["Pioggia degli ultimi 7 giorni", nf(q === 2 ? 3 : 21) + " mm"], ["Minima della notte", nf(base - 4.8, 1) + " °C"]];
  if (id === "suolo") { const u = (q === 2 ? 19 : 27) + wob(4, 0.4); return [["Umidità a 20 cm", nf(u, 1) + "%"], ["Umidità a 40 cm", nf(u + 4.2, 1) + "%"], ["Temperatura del suolo", nf(base + 1.2 + wob(5, 0.1), 1) + " °C"], ["Salinità", nf(0.9 + wob(6, 0.02), 2) + " dS/m"], ["Soglia di irrigazione", "22%"], ["Stato", u < 22 ? "Sotto soglia: irrigare" : "Acqua sufficiente"]]; }
  if (id === "gps") return [["Superficie mappata", nf(field() ? P.ettari : Math.max(1, Math.round((P.capi || 100) / 12)), 1) + " ha"], ["Campi rilevati", nf(Math.max(1, Math.round((field() ? P.ettari : 20) / 6)))], ["Precisione", "2,5 cm con RTK"], ["Ultima lavorazione", "3 giorni fa"], ["Ore motore della stagione", nf(212 + doy % 40)], ["Trattore", "Fermo in azienda"]];
  const ts = t + 3.5, thi = (1.8 * ts + 32) - (0.55 - 0.0055 * rh) * (1.8 * ts - 26);
  return [["Temperatura in stalla", nf(ts, 1) + " °C"], ["Umidità in stalla", nf(rh) + "%"], ["Indice di stress da caldo", nf(thi)], ["Stato", thi >= 72 ? "Stress da caldo: ventilare" : "Benessere nella norma"], ["Capi monitorati", nf(P.capi || 0)], ["Avvisi di oggi", thi >= 72 ? "2" : "0"]];
}
function snSpark(id) { const pts = Array.from({ length: 28 }, (_, i) => 50 + 22 * Math.sin(i / 4 * Math.PI * 2 / 1.0 + id.length) + 9 * Math.sin(i * 1.3 + id.charCodeAt(0))); const mx = Math.max(...pts), mn = Math.min(...pts);
  return `<svg viewBox="0 0 280 46" class="sn-spark" role="img" aria-label="Andamento degli ultimi 7 giorni"><path d="${pts.map((v, i) => (i ? "L" : "M") + (i * 10 + 5) + "," + (41 - (v - mn) / (mx - mn) * 36).toFixed(1)).join("")}" fill="none" stroke="var(--kc)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }
function vSensori() {
  clearInterval(snTimer); const C = P.collegati || {}, st = P.stazione, cl = P.clima && P.clima.oggi, list = SENS.filter(x => field() ? x.id !== "stalla" : x.id !== "suolo"), shown = TOOLS.filter(t => field() ? !["stalla", "collari"].includes(t.id) : !["trappole", "salinita"].includes(t.id));
  const fileInfo = id => id === "gps" ? (P.confini ? `<p class="note"><b class="kw">File caricato:</b> ${nf(P.confini.ha, 2)} ettari in ${P.confini.campi} ${P.confini.campi === 1 ? "campo" : "campi"}.${field() && Math.abs(P.confini.ha - P.ettari) > 0.05 ? ` In Azienda ne hai indicati ${nf(P.ettari, 1)}. <button class="btn ghost" id="sn-geo-use" type="button" style="padding:3px 10px">Usa gli ettari misurati</button>` : ""} <button class="btn ghost" type="button" data-sn-del="gps" style="padding:3px 10px">Togli</button></p>` : "")
    : id !== "stalla" && st && (id === "meteo" ? st.temp || st.pioggia : st.suolo) ? `<p class="note"><b class="kw">File caricato:</b> ${nf(st.giorni)} giorni, dal ${esc(st.dal)} al ${esc(st.al)}. ${id === "meteo" ? (st.oggi && cl ? "La tua stazione è in uso per il clima della sede." : st.anni.length + " anni completi: ne servono tre per sostituire il clima stimato.") : "Umidità media " + nf(st.suoloMedia, 1) + ", minima " + nf(st.suoloMin, 1) + "."} <button class="btn ghost" type="button" data-sn-del="csv" style="padding:3px 10px">Togli</button></p>` : "";
  const tick = (ok, t) => `<span class="chip ${ok ? "good" : "calm"}">${ok ? "✓ " : ""}${t}</span>`;
  $("v-sensori").innerHTML = `<div><p class="eyebrow" style="--c:var(--inv)">Sensori</p><h1 class="verdict">Collega i tuoi strumenti: <em>i dati arrivano da soli</em> e le risposte parlano del tuo campo.</h1>
    <p class="lede" style="font-size:15px">Scegli uno strumento e premi «Collega». Se preferisci non collegarlo, carica il file con i dati che hai registrato.</p></div>
  <div class="card" style="gap:10px"><h3>Cosa si compila da solo per ${esc(P.nomeSede || "questa sede")}</h3><div class="tags">
    ${tick(P.gps || C.gps, "Posizione esatta")}${tick(!!cl, "Clima della sede")}${tick(C.meteo || (st && st.oggi && cl), "Meteo dal tuo campo")}${field() ? tick(C.suolo || (st && st.suolo), "Umidità del terreno") : tick(C.stalla, "Caldo in stalla")}${tick(P.confini || C.gps, field() ? "Ettari misurati" : "Superfici misurate")}${tick(!!P.mercato, "Prezzi di mercato")}</div></div>
  <div class="sn-grid">${list.map(x => { const c = C[x.id], col = { meteo: "--inv", suolo: "--aut", gps: "--pri", stalla: "--est" }[x.id];
    return `<div class="card sn ${c ? "on" : ""}" style="--kc:var(${col})" data-sn="${x.id}"><figure class="sn-img"><img src="${x.img}" alt="${esc(x.foto.split(". Foto")[0])}" loading="lazy"><figcaption>${esc(x.foto)}</figcaption></figure>
      <div class="sn-body"><div class="card-h"><h2>${x.nome}</h2>${c ? `<span class="chip good"><i class="live"></i>Collegato</span>` : `<span class="chip calm">Non collegato</span>`}</div>
      <p>${x.cosa}</p><p class="note"><b class="kw">Compila da solo:</b> ${x.da}.</p>
      ${c ? `<p class="note"><b>${esc(c.modello)}</b>${c.codice ? " · " + esc(c.codice) : ""} · Collegato il ${esc(c.dal)} · <span class="chip plain" style="color:var(--muted)">Dati dimostrativi</span></p>
        <div class="sn-live" data-live="${x.id}"></div>${snSpark(x.id)}<p class="note">Andamento degli ultimi 7 giorni · Ultimo dato: <span data-ago="${x.id}">adesso</span> · Batteria 86% · Segnale buono</p>
        <div class="sn-act"><button class="btn ghost" type="button" data-sn-off="${x.id}">Scollega</button><label class="btn ghost" style="cursor:pointer">${x.fileTxt}<input type="file" data-sn-file="${x.id}" accept="${x.file}" hidden></label></div>`
      : snBusy === x.id ? `<div class="sn-steps" id="sn-steps"><p><span class="spinner"></span> <span id="sn-step">Cerco lo strumento in rete…</span></p><div class="sn-prog"><i id="sn-bar"></i></div></div>`
      : snOpen === x.id ? `<form class="sn-form" data-sn-form="${x.id}"><label class="ctl">Modello<select name="m">${x.modelli.map(m => `<option>${m}</option>`).join("")}</select></label><label class="ctl">Codice dello strumento o chiave di accesso<input type="text" name="c" maxlength="40" placeholder="Si trova sull'etichetta o nell'app del produttore" autocomplete="off"></label><div class="sn-act"><button class="btn" type="submit">Collega ora</button><button class="btn ghost" type="button" data-sn-x>Annulla</button></div></form>`
      : `<div class="sn-act"><button class="btn" type="button" data-sn-open="${x.id}">Collega</button><label class="btn ghost" style="cursor:pointer">${x.fileTxt}<input type="file" data-sn-file="${x.id}" accept="${x.file}" hidden></label>${x.id === "gps" ? `<button class="btn ghost" type="button" id="sn-gps">Usa il GPS di questo telefono</button>` : ""}</div>`}
      <div data-sn-out="${x.id}">${fileInfo(x.id)}${x.id === "gps" && P.gps ? `<p class="note"><b class="kw">Posizione GPS in uso:</b> ${nf(P.lat, 4)}, ${nf(P.lon, 4)}.</p>` : ""}</div></div></div>`; }).join("")}</div>
  ${st && st.anni.length ? `<details class="card"><summary><b>I dati letti dal file della stazione, anno per anno</b></summary><div class="tablewrap"><table><thead><tr><th>Anno</th><th>Inverno</th><th>Primavera</th><th>Estate</th><th>Autunno</th><th>Pioggia dell'anno</th><th>Giorni sopra 32 °C</th><th>Ultima notte sotto 2 °C</th><th>Inizio primavera</th></tr></thead><tbody>${st.anni.map(a => `<tr><td>${a.anno}</td>${a.T.map(t => `<td class="num">${t == null ? "—" : nf(t, 1) + " °C"}</td>`).join("")}<td class="num">${a.R ? nf(a.R.reduce((x, y) => x + y, 0)) + " mm" : "—"}</td><td class="num">${a.H}</td><td class="num">${a.F ? dateOf(a.F) : "—"}</td><td class="num">${a.O ? dateOf(a.O) : "—"}</td></tr>`).join("")}</tbody></table></div></details>` : ""}
  <details class="card"><summary><b>Quale strumento mi serve? Specifiche, costi e vantaggi</b></summary><p class="note">Costi indicativi, da verificare con il fornitore.</p>
    <div class="grid g2">${shown.map(t => `<div class="card diag" style="--kc:var(${t.c});border-top:4px solid var(${t.c})"><h3>${t.nome}</h3><p>${t.misura}</p><ul class="list">${t.spec.map(s => `<li>${s}</li>`).join("")}</ul><p class="note"><b class="kw">Costo.</b> ${t.costo}</p><p class="note"><b class="kw">Vantaggio.</b> ${t.vant}</p></div>`).join("")}</div></details>
  <p class="note">In questa versione dimostrativa il collegamento in rete mostra dati di esempio, segnati come «Dati dimostrativi»: i calcoli di Agro non li usano. I file che carichi e il GPS del telefono sono invece letti davvero.</p>`;
  const live = () => { if (!$("v-sensori").classList.contains("on") && !document.querySelector("#v-sensori.on")) return; document.querySelectorAll("#v-sensori [data-live]").forEach(el => { el.innerHTML = snRead(el.dataset.live).map(r => `<span><b class="num">${r[1]}</b>${r[0]}</span>`).join(""); }); };
  live(); if (Object.keys(C).length) snTimer = setInterval(live, 4000);
  const root = $("v-sensori"), out = id => root.querySelector(`[data-sn-out="${id}"]`);
  root.onclick = e => { const t = e.target, o = t.closest("[data-sn-open]"), off = t.closest("[data-sn-off]"), del = t.closest("[data-sn-del]");
    if (o) { snOpen = o.dataset.snOpen; vSensori(); const f = root.querySelector("[data-sn-form] select"); if (f) f.focus(); }
    else if (t.closest("[data-sn-x]")) { snOpen = null; vSensori(); }
    else if (off) { delete P.collegati[off.dataset.snOff]; save(); vSensori(); }
    else if (del) { const had = P.stazione && P.stazione.oggi; if (del.dataset.snDel === "gps") { P.confini = null; save(); vSensori(); } else { P.stazione = null; save(); if (had) recompute(true); else vSensori(); } } };
  root.onsubmit = e => { const f = e.target.closest("[data-sn-form]"); if (!f) return; e.preventDefault(); const id = f.dataset.snForm, modello = f.elements.m.value, codice = f.elements.c.value.trim().slice(0, 40); snOpen = null; snBusy = id; vSensori();
    const steps = ["Cerco lo strumento in rete…", "Strumento trovato: chiedo l'accesso…", "Scarico i dati degli ultimi mesi…", "Collegato."]; let k = 0;
    const go = () => { const s = $("sn-step"), b = $("sn-bar"); if (!s) { snBusy = null; return; } s.textContent = steps[k]; b.style.width = Math.round((k + 1) / steps.length * 100) + "%"; k++;
      if (k < steps.length) setTimeout(go, 1100); else setTimeout(() => { snBusy = null; P.collegati = Object.assign({}, P.collegati, { [id]: { modello, codice, dal: new Date().toLocaleDateString("it-IT", { day: "numeric", month: "long" }) } }); save(); vSensori(); }, 700); };
    go(); };
  root.onchange = async e => { const inp = e.target.closest("[data-sn-file]"); if (!inp) return; const f = inp.files[0], id = inp.dataset.snFile, o = out(id); if (!f) return;
    if (f.size > 60e6) { o.innerHTML = `<p class="err">Il file supera 60 MB: esporta dati giornalieri o un periodo più corto.</p>`; return; }
    try { if (id === "gps") { const a = areaHa(await f.text()); if (!(a.ha > 0.01 && a.ha < 100000)) throw new Error("superficie non plausibile"); P.confini = { ha: +a.ha.toFixed(2), campi: a.campi, file: f.name.slice(0, 80) }; save(); vSensori(); }
      else { const r = readCsv(await f.text()); r.file = f.name.slice(0, 80); if (P.clima && P.clima.oggi) r.rian = P.stazione && P.stazione.rian ? P.stazione.rian : { T: (P.clima.oggi.T || []).slice(), H: P.clima.oggi.H }; P.stazione = r; save(); if (r.oggi) recompute(true); else vSensori(); } }
    catch (x) { o.innerHTML = `<p class="err">Non riesco a leggere il file: ${esc(x.message)}.</p>`; } };
  if ($("sn-geo-use")) $("sn-geo-use").onclick = () => { P.ettari = +P.confini.ha.toFixed(1); P.example = false; save(); recompute(true); };
  if ($("sn-gps")) $("sn-gps").onclick = () => { const o = out("gps"); if (!navigator.geolocation) { o.innerHTML = `<p class="err">Questo dispositivo non mette a disposizione la posizione.</p>`; return; } o.innerHTML = `<p class="note"><span class="spinner"></span> Leggo la posizione…</p>`;
    navigator.geolocation.getCurrentPosition(p => { const la = p.coords.latitude, lo = p.coords.longitude; if (!(la > 35 && la < 48 && lo > 6 && lo < 19)) { o.innerHTML = `<p class="err">La posizione letta è fuori dall'Italia: non la uso.</p>`; return; }
      P.lat = +la.toFixed(5); P.lon = +lo.toFixed(5); if (p.coords.altitude != null && isFinite(p.coords.altitude)) P.quota = Math.max(0, Math.round(p.coords.altitude)); P.zona = zonaAuto(P.lat, P.quota || 0); P.gps = true; P.meteo = null; P.example = false; save(); recompute(true); },
      e => { o.innerHTML = `<p class="err">${e.code === 1 ? "Non hai dato il permesso di leggere la posizione." : "Non riesco a leggere la posizione: riprova all'aperto."}</p>`; }, { enableHighAccuracy: true, timeout: 20000 }); };
}

/* ---------- Consulente ---------- */
let chat = [], talking = false, sample = null;
function facts() { const a = R.attuale, pc = R.percorso, pick = rows => [3, 13, 23].map(i => ({ anno: rows[i].anno, margine_mediano: eur(rows[i].p50), margine_caso_sfavorevole: eur(rows[i].p10), rischio_anno_in_perdita: pct(rows[i].loss), resa_vs_oggi: pct(rows[i].y50 - 1, true) }));
  return { strumenti_e_dati: { posizione: P.gps ? "GPS" : "centro del comune", stazione_meteo_caricata: P.stazione ? { giorni: P.stazione.giorni, anni_completi: P.stazione.anni.length, usata_per_il_clima: !!P.stazione.oggi, umidita_suolo_media: P.stazione.suoloMedia, umidita_suolo_minima: P.stazione.suoloMin } : "no", confini_campi_ettari: P.confini ? P.confini.ha : "non caricati", strumenti_collegati_in_dimostrazione: Object.keys(P.collegati || {}).map(k => (SENS.find(t => t.id === k) || {}).nome + ": " + P.collegati[k].modello) },
    azienda: { nome: P.nome, attivita: subject(), zona: AM.ZONES[P.zona].name, regione: P.regione, dati_di_esempio: !!P.example, ricavo_annuo: eur(R.oggi.ricavo) },
    stagione_prossima: { anno: SE.anno, meteo_rilevato_ultimi_90_giorni: P.meteo ? { comune: P.comune, temperatura_vs_ultimi_10_anni: deg(P.meteo.dT), temperatura_vs_1991_2020: deg(P.meteo.dT30), pioggia_vs_ultimi_10_anni: P.meteo.pioggia + "%", quanto_anticipa_l_inverno_correlazione: P.meteo.segnale.inverno.r, fonte: "Open-Meteo ERA5-Land" } : "non disponibile", clima_sede_dai_dati: P.clima ? { oggi_2016_2025: P.clima.oggi, riferimento_1991_2020: P.clima.riferimento, tendenza_gradi_per_decennio_per_stagione: P.clima.tendenzaT } : "non disponibile", prossimi_16_giorni: FCAST ? { minima: Math.min(...FCAST.min), massima: Math.max(...FCAST.max), pioggia_mm: Math.round(FCAST.pioggia.reduce((a, b) => a + b, 0)) } : "non disponibile", prezzi_eurostat: P.mercato || "non disponibile", inizio_primavera_giorni_vs_normale: Math.round(SE.inizio.m), intervallo: [Math.round(SE.inizio.p10), Math.round(SE.inizio.p90)], fase: SE.fase, data_normale: dateOf(SE.normale), data_consigliata: dateOf(SE.migliore.giorno), guadagno_atteso: eur(SE.guadagno), rischio_gelo: pct(SE.migliore.pGelo), ultima_gelata_attesa: dateOf(SE.gelata.m), giorni_sopra_32: nf(SE.caldo.m), stagioni: SE.stagioni.map(s => ({ stagione: s.nome, temperatura: nf(s.temp, 1) + " °C", pioggia: pct(s.pioggia, true), prob_piu_secca: pct(s.pSecco) })) },
    previsione_senza_cambiare: pick(a.anni), clima: [3, 13, 23].map(i => { const c = R.clima.tutti[i]; return { anno: c.anno, estate: "+" + nf(c.Tu[1], 1) + " °C", inizio_primavera_giorni: Math.round(c.on[1]), giorni_sopra_32: nf(c.hot[1]), acqua_irrigua: pct(c.av[1]) }; }),
    piano_consigliato: { mosse: R.scelta.descrizione, investimento: eur(R.scelta.investimento), valore_atteso_30_anni: eur(pc.sintesi.medio), casi_peggiori: eur(pc.sintesi.peggiori), assetto_attuale_valore_atteso: eur(a.sintesi.medio), assetto_attuale_casi_peggiori: eur(a.sintesi.peggiori), batte_attuale_su_100: nf(pc.sintesi.batteAttuale * 100), acqua_m3_anno: nf(R.scelta.acqua), emissioni_t: nf(R.scelta.emissioni), biodiversita: R.scelta.biodiversita, con_piano: pick(pc.anni) },
    percorso_a_tappe: { indicatore: pc.indicatore, ora: pc.ora.map(k => L()[k].name), nel_2031: pc.nodi.map(n => ({ caso: n.nome, probabilita: pct(n.prob), aggiungi: n.aggiungi.map(k => L()[k].name), nel_2036: n.rami.map(r => ({ caso: r.nome, aggiungi: r.aggiungi.map(k => L()[k].name) })) })), valore_di_decidere_a_tappe: eur(pc.valoreFlessibilita) },
    opzioni_reali: R.opzioni.map(o => ({ investimento: o.nome, costo: eur(o.costo), quando: o.quando, guadagno_se_aspetti_invece_di_farlo_ora: eur(o.valoreAttesa) })),
    spiegazione: { effetto_di_ogni_mossa: R.spiegazione.leve.map(x => ({ mossa: x.nome, nel_piano: x.attiva, se_la_cambi: eur(x.dValore) })), da_cosa_dipende: R.spiegazione.cause.slice(0, 6).map(c => ({ fonte: c.nome, quota: pct(c.quota) })) },
    robustezza: { fiducia_nel_modello: RHO_N[P.prefs.fiducia], piano_stabile: R.robustezza.livelli.every(x => x.stessa), stress: R.robustezza.stress.map(s => ({ prova: s.nome, piano: eur(s.piano), attuale: eur(s.attuale), piano_vince_su_100: nf(s.vince * 100) })) },
    dati_da_raccogliere: R.informazione.voci.filter(v => v.riducibile).map(v => ({ misura: v.misura, costo: eur(v.costo), valore: eur(v.valoreStimato), conviene: v.valoreStimato > v.costo })),
    sprechi_oggi_euro_anno: R.sprechi.attuale, contributi_applicati: P.contributi, simulazioni: R.traiettorie };
}
const RULES = "Sei My Agro, consulente agronomico e zootecnico dentro un sistema di supporto alle decisioni. Rispondi in italiano, diretto e concreto, in testo semplice senza markdown né elenchi con simboli, al massimo 150 parole salvo richiesta diversa. Usa solo i numeri presenti nei DATI: vengono da simulazioni dimostrative con parametri illustrativi, non da previsioni validate; dillo una volta quando le cifre guidano una spesa. Non inventare numeri: se manca qualcosa, di' cosa misurare o inserire. «In N futuri su 100» vale dentro le simulazioni, non è una probabilità del futuro. Per problemi imprevisti (incendio, grandine, malattie, guasti, prezzi) dai una soluzione in tre tempi: cosa fare subito, cosa si può recuperare o trasformare in valore, come ripartire; per salute delle persone e obblighi di legge rimanda a 112, veterinario, servizio fitosanitario o Comune. Se la domanda riguarda contributi, ricorda la scheda Bandi.";
function local(q) { const t = q.toLowerCase(), pc = R.percorso, a = R.attuale.sintesi;
  if (/semin|trapiant|primaver|stagion|quando/.test(t)) return `Per il ${SE.anno} la primavera è attesa ${Math.round(-SE.inizio.m) >= 2 ? giorni(SE.inizio.m) + " prima" : "nella norma"}. ${SE.fase} consigliata intorno al ${dateOf(SE.migliore.giorno)} (di solito ${dateOf(SE.normale)}), con ${eur(SE.guadagno)} di margine atteso in più e rischio di gelo ${pct(SE.migliore.pGelo)}. Il meteo della sede si aggiorna da solo.`;
  if (/risch|perd|peggi/.test(t)) return `Senza cambiare nulla il margine di un anno tipico nel 2040 è ${eur(R.attuale.anni[13].p50)} e il rischio di un anno in perdita ${pct(R.attuale.anni[13].loss)}. Con il piano i casi peggiori a 30 anni passano da ${eur(a.peggiori)} a ${eur(pc.sintesi.peggiori)}.`;
  if (/perch|spieg/.test(t)) { const k = R.spiegazione.leve.filter(x => x.attiva).sort((x, y) => x.dValore - y.dValore)[0]; return k ? `La mossa che pesa di più è ${k.nome.toLowerCase()}: toglierla costerebbe ${eur(-k.dValore)}. Il risultato dipende soprattutto da ${R.spiegazione.cause[0].nome.toLowerCase()} (${pct(R.spiegazione.cause[0].quota)} dell'incertezza).` : `Nessuna mossa ripaga il suo costo con le tue preferenze.`; }
  return `Il piano consigliato per ${P.nome}: ${R.scelta.descrizione.join("; ").toLowerCase() || "nessun cambiamento"}. Guadagno medio in 30 anni ${eur(pc.sintesi.medio)} contro ${eur(a.medio)} di oggi, e batte l'assetto attuale in ${nf(pc.sintesi.batteAttuale * 100)} futuri su 100. Chiedimi della prossima stagione, dei rischi, di un imprevisto o del perché.`;
}
function bubble(cls, text) { const d = document.createElement("div"); d.className = "msg " + cls; d.textContent = text; $("msgs").appendChild(d); $("msgs").scrollTop = $("msgs").scrollHeight; return d; }
function intro() { chat = []; $("msgs").innerHTML = ""; bubble("ai", "Cosa posso fare per te? " + local("")); }
function chips() { $("chips").innerHTML = ["Quando " + (R.normali.tipo === "spring" ? "devo " + R.normali.nomeFase.toLowerCase().replace("trapianto", "trapiantare").replace("semina", "seminare") : "parte la stagione") + " quest'anno?", "Qual è il rischio più grosso?", "Perché consigli questo piano?", "Cosa misuro prima di investire?"].map(c => `<button type="button">${c}</button>`).join(""); }
$("chips").onclick = e => { const b = e.target.closest("button"); if (b) ask(b.textContent); };
$("ask").onsubmit = e => { e.preventDefault(); const q = $("q").value.trim(); if (q) { $("q").value = ""; ask(q); } };
$("q").onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("ask").requestSubmit(); } };
async function ask(q) {
  if (talking || !R) return; bubble("me", q); chat.push({ role: "user", content: q });
  if (!IA && !sample) { const a = local(q); chat.push({ role: "assistant", content: a }); bubble("ai", a); return; }
  talking = true; $("send").disabled = true; $("advisor").classList.add("think"); const out = bubble("ai", "Sto guardando i tuoi numeri…");
  try { const hist = chat.slice(-7, -1).map(m => (m.role === "user" ? "DOMANDA PRECEDENTE: " : "TUA RISPOSTA: ") + m.content).join("\n"), prompt = RULES + "\n\nDATI:\n" + JSON.stringify(facts()) + (hist ? "\n\nCONVERSAZIONE FINORA:\n" + hist : "") + "\n\nDOMANDA:\n" + q;
    const text = IA ? await ai(prompt) : (await sample(prompt, { cache: false })).text; out.textContent = text; chat.push({ role: "assistant", content: text }); }
  catch (err) { const a = local(q); chat.push({ role: "assistant", content: a }); out.textContent = a; }
  talking = false; $("send").disabled = false; $("advisor").classList.remove("think"); $("msgs").scrollTop = $("msgs").scrollHeight;
}
function mode() { $("adv-mode").textContent = IA ? "My Agro con IA attiva tramite Claude Code. Legge i risultati calcolati per la tua azienda." : sample ? "My Agro con IA attiva. Legge i risultati calcolati per la tua azienda." : "Modalità base: risponde con le cifre calcolate. Per le risposte con IA serve Claude Code su questo computer."; }

/* ---------- Presentazione: cosa posso fare per te ---------- */
const DO = [
  ["stagione", "var(--pri)", "Ti diciamo quando seminare quest'anno", "Se la primavera arriva prima, lo vedi a fine inverno: data consigliata, rischio di gelo, cosa fare stagione per stagione.", "Vai alla stagione", `<svg viewBox="0 0 120 60"><path d="M4 50h112" stroke="var(--line)" stroke-width="3" stroke-linecap="round"/>${[18, 42, 66, 90].map((x, i) => `<g class="sprout" style="animation-delay:${-i * 0.6}s"><path d="M${x} 50V${30 - i * 3}" stroke="var(--pri)" stroke-width="3" stroke-linecap="round"/><path d="M${x} ${38 - i * 2}c-7-1-9-5-9-8 5 0 9 3 9 8zM${x} ${34 - i * 2}c6-1 8-4 8-7-5 0-8 3-8 7z" fill="var(--pri)"/></g>`).join("")}</svg>`, 1],
  ["previsione", "var(--inv)", "Ti mostriamo cosa cambia da qui al 2056", "Margini, rese, acqua e stagioni che si spostano, con il margine di errore sempre in vista.", "Guarda la previsione", `<svg viewBox="0 0 120 60"><polygon points="4,30 40,23 80,16 116,6 116,54 80,46 40,39 4,34" fill="var(--inv)" opacity=".22"/><path class="draw" style="--len:140" d="M4 32 40 30 80 34 116 30" stroke="var(--inv)" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`],
  ["simulazione", "var(--pri)", "Proviamo le tue idee prima che tu spenda", "Accendi una scelta in uno dei nove ambiti dell'azienda e vedi subito cosa cambia.", "Apri la simulazione", `<svg viewBox="0 0 120 60">${[10, 28, 46].map((y, i) => `<rect x="6" y="${y - 6}" width="34" height="12" rx="6" fill="${i === 1 ? "var(--line)" : "var(--pri)"}"/><circle cx="${i === 1 ? 12 : 34}" cy="${y}" r="4.5" fill="var(--surface)"><animate attributeName="cx" values="${i === 1 ? "12;34;12" : "34;12;34"}" dur="${3 + i}s" repeatCount="indefinite"/></circle><rect x="50" y="${y - 3}" width="${40 + i * 12}" height="6" rx="3" fill="var(--line)"/>`).join("")}</svg>`],
  ["piano", "var(--est)", "Scegliamo con te il piano migliore", "1.536 combinazioni di scelte a confronto su profitto, rischio, acqua, biodiversità ed emissioni, pesati come vuoi tu. Con cosa fare ora e cosa rimandare.", "Vedi il piano", `<svg viewBox="0 0 120 60">${[[20, 44], [34, 30], [52, 36], [66, 20], [84, 26], [100, 12], [44, 48], [74, 40]].map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i === 5 ? 6 : 3.5}" fill="${i === 5 ? "var(--est)" : "var(--muted)"}" opacity="${i === 5 ? 1 : 0.45}">${i === 5 ? `<animate attributeName="r" values="6;9;6" dur="2s" repeatCount="indefinite"/>` : ""}</circle>`).join("")}</svg>`, 1],
  ["perche", "var(--aut)", "Ti spieghiamo perché, e se regge anche se sbagliamo", "Quale mossa pesa di più, da cosa dipende il risultato, cosa succede con prezzi bassi o tre anni di siccità.", "Leggi il perché", `<svg viewBox="0 0 120 60">${[44, 78, 30, 60].map((w, i) => `<rect x="6" y="${6 + i * 13}" width="${w}" height="8" rx="4" fill="var(--aut)" opacity="${1 - i * 0.18}"><animate attributeName="width" values="${w};${w + 18};${w}" dur="${2.6 + i * 0.5}s" repeatCount="indefinite"/></rect>`).join("")}</svg>`],
  ["diagnosi", "var(--est)", "Guardiamo una foto e ti diciamo cos'ha la pianta", "Foto o video di foglie, frutti, terreno o animali: problema, cause probabili, cura.", "Carica una foto", `<svg viewBox="0 0 120 60"><path d="M60 6c26 8 30 30 14 48-26-4-34-26-14-48z" fill="var(--pri)" opacity=".8"/><circle cx="62" cy="30" r="5" fill="var(--aut)"/><circle cx="72" cy="40" r="3" fill="var(--aut)"/><rect x="30" y="0" width="62" height="2.5" fill="var(--est)"><animate attributeName="y" values="4;54;4" dur="2.4s" repeatCount="indefinite"/></rect></svg>`],
  ["imprevisti", "var(--aut)", "Ti aiutiamo quando succede l'imprevisto", "Incendio, grandine, gelata, alluvione, malattie: cosa fare subito, cosa si può ancora salvare, come ripartire.", "Apri gli imprevisti", `<svg viewBox="0 0 120 60"><path d="M60 54c-16 0-22-12-16-24 3 5 6 5 6 0 0-9 6-16 12-24 0 12 14 16 14 32 0 10-7 16-16 16z" fill="var(--aut)"><animate attributeName="d" dur="1.4s" repeatCount="indefinite" values="M60 54c-16 0-22-12-16-24 3 5 6 5 6 0 0-9 6-16 12-24 0 12 14 16 14 32 0 10-7 16-16 16z;M60 54c-16 0-20-13-15-23 3 6 7 4 6-1-1-9 5-17 10-22 1 12 15 14 15 30 0 10-7 16-16 16z;M60 54c-16 0-22-12-16-24 3 5 6 5 6 0 0-9 6-16 12-24 0 12 14 16 14 32 0 10-7 16-16 16z"/></path></svg>`, 1],
  ["bandi", "var(--inv)", "Troviamo i bandi e ti diciamo se puoi partecipare", "Contributi aperti, lettura del bando e spese ammesse collegate agli investimenti del piano.", "Cerca i bandi", `<svg viewBox="0 0 120 60"><rect x="38" y="4" width="40" height="52" rx="5" fill="var(--surface2)" stroke="var(--inv)" stroke-width="2.5"/><path d="M46 18h24M46 28h24M46 38h14" stroke="var(--line)" stroke-width="3" stroke-linecap="round"/><path class="draw" style="--len:40;animation-iteration-count:infinite;animation-duration:2.4s" d="M56 44l7 7 14-16" stroke="var(--pri)" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`, 1]
];
$("l-do").innerHTML = DO.map(d => `<a class="card do ${d[6] ? "big" : ""}" href="#${d[0]}" style="--c:${d[1]}"><div class="g">${d[5]}</div><h3>${d[2]}</h3><p>${d[3]}</p><span class="go">${d[4]}</span></a>`).join("");


/* ---------- Prezzi ---------- */
const PLANS = [
  { id: "stagione", nome: "Stagione", m: 29, per: "Una sede, per decidere bene l'annata", cta: "Prova Stagione", punti: ["1 sede o terreno", "Data di semina e calendario delle quattro stagioni", "Meteo della sede letto in automatico", "Previsione a 30 anni con margine di errore", "Diagnosi da foto e video: 5 al mese", "Guida agli imprevisti"] },
  { id: "azienda", nome: "Azienda", m: 149, top: 1, per: "Fino a 3 sedi, per chi deve investire", cta: "Prova Azienda", punti: ["Fino a 3 sedi o terreni", "Tutto di Stagione", "Piano ottimizzato su 1.536 combinazioni e 5 obiettivi", "Percorso a tappe e valore dell'attesa", "Robustezza, prove di stress, dati da raccogliere", "Bandi: ricerca e lettura, 5 al mese"] },
  { id: "impresa", nome: "Impresa", m: 390, per: "Fino a 12 sedi, per aziende con più terreni", cta: "Prova Impresa", punti: ["Fino a 12 sedi, poi 25 € al mese per ogni sede in più", "Tutto di Azienda, per ogni sede", "Diagnosi e bandi senza limiti", "My Agro senza limiti", "Assistenza prioritaria"] }
];
const Y = "<i class='yes'></i>", NO = "<span class='no'>—</span>";
const CMP = [["Sedi"], ["Sedi o terreni inclusi, ognuno con le sue specifiche", "1", "3", "12, poi 25 € al mese a sede"], ["Meteo della sede letto in automatico", Y, Y, Y],
  ["Quest'anno"], ["Data di semina o trapianto consigliata", Y, Y, Y], ["Calendario delle quattro stagioni e rischio di gelo", Y, Y, Y], ["Guida agli imprevisti: subito, recupero, ripartenza", Y, Y, Y], ["Diagnosi da foto e video", "5 al mese", "50 al mese", "Senza limiti"], ["My Agro, il consulente", "30 domande al mese", "Senza limiti", "Senza limiti"],
  ["Lungo periodo"], ["Previsione a 30 anni con margine di errore", Y, Y, Y], ["Simulazione delle scelte nei 9 ambiti dell'azienda", NO, Y, Y], ["Piano ottimizzato su profitto, rischio, acqua, biodiversità, emissioni", NO, Y, Y], ["Percorso a tappe (2031, 2036) e valore dell'attesa", NO, Y, Y], ["Robustezza e prove di stress", NO, Y, Y], ["Dati da raccogliere prima di investire", NO, Y, Y], ["Aggiornamento del piano con le osservazioni di ogni stagione", NO, Y, Y],
  ["Contributi"], ["Ricerca dei bandi aperti", NO, Y, Y], ["Lettura del bando e verifica dei requisiti", NO, "5 al mese", "Senza limiti"], ["Contributo applicato al piano", NO, Y, Y],
  ["Assistenza"], ["Supporto", "Mail", "Mail, risposta in giornata", "Prioritaria"]];
let ciclo = "anno";
function price(p) { const v = ciclo === "anno" ? Math.round(p.m * 10 / 12) : p.m; return (p.da ? "<small>da </small>" : "") + nf(v) + " €<small> al mese" + (ciclo === "anno" ? ", fatturato all'anno" : "") + "</small>"; }
function renderPlans() {
  seg("pr-ciclo", [["mese", "Mensile"], ["anno", "Annuale: 2 mesi gratis"]], ciclo, k => { ciclo = k; renderPlans(); });
  $("l-plans").innerHTML = PLANS.map(p => `<div class="card plan ${p.top ? "top" : ""}">${p.top ? `<span class="chip acc plain tag">Il più scelto per investire</span>` : `<span class="chip calm plain tag">${p.per}</span>`}<h3>${p.nome}</h3><div class="pr num">${price(p)}</div>${p.top ? `<span class="note">${p.per}</span>` : ""}<ul>${p.punti.map(x => `<li>${x}</li>`).join("")}</ul><a class="btn ${p.top ? "" : "ghost"}" href="#registrati" data-plan="${p.id}">${p.cta}</a><span class="note" style="text-align:center">14 giorni gratis, senza carta</span></div>`).join("");
  $("l-cmp").innerHTML = `<thead><tr><th>Analisi</th>${PLANS.map(p => `<th class="${p.top ? "hl" : ""}">${p.nome}</th>`).join("")}</tr></thead><tbody>${CMP.map(r => r.length === 1 ? `<tr class="grp"><td colspan="4">${r[0]}</td></tr>` : `<tr><td>${r[0]}</td>${[1, 2, 3].map(i => `<td class="${i === 2 ? "hl" : ""}">${r[i]}</td>`).join("")}</tr>`).join("")}</tbody>`;
}
renderPlans();
$("l-plans").onclick = e => { const b = e.target.closest("[data-plan]"); if (b) wantPlan = b.dataset.plan; };
/* Anteprime del prodotto nella presentazione */
$("lv-1").innerHTML = `<div class="mini"><span><span class="chip acc">Azienda di esempio</span></span><span class="note">Inverno più caldo di 1,6 °C</span></div><div class="mini"><span>Trapianto consigliato<br><b>14 aprile</b></span><span>Di solito<br><b style="color:var(--muted)">20 aprile</b></span><span>Rischio di gelo<br><b class="good">Basso</b></span></div>
  <svg viewBox="0 0 360 120"><path d="M10 100 C80 96 110 40 180 30 S300 44 350 56" fill="none" stroke="var(--pri)" stroke-width="3.5" class="draw" style="--len:420"/><path d="M10 112 C80 110 110 70 180 62 S300 78 350 92" fill="none" stroke="var(--muted)" stroke-width="1.6" stroke-dasharray="4 5"/><line x1="232" x2="232" y1="8" y2="112" stroke="var(--muted)" stroke-dasharray="2 4"/><circle cx="180" cy="30" r="7" fill="var(--est)" stroke="var(--surface)" stroke-width="2"><animate attributeName="r" values="7;10;7" dur="2s" repeatCount="indefinite"/></circle></svg>`;
$("lv-2").innerHTML = `<div class="mini"><span><span class="chip acc">Azienda di esempio</span></span><span class="note">Percorso a tappe</span></div>
  <svg viewBox="0 0 360 150">${[[26, "var(--pri)", "Anni favorevoli"], [75, "var(--est)", "Anni nella media"], [124, "var(--aut)", "Anni duri"]].map(a => `<path class="flow" d="M96,75 C140,75 140,${a[0]} 184,${a[0]}" fill="none" stroke="${a[1]}" stroke-width="3" stroke-linecap="round"/><rect x="184" y="${a[0] - 15}" width="166" height="30" rx="8" fill="var(--surface)" stroke="${a[1]}" stroke-width="2"/><text x="194" y="${a[0] + 4}" style="font:600 11px var(--body);fill:var(--ink)">${a[2]}</text>`).join("")}<rect x="10" y="55" width="86" height="40" rx="8" fill="var(--surface)" stroke="var(--accent)" stroke-width="2"/><text x="20" y="72" style="font:600 11px var(--body);fill:var(--ink)">Ora</text><text x="20" y="87" style="font:10px var(--body);fill:var(--muted)">6 mosse</text><text x="184" y="148" style="font:10px var(--body);fill:var(--muted)">2031: decidi su ciò che hai misurato</text></svg>`;
$("lv-3").innerHTML = `<div class="mini"><span><span class="chip acc">Esempio</span></span><span class="chip warn">Probabilmente sì</span></div><div><b style="font-family:var(--display);font-size:19px">Investimenti irrigui aziendali</b><p class="note">Scadenza 31 gennaio · Contributo 50%, 60% per i giovani</p></div>
  ${[["Sede operativa in regione", "good", "C'è"], ["Regolarità contributiva", "warn", "Da verificare"], ["Risparmio idrico del 10%", "warn", "Da verificare"]].map(r => `<div class="mini" style="align-items:center"><span>${r[0]}</span><span class="chip ${r[1]}">${r[2]}</span></div>`).join("")}<a class="btn" style="align-self:flex-start;pointer-events:none">Applica il contributo al piano</a>`;

/* ---------- Account: registrazione, conferma della mail, azienda dalla partita IVA, piano, accesso ---------- */
let A = null, wantPlan = "azienda", stepN = 1, draft = {};
try { A = JSON.parse(localStorage.getItem("agro.account")); } catch (e) {}
const logged = () => !!(A && A.completo && localStorage.getItem("agro.sessione") === "1");
function saveA() { try { localStorage.setItem("agro.account", JSON.stringify(A)); } catch (e) {} fetch("api/account", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(A) }).catch(() => {}); }
async function hashPw(salt, pw) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ":" + pw)); return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, "0")).join(""); }
function pivaOk(s) { if (!/^\d{11}$/.test(s)) return false; let t = 0; for (let i = 0; i < 11; i++) { let d = +s[i]; if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } t += d; } return t % 10 === 0; }
const dots = n => `<div class="dots">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</div><p class="eyebrow">Passo ${n} di 5</p>`;
function acctUI() { const on = logged(), pl = on ? (PLANS.find(p => p.id === A.piano) || PLANS[1]).nome : "";
  $("acct").innerHTML = on ? `<span class="acct">${esc(A.nome.split(" ")[0])} · Piano ${pl} · <button class="linkb" id="out" type="button">Esci</button></span>` : `<a class="btn ghost" href="#accedi" style="padding:5px 12px">Accedi</a> <a class="btn" href="#registrati" style="padding:5px 12px">Crea account</a>`;
  if ($("out")) $("out").onclick = () => { localStorage.removeItem("agro.sessione"); acctUI(); location.hash = "home"; };
  $("l-login").textContent = on ? "Apri Agro" : "Accedi"; $("l-login").setAttribute("href", on ? "#stagione" : "#accedi"); $("l-cta-top").hidden = on; }
function authRender(kind) {
  const box = $("auth-box"); box.classList.toggle("wide", kind === "registrati" && stepN === 4); $("auth-foot").innerHTML = "";
  if (kind === "accedi") {
    box.innerHTML = `<h1>Bentornato</h1><form id="lg" style="display:flex;flex-direction:column;gap:14px"><label>Mail<input type="email" id="lg-m" autocomplete="username" required value="${esc(A ? A.email : "")}"></label><label>Password<input type="password" id="lg-p" autocomplete="current-password" required></label><p class="err" id="lg-e" hidden></p><button class="btn big" type="submit">Accedi</button></form><p class="note"><button class="linkb" id="lg-f" type="button">Password dimenticata?</button></p>`;
    $("auth-foot").innerHTML = `Non hai un account? <a href="#registrati">Inizia la prova gratuita</a>`;
    $("lg").onsubmit = async e => { e.preventDefault(); const er = $("lg-e"), m = $("lg-m").value.trim().toLowerCase(); er.hidden = true;
      if (!A || A.email !== m || A.hash !== await hashPw(A.salt, $("lg-p").value)) { er.textContent = "Mail o password non corrette."; er.hidden = false; return; }
      if (!A.completo) { stepN = A.verificata ? 3 : 2; location.hash = "registrati"; return; }
      localStorage.setItem("agro.sessione", "1"); acctUI(); location.hash = "stagione"; };
    $("lg-f").onclick = () => { const m = $("lg-m").value.trim(), er = $("lg-e"); er.hidden = false; er.className = m ? "note" : "err"; er.textContent = m ? `Certo, ti abbiamo inviato una mail a ${m} con il link per scegliere una nuova password.` : "Scrivi prima la tua mail."; };
    return;
  }
  if (stepN === 1) {
    box.innerHTML = `${dots(1)}<h1>Crea il tuo account</h1><p class="lede">14 giorni gratis, senza carta di credito.</p><form id="rg" style="display:flex;flex-direction:column;gap:14px">
      <label>Nome e cognome<input type="text" id="rg-n" autocomplete="name" required value="${esc(draft.nome || "")}"></label><label>Mail<input type="email" id="rg-m" autocomplete="username" required value="${esc(draft.email || "")}"></label>
      <label>Password<input type="password" id="rg-p" autocomplete="new-password" required minlength="8"><div class="meter"><i id="rg-mt"></i></div><span class="note" id="rg-ml">Almeno 8 caratteri</span></label>
      <label class="row"><input type="checkbox" id="rg-c" required><span>Accetto i termini del servizio e l'informativa sulla privacy</span></label><p class="err" id="rg-e" hidden></p><button class="btn big" type="submit">Crea account</button></form>`;
    $("auth-foot").innerHTML = `Hai già un account? <a href="#accedi">Accedi</a>`;
    $("rg-p").oninput = e => { const v = e.target.value, sc = (v.length >= 8) + (v.length >= 12) + (/[A-Z]/.test(v) && /[a-z]/.test(v)) + /\d/.test(v) + /[^A-Za-z0-9]/.test(v), m = $("rg-mt"); m.style.setProperty("--w", sc * 20 + "%"); m.style.setProperty("--c", sc < 2 ? "var(--crit)" : sc < 4 ? "var(--warn)" : "var(--good)"); $("rg-ml").textContent = v.length < 8 ? "Almeno 8 caratteri" : sc < 3 ? "Debole: aggiungi numeri, maiuscole o simboli" : sc < 4 ? "Discreta" : "Robusta"; };
    $("rg").onsubmit = async e => { e.preventDefault(); const er = $("rg-e"), m = $("rg-m").value.trim().toLowerCase(), pw = $("rg-p").value; er.hidden = true;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(m)) { er.textContent = "Controlla la mail: non sembra un indirizzo valido."; er.hidden = false; return; }
      if (pw.length < 8) { er.textContent = "La password deve avere almeno 8 caratteri."; er.hidden = false; return; }
      if (A && A.completo && A.email === m) { er.innerHTML = `Esiste già un account con questa mail. <a href="#accedi">Accedi</a>`; er.hidden = false; return; }
      const salt = Array.from(crypto.getRandomValues(new Uint8Array(12))).map(x => x.toString(16).padStart(2, "0")).join("");
      A = { nome: $("rg-n").value.trim(), email: m, salt, hash: await hashPw(salt, pw), verificata: false, completo: false, creato: new Date().toISOString() }; draft = { nome: A.nome, email: m }; saveA(); stepN = 2; authRender("registrati"); };
    return;
  }
  if (stepN === 2) {
    box.innerHTML = `${dots(2)}<svg class="mail" viewBox="0 0 74 74"><g class="fly"><rect x="9" y="19" width="56" height="38" rx="6" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="3"/><path d="M11 23l26 20 26-20" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g></svg>
      <h1 style="text-align:center">Certo, ti abbiamo inviato una mail</h1><p class="lede" style="text-align:center">Apri il link che trovi nella mail arrivata a <b>${esc(A.email)}</b> per confermare l'indirizzo. Se non la vedi, controlla nella posta indesiderata.</p>
      <button class="btn big" id="v-ok" type="button">Ho confermato la mail</button><p class="note" style="text-align:center" id="v-n"><button class="linkb" id="v-re" type="button">Inviala di nuovo</button> · <button class="linkb" id="v-ch" type="button">Cambia indirizzo</button></p>`;
    $("v-ok").onclick = () => { A.verificata = true; saveA(); stepN = 3; authRender("registrati"); };
    $("v-re").onclick = () => { $("v-n").insertAdjacentHTML("beforeend", `<br><span class="good">Certo, l'abbiamo inviata di nuovo.</span>`); $("v-re").disabled = true; };
    $("v-ch").onclick = () => { stepN = 1; authRender("registrati"); };
    return;
  }
  if (stepN === 3) {
    box.innerHTML = `${dots(3)}<h1>La tua azienda</h1><p class="lede">Scrivi la partita IVA: ragione sociale e sede le recuperiamo dal registro europeo VIES.</p>
      <label>Partita IVA<input type="text" id="pv" inputmode="numeric" maxlength="13" placeholder="11 cifre" autocomplete="off" value="${esc(draft.piva || "")}"></label><div id="pv-out"></div>
      <div id="pv-man" hidden style="display:flex;flex-direction:column;gap:12px"><label>Ragione sociale<input type="text" id="pv-r"></label><label>Sede<input type="text" id="pv-a"></label></div>
      <div class="grid g2"><label>Cosa gestisci<select id="pv-t"><option value="campo">Campo coltivato</option><option value="allev">Allevamento</option></select></label><label>Regione<select id="pv-g">${REGIONI.map(r => `<option ${r === P.regione ? "selected" : ""}>${r}</option>`).join("")}</select></label></div>
      <p class="err" id="pv-e" hidden></p><button class="btn big" id="pv-go" type="button">Continua</button>`;
    let found = null, lastQ = "";
    const look = async () => { const v = $("pv").value.replace(/^IT/i, "").replace(/\s/g, ""), out = $("pv-out"); if (v === lastQ) return; lastQ = v; found = null; $("pv-man").hidden = true;
      if (v.length < 11) { out.innerHTML = ""; return; } if (!pivaOk(v)) { out.innerHTML = `<p class="err">Questa partita IVA non è valida: controlla le cifre.</p>`; return; }
      out.innerHTML = `<p class="note"><span class="spinner"></span> Cerco l'azienda nel registro VIES…</p>`;
      try { const j = await (await fetch("api/piva?n=" + v)).json(); if (v !== lastQ) return;
        if (j.valida && j.ragione) { found = j; out.innerHTML = `<div class="vies"><span class="chip good">Partita IVA attiva nel registro VIES</span><b>${esc(j.ragione)}</b><span>${esc(j.indirizzo || "")}</span><span class="note">Non è la tua azienda? Controlla il numero.</span></div>`; if (j.regione) $("pv-g").value = j.regione; }
        else { out.innerHTML = `<p class="note">${j.valida === false ? "Il registro VIES non riconosce questa partita IVA come attiva per gli scambi europei." : "Il registro VIES non risponde in questo momento."} Puoi inserire i dati a mano.</p>`; $("pv-man").hidden = false; }
      } catch (e) { out.innerHTML = `<p class="note">Non riesco a raggiungere il registro VIES. Puoi inserire i dati a mano.</p>`; $("pv-man").hidden = false; } };
    $("pv").oninput = look; if (draft.piva) look();
    $("pv-go").onclick = () => { const v = $("pv").value.replace(/^IT/i, "").replace(/\s/g, ""), er = $("pv-e"), rs = found ? found.ragione : $("pv-r").value.trim(); er.hidden = true;
      if (!pivaOk(v)) { er.textContent = "Inserisci una partita IVA valida di 11 cifre."; er.hidden = false; return; } if (!rs) { er.textContent = "Manca la ragione sociale."; er.hidden = false; $("pv-man").hidden = false; return; }
      Object.assign(A, { piva: v, ragione: rs, indirizzo: found ? found.indirizzo : $("pv-a").value.trim(), daVies: !!found, tipo: $("pv-t").value, regione: $("pv-g").value }); draft.piva = v; saveA(); stepN = 4; authRender("registrati"); };
    return;
  }
  if (stepN === 4) {
    box.innerHTML = `${dots(4)}<h1>Scegli il piano</h1><p class="lede">Lo provi gratis per 14 giorni e puoi cambiarlo quando vuoi. Nessuna carta richiesta adesso.</p>
      <div class="l-plans" id="pk">${PLANS.map(p => `<button type="button" class="card plan ${p.id === wantPlan ? "top" : ""}" data-p="${p.id}" style="text-align:left;cursor:pointer;font:inherit;color:inherit"><h3>${p.nome}</h3><div class="pr num" style="font-size:28px">${price(p)}</div><span class="note">${p.per}</span><ul>${p.punti.slice(0, 4).map(x => `<li>${x}</li>`).join("")}</ul></button>`).join("")}</div>
      <button class="btn big" id="pk-go" type="button">Attiva la prova gratuita</button>`;
    $("pk").onclick = e => { const b = e.target.closest("[data-p]"); if (b) { wantPlan = b.dataset.p; authRender("registrati"); } };
    $("pk-go").onclick = () => { const fine = new Date(Date.now() + 14 * 864e5); Object.assign(A, { piano: wantPlan, ciclo, provaFino: fine.toISOString(), completo: true }); saveA(); localStorage.setItem("agro.sessione", "1");
      P = merge({}); Object.assign(P, { nome: A.ragione, tipo: A.tipo, regione: A.regione, example: false, comune: A.comune || "", lat: null, lon: null, quota: null, meteo: null }); save(); resetViews(); started = false; R = null; stepN = 5; acctUI(); authRender("registrati"); };
    return;
  }
  const pl = PLANS.find(p => p.id === A.piano) || PLANS[1];
  box.innerHTML = `${dots(5)}<svg class="check" viewBox="0 0 84 84"><circle cx="42" cy="42" r="36" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="3"/><path d="M26 43l11 11 21-23" fill="none" stroke="var(--accent)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <h1 style="text-align:center">Certo, benvenuto ${esc(A.nome.split(" ")[0])}: sei iscritto</h1><p class="lede" style="text-align:center">Abbiamo creato lo spazio di <b>${esc(A.ragione)}</b> con il piano ${pl.nome}. La prova gratuita dura fino al ${new Date(A.provaFino).toLocaleDateString("it-IT", { day: "numeric", month: "long" })}. Ti abbiamo inviato una mail di riepilogo.</p>
    <a class="btn big" href="#azienda">Completa i dati dell'azienda</a><a class="btn ghost" href="#stagione">Vai subito alla prossima stagione</a>`;
}

/* ---------- Movimento: luce sulle schede, inclinazione, suggerimenti, sfondi animati ---------- */
const tip = $("tip"), reduce = matchMedia("(prefers-reduced-motion:reduce)").matches;
let MX = innerWidth / 2, MY = innerHeight / 2;
document.addEventListener("pointermove", e => { MX = e.clientX; MY = e.clientY;
  const c = e.target.closest && e.target.closest(".card"); if (c) { const r = c.getBoundingClientRect(); c.style.setProperty("--mx", (e.clientX - r.left) + "px"); c.style.setProperty("--my", (e.clientY - r.top) + "px");
    if (c.classList.contains("do") && !reduce) c.style.transform = `perspective(700px) rotateX(${((e.clientY - r.top) / r.height - 0.5) * -7}deg) rotateY(${((e.clientX - r.left) / r.width - 0.5) * 9}deg) translateY(-4px)`; }
  showTip(e); });
function showTip(e) { const t = e.target.closest && e.target.closest("[data-tip]"); if (t) { tip.textContent = t.dataset.tip; tip.classList.add("on"); const w = tip.offsetWidth, h = tip.offsetHeight; tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, e.clientX + 14)) + "px"; tip.style.top = (e.clientY + h + 24 > innerHeight ? e.clientY - h - 12 : e.clientY + 16) + "px"; } else tip.classList.remove("on"); return !!t; }
/* Sul telefono non c'è il passaggio del mouse: il dettaglio compare toccando e sparisce da solo */
let tipT = 0; document.addEventListener("pointerdown", e => { if (e.pointerType === "mouse") return; clearTimeout(tipT); if (showTip(e)) tipT = setTimeout(() => tip.classList.remove("on"), 4000); });
/* Barra in basso sul telefono */
(function () { const mb = $("mnav-menu"), setM = on => { document.body.classList.toggle("menu-open", on); mb.setAttribute("aria-expanded", on ? "true" : "false"); };
  mb.onclick = () => setM(!document.body.classList.contains("menu-open"));
  $("nav").addEventListener("click", e => { if (e.target.closest("a")) setM(false); });
  const mark = () => { const hsh = location.hash || "#home"; let hit = false; document.querySelectorAll("#mnav a").forEach(a => { const on = a.getAttribute("href") === hsh; a.classList.toggle("on", on); hit = hit || on; }); mb.classList.toggle("on", !hit); };
  addEventListener("hashchange", () => { setM(false); mark(); }); mark(); })();
document.addEventListener("pointerout", e => { const c = e.target.closest && e.target.closest(".do"); if (c && !c.contains(e.relatedTarget)) c.style.transform = ""; });
/* Sfondo: semi portati dal vento, che si scansano al passaggio del mouse */
(function () { if (reduce) return; const cv = $("amb"), x = cv.getContext("2d"); let w, h, ps = []; const cols = ["#2F78B7", "#2E9E57", "#D99A12", "#C4572F"];
  const size = () => { w = cv.width = innerWidth; h = cv.height = innerHeight; }; size(); addEventListener("resize", size);
  for (let i = 0; i < 46; i++) ps.push({ x: Math.random() * w, y: Math.random() * h, vx: 0.15 + Math.random() * 0.35, vy: (Math.random() - 0.5) * 0.2, r: 1 + Math.random() * 2.2, c: cols[i % 4], ph: Math.random() * 6.28 });
  let t = 0; (function loop() { t += 0.008; x.clearRect(0, 0, w, h);
    for (const p of ps) { const dx = p.x - MX, dy = p.y - MY, d2 = dx * dx + dy * dy; if (d2 < 22000) { const f = (22000 - d2) / 22000 * 0.9, d = Math.sqrt(d2) || 1; p.x += dx / d * f * 3; p.y += dy / d * f * 3; }
      p.x += p.vx; p.y += p.vy + Math.sin(t * 2 + p.ph) * 0.25; if (p.x > w + 10) { p.x = -10; p.y = Math.random() * h; } if (p.y < -10) p.y = h + 10; if (p.y > h + 10) p.y = -10;
      x.globalAlpha = 0.5; x.fillStyle = p.c; x.beginPath(); x.ellipse(p.x, p.y, p.r * 2.2, p.r, Math.sin(t + p.ph) * 0.8, 0, 6.28); x.fill(); }
    requestAnimationFrame(loop); })(); })();
/* Copertina: una sola sequenza. Cadono i semi, spuntano gli alberi, arrivano le quattro stagioni, cadono le foglie. Poi si ferma. */
(function () { const cv = $("heroc"), x = cv.getContext("2d"), chipsEl = Array.from($("l-wheel").children);
  let w = 0, h = 0, soil = null, grain = null, t0 = null, ended = false, last = 0;
  const mul = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }, Rn = mul(11);
  const cl = (v, a, b) => v < a ? a : v > b ? b : v, mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k], rgb = (a, al) => `rgba(${a[0] | 0},${a[1] | 0},${a[2] | 0},${al == null ? 1 : al})`;
  /* Alberi: rami generati una volta, poi fatti crescere dal basso */
  const trees = [{ x: 0.585, s: 0.6, d: 0.5 }, { x: 0.675, s: 0.86, d: 1.2 }, { x: 0.775, s: 1, d: 0.8 }, { x: 0.875, s: 0.78, d: 1.7 }, { x: 0.955, s: 0.52, d: 2.1 }].map(sp => { const br = [], lf = []; let maxD = 0;
    (function grow(x0, y0, ang, len, dep, dist) { const x1 = x0 + Math.sin(ang) * len, y1 = y0 + Math.cos(ang) * len, d1 = dist + len; br.push({ x0, y0, x1, y1, dep, a: dist, b: d1 }); if (d1 > maxD) maxD = d1;
      if (dep >= 1) { const n = dep >= 4 ? 5 : dep >= 2 ? 3 : 1; for (let i = 0; i < n; i++) lf.push({ x: x1 + (Rn() - 0.5) * 0.15, y: y1 + (Rn() - 0.3) * 0.11, r: 0.036 + Rn() * 0.032, at: d1, k: Rn(), fall: Rn() < 0.42, tf: 10.9 + Rn() * 2.3, dx: (Rn() - 0.5) * 0.5, rot: Rn() * 6.28, gy: Rn() }); }
      if (dep < 4) { const n = dep === 0 ? 3 : 2; for (let i = 0; i < n; i++) grow(x1, y1, ang + (i - (n - 1) / 2) * (0.55 + Rn() * 0.25) + (Rn() - 0.5) * 0.2, len * (0.66 + Rn() * 0.1), dep + 1, d1); } })(0, 0, (Rn() - 0.5) * 0.1, 0.34, 0, 0);
    return { sp, br, lf, maxD }; });
  const tufts = Array.from({ length: 150 }, () => ({ x: Rn(), hh: 3 + Rn() * 8, lean: (Rn() - 0.5) * 6, k: Rn() })), flakes = Array.from({ length: 40 }, () => ({ x: Rn(), y: Rn(), s: 0.5 + Rn() }));
  const SKY = [[[8, 22, 36], [15, 38, 54]], [[7, 28, 22], [16, 54, 40]], [[14, 30, 20], [34, 60, 34]], [[26, 20, 17], [62, 40, 26]]], SUN = [[150, 190, 230], [190, 235, 160], [250, 220, 120], [245, 160, 100]], AUT = [[226, 166, 40], [204, 100, 52], [176, 62, 42]];
  function textures() { const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1); if (r.width < 2 || r.height < 2) { soil = null; return; } w = r.width; h = r.height; cv.width = w * dpr; cv.height = h * dpr; x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const R2 = mul(5), sh = Math.ceil(h * 0.2) + 20; soil = document.createElement("canvas"); soil.width = Math.ceil(w); soil.height = sh; const s = soil.getContext("2d"); s.fillStyle = "#231c14"; s.fillRect(0, 0, w, sh);
    for (let i = 0; i < w * 2.2; i++) { const l = 30 + R2() * 40; s.strokeStyle = `rgba(${l + 40 | 0},${l + 22 | 0},${l | 0},${0.12 + R2() * 0.22})`; s.lineWidth = 1 + R2() * 2; const px = R2() * w, py = R2() * sh, ln = 4 + R2() * 22; s.beginPath(); s.moveTo(px, py); s.lineTo(px + ln, py + (R2() - 0.5) * 3); s.stroke(); }
    for (let k = 0; k < 9; k++) { s.strokeStyle = "rgba(0,0,0,.28)"; s.lineWidth = 2 + k * 0.5; s.beginPath(); for (let px = 0; px <= w; px += 20) { const py = 10 + k * k * 2.1 + Math.sin(px / 190 + k) * 3; px ? s.lineTo(px, py) : s.moveTo(px, py); } s.stroke(); }
    grain = document.createElement("canvas"); grain.width = grain.height = 160; const g = grain.getContext("2d"); for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(255,255,255,${R2() * 0.09})`; g.fillRect(R2() * 160, R2() * 160, 1, 1); } }
  function draw(t) {
    if (!soil) { textures(); if (!soil) return; }
    /* Primo giro: semi e crescita. Poi le quattro stagioni girano senza fine: c è il tempo dentro il ciclo di 14 secondi */
    const loop = t >= 14, c = loop ? (t - 14) % 14 : t, U = q => q < 2.4 ? 0 : q < 4 ? (q - 2.4) / 1.6 : q < 6.4 ? 1 : q < 8 ? 1 + (q - 6.4) / 1.6 : q < 10 ? 2 : q < 11.6 ? 2 + (q - 10) / 1.6 : 3;
    const u = loop && c < 1.6 ? 3 + c / 1.6 : U(c), i = Math.floor(u) % 4, j2 = (i + 1) % 4, k = u - Math.floor(u), wn = u < 1 ? 1 - u : u > 3 ? u - 3 : 0;
    const top = mix(SKY[i][0], SKY[j2][0], k), bot = mix(SKY[i][1], SKY[j2][1], k), sun = mix(SUN[i], SUN[j2], k), gy = h * 0.86, small = w < 760, hs = small ? 0.17 : 0.33;
    const gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, rgb(top)); gr.addColorStop(1, rgb(bot)); x.fillStyle = gr; x.fillRect(0, 0, w, h);
    const rg = x.createRadialGradient(w * 0.78, gy, 0, w * 0.78, gy, h * 0.75); rg.addColorStop(0, rgb(sun, 0.26)); rg.addColorStop(1, rgb(sun, 0)); x.fillStyle = rg; x.fillRect(0, 0, w, h);
    x.fillStyle = x.createPattern(grain, "repeat"); x.fillRect(0, 0, w, h);
    /* Terreno: una trama ferma, tinta dalla stagione */
    const edge = px => gy + Math.sin(px / 150) * 4 + Math.sin(px / 47) * 1.5;
    x.save(); x.beginPath(); x.moveTo(0, h); for (let px = 0; px <= w + 20; px += 20) x.lineTo(px, edge(px)); x.lineTo(w, h); x.closePath(); x.clip(); x.drawImage(soil, 0, gy - 8);
    x.fillStyle = wn > 0 ? `rgba(215,232,245,${0.2 * wn})` : u < 2 ? `rgba(60,150,80,${0.1 * Math.min(1, u - 0.6)})` : `rgba(190,96,40,${0.12 * (u - 2)})`; x.fillRect(0, gy - 10, w, h); x.restore();
    const gcol = u < 2 ? mix([120, 200, 110], [70, 160, 80], cl(u - 1, 0, 1)) : mix([70, 160, 80], [196, 160, 80], cl(u - 2, 0, 1)), gh = u <= 1 ? u : u <= 2 ? 1 : u <= 3 ? 1 - 0.3 * (u - 2) : 0.7 * (4 - u);
    if (gh > 0.01) { x.strokeStyle = rgb(gcol, 0.8); x.lineWidth = 1.3; x.beginPath(); for (const f of tufts) { const px = f.x * w, py = edge(px) + 2; x.moveTo(px, py); x.lineTo(px + f.lean * gh, py - f.hh * gh); } x.stroke(); }
    if (wn > 0) { x.fillStyle = `rgba(235,244,250,${0.7 * wn})`; for (const f of flakes) { const py = ((f.y + t * 0.06 * f.s) % 1) * gy; x.beginPath(); x.arc(f.x * w + Math.sin(t + f.y * 9) * 6, py, 1.4 * f.s, 0, 6.28); x.fill(); } }
    /* Semi, poi alberi */
    const g = loop ? 1 : t < 3 ? 0 : t < 6.5 ? (t - 3) / 3.5 * 0.6 : t < 8.2 ? 0.6 + (t - 6.5) / 1.7 * 0.4 : 1, resting = [];
    for (const tr of trees) { const sp = tr.sp, bx = sp.x * w, by = edge(bx) + 3, H = h * hs * sp.s, ts = t - sp.d;
      if (!loop && ts > 0 && ts < 2.6) { const q = cl(ts / 0.9, 0, 1), sy = -12 + (by + 12) * q * q, al = ts < 1.7 ? 1 : 1 - (ts - 1.7) / 0.9; x.fillStyle = `rgba(214,176,112,${al})`; x.beginPath(); x.ellipse(bx, sy, 3.2, 4.6, 0.4, 0, 6.28); x.fill();
        if (q < 1) { x.strokeStyle = "rgba(214,176,112,.25)"; x.lineWidth = 1.5; x.beginPath(); x.moveTo(bx, sy - 6); x.lineTo(bx, sy - 30); x.stroke(); } else { const rr = (ts - 0.9) * 16; x.strokeStyle = `rgba(214,176,112,${Math.max(0, 0.5 - (ts - 0.9) * 0.5)})`; x.lineWidth = 1.5; x.beginPath(); x.ellipse(bx, by, rr, rr * 0.3, 0, 0, 6.28); x.stroke(); } }
      if (g <= 0) continue; const reach = g * tr.maxD * 1.03;
      x.lineCap = "round"; for (const b of tr.br) { if (reach <= b.a) continue; const q = cl((reach - b.a) / (b.b - b.a), 0, 1); x.strokeStyle = rgb(mix([150, 118, 84], [104, 80, 58], b.dep / 4)); x.lineWidth = Math.max(1, (5 - b.dep) * H * 0.013 * (0.5 + 0.5 * g)); x.beginPath(); x.moveTo(bx + b.x0 * H, by - b.y0 * H); x.lineTo(bx + (b.x0 + (b.x1 - b.x0) * q) * H, by - (b.y0 + (b.y1 - b.y0) * q) * H); x.stroke(); }
      if (g < 0.3) { const tip = Math.min(reach, 0.34) * H, a = cl(1 - (g - 0.15) / 0.15, 0, 1); x.fillStyle = `rgba(140,214,110,${a})`; for (const sgn of [-1, 1]) { x.beginPath(); x.ellipse(bx + sgn * 5, by - tip - 2, 6, 3, sgn * -0.6, 0, 6.28); x.fill(); } }
      for (const l of tr.lf) { if (reach <= l.at) continue; const tf = 10.6 + (l.tf - 10.9) / 2.3 * 1.5, ox = bx + l.x * H, oy = by - l.y * H, gyy = edge(ox + l.dx * H) + 4 + l.gy * 16;
        let sc = 1, al = 0.9, p = 0, c3 = mix([150, 214, 112], [48, 160, 90], cl((c - 5.5) / 3, 0, 1)); c3 = mix(c3, AUT[Math.floor(l.k * 3)], cl((c - 10 - l.k * 0.8) / 1.8, 0, 1));
        if (!loop) { sc = cl((reach - l.at) / (0.14 * tr.maxD), 0, 1); if (l.fall && c > tf) p = cl((c - tf) / 1.8, 0, 1); }
        else if (c < 3) { c3 = AUT[Math.floor(l.k * 3)]; if (l.fall) { p = 1; al = 0.95 * (1 - cl((c - 0.3) / 1.9, 0, 1)); } else { const wf = l.k * 1.2; p = cl((c - wf) / 1.4, 0, 1); al = 0.9 * (1 - cl((c - wf - 1.4) / 0.9, 0, 1)); } }
        else { sc = cl((c - 3 - l.k * 1.6) / 1.4, 0, 1); if (l.fall && c > tf) p = cl((c - tf) / 1.8, 0, 1); }
        if (al <= 0.01 || sc <= 0.01) continue; const r = l.r * H * sc;
        if (p > 0) resting.push([ox + l.dx * H * p + Math.sin(p * 9 + l.rot) * 9 * (1 - p), oy + (gyy - oy) * p * p, r, l.rot + p * 5, c3, al]); else { x.fillStyle = rgb(c3, al); x.beginPath(); x.arc(ox, oy, r, 0, 6.28); x.fill(); } } }
    for (const q of resting) { x.fillStyle = rgb(q[4], q[5]); x.beginPath(); x.ellipse(q[0], q[1], q[2] * 0.95, q[2] * 0.5, q[3], 0, 6.28); x.fill(); }
    const ph = u < 0.5 || u >= 3.5 ? 0 : u < 1.5 ? 1 : u < 2.5 ? 2 : 3; chipsEl.forEach((el, j) => el.classList.toggle("on", j === ph));
  }
  function frame(now) { if (!document.body.classList.contains("r-home") || document.hidden) { t0 = null; requestAnimationFrame(frame); return; }
    if (t0 == null) t0 = now - last * 1000; last = (now - t0) / 1000; draw(last); requestAnimationFrame(frame); }
  textures(); if (reduce) { last = 13.9; draw(last); } else requestAnimationFrame(frame);
  addEventListener("resize", () => { textures(); draw(last); });
})();

/* ---------- Navigazione e avvio ---------- */
const wide = matchMedia("(min-width:1181px)"), VIEWS = ["stagione", "diagnosi", "imprevisti", "bandi", "previsione", "simulazione", "piano", "perche", "robustezza", "dati", "azienda", "sensori"];
let started = false;
function route() {
  let r = location.hash.slice(1), anch = null; if (r === "prezzi" || r === "come-funziona") { anch = r; r = "home"; }
  if (r === "registrati" || r === "accedi") { if (logged() && stepN !== 5) { location.hash = "stagione"; return; } if (r === "registrati" && A && !A.completo && stepN === 1) stepN = A.verificata ? 3 : 1; document.body.className = "r-auth"; scrollTo(0, 0); authRender(r); return; }
  if (stepN === 5) stepN = 1;
  if (r !== "home" && r !== "consulente" && !VIEWS.includes(r)) r = "home";
  const shown = r === "consulente" ? (wide.matches ? "stagione" : "consulente") : r;
  document.body.className = "r-" + r; if (r === "home") { if (anch) $("s-" + anch).scrollIntoView({ behavior: "smooth" }); else scrollTo(0, 0); } else $("main").scrollTop = 0;
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.dataset.view === shown));
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#" + (r === "consulente" && !wide.matches ? r : shown)));
  if (r !== "home" && !started) { started = true; recompute(true); }
}
addEventListener("hashchange", route); wide.addEventListener("change", route);
(async () => {
  try { const d = await (await fetch("api/azienda")).json(); if (d && d.tipo) P = merge(d); } catch (e) {}
  try { const st = await (await fetch("api/stato")).json(); IA = !!st.ia; } catch (e) {}
  try { const a = await (await fetch("api/account")).json(); if (a && a.email && !A) A = a; } catch (e) {}
  acctUI();
  if (!IA) { try { sample = self.claude && self.claude.use ? await self.claude.use("sample") : null; } catch (e) { sample = null; } }
  mode(); route();
})();
