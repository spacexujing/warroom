// 最小游戏状态 —— 骨架阶段。
// 目标：能让玩家进房间、选/分国家、开始对局、看到 state 广播。
// 真正的 7 阶段/战斗结算引擎留待后续实现。

export const PHASES = [
  "phase1_economy",
  "phase2_planning",
  "phase3_movement",
  "phase4_combat",
  "phase5_refit",
  "phase6_morale",
  "phase7_production",
];

export const NATIONS = [
  "china", "britain", "soviet", "usa", "germany", "italy", "japan",
];

// 按剧本默认可参战国家
const SCENARIO_NATIONS = {
  0: NATIONS, // global: 全部
  1: ["britain", "soviet", "usa", "germany", "italy"], // europe
  2: ["china", "britain", "usa", "japan"], // pacific
  3: ["britain", "usa", "germany", "italy"], // north africa
  4: ["soviet", "germany"], // eastern front
};

export function enabledNations(scenario) {
  return SCENARIO_NATIONS[scenario] ?? NATIONS;
}

// 初始化最小 game state
export function initGameState(room) {
  room.gameState = {
    roomId: room.id,
    scenario: room.scenario,
    round: 1,
    currentPhase: PHASES[0],
    phaseIndex: 0,
    players: room.players.map((p) => ({
      playerId: p.playerId,
      username: p.username,
      nationIds: p.nationIds,
      ready: false,
    })),
    createdAt: Date.now(),
  };
  return room.gameState;
}

// 当前状态（发给前端）
export function statePayload(room) {
  return room.gameState;
}
