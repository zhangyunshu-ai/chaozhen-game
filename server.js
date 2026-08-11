/* ===================== 潮镇多人游戏服务器 ===================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const GameEngine = require('./game-engine');
const { T, HOST_PASS } = require('./constants');

const PORT = process.env.PORT || 3000;

/* ===================== 房间管理 ===================== */
const rooms = new Map(); // roomId -> { state, clients: Map<clientId, {ws, role, familyIdx}> }

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'CZ-';
  for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function createRoom() {
  let id;
  do { id = generateRoomId(); } while (rooms.has(id));
  const state = GameEngine.newGame();
  rooms.set(id, { state, clients: new Map(), createdAt: Date.now() });
  console.log(`[Room] Created room ${id}`);
  return id;
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

/* ===================== 数据隔离：按角色过滤状态 ===================== */
// 讲师(host) 看到所有家族完整数据
// 学员(familyN) 只看到自己的家族详细数据，其他家族仅保留公开信息
function filterStateForClient(fullState, client) {
  if (client.role === 'host' || client.familyIdx < 0) {
    return fullState; // 讲师看全部
  }

  const myIdx = client.familyIdx;
  const state = JSON.parse(JSON.stringify(fullState)); // 深拷贝

  // 对非自己的家族，脱敏处理
  state.families = state.families.map((f, i) => {
    if (i === myIdx) return f; // 自己的数据完整保留

    // 其他家族：只保留公开信息（名字 + 是否已开始 + 是否完成当前幕）
    return {
      i: f.i,
      name: f.name,
      allocated: f.allocated,           // 公开：是否已配置
      started: f.started,               // 公开：各幕完成状态
      gameEnded: f.gameEnded,           // 公开：是否已结束
      custody: f.custody,               // 公开：是否被托管
      coopPick: f.coopPick,             // 公开：合作项目选择（合作需要互相看到）
      coopStake: f.coopStake,           // 公开：合作出资额
      coopOptOut: f.coopOptOut,         // 公开：是否退出合作
      coopResult: f.coopResult,         // 公开：合作结果
      coopAdv: f.coopAdv,               // 公开：合作优势
      coopPitch: f.coopPitch,           // 公开：合作提案
      peerDebt: f.peerDebt,             // 公开：欠同伴的钱（同伴需要看到）
      peerReceivable: f.peerReceivable, // 公开：同伴欠自己的钱
      // 以下全部隐藏
      cash: 0, stock: 0, bond: 0, commodity: 0, reserve: 0,
      debt: 0, health: 0, ability: 0, credit: 0, relation: 0,
      protection: false, extra: 0,
      fate3: null, fate4: null, fateLife: null, usedFates: [],
      crisisDone: false, crisisChoice: null, crisisGiveUp: '',
      history: [], ref: {}, final: '', secret: false,
      tr: {}, math: {}, decisions: [],
      portrait: null, lowCovStreak: 0, custodyActs: 0,
      marginCalls: 0, scarcity: 0, trail: [],
      forcedSells: 0, carryOver: 0, pledgedSell: 0,
      eduSpend: 0, medSpend: 0, spendKeys: [], bought: [],
      prodDebt: 0, gapDebt: 0,
      treasureBet: 0, stockRet: 0, comRet: 0,
      consumeDone: false, consumeBill: [],
      painDone: false, painSpent: 0, painNote: '', painDeal: ''
    };
  });

  return state;
}

/* ===================== 静态文件服务 ===================== */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0].split('#')[0];
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  // API 端点
  if (urlPath === '/api/create-room') {
    const roomId = createRoom();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ roomId }));
    return;
  }

  if (urlPath === '/api/rooms') {
    const list = Array.from(rooms.keys()).map(id => ({
      id, createdAt: rooms.get(id).createdAt,
      playerCount: rooms.get(id).clients.size,
      round: rooms.get(id).state.round
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ rooms: list }));
    return;
  }

  const filePath = path.join(__dirname, 'public', urlPath);
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>404</h1><p>文件未找到</p>');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ===================== WebSocket 处理 ===================== */
const server = http.createServer(serveStatic);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const roomId = url.searchParams.get('room');
  const role = url.searchParams.get('role') || 'host';
  const clientId = url.searchParams.get('clientId') || ('c-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));

  // 如果没有 room 参数，创建一个新房间
  let room;
  let actualRoomId;
  if (!roomId) {
    actualRoomId = createRoom();
    room = rooms.get(actualRoomId);
  } else {
    room = rooms.get(roomId);
    if (!room) {
      // 房间不存在，自动创建
      room = { state: GameEngine.newGame(), clients: new Map(), createdAt: Date.now() };
      rooms.set(roomId, room);
    }
    actualRoomId = roomId;
  }

  const familyIdx = role === 'host' ? -1 : parseInt(role.replace('family', ''));
  const client = { ws, role, familyIdx, clientId, connectedAt: Date.now() };
  room.clients.set(clientId, client);

  console.log(`[WS] Client ${clientId} connected to room ${actualRoomId}, role=${role}, familyIdx=${familyIdx}`);

  // 发送当前完整状态（经过隔离过滤）
  sendToClient(client, {
    type: 'CONNECTED',
    roomId: actualRoomId,
    role,
    clientId,
    state: filterStateForClient(room.state, client)
  });

  // 广播玩家加入
  broadcastToRoom(room, {
    type: 'PLAYER_JOINED',
    role,
    clientId,
    playerCount: room.clients.size
  }, clientId);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleMessage(room, client, msg);
    } catch (e) {
      console.error('[WS] Message parse error:', e.message);
      sendToClient(client, { type: 'ERROR', message: '消息格式错误' });
    }
  });

  ws.on('close', () => {
    room.clients.delete(clientId);
    console.log(`[WS] Client ${clientId} disconnected`);
    broadcastToRoom(room, {
      type: 'PLAYER_LEFT',
      role,
      clientId,
      playerCount: room.clients.size
    });
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err.message);
  });
});

