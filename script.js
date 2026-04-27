const $ = (id) => document.getElementById(id);
const suits = ['♠', '♥', '♦', '♣'];
const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const CHIPS = [25, 100, 500, 1000];
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
function pendingTotal(limit = getDoorCount()) {
  return state.pendingBets.slice(0, limit).reduce((sum, b) => sum + doorBetTotal(b), 0);
}
function pendingSideTotal(limit = getDoorCount()) {
  return state.pendingBets.slice(0, limit).reduce((sum, b) => sum + b.pair + b.under13 + b.over13, 0);
}
function cardValue(c) { if (c.r === 'A') return 11; if (['J', 'Q', 'K'].includes(c.r)) return 10; return Number(c.r); }
function handValue(cards) {
  let total = cards.reduce((s, c) => s + cardValue(c), 0);
  let aces = cards.filter(c => c.r === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
function isBJ(cards) { return cards.length === 2 && handValue(cards).total === 21; }
function isNaturalBJ(h) { return h && !h.fromSplit && isBJ(h.cards); }
function dealerHasBlackjack() { return state.dealer.length === 2 && handValue(state.dealer).total === 21; }
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

  renderBettingBoard();
  renderPlayerHands();
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
  if (isMobileUI()) html += `<div class="mini" style="margin-top:8px">手機版已固定 1 門，避免畫面太窄誤撳。</div>`;
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
  return state.hands.slice(0, globalIndex + 1).filter(item => item.door === h.door).length;
}
function canSplit(h) {
  if (!h || h.cards.length !== 2) return false;
  if (state.splitCount >= 4) return false;
  const a = h.cards[0].r, b = h.cards[1].r;
  if (a !== b) return false;
  if (a === 'A' && h.wasSplitA) return false;
  return canAfford(h.bet);
}

function validateBets() {
  const count = getDoorCount();
  const doors = [];
  for (let i = 0; i < count; i++) {
    const b = { ...state.pendingBets[i], door: i };
    const total = doorBetTotal(b);
    if (total === 0) continue;
    if (b.main < MAIN_MIN) return { ok: false, message: `第 ${i + 1} 門主注最少要 ${money(MAIN_MIN)}。` };
    if (b.pair > 0 && b.pair < PAIR_MIN) return { ok: false, message: `第 ${i + 1} 門 Pair 最少要 ${money(PAIR_MIN)}。` };
    if (b.under13 > 0 && b.under13 < SIDE13_MIN) return { ok: false, message: `第 ${i + 1} 門 -13 最少要 ${money(SIDE13_MIN)}。` };
    if (b.over13 > 0 && b.over13 < SIDE13_MIN) return { ok: false, message: `第 ${i + 1} 門 +13 最少要 ${money(SIDE13_MIN)}。` };
    doors.push(b);
  }
  if (!doors.length) return { ok: false, message: '請先落注。主注每門最少 $500。' };
  const totalStake = doors.reduce((sum, b) => sum + doorBetTotal(b), 0);
  if (state.cash < totalStake) return { ok: false, message: `主錢包唔夠下注。今鋪需要 ${money(totalStake)}。` };
  return { ok: true, doors, totalStake };
}
function addChip(value) {
  if (!canEditBets()) { msg('牌局進行中，不能改下注。'); return; }
  const count = getDoorCount();
  if (state.selectedBet.door >= count) state.selectedBet = { door: 0, type: 'main' };
  if (pendingTotal(count) + value > state.cash) { msg(`主錢包暫時只得 ${money(state.cash)}，唔夠再加呢粒籌碼。`); maybePromptReload(); return; }
  state.pendingBets[state.selectedBet.door][state.selectedBet.type] += value;
  msg(`已加 ${money(value)} 落 ${selectedBetLabel()}。`);
  update();
}
function clearSelectedBet() {
  if (!canEditBets()) return;
  state.pendingBets[state.selectedBet.door][state.selectedBet.type] = 0;
  msg(`已清空 ${selectedBetLabel()}。`);
  update();
}
function clearAllBets() {
  if (!canEditBets()) return;
  state.pendingBets = [blankBet(), blankBet(), blankBet()];
  state.selectedBet = { door: 0, type: 'main' };
  msg('已清空所有下注。');
  update();
}
function setSelectedBet(door, type) {
  if (!canEditBets()) return;
  state.selectedBet = { door: Number(door), type };
  update();
}

function showModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.classList.add('show');
  document.body.classList.add('modal-open');
}
function hideModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.classList.remove('show');
  if (!document.querySelector('.modal-backdrop.show')) document.body.classList.remove('modal-open');
}
function showBoardingModal() {
  $('boardingCash').value = $('startCash').value || state.initialCash || 5000;
  $('boardingReserve').value = $('reserveCash').value || state.initialReserve || 0;
  showModal('boardingModal');
}
function boardShip() {
  const cash = Math.max(0, Number($('boardingCash').value || 0));
  const reserve = Math.max(0, Number($('boardingReserve').value || 0));
  $('startCash').value = cash;
  $('reserveCash').value = reserve;
  hideModal('boardingModal');
  startSession(`OK 上船。今次子彈 ${money(cash)}，後備彈藥 ${money(reserve)}。先落注，再開新一鋪。`);
}
function startSession(customMessage) {
  state.cash = Math.max(0, Number($('startCash').value || 5000));
  state.reserve = Math.max(0, Number($('reserveCash').value || 0));
  state.initialCash = state.cash;
  state.initialReserve = state.reserve;
  state.topUpUsed = false;
  state.round = 0;
  state.ledger = [];
  state.phase = 'idle';
  state.hands = [];
  state.dealer = [];
  state.insuranceBet = 0;
  state.insuranceChoiceDone = false;
  state.roundBets = [];
  state.sideDelta = 0;
  state.sideSummary = '—';
  state.reloadPromptOpen = false;
  resetPendingBets();
  enforceDoorLimit();
  msg(customMessage || '新局開始。先喺玩家下注區揀主注 / Pair / -13 / +13，再按「開新一鋪」。');
  update();
  maybePromptReload();
}
function reloadAtTable() {
  if (state.topUpUsed) { msg('已經覆桌 / 補過一次，不能再補。'); return; }
  if (state.reserve <= 0) { msg('冇後備彈藥可以覆桌。'); return; }
  const amount = state.reserve;
  state.cash += amount;
  state.reserve = 0;
  state.topUpUsed = true;
  state.reloadPromptOpen = false;
  hideModal('reloadModal');
  if (state.phase === 'tripOver') state.phase = 'roundOver';
  msg(`已覆桌，用後備彈藥 ${money(amount)} 繼續玩。`);
  update();
}
function topUp() { reloadAtTable(); }
function goHome() {
  state.reloadPromptOpen = false;
  hideModal('reloadModal');
  state.phase = 'tripOver';
  msg('你揀咗返香港。今次行程完結，可以按「重新開局」再上船。');
  update();
}
function maybePromptReload() {
  if (state.reloadPromptOpen) return;
  if (!(state.phase === 'idle' || state.phase === 'roundOver')) return;
  if (state.cash >= MAIN_MIN) return;
  if (!state.topUpUsed && state.reserve > 0) {
    state.reloadPromptOpen = true;
    $('reloadCopy').textContent = `主錢包得返 ${money(state.cash)}，唔夠主注最少 ${money(MAIN_MIN)}。後備彈藥仲有 ${money(state.reserve)}。`;
    showModal('reloadModal');
  } else if (state.cash < MAIN_MIN) {
    state.phase = 'tripOver';
    msg('子彈唔夠再開新一鋪，而且冇後備彈藥。今次行程完結。');
    update();
  }
}

