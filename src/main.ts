import { generateMatch } from "./generate";
import { bind, render } from "./render";
import { applyAction, startMatch } from "./rules";
import type { GameState } from "./types";
import "./style.css";

function requireApp(): HTMLDivElement {
  const el = document.querySelector<HTMLDivElement>("#app");
  if (!el) throw new Error("#app missing");
  return el;
}

const root = requireApp();

let state: GameState = startMatch(generateMatch());

function paint(): void {
  render(root, state);
}

function play(next: GameState): void {
  state = next;
  paint();
}

bind(root, {
  onHex: (hexKey) => {
    play(applyAction(state, { type: "explore", key: hexKey }));
  },
  onFire: () => play(applyAction(state, { type: "fire" })),
  onAckPause: () => play(applyAction(state, { type: "ack-pause" })),
  onNewGame: () => play(startMatch(generateMatch())),
});

paint();
