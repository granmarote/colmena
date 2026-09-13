export type Hex = { q: number; r: number };

export const HEX_DIRS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function key(h: Hex): string {
  return `${h.q},${h.r}`;
}

export function parseKey(k: string): Hex {
  const [q, r] = k.split(",").map(Number);
  return { q, r };
}

export function eq(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

export function add(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function neighbors(h: Hex): Hex[] {
  return HEX_DIRS.map((d) => add(h, d));
}

export function distance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

export function hive(radius: number): Hex[] {
  const cells: Hex[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      const h = { q, r };
      if (distance(h, { q: 0, r: 0 }) <= radius) cells.push(h);
    }
  }
  return cells;
}

export function ring(radius: number): Hex[] {
  return hive(radius).filter((h) => distance(h, { q: 0, r: 0 }) === radius);
}

/** Pointy-top pixel center. */
export function toPixel(h: Hex, size: number): { x: number; y: number } {
  return {
    x: size * Math.sqrt(3) * (h.q + h.r / 2),
    y: size * (3 / 2) * h.r,
  };
}

export function hexPolygon(cx: number, cy: number, size: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${cx + size * Math.cos(a)},${cy + size * Math.sin(a)}`);
  }
  return pts.join(" ");
}
