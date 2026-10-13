// 房间模型 —— 无鉴权版。房间只存在于内存。

import crypto from "node:crypto";

// roomId -> room
const rooms = new Map();

// 剧本 ID（对齐前端 Sl / 剧本表）。先用最小编号集合。
export const SCENARIOS = [
  { id: 0, key: "global", name: "全球战场", max: 6 },
  { id: 1, key: "europe", name: "欧洲战场", max: 5 },
  { id: 2, key: "pacific", name: "太平洋战场", max: 3 },
  { id: 3, key: "north_africa", name: "北非战场", max: 4 },
  { id: 4, key: "eastern_front", name: "东线战场", max: 2 },
];

function newRoomId() {
  // 6 位大写短码，便于口头传播
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += abc[crypto.randomInt(abc.length)];
  return s;
}

export function createRoom({ username, scenario = 0, roomName = "", maxPlayers = 6, options = {} }) {
  let id;
  do { id = newRoomId(); } while (rooms.has(id));

  const room = {
    id,
    name: roomName || `房间 ${id}`,
    scenario,
    maxPlayers,
    hostId: null,           // playerId（连接时分配）
    createdAt: Date.now(),
    status: "lobby",        // lobby | in_progress | finished
    players: [],            // { playerId, username, isSpectator, nationIds }
    spectators: [],
    options,
    // 最小游戏状态
    gameState: null,
  };
  rooms.set(id, room);
  return room;
}

export function getRoom(id) {
  return rooms.get(id) || null;
}

export function deleteRoom(id) {
  rooms.delete(id);
}

export function listRooms() {
  return [...rooms.values()].map((r) => ({
    id: r.id,
    roomId: r.id,
    name: r.name,
    roomName: r.name,
    scenario: r.scenario,
    maxPlayers: r.maxPlayers,
    status: r.status,
    playerCount: r.players.length,
    spectatorCount: r.spectators.length,
    hostId: r.hostId,
  }));
}

export function addPlayer(room, { playerId, username, isSpectator = false }) {
  const entry = { playerId, username, isSpectator, nationIds: [] };
  if (isSpectator) room.spectators.push(entry);
  else room.players.push(entry);
  if (!room.hostId && !isSpectator) room.hostId = playerId;
  return entry;
}

export function removePlayerById(room, playerId) {
  room.players = room.players.filter((p) => p.playerId !== playerId);
  room.spectators = room.spectators.filter((p) => p.playerId !== playerId);
  if (room.hostId === playerId) {
    room.hostId = room.players[0]?.playerId ?? null;
  }
}

export function renamePlayer(room, playerId, username) {
  for (const p of [...room.players, ...room.spectators]) {
    if (p.playerId === playerId) p.username = username;
  }
}

export function findPlayerBySocket(room, playerId) {
  return [...room.players, ...room.spectators].find((p) => p.playerId === playerId) || null;
}

// room:players 广播体（对齐前端消费结构）
export function playersPayload(room) {
  return [...room.players, ...room.spectators].map((p) => ({
    playerId: p.playerId,
    id: p.playerId,
    username: p.username,
    isSpectator: p.isSpectator,
    nationIds: p.nationIds,
  }));
}
