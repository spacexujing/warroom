# 本地复现 War Room 服务 —— 原站镜像缺口分析

> 此文分析原站后端源码的缺失，不代表当前仓库没有本地引擎。现在已有 `web/` 全球战场七阶段协作版本；运行、结算范围及待开发项见 [web/README.md](web/README.md)。`server/` 仍为镜像兼容骨架。

分析对象: https://www.playwarroom.com （前端 bundle: site/index-BtF6H2JA.js）

## 一、已拿到的（本地已有）

| 资源 | 状态 | 位置 |
|------|------|------|
| 全部图片素材 (250个) | ✅ | assets/ |
| 前端 SPA 外壳 | ✅ | site/index.html |
| 前端全部 JS (1.6MB, 含游戏逻辑+布局数据) | ✅ | site/index-BtF6H2JA.js |
| Service Worker | ✅ | site/map-assets-sw.js |
| 地图坐标 (190个归一化点) | ✅ | extracted/territory_positions.json |
| 领土/海洋/海峡/叠加层数据 | ✅ | extracted/ |
| 完整规则书 (PDF+TXT) | ✅ | 作战室规则2025* |

## 二、本地启动缺什么

### A. 前端 —— 基本不缺，可直接静态托管
- 前端是纯 React SPA，把 assets/ 平铺到 web 根 + index.html + JS bundle 即可打开界面
- 但所有数据都靠后端喂，没有后端就是空壳

### B. 后端 —— 完全缺失（这是主要缺口）
后端是 **Node.js + Express + Socket.IO**（响应头 X-Powered-By: Express，
/socket.io/ 端点返回 EIO=4 握手包），源码未公开，需要**从零重写**。

需要实现的部分：

1. **HTTP API**（Express 路由，全部以 `hn=""` 即同源为 base）
   - 鉴权: POST /api/auth/login, /register, /logout, GET /me
     （JWT，token 存前端 localStorage["warroom_token"]，Authorization: Bearer）
   - 房间: GET /api/rooms
   - 存档/回放: /api/saved-games, /api/completed-games, .../snapshots, .../state
   - 模组/剧本: /api/mod/scenarios, /api/admin/mod/scenarios/*
   - 管理: /api/admin/* (players, stats, titles, users/roles, adjudication-requests)
   - 其他: /api/lobby/users, /api/donation/supporters, /api/contribution/testers, /api/wechat-qr
   - 错误格式: {errorKey, error}（中英双语，errorKey 供 i18n）

2. **Socket.IO 实时服务**（约 120 个事件）
   - 握手需校验 auth.token
   - 房间管理: room:create/join/leave/start/info/players/spectate/set_hotseat...
   - 游戏引擎（服务端权威，前端只发操作）:
     - phase1:ready / ready_all（国民经济）
     - phase2:submit / unsubmit / reorg / route_overlays（战略规划）
     - phase3:execute_one / pick_slot / skip_order / launch_carrier_fighters（移动）
     - phase4:* 全部战斗（roll_dice, assign_hit, discard_hits, miss_black_hit,
       resolve_garrison_hit, roll_strategic_bombing, roll_convoy_raid,
       resolve_escort_guard, choose_hotspot, award_medals...）（作战行动）
     - phase5:* deploy / land_air / ready（改装部署）
     - phase6:* submit_medals / submit_relieve / submit_zone_penalty（压力结算）
     - phase7:* purchase / deploy / trade / strategic_bombing_repair（生产）
     - game:state / game:patch / game:log / rollback_* / surrender（状态同步与回档）
   - **关键**: 掷骰 RNG、命中分配、伤害计算、胜负判定——全在服务端，
     前端 bundle 里没有这些算法（只有 UI 侧的规则语义和 i18n 文案）

3. **数据层**（完全缺失）
   - 用户库（账号、角色 admin/player/superadmin、密码哈希）
   - 房间/对局状态
   - 剧本(scenario)数据 —— 注意：地形/坐标在前端 bundle 里有，
     但剧本初设（各国初始部队、资源、领土归属）在服务端
   - 存档、回放快照、统计数据、锦标赛

4. **i18n** —— 前端已内置中英文案，后端错误也用 errorKey，需对齐

### C. 部署配置
- 同源部署（前端静态 + 后端 API/socket 同一 host）
- HTTPS
- Service Worker scope "/"

## 三、工作量评估

| 模块 | 难度 | 说明 |
|------|------|------|
| 前端静态托管 | ★ | 改 base 路径即可 |
| HTTP API + JWT | ★★★ | 按上面清单实现 |
| Socket 房间管理 | ★★★ | ~30 事件 |
| **游戏引擎（7阶段+战斗结算）** | ★★★★★ | 核心难点，~90 事件，需完整实现规则书全部规则 |
| 数据持久化 | ★★★ | DB 设计 + 剧本数据录入 |

## 四、最快可行路径

1. **纯离线单机版**（推荐起步）：
   - 只做前端 + 一个本地 mock 服务，把"服务端权威"逻辑用 JS 在浏览器里重写
   - 游戏引擎可参考前端已有的规则语义（命中顺序、颜色映射、优势、转换表）
   - 无需鉴权、网络、DB

2. **完整联机版**：需要从零写 Node + Socket.IO 后端，工作量最大，
   且需自行录入各国初始剧本数据（这部分前端没有）

## 五、结论

- 前端：**几乎不缺**（素材+代码+布局数据+规则语义都在手）
- 后端：**完全缺失**，需从零实现（Express + Socket.IO + 游戏引擎 + 数据库）
- 最大障碍：**游戏引擎的结算算法在服务端，未随前端泄露**；
  但规则书 + 前端 i18n/常量已足够反推出绝大部分规则
- 立即可做：静态打开前端看 UI；单机版需重写引擎；联机版需重写整个后端
