/* ===================== 潮镇游戏引擎（服务端权威端） ===================== */
/* 从原 HTML 完整移植游戏逻辑，移除所有 DOM 调用 */

const C = require('./constants');
const { INITIAL, INCOME, LIVING, INFLATION, BOND_RET, LIQ, MARGIN_TRIGGER, MARGIN_RATE,
  T, R, Q, FATE3, FATE_LIFE, FATE4, DEEPQ, COMMON, SPECIAL, SPEND_CLASS, CLASS_NOTE,
  UNLOCK, OPTSPEC, CRISIS, COOP, TREASURE_PLAN, PAIN, hasKey } = C;

/* ===================== 工具函数 ===================== */
const cl = x => Math.max(0, Math.min(5, x));
const fm = x => (Math.round(Number(x || 0) * 10) / 10) + "";
const assets = s => s.cash + s.reserve + s.stock + s.bond + s.commodity + s.peerReceivable;
const totalDebt = s => s.debt + s.peerDebt;
const netWorth = s => assets(s) - totalDebt(s);
const debtRatio = s => totalDebt(s) / Math.max(1, assets(s));
const investable = s => s.stock + s.bond + s.commodity;

function debtRate(s) {
  let r = 0.06;
  if (debtRatio(s) > 0.5) r = 0.10;
  if (debtRatio(s) > 0.9) r = 0.15;
  if (s.credit <= 2) r += 0.03;
  return r;
}
function nextLiving(act) { return LIVING[Math.min(5, act + 1)] || 18 }
function coverage(s, act) {
  const need = nextLiving(act) + totalDebt(s) * debtRate(s);
  return (s.cash + s.reserve) / Math.max(1, need);
}
function optionIndex(s, act) {
  const cov = Math.max(0, coverage(s, act));
  const liq = 40 * Math.min(1, cov / 3);
  const dbt = 30 * (1 - Math.min(1, debtRatio(s)));
  const cap = 30 * ((s.health + s.ability + s.credit + s.relation) / 20);
  return Math.round(liq + dbt + cap);
}
function shuffleArr(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t } return a }

/* ===================== 状态初始化 ===================== */
function mk(t, i) {
  return {
    i, name: t.name, cash: INITIAL, reserve: 0, stock: 0, bond: 0, commodity: 0, allocated: false,
    debt: 0, peerDebt: 0, peerReceivable: 0,
    health: t.health, ability: t.ability, credit: t.credit, relation: t.relation,
    protection: false, extra: 0, started: Array(6).fill(false),
    fate3: null, fate4: null, fateLife: null, usedFates: [], crisisDone: false, crisisChoice: null, crisisGiveUp: "",
    history: [], ref: {}, final: "", secret: false, tr: {}, math: {}, decisions: [],
    gameEnded: false, portrait: null,
    custody: false, lowCovStreak: 0, custodyActs: [], marginCalls: [],
    scarcity: [], trail: [],
    forcedSells: 0, carryOver: 0, pledgedSell: 0, eduSpend: 0, medSpend: 0, spendKeys: [], bought: [], prodDebt: 0, gapDebt: 0,
    coopPick: null, coopStake: 0, coopOptOut: false, coopResult: null, coopAdv: "", coopPitch: "",
    treasureBet: null, stockRet: null, comRet: null,
    consumeDone: false, consumeBill: null,
    painDone: false, painSpent: 0, painNote: "", painDeal: null
  };
}

function newGame() {
  return {
    round: 0, events: [], families: T.map(mk), bankLoans: [], loans: [],
    fateRole3: shuffleArr(["bad", "bad", "bad", "bad", "bad", "good", "good"]),
    fateRole4: shuffleArr(["good", "good", "good", "bad", "bad", "bad", "bad"]),
    coopWinner: null, coopSettled: false, coopReport: null, treasureReport: null,
    treasureLog: [], lastUpdate: Date.now()
  };
}

/* ===================== 记录函数 ===================== */
function stateNow(s) {
  return { cash: s.cash, reserve: s.reserve, stock: s.stock, bond: s.bond, commodity: s.commodity,
    debt: s.debt, peerDebt: s.peerDebt, health: s.health, ability: s.ability, credit: s.credit, relation: s.relation };
}
function addDecision(s, round, type, title, detail, riskLevel, riskReason, judgment, impact) {
  if (!Array.isArray(s.decisions)) s.decisions = [];
  s.decisions.push({ round, type, title, detail, riskLevel, riskReason, judgment, impact: impact || "", state: stateNow(s), time: Date.now() });
  logEvent(state, s.i, title, detail, "风险：" + riskLevel);
}
function addScarcity(s, act, kind, what, gaveUp) {
  if (!Array.isArray(s.scarcity)) s.scarcity = [];
  s.scarcity.push({ act, kind, what, gaveUp });
}
function riskClass(l) { return l === "高" ? "risk-high" : l === "中" ? "risk-mid" : "risk-low" }
function scoreClass(v) { return v < 3 ? "low" : v === 3 ? "mid" : "high" }

function logEvent(state, famIdx, action, detail, extra) {
  var ev = { ts: Date.now(), fam: famIdx, round: state.round,
    name: (state.families[famIdx] || {}).name || "", action: action, detail: detail || "", extra: extra || "" };
  if (!Array.isArray(state.events)) state.events = [];
  state.events.push(ev);
  if (state.events.length > 400) state.events.shift();
}

/* ===================== 资金流动 ===================== */
function nextLoanId(p) { return p + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7) }

function logTxn(s, kind, label, amount, extra) {
  if (!Array.isArray(s.txns)) s.txns = [];
  s.txns.unshift({ act: 0, kind, label, amount: Math.round(amount * 10) / 10, extra: extra || "",
    cash: Math.round(s.cash * 10) / 10, debt: Math.round(totalDebt(s) * 10) / 10 });
  s.txns[0].act = s._currentAct || 0;
}

function addBankDebt(state, famIdx, amount, reason, productive) {
  amount = Number(amount || 0); if (amount <= 0) return;
  const s = state.families[famIdx];
  const rate = Math.round(debtRate(s) * 100);
  s.debt += amount;
  state.bankLoans.push({ id: nextLoanId("BANK"), borrower: famIdx, creditor: "潮镇银行", original: amount, outstanding: amount, rate, reason, productive: !!productive, createdRound: state.round });
  if (productive) s.prodDebt = (s.prodDebt || 0) + amount; else s.gapDebt = (s.gapDebt || 0) + amount;
  s.history.unshift("🏦 新增银行债务 " + fm(amount) + "万｜利率" + rate + "%/幕｜原因：" + reason);
  logTxn(s, "borrow", "银行借入：" + reason, amount, "利率" + rate + "%/幕");
}

function addBridgeDebt(state, famIdx, amount, reason) {
  amount = Number(amount || 0); if (amount <= 0) return;
  const s = state.families[famIdx];
  const rate = Math.round(debtRate(s) * 100);
  s.debt += amount; s.carryOver = (s.carryOver || 0) + amount;
  state.bankLoans.push({ id: nextLoanId("BRIDGE"), borrower: famIdx, creditor: "潮镇银行·应急垫付", original: amount, outstanding: amount, rate, reason: "第四幕结转｜" + reason, bridge: true, createdRound: state.round });
  logTxn(s, "borrow", "第三幕缺口结转｜" + reason, amount, "利率" + rate + "%/幕，第四幕之后处理");
  s.history.unshift("⏭️ 第四幕缺口 " + fm(amount) + "万结转为应急垫付｜利率" + rate + "%/幕｜第五幕集中处理｜" + reason);
  addScarcity(s, 3, "debt", "第四幕有 " + fm(amount) + " 万缺口没有当场解决，被结转到第五幕", "它不会消失，只会带着利息等在那里");
}

/* 支出：返回 need（缺口金额，>0 表示现金不够需要后续处理） */
function spend(state, famIdx, amount, label, act) {
  amount = Math.max(0, Number(amount || 0)); if (amount <= 0) return 0;
  const s = state.families[famIdx];
  const use = Math.min(s.cash, amount); s.cash -= use; let need = amount - use;
  if (need <= 0.001) return 0;
  addScarcity(s, act, "shortfall", label + "需要" + fm(amount) + "万，现金只够" + fm(use) + "万", "缺口 " + fm(need) + " 万必须从别处来");
  // 第三幕：缺口结转
  if (act === 3) { addBridgeDebt(state, famIdx, need, label); return 0; }
  // 有投资资产：返回 need，由前端弹窗处理（玩家选择变现或借款）
  if (investable(s) > 0.01) {
    return need;
  }
  // 无资产可变现：自动借款
  addBankDebt(state, famIdx, need, label + "（无资产可变现，只能借款）");
  s.cash += need;
  addScarcity(s, act, "debt", "为了" + label + "新增负债" + fm(need) + "万", "未来的收入被提前用掉了");
  return 0;
}

