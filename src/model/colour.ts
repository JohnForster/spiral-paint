export const DEFAULT_COLOUR = "#ffffff";

/** Normalises "#rgb" / "#rrggbb" (any case) to lowercase "#rrggbb"; null if invalid. */
export function normaliseColour(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const hex = m[1]!.toLowerCase();
  return hex.length === 3 ? `#${[...hex].map((c) => c + c).join("")}` : `#${hex}`;
}
