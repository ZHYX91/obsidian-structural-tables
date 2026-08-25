export function moveSettingsTabIndex(
  currentIndex: number,
  key: string,
  count: number,
  direction: "ltr" | "rtl",
): number | null {
  if (count <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const forwardKey = direction === "rtl" ? "ArrowLeft" : "ArrowRight";
  const backwardKey = direction === "rtl" ? "ArrowRight" : "ArrowLeft";
  if (key === forwardKey) return (currentIndex + 1) % count;
  if (key === backwardKey) return (currentIndex - 1 + count) % count;
  return null;
}
