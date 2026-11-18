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
assert.ok(script.includes("if(tag==='ALPH'&&networkSource!=='BackPoW')return null"), 'Alephium auto-estimates must use the validated aggregate-chain source');
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
const findFn = between('function findNetwork(tag){', 'function parseMetric(v){');
const estimateFns = between('function estimateUnsupportedReason(tag){', 'function estimateRevenue(tag,hashH){');
const revenueFn = between('function estimateRevenue(tag,hashH){', 'async function loadMarket(){');

const networks = {
  BTC: {tag:'BTC',nethash:966e18,block_time:600,block_reward:3.125},
  LTC: {tag:'LTC',nethash:2.62e15,block_time:150,block_reward:6.2635},
  DOGE: {tag:'DOGE',nethash:2.62e15,block_time:60,block_reward:10000},
  ALPH: {tag:'ALPH',nethash:4.649987319732508e15,block_time:0.54,block_reward24:0.14,emission:{oracleRewardBasis:'total',minerShare:1}},
  ZEC: {tag:'ZEC',nethash:36.14910666503059e9,block_time:24,block_reward24:0.42,emission:{oracleRewardBasis:'miner',minerShare:0.8}},
  DASH: {tag:'DASH',nethash:3.188109791242718e15,block_time:157.285,block_reward24:0.41,emission:{oracleRewardBasis:'miner',minerShare:0.2}},
  CKB: {tag:'CKB',nethash:85.61e15,block_time:8,block_reward:266},
  ALEO: {tag:'ALEO',nethash:1e15,block_time:1,block_reward:1}
};
const context = {
  Number, Math, Date, String, isFinite, parseFloat,
  state: {prices:{BTC:73691,LTC:80,DOGE:0.15,ALPH:0.031487,ZEC:949.01,DASH:38.12,CKB:0.0009},btcUsd:73691,networkCoins:Object.values(networks),btcNetwork:null,networkDataSource:{ALPH:'BackPoW',ZEC:'BackPoW',DASH:'BackPoW'}},
  coins: {
    BTC:{algo:'SHA-256'},BCH:{algo:'SHA-256'},LTC:{algo:'Scrypt'},DOGE:{algo:'Scrypt'},
    ALPH:{algo:'Blake3'},ZEC:{algo:'Equihash'},DASH:{algo:'X11'},CKB:{algo:'Eaglesong'},ALEO:{algo:'zkSNARK'}
  },
  findNetwork: tag => networks[tag] || null
};
vm.createContext(context);
vm.runInContext(findFn + parseFns + hashFn + estimateFns + revenueFn, context);

assert.equal(context.parseMetric('2,5 TH/s'), 2.5e12);
assert.equal(context.parseMetric('966 EH/s'), 966e18);
assert.equal(context.parseMetric('3.04P'), 3.04e15);
assert.equal(context.parseSeconds('2.5 min'), 150);
context.state.btcNetwork = {tag:'BTC',nethash:123};
context.state.networkDataSource.BTC = 'CoinCalculators';
assert.equal(context.findNetwork('BTC').nethash, networks.BTC.nethash, 'A stale Mempool BTC record must not override newer CoinCalculators data');
context.state.networkDataSource.BTC = 'Mempool.space';
assert.equal(context.findNetwork('BTC').nethash, 123, 'Fresh Mempool BTC data should take precedence');
context.state.btcNetwork = null;
assert.equal(context.hashToH({hash:840,unit:'KSOL'}), 840000);

const btc = context.estimateCoinDaily('BTC',234e12);
assert.ok(btc && Math.abs(btc.usd - 8.03) < 0.1, `BTC reference estimate mismatch: ${btc?.usd}`);
const alph = context.estimateCoinDaily('ALPH',399.64e9);
assert.ok(alph && Math.abs(alph.usd-0.0602479582)<0.002, `ALPH estimate must match BackPoW aggregate-chain reference: ${alph?.usd}`);
context.state.networkDataSource.ALPH = 'CoinCalculators';
assert.equal(context.estimateCoinDaily('ALPH',399.64e9), null, 'ALPH must not use an unverified per-chain block-time convention');
context.state.networkDataSource.ALPH = 'BackPoW';
assert.equal(context.estimateCoinDaily('CKB',63.5e12), null, 'CKB must not invent a partial estimate without confirmed full reward data');
assert.ok(context.estimateUnsupportedReason('CKB').includes('вручную'), 'CKB must explain its manual pool-income mode');
assert.equal(context.estimateCoinDaily('ALEO',2e9), null, 'Aleo must not use generic hashrate math');
const dash = context.estimateCoinDaily('DASH',1.771239e12);
const zec = context.estimateCoinDaily('ZEC',841512);
assert.ok(dash && Math.abs(dash.usd-4.769913)<0.02, `DASH must use miner payout once: ${dash?.usd}`);
assert.ok(zec && Math.abs(zec.usd-33.447793)<0.1, `ZEC must use miner payout once: ${zec?.usd}`);
const ltc = context.estimateRevenue('LTC',16e9);
assert.ok(ltc && ltc.components.LTC && ltc.components.DOGE, 'Merged LTC + DOGE estimate must include both components');
assert.ok(script.includes('...backpowTags.map(fetchBackpow)'), 'All supported network datasets must be requested on refresh');
context.state.networkFetchedAt = {BTC:Date.now()-27*60*60*1000};
context.state.networkDataSource = {BTC:'BackPoW'};
context.state.priceFetchedAt = {BTC:Date.now()};
context.state.priceDataSource = {BTC:'CoinGecko'};
assert.equal(context.estimateCoinDaily('BTC',234e12), null, 'Stale daily network data must not produce an automatic estimate');
context.state.networkFetchedAt.BTC = Date.now();
assert.ok(context.estimateCoinDaily('BTC',234e12), 'Fresh network and market data should allow an estimate');
context.state.priceFetchedAt.BTC = Date.now()-11*60*1000;
assert.equal(context.estimateCoinDaily('BTC',234e12), null, 'Stale market prices must not produce an automatic estimate');

console.log(`Smoke tests passed: ${coinTags.length} coins, ${deviceRows.length} ASIC entries, DOM selectors, parsing, BTC, ALPH, CKB, DASH, ZEC, LTC+DOGE and ALEO guard.`);
