#!/usr/bin/env python3
"""通过 CDP 直接对 agent-browser 的 chrome 截图（Page.captureScreenshot）。
用法: python3 cdp_shot.py <out.png>
"""
import json, sys, base64, urllib.request, socket, struct, os, glob

def _find_port():
    # 从 agent-browser chrome 的 DevToolsActivePort 自动发现端口
    if os.environ.get("CDP_PORT"):
        return int(os.environ["CDP_PORT"])
    for f in glob.glob("/tmp/agent-browser-chrome-*/DevToolsActivePort"):
        try:
            return int(open(f).read().splitlines()[0])
        except Exception:
            pass
    return 42819

PORT = _find_port()  # agent-browser chrome 调试端口
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/cdp_shot.png"

# 1) 取 target 列表
def http_get(path):
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=5) as r:
        return json.load(r)

targets = http_get("/json")
page = None
for t in targets:
    if t.get("type") == "page":
        page = t
        break
if not page:
    print("no page target"); sys.exit(1)
ws_url = page["webSocketDebuggerUrl"]
print("page:", page.get("url"))

# 2) 极简 WebSocket 客户端
import base64 as b64
key = b64.b64encode(os.urandom(16)).decode()
host = "127.0.0.1"
path = ws_url.split(f"{host}:{PORT}",1)[1]
s = socket.create_connection((host, PORT), timeout=10)
req = (f"GET {path} HTTP/1.1\r\nHost: {host}:{PORT}\r\nUpgrade: websocket\r\n"
       f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
s.sendall(req.encode())
resp = s.recv(4096)
assert b"101" in resp, resp[:200]

def send(payload: str):
    data = payload.encode()
    header = bytearray([0x81])
    ln = len(data)
    mask = os.urandom(4)
    if ln < 126:
        header.append(0x80 | ln)
    elif ln < 65536:
        header.append(0x80 | 126); header += struct.pack(">H", ln)
    else:
        header.append(0x80 | 127); header += struct.pack(">Q", ln)
    header += mask
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    s.sendall(bytes(header) + masked)

def recv_frame():
    # read 2 bytes
    def rd(n):
        buf = b""
        while len(buf) < n:
            c = s.recv(n - len(buf))
            if not c: raise EOFError
            buf += c
        return buf
    b1, b2 = rd(2)
    ln = b2 & 0x7f
    if ln == 126: ln = struct.unpack(">H", rd(2))[0]
    elif ln == 127: ln = struct.unpack(">Q", rd(8))[0]
    return rd(ln)

send(json.dumps({"id": 1, "method": "Page.captureScreenshot", "params": {"format": "png"}}))
# 读到 id:1 的响应
while True:
    frame = recv_frame()
    try:
        msg = json.loads(frame)
    except Exception:
        continue
    if msg.get("id") == 1:
        data = msg["result"]["data"]
        open(OUT, "wb").write(base64.b64decode(data))
        print("saved", OUT, os.path.getsize(OUT), "bytes")
        break
