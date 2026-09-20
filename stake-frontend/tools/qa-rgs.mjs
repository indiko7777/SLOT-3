// Local-only contract smoke test. Never accepts a remote RGS URL.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:8787';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publish = path.join(root, 'stake-math/publish_files');
const index = JSON.parse(readFileSync(path.join(publish, 'index.json'), 'utf8'));
const report = { checkedAt: new Date().toISOString(), server: base, modes: [] };
const sid = `local-contract-qa-${Date.now()}`;
async function post(endpoint, payload = {}) {
  const response = await fetch(base + endpoint, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({sessionID:sid,...payload}) });
  assert.equal(response.ok, true);
  const data = await response.json();
  assert.equal(data.status.statusCode, 'SUCCESS', JSON.stringify(data.status));
  return data;
}

for (const mode of index.modes) {
  const rows = readFileSync(path.join(publish, mode.weights), 'utf8').trim().split(/\r?\n/).map(line => line.split(',').map(Number));
  const weighted = rows.filter(row => row[1] > 0);
  const cases = {
    loss: weighted.find(row => row[2] === 0),
    win: weighted.find(row => row[2] > 0 && row[2] < 500000),
    cap: weighted.find(row => row[2] === 500000),
  };
  const checked = [];
  for (const [scenario, row] of Object.entries(cases)) {
    if (!row) continue;
    const response = await fetch(`${base}/bet/replay/heat-chase/1/${mode.name}/${row[0]}`);
    const replay = await response.json();
    assert.equal(replay.status.statusCode, 'SUCCESS');
    assert.equal(replay.payoutMultiplier, row[2]/100);
    assert.ok(Array.isArray(replay.state) && replay.state.length > 0);
    assert.equal(replay.state[0].type, 'round_start');
    assert.equal(replay.state[0].mode, mode.name);
    checked.push({scenario,event:row[0],payout:replay.payoutMultiplier,events:replay.state.length,bonus:replay.state.some(event=>event.type==='bonus_trigger')});
  }
  const before = await post('/wallet/authenticate');
  const amount = before.config.defaultBetLevel;
  const play = await post('/wallet/play',{amount,currency:before.balance.currency,mode:mode.name});
  assert.equal(play.balance.amount, before.balance.amount - Math.round(amount*mode.cost));
  const reconnect = await post('/wallet/authenticate');
  if (play.round.active) {
    assert.equal(reconnect.round.roundID, play.round.roundID);
    assert.deepEqual(reconnect.round.state, play.round.state);
    const end = await post('/wallet/end-round');
    assert.equal(end.balance.amount, play.balance.amount + play.round.payout);
    const secondEnd = await post('/wallet/end-round');
    assert.equal(secondEnd.balance.amount, end.balance.amount, 'settlement must not double-credit');
  } else assert.equal(reconnect.round, null);
  report.modes.push({mode:mode.name,cost:mode.cost,replays:checked,wallet:'pass',resume:play.round.active?'pass':'not-active'});
  console.log(`${mode.name}: ${checked.length} replay scenarios, wallet PASS${play.round.active?', active-round recovery PASS':''}`);
}
writeFileSync(path.join(root,'docs/LOCAL_RGS_QA.json'),JSON.stringify(report,null,2)+'\n');
