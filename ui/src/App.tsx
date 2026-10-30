import { useCallback, useEffect, useState } from "react";
import { useTheme, useApp, useModelContext } from "@nimblebrain/synapse/react";
import { Button, EmptyState, Inline, SegmentedControl, Spinner, Stack } from "@nimblebrain/synapse/ui";
import { useBoards } from "./hooks/useBoards";
import { useTasks } from "./hooks/useTasks";
import type { Task } from "./hooks/useTasks";
import type { BoardColumn } from "./hooks/useBoards";
import { BoardSelector } from "./components/BoardSelector";
import { TaskDetail } from "./components/TaskDetail";
import BoardView from "./views/BoardView";
import TableView from "./views/TableView";
import { useStyleTokens } from "./tokens";
import { errorStyle, inputStyle, labelStyle } from "./formStyles";

// ---------------------------------------------------------------------------
// Responsive styles (injected once)
// ---------------------------------------------------------------------------

const RESPONSIVE_STYLES = `
@media (max-width: 640px) {
  .tb-header {
    flex-wrap: wrap !important;
  }
  .tb-header-actions {
    order: 3;
    width: 100%;
    display: flex;
    gap: 0.5rem;
  }
  .tb-view-toggle {
    order: 2;
    margin-left: auto !important;
  }
  .tb-board-container {
    flex-direction: column !important;
  }
  .tb-board-container > div {
    flex: none !important;
    width: 100% !important;
    min-width: 0 !important;
  }
  .tb-table-wrap {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .tb-table-wrap table {
    table-layout: auto !important;
    min-width: 0 !important;
  }
  .tb-col-hide-mobile {
    display: none !important;
  }
  .tb-filter-bar {
    flex-direction: column !important;
    align-items: stretch !important;
  }
  .tb-filter-bar > div,
  .tb-filter-bar > label {
    width: 100%;
  }
  .tb-filter-bar select {
    width: 100% !important;
    min-width: 0 !important;
  }
  .tb-bulk-bar {
    flex-wrap: wrap !important;
  }
  .tb-dialog-panel {
    width: 100vw !important;
    max-width: 100vw !important;
    border-radius: 0 !important;
  }
}
`;

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const el = document.createElement("style");
  el.textContent = RESPONSIVE_STYLES;
  document.head.appendChild(el);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewMode = "board" | "table";

const DEFAULT_COLUMNS: BoardColumn[] = [
  { key: "todo", label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "done", label: "Done" },
];

const PRIORITIES = ["critical", "high", "medium", "low", "none"] as const;
const EFFORTS = ["trivial", "small", "medium", "large", "epic"] as const;

// ---------------------------------------------------------------------------
// Centered modal shell
//
// The library ships an edge-anchored `Drawer` (native <dialog>) but no centered
// `Modal` yet — see PR notes. Until it does, the create dialogs use this small
// token-driven overlay so they stay visually consistent with the rest of the app.
// ---------------------------------------------------------------------------

function ModalShell({
  title,
  width,
  onClose,
  children,
  footer,
}: {
  title: string;
  width: number;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const t = useStyleTokens();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        className="tb-dialog-panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: `${width}px`,
          maxWidth: "90vw",
          background: t.bg,
          color: t.fg,
          borderRadius: "12px",
          border: `1px solid ${t.border}`,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "1rem 1.25rem",
            borderBottom: `1px solid ${t.border}`,
          }}
        >
          <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>{title}</h3>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.25rem",
              cursor: "pointer",
              color: t.fgMuted,
              padding: "0.25rem",
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div style={{ padding: "1.25rem" }}>
          <Stack gap="1rem">{children}</Stack>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.5rem",
            padding: "1rem 1.25rem",
            borderTop: `1px solid ${t.border}`,
          }}
        >
          {footer}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Board Dialog
// ---------------------------------------------------------------------------

function CreateBoardDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, description: string, columns: BoardColumn[]) => Promise<void>;
}) {
  const t = useStyleTokens();
  const input = inputStyle(t);
  const label = labelStyle(t);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [columns, setColumns] = useState<BoardColumn[]>(DEFAULT_COLUMNS.map((c) => ({ ...c })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleColumnChange = (index: number, field: "key" | "label", value: string) => {
    setColumns((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      // Auto-derive key from label if user hasn't manually edited the key
      if (field === "label") {
        next[index].key = value.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
      }
      return next;
    });
  };

  const addColumn = () => {
    setColumns((prev) => [...prev, { key: "", label: "" }]);
  };

  const removeColumn = (index: number) => {
    if (columns.length <= 1) return;
    setColumns((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate(
        name.trim(),
        description.trim(),
        columns.filter((c) => c.key && c.label),
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create board");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title="Create Board"
      width={480}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={saving || !name.trim()}>
            {saving ? "Creating..." : "Create Board"}
          </Button>
        </>
      }
    >
      <div>
        <label style={label}>Board Name *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Project Board"
          style={input}
          autoFocus
        />
      </div>

      <div>
        <label style={label}>Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          style={input}
        />
      </div>

      <div>
        <label style={label}>Columns</label>
        <Stack gap="0.5rem">
          {columns.map((col, i) => (
            <Inline key={i} gap="0.5rem">
              <input
                type="text"
                value={col.label}
                onChange={(e) => handleColumnChange(i, "label", e.target.value)}
                placeholder="Column name"
                style={{ ...input, flex: 1 }}
              />
              <button
                onClick={() => removeColumn(i)}
                disabled={columns.length <= 1}
                style={{
                  background: "none",
                  border: "none",
                  color: columns.length <= 1 ? t.fgFaint : t.danger,
                  cursor: columns.length <= 1 ? "not-allowed" : "pointer",
                  fontSize: "1rem",
                  padding: "0.25rem",
                }}
                aria-label="Remove column"
              >
                ×
              </button>
            </Inline>
          ))}
          <button
            onClick={addColumn}
            style={{
              background: "none",
              border: `1px dashed ${t.border}`,
              borderRadius: "6px",
              padding: "0.4rem",
              color: t.fgMuted,
              cursor: "pointer",
              fontSize: "0.8rem",
            }}
          >
            + Add Column
          </button>
        </Stack>
      </div>

      {error && <div style={errorStyle(t)}>{error}</div>}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Create Task Dialog
// ---------------------------------------------------------------------------

function CreateTaskDialog({
  columns,
  defaultColumn,
  onClose,
  onCreate,
}: {
  columns: BoardColumn[];
  defaultColumn: string;
  onClose: () => void;
  onCreate: (data: {
    title: string;
    column: string;
    priority: string;
    assignee: string;
    due_date: string;
    effort: string;
  }) => Promise<void>;
}) {
  const t = useStyleTokens();
  const input = inputStyle(t);
  const label = labelStyle(t);
  const [title, setTitle] = useState("");
  const [column, setColumn] = useState(defaultColumn);
  const [priority, setPriority] = useState<string>("medium");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [effort, setEffort] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Update column if defaultColumn changes (e.g. clicking + on a different column)
  useEffect(() => {
    setColumn(defaultColumn);
  }, [defaultColumn]);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        title: title.trim(),
        column,
        priority,
        assignee: assignee.trim(),
        due_date: dueDate,
        effort,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title="New Task"
      width={440}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={saving || !title.trim()}>
            {saving ? "Creating..." : "Create Task"}
          </Button>
        </>
      }
    >
      <div>
        <label style={label}>Title *</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs to be done?"
          style={input}
          autoFocus
        />
      </div>

      {/* Column + Priority row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <div>
          <label style={label}>Column</label>
          <select value={column} onChange={(e) => setColumn(e.target.value)} style={input}>
            {columns.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={label}>Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} style={input}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Assignee + Due date row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <div>
          <label style={label}>Assignee</label>
          <input
            type="text"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            placeholder="Name or email"
            style={input}
          />
        </div>
        <div>
          <label style={label}>Due Date</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={input} />
        </div>
      </div>

      {/* Effort */}
      <div>
        <label style={label}>Effort</label>
        <select value={effort} onChange={(e) => setEffort(e.target.value)} style={input}>
          <option value="">--</option>
          {EFFORTS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </div>

      {error && <div style={errorStyle(t)}>{error}</div>}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const theme = useTheme();
  const t = useStyleTokens();
  const app = useApp();
  const { boards, loading: boardsLoading, refresh: refreshBoards } = useBoards();

  const [activeView, setActiveView] = useState<ViewMode>("board");
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [showCreateBoard, setShowCreateBoard] = useState(false);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [createTaskColumn, setCreateTaskColumn] = useState<string>("");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const { tasks, refresh: refreshTasks } = useTasks(selectedBoardId);

  // Derive the current board object from the boards list
  const selectedBoard = boards.find((b) => b.id === selectedBoardId) ?? null;

  // Apply theme mode to document (lets the host's light/dark CSS vars scope)
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme.mode);
  }, [theme.mode]);

  // Inject responsive CSS on first render
  useEffect(() => { injectStyles(); }, []);

  // Auto-select the first board when boards load and nothing is selected
  useEffect(() => {
    if (!selectedBoardId && boards.length > 0) {
      setSelectedBoardId(boards[0].id);
    }
  }, [selectedBoardId, boards]);

  // Push current UI state to the agent so it knows what the user is looking at
  const pushState = useModelContext();
  useEffect(() => {
    const tasksByColumn: Record<string, number> = {};
    for (const tk of tasks) {
      tasksByColumn[tk.column] = (tasksByColumn[tk.column] ?? 0) + 1;
    }
    pushState(
      {
        selectedBoard: selectedBoard
          ? { id: selectedBoard.id, name: selectedBoard.name, columns: selectedBoard.columns.map((c) => c.key) }
          : null,
        view: activeView,
        taskCount: tasks.length,
        tasksByColumn,
      },
      selectedBoard
        ? `Viewing "${selectedBoard.name}" board (${activeView} view, ${tasks.length} tasks)`
        : "No board selected",
    );
  }, [selectedBoard, activeView, tasks, pushState]);

  // -- Board selector handler (intercepts "__create__" sentinel) --

  const handleBoardChange = useCallback((boardId: string | null) => {
    if (boardId === "__create__") {
      setShowCreateBoard(true);
      return;
    }
    setSelectedBoardId(boardId);
  }, []);

  // -- Create board --

  const handleCreateBoard = useCallback(
    async (name: string, description: string, columns: BoardColumn[]) => {
      const result = await app.callTool("create_board", {
        name,
        description: description || undefined,
        columns: columns.map((c) => ({ key: c.key, label: c.label })),
      });
      if (result.isError) {
        throw new Error(String(result.data));
      }
      await refreshBoards();
      // Select the newly created board
      const data = result.data as { id?: string } | undefined;
      if (data?.id) {
        setSelectedBoardId(data.id);
      }
    },
    [app, refreshBoards],
  );

  // -- Create task --

  const handleAddTask = useCallback(
    (columnKey: string) => {
      setCreateTaskColumn(columnKey);
      setShowCreateTask(true);
    },
    [],
  );

  const handleCreateTask = useCallback(
    async (data: {
      title: string;
      column: string;
      priority: string;
      assignee: string;
      due_date: string;
      effort: string;
    }) => {
      if (!selectedBoardId) return;
      const args: Record<string, unknown> = {
        board_id: selectedBoardId,
        title: data.title,
        column: data.column,
        priority: data.priority,
      };
      if (data.assignee) args.assignee = data.assignee;
      if (data.due_date) args.due_date = data.due_date;
      if (data.effort) args.effort = data.effort;

      const result = await app.callTool("create_board_task", args);
      if (result.isError) {
        throw new Error(String(result.data));
      }
      await refreshTasks();
    },
    [app, selectedBoardId, refreshTasks],
  );

  // -- Task click (open detail) --

  const handleTaskClick = useCallback((task: Task) => {
    setSelectedTask(task);
  }, []);

  // -- Header "New Task" button (uses default column) --

  const handleNewTaskHeader = useCallback(() => {
    const defaultCol = selectedBoard?.default_column ?? selectedBoard?.columns[0]?.key ?? "";
    setCreateTaskColumn(defaultCol);
    setShowCreateTask(true);
  }, [selectedBoard]);

  // -- Delete board --

  const handleDeleteBoard = useCallback(async () => {
    if (!selectedBoardId) return;
    const board = boards.find((b) => b.id === selectedBoardId);
    if (!confirm(`Delete board "${board?.name}"? All tasks on this board will be orphaned.`)) return;
    try {
      await app.callTool("delete_board", { board_id: selectedBoardId });
      setSelectedBoardId(null);
      await refreshBoards();
    } catch (err) {
      console.error("Failed to delete board:", err);
    }
  }, [app, selectedBoardId, boards, refreshBoards]);

  // -- Render --

  return (
    <div
      style={{
        fontFamily: t.fontFamily,
        minHeight: "100vh",
        background: t.bg,
        color: t.fg,
      }}
    >
      {/* ---- Header ---- */}
      <header
        className="tb-header"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.75rem 1rem",
          borderBottom: `1px solid ${t.border}`,
          background: t.bgRaised,
        }}
      >
        {/* Board selector */}
        <BoardSelector
          boards={boards}
          selectedBoardId={selectedBoardId}
          onBoardChange={handleBoardChange}
        />

        {/* New Task + Delete Board buttons */}
        {selectedBoard && (
          <Inline className="tb-header-actions" gap="0.5rem">
            <Button size="sm" onClick={handleNewTaskHeader}>
              + New Task
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDeleteBoard} title="Delete this board">
              Delete Board
            </Button>
          </Inline>
        )}

        {/* View toggle (pushed to the right) */}
        <div className="tb-view-toggle" style={{ marginLeft: "auto" }}>
          <SegmentedControl<ViewMode>
            options={[
              { label: "Board", value: "board" },
              { label: "Table", value: "table" },
            ]}
            value={activeView}
            onChange={setActiveView}
          />
        </div>
      </header>

      {/* ---- Main content ---- */}
      <main>
        {boardsLoading && boards.length === 0 ? (
          <EmptyState icon={<Spinner />} description="Loading boards" style={{ padding: "6rem 2rem" }} />
        ) : boards.length === 0 ? (
          <EmptyState
            icon={<span style={{ fontSize: "2.5rem", opacity: 0.4 }}>+</span>}
            title="Create your first board"
            description="Boards organize your tasks into columns. Start with a simple To Do / In Progress / Done workflow."
            action={
              <Button onClick={() => setShowCreateBoard(true)}>+ New Board</Button>
            }
            style={{ padding: "6rem 2rem" }}
          />
        ) : !selectedBoard ? (
          <EmptyState
            title="Select a board"
            description="Pick a board from the dropdown to get started."
            style={{ padding: "6rem 2rem" }}
          />
        ) : activeView === "board" ? (
          <BoardView
            board={selectedBoard}
            tasks={tasks}
            onTaskClick={handleTaskClick}
            onAddTask={handleAddTask}
            onRefresh={refreshTasks}
          />
        ) : (
          <TableView
            tasks={tasks}
            board={selectedBoard}
            callTool={app.callTool.bind(app)}
            onRefresh={refreshTasks}
          />
        )}
      </main>

      {/* ---- Modals / Overlays ---- */}

      {showCreateBoard && (
        <CreateBoardDialog
          onClose={() => setShowCreateBoard(false)}
          onCreate={handleCreateBoard}
        />
      )}

      {showCreateTask && selectedBoard && (
        <CreateTaskDialog
          columns={selectedBoard.columns}
          defaultColumn={createTaskColumn || selectedBoard.default_column || selectedBoard.columns[0]?.key || ""}
          onClose={() => setShowCreateTask(false)}
          onCreate={handleCreateTask}
        />
      )}

      {selectedTask && selectedBoard && (
        <TaskDetail
          task={selectedTask}
          columns={selectedBoard.columns}
          onClose={() => setSelectedTask(null)}
          onSaved={refreshTasks}
        />
      )}
    </div>
  );
}
