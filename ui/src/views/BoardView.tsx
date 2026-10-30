import type { CSSProperties } from "react";
import { useApp } from "@nimblebrain/synapse/react";
import Column from "../components/Column.js";
import type { ColumnDef } from "../components/Column.js";
import type { Task } from "../components/TaskCard.js";

// -- Types --

export interface Board {
  id: string;
  name: string;
  description?: string;
  columns: ColumnDef[];
  default_column?: string;
}

export interface BoardViewProps {
  board: Board;
  tasks: Task[];
  onTaskClick?: (task: Task) => void;
  onAddTask?: (columnKey: string) => void;
  onRefresh?: () => void;
}

// -- Component --

export default function BoardView({
  board,
  tasks,
  onTaskClick,
  onAddTask,
  onRefresh,
}: BoardViewProps) {
  const app = useApp();
  // Group tasks by column key
  const tasksByColumn = new Map<string, Task[]>();
  for (const col of board.columns) {
    tasksByColumn.set(col.key, []);
  }
  for (const task of tasks) {
    const bucket = tasksByColumn.get(task.column);
    if (bucket) {
      bucket.push(task);
    }
  }

  // Handle drag-and-drop: call move_task via Synapse
  async function handleDrop(taskId: string, _sourceColumn: string, targetColumn: string) {
    try {
      await app.callTool("move_task", {
        task_id: taskId,
        target_column: targetColumn,
      });
      onRefresh?.();
    } catch (err) {
      console.error("Failed to move task:", err);
    }
  }

  // -- Board layout --

  const containerStyle: CSSProperties = {
    display: "flex",
    gap: "0.75rem",
    padding: "1rem",
    overflowX: "auto",
    minHeight: "calc(100vh - 60px)",
    alignItems: "flex-start",
    width: "100%",
  };

  return (
    <div className="tb-board-container" style={containerStyle}>
      {board.columns.map((col) => (
        <Column
          key={col.key}
          column={col}
          tasks={tasksByColumn.get(col.key) ?? []}
          onDrop={handleDrop}
          onTaskClick={onTaskClick}
          onAddTask={onAddTask}
        />
      ))}
    </div>
  );
}
