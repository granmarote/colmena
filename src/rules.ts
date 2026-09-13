import { distance, key, neighbors } from "./hex";
import {
  ALIEN_HP,
  FACE,
  SHIP_FACE,
  TEAM_MAX_HP,
  type Action,
  type GameState,
  type PauseInfo,
  type RadarSignal,
  type Team,
  type Tile,
  type TileContent,
} from "./types";

function clone(state: GameState): GameState {
  return {
    ...state,
    tiles: Object.fromEntries(
      Object.entries(state.tiles).map(([k, t]) => [k, { ...t, hex: { ...t.hex } }]),
    ),
    teams: [
      { ...state.teams[0], hex: { ...state.teams[0].hex } },
      { ...state.teams[1], hex: { ...state.teams[1].hex } },
    ],
    charlie: { ...state.charlie, hex: { ...state.charlie.hex } },
    log: [...state.log],
    signals: [...state.signals],
    pause: state.pause ? { ...state.pause } : null,
    actedThisRound: [...state.actedThisRound],
  };
}

function pushLog(state: GameState, line: string): void {
  state.log.push(line);
  if (state.log.length > 14) state.log.splice(0, state.log.length - 14);
}

export function actor(state: GameState): Team {
  return state.teams[state.active];
}

function actorId(team: Team): 0 | 1 {
  return team.id === 1 ? 1 : 0;
}

export function otherTeam(state: GameState): Team {
  return state.teams[state.active === 0 ? 1 : 0];
}

export function occupantAt(state: GameState, hexKey: string): Team | null {
  for (const team of state.teams) {
    if (team.alive && key(team.hex) === hexKey) return team;
  }
  return null;
}

export function tileHasHiddenAlien(tile: Tile): boolean {
  return !tile.revealed && tile.content === "alien" && tile.alienHp > 0;
}

export function tileHasLiveAlien(tile: Tile): boolean {
  return tile.content === "alien" && tile.alienHp > 0;
}

function livingTeams(state: GameState): Team[] {
  if (state.joined) {
    const lead = state.teams.find((t) => t.alive);
    return lead ? [lead] : [];
  }
  return state.teams.filter((t) => t.alive);
}

function carrier(state: GameState): Team | null {
  if (state.carrying === null) return null;
  const team = state.teams[state.carrying];
  return team.alive ? team : null;
}

function isCarrier(state: GameState, team: Team): boolean {
  const hold = carrier(state);
  return hold !== null && hold.id === team.id;
}

function followCharlie(state: GameState): void {
  const hold = carrier(state);
  if (hold) state.charlie.hex = { ...hold.hex };
}

const SIGNAL_ORDER: RadarSignal[] = ["survivor", "danger"];

export function computeSignals(state: GameState, team: Team): RadarSignal[] {
  if (!team.alive) return [];
  const found = new Set<RadarSignal>();
  for (const n of neighbors(team.hex)) {
    const tile = state.tiles[key(n)];
    if (!tile) continue;
    if (tileHasHiddenAlien(tile) || (tile.revealed && tileHasLiveAlien(tile))) {
      found.add("danger");
    }
    if (!tile.revealed && tile.content === "survivor") found.add("survivor");
    if (!tile.revealed && tile.content === "reactor") found.add("danger");
  }
  return SIGNAL_ORDER.filter((s) => found.has(s));
}

function refreshRadar(state: GameState): void {
  const team = actor(state);
  state.signals = team.alive ? computeSignals(state, team) : [];
}

function checkDefeat(state: GameState): boolean {
  if (livingTeams(state).length === 0) {
    state.phase = "lost";
    state.combatKey = null;
    pushLog(state, "The wreck goes silent. No one answers.");
    return true;
  }
  return false;
}

function loseCharlie(state: GameState, message: string): void {
  state.charlie.alive = false;
  state.charlie.hp = 0;
  state.carrying = null;
  state.phase = "lost";
  state.combatKey = null;
  state.notice = message;
  pushLog(state, `${FACE.survivor} was lost.`);
}

function dropCharlie(state: GameState, at: Team): void {
  if (state.carrying === null) return;
  const tile = state.tiles[key(at.hex)];
  state.carrying = null;
  if (!tile) return;
  tile.content = "survivor";
  tile.revealed = true;
  tile.alienHp = 0;
  if (state.charlie.o2 <= 0) state.charlie.o2 = 2;
  state.charlie.hex = { ...tile.hex };
  pushLog(state, `${FACE.survivor} Charlie is down on the wreck. Someone has to pick them up.`);
}

function pickupCharlie(state: GameState, team: Team, tile: Tile): void {
  state.carrying = actorId(team);
  tile.content = "empty";
  tile.alienHp = 0;
  state.charlie.hex = { ...team.hex };
  team.o2 += state.charlie.o2;
  team.ammo += state.charlie.ammo;
  state.charlie.o2 = 0;
  state.charlie.ammo = 0;
  pushLog(
    state,
    `${FACE.survivor} Charlie is with ${team.name}, bringing extra O₂ and ammo. Get them to either dropship ${SHIP_FACE}.`,
  );
}

