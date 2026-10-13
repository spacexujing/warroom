#!/usr/bin/env python3
"""合成 focus 动画 GIF（确定性方式）：
在浏览器里预先把动画的每一帧 view 参数算好，逐帧 setState + 截图。
"""
import json, base64, urllib.request, socket, struct, os, glob, time, io

def _find_port():
    for f in glob.glob("/tmp/agent-browser-chrome-*/DevToolsActivePort"):
        try: return int(open(f).read().splitlines()[0])
        except Exception: pass
    return 42819
PORT=_find_port(); OUT="/tmp/focus.gif"

def http_get(p):
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{p}", timeout=5) as r: return json.load(r)
page=next(t for t in http_get("/json") if t.get("type")=="page")
ws_url=page["webSocketDebuggerUrl"]
key=base64.b64encode(os.urandom(16)).decode()
host="127.0.0.1"; path=ws_url.split(f"{host}:{PORT}",1)[1]
s=socket.create_connection((host,PORT),timeout=10)
s.sendall((f"GET {path} HTTP/1.1\r\nHost: {host}:{PORT}\r\nUpgrade: websocket\r\n"
           f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
assert b"101" in s.recv(4096)
_id=[0]
def send(m,p=None):
    _id[0]+=1; i=_id[0]
    d=json.dumps({"id":i,"method":m,"params":p or {}}).encode()
    h=bytearray([0x81]); ln=len(d); mk=os.urandom(4)
    if ln<126: h.append(0x80|ln)
    elif ln<65536: h.append(0x80|126); h+=struct.pack(">H",ln)
    else: h.append(0x80|127); h+=struct.pack(">Q",ln)
    h+=mk; s.sendall(bytes(h)+bytes(b^mk[k%4] for k,b in enumerate(d))); return i
def rd(n):
    b=b""
    while len(b)<n:
        c=s.recv(n-len(b))
        if not c: raise EOFError
        b+=c
    return b
def until(wid):
    while True:
        b1,b2=rd(2); ln=b2&0x7f
        if ln==126: ln=struct.unpack(">H",rd(2))[0]
        elif ln==127: ln=struct.unpack(">Q",rd(8))[0]
        fr=rd(ln)
        try: m=json.loads(fr)
        except: continue
        if m.get("id")==wid: return m
def ev(expr):
    return until(send("Runtime.evaluate",{"expression":expr,"returnByValue":True}))
def shot():
    m=until(send("Page.captureScreenshot",{"format":"jpeg","quality":70,
        "clip":{"x":0,"y":0,"width":1280,"height":577,"scale":0.5}}))
    return base64.b64decode(m["result"]["data"])

# 1) 复位到 fit 初始
ev("cancelFocusAnim(); view.rotation=0; view.scale=fitScale; centerView(); drawMap(); 1")
time.sleep(0.2)
# 2) 让浏览器算出 from/to 及每帧 view 值（25 帧）
setup = ev("""(()=>{
  const FOCUS_ANCHOR_X=0.40, FOCUS_ANCHOR_Y=0.50;
  const nx=0.263, ny=0.541;
  const p={x:nx*mapSide,y:ny*mapSide};
  const scale=focusScaleAbs;
  const cx=cssW/2, cy=cssH/2, ax=cssW*FOCUS_ANCHOR_X, ay=cssH*FOCUS_ANCHOR_Y;
  const dx=ax-cx, dy=ay-cy, cos=Math.cos(-view.rotation), sin=Math.sin(-view.rotation);
  const tx=cx+dx*cos-dy*sin, ty=cy+dx*sin+dy*cos;
  const to={scale, x:tx-p.x*scale, y:ty-p.y*scale};
  const from={x:view.x,y:view.y,scale:view.scale};
  const ease=t=> t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
  const N=25, frames=[];
  for(let i=0;i<N;i++){
    const k=ease(i/(N-1));
    frames.push({x:from.x+(to.x-from.x)*k, y:from.y+(to.y-from.y)*k, s:from.scale+(to.scale-from.scale)*k});
  }
  window.__frames=frames; return frames.length;
})()""")
print("frames:", setup["result"]["result"].get("value"))

frames=[]
N=25
for i in range(N):
    ev(f"view.x=window.__frames[{i}].x; view.y=window.__frames[{i}].y; view.scale=window.__frames[{i}].s; drawMap(); 1")
    frames.append(shot())
print("captured", len(frames))

from PIL import Image
imgs=[Image.open(io.BytesIO(f)).convert("P", palette=Image.ADAPTIVE) for f in frames]
imgs[0].save(OUT, save_all=True, append_images=imgs[1:], duration=40, loop=0)
print("saved", OUT, os.path.getsize(OUT), "bytes")
