import { useEffect, useState } from "react";

// Runs an async load whenever `key` changes. Returns undefined while the
// value for the current key is still loading.
export function useLoaded<T>(key: string, load: () => Promise<T>): T | undefined {
  const [state, setState] = useState<{ key: string; value: T } | null>(null);
  useEffect(() => {
    let live = true;
    load().then((value) => {
      if (live) setState({ key, value });
    });
    return () => {
      live = false;
    };
    // `load` is a closure over `key`; re-running on key alone is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state?.key === key ? state.value : undefined;
}
