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
const sourcesStart=html.indexOf('<p class="note">Источники:');
const sourcesEnd=html.indexOf('</p>',sourcesStart);
assert.ok(sourcesStart>=0&&sourcesEnd>sourcesStart,'Compact source list exists');
const sourcesHtml=html.slice(sourcesStart,sourcesEnd);
for(const source of ['BackPoW','CoinGecko','Binance','Mempool.space','CBR-XML-Daily','ExchangeRate API','Bitdeer','MicroBT','Bitmain','Canaan','Canaan A1566','IceRiver','iBeLink','ElphaPex','Goldshell','Jasminer','iPollo','Innosilicon']) {
  assert.ok(sourcesHtml.includes('>'+source+'</a>'),`Missing source link: ${source}`);
}
assert.ok(!/<a\b(?![^>]*\brel="noopener")[^>]*target="_blank"/.test(sourcesHtml),'External source links must use rel=noopener');

const coinStart = script.indexOf('const coins={');
const coinEnd = script.indexOf('};', coinStart);
assert.ok(coinStart >= 0 && coinEnd > coinStart, 'Coin table exists');
const coinBlock = script.slice(coinStart, coinEnd);
const coinTags = [...coinBlock.matchAll(/^\s*([A-Z]{2,5}):/gm)].map(m => m[1]);
assert.deepEqual(coinTags, ['BTC','BCH','LTC','KAS','ALPH','ZEC','ETC','DASH','CKB','ALEO']);

