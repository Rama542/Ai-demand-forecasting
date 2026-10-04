"use client";

import * as React from "react";
import { Button, EmptyState, Skeleton } from "@/components/ui";

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Runs a fetcher and exposes real data, a real error, or a loading flag.
 * It never invents a fallback value, so consumers must handle `data === null`.
 */
export function useAsync<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: React.DependencyList,
  options: { enabled?: boolean } = {},
): AsyncState<T> {
  const enabled = options.enabled ?? true;
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(enabled);
  const [nonce, setNonce] = React.useState(0);

  const fetcherRef = React.useRef(fetcher);
  fetcherRef.current = fetcher;

  React.useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError(null);

    fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (!active) return;
        setData(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!active || controller.signal.aborted) return;
        setData(null);
        setError(cause instanceof Error ? cause.message : "Request failed.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled]);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, loading, reload };
}

/**
 * Imperative action state for forms: run, guard against double submits, and
 * surface a failure message instead of throwing into the void.
 */
export function useAction<A extends unknown[], R>(
  action: (...args: A) => Promise<R>,
): {
  run: (...args: A) => Promise<R | null>;
  pending: boolean;
  error: string | null;
  clearError: () => void;
} {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const mounted = React.useRef(true);
  const actionRef = React.useRef(action);
  actionRef.current = action;

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = React.useCallback(async (...args: A) => {
    setPending(true);
    setError(null);
    try {
      const result = await actionRef.current(...args);
      return result;
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : "Request failed.");
      }
      return null;
    } finally {
      if (mounted.current) setPending(false);
    }
  }, []);

  const clearError = React.useCallback(() => setError(null), []);

  return { run, pending, error, clearError };
}

/** Debounced mirror of a rapidly changing value (search inputs). */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Persist a value in localStorage without breaking SSR. */
export function useLocalStorage<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = React.useState<T>(initial);

  React.useEffect(() => {
    const stored = window.localStorage.getItem(key);
    if (stored === null) return;
    try {
      setValue(JSON.parse(stored) as T);
    } catch {
      /* ignore malformed storage */
    }
  }, [key]);

  const update = React.useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
    },
    [key],
  );

  return [value, update];
}

export interface ResourceProps {
  loading: boolean;
  error: string | null;
  isEmpty?: boolean;
  onRetry?: () => void;
  skeleton?: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: React.ComponentProps<typeof EmptyState>["icon"];
  children: React.ReactNode;
}

/** The single place that decides between loading, error, empty, and content. */
export function AsyncBoundary({
  loading,
  error,
  isEmpty = false,
  onRetry,
  skeleton,
  emptyTitle = "No data yet",
  emptyDescription = "There is nothing to show for this selection.",
  emptyIcon,
  children,
}: ResourceProps) {
  if (loading) return <>{skeleton ?? <Skeleton width="100%" height={180} />}</>;
  if (error) {
    return (
      <EmptyState
        title="Could not load this"
        description={error}
        icon="alert"
        action={
          onRetry ? (
            <Button variant="secondary" icon="refresh" onClick={onRetry}>
              Try again
            </Button>
          ) : null
        }
      />
    );
  }
  if (isEmpty) {
    return <EmptyState title={emptyTitle} description={emptyDescription} icon={emptyIcon} />;
  }
  return <>{children}</>;
}