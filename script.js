const $ = (id) => document.getElementById(id);
const suits = ['♠','♥','♦','♣'];
const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const chips = [25,100,500,1000];
const isMobile = () => window.matchMedia('(max-width: 760px)').matches;

let state = {
  cash: 5000, reserve: 2500, initialCash: 5000, initialReserve: 2500, topUpUsed: false,
  shoe: [], dealer: [], spots: [], activeSpot: 0, activeHand: 0, phase: 'idle', round: 0, ledger: [],
  insuranceBet: 0, splitCount: 0, actionsTaken: false, selectedBet: { spot: 0, field: 'main' },
};

function money(n){ return '$' + Math.round(n).toLocaleString('en-US'); }
function cardValue(c){ if(c.r==='A') return 11; if(['J','Q','K'].includes(c.r)) return 10; return Number(c.r); }
function sideCardValue(c){ if(c.r==='A') return 1; if(['J','Q','K'].includes(c.r)) return 10; return Number(c.r); }
function handValue(cards){ let total=cards.reduce((s,c)=>s+cardValue(c),0); let aces=cards.filter(c=>c.r==='A').length; while(total>21&&aces>0){ total-=10; aces--; } return {total,soft:aces>0}; }
function isBJ(cards){ return cards.length===2 && handValue(cards).total===21; }
function handText(cards){ return cards.map(c=>c.r+c.s).join(' '); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function msg(t){ $('message').innerHTML=t; }
function enabledSpotCount(){ if(isMobile()) return 1; return Math.min(3, Math.max(1, Number($('spotCount')?.value || 1))); }
function blankSpot(i){ return { id:i, bets:{main: i===0 ? 500 : 0, pair:0, minus13:0, plus13:0}, sideDelta:0, sideText:'—', hands:[] }; }
function ensureSpots(){ while(state.spots.length<3) state.spots.push(blankSpot(state.spots.length)); if(isMobile() && $('spotCount')) $('spotCount').value='1'; }
function shuffle(){ const d=[]; for(let k=0;k<6;k++) for(const s of suits) for(const r of ranks) d.push({r,s}); for(let i=d.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [d[i],d[j]]=[d[j],d[i]]; } state.shoe=d; }
function draw(){ if(!state.shoe.length) shuffle(); return state.shoe.pop(); }
function canAfford(amount){ return state.cash>=amount; }
function cardHTML(c){ const red=(c.s==='♥'||c.s==='♦')?' red':''; return `<div class="playing-card${red}"><span>${c.r}</span><small>${c.s}</small></div>`; }
function activeSpot(){ return state.spots[state.activeSpot]; }
function activeHand(){ return activeSpot()?.hands[state.activeHand]; }
function totalMainBet(){ return state.spots.slice(0,enabledSpotCount()).reduce((s,sp)=>s+sp.bets.main,0); }

function renderBettingSpot(sp, i, locked){
  const sel = (f)=> state.selectedBet.spot===i && state.selectedBet.field===f ? ' selected' : '';
  return `<div class="spot ${i===state.selectedBet.spot && !locked ? 'active':''}">
    <div class="spot-head"><b>第 ${i+1} 門</b><span class="pill">今門總注 ${money(sp.bets.main+sp.bets.pair+sp.bets.minus13+sp.bets.plus13)}</span></div>
    <div class="bet-grid">
      <button class="bet-box${sel('main')}" data-spot="${i}" data-field="main" ${locked?'disabled':''}><span>主注｜最少 $500</span><b>${money(sp.bets.main)}</b></button>
      <button class="bet-box${sel('pair')}" data-spot="${i}" data-field="pair" ${locked?'disabled':''}><span>Pair｜1 賠 11｜最少 $50</span><b>${money(sp.bets.pair)}</b></button>
      <button class="bet-box${sel('minus13')}" data-spot="${i}" data-field="minus13" ${locked?'disabled':''}><span>-13｜最少 $100</span><b>${money(sp.bets.minus13)}</b></button>
      <button class="bet-box${sel('plus13')}" data-spot="${i}" data-field="plus13" ${locked?'disabled':''}><span>+13｜最少 $100</span><b>${money(sp.bets.plus13)}</b></button>
    </div>
    <div class="chip-row">
      ${chips.map(v=>`<button class="chip c${v}" data-chip="${v}" ${locked?'disabled':''}>${money(v)}</button>`).join('')}
      <button class="ghost mini-btn" data-clear="1" ${locked?'disabled':''}>清格</button>
    </div>
  </div>`;
}
function renderPlayingSpot(sp, si){
  return `<div class="spot ${si===state.activeSpot && (state.phase==='player'||state.phase==='choice'||state.phase==='bjChoice') ? 'active':''}">
    <div class="spot-head"><b>第 ${si+1} 門</b><span class="pill">邊注：${sp.sideText || '—'}</span></div>
    ${sp.hands.map((h,hi)=>`
      <div class="hand ${si===state.activeSpot&&hi===state.activeHand&&(state.phase==='player'||state.phase==='choice')?'active':''}">
        <div class="zone-title"><b>手牌 ${hi+1} <span class="pill">主注 ${money(h.bet)}</span> ${h.finished?'<span class="pill">完成</span>':''}</b><span>點數 ${handValue(h.cards).total}${handValue(h.cards).soft?' soft':''}</span></div>
        <div class="cards">${h.cards.map(cardHTML).join('')}</div><div class="mini">${h.note||''}</div><div class="result">${h.result||''}</div>
      </div>`).join('')}
  </div>`;
}
function attachBetEvents(){
  document.querySelectorAll('.bet-box').forEach(btn=>btn.onclick=()=>{ state.selectedBet={spot:Number(btn.dataset.spot),field:btn.dataset.field}; update(); });
  document.querySelectorAll('[data-chip]').forEach(btn=>btn.onclick=()=>addChip(Number(btn.dataset.chip)));
  document.querySelectorAll('[data-clear]').forEach(btn=>btn.onclick=()=>{ const sp=state.spots[state.selectedBet.spot]; if(sp){ sp.bets[state.selectedBet.field]=0; update(); }});
}
function addChip(v){
  if(!(state.phase==='idle'||state.phase==='roundOver')) return;
  const sp=state.spots[state.selectedBet.spot]; if(!sp) return;
  sp.bets[state.selectedBet.field]+=v;
  update();
}
function validateBets(){
  const n=enabledSpotCount(); let total=0;
  for(let i=0;i<n;i++){
    const b=state.spots[i].bets;
    if(b.main<500) return `第 ${i+1} 門主注最少 $500。`;
    if(b.pair>0 && b.pair<50) return `第 ${i+1} 門 Pair 最少 $50。`;
    if(b.minus13>0 && b.minus13<100) return `第 ${i+1} 門 -13 最少 $100。`;
    if(b.plus13>0 && b.plus13<100) return `第 ${i+1} 門 +13 最少 $100。`;
    if(b.minus13>0 && b.plus13>0) return `第 ${i+1} 門 -13 同 +13 只可揀一邊。`;
    total += b.main + b.pair + b.minus13 + b.plus13;
  }
  if(total<=0) return '請先落注。';
  if(state.cash<total) return `主錢包唔夠，今鋪總注係 ${money(total)}。`;
  return '';
}

function update(){
  ensureSpots();
  $('cash').textContent=money(state.cash); $('reserve').textContent=money(state.reserve); $('handsPlayed').textContent=state.round; $('net').textContent=money(state.cash+state.reserve-(state.initialCash+state.initialReserve));
  $('dealerCards').innerHTML=state.dealer.map(cardHTML).join('');
  const dv=state.dealer.length?handValue(state.dealer):null; $('dealerScore').textContent=dv?`點數 ${dv.total}${dv.soft?' soft':''}`:'';
  const n=enabledSpotCount(); const locked=!(state.phase==='idle'||state.phase==='roundOver');
  $('playerHands').innerHTML = locked ? state.spots.slice(0,n).map(renderPlayingSpot).join('') : state.spots.slice(0,n).map((sp,i)=>renderBettingSpot(sp,i,false)).join('');
  if(!locked) attachBetEvents();
  $('roundInfo').textContent = locked ? `第 ${state.activeSpot+1} 門｜第 ${state.activeHand+1} 手` : `準備開 ${n} 門`;
  const h=activeHand(); const dealerA=state.dealer[0]?.r==='A'; const playerPhase=state.phase==='player'||state.phase==='choice';
  $('deal').disabled=!(state.phase==='idle'||state.phase==='roundOver');
  $('hit').disabled=!playerPhase||!h||h.lockedOneCard;
  $('stand').disabled=!playerPhase||!h||h.lockedOneCard;
  $('double').disabled=!playerPhase||!h||state.actionsTaken||h.cards.length!==2||!canAfford(h.bet);
  $('split').disabled=!playerPhase||!h||state.actionsTaken||!canSplit(h);
  $('surrender').disabled=!playerPhase||!h||state.actionsTaken||dealerA;
  $('insurance').disabled=!(state.phase==='choice'&&dealerA&&state.insuranceBet===0&&canAfford(totalMainBet()/2));
  $('noInsurance').disabled=!(state.phase==='choice'&&dealerA);
  $('bjTake').disabled=!(state.phase==='bjChoice');
  $('bjWait').disabled=!(state.phase==='bjChoice');
  $('bjTake').textContent = dealerA ? 'BJ 即收 1:1' : 'BJ 收 1.5';
  renderLedger();
}

function startSession(){
  state.cash=Number($('startCash').value||5000); state.reserve=Number($('reserveCash').value||2500); state.initialCash=state.cash; state.initialReserve=state.reserve; state.topUpUsed=false; state.round=0; state.ledger=[]; state.phase='idle'; state.dealer=[]; state.insuranceBet=0; state.splitCount=0; state.actionsTaken=false; state.spots=[blankSpot(0),blankSpot(1),blankSpot(2)]; state.selectedBet={spot:0,field:'main'};
  msg('新局開始。喺玩家區用籌碼落注，再按「開新一鋪」。'); update();
}
function topUp(){ if(state.topUpUsed){msg('已經補過一次錢，不能再補。');return;} if(state.reserve<=0){msg('後備金已經無錢可補。');return;} state.cash+=state.reserve; state.reserve=0; state.topUpUsed=true; msg('已補一次後備金入主錢包。'); update(); }

async function newRound(){
  if(!(state.phase==='idle'||state.phase==='roundOver')) return;
  if(isMobile()) $('spotCount').value='1';
  const err=validateBets(); if(err){ msg(err); update(); return; }
  const n=enabledSpotCount(); shuffle(); state.round++; state.dealer=[]; state.insuranceBet=0; state.splitCount=0; state.actionsTaken=false; state.activeSpot=0; state.activeHand=0; state.phase='dealing';
  let total=0;
  for(let i=0;i<n;i++){
    const sp=state.spots[i]; const b=sp.bets; total += b.main+b.pair+b.minus13+b.plus13;
    sp.sideDelta=0; sp.sideText='待開牌'; sp.hands=[{cards:[],bet:b.main,finished:false,result:'',note:'',lockedOneCard:false,wasSplitA:false,settled:false,settledDelta:null}];
  }
  state.cash -= total;
  msg(`派牌中：先派每門第 1 張。`); update(); await sleep(280);
  for(let i=0;i<n;i++){ state.spots[i].hands[0].cards.push(draw()); update(); await sleep(220); }
  msg('派牌中：派莊家 1 張明牌。'); state.dealer.push(draw()); update(); await sleep(420);
  msg('派牌中：派每門第 2 張。');
  for(let i=0;i<n;i++){ state.spots[i].hands[0].cards.push(draw()); update(); await sleep(220); }
  settleSideBets(); msg('派牌完成，準備開始動作。'); update(); await sleep(260);

  const hasBJ = state.spots.slice(0,n).some(sp=>isBJ(sp.hands[0].cards));
  if(hasBJ){ state.phase='bjChoice'; msg(state.dealer[0].r==='A' ? '你有 Blackjack，而莊家 A 面：可即收 1:1，或者等莊家補牌結果。' : '你有 Blackjack：按「BJ 收 1.5」確認收錢，或等莊家結果。'); }
  else if(state.dealer[0].r==='A'){ state.phase='choice'; msg('莊家 A 面：不能投降。你可以買保險、唔買，或直接繼續玩家動作。'); }
  else { state.phase='player'; msg('開始動作。莊家非 A，可以投降輸一半。'); }
  update();
}
function firstTwoSideTotal(cards){ return sideCardValue(cards[0])+sideCardValue(cards[1]); }
function settleSideBets(){
  const n=enabledSpotCount();
  for(let i=0;i<n;i++){
    const sp=state.spots[i]; const b=sp.bets; const cards=sp.hands[0].cards; let parts=[]; let delta=0;
    if(b.pair>0){ if(cards[0].r===cards[1].r){ state.cash+=b.pair*12; delta+=b.pair*11; parts.push(`Pair 贏 +${money(b.pair*11)}`); } else { delta-=b.pair; parts.push(`Pair 輸 ${money(b.pair)}`); } }
    const t=firstTwoSideTotal(cards);
    if(b.minus13>0){ if(t<13){ state.cash+=b.minus13*2; delta+=b.minus13; parts.push(`-13 贏 +${money(b.minus13)}`); } else { delta-=b.minus13; parts.push(`-13 輸 ${money(b.minus13)}`); } }
    if(b.plus13>0){ if(t>13){ state.cash+=b.plus13*2; delta+=b.plus13; parts.push(`+13 贏 +${money(b.plus13)}`); } else { delta-=b.plus13; parts.push(`+13 輸 ${money(b.plus13)}`); } }
    sp.sideDelta=delta; sp.sideText=parts.length?parts.join('｜'):'—';
  }
}
function canSplit(h){ if(!h||h.cards.length!==2) return false; if(state.splitCount>=4) return false; if(h.cards[0].r!==h.cards[1].r) return false; if(h.cards[0].r==='A'&&h.wasSplitA) return false; return canAfford(h.bet); }
function beginFromChoice(){ if(state.phase==='choice'){ state.phase='player'; msg('開始動作。'); } }
function buyInsurance(){ if(state.phase!=='choice') return; const amt=totalMainBet()/2; if(!canAfford(amt)){msg('唔夠錢買保險。');return;} state.cash-=amt; state.insuranceBet=amt; state.phase='player'; msg(`已買保險 ${money(amt)}。繼續玩家動作。`); update(); }
function noInsurance(){ if(state.phase!=='choice') return; state.phase='player'; msg('你選擇唔買保險，繼續玩家動作。'); update(); }
function blackjackTake(){
  if(state.phase!=='bjChoice') return;
  const dealerA=state.dealer[0]?.r==='A';
  for(const sp of state.spots.slice(0,enabledSpotCount())) for(const h of sp.hands){
    if(isBJ(h.cards)&&!h.settled){ const win = dealerA ? h.bet : h.bet*1.5; state.cash += h.bet + win; h.finished=true; h.settled=true; h.settledDelta=win; h.result=dealerA?'Blackjack 即收 1:1':'Blackjack 收 1.5'; }
  }
  if(allHandsFinished()) endRoundWithoutDealer('Blackjack 已收錢，本鋪完成。');
  else { state.phase = state.dealer[0]?.r==='A' ? 'choice' : 'player'; goToNextUnfinished(); msg('Blackjack 已收錢，其餘手牌繼續。'); update(); }
}
function blackjackWait(){ if(state.phase!=='bjChoice') return; for(const sp of state.spots.slice(0,enabledSpotCount())) for(const h of sp.hands){ if(isBJ(h.cards)){ h.finished=true; h.note='Blackjack 等結果'; }} if(allHandsFinished()) dealerPlayAndSettle(); else { state.phase=state.dealer[0]?.r==='A'?'choice':'player'; goToNextUnfinished(); update(); } }
function hit(){ beginFromChoice(); const h=activeHand(); if(!h||state.phase!=='player') return; h.cards.push(draw()); state.actionsTaken=true; const v=handValue(h.cards).total; if(v>21){h.finished=true;h.result='爆牌';nextHandOrDealer();} else if(v===21){finishPlayerHand();} msg('已補牌。'); update(); }
function stand(){ beginFromChoice(); if(state.phase!=='player') return; finishPlayerHand(); msg('已停牌。'); update(); }
function doubleDown(){ beginFromChoice(); const h=activeHand(); if(!h||state.phase!=='player'||h.cards.length!==2||!canAfford(h.bet)) return; state.cash-=h.bet; h.bet*=2; h.cards.push(draw()); h.note='Double：只補一張'; state.actionsTaken=true; finishPlayerHand(); update(); }
function split(){ beginFromChoice(); const h=activeHand(); if(!canSplit(h)) return; state.cash-=h.bet; state.splitCount++; const c2=h.cards.pop(); const splitA=h.cards[0].r==='A'; h.cards.push(draw()); h.wasSplitA=splitA; h.lockedOneCard=splitA; h.finished=splitA; h.note=splitA?'AA 分牌：只補一張，不能再分 A':''; const newH={cards:[c2,draw()],bet:h.bet,finished:splitA,result:'',note:splitA?'AA 分牌：只補一張，不能再分 A':'',lockedOneCard:splitA,wasSplitA:splitA,settled:false,settledDelta:null}; activeSpot().hands.splice(state.activeHand+1,0,newH); state.actionsTaken=false; msg(splitA?'已分 AA；每手只補一張，自動完成。':'已分牌。'); if(splitA) nextHandOrDealer(); update(); }
function surrender(){ beginFromChoice(); const h=activeHand(); if(!h||state.actionsTaken||state.dealer[0]?.r==='A') return; h.finished=true; h.result='投降，輸一半'; state.cash+=h.bet/2; h.settled=true; h.settledDelta=-h.bet/2; nextHandOrDealer(); update(); }
function finishPlayerHand(){ const h=activeHand(); h.finished=true; nextHandOrDealer(); }
function allHandsFinished(){ return state.spots.slice(0,enabledSpotCount()).every(sp=>sp.hands.every(h=>h.finished)); }
function goToNextUnfinished(){ const n=enabledSpotCount(); for(let si=0;si<n;si++) for(let hi=0;hi<state.spots[si].hands.length;hi++) if(!state.spots[si].hands[hi].finished){ state.activeSpot=si; state.activeHand=hi; state.actionsTaken=false; return true; } return false; }
function nextHandOrDealer(){ if(goToNextUnfinished()) return; dealerPlayAndSettle(); }
function dealerPlayAndSettle(){ state.phase='dealer'; while(handValue(state.dealer).total<17) state.dealer.push(draw()); settle(); }
function settle(){
  const dv=handValue(state.dealer); const dealerBJ=isBJ(state.dealer); const deltas=[]; let insuranceDelta=0;
  if(state.insuranceBet>0){ if(state.dealer[0].r==='A'&&dealerBJ){ state.cash+=state.insuranceBet*3; insuranceDelta=state.insuranceBet*2; } else insuranceDelta=-state.insuranceBet; }
  for(const sp of state.spots.slice(0,enabledSpotCount())) for(const h of sp.hands){
    if(h.settled){ deltas.push({label:h.result,delta:h.settledDelta}); continue; }
    const pv=handValue(h.cards); let delta=-h.bet;
    if(pv.total>21){ h.result='輸（爆牌）'; }
    else if(isBJ(h.cards)&&!h.wasSplitA){ if(dealerBJ){ h.result='Blackjack 打和'; state.cash+=h.bet; delta=0; } else { h.result='Blackjack 贏 1.5'; state.cash+=h.bet*2.5; delta=h.bet*1.5; } }
    else if(dv.total>21){ h.result='贏（莊爆）'; state.cash+=h.bet*2; delta=h.bet; }
    else if(pv.total>dv.total){ h.result='贏'; state.cash+=h.bet*2; delta=h.bet; }
    else if(pv.total<dv.total){ h.result='輸'; }
    else { h.result='打和'; state.cash+=h.bet; delta=0; }
    deltas.push({label:h.result,delta});
  }
  state.phase='roundOver'; logRound(deltas,insuranceDelta); msg('本鋪完成。可以開新一鋪。'); update();
}
function endRoundWithoutDealer(message){ state.phase='roundOver'; const deltas=[]; for(const sp of state.spots.slice(0,enabledSpotCount())) for(const h of sp.hands) deltas.push({label:h.result,delta:h.settledDelta||0}); logRound(deltas,0); msg(message); update(); }
function logRound(deltas,insuranceDelta){
  const spots=state.spots.slice(0,enabledSpotCount()); const sideTotal=spots.reduce((s,sp)=>s+sp.sideDelta,0); const total=deltas.reduce((s,d)=>s+d.delta,0)+insuranceDelta+sideTotal;
  state.ledger.unshift({ round:state.round, bet:spots.map((sp,i)=>`門${i+1}: 主${money(sp.bets.main)} Pair${money(sp.bets.pair)} -13${money(sp.bets.minus13)} +13${money(sp.bets.plus13)}`).join('<br>'), dealer: state.dealer.length ? handText(state.dealer)+' ('+handValue(state.dealer).total+')' : handText(state.dealer), results: spots.map((sp,si)=>`門${si+1}: `+sp.hands.map((h,hi)=>`手${hi+1} ${handText(h.cards)} → ${h.result}`).join('；')).join('<br>'), insurance: spots.map((sp,i)=>`門${i+1}: ${sp.sideText}`).join('<br>') + (state.insuranceBet?`<br>保險 ${money(state.insuranceBet)} / ${insuranceDelta>=0?'+':''}${money(insuranceDelta)}`:''), delta:total, balance:state.cash });
}
function renderLedger(){ $('ledgerBody').innerHTML=state.ledger.map(r=>`<tr><td>${r.round}</td><td>${r.bet}</td><td>${r.dealer}</td><td>${r.results}</td><td>${r.insurance}</td><td class="${r.delta>=0?'gain':'loss'}">${r.delta>=0?'+':''}${money(r.delta)}</td><td>${money(r.balance)}</td></tr>`).join(''); }

$('newSession').onclick=startSession; $('topUp').onclick=topUp; $('spotCount').onchange=()=>{ if(state.phase==='idle'||state.phase==='roundOver') update(); };
$('deal').onclick=newRound; $('hit').onclick=hit; $('stand').onclick=stand; $('double').onclick=doubleDown; $('split').onclick=split; $('surrender').onclick=surrender; $('insurance').onclick=buyInsurance; $('noInsurance').onclick=noInsurance; $('bjTake').onclick=blackjackTake; $('bjWait').onclick=blackjackWait;
window.addEventListener('resize',()=>{ if(isMobile() && $('spotCount').value!=='1') $('spotCount').value='1'; update(); });
startSession();
