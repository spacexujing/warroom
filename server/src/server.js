// War Room 无鉴权伪线上服务
//  Express(静态托管 + 最小 HTTP API) + Socket.IO(房间/昵称/对局同步)
//
//  设计要点：
//   - 无账号、无密码、无 JWT 校验。玩家只声明昵称，随时可改。
//   - /api/auth/* 存在仅为兼容前端启动流程，永远返回“已登录”的匿名用户。
//   - 所有房间/对局数据在内存，进程重启即清空。

import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server as SocketServer } from "socket.io";

import { createUser, getUser, setUsername, removeUser, toClientUser, sanitizeName } from "./users.js";
import {
  createRoom, getRoom, deleteRoom, listRooms, addPlayer, removePlayerById,
  renamePlayer, playersPayload,
} from "./rooms.js";
import { initGameState, statePayload, enabledNations, PHASES } from "./game.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());

// ---------- 静态资源 ----------
// 前端产物：public/index.html + public/assets/index-*.js + 图片素材(平铺根路径)
const PUBLIC = path.join(__dirname, "..", "public");
app.use(express.static(PUBLIC, { extensions: ["html"] }));

// ---------- 无鉴权 HTTP API ----------
// 说明：这些端点刻意不做任何校验，仅让前端认为“已登录”。
const ANON = () => ({ id: "anon", username: "指挥官", role: "player", isAdmin: false, isSuperAdmin: false });

app.post("/api/auth/login", (req, res) => {
  const username = sanitizeName(req.body?.username) || "指挥官";
  res.json({ token: "no-auth", user: { id: "anon", username, role: "player", isAdmin: false, isSuperAdmin: false } });
});

app.post("/api/auth/register", (req, res) => {
  const username = sanitizeName(req.body?.username) || "指挥官";
  res.json({ token: "no-auth", user: { id: "anon", username, role: "player", isAdmin: false, isSuperAdmin: false } });
});

app.get("/api/auth/me", (req, res) => {
  // 永远返回一个匿名用户，前端即视为已登录
  res.json({ user: ANON() });
});

app.post("/api/auth/logout", (req, res) => res.json({ ok: true }));

// 房间列表（前端大厅可能用到）
app.get("/api/rooms", (req, res) => res.json({ rooms: listRooms() }));

// 前端启动会拉的一些公共数据，按前端期望的形状返回
app.get("/api/contribution/testers", (req, res) => res.json([]));
app.get("/api/donation/supporters", (req, res) => res.json([]));
app.get("/api/wechat-qr", (req, res) => res.json({ description: "", imageUrl: null, imageUpdatedAt: 0 }));
app.get("/api/lobby/users", (req, res) => res.json({ users: [] }));
app.get("/api/lobby/summary", (req, res) => res.json({ totalPlayers: 0, onlinePlayers: 0 }));
app.get("/api/tournaments", (req, res) => res.json({ tournaments: [] }));
app.get("/api/mod/scenarios", (req, res) => res.json({ scenarios: [] }));
app.get("/api/saved-games", (req, res) => res.json({ savedGames: [], totalSavedGames: 0 }));
app.get("/api/completed-games", (req, res) => res.json({ completedGames: [], totalCompletedGames: 0 }));
app.get("/api/rankings", (req, res) => res.json({ rankings: {} }));

// 通配：其他未实现的 /api/* 返回空对象，避免前端崩
app.use("/api", (req, res) => res.json({}));

// SPA 兜底
app.get("*", (req, res) => res.sendFile(path.join(PUBLIC, "index.html")));

// ---------- Socket.IO ----------
const server = http.createServer(app);
const io = new SocketServer(server, {
  path: "/socket.io",
  cors: { origin: "*" },
});

// socketId -> { playerId, roomId }
const session = new Map();

function welcomeSnapshot(socket) {
  const room = getRoom(socket.data.roomId);
  if (!room) return;
  socket.emit("room:info", roomInfoPayload(room, socket.data.playerId));
  io.to(room.id).emit("room:players", playersPayload(room));
}

function roomInfoPayload(room, myPlayerId) {
  return {
    roomId: room.id,
    roomName: room.name,
    scenario: room.scenario,
    maxPlayers: room.maxPlayers,
    enabledNations: enabledNations(room.scenario),
    hostPlayerId: room.hostId,
    myPlayerId,
    status: room.status,
    isHotseat: false,
    isTestMode: false,
    isSpectator: false,
    allowSpectators: true,
    emergencyDive: false,
    presetOptionIndex: 0,
    nationSelectMode: "free",
  };
}