function handleMessage(room, client, msg) {
  const { type, payload } = msg;

  // 讲师验证
  if (['NEXT_ROUND', 'PREV_ROUND', 'RESET_GAME'].includes(type) && client.role !== 'host') {
    return sendToClient(client, { type: 'ERROR', message: '只有讲师可以执行此操作' });
  }

  // 执行游戏逻辑
  const result = GameEngine.execute(room.state, { type, payload }, client);

  if (result && result.error) {
    return sendToClient(client, { type: 'ERROR', message: result.error });
  }

  // 广播状态更新给所有人（每人收到的状态经过各自隔离过滤）
  broadcastStateUpdate(room, {
    type: 'STATE_UPDATE',
    message: result && result.message ? result.message : null,
    result: result
  });

  // 如果有特别通知
  if (result && result.message) {
    sendToClient(client, { type: 'NOTICE', message: result.message });
  }
}

/* ===================== 消息发送（带数据隔离） ===================== */
function sendToClient(client, msg) {
  if (client.ws.readyState === WebSocket.OPEN) {
    // 如果是状态更新类消息，对非讲师客户端做数据过滤
    if (msg.state && client.role !== 'host' && client.familyIdx >= 0) {
      msg = { ...msg, state: filterStateForClient(msg.state, client) };
    }
    client.ws.send(JSON.stringify(msg));
  }
}

function broadcastToRoom(room, msg, excludeClientId) {
  for (const [cid, client] of room.clients) {
    if (cid !== excludeClientId) {
      sendToClient(client, msg);
    }
  }
}

// 专门用于广播状态更新：每个客户端收到过滤后的状态
function broadcastStateUpdate(room, msg) {
  for (const [cid, client] of room.clients) {
    const filteredMsg = { ...msg, state: filterStateForClient(room.state, client) };
    sendToClient(client, filteredMsg);
  }
}

/* ===================== 启动 ===================== */
server.listen(PORT, () => {
  console.log(`[Server] 潮镇多人游戏服务器已启动`);
  console.log(`[Server] 端口: ${PORT}`);
  console.log(`[Server] 访问: http://localhost:${PORT}`);
});

// 优雅退出
process.on('SIGTERM', () => {
  console.log('[Server] 收到 SIGTERM，正在关闭...');
  server.close(() => process.exit(0));
});