/* ===================== 每幕开场 ===================== */
function actStart(state, famIdx) {
  const s = state.families[famIdx];
  const act = state.round;
  if (!s.allocated || s.started[act]) return;
  s._currentAct = act;
  const before = { cash: s.cash, reserve: s.reserve, debt: totalDebt(s) };
  const hf = s.health >= 5 ? 1.1 : s.health === 4 ? 1 : s.health === 3 ? .75 : s.health === 2 ? .45 : s.health === 1 ? .2 : 0;
  const income = Math.round(INCOME * hf * 10) / 10 + (s.extra || 0);
  s.cash += income;
  if (act > 0) {
    const ero = Math.round(s.cash * INFLATION * 10) / 10;
    if (ero > 0.05) {
      s.cash -= ero;
      s.inflLoss = Math.round(((s.inflLoss || 0) + ero) * 10) / 10;
      s.history.unshift("📉 通货膨胀｜现金 -" + fm(ero) + "万（每幕 -" + Math.round(INFLATION * 100) + "%，只吃现金）｜累计已蒸发 " + fm(s.inflLoss) + "万");
      if (ero >= 6) addScarcity(s, act, "inflation", "通胀这一幕吃掉 " + fm(ero) + " 万现金", "放着不动的钱，也在一直变少");
    }
  }
  let live = LIVING[act];
  const penalties = [];
  if (s.relation < 3) { live *= 1.15; penalties.push("关系<3，内耗使支出+15%") }
  if (s.ability < 3) { live *= 1.10; penalties.push("能力<3，同样的事更贵+10%") }
  live = Math.round(live * 10) / 10;
  spend(state, famIdx, live, "第" + (act + 1) + "幕刚性支出", act);
  if (totalDebt(s) > 0) {
    const r = debtRate(s), grow = Math.round(s.debt * r * 10) / 10;
    s.debt += grow;
    state.bankLoans.filter(l => l.borrower === famIdx && l.outstanding > 0).forEach(l => { l.outstanding *= (1 + r) });
    if (grow > 0) s.history.unshift("📈 债务计息 +" + fm(grow) + "万（利率" + Math.round(r * 100) + "%/幕，负债率越高越贵）");
  }
  s.started[act] = true;
  s.history.unshift("📅 第" + (act + 1) + "幕开场｜带入现金" + fm(before.cash) + "/储备" + fm(before.reserve) + "/负债" + fm(before.debt)
    + "。本幕：收入+" + fm(income) + "万，刚性支出-" + fm(live) + "万" + (penalties.length ? "（" + penalties.join("；") + "）" : ""));
  checkCustody(s, act);
  recordTrail(s, act);
}

function recordTrail(s, act) {
  if (!Array.isArray(s.trail)) s.trail = [];
  const e = { act, net: Math.round(netWorth(s)), opt: optionIndex(s, act), cov: Math.round(coverage(s, act) * 10) / 10, debt: Math.round(totalDebt(s)) };
  const i = s.trail.findIndex(x => x.act === act);
  if (i >= 0) s.trail[i] = e; else s.trail.push(e);
  s.trail.sort((a, b) => a.act - b.act);
}

function checkCustody(s, act) {
  const cov = coverage(s, act), insolvent = totalDebt(s) > assets(s);
  if (cov < 0.6 || insolvent) s.lowCovStreak = (s.lowCovStreak || 0) + 1;
  else { s.lowCovStreak = 0; if (s.custody) { s.custody = false; s.history.unshift("✅ 流动性恢复，解除托管") } }
  if ((s.lowCovStreak >= 2 || insolvent) && !s.custody) {
    s.custody = true;
    if (!Array.isArray(s.custodyActs)) s.custodyActs = [];
    s.custodyActs.push(act + 1);
    s.history.unshift("🚨 进入托管：流动性连续不足" + (insolvent ? "且已资不抵债" : "") + "。本幕起不能消费、不能合作、不能新增投资，直到覆盖率恢复。");
    addScarcity(s, act, "custody", "家庭进入托管状态", "消费、合作、投资的权利同时被收走");
  }
}

function marginCheck(state, famIdx) {
  const s = state.families[famIdx];
  const act = state.round;
  if (totalDebt(s) <= 0) return;
  if (coverage(s, act) >= MARGIN_TRIGGER) return;
  if (!Array.isArray(s.marginCalls)) s.marginCalls = [];
  if (s.marginCalls.some(m => m.act === act)) return;
  const call = Math.round(totalDebt(s) * MARGIN_RATE * 10) / 10;
  s.marginCalls.push({ act, amount: call });
  s.credit = cl(s.credit - 1);
  s.history.unshift("⚠️ 银行追加保证金 " + fm(call) + "万：你的现金撑不过 " + MARGIN_TRIGGER + " 倍刚性支出，信用-1");
  addScarcity(s, act, "margin", "银行要求追加保证金 " + fm(call) + " 万", "越缺钱的时候，别人越要你先拿钱出来");
  spend(state, famIdx, call, "追加保证金", act);
  addDecision(s, act, "margin", "被追加保证金", "负债" + fm(totalDebt(s)) + "万，覆盖率不足触发追保" + fm(call) + "万",
    "高", "追保发生在你最没钱的时候，这正是杠杆真正的成本。", "这不是你的选择，是负债替你做的决定。", "信用降至" + s.credit + "/5。");
}

/* ===================== 命运袋 ===================== */
function fateRound(r) { return r === 2 || r === 3 || r === 4 }

function pickFate(state, famIdx, r) {
  const s = state.families[famIdx];
  const pool = r === 2 ? FATE_LIFE : r === 3 ? FATE3 : FATE4;
  const bucket = r === 2 ? "bad" : (r === 3 ? (state.fateRole3 || [])[famIdx] : (state.fateRole4 || [])[famIdx]) || "bad";
  let cand = pool.filter(x => !s.usedFates.includes(x[0]));
  if (!cand.length) cand = pool;
  const fitted = cand.filter(x => !x[10] || !x[10].length || x[10].indexOf(famIdx) >= 0);
  const use = fitted.length ? fitted : cand;
  let arr = use.filter(x => x[1] === bucket); if (!arr.length) arr = use;
  const weighted = [];
  arr.forEach(x => {
    const tag = x[9] || ""; let w = 1;
    if (tag === "edu" && s.eduSpend > 0) w = bucket === "good" ? 3 : 1;
    if (tag === "med" && s.medSpend > 0) w = bucket === "bad" ? 0.35 : 3;
    for (let k = 0; k < Math.max(1, Math.round(w * 4)); k++) weighted.push(x);
  });
  const finalArr = weighted.length ? weighted : arr;
  return finalArr[Math.floor(Math.random() * finalArr.length)];
}

function drawFate(state, famIdx) {
  const s = state.families[famIdx];
  const r = state.round;
  if (!fateRound(r)) return { error: "本幕没有命运袋。" };
  if ((r === 2 && s.fateLife) || (r === 3 && s.fate3) || (r === 4 && s.fate4)) return { error: "本幕已经抽过了。" };
  const raw = pickFate(state, famIdx, r);
  const e = { name: raw[0], kind: raw[1], tag: raw[2], actual: raw[3], health: raw[4], ability: raw[5], credit: raw[6], relation: raw[7],
    story: raw[8], tag2: raw[9] || "", extraDebt: 0, assetZero: false };
  // 处理命运袋效果
  let x = e.actual;
  if (x < 0 && e.tag2 === "med" && s.medSpend > 0) { x = Math.round(x * .5); e.medCut = true }
  if (x > 0 && e.tag2 === "edu" && s.eduSpend > 0) { x = x + 10; e.eduBoost = true }
  if (x < 0 && s.protection && (e.tag === "家庭" || e.tag === "灾难" || e.tag === "保障")) { x = Math.round(x * .55); e.mitigated = true }
  e.actual = x;
  if (x < 0) {
    const need = spend(state, famIdx, -x, "命运袋：" + e.name, r);
    if (need > 0) {
      // 有缺口需要变现 - 自动借款处理（简化：直接借款）
      addBankDebt(state, famIdx, need, "命运袋缺口：" + e.name);
      s.cash += need;
    }
  } else {
    s.cash += x;
  }
  s.health = cl(s.health + e.health); s.ability = cl(s.ability + e.ability);
  s.credit = cl(s.credit + e.credit); s.relation = cl(s.relation + e.relation);
  s.usedFates.push(e.name);
  if (r === 2) s.fateLife = e; else if (r === 3) s.fate3 = e; else s.fate4 = e;
  s.history.unshift("🎴 命运袋：" + e.name + "｜" + (e.actual >= 0 ? "+" : "") + e.actual + "万"
    + (e.mitigated ? "（保障已缓释45%）" : "") + (e.medCut ? "（第二幕买过医疗保障，损失减半）" : "") + (e.eduBoost ? "（第二幕投过教育，奖学金+10万）" : ""));
  checkCustody(s, r); recordTrail(s, r);
  return { success: true, fate: e };
}

/* ===================== 痛点账单 ===================== */
function dealPain(s) {
  if (s.painDeal && s.painDeal.length === 3) return s.painDeal;
  const cats = ["老人", "孩子", "亲戚", "自己", "夫妻"];
  const pick = [], pool = cats.slice();
  while (pick.length < 3 && pool.length) pick.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  s.painDeal = pick.map(function (c) {
    const cand = PAIN.filter(x => x.cat === c && (!x.fit.length || x.fit.indexOf(s.i) >= 0));
    const use = cand.length ? cand : PAIN.filter(x => x.cat === c);
    return use[Math.floor(Math.random() * use.length)].k;
  });
  return s.painDeal;
}
function painCards(s) { const ks = dealPain(s); return ks.map(k => PAIN.filter(x => x.k === k)[0]).filter(Boolean) }

