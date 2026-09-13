import type { Hex } from "./hex";

export const HIVE_RADIUS = 3;
export const TEAM_MAX_HP = 3;
export const ALIEN_HP = 1;
export const START_O2 = 12;
export const START_AMMO = 2;
export const CHARLIE_START_O2 = START_O2 + 2;
export const CHARLIE_START_AMMO = 2;

export type TileContent =
  | "empty"
  | "alien"
  | "oxygen"
  | "ammo"
  | "kit"
  | "reactor"
  | "survivor"
  | "blast";

export type RadarSignal = "survivor" | "danger";

export type Tile = {
  hex: Hex;
  content: TileContent;
  revealed: boolean;
  alienHp: number;
  ship: boolean;
  grave: boolean;
};

export type TeamId = 0 | 1 | 2;

export type Team = {
  id: TeamId;
  name: string;
  emoji: string;
  hp: number;
  maxHp: number;
  o2: number;
  ammo: number;
  hex: Hex;
  alive: boolean;
};

export type Phase = "play" | "combat" | "won" | "lost" | "pause";

export type PauseInfo =
  | {
      kind: "blast";
      triggerId: 0 | 1;
      joined: boolean;
      otherCaught: boolean;
      charlieHit: boolean;
      charlieOnRing: boolean;
      wasCarrying: boolean;
    }
  | {
      kind: "oxygen";
      victimId: 0 | 1;
      joined: boolean;
      charlieDropped: boolean;
    }
  | {
      kind: "charlie-o2";
    }
  | {
      kind: "found";
      finderId: 0 | 1;
      joined: boolean;
    };

export type GameState = {
  tiles: Record<string, Tile>;
  teams: [Team, Team];
  charlie: Team;
  joined: boolean;
  active: 0 | 1;
  phase: Phase;
  combatKey: string | null;
  log: string[];
  signals: RadarSignal[];
  notice: string;
  carrying: 0 | 1 | null;
  bombDetonated: boolean;
  pause: PauseInfo | null;
  actedThisRound: number[];
};

export type Action =
  | { type: "explore"; key: string }
  | { type: "move"; key: string }
  | { type: "fire" }
  | { type: "ack-pause" };

export const FACE: Record<TileContent, string> = {
  empty: "",
  alien: "👽",
  oxygen: "🫧",
  ammo: "🔫",
  kit: "❤️",
  reactor: "☢️",
  survivor: "🧑‍🚀",
  blast: "🔥",
};

export const TEAM_FACE: [string, string] = ["👨‍🚀", "👩‍🚀"];
export const CHARLIE_FACE = "🧑‍🚀";
export const SHIP_FACE = "🚀";
export const GRAVE_FACE = "☠️";
export const BLAST_BANNER = "🔥🔥☢️🔥🔥";
export const OXYGEN_BANNER = "🫧☠️🫧";
export const CHARLIE_O2_BANNER = "🧑‍🚀🫧☠️";
export const FOUND_BANNER = "🧑‍🚀🚀";
