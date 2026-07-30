// smooth — majority vote / debounce over a short window of recent predictions
// so the on-screen label is stable, a single stray frame doesn't flip it, and
// no-hand frames (null) don't blank it. Ties break toward the most recent label.

export function smooth(recent: readonly (string | null)[]): string | null {
  const counts = new Map<string, number>();
  const lastSeen = new Map<string, number>();

  recent.forEach((label, i) => {
    if (label === null) return;
    counts.set(label, (counts.get(label) ?? 0) + 1);
    lastSeen.set(label, i);
  });

  if (counts.size === 0) return null;

  const maxCount = Math.max(...counts.values());
  let winner: string | null = null;
  let winnerRecency = -1;
  for (const [label, count] of counts) {
    if (count === maxCount && lastSeen.get(label)! > winnerRecency) {
      winner = label;
      winnerRecency = lastSeen.get(label)!;
    }
  }
  return winner;
}
