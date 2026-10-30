"""Board and task records, kept in the existing workspace JSON layout.

Records live at ``apps/todo-board/data/{boards,tasks}/<id>.json`` under the
workspace root, exactly where Upjack writes them, so a workspace Upjack wrote
reads back unchanged. Fields added with ``add_field`` are kept in the
workspace too, at ``apps/todo-board/schemas/<kind>.fields.json``, and the
app's own schema files are never edited. The server does not use this store
yet.
"""

from __future__ import annotations

import json
import operator
import os
import re
import stat
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from threading import RLock
from typing import Any

from jsonschema import Draft202012Validator
from ulid import ULID

ENTITIES = {"board": ("boards", "bd"), "task": ("tasks", "tk")}
IMMUTABLE = {"id", "type", "version", "created_at", "created_by"}
INDEX = "apps/todo-board/data/_index/relations.json"
EXTENSIONS = "apps/todo-board/schemas/{}.fields.json"
BASE_REF = "https://upjack.dev/schemas/v1/upjack-entity.schema.json"
COMPARISONS = {"$gt": operator.gt, "$gte": operator.ge, "$lt": operator.lt, "$lte": operator.le}
FIELD_TYPES = ("array", "boolean", "integer", "number", "object", "string")

Record = dict[str, Any]


def _timestamp() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _extension_error(name: Any, field: Any) -> str | None:
    """Say what is wrong with one added field, or return None when it is valid."""
    if not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9_]*", name):
        return f"Invalid field_name '{name}'. Must match [a-z][a-z0-9_]*"
    if not isinstance(field, dict) or set(field) - {"type", "default", "description", "required"}:
        return f"Invalid definition for field '{name}'"
    field_type = field.get("type")
    if field_type not in FIELD_TYPES:
        return f"Invalid field_type '{field_type}'. Allowed: {list(FIELD_TYPES)}"
    # Creates validate the default they fill in, so it must pass the JSON
    # Schema type check, which rejects True for an integer field.
    default = field.get("default")
    if "default" not in field or not Draft202012Validator({"type": field_type}).is_valid(default):
        return f"Default value {default!r} is not compatible with type '{field_type}'"
    if not isinstance(field.get("required"), bool):
        return f"Field '{name}' needs required set to true or false"
    if not isinstance(field.get("description", ""), str):
        return f"Field '{name}' needs a text description"
    return None


def _inherited(schema: Record) -> set[str]:
    """Field names a kind inherits through ``allOf``, the base entity fields."""
    return {name for part in schema.get("allOf", []) for name in part.get("properties", {})}


def _matches_filter(entity: Record, filters: Record | None) -> bool:
    for field, expected in (filters or {}).items():
        value = entity.get(field)
        if not isinstance(expected, dict):
            if value != expected:
                return False
            continue
        for condition, operand in expected.items():
            if condition == "$exists":
                okay = (field in entity and value is not None) == operand
            elif condition == "$ne":
                okay = value != operand
            elif condition == "$in":
                okay = value in operand
            elif condition == "$contains":
                okay = isinstance(value, list) and operand in value
            elif condition in COMPARISONS:
                try:
                    okay = value is not None and COMPARISONS[condition](value, operand)
                except TypeError:
                    okay = False
            else:
                raise ValueError(f"Unsupported filter operator: {condition}")
            if not okay:
                return False
    return True


