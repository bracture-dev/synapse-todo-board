import { useCallback, useEffect, useState } from "react";
import type { BoardColumn } from "../hooks/useBoards";
import type { Task } from "../hooks/useTasks";
import { useApp } from "@nimblebrain/synapse/react";
import { Button, Drawer, Stack, TextLink } from "@nimblebrain/synapse/ui";
import { useStyleTokens } from "../tokens";
import { errorStyle, inputStyle, labelStyle } from "../formStyles";

interface TaskDetailProps {
  task: Task;
  columns: BoardColumn[];
  onClose: () => void;
  onSaved?: () => void;
}

const PRIORITIES = ["critical", "high", "medium", "low", "none"] as const;
const EFFORTS = ["trivial", "small", "medium", "large", "epic"] as const;

/**
 * Slide-over panel for editing a single task, built on the shared `Drawer`
 * (native `<dialog>` — Escape, backdrop dismissal, and focus handling come from
 * the library). Save calls update_task (and move_task first if the column
 * changed, for WIP enforcement). Task creation is a separate flow
 * (CreateTaskDialog), so this panel is edit-only.
 */
export function TaskDetail({ task, columns, onClose, onSaved }: TaskDetailProps) {
  const app = useApp();
  const t = useStyleTokens();

  const [title, setTitle] = useState(task.title ?? "");
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState<Task["priority"]>(task.priority ?? "none");
  const [column, setColumn] = useState(task.column ?? columns[0]?.key ?? "");
  const [assignee, setAssignee] = useState(task.assignee ?? "");
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [effort, setEffort] = useState(task.effort ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Present as a bottom sheet on a coarse (touch) pointer; a side sheet otherwise.
  const [isCoarse, setIsCoarse] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(pointer: coarse)");
    const onChange = () => setIsCoarse(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const input = inputStyle(t);
  const label = labelStyle(t);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      // If the column changed, use move_task first for WIP enforcement.
      if (column !== task.column) {
        await app.callTool("move_task", {
          task_id: task.id,
          target_column: column,
        });
      }

      const result = await app.callTool("update_task", {
        task_id: task.id,
        title,
        description: description || undefined,
        priority,
        assignee: assignee || undefined,
        due_date: dueDate || undefined,
        effort: effort || undefined,
      });

      if (result.isError) {
        setError(String(result.data));
        return;
      }

      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save task");
    } finally {
      setSaving(false);
    }
  }, [app, task, title, description, priority, column, assignee, dueDate, effort, onClose, onSaved]);

  const handleArchive = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await app.callTool("archive_task", {
        task_id: task.id,
      });
      if (result.isError) {
        setError(String(result.data));
        return;
      }
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to archive task");
    } finally {
      setSaving(false);
    }
  }, [app, task, onClose, onSaved]);

  return (
    <Drawer open onClose={onClose} width={420} side={isCoarse ? "bottom" : "right"}>
      <Drawer.Header title="Edit Task" onClose={onClose} />

      <Drawer.Body>
        <Stack gap="1rem">
          {/* Title */}
          <div>
            <label style={label}>Title</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={input} />
          </div>

          {/* Description */}
          <div>
            <label style={label}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              style={{ ...input, resize: "vertical" }}
            />
          </div>

          {/* Priority + Effort row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label style={label}>Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Task["priority"])}
                style={input}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={label}>Effort</label>
              <select value={effort} onChange={(e) => setEffort(e.target.value)} style={input}>
                <option value="">--</option>
                {EFFORTS.map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Column */}
          <div>
            <label style={label}>Column</label>
            <select value={column} onChange={(e) => setColumn(e.target.value)} style={input}>
              {columns.map((col) => (
                <option key={col.key} value={col.key}>{col.label}</option>
              ))}
            </select>
          </div>

          {/* Assignee */}
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

          {/* Due date */}
          <div>
            <label style={label}>Due Date</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={input} />
          </div>

          {error && <div style={errorStyle(t)}>{error}</div>}
        </Stack>
      </Drawer.Body>

      <Drawer.Footer style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <TextLink tone="danger" onClick={handleArchive} disabled={saving}>
          Archive
        </TextLink>
        <div style={{ flex: 1 }} />
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving || !title.trim()}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </Drawer.Footer>
    </Drawer>
  );
}