/* ===================== 消费标签 ===================== */
function menuTag(name) {
  if (/教育|夏校|竞赛|兴趣班|游学|创业营|创业种子|自主预算|创作设备|课程|训练营|决策课|冲刺/.test(name)) return "edu";
  if (/保险|保障|体检|医疗|养老|照护|留任/.test(name)) return "med";
  return "";
}
function consumeDownside(x) {
  const k = x[4], cost = x[1];
  if (k === "status") return "关系 +1，但没有任何长期效果：排面换来的和睦只持续一阵子，钱是实打实花掉的 " + cost + " 万";
  if (k === "trap") return "信用 -1：这类'保本高息'一旦出事，先损失的是你的判断力名声";
  if (k === "marketing") return "关系 -1：靠流量换来的收入，是用家里人的时间换的";
  if (k === "income2") return "关系 -1：第二收入是从陪家人的时间里挤出来的";
  if (k === "passive") return "关系 -1：家里的空间从此要让给外人";
  if (k === "sidebiz") return "关系 -1、健康 -1：副业最贵的成本是你自己的身体";
  if (k === "protection") return "无即时回报：保费花出去，什么都没发生时它看起来像浪费";
  if (k === "credit") return "健康 -1：维护圈层要花的不只是钱，还有你的作息";
  if (k === "ability" || k === "abilityCredit") return "关系 -1：学习和升级要占用的，是本来陪家人的时间";
  if (k === "dual") return "占用现金 " + cost + " 万：对孩子的投入见效最慢，也最不可撤回";
  if (k === "health") return "占用现金 " + cost + " 万：查出问题就要继续花钱";
  if (k === "relation") return "占用现金 " + cost + " 万：它不解决任何问题，只是让人喘口气";
  return "占用现金 " + cost + " 万";
}

/* ===================== 合作结算 ===================== */
function coopRoster(state, name) { return state.families.map((x, i) => ({ x, i })).filter(o => o.x.coopPick === name) }
function coopQualified(s, p) {
  const q = p.req || {};
  return (!q.ability || s.ability >= q.ability) && (!q.credit || s.credit >= q.credit) && (!q.relation || s.relation >= q.relation);
}

function settleCoop(state) {
  if (state.coopSettled) return;
  const live = COOP.filter(p => coopRoster(state, p.name).length >= 2);
  if (!live.length) {
    COOP.forEach(p => coopRoster(state, p.name).forEach(o => {
      o.x.cash += o.x.coopStake;
      o.x.history.unshift("↩️ 「" + p.name + "」参与家庭不足2家，项目未开工，出资 " + fm(o.x.coopStake) + "万原路退回");
      o.x.coopResult = { status: "void", amount: 0 };
    }));
    state.coopSettled = true; state.coopWinner = null; buildCoopReport(state); return;
  }
  const win = live[Math.floor(Math.random() * live.length)];
  state.coopWinner = win.name;
  COOP.forEach(p => {
    const r = coopRoster(state, p.name);
    if (!r.length) return;
    if (r.length < 2) {
      r.forEach(o => { o.x.cash += o.x.coopStake; o.x.history.unshift("↩️ 「" + p.name + "」不足2家未开工，出资 " + fm(o.x.coopStake) + "万退回"); o.x.coopResult = { status: "void", amount: 0 } });
      return;
    }
    if (p.name === win.name) {
      r.forEach(o => { const gain = o.x.coopStake * 10; o.x.cash += gain; o.x.credit = cl(o.x.credit + 1); o.x.relation = cl(o.x.relation + 1); o.x.history.unshift("🏆 「" + p.name + "」是唯一赚钱的项目！出资" + fm(o.x.coopStake) + "万 → 返还" + fm(gain) + "万"); o.x.coopResult = { status: "win", amount: gain - o.x.coopStake } });
    } else {
      const comp = Math.round(p.comp[0] + Math.random() * (p.comp[1] - p.comp[0]));
      r.forEach(o => {
        o.x.credit = cl(o.x.credit - 1);
        o.x.history.unshift("💥 「" + p.name + "」项目失败｜出资" + fm(o.x.coopStake) + "万全损，另需赔偿" + fm(comp) + "万");
        addScarcity(o.x, 6, "coop", "合作项目失败：出资" + fm(o.x.coopStake) + "万全损，再赔" + fm(comp) + "万", "一个决定，同时拿走了本金和信用");
        o.x.coopResult = { status: "lose", amount: -(o.x.coopStake + comp), comp };
        spend(state, o.i, comp, "合作项目赔偿金：" + p.name, 6);
      });
    }
  });
  state.coopSettled = true; buildCoopReport(state);
}

function buildCoopReport(state) {
  const rows = COOP.map(p => {
    const r = coopRoster(state, p.name);
    if (!r.length) return null;
    const st = r[0].x.coopResult ? r[0].x.coopResult.status : "void";
    const label = st === "win" ? '✅ 盈利' : st === "lose" ? '❌ 亏损' : '⏸ 未开工';
    const who = r.map(o => T[o.i].icon + ' ' + o.x.name + '（出资' + fm(o.x.coopStake) + '万）').join("、");
    const outcome = st === "win" ? r.map(o => T[o.i].icon + o.x.name + ' 净赚 ' + fm(o.x.coopResult.amount) + ' 万').join("；")
      : st === "lose" ? r.map(o => T[o.i].icon + o.x.name + ' 出资全损，另赔 ' + fm(o.x.coopResult.comp) + ' 万').join("；")
        : "参与家庭不足 2 家，项目未开工，出资已原路退回。";
    return { name: p.name, label, who, outcome, st };
  }).filter(Boolean);
  const none = state.families.filter(x => x.coopOptOut);
  state.coopReport = { rows, winner: state.coopWinner, none };
}

function buildTreasureReport(state) {
  const L = state.treasureLog || [];
  const skipped = state.families.filter(x => x.gameEnded && !x.treasureBet);
  state.treasureReport = { log: L, skipped };
}

/* ===================== 终局结算 ===================== */
function settlement(s) {
  const sr = (s.stockRet === null || s.stockRet === undefined) ? 0.08 : s.stockRet;
  const cr = (s.comRet === null || s.comRet === undefined) ? 0.09 : s.comRet;
  const stockProfit = s.stock * sr, bondProfit = s.bond * BOND_RET, comProfit = s.commodity * cr;
  const investmentProfit = stockProfit + bondProfit + comProfit;
  const debt = totalDebt(s);
  const gross = s.cash + s.reserve + s.stock + stockProfit + s.bond + bondProfit + s.commodity + comProfit + s.peerReceivable;
  return { stockRet: sr, comRet: cr, stockProfit, bondProfit, comProfit, investmentProfit, gross, debt, finalNet: gross - debt,
    insolvent: gross - debt < 0, custody: !!s.custody };
}

function bearableLoss(s, act) {
  const need = (LIVING[Math.min(act + 1, LIVING.length - 1)] || 0) + (LIVING[Math.min(act + 2, LIVING.length - 1)] || 0) + totalDebt(s) * debtRate(s);
  return Math.max(0, (s.cash + s.reserve) - need);
}

function riskVerdict(s, amount, act) {
  const bear = bearableLoss(s, act), cov = coverage(s, act), lev = totalDebt(s) / Math.max(1, assets(s));
  if (amount <= 0) return { level: "none", label: "未参与", why: "没有下注，也就没有下注风险。" };
  const debtFunded = !!(s.treasureBet && s.treasureBet.src === "debt");
  if (debtFunded && amount > bear * 0.3)
    return { level: "survival", label: "生存性赌博（借钱下注）", why: "这笔钱是借来的。50% 归零的项目一旦失败，你不是回到原点，而是背着 " + fm(amount) + " 万债务回到原点。" };
  if (amount <= bear * 0.6 && cov >= 1.5 && lev < 0.35)
    return { level: "ok", label: "可承受的试错", why: "即使全部亏光，你的可动用资金仍能覆盖后面两幕的刚性支出和利息。" };
  if (amount <= bear && cov >= 1.1 && lev < 0.6)
    return { level: "tight", label: "勉强承受得起", why: "亏光之后你还能撑住，但缓冲会被吃干。" };
  return { level: "survival", label: "生存性赌博", why: "投入超过了你能承受的损失。" };
}

