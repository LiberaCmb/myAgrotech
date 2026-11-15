/* Agro · motore di simulazione e decisione (v2).
   Cadenza stagionale: ogni anno ha inverno, primavera, estate e autunno.
   Gira in un Web Worker nel browser e in Node per le prove.
   Tutti i parametri sono illustrativi: servono a confrontare scelte, non a prevedere un anno preciso. */
(function (G) {
"use strict";
const VERSION = "2.0", Y0 = 2026, T = 30, DISC = 0.04, N = 300, STG = [0, 4, 9], NEVER = 99, FP = 180;

/* ---------- Tabelle di base ---------- */
// R: pioggia normale per stagione (mm). E: evapotraspirazione di riferimento (mm). H: giorni sopra 32 °C. F: ultima gelata (giorno dell'anno). O: inizio primavera (giorno dell'anno).
const ZONES = {
  sud_costa:   { name: "Sud, pianura costiera", R: [190, 130, 40, 160], E: [100, 310, 540, 200], H: 28, F: 68,  O: 72, coast: 1 },
  sud_collina: { name: "Sud, collina interna",  R: [230, 170, 60, 190], E: [80, 280, 500, 180],  H: 18, F: 92,  O: 86, coast: 0 },
  centro:      { name: "Centro Italia",         R: [230, 200, 110, 210], E: [70, 270, 470, 160], H: 14, F: 98,  O: 90, coast: 0 },
  nord:        { name: "Pianura Padana",        R: [170, 220, 210, 200], E: [50, 260, 450, 140], H: 16, F: 104, O: 94, coast: 0 }
};
const SCEN = [
  { id: "ssp126", name: "Emissioni basse", code: "SSP1-2.6", dT: 0.018, rf: 0.4, dW: -0.001, w: 0.25 },
  { id: "ssp245", name: "Emissioni intermedie", code: "SSP2-4.5", dT: 0.035, rf: 1.0, dW: -0.003, w: 0.5 },
  { id: "ssp585", name: "Emissioni alte", code: "SSP5-8.5", dT: 0.055, rf: 1.7, dW: -0.006, w: 0.25 }
];
// Cinque modelli climatici sintetici: sensibilità al riscaldamento e risposta delle piogge diverse.
const CMOD = [
  { name: "Modello A", sens: 0.75, rain: 0.5, w: 0.15 }, { name: "Modello B", sens: 0.9, rain: 1.3, w: 0.25 },
  { name: "Modello C", sens: 1.0, rain: 1.0, w: 0.25 }, { name: "Modello D", sens: 1.15, rain: 0.8, w: 0.2 },
  { name: "Modello E", sens: 1.35, rain: 1.6, w: 0.15 }
];
// Tre famiglie di risposta della coltura (incertezza strutturale).
const STRUCT = [
  { name: "Risposta lineare", w: 0.5 }, { name: "Risposta a soglia", w: 0.3 }, { name: "Con adattamento e CO₂", w: 0.2 }
];
const SEAS_T = [0.8, 0.9, 1.3, 1.0], RAIN_T = [-0.001, -0.004, -0.007, -0.002], RAIN_CV = [0.25, 0.3, 0.5, 0.3];
/* kind: spring = semina o trapianto primaverile; winter = semina autunnale; tree = arborea.
   S0: giorno normale della fase esposta al gelo (trapianto, spigatura, germogliamento). L: giorni fino alla fase critica per il caldo. */
const CROPS = {
  /* Cereali */
  grano:    { cat: "Cereali", name: "Grano duro", kind: "winter", stage: "Spigatura", y: 3.8, price: 330, cost: 900, need: 450, f: [0.15, 0.6, 0.15, 0.1], S0: 120, L: 28, Wc: 34, heat: 0.006, Ky: 1.0, frost: 0.3, pest: 0.1, e0: 1.4 },
  tenero:   { cat: "Cereali", name: "Grano tenero", kind: "winter", stage: "Spigatura", y: 5.5, price: 250, cost: 950, need: 450, f: [0.15, 0.6, 0.15, 0.1], S0: 125, L: 28, Wc: 34, heat: 0.0055, Ky: 1.0, frost: 0.3, pest: 0.1, e0: 1.5 },
  orzo:     { cat: "Cereali", name: "Orzo", kind: "winter", stage: "Spigatura", y: 4.2, price: 210, cost: 650, need: 400, f: [0.18, 0.62, 0.1, 0.1], S0: 115, L: 26, Wc: 32, heat: 0.005, Ky: 1.0, frost: 0.25, pest: 0.08, e0: 1.2 },
  mais:     { cat: "Cereali", name: "Mais da granella", kind: "spring", stage: "Semina", y: 11, price: 230, cost: 1700, need: 600, f: [0, 0.3, 0.7, 0], S0: 100, L: 72, Wc: 36, heat: 0.005, Ky: 1.25, frost: 0.4, pest: 0.1, e0: 2.6 },
  riso:     { cat: "Cereali", name: "Riso", kind: "spring", stage: "Semina", y: 6.8, price: 480, cost: 2400, need: 900, f: [0, 0.3, 0.7, 0], S0: 115, L: 90, Wc: 30, heat: 0.003, Ky: 0.9, frost: 0.2, pest: 0.1, e0: 6.5 },
  sorgo:    { cat: "Cereali", name: "Sorgo", kind: "spring", stage: "Semina", y: 6.5, price: 210, cost: 850, need: 420, f: [0, 0.3, 0.7, 0], S0: 125, L: 65, Wc: 36, heat: 0.003, Ky: 0.9, frost: 0.35, pest: 0.07, e0: 1.6 },
  /* Colture industriali e proteiche */
  soia:     { cat: "Industriali e proteiche", name: "Soia", kind: "spring", stage: "Semina", y: 3.6, price: 420, cost: 800, need: 500, f: [0, 0.25, 0.75, 0], S0: 125, L: 70, Wc: 36, heat: 0.0045, Ky: 0.85, frost: 0.35, pest: 0.08, e0: 0.9 },
  girasole: { cat: "Industriali e proteiche", name: "Girasole", kind: "spring", stage: "Semina", y: 2.6, price: 430, cost: 650, need: 420, f: [0, 0.35, 0.65, 0], S0: 100, L: 75, Wc: 36, heat: 0.004, Ky: 0.95, frost: 0.3, pest: 0.08, e0: 1.1 },
  colza:    { cat: "Industriali e proteiche", name: "Colza", kind: "winter", stage: "Fioritura", y: 3.0, price: 440, cost: 850, need: 430, f: [0.18, 0.6, 0.1, 0.12], S0: 100, L: 30, Wc: 34, heat: 0.005, Ky: 1.0, frost: 0.35, pest: 0.12, e0: 1.6 },
  bietola:  { cat: "Industriali e proteiche", name: "Barbabietola da zucchero", kind: "spring", stage: "Semina", y: 60, price: 50, cost: 1900, need: 600, f: [0, 0.35, 0.65, 0], S0: 70, L: 110, Wc: 40, heat: 0.004, Ky: 1.0, frost: 0.45, pest: 0.12, e0: 2.2 },
  legumi:   { cat: "Industriali e proteiche", name: "Legumi da granella (cece, lenticchia)", kind: "spring", stage: "Semina", y: 1.6, price: 650, cost: 650, need: 300, f: [0.05, 0.6, 0.35, 0], S0: 65, L: 85, Wc: 34, heat: 0.0055, Ky: 0.85, frost: 0.3, pest: 0.08, e0: 0.6 },
  favino:   { cat: "Industriali e proteiche", name: "Favino e fava", kind: "winter", stage: "Fioritura", y: 2.8, price: 300, cost: 600, need: 380, f: [0.2, 0.6, 0.1, 0.1], S0: 100, L: 30, Wc: 34, heat: 0.0055, Ky: 0.9, frost: 0.35, pest: 0.08, e0: 0.6 },
  medica:   { cat: "Industriali e proteiche", name: "Erba medica", kind: "winter", stage: "Primo sfalcio", y: 11, price: 180, cost: 900, need: 650, f: [0.1, 0.35, 0.4, 0.15], S0: 125, L: 30, Wc: 40, heat: 0.0035, Ky: 0.9, frost: 0.15, pest: 0.05, e0: 0.7 },
  /* Orticole */
  pomodoro: { cat: "Orticole", name: "Pomodoro da industria", kind: "spring", stage: "Trapianto", y: 80, price: 140, cost: 7500, need: 650, f: [0, 0.3, 0.7, 0], S0: 110, L: 60, Wc: 40, heat: 0.0045, Ky: 1.05, frost: 0.6, pest: 0.12, e0: 3.2 },
  patata:   { cat: "Orticole", name: "Patata", kind: "spring", stage: "Semina", y: 30, price: 250, cost: 5500, need: 500, f: [0, 0.45, 0.55, 0], S0: 85, L: 70, Wc: 40, heat: 0.005, Ky: 1.1, frost: 0.55, pest: 0.15, e0: 2.8 },
  melone:   { cat: "Orticole", name: "Melone e anguria", kind: "spring", stage: "Trapianto", y: 35, price: 300, cost: 7500, need: 450, f: [0, 0.3, 0.7, 0], S0: 115, L: 60, Wc: 40, heat: 0.003, Ky: 1.1, frost: 0.7, pest: 0.12, e0: 2.8 },
  peperone: { cat: "Orticole", name: "Peperone e melanzana", kind: "spring", stage: "Trapianto", y: 35, price: 600, cost: 14000, need: 650, f: [0, 0.3, 0.7, 0], S0: 120, L: 65, Wc: 40, heat: 0.0045, Ky: 1.1, frost: 0.7, pest: 0.14, e0: 3.4 },
  zucchina: { cat: "Orticole", name: "Zucchina", kind: "spring", stage: "Trapianto", y: 30, price: 550, cost: 11000, need: 500, f: [0, 0.4, 0.6, 0], S0: 110, L: 45, Wc: 40, heat: 0.004, Ky: 1.0, frost: 0.7, pest: 0.13, e0: 3.0 },
  insalata: { cat: "Orticole", name: "Insalate (lattuga, indivia)", kind: "spring", stage: "Trapianto", y: 30, price: 500, cost: 9500, need: 300, f: [0.05, 0.6, 0.35, 0], S0: 75, L: 45, Wc: 34, heat: 0.006, Ky: 1.0, frost: 0.35, pest: 0.13, e0: 2.6 },
  cipolla:  { cat: "Orticole", name: "Cipolla", kind: "spring", stage: "Semina", y: 40, price: 220, cost: 5200, need: 450, f: [0.05, 0.45, 0.5, 0], S0: 70, L: 100, Wc: 40, heat: 0.0035, Ky: 1.1, frost: 0.3, pest: 0.12, e0: 2.4 },
  carciofo: { cat: "Orticole", name: "Carciofo", kind: "winter", stage: "Raccolta principale", y: 10, price: 700, cost: 4500, need: 500, f: [0.2, 0.35, 0.15, 0.3], S0: 95, L: 30, Wc: 40, heat: 0.005, Ky: 0.9, frost: 0.5, pest: 0.1, e0: 2.0 },
  cavolo:   { cat: "Orticole", name: "Cavolfiore e broccoli", kind: "winter", stage: "Raccolta", y: 22, price: 450, cost: 5500, need: 400, f: [0.3, 0.15, 0.15, 0.4], S0: 80, L: 30, Wc: 36, heat: 0.004, Ky: 0.9, frost: 0.15, pest: 0.12, e0: 2.4 },
  finocchio:{ cat: "Orticole", name: "Finocchio", kind: "winter", stage: "Raccolta", y: 28, price: 400, cost: 6000, need: 400, f: [0.3, 0.15, 0.15, 0.4], S0: 75, L: 30, Wc: 36, heat: 0.004, Ky: 0.95, frost: 0.15, pest: 0.11, e0: 2.4 },
  fragola:  { cat: "Orticole", name: "Fragola", kind: "tree", stage: "Fioritura", y: 28, price: 2600, cost: 45000, need: 500, f: [0.1, 0.55, 0.25, 0.1], S0: 80, L: 45, Wc: 36, heat: 0.005, Ky: 1.0, frost: 0.6, pest: 0.15, e0: 4.5 },
  /* Vite, olivo e agrumi */
  olivo:    { cat: "Vite, olivo e agrumi", name: "Olivo da olio", kind: "tree", stage: "Germogliamento", y: 5, price: 800, cost: 2800, need: 500, f: [0.05, 0.3, 0.5, 0.15], S0: 98, L: 55, Wc: 40, heat: 0.003, Ky: 0.6, frost: 0.35, pest: 0.14, e0: 1.2 },
  vite:     { cat: "Vite, olivo e agrumi", name: "Vite da vino", kind: "tree", stage: "Germogliamento", y: 10, price: 600, cost: 4500, need: 450, f: [0.02, 0.33, 0.55, 0.1], S0: 95, L: 95, Wc: 50, heat: 0.0035, Ky: 0.65, frost: 0.5, pest: 0.14, e0: 1.8 },
  tavola:   { cat: "Vite, olivo e agrumi", name: "Uva da tavola", kind: "tree", stage: "Germogliamento", y: 25, price: 700, cost: 12000, need: 600, f: [0.02, 0.33, 0.55, 0.1], S0: 95, L: 100, Wc: 50, heat: 0.003, Ky: 0.85, frost: 0.5, pest: 0.14, e0: 2.4 },
  agrumi:   { cat: "Vite, olivo e agrumi", name: "Agrumi", kind: "tree", stage: "Germogliamento", y: 25, price: 350, cost: 5200, need: 800, f: [0.1, 0.25, 0.5, 0.15], S0: 90, L: 60, Wc: 40, heat: 0.003, Ky: 1.0, frost: 0.3, pest: 0.12, e0: 2.4 },
  /* Frutta e frutta a guscio */
  melo:     { cat: "Frutta e frutta a guscio", name: "Melo", kind: "tree", stage: "Fioritura", y: 45, price: 420, cost: 13000, need: 650, f: [0.02, 0.28, 0.55, 0.15], S0: 105, L: 100, Wc: 50, heat: 0.0035, Ky: 1.0, frost: 0.65, pest: 0.15, e0: 2.6 },
  pero:     { cat: "Frutta e frutta a guscio", name: "Pero", kind: "tree", stage: "Fioritura", y: 25, price: 650, cost: 12000, need: 650, f: [0.02, 0.28, 0.55, 0.15], S0: 98, L: 100, Wc: 50, heat: 0.004, Ky: 1.0, frost: 0.65, pest: 0.16, e0: 2.6 },
  pesco:    { cat: "Frutta e frutta a guscio", name: "Pesco e nettarine", kind: "tree", stage: "Fioritura", y: 22, price: 550, cost: 9500, need: 650, f: [0.02, 0.33, 0.6, 0.05], S0: 75, L: 100, Wc: 50, heat: 0.003, Ky: 1.0, frost: 0.7, pest: 0.14, e0: 2.4 },
  albicocco:{ cat: "Frutta e frutta a guscio", name: "Albicocco", kind: "tree", stage: "Fioritura", y: 14, price: 750, cost: 8000, need: 550, f: [0.03, 0.42, 0.5, 0.05], S0: 72, L: 85, Wc: 45, heat: 0.003, Ky: 0.95, frost: 0.6, pest: 0.13, e0: 2.2 },
  ciliegio: { cat: "Frutta e frutta a guscio", name: "Ciliegio", kind: "tree", stage: "Fioritura", y: 8, price: 2600, cost: 12000, need: 500, f: [0.03, 0.52, 0.4, 0.05], S0: 90, L: 55, Wc: 40, heat: 0.0035, Ky: 0.9, frost: 0.65, pest: 0.15, e0: 2.0 },
  susino:   { cat: "Frutta e frutta a guscio", name: "Susino", kind: "tree", stage: "Fioritura", y: 18, price: 550, cost: 7500, need: 600, f: [0.02, 0.33, 0.6, 0.05], S0: 80, L: 100, Wc: 50, heat: 0.003, Ky: 0.95, frost: 0.65, pest: 0.13, e0: 2.2 },
  kiwi:     { cat: "Frutta e frutta a guscio", name: "Kiwi (actinidia)", kind: "tree", stage: "Germogliamento", y: 22, price: 900, cost: 11000, need: 900, f: [0.02, 0.28, 0.6, 0.1], S0: 85, L: 110, Wc: 50, heat: 0.005, Ky: 1.15, frost: 0.6, pest: 0.14, e0: 2.6 },
  nocciolo: { cat: "Frutta e frutta a guscio", name: "Nocciolo", kind: "tree", stage: "Germogliamento", y: 2.2, price: 3200, cost: 3200, need: 450, f: [0.05, 0.3, 0.55, 0.1], S0: 75, L: 120, Wc: 50, heat: 0.004, Ky: 0.8, frost: 0.45, pest: 0.12, e0: 1.2 },
  mandorlo: { cat: "Frutta e frutta a guscio", name: "Mandorlo", kind: "tree", stage: "Fioritura", y: 2.0, price: 2000, cost: 2600, need: 450, f: [0.05, 0.35, 0.5, 0.1], S0: 62, L: 130, Wc: 50, heat: 0.0025, Ky: 0.7, frost: 0.6, pest: 0.1, e0: 1.1 },
  castagno: { cat: "Frutta e frutta a guscio", name: "Castagno da frutto", kind: "tree", stage: "Germogliamento", y: 2.5, price: 1800, cost: 1800, need: 500, f: [0.05, 0.3, 0.5, 0.15], S0: 110, L: 110, Wc: 50, heat: 0.004, Ky: 0.8, frost: 0.4, pest: 0.16, e0: 0.8 }
};
const FORAGE = { name: "Foraggi aziendali", kind: "winter", stage: "Primo sfalcio", y: 8, price: FP, cost: 0, need: 550, f: [0.15, 0.45, 0.3, 0.1], S0: 125, L: 30, Wc: 40, heat: 0.004, Ky: 0.9, frost: 0.15, pest: 0.06, e0: 0.9 };
/* Per capo (o posto, fattrice, alveare) all'anno. prod in kg venduti; feed in tonnellate di foraggio equivalente:
   per suini, avicoli e conigli è la spesa di mangime divisa per il prezzo del foraggio (180 €/t). cost comprende l'alimentazione ordinaria: feed serve solo a calcolare il rincaro negli anni scarsi. u: unità di conto; what: cosa si vende. */
const HERDS = {
  bufala:   { cat: "Bovini e bufalini", name: "Bufale da latte", u: "capi", what: "latte", prod: 2300, price: 1.75, cost: 2900, feed: 5.5, heat: 0.0022, ent: 3.0 },
  bovino:   { cat: "Bovini e bufalini", name: "Bovine da latte", u: "capi", what: "latte", prod: 8500, price: 0.52, cost: 3300, feed: 6.5, heat: 0.0030, ent: 3.4 },
  carne:    { cat: "Bovini e bufalini", name: "Bovini da carne (ingrasso)", u: "capi", what: "peso vivo", prod: 420, price: 3.4, cost: 1050, feed: 3.2, heat: 0.0015, ent: 2.2 },
  nutrice:  { cat: "Bovini e bufalini", name: "Vacche nutrici (linea vacca-vitello)", u: "vacche", what: "vitelli, peso vivo", prod: 230, price: 3.6, cost: 700, feed: 2.4, heat: 0.0015, ent: 2.4 },
  ovino:    { cat: "Ovini e caprini", name: "Ovini da latte", u: "capi", what: "latte", prod: 220, price: 1.35, cost: 190, feed: 0.75, heat: 0.0018, ent: 0.35 },
  agnello:  { cat: "Ovini e caprini", name: "Ovini da carne", u: "pecore", what: "agnelli, peso vivo", prod: 22, price: 5.5, cost: 95, feed: 0.35, heat: 0.0012, ent: 0.3 },
  capra:    { cat: "Ovini e caprini", name: "Capre da latte", u: "capi", what: "latte", prod: 450, price: 0.95, cost: 330, feed: 0.8, heat: 0.0018, ent: 0.3 },
  suino:    { cat: "Suini", name: "Suini da ingrasso", u: "posti", what: "peso vivo", prod: 255, price: 1.9, cost: 435, feed: 1.3, heat: 0.0030, ent: 0.25 },
  scrofa:   { cat: "Suini", name: "Scrofe da riproduzione", u: "scrofe", what: "suinetti, peso vivo", prod: 780, price: 3.2, cost: 1775, feed: 4.9, heat: 0.0035, ent: 0.6 },
  ovaiola:  { cat: "Avicoli", name: "Galline ovaiole", u: "capi", what: "uova", prod: 19, price: 1.6, cost: 23.4, feed: 0.08, heat: 0.0035, ent: 0.005 },
  pollo:    { cat: "Avicoli", name: "Polli da carne", u: "posti", what: "peso vivo", prod: 14.3, price: 1.25, cost: 14.7, feed: 0.057, heat: 0.0040, ent: 0.004 },
  tacchino: { cat: "Avicoli", name: "Tacchini da carne", u: "posti", what: "peso vivo", prod: 32, price: 1.75, cost: 44, feed: 0.19, heat: 0.0035, ent: 0.012 },
  coniglio: { cat: "Altri allevamenti", name: "Conigli da carne", u: "fattrici", what: "peso vivo", prod: 130, price: 2.2, cost: 230, feed: 0.94, heat: 0.0040, ent: 0.05 },
  api:      { cat: "Altri allevamenti", name: "Api da miele", u: "alveari", what: "miele", prod: 25, price: 8, cost: 110, feed: 0.05, heat: 0.0030, ent: 0 }
};
const IRR = { no: 0, asp: 0.75, goccia: 0.9 }, COOL = { no: 0, vent: 0.4, docce: 0.7 };

/* Leve decisionali. Le prime sei si possono cambiare ogni anno; le ultime quattro sono investimenti con un momento di ingresso. */
const FLEX = ["v", "cal", "soil", "ipm", "sens", "ins"], INV = ["W", "C", "P", "G"];
function LEVERS(tipo) {
  const f = tipo === "campo";
  return {
    v:    { dom: 1, name: f ? "Varietà tolleranti a caldo e secco" : "Razione estiva e foraggi tolleranti", rev: "Reversibile" },
    C:    { dom: 1, name: f ? "Riconversione del 35% a coltura meno esigente" : "35% dei foraggi a specie resistenti al secco", rev: "In parte reversibile" },
    cal:  { dom: 2, name: f ? "Calendario" : "Calendario di sfalci e semine", opts: ["Date abituali", f ? "Anticipo fisso" : "Anticipo fisso", "Adattivo: segue la stagione"], rev: "Reversibile" },
    G:    { dom: 3, name: f ? "20% della coltura su un appezzamento più fresco" : "20% dei foraggi su terreni più freschi", rev: "In parte reversibile" },
    W:    { dom: 4, name: f ? "Irrigazione a goccia e accumulo idrico" : "Irrigazione di soccorso e accumulo idrico", rev: "Poco reversibile" },
    soil: { dom: 5, name: "Colture di copertura e sostanza organica", rev: "Reversibile" },
    ipm:  { dom: 6, name: f ? "Difesa integrata con monitoraggio" : "Biosicurezza e piano sanitario", rev: "Reversibile" },
    sens: { dom: 7, name: f ? "Sensori di suolo e centralina meteo" : "Sensori in stalla e centralina meteo", rev: "Reversibile" },
    P:    { dom: 7, name: f ? "Reti ombreggianti, antigrandine e antibrina" : "Raffrescamento: ventilazione e docce", rev: "Poco reversibile" },
    ins:  { dom: 8, name: "Assicurazione parametrica su siccità, gelo e grandine", rev: "Reversibile" }
  };
}
const DOMAINS = ["", "Colture e varietà", "Calendario e fenologia", "Geografia produttiva", "Acqua e infrastrutture", "Suolo e fertilità", "Fitopatie e rischio biologico", "Tecnologia e investimenti", "Mercati, finanza e assicurazioni", "Rischio di territorio"];

/* ---------- Numeri casuali e statistiche pesate ---------- */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function wmean(v, w, o, n) { let s = 0, sw = 0; for (let i = 0; i < n; i++) { s += v[o + i] * w[i]; sw += w[i]; } return sw > 0 ? s / sw : 0; }
/* Quantili e media della coda peggiore (CVaR) con pesi. idx: indici ammessi oppure null per tutti. */
function wstats(v, o, w, idx, alpha) {
  const n = idx ? idx.length : w.length, ord = new Array(n);
  for (let i = 0; i < n; i++) ord[i] = idx ? idx[i] : i;
  ord.sort((a, b) => v[o + a] - v[o + b]);
  let sw = 0, s = 0; for (let i = 0; i < n; i++) { sw += w[ord[i]]; s += w[ord[i]] * v[o + ord[i]]; }
  if (!(sw > 0)) return { mean: 0, cvar: 0, p10: 0, p50: 0, p90: 0, sw: 0 };
  const res = { mean: s / sw, sw };
  let acc = 0, tail = 0, tw = 0; const lim = alpha * sw; let q = [0.1, 0.5, 0.9], qi = 0; const qv = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const wi = w[ord[i]], x = v[o + ord[i]];
    if (acc < lim) { const take = Math.min(wi, lim - acc); tail += take * x; tw += take; }
    acc += wi;
    while (qi < 3 && acc >= q[qi] * sw) { qv[qi] = x; qi++; }
  }
  while (qi < 3) { qv[qi] = v[o + ord[n - 1]]; qi++; }
  res.cvar = tw > 0 ? tail / tw : res.mean; res.p10 = qv[0]; res.p50 = qv[1]; res.p90 = qv[2];
  return res;
}
/* Ottimizzazione robusta alla distribuzione: valore atteso nel caso peggiore tra tutte le distribuzioni
   entro una distanza di Kullback-Leibler rho da quella ipotizzata (forma duale, ricerca a sezione aurea). */
const zbuf = new Float64Array(N);
function klWorst(v, o, w, rho) {
  const n = w.length; let m = 0, sw = 0; for (let i = 0; i < n; i++) { m += v[o + i] * w[i]; sw += w[i]; } m /= sw;
  if (rho <= 0) return m;
  let va = 0; for (let i = 0; i < n; i++) { const d = v[o + i] - m; va += w[i] * d * d; } const sd = Math.sqrt(va / sw);
  if (sd < 1e-9) return m;
  for (let i = 0; i < n; i++) zbuf[i] = (v[o + i] - m) / sd;
  const f = la => { const a = Math.exp(la); let mx = -Infinity; for (let i = 0; i < n; i++) { const x = -zbuf[i] / a; if (x > mx) mx = x; }
    let s = 0; for (let i = 0; i < n; i++) s += w[i] / sw * Math.exp(-zbuf[i] / a - mx); return -a * (mx + Math.log(s)) - a * rho; };
  let lo = -3, hi = 5; const gr = 0.618034; let x1 = hi - gr * (hi - lo), x2 = lo + gr * (hi - lo), f1 = f(x1), f2 = f(x2);
  for (let k = 0; k < 28; k++) { if (f1 < f2) { lo = x1; x1 = x2; f1 = f2; x2 = lo + gr * (hi - lo); f2 = f(x2); } else { hi = x2; x2 = x1; f2 = f1; x1 = hi - gr * (hi - lo); f1 = f(x1); } }
  return m + sd * Math.max(f1, f2);
}

/* Zona climatica corretta per la sede: quota rispetto alla quota tipica della zona */
const ZREF = { sud_costa: 20, sud_collina: 350, centro: 250, nord: 60 };
function siteZone(P) { const zb = ZONES[P.zona], z = Object.assign({}, zb, { R: zb.R.slice() });
  if (P.quota != null && isFinite(P.quota)) { const dz = clamp((P.quota - ZREF[P.zona]) / 100, -4, 12); z.H = zb.H * clamp(1 - 0.06 * dz, 0.25, 1.3); z.F = zb.F + 2.2 * dz; z.O = zb.O + 2.2 * dz; const rm = clamp(1 + 0.02 * dz, 0.8, 1.3); z.R = zb.R.map(v => v * rm); }
  z.Od = z.O;
  /* Se per la sede ci sono i dati storici (ERA5-Land 1991-2025), il clima di oggi è la media 2016-2025 misurata, non la tabella */
  const c = P.clima && P.clima.oggi; if (c) { if (c.R && c.R.every(v => v > 0)) z.R = c.R.slice(); if (c.H != null) z.H = Math.max(1, c.H); if (c.F != null) z.F = c.F; if (c.O != null) z.Od = c.O; z.dati = true; }
  return z; }
/* ---------- Mondo: clima, prezzi e parametri incerti per ogni traiettoria ---------- */
function buildWorld(P) {
  const z = siteZone(P), r = rng(P.seed || 2026);
  const g = () => { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
  const W = { z };
  for (const k of ["Tw", "Ts", "Tu", "Ta", "Rw", "Rs", "Ru", "Ra", "on", "fr", "hot", "av", "ext", "pm", "pa", "ci", "wi", "o1", "o2", "ny", "pp"]) W[k] = new Float32Array(N * T);
  for (const k of ["kyM", "heatM", "cultU", "pestM", "somM", "fin", "cx", "sys", "rate"]) W[k] = new Float32Array(N);
  W.sc = new Uint8Array(N); W.cm = new Uint8Array(N); W.st = new Uint8Array(N);
  /* Variabilità e legami tra stagioni: stimati sulla storia della sede quando c'è, altrimenti valori di base */
  const cl = P.clima, fT = [0.59, 0.55, 0.5, 0.54].map((b, k) => cl && cl.sdT ? clamp(cl.sdT[k] / b, 0.6, 2.2) : 1), cvR = RAIN_CV.map((b, k) => cl && cl.cvR ? clamp(cl.cvR[k], 0.12, 0.8) : b);
  const onB = cl && cl.inizio ? clamp(cl.inizio.perGrado, -16, -3) : -6.5, onS = cl && cl.inizio ? clamp(cl.inizio.sd, 3, 12) : 5, frB = cl && cl.gelata ? clamp(cl.gelata.perGrado, -12, 0) : -5, frS = cl && cl.gelata ? clamp(cl.gelata.sd, 6, 25) : 10;
  const hotB = cl && cl.caldo ? clamp(cl.caldo.perGrado, 2, 25) : 9, hotS = cl && cl.caldo ? clamp(cl.caldo.sd, 1, 12) : 3, pvol = P.volPrezzo ? clamp(P.volPrezzo / 1.118, 0.03, 0.3) : 0.064;
  const nS = [N / 4, N / 2, N / 4], ann = (rr, n) => rr / (1 - Math.pow(1 + rr, -n)), Rtot = z.R[0] + z.R[1] + z.R[2] + z.R[3];
  let p = 0;
  for (let s = 0; s < 3; s++) for (let j = 0; j < nS[s]; j++, p++) {
    const S = SCEN[s]; W.sc[p] = s;
    let u = (j + 0.5) / nS[s], m = 0, acc = 0; for (; m < 5; m++) { acc += CMOD[m].w; if (u <= acc) break; } m = Math.min(m, 4); W.cm[p] = m;
    u = r(); W.st[p] = u < STRUCT[0].w ? 0 : u < STRUCT[0].w + STRUCT[1].w ? 1 : 2;
    const sens = CMOD[m].sens * Math.exp(0.08 * g()), rainM = CMOD[m].rain, sys = Math.exp(0.3 * g());
    W.sys[p] = sys; W.kyM[p] = Math.exp(0.2 * g()); W.heatM[p] = Math.exp(0.25 * g()); W.cultU[p] = r(); W.pestM[p] = Math.exp(0.3 * g()); W.somM[p] = Math.exp(0.15 * g());
    const rate = 0.025 + 0.06 * r(); W.rate[p] = rate; W.fin[p] = ann(rate, 10) / ann(DISC, 10); W.cx[p] = 0.9 + 0.4 * r();
    const dp = 0.003 * g(), da = 0.006 * g() - 0.002 * (sys - 1), ge = 0.001 + 0.004 * g();
    let Lf = 0, lp = 0, la = 0;
    for (let t = 0; t < T; t++) {
      const i = p * T + t, yr = t + 1, tr = S.dT * yr * sens;
      Lf = 0.5 * Lf + 0.3 * g();
      const ew = 0.55 * g() * fT[0], es = (0.5 * ew / fT[0] + 0.43 * g()) * fT[1], eu = (0.3 * es / fT[1] + 0.42 * g()) * fT[2], ea = 0.5 * g() * fT[3];
      const Tw = tr * SEAS_T[0] + 0.6 * Lf + ew, Ts = tr * SEAS_T[1] + 0.6 * Lf + es, Tu = tr * SEAS_T[2] + 0.6 * Lf + eu, Ta = tr * SEAS_T[3] + 0.6 * Lf + ea;
      W.Tw[i] = Tw; W.Ts[i] = Ts; W.Tu[i] = Tu; W.Ta[i] = Ta;
      const rf = S.rf * rainM * yr, rr = k => z.R[k] * Math.max(0.15, (1 + RAIN_T[k] * rf) * (1 - 0.08 * Lf) * (1 + cvR[k] * g()));
      const Rw = rr(0), Rs = rr(1), Ru = rr(2), Ra = rr(3); W.Rw[i] = Rw; W.Rs[i] = Rs; W.Ru[i] = Ru; W.Ra[i] = Ra;
      W.on[i] = onB * (0.6 * Tw + 0.4 * Ts) + onS * g();
      W.fr[i] = z.F + frB * (0.5 * Tw + 0.5 * Ts) + frS * g();
      W.hot[i] = Math.max(0, z.H + hotB * Tu + hotS * g());
      W.av[i] = clamp(1 + S.dW * yr * sens * sys + 0.07 * g() + 0.25 * Math.min(0, (Rw + Rs + Ru + Ra) / Rtot - 1), 0.2, 1);
      W.ext[i] = r() < 0.05 + 0.02 * Math.max(0, Tu) ? 1 : 0;
      lp = 0.6 * lp + pvol * g(); la = 0.6 * la + 0.08 * g();
      W.pm[i] = Math.exp(dp * yr + lp); W.pa[i] = Math.exp(da * yr + la);
      W.ci[i] = Math.max(0.7, 1 + ge * yr + 0.04 * g()); W.wi[i] = 1 + 0.012 * yr * sys;
      W.o1[i] = g(); W.o2[i] = g(); W.ny[i] = Math.max(0.5, 1 + 0.05 * g()); W.pp[i] = g();
    }
  }
  return W;
}

/* ---------- Azienda ---------- */
function makeFarm(P) {
  const field = P.tipo === "campo", z = siteZone(P), gr = P.contributi || {};
  const F = { field, z, units: field ? P.ettari : P.capi, water: P.acqua == null ? 0.25 : P.acqua, grant: k => 1 - clamp((gr[k] || 0) / 100, 0, 0.9) };
  let c;
  if (field) { c = Object.assign({}, CROPS[P.coltura], { y: P.resa, price: P.prezzo, cost: P.costo }); F.eff0 = IRR[P.irr] || 0; F.k = 1; F.fa = 1; }
  else { const h = Object.assign({}, HERDS[P.specie], { prod: P.prod, price: P.prezzoL, cost: P.costoC }); F.h = h; c = Object.assign({}, FORAGE); F.eff0 = 0; F.k = h.cost / 3000; F.s = P.auto / 100; F.cool0 = COOL[P.cool] || 0; F.fa = h.feed * F.s / FORAGE.y; }
  c.S0 += Math.round((z.O - 72) * 0.8); F.c = c;
  const alt = Object.assign({}, c, { price: c.price * 0.8, need: c.need * 0.7, heat: c.heat * 0.5, Ky: c.Ky * 0.5, pest: c.pest * 0.8 });
  alt.cost = field ? Math.max(0, c.y * alt.price - 0.9 * (c.y * c.price - c.cost)) : 0;
  F.alt = alt; F.tree = c.kind === "tree";
  const k = F.k, tr = F.tree;
  /* Investimento e costo annuo per unità (ettaro o capo) */
  F.capex = field
    ? { W: P.irr === "goccia" ? 2600 : P.irr === "asp" ? 4500 : 5200, C: tr ? 5600 : 420, P: tr ? 3200 : 2400, G: tr ? 2500 : 300, v: tr ? 900 : 150, sens: 90 }
    : { W: 250 * k, C: 90 * k, P: 400 * k, G: 150 * k, v: 60 * k, sens: 25 * k };
  F.opex = field ? { W: 60, C: 0, P: 80, G: 120, v: tr ? 0 : 30, cal: 10, soil: 110, ipm: 60, sens: 15 } : { W: 20 * k, C: 6 * k, P: 30 * k, G: 40 * k, v: 15 * k, cal: 3 * k, soil: 25 * k, ipm: 25 * k, sens: 8 * k };
  for (const q of ["W", "C", "P", "G", "sens"]) F.capex[q] *= F.grant(q);
  F.rev0 = field ? c.y * c.price : F.h.prod * F.h.price;
  F.calFix = c.kind === "spring" ? -10 : c.kind === "winter" ? -6 : 5;
  F.skill = c.kind === "winter" ? 0.45 : 0.8;
  return F;
}

/* ---------- Un anno, una porzione di superficie: bilancio idrico stagionale, fenologia, stress ---------- */
const sc = { D: 0, irr: 0, net: 0, hl: 0, wl: 0, pl: 0, fl: 0, xl: 0, S: 0 }; // risultati dell'ultima chiamata
const st = { store: new Float64Array(3), som: new Float64Array(3), sal: new Float64Array(3) };
let SHOCK = null;
function part(M, c, slot, i, p, shift, o) {
  const W = M.W, z = W.z, stc = W.st[p];
  let Ts = W.Ts[i], hot = W.hot[i] * o.hotMul, frd = W.fr[i] + o.frostAdd, on = W.on[i], av = W.av[i];
  let R0 = W.Rw[i] * o.rainMul, R1 = W.Rs[i] * o.rainMul, R2 = W.Ru[i] * o.rainMul, R3 = W.Ra[i] * o.rainMul;
  if (SHOCK) { av *= SHOCK.avail; if (SHOCK.dry && SHOCK.dry(i % T)) { R1 *= 0.6; R2 *= 0.4; } }
  /* Fenologia: la fase esposta segue l'inizio della primavera (arboree e cereali) o la data scelta (semine primaverili) */
  const follow = c.kind === "tree" ? 1 : c.kind === "winter" ? 0.7 : 0;
  const S = c.S0 + follow * on + shift, C = S + c.L * (1 - 0.03 * Ts), HS = 165 + 0.4 * on;
  const expo = clamp((C + c.Wc / 2 - HS) / c.Wc, 0, 1);
  let hl = c.heat * W.heatM[p] * o.hm * hot * (0.35 + 0.65 * expo) * o.heatMul;
  if (stc === 1) hl *= 1 + 0.8 * Math.max(0, hot / (Math.max(z.H, 5) * 1.3) - 1); else if (stc === 2) hl *= 0.8;
  hl = Math.min(0.9, hl);
  const fl = c.frost * clamp((frd - S) / 15, 0, 1) * o.frostMul;
  /* Semine primaverili: partire prima che la stagione sia pronta rallenta la coltura (terreno freddo) */
  let cl = 0; if (c.kind === "spring") { const q = clamp((c.S0 - 4 + 0.9 * on - S) / 20, 0, 1.5); cl = 0.25 * q * q; }
  /* Acqua: quattro stagioni, il suolo fa da serbatoio tra una e l'altra */
  let fs = c.f[1], fu = c.f[2];
  if (c.kind === "spring") { const du = clamp(0.006 * shift, -0.2, 0.1); fu += du; fs -= du; }
  const som = st.som[slot], cap = (70 + 40 * som) * M.capMul, co = stc === 2 ? 0.97 : 1;
  let store = st.store[slot], quota = c.need * 0.8 * Math.min(1, av + o.boost), unmet = 0, etc = 0, gross = 0, net = 0;
  const ff = [c.f[0], fs, fu, c.f[3]], RR = [R0, R1, R2, R3], TT = [W.Tw[i], Ts, W.Tu[i], W.Ta[i]];
  for (let s = 0; s < 4; s++) {
    const e = c.need * ff[s] * (1 + 0.035 * TT[s]) * co, sup = 0.75 * RR[s] + store, a0 = Math.min(e, sup);
    store = Math.min(cap, sup - a0) * 0.85; etc += e;
    let gap = e - a0;
    if (gap > 0 && o.eff > 0) { const gq = Math.min(gap / o.eff, quota); quota -= gq; gross += gq; net += gq * o.eff; gap -= gq * o.eff; }
    unmet += gap;
  }
  st.store[slot] = store;
  const D = etc > 0 ? unmet / etc : 0;
  const wl = Math.min(0.95, c.Ky * W.kyM[p] * o.dm * (stc === 1 ? D + 1.5 * Math.max(0, D - 0.2) : D));
  /* Suolo: sostanza organica e salinità evolvono di anno in anno */
  const Tm = (TT[0] + TT[1] + TT[2] + TT[3]) / 4, kd = 0.012;
  let ns = som + kd * 1.6 + (o.cover ? 0.03 : 0) - kd * som * (1 + 0.06 * Tm) * W.somM[p];
  if (W.ext[i] && !o.cover) ns -= 0.02 * M.slope;
  st.som[slot] = clamp(ns, 0.5, 4);
  let sal = st.sal[slot];
  if (z.coast) { sal = clamp(sal + 0.02 * (gross / c.need) * (1.25 - av) * 4 - 0.03 * (R0 / z.R[0]), 0, 1); st.sal[slot] = sal; }
  const salF = 1 - 0.25 * Math.max(0, sal - 0.25);
  /* Parassiti e patogeni: inverni miti e primavere umide aumentano la pressione */
  const Pp = clamp(0.45 + 0.14 * W.Tw[i] + 0.25 * (R1 / z.R[1] - 1) + 0.12 * W.pp[i], 0, 1.3) * W.pestM[p];
  const pl = Math.min(0.6, c.pest * Pp * o.ipmF);
  const xl = W.ext[i] ? 0.3 * o.extMul : 0;
  sc.D = D; sc.irr = gross; sc.net = net; sc.hl = hl; sc.wl = wl; sc.pl = pl; sc.fl = fl; sc.cl = cl; sc.xl = xl; sc.S = S; sc.Pp = Pp;
  let f = (1 - hl) * Math.max(0.05, 1 - wl) * (1 - pl) * (1 - fl) * (1 - cl) * (1 - xl) * salF;
  if (stc === 2) f *= 1 + 0.0015 * (i % T + 1);
  return f;
}
const O = { hotMul: 1, frostAdd: 0, rainMul: 1, hm: 1, dm: 1, heatMul: 1, frostMul: 1, extMul: 1, boost: 0, eff: 0, cover: false, ipmF: 1 };

/* Decisione stagionale sul calendario: usa ciò che si osserva a fine inverno (con errore di misura), non il futuro */
function decideShift(M, flex, i, p) {
  const F = M.farm, W = M.W;
  if (flex.cal === 0) return 0;
  if (flex.cal === 1) return F.calFix;
  const c = F.c, fo = F.skill * (W.on[i] + W.o1[i] * (flex.sens ? 3 : 7));
  if (c.kind === "spring") { let sh = clamp(fo, -24, 8); const fh = W.fr[i] + W.o2[i] * (flex.sens ? 5 : 9); return Math.max(sh, fh + 4 - c.S0); }
  if (c.kind === "winter") return fo < -4 ? -6 : 0;
  return fo < -5 ? 6 : 0;
}

/* Margine di un anno per unità (ettaro o capo), con le leve attive in quell'anno */
const acc = { irr: 0, em: 0, D: 0, yi: 0, hl: 0, wl: 0, pl: 0, fl: 0, xl: 0, lost: 0, treat: 0, S: 0, pay: 0 };
function yearEval(M, flex, p, t, aW, aC, aP, aG, convAge, shiftOv) {
  const W = M.W, F = M.farm, i = p * T + t, c = F.c, field = F.field;
  const e = 0.4 + 1.2 * W.cultU[p];
  O.hm = flex.v ? 1 - 0.35 * e : 1; O.dm = flex.v ? 1 - 0.15 * e : 1;
  O.eff = aW ? (field ? Math.max(F.eff0, 0.9) : 0.8) : F.eff0; if (O.eff > 0 && flex.sens) O.eff = Math.min(0.97, O.eff + 0.04);
  O.boost = aW ? 0.25 : 0; O.cover = !!flex.soil; O.ipmF = flex.ipm ? (flex.sens ? 0.75 : 0.8) : 1;
  const cov = aP && field ? 0.4 : 0; O.heatMul = 1 - 0.25 * cov; O.frostMul = (1 - 0.5 * cov) * (flex.cal === 2 && c.kind === "tree" ? 0.8 : 1); O.extMul = 1 - 0.67 * cov;
  const shift = shiftOv == null ? decideShift(M, flex, i, p) : shiftOv;
  const gS = aG ? 0.2 : 0, aS = aC ? 0.35 : 0, mS = 1 - gS - aS, pen = flex.v ? 0.965 : 1;
  let pm = W.pm[i], pa = W.pa[i], ci = W.ci[i]; if (SHOCK && t >= 2) { pm *= SHOCK.price; pa *= SHOCK.price; ci *= SHOCK.cost; }
  let rev = 0, cost = 0, irr = 0, yi = 0, D = 0;
  O.hotMul = 1; O.frostAdd = 0; O.rainMul = 1;
  const ny = W.ny[i];
  let rel = part(M, c, 0, i, p, shift, O) / M.f0 * pen * ny;
  rev += mS * c.y * rel * c.price * pm; cost += mS * c.cost * ci; irr += mS * sc.irr; yi += mS * rel; D += mS * sc.D;
  acc.hl = sc.hl; acc.wl = sc.wl; acc.pl = sc.pl; acc.fl = sc.fl + sc.cl; acc.fr = sc.fl; acc.xl = sc.xl; acc.S = sc.S;
  const Pp = sc.Pp;
  if (aS > 0) { const ra = part(M, F.alt, 1, i, p, shift, O) / M.f0a * ny * (convAge < 2 ? 0.5 : 1); rev += aS * c.y * ra * F.alt.price * pa; cost += aS * F.alt.cost * ci; irr += aS * sc.irr; yi += aS * ra; D += aS * sc.D; }
  if (gS > 0) { O.hotMul = 0.65; O.frostAdd = 8; O.rainMul = 1.1; const rg = part(M, c, 2, i, p, shift, O) / M.f0g * pen * ny * 0.97; rev += gS * c.y * rg * c.price * pm; cost += gS * c.cost * ci; irr += gS * sc.irr; yi += gS * rg; D += gS * sc.D; }
  const tc = (field ? 0.06 * c.cost : 0.02 * F.h.cost) * Pp, treat = flex.ipm ? 0.55 * tc : tc;
  let ox = F.opex;
  let op = (aW ? ox.W : 0) + (aC ? ox.C : 0) + (aP ? ox.P : 0) + (aG ? ox.G : 0) + (flex.v ? ox.v : 0) + (flex.cal === 2 ? ox.cal : 0) + (flex.soil ? ox.soil : 0) + (flex.ipm ? ox.ipm : 0) + (flex.sens ? ox.sens : 0);
  /* Assicurazione parametrica: paga su siccità estiva, gelata tardiva o evento estremo */
  let pay = 0;
  if (flex.ins) { const dry = W.Ru[i] < 0.5 * W.z.R[2], fro = W.fr[i] > c.S0 + 5, ex = W.ext[i] === 1; pay = F.rev0 * ((dry ? 0.2 : 0) + (fro ? 0.2 : 0) + (ex ? 0.25 : 0)); op += M.premium; }
  let margin, em;
  const wcost = irr * 10 * F.water * W.wi[i] * F.fa;
  if (field) {
    margin = rev - cost - wcost - treat - op + pay;
    em = c.e0 * (flex.sens ? 0.97 : 1) + irr * 10 * 0.00015 + 0.1 * Pp * (flex.ipm ? 0.55 : 1) - (flex.soil ? 1.5 : 0) + (aS > 0 ? -0.2 * c.e0 * aS : 0);
    acc.lost = c.y * c.price * pm;
  } else {
    const h = F.h, cool = aP ? Math.max(F.cool0, 0.7) : F.cool0, coolE = Math.min(0.9, cool + (flex.sens ? 0.05 : 0));
    const dis = 0.06 * Pp * (flex.ipm ? 0.5 : 1);
    const prodF = Math.max(0.3, 1 - h.heat * O.hm * Math.max(-5, W.hot[i] - W.z.H) * (1 - coolE)) * (1 - dis + 0.027) * ny;
    const ffo = Math.min(1.3, yi), km = aW ? 0.5 : 1, k = km * 0.6 * Math.max(0, 1 - ffo);
    const feedX = h.feed * FP * (F.s * (1 - ffo) * (1 + k) + (1 - F.s) * k) * ci;
    margin = h.prod * h.price * prodF * pm - h.cost * ci - feedX - wcost - treat - op + pay;
    em = h.ent / Math.max(0.5, prodF) + F.fa * (c.e0 + irr * 10 * 0.00015 - (flex.soil ? 1.5 : 0));
    acc.hl = 1 - prodF / ny; acc.wl = Math.max(0, 1 - ffo) * F.s * 0.3; acc.lost = h.prod * h.price * pm; yi = prodF;
  }
  acc.irr = irr * 10 * F.fa; acc.em = em; acc.D = D; acc.yi = yi; acc.treat = treat + wcost; acc.pay = pay;
  return margin;
}
function resetState() { for (let k = 0; k < 3; k++) { st.store[k] = 80; st.som[k] = 1.6; st.sal[k] = 0.15; } }

/* Valore attuale netto di una strategia su una traiettoria. tim: anno di ingresso dei quattro investimenti (99 = mai). */
function runPath(M, flex, tim, p, det) {
  const W = M.W, F = M.farm, cap = F.capex;
  resetState();
  let npv = flex.v ? -cap.v : 0, wat = 0, em = 0; if (flex.sens) npv -= cap.sens;
  const big = W.cx[p] * W.fin[p];
  for (let t = 0; t < T; t++) {
    const df = M.df[t];
    if (t === tim[0]) npv -= cap.W * big * df; if (t === tim[1]) npv -= cap.C * W.fin[p] * df; if (t === tim[2]) npv -= cap.P * big * df; if (t === tim[3]) npv -= cap.G * W.fin[p] * df;
    const m = yearEval(M, flex, p, t, t >= tim[0], t >= tim[1], t >= tim[2], t >= tim[3], t - tim[1], null);
    npv += m * df; wat += acc.irr; em += acc.em;
    if (det) { const j = p * T + t; det.m[j] = m * F.units; det.y[j] = acc.yi; det.D[j] = acc.D; det.S[j] = acc.S;
      det.hl[j] = acc.hl * acc.lost; det.wl[j] = acc.wl * acc.lost; det.pl[j] = acc.pl * acc.lost; det.fl[j] = acc.fl * acc.lost; det.xl[j] = acc.xl * acc.lost; det.tr[j] = acc.treat; det.ir[j] = acc.irr; }
  }
  M.o_w = wat / T; M.o_e = em / T; M.o_som = st.som[0];
  return npv * F.units;
}

/* ---------- Costruzione del modello e fase 1: tutte le combinazioni statiche ---------- */
const NF = 96, NC = NF * 16;
function flexOf(f) { return { v: f & 1, cal: (f >> 1) % 3, soil: Math.floor(f / 6) & 1, ipm: Math.floor(f / 12) & 1, sens: Math.floor(f / 24) & 1, ins: Math.floor(f / 48) & 1 }; }
function flexIdx(x) { return (x.v ? 1 : 0) + 2 * (x.cal || 0) + 6 * (x.soil ? 1 : 0) + 12 * (x.ipm ? 1 : 0) + 24 * (x.sens ? 1 : 0) + 48 * (x.ins ? 1 : 0); }
const timOf = m => [m & 1 ? 0 : NEVER, m & 2 ? 0 : NEVER, m & 4 ? 0 : NEVER, m & 8 ? 0 : NEVER];
function capexOf(M, flex, mask) { const c = M.farm.capex, u = M.farm.units; return ((flex.v ? c.v : 0) + (flex.sens ? c.sens : 0) + (mask & 1 ? c.W * 1.1 : 0) + (mask & 2 ? c.C : 0) + (mask & 4 ? c.P * 1.1 : 0) + (mask & 8 ? c.G : 0)) * u; }
function biodiv(flex, mask) { const a = mask & 2 ? 0.35 : 0, H = a ? -(a * Math.log(a) + (1 - a) * Math.log(1 - a)) / Math.LN2 : 0; return Math.round(30 + 22 * H + (flex.soil ? 16 : 0) + (flex.ipm ? 14 : 0) + (flex.sens ? 4 : 0) - (mask & 4 ? 5 : 0) - (mask & 1 ? 3 : 0)); }

function build(P, progress) {
  const M = { P, W: buildWorld(P), farm: makeFarm(P), df: new Float64Array(T), capMul: { sabbioso: 0.7, medio: 1, argilloso: 1.25 }[P.suolo] || 1, slope: { pianura: 1, collina: 1.6, pendenza: 2.6 }[P.giacitura] || 1 };
  for (let t = 0; t < T; t++) M.df[t] = 1 / Math.pow(1 + DISC, t + 1);
  /* Resa di riferimento: clima normale di oggi, assetto attuale */
  const W = M.W, z = W.z, F = M.farm, n0 = { Tw: 0, Ts: 0, Tu: 0, Ta: 0, Rw: z.R[0], Rs: z.R[1], Ru: z.R[2], Ra: z.R[3], on: 0, fr: z.F, hot: z.H, av: 1, ext: 0, pp: 0 };
  const save = {}; for (const k in n0) { save[k] = W[k][0]; W[k][0] = n0[k]; }
  const sv = [W.st[0], W.kyM[0], W.heatM[0], W.pestM[0], W.somM[0]]; W.st[0] = 0; W.kyM[0] = 1; W.heatM[0] = 1; W.pestM[0] = 1; W.somM[0] = 1;
  const base = () => { O.hotMul = 1; O.frostAdd = 0; O.rainMul = 1; O.hm = 1; O.dm = 1; O.heatMul = 1; O.frostMul = 1; O.extMul = 1; O.boost = 0; O.eff = F.eff0; O.cover = false; O.ipmF = 1; };
  resetState(); base(); M.f0 = part(M, F.c, 0, 0, 0, 0, O); M.D0 = sc.D;
  resetState(); base(); M.f0a = part(M, F.alt, 1, 0, 0, 0, O);
  resetState(); base(); O.hotMul = 0.65; O.frostAdd = 8; O.rainMul = 1.1; M.f0g = part(M, F.c, 2, 0, 0, 0, O);
  for (const k in n0) W[k][0] = save[k]; W.st[0] = sv[0]; W.kyM[0] = sv[1]; W.heatM[0] = sv[2]; W.pestM[0] = sv[3]; W.somM[0] = sv[4];
  /* Premio assicurativo: 1,25 volte l'indennizzo atteso nei primi dieci anni */
  let pay = 0, cnt = 0; for (let p = 0; p < N; p++) for (let t = 0; t < 10; t++) { const i = p * T + t; pay += (W.Ru[i] < 0.5 * z.R[2] ? 0.2 : 0) + (W.fr[i] > F.c.S0 + 5 ? 0.2 : 0) + (W.ext[i] ? 0.25 : 0); cnt++; }
  M.premium = 1.25 * F.rev0 * pay / cnt;
  /* Fase 1: 96 combinazioni di leve annuali × 16 combinazioni di investimenti fatti subito o mai */
  M.npv = new Float32Array(NC * N); M.wat = new Float32Array(NC); M.em = new Float32Array(NC); M.cap = new Float32Array(NC); M.bio = new Float32Array(NC);
  for (let f = 0; f < NF; f++) {
    const flex = flexOf(f);
    for (let m = 0; m < 16; m++) {
      const c = f * 16 + m, tim = timOf(m); let w = 0, e = 0;
      for (let p = 0; p < N; p++) { M.npv[c * N + p] = runPath(M, flex, tim, p, null); w += M.o_w; e += M.o_e; }
      M.wat[c] = w / N * F.units; M.em[c] = e / N * F.units; M.cap[c] = capexOf(M, flex, m); M.bio[c] = biodiv(flex, m);
    }
    if (progress) progress((f + 1) / NF);
  }
  M.wts = new Float64Array(N).fill(1 / N); M.ess = N;
  /* Assetto attuale nel dettaglio: serve per indicatori osservabili e confronti */
  M.base = detail(M, flexOf(0), () => timOf(0));
  return M;
}
function detail(M, flex, timFn) {
  const d = {}; for (const k of ["m", "y", "D", "S", "hl", "wl", "pl", "fl", "xl", "tr", "ir"]) d[k] = new Float32Array(N * T);
  d.npv = new Float32Array(N); for (let p = 0; p < N; p++) d.npv[p] = runPath(M, flex, timFn(p), p, d);
  return d;
}
/* Riassunto anno per anno di un dettaglio, con i pesi correnti */
function yearly(M, d, sel) {
  const w = M.wts, out = [], col = new Float32Array(N), U = M.farm.units;
  for (let t = 0; t < T; t++) {
    const row = { anno: Y0 + 1 + t };
    for (let p = 0; p < N; p++) col[p] = d.m[p * T + t];
    let s = wstats(col, 0, w, sel, 0.1); row.p10 = s.p10; row.p50 = s.p50; row.p90 = s.p90; row.avg = s.mean;
    let loss = 0, sw = 0, y = 0, D = 0; const ids = sel || null, n = ids ? ids.length : N;
    for (let k = 0; k < n; k++) { const p = ids ? ids[k] : k, j = p * T + t; sw += w[p]; if (d.m[j] < 0) loss += w[p]; D += w[p] * d.D[j]; }
    for (let p = 0; p < N; p++) col[p] = d.y[p * T + t];
    s = wstats(col, 0, w, sel, 0.1); row.y10 = s.p10; row.y50 = s.p50; row.y90 = s.p90; row.loss = loss / sw; row.def = D / sw;
    out.push(row);
  }
  return out;
}

/* ---------- Selezione multi-obiettivo con robustezza e vincoli ---------- */
function select(M, prefs) {
  const w = M.wts, rho = prefs.rho || 0, bud = prefs.budget == null ? Infinity : prefs.budget, wcap = prefs.acquaMax == null ? Infinity : prefs.acquaMax * Math.max(1, M.wat[0]);
  const ow = prefs.pesi, pz = prefs.prezzi || {}, rob = new Float32Array(NC), cv = new Float32Array(NC), mean = new Float32Array(NC), feas = new Uint8Array(NC), val = new Float32Array(NC);
  let AF = 0; for (let t = 0; t < T; t++) AF += M.df[t];
  const sw = (ow[0] + ow[1]) || 1; let best = -1, bs = -Infinity, lo = Infinity, hi = -Infinity;
  for (let c = 0; c < NC; c++) {
    const s = wstats(M.npv, c * N, w, null, 0.1); mean[c] = s.mean; cv[c] = s.cvar; rob[c] = rho > 0 ? klWorst(M.npv, c * N, w, rho) : s.mean;
    feas[c] = M.cap[c] <= bud + 1 && M.wat[c] <= wcap + 1 ? 1 : 0;
    /* Valore in euro: profitto robusto e casi peggiori, più acqua, emissioni e biodiversità al prezzo che l'utente dà loro */
    val[c] = (ow[0] * rob[c] + ow[1] * cv[c]) / sw + AF * ((pz.bio || 0) * M.bio[c] - (pz.acqua || 0) * M.wat[c] - (pz.co2 || 0) * M.em[c]);
    if (feas[c]) { if (val[c] > bs) { bs = val[c]; best = c; } if (val[c] < lo) lo = val[c]; if (val[c] > hi) hi = val[c]; }
  }
  if (best < 0) { best = 0; feas[0] = 1; lo = hi = val[0]; }
  const score = new Float32Array(NC); for (let c = 0; c < NC; c++) score[c] = feas[c] && hi > lo ? (val[c] - lo) / (hi - lo) : 0;
  return { best, score, rob, cv, mean, feas, val };
}
function pareto(M, S) {
  const ids = []; for (let c = 0; c < NC; c++) if (S.feas[c]) ids.push(c);
  const V = c => [S.mean[c], S.cv[c], -M.wat[c], M.bio[c], -M.em[c]], vals = ids.map(V), front = [];
  for (let a = 0; a < ids.length; a++) { let dom = false; const va = vals[a];
    for (let b = 0; b < ids.length && !dom; b++) { if (a === b) continue; const vb = vals[b]; let ge = true, gt = false;
      for (let k = 0; k < 5; k++) { if (vb[k] < va[k] - 1e-9) { ge = false; break; } if (vb[k] > va[k] + 1e-9) gt = true; } if (ge && gt) dom = true; }
    if (!dom) front.push(ids[a]); }
  return front;
}

/* ---------- Programmazione stocastica a più stadi: albero di scenari e induzione a ritroso ---------- */
function tree(M, flex, prefs) {
  const W = M.W, F = M.farm, w = M.wts, field = F.field, bd = M.base;
  /* Indicatori osservabili (con errore di misura): quello che l'azienda vede davvero nel 2031 e nel 2036 */
  const sig = (flex.sens ? 0.5 : 1) * (field ? 0.03 : 4), z1 = new Float64Array(N), z2 = new Float64Array(N);
  for (let p = 0; p < N; p++) { let a = 0, b = 0;
    for (let t = 0; t < 4; t++) a += (field ? bd.D[p * T + t] : W.hot[p * T + t]) + sig * W.o1[p * T + t];
    for (let t = 4; t < 9; t++) b += (field ? bd.D[p * T + t] : W.hot[p * T + t]) + sig * W.o2[p * T + t];
    z1[p] = a / 4; z2[p] = b / 5; }
  const cut = (z, ids, qs) => { const o = ids.slice().sort((a, b) => z[a] - z[b]); let sw = 0; for (const p of o) sw += w[p]; const out = []; let ac = 0, qi = 0;
    for (const p of o) { ac += w[p]; while (qi < qs.length && ac >= qs[qi] * sw) { out.push(z[p]); qi++; } } while (out.length < qs.length) out.push(z[o[o.length - 1]]); return out; };
  const all = Array.from({ length: N }, (_, i) => i), c1 = cut(z1, all, [1 / 3, 2 / 3]);
  const nodes = [[], [], []]; for (const p of all) nodes[z1[p] <= c1[0] ? 0 : z1[p] <= c1[1] ? 1 : 2].push(p);
  const leaves = [], leafOf = new Uint8Array(N), c2 = [];
  nodes.forEach((ids, n) => { const m = ids.length ? cut(z2, ids, [0.5])[0] : 0; c2.push(m); const a = [], b = []; for (const p of ids) (z2[p] <= m ? a : b).push(p); leaves.push(a, b); for (const p of a) leafOf[p] = 2 * n; for (const p of b) leafOf[p] = 2 * n + 1; });
  /* Valore di ogni combinazione di tempi (ora, 2031, 2036, mai) su ogni traiettoria */
  const V = new Float32Array(256 * N), code = [0, 4, 9, NEVER];
  for (let q = 0; q < 256; q++) { const tim = [code[q & 3], code[(q >> 2) & 3], code[(q >> 4) & 3], code[(q >> 6) & 3]]; for (let p = 0; p < N; p++) V[q * N + p] = runPath(M, flex, tim, p, null); }
  const lam = prefs.pesi[1] / ((prefs.pesi[0] + prefs.pesi[1]) || 1);
  const pw = ids => { let s = 0; for (const p of ids) s += w[p]; return s; }, lw = leaves.map(pw), tot = lw.reduce((a, b) => a + b, 0);
  const scL = leaves.map(ids => { const a = new Float64Array(256); if (!ids.length) return a; for (let q = 0; q < 256; q++) { const s = wstats(V, q * N, w, ids, 0.2); a[q] = (1 - lam) * s.mean + lam * s.cvar; } return a; });
  const cap = F.capex, cc = [cap.W * 1.1, cap.C, cap.P * 1.1, cap.G].map(x => x * F.units), bud = prefs.budget == null ? Infinity : prefs.budget - ((flex.v ? cap.v : 0) + (flex.sens ? cap.sens : 0)) * F.units;
  const cost = m => (m & 1 ? cc[0] : 0) + (m & 2 ? cc[1] : 0) + (m & 4 ? cc[2] : 0) + (m & 8 ? cc[3] : 0);
  const q3 = (a1, a2, a3) => { let q = 0; for (let k = 0; k < 4; k++) { const b = 1 << k; q |= (a1 & b ? 0 : a2 & b ? 1 : a3 & b ? 2 : 3) << (2 * k); } return q; };
  /* Risolve l'albero. allow(a1): vincolo sul primo stadio; never: maschera di investimenti esclusi; fixed: nessuna flessibilità */
  function solve(allow, never, fixed) {
    let bestV = -Infinity, pol = null;
    for (let a1 = 0; a1 < 16; a1++) {
      if (a1 & never || cost(a1) > bud + 1 || (allow && !allow(a1))) continue;
      let val = 0; const nd = [];
      for (let n = 0; n < 3; n++) {
        let bv = -Infinity, ba2 = a1, bl = null;
        for (let a2 = 0; a2 < 16; a2++) {
          if ((a2 & a1) !== a1 || a2 & never || cost(a2) > bud + 1 || (fixed && a2 !== a1)) continue;
          let v = 0; const la = [];
          for (let j = 0; j < 2; j++) { const L = 2 * n + j; let b3 = -Infinity, ba3 = a2;
            for (let a3 = 0; a3 < 16; a3++) { if ((a3 & a2) !== a2 || a3 & never || cost(a3) > bud + 1 || (fixed && a3 !== a2)) continue; const s = scL[L][q3(a1, a2, a3)]; if (s > b3) { b3 = s; ba3 = a3; } }
            v += lw[L] * b3; la.push(ba3); }
          if (v > bv) { bv = v; ba2 = a2; bl = la; }
        }
        val += bv; nd.push({ a2: ba2, a3: bl });
      }
      val /= tot; if (val > bestV) { bestV = val; pol = { a1, nd }; }
    }
    return { value: bestV, pol };
  }
  const free = solve(null, 0, false), now = solve(null, 0, true);
  const tq = new Uint8Array(N); for (let p = 0; p < N; p++) { const L = leafOf[p], n = L >> 1; tq[p] = q3(free.pol.a1, free.pol.nd[n].a2, free.pol.nd[n].a3[L & 1]); }
  /* Opzioni reali: quanto vale poter aspettare, per ogni investimento */
  const opts = INV.map((id, k) => { const b = 1 << k; const inNow = solve(a => !!(a & b), 0, false).value, wait = solve(a => !(a & b), 0, false).value, nev = solve(null, b, false).value;
    let pr = 0, when = free.pol.a1 & b ? "ora" : null; if (!when) for (let L = 0; L < 6; L++) { const n = L >> 1; if (free.pol.nd[n].a3[L & 1] & b) pr += lw[L] / tot; }
    return { id, ora: inNow, attesa: wait, mai: nev, valoreAttesa: wait - inNow, valoreOpzione: free.value - nev, quando: when || (pr > 0.01 ? "condizionale" : "mai"), prob: when ? 1 : pr, costo: cc[k] }; });
  return { z1, z2, c1, c2, nodes, leaves, lw: lw.map(x => x / tot), free, now, V, tq, opts, cc, lam,
    timOfPath: p => { const q = tq[p]; return [code[q & 3], code[(q >> 2) & 3], code[(q >> 4) & 3], code[(q >> 6) & 3]]; } };
}

/* ---------- Gruppi di incertezza: valore dell'informazione e da cosa dipende il risultato ---------- */
function groups(M) {
  const W = M.W, ter = f => { const v = Array.from({ length: N }, (_, p) => f(p)), o = v.slice().sort((a, b) => a - b), a = o[Math.floor(N / 3)], b = o[Math.floor(2 * N / 3)]; return v.map(x => x <= a ? 0 : x <= b ? 1 : 2); };
  const mp = k => p => { let s = 0; for (let t = 0; t < T; t++) s += W[k][p * T + t]; return s / T; };
  return [
    { id: "clima_scenario", inc: "Climatica", name: "Traiettoria delle emissioni", g: Array.from(W.sc), riducibile: false },
    { id: "clima_modello", inc: "Climatica", name: "Differenze tra modelli climatici", g: Array.from(W.cm), riducibile: false },
    { id: "struttura", inc: "Strutturale", name: "Forma della risposta della coltura", g: Array.from(W.st), riducibile: false },
    { id: "agro", inc: "Agronomica", name: "Sensibilità a caldo e stress idrico", g: ter(p => W.kyM[p] * W.heatM[p]), riducibile: true, misura: "Prova di risposta a caldo e stress idrico sui tuoi dati di resa", costo: 1500 },
    { id: "cultivar", inc: "Agronomica", name: "Riuscita delle varietà tolleranti", g: ter(p => W.cultU[p]), riducibile: true, misura: "Parcella di prova con varietà tolleranti per due stagioni", costo: 2500 },
    { id: "suolo", inc: "Agronomica", name: "Tenuta della sostanza organica", g: ter(p => W.somM[p]), riducibile: true, misura: "Analisi del suolo e della ritenzione idrica", costo: 400 },
    { id: "acqua", inc: "Climatica", name: "Acqua disponibile nel bacino", g: ter(mp("av")), riducibile: true, misura: "Studio sulla disponibilità d'acqua del consorzio o del bacino", costo: 4000 },
    { id: "prezzi", inc: "Economica", name: "Andamento dei prezzi di vendita", g: ter(mp("pm")), riducibile: false },
    { id: "finanza", inc: "Economica", name: "Costo del denaro", g: ter(p => W.rate[p]), riducibile: true, misura: "Preventivo vincolante di finanziamento", costo: 0 }
  ];
}
function voi(M, S) {
  const w = M.wts, ids = []; for (let c = 0; c < NC; c++) if (S.feas[c]) ids.push(c);
  let base = -Infinity; for (const c of ids) if (S.mean[c] > base) base = S.mean[c];
  let pi = 0; for (let p = 0; p < N; p++) { let mx = -Infinity; for (const c of ids) { const v = M.npv[c * N + p]; if (v > mx) mx = v; } pi += w[p] * mx; }
  const out = { evpi: Math.max(0, pi - base), voci: [] };
  for (const gdef of groups(M)) {
    const ng = Math.max(...gdef.g) + 1, gw = new Float64Array(ng); for (let p = 0; p < N; p++) gw[gdef.g[p]] += w[p];
    let tot = 0;
    for (let k = 0; k < ng; k++) { if (!(gw[k] > 0)) continue; let mx = -Infinity; for (const c of ids) { let s = 0; const o = c * N; for (let p = 0; p < N; p++) if (gdef.g[p] === k) s += w[p] * M.npv[o + p]; if (s > mx) mx = s; } tot += mx; }
    const ev = Math.max(0, tot - base);
    out.voci.push({ id: gdef.id, inc: gdef.inc, nome: gdef.name, riducibile: gdef.riducibile, misura: gdef.misura || null, costo: gdef.costo == null ? null : gdef.costo, valoreMassimo: ev, valoreStimato: gdef.riducibile ? 0.7 * ev : null });
  }
  return out;
}
function drivers(M, vals) {
  const w = M.wts; let m = 0; for (let p = 0; p < N; p++) m += w[p] * vals[p]; let va = 0; for (let p = 0; p < N; p++) va += w[p] * (vals[p] - m) * (vals[p] - m);
  const res = []; let sum = 0;
  for (const gdef of groups(M)) { const ng = Math.max(...gdef.g) + 1, gs = new Float64Array(ng), gw = new Float64Array(ng); for (let p = 0; p < N; p++) { gs[gdef.g[p]] += w[p] * vals[p]; gw[gdef.g[p]] += w[p]; }
    let b = 0; for (let k = 0; k < ng; k++) if (gw[k] > 0) { const d = gs[k] / gw[k] - m; b += gw[k] * d * d; } const sh = va > 0 ? b / va : 0; sum += sh; res.push({ id: gdef.id, inc: gdef.inc, nome: gdef.name, quota: sh }); }
  res.push({ id: "naturale", inc: "Climatica", nome: "Variabilità naturale di anno in anno e interazioni", quota: Math.max(0, 1 - sum) });
  return res.sort((a, b) => b.quota - a.quota);
}

/* ---------- Aggiornamento con le osservazioni (controllo predittivo): ripesa le traiettorie e si riottimizza ---------- */
function observe(M, recs) {
  const W = M.W, w = M.wts, bd = M.base; w.fill(1 / N);
  const sens = false;
  for (const r of recs || []) { const t = r.anno - Y0 - 1; if (!(t >= 0 && t < T)) continue;
    for (let p = 0; p < N; p++) { const i = p * T + t; let ll = 0;
      if (r.tw != null) { const d = (W.Tw[i] - r.tw) / (sens ? 0.3 : 0.5); ll -= 0.5 * d * d; }
      if (r.onset != null) { const d = (W.on[i] - r.onset) / (sens ? 3 : 5); ll -= 0.5 * d * d; }
      if (r.pioggia != null) { const z = W.z, d = ((W.Rw[i] + W.Rs[i] + W.Ru[i] + W.Ra[i]) / (z.R[0] + z.R[1] + z.R[2] + z.R[3]) - 1 - r.pioggia / 100) / 0.12; ll -= 0.5 * d * d; }
      if (r.resa != null) { const d = (bd.y[i] - 1 - r.resa / 100) / 0.1; ll -= 0.5 * d * d; }
      w[p] *= Math.exp(ll); } }
  let s = 0, s2 = 0; for (let p = 0; p < N; p++) s += w[p];
  if (!(s > 1e-280)) { w.fill(1 / N); M.ess = 0; return; }
  for (let p = 0; p < N; p++) { w[p] /= s; s2 += w[p] * w[p]; } M.ess = 1 / s2;
}

/* ---------- Previsione stagionale e data di semina per quest'anno ---------- */
function season(M, obs, flex, mask) {
  const W = M.W, F = M.farm, z = W.z, c = F.c, w = new Float64Array(N), t = 0;
  let sg = 0.35, ess = 0;
  for (let k = 0; k < 4 && ess < 25; k++, sg *= 1.6) { let s = 0, s2 = 0;
    for (let p = 0; p < N; p++) { let ll = 0; if (obs && obs.tw != null) { const d = (W.Tw[p * T] - obs.tw) / sg; ll -= 0.5 * d * d; } if (obs && obs.pioggia != null) { const d = (W.Rw[p * T] / z.R[0] - 1 - obs.pioggia / 100) / (sg * 0.6); ll -= 0.5 * d * d; } w[p] = M.wts[p] * Math.exp(ll); s += w[p]; }
    for (let p = 0; p < N; p++) { w[p] /= s; s2 += w[p] * w[p]; } ess = 1 / s2; }
  const col = new Float32Array(N), q = k => { for (let p = 0; p < N; p++) col[p] = W[k][p * T]; const s = wstats(col, 0, w, null, 0.1); return { m: s.mean, p10: s.p10, p90: s.p90 }; };
  const pr = (k, f) => { let s = 0; for (let p = 0; p < N; p++) if (f(W[k][p * T])) s += w[p]; return s; };
  const res = { anno: Y0 + 1, tipo: c.kind, fase: c.stage, normale: c.S0, pioggiaNormale: z.R.slice(), inizioNormale: z.Od, gelataNormale: z.F, campione: ess,
    inizio: q("on"), gelata: q("fr"), caldo: q("hot"), acqua: q("av"), caldoNormale: z.H,
    stagioni: [["Inverno", "Tw", "Rw", 0], ["Primavera", "Ts", "Rs", 1], ["Estate", "Tu", "Ru", 2], ["Autunno", "Ta", "Ra", 3]].map(a => ({ nome: a[0], temp: q(a[1]).m, pCaldo: pr(a[1], v => v > 0.4), pioggia: q(a[2]).m / z.R[a[3]] - 1, pSecco: pr(a[2], v => v < 0.8 * z.R[a[3]]) })) };
  const lo = c.kind === "spring" ? -28 : -10, hi = c.kind === "spring" ? 14 : 10, step = 2, fx = Object.assign({}, flex), mk = mask || 0;
  const aW = !!(mk & 1), aC = !!(mk & 2), aP = !!(mk & 4), aG = !!(mk & 8); res.curva = [];
  let best = null, usual = null;
  for (let sh = lo; sh <= hi; sh += step) {
    let fp = 0; for (let p = 0; p < N; p++) { resetState(); col[p] = yearEval(M, fx, p, t, aW, aC, aP, aG, 5, sh) * F.units; if (acc.fr > 0.001) fp += w[p]; }
    const s = wstats(col, 0, w, null, 0.1), row = { spost: sh, giorno: Math.round(c.S0 + (c.kind === "tree" ? res.inizio.m : c.kind === "winter" ? 0.7 * res.inizio.m : 0) + sh), medio: s.mean, p10: s.p10, pGelo: fp, punteggio: 0.7 * s.mean + 0.3 * s.cvar };
    res.curva.push(row); if (!best || row.punteggio > best.punteggio) best = row; if (sh === 0) usual = row;
  }
  res.migliore = best; res.abituale = usual; res.finestra = { prima: -lo, dopo: hi, passo: step }; res.guadagno = best.medio - usual.medio;
  res.raccolta = Math.round(best.spost + (c.kind === "spring" ? 0 : (c.kind === "tree" ? 1 : 0.7) * res.inizio.m) - 0.03 * res.stagioni[1].temp * c.L - 2 * res.stagioni[2].temp);
  return res;
}

/* ---------- Prove di stress ---------- */
const SHOCKS = [
  { id: "prezzi", nome: "Prezzi di vendita più bassi del 25% dal terzo anno", s: { price: 0.75, avail: 1, cost: 1 } },
  { id: "acqua", nome: "Acqua irrigua ridotta del 30%", s: { price: 1, avail: 0.7, cost: 1 } },
  { id: "costi", nome: "Costi di produzione più alti del 25%", s: { price: 1, avail: 1, cost: 1.25 } },
  { id: "siccita", nome: "Tre anni consecutivi di siccità (2029-2031)", s: { price: 1, avail: 0.85, cost: 1, dry: t => t >= 2 && t <= 4 } }
];
function stress(M, flex, timFn) {
  const w = M.wts, out = [], v = new Float32Array(N), b = new Float32Array(N), f0 = flexOf(0), t0 = timOf(0);
  for (const sh of SHOCKS) { SHOCK = sh.s; for (let p = 0; p < N; p++) { v[p] = runPath(M, flex, timFn(p), p, null); b[p] = runPath(M, f0, t0, p, null); } SHOCK = null;
    const a = wstats(v, 0, w, null, 0.1), c = wstats(b, 0, w, null, 0.1); let win = 0; for (let p = 0; p < N; p++) if (v[p] > b[p]) win += w[p];
    out.push({ id: sh.id, nome: sh.nome, piano: a.mean, pianoPeggiori: a.cvar, attuale: c.mean, attualePeggiori: c.cvar, vince: win }); }
  return out;
}

/* ---------- Soluzione completa: quello che la pagina mostra ---------- */
function describe(M, flex, mask) { const L = LEVERS(M.P.tipo), a = []; for (const k of FLEX) if (flex[k]) a.push(k === "cal" ? L.cal.name + ": " + L.cal.opts[flex.cal].toLowerCase() : L[k].name); INV.forEach((k, i) => { if (mask & (1 << i)) a.push(L[k].name); }); return a; }
function summary(M, S, c) { const s = wstats(M.npv, c * N, M.wts, null, 0.1); let win = 0; for (let p = 0; p < N; p++) if (M.npv[c * N + p] > M.npv[p]) win += M.wts[p];
  return { id: c, leve: flexOf(Math.floor(c / 16)), invest: c % 16, medio: s.mean, peggiori: s.cvar, p10: s.p10, p50: s.p50, p90: s.p90, robusto: S.rob[c], acqua: M.wat[c], biodiversita: M.bio[c], emissioni: M.em[c], investimento: M.cap[c], batteAttuale: win, valore: S.val[c], punteggio: S.score[c], ammessa: !!S.feas[c] }; }

function solve(M, prefs) {
  const w = M.wts, W = M.W, F = M.farm, t0 = Date.now();
  const S = select(M, prefs), best = S.best, bf = flexOf(Math.floor(best / 16)), bm = best % 16;
  const R = { versione: VERSION, anno0: Y0, anni: T, traiettorie: N, seme: M.P.seed || 2026, sconto: DISC, campioneEfficace: M.ess, campo: F.field, unita: F.units,
    scenari: SCEN.map(s => ({ nome: s.name, codice: s.code, peso: s.w })), modelli: CMOD.map(m => m.name), strutture: STRUCT.map(s => s.name) };
  /* Previsione: clima stagionale per anno, tutti gli scenari e per scenario */
  const col = new Float32Array(N), clim = sel => { const out = []; for (let t = 0; t < T; t++) { const row = { anno: Y0 + 1 + t };
    for (const k of ["Tw", "Ts", "Tu", "Ta", "on", "fr", "hot", "av", "Rs", "Ru"]) { for (let p = 0; p < N; p++) col[p] = W[k][p * T + t]; const s = wstats(col, 0, w, sel, 0.1); row[k] = [s.p10, s.mean, s.p90]; } out.push(row); } return out; };
  const selS = [0, 1, 2].map(s => { const a = []; for (let p = 0; p < N; p++) if (W.sc[p] === s) a.push(p); return a; });
  R.clima = { tutti: clim(null), scenari: selS.map(clim) }; R.normali = { daDati: !!W.z.dati, ipotesiEstate: SCEN.map(s => s.dT * SEAS_T[2] * 10), inizio: W.z.Od, gelata: W.z.F, caldo: W.z.H, pioggia: W.z.R, fase: F.c.S0, nomeFase: F.c.stage, tipo: F.c.kind };
  R.attuale = { anni: yearly(M, M.base, null), perScenario: selS.map(s => yearly(M, M.base, s)), sintesi: summary(M, S, 0) };
  R.oggi = { deficit: M.D0, ricavo: F.rev0 * F.units };
  /* Ottimizzazione multi-obiettivo */
  R.scelta = summary(M, S, best); R.scelta.descrizione = describe(M, bf, bm);
  const nomS = select(M, Object.assign({}, prefs, { rho: 0 }));
  R.nominale = summary(M, nomS, nomS.best); R.nominale.descrizione = describe(M, flexOf(Math.floor(nomS.best / 16)), nomS.best % 16);
  const fr = pareto(M, S); R.pareto = fr.map(c => { const s = summary(M, S, c); return { id: c, medio: s.medio, peggiori: s.peggiori, acqua: s.acqua, bio: s.biodiversita, em: s.emissioni, inv: s.investimento, p: s.punteggio }; });
  const samp = []; for (let c = 0; c < NC; c += 7) if (S.feas[c]) samp.push({ id: c, medio: S.mean[c], peggiori: S.cv[c], acqua: M.wat[c], bio: M.bio[c], em: M.em[c], inv: M.cap[c], p: S.score[c] }); R.nuvola = samp;
  R.riferimenti = [0, NC - 1 - 15 * 0, flexIdx({ v: 1, cal: 2, soil: 0, ipm: 0, sens: 0, ins: 0 }) * 16].map(c => { const s = summary(M, S, c); s.descrizione = describe(M, s.leve, s.invest); return s; });
  /* Percorso a più stadi e opzioni reali */
  const tr = tree(M, bf, prefs), L = LEVERS(M.P.tipo), names = m => INV.filter((k, i) => m & (1 << i));
  const pol = tr.free.pol, dnpv = new Float32Array(N); const det = detail(M, bf, tr.timOfPath); for (let p = 0; p < N; p++) dnpv[p] = det.npv[p];
  const ps = wstats(dnpv, 0, w, null, 0.1); let win = 0; for (let p = 0; p < N; p++) if (dnpv[p] > M.base.npv[p]) win += w[p];
  const rng2 = (z, ids) => { let a = Infinity, b = -Infinity; for (const p of ids) { if (z[p] < a) a = z[p]; if (z[p] > b) b = z[p]; } return [a, b]; };
  R.percorso = { leve: bf, indicatore: F.field ? "Deficit idrico medio osservato" : "Giorni sopra 32 °C osservati in media", unitaIndicatore: F.field ? "%" : "giorni",
    ora: names(pol.a1), soglie2031: tr.c1, nodi: pol.nd.map((n, i) => ({ nome: ["Anni favorevoli", "Anni nella media", "Anni duri"][i], prob: tr.lw[2 * i] + tr.lw[2 * i + 1], aggiungi: names(n.a2 & ~pol.a1), soglia2036: tr.c2[i],
      rami: [0, 1].map(j => ({ nome: j ? "Poi peggiora" : "Poi migliora", prob: tr.lw[2 * i + j], aggiungi: names(n.a3[j] & ~n.a2) })) })),
    valore: tr.free.value, valoreDecidiOggi: tr.now.value, valoreFlessibilita: tr.free.value - tr.now.value, pianoOggi: names(tr.now.pol.a1),
    sintesi: { medio: ps.mean, peggiori: ps.cvar, p10: ps.p10, p50: ps.p50, p90: ps.p90, batteAttuale: win }, anni: yearly(M, det, null), perScenario: selS.map(s => yearly(M, det, s)) };
  R.opzioni = tr.opts.map(o => Object.assign(o, { nome: L[o.id].name, rev: L[o.id].rev }));
  /* Spiegazione: contributo di ogni leva, cause del risultato, prezzi ombra */
  const tog = []; for (const k of FLEX) { const alt = Object.assign({}, bf); if (k === "cal") { for (const v of [0, 1, 2]) if (v !== bf.cal) { alt.cal = v; const c = flexIdx(alt) * 16 + bm; tog.push({ leva: "cal", nome: L.cal.name + ": " + L.cal.opts[v].toLowerCase(), attiva: false, dMedio: S.mean[c] - S.mean[best], dPeggiori: S.cv[c] - S.cv[best], dValore: S.val[c] - S.val[best], ammessa: !!S.feas[c] }); } continue; }
    alt[k] = bf[k] ? 0 : 1; const c = flexIdx(alt) * 16 + bm; tog.push({ leva: k, nome: L[k].name, attiva: !!bf[k], dMedio: S.mean[c] - S.mean[best], dPeggiori: S.cv[c] - S.cv[best], dValore: S.val[c] - S.val[best], ammessa: !!S.feas[c] }); }
  INV.forEach((k, i) => { const c = Math.floor(best / 16) * 16 + (bm ^ (1 << i)); tog.push({ leva: k, nome: L[k].name, attiva: !!(bm & (1 << i)), dMedio: S.mean[c] - S.mean[best], dPeggiori: S.cv[c] - S.cv[best], dValore: S.val[c] - S.val[best], ammessa: !!S.feas[c] }); });
  const sh = (key, mul) => { if (prefs[key] == null) return null; const p2 = Object.assign({}, prefs); p2[key] = prefs[key] * mul; const s2 = select(M, p2); return { delta: S2mean(s2) - S.mean[best], cambia: s2.best !== best }; function S2mean(x) { return x.mean[x.best]; } };
  R.spiegazione = { leve: tog, cause: drivers(M, dnpv), ombra: { budget: sh("budget", 1.2), acqua: sh("acquaMax", 1.2) }, vincoli: { budget: prefs.budget == null ? null : { limite: prefs.budget, usato: M.cap[best] }, acqua: prefs.acquaMax == null ? null : { limite: prefs.acquaMax * Math.max(1, M.wat[0]), usato: M.wat[best] } } };
  /* Sprechi e spese: dove si perdono soldi nei primi dieci anni, oggi e con il piano */
  const waste = d => { const o = {}; for (const k of ["hl", "wl", "pl", "fl", "xl", "tr"]) { let s = 0; for (let p = 0; p < N; p++) { let a = 0; for (let t = 0; t < 10; t++) a += d[k][p * T + t]; s += w[p] * a / 10; } o[k] = s * F.units; } return o; };
  R.sprechi = { attuale: waste(M.base), piano: waste(det) };
  /* Robustezza: scelta al variare della fiducia nel modello, rimpianto per gruppo, prove di stress */
  R.robustezza = { raggio: prefs.rho || 0, livelli: [0, 0.05, 0.15, 0.4].map(r => { const s = select(M, Object.assign({}, prefs, { rho: r })); return { raggio: r, id: s.best, descrizione: describe(M, flexOf(Math.floor(s.best / 16)), s.best % 16), valoreCasoPeggiore: s.rob[s.best], stessa: s.best === best }; }), rimpianto: [] };
  for (const gdef of groups(M).slice(0, 3)) { const ng = Math.max(...gdef.g) + 1, labels = gdef.id === "clima_scenario" ? SCEN.map(s => s.name) : gdef.id === "clima_modello" ? CMOD.map(m => m.name) : STRUCT.map(s => s.name);
    for (let k = 0; k < ng; k++) { let gw = 0, mine = 0, cur = 0; for (let p = 0; p < N; p++) if (gdef.g[p] === k) { gw += w[p]; mine += w[p] * M.npv[best * N + p]; cur += w[p] * M.npv[p]; }
      if (!(gw > 0)) continue; let mx = -Infinity; for (let c = 0; c < NC; c++) { if (!S.feas[c]) continue; let s = 0; const o = c * N; for (let p = 0; p < N; p++) if (gdef.g[p] === k) s += w[p] * M.npv[o + p]; if (s > mx) mx = s; }
      R.robustezza.rimpianto.push({ gruppo: gdef.name, caso: labels[k], peso: gw, piano: mine / gw, attuale: cur / gw, migliorePossibile: mx / gw, rimpianto: (mx - mine) / gw }); } }
  R.robustezza.stress = stress(M, bf, tr.timOfPath);
  R.informazione = voi(M, S);
  R.territorio = { quotaAcquaBacino: (R.spiegazione.cause.find(c => c.id === "acqua") || { quota: 0 }).quota };
  R.tempoCalcolo = Date.now() - t0;
  return R;
}
/* Simulazione manuale: una combinazione scelta dall'utente tra quelle già calcolate */
function simulate(M, prefs, flex, mask) { const S = select(M, prefs), c = flexIdx(flex) * 16 + mask, s = summary(M, S, c); s.descrizione = describe(M, flex, mask);
  const d = detail(M, flex, () => timOf(mask)); s.anni = yearly(M, d, null); s.attuale = summary(M, S, 0); return s; }

const API = { siteZone, VERSION, Y0, T, N, ZONES, SCEN, CMOD, STRUCT, CROPS, HERDS, FORAGE, LEVERS, DOMAINS, FLEX, INV, build, solve, select, season, observe, simulate, flexOf, flexIdx, klWorst, wstats };
if (typeof module !== "undefined" && module.exports) module.exports = API;
else if (typeof importScripts === "function") {
  let M = null;
  G.onmessage = ev => { const d = ev.data;
    try {
      if (d.cmd === "init") { M = build(d.P, f => G.postMessage({ id: d.id, progress: f })); observe(M, d.P.osservazioni); G.postMessage({ id: d.id, ok: true, result: { pronto: true } }); }
      else if (!M) G.postMessage({ id: d.id, ok: false, error: "Modello non inizializzato" });
      else if (d.cmd === "solve") { observe(M, d.oss); G.postMessage({ id: d.id, ok: true, result: solve(M, d.prefs) }); }
      else if (d.cmd === "season") G.postMessage({ id: d.id, ok: true, result: season(M, d.obs, d.flex, d.mask) });
      else if (d.cmd === "sim") G.postMessage({ id: d.id, ok: true, result: simulate(M, d.prefs, d.flex, d.mask) });
    } catch (e) { G.postMessage({ id: d.id, ok: false, error: String(e && e.stack || e) }); }
  };
} else G.AgroModel = API;
})(typeof self !== "undefined" ? self : globalThis);
