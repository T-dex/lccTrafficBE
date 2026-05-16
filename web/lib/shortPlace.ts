export function shortPlaceLabel(displayLabel: string): string {
  if (!displayLabel) return displayLabel;
  const parts = displayLabel.split(",").map((s) => s.trim());
  let a = parts[0] || "";
  const b = parts[1] || "";
  a = a.replace(/\b(South|North|East|West)\b/gi, (m) => m[0].toUpperCase() + ".");
  if (b) return `${a}, ${b}`;
  return a;
}