function futureMap(s) {
  const st = settlement(s), liquid = s.cash + s.reserve, debt = totalDebt(s);
  const lev = debt / Math.max(1, assets(s));
  const cov = coverage(s, 6);
  const open = [], shut = [];
  (liquid >= 30 && !s.custody ? open : shut).push("承受一次 30 万的突发事件");
  (liquid >= 40 && lev < 0.3 ? open : shut).push("再做一次可承受的创业或投资试错");
  (s.credit >= 3 && lev < 0.5 ? open : shut).push("以正常成本获得融资");
  (s.credit >= 4 ? open : shut).push("参加对信用有要求的高质量合作项目");
  (s.ability >= 4 || s.relation >= 4 ? open : shut).push("被别人主动邀请合作");
  (s.ability >= 3 && liquid >= 25 ? open : shut).push("支持家庭成员做一次职业转型");
  (cov >= 2 ? open : shut).push("承受两幕以上的收入中断");
  (s.health >= 4 && s.relation >= 4 ? open : shut).push("在不透支家人的前提下应对下一次危机");
  if (debt > 0 && lev >= 0.5) shut.push("自由支配现金——必须优先偿债");
  if (s.custody || st.insolvent) shut.push("参与任何新的项目——一次危机就可能再次触发托管");
  return { open, shut, liquid: Math.round(liquid), lev: Math.round(lev * 100), cov: Math.round(cov * 10) / 10 };
}

function turningPoint(s) {
  const t = (s.trail || []).slice().sort((a, b) => a.act - b.act);
  if (t.length < 2) return null;
  let worst = null;
  for (let i = 1; i < t.length; i++) {
    const drop = t[i - 1].opt - t[i].opt;
    if (!worst || drop > worst.drop) worst = { act: t[i].act, drop: drop, before: t[i - 1].opt, after: t[i].opt };
  }
  if (!worst || worst.drop <= 0) return null;
  const d = (s.decisions || []).filter(x => x.round === worst.act);
  const sc = (s.scarcity || []).filter(x => x.act === worst.act);
  worst.decisions = d; worst.scarcity = sc;
  return worst;
}

function buildPortrait(s) {
  const st = settlement(s);
  const d = s.decisions || [], sc = s.scarcity || [], trail = (s.trail || []).slice().sort((a, b) => a.act - b.act);
  const alloc = d.find(x => x.type === "allocation");
  const meta = alloc && alloc.meta ? alloc.meta : { reserveRatio: 0, stockRatio: 0, liquid: 0 };
  const consumption = d.find(x => x.type === "consumption");
  const consumeSpend = consumption && consumption.meta ? consumption.meta.totalSpend : 0;
  const crisis = d.find(x => x.type === "crisis");
  const crisisKey = crisis && crisis.meta ? crisis.meta.optionKey : null;
  const coop = d.find(x => x.type === "cooperation");
  const treasure = d.find(x => x.type === "treasure");
  const loans = d.filter(x => x.type === "loan").length;
  const sells = d.filter(x => x.type === "liquidation").length;
  const repays = d.filter(x => x.type === "repayment" && x.detail.indexOf("未偿还") < 0).length;
  const margins = (s.marginCalls || []).length;

  const optStart = trail.length ? trail[0].opt : optionIndex(s, 0);
  const optEnd = trail.length ? trail[trail.length - 1].opt : optionIndex(s, 6);
  const optMin = trail.length ? Math.min.apply(null, trail.map(x => x.opt)) : optEnd;
  const netIdxEnd = Math.round(st.finalNet / INITIAL * 100);
  const familyCap = Math.round((s.health + s.ability + s.credit + s.relation) / 20 * 100);
  const forcedMoments = sc.filter(x => ["shortfall", "sell", "debt", "margin", "custody", "reserve"].indexOf(x.kind) >= 0).length;

  let type, typeLine;
  if (s.custody) { type = "被托管的家庭"; typeLine = "你没有出局，但最后几幕你已经没有可以走的路了。" }
  else if (margins > 0 || loans >= 2) { type = "用未来买今天的人"; typeLine = "你反复用负债解决当下的问题。" }
  else if (sells >= 2) { type = "资产很多、现金很少的家庭"; typeLine = "你的账面并不穷，但每次需要用钱时都得折价卖东西。" }
  else if (crisisKey === "borrowfam" || s.health <= 2 || s.relation <= 2) { type = "拿家人顶上去的家庭"; typeLine = "有一部分账单，是记在人身上的。" }
  else if (crisisKey === "shrink") { type = "主动缩小的家庭"; typeLine = "你选择砍掉一块业务换取安全。" }
  else if (coop && coop.meta && coop.meta.success && s.credit >= 4) { type = "把信用变成资源的家庭"; typeLine = "你靠别人愿意跟你合作。" }
  else if (meta.liquid >= 150 && optEnd >= 65 && consumeSpend <= 20) { type = "流动性守门人"; typeLine = "你从第一幕起就为不确定性留了厚厚的一层。" }
  else if (consumeSpend >= 45 && meta.reserveRatio < .08) { type = "被焦虑驱动的消费者"; typeLine = "你买的东西大多确实有用。问题在于它们花掉的是第三幕最需要的现金。" }
  else if (meta.stockRatio >= .5) { type = "押注单一未来的家庭"; typeLine = "你把大部分身家押在一种资产上。" }
  else if (treasure && treasure.meta && treasure.meta.skipped && treasure.meta.liquidLeft >= 60) { type = "按兵不动的家庭"; typeLine = "最后一幕你选择不动手。" }
  else if (optEnd - optStart >= -5 && netIdxEnd < 60) { type = "安全但停滞的家庭"; typeLine = "你几乎没冒任何风险，也几乎没有增长。" }
  else { type = "在权衡里前进的家庭"; typeLine = "你没有把任何一种资源用到极限。" }

  const kept = [], sold = [];
  if (meta.liquid >= 120) kept.push("开局就留出了 " + fm(meta.liquid) + " 万可立刻动用的钱");
  if (s.reserve > 0) kept.push("到最后手上还有 " + fm(s.reserve) + " 万储备没有动过");
  if (totalDebt(s) <= 0) kept.push("七幕结束时没有欠任何人钱");
  if (s.health >= 4) kept.push("健康 " + s.health + "/5");
  if (s.relation >= 4) kept.push("关系 " + s.relation + "/5");
  if (s.credit >= 4) kept.push("信用 " + s.credit + "/5");
  if (repays > 0) kept.push("有过主动偿债的记录");
  if (!kept.length) kept.push("你完整走完了七幕");

  if (sells > 0) sold.push("折价变现过 " + sells + " 次");
  if (loans > 0) sold.push("借款 " + loans + " 次");
  if (margins > 0) sold.push("被追加保证金 " + margins + " 次");
  if (s.health < 4) sold.push("健康从 " + T[s.i].health + " 降到 " + s.health);
  if (s.relation < 4) sold.push("关系从 " + T[s.i].relation + " 降到 " + s.relation);
  if (s.credit < 4) sold.push("信用从 " + T[s.i].credit + " 降到 " + s.credit);
  if (s.extra < 0) sold.push("未来每一幕的收入永久减少了 " + Math.abs(s.extra) + " 万");
  if (s.crisisGiveUp) sold.push("你自己写下的：" + s.crisisGiveUp);
  if (!sold.length) sold.push("这一局你没有被迫卖掉任何东西");

  return { type, typeLine, settlement: st, optStart, optEnd, optMin, netIdxEnd, familyCap, forcedMoments,
    trail, scarcity: sc, decisions: d, kept, sold, loans, sells, margins, repays };
}

/* ===================== 触发挑战状态 ===================== */
function triggerState(s) { if (!s.tr[state.round]) s.tr[state.round] = { wall: false, mouth: false }; return s.tr[state.round] }
function mathState(s) {
  if (!s.math[state.round]) { const q = Q[(s.i * 2 + state.round) % Q.length]; s.math[state.round] = { q: q[0], a: q[1], ex: q[2], passed: false } }
  return s.math[state.round];
}

/* ===================== 操作执行器 ===================== */
let state; // 当前操作的状态引用，由 execute 设置

function execute(gameState, action, client) {
  state = gameState;
  const famIdx = client.role === 'host' ? -1 : parseInt(client.role.replace('family', ''));
  
  try {
    switch (action.type) {
      case 'SELECT_FAMILY': return handleSelectFamily(action, famIdx);
      case 'ALLOCATE': return handleAllocate(action, famIdx);
      case 'SUBMIT_CONSUME': return handleSubmitConsume(action, famIdx);
      case 'DRAW_FATE': return drawFate(state, famIdx);
      case 'SUBMIT_PAIN': return handleSubmitPain(action, famIdx);
      case 'SUBMIT_CRISIS': return handleSubmitCrisis(action, famIdx);
      case 'SUBMIT_DEBT': return handleSubmitDebt(action, famIdx);
      case 'SUBMIT_COOP': return handleSubmitCoop(action, famIdx);
      case 'SUBMIT_TREASURE': return handleSubmitTreasure(action, famIdx);
      case 'BORROW_BANK': return handleBorrowBank(action, famIdx);
      case 'REPAY': return handleRepay(action, famIdx);
      case 'LIQUIDATE': return handleLiquidate(action, famIdx);
      case 'USE_RESERVE': return handleUseReserve(action, famIdx);
      case 'INVEST_MORE': return handleInvestMore(action, famIdx);
      case 'TRANSFER_RESERVE': return handleTransferReserve(action, famIdx);
      case 'NEXT_ROUND': return handleNextRound(action, client);
      case 'PREV_ROUND': return handlePrevRound(action, client);
      case 'RESET_GAME': return handleResetGame(action, client);
      case 'SET_TRIGGER': return handleSetTrigger(action, famIdx);
      case 'CHECK_MATH': return handleCheckMath(action, famIdx);
      case 'RESTORE_CREDIT': return handleRestoreCredit(action, famIdx);
      case 'TOGGLE_SECRET': return handleToggleSecret(famIdx);
      case 'SAVE_FINAL': return handleSaveFinal(action, famIdx);
      default: return { error: '未知操作类型: ' + action.type };
    }
  } catch (e) {
    return { error: e.message };
  }
}

