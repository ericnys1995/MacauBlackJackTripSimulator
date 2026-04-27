const $ = (id) => document.getElementById(id);
const suits = ['♠', '♥', '♦', '♣'];
const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

let state = {
  cash: 5000,
  reserve: 2500,
  initialCash: 5000,
  initialReserve: 2500,
  topUpUsed: false,
  shoe: [],
  dealer: [],
  hands: [],
  active: 0,
  phase: 'idle',
  round: 0,
  ledger: [],
  baseBet: 500,
  insuranceBet: 0,
  bjChoice: null,
  splitCount: 0,
  actionsTaken: false,
};

function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
function currentBet() {
  const count = Math.max(1, Math.floor(Number($('betCount')?.value || 1)));
  return 500 * count;
}
function updateBetPreview() { if ($('betPreview')) $('betPreview').textContent = money(currentBet()); }
function cardValue(c) { if (c.r === 'A') return 11; if (['J','Q','K'].includes(c.r)) return 10; return Number(c.r); }
function handValue(cards) {
  let total = cards.reduce((s, c) => s + cardValue(c), 0);
  let aces = cards.filter(c => c.r === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
function isBJ(cards) { return cards.length === 2 && handValue(cards).total === 21; }
function shuffle() {
  const d = [];
  for (let k = 0; k < 6; k++) for (const s of suits) for (const r of ranks) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  state.shoe = d;
}
function draw() { if (!state.shoe.length) shuffle(); return state.shoe.pop(); }
function canAfford(amount) { return state.cash >= amount; }
function activeHand() { return state.hands[state.active]; }
function cardHTML(c) {
  const red = (c.s === '♥' || c.s === '♦') ? ' red' : '';
  return `<div class="playing-card${red}"><span>${c.r}</span><small>${c.s}</small></div>`;
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function handText(cards) { return cards.map(c => c.r + c.s).join(' '); }

function update() {
  $('cash').textContent = money(state.cash);
  $('reserve').textContent = money(state.reserve);
  $('handsPlayed').textContent = state.round;
  $('net').textContent = money(state.cash + state.reserve - (state.initialCash + state.initialReserve));
  $('dealerCards').innerHTML = state.dealer.map(cardHTML).join('');
  const dv = state.dealer.length ? handValue(state.dealer) : null;
  $('dealerScore').textContent = dv ? `點數 ${dv.total}${dv.soft ? ' soft' : ''}` : '';
  $('playerHands').innerHTML = state.hands.map((h, i) => `
    <div class="hand ${i === state.active && (state.phase === 'player' || state.phase === 'choice') ? 'active' : ''}">
      <div class="zone-title"><b>手牌 ${i + 1} <span class="pill">注 ${money(h.bet)}</span> ${h.finished ? '<span class="pill">完成</span>' : ''}</b><span>點數 ${handValue(h.cards).total}${handValue(h.cards).soft ? ' soft' : ''}</span></div>
      <div class="cards">${h.cards.map(cardHTML).join('')}</div>
      <div class="mini">${h.note || ''}</div><div class="result">${h.result || ''}</div>
    </div>`).join('');
  $('roundInfo').textContent = state.hands.length ? `目前第 ${state.active + 1} 手 / 共 ${state.hands.length} 手` : '';

  const h = activeHand();
  const dealerA = state.dealer[0]?.r === 'A';
  const playerPhase = state.phase === 'player' || state.phase === 'choice';
  updateBetPreview();

  $('deal').disabled = !(state.phase === 'idle' || state.phase === 'roundOver');
  $('hit').disabled = !playerPhase || !h || h.lockedOneCard;
  $('stand').disabled = !playerPhase || !h || h.lockedOneCard;
  $('double').disabled = !playerPhase || !h || state.actionsTaken || h.cards.length !== 2 || !canAfford(h.bet);
  $('split').disabled = !playerPhase || !h || state.actionsTaken || !canSplit(h);
  $('surrender').disabled = !playerPhase || !h || state.actionsTaken || dealerA;
  $('insurance').disabled = !(state.phase === 'choice' && dealerA && state.insuranceBet === 0 && canAfford(state.baseBet / 2));
  $('noInsurance').disabled = !(state.phase === 'choice' && dealerA);
  $('bjTake').disabled = !(state.phase === 'bjChoice');
  $('bjWait').disabled = !(state.phase === 'bjChoice');
  renderLedger();
}

function msg(t) { $('message').innerHTML = t; }
function canSplit(h) {
  if (!h || h.cards.length !== 2) return false;
  if (state.splitCount >= 4) return false;
  const a = h.cards[0].r, b = h.cards[1].r;
  if (a !== b) return false;
  if (a === 'A' && h.wasSplitA) return false;
  return canAfford(h.bet);
}
function startSession() {
  state.cash = Number($('startCash').value || 5000);
  state.reserve = Number($('reserveCash').value || 2500);
  state.initialCash = state.cash;
  state.initialReserve = state.reserve;
  state.topUpUsed = false;
  state.round = 0;
  state.ledger = [];
  state.phase = 'idle';
  state.hands = [];
  state.dealer = [];
  state.insuranceBet = 0;
  msg('新局開始。按「開新一鋪」。');
  update();
}
function topUp() {
  if (state.topUpUsed) { msg('已經補過一次錢，不能再補。'); return; }
  if (state.reserve <= 0) { msg('後備金已經無錢可補。'); return; }
  state.cash += state.reserve;
  state.reserve = 0;
  state.topUpUsed = true;
  msg('已補一次後備金入主錢包。');
  update();
}

async function newRound() {
  if (!(state.phase === 'idle' || state.phase === 'roundOver')) return;
  state.baseBet = currentBet();
  if (state.cash < state.baseBet) { msg('主錢包唔夠下注。'); update(); return; }
  shuffle();
  state.cash -= state.baseBet;
  state.round++;
  state.insuranceBet = 0;
  state.bjChoice = null;
  state.splitCount = 0;
  state.actionsTaken = false;
  state.dealer = [];
  state.hands = [{ cards: [], bet: state.baseBet, finished: false, result: '', note: '', lockedOneCard: false, wasSplitA: false }];
  state.active = 0;
  state.phase = 'dealing';

  msg('派牌中：先派你第 1 張。'); update(); await sleep(360);
  state.hands[0].cards.push(draw()); msg('派牌中：再派莊家 1 張明牌。'); update(); await sleep(520);
  state.dealer.push(draw()); msg('派牌中：最後派你第 2 張。'); update(); await sleep(520);
  state.hands[0].cards.push(draw()); msg('派牌完成，準備開始動作。'); update(); await sleep(280);

  const player = state.hands[0].cards;
  const dealerA = state.dealer[0].r === 'A';
  if (isBJ(player) && dealerA) {
    state.phase = 'bjChoice';
    msg('你 Blackjack，而莊家 A 面：可即收 1:1，或者等莊家補牌結果。');
  } else if (dealerA) {
    state.phase = 'choice';
    msg('莊家 A 面：不能投降。你可以買保險，亦可以唔買直接補牌 / 停牌 / Double / Split。');
  } else if (isBJ(player)) {
    state.phase = 'player';
    finishPlayerHand(true);
    dealerPlayAndSettle();
  } else {
    state.phase = 'player';
    msg('開始動作。莊家非 A，可以投降輸一半。');
  }
  update();
}

function beginFromChoice() { if (state.phase === 'choice') { state.phase = 'player'; msg('開始動作。'); } }
function buyInsurance() {
  if (state.phase !== 'choice') return;
  const amt = state.baseBet / 2;
  if (!canAfford(amt)) { msg('唔夠錢買保險。'); return; }
  state.cash -= amt;
  state.insuranceBet = amt;
  state.phase = 'player';
  msg(`已買保險 ${money(amt)}。繼續玩家動作。`);
  update();
}
function noInsurance() { if (state.phase !== 'choice') return; state.phase = 'player'; msg('你選擇唔買保險，繼續玩家動作。'); update(); }
function blackjackTake() {
  const h = activeHand();
  state.cash += h.bet * 2;
  h.finished = true;
  h.result = 'Blackjack 即收 1:1';
  state.phase = 'roundOver';
  logRound([{ label: h.result, delta: h.bet }], 0);
  msg('已即收 1:1，本鋪完。');
  update();
}
function blackjackWait() { state.bjChoice = 'wait'; state.phase = 'player'; finishPlayerHand(true); dealerPlayAndSettle(); }
function hit() {
  beginFromChoice();
  const h = activeHand();
  if (!h || state.phase !== 'player') return;
  h.cards.push(draw());
  state.actionsTaken = true;
  const v = handValue(h.cards).total;
  if (v > 21) { h.finished = true; h.result = '爆牌'; nextHandOrDealer(); }
  else if (v === 21) { finishPlayerHand(); }
  msg('已補牌。');
  update();
}
function stand() { beginFromChoice(); if (state.phase !== 'player') return; finishPlayerHand(); msg('已停牌。'); update(); }
function doubleDown() {
  beginFromChoice();
  const h = activeHand();
  if (!h || state.phase !== 'player' || h.cards.length !== 2 || !canAfford(h.bet)) return;
  state.cash -= h.bet;
  h.bet *= 2;
  h.cards.push(draw());
  h.note = 'Double：只補一張';
  state.actionsTaken = true;
  finishPlayerHand();
  update();
}
function split() {
  beginFromChoice();
  const h = activeHand();
  if (!canSplit(h)) return;
  state.cash -= h.bet;
  state.splitCount++;
  const c2 = h.cards.pop();
  const splitA = h.cards[0].r === 'A';
  h.cards.push(draw());
  h.wasSplitA = splitA;
  h.lockedOneCard = splitA;
  h.finished = splitA;
  h.note = splitA ? 'AA 分牌：只補一張，不能再分 A' : '';
  const newH = { cards: [c2, draw()], bet: h.bet, finished: splitA, result: '', note: splitA ? 'AA 分牌：只補一張，不能再分 A' : '', lockedOneCard: splitA, wasSplitA: splitA };
  state.hands.splice(state.active + 1, 0, newH);
  state.actionsTaken = false;
  msg(splitA ? '已分 AA；每手只補一張，自動完成。' : '已分牌。');
  if (splitA) nextHandOrDealer();
  update();
}
function surrender() {
  beginFromChoice();
  const h = activeHand();
  if (!h || state.actionsTaken || state.dealer[0]?.r === 'A') return;
  h.finished = true;
  h.result = '投降，輸一半';
  state.cash += h.bet / 2;
  nextHandOrDealer();
  update();
}
function finishPlayerHand(fromBJ = false) { const h = activeHand(); h.finished = true; if (fromBJ) h.note = 'Blackjack 等結果'; nextHandOrDealer(); }
function nextHandOrDealer() {
  for (let i = 0; i < state.hands.length; i++) {
    if (!state.hands[i].finished) { state.active = i; state.actionsTaken = false; return; }
  }
  dealerPlayAndSettle();
}
function dealerPlayAndSettle() { state.phase = 'dealer'; while (handValue(state.dealer).total < 17) state.dealer.push(draw()); settle(); }
function settle() {
  const dv = handValue(state.dealer);
  const dealerBJ = isBJ(state.dealer);
  const deltas = [];
  let insuranceDelta = 0;
  if (state.insuranceBet > 0) {
    if (state.dealer[0].r === 'A' && dealerBJ) { state.cash += state.insuranceBet * 3; insuranceDelta = state.insuranceBet * 2; }
    else { insuranceDelta = -state.insuranceBet; }
  }
  for (const h of state.hands) {
    if (h.result && h.result.startsWith('投降')) { deltas.push({ label: h.result, delta: -h.bet / 2 }); continue; }
    const pv = handValue(h.cards);
    let delta = -h.bet;
    if (pv.total > 21) { h.result = '輸（爆牌）'; delta = -h.bet; }
    else if (isBJ(h.cards) && !h.wasSplitA) {
      if (dealerBJ) { h.result = 'Blackjack 打和'; state.cash += h.bet; delta = 0; }
      else { h.result = 'Blackjack 贏 1.5'; state.cash += h.bet * 2.5; delta = h.bet * 1.5; }
    } else if (dv.total > 21) { h.result = '贏（莊爆）'; state.cash += h.bet * 2; delta = h.bet; }
    else if (pv.total > dv.total) { h.result = '贏'; state.cash += h.bet * 2; delta = h.bet; }
    else if (pv.total < dv.total) { h.result = '輸'; delta = -h.bet; }
    else { h.result = '打和'; state.cash += h.bet; delta = 0; }
    deltas.push({ label: h.result, delta });
  }
  state.phase = 'roundOver';
  logRound(deltas, insuranceDelta);
  msg('本鋪完成。可以開新一鋪。');
  update();
}
function logRound(deltas, insuranceDelta) {
  const total = deltas.reduce((s, d) => s + d.delta, 0) + insuranceDelta;
  state.ledger.unshift({
    round: state.round,
    bet: state.baseBet,
    dealer: handText(state.dealer) + ' (' + handValue(state.dealer).total + ')',
    results: state.hands.map((h, i) => `手${i + 1}: ${handText(h.cards)} → ${h.result}`).join('<br>'),
    insurance: state.insuranceBet ? `${money(state.insuranceBet)} / ${insuranceDelta >= 0 ? '+' : ''}${money(insuranceDelta)}` : '—',
    delta: total,
    balance: state.cash,
  });
}
function renderLedger() {
  $('ledgerBody').innerHTML = state.ledger.map(r => `<tr><td>${r.round}</td><td>${money(r.bet)}</td><td>${r.dealer}</td><td>${r.results}</td><td>${r.insurance}</td><td class="${r.delta >= 0 ? 'gain' : 'loss'}">${r.delta >= 0 ? '+' : ''}${money(r.delta)}</td><td>${money(r.balance)}</td></tr>`).join('');
}

$('newSession').onclick = startSession;
$('topUp').onclick = topUp;
$('betCount').oninput = updateBetPreview;
$('deal').onclick = newRound;
$('hit').onclick = hit;
$('stand').onclick = stand;
$('double').onclick = doubleDown;
$('split').onclick = split;
$('surrender').onclick = surrender;
$('insurance').onclick = buyInsurance;
$('noInsurance').onclick = noInsurance;
$('bjTake').onclick = blackjackTake;
$('bjWait').onclick = blackjackWait;
startSession();
