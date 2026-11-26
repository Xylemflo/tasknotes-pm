export const APPROVED_PROJECT_COLORS = [
  "#AF1C0D",
  "#00B8A9",
  "#FFCA3A",
  "#7B61FF",
  "#2DC653",
  "#FF7A00",
  "#1982C4",
  "#F15BB5",
  "#96AFC9",
  "#A65F38",
] as const;

type Oklab = { l: number; a: number; b: number };

export function normalizeProjectColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : null;
}

/** Choose the unused approved color first, then maximize OKLab distance. */
export function nextDistinctProjectColor(usedValues: Iterable<string>): string {
  const used = [...usedValues]
    .map((value) => normalizeProjectColor(value))
    .filter((value): value is string => value !== null);
  const usedSet = new Set(used);
  const approved = APPROVED_PROJECT_COLORS.find((color) => !usedSet.has(color));
  if (approved) return approved;

  const candidates = generatedCandidates().filter((color) => !usedSet.has(color));
  if (!candidates.length) throw new Error("No distinct project colors remain available");
  return candidates.reduce((best, candidate) => {
    const candidateDistance = minimumPerceptualDistance(candidate, used);
    const bestDistance = minimumPerceptualDistance(best, used);
    return candidateDistance > bestDistance || (candidateDistance === bestDistance && candidate < best)
      ? candidate
      : best;
  });
}

export function buildDistinctProjectPalette(count: number): string[] {
  const colors: string[] = [];
  while (colors.length < count) colors.push(nextDistinctProjectColor(colors));
  return colors;
}

export function projectColorDistance(left: string, right: string): number {
  const a = hexToOklab(left);
  const b = hexToOklab(right);
  return Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b);
}

function minimumPerceptualDistance(candidate: string, used: string[]): number {
  if (!used.length) return Number.POSITIVE_INFINITY;
  return Math.min(...used.map((color) => projectColorDistance(candidate, color)));
}

let cachedCandidates: string[] | null = null;

function generatedCandidates(): string[] {
  if (cachedCandidates) return cachedCandidates;
  const candidates = new Set<string>();
  const lightnesses = [0.42, 0.50, 0.58, 0.66, 0.74, 0.82];
  const chromas = [0.04, 0.08, 0.12, 0.16, 0.20, 0.24];
  for (const lightness of lightnesses) {
    for (const chroma of chromas) {
      for (let hue = 0; hue < 360; hue += 15) {
        const color = oklchToHex(lightness, chroma, hue);
        if (color) candidates.add(color);
      }
    }
  }
  for (const approved of APPROVED_PROJECT_COLORS) candidates.delete(approved);
  cachedCandidates = [...candidates].sort();
  return cachedCandidates;
}

function hexToOklab(color: string): Oklab {
  const normalized = normalizeProjectColor(color);
  if (!normalized) throw new Error(`Invalid project color: ${color}`);
  const red = srgbToLinear(Number.parseInt(normalized.slice(1, 3), 16) / 255);
  const green = srgbToLinear(Number.parseInt(normalized.slice(3, 5), 16) / 255);
  const blue = srgbToLinear(Number.parseInt(normalized.slice(5, 7), 16) / 255);
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function oklchToHex(lightness: number, chroma: number, hue: number): string | null {
  const radians = hue * Math.PI / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const lRoot = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lRoot ** 3;
  const m = mRoot ** 3;
  const s = sRoot ** 3;
  const channels = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  if (channels.some((channel) => channel < 0 || channel > 1)) return null;
  return `#${channels.map((channel) => Math.round(linearToSrgb(channel) * 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number): number {
  return channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
}