io.on("connection", (socket) => {
  console.log("[socket] connection", socket.id, "auth=", JSON.stringify(socket.handshake.auth));
  // 建连即创建一个匿名用户（昵称可空，进房前再设）
  const user = createUser(socket.id, "");
  session.set(socket.id, { playerId: user.id, roomId: null });
  socket.data.playerId = user.id;

  // 便于调试/前端接入：把当前身份发回
  socket.emit("identity", toClientUser(user));

  // ---- 昵称：随时可改，改完广播 ----
  socket.on("user:set_name", (name, cb) => {
    const u = setUsername(socket.id, name);
    io.emit("identity", toClientUser(u));
    if (socket.data.roomId) {
      const room = getRoom(socket.data.roomId);
      if (room) {
        renamePlayer(room, socket.data.playerId, u.username);
        io.to(room.id).emit("room:players", playersPayload(room));
      }
    }
    cb?.({ ok: true, user: toClientUser(u) });
  });

  // ---- 房间：创建 ----
  // 前端签名: emit("room:create", username, scenario, roomName, maxPlayers, password, ...flags, cb)
  socket.on("room:create", (...args) => {
    const cb = typeof args[args.length - 1] === "function" ? args.pop() : null;
    console.log("[room:create] args =", JSON.stringify(args));
    const [username, scenario = 0, roomName = "", maxPlayers = 6] = args;
    const u = setUsername(socket.id, username) || user;
    const room = createRoom({ username: u.username, scenario, roomName, maxPlayers });
    addPlayer(room, { playerId: socket.data.playerId, username: u.username });
    socket.join(room.id);
    socket.data.roomId = room.id;
    session.get(socket.id).roomId = room.id;
    socket.emit("room:info", roomInfoPayload(room, socket.data.playerId));
    io.to(room.id).emit("room:players", playersPayload(room));
    cb?.(room.id);
  });

  // ---- 房间：加入 ----
  // 前端签名: emit("room:join", roomId, username, password, cb)
  socket.on("room:join", (roomId, username, _password, cb) => {
    const room = getRoom(roomId);
    if (!room) return cb?.(false, { error: "房间不存在" });
    if (room.players.length >= room.maxPlayers) return cb?.(false, { error: "房间已满" });
    const u = setUsername(socket.id, username) || user;
    addPlayer(room, { playerId: socket.data.playerId, username: u.username });
    socket.join(room.id);
    socket.data.roomId = room.id;
    session.get(socket.id).roomId = room.id;
    io.to(room.id).emit("room:players", playersPayload(room));
    socket.emit("room:info", roomInfoPayload(room, socket.data.playerId));
    cb?.(room.id);
  });

  // ---- 房间：旁观 ----
  socket.on("room:spectate", (roomId, username, _password, cb) => {
    const room = getRoom(roomId);
    if (!room) return cb?.(false, { error: "房间不存在" });
    const u = setUsername(socket.id, username) || user;
    addPlayer(room, { playerId: socket.data.playerId, username: u.username, isSpectator: true });
    socket.join(room.id);
    socket.data.roomId = room.id;
    io.to(room.id).emit("room:players", playersPayload(room));
    socket.emit("room:info", roomInfoPayload(room, socket.data.playerId));
    cb?.(room.id);
  });

  // ---- 房间：离开 ----
  socket.on("room:leave", () => {
    const room = getRoom(socket.data.roomId);
    if (room) {
      removePlayerById(room, socket.data.playerId);
      socket.leave(room.id);
      if (room.players.length === 0) deleteRoom(room.id);
      else io.to(room.id).emit("room:players", playersPayload(room));
    }
    socket.data.roomId = null;
    if (session.has(socket.id)) session.get(socket.id).roomId = null;
  });

  // ---- 房间：查询 ----
  socket.on("room:info_request", () => welcomeSnapshot(socket));
  socket.on("room:list", (cb) => cb?.(listRooms()));

  // ---- 房间：开始对局（骨架版：只切状态、广播） ----
  socket.on("room:start", (cb) => {
    const room = getRoom(socket.data.roomId);
    if (!room) return cb?.(false, { error: "不在房间中" });
    initGameState(room);
    room.status = "in_progress";
    io.to(room.id).emit("game:state", statePayload(room));
    io.to(room.id).emit("room:info", roomInfoPayload(room, null));
    cb?.(true);
  });

  // ---- 国家选择（骨架版：只记录并广播） ----
  socket.on("room:pick_nation", (nationId, cb) => {
    const room = getRoom(socket.data.roomId);
    if (!room) return cb?.(false);
    const p = room.players.find((x) => x.playerId === socket.data.playerId);
    if (p && nationId) {
      if (!p.nationIds.includes(nationId)) {
        // 单选式：先清空
        p.nationIds = [nationId];
        for (const other of room.players) {
          if (other !== p) other.nationIds = other.nationIds.filter((n) => n !== nationId);
        }
      }
    }
    io.to(room.id).emit("room:players", playersPayload(room));
    cb?.(true);
  });

  // ---- 游戏状态同步（骨架版：仅支持整体广播 patch） ----
  socket.on("game:patch", (patch) => {
    const room = getRoom(socket.data.roomId);
    if (room && room.gameState) {
      room.gameState = { ...room.gameState, ...patch };
      socket.to(room.id).emit("game:patch", patch);
    }
  });

  // ---- 各阶段最小响应：收到即广播、回执成功（引擎留空） ----
  for (const phase of PHASES) {
    const ev = `${phase.replace("_", ":")}`; // 仅为占位，前端实际用 phaseN:xxx
  }
  const ACK_EVENTS = [
    "phase1:ready", "phase1:ready_all",
    "phase2:submit", "phase2:unsubmit",
    "phase3:pick_slot", "phase3:execute_one",
    "phase4:confirm_ready", "phase4:confirm_end",
    "phase5:ready", "phase5:ready_all",
    "phase6:submit_medals", "phase6:submit_relieve",
    "phase7:purchase", "phase7:deploy",
  ];
  for (const ev of ACK_EVENTS) {
    socket.on(ev, (...args) => {
      const cb = typeof args[args.length - 1] === "function" ? args.pop() : null;
      cb?.(true);
    });
  }

  socket.on("disconnect", () => {
    const room = getRoom(socket.data.roomId);
    if (room) {
      removePlayerById(room, socket.data.playerId);
      if (room.players.length === 0 && room.spectators.length === 0) deleteRoom(room.id);
      else io.to(room.id).emit("room:players", playersPayload(room));
    }
    removeUser(socket.id);
    session.delete(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`[warroom-local] 无鉴权服务已启动`);
  console.log(`  http://localhost:${PORT}`);
});
