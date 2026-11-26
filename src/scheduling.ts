export type OrdinaryCompletionInput = {
  currentCompletionMs: number | null;
  desiredCompletionMs: number | null;
  activeChildCount: number;
  hasUnresolvedActiveChild: boolean;
};

/**
 * Active, fully scheduled children control an exact parent rollup and may move
 * it in either direction. Without an active child, or while any active child
 * is unresolved, known constraints may extend the parent but never compress it.
 */
export function resolveOrdinaryCompletion(input: OrdinaryCompletionInput): number | null {
  const { currentCompletionMs, desiredCompletionMs, activeChildCount, hasUnresolvedActiveChild } = input;
  if (activeChildCount > 0 && !hasUnresolvedActiveChild && desiredCompletionMs !== null) {
    return desiredCompletionMs;
  }
  if (desiredCompletionMs === null) return currentCompletionMs;
  return currentCompletionMs === null
    ? desiredCompletionMs
    : Math.max(currentCompletionMs, desiredCompletionMs);
}
