import { hexPolygon, key, toPixel } from "./hex";
import { pauseIsFatal, computeSignals, legalHexes, occupantAt } from "./rules";
import {
  ALIEN_HP,
  BLAST_BANNER,
  CHARLIE_O2_BANNER,
  FOUND_BANNER,
  FACE,
  SHIP_FACE,
  TEAM_FACE,
  CHARLIE_FACE,
  GRAVE_FACE,
  OXYGEN_BANNER,
  type GameState,
  type PauseInfo,
  type Team,
  type Tile,
} from "./types";

const HEX_SIZE = 44;
const HEX_INSET = 40;

export type RenderHandlers = {
  onHex: (hexKey: string) => void;
  onFire: () => void;
  onAckPause: () => void;
  onNewGame: () => void;
};

function hpBar(team: Team): string {
  const filled = "●".repeat(team.hp);
  const empty = "○".repeat(Math.max(0, team.maxHp - team.hp));
  return `<span class="hp">${filled}${empty}</span>`;
}

function partyTitle(members: Team[]): string {
  return members.map((m) => `${m.emoji} ${m.name}`).join(" & ");
}

function partyStatus(state: GameState, members: Team[], lead: Team): string {
  if (members.length === 1 && members[0].id === 2) {
    if (!state.charlie.alive) return "Down";
    if (state.phase === "won") return "Extracted";
    return "Missing";
  }
  if (!lead.alive) return "Down";
  if (state.phase === "won") return "Extracted";
  const active =
    state.phase !== "lost" &&
    (state.active === lead.id || (state.joined && lead.alive));
  if (active && state.phase === "combat") return "Fighting";
  if (active && state.phase === "play") return "Playing";
  return "Waiting";
}

