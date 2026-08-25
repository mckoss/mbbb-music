/**
 * Track mounted owners of a shared resource. Empty notification is deferred by
 * one task so a route transition can unmount one owner and mount its successor
 * without interrupting the resource between them.
 */
export function createPresenceGroup(onEmpty: () => void) {
  let count = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;

  return function mount(): () => void {
    count++;
    if (pending != null) {
      clearTimeout(pending);
      pending = null;
    }

    let mounted = true;
    return () => {
      if (!mounted) return;
      mounted = false;
      count--;
      if (count !== 0) return;

      pending = setTimeout(() => {
        pending = null;
        if (count === 0) onEmpty();
      }, 0);
    };
  };
}
