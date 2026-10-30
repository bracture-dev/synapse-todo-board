import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp, useDataSync } from "@nimblebrain/synapse/react";

export interface Task {
  id: string;
  title: string;
  description?: string;
  priority: "critical" | "high" | "medium" | "low" | "none";
  column: string;
  position: number;
  due_date?: string;
  completed_at?: string;
  assignee?: string;
  effort?: "trivial" | "small" | "medium" | "large" | "epic";
  board_name?: string;
  status: string;
  created_at: string;
  updated_at: string;
  relationships?: Array<{ rel: string; target: string }>;
}

/** Tasks grouped by column key, sorted by position within each column. */
export type TasksByColumn = Record<string, Task[]>;

/**
 * Fetches tasks for a specific board via list_tasks.
 * Refreshes automatically on task entity changes.
 * Provides a `tasksByColumn` grouped view for the board.
 */
export function useTasks(boardId: string | null) {
  const app = useApp();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const callId = useRef(0);

  const refresh = useCallback(async () => {
    if (!boardId) {
      setTasks([]);
      setLoading(false);
      return;
    }

    const id = ++callId.current;
    setError(null);
    try {
      const result = await app.callTool<Task[] | { entities: Task[] }>(
        "query_tasks_by_relationship",
        { rel: "belongs_to", target_id: boardId },
      );
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
          ? ((data as Record<string, unknown>).entities as Task[])
          : [];
      setTasks(entities);
    } catch (err) {
      if (id !== callId.current) return;
      setError(err instanceof Error ? err.message : "Failed to fetch tasks");
    } finally {
      if (id === callId.current) {
        setLoading(false);
      }
    }
  }, [boardId, app]);

  // AppProvider mounts this hook after the host handshake.
  useEffect(() => {
    void refresh();
  }, [app, refresh]);

  // Subscribe to any data change — refresh tasks broadly since the agent
  // may call tools with names that don't contain "task" (e.g. batch operations)
  useDataSync(refresh);

  /** Tasks grouped by column key, sorted by position (ascending). */
  const tasksByColumn = useMemo<TasksByColumn>(() => {
    const grouped: TasksByColumn = {};
    for (const task of tasks) {
      const col = task.column;
      if (!grouped[col]) grouped[col] = [];
      grouped[col].push(task);
    }
    // Sort each column by position
    for (const col of Object.keys(grouped)) {
      grouped[col].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    }
    return grouped;
  }, [tasks]);

  return { tasks, tasksByColumn, loading, error, refresh } as const;
}
