"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { decodeFrame, createApp } = require("../server");
function frame(text, { opcode = 1, fin = true } = {}) {
  const payload = Buffer.from(text), key = Buffer.from([1, 2, 3, 4]);
  const buf = Buffer.alloc(6 + payload.length); buf[0] = (fin ? 128 : 0) | opcode; buf[1] = 128 | payload.length; key.copy(buf, 2); for (let i = 0; i < payload.length; i++) buf[6 + i] = payload[i] ^ key[i & 3]; return buf;
}
test("WebSocket parser accepts masked UTF-8, waits for partial frames and rejects oversized or unmasked messages", () => {
  const buf = frame("确认"); assert.equal(decodeFrame(buf).payload.toString(), "确认"); assert.equal(decodeFrame(buf.subarray(0, 5)), null); assert.throws(() => decodeFrame(Buffer.from([129, 1, 120])));
  const huge = Buffer.alloc(10); huge[0] = 129; huge[1] = 255; huge.writeBigUInt64BE(65537n, 2); assert.throws(() => decodeFrame(huge));
  assert.throws(() => decodeFrame(frame("x", { opcode: 9, fin: false })));
});
test("malformed URL and unsupported methods return errors without throwing", () => {
  const { serveStatic } = createApp({ savePath: null }); let status = 0;
  const response = { writeHead(code) { status = code; }, end() {} };
  serveStatic({ url: "/%ZZ", method: "GET" }, response); assert.equal(status, 400);
  serveStatic({ url: "/", method: "POST" }, response); assert.equal(status, 405);
  serveStatic({ url: "/%00", method: "GET" }, response); assert.equal(status, 400);
});
