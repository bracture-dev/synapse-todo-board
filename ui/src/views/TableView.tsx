import { useState, useMemo, useCallback } from "react";
import FilterBar, { EMPTY_FILTERS, type Filters, type ColumnDef } from "../components/FilterBar";
import type { App } from "@nimblebrain/synapse";
import { Badge, Button, Inline } from "@nimblebrain/synapse/ui";
import { PRIORITY_TONE, useStyleTokens, type ResolvedTokens } from "../tokens";

// -- Domain types --

export interface Task {
  id: string;
  title: string;
  priority: string;
  column: string;
  assignee?: string | null;
  due_date?: string | null;
  effort?: string | null;
  created_at?: string | null;
  status?: string;
}

export interface Board {
  id: string;
  name: string;
  columns: ColumnDef[];
}

export interface TableViewProps {
  tasks: Task[];
  board: Board;
  callTool: App["callTool"];
  onRefresh?: () => void;
}

// -- Helpers --

type SortDir = "asc" | "desc";

interface SortConfig {
  key: keyof Task;
  dir: SortDir;
}

const PRIORITIES_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

const EFFORT_ORDER: Record<string, number> = {
  epic: 0,
  large: 1,
  medium: 2,
  small: 3,
  trivial: 4,
};

const PRIORITIES = ["critical", "high", "medium", "low", "none"];

function isOverdue(task: Task): boolean {
  if (!task.due_date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(task.due_date + "T00:00:00");
  return due < today;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function compareValues(a: unknown, b: unknown, key: keyof Task): number {
  if (key === "priority") {
    return (PRIORITIES_ORDER[a as string] ?? 99) - (PRIORITIES_ORDER[b as string] ?? 99);
  }
  if (key === "effort") {
    return (EFFORT_ORDER[a as string] ?? 99) - (EFFORT_ORDER[b as string] ?? 99);
  }
  const aStr = (a ?? "") as string;
  const bStr = (b ?? "") as string;
  return aStr.localeCompare(bStr);
}

// -- Column definitions --

interface ColDef {
  key: keyof Task;
  label: string;
  width?: string;
  editable?: boolean;
  hideMobile?: boolean;
}

const TABLE_COLUMNS: ColDef[] = [
  { key: "title", label: "Title", width: "auto" },
  { key: "priority", label: "Priority", width: "110px", editable: true },
  { key: "column", label: "Column", width: "130px", editable: true, hideMobile: true },
  { key: "assignee", label: "Assignee", width: "120px", editable: true, hideMobile: true },
  { key: "due_date", label: "Due Date", width: "120px" },
  { key: "effort", label: "Effort", width: "100px", hideMobile: true },
  { key: "created_at", label: "Created", width: "120px", hideMobile: true },
];

// -- Inline edit cell --

interface InlineCellProps {
  task: Task;
  field: "priority" | "column" | "assignee";
  options: string[];
  labels?: Record<string, string>;
  onSave: (taskId: string, field: string, value: string) => void;
  t: ResolvedTokens;
}

function InlineEditCell({ task, field, options, labels, onSave, t }: InlineCellProps) {
  const [editing, setEditing] = useState(false);
  const currentValue = (task[field] ?? "") as string;

  if (!editing) {
    const display = (labels?.[currentValue] ?? currentValue) || "—";
    return (
      <span
        onClick={() => setEditing(true)}
        style={{
          cursor: "pointer",
          borderBottom: `1px dashed ${t.borderStrong}`,
          paddingBottom: "1px",
        }}
        title="Click to edit"
      >
        {field === "priority" && currentValue && currentValue !== "none" ? (
          <Badge tone={PRIORITY_TONE[currentValue] ?? "neutral"}>{display}</Badge>
        ) : (
          display
        )}
      </span>
    );
  }

  return (
    <select
      autoFocus
      value={currentValue}
      onChange={(e) => {
        onSave(task.id, field, e.target.value);
        setEditing(false);
      }}
      onBlur={() => setEditing(false)}
      style={{
        padding: "0.2rem 0.3rem",
        fontSize: "0.8rem",
        borderRadius: "6px",
        border: `1px solid ${t.border}`,
        background: t.bgRaised,
        color: t.fg,
        fontFamily: t.fontFamily,
        width: "100%",
      }}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {labels?.[o] ?? o}
        </option>
      ))}
    </select>
  );
}

// -- Bulk action bar --

