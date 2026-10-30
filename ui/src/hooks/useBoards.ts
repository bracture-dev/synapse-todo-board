import { useCallback, useEffect, useRef, useState } from "react";
import { useApp, useDataSync } from "@nimblebrain/synapse/react";

export interface BoardColumn {
  key: string;
  label: string;
  color?: string;
  wip_limit?: number;
}

export interface Board {
  id: string;
  name: string;
  description?: string;
  columns: BoardColumn[];
  default_column?: string;
  status: string;
  created_at: string;
  updated_at: string;
  task_count?: number;
}

/**
 * Fetches all boards via the list_boards tool.
 * Refreshes automatically on board entity changes.
 */
export function useBoards() {
  const app = useApp();
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const callId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++callId.current;
    setError(null);
    try {
      const result = await app.callTool<Board[] | { entities: Board[] }>(
        "list_boards",
      );
      // Stale guard: only apply if this is still the latest call
      if (id !== callId.current) return;
      if (result.isError) {
        setError(String(result.data));
        return;
      }
      // Upjack list/query tools wrap results in { entities: [...], count: N }
      const data = result.data;
      const entities = Array.isArray(data)
        ? data
        : Array.isArray((data as Record<string, unknown>)?.entities)
          ? ((data as Record<string, unknown>).entities as Board[])
          : [];
      setBoards(entities);
    } catch (err) {
      if (id !== callId.current) return;
      setError(err instanceof Error ? err.message : "Failed to fetch boards");
    } finally {
      if (id === callId.current) {
        setLoading(false);
      }
    }
  }, [app]);

  // AppProvider mounts this hook after the host handshake.
  useEffect(() => {
    void refresh();
  }, [app, refresh]);

  // Subscribe to any data change — refresh boards broadly
  useDataSync(refresh);

  return { boards, loading, error, refresh } as const;
}
