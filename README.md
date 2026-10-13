# War Room — 全球战场协作棋盘与资源镜像

当前可运行的开发入口为 `web/`。需要 Node.js 20+，运行：

```sh
./run.sh
```

打开 http://127.0.0.1:3000 。独立引擎提供七阶段的主要结算、操作预览、自动存档与结算记录。

`run.sh` 可从任意工作目录调用，检查 Node.js 版本后在前台启动服务，按 `Ctrl+C` 停止。可用 `HOST`、`PORT`、`WARROOM_SAVE_PATH` 指定监听地址、端口和存档路径，例如 `PORT=8080 ./run.sh`。

- [运行与规则说明](web/README.md)
- [界面截图与审阅顺序](docs/UI_REVIEW.md)
- `cd web && npm test` 运行引擎与传输测试。

本版使用全球剧本；原站镜像与 `server/` 兼容骨架仍保留作为参考。其他剧本和可选规则的范围见运行说明。

## 原始资源镜像说明

来源: https://www.playwarroom.com  (Azure 托管, 香港 eastasia 节点)
镜像时间: 2026-10-12

## 重要发现

- 裸域名 playwarroom.com **无 A 记录**，必须用 **www.playwarroom.com**。
- 站点是 React + Vite 单页应用 (SPA)。核心逻辑全在 `site/index-BtF6H2JA.js` (1.6MB)。
- 图片资源**直接挂在根路径**下：`https://www.playwarroom.com/<文件名>`
  （不是 /assets/ 或 /map-assets/，尽管 JS 里变量名叫 map-assets）。
- 图片通过 Service Worker (`site/map-assets-sw.js`) 做 CacheFirst 缓存，拦截所有图片请求。
- 资源版本标识 (JS 内): `map-assets-2026-07-09-1`。
- 站点是二战题材桌游，Nightmare/nightingale-games.com 出品，作者 paypal: ecustcl。

## 目录结构

```
warroom/
├── assets/                 # 250 个图片素材 (67.5MB)，原始文件名
├── site/
│   ├── index.html          # SPA 外壳
│   ├── index-BtF6H2JA.js   # 全部游戏逻辑 + 资源清单 (1.6MB)
│   └── map-assets-sw.js    # Service Worker (图片缓存)
├── assets_index.json       # 每个文件的 尺寸/字节 索引
├── assets_manifest.txt     # 人类可读清单 (按前缀分组)
└── README.md
```

## 素材分类 (按前缀)

| 前缀 | 数量 | 说明 |
|------|------|------|
| Japan / Britain / Germany / USA / Soviet / Italy / China | 44/37/34/34/26/22/13 | 各国单位棋子 (Air 空军 / Land 陆军 / Sea 海军) 及国旗、卡牌正反面 |
| Neutral | 4 | 中立国卡牌 (land_front / land_back / _cn 中文版) |
| MapOverlay | 4 | 战役地图叠加: NORTH_AFRICA / THE_EASTERN_FRONT / WAR_IN_EUROPE / WAR_IN_THE_PACIFIC |
| Hotspot | 2 | active / inactive 热点标记 |
| CarrierFighter | 4 | allied / axis 舰载机 |
| Arrow / Air_return | 4 | 方向箭头 / 返航标记 (allied/axis) |
| 单兵种图标 | ~15 | Infantry/Artillery/Armor/Fighter/Bomber/Submarine/Cruiser/Carrier/Battleship 的 .jpg |
| 资源/状态图标 | — | Oil / Iron / Medal / Industry / CivilianGoods / Convoy_Casualties / Bomb / Dived_Submarine |
| 地图 | 2 | map.jpg (3.6MB) / map_cn.jpg (4.9MB, 中文版) |

## 关键数据结构 (从 JS 提取)

### 单位类型 → 图标 (land/air/sea 通用)
```js
{
  infantry:"/Infantry.jpg", artillery:"/Artillery.jpg", armor:"/Armor.jpg",
  fighter:"/Fighter.jpg", bomber:"/Bomber.jpg", submarine:"/Submarine.jpg",
  cruiser:"/Cruiser.jpg", carrier:"/Carrier.jpg", battleship:"/Battleship.jpg",
  carrier_fighter:"/CarrierFighter_allied.png", convoy_casualty:"/Convoy_Casualties.png"
}
```

### 卡牌背面/正面命名约定
```
<Nation>_land_front.jpg      国家陆军卡正面
<Nation>_land_front_cn.jpg   中文版正面
<Nation>_land_back.jpg       背面
<Nation>_Air_<NN>.png        空军单位编号卡 (如 Britain_Air_11.png)
<Nation>_Land_<NN>.png       陆军单位编号卡
<Nation>_Sea_<NN>.png        海军单位编号卡
<Nation>_Flag.jpg            国旗
```

### 单位属性标注 (JS 内, 文件名 → 属性字符串)
```
"Britain_Air_11.png":"Ar/3g"    // A=?, r=range?, 3g=?
"Britain_Land_80.png":"Lb/y"    // L=land, b=?, y=?
"Britain_Land_36.png":"Lg/b/y"
```
（属性编码含义待逆向：L=Land, A=Air, S=Sea 类前缀 + 后续小写字母为能力标记）

### 热点/地图 (Phase 4 Select Hotspot 等 UI 文案)
- Hotspot_active.png / Hotspot_inactive.png
- MapOverlay_*.png 对应四场战役场景

## 后续开发入口

1. 游戏主逻辑: 反混淆 `site/index-BtF6H2JA.js`（Vite 打包，函数名已压缩）。
2. 资源引用统一走根路径，本地开发时把 `assets/` 平铺到 web 根目录即可。
3. 中文版素材齐全 (`*_cn.jpg` + `map_cn.jpg`)，可做双语。