function handleSelectFamily(action, famIdx) {
  if (famIdx < 0) return { error: "讲师不需要选择家族" };
  const s = state.families[famIdx];
  if (s.allocated) actStart(state, famIdx);
  return { success: true };
}

function handleAllocate(action, famIdx) {
  const s = state.families[famIdx];
  if (s.allocated) return { error: "已经完成资产配置" };
  const { stock, bond, commodity, reflection } = action.payload;
  if ([stock, bond, commodity].some(x => x < 0)) return { error: "配置金额不能为负数。" };
  const invested = stock + bond + commodity;
  if (invested > INITIAL) return { error: "配置超过 500 万" };
  if (!reflection || reflection.length < 8) return { error: "请先完成深层问题（至少 8 个字）" };
  
  s.cash = INITIAL - invested; s.reserve = 0; s.stock = stock; s.bond = bond; s.commodity = commodity; s.allocated = true;
  s.ref[0] = reflection;
  s.history.unshift("🧭 初始配置：现金" + fm(s.cash) + "/股票" + fm(stock) + "/债券" + fm(bond) + "/商品" + fm(commodity));
  
  const liquid = s.cash, sr = stock / INITIAL;
  const maxA = Math.max(s.cash, stock, bond, commodity);
  const names = { cash: "现金", stock: "股票", bond: "债券", commodity: "大宗商品" };
  const maxName = names[Object.entries({ cash: s.cash, stock, bond, commodity }).sort((a, b) => b[1] - a[1])[0][0]];
  const risk = (liquid < 80 || maxA > INITIAL * .55) ? "高" : (liquid < 150 || maxA > INITIAL * .40) ? "中" : "低";
  addDecision(s, 0, "allocation", "500万资产配置",
    "现金" + fm(s.cash) + "万、股票" + fm(stock) + "万、债券" + fm(bond) + "万、大宗商品" + fm(commodity) + "万", risk,
    risk === "高" ? "可立刻动用的钱偏少或单一资产集中度过高" : risk === "中" ? "有一定缓冲" : "流动性与风险资产之间较均衡",
    "你把最大一笔钱放在\"" + maxName + "\"", "配置后可立刻动用 " + fm(liquid) + " 万。");
  s.decisions[s.decisions.length - 1].meta = { stockRatio: sr, liquid };
  
  actStart(state, famIdx);
  return { success: true, message: "资产配置完成" };
}

function handleSubmitConsume(action, famIdx) {
  const s = state.families[famIdx];
  if (s.consumeDone) return { error: "第二幕已经提交过了" };
  if (s.custody) return { error: "托管状态下不能消费" };
  const { items, buyNothing, anxiety, reflection } = action.payload;
  if (!items.length && !buyNothing) return { error: "至少选择一项消费或选择\"什么都不买\"" };
  if (!anxiety || anxiety.length < 4) return { error: "先写下你最强的那个消费焦虑" };
  if (!reflection || reflection.length < 8) return { error: "请先完成深层问题" };
  
  const allItems = SPECIAL[famIdx].concat(COMMON);
  const total = items.reduce((z, idx) => z + allItems[idx][1], 0);
  if (total > s.cash) return { error: "所选消费合计 " + total + " 万，当前现金只有 " + fm(s.cash) + " 万。" };
  
  const names = [], detail = [];
  const cashBefore = s.cash;
  const capBefore = { health: s.health, ability: s.ability, credit: s.credit, relation: s.relation, extra: s.extra };
  
  items.forEach(idx => {
    const x = allItems[idx]; names.push(x[0]); s.cash -= x[1];
    detail.push({ name: x[0], cost: x[1], cls: SPEND_CLASS[x[4]] || "消费", anx: x[2], effect: consumeDownside(x) });
    const k = x[4];
    if (k === "health") s.health = cl(s.health + 1);
    if (k === "protection") s.protection = true;
    if (k === "relation") s.relation = cl(s.relation + 1);
    if (k === "ability") s.ability = cl(s.ability + 1);
    if (k === "credit") s.credit = cl(s.credit + 1);
    if (k === "dual") { s.ability = cl(s.ability + 1); s.relation = cl(s.relation + 1) }
    if (k === "abilityCredit") { s.ability = cl(s.ability + 1); s.credit = cl(s.credit + 1) }
    if (k === "marketing") s.extra += 1;
    if (k === "income2") s.extra += 2;
    if (k === "passive") s.extra += 1;
    if (k === "sidebiz") { s.extra += 2; s.ability = cl(s.ability + 1) }
    if (k === "trap") s.credit = cl(s.credit - 1);
    if (k === "status") s.relation = cl(s.relation + 1);
    if (k === "marketing") s.relation = cl(s.relation - 1);
    if (k === "income2") s.relation = cl(s.relation - 1);
    if (k === "passive") s.relation = cl(s.relation - 1);
    if (k === "sidebiz") { s.relation = cl(s.relation - 1); s.health = cl(s.health - 1) }
    if (k === "credit") s.health = cl(s.health - 1);
    if (k === "ability" || k === "abilityCredit") s.relation = cl(s.relation - 1);
    if (!Array.isArray(s.spendKeys)) s.spendKeys = [];
    if (!Array.isArray(s.bought)) s.bought = [];
    s.spendKeys.push(k); s.bought.push(x[0]);
    const tg = menuTag(x[0]);
    if (tg === "edu") { s.eduSpend++; s.history.unshift("🎓 教育投入已记录") }
    if (tg === "med") { s.medSpend++; s.history.unshift("🏥 医疗保障已记录") }
    s.history.unshift("🛍️ " + x[0] + " -" + x[1] + "万｜痛点：" + x[2]);
  });
  if (buyNothing) s.history.unshift("🧘 第二幕：什么都不买");
  s.history.unshift("💭 最强消费焦虑：" + anxiety);
  s.ref[1] = reflection;
  
  const ratio = total / Math.max(1, s.cash + total);
  const risk = buyNothing || total <= 10 ? "低" : (ratio > .25 || total >= 45) ? "高" : "中";
  addDecision(s, 1, "consumption", "消费节选择", buyNothing ? "什么都不买" : names.join("、") + "，合计" + fm(total) + "万", risk,
    risk === "高" ? "消费占当时现金的比例较高" : risk === "中" ? "消费有其价值，但会明显降低短期的现金缓冲" : "消费规模较小",
    "你识别到自己的核心焦虑是\"" + anxiety + "\"", "消费后现金 " + fm(s.cash) + " 万。");
  s.decisions[s.decisions.length - 1].meta = { totalSpend: total, anxiety };
  s.consumeDone = true; s.consumeBill = { detail, total, none: buyNothing, anxiety, cashBefore, capBefore };
  recordTrail(s, 1);
  return { success: true, message: "第二幕已提交", consumeBill: s.consumeBill };
}

function handleSubmitPain(action, famIdx) {
  const s = state.families[famIdx];
  if (s.painDone) return { error: "本幕账单已结算" };
  if (!s.fateLife) return { error: "必须先抽生活命运袋" };
  const { choices, note, reflection } = action.payload;
  if (!reflection || reflection.length < 8) return { error: "请先完成深层问题" };
  if (!note || note.length < 6) return { error: "请先写清楚最难的是哪一张（至少 6 个字）" };
  
  const cards = painCards(s);
  for (let i = 0; i < cards.length; i++) {
    if (!choices[i]) return { error: "还有账单没有表态：「" + cards[i].n + "」" };
  }
  const paid = choices.filter(c => c.mode === "pay"), skipped = choices.filter(c => c.mode === "skip");
  const tot = paid.reduce((z, p) => z + p.card.c, 0);
  if (tot > s.cash + 0.001) return { error: "现金不够：需要 " + fm(tot) + " 万，只有 " + fm(s.cash) + " 万。" };
  
  s._currentAct = 2;
  paid.forEach(p => {
    const x = p.card;
    s.health = cl(s.health + (x.ph || 0)); s.relation = cl(s.relation + (x.pr || 0));
    if (x.k === "kid1") s.eduSpend++;
    if (x.k === "eld1" || x.k === "eld2" || x.k === "self1") s.medSpend++;
    if (x.k === "eld2" || x.k === "kid2" || x.k === "kid3") s.ability = cl(s.ability + 1);
    if (x.k === "self2") { s.ability = cl(s.ability + 1); if (!Array.isArray(s.spendKeys)) s.spendKeys = []; s.spendKeys.push("ability") }
    if (x.k === "rel1") s.credit = cl(s.credit + 1);
  });
  skipped.forEach(p => {
    const x = p.card;
    s.health = cl(s.health + (x.sh || 0)); s.relation = cl(s.relation + (x.sr || 0));
    if (x.sa) s.ability = cl(s.ability + x.sa);
    if (x.sinc) s.extra = (s.extra || 0) + x.sinc;
    addScarcity(s, 3, "pain", "没有处理「" + x.n + "」", "省下的钱记在账上，代价记在人身上");
  });
  if (tot > 0) spend(state, famIdx, tot, "第三幕痛点账单", 2);
  s.painDone = true; s.painSpent = tot; s.painNote = note; s.ref[2] = reflection;
  s.history.unshift("🧾 第三幕痛点账单｜处理：" + (paid.length ? paid.map(p => p.x.n).join("、") : "无")
    + "｜未处理：" + (skipped.length ? skipped.map(p => p.x.n).join("、") : "无") + "｜支出" + fm(tot) + "万");
  addDecision(s, 2, "pain", "痛点账单",
    "付钱处理 " + paid.length + " 张（" + fm(tot) + "万），不处理 " + skipped.length + " 张",
    skipped.length >= 2 ? "高" : skipped.length === 1 ? "中" : "低",
    skipped.length >= 2 ? "两张以上没有处理，健康与关系同时下滑" : skipped.length === 1 ? "有一张没有处理" : "三张全部处理",
    "你写下最难的一张是：\"" + note + "\"", "第三幕后现金" + fm(s.cash) + "万。");
  s.decisions[s.decisions.length - 1].meta = { paid: paid.map(p => p.card.n), skipped: skipped.map(p => p.card.n), total: tot, note };
  checkCustody(s, 2); recordTrail(s, 2);
  return { success: true, message: "第三幕已提交" };
}