const deviceRows = [...script.matchAll(/\['([^']+)','([^']+)','([^']+)','([^']+)','([^']+)',(\d+)\]/g)];
assert.ok(deviceRows.length >= 65, `Expected broad ASIC catalogue, found ${deviceRows.length}`);
const parsedDevices = deviceRows.map(m => ({name:m[1],brand:m[2],coins:m[3].split(','),hash:Number(m[4]),unit:m[5],watts:Number(m[6])}));
assert.equal(new Set(parsedDevices.map(d => d.name)).size, parsedDevices.length, 'ASIC model names must be unique');
for (const d of parsedDevices) {
  assert.ok(d.brand && d.hash > 0 && d.watts > 0, `Invalid ASIC specification: ${d.name}`);
  assert.ok(['TH','PH','GH','MH','KSOL','KH'].includes(d.unit), `Unknown hashrate unit: ${d.name}`);
  assert.ok(d.coins.length > 0 && d.coins.every(tag => coinTags.includes(tag)), `Invalid coin mapping: ${d.name}`);
}
assert.equal(parsedDevices.length, 70, 'Current reviewed ASIC catalogue should contain 70 distinct models');
assert.ok(script.includes("const grossManualSet=$('grossRevenue').value.trim()!==''"), 'An explicitly entered zero gross revenue must be treated as a manual override');
assert.ok(script.includes("if($('grossRevenue').value.trim()!==''") , 'Manual revenue status must distinguish blank from zero');
assert.ok(script.includes("else{delete state.prices[tag];delete state.priceFetchedAt[tag];delete state.priceDataSource[tag];"), 'Clearing manual coin price must restore automatic pricing');
assert.ok(script.includes("state.fxManual=true"), 'A manually entered FX rate must not be overwritten by automatic FX refresh');
assert.ok(script.includes("state.fxManual=false;state.fx=0"), 'Clearing manual FX must restore automatic FX mode');
assert.ok(!script.includes("['iBeLink BM-K1 Max','iBeLink','CKB'"), 'Kadena BM-K1 Max must not be listed as a CKB miner');
for (const model of ['Antminer S23 Hyd 3U','Antminer S21 Pro','Antminer Z15 K','Antminer KS5','IceRiver KS7 Lite','IceRiver AL2 Lite','IceRiver AE3']) {
  assert.ok(script.includes(model), `Missing ASIC model: ${model}`);
}
assert.ok(script.includes("'1160','TH',11020"), 'S23 Hyd 3U must be 1160 TH/s, not PH/s');
assert.ok(script.includes("'525','KSOL',2483"), 'Z15 K must be 525 kSol/s at 2483 W');
assert.ok(script.includes("['Antminer KS5','Bitmain','KAS','20','TH',3000]"), '20 TH/s KS5 must be attributed to Bitmain, not IceRiver');
assert.ok(!script.includes("['IceRiver KS5','IceRiver','KAS'"), 'There is no IceRiver KS5 model in this catalog');
assert.ok(script.includes("['Antminer L7','Bitmain','LTC','9.5','GH',3420]"), 'Antminer L7 standard 9.5G model must use the official 3420 W rating');
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
const normalizeFn = between('function normalizeCoinRecord(raw,tag,name){', 'function updateNetworkDisplay(tag){');
const estimateFns = between('function estimateUnsupportedReason(tag,device=null){', 'function estimateAleoDevice(hashH,device){');
const revenueFn = between('function estimateAleoDevice(hashH,device){', 'async function loadMarket(){');
const profitFn = between('function calculateDailyProfit(', 'function calc(){');
const fxFn = between('function fxIsFresh(){', 'const toUsd=');

const networks = {
  BTC: {tag:'BTC',nethash:966e18,block_time:600,block_reward:3.125,emission:{oracleRewardBasis:'total',minerShare:1,status:'ok',subsidyNow:3.125,observedReward:3.14}},
  BCH: {tag:'BCH',nethash:3.608014395911283e18,block_time:588.341,block_reward24:3.13,usdPrice:196.02,emission:{oracleRewardBasis:'total',minerShare:1,status:'ok',observedReward:3.13}},
  LTC: {tag:'LTC',nethash:2.640109312639098e15,block_time:150.641,block_reward24:6.25,usdPrice:40.45},
  DOGE: {tag:'DOGE',nethash:2.6179463157657545e15,block_time:63.501,block_reward24:10000,usdPrice:0.054412},
  KAS: {tag:'KAS',nethash:3.047004924141843e17,block_time:0.1,block_reward24:1.94454365,usdPrice:0.02614141,emission:{oracleRewardBasis:'total',minerShare:1,status:'ok',observedReward:1.94454365}},
  ETC: {tag:'ETC',nethash:1.7430490536115375e14,block_time:13.521,block_reward24:1.59,usdPrice:5.72,emission:{oracleRewardBasis:'total',minerShare:1,status:'ok',observedReward:1.59}},
  ALPH: {tag:'ALPH',nethash:4.649987319732508e15,block_time:0.54,block_reward24:0.14,emission:{oracleRewardBasis:'total',minerShare:1}},
  ZEC: {tag:'ZEC',nethash:36.14910666503059e9,block_time:24,block_reward24:0.42,emission:{oracleRewardBasis:'miner',minerShare:0.8}},
  DASH: {tag:'DASH',nethash:3.188109791242718e15,block_time:157.285,block_reward24:0.41,emission:{oracleRewardBasis:'miner',minerShare:0.2}},
  CKB: {tag:'CKB',nethash:75.00833379562404e15,block_time:10.086,block_reward24:685.45,emission:{oracleRewardBasis:'miner',minerShare:0.64057,status:'ok',observedReward:775.86}},
  ALEO: {tag:'ALEO',nethash:4.128650163258353e12,block_time:9.58,block_reward24:24.659349,usdPrice:0.02820313,ASICS:[{name:'Iceriver AE0',hashrate:60000000,watts:100,revenue:0.09186686045554604,revenueAt:0.02820313},{name:'Iceriver AE1 Lite',hashrate:299910000,watts:500,revenue:0.4533364659041364,revenueAt:0.02820313},{name:'Iceriver AE2',hashrate:718056000,watts:1300,revenue:1.0966044169720786,revenueAt:0.02820313},{name:'Iceriver AE3',hashrate:1995400000,watts:3400,revenue:3.0387038347417725,revenueAt:0.02820313}],emission:{oracleRewardBasis:'miner',status:'needs_live_input'}}
};
const context = {
  Number, Math, Date, String, isFinite, parseFloat,
  state: {prices:{BTC:73691,BCH:196.02,LTC:40.45,DOGE:0.054412,KAS:0.02614141,ETC:5.72,ALPH:0.031487,ZEC:949.01,DASH:38.12,CKB:0.000749,ALEO:0.02820313},btcUsd:73691,networkCoins:Object.values(networks),btcNetwork:null,networkDataSource:{ALPH:'BackPoW',ZEC:'BackPoW',DASH:'BackPoW',CKB:'BackPoW',ALEO:'BackPoW'},priceFetchedAt:{BTC:Date.now(),BCH:Date.now(),LTC:Date.now(),DOGE:Date.now(),KAS:Date.now(),ETC:Date.now(),ALPH:Date.now(),ZEC:Date.now(),DASH:Date.now(),CKB:Date.now(),ALEO:Date.now()},priceDataSource:{BTC:'CoinGecko',BCH:'CoinGecko',LTC:'CoinGecko',DOGE:'CoinGecko',KAS:'CoinGecko',ETC:'CoinGecko',ALPH:'CoinGecko',ZEC:'CoinGecko',DASH:'CoinGecko',CKB:'CoinGecko',ALEO:'CoinGecko'}},
  coins: {
    BTC:{algo:'SHA-256'},BCH:{algo:'SHA-256'},LTC:{algo:'Scrypt'},DOGE:{algo:'Scrypt'},KAS:{algo:'kHeavyHash'},ETC:{algo:'Etchash'},
    ALPH:{algo:'Blake3'},ZEC:{algo:'Equihash'},DASH:{algo:'X11'},CKB:{algo:'Eaglesong'},ALEO:{algo:'zkSNARK'}
  },
  findNetwork: tag => networks[tag] || null
};
vm.createContext(context);
vm.runInContext(findFn + parseFns + hashFn + normalizeFn + estimateFns + revenueFn + profitFn + fxFn, context);

assert.equal(context.parseMetric('2,5 TH/s'), 2.5e12);
assert.equal(context.parseMetric('966 EH/s'), 966e18);
assert.equal(context.parseMetric('3.04P'), 3.04e15);
assert.equal(context.parseSeconds('2.5 min'), 150);
assert.equal(context.parseMetric('685,45'), 685.45);
assert.equal(context.parseMetric('0.000749'), 0.000749);
assert.equal(context.parseMetric('1.25 PH/s'), 1.25e15);
assert.equal(context.parseSeconds('250 ms'), 0.25);
context.state.fx=82.313;
context.state.fxUpdatedAt=Date.now()-24*60*60*1000;
context.state.fxManual=false;
assert.equal(context.fxIsFresh(),true,'A one-day-old daily FX quote should remain usable');
context.state.fxUpdatedAt=Date.now()-37*60*60*1000;
assert.equal(context.fxIsFresh(),false,'A stale automatic FX quote must be rejected');
context.state.fxManual=true;
assert.equal(context.fxIsFresh(),true,'A manually entered FX rate remains valid until cleared');
context.state.fxManual=false;
const normalizedCkb = context.normalizeCoinRecord({
  Algorithm:'Eaglesong','Block time':10.086,'Bl. reward':775.86,'Bl. reward 24h':685.45,
  Nethash:75.00833379562404e15,usdPrice:0.000749,
  emission:{oracleRewardBasis:'miner',status:'ok',observedReward:775.86},
  ASICS:[{name:'Bitmain Antminer K7',hashrate:63.68415e12,watts:3080}]
},'CKB','Nervos');
assert.equal(normalizedCkb.algorithm,'Eaglesong');
assert.equal(normalizedCkb.block_reward24,685.45);
assert.equal(normalizedCkb.nethash,75.00833379562404e15);
assert.equal(normalizedCkb.price_usd,0.000749);
assert.equal(normalizedCkb.emission.oracleRewardBasis,'miner');
assert.equal(normalizedCkb.ASICS[0].watts,3080);
assert.equal(context.hashToH({hash:1,unit:'PH'}), 1e15);
assert.equal(context.hashToH({hash:1,unit:'TH'}), 1e12);
assert.equal(context.hashToH({hash:1,unit:'GH'}), 1e9);
assert.equal(context.hashToH({hash:1,unit:'MH'}), 1e6);
assert.equal(context.hashToH({hash:1,unit:'KSOL'}), 1e3);
assert.equal(context.hashToH({hash:1,unit:'KH'}), 1e3);
context.state.btcNetwork = {tag:'BTC',nethash:123};
context.state.networkDataSource.BTC = 'legacy source';
assert.equal(context.findNetwork('BTC').nethash, networks.BTC.nethash, 'A stale Mempool BTC record must not override newer legacy source data');
context.state.networkDataSource.BTC = 'Mempool.space';
assert.equal(context.findNetwork('BTC').nethash, 123, 'Fresh Mempool BTC data should take precedence');
context.state.btcNetwork = null;
const savedNetworkCoins = context.state.networkCoins;
context.state.networkCoins = [
  {tag:'LTC',name:'Litecoin + Dogecoin',coin:'DOGE',nethash:99,source:'BackPoW'},
  {tag:'DOGECOIN',name:'Dogecoin',nethash:1,source:'legacy source'},
  {tag:'DOGE',name:'Dogecoin',nethash:2,source:'BackPoW'},
  {tag:'LITECOIN',name:'Litecoin',nethash:3,source:'legacy source'},
  {tag:'LTC',name:'Litecoin',nethash:4,source:'BackPoW'}
];
assert.equal(context.findNetwork('DOGE').nethash, 2, 'DOGE lookup must not mistake an LTC record with a DOGE coin alias for the DOGE network');
context.state.networkCoins = [
  {tag:'LITECOIN',name:'Litecoin',nethash:3,source:'legacy source'},
  {tag:'LTC',name:'Litecoin',nethash:4,source:'BackPoW'}
];
assert.equal(context.findNetwork('LTC').nethash, 4, 'BackPoW LTC record must beat an earlier LITECOIN alias');
context.state.networkCoins = savedNetworkCoins;
assert.equal(context.hashToH({hash:840,unit:'KSOL'}), 840000);

const ckbSample = context.calculateDailyProfit(3.98,3080,0.02,1,5.5/82.313,0);
assert.ok(Math.abs(ckbSample.net-(3.98-3.98*0.02-(3.08*24*5.5/82.313)))<1e-10, 'Net profit must subtract pool fee and electricity from gross revenue');
assert.ok(ckbSample.net<0, 'CKB sample must show a loss when electricity exceeds gross revenue');
const offline = context.calculateDailyProfit(3.98,3080,0.02,0,5.5/82.313,0);
assert.equal(offline.gross,0, 'Zero uptime must produce zero mining revenue');
assert.equal(offline.electric,0, 'Zero uptime must produce zero ASIC electricity consumption');
const fullFee = context.calculateDailyProfit(10,1000,1,1,0,0);
assert.equal(fullFee.net,0, 'A 100% pool fee must leave no mining revenue before electricity');
const fixedCosts = context.calculateDailyProfit(0,0,0,1,0,30);
assert.equal(fixedCosts.net,-1, 'Fixed monthly expenses must be charged at one-thirtieth per day even with no mining revenue');
const ltcDirect = context.estimateCoinDaily('LTC',16e9);
const dogeDirect = context.estimateCoinDaily('DOGE',16e9);
assert.ok(ltcDirect && ltcDirect.usd > 0, 'LTC must have an independent Scrypt network estimate');
assert.ok(dogeDirect && dogeDirect.usd > 0, 'DOGE must have an independent merged-mining network estimate');
const bch = context.estimateCoinDaily('BCH',234e12);
assert.ok(bch && bch.usd > 0, 'BCH must use its own SHA-256 network and block reward');
const kas = context.estimateCoinDaily('KAS',40e12);
assert.ok(kas && kas.usd > 0, 'KAS must use its own kHeavyHash network and emission');
const etc = context.estimateCoinDaily('ETC',23.4e9);
assert.ok(etc && etc.usd > 0, 'ETC must use its own Etchash network and block reward');
const btc = context.estimateCoinDaily('BTC',234e12);
assert.ok(btc && Math.abs(btc.usd - 8.03) < 0.1, `BTC reference estimate mismatch: ${btc?.usd}`);
assert.equal(btc.reward,3.125,'BTC expected revenue must use protocol subsidy and exclude volatile transaction fees');
assert.ok(script.includes("const backpowBtc=state.networkCoins.find(x=>String(x.tag||'').toUpperCase()==='BTC'&&x.source==='BackPoW')"), 'Mempool BTC network data must retain BackPoW protocol subsidy metadata');
const alph = context.estimateCoinDaily('ALPH',399.64e9);
assert.ok(alph && Math.abs(alph.usd-0.0602479582)<0.002, `ALPH estimate must match BackPoW aggregate-chain reference: ${alph?.usd}`);
context.state.networkDataSource.ALPH = 'legacy source';
assert.equal(context.estimateCoinDaily('ALPH',399.64e9), null, 'ALPH must not use an unverified per-chain block-time convention');
context.state.networkDataSource.ALPH = 'BackPoW';
const ckb = context.estimateCoinDaily('CKB',63.5e12);
assert.ok(ckb && ckb.usd > 0, 'CKB must calculate automatically from confirmed miner-reward basis');
const expectedCkb = (63.5e12/75.00833379562404e15)*(86400/10.086)*685.45*0.000749;
assert.ok(Math.abs(ckb.usd-expectedCkb)<0.001, 'CKB must use the 24-hour average block reward, not a single high-fee block');
const aleo = context.estimateRevenue('ALEO',2e9,{name:'IceRiver AE3',w:3400});
assert.ok(aleo && Math.abs(aleo.usd-(3.0387038347*(2e9/1995400000)))<0.001, 'ALEO AE3 must scale the BackPoW device benchmark by exact hashrate and live price');
assert.equal(context.estimateRevenue('ALEO',2e9,{name:'Custom device',w:3400}), null, 'ALEO custom devices must not be extrapolated from an unverified prover rate');
for (const [name,hash,watts,revenue] of [
  ['IceRiver AE0',60e6,100,0.09186686045554604],
  ['IceRiver AE1 Lite',300e6,500,0.4533364659041364],
  ['IceRiver AE2',720e6,1300,1.0966044169720786],
  ['IceRiver AE3',2e9,3400,3.0387038347417725]
]) {
  const estimate = context.estimateRevenue('ALEO',hash,{name,w:watts});
  assert.ok(estimate && Math.abs(estimate.usd-revenue*(hash/({ 'IceRiver AE0':60e6,'IceRiver AE1 Lite':299910000,'IceRiver AE2':718056000,'IceRiver AE3':1995400000 }[name])))<0.001, `ALEO benchmark mismatch for ${name}`);
}
assert.equal(context.estimateUnsupportedReason('CKB'), '', 'CKB should not show a manual-income warning when miner reward basis exists');
assert.equal(context.estimateUnsupportedReason('ALEO',{name:'IceRiver AE3'}), '', 'ALEO should allow a source-verified exact ASIC benchmark');
const dash = context.estimateCoinDaily('DASH',1.771239e12);
const zec = context.estimateCoinDaily('ZEC',841512);
assert.ok(dash && Math.abs(dash.usd-4.769913)<0.02, `DASH must use miner payout once: ${dash?.usd}`);
assert.ok(zec && Math.abs(zec.usd-33.447793)<0.1, `ZEC must use miner payout once: ${zec?.usd}`);
const ltc = context.estimateRevenue('LTC',16e9);
assert.ok(ltc && ltc.components.LTC && ltc.components.DOGE, 'Merged LTC + DOGE estimate must include both components');
assert.ok(ltc.dogeCoins>50, `DOGE merged-mining reward should use its own network record: ${ltc.dogeCoins}`);
assert.ok(script.includes('...backpowTags.map(fetchBackpow)'), 'All supported network datasets must be requested on refresh');
assert.ok(script.includes('https://data-api.binance.vision/api/v3/ticker/price?symbol='), 'Use the public Binance market-data ticker for supported assets');
assert.ok(script.includes("state.priceDataSource[tag]==='manual'"), 'Live exchange quotes must not overwrite a manual coin price');
assert.ok(script.includes("if(results[2].status==='fulfilled')"), 'Mempool hashrate must use its original response slot');
assert.ok(script.includes("const hasExchangeQuote=priceTags.some(tag=>state.priceDataSource[tag]==='Binance USDT')"), 'Only direct exchange quotes should be labelled as cross-checked against CoinGecko');
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
