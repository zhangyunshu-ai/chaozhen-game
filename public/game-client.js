/* ===================== 潮镇多人版 - 前端客户端 ===================== */
/* 全局状态：从服务端推送 */
let g = null;
let sel = 0;
let myRole = 'host';        // 'host' | 'family0'..'family6'
let myFamilyIdx = -1;       // -1=讲师, 0-6=家族
let ws = null;
let connected = false;
let isHost = false;

/* 常量（从服务端状态中附带，或前端内置） */
const T_NAMES = ['远航贸易家','智造工坊家','潮味餐馆家','双薪稳健家','海湾民宿家','现金堡垒家','星潮创业家'];
const T_ICONS = ['🚢','🤖','🍜','🏠','🌊','🏦','🚀'];

/* ===================== WebSocket 连接 ===================== */
function init() {
  const params = new URLSearchParams(location.search);
  const roomId = params.get('room');
  myRole = params.get('role') || 'host';
  isHost = myRole === 'host';
  myFamilyIdx = isHost ? 0 : parseInt(myRole.replace('family', ''));

  if (!roomId) {
    document.getElementById('connStatus').textContent = '缺少房间号参数';
    return;
  }

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${location.host}?room=${roomId}&role=${myRole}`;
  document.getElementById('connStatus').textContent = `连接 ${wsUrl}…`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    connected = true;
    document.getElementById('connStatus').textContent = '已连接，等待数据…';
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  };

  ws.onclose = () => {
    connected = false;
    document.getElementById('connStatus').textContent = '连接已断开，正在重连…';
    setTimeout(() => location.reload(), 2000);
  };

  ws.onerror = (err) => {
    document.getElementById('connStatus').textContent = '连接错误';
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'CONNECTED':
      g = msg.state;
      document.getElementById('connecting').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
      if (isHost) {
        sel = 0;
      } else {
        sel = myFamilyIdx;
      }
      renderAll();
      break;
    case 'STATE_UPDATE':
      g = msg.state;
      renderAll();
      if (msg.message) {
        // 有通知消息
      }
      break;
    case 'NOTICE':
      alert(msg.message);
      break;
    case 'ERROR':
      alert(msg.message);
      break;
    case 'PLAYER_JOINED':
    case 'PLAYER_LEFT':
      // 只更新在线人数
      break;
  }
}

function send(type, payload = {}) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

/* ===================== 视图切换 ===================== */
const HOST_PASSWORD = "556765";
let hostUnlocked = false;

function view(v) {
  if (v === 'host' && !hostUnlocked) {
    const input = prompt('请输入讲师密码：');
    if (input !== HOST_PASSWORD) {
      alert('密码错误');
      return;
    }
    hostUnlocked = true;
  }
  ['player', 'host', 'ending'].forEach(x => {
    const el = document.querySelector('#' + x + 'View');
    if (el) el.classList.toggle('hidden', x !== v);
  });
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.v === v));
  if (v === 'host') renderHost();
  if (v === 'ending') renderEnding();
}

/* ===================== 渲染：宏观数据 ===================== */
function renderMacro() {
  // 宏观数据是静态的，直接写
  const MACRO = [
    "上半年国内生产总值 695704 亿元，同比增长 4.7%；一季度增长 5.0%，二季度回落到 4.3%。",
    "分产业看：第一产业 +3.7%、第二产业 +3.9%、第三产业（服务业）+5.2%。规模以上工业增加值 +5.4%，其中制造业 +5.6%。",
    "结构分化非常剧烈：装备制造业 +9.3%、高技术制造业 +13.3%，而房地产开发投资同比下降 18.0%。",
    "社会消费品零售总额同比只增长 1.3%（商品零售 +1.1%、餐饮收入 +2.8%），居民消费明显更谨慎。",
    "所以第三幕不抽公共灾难：同一个宏观环境，7 个家族会掉进 7 个完全不同的坑。"
  ];
  document.querySelector('#macroList').innerHTML = MACRO.map(x => '<li>' + x + '</li>').join('');
  document.querySelector('#macroSource').textContent = "数据来源：国家统计局 2026 年上半年国民经济运行情况。游戏内的收入、生活成本、危机金额与资产收益率均为教学示例数字。";
}

/* ===================== 计算函数（前端镜像） ===================== */
const cl = x => Math.max(0, Math.min(5, x));
const fm = x => (Math.round(Number(x || 0) * 10) / 10) + "";
const assets = s => s.cash + s.reserve + s.stock + s.bond + s.commodity + s.peerReceivable;
const totalDebt = s => s.debt + s.peerDebt;
const netWorth = s => assets(s) - totalDebt(s);
const debtRatio = s => totalDebt(s) / Math.max(1, assets(s));
const investable = s => s.stock + s.bond + s.commodity;
const LIVING = [7, 8, 9, 10, 11, 12, 13];

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
const MARGIN_TRIGGER = 1.25;
const INFLATION = 0.06;
const INITIAL = 500;

/* ===================== 渲染：家族选择 ===================== */
function renderFamilies() {
  if (isHost) {
    document.querySelector('#families').innerHTML = g.families.map((s, i) => {
      return `<div class="family ${i === sel ? 'selected' : ''} ${s.secret ? 'open' : ''}" onclick="selectFamily(${i})">
        <div style="font-size:28px">${T_ICONS[i]}</div><h3>${s.name}</h3>
        <div class="meta">${s.allocated ? '已开始' : '未开始'} ${s.custody ? '· 🚨托管' : ''}</div>
      </div>`;
    }).join("");
  } else {
    // 玩家只显示自己的家族
    const s = g.families[myFamilyIdx];
    document.querySelector('#families').innerHTML = `<div class="family selected open" onclick="selectFamily(${myFamilyIdx})">
      <div style="font-size:28px">${T_ICONS[myFamilyIdx]}</div><h3>${s.name}</h3>
      <div class="meta">这是你的家族</div>
    </div>`;
  }
}

function selectFamily(i) {
  if (!isHost && i !== myFamilyIdx) return;
  sel = i;
  send('SELECT_FAMILY', { familyIndex: i });
  document.querySelector('#playerGame').classList.remove('hidden');
  renderAll();
}

/* ===================== 渲染：档案 ===================== */
const T_DATA = [
  {name:"远航贸易家",icon:"🚢",public:"跨境贸易企业主家庭。账面收入高，但回款慢、汇率与贸易政策敏感。",
    dossier:{members:"父亲42岁经营外贸公司；母亲39岁管理家庭资金；孩子14岁。",income:"家庭每幕固定收入10万，企业利润波动大，旺季明显。",business:"70%订单来自海外，最大客户占收入35%；账期60—90天。",housing:"自住房1套，无房贷；另有公司仓库租赁。",education:"父母希望孩子未来留学，孩子更想学AI与产品设计。",risk:"企业现金流与家庭现金偶尔混用；父亲偏扩张，母亲偏安全。",secret:"你们刚收到大客户压价通知，同时担心新的贸易壁垒。"}},
  {name:"智造工坊家",icon:"🤖",public:"制造业家庭。客户压价、设备更新、AI自动化同时逼近。",
    dossier:{members:"父亲41岁工厂负责人；母亲38岁负责财务；孩子13岁。",income:"家庭每幕固定收入10万，80%来自企业分红与工资。",business:"传统零部件制造，前三大客户占收入55%；设备平均使用8年。",housing:"两套住房，其中一套出租。",education:"父母希望孩子未来接班，孩子喜欢机器人但不确定是否接班。",risk:"设备更新要花大钱，不更新又担心订单流失。",secret:"核心客户要求降价12%，同行开始使用AI质检与自动化。"}},
  {name:"潮味餐馆家",icon:"🍜",public:"餐饮家庭。现金流快，但食材、人工、能源和口碑都很敏感。",
    dossier:{members:"夫妻共同经营餐饮门店；孩子12岁，常在店里帮忙。",income:"家庭每幕固定收入10万，但旺季与淡季差异大。",business:"两家店，营业额不错但净利率仅约8%；平台流量费上升。",housing:"自住房1套，有少量房贷但本游戏不计入初始负债。",education:"父母给孩子报了很多课，却很少讨论孩子真正想学什么。",risk:"生意忙导致家庭关系容易紧张；成本稍涨就会侵蚀利润。",secret:"食材与能源成本上涨，同时一家门店被平台降权。"}},
  {name:"双薪稳健家",icon:"🏠",public:"工程师+教师家庭。收入稳定，但教育、养老和住房支出都有明确用途。",
    dossier:{members:"父亲40岁工程师；母亲38岁教师；孩子13岁。",income:"两人合计每幕固定收入约10万，稳定但增长有限。",business:"无企业经营资产。",housing:"自住房1套，另有一套老房需维修。",education:"父母非常重视教育，希望孩子走稳定路线；孩子想尝试新媒体与设计。",risk:"最大风险不是企业，而是单一职业能力、父母养老与教育支出同时出现。",secret:"父亲所在部门正在用AI自动化压缩岗位，外公又可能需要长期照护。"}},
  {name:"海湾民宿家",icon:"🌊",public:"旅游民宿家庭。旺季赚钱，但天气、平台和客流变化影响巨大。",
    dossier:{members:"夫妻经营民宿；孩子14岁。",income:"旺季一幕可超过15万，淡季可能只有3—5万，游戏内取固定10万。",business:"三套民宿房源，依赖线上平台；维护成本高。",housing:"自住房1套，经营房源以租赁为主。",education:"孩子喜欢摄影和旅行内容，父母希望孩子学习酒店管理。",risk:"收入高度季节化；极端天气会直接造成停业。",secret:"未来一段时间天气预警频繁，而你们刚投入一笔装修款。"}},
  {name:"现金堡垒家",icon:"🏦",public:"高储蓄、低负债家庭。最大优势是安全，最大风险是永远不敢承担可承受的试错。",
    dossier:{members:"父母都有稳定收入；孩子13岁。",income:"每幕固定收入约10万，过去十年储蓄率极高。",business:"没有主营企业，偶尔参与朋友项目。",housing:"两套自有住房，无贷款。",education:"父母愿意为教育花钱，但更习惯替孩子做选择。",risk:"把'绝不亏损'当作安全，容易被所谓保本高息产品诱惑。",secret:"一位非常信任的朋友正在邀请你投资一个'保本、年化12%'项目。"}},
  {name:"星潮创业家",icon:"🚀",public:"高增长创业家庭。最会抓机会，也最容易把公司风险穿透到家庭。",
    dossier:{members:"父亲创业公司CEO；母亲参与运营；孩子15岁。",income:"家庭每幕固定收入10万，但真实财富高度依赖公司股权。",business:"AI应用创业公司，增长快、烧钱也快；有个人担保。",housing:"自住房有抵押，但游戏初始不计债务。",education:"父母希望孩子具有创业精神；孩子已经开始迷恋'翻倍'和高收益。",risk:"家庭和企业资金边界模糊，融资一旦中断，个人担保可能触发。",secret:"下一轮融资被推迟，账上只能支撑约4个月运营。"}}
];

function renderDossier() {
  const t = T_DATA[sel], s = g.families[sel];
  document.querySelector('#dossier').innerHTML = '<div class="dossier">'
    + '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">'
    + '<div><span class="badge gold">家族完整档案</span><h3>' + t.icon + ' ' + t.name + '</h3></div>'
    + '<button class="btn small alt" onclick="toggleSecret()">查看/隐藏隐藏压力</button></div>'
    + '<div class="dossier-grid">'
    + '<div><b>家庭成员</b><br><small>' + t.dossier.members + '</small></div>'
    + '<div><b>收入结构</b><br><small>' + t.dossier.income + '</small></div>'
    + '<div><b>事业/职业</b><br><small>' + t.dossier.business + '</small></div>'
    + '<div><b>住房资产</b><br><small>' + t.dossier.housing + '</small></div>'
    + '<div><b>教育目标</b><br><small>' + t.dossier.education + '</small></div>'
    + '<div><b>核心脆弱点</b><br><small>' + t.dossier.risk + '</small></div></div>'
    + (s.secret ? '<div class="news"><b>隐藏压力：</b>' + t.dossier.secret + '</div>' : '') + '</div>';
}

function toggleSecret() { send('TOGGLE_SECRET', {}); }

/* ===================== 渲染：仪表盘 ===================== */
function renderGauges() {
  const s = g.families[sel], act = g.round;
  if (!s.allocated) { document.querySelector('#gauges').innerHTML = ""; document.querySelector('#runway').innerHTML = ""; return; }
  const cov = coverage(s, act), oi = optionIndex(s, act), dr = debtRatio(s);
  const covCls = cov >= 2 ? "ok" : cov >= 1 ? "warn" : "bad";
  const oiCls = oi >= 65 ? "ok" : oi >= 40 ? "warn" : "bad";
  const drCls = dr <= 0.2 ? "ok" : dr <= 0.5 ? "warn" : "bad";
  document.querySelector('#gauges').innerHTML =
    '<div class="gauge ' + oiCls + '"><div class="g-top"><span>选择权指数</span><span>0–100</span></div>'
    + '<div class="g-val">' + oi + '</div><div class="bar"><i style="width:' + oi + '%"></i></div>'
    + '<small>你现在还剩多少种可走的下一步。</small></div>'
    + '<div class="gauge ' + covCls + '"><div class="g-top"><span>流动性覆盖</span><span>安全线 ≥1.5</span></div>'
    + '<div class="g-val">' + fm(cov) + '×</div><div class="bar"><i style="width:' + Math.min(100, cov / 3 * 100) + '%"></i></div>'
    + '<small>现金 ÷ 下一幕刚性支出。</small></div>'
    + '<div class="gauge ' + drCls + '"><div class="g-top"><span>负债率</span><span>负债÷资产</span></div>'
    + '<div class="g-val">' + Math.round(dr * 100) + '%</div><div class="bar"><i style="width:' + Math.min(100, dr * 100) + '%"></i></div>'
    + '<small>当前借钱利率 ' + Math.round(debtRate(s) * 100) + '%/幕。</small></div>';

  const burn = nextLiving(act) + totalDebt(s) * debtRate(s);
  const runwayActs = burn > 0 ? (s.cash + s.reserve) / burn : 99;
  const rc = runwayActs >= 3 ? "" : runwayActs >= 1.5 ? "warn" : "bad";
  document.querySelector('#runway').className = "runway " + rc;
  document.querySelector('#runway').innerHTML =
    '⏳ 按现在的现金，你还能撑 <b>' + (runwayActs > 9 ? "9+" : fm(runwayActs)) + ' 幕</b>。'
    + '　下一幕刚性支出 ' + fm(nextLiving(act)) + ' 万' + (totalDebt(s) > 0 ? '，另需支付利息约 ' + fm(totalDebt(s) * debtRate(s)) + ' 万' : '') + '。';
}

function renderCustody() {
  const s = g.families[sel], box = document.querySelector('#custodyBanner');
  document.body.classList.toggle("custody", !!s.custody);
  if (!s.custody) { box.innerHTML = ""; return; }
  box.innerHTML = '<div class="custody-banner"><h4>🚨 你的家庭已进入托管状态</h4>'
    + '现金撑不住刚性支出已经连续两幕（或已资不抵债）。从现在开始，你<b>不能消费、不能参与合作、不能新增投资</b>。</div>';
}

function renderResources() {
  const s = g.families[sel];
  const a = [["💵","现金",fm(s.cash)+"万",s.cash<nextLiving(g.round)?"low":""],
    ["🛡️","储备",fm(s.reserve)+"万",""],
    ["📈","股票",fm(s.stock)+"万",""],
    ["📜","债券",fm(s.bond)+"万",""],
    ["🛢️","商品",fm(s.commodity)+"万",""],
    ["❤️","健康",s.health+"/5",s.health<3?"low":s.health===3?"mid":"high"],
    ["🧠","能力",s.ability+"/5",s.ability<3?"low":s.ability===3?"mid":"high"],
    ["🤝","信用",s.credit+"/5",s.credit<3?"low":s.credit===3?"mid":"high"],
    ["🏡","关系",s.relation+"/5",s.relation<3?"low":s.relation===3?"mid":"high"],
    ["🧾","负债",fm(totalDebt(s))+"万",totalDebt(s)>0?"low":""]];
  document.querySelector('#resources').innerHTML = a.map(x => '<div class="res"><span>' + x[0] + ' ' + x[1] + '</span><b class="' + x[3] + '">' + x[2] + '</b></div>').join("");
}

/* ===================== 渲染：同步状态 ===================== */
function renderSync() {
  const b = document.querySelector('#syncBar');
  if (!b) return;
  b.className = "sync-bar ok";
  b.innerHTML = '<span class="dot"></span> 已联机 · 房间 ' + (new URLSearchParams(location.search).get('room') || '')
    + (isHost ? ' · 你是讲师' : ' · 你是 ' + T_ICONS[myFamilyIdx] + ' ' + T_NAMES[myFamilyIdx]);
}

/* ===================== 渲染：历史记录 ===================== */
function renderHistory() {
  document.querySelector('#history').innerHTML = (g.families[sel].history || []).slice(0, 50).map(x => '<div>' + x + '</div>').join("") || "<div>尚无记录</div>";
}

/* ===================== 渲染：命运袋 ===================== */
function fateRound(r) { return r === 2 || r === 3 || r === 4 }

function renderFate() {
  const s = g.families[sel], r = g.round, b = document.querySelector('#fateBox');
  if (!fateRound(r)) {
    b.className = "fate"; b.innerHTML = '<div><small>本幕没有命运袋</small><h3>命运袋在第三、四、五幕</h3><p>危机最重、生活最沉、债务最紧的三幕，才是运气真正咬人的时候。</p></div>';
    return;
  }
  const e = r === 2 ? s.fateLife : r === 3 ? s.fate3 : s.fate4;
  if (!e) {
    b.className = "fate";
    b.innerHTML = '<div><span class="badge">' + (r === 2 ? "第一次｜生活命运袋" : r === 3 ? "第二次｜危机命运袋" : "第三次｜债务命运袋") + '</span><h3>尚未抽取</h3>'
      + '<p>' + (r === 2 ? "这一袋全是关于健康和关系的事。" : r === 3 ? "抽完才能进入你的家族危机。" : "抽完才能进入债务处理。") + '</p></div>'
      + '<button class="btn small gold" onclick="drawFate()">抽取命运袋</button>';
    return;
  }
  b.className = "fate " + e.kind;
  b.innerHTML = '<div><span class="badge">' + e.tag + '</span><h3>' + e.name + '</h3><p>' + e.story + '</p></div>'
    + '<b>' + ("现金影响 " + (e.actual >= 0 ? "+" : "") + e.actual + "万") + '</b>';
}

function drawFate() { send('DRAW_FATE', {}); }

/* ===================== 渲染：触发器 ===================== */
function renderTriggers() {
  const s = g.families[sel];
  if (!s.tr) s.tr = {};
  const t = s.tr[g.round] || { wall: false, mouth: false };
  let h = "";
  if (totalDebt(s) > 0 || s.custody)
    h += '<div class="trigger"><h3>🦵 有负债：扎马步</h3><p>做决定前完成30秒扎马步。</p><label><input type="checkbox" ' + (t.wall ? "checked" : "") + ' onchange="setTrigger(\'wall\',this.checked)"> 已完成</label></div>';
  if (s.ability < 3) {
    const m = s.math && s.math[g.round];
    h += '<div class="trigger"><h3>🧮 能力<3：财商计算题</h3><div class="quiz"><b>' + (m ? m.q : '计算题加载中') + '</b>'
      + (m && m.passed ? "　✅ 已通过，能力+1" : '<input id="mathAns" type="number" step=".01" style="margin-top:7px"><button class="btn small" style="margin-top:7px" onclick="checkMath()">提交答案</button>') + '</div></div>';
  }
  if (s.relation < 3)
    h += '<div class="trigger"><h3>🗣️ 关系<3：嘴巴不能闲</h3><p>30秒内轮流说："我听见你最担心的是……"</p><label><input type="checkbox" ' + (t.mouth ? "checked" : "") + ' onchange="setTrigger(\'mouth\',this.checked)"> 讲师确认完成</label></div>';
  if (s.credit < 3)
    h += '<div class="trigger"><h3>📣 信用<3：全场信任路演</h3><p>向所有人说出一个真实的家族优势。</p><input id="trustAdv" type="text"><button class="btn small gold" style="margin-top:7px" onclick="restoreCredit()">全场同意</button></div>';
  document.querySelector('#triggerBox').innerHTML = h || '<div class="prereq">✅ 当前无额外行为触发。</div>';
}

function setTrigger(k, v) { send('SET_TRIGGER', { key: k, value: v }); }
function checkMath() {
  const v = Number(document.querySelector('#mathAns').value);
  send('CHECK_MATH', { answer: v });
}
function restoreCredit() {
  const v = (document.querySelector('#trustAdv').value || "").trim();
  if (v.length < 4) return alert("先说出具体的家族优势。");
  send('RESTORE_CREDIT', { advantage: v });
}

/* ===================== 渲染：债务 ===================== */
function renderDebt() {
  const s = g.families[sel], box = document.querySelector('#debtBox');
  if (totalDebt(s) <= 0) { box.innerHTML = ""; return; }
  const bankLoans = (g.bankLoans || []).filter(x => x.borrower === sel && x.outstanding > 0.001);
  const peerLoans = (g.loans || []).filter(x => x.to === sel && x.principalOutstanding > 0.001);
  const bankDue = bankLoans.reduce((z, l) => z + l.outstanding, 0);
  const peerDue = peerLoans.reduce((z, l) => z + l.principalOutstanding * (1 + l.rate / 100), 0);
  const rate = Math.round(debtRate(s) * 100);
  const ledger = bankLoans.map(l => '<tr><td>潮镇银行' + (l.bridge ? '·应急' : '') + '</td><td>' + fm(l.outstanding) + '万</td><td>' + l.rate + '%</td><td>' + l.reason + '</td></tr>').join("")
    + peerLoans.map(l => '<tr><td>🤝 ' + (g.families[l.from].name) + '</td><td>' + fm(l.principalOutstanding) + '万</td><td>' + l.rate + '%</td><td>同伴借款</td></tr>').join("");
  box.innerHTML = '<div class="debt-box"><b>🏦 当前债务</b>'
    + '<table><tr><th>债权人</th><th>未还本金</th><th>利率</th><th>原因</th></tr>' + ledger + '</table>'
    + '<p>欠银行 <b>' + fm(bankDue) + '</b> 万｜欠其他家庭约 <b>' + fm(peerDue) + '</b> 万。</p>'
    + '<p><b>当前利率 ' + rate + '%/幕</b>。</p></div>';
}

/* ===================== 反思框 ===================== */
const DEEPQ = [
  ["你家的钱和公司的钱，此刻是同一笔钱吗？如果最大客户明天消失，你希望哪一部分先被保护？","设备用了8年还能转，这算是资产还是负债？","你的生意每天都在收现金，这让你感觉安全。但如果连续两个月没有客流呢？","你们家最稳的是收入，最不稳的是'单一职业能力'。","旺季和淡季的差距这么大，你是在为平均的一年做配置，还是为最差的那一个月？","你把'绝不亏损'当作安全。但如果十年后购买力少了三成呢？","你最会抓机会，也最容易把公司风险带回家。这500万里，你愿意留出多少是公司绝对碰不到的？"],
  ["你刚刚最想买的那一项，是为了拿下订单，还是为了让自己看起来还在增长？","'不升级就被淘汰'这句话，是市场告诉你的，还是卖设备的人告诉你的？","店里生意忙的时候，你给孩子报的班，是孩子需要，还是你补偿自己的愧疚？","你们家最重视教育。但如果孩子想学的和你想让他学的不一样，钱应该听谁的？","你刚刚花的钱里，有多少是在买客流，有多少是在买心安？","你很少乱花钱，所以你更容易在大额上一次性做错。","你习惯用花钱换速度。有哪一笔如果慢一点决定，就可能不花？"],
  ["这一轮的账单里，哪一笔是为了公司，哪一笔是为了家？","你习惯用钱换效率。但孩子的补习、老人的检查，这两样钱换不来效率。","你店里最忙的时候，家里最需要你的是谁？","你们家两份收入都稳定，所以这些账单看起来都付得起。'付得起'和'值得付'，你分得清吗？","淡季还没过去，这些账单不会等你。你会先砍哪一样？","你有钱，所以这些账单对你只是数字。那你有没有想过，为什么它们对别人是命？","你一直在为未来花钱。这一轮的账单全是为了现在，一分钱都赚不回来。"],
  ["这次危机里，你最先想保住的是订单、现金，还是你在客户面前的形象？","你选的方案让家人更累了吗？","两家店只能保一家的时候，你判断的依据是数字，还是感情？","你们没有企业可以砍，只能砍自己的生活。","天气你控制不了，装修款是你自己投的。","你有很多现金，所以你可以硬扛。但硬扛和'不知道还能做什么'，你分得清吗？","公司出事，家庭兜底。你签下个人担保的那天，有没有和家人商量过？"],
  ["你的债务是为了扩张，还是为了填上一个你还没承认的窟窿？","如果这笔债务要还三年，这三年里你还敢不敢再上一次设备？","餐饮回款快，所以借钱看起来很安全。回款快和还得起，是同一件事吗？","你们家几乎没借过钱。第一次借钱的时候，你最怕别人怎么看你？","淡季借钱撑到旺季，是周转还是赌博？","你完全可以一次性还清。那你为什么还要犹豫？","你很擅长用未来的钱办今天的事。如果未来那一轮不来呢？"],
  ["合作需要交出一部分控制权。你上一次真正让别人替你做决定，是什么时候？","你的能力是别人需要的吗？还是你只是需要别人？","你的优势是现金流快、人缘好。哪一样是别人真正想跟你合作的原因？","你信用最高、负债最少，所以最被需要。被需要和被利用，你怎么分辨？","你的房源是资产，也是别人眼中的库存。你愿意让别人一起经营它吗？","你有钱但没人找你合作，缺的是什么？","你最会讲故事。这一幕里，你说服别人用的是事实，还是你的语速？"],
  ["三倍或者归零。如果这笔钱亏光，你的公司还能开门吗？","你已经投了设备，再投这一笔，是分散风险还是加倍下注？","你今天的现金是一天天收回来的。这一次你打算用几天的辛苦，换一次50%？","你一辈子都在避免风险。如果这次你参与了，是因为算过，还是因为看到别人在赚？","旺季来了就翻身。如果这次亏了，需要多少个旺季才能补回来？","你终于遇到一个'可能翻三倍'的机会。让你心动的是收益率，还是终于可以不再被说保守？","你落后了，所以你想翻盘。请诚实回答：这是投资决策，还是情绪决策？"]
];

function reflectionBox() {
  const q = (DEEPQ[g.round] && DEEPQ[g.round][sel]) || "请写下你的思考";
  return '<div class="reflection"><b>💭 本幕深层问题｜' + T_NAMES[sel] + ' 专属</b><div>' + q + '</div>'
    + '<textarea id="reflectionInput">' + (g.families[sel].ref && g.families[sel].ref[g.round] || "") + '</textarea></div>';
}

/* ===================== 幕面板 ===================== */
const R_DATA = [
  ["第一幕｜500万家庭资产配置","你不是在选收益最高的资产，而是在决定未来什么风险由谁承担。","500万必须全部配置到现金、家庭储备、股票、债券、大宗商品。"],
  ["第二幕｜精准消费节","最有效的消费刺激，不是告诉你'它很好'，而是告诉你'不买你就落后'。","每个家族有不同的消费菜单，可多选。"],
  ["第三幕｜痛点账单 + 生活命运袋","危机还没来，但生活的账单已经在桌上了。","先抽生活命运袋，再面对属于你家的三张账单。"],
  ["第四幕｜家族危机副本 + 命运袋","宏观不是一张天气图。","先抽命运袋，再进入你家族专属的危机。"],
  ["第五幕｜债务与稀缺 + 命运袋","真正昂贵的往往不是利息，而是未来的选择被提前锁定。","第二次命运袋在这一幕。"],
  ["第六幕｜合作市场","当现金不足时，信用、能力和关系开始变成可以交换的资本。","本幕会先做债务体检。"],
  ["第七幕｜宝藏计划","结果不会替你证明决策是对的。","最后一次主动投资。"]
];

function roundHTML() {
  const s = g.families[sel], r = g.round, d = R_DATA[r];
  let h = '<div class="round-head"><div class="round-num">' + (r + 1) + '</div><div><h2>' + d[0] + '</h2><p>' + d[1] + '</p></div></div><div class="news">' + d[2] + '</div>';
  if (r === 0 && !s.allocated) h += firstHTML();
  else if (r === 0) h += '<div class="panel"><h3>已完成初始资产配置</h3><p class="source">现金 ' + fm(s.cash) + ' 万</p></div>' + reflectionBox();
  else if (r === 1) h += consumeHTML();
  else if (r === 2) h += painHTML();
  else if (r === 3) h += crisisHTML();
  else if (r === 4) h += debtHTML();
  else if (r === 5) h += coopHTML();
  else if (r === 6) h += treasureHTML();
  document.querySelector('#roundPanel').innerHTML = h;
}

/* ===================== 第一幕：资产配置 ===================== */
function firstHTML() {
  return '<div class="panel"><h3>500 万元家庭资产配置</h3>'
    + '<div class="prereq"><b>初始 500 万全部是现金。</b>你填入的部分会从现金里扣掉，剩下的仍是现金。'
    + '<br><b>关键差别不在收益率，在于"出事的时候它能不能马上变成钱"。</b></div>'
    + '<div class="alloc-grid">'
    + '<div class="alloc"><b>📈 股票</b><input id="a_stock" type="number" min="0" value="0" oninput="updateAllocationPreview()">'
    + '<small>终局收益不确定：最差 -45%，最好 +40%。急用钱时只能按 50% 变现。</small></div>'
    + '<div class="alloc"><b>📜 债券</b><input id="a_bond" type="number" min="0" value="0" oninput="updateAllocationPreview()">'
    + '<small>终局固定 +4%。急用钱时按 88% 变现。</small></div>'
    + '<div class="alloc"><b>🛢️ 大宗商品</b><input id="a_commodity" type="number" min="0" value="0" oninput="updateAllocationPreview()">'
    + '<small>终局按通胀档位 +2%~+18%。急用钱时按 70% 变现。</small></div>'
    + '<div class="alloc"><b>💵 自动剩余现金</b><input id="a_cash_preview" type="number" value="500" readonly>'
    + '<small>无收益。但它是唯一一种在任何时刻都不打折的钱。</small></div></div>'
    + '<p id="allocPreview" class="news">已配置 0 万；剩余现金 500 万。</p>'
    + '<button class="btn" onclick="allocate()">确认资产配置</button></div>' + reflectionBox();
}

function updateAllocationPreview() {
  const v = k => Number((document.querySelector(k) || {}).value || 0);
  const invested = v("#a_stock") + v("#a_bond") + v("#a_commodity"), remain = INITIAL - invested;
  const cashEl = document.querySelector("#a_cash_preview"), msg = document.querySelector("#allocPreview");
  if (cashEl) cashEl.value = Math.max(0, remain);
  if (msg) msg.innerHTML = remain >= 0
    ? '已配置 ' + fm(invested) + ' 万；剩余现金 <b>' + fm(remain) + '</b> 万。'
    : '<b style="color:var(--alarm)">超出 500 万。</b>';
}

function allocate() {
  const v = k => Number((document.querySelector(k) || {}).value || 0);
  const stock = v("#a_stock"), bond = v("#a_bond"), commodity = v("#a_commodity");
  const reflection = (document.querySelector('#reflectionInput') || {}).value.trim();
  if ([stock, bond, commodity].some(x => x < 0)) return alert("配置金额不能为负数。");
  if (stock + bond + commodity > INITIAL) return alert("配置超过 500 万。");
  if (reflection.length < 8) return alert("请先完成深层问题（至少 8 个字）");
  send('ALLOCATE', { stock, bond, commodity, reflection });
}

/* ===================== 第二幕：消费 ===================== */
const COMMON = [
  ["家庭年度体检",6,"健康风险","一家人一起做一次全面检查","health"],
  ["补充医疗保障",8,"大额支出焦虑","把最坏的那种账单挡在外面","protection"],
  ["家庭共同旅行",10,"关系疲劳","一年就这么一次，孩子长得很快","relation"],
  ["换一台更好的车",20,"身份焦虑","接送孩子、见客户，车是脸面","status"],
  ["家里翻新与家电换新",16,"生活质量焦虑","住了八年了，该换了","status"],
  ["节日与人情往来加码",9,"人情焦虑","该走的礼不能省","status"],
  ["孩子的新款电子产品",11,"同辈比较焦虑","同学都有，他从来没开口要过","status"],
  ["高端健身与形体管理",12,"外形焦虑","四十岁之后，身材是自律的证明","health"],
  ["孩子自主预算",5,"控制焦虑","给他一笔钱，让他自己决定怎么花","dual"],
  ["第二收入训练营",10,"单一收入焦虑","下班后的三小时，也许能变成钱","income2"],
  ["出租闲置资产（车位/空房）",12,"资产闲置焦虑","闲着也是闲着","passive"],
  ["家庭副业启动包",14,"抗风险焦虑","万一主业出事，还有一条腿","sidebiz"]
];
const SPECIAL = [
  [["海外夏校",18,"教育焦虑","孩子会记住这个夏天","dual"],["老板圈年度席位",22,"圈层焦虑","能坐进那个房间，本身就是资格","credit"],["AI外贸获客",15,"订单焦虑","不升级就等着被替代","ability"],["贸易信用保险",10,"回款焦虑","平时看不见，出事那天你会庆幸","protection"],["豪华商务接待",12,"身份焦虑","该有的排面，不能没有","status"],["供应链备份",14,"贸易摩擦焦虑","把最坏的情况提前想好","abilityCredit"]],
  [["智能产线升级",25,"淘汰焦虑","不升级就等着被替代","ability"],["工业AI训练营",10,"技能焦虑","不升级就等着被替代","ability"],["商务车升级",28,"身份焦虑","该有的排面，不能没有","status"],["孩子竞赛冲刺",12,"教育焦虑","不升级就等着被替代","ability"],["核心员工留任奖金",10,"人才焦虑","能坐进那个房间，本身就是资格","credit"],["设备保险",9,"设备风险","平时看不见，出事那天你会庆幸","protection"]],
  [["网红探店套餐",10,"流量焦虑","一条新的进钱的路","marketing"],["中央厨房设备",18,"成本焦虑","不升级就等着被替代","ability"],["新店装修",25,"扩张焦虑","店要开得像样，客人才愿意来","status"],["孩子兴趣班组合",9,"教育焦虑","孩子会记住这个夏天","dual"],["食品安全保险",9,"口碑风险","平时看不见，出事那天你会庆幸","protection"],["会员储值系统",8,"现金流焦虑","能坐进那个房间，本身就是资格","credit"]],
  [["名校竞赛冲刺",12,"教育焦虑","不升级就等着被替代","ability"],["学区房豪装",22,"身份焦虑","该有的排面，不能没有","status"],["成人技能升级",9,"职业替代焦虑","不升级就等着被替代","ability"],["父母养老预备方案",12,"照护焦虑","有些事再不做就来不及了","relation"],["失业收入保障",10,"职业风险","平时看不见，出事那天你会庆幸","protection"],["孩子创作设备",8,"教育控制焦虑","孩子会记住这个夏天","dual"]],
  [["网红民宿改造",20,"流量焦虑","一条新的进钱的路","marketing"],["节能改造",15,"能源焦虑","不升级就等着被替代","ability"],["奢华亲子旅行",14,"补偿心理","有些事再不做就来不及了","relation"],["天气灾害保险",10,"天气焦虑","平时看不见，出事那天你会庆幸","protection"],["平台流量投放",12,"订单焦虑","一条新的进钱的路","marketing"],["第二收入课程",10,"季节性收入焦虑","不升级就等着被替代","ability"]],
  [["私人银行会籍",18,"身份焦虑","该有的排面，不能没有","status"],["投资决策课",8,"认知焦虑","不升级就等着被替代","ability"],["孩子创业种子金",12,"控制焦虑","孩子会记住这个夏天","dual"],["高端保险",10,"安全焦虑","平时看不见，出事那天你会庆幸","protection"],["海外游学",14,"教育焦虑","不升级就等着被替代","ability"],["朋友保本高息份额",20,"错失收益焦虑","熟人介绍的，年化比银行高得多","trap"]],
  [["创始人社群",22,"融资焦虑","能坐进那个房间，本身就是资格","credit"],["AI增长引擎",18,"增长焦虑","不升级就等着被替代","ability"],["品牌升级",20,"身份焦虑","该有的排面，不能没有","status"],["高管猎聘",18,"组织焦虑","把最坏的情况提前想好","abilityCredit"],["关键人保险",10,"经营风险","平时看不见，出事那天你会庆幸","protection"],["孩子创业营",10,"教育焦虑","不升级就等着被替代","ability"]]
];
const SPEND_CLASS = {status:"消费",relation:"消费",health:"保障",marketing:"未来期权",trap:"消费",protection:"保障",ability:"未来期权",abilityCredit:"未来期权",credit:"未来期权",dual:"未来期权",income2:"未来期权",passive:"未来期权",sidebiz:"未来期权"};

function consumeHTML() {
  const s = g.families[sel], items = SPECIAL[sel].concat(COMMON);
  if (s.custody) return '<div class="panel"><h3>消费菜单</h3><div class="debt-box">你处于托管状态，本幕不能消费。</div></div>' + reflectionBox();
  if (s.consumeDone) {
    const b = s.consumeBill || { detail: [], total: 0 };
    return '<div class="panel"><span class="badge">已提交</span><h3>第二幕已完成</h3>'
      + '<div class="prereq"><b>本幕支出 <b>' + fm(b.total) + '</b> 万。</b>现金 <b>' + fm(s.cash) + '</b> 万。</div></div>' + reflectionBox();
  }
  return '<div class="panel"><span class="badge warn">家族痛点定向消费｜可多选</span><h3>消费菜单</h3>'
    + '<div class="prereq">现金 ' + fm(s.cash) + ' 万。你现在花掉的每一万，都会从第三幕危机的可用现金里消失。</div>'
    + items.map((x, i) => {
      const cls = SPEND_CLASS[x[4]] || "消费";
      const chip = cls === "保障" ? "relief" : cls === "未来期权" ? "future" : "cost";
      return '<label class="option"><input type="checkbox" name="consume" value="' + i + '"><div>'
        + '<b>' + x[0] + ' · ' + x[1] + '万</b> <span class="crisis-chip ' + chip + '">' + cls + '</span>'
        + '<small>它击中的是：' + x[2] + '</small>'
        + '<small style="color:var(--ink)">「' + x[3] + '」</small></div></label>';
    }).join("")
    + '<label class="option"><input type="checkbox" id="buyNothing"><div><b>什么都不买</b><small>保留现金与选择权。</small></div></label>'
    + '<p>哪一个选项最让你产生"不买就会落后"的感觉？</p><input id="anxiety" type="text">'
    + '<button class="btn" onclick="submitConsume()">提交第二幕</button></div>' + reflectionBox();
}

function submitConsume() {
  const s = g.families[sel];
  if (s.consumeDone) return alert("已经提交过了");
  const picked = Array.prototype.slice.call(document.querySelectorAll('input[name="consume"]:checked')).map(e => +e.value);
  const buyNothing = (document.querySelector("#buyNothing") || {}).checked;
  if (!picked.length && !buyNothing) return alert("至少选择一项或选择\"什么都不买\"。");
  const anxiety = ((document.querySelector("#anxiety") || {}).value || "").trim();
  if (anxiety.length < 4) return alert("先写下你最强的那个消费焦虑。");
  const reflection = (document.querySelector('#reflectionInput') || {}).value.trim();
  if (reflection.length < 8) return alert("请先完成深层问题");
  send('SUBMIT_CONSUME', { items: picked, buyNothing, anxiety, reflection });
}

/* ===================== 第三幕：痛点账单 ===================== */
const PAIN = [
  {k:"eld1",cat:"老人",n:"老人住院与陪护",c:16,d:"检查、住院、护工，三件事同时压过来。",pay:"健康+1，医疗保障+1",skip:"健康-2，关系-1",ph:1,pr:0,sh:-2,sr:-1},
  {k:"eld2",cat:"老人",n:"请人分担老人照护",c:14,d:"要么请人，要么家里有人辞职。",pay:"健康+1，能力+1",skip:"健康-1，每幕收入-1",ph:1,pr:0,sh:-1,sr:0,sinc:-1},
  {k:"kid1",cat:"孩子",n:"孩子的课外辅导续费",c:12,d:"停了就跟不上，续了就是每月固定支出。",pay:"关系+1，教育投入+1",skip:"关系-1，能力-1",ph:0,pr:1,sh:0,sr:-1,sa:-1},
  {k:"kid2",cat:"孩子",n:"孩子在学校出了状况",c:13,d:"老师约谈了两次，你都没去成。",pay:"关系+1，能力+1",skip:"关系-2，能力-1",ph:0,pr:1,sh:0,sr:-2,sa:-1},
  {k:"kid3",cat:"孩子",n:"孩子想学的那件'没用的事'",c:9,d:"它不会变成分数，也不会变成收入。",pay:"关系+1，能力+1",skip:"关系-1",ph:0,pr:1,sh:0,sr:-1},
  {k:"rel1",cat:"亲戚",n:"亲戚开口借钱",c:15,d:"借了家里紧，不借这门亲戚就到头了。",pay:"关系+1，信用+1",skip:"关系-2",ph:0,pr:1,sh:0,sr:-2},
  {k:"rel2",cat:"亲戚",n:"老家的人情往来",c:10,d:"红白事、修祠堂、随份子。",pay:"关系+1",skip:"关系-1，信用-1",ph:0,pr:1,sh:0,sr:-1},
  {k:"self1",cat:"自己",n:"自己的身体检查与治疗",c:11,d:"最能挣钱的那个人，最舍不得花这笔钱。",pay:"健康+1",skip:"健康-2，每幕收入-1",ph:1,pr:0,sh:-2,sr:0,sinc:-1},
  {k:"self2",cat:"自己",n:"自己的技能提升",c:12,d:"报名费不贵，贵的是那段没法赚钱的时间。",pay:"能力+1，未来期权",skip:"能力-1",ph:0,pr:0,sh:0,sr:0,sa:-1},
  {k:"self3",cat:"自己",n:"一次短暂的休假旅行",c:8,d:"什么都不解决，但有人已经绷了很久。",pay:"关系+1，健康+1",skip:"健康-1，关系-1",ph:1,pr:1,sh:-1,sr:-1},
  {k:"mar1",cat:"夫妻",n:"婚姻里那件一直没谈的事",c:10,d:"谈要花时间和钱，不谈它自己不会消失。",pay:"关系+2",skip:"关系-2，健康-1",ph:0,pr:2,sh:-1,sr:-2},
  {k:"mar2",cat:"夫妻",n:"两地分居的通勤与租房",c:13,d:"为了收入分在两个城市，孩子跟着老人。",pay:"关系+1，健康+1",skip:"关系-2",ph:1,pr:1,sh:0,sr:-2}
];

function painHTML() {
  const s = g.families[sel];
  if (!s.fateLife) return '<div class="panel"><h3>先抽生活命运袋</h3><div class="prereq">这一袋里没有一张好牌。它全是关于健康和关系的事。</div></div>' + reflectionBox();
  if (s.painDone) return '<div class="panel"><h3>本幕账单已结算</h3><div class="prereq">支出 <b>' + fm(s.painSpent || 0) + '</b> 万。现金 ' + fm(s.cash) + ' 万。</div></div>' + reflectionBox();
  if (!s.painDeal) return '<div class="panel"><h3>等待发牌</h3></div>' + reflectionBox();
  const cards = s.painDeal.map(k => PAIN.filter(x => x.k === k)[0]).filter(Boolean);
  const html = cards.map((x, i) => {
    const afford = x.c <= s.cash + 0.001;
    return '<div class="crisis-option" style="cursor:default">'
      + '<div class="crisis-option-title"><span class="crisis-chip cap">' + x.cat + '</span> ' + x.n + '</div>'
      + '<div class="crisis-desc">' + x.d + '</div>'
      + '<div class="crisis-metrics" style="margin-top:8px">'
      + '<span class="crisis-chip cost">处理要花 ' + x.c + ' 万</span>'
      + '<span class="crisis-chip relief">处理：' + x.pay + '</span>'
      + '<span class="crisis-chip debt">不处理：' + x.skip + '</span></div>'
      + '<div style="margin-top:9px">'
      + '<label class="pain-choice pay' + (afford ? "" : " locked") + '"><input type="radio" name="pain_' + x.k + '" value="pay" ' + (afford ? "" : "disabled") + '>'
      + '<b>付钱处理　-' + x.c + ' 万</b>' + (afford ? "" : '　<span style="color:var(--alarm)">✕ 现金不够</span>') + '</label>'
      + '<label class="pain-choice skip"><input type="radio" name="pain_' + x.k + '" value="skip">'
      + '<b>不处理　不花钱</b><span style="color:var(--alarm)">　→ ' + x.skip + '</span></label>'
      + '</div></div>';
  }).join("");
  return '<div class="crisis"><h3 style="margin:0 0 10px">第三幕｜痛点账单</h3>'
    + '<div class="prereq">现金 <b>' + fm(s.cash) + '</b> 万。每一张都必须表态。</div>'
    + '<div class="crisis-options-grid">' + html + '</div>'
    + '<div class="crisis-section-title"><h4>最难的是哪一张？</h4></div>'
    + '<textarea id="painNote" placeholder="写下最难的选择…"></textarea>'
    + '<div class="crisis-actions sticky-actions"><button class="btn" onclick="submitPain()">确认账单并提交</button></div>'
    + '</div>' + reflectionBox();
}

function submitPain() {
  const s = g.families[sel];
  if (!s.painDeal) return alert("等待发牌");
  const cards = s.painDeal.map(k => PAIN.filter(x => x.k === k)[0]).filter(Boolean);
  const choices = [];
  for (const x of cards) {
    const e = document.querySelector('input[name="pain_' + x.k + '"]:checked');
    if (!e) return alert("还有账单没有表态：「" + x.n + "」");
    choices.push({ cardKey: x.k, mode: e.value });
  }
  const note = ((document.querySelector("#painNote") || {}).value || "").trim();
  if (note.length < 6) return alert("请先写清楚最难的是哪一张（至少 6 个字）。");
  const reflection = (document.querySelector('#reflectionInput') || {}).value.trim();
  if (reflection.length < 8) return alert("请先完成深层问题");
  send('SUBMIT_PAIN', { choices, note, reflection });
}

/* ===================== 第四幕：危机 ===================== */
const CRISIS = [
  {name:"外贸订单被冻结",shock:135,context:"最大客户要求降价并延期货款，新的贸易壁垒同时压过来。",flav:["守着订单不放，全家轮流盯生产和客户。","投钱做AI获客并开东盟新市场。","向银行申请过桥贷款垫付货款。","主动砍掉利润最薄的那条产品线。","卖掉投资账户里的资产，先把货款垫上。","让家人无休加班、孩子暂停课外班，全部顶上去。"]},
  {name:"制造业价格战与设备淘汰",shock:165,context:"客户要求降价12%，同行上了AI质检和自动化。",flav:["按原模式硬扛，赌客户最终会回来。","上AI质检与自动化产线。","借款先把这一轮订单交掉。","停掉一条产线，收缩到核心客户。","变卖投资资产换设备款。","夫妻俩住进厂里，孩子交给老人。"]},
  {name:"餐饮成本上升与客流谨慎",shock:100,context:"客流变谨慎，食材、人工、能源和平台抽成同时上涨。",flav:["硬撑两家店，等客流回来。","投中央厨房重构菜单和成本结构。","借款撑住两家店的房租和工资。","关掉更弱的那家店。","卖掉投资资产补现金流。","全家取消休息日，孩子放学就来店里。"]},
  {name:"岗位自动化与长辈照护",shock:90,context:"父亲所在部门用AI压缩岗位，奖金归零；同时外公需要长期照护。",flav:["谁都不动，硬扛过这一段。","投钱做技能再训练与转岗。","借款维持原有的全部计划。","一人转兼职，主动降低家庭开支结构。","卖掉投资资产覆盖照护费。","取消孩子全部课外投入，父母连轴转。"]},
  {name:"极端天气与平台退订潮",shock:130,context:"旺季集中退订，房屋受损需要维修。",flav:["赌天气恢复，什么都不改。","投钱做节能改造并转型长租。","借款继续投放和装修。","退掉一套房源，收缩经营规模。","变卖投资资产做维修。","夫妻俩自己上阵维修保洁，全年无休。"]},
  {name:"'保本高息'兑付危机",shock:115,context:"熟人推荐的'保本年化12%'项目延期兑付。",flav:["继续等，相信朋友最终会兑付。","请专业机构介入并重建投资决策流程。","借款先维持家庭正常运转。","认赔退出，接受本金损失并收缩。","卖掉其他投资填上这个窟窿。","全家降级生活，父母瞒着孩子扛下来。"]},
  {name:"融资推迟与个人担保穿透",shock:195,context:"新一轮融资推迟，供应商催款和个人担保同时到期。",flav:["创始人个人兜底，扛下全部缺口。","投钱裁员重组并聚焦核心产品。","做桥接贷款撑到下一轮。","出售非核心业务线换现金。","变卖家庭投资资产填公司窟窿。","全家搬离原住处，孩子转学，母亲全职进公司。"]}
];
const OPTSPEC = [
  {key:"endure",name:"硬扛到底",costR:0,debtR:0,rMin:0,rMax:.10,h:-1,a:0,c:0,rel:-1,extra:0,desc:"不花钱、不借钱、不改结构。"},
  {key:"invest",name:"投钱升级",costR:.16,debtR:0,rMin:.55,rMax:.80,h:0,a:1,c:0,rel:0,extra:1,desc:"现在掏一大笔现金做结构性升级。"},
  {key:"bridge",name:"银行过桥",costR:0,debtR:.45,rMin:.45,rMax:.65,h:0,a:0,c:-1,rel:0,extra:0,desc:"用新增债务换今天的喘息。"},
  {key:"shrink",name:"缩减规模",costR:.07,debtR:0,rMin:.35,rMax:.55,h:0,a:0,c:0,rel:1,extra:-2,desc:"主动砍掉一块业务止血。"},
  {key:"liquid",name:"变卖资产自救",costR:0,debtR:0,rMin:.50,rMax:.70,h:0,a:0,c:0,rel:0,extra:0,sell:.5,desc:"卖掉投资资产换现金。"},
  {key:"borrowfam",name:"透支家人",costR:0,debtR:0,rMin:.40,rMax:.60,h:-2,a:0,c:0,rel:-2,extra:0,desc:"用身体和关系顶上去。"}
];

function crisisOpts(fi) {
  const c = CRISIS[fi];
  return OPTSPEC.map((o, i) => ({
    key: o.key, name: o.name, desc: o.desc, flav: c.flav[i],
    cost: Math.round(c.shock * o.costR), newDebt: Math.round(c.shock * o.debtR),
    sellNeed: o.sell ? Math.round(c.shock * o.sell) : 0,
    rMin: o.rMin, rMax: o.rMax, h: o.h, a: o.a, c: o.c, rel: o.rel, extra: o.extra
  }));
}

function crisisHTML() {
  const s = g.families[sel], c = CRISIS[sel], opts = crisisOpts(sel);
  if (!s.fate3) return '<div class="panel"><h3>先抽命运袋</h3><div class="prereq">第三幕的命运袋在右侧。</div></div>' + reflectionBox();
  if (s.crisisDone) return '<div class="panel"><h3>危机已处理</h3><div class="prereq">方案：' + s.crisisChoice + '。现金 ' + fm(s.cash) + ' 万。</div></div>' + reflectionBox();
  return '<div class="crisis">'
    + '<div class="crisis-top"><div class="crisis-story"><span class="badge warn">第四幕 · 家族专属危机</span><h3>' + c.name + '</h3><p>' + c.context + '</p></div>'
    + '<div class="crisis-bill"><div><small>基础冲击</small><div class="big">-' + c.shock + '万</div></div>'
    + '<div class="liquid">现金：<b>' + fm(s.cash) + '万</b><br>储备：<b>' + fm(s.reserve) + '万</b></div></div></div>'
    + '<div class="crisis-section-title"><h4>六个方案，六种代价</h4></div>'
    + '<div class="crisis-options-grid">' + opts.map((x, i) => {
      const poor = x.cost > s.cash + 0.001;
      return '<label class="crisis-option ' + (poor ? "locked" : "") + '">'
        + '<input type="radio" name="crisisOpt" value="' + i + '" ' + (poor ? "disabled" : "") + '>'
        + '<div class="crisis-option-title">' + x.name + '</div>'
        + '<div class="crisis-metrics">'
        + (x.cost ? '<span class="crisis-chip cost">现金 -' + x.cost + '万</span>' : '<span class="crisis-chip cost">不花现金</span>')
        + '<span class="crisis-chip relief">减损 ' + Math.round(x.rMin * 100) + '~' + Math.round(x.rMax * 100) + '%</span>'
        + (x.newDebt ? '<span class="crisis-chip debt">新增债务 ' + x.newDebt + '万</span>' : '')
        + '</div><div class="crisis-desc">' + x.flav + '　' + x.desc + '</div>'
        + (poor ? '<div class="crisis-lock-note">✕ 付不起：需要 ' + x.cost + ' 万，你只有 ' + fm(s.cash) + ' 万。</div>' : '')
        + '</label>';
    }).join("") + '</div>'
    + '<div class="crisis-section-title"><h4>这个选择，你放弃了什么？</h4></div>'
    + '<textarea id="crisisGiveUp" placeholder="例如：我放弃了原本给孩子留的教育预算。">' + (s.crisisGiveUp || "") + '</textarea>'
    + loanBox()
    + '<div class="crisis-actions sticky-actions"><button class="btn red" onclick="submitCrisis()">确认并提交</button></div>'
    + '</div>' + reflectionBox();
}

function submitCrisis() {
  const s = g.families[sel];
  const e = document.querySelector('input[name="crisisOpt"]:checked');
  if (!e) return alert("请先选择一种应对方案。");
  const giveUp = ((document.querySelector("#crisisGiveUp") || {}).value || "").trim();
  if (giveUp.length < 6) return alert("请先写下你放弃了什么（至少 6 个字）。");
  const reflection = (document.querySelector('#reflectionInput') || {}).value.trim();
  if (reflection.length < 8) return alert("请先完成深层问题");
  send('SUBMIT_CRISIS', { optionIndex: +e.value, giveUp, reflection });
}

/* ===================== 第五幕：债务 ===================== */
function debtHTML() {
  const s = g.families[sel];
  if (!s.fate4) return '<div class="panel"><h3>先抽命运袋</h3></div>' + reflectionBox();
  return '<div class="crisis"><h3 style="margin:0 0 10px">第五幕｜债务处理</h3>'
    + '<div class="prereq">现金 <b>' + fm(s.cash) + '</b> 万。总负债 <b>' + fm(totalDebt(s)) + '</b> 万。</div>'
    + loanBox()
    + '<div class="prereq"><b>不还钱不会立刻出事</b>——这正是债务最危险的地方。</div>'
    + '<div class="crisis-actions sticky-actions"><button class="btn" onclick="submitDebt()">提交第五幕</button></div>'
    + '</div>' + reflectionBox();
}

function loanBox() {
  const s = g.families[sel];
  const rate = Math.round(debtRate(s) * 100);
  return '<div class="reserve-box"><b>🏦 借钱</b>'
    + '<div class="two"><div>'
    + '<p><b>向银行借</b>　当前利率 ' + rate + '%/幕</p>'
    + '<input id="lbBankAmt" type="number" min="0" value="0" placeholder="借入本金（万）">'
    + '<select id="lbBankPurpose" style="margin-top:6px"><option value="gap">填补当期缺口</option><option value="prod">创造新的收入或选择权</option></select>'
    + '<button type="button" class="btn small red" style="margin-top:6px" onclick="lbBorrowBank()">向银行借入</button></div>'
    + '<div><p><b>✅ 还钱</b></p>'
    + '<input id="lbBankPay" type="number" min="0" value="0" placeholder="偿还银行（万）">'
    + '<button type="button" class="btn small" style="margin-top:6px" onclick="lbRepayBank()">偿还银行</button>'
    + '<input id="lbPeerPay" type="number" min="0" value="0" style="margin-top:6px" placeholder="偿还同伴（万）">'
    + '<button type="button" class="btn small" style="margin-top:6px" onclick="lbRepayPeer()">偿还同伴</button></div></div></div>'
    + '<div class="reserve-box"><b>💱 主动变现</b><p class="source">可变现资产 ' + fm(investable(s)) + ' 万。</p>'
    + (investable(s) > 0.01 ? '<div class="two"><div><p>卖股票（万）</p><input id="sellStock" type="number" min="0" value="0"></div><div><p>卖债券（万）</p><input id="sellBond" type="number" min="0" value="0"></div></div><div class="two"><div><p>卖商品（万）</p><input id="sellCommodity" type="number" min="0" value="0"></div><div style="display:flex;align-items:flex-end"><button type="button" class="btn small alt" onclick="doLiquidate()">确认变现</button></div></div>' : '<span class="source">没有可变卖资产。</span>')
    + '</div>'
    + '<div class="reserve-box"><b>📈 主动投资</b><div class="two"><div><p>买入股票（万）</p><input id="buyStock" type="number" min="0" value="0"></div><div><p>买入债券（万）</p><input id="buyBond" type="number" min="0" value="0"></div></div><div class="two"><div><p>买入商品（万）</p><input id="buyCommodity" type="number" min="0" value="0"></div><div style="display:flex;align-items:flex-end"><button type="button" class="btn small" onclick="investMore()">确认买入</button></div></div></div>'
    + '<div class="reserve-box"><b>🛡️ 储备转账</b><div class="two"><div><p>现金→储备（万）</p><input id="toReserve" type="number" min="0" value="0"><button type="button" class="btn small" style="margin-top:6px" onclick="transferReserve(\'to\')">转入</button></div><div><p>储备→现金（万）</p><input id="fromReserve" type="number" min="0" value="0"><button type="button" class="btn small alt" style="margin-top:6px" onclick="transferReserve(\'from\')">提取</button></div></div></div>';
}

function lbBorrowBank() {
  const a = Number((document.querySelector("#lbBankAmt") || {}).value || 0);
  if (a <= 0) return alert("请输入金额。");
  const pur = ((document.querySelector("#lbBankPurpose") || {}).value);
  send('BORROW_BANK', { amount: a, purpose: pur });
}
function lbRepayBank() {
  const a = Number((document.querySelector("#lbBankPay") || {}).value || 0);
  if (a <= 0) return alert("请输入金额。");
  send('REPAY', { kind: 'bank', amount: a });
}
function lbRepayPeer() {
  const a = Number((document.querySelector("#lbPeerPay") || {}).value || 0);
  if (a <= 0) return alert("请输入金额。");
  send('REPAY', { kind: 'peer', amount: a });
}
function doLiquidate() {
  const st = Number((document.querySelector("#sellStock") || {}).value || 0);
  const bd = Number((document.querySelector("#sellBond") || {}).value || 0);
  const cm = Number((document.querySelector("#sellCommodity") || {}).value || 0);
  if (st > 0) send('LIQUIDATE', { kind: 'stock', amount: st });
  if (bd > 0) send('LIQUIDATE', { kind: 'bond', amount: bd });
  if (cm > 0) send('LIQUIDATE', { kind: 'commodity', amount: cm });
  if (st + bd + cm === 0) alert("请输入金额。");
}
function investMore() {
  const st = Number((document.querySelector("#buyStock") || {}).value || 0);
  const bd = Number((document.querySelector("#buyBond") || {}).value || 0);
  const cm = Number((document.querySelector("#buyCommodity") || {}).value || 0);
  if (st + bd + cm === 0) return alert("请输入金额。");
  send('INVEST_MORE', { stock: st, bond: bd, commodity: cm });
}
function transferReserve(dir) {
  const id = dir === 'to' ? '#toReserve' : '#fromReserve';
  const a = Number((document.querySelector(id) || {}).value || 0);
  if (a <= 0) return alert("请输入金额。");
  send('TRANSFER_RESERVE', { direction: dir, amount: a });
}

function submitDebt() {
  const reflection = (document.querySelector('#reflectionInput') || {}).value.trim();
  if (reflection.length < 8) return alert("请先完成深层问题");
  send('SUBMIT_DEBT', { repayBankAmt: 0, repayPeerAmt: 0, reflection });
}

/* ===================== 第六幕：合作 ===================== */
const COOP = [
  {name:"潮镇AI提效联合体",reqTxt:"能力 ≥ 4",min:20,cap:4,brief:"给本地中小工厂做AI质检与排产。",risk:"最大风险：客户愿意试用，但不愿意付钱。"},
  {name:"跨境高科技配套联盟",reqTxt:"信用 ≥ 4",min:25,cap:4,brief:"抱团承接高技术制造出口订单。",risk:"最大风险：一纸新规就可能让整批订单作废。"},
  {name:"社区教育与托育服务",reqTxt:"关系 ≥ 4",min:15,cap:3,brief:"面向双职工家庭的课后托管。",risk:"最大风险：合规与场地成本吃掉全部利润。"},
  {name:"餐饮民宿联营计划",reqTxt:"关系 ≥ 3",min:20,cap:4,brief:"把餐馆客流和民宿房源打通做套餐。",risk:"最大风险：两边同时遇冷就没有互补。"},
  {name:"老城区地产翻新",reqTxt:"信用 ≥ 3 且 能力 ≥ 3",min:30,cap:3,brief:"低价拿下老楼翻新出租。",risk:"最大风险：房地产开发投资同比下降18.0%。"}
];

function coopHTML() {
  const s = g.families[sel];
  if (s.custody) return '<div class="panel"><h3>合作市场</h3><div class="debt-box">托管状态下不能参与合作。</div></div>' + reflectionBox();
  if (s.coopPick || s.coopOptOut) {
    return '<div class="panel"><h3>合作市场</h3>'
      + (s.coopPick ? '<div class="news"><b>已组队：</b>' + s.coopPick + '，出资 ' + fm(s.coopStake) + ' 万。</div>' : '<div class="news"><b>已选择不参与。</b></div>')
      + '<button class="btn" onclick="submitCoopDone()">提交第六幕</button></div>' + reflectionBox();
  }
  const cards = COOP.map((p, i) => {
    return '<label class="crisis-option"><input type="radio" name="coopOpt" value="' + i + '">'
      + '<div class="crisis-option-title">' + p.name + '　<span class="crisis-chip cap">' + p.reqTxt + '</span></div>'
      + '<div class="crisis-desc">' + p.brief + '　<b>' + p.risk + '</b></div></label>';
  }).join("");
  const mates = g.families.map((x, i) => {
    if (i === sel) return "";
    const bad = x.custody || x.coopPick || x.coopOptOut;
    return '<label class="option ' + (bad ? "locked" : "") + '"><input type="checkbox" name="coopMate" value="' + i + '" ' + (bad ? "disabled" : "") + '>'
      + '<div><b>' + T_ICONS[i] + ' ' + x.name + '</b><small>' + (bad ? '不能加入' : '可以邀请') + '</small></div></label>';
  }).join("");
  return '<div class="crisis"><h3 style="margin:0 0 10px">第六幕｜合作市场</h3>'
    + '<div class="prereq">选一个项目，再选 1-2 个合作家庭。你也可以选择不参与。</div>'
    + '<div class="crisis-section-title"><h4>选一个项目</h4></div>'
    + '<div class="crisis-options-grid">' + cards + '</div>'
    + '<div class="crisis-section-title"><h4>选 1-2 个合作家庭</h4></div>'
    + mates
    + '<p>我方出资（万）</p><input id="coopStake" type="number" min="0" value="20">'
    + '<p>家族优势</p><input id="coopAdv" type="text">'
    + '<p>孩子竞选词</p><textarea id="coopPitch"></textarea>'
    + '<div class="crisis-actions sticky-actions">'
    + '<button class="btn" onclick="submitCoop()">组队并提交</button>'
    + '<button class="btn alt" onclick="submitCoopOut()">不参与</button></div>'
    + '</div>' + reflectionBox();
}

function submitCoop() {
  const e = document.querySelector('input[name="coopOpt"]:checked');
  if (!e) return alert("请选择一个项目。");
  const mates = Array.prototype.slice.call(document.querySelectorAll('input[name="coopMate"]:checked')).map(x => Number(x.value));
  if (mates.length < 1 || mates.length > 2) return alert("请选择 1-2 个合作家庭。");
  const stake = Number((document.querySelector("#coopStake") || {}).value || 0);
  const adv = ((document.querySelector("#coopAdv") || {}).value || "").trim();
  const pitch = ((document.querySelector("#coopPitch") || {}).value || "").trim();
  if (adv.length < 4 || pitch.length < 10) return alert("请完成家族优势和孩子竞选词。");
  const reflection = (document.querySelector('#reflectionInput') || {}).value.trim();
  if (reflection.length < 8) return alert("请先完成深层问题");
  send('SUBMIT_COOP', { mode: 'join', projectIndex: +e.value, mateIndices: mates, stake, adv, pitch, reflection });
}
function submitCoopOut() {
  const reflection = (document.querySelector('#reflectionInput') || {}).value.trim();
  if (reflection.length < 8) return alert("请先完成深层问题");
  send('SUBMIT_COOP', { mode: 'out', reflection });
}
function submitCoopDone() {
  const reflection = (document.querySelector('#reflectionInput') || {}).value.trim();
  if (reflection.length < 8) return alert("请先完成深层问题");
  send('SUBMIT_COOP', { mode: 'done', reflection });
}

/* ===================== 第七幕：宝藏 ===================== */
function treasureHTML() {
  const s = g.families[sel];
  if (s.gameEnded) return '<div class="panel"><h3>已结束</h3><div class="prereq">这一局已经完成。查看终局复盘。</div></div>' + reflectionBox();
  if (s.custody) return '<div class="panel"><h3>潮镇宝藏计划</h3><div class="debt-box">托管状态下不能新增投资。</div>'
    + '<button class="btn red" onclick="submitTreasureCustody()">结束这一局</button></div>' + reflectionBox();
  return '<div class="crisis"><h3 style="margin:0 0 10px">第七幕｜潮镇宝藏计划</h3>'
    + '<div class="crisis-bill" style="margin-top:12px"><div><small>成功概率</small><div class="big">50%</div></div>'
    + '<div class="liquid">成功：<b>投入 ×3</b><br>失败：<b>投入归零</b><br>现金：<b>' + fm(s.cash) + '万</b></div></div>'
    + '<div class="prereq">50% 翻三倍，50% 全部损失。</div>'
    + '<p>投入金额（万）</p><input id="treasureAmt" type="number" min="0" value="0">'
    + '<p>资金来源</p><select id="treasureSource"><option value="cash">现金</option><option value="debt">向银行借款参与</option></select>'
    + '<p>如果亏光，接下来三个月怎么过？</p><textarea id="worst"></textarea>'
    + '<div class="crisis-actions sticky-actions">'
    + '<button class="btn red" onclick="submitTreasure()">确认投入并开奖</button>'
    + '<button class="btn alt" onclick="submitTreasureSkip()">不参与，直接结算</button></div>'
    + '</div>' + reflectionBox();
}

function submitTreasure() {
  const a = Number((document.querySelector("#treasureAmt") || {}).value || 0);
  const src = (document.querySelector("#treasureSource") || {}).value;
  const w = ((document.querySelector("#worst") || {}).value || "").trim();
  if (a <= 0) return alert("投入金额必须大于 0。");
  if (w.length < 10) return alert("请先写清楚最坏情境（至少 10 个字）。");
  const reflection = (document.querySelector('#reflectionInput') || {}).value.trim();
  if (reflection.length < 8) return alert("请先完成深层问题");
  send('SUBMIT_TREASURE', { amount: a, source: src, worst: w, reflection });
}
function submitTreasureSkip() {
  const reflection = (document.querySelector('#reflectionInput') || {}).value.trim();
  if (reflection.length < 8) return alert("请先完成深层问题");
  send('SUBMIT_TREASURE', { skip: 'skip', reflection });
}
function submitTreasureCustody() {
  const reflection = (document.querySelector('#reflectionInput') || {}).value.trim();
  if (reflection.length < 8) return alert("请先完成深层问题");
  send('SUBMIT_TREASURE', { skip: 'custody', reflection });
}

/* ===================== 讲师看板 ===================== */
function sendNextRound() { send('NEXT_ROUND', {}); }
function sendPrevRound() { send('PREV_ROUND', {}); }
function sendReset() {
  if (confirm("确认重置游戏？所有数据将清空。")) send('RESET_GAME', {});
}

function renderHostSummary() {
  const box = document.querySelector('#hostSummary');
  if (!box) return;

  const started = g.families.filter(s => s.allocated);
  const n = started.length;
  const acts = R_DATA.map(r => r[0].split("｜")[0]);

  // 完成本幕人数
  const done = (s, a) => {
    if (a === 0) return !!s.allocated;
    if (a === 1) return !!s.consumeDone;
    if (a === 2) return !!s.painDone;
    if (a === 3) return !!s.crisisDone;
    if (a === 4) return (s.trail || []).some(t => t.act === 4);
    if (a === 5) return !!(s.coopPick || s.coopOptOut);
    if (a === 6) return !!s.gameEnded;
    return false;
  };

  const roundDoneCount = started.filter(s => done(s, g.round)).length;
  const waitingCount = n - roundDoneCount;

  // 统计指标（只在已开始的家族上统计）
  let avgNet = 0, avgDebtRate = 0, avgCov = 0, avgOpt = 0;
  let riskCount = 0, custodyCount = 0, endedCount = 0;
  let maxNet = -Infinity, minNet = Infinity, maxNetName = '', minNetName = '';
  let totalCash = 0, totalStock = 0, totalBond = 0, totalCommodity = 0, totalDebtAll = 0;

  started.forEach((s, i) => {
    const nw = netWorth(s);
    const dr = debtRatio(s);
    const cov = coverage(s, g.round);
    const oi = optionIndex(s, g.round);
    avgNet += nw; avgDebtRate += dr; avgCov += cov; avgOpt += oi;
    totalCash += s.cash; totalStock += s.stock; totalBond += s.bond; totalCommodity += s.commodity;
    totalDebtAll += totalDebt(s);
    if (cov < MARGIN_TRIGGER && !s.custody) riskCount++;
    if (s.custody) custodyCount++;
    if (s.gameEnded) endedCount++;
    if (nw > maxNet) { maxNet = nw; maxNetName = s.name; }
    if (nw < minNet) { minNet = nw; minNetName = s.name; }
  });
  if (n > 0) { avgNet /= n; avgDebtRate /= n; avgCov /= n; avgOpt /= n; }
  if (!isFinite(maxNet)) { maxNet = 0; maxNetName = '—'; }
  if (!isFinite(minNet)) { minNet = 0; minNetName = '—'; }

  // KPI 卡片
  const kpi = (label, val, sub, cls) =>
    `<div class="summary-kpi ${cls || ''}"><span class="kpi-label">${label}</span><b class="kpi-val ${cls || ''}">${val}</b><small class="kpi-sub">${sub || ''}</small></div>`;

  let html = '<h3 style="margin:18px 0 8px">📊 全班实时汇总</h3>';
  html += '<div class="summary-kpi-row">';
  html += kpi('在线/总数', n + '/7', started.filter(s => !s.gameEnded).length + ' 人进行中');
  html += kpi('当前幕完成', roundDoneCount + '/' + n, waitingCount > 0 ? '⏳ ' + waitingCount + ' 人待提交' : '✅ 全部完成', waitingCount > 0 ? '' : 'ok');
  html += kpi('平均净资产', fm(avgNet) + '万', '最高 ' + maxNetName + ' ' + fm(maxNet) + '万');
  html += kpi('平均负债率', Math.round(avgDebtRate * 100) + '%', '最低 ' + minNetName + ' ' + fm(minNet) + '万');
  html += kpi('平均覆盖率', n ? fm(avgCov) + '×' : '—', n ? (avgCov < MARGIN_TRIGGER ? '⚠️ 低于安全线' : '安全线 ' + MARGIN_TRIGGER + '×') : '等待开始', n && avgCov < MARGIN_TRIGGER ? 'warn' : 'ok');
  html += kpi('平均选择权', avgOpt.toFixed(1), '开局 4.0');
  html += kpi('风险预警', riskCount + ' 人', '覆盖率 < ' + MARGIN_TRIGGER + '×', riskCount > 0 ? 'warn' : 'ok');
  html += kpi('已托管', custodyCount + ' 人', custodyCount > 0 ? '🚨 需关注' : '无', custodyCount > 0 ? 'danger' : 'ok');
  html += kpi('已结束', endedCount + '/7', endedCount === 7 ? '全部完成' : '游戏进行中');
  html += '</div>';

  // 全班资产分布
  html += '<div class="summary-assets" style="margin-top:14px">';
  html += '<div class="summary-asset-item"><span>💵 全班现金</span><b>' + fm(totalCash) + '万</b></div>';
  html += '<div class="summary-asset-item"><span>📈 全班股票</span><b>' + fm(totalStock) + '万</b></div>';
  html += '<div class="summary-asset-item"><span>🏛️ 全班债券</span><b>' + fm(totalBond) + '万</b></div>';
  html += '<div class="summary-asset-item"><span>🛢️ 全班商品</span><b>' + fm(totalCommodity) + '万</b></div>';
  html += '<div class="summary-asset-item"><span>💳 全班总负债</span><b>' + fm(totalDebtAll) + '万</b></div>';
  html += '</div>';

  // 各家族净资产排名条形图
  if (n > 0) {
    const sorted = started.map((s, i) => ({ name: s.name, icon: T_ICONS[g.families.indexOf(s)], nw: netWorth(s), custody: s.custody, ended: s.gameEnded }))
      .sort((a, b) => b.nw - a.nw);
    const maxBar = Math.max(...sorted.map(s => Math.abs(s.nw)), 1);
    html += '<h4 style="margin:16px 0 6px">🏆 净资产排名</h4>';
    html += '<div class="summary-rank">';
    sorted.forEach((s, i) => {
      const pct = Math.abs(s.nw) / maxBar * 100;
      const neg = s.nw < 0;
      const badge = s.custody ? ' 🚨' : (s.ended ? ' ✅' : '');
      html += '<div class="rank-row">'
        + '<span class="rank-num">' + (i + 1) + '</span>'
        + '<span class="rank-name">' + s.icon + ' ' + s.name + badge + '</span>'
        + '<div class="rank-bar-wrap"><div class="rank-bar ' + (neg ? 'neg' : '') + '" style="width:' + pct + '%"></div></div>'
        + '<span class="rank-val ' + (neg ? 'neg' : '') + '">' + fm(s.nw) + '万</span>'
        + '</div>';
    });
    html += '</div>';
  }

  box.innerHTML = html;
}

function renderHost() {
  if (!g) return;
  renderHostSummary();
  const fb = document.querySelector('#hostFeed');
  const ev = (g.events || []).slice().sort((a, b) => b.ts - a.ts);
  const feedHtml = ev.length ? '<div class="table-wrap"><table><tr><th>时间</th><th>家庭</th><th>幕</th><th>动作</th><th>内容</th></tr>'
    + ev.slice(0, 50).map(e => '<tr><td>' + new Date(e.ts).toLocaleTimeString() + '</td>'
      + '<td>' + (T_ICONS[e.fam] || "") + ' ' + (e.name || "") + '</td>'
      + '<td>第' + (e.round + 1) + '幕</td>'
      + '<td><b>' + e.action + '</b></td>'
      + '<td style="white-space:normal">' + e.detail + '</td></tr>').join("") + '</table></div>'
    + '<p class="source">共 ' + ev.length + ' 条，显示最近 50 条。</p>'
    : '<div class="prereq">还没有任何人提交过选择。</div>';
  if (fb) fb.innerHTML = feedHtml;

  document.querySelector('#hostRound').innerHTML = '<b>' + R_DATA[g.round][0] + '</b>｜在线 ' + g.families.filter(s => s.allocated).length + '/7 家已开始';

  // 进度矩阵
  const acts = R_DATA.map(r => r[0].split("｜")[0]);
  const done = (s, a) => {
    if (a === 0) return !!s.allocated;
    if (a === 1) return !!s.consumeDone;
    if (a === 2) return !!s.painDone;
    if (a === 3) return !!s.crisisDone;
    if (a === 4) return (s.trail || []).some(t => t.act === 4);
    if (a === 5) return !!(s.coopPick || s.coopOptOut);
    if (a === 6) return !!s.gameEnded;
    return false;
  };
  let progressHtml = '<div class="table-wrap"><table><tr><th>家庭</th>' + acts.map(a => '<th>' + a + '</th>').join("") + '<th>状态</th></tr>';
  g.families.forEach((s, i) => {
    progressHtml += '<tr' + (s.custody ? ' class="custody"' : '') + '><td>' + T_ICONS[i] + ' ' + s.name + '</td>';
    for (let a = 0; a < 7; a++) {
      const ok = done(s, a), cur = (a === g.round);
      progressHtml += '<td style="text-align:center' + (cur ? ';background:#f3ead0' : '') + '">' + (ok ? '✅' : (cur ? '⏳' : '·')) + '</td>';
    }
    progressHtml += '<td>' + (s.custody ? '🚨托管' : (s.allocated ? '进行中' : '未开始')) + '</td></tr>';
  });
  const waiting = g.families.filter(s => s.allocated && !done(s, g.round)).length;
  progressHtml += '</table></div><p class="source">当前还有 <b>' + waiting + '</b> 个家庭没有提交本幕。</p>';
  document.querySelector('#hostProgress').innerHTML = progressHtml;

  // 链接
  const roomId = new URLSearchParams(location.search).get('room') || '';
  const base = location.origin;
  document.querySelector('#linkBox').innerHTML = '<div class="prereq"><b>7 个家族专属链接：</b></div>'
    + '<div class="link-list">' + g.families.map((x, i) => '<div class="link-row"><span>' + T_ICONS[i] + ' ' + x.name + '</span><input type="text" value="' + base + '/game.html?room=' + roomId + '&role=family' + i + '" readonly><button class="btn small alt" onclick="copyText(this.previousElementSibling)">复制</button></div>').join("") + '</div>';

  // 仪表盘
  let h = '<thead><tr><th>家庭</th><th>选择权</th><th>覆盖率</th><th>负债率</th><th>现金</th><th>储备</th><th>股票</th><th>债券</th><th>商品</th><th>总负债</th><th>净资产</th><th>健</th><th>能</th><th>信</th><th>关</th><th>第三幕方案</th><th>状态</th></tr></thead><tbody>';
  g.families.forEach((s, i) => {
    const cov = s.allocated ? coverage(s, g.round) : 99;
    const cls = s.custody ? "custody" : (s.allocated && cov < MARGIN_TRIGGER ? "risk" : "");
    h += '<tr class="' + cls + '"><td>' + T_ICONS[i] + ' ' + s.name + '</td>'
      + '<td><b>' + (s.allocated ? optionIndex(s, g.round) : "—") + '</b></td>'
      + '<td>' + (s.allocated ? fm(cov) + "×" : "—") + '</td>'
      + '<td>' + Math.round(debtRatio(s) * 100) + '%</td>'
      + '<td>' + fm(s.cash) + '</td><td>' + fm(s.reserve) + '</td><td>' + fm(s.stock) + '</td><td>' + fm(s.bond) + '</td><td>' + fm(s.commodity) + '</td>'
      + '<td>' + fm(totalDebt(s)) + '</td><td>' + fm(netWorth(s)) + '</td>'
      + '<td>' + s.health + '</td><td>' + s.ability + '</td><td>' + s.credit + '</td><td>' + s.relation + '</td>'
      + '<td>' + (s.crisisDone ? s.crisisChoice : "—") + '</td>'
      + '<td>' + (s.custody ? "🚨托管" : s.gameEnded ? "已结束" : s.allocated ? "进行中" : "未开始") + '</td></tr>';
  });
  document.querySelector('#dash').innerHTML = h + '</tbody>';
}

function copyText(el) {
  el.select();
  navigator.clipboard.writeText(el.value).then(() => {
    const btn = el.nextElementSibling;
    if (btn) { const orig = btn.textContent; btn.textContent = '已复制'; setTimeout(() => btn.textContent = orig, 1500); }
  });
}

/* ===================== 终局复盘 ===================== */
function renderEnding() {
  const e = document.querySelector('#endingFamily');
  if (!e.options.length) e.innerHTML = g.families.map((s, i) => '<option value="' + i + '">' + T_ICONS[i] + ' ' + s.name + '</option>').join("");
  const s = g.families[Number(e.value) || 0];
  const st = s.gameEnded && s.portrait ? s.portrait.settlement : { finalNet: netWorth(s), stockRet: 0, stockProfit: 0, bondProfit: 0, comProfit: 0, investmentProfit: 0, insolvent: false };
  document.querySelector('#endingContent').innerHTML =
    '<div class="ending"><span class="badge gold">' + (s.gameEnded ? (s.custody ? "以托管状态结束" : "正常结算") : "尚未完成第七幕") + '</span>'
    + '<h2>' + s.name + '</h2>'
    + '<p><b>最终净值：' + fm(st.finalNet) + ' 万</b>　｜　选择权指数：<b>' + (s.gameEnded && s.portrait ? s.portrait.optEnd : optionIndex(s, g.round)) + '</b></p></div>'
    + '<div class="profit"><b>终局投资收益</b><br>'
    + '股票 ' + fm(st.stockProfit) + ' 万（' + (st.stockRet >= 0 ? "+" : "") + Math.round(st.stockRet * 100) + '%）<br>'
    + '债券 ' + fm(st.bondProfit) + ' 万（+4%）<br>'
    + '大宗商品 ' + fm(st.comProfit) + ' 万<br>'
    + '<b>合计 ' + fm(st.investmentProfit) + ' 万</b></div>'
    + (s.gameEnded && s.portrait ? '<div class="role-summary"><b>画像类型：' + s.portrait.type + '</b><br>' + s.portrait.typeLine + '<br><br><button class="btn small gold" onclick="showPortrait(' + s.i + ')">打开完整家族画像</button></div>' : '<div class="role-summary">完成第七幕后生成家族画像。</div>');
  document.querySelector('#finalReflection').value = s.final || "";
  document.querySelector('#allSummaries').innerHTML = g.families.map((x, i) => '<div class="role-summary"><b>' + T_ICONS[i] + ' ' + x.name + '</b><br>终局净值约 ' + fm(x.gameEnded && x.portrait ? x.portrait.settlement.finalNet : netWorth(x)) + ' 万' + (x.gameEnded && x.portrait ? '，画像：' + x.portrait.type : '（未完成）') + '</div>').join("");
}

function saveFinal() {
  const i = Number((document.querySelector("#endingFamily") || {}).value) || 0;
  const text = (document.querySelector("#finalReflection") || {}).value || "";
  send('SAVE_FINAL', { familyIndex: i, text });
  alert("已保存");
}

function showPortrait(i) {
  const s = g.families[i];
  if (!s.gameEnded || !s.portrait) return alert("该家族还没有完成或画像未生成。");
  const p = s.portrait;
  document.querySelector('#portraitBody').innerHTML =
    '<div class="portrait-head"><div><span class="badge gold">七幕结束 · 家族画像</span>'
    + '<div class="portrait-title">' + T_ICONS[i] + ' ' + p.type + '</div>'
    + '<p class="portrait-sub">' + p.typeLine + '</p></div>'
    + '<button class="btn small alt" onclick="closePortrait()">关闭</button></div>'
    + '<div class="pkpi">'
    + '<div class="pkpi-item"><span>选择权指数（终）</span><b>' + p.optEnd + '</b><small>开局 ' + p.optStart + '</small></div>'
    + '<div class="pkpi-item"><span>终局净值</span><b>' + fm(p.settlement.finalNet) + '万</b></div>'
    + '<div class="pkpi-item"><span>被迫时刻</span><b>' + p.forcedMoments + ' 次</b></div>'
    + '<div class="pkpi-item"><span>家庭资本</span><b>' + p.familyCap + '</b></div>'
    + '<div class="pkpi-item"><span>期末负债</span><b>' + fm(totalDebt(s)) + '万</b></div>'
    + '</div>'
    + '<div class="pgrid"><div class="pbox"><b>✅ 保住了什么</b><ul><li>' + p.kept.join("</li><li>") + '</li></ul></div>'
    + '<div class="pbox"><b>⚠️ 卖掉了什么</b><ul><li>' + p.sold.join("</li><li>") + '</li></ul></div></div>'
    + '<div style="margin-top:16px;text-align:right"><button class="btn alt" onclick="closePortrait()">返回</button></div>';
  document.querySelector('#portraitModal').classList.remove('hidden');
}
function closePortrait() { document.querySelector('#portraitModal').classList.add('hidden'); }

/* ===================== 主渲染 ===================== */
function renderAll() {
  if (!g) return;
  renderMacro();
  renderSync();
  renderFamilies();
  const myFam = g.families[sel];
  if (myFam && (myFam.allocated || (!isHost && sel === myFamilyIdx))) {
    // 学员始终显示自己的游戏面板（无论是否已配置资产）
    document.querySelector('#playerGame').classList.remove('hidden');
    renderDossier();
    renderCustody();
    renderGauges();
    renderResources();
    roundHTML();
    renderFate();
    renderTriggers();
    renderDebt();
    renderHistory();
  } else if (myFam && isHost && myFam.allocated) {
    // 讲师只看已开始游戏的家族面板
    document.querySelector('#playerGame').classList.remove('hidden');
    renderDossier();
    renderCustody();
    renderGauges();
    renderResources();
    roundHTML();
    renderFate();
    renderTriggers();
    renderDebt();
    renderHistory();
  } else {
    document.querySelector('#playerGame').classList.add('hidden');
  }
  renderHost();
  if (!document.querySelector('#endingView').classList.contains('hidden')) renderEnding();
}

/* 启动 */
init();
