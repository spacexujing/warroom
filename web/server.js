#!/usr/bin/env node
/**
 * War Room — 无鉴权 · 无身份 · 全局单局（零依赖）
 *
 * 模型：
 *   - 服务端从头到尾只有【一盘进行中的游戏】，状态由服务端权威持有。
 *   - 连接即匿名：WebSocket 一连上就是一个无身份通道，不传"你是谁"。
 *   - 视角是纯客户端概念；服务端校验国家、阶段、部队归属、资源和规则。
 *   - 任何操作 → 服务端状态变化 → 立即广播给所有在线连接（动作来源对他人无感）。
 *
 * 启动:  node server.js   (默认端口 3000)
 */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = process.env.PORT || 3000;
const MAX_MESSAGE = 65536;
const PUBLIC_DIR = path.join(__dirname, "public");

/* ============================================================
 * 一、最小 WebSocket 实现（RFC 6455）
 * ============================================================ */

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function upgradeToWebSocket(req, socket, head, { onMessage, onClose }) {
  const key = req.headers["sec-websocket-key"];
  if (req.headers["sec-websocket-version"] !== "13" || typeof key !== "string" || Buffer.from(key, "base64").length !== 16) { socket.destroy(); return null; }
  if (req.headers.origin) { try { if (new URL(req.headers.origin).host !== req.headers.host) { socket.destroy(); return null; } } catch { socket.destroy(); return null; } }
  const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  const conn = {
    id: crypto.randomBytes(8).toString("hex"),
    alive: true,
    send(data) {
      if (!conn.alive) return;
      const payload = Buffer.from(typeof data === "string" ? data : JSON.stringify(data), "utf8");
      if (socket.writableLength > 4 * 1024 * 1024) { conn.close(); return; }
      try { socket.write(encodeFrame(payload, 0x1)); } catch { conn.alive = false; }
    },
    close() {
      conn.alive = false;
      try { socket.write(encodeFrame(Buffer.alloc(0), 0x8)); } catch {}
      try { socket.destroy(); } catch {}
    },
  };

  let buffer = Buffer.alloc(0), fragments = [], total = 0, fragmented = false;
  function consume(chunk) {
    try {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const frame = decodeFrame(buffer); if (!frame) break; buffer = frame.rest;
        if (frame.opcode === 0x8) { conn.close(); return; }
        if (frame.opcode === 0x9) { socket.write(encodeFrame(frame.payload, 0xA)); continue; }
        if (frame.opcode === 0xA) continue;
        if (frame.opcode === 1) { if (fragmented) throw Error("nested fragments"); fragments = []; total = 0; }
        else if (!fragmented) throw Error("unexpected continuation");
        fragments.push(frame.payload); total += frame.payload.length;
        if (total > MAX_MESSAGE) throw Error("message too large");
        fragmented = !frame.fin;
        if (frame.fin) { const message = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(fragments)); fragments = []; total = 0; onMessage(conn, message); }
      }
      if (buffer.length > MAX_MESSAGE + 14) throw Error("message too large");
    } catch { conn.close(); }
  }
  socket.on("data", consume);
  if (head.length) process.nextTick(() => consume(head));
  socket.on("close", () => { conn.alive = false; onClose(conn); });
  socket.on("error", () => { conn.alive = false; onClose(conn); });

  return conn;
}

function encodeFrame(payload, opcode) {
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.alloc(2); header[1] = len; }
  else if (len < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f, fin = !!(buf[0] & 0x80);
  const masked = (buf[1] & 0x80) !== 0;
  if ((buf[0] & 0x70) || !masked || ![0, 1, 8, 9, 10].includes(opcode)) throw Error("invalid WebSocket frame");
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); offset = 4; }
  else if (len === 127) { if (buf.length < 10) return null; const wide = buf.readBigUInt64BE(2); if (wide > BigInt(MAX_MESSAGE)) throw Error("message too large"); len = Number(wide); offset = 10; }
  if (len > MAX_MESSAGE || (opcode >= 8 && (!fin || len > 125))) throw Error("invalid frame length");
  let maskKey = null;
  if (masked) { if (buf.length < offset + 4) return null; maskKey = buf.subarray(offset, offset + 4); offset += 4; }
  if (buf.length < offset + len) return null;
  const payload = Buffer.from(buf.subarray(offset, offset + len));
  if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i & 3];
  return { opcode, fin, payload, rest: buf.subarray(offset + len) };
}

/* ============================================================
 * 二、全局唯一的游戏状态（服务端权威）
 * ============================================================ */

const { createEngine } = require("./engine");
const conns = new Set();
let engine;
function broadcastState(state) { for (const c of conns) c.send(state); }
function snapshot() { return engine.snapshot(); }
function handleMessage(conn, raw) { engine.dispatch(conn, raw); }
/* ============================================================
 * 五、HTTP：静态文件 + 图片素材
 * ============================================================ */

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon",
};

function serveStatic(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname); } catch { res.writeHead(400); return res.end("malformed URL"); }
  if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405, { Allow: "GET, HEAD" }); return res.end(); }
  if (urlPath === "/api/state" || urlPath === "/api/export") {
    res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store", ...(urlPath === "/api/export" ? { "Content-Disposition": `attachment; filename="warroom-round-${engine.game.round}.json"` } : {}) });
    return res.end(req.method === "HEAD" ? undefined : JSON.stringify(urlPath === "/api/export" ? { version: 1, game: engine.game } : snapshot()));
  }
  if (urlPath.includes("\0") || urlPath.includes("\\")) { res.writeHead(400); return res.end(); }
  if (urlPath === "/") urlPath = "/index.html";
  const safe = urlPath;
  const filePath = path.resolve(PUBLIC_DIR, "." + safe);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end("forbidden"); }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      const alt = path.join(PUBLIC_DIR, "assets", path.basename(safe));
      return fs.stat(alt, (e2, s2) => {
        if (e2 || !s2.isFile()) { res.writeHead(404); return res.end("not found"); }
        streamFile(req, res, alt);
      });
    }
    streamFile(req, res, filePath);
  });
}

function streamFile(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-cache" });
  if (req.method === "HEAD") return res.end();
  const stream = fs.createReadStream(filePath); stream.on("error", () => res.destroy()); stream.pipe(res);
}

/* ============================================================
 * 六、启动
 * ============================================================ */

const server = http.createServer(serveStatic);

server.on("upgrade", (req, socket, head) => {
  if (req.url.split("?")[0] !== "/ws") { socket.destroy(); return; }
  const conn = upgradeToWebSocket(req, socket, head, {
    onMessage: (c, raw) => handleMessage(c, raw),
    onClose: (c) => conns.delete(c),
  });
  if (!conn) return;
  conns.add(conn);
  // 一连上就推送全局状态（无需任何身份/握手信息）
  conn.send(snapshot());
});

if (require.main === module) {
  engine = createEngine({ emit: broadcastState, savePath: process.env.WARROOM_SAVE_PATH || path.join(__dirname, "data", "game.json") });
  server.listen(PORT, process.env.HOST || "127.0.0.1", () => console.log(`[warroom] http://${process.env.HOST || "127.0.0.1"}:${PORT} · 七阶段协作单局`));
}
function createApp(options = {}) { engine = createEngine({ emit: broadcastState, ...options }); return { server, engine, serveStatic }; }
module.exports = { createApp, encodeFrame, decodeFrame };
