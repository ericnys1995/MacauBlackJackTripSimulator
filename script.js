const $ = (id) => document.getElementById(id);
const suits = ['♠', '♥', '♦', '♣'];
const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const MAIN_MIN = 500;
const PAIR_MIN = 50;
const SIDE13_MIN = 100;
const PAIR_PAYOUT = 11;
const SIDE13_PAYOUT = 1;

const BET_TYPES = {
  main: { label: '主注', min: MAIN_MIN, hint: '最少 $500' },
  pair: { label: 'PAIR', min: PAIR_MIN, hint: '1 賠 11｜最少 $50' },
  under13: { label: '-13', min: SIDE13_MIN, hint: '最少 $100' },
  over13: { label: '+13', min: SIDE13_MIN, hint: '最少 $100' },
};

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
  pendingBets: [],
  selectedBet: { door: 0, type: 'main' },
  doorCount: 1,
  roundBets: [],
  baseBet: 0,
  sideStake: 0,
  totalStake: 0,
  extraStake: 0,
  insuranceBet: 0,
  insuranceChoiceDone: false,
  insuranceDelta: 0,
  sideDelta: 0,
  sideSummary: '—',
  splitCount: 0,
  actionsTaken: false,
  reloadPromptOpen: false,
};

function money(n) {
  const value = Math.round(Number(n) || 0);
  const sign = value < 0 ? '-' : '';
  return sign + '$' + Math.abs(value).toLocaleString('en-US');
}
function blankBet() { return { main: 0, pair: 0, under13: 0, over13: 0 }; }
function resetPendingBets() {
  state.pendingBets = [blankBet(), blankBet(), blankBet()];
  state.pendingBets[0].main = MAIN_MIN;
  state.selectedBet = { door: 0, type: 'main' };
}
function isMobileUI() { return window.matchMedia('(max-width: 760px)').matches; }
function getDoorCount() {
  return isMobileUI() ? 1 : Math.max(1, Math.min(3, Number($('doorCount')?.value || 1)));
}
function canEditBets() { return state.phase === 'idle' || state.phase === 'roundOver'; }
function enforceDoorLimit() {
  const selector = $('doorCount');
  if (!selector) return;
  if (isMobileUI()) {
    selector.value = '1';
    selector.disabled = true;
  } else {
    selector.disabled = !canEditBets();
  }
  state.doorCount = getDoorCount();
  if (state.selectedBet.door >= state.doorCount) state.selectedBet = { door: 0, type: 'main' };
}
function doorBetTotal(b) { return b.main + b.pair + b.under13 + b.over13; }
function mainTotal(limit = getDoorCount()) { return state.pendingBets.slice(0, limit).reduce((sum, b) => sum + b.main, 0); }
function pendingTotal(limit = getDoorCount()) { return state.pendingBets.slice(0, limit).reduce((sum, b) => sum + doorBetTotal(b), 0); }
function pendingSideTotal(limit = getDoorCount()) { return state.pendingBets.slice(0, limit).reduce((sum, b) => sum + b.pair + b.under13 + b.over13, 0); }
function cardValue(c) { if (c.r === 'A') return 11; if (['J', 'Q', 'K'].includes(c.r)) return 10; return Number(c.r); }
function handValue(cards) {
  let total = cards.reduce((s, c) => s + cardValue(c), 0);
  let aces = cards.filter(c => c.r === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
function isBJ(cards) { return cards.length === 2 && handValue(cards).total === 21; }
function isNaturalBJ(h) { return h && !h.fromSplit && isBJ(h.cards); }
function shuffle() {
  const d = [];
  for (let k = 0; k < 6; k++) for (const s of suits) for (const r of ranks) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
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
  enforceDoorLimit();
  document.body.classList.toggle('round-active', !canEditBets());
  document.body.classList.toggle('mobile-game', isMobileUI());
  $('cash').textContent = money(state.cash);
  $('reserve').textContent = money(state.reserve);
  $('handsPlayed').textContent = state.round;
  $('net').textContent = money(state.cash + state.reserve - (state.initialCash + state.initialReserve));
  $('dealerCards').innerHTML = state.dealer.map(cardHTML).join('');
  const dv = state.dealer.length ? handValue(state.dealer) : null;
  $('dealerScore').textContent = dv ? `點數 ${dv.total}${dv.soft ? ' soft' : ''}` : '';
  renderPlayerHands();
  renderBettingBoard();
  updateBjLabels();

  const h = activeHand();
  const dealerA = state.dealer[0]?.r === 'A';
  const playerPhase = state.phase === 'player' || state.phase === 'choice';
  $('deal').disabled = !canEditBets();
  $('hit').disabled = !playerPhase || !h || h.lockedOneCard;
  $('stand').disabled = !playerPhase || !h || h.lockedOneCard;
  $('double').disabled = !playerPhase || !h || state.actionsTaken || h.cards.length !== 2 || !canAfford(h.bet);
  $('split').disabled = !playerPhase || !h || state.actionsTaken || !canSplit(h);
  $('surrender').disabled = !playerPhase || !h || state.actionsTaken || dealerA;
  $('insurance').disabled = !(state.phase === 'choice' && dealerA && !state.insuranceChoiceDone && state.insuranceBet === 0 && canAfford(state.baseBet / 2));
  $('noInsurance').disabled = !(state.phase === 'choice' && dealerA && !state.insuranceChoiceDone);
  $('bjTake').disabled = !(state.phase === 'bjChoice');
  $('bjWait').disabled = !(state.phase === 'bjChoice');

  document.querySelectorAll('.chip-rack button').forEach(btn => {
    if (btn.id === 'clearBetCell' || btn.id === 'clearAllBets' || btn.dataset.chip) btn.disabled = !canEditBets();
  });
  if ($('doorCount')) $('doorCount').disabled = isMobileUI() || !canEditBets();
  renderLedger();
}
function msg(t) { $('message').innerHTML = t; }

function selectedBetLabel() {
  const info = BET_TYPES[state.selectedBet.type];
  return `第 ${state.selectedBet.door + 1} 門 ${info.label}`;
}
function renderBettingBoard() {
  const board = $('bettingBoard');
  if (!board) return;
  if (!state.pendingBets.length) resetPendingBets();
  const count = getDoorCount();
  const locked = !canEditBets();
  const total = pendingTotal(count);
  const side = pendingSideTotal(count);
  $('bettingTotal').textContent = `今鋪下注：${money(total)}`;
  $('bettingHelp').textContent = locked
    ? '牌局進行中，今鋪投注已鎖定。'
    : `已選：${selectedBetLabel()}。主注最少 ${money(MAIN_MIN)}；Pair 最少 ${money(PAIR_MIN)}；-13/+13 最少 ${money(SIDE13_MIN)}。`;

  let html = `<div class="bet-doors ${locked ? 'locked-bet' : ''}">`;
  for (let i = 0; i < count; i++) {
    const b = state.pendingBets[i];
    html += `<div class="bet-door"><div class="bet-door-head"><b>第 ${i + 1} 門</b><span>總 ${money(doorBetTotal(b))}</span></div><div class="bet-grid">`;
    for (const type of Object.keys(BET_TYPES)) {
      const info = BET_TYPES[type];
      const value = b[type];
      const selected = state.selectedBet.door === i && state.selectedBet.type === type;
      html += `<button type="button" class="bet-cell ${selected ? 'selected' : ''} ${value > 0 ? 'has-bet' : ''}" data-door="${i}" data-type="${type}" ${locked ? 'disabled' : ''}>
        <span>${info.label}</span><b>${money(value)}</b><small>${info.hint}</small>
      </button>`;
    }
    html += `</div></div>`;
  }
  html += `</div>`;
  if (isMobileUI()) html += `<div class="mini" style="margin-top:6px">手機版固定 1 門。</div>`;
  if (side > 0) html += `<div class="side-line">邊注合計：${money(side)}。Pair 1賠11；-13/+13 暫以 1賠1 計。</div>`;
  board.innerHTML = html;
}

function renderPlayerHands() {
  const container = $('playerHands');
  if (!state.hands.length) {
    container.innerHTML = '';
    $('roundInfo').textContent = canEditBets() ? '先喺下注區揀籌碼' : '';
    return;
  }
  const active = activeHand();
  $('roundInfo').textContent = active ? `目前第 ${active.door + 1} 門 / 共 ${state.hands.length} 手牌` : '';

  const blocks = state.roundBets.map(bet => {
    const hands = state.hands.map((h, index) => ({ h, index })).filter(item => item.h.door === bet.door);
    const sideText = bet.sideText ? `<div class="side-line">${bet.sideText}</div>` : '';
    const handsHTML = hands.map(({ h, index }) => `
      <div class="hand ${index === state.active && (state.phase === 'player' || state.phase === 'choice' || state.phase === 'bjChoice') ? 'active' : ''}">
        <div class="zone-title">
          <b>手牌 ${handNumberInDoor(index)} <span class="pill">注 ${money(h.bet)}</span> ${h.finished ? '<span class="pill">完成</span>' : ''}</b>
          <span>${h.cards.length ? `點數 ${handValue(h.cards).total}${handValue(h.cards).soft ? ' soft' : ''}` : ''}</span>
        </div>
        <div class="cards">${h.cards.map(cardHTML).join('')}</div>
        <div class="mini">${h.note || ''}</div><div class="result">${h.result || ''}</div>
      </div>`).join('');
    return `<div class="door-play-block">
      <div class="door-play-head"><b>第 ${bet.door + 1} 門</b><span>主注 ${money(bet.main)}｜Pair ${money(bet.pair)}｜-13 ${money(bet.under13)}｜+13 ${money(bet.over13)}</span></div>
      ${sideText}${handsHTML}
    </div>`;
  }).join('');
  container.innerHTML = blocks;
}
function handNumberInDoor(globalIndex) {
  const h = state.hands[globalIndex];
  if (!h) return globalIndex + 1;
  return state.hands.filter((x, i) => x.door === h.door && i <= globalIndex).length;
}
function updateBjLabels() {
  const h = activeHand();
  const dealerA = state.dealer[0]?.r === 'A';
  if (state.phase === 'bjChoice' && h) {
    $('bjTake').textContent = dealerA ? 'BJ 即收 1:1' : 'BJ 收 1.5';
  } else {
    $('bjTake').textContent = 'BJ 即收';
  }
}

function canSplit(h) {
  if (!h || h.cards.length !== 2) return false;
  if (state.splitCount >= 4) return false;
  const a = h.cards[0].r, b = h.cards[1].r;
  if (a !== b) return false;
  if (a === 'A' && h.wasSplitA) return false;
  return canAfford(h.bet);
}

function startSession(fromBoarding = false) {
  const cashSource = fromBoarding ? $('boardingCash') : $('startCash');
  const reserveSource = fromBoarding ? $('boardingReserve') : $('reserveCash');
  state.cash = Math.max(0, Number(cashSource.value || 0));
  state.reserve = Math.max(0, Number(reserveSource.value || 0));
  state.initialCash = state.cash;
  state.initialReserve = state.reserve;
  state.topUpUsed = false;
  state.round = 0;
  state.ledger = [];
  state.phase = 'idle';
  state.hands = [];
  state.dealer = [];
  state.roundBets = [];
  state.insuranceBet = 0;
  state.insuranceChoiceDone = false;
  resetPendingBets();
  $('startCash').value = state.cash;
  $('reserveCash').value = state.reserve;
  msg('新局開始。先喺下注區揀籌碼，再按「開新一鋪」。');
  update();
}
function boardShip() {
  startSession(true);
  $('boardingModal').classList.remove('show');
  document.body.classList.remove('modal-open');
}
function topUp() {
  if (state.topUpUsed) { msg('已經覆桌過一次，不能再補。'); return false; }
  if (state.reserve <= 0) { msg('後備彈藥已經無錢可補。'); return false; }
  state.cash += state.reserve;
  state.reserve = 0;
  state.topUpUsed = true;
  msg('已覆桌：後備彈藥已補入主錢包。');
  update();
  return true;
}
function showReloadPrompt(reason = '你一開始嗰份子彈已經唔夠再開新一鋪。') {
  $('reloadCopy').textContent = reason;
  state.reloadPromptOpen = true;
  $('reloadModal').classList.add('show');
  document.body.classList.add('modal-open');
}
function closeReloadPrompt() {
  state.reloadPromptOpen = false;
  $('reloadModal').classList.remove('show');
  document.body.classList.remove('modal-open');
}
function validateBets(count) {
  for (let i = 0; i < count; i++) {
    const b = state.pendingBets[i];
    if (b.main < MAIN_MIN) return `第 ${i + 1} 門主注最少要 ${money(MAIN_MIN)}。`;
    if (b.pair > 0 && b.pair < PAIR_MIN) return `第 ${i + 1} 門 Pair 最少要 ${money(PAIR_MIN)}。`;
    if (b.under13 > 0 && b.under13 < SIDE13_MIN) return `第 ${i + 1} 門 -13 最少要 ${money(SIDE13_MIN)}。`;
    if (b.over13 > 0 && b.over13 < SIDE13_MIN) return `第 ${i + 1} 門 +13 最少要 ${money(SIDE13_MIN)}。`;
  }
  return '';
}
function canCoverOrPrompt(total) {
  if (state.cash >= total) return true;
  if (!state.topUpUsed && state.reserve > 0) {
    showReloadPrompt(`今鋪下注要 ${money(total)}，主錢包得 ${money(state.cash)}。返香港，定覆桌用後備彈藥？`);
    return false;
  }
  msg(`主錢包唔夠下注：今鋪要 ${money(total)}，目前得 ${money(state.cash)}。`);
  return false;
}

async function newRound() {
  if (!canEditBets()) return;
  enforceDoorLimit();
  const count = getDoorCount();
  const error = validateBets(count);
  if (error) { msg(error); update(); return; }
  const total = pendingTotal(count);
  if (!canCoverOrPrompt(total)) return;

  shuffle();
  state.cash -= total;
  state.round++;
  state.phase = 'dealing';
  state.dealer = [];
  state.hands = [];
  state.active = 0;
  state.roundBets = state.pendingBets.slice(0, count).map((b, i) => ({ ...b, door: i, sideText: '' }));
  state.baseBet = state.roundBets.reduce((sum, b) => sum + b.main, 0);
  state.sideStake = state.roundBets.reduce((sum, b) => sum + b.pair + b.under13 + b.over13, 0);
  state.totalStake = total;
  state.extraStake = 0;
  state.insuranceBet = 0;
  state.insuranceChoiceDone = false;
  state.insuranceDelta = 0;
  state.sideDelta = 0;
  state.sideSummary = '—';
  state.splitCount = 0;
  state.actionsTaken = false;

  for (const bet of state.roundBets) {
    state.hands.push({ door: bet.door, cards: [], bet: bet.main, finished: false, settled: false, result: '', note: '', lockedOneCard: false, wasSplitA: false, fromSplit: false, bjDecisionDone: false, bjWait: false, delta: 0 });
  }

  msg('派牌中：先派每門玩家第 1 張。'); update(); await sleep(260);
  for (const h of state.hands) { h.cards.push(draw()); update(); await sleep(170); }
  msg('派牌中：再派莊家 1 張明牌。'); update(); await sleep(360);
  state.dealer.push(draw()); update(); await sleep(420);
  msg('派牌中：最後派每門玩家第 2 張。'); update(); await sleep(250);
  for (const h of state.hands) { h.cards.push(draw()); update(); await sleep(170); }

  resolveSideBets();
  msg('派牌完成，準備開始動作。'); update(); await sleep(200);
  proceedAfterInitialDeal();
  update();
}

function side13Total(cards) { return handValue(cards).total; }
function resolveSideBets() {
  const summaries = [];
  state.sideDelta = 0;
  for (const bet of state.roundBets) {
    const h = state.hands.find(x => x.door === bet.door && !x.fromSplit);
    if (!h) continue;
    const parts = [];
    if (bet.pair > 0) {
      const win = h.cards[0].r === h.cards[1].r;
      const delta = win ? bet.pair * PAIR_PAYOUT : -bet.pair;
      if (win) state.cash += bet.pair * (PAIR_PAYOUT + 1);
      state.sideDelta += delta;
      parts.push(`Pair ${win ? '+' : ''}${money(delta)}`);
    }
    const total = side13Total(h.cards);
    if (bet.under13 > 0) {
      const win = total < 13;
      const delta = win ? bet.under13 * SIDE13_PAYOUT : -bet.under13;
      if (win) state.cash += bet.under13 * (SIDE13_PAYOUT + 1);
      state.sideDelta += delta;
      parts.push(`-13(${total}) ${win ? '+' : ''}${money(delta)}`);
    }
    if (bet.over13 > 0) {
      const win = total > 13;
      const delta = win ? bet.over13 * SIDE13_PAYOUT : -bet.over13;
      if (win) state.cash += bet.over13 * (SIDE13_PAYOUT + 1);
      state.sideDelta += delta;
      parts.push(`+13(${total}) ${win ? '+' : ''}${money(delta)}`);
    }
    bet.sideText = parts.join('｜');
    if (parts.length) summaries.push(`第${bet.door + 1}門：${parts.join('，')}`);
  }
  state.sideSummary = summaries.length ? summaries.join('<br>') : '—';
}
function proceedAfterInitialDeal() {
  const firstBJ = state.hands.findIndex(h => isNaturalBJ(h) && !h.bjDecisionDone);
  if (firstBJ >= 0) {
    state.active = firstBJ;
    state.phase = 'bjChoice';
    const dealerA = state.dealer[0]?.r === 'A';
    msg(dealerA ? '你有 Blackjack，而莊家 A 面：可即收 1:1，或者等莊家補牌結果。' : '你有 Blackjack：可即收 1.5，或者等結果。');
    return;
  }
  const dealerA = state.dealer[0]?.r === 'A';
  if (dealerA && !state.insuranceChoiceDone) {
    state.phase = 'choice';
    const firstPlayable = state.hands.findIndex(h => !h.finished);
    state.active = firstPlayable >= 0 ? firstPlayable : 0;
    msg('莊家 A 面：不能投降。你可以買保險、唔買，或者直接開始動作。');
    return;
  }
  startPlayerActions();
}
function startPlayerActions() {
  const firstPlayable = state.hands.findIndex(h => !h.finished && !h.settled);
  if (firstPlayable >= 0) {
    state.phase = 'player';
    state.active = firstPlayable;
    state.actionsTaken = false;
    msg(state.dealer[0]?.r === 'A' ? '開始動作。莊家 A 面不能投降。' : '開始動作。莊家非 A，可以投降輸一半。');
  } else {
    dealerPlayAndSettle();
  }
}
function beginFromChoice() {
  if (state.phase === 'choice') {
    state.insuranceChoiceDone = true;
    state.phase = 'player';
    msg('開始動作。');
  }
}
function buyInsurance() {
  if (state.phase !== 'choice') return;
  const amt = state.baseBet / 2;
  if (!canAfford(amt)) { msg('唔夠錢買保險。'); return; }
  state.cash -= amt;
  state.insuranceBet = amt;
  state.insuranceChoiceDone = true;
  state.phase = 'player';
  msg(`已買保險 ${money(amt)}。繼續玩家動作。`);
  update();
}
function noInsurance() {
  if (state.phase !== 'choice') return;
  state.insuranceChoiceDone = true;
  state.phase = 'player';
  msg('你選擇唔買保險，繼續玩家動作。');
  update();
}
function blackjackTake() {
  if (state.phase !== 'bjChoice') return;
  const h = activeHand();
  const dealerA = state.dealer[0]?.r === 'A';
  const profit = dealerA ? h.bet : h.bet * 1.5;
  const returnAmount = h.bet + profit;
  state.cash += returnAmount;
  h.finished = true;
  h.settled = true;
  h.bjDecisionDone = true;
  h.result = dealerA ? 'Blackjack 即收 1:1' : 'Blackjack 即收 1.5';
  h.delta = profit;
  msg(`${h.result}。`);
  proceedAfterInitialDeal();
  if (state.phase === 'player') startPlayerActions();
  update();
}
function blackjackWait() {
  if (state.phase !== 'bjChoice') return;
  const h = activeHand();
  h.finished = true;
  h.bjDecisionDone = true;
  h.bjWait = true;
  h.note = 'Blackjack 等結果';
  proceedAfterInitialDeal();
  update();
}
function hit() {
  beginFromChoice();
  const h = activeHand();
  if (!h || state.phase !== 'player') return;
  h.cards.push(draw());
  state.actionsTaken = true;
  const v = handValue(h.cards).total;
  if (v > 21) { h.finished = true; h.result = '爆牌'; h.delta = -h.bet; }
  else if (v === 21) { h.finished = true; }
  msg('已補牌。');
  nextHandOrDealer();
  update();
}
function stand() {
  beginFromChoice();
  if (state.phase !== 'player') return;
  const h = activeHand();
  h.finished = true;
  msg('已停牌。');
  nextHandOrDealer();
  update();
}
function doubleDown() {
  beginFromChoice();
  const h = activeHand();
  if (!h || state.phase !== 'player' || h.cards.length !== 2 || !canAfford(h.bet)) return;
  state.cash -= h.bet;
  state.extraStake += h.bet;
  h.bet *= 2;
  h.cards.push(draw());
  h.note = 'Double：只補一張';
  state.actionsTaken = true;
  h.finished = true;
  msg('已 Double，只補一張。');
  nextHandOrDealer();
  update();
}
function split() {
  beginFromChoice();
  const h = activeHand();
  if (!canSplit(h)) return;
  state.cash -= h.bet;
  state.extraStake += h.bet;
  state.splitCount++;
  const c2 = h.cards.pop();
  const splitA = h.cards[0].r === 'A';
  h.cards.push(draw());
  h.wasSplitA = splitA;
  h.fromSplit = true;
  h.lockedOneCard = splitA;
  h.finished = splitA;
  h.note = splitA ? 'AA 分牌：只補一張，不能再分 A' : '';
  const newH = { door: h.door, cards: [c2, draw()], bet: h.bet, finished: splitA, settled: false, result: '', note: splitA ? 'AA 分牌：只補一張，不能再分 A' : '', lockedOneCard: splitA, wasSplitA: splitA, fromSplit: true, bjDecisionDone: true, bjWait: false, delta: 0 };
  state.hands.splice(state.active + 1, 0, newH);
  state.actionsTaken = false;
  msg(splitA ? '已分 AA；每手只補一張，自動完成。' : '已分牌。');
  nextHandOrDealer();
  update();
}
function surrender() {
  beginFromChoice();
  const h = activeHand();
  if (!h || state.actionsTaken || state.dealer[0]?.r === 'A') return;
  h.finished = true;
  h.settled = true;
  h.result = '投降，輸一半';
  h.delta = -h.bet / 2;
  state.cash += h.bet / 2;
  msg('已投降，輸一半。');
  nextHandOrDealer();
  update();
}
function nextHandOrDealer() {
  for (let i = 0; i < state.hands.length; i++) {
    if (!state.hands[i].finished) {
      state.active = i;
      state.actionsTaken = false;
      state.phase = 'player';
      return;
    }
  }
  dealerPlayAndSettle();
}
function needsDealerResult() {
  return state.hands.some(h => !h.settled && handValue(h.cards).total <= 21);
}
function dealerPlayAndSettle() {
  state.phase = 'dealer';
  if (needsDealerResult()) {
    while (handValue(state.dealer).total < 17) state.dealer.push(draw());
  }
  settle();
}
function settle() {
  const dv = handValue(state.dealer);
  const dealerBJ = isBJ(state.dealer);
  state.insuranceDelta = 0;
  if (state.insuranceBet > 0) {
    if (state.dealer[0]?.r === 'A' && dealerBJ) {
      state.cash += state.insuranceBet * 3;
      state.insuranceDelta = state.insuranceBet * 2;
    } else {
      state.insuranceDelta = -state.insuranceBet;
    }
  }

  for (const h of state.hands) {
    if (h.settled) continue;
    const pv = handValue(h.cards);
    if (pv.total > 21) {
      h.result = '輸（爆牌）';
      h.delta = -h.bet;
    } else if (isNaturalBJ(h)) {
      if (dv.total === 21) {
        h.result = 'Blackjack 打和';
        state.cash += h.bet;
        h.delta = 0;
      } else {
        h.result = 'Blackjack 贏 1.5';
        state.cash += h.bet * 2.5;
        h.delta = h.bet * 1.5;
      }
    } else if (dv.total > 21) {
      h.result = '贏（莊爆）';
      state.cash += h.bet * 2;
      h.delta = h.bet;
    } else if (pv.total > dv.total) {
      h.result = '贏';
      state.cash += h.bet * 2;
      h.delta = h.bet;
    } else if (pv.total < dv.total) {
      h.result = '輸';
      h.delta = -h.bet;
    } else {
      h.result = '打和';
      state.cash += h.bet;
      h.delta = 0;
    }
    h.settled = true;
  }
  state.phase = 'roundOver';
  logRound();
  msg('本鋪完成。可以開新一鋪。');
  update();
}
function logRound() {
  const handDelta = state.hands.reduce((sum, h) => sum + (h.delta || 0), 0);
  const total = handDelta + state.sideDelta + state.insuranceDelta;
  const mainText = `主注 ${money(state.baseBet)} / 邊注 ${money(state.sideStake)} / 總 ${money(state.totalStake + state.extraStake)}`;
  const dealerText = state.dealer.length ? handText(state.dealer) + ' (' + handValue(state.dealer).total + ')' : '—';
  const results = state.hands.map((h, i) => `第${h.door + 1}門 手${handNumberInDoor(i)}: ${handText(h.cards)} → ${h.result || '完成'}`).join('<br>');
  const insurance = state.insuranceBet ? `${money(state.insuranceBet)} / ${state.insuranceDelta >= 0 ? '+' : ''}${money(state.insuranceDelta)}` : '—';
  state.ledger.unshift({
    round: state.round,
    bet: mainText,
    dealer: dealerText,
    results,
    side: state.sideSummary,
    insurance,
    delta: total,
    balance: state.cash,
  });
}
function renderLedger() {
  $('ledgerBody').innerHTML = state.ledger.map(r => `<tr><td>${r.round}</td><td>${r.bet}</td><td>${r.dealer}</td><td>${r.results}</td><td>${r.side}</td><td>${r.insurance}</td><td class="${r.delta >= 0 ? 'gain' : 'loss'}">${r.delta >= 0 ? '+' : ''}${money(r.delta)}</td><td>${money(r.balance)}</td></tr>`).join('');
}

function addChip(amount) {
  if (!canEditBets()) return;
  const { door, type } = state.selectedBet;
  state.pendingBets[door][type] += amount;
  update();
}
function clearSelectedBet() {
  if (!canEditBets()) return;
  const { door, type } = state.selectedBet;
  state.pendingBets[door][type] = 0;
  update();
}
function clearAllBets() {
  if (!canEditBets()) return;
  for (let i = 0; i < 3; i++) state.pendingBets[i] = blankBet();
  update();
}

document.addEventListener('click', (e) => {
  const cell = e.target.closest('.bet-cell');
  if (cell && canEditBets()) {
    state.selectedBet = { door: Number(cell.dataset.door), type: cell.dataset.type };
    update();
    return;
  }
  const chip = e.target.closest('[data-chip]');
  if (chip) addChip(Number(chip.dataset.chip));
});
window.addEventListener('resize', update);

$('boardingOk').onclick = boardShip;
$('newSession').onclick = () => startSession(false);
$('topUp').onclick = topUp;
$('doorCount').onchange = () => { enforceDoorLimit(); update(); };
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
$('clearBetCell').onclick = clearSelectedBet;
$('clearAllBets').onclick = clearAllBets;
$('goHome').onclick = () => { closeReloadPrompt(); state.phase = 'quit'; msg('今次旅程完結：返香港。'); update(); };
$('reloadTable').onclick = () => { closeReloadPrompt(); if (topUp()) msg('已覆桌。你可以再按「開新一鋪」。'); };

resetPendingBets();
update();