function maybeExtract(state: GameState, team: Team): boolean {
  const tile = state.tiles[key(team.hex)];
  if (!tile?.ship || !isCarrier(state, team) || !team.alive) return false;
  state.phase = "won";
  pushLog(state, `${SHIP_FACE} Charlie is on the ship. Rescue complete.`);
  return true;
}

function killTeam(state: GameState, team: Team, reason: string, catastrophic: boolean): void {
  const held = isCarrier(state, team) || (state.joined && state.carrying !== null);
  team.alive = false;
  team.hp = 0;
  const deathTile = state.tiles[key(team.hex)];
  if (deathTile) {
    deathTile.grave = true;
    deathTile.revealed = true;
  }
  pushLog(state, `${team.emoji} ${team.name} ${reason}`);
  if (state.joined) {
    for (const t of state.teams) t.alive = false;
  }
  state.combatKey = null;
  if (state.phase === "combat") state.phase = "play";
  if (held) {
    if (catastrophic) loseCharlie(state, `${FACE.reactor} Charlie didn't make it.`);
    else dropCharlie(state, team);
  }
  checkDefeat(state);
}

function minTeamDistance(state: GameState, hex: { q: number; r: number }): number {
  const living = livingTeams(state);
  if (living.length === 0) return 99;
  return Math.min(...living.map((t) => distance(t.hex, hex)));
}

function rollScatter(): TileContent {
  const r = Math.random();
  if (r < 0.2) return "alien";
  if (r < 0.32) return "oxygen";
  if (r < 0.44) return "ammo";
  if (r < 0.52) return "kit";
  return "empty";
}

function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

function applyFog(state: GameState): void {
  if (state.phase !== "play") return;
  const fogged: Tile[] = [];
  for (const tile of Object.values(state.tiles)) {
    if (tile.ship) continue;
    if (tile.grave) continue;
    if (tile.content === "blast" || tile.content === "reactor") continue;
    if (!tile.revealed) continue;
    if (minTeamDistance(state, tile.hex) >= 2) fogged.push(tile);
  }
  if (fogged.length === 0) return;

  const stillVisible = Object.values(state.tiles).filter(
    (t) => !t.ship && !fogged.includes(t),
  );
  const survivorOnBoard = stillVisible.some((t) => t.content === "survivor");
  const bombOnBoard = stillVisible.some((t) => t.content === "reactor");
  const needSurvivor =
    state.charlie.alive && state.carrying === null && !survivorOnBoard;
  const needBomb = !state.bombDetonated && !bombOnBoard;

  const bag: TileContent[] = [];
  if (needSurvivor) bag.push("survivor");
  if (needBomb && bag.length < fogged.length) bag.push("reactor");
  while (bag.length < fogged.length) bag.push(rollScatter());
  shuffleInPlace(bag);

  for (let i = 0; i < fogged.length; i++) {
    const tile = fogged[i];
    const content = bag[i] ?? "empty";
    tile.revealed = false;
    tile.content = content;
    tile.alienHp = content === "alien" ? ALIEN_HP : 0;
    if (content === "survivor") state.charlie.hex = { ...tile.hex };
  }
}

function settle(state: GameState, team: Team): void {
  followCharlie(state);
  if (maybeExtract(state, team)) return;
  applyFog(state);
  refreshRadar(state);
}

function enterPause(state: GameState, info: PauseInfo): void {
  if (info.kind !== "found" && livingTeams(state).length > 0 && state.charlie.alive) {
    const previous = state.phase;
    state.phase = "play";
    applyFog(state);
    state.phase = previous;
  }
  state.pause = info;
  state.phase = "pause";
  state.notice = "";
}

export function pauseIsFatal(state: GameState): boolean {
  const info = state.pause;
  if (!info) return livingTeams(state).length === 0 || !state.charlie.alive;
  if (info.kind === "found") return false;
  if (info.kind === "charlie-o2") return true;
  if (info.kind === "oxygen") return livingTeams(state).length === 0 || !state.charlie.alive;
  return livingTeams(state).length === 0 || info.charlieHit;
}

function asphyxiateCharlie(state: GameState): void {
  loseCharlie(state, `${FACE.oxygen} Charlie ran out of oxygen.`);
  enterPause(state, { kind: "charlie-o2" });
}

function tickCharlie(state: GameState): void {
  if (!state.charlie.alive) return;
  if (state.carrying !== null) return;
  if (state.charlie.o2 <= 0) {
    asphyxiateCharlie(state);
    return;
  }
  state.charlie.o2 -= 1;
  if (state.charlie.o2 <= 0) {
    state.charlie.o2 = 0;
    asphyxiateCharlie(state);
  }
}