function crisisOpts(fi) {
  const c = CRISIS[fi];
  return OPTSPEC.map((o, i) => ({
    key: o.key, name: o.name, desc: o.desc, flav: c.flav[i], unlocked: true,
    cost: Math.round(c.shock * o.costR), newDebt: Math.round(c.shock * o.debtR),
    sellNeed: o.sell ? Math.round(c.shock * o.sell) : 0,
    rMin: o.rMin, rMax: o.rMax, h: o.h, a: o.a, c: o.c, rel: o.rel, extra: o.extra
  }));
}

function handleSubmitCrisis(action, famIdx) {
  const s = state.families[famIdx];
  if (s.crisisDone) return { error: "第三幕危机已经处理过了。" };
  if (!s.fate3) return { error: "必须先抽第三幕命运袋。" };
  const { optionIndex, giveUp, reflection } = action.payload;
  if (!reflection || reflection.length < 8) return { error: "请先完成深层问题" };
  if (!giveUp || giveUp.length < 6) return { error: "请先写下这个选择你放弃了什么（至少 6 个字）" };
  
  const c = CRISIS[famIdx];
  const x = crisisOpts(famIdx)[optionIndex];
  if (!x) return { error: "请选择一种应对方案。" };
  if (x.cost > s.cash) return { error: "方案\"" + x.name + "\"需要 " + x.cost + " 万现金，你只有 " + fm(s.cash) + " 万。" };
  
  s._currentAct = 3;
  s.crisisGiveUp = giveUp; s.ref[3] = reflection;
  s.cash -= x.cost;
  if (x.newDebt > 0) { addBankDebt(state, famIdx, x.newDebt, "第三幕：" + c.name + "｜" + x.name); s.cash += x.newDebt;
    addScarcity(s, 3, "debt", "用新增债务 " + fm(x.newDebt) + " 万应对危机", "未来每一幕都要为这笔钱付利息"); }
  if (x.sellNeed > 0) {
    if (investable(s) <= 0.01) return { error: "方案需要变卖投资资产，但你没有可卖的资产。" };
    s.pledgedSell = (s.pledgedSell || 0) + x.sellNeed;
    spend(state, famIdx, x.sellNeed, "第四幕承诺变卖自救", 3);
  }
  const mult = s.ability >= 4 ? 1.12 : s.ability <= 2 ? 0.82 : 1;
  const pct = x.rMin + Math.random() * (x.rMax - x.rMin);
  const red = Math.round(c.shock * pct * mult);
  const actual = Math.max(0, c.shock - red);
  s.health = cl(s.health + x.h); s.ability = cl(s.ability + x.a); s.credit = cl(s.credit + x.c); s.relation = cl(s.relation + x.rel); s.extra += x.extra;
  spend(state, famIdx, actual, "第三幕危机：" + c.name, 2);
  s.crisisDone = true; s.crisisChoice = x.name;
  s.history.unshift("🌪️ 第三幕：" + c.name + "｜方案\"" + x.name + "\"｜成本" + fm(x.cost) + "万｜实际减损" + red + "万｜仍需承担" + actual + "万");
  if (x.h < 0 || x.rel < 0) addScarcity(s, 3, "family", "用家人的健康/关系顶住了危机", "健康" + x.h + "、关系" + x.rel);
  if (x.extra < 0) addScarcity(s, 3, "future", "主动缩减规模，未来每幕收入永久 -" + Math.abs(x.extra) + " 万", "今天的安全，用明天的收入买单");
  const risk = (x.newDebt > 0 || actual >= c.shock * .5) ? "高" : (actual >= c.shock * .3 || x.cost >= c.shock * .15) ? "中" : "低";
  addDecision(s, 3, "crisis", "危机应对：" + c.name,
    "选择\"" + x.name + "\"；主动成本" + fm(x.cost) + "万，实际减损" + red + "万，仍承担" + actual + "万" + (x.newDebt ? "，新增债务" + fm(x.newDebt) + "万" : ""),
    risk, risk === "高" ? "留下了较大的损失或新增了杠杆" : risk === "中" ? "在成本、损失和未来能力之间做了交换" : "显著降低了冲击",
    "你写下的放弃是：\"" + giveUp + "\"", "危机后现金" + fm(s.cash) + "万、总负债" + fm(totalDebt(s)) + "万。");
  s.decisions[s.decisions.length - 1].meta = { newDebt: x.newDebt, remainingLoss: actual, optionKey: x.key, giveUp };
  checkCustody(s, 3); recordTrail(s, 3);
  const carry = Math.round((s.carryOver || 0) * 10) / 10;
  return { success: true, message: "第三幕结算完成。\n方案：" + x.name + "\n主动成本 " + fm(x.cost) + " 万，实际减损 " + red + " 万，仍需承担 " + actual + " 万。\n现金 " + fm(s.cash) + " 万｜总负债 " + fm(totalDebt(s)) + " 万" + (carry > 0 ? "\n其中 " + fm(carry) + " 万是结转缺口。" : "") };
}

function handleSubmitDebt(action, famIdx) {
  const s = state.families[famIdx];
  if (!s.fate4) return { error: "必须先抽第四幕命运袋。" };
  const { repayBankAmt, repayPeerAmt, reflection } = action.payload;
  if (!reflection || reflection.length < 8) return { error: "请先完成深层问题" };
  const a = repayBankAmt || 0, b = repayPeerAmt || 0;
  if (a + b > s.cash) return { error: "计划付款 " + fm(a + b) + " 万，但现金只有 " + fm(s.cash) + " 万。" };
  
  s._currentAct = 4;
  s.ref[4] = reflection;
  let br = { paid: 0 }, pr = { paid: 0 };
  if (a > 0) {
    if (s.debt <= 0) return { error: "你没有银行债务。" };
    br = repayBank(state, famIdx, a);
  }
  if (b > 0) {
    if (s.peerDebt <= 0) return { error: "你没有同伴借款。" };
    pr = repayPeer(state, famIdx, b);
  }
  if (br.paid + pr.paid > 0) { s.credit = cl(s.credit + 1); s.history.unshift("🧾 第四幕偿债：银行" + fm(br.paid) + "万、同伴" + fm(pr.paid) + "万，信用+1"); }
  else if (totalDebt(s) > 0) { s.history.unshift("🧾 第四幕：选择不偿还，债务继续计息"); addScarcity(s, 3, "nopay", "有负债但本幕未偿还", "利息会继续累积"); }
  addDecision(s, 3, "repayment", "债务处理",
    br.paid + pr.paid > 0 ? "银行付款" + fm(br.paid) + "万；同伴付款" + fm(pr.paid) + "万" : "本幕未偿还",
    totalDebt(s) > 60 ? "高" : totalDebt(s) > 0 ? "中" : "低",
    totalDebt(s) > 60 ? "偿债后仍有较高负债" : totalDebt(s) > 0 ? "主动偿还降低了杠杆" : "当前已无债务约束",
    "是否主动偿债，比\"能不能借到钱\"更能体现信用纪律", "偿债后银行债" + fm(s.debt) + "万。");
  checkCustody(s, 3); recordTrail(s, 3);
  return { success: true, message: "第五幕已提交" };
}

function repayBank(state, famIdx, total) {
  const s = state.families[famIdx];
  let remaining = Math.max(0, Number(total || 0)); if (remaining <= 0) return { paid: 0 };
  const loans = state.bankLoans.filter(x => x.borrower === famIdx && x.outstanding > 0.001);
  const maxDue = loans.reduce((z, l) => z + l.outstanding, 0);
  remaining = Math.min(remaining, maxDue);
  if (s.cash < remaining) return null;
  let paid = remaining;
  for (const loan of loans) {
    if (remaining <= 0.001) break;
    const pmt = Math.min(remaining, loan.outstanding);
    loan.outstanding -= pmt; s.debt = Math.max(0, s.debt - pmt); remaining -= pmt;
  }
  s.cash -= paid;
  return { paid };
}