class BoardStore:
    """Read and write board and task records under one workspace root."""

    def __init__(self, root: str | Path, project_root: str | Path) -> None:
        self.root = Path(root).resolve()
        self.project_root = Path(project_root).resolve()
        self.lock = RLock()
        self.schemas = {kind: self._load_schema(kind) for kind in ENTITIES}

    def _load_schema(self, kind: str) -> Record:
        # The app schemas compose the remote Upjack base entity through allOf.
        # Swap that one entry for the local copy so loading never needs the network.
        schema = json.loads((self.project_root / "schemas" / f"{kind}.schema.json").read_text())
        base = json.loads((self.project_root / "schemas/entity.schema.json").read_text())
        schema["allOf"] = [
            base if part.get("$ref") == BASE_REF else part for part in schema.get("allOf", [])
        ]
        properties = schema.setdefault("properties", {})
        for name, field in self._read_extensions(kind).items():
            # A field the app or the base entity now defines keeps that
            # definition, so an app update that ships the same field still loads.
            if name in properties or name in _inherited(schema):
                continue
            error = _extension_error(name, field)
            if error:
                raise ValueError(f"Invalid field in {EXTENSIONS.format(kind)}: {error}")
            properties[name] = {key: value for key, value in field.items() if key != "required"}
            if field["required"] and name not in schema.get("required", []):
                schema.setdefault("required", []).append(name)
        return schema

    def _read_extensions(self, kind: str) -> Record:
        relative = EXTENSIONS.format(kind)
        try:
            saved = json.loads(self._path(relative).read_text())
        except FileNotFoundError:
            return {}
        except json.JSONDecodeError as error:
            raise ValueError(f"Invalid JSON in {relative}: {error}") from None
        # Refuse anything add_field would not write, as for a field: unknown
        # keys, and a version of True or 1.0, which Python counts as equal to 1.
        if (
            not isinstance(saved, dict)
            or set(saved) != {"version", "fields"}
            or type(saved["version"]) is not int
            or saved["version"] != 1
            or not isinstance(saved["fields"], dict)
        ):
            raise ValueError(f"Unsupported version or layout in {relative}")
        return saved["fields"]

    def _path(self, relative: str) -> Path:
        path = self.root / relative
        if not path.resolve().is_relative_to(self.root):
            raise ValueError("Path escapes workspace root")
        return path

    def _entity_path(self, kind: str, entity_id: str) -> Path:
        plural, prefix = ENTITIES[kind]
        if not re.fullmatch(prefix + r"_[0-9A-HJKMNP-TV-Z]{26}", entity_id):
            raise ValueError(f"Invalid {kind} ID")
        return self._path(f"apps/todo-board/data/{plural}/{entity_id}.json")

    @staticmethod
    def _atomic(path: Path, value: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".todo-{ULID()}.tmp")
        # Mode 0o666 lets the umask apply, as it does to a plain write.
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o666)
        try:
            with os.fdopen(fd, "w") as stream:
                if path.exists():
                    os.fchmod(stream.fileno(), stat.S_IMODE(path.stat().st_mode))
                json.dump(value, stream, indent=2)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def _save(self, kind: str, record: Record, old_edges: list, validate: bool = True) -> Record:
        if validate:
            Draft202012Validator(self.schemas[kind]).validate(record)
        self._atomic(self._entity_path(kind, record["id"]), record)
        # Upjack patches this index on its own writes and trusts it on reads,
        # so keep it whole. It holds every status, so only edge changes matter.
        if old_edges != record.get("relationships", []) or not self._path(INDEX).exists():
            self.rebuild_index()
        return deepcopy(record)

    def _hydrate(self, kind: str, record: Record) -> Record:
        record = deepcopy(record)
        for schema in [*self.schemas[kind].get("allOf", []), self.schemas[kind]]:
            for field, definition in schema.get("properties", {}).items():
                if field not in record and "default" in definition:
                    record[field] = deepcopy(definition["default"])
        return record

    def create_entity(self, kind: str, data: Record, created_by: str = "agent") -> Record:
        """Create a record. A supplied ID must be new and well formed."""
        with self.lock:
            data = deepcopy(data)
            supplied_id = data.pop("id", None)
            entity_id = supplied_id or f"{ENTITIES[kind][1]}_{ULID()}"
            path = self._entity_path(kind, entity_id)
            if path.exists():
                raise ValueError(f"Entity already exists: {entity_id}")
            timestamp = _timestamp()
            record = {
                "version": 1,
                "created_at": timestamp,
                "updated_at": timestamp,
                "created_by": created_by,
                "status": "active",
                "tags": [],
                "relationships": [],
                **data,
                "id": entity_id,
                "type": kind,
            }
            return self._save(kind, self._hydrate(kind, record), [])

    def get_entity(self, kind: str, entity_id: str) -> Record:
        """Read one record, filling in missing schema defaults."""
        with self.lock:
            try:
                record = json.loads(self._entity_path(kind, entity_id).read_text())
            except FileNotFoundError:
                raise FileNotFoundError(f"Entity not found: {entity_id}") from None
            return self._hydrate(kind, record)

    def update_entity(self, kind: str, entity_id: str, data: Record) -> Record:
        """Merge fields into a record. Immutable fields are ignored."""
        with self.lock:
            record = self.get_entity(kind, entity_id)
            old_edges = record.get("relationships", [])
            record.update({k: v for k, v in data.items() if k not in IMMUTABLE})
            record["updated_at"] = _timestamp()
            return self._save(kind, record, old_edges)

    def _all(self, kind: str) -> list[Record]:
        directory = self._path(f"apps/todo-board/data/{ENTITIES[kind][0]}")
        records = []
        for path in sorted(directory.glob("*.json")):
            try:
                records.append(self.get_entity(kind, path.stem))
            except (OSError, TypeError, ValueError):
                # Not a readable record: a stray file, a non-object, a path
                # outside the workspace, or a file deleted since the glob.
                continue
        return records

    def list_entities(
        self, kind: str, status: str = "active", limit: int | None = None
    ) -> list[Record]:
        """List records with one status, most recently updated first."""
        records = [record for record in self._all(kind) if record.get("status", "active") == status]
        ordered = sorted(records, key=lambda record: record.get("updated_at", ""), reverse=True)
        return ordered if limit is None else ordered[: max(0, limit)]

    def delete_entity(self, kind: str, entity_id: str, hard: bool = False) -> Record:
        """Mark a record deleted, or remove its file when ``hard`` is set."""
        with self.lock:
            record = self.get_entity(kind, entity_id)
            if hard:
                # Only an explicit hard delete removes a file, and only this one.
                self._entity_path(kind, entity_id).unlink()
                self.rebuild_index()
                return record
            # As in Upjack, a soft delete skips validation, so a record that
            # predates the current schema can still be deleted.
            record["status"] = "deleted"
            record["updated_at"] = _timestamp()
            return self._save(kind, record, record.get("relationships", []), validate=False)

    def search_entities(
        self,
        kind: str,
        query: str | None = None,
        filter: Record | None = None,
        sort: str = "-updated_at",
        limit: int = 20,
    ) -> list[Record]:
        """Search string fields and filter. Deleted records need a status filter."""
        records = [
            record
            for record in self._all(kind)
            if ((filter and "status" in filter) or record.get("status") != "deleted")
            and (
                not query
                or any(query.lower() in v.lower() for v in record.values() if isinstance(v, str))
            )
            and _matches_filter(record, filter)
        ]
        field = sort.lstrip("-")

        def sort_key(record: Record) -> tuple:
            value = record.get(field)
            return (value is not None, isinstance(value, str), value if value is not None else "")

        return sorted(records, key=sort_key, reverse=sort.startswith("-"))[: max(0, limit)]

    def query_by_relationship(
        self,
        kind: str,
        rel: str,
        target_id: str,
        filter: Record | None = None,
        limit: int | None = None,
    ) -> list[Record]:
        """List active records of one kind with a ``rel`` edge to ``target_id``."""
        records = [
            record
            for record in self._all(kind)
            if record.get("status", "active") == "active"
            and _matches_filter(record, filter)
            and any(
                edge.get("rel") == rel and edge.get("target") == target_id
                for edge in record.get("relationships", [])
            )
        ]
        return records if limit is None else records[: max(0, limit)]

    def _kind(self, entity_id: str) -> str:
        for kind, (_, prefix) in ENTITIES.items():
            if entity_id.startswith(prefix + "_"):
                return kind
        raise ValueError("Unknown entity ID prefix")

    def _resolve(self, entity_id: str) -> Record | None:
        try:
            return self.get_entity(self._kind(entity_id), entity_id)
        except (FileNotFoundError, ValueError):
            return None

    def get_related(
        self, entity_id: str, rel: str | None = None, direction: str = "forward"
    ) -> list[Record]:
        """Follow a record's edges, or find the records whose edges point at it."""
        if direction == "reverse":
            return [
                record
                for kind in ENTITIES
                for record in self._all(kind)
                if any(
                    edge.get("target") == entity_id and (rel is None or edge.get("rel") == rel)
                    for edge in record.get("relationships", [])
                )
            ]
        if direction != "forward":
            raise ValueError("Direction must be forward or reverse")
        source = self.get_entity(self._kind(entity_id), entity_id)
        found = [
            self._resolve(edge.get("target", ""))
            for edge in source.get("relationships", [])
            if rel is None or edge.get("rel") == rel
        ]
        return [record for record in found if record]

    def get_composite(self, kind: str, entity_id: str, depth: int = 1) -> Record:
        """Read a record with its related records under ``_related``."""
        entity = self.get_entity(kind, entity_id)
        related: dict[str, list[Record]] = {}
        if depth < 1:
            return {**entity, "_related": related}
        for edge in entity.get("relationships", []):
            found = self._resolve(edge.get("target", ""))
            if edge.get("rel") and found:
                related.setdefault(edge["rel"], []).append(found)
        for source in self.get_related(entity_id, direction="reverse"):
            for edge in source.get("relationships", []):
                if edge.get("target") == entity_id and edge.get("rel"):
                    related.setdefault("~" + edge["rel"], []).append(source)
        return {**entity, "_related": related}

    def rebuild_index(self) -> Record:
        """Rewrite the reverse index Upjack reads, from every record's edges."""
        with self.lock:
            reverse: dict[str, list[dict[str, str]]] = {}
            for kind in ENTITIES:
                for record in self._all(kind):
                    for edge in record.get("relationships", []):
                        if not edge.get("rel") or not edge.get("target"):
                            continue
                        entry = {"source": record["id"], "rel": edge["rel"]}
                        entries = reverse.setdefault(edge["target"], [])
                        if entry not in entries:
                            entries.append(entry)
            self._atomic(self._path(INDEX), {"reverse": reverse})
            return {"success": True, "entries": sum(map(len, reverse.values()))}

    def add_field(
        self,
        entity_type: str,
        field_name: str,
        field_type: str,
        default: Any,
        description: str = "",
        required: bool = True,
    ) -> Record:
        """Add a field with a valid default to one kind's schema.

        Upjack wrote the field into the app's own schema file, which an app
        update replaces. Here it is saved in the workspace with the records,
        and reads fill its default into records written before it existed.
        A rejected field comes back as ``{"error": ...}``, as it did from Upjack.
        """
        if entity_type not in ENTITIES:
            return {"error": f"Unknown entity type '{entity_type}'"}
        field = {"type": field_type, "default": default, "required": required}
        if description != "":
            field["description"] = description
        error = _extension_error(field_name, field)
        if error:
            return {"error": error}
        with self.lock:
            schema = self.schemas[entity_type]
            if field_name in _inherited(schema):
                return {"error": f"Field '{field_name}' is a reserved base entity field"}
            fields = self._read_extensions(entity_type)
            # The file also holds fields another store on this workspace added.
            if field_name in schema["properties"] or field_name in fields:
                return {"error": f"Field '{field_name}' already exists"}
            fields[field_name] = field
            path = self._path(EXTENSIONS.format(entity_type))
            self._atomic(path, {"version": 1, "fields": fields})
            self.schemas[entity_type] = self._load_schema(entity_type)
        return {
            "success": True,
            "entity_type": entity_type,
            "field": {
                "name": field_name,
                "type": field_type,
                "default": default,
                "required": required,
            },
        }