function noteActedAndMaybeTickCharlie(state: GameState): boolean {
  const who = actor(state);
  if (who.alive && !state.actedThisRound.includes(who.id)) {
    state.actedThisRound.push(who.id);
  }
  const living = livingTeams(state);
  if (living.length === 0) return false;
  if (!living.every((t) => state.actedThisRound.includes(t.id))) return false;
  state.actedThisRound = [];
  tickCharlie(state);
  return state.phase === "pause";
}

function openOxygenPause(state: GameState, team: Team): void {
  const joined = state.joined;
  const held = isCarrier(state, team) || (joined && state.carrying !== null);
  killTeam(state, team, "ran out of oxygen.", false);
  enterPause(state, {
    kind: "oxygen",
    victimId: team.id === 1 ? 1 : 0,
    joined,
    charlieDropped: held && state.charlie.alive,
  });
}

function beginTurn(state: GameState): void {
  if (state.phase === "won" || state.phase === "lost" || state.phase === "pause") return;
  const living = livingTeams(state);
  if (living.length === 0) {
    checkDefeat(state);
    return;
  }
  if (!actor(state).alive) {
    const next = living[0];
    state.active = actorId(next);
  }
  const team = actor(state);
  if (team.o2 <= 0) {
    openOxygenPause(state, team);
    return;
  }
  team.o2 -= 1;
  refreshRadar(state);
}

function passTurn(state: GameState): void {
  if (state.phase === "won" || state.phase === "lost" || state.phase === "combat" || state.phase === "pause") return;
  if (noteActedAndMaybeTickCharlie(state)) return;
  applyFog(state);
  const living = livingTeams(state);
  if (living.length === 0) {
    checkDefeat(state);
    return;
  }
  if (living.length === 1) {
    state.active = actorId(living[0]);
    beginTurn(state);
    return;
  }
  state.active = state.active === 0 ? 1 : 0;
  if (!actor(state).alive) state.active = actorId(otherTeam(state));
  beginTurn(state);
}

export function legalHexes(state: GameState): Set<string> {
  const out = new Set<string>();
  if (state.phase !== "play") return out;
  const team = actor(state);
  if (!team.alive) return out;
  for (const n of neighbors(team.hex)) {
    const tile = state.tiles[key(n)];
    if (!tile) continue;
    out.add(key(n));
  }
  return out;
}

function mergeTeams(state: GameState, mover: Team, other: Team): void {
  mover.o2 += other.o2;
  mover.ammo += other.ammo;
  mover.hp = Math.min(TEAM_MAX_HP, mover.hp + other.hp);
  if (state.carrying === other.id) state.carrying = actorId(mover);
  other.alive = false;
  other.o2 = 0;
  other.ammo = 0;
  state.joined = true;
  pushLog(
    state,
    `${mover.emoji}${other.emoji} Teams join. Supplies pooled. One party now.`,
  );
}

function detonateReactor(state: GameState, team: Team, tile: Tile): void {
  tile.revealed = true;
  state.bombDetonated = true;
  const wasCarrying = isCarrier(state, team) || (state.joined && state.carrying !== null);
  let survivorLost = false;
  const victims: Team[] = [];

  for (const n of neighbors(tile.hex)) {
    const adj = state.tiles[key(n)];
    if (!adj) continue;
    if (adj.content === "survivor") survivorLost = true;
    const who = occupantAt(state, key(n));
    if (who?.alive && who.id !== team.id) victims.push(who);
    if (adj.ship) continue;
    adj.revealed = true;
    adj.content = "blast";
    adj.alienHp = 0;
  }

  pushLog(
    state,
    `${team.emoji} ${team.name} triggered a leaking reactor. Adjacent tiles erupt ${FACE.blast}.`,
  );

  for (const victim of victims) {
    if (victim.alive) killTeam(state, victim, "was caught in the blast.", true);
  }
  if (team.alive) killTeam(state, team, "was vaporized by the core.", true);

  if (survivorLost && state.charlie.alive) {
    loseCharlie(state, `${FACE.reactor} The blast took Charlie. Rescue failed.`);
  }

  enterPause(state, {
    kind: "blast",
    triggerId: team.id === 1 ? 1 : 0,
    joined: state.joined,
    otherCaught: victims.length > 0,
    charlieHit: !state.charlie.alive,
    charlieOnRing: survivorLost,
    wasCarrying,
  });
}

function ackPause(state: GameState): GameState {
  if (state.phase !== "pause" || !state.pause) return state;
  const fatal = pauseIsFatal(state);
  state.pause = null;
  if (fatal) {
    state.phase = "lost";
    return state;
  }
  state.phase = "play";
  applyFog(state);
  passTurn(state);
  return state;
}

