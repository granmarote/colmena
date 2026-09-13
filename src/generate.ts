import { distance, eq, hive, key, ring, type Hex } from "./hex";
import {
  ALIEN_HP,
  CHARLIE_FACE,
  FACE,
  HIVE_RADIUS,
  SHIP_FACE,
  CHARLIE_START_AMMO,
  CHARLIE_START_O2,
  START_AMMO,
  START_O2,
  TEAM_FACE,
  TEAM_MAX_HP,
  type GameState,
  type Team,
  type Tile,
  type TileContent,
} from "./types";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickSpawns(outer: Hex[], rng: () => number): [Hex, Hex] {
  const shuffled = shuffle(outer, rng);
  for (let i = 0; i < shuffled.length; i++) {
    for (let j = i + 1; j < shuffled.length; j++) {
      if (distance(shuffled[i], shuffled[j]) > 1) {
        return [shuffled[i], shuffled[j]];
      }
    }
  }
  throw new Error("Could not place non-adjacent spawns");
}

function makeCharlie(hex: Hex): Team {
  return {
    id: 2,
    name: "Charlie",
    emoji: CHARLIE_FACE,
    hp: 1,
    maxHp: 1,
    o2: CHARLIE_START_O2,
    ammo: CHARLIE_START_AMMO,
    hex,
    alive: true,
  };
}

function makeTeam(id: 0 | 1, spawn: Hex): Team {
  return {
    id,
    name: id === 0 ? "Alpha" : "Bravo",
    emoji: TEAM_FACE[id],
    hp: TEAM_MAX_HP,
    maxHp: TEAM_MAX_HP,
    o2: START_O2,
    ammo: START_AMMO,
    hex: spawn,
    alive: true,
  };
}

function fillLoot(slots: number, rng: () => number): TileContent[] {
  const aliens = rng() < 0.5 ? 7 : 8;
  const bag: TileContent[] = [];
  for (let i = 0; i < aliens; i++) bag.push("alien");
  for (let i = 0; i < 4; i++) bag.push("oxygen");
  for (let i = 0; i < 6; i++) bag.push("ammo");
  bag.push("kit", "kit", "reactor", "survivor");
  while (bag.length < slots) bag.push("empty");
  return bag;
}

export function generateMatch(seed = Date.now()): GameState {
  const rng = mulberry32(seed);
  const cells = hive(HIVE_RADIUS);
  const [spawnA, spawnB] = pickSpawns(ring(HIVE_RADIUS), rng);
  const lootHexes = shuffle(
    cells.filter((h) => !eq(h, spawnA) && !eq(h, spawnB)),
    rng,
  );
  const loot = shuffle(fillLoot(lootHexes.length, rng), rng);

  const tiles: Record<string, Tile> = {};
  for (const h of cells) {
    tiles[key(h)] = {
      hex: h,
      content: "empty",
      revealed: eq(h, spawnA) || eq(h, spawnB),
      alienHp: 0,
      ship: eq(h, spawnA) || eq(h, spawnB),
      grave: false,
    };
  }
  for (let i = 0; i < lootHexes.length; i++) {
    const content = loot[i] ?? "empty";
    const h = lootHexes[i];
    tiles[key(h)] = {
      hex: h,
      content,
      revealed: false,
      alienHp: content === "alien" ? ALIEN_HP : 0,
      ship: false,
      grave: false,
    };
  }

  const teams: [Team, Team] = [makeTeam(0, spawnA), makeTeam(1, spawnB)];
  const survivorTile = Object.values(tiles).find((t) => t.content === "survivor");
  if (!survivorTile) throw new Error("Survivor missing from hive");

  return {
    tiles,
    teams,
    charlie: makeCharlie(survivorTile.hex),
    joined: false,
    active: 0,
    phase: "play",
    combatKey: null,
    log: [
      "Hive-ship down. Two dropships on the outer hull.",
      `${FACE.survivor} Find Charlie and get back to a ${SHIP_FACE}.`,
    ],
    signals: [],
    notice: "",
    carrying: null,
    bombDetonated: false,
    pause: null,
    actedThisRound: [],
  };
}