function partyCard(state: GameState, members: Team[], lead: Team): string {
  const span = Math.min(3, Math.max(1, members.length));
  const isActive =
    lead.id !== 2 &&
    lead.alive &&
    state.phase !== "won" &&
    state.phase !== "lost" &&
    state.phase !== "pause" &&
    (state.active === lead.id || (state.joined && lead.alive));
  const classes = [
    "team-card",
    `span-${span}`,
    isActive ? "active" : "",
    members[0].id === 2 ? (lead.alive ? "" : "dead") : lead.alive ? "" : "dead",
    members.some((m) => m.id === 2) ? "survivor-card" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const o2 = lead.id === 2 || lead.alive ? lead.o2 : "—";
  const ammo = lead.id === 2 || lead.alive ? lead.ammo : "—";
  return `
    <article class="${classes}">
      <header>
        <h2>${partyTitle(members)}</h2>
        <span class="status">${partyStatus(state, members, lead)}</span>
      </header>
      <dl>
        <div><dt>Life</dt><dd>${hpBar(lead)}</dd></div>
        <div><dt>O₂</dt><dd>${o2}</dd></div>
        <div><dt>Ammo</dt><dd>${ammo}</dd></div>
      </dl>
    </article>
  `;
}

function hud(state: GameState): string {
  const [alpha, bravo] = state.teams;
  const charlie = state.charlie;
  const charlieAlive = charlie.alive;
  const withAlpha = state.carrying === 0 && charlieAlive;
  const withBravo = state.carrying === 1 && charlieAlive;
  const cards: string[] = [];

  if (state.joined) {
    const lead = state.teams.find((t) => t.alive) ?? alpha;
    const members = [alpha, bravo];
    if ((withAlpha || withBravo) && charlieAlive) members.push(charlie);
    cards.push(partyCard(state, members, lead));
    if (!withAlpha && !withBravo) cards.push(partyCard(state, [charlie], charlie));
  } else {
    cards.push(
      partyCard(state, withAlpha ? [alpha, charlie] : [alpha], alpha),
    );
    cards.push(
      partyCard(state, withBravo ? [bravo, charlie] : [bravo], bravo),
    );
    if (!withAlpha && !withBravo) cards.push(partyCard(state, [charlie], charlie));
  }

  return `<div class="hud">${cards.join("")}</div>`;
}

function tileFace(tile: Tile): string {
  if (tile.ship) return SHIP_FACE;
  if (tile.grave && (!tile.revealed || tile.content === "empty")) return GRAVE_FACE;
  if (!tile.revealed) return "";
  if (tile.content === "empty") return "";
  return FACE[tile.content];
}

function peopleOn(state: GameState, hexKey: string): string[] {
  const people: string[] = [];
  if (
    state.carrying !== null &&
    state.charlie.alive &&
    key(state.charlie.hex) === hexKey
  ) {
    people.push(CHARLIE_FACE);
  }
  if (state.joined) {
    const lead = state.teams.find((t) => t.alive);
    if (lead && key(lead.hex) === hexKey) people.push(TEAM_FACE[0], TEAM_FACE[1]);
  } else {
    const who = occupantAt(state, hexKey);
    if (who) people.push(who.emoji);
  }
  return people;
}

function tileGlyphs(state: GameState, tile: Tile): string[] {
  const hexKey = key(tile.hex);
  const face = tileFace(tile);
  const people = peopleOn(state, hexKey);
  const glyphs: string[] = [];
  if (face) glyphs.push(face);
  glyphs.push(...people);
  if (tile.grave && !glyphs.includes(GRAVE_FACE)) glyphs.push(GRAVE_FACE);
  return glyphs;
}

function glyphRows(glyphs: string[]): string[][] {
  const n = glyphs.length;
  if (n <= 2) return [glyphs];
  if (n === 3) return [[glyphs[0]], glyphs.slice(1)];
  const top = Math.ceil(n / 2);
  return [glyphs.slice(0, top), glyphs.slice(top)];
}

function renderGlyphs(glyphs: string[], x: number, y: number): string {
  if (glyphs.length === 0) return "";
  const rows = glyphRows(glyphs);
  const cls = glyphs.length <= 1 ? "solo" : glyphs.length === 2 ? "pair" : "stack";
  const gapX = glyphs.length >= 3 ? 12 : 18;
  const gapY = 14;
  const y0 = y + 2 - ((rows.length - 1) * gapY) / 2;
  return rows
    .map((row, ri) => {
      const x0 = x - ((row.length - 1) * gapX) / 2;
      const rowY = y0 + ri * gapY;
      return row
        .map(
          (g, i) =>
            `<text class="${cls}" x="${x0 + i * gapX}" y="${rowY}" text-anchor="middle" dominant-baseline="middle">${g}</text>`,
        )
        .join("");
    })
    .join("");
}

function board(state: GameState): string {
  const tiles = Object.values(state.tiles);
  const pts = tiles.map((t) => toPixel(t.hex, HEX_SIZE));
  const minX = Math.min(...pts.map((p) => p.x)) - HEX_SIZE;
  const maxX = Math.max(...pts.map((p) => p.x)) + HEX_SIZE;
  const minY = Math.min(...pts.map((p) => p.y)) - HEX_SIZE;
  const maxY = Math.max(...pts.map((p) => p.y)) + HEX_SIZE;
  const legal = legalHexes(state);
  const actorKey = state.teams[state.active].alive ? key(state.teams[state.active].hex) : "";

  const hexes = tiles
    .map((tile) => {
      const { x, y } = toPixel(tile.hex, HEX_SIZE);
      const k = key(tile.hex);
      const isLegal = legal.has(k);
      const isHere = k === actorKey;
      const who = occupantAt(state, k);
      const ping = who ? computeSignals(state, who) : [];
      const pingClass = ping.length ? `radar radar-${ping.join("-")}` : "";
      const classes = [
        "hex",
        tile.revealed ? "revealed" : "hidden",
        isLegal ? "legal" : "",
        pingClass,
        isHere ? "here" : "",
        tile.ship ? "ship" : "",
        tile.grave ? "grave" : "",
        tile.content === "reactor" && tile.revealed ? "reactor" : "",
        tile.content === "blast" ? "blast" : "",
        tileHasCombat(state, k) ? "combat-hex" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const glyphs = renderGlyphs(tileGlyphs(state, tile), x, y);
      const ring = ping.length
        ? `<polygon class="radar-ring" points="${hexPolygon(x, y, HEX_INSET + 5)}" />`
        : "";
      return `
        <g class="${classes}" data-hex="${k}" role="button" tabindex="0">
          <polygon points="${hexPolygon(x, y, HEX_INSET)}" />
          ${ring}
          ${glyphs}
        </g>
      `;
    })
    .join("");

  return `
    <svg class="hive" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" role="img" aria-label="Hive wreckage">
      ${hexes}
    </svg>
  `;
}

function tileHasCombat(state: GameState, hexKey: string): boolean {
  return state.phase === "combat" && state.combatKey === hexKey;
}

function blastLines(state: GameState, info: Extract<PauseInfo, { kind: "blast" }>): string[] {
  const trigger = state.teams[info.triggerId];
  const other = state.teams[info.triggerId === 0 ? 1 : 0];
  const fatal = pauseIsFatal(state);
  const lines = [
    "A leaking reactor went critical. Adjacent wreckage is on fire and stays mapped.",
  ];
  if (info.joined) {
    lines.push("The joined party was standing on the core. The blast took everyone in it.");
  } else if (info.otherCaught) {
    lines.push(
      `${trigger.emoji} ${trigger.name} triggered it, and the fire also caught ${other.emoji} ${other.name}. Both teams are gone.`,
    );
  } else if (fatal && !info.charlieHit) {
    lines.push(`${trigger.emoji} ${trigger.name} was vaporized by the core. No one is left to finish the rescue.`);
  } else {
    lines.push(
      `${trigger.emoji} ${trigger.name} was vaporized by the core.${fatal ? "" : ` ${other.emoji} ${other.name} can still search — stay off the fire.`}`,
    );
  }

  if (info.charlieHit) {
    if (info.wasCarrying) {
      lines.push("Charlie was with them on the core and was lost in the blast. Rescue failed.");
    } else if (info.charlieOnRing) {
      lines.push("The fire reached Charlie on an adjacent tile. The survivor is gone. Rescue failed.");
    } else {
      lines.push("Charlie was caught in the blast. The survivor is gone. Rescue failed.");
    }
  } else if (fatal) {
    lines.push("Charlie was not in the blast, but no one is left to bring them home.");
  } else {
    lines.push("Charlie was not in the blast. The survivor is still out there.");
  }
  return lines;
}

function oxygenLines(state: GameState, info: Extract<PauseInfo, { kind: "oxygen" }>): string[] {
  const fatal = pauseIsFatal(state);
  const victim = state.teams[info.victimId];
  const other = state.teams[info.victimId === 0 ? 1 : 0];
  const lines = [`${victim.emoji} ${victim.name} ran out of oxygen and is gone.`];
  if (info.joined) {
    lines.push("The joined party shared one air supply. Everyone in it is down.");
    if (info.charlieDropped) {
      lines.push("Charlie was with them and is now stranded. No one is left to finish the rescue.");
    } else {
      lines.push("No one is left to bring Charlie home. The rescue is over.");
    }
  } else if (fatal) {
    if (info.charlieDropped) {
      lines.push("Charlie is down on the wreck, but no one is left to carry them to a ship.");
    } else {
      lines.push("No one is left. The rescue is over.");
    }
  } else if (info.charlieDropped) {
    lines.push(
      `Charlie is down on that hex. ${other.emoji} ${other.name} can still pick them up and get to either ${SHIP_FACE}.`,
    );
  } else {
    lines.push(`${other.emoji} ${other.name} can still search — watch the O₂.`);
  }
  return lines;
}

function charlieO2Lines(): string[] {
  return [
    "Charlie ran out of oxygen while waiting in the wreck.",
    "The survivor is gone. Rescue failed.",
  ];
}

function foundLines(state: GameState, info: Extract<PauseInfo, { kind: "found" }>): string[] {
  const finder = state.teams[info.finderId];
  const who = info.joined ? "The party" : `${finder.emoji} ${finder.name}`;
  return [
    `${who} found Charlie. Finding the survivor is not the rescue yet.`,
    `Take Charlie to either dropship ${SHIP_FACE} on the outer hull. Alpha can use Bravo’s rocket, Bravo can use Alpha’s — any party, any ship.`,
  ];
}

function pauseOverlay(state: GameState): string {
  const info = state.pause;
  if (!info) return "";
  const fatal = pauseIsFatal(state);
  let kicker = "Signal";
  let banner = FOUND_BANNER;
  let variant = "found";
  let lines: string[] = [];
  if (info.kind === "blast") {
    kicker = "Core breach";
    banner = BLAST_BANNER;
    variant = "blast";
    lines = blastLines(state, info);
  } else if (info.kind === "oxygen") {
    kicker = "No air";
    banner = OXYGEN_BANNER;
    variant = "oxygen";
    lines = oxygenLines(state, info);
  } else if (info.kind === "charlie-o2") {
    kicker = "Survivor lost";
    banner = CHARLIE_O2_BANNER;
    variant = "oxygen charlie-o2";
    lines = charlieO2Lines();
  } else {
    kicker = "Survivor found";
    banner = FOUND_BANNER;
    variant = "found";
    lines = foundLines(state, info);
  }
  const action = fatal
    ? `<button type="button" data-act="new">New wreck</button>`
    : `<button type="button" data-act="ack-pause">Continue</button>`;
  return `
    <div class="overlay ${variant}">
      <p class="kicker">${kicker}</p>
      <h2 class="blast-mark">${banner}</h2>
      ${lines.map((line) => `<p>${line}</p>`).join("")}
      <div class="actions">${action}</div>
    </div>
  `;
}

function overlay(state: GameState): string {
  if (state.phase === "pause") return pauseOverlay(state);
  if (state.phase === "combat") {
    const team = state.teams[state.active];
    const tile = state.combatKey ? state.tiles[state.combatKey] : undefined;
    const alienHp = tile?.alienHp ?? 0;
    const fireDisabled = team.ammo <= 0 ? "disabled" : "";
    return `
      <div class="overlay combat">
        <p class="kicker">Contact</p>
        <h2>${FACE.alien} Alien attack</h2>
        <p>It already hit. Alien life ${"●".repeat(alienHp)}${"○".repeat(Math.max(0, ALIEN_HP - alienHp))} · your ammo ${team.ammo}</p>
        <div class="actions">
          <button type="button" data-act="fire" ${fireDisabled}>Fire ${FACE.ammo}</button>
        </div>
      </div>
    `;
  }
  if (state.phase === "won") {
    return `
      <div class="overlay win">
        <p class="kicker">Signal locked</p>
        <h2>${SHIP_FACE} ${FACE.survivor} Charlie is home</h2>
        <p>You got them back to a dropship. The wreck didn't keep everyone.</p>
        <button type="button" data-act="new">New wreck</button>
      </div>
    `;
  }
  if (state.phase === "lost") {
    const survivorGone = state.notice.includes("took the survivor");
    return `
      <div class="overlay lose">
        <p class="kicker">No reply</p>
        <h2>${survivorGone ? `${FACE.survivor} Lost in the fire` : "Both teams are gone"}</h2>
        <p>${survivorGone ? "The blast reached the survivor. The wreck keeps its dead." : "The wreckage keeps its dead. Try another drop."}</p>
        <button type="button" data-act="new">New wreck</button>
      </div>
    `;
  }
  return "";
}

export function render(root: HTMLElement, state: GameState): void {
  root.innerHTML = `
    <header class="top">
      <div class="brand">
        <p class="kicker">Crash site</p>
        <h1>COLMENA</h1>
      </div>
      <button type="button" data-act="new" class="ghost">New wreck</button>
      <p class="lede">A hive-ship went down. Two rescue teams. One missing survivor. Aliens in the dark. An unstable nuclear reactor... and little O2 left... <span class="lede-out">Good luck<span class="cursor" aria-hidden="true" style="animation-delay: -${Date.now() % 1100}ms"></span></span></p>
    </header>
    ${hud(state)}
    <div class="board-wrap">
      ${board(state)}
      ${overlay(state)}
    </div>
    <ol class="log">${state.log.map((line) => `<li>${line}</li>`).join("")}</ol>
  `;
}

export function bind(root: HTMLElement, handlers: RenderHandlers): void {
  root.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    if (!target) return;
    const hex = target.closest<SVGGElement>("[data-hex]");
    if (hex?.dataset.hex) {
      handlers.onHex(hex.dataset.hex);
      return;
    }
    const btn = target.closest<HTMLButtonElement>("[data-act]");
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === "fire") handlers.onFire();
    if (act === "ack-pause") handlers.onAckPause();
    if (act === "new") handlers.onNewGame();
  });
}
