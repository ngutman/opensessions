export function resolveSyncedFocus(
  nextFocusedSession: string | null,
  nextCurrentSession: string | null,
  localSessionName: string | null,
): string | null {
  if (localSessionName && nextCurrentSession && nextCurrentSession !== localSessionName) {
    return localSessionName;
  }

  return nextFocusedSession ?? localSessionName;
}