function repayPeer(state, famIdx, total) {
  const s = state.families[famIdx];
  let remaining = Math.max(0, Number(total || 0)); if (remaining <= 0) return { paid: 0 };
  const loans = state.loans.filter(x => x.to === famIdx && x.principalOutstanding > 0.001);
  const maxDue = loans.reduce((z, l) => z + l.principalOutstanding * (1 + l.rate / 100), 0);
  remaining = Math.min(remaining, maxDue);
  if (s.cash < remaining) return null;
  let paid = remaining, interest = 0;
  for (const loan of loans) {
    if (remaining <= 0.001) break;
    const factor = 1 + loan.rate / 100, due = loan.principalOutstanding * factor;
    const pmt = Math.min(remaining, due), pp = Math.min(loan.principalOutstanding, pmt / factor), ii = pmt - pp;
    const lender = state.families[loan.from];
    loan.principalOutstanding -= pp; s.peerDebt = Math.max(0, s.peerDebt - pp);
    lender.peerReceivable = Math.max(0, lender.peerReceivable - pp); lender.cash += pmt;
    interest += ii; remaining -= pmt;
    if (loan.principalOutstanding <= 0.001) loan.repaid = true;
  }
  s.cash -= paid;
  return { paid, interest };
}

function eligibleLenders(state, famIdx) {
  return state.families.map((x, i) => ({ x, i })).filter(o => o.i !== famIdx && totalDebt(o.x) === 0 && o.x.cash >= 10 && !o.x.custody);
}

function handleBorrowBank(action, famIdx) {
  const s = state.families[famIdx];
  const { amount, purpose } = action.payload;
  if (amount <= 0) return { error: "请输入要借入的本金金额。" };
  if (s.custody) return { error: "托管状态下不能新增投资。" };
  const pur = purpose === "prod";
  addBankDebt(state, famIdx, amount, "第" + (state.round + 1) + "幕主动借款·" + (pur ? "创造新收入或选择权" : "填补当期缺口"), pur);
  s.cash += amount;
  if (!pur) addScarcity(s, state.round, "debt", "借入 " + fm(amount) + " 万用于填补缺口", "今天的喘息，是从未来的收入里预支的");
  const cov = coverage(s, state.round);
  const risk = (!pur && cov < 1.25) ? "高" : pur && cov >= 1.25 ? "中" : "高";
  addDecision(s, state.round, "loan", "向银行借款", "借入" + fm(amount) + "万，利率" + Math.round(debtRate(s) * 100) + "%/幕｜用途：" + (pur ? "创造新收入或选择权" : "填补当期缺口"), risk,
    pur ? "用于创造新现金流的债务" : "用于填补持续性亏空的债务",
    pur ? "你用未来的现金流买下了今天不必卖资产的自由" : "如果下一幕还要再借一次来填同一个洞，那说明问题不在钱不够",
    "总负债升至" + fm(totalDebt(s)) + "万。");
  return { success: true };
}

function handleRepay(action, famIdx) {
  const s = state.families[famIdx];
  const { kind, amount } = action.payload;
  if (amount <= 0) return { error: "请输入偿还金额。" };
  if (amount > s.cash) return { error: "现金不足：当前现金 " + fm(s.cash) + " 万。" };
  if (kind === "bank") {
    if (s.debt <= 0) return { error: "当前没有银行债务。" };
    const r = repayBank(state, famIdx, amount); if (!r) return { error: "现金不足。" };
    s.history.unshift("✅ 还银行 " + fm(r.paid) + "万");
    addDecision(s, state.round, "repayment", "偿还银行债务", "付款" + fm(r.paid) + "万", "低", "主动减少负债", "你把现金用在解除过去的承诺上", "银行负债降至" + fm(s.debt) + "万。");
  } else {
    if (s.peerDebt <= 0) return { error: "当前没有同伴借款。" };
    const r = repayPeer(state, famIdx, amount); if (!r) return { error: "现金不足。" };
    s.history.unshift("✅ 还同伴 " + fm(r.paid) + "万（利息" + fm(r.interest) + "）");
    addDecision(s, state.round, "repayment", "偿还同伴借款", "付款" + fm(r.paid) + "万", "低", "履约不仅减少负债，也保护未来的合作信用", "你用实际还款证明信用", "同伴负债降至" + fm(s.peerDebt) + "万。");
  }
  s.credit = cl(s.credit + 1); checkCustody(s, state.round);
  return { success: true };
}

function handleLiquidate(action, famIdx) {
  const s = state.families[famIdx];
  const { kind, amount } = action.payload;
  if (amount <= 0) return { error: "请输入要卖出的本金金额。" };
  if (amount > s[kind] + 0.001) return { error: "持有本金只有 " + fm(s[kind]) + " 万。" };
  const rate = LIQ[kind], got = amount * rate, loss = amount - got;
  s[kind] -= amount; s.cash += got; s.forcedSells = (s.forcedSells || 0) + 1;
  const label = { stock: "股票", bond: "债券", commodity: "大宗商品" }[kind];
  s.history.unshift("📉 折价变现" + label + " 本金" + fm(amount) + "万 → 现金" + fm(got) + "万（损失" + fm(loss) + "万）");
  addScarcity(s, state.round, "sell", "折价卖出" + label + fm(amount) + "万，只拿回" + fm(got) + "万", "永久损失了 " + fm(loss) + " 万本金");
  addDecision(s, state.round, "liquidation", "折价变现" + label, label + "本金" + fm(amount) + "万换回现金" + fm(got) + "万",
    kind === "stock" ? "高" : "中", "为流动性接受折价", "你选择用长期资产的价值，换今天必须付的钱", "本金减少" + fm(amount) + "万。");
  return { success: true };
}

function handleUseReserve(action, famIdx) {
  const s = state.families[famIdx];
  const { amount } = action.payload;
  if (amount <= 0) return { error: "请输入要提取的金额。" };
  if (amount > s.reserve + 0.001) return { error: "储备只有 " + fm(s.reserve) + " 万。" };
  s.reserve -= amount; s.cash += amount;
  s.history.unshift("🔓 动用储备 " + fm(amount) + "万 → 现金");
  return { success: true };
}

function handleInvestMore(action, famIdx) {
  const s = state.families[famIdx];
  if (s.custody) return { error: "托管状态下不能新增投资。" };
  const { stock, bond, commodity } = action.payload;
  const tot = stock + bond + commodity;
  if (tot <= 0) return { error: "请输入要买入的金额。" };
  if (tot > s.cash) return { error: "现金不足：计划买入 " + fm(tot) + " 万，现金只有 " + fm(s.cash) + " 万。" };
  s.cash -= tot; s.stock += stock; s.bond += bond; s.commodity += commodity;
  s.history.unshift("📈 主动买入｜股票" + fm(stock) + "/债券" + fm(bond) + "/商品" + fm(commodity) + "万，现金-" + fm(tot) + "万");
  const cov = coverage(s, state.round);
  addDecision(s, state.round, "invest", "主动增加投资", "买入股票" + fm(stock) + "万、债券" + fm(bond) + "万、商品" + fm(commodity) + "万",
    cov < 1.5 ? "高" : cov < 2.5 ? "中" : "低",
    cov < 1.5 ? "在流动性覆盖偏低时继续把现金变成资产" : cov < 2.5 ? "投资合理，但缓冲不算宽裕" : "在保有充足缓冲的前提下增加长期资产",
    "买入的时点比买入的品种更能说明问题", "买入后现金" + fm(s.cash) + "万。");
  return { success: true };
}

function handleTransferReserve(action, famIdx) {
  const s = state.families[famIdx];
  const { direction, amount } = action.payload;
  if (amount <= 0) return { error: "请输入金额。" };
  if (direction === "to") {
    if (amount > s.cash) return { error: "现金不足：当前现金" + fm(s.cash) + "万。" };
    s.cash -= amount; s.reserve += amount;
    s.history.unshift("🛡️ 现金→储备 " + fm(amount) + "万");
  } else {
    if (amount > s.reserve) return { error: "储备不足：当前储备" + fm(s.reserve) + "万。" };
    s.reserve -= amount; s.cash += amount;
    s.history.unshift("🔓 储备→现金 " + fm(amount) + "万");
  }
  return { success: true };
}