interface BulkBarProps {
  count: number;
  columns: ColumnDef[];
  onChangeColumn: (columnKey: string) => void;
  onSetPriority: (priority: string) => void;
  onArchive: () => void;
  onClear: () => void;
  t: ResolvedTokens;
}

function BulkActionBar({ count, columns, onChangeColumn, onSetPriority, onArchive, onClear, t }: BulkBarProps) {
  return (
    <Inline
      className="tb-bulk-bar"
      gap="0.75rem"
      style={{
        padding: "0.5rem 1rem",
        background: t.accentSoft,
        borderBottom: `1px solid ${t.border}`,
        fontSize: "0.8rem",
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontWeight: 600 }}>{count} selected</span>

      <select
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) onChangeColumn(e.target.value);
          e.target.value = "";
        }}
        style={bulkSelectStyle(t)}
      >
        <option value="" disabled>
          Move to...
        </option>
        {columns.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>

      <select
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) onSetPriority(e.target.value);
          e.target.value = "";
        }}
        style={bulkSelectStyle(t)}
      >
        <option value="" disabled>
          Set priority...
        </option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </option>
        ))}
      </select>

      <Button variant="ghost" size="sm" onClick={onArchive} style={{ color: t.danger }}>
        Archive
      </Button>

      <Button variant="ghost" size="sm" onClick={onClear} style={{ marginLeft: "auto", color: t.fgMuted }}>
        Deselect all
      </Button>
    </Inline>
  );
}

function bulkSelectStyle(t: ResolvedTokens): React.CSSProperties {
  return {
    padding: "0.3rem 0.5rem",
    fontSize: "0.8rem",
    borderRadius: "6px",
    border: `1px solid ${t.border}`,
    background: t.bgRaised,
    color: t.fg,
    fontFamily: t.fontFamily,
    cursor: "pointer",
  };
}

// -- Main component --

