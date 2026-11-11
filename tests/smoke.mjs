import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(m => m[1]).filter(s => s.trim());
assert.ok(scripts.length, 'Inline calculator script exists');
const script = scripts.at(-1);
new vm.Script(script, { filename: 'index.html:inline-script' });

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const idSet = new Set(ids);
assert.equal(idSet.size, ids.length, 'HTML element IDs must be unique');
const missing = [...new Set([...script.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]))]
  .filter(id => !idSet.has(id));
assert.deepEqual(missing, [], 'Every hard-coded DOM selector must exist');

const coinStart = script.indexOf('const coins={');
const coinEnd = script.indexOf('};', coinStart);
assert.ok(coinStart >= 0 && coinEnd > coinStart, 'Coin table exists');
const coinBlock = script.slice(coinStart, coinEnd);
const coinTags = [...coinBlock.matchAll(/^\s*([A-Z]{2,5}):/gm)].map(m => m[1]);
assert.deepEqual(coinTags, ['BTC','BCH','LTC','KAS','ALPH','ZEC','ETC','DASH','CKB','ALEO']);

const deviceRows = [...script.matchAll(/\['[^']+','[^']+','[^']+','[^']+','[^']+',\d+\]/g)];
assert.ok(deviceRows.length >= 65, `Expected broad ASIC catalogue, found ${deviceRows.length}`);
for (const model of ['Antminer S23 Hyd 3U','Antminer S21 Pro','Antminer Z15 K','IceRiver KS7 Lite','IceRiver AL2 Lite','IceRiver AE3']) {
  assert.ok(script.includes(model), `Missing ASIC model: ${model}`);
}
assert.ok(script.includes("'1160','TH',11020"), 'S23 Hyd 3U must be 1160 TH/s, not PH/s');
assert.ok(script.includes("'525','KSOL',2483"), 'Z15 K must be 525 kSol/s at 2483 W');
assert.ok(script.includes("tag==='ALPH'?16:1"), 'Alephium must account for its 16 chains');
assert.ok(script.includes("requestId!==state.marketRequestId||selectedTag!==$('coinSelect').value"), 'Stale market responses must be ignored');
assert.ok(script.includes("$('grossRevenue').value=''"), 'Manual revenue must clear on coin change');

function between(start, end) {
  const a = script.indexOf(start);
  const b = script.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Could not extract ${start}`);
  return script.slice(a, b);
}
const parseFns = between('function parseMetric(v){', 'function formatHashrate(value){');
const hashFn = between('function hashToH(d){', 'function customDevice(){');
const estimateFns = between('function estimateUnsupportedReason(tag){', 'function estimateRevenue(tag,hashH){');
const revenueFn = between('function estimateRevenue(tag,hashH){', 'async function loadMarket(){');

const networks = {
  BTC: {tag:'BTC',nethash:966e18,block_time:600,block_reward:3.125},
  LTC: {tag:'LTC',nethash:2.62e15,block_time:150,block_reward:6.2635},
  DOGE: {tag:'DOGE',nethash:2.62e15,block_time:60,block_reward:10000},
  ALPH: {tag:'ALPH',nethash:2.35e15,block_time:8,block_reward:0.1915},
  ZEC: {tag:'ZEC',nethash:10.58e9,block_time:75,block_reward:1.5625},
  DASH: {tag:'DASH',nethash:4.8e15,block_time:156,block_reward:2.81},
  CKB: {tag:'CKB',nethash:85.61e15,block_time:8,block_reward:266},
  ALEO: {tag:'ALEO',nethash:1e15,block_time:1,block_reward:1}
};
const context = {
  Number, Math, Date, String, isFinite, parseFloat,
  state: {prices:{BTC:73691,LTC:80,DOGE:0.15,ALPH:0.03,ZEC:1000,DASH:30,CKB:0.0009},btcUsd:73691},
  coins: {
    BTC:{algo:'SHA-256'},BCH:{algo:'SHA-256'},LTC:{algo:'Scrypt'},DOGE:{algo:'Scrypt'},
    ALPH:{algo:'Blake3'},ZEC:{algo:'Equihash'},DASH:{algo:'X11'},CKB:{algo:'Eaglesong'},ALEO:{algo:'zkSNARK'}
  },
  findNetwork: tag => networks[tag] || null
};
vm.createContext(context);
vm.runInContext(parseFns + hashFn + estimateFns + revenueFn, context);

assert.equal(context.parseMetric('2,5 TH/s'), 2.5e12);
assert.equal(context.parseMetric('966 EH/s'), 966e18);
assert.equal(context.parseMetric('3.04P'), 3.04e15);
assert.equal(context.parseSeconds('2.5 min'), 150);
assert.equal(context.hashToH({hash:840,unit:'KSOL'}), 840000);

const btc = context.estimateCoinDaily('BTC',234e12);
assert.ok(btc && Math.abs(btc.usd - 8.03) < 0.1, `BTC reference estimate mismatch: ${btc?.usd}`);
const alph = context.estimateCoinDaily('ALPH',16.6e12);
assert.ok(alph && alph.coins > 0, 'ALPH 16-chain estimate should be available');
const ckb = context.estimateCoinDaily('CKB',63.5e12);
assert.ok(ckb && ckb.incomplete && ckb.usd > 0, 'CKB should expose a labelled base-issuance-only estimate');
assert.equal(context.estimateCoinDaily('ALEO',2e9), null, 'Aleo must not use generic hashrate math');
const dash = context.estimateCoinDaily('DASH',1.77e12);
const zec = context.estimateCoinDaily('ZEC',840e3);
assert.ok(dash && dash.coins > 0 && zec && zec.coins > 0, 'Miner subsidy shares must yield positive estimates');
const ltc = context.estimateRevenue('LTC',16e9);
assert.ok(ltc && ltc.components.LTC && ltc.components.DOGE, 'Merged LTC + DOGE estimate must include both components');

console.log(`Smoke tests passed: ${coinTags.length} coins, ${deviceRows.length} ASIC entries, DOM selectors, parsing, BTC, ALPH, CKB, DASH, ZEC, LTC+DOGE and ALEO guard.`);