async function newRound() {
  if (!canEditBets()) return;
  const checked = validateBets();
  if (!checked.ok) { msg(checked.message); update(); maybePromptReload(); return; }

  shuffle();
  state.cash -= checked.totalStake;
  state.round++;
  state.roundBets = checked.doors.map(b => ({ ...b, sideText: '' }));
  state.baseBet = state.roundBets.reduce((sum, b) => sum + b.main, 0);
  state.sideStake = state.roundBets.reduce((sum, b) => sum + b.pair + b.under13 + b.over13, 0);
  state.totalStake = checked.totalStake;
  state.extraStake = 0;
  state.insuranceBet = 0;
  state.insuranceChoiceDone = false;
  state.sideDelta = 0;
  state.sideSummary = '—';
  state.splitCount = 0;
  state.actionsTaken = false;
  state.dealer = [];
  state.hands = state.roundBets.map(b => makeHand(b.door, b.main));
  state.active = 0;
  state.phase = 'dealing';

  for (const h of state.hands) {
    msg(`派牌中：先派第 ${h.door + 1} 門第 1 張。`);
    h.cards.push(draw());
    update();
    await sleep(360);
  }
  msg('派牌中：再派莊家 1 張明牌。');
  state.dealer.push(draw());
  update();
  await sleep(520);
  for (const h of state.hands) {
    msg(`派牌中：派第 ${h.door + 1} 門第 2 張。`);
    h.cards.push(draw());
    update();
    await sleep(520);
  }

  settleSideBets();
  msg('派牌完成，準備開始動作。');
  update();
  await sleep(220);
  beginNextDecision();
}
function makeHand(door, bet, cards = []) {
  return { door, cards, bet, finished: false, result: '', note: '', lockedOneCard: false, wasSplitA: false, fromSplit: false, settled: false, delta: null, bjWait: false };
}
function settleSideBets() {
  let sideDelta = 0;
  const summary = [];
  for (const bet of state.roundBets) {
    const h = state.hands.find(item => item.door === bet.door && !item.fromSplit);
    if (!h || h.cards.length < 2) continue;
    const entries = [];
    if (bet.pair > 0) {
      const win = h.cards[0].r === h.cards[1].r;
      const profit = win ? bet.pair * PAIR_PAYOUT : -bet.pair;
      if (win) state.cash += bet.pair * (PAIR_PAYOUT + 1);
      sideDelta += profit;
      entries.push(`Pair ${win ? '中' : '輸'} ${profit >= 0 ? '+' : ''}${money(profit)}`);
    }
    if (bet.under13 > 0) {
      const value = side13Value(h.cards);
      const win = value < 13;
      const profit = win ? bet.under13 * SIDE13_PAYOUT : -bet.under13;
      if (win) state.cash += bet.under13 * (SIDE13_PAYOUT + 1);
      sideDelta += profit;
      entries.push(`-13 ${win ? '中' : '輸'} (${value}) ${profit >= 0 ? '+' : ''}${money(profit)}`);
    }
    if (bet.over13 > 0) {
      const value = side13Value(h.cards);
      const win = value > 13;
      const profit = win ? bet.over13 * SIDE13_PAYOUT : -bet.over13;
      if (win) state.cash += bet.over13 * (SIDE13_PAYOUT + 1);
      sideDelta += profit;
      entries.push(`+13 ${win ? '中' : '輸'} (${value}) ${profit >= 0 ? '+' : ''}${money(profit)}`);
    }
    bet.sideText = entries.join('｜');
    if (entries.length) summary.push(`第 ${bet.door + 1} 門：${entries.join('｜')}`);
  }
  state.sideDelta = sideDelta;
  state.sideSummary = summary.length ? summary.join('<br>') : '—';
}
function side13Value(cards) { return handValue(cards.slice(0, 2)).total; }

