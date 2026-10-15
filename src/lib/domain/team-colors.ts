import { FALLBACK_TEAM_COLORS, TEAM_COLOR_TABLE } from "./team-color-table";

// team number to "#rrggbb"
export type TeamColorOverrides = Readonly<Record<string, string>>;

const BOARD_BACKGROUND = "#0d0d0d";
const MIN_BOARD_CONTRAST = 3;
const lightened = new Map<string, string>();

export function resolveTeamColor(team: string, overrides: TeamColorOverrides = {}, autoLighten = false): string {
  const number = Number.parseInt(team.trim(), 10);
  const key = Number.isFinite(number) ? String(number) : team.trim();
  const override = overrides[key];
  if (override !== undefined) return override;
  const color = TEAM_COLOR_TABLE[number] ?? FALLBACK_TEAM_COLORS[Math.abs(number || 0) % FALLBACK_TEAM_COLORS.length];
  return autoLighten ? lightenForBoard(color) : color;
}

// raises only the hsl lightness so hue and saturation survive - black and greys become a readable grey
function lightenForBoard(color: string): string {
  const cached = lightened.get(color);
  if (cached) return cached;
  let result = color;
  if (boardContrast(color) < MIN_BOARD_CONTRAST) {
    const [hue, saturation, lightness] = toHsl(color);
    let low = lightness;
    let high = 1;
    for (let step = 0; step < 16; step++) {
      const middle = (low + high) / 2;
      if (boardContrast(fromHsl(hue, saturation, middle)) >= MIN_BOARD_CONTRAST) high = middle;
      else low = middle;
    }
    result = fromHsl(hue, saturation, high);
  }
  lightened.set(color, result);
  return result;
}

function boardContrast(color: string): number {
  return (relativeLuminance(color) + 0.05) / (relativeLuminance(BOARD_BACKGROUND) + 0.05);
}

function relativeLuminance(color: string): number {
  const [red, green, blue] = channels(color).map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function channels(color: string): [number, number, number] {
  return [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16) / 255) as [number, number, number];
}

function toHsl(color: string): [number, number, number] {
  const [red, green, blue] = channels(color);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return [0, 0, lightness];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const sector = max === red ? ((green - blue) / delta) % 6 : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  return [(sector * 60 + 360) % 360, saturation, lightness];
}

function fromHsl(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const [red, green, blue] =
    hue < 60 ? [chroma, second, 0] : hue < 120 ? [second, chroma, 0] : hue < 180 ? [0, chroma, second] : hue < 240 ? [0, second, chroma] : hue < 300 ? [second, 0, chroma] : [chroma, 0, second];
  const offset = lightness - chroma / 2;
  return `#${[red, green, blue].map((channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, "0")).join("")}`;
}
