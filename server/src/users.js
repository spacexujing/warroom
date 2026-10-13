// 无鉴权会话与用户管理
// —— 玩家只用昵称声明身份，随时可改，无密码、无账号、无持久化。

import crypto from "node:crypto";

// 内存中的用户表: socketId -> user
// 每个连接一个匿名用户；username 可随时改。
const users = new Map();

// 生成一个稳定的匿名 userId（仅用于前端区分，不跨会话）
export function newUserId() {
  return "u_" + crypto.randomBytes(6).toString("hex");
}

// 创建默认用户（进入时随机给个昵称，玩家可改）
export function createUser(socketId, username) {
  const user = {
    id: newUserId(),
    username: sanitizeName(username) || "指挥官" + Math.floor(Math.random() * 9000 + 1000),
    role: "player",
    isAdmin: false,
    isSuperAdmin: false,
  };
  users.set(socketId, user);
  return user;
}

export function getUser(socketId) {
  return users.get(socketId) || null;
}

export function setUsername(socketId, username) {
  const u = users.get(socketId);
  if (!u) return null;
  const name = sanitizeName(username);
  if (name) u.username = name;
  return u;
}

export function removeUser(socketId) {
  users.delete(socketId);
}

export function sanitizeName(name) {
  if (typeof name !== "string") return "";
  return name.trim().slice(0, 24);
}

// 前端 auth/me 返回的 user 对象形态（对齐前端契约）
export function toClientUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    isAdmin: u.isAdmin,
    isSuperAdmin: u.isSuperAdmin,
  };
}