export default function TableView({ tasks, board, callTool, onRefresh }: TableViewProps) {
  const t = useStyleTokens();
  const [sort, setSort] = useState<SortConfig>({ key: "priority", dir: "asc" });
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Derive unique assignees from tasks
  const assignees = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (t.assignee) set.add(t.assignee);
    }
    return Array.from(set).sort();
  }, [tasks]);

  // Column label lookup
  const columnLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of board.columns) {
      map[c.key] = c.label;
    }
    return map;
  }, [board.columns]);

  // Filter tasks
  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (filters.priority && t.priority !== filters.priority) return false;
      if (filters.column && t.column !== filters.column) return false;
      if (filters.assignee && t.assignee !== filters.assignee) return false;
      if (filters.overdueOnly && !isOverdue(t)) return false;
      return true;
    });
  }, [tasks, filters]);

  // Sort tasks
  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const cmp = compareValues(a[sort.key], b[sort.key], sort.key);
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sort]);

  // Sort toggle
  const handleSort = useCallback(
    (key: keyof Task) => {
      setSort((prev) => ({
        key,
        dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc",
      }));
    },
    [],
  );

  // Selection
  const allSelected = sorted.length > 0 && sorted.every((t) => selected.has(t.id));

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sorted.map((t) => t.id)));
    }
  }, [allSelected, sorted]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Inline edit handler
  const handleInlineEdit = useCallback(
    async (taskId: string, field: string, value: string) => {
      if (field === "column") {
        await callTool("move_task", { task_id: taskId, target_column: value });
      } else {
        await callTool("update_task", { task_id: taskId, [field]: value });
      }
      onRefresh?.();
    },
    [callTool, onRefresh],
  );

  // Bulk actions
  const handleBulkColumn = useCallback(
    async (columnKey: string) => {
      const ids = Array.from(selected);
      await Promise.all(ids.map((id) => callTool("move_task", { task_id: id, target_column: columnKey })));
      setSelected(new Set());
      onRefresh?.();
    },
    [selected, callTool, onRefresh],
  );

  const handleBulkPriority = useCallback(
    async (priority: string) => {
      const ids = Array.from(selected);
      await Promise.all(ids.map((id) => callTool("update_task", { task_id: id, priority })));
      setSelected(new Set());
      onRefresh?.();
    },
    [selected, callTool, onRefresh],
  );

  const handleBulkArchive = useCallback(async () => {
    const ids = Array.from(selected);
    await Promise.all(ids.map((id) => callTool("archive_task", { task_id: id })));
    setSelected(new Set());
    onRefresh?.();
  }, [selected, callTool, onRefresh]);

  // -- Styles --

  const thStyle = (col: ColDef): React.CSSProperties => ({
    padding: "0.5rem 0.75rem",
    textAlign: "left",
    fontSize: "0.75rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    color: t.fgMuted,
    borderBottom: `2px solid ${t.borderStrong}`,
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
    width: col.width,
  });

  const tdStyle: React.CSSProperties = {
    padding: "0.5rem 0.75rem",
    fontSize: "0.825rem",
    borderBottom: `1px solid ${t.border}`,
    verticalAlign: "middle",
  };

  const overdueRowBg = t.dangerSoft;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 52px)" }}>
      <FilterBar
        filters={filters}
        onChange={setFilters}
        columns={board.columns}
        assignees={assignees}
      />

      {selected.size > 0 && (
        <BulkActionBar
          count={selected.size}
          columns={board.columns}
          onChangeColumn={handleBulkColumn}
          onSetPriority={handleBulkPriority}
          onArchive={handleBulkArchive}
          onClear={() => setSelected(new Set())}
          t={t}
        />
      )}

      <div className="tb-table-wrap" style={{ flex: 1, overflow: "auto", padding: "0 1rem" }}>
        {sorted.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem 1rem", color: t.fgMuted }}>
            No tasks match the current filters.
          </div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              tableLayout: "fixed",
            }}
          >
            <thead>
              <tr>
                {/* Checkbox column */}
                <th
                  style={{
                    ...thStyle({ key: "title", label: "", width: "40px" }),
                    cursor: "default",
                    width: "40px",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    style={{ cursor: "pointer" }}
                  />
                </th>
                {TABLE_COLUMNS.map((col) => (
                  <th key={col.key} className={col.hideMobile ? "tb-col-hide-mobile" : undefined} style={thStyle(col)} onClick={() => handleSort(col.key)}>
                    {col.label}
                    {sort.key === col.key && (
                      <span style={{ marginLeft: "4px", fontSize: "0.65rem" }}>
                        {sort.dir === "asc" ? "▲" : "▼"}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((task) => {
                const overdue = isOverdue(task);
                return (
                  <tr
                    key={task.id}
                    style={{
                      background: overdue ? overdueRowBg : "transparent",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      if (!overdue) {
                        (e.currentTarget as HTMLElement).style.background = t.bgHover;
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = overdue ? overdueRowBg : "transparent";
                    }}
                  >
                    {/* Checkbox */}
                    <td style={{ ...tdStyle, width: "40px" }}>
                      <input
                        type="checkbox"
                        checked={selected.has(task.id)}
                        onChange={() => toggleOne(task.id)}
                        style={{ cursor: "pointer" }}
                      />
                    </td>

                    {/* Title */}
                    <td style={{ ...tdStyle, fontWeight: 500 }}>
                      {task.title}
                      {overdue && (
                        <span
                          style={{
                            marginLeft: "0.5rem",
                            fontSize: "0.65rem",
                            fontWeight: 600,
                            color: t.danger,
                            textTransform: "uppercase",
                          }}
                        >
                          overdue
                        </span>
                      )}
                    </td>

                    {/* Priority (editable) */}
                    <td style={tdStyle}>
                      <InlineEditCell
                        task={task}
                        field="priority"
                        options={PRIORITIES}
                        onSave={handleInlineEdit}
                        t={t}
                      />
                    </td>

                    {/* Column (editable) */}
                    <td className="tb-col-hide-mobile" style={tdStyle}>
                      <InlineEditCell
                        task={task}
                        field="column"
                        options={board.columns.map((c) => c.key)}
                        labels={columnLabels}
                        onSave={handleInlineEdit}
                        t={t}
                      />
                    </td>

                    {/* Assignee (editable) */}
                    <td className="tb-col-hide-mobile" style={tdStyle}>
                      <InlineEditCell
                        task={task}
                        field="assignee"
                        options={["", ...assignees]}
                        onSave={handleInlineEdit}
                        t={t}
                      />
                    </td>

                    {/* Due Date */}
                    <td
                      style={{
                        ...tdStyle,
                        color: overdue ? t.danger : undefined,
                        fontWeight: overdue ? 600 : undefined,
                      }}
                    >
                      {formatDate(task.due_date)}
                    </td>

                    {/* Effort */}
                    <td className="tb-col-hide-mobile" style={tdStyle}>
                      {task.effort ? task.effort.charAt(0).toUpperCase() + task.effort.slice(1) : "—"}
                    </td>

                    {/* Created */}
                    <td className="tb-col-hide-mobile" style={{ ...tdStyle, color: t.fgFaint, fontSize: "0.775rem" }}>
                      {formatDate(task.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
