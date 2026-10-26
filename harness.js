#!/usr/bin/env node
// Päikesepaneelide kalkulaatori testharness.
//
//   node test/harness.js            (repo juurkaustast; loeb index.html)
//   node test/harness.js path/to/index.html
//
// Käivitab kalkulaatori tegeliku <script> sisu minimaalse DOM-i jäljendis ja:
//   1. jooksutab calculate() vaikeseadetel ja kontrollib tulemused NaN/Infinity vastu
//   2. kõik lülitite kombinatsioonid
//   3. iga liugur min ja max asendis
//   4. iga rippmenüü iga valik (koos change-käsitlejatega)
//   5. ebameeldivad kombinatsioonid (null-tarbimine, pisike peakaitse + suur aku jne)
//   6. ENERGIABILANSID: tootmine, tarbimine ja aku sisend/väljund peavad klappima
//      iga kuu ja päevatüübi kohta (püsiseisund), ning aasta sääst peab täpselt
//      võrduma sõltumatu tunnipõhise ümberarvutusega
//   7. ajamõõtmine
// Lõpeb veakoodiga 1, kui midagi ebaõnnestub — sobib CI-sse.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = process.argv[2] || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');

// ---------- form defaults straight from the markup ----------
const defaults = {};
for (const m of html.matchAll(/<input[^>]*\bid="([^"]+)"[^>]*>/g)){
  const tag = m[0], id = m[1];
  const v = tag.match(/\bvalue="([^"]*)"/), t = tag.match(/\btype="([^"]*)"/);
  const d = { type: t ? t[1] : 'text', value: v ? v[1] : '' };
  if (d.type === 'checkbox') d.checked = /\bchecked\b/.test(tag);
  if (d.type === 'range'){ d.min = tag.match(/\bmin="([^"]+)"/)[1]; d.max = tag.match(/\bmax="([^"]+)"/)[1]; }
  defaults[id] = d;
}
for (const m of html.matchAll(/<select[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)){
  const id = m[1], opts = [...m[2].matchAll(/<option([^>]*)>/g)].map(o => o[1]);
  const vals = opts.map(o => o.match(/value="([^"]*)"/)[1]);
  const sel = opts.filter(o => /\bselected\b/.test(o)).map(o => o.match(/value="([^"]*)"/)[1]);
  defaults[id] = { type: 'select', value: sel[0] !== undefined ? sel[0] : vals[0], options: vals };
}
const allIds = [...new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]))];