function applyLoot(state: GameState, team: Team, tile: Tile, label: string): void {
  if (tile.content === "oxygen") {
    team.o2 += 1;
    pushLog(state, `${label} found oxygen ${FACE.oxygen} (+1 O₂).`);
  } else if (tile.content === "ammo") {
    team.ammo += 1;
    pushLog(state, `${label} found ammo ${FACE.ammo} (+1).`);
  } else if (tile.content === "kit") {
    if (team.hp < team.maxHp) {
      team.hp += 1;
      pushLog(state, `${label} found ${FACE.kit} and recovered +1 life (${team.hp}).`);
    } else {
      pushLog(state, `${label} found ${FACE.kit} but life is already full.`);
    }
  }
}

function arrive(state: GameState, team: Team, tile: Tile, firstLook: boolean): void {
  team.hex = { ...tile.hex };
  const label = `${team.emoji} ${team.name}`;

  if (tile.content === "reactor") {
    detonateReactor(state, team, tile);
    return;
  }

  if (tileHasLiveAlien(tile)) {
    tile.revealed = true;
    state.phase = "combat";
    state.combatKey = key(tile.hex);
    team.hp -= 1;
    pushLog(state, `${FACE.alien} Ambush! It strikes first. ${label} −1 life.`);
    if (team.hp <= 0) {
      killTeam(state, team, "was torn apart.", false);
      return;
    }
    if (team.ammo <= 0) {
      killTeam(state, team, "had no ammo left to fight.", false);
    }
    return;
  }

  if (firstLook) tile.revealed = true;

  if (firstLook) applyLoot(state, team, tile, label);

  const foundCharlie = tile.content === "survivor";
  if (foundCharlie) {
    pickupCharlie(state, team, tile);
  } else if (firstLook && tile.ship) {
    pushLog(state, `${label} is at a dropship ${SHIP_FACE}.`);
  } else if (firstLook && tile.content === "blast") {
    pushLog(state, `${label} crosses scorched wreckage ${FACE.blast}.`);
  } else if (firstLook && tile.content === "empty" && !tile.ship) {
    pushLog(state, `${label} advances through empty wreckage.`);
  } else if (!firstLook && tile.content === "blast") {
    pushLog(state, `${label} crosses scorched wreckage ${FACE.blast}.`);
  } else if (!firstLook) {
    pushLog(state, `${label} crosses known wreckage.`);
  }

  settle(state, team);
  if (foundCharlie && state.phase === "play") {
    enterPause(state, {
      kind: "found",
      finderId: team.id === 1 ? 1 : 0,
      joined: state.joined,
    });
  }
}

function exploreOrMove(state: GameState, hexKey: string): GameState {
  if (state.phase !== "play") return state;
  if (!legalHexes(state).has(hexKey)) return state;
  const tile = state.tiles[hexKey];
  const team = actor(state);
  if (!tile || !team.alive) return state;

  const other = occupantAt(state, hexKey);
  if (other && other.id !== team.id && !state.joined) {
    mergeTeams(state, team, other);
    team.hex = { ...tile.hex };
    settle(state, team);
    if (state.phase === "play") passTurn(state);
    return state;
  }

  arrive(state, team, tile, !tile.revealed);
  if (state.phase === "play") passTurn(state);
  return state;
}

function doFire(state: GameState): GameState {
  if (state.phase !== "combat" || !state.combatKey) return state;
  const team = actor(state);
  const tile = state.tiles[state.combatKey];
  if (!team.alive || !tile || !tileHasLiveAlien(tile)) return state;
  if (team.ammo <= 0) {
    killTeam(state, team, "had no ammo left to fight.", false);
    applyFog(state);
    passTurn(state);
    return state;
  }
  team.ammo -= 1;
  tile.alienHp -= 1;
  if (tile.alienHp <= 0) {
    tile.content = "empty";
    tile.alienHp = 0;
    state.phase = "play";
    state.combatKey = null;
    pushLog(state, `${team.emoji} ${team.name} put the ${FACE.alien} down.`);
    settle(state, team);
    if (state.phase === "play") passTurn(state);
    return state;
  }
  pushLog(state, `${FACE.alien} Wounded. Still standing. Ammo left: ${team.ammo}.`);
  if (team.ammo <= 0) {
    killTeam(state, team, "emptied the clip and the alien finished them.", false);
    applyFog(state);
    passTurn(state);
  }
  return state;
}

export function applyAction(state: GameState, action: Action): GameState {
  const next = clone(state);
  switch (action.type) {
    case "explore":
    case "move":
      return exploreOrMove(next, action.key);
    case "fire":
      return doFire(next);
    case "ack-pause":
      return ackPause(next);
  }
}

export function startMatch(state: GameState): GameState {
  const next = clone(state);
  beginTurn(next);
  return next;
}