function handleSubmitCoop(action, famIdx) {
  const a = state.families[famIdx];
  const { mode, projectIndex, mateIndices, stake, adv, pitch, reflection } = action.payload;
  if (!reflection || reflection.length < 8) return { error: "请先完成深层问题" };
  if (mode === "out") {
    a.coopOptOut = true; a.ref[5] = reflection;
    a.history.unshift("🚪 第六幕：选择不参与任何合作项目，保留现金 " + fm(a.cash) + "万");
    addDecision(a, 5, "cooperation", "合作市场", "选择不参与任何项目", "低", "不意味着完全避开风险", "拒绝一个自己看不懂的项目", "第六幕后现金" + fm(a.cash) + "万。");
    recordTrail(a, 5);
    return { success: true };
  }
  if (a.custody) return { error: "托管状态下不能参与合作。" };
  if (a.coopPick || a.coopOptOut) return { error: "你这一幕已经做过选择了。" };
  
  const p = COOP[projectIndex];
  if (!p) return { error: "请选择一个合作项目。" };
  if (!coopQualified(a, p)) return { error: "你的家庭资本达不到「" + p.name + "」的门槛。" };
  if (stake < p.min) return { error: "你的出资至少 " + p.min + " 万。" };
  if (stake > a.cash) return { error: "现金不足。" };
  if (coopRoster(state, p.name).length + 1 + mateIndices.length > p.cap) return { error: "这个项目的合作家庭已经太多了。" };
  if (!adv || adv.length < 4 || !pitch || pitch.length < 10) return { error: "请完成家族优势和孩子竞选词。" };
  
  // 验证合作家庭
  const plan = [];
  for (const mi of mateIndices) {
    const m = state.families[mi];
    if (m.custody) return { error: m.name + " 处于托管状态，无法参与合作。" };
    if (m.coopPick || m.coopOptOut) return { error: m.name + " 这一幕已经做过选择了。" };
    if (!coopQualified(m, p)) return { error: m.name + " 的家庭资本达不到门槛。" };
    plan.push({ i: mi, f: m, stake: p.min }); // 简化：被邀请方出资最低额
  }
  
  const members = [{ i: famIdx, f: a, stake }].concat(plan);
  members.forEach(o => {
    o.f.cash -= o.stake; o.f.coopPick = p.name; o.f.coopStake = o.stake; o.f.ref[5] = reflection;
    o.f.history.unshift("🤝 合作项目「" + p.name + "」｜本家出资" + fm(o.stake) + "万｜同组：" + members.filter(x => x.i !== o.i).map(x => x.f.name).join("、"));
  });
  a.coopAdv = adv; a.coopPitch = pitch;
  members.forEach(o => {
    const ratio = o.stake / Math.max(1, netWorth(o.f) + o.stake);
    addDecision(o.f, 5, "cooperation", "合作市场",
      "参与「" + p.name + "」，出资" + fm(o.stake) + "万；同组：" + members.filter(x => x.i !== o.i).map(x => x.f.name).join("、"),
      ratio > .3 ? "高" : ratio > .12 ? "中" : "低",
      ratio > .3 ? "出资占净资产比例很高" : ratio > .12 ? "出资规模适中" : "出资规模谨慎",
      o.i === famIdx ? "你写的优势是\"" + adv + "\"" : "你被" + a.name + "邀请加入",
      "第六幕后现金" + fm(o.f.cash) + "万。");
    checkCustody(o.f, 5); recordTrail(o.f, 5);
  });
  return { success: true, message: "组队成功：「" + p.name + "」\n" + members.map(o => T[o.i].icon + " " + o.f.name + "　出资 " + fm(o.stake) + " 万").join("\n") };
}

function handleSubmitTreasure(action, famIdx) {
  const s = state.families[famIdx];
  if (s.gameEnded) return { error: "第七幕已经提交并结算过了。" };
  const { skip, amount, source, worst, reflection } = action.payload;
  if (!reflection || reflection.length < 8) return { error: "请先完成深层问题" };
  
  s._currentAct = 6;
  s.ref[6] = reflection;
  settleCoop(state);
  
  if (skip === "skip") {
    const liquidLeft = s.cash;
    s.history.unshift("🧘 第七幕：不参与宝藏计划，直接结算（当时可动用 " + fm(liquidLeft) + " 万）");
    addDecision(s, 6, "treasure", "潮镇宝藏计划", "选择不参与，直接结算", liquidLeft >= 60 ? "低" : "中",
      liquidLeft >= 60 ? "手上仍有可投的钱却选择不投" : "可动用资金本来就不多",
      "在一个 50% 归零的项目面前选择不动手", "结束时可动用 " + fm(liquidLeft) + " 万。");
    s.decisions[s.decisions.length - 1].meta = { source: "none", amount: 0, success: null, skipped: true, liquidLeft };
  } else if (!skip) {
    if (amount <= 0) return { error: "投入金额必须大于 0。" };
    if (!worst || worst.length < 10) return { error: "请先写清楚最坏情境（至少 10 个字）。" };
    if (source === "cash") {
      if (s.cash < amount) return { error: "现金不足：" + fm(s.cash) + "万。" };
      s.cash -= amount;
    } else {
      addBankDebt(state, famIdx, amount, "第六幕潮镇宝藏计划");
      addScarcity(s, 6, "debt", "借款 " + fm(amount) + " 万去博一次 50%", "把还没赚到的钱先押了出去");
    }
    const ratio = amount / Math.max(1, netWorth(s) + amount);
    const success = Math.random() < 0.5;
    if (success) s.cash += amount * 3; else s.credit = cl(s.credit - 1);
    s.treasureBet = { amount, src: source, success };
    state.treasureLog = state.treasureLog || [];
    state.treasureLog.push({ fam: famIdx, amount, src: source, success });
    s.history.unshift("🎯 潮镇宝藏计划" + (success ? "成功：翻三倍，返还" + fm(amount * 3) + "万" : "失败：投入" + fm(amount) + "万全部损失"));
    const trisk = source === "debt" ? "高" : (ratio > .3 ? "高" : ratio > .12 ? "中" : "低");
    addDecision(s, 6, "treasure", "潮镇宝藏计划",
      "投入" + fm(amount) + "万，来源" + (source === "cash" ? "现金" : "银行借款") + "，结果" + (success ? "翻三倍" : "全部损失"), trisk,
      source === "debt" ? "用借来的钱参与 50% 归零的项目" : trisk === "高" ? "投入占家庭净资产比例过高" : "仓位控制在可承受范围内",
      "你写下的最坏情境是：\"" + worst + "\"", "第七幕后现金" + fm(s.cash) + "万。");
    s.decisions[s.decisions.length - 1].meta = { source, amount, success, worst, ratio };
  } else {
    s.history.unshift("🚫 第七幕：托管状态下无法参与，直接结束");
    addDecision(s, 6, "treasure", "潮镇宝藏计划", "托管状态，没有参与资格", "高", "最后一次机会出现时已经没有资源", "你没有做错这一步", "以托管状态结束。");
  }
  
  const macro = Math.random();
  s.stockRet = macro < .20 ? -0.45 : macro < .40 ? -0.12 : macro < .72 ? 0.08 : macro < .90 ? 0.22 : 0.40;
  s.comRet = 0.02 + Math.random() * 0.16;
  checkCustody(s, 6); recordTrail(s, 6);
  s.gameEnded = true;
  s.portrait = buildPortrait(s);
  buildTreasureReport(state);
  return { success: true, message: "第七幕已结算", portrait: s.portrait };
}

function handleNextRound(action, client) {
  if (client.role !== 'host') return { error: '只有讲师可以推进幕次' };
  if (state.round >= 6) return { error: '已经是最后一幕' };
  state.round++;
  if (state.round === 6) settleCoop(state);
  state.families.forEach((s, i) => { if (s.allocated) actStart(state, i) });
  return { success: true, round: state.round };
}

function handlePrevRound(action, client) {
  if (client.role !== 'host') return { error: '只有讲师可以推进幕次' };
  if (state.round <= 0) return { error: '已经是第一幕' };
  state.round--;
  return { success: true, round: state.round };
}

function handleResetGame(action, client) {
  if (client.role !== 'host') return { error: '只有讲师可以重置游戏' };
  const ng = newGame();
  Object.assign(state, ng);
  return { success: true, message: '游戏已重置' };
}

function handleSetTrigger(action, famIdx) {
  const s = state.families[famIdx];
  const { key, value } = action.payload;
  triggerState(s)[key] = value;
  return { success: true };
}

function handleCheckMath(action, famIdx) {
  const s = state.families[famIdx];
  const m = mathState(s);
  const { answer } = action.payload;
  if (Math.abs(answer - m.a) < .001) {
    m.passed = true; s.ability = cl(s.ability + 1);
    s.history.unshift("🧮 计算题通过：" + m.ex + "；能力+1");
    return { success: true, passed: true };
  }
  return { success: true, passed: false, error: "答案不对，再算一次。" };
}

function handleRestoreCredit(action, famIdx) {
  const s = state.families[famIdx];
  const { advantage } = action.payload;
  if (!advantage || advantage.length < 4) return { error: "先说出具体的家族优势。" };
  s.credit = Math.max(3, s.credit);
  s.history.unshift("📣 全场同意：\"" + advantage + "\"，信用恢复至3");
  return { success: true };
}

function handleToggleSecret(famIdx) {
  const s = state.families[famIdx];
  s.secret = !s.secret;
  return { success: true };
}

function handleSaveFinal(action, famIdx) {
  const s = state.families[famIdx];
  const { text } = action.payload;
  s.final = text || "";
  return { success: true };
}

module.exports = {
  execute, newGame, mk, cl, fm, assets, totalDebt, netWorth, debtRatio, investable,
  debtRate, nextLiving, coverage, optionIndex, settlement, buildPortrait,
  eligibleLenders, coopQualified, coopRoster, painCards, crisisOpts, fateRound,
  riskClass, scoreClass, futureMap, turningPoint, riskVerdict, bearableLoss
};