// ---------- DOM + Chart shim ----------
const elements = {};
function makeEl(id){
  const d = defaults[id] || { type: 'div', value: '' };
  return { id, value: d.value, checked: !!d.checked, textContent: '', innerHTML: '', className: '', style: {},
    type: d.type, max: d.max, min: d.min, _listeners: {},
    addEventListener(ev, fn){ (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    getContext(){ return {}; } };
}
allIds.forEach(id => elements[id] = makeEl(id));
const charts = [];
class Chart { constructor(ctx, cfg){ this.config = cfg; this.data = cfg.data; charts.push(this); } update(){} }
const document = { getElementById(id){ if (!elements[id]) elements[id] = makeEl(id); return elements[id]; } };
const script = html.match(/<script>([\s\S]*)<\/script>/)[1]
  + '\n;globalThis.__X={getHourlyProfile,orientationFactor,simulateRepresentativeDay,simulateMonthPair,getScaledPrices,irrOf,MID_MONTH_DOY,MONTHLY_CONSUMPTION_SHARE,WEEKDAY_FRACTION,HOURLY_SHAPE_WEEKDAY,HOURLY_SHAPE_WEEKEND,PRICE_SHAPE_WEEKDAY,PRICE_SHAPE_WEEKEND,ISDAY_WEEKDAY,ISDAY_WEEKEND};';
const ctx = vm.createContext({ document, window: { addEventListener(){} }, Chart, console, Math, Array, Object, Number, Intl, Date, JSON, parseFloat, parseInt, isFinite, isNaN, Infinity, NaN, undefined });
try { vm.runInContext(script, ctx, { filename: 'calc.js' }); }
catch (e){ console.log('LOAD ERROR:', e.stack); process.exit(1); }
const calculate = ctx.calculate, X = ctx.__X;

// ---------- helpers ----------
let failures = 0;
const grab = id => elements[id].textContent;
const set = (id, v) => { elements[id].value = String(v); };
const setChecked = (id, v) => { elements[id].checked = !!v; };
const fire = (id, ev) => (elements[id]._listeners[ev] || []).forEach(fn => fn());
function scanOutputs(label){
  const bad = [];
  for (const id of Object.keys(elements)) for (const prop of ['textContent', 'innerHTML']){
    const t = String(elements[id][prop] || '');
    if (/NaN|Infinity|undefined|null/.test(t)) bad.push(`${id}.${prop}: "${t.slice(0, 70)}"`);
  }
  for (const ch of charts) (ch.data.datasets || []).forEach((ds, i) => (ds.data || []).forEach((v, j) => {
    if (typeof v !== 'number' || !isFinite(v)) bad.push(`chart ds${i} "${ds.label}" [${j}]=${v}`);
  }));
  if (bad.length){ console.log(`  [${label}] HALVAD VÄLJUNDID:`); bad.slice(0, 6).forEach(b => console.log('    -', b)); }
  return bad.length;
}
function run(label){
  try { calculate(); } catch (e){ console.log(`  [${label}] KÄITUSAJA VIGA: ${e.message}\n    ${(e.stack.split('\n')[1] || '').trim()}`); return 1; }
  return scanOutputs(label);
}
function restoreAll(){
  for (const [id, d] of Object.entries(defaults)){ elements[id].value = d.value; if (d.type === 'checkbox') elements[id].checked = !!d.checked; }
}

// ---------- 1. default ----------
console.log('=== 1. Vaikeseaded ===');
failures += run('default');
console.log(`   investeering ${grab('m-investment')} | sääst y1 ${grab('m-savings1')} | tasuvus ${grab('m-payback')} (${grab('m-payback-sub')})`);
console.log(`   NPV ${grab('m-npv')} | IRR ${grab('m-irr')} | amort ${grab('m-depreciation')} | vahetused ${grab('m-battreplace')}`);
console.log(`   naaber: ${grab('m-neighbor-frozen')} / ${grab('m-neighbor-floating')} / ${grab('m-neighbor-diff')}`);

// ---------- 2. toggles ----------
console.log('=== 2. Lülitid (16 kombinatsiooni) ===');
const toggles = Object.keys(defaults).filter(k => defaults[k].type === 'checkbox');
for (let mask = 0; mask < (1 << toggles.length); mask++){
  toggles.forEach((t, i) => setChecked(t, !!(mask & (1 << i))));
  failures += run('lülitid ' + toggles.map((t, i) => `${t}=${(mask >> i) & 1}`).join(','));
}
restoreAll();

// ---------- 3. sliders ----------
console.log('=== 3. Liugurid min/max ===');
let nS = 0;
for (const [id, d] of Object.entries(defaults).filter(([, d]) => d.type === 'range')){
  set(id, d.min); fire(id, 'input'); failures += run(`${id}=min`);
  set(id, d.max); fire(id, 'input'); failures += run(`${id}=max`);
  set(id, d.value); fire(id, 'input'); nS++;
}
restoreAll(); run('restore');
console.log(`   ${nS} liugurit testitud`);

// ---------- 4. selects ----------
console.log('=== 4. Rippmenüüd ===');
let nO = 0;
for (const [id, d] of Object.entries(defaults).filter(([, d]) => d.type === 'select')){
  for (const opt of d.options){ set(id, opt); try { fire(id, 'change'); } catch (e){ console.log(`  [${id}=${opt}] change-käsitleja VIGA: ${e.message}`); failures++; } failures += run(`${id}=${opt}`); nO++; }
  set(id, d.value); fire(id, 'change');
}
restoreAll(); run('restore');
console.log(`   ${nO} valikut testitud`);

// ---------- 5. nasty combos ----------
console.log('=== 5. Äärmuslikud kombinatsioonid ===');
const combos = [
  { label: 'aku väljas, battLife<panelLife', s: { battLife: 5, panelLife: 25 }, c: { hasBattery: false } },
  { label: 'panelLife 15 < battLife 20', s: { panelLife: 15, battLife: 20 } },
  { label: 'panelLife 15, battLife 5', s: { panelLife: 15, battLife: 5 } },
  { label: 'pisike inverter 5 kW + 30 kWp', s: { inverterAc: 5, pvsizeA: 15, pvsizeB: 15 } },
  { label: 'peakaitse 3,68 kW + 61 kWh aku', s: { battsize: 61.44 }, sel: { mainFuse: '3.68' } },
  { label: 'null-tarbimine', s: { consumptionDay: 0, consumptionNight: 0 } },
  { label: 'null-paneelid', s: { pvsizeA: 0, pvsizeB: 0 } },
  { label: 'kasv 0 / diskonto 0 / vananemine 0', s: { escalation: 0, discount: 0, degradation: 0, battFade: 0 } },
  { label: 'kasv 8 / diskonto 10 / vananemine 1,5 / fade 5', s: { escalation: 8, discount: 10, degradation: 1.5, battFade: 5 } },
  { label: 'ringtõhusus 70 %', s: { roundtrip: 70 } },
  { label: 'reguleerimine 150 + kestvus 4 h', s: { regulationRate: 150, regDuration: 4 } },
  { label: 'reguleerimine kestvus 0 (piirang väljas)', s: { regDuration: 0 } },
  { label: 'muud kulud 0', s: { installCost: 0, commissionCost: 0, designCost: 0, electricalCost: 0, gridFee: 0 } },
  { label: 'energiahind päev max / öö min', s: { energyDay: 0.30, energyNight: 0.01 } },
];
for (const c of combos){
  restoreAll();
  for (const [k, v] of Object.entries(c.s || {})) set(k, v);
  for (const [k, v] of Object.entries(c.sel || {})) set(k, v);
  for (const [k, v] of Object.entries(c.c || {})) setChecked(k, v);
  failures += run(c.label);
  console.log(`   ${c.label}: tasuvus ${grab('m-payback')} | NPV ${grab('m-npv')} | IRR ${grab('m-irr')} | vahetused ${grab('m-battreplace')}`);
}
restoreAll(); run('restore');

// ---------- 6. energy balances + independent recomputation ----------
console.log('=== 6. Energiabilansid ja sõltumatu ümberarvutus (vaikeseaded) ===');
(function(){
  const g = id => +elements[id].value;
  const networkDay = g('networkDay'), networkNight = g('networkNight'), VAT = 0.24;
  const flatFees = g('excise') + g('renewfee') + g('securityfee') + g('balancingfee');
  const tilt = g('tilt'), baseyield = g('baseyield');
  const pvA = g('pvsizeA'), azA = g('azimuthA'), pvB = elements.hasBlockB.checked ? g('pvsizeB') : 0, azB = g('azimuthB');
  const inverterAc = g('inverterAc'), batt = elements.hasBattery.checked ? g('battsize') : 0, eff = g('roundtrip') / 100;
  const cap = g('mainFuse'), allow = elements.hasBattery.checked && elements.allowGridCharge.checked;
  const cons = g('consumptionDay') + g('consumptionNight');
  const DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const profA = X.getHourlyProfile(azA, tilt), profB = X.getHourlyProfile(azB, tilt);
  let sA = 0, sB = 0; for (let i = 0; i < profA.length; i++){ sA += profA[i]; sB += profB[i]; }
  const yA = baseyield * X.orientationFactor(azA, tilt), yB = baseyield * X.orientationFactor(azB, tilt);
  const scA = sA > 0 ? pvA * yA / sA : 0, scB = sB > 0 ? pvB * yB / sB : 0;
  const prices = X.getScaledPrices(g('energyDay'), g('energyNight'));
  let baseline = 0, actual = 0, exportRev = 0, worst = { prod: 0, cons: 0, batt: 0 };
  for (let m = 0; m < 12; m++){
    const si = X.MID_MONTH_DOY[m] * 24, pa = [], pb = [];
    for (let h = 0; h < 24; h++){ pa.push(profA[si + h] * scA); pb.push(profB[si + h] * scB); }
    const mt = cons * X.MONTHLY_CONSUMPTION_SHARE[m], wdC = DIM[m] * 5 / 7, weC = DIM[m] * 2 / 7;
    const cwd = X.HOURLY_SHAPE_WEEKDAY[m].map(f => f * mt * X.WEEKDAY_FRACTION[m] / wdC);
    const cwe = X.HOURLY_SHAPE_WEEKEND[m].map(f => f * mt * (1 - X.WEEKDAY_FRACTION[m]) / weC);
    const { simWd: wd, simWe: we } = X.simulateMonthPair(pa, pb, cwd, cwe, prices[m].wd, prices[m].we, networkDay, networkNight, flatFees, VAT, batt, eff, allow, allow, inverterAc, cap);
    for (const [sim, ps, isDay, cnt, c] of [[wd, prices[m].wd, h => X.ISDAY_WEEKDAY[h], wdC, cwd], [we, prices[m].we, () => false, weC, cwe]]){
      let prod = 0, prodUse = 0, consT = 0, consUse = 0, chg = 0, dis = 0;
      for (let h = 0; h < 24; h++){
        const bv = (ps[h] + (isDay(h) ? networkDay : networkNight) + flatFees) * (1 + VAT);
        baseline += c[h] * cnt * bv;
        actual += (sim.gridBought[h] + sim.gridCharged[h]) * cnt * bv;
        exportRev += sim.exportArr[h] * cnt * ps[h];
        prod += Math.min(pa[h] + pb[h], inverterAc);
        prodUse += sim.directSelf[h] + sim.solarCharged[h] + sim.exportDirect[h] + sim.curtailed[h];
        consT += c[h]; consUse += sim.directSelf[h] + sim.dischargeFromSolar[h] + sim.dischargeFromGrid[h] + sim.gridBought[h];
        chg += sim.solarCharged[h] + sim.gridCharged[h];
        dis += (sim.dischargeFromSolar[h] + sim.dischargeFromGrid[h] + sim.exportFromSolar[h] + sim.exportFromGrid[h]) / eff;
      }
      worst.prod = Math.max(worst.prod, Math.abs(prod - prodUse));
      worst.cons = Math.max(worst.cons, Math.abs(consT - consUse));
      worst.batt = Math.max(worst.batt, Math.abs(chg - dis + (sim.socStartTotal - sim.socEndTotal)));
    }
  }
  const tol = 0.01;
  console.log(`   tootmise bilanss, max viga: ${worst.prod.toFixed(4)} kWh ${worst.prod < tol ? 'OK' : 'VIGA'}`);
  console.log(`   tarbimise bilanss, max viga: ${worst.cons.toFixed(4)} kWh ${worst.cons < tol ? 'OK' : 'VIGA'}`);
  console.log(`   aku bilanss (laetud = tühjendatud/tõhusus + Δlaeng), max viga: ${worst.batt.toFixed(4)} kWh ${worst.batt < tol ? 'OK' : 'VIGA'}`);
  if (worst.prod >= tol || worst.cons >= tol || worst.batt >= tol) failures++;
  const reg = elements.hasBattery.checked ? Math.min(inverterAc, cap, g('regDuration') > 0 ? batt / g('regDuration') : Infinity) * g('regulationRate') : 0;
  const hourlyY1 = baseline - actual + exportRev + reg - g('maintenance');
  const calcY1 = parseFloat(grab('m-savings1').replace(/[^\d]/g, ''));
  const diff = Math.abs(calcY1 - hourlyY1);
  console.log(`   1. aasta sääst: kalkulaator ${calcY1} € vs sõltumatu ümberarvutus ${hourlyY1.toFixed(0)} € → vahe ${diff.toFixed(1)} € ${diff < 1.5 ? 'OK' : 'VIGA'}`);
  if (diff >= 1.5) failures++;
  const npvSeries = charts[0] && charts[0].data.datasets[0].data;
  if (!npvSeries || npvSeries.length !== Math.round(g('panelLife')) + 1){ console.log('   rahavoo kõver: vale pikkus VIGA'); failures++; } else console.log(`   rahavoo kõver: ${npvSeries.length - 1} aastat OK`);
})();

// ---------- 7. timing ----------
console.log('=== 7. Ajamõõtmine ===');
const t0 = Date.now(); for (let i = 0; i < 10; i++) calculate();
console.log(`   10 × calculate() = ${Date.now() - t0} ms (${((Date.now() - t0) / 10).toFixed(0)} ms tk)`);

console.log(`\nKOKKU VIGU: ${failures}`);
process.exit(failures ? 1 : 0);