function beginNextDecision() {
  for (let i = 0; i < state.hands.length; i++) {
    const h = state.hands[i];
    if (!h.finished) {
      state.active = i;
      state.actionsTaken = false;
      if (isNaturalBJ(h)) {
        state.phase = 'bjChoice';
        const dealerA = state.dealer[0]?.r === 'A';
        msg(dealerA
          ? `第 ${h.door + 1} 門 Blackjack，莊家 A 面：可即收 1:1，或者等莊家結果。`
          : `第 ${h.door + 1} 門 Blackjack：可即收 1.5，或者等莊家結果。`);
        update();
        return;
      }
      if (state.dealer[0]?.r === 'A' && !state.insuranceChoiceDone) {
        state.phase = 'choice';
        msg('莊家 A 面：不能投降。你可以買保險、唔買保險，或者直接補牌 / 停牌 / Double / Split。');
        update();
        return;
      }
      state.phase = 'player';
      msg(state.dealer[0]?.r === 'A' ? '開始動作。莊家 A 面不能投降。' : '開始動作。莊家非 A，可以投降輸一半。');
      update();
      return;
    }
  }
  if (state.hands.some(h => !h.settled) || state.insuranceBet > 0) dealerPlayAndSettle();
  else finishRoundFromSettledOnly();
}
function beginFromChoice() {
  if (state.phase === 'choice') {
    state.insuranceChoiceDone = true;
    state.phase = 'player';
    msg('你選擇唔買保險，繼續玩家動作。');
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
function updateBjLabels() {
  const dealerA = state.dealer[0]?.r === 'A';
  if ($('bjTake')) $('bjTake').textContent = dealerA ? 'BJ 即收 1:1' : 'BJ 收 1.5';
  if ($('bjWait')) $('bjWait').textContent = 'BJ 等結果';
}
function blackjackTake() {
  if (state.phase !== 'bjChoice') return;
  const h = activeHand();
  const dealerA = state.dealer[0]?.r === 'A';
  const profit = dealerA ? h.bet : h.bet * 1.5;
  state.cash += h.bet + profit;
  h.finished = true;
  h.settled = true;
  h.delta = profit;
  h.result = dealerA ? 'Blackjack 即收 1:1' : 'Blackjack 即收 1.5';
  h.note = '已即收，不等莊家';
  msg(h.result + '。');
  beginNextDecision();
}
function blackjackWait() {
  if (state.phase !== 'bjChoice') return;
  const h = activeHand();
  h.bjWait = true;
  h.note = 'Blackjack 等結果';
  finishPlayerHand(true);
}
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
function stand() {
  beginFromChoice();
  if (state.phase !== 'player') return;
  finishPlayerHand();
  msg('已停牌。');
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
  finishPlayerHand();
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
  h.fromSplit = true;
  h.cards.push(draw());
  h.wasSplitA = splitA;
  h.lockedOneCard = splitA;
  h.finished = splitA;
  h.note = splitA ? 'AA 分牌：只補一張，不能再分 A' : '';
  const newH = makeHand(h.door, h.bet, [c2, draw()]);
  newH.fromSplit = true;
  newH.wasSplitA = splitA;
  newH.lockedOneCard = splitA;
  newH.finished = splitA;
  newH.note = splitA ? 'AA 分牌：只補一張，不能再分 A' : '';
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
  h.settled = true;
  h.delta = -h.bet / 2;
  h.result = '投降，輸一半';
  state.cash += h.bet / 2;
  nextHandOrDealer();
  update();
}
function finishPlayerHand(fromBJ = false) {
  const h = activeHand();
  h.finished = true;
  if (fromBJ) h.note = 'Blackjack 等結果';
  nextHandOrDealer();
}
function nextHandOrDealer() { beginNextDecision(); }
function dealerPlayAndSettle() {
  state.phase = 'dealer';
  while (handValue(state.dealer).total < 17) state.dealer.push(draw());
  settle();
}
function settle() {
  const dv = handValue(state.dealer);
  const dealerBJ = dealerHasBlackjack();
  const deltas = [];
  let insuranceDelta = 0;

  if (state.insuranceBet > 0) {
    if (state.dealer[0].r === 'A' && dealerBJ) { state.cash += state.insuranceBet * 3; insuranceDelta = state.insuranceBet * 2; }
    else { insuranceDelta = -state.insuranceBet; }
  }

  for (const h of state.hands) {
    if (h.settled) { deltas.push({ label: h.result, delta: h.delta || 0 }); continue; }
    const pv = handValue(h.cards);
    let delta = -h.bet;
    if (pv.total > 21) { h.result = '輸（爆牌）'; delta = -h.bet; }
    else if (isNaturalBJ(h) || h.bjWait) {
      if (dealerBJ) { h.result = 'Blackjack 打和'; state.cash += h.bet; delta = 0; }
      else { h.result = 'Blackjack 贏 1.5'; state.cash += h.bet * 2.5; delta = h.bet * 1.5; }
    } else if (dv.total > 21) { h.result = '贏（莊爆）'; state.cash += h.bet * 2; delta = h.bet; }
    else if (pv.total > dv.total) { h.result = '贏'; state.cash += h.bet * 2; delta = h.bet; }
    else if (pv.total < dv.total) { h.result = '輸'; delta = -h.bet; }
    else { h.result = '打和'; state.cash += h.bet; delta = 0; }
    h.delta = delta;
    h.settled = true;
    deltas.push({ label: h.result, delta });
  }
  finishRound(deltas, insuranceDelta, '本鋪完成。可以開新一鋪。');
}
function finishRoundFromSettledOnly() {
  const deltas = state.hands.map(h => ({ label: h.result, delta: h.delta || 0 }));
  finishRound(deltas, 0, '本鋪完成。可以開新一鋪。');
}
function finishRound(deltas, insuranceDelta, message) {
  state.phase = 'roundOver';
  logRound(deltas, insuranceDelta);
  msg(message);
  update();
  maybePromptReload();
}
function logRound(deltas, insuranceDelta) {
  const mainStake = state.baseBet + state.extraStake;
  const betSummary = `主注 ${money(mainStake)}<br>邊注 ${money(state.sideStake)}`;
  const total = deltas.reduce((s, d) => s + d.delta, 0) + state.sideDelta + insuranceDelta;
  state.ledger.unshift({
    round: state.round,
    bet: betSummary,
    dealer: state.dealer.length ? handText(state.dealer) + ' (' + handValue(state.dealer).total + ')' : handText(state.dealer),
    results: state.roundBets.map(bet => {
      const handRows = state.hands
        .filter(h => h.door === bet.door)
        .map((h, idx) => `手${idx + 1}: ${handText(h.cards)} → ${h.result}`)
        .join('<br>');
      return `<b>第 ${bet.door + 1} 門</b><br>${handRows}`;
    }).join('<hr>'),
    side: state.sideSummary,
    insurance: state.insuranceBet ? `${money(state.insuranceBet)} / ${insuranceDelta >= 0 ? '+' : ''}${money(insuranceDelta)}` : '—',
    delta: total,
    balance: state.cash,
  });
}
function renderLedger() {
  $('ledgerBody').innerHTML = state.ledger.map(r => `<tr>
    <td>${r.round}</td><td>${r.bet}</td><td>${r.dealer}</td><td>${r.results}</td><td>${r.side}</td><td>${r.insurance}</td>
    <td class="${r.delta >= 0 ? 'gain' : 'loss'}">${r.delta >= 0 ? '+' : ''}${money(r.delta)}</td><td>${money(r.balance)}</td>
  </tr>`).join('');
}

$('newSession').onclick = showBoardingModal;
$('topUp').onclick = topUp;
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
$('doorCount').onchange = () => { enforceDoorLimit(); update(); };
$('bettingBoard').onclick = (event) => {
  const cell = event.target.closest('.bet-cell');
  if (!cell) return;
  setSelectedBet(cell.dataset.door, cell.dataset.type);
};
document.querySelectorAll('[data-chip]').forEach(btn => {
  btn.onclick = () => addChip(Number(btn.dataset.chip));
});
$('clearBetCell').onclick = clearSelectedBet;
$('clearAllBets').onclick = clearAllBets;
$('boardingOk').onclick = boardShip;
$('reloadTable').onclick = reloadAtTable;
$('goHome').onclick = goHome;
window.addEventListener('resize', () => { enforceDoorLimit(); update(); });

resetPendingBets();
update();
showBoardingModal();
