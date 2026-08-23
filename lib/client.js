window.__ModuleLoader__.load({
  id: 'dsh-settings-manager',
  factory: (require) => {
    'use strict'
    var module = { exports: {} }
    var exports = module.exports
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.ts
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(client_exports);
var import_react = __toESM(require("react"), 1);
var SECTION_SLOT = "settings.section";
var OWN_ID = "settings-manager";
var STORAGE_KEY = "dsh-settings-manager.policy.v1";
var LOCALE_NS = "settingsManager";
var OWN_ORDER = 1;
var TOUCH_ID = "settings-manager-touch";
var zh = {
  nav: "\u8BBE\u7F6E\u7F16\u6392",
  hint: "\u7BA1\u7406\u5404\u63D2\u4EF6\u5728\u5168\u5C40\u8BBE\u7F6E\u4E2D\u7684\u663E\u793A\u4E0E\u6392\u5E8F\uFF0C\u6539\u52A8\u5373\u65F6\u751F\u6548\u3002\u9690\u85CF\u7684\u5206\u533A\u4E0D\u518D\u51FA\u73B0\u5728\u8BBE\u7F6E\u5BFC\u822A\uFF1B\u62D6\u62FD\u6216\u6309\u94AE\u53EF\u8C03\u6574\u987A\u5E8F\u3002",
  hide: "\u9690\u85CF",
  show: "\u663E\u793A",
  moveUp: "\u4E0A\u79FB",
  moveDown: "\u4E0B\u79FB",
  reset: "\u91CD\u7F6E",
  resetAll: "\u5168\u90E8\u91CD\u7F6E",
  hiddenTag: "\u5DF2\u9690\u85CF",
  noSections: "\u6682\u65E0\u5DF2\u6CE8\u518C\u7684\u8BBE\u7F6E\u5206\u533A",
  selfNote: "\u672C\u5206\u533A\u7531 dsh-settings-manager \u63D0\u4F9B\uFF0C\u4E0D\u53EF\u9690\u85CF\u3002",
  dragHint: "\u62D6\u62FD\u8C03\u6574\u987A\u5E8F",
  rename: "\u6539\u540D",
  renamePlaceholder: "\u8F93\u5165\u65B0\u540D\u79F0\u2026"
};
var en = {
  nav: "Settings Manager",
  hint: "Manage how plugin sections appear in global settings. Changes apply instantly: hidden sections leave the settings nav; drag or use the arrows to reorder.",
  hide: "Hide",
  show: "Show",
  moveUp: "Move up",
  moveDown: "Move down",
  reset: "Reset",
  resetAll: "Reset all",
  hiddenTag: "Hidden",
  noSections: "No settings sections registered",
  selfNote: "Provided by dsh-settings-manager; cannot be hidden.",
  dragHint: "Drag to reorder",
  rename: "Rename",
  renamePlaceholder: "Enter new name\u2026"
};
var NAV_SCROLL_CSS = [
  '[role="dialog"] nav { overflow-y: auto; padding-bottom: 12px; scrollbar-width: thin; }'
].join("\n");
var PANEL_CSS = [
  ".dsm-icon-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }",
  ".dsm-icon-btn:disabled { opacity: .35; cursor: default; }",
  ".dsm-icon-btn:disabled:hover { background: transparent; }",
  ".dsm-reset-all:hover { background: var(--dsw-alias-interactive-bg-hover); }",
  ".dsm-switch:disabled { opacity: .5; cursor: default; }",
  // Drag feedback via classes (not inline styles — see styles.row comment).
  ".dsm-row-dragging { opacity: .4; }",
  // Single insertion indicator element, positioned in the row gap at the
  // exact spot where the dragged section will land. Blue (business-primary)
  // reads as a placement cue rather than success.
  ".dsm-drop-indicator {",
  "  position: absolute; left: 2px; right: 2px; height: 2px;",
  "  border-radius: 1px; background: var(--dsw-alias-state-business-primary);",
  "  z-index: 2; pointer-events: none;",
  "}"
].join("\n");
function insertStyles(css) {
  if (typeof document === "undefined") return () => {
  };
  const style = document.createElement("style");
  style.setAttribute("data-plugin", "dsh-settings-manager");
  style.textContent = css;
  document.head.append(style);
  return () => style.remove();
}
function createEmitter() {
  const listeners = /* @__PURE__ */ new Set();
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit() {
      for (const fn of [...listeners]) {
        try {
          fn();
        } catch (error) {
        }
      }
    }
  };
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function createPolicy() {
  const state = { hidden: {}, order: {}, labels: {} };
  try {
    const raw = globalThis.localStorage ? globalThis.localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isRecord(parsed)) {
        if (isRecord(parsed.hidden)) state.hidden = parsed.hidden;
        if (isRecord(parsed.order)) state.order = parsed.order;
        if (isRecord(parsed.labels)) state.labels = parsed.labels;
      }
    }
  } catch (error) {
  }
  const emitter = createEmitter();
  let onChanged = null;
  function save() {
    try {
      if (globalThis.localStorage) {
        globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
    } catch (error) {
    }
  }
  function changed() {
    save();
    emitter.emit();
    if (onChanged) {
      try {
        onChanged();
      } catch (error) {
      }
    }
  }
  return {
    isHidden(id) {
      return id !== OWN_ID && state.hidden[id] === true;
    },
    orderFor(id) {
      const value = state.order[id];
      return typeof value === "number" && Number.isFinite(value) ? value : void 0;
    },
    labelFor(id) {
      const value = state.labels[id];
      return typeof value === "string" && value.length > 0 ? value : void 0;
    },
    effectiveOrder(id, registeredOrder) {
      const value = this.orderFor(id);
      return value !== void 0 ? value : typeof registeredOrder === "number" ? registeredOrder : 0;
    },
    setHidden(id, hidden) {
      if (id === OWN_ID) return;
      if (hidden) state.hidden[id] = true;
      else delete state.hidden[id];
      changed();
    },
    setOrder(id, order) {
      if (typeof order === "number" && Number.isFinite(order)) state.order[id] = order;
      else delete state.order[id];
      changed();
    },
    setOrders(orders) {
      let dirty = false;
      for (const [id, order] of Object.entries(orders)) {
        if (typeof order === "number" && Number.isFinite(order)) {
          if (state.order[id] !== order) {
            state.order[id] = order;
            dirty = true;
          }
        } else if (id in state.order) {
          delete state.order[id];
          dirty = true;
        }
      }
      if (dirty) changed();
    },
    setLabel(id, label) {
      const value = typeof label === "string" ? label.trim() : "";
      if (value.length > 0) state.labels[id] = value;
      else delete state.labels[id];
      changed();
    },
    reset(id) {
      delete state.hidden[id];
      delete state.order[id];
      delete state.labels[id];
      changed();
    },
    resetAll() {
      state.hidden = {};
      state.order = {};
      state.labels = {};
      changed();
    },
    applyToRead(options) {
      const order = this.orderFor(options.id);
      const label = this.labelFor(options.id);
      if (order === void 0 && label === void 0) return options;
      return {
        ...options,
        ...order !== void 0 ? { order } : {},
        ...label !== void 0 ? { label: () => label } : {}
      };
    },
    subscribe(fn) {
      return emitter.subscribe(fn);
    },
    setOnChanged(fn) {
      onChanged = fn;
    }
  };
}
function installPatches(ctx, policy) {
  let slotsService;
  try {
    slotsService = ctx.get("slots");
  } catch (error) {
    slotsService = void 0;
  }
  if (slotsService === void 0) return { installed: false };
  let proto;
  try {
    proto = Object.getPrototypeOf(slotsService);
  } catch (error) {
    proto = void 0;
  }
  if (!proto || typeof proto.register !== "function") return { installed: false };
  if (proto.__settingsManagerPatched) {
    const holder = proto.__settingsManagerPolicy;
    if (holder) holder.current = policy;
    proto.__settingsManagerCtx = ctx;
    return proto.__settingsManagerInterface || { installed: true };
  }
  const policyHolder = { current: policy };
  const origRegister = proto.register;
  const origEntries = proto.entries;
  const origEntriesOfSlot = proto.entriesOfSlot;
  const inventory = /* @__PURE__ */ new Map();
  proto.register = function register(rawOptions, component) {
    if (rawOptions && rawOptions.name === SECTION_SLOT && typeof rawOptions.id === "string") {
      inventory.set(rawOptions.id, {
        id: rawOptions.id,
        order: typeof rawOptions.order === "number" ? rawOptions.order : 0,
        label: rawOptions.label,
        priority: typeof rawOptions.priority === "number" ? rawOptions.priority : 0
      });
    }
    return origRegister.call(this, rawOptions, component);
  };
  proto.entries = function entries(key) {
    const rows = origEntries.call(this, key);
    if (key !== SECTION_SLOT) return rows;
    const p = policyHolder.current;
    const out = [];
    for (const entry of rows) {
      if (p.isHidden(entry.options.id)) continue;
      const order = p.orderFor(entry.options.id);
      const label = p.labelFor(entry.options.id);
      if (order === void 0 && label === void 0) {
        out.push(entry);
        continue;
      }
      out.push({ ...entry, options: p.applyToRead(entry.options) });
    }
    return out;
  };
  proto.entriesOfSlot = function entriesOfSlot(key) {
    const rows = origEntriesOfSlot.call(this, key);
    if (key !== SECTION_SLOT) return rows;
    return rows.filter((entry) => !policyHolder.current.isHidden(entry.options.id));
  };
  proto.__settingsManagerPatched = true;
  const iface = {
    installed: true,
    origEntries,
    inventory,
    bump() {
      try {
        const activeCtx = proto.__settingsManagerCtx || ctx;
        const slots = activeCtx.get("slots");
        if (!slots) return;
        const disposer = slots.register(
          { name: SECTION_SLOT, id: TOUCH_ID, order: 1e9, priority: 100, label: () => "" },
          () => null
        );
        if (typeof disposer === "function") disposer();
      } catch (error) {
      }
    }
  };
  proto.__settingsManagerPolicy = policyHolder;
  proto.__settingsManagerCtx = ctx;
  proto.__settingsManagerInterface = iface;
  return iface;
}
var styles = {
  wrap: { padding: "4px 2px" },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    marginBottom: "12px"
  },
  hint: {
    fontSize: "13px",
    lineHeight: "1.5",
    color: "var(--dsw-alias-label-tertiary)",
    margin: 0,
    flex: "1",
    minWidth: 0
  },
  resetAllBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    flex: "none",
    fontSize: "12px",
    lineHeight: "16px",
    padding: "6px 12px",
    borderRadius: "8px",
    cursor: "pointer",
    color: "var(--dsw-alias-label-primary)",
    background: "var(--dsw-alias-bg-layer-1)",
    border: "1px solid var(--dsw-alias-border-l2)"
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    position: "relative"
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "7px 10px",
    borderRadius: "10px",
    background: "var(--dsw-alias-bg-layer-1)",
    border: "1px solid var(--dsw-alias-border-l1)",
    cursor: "grab"
  },
  // Drag feedback lives in CSS classes (.dsm-row-dragging / .dsm-drop-before
  // / .dsm-drop-after), NOT inline styles: mixing the `border` shorthand above
  // with a `borderColor` longhand causes React's inline-style diffing to
  // corrupt the border when toggling the drop target.
  grip: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "none",
    color: "var(--dsw-alias-label-caption)",
    cursor: "grab",
    padding: 0,
    background: "none",
    border: "none"
  },
  rowMain: { display: "flex", flexDirection: "column", gap: "1px", minWidth: 0, flex: "1" },
  labelLine: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0 },
  label: {
    fontSize: "13px",
    fontWeight: 500,
    lineHeight: "18px",
    color: "var(--dsw-alias-label-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  },
  tag: {
    flex: "none",
    fontSize: "10px",
    lineHeight: "14px",
    padding: "1px 7px",
    borderRadius: "999px",
    color: "var(--dsw-alias-label-tertiary)",
    background: "var(--dsw-alias-interactive-bg-hover)"
  },
  meta: {
    fontSize: "11px",
    lineHeight: "15px",
    color: "var(--dsw-alias-label-caption)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  },
  renameInput: {
    flex: "1",
    minWidth: 0,
    fontSize: "13px",
    lineHeight: "18px",
    padding: "2px 8px",
    color: "var(--dsw-alias-label-primary)",
    background: "var(--dsw-alias-bg-layer-2)",
    border: "1px solid var(--dsw-alias-border-l2)",
    borderRadius: "6px",
    outline: "none"
  },
  rowActions: { display: "flex", alignItems: "center", gap: "2px", flex: "none" },
  iconBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "none",
    width: "26px",
    height: "26px",
    borderRadius: "7px",
    cursor: "pointer",
    color: "var(--dsw-alias-label-tertiary)",
    background: "transparent",
    border: "none",
    padding: 0
  },
  empty: { fontSize: "12px", color: "var(--dsw-alias-label-caption)" },
  switchTrack: {
    position: "relative",
    flex: "none",
    width: "34px",
    height: "20px",
    borderRadius: "999px",
    cursor: "pointer",
    padding: 0,
    border: "none",
    transition: "background-color .15s ease",
    background: "var(--dsw-alias-border-l2)"
  },
  switchKnob: {
    position: "absolute",
    top: "2px",
    left: "2px",
    width: "16px",
    height: "16px",
    borderRadius: "999px",
    background: "var(--dsw-alias-bg-base)",
    transition: "transform .15s ease",
    pointerEvents: "none"
  }
};
var SVG_COMMON = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: "false"
};
function svgIcon(name2) {
  const circles = (x, ys) => ys.map((cy, i) => import_react.default.createElement("circle", { key: `${x}-${i}`, cx: x, cy, r: 1, fill: "currentColor", stroke: "none" }));
  const paths = (ds) => ds.map((d, i) => import_react.default.createElement("path", { key: i, d }));
  const content = {
    grip: () => [...circles(9, [5, 12, 19]), ...circles(15, [5, 12, 19])],
    up: () => paths(["m5 9 3-3 3 3"]),
    down: () => paths(["m5 7 3 3 3-3"]),
    reset: () => paths(["M3 12a9 9 0 1 0 2.64-6.36L3 8", "M3 3v5h5"]),
    pencil: () => paths(["M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"])
  };
  return import_react.default.createElement("svg", SVG_COMMON, content[name2] ? content[name2]() : null);
}
function resolveLabel(label) {
  if (typeof label === "function") return label();
  return typeof label === "string" ? label : "";
}
function resolvePlace(clientY, rect, current) {
  const mid = rect.top + rect.height / 2;
  const band = rect.height * 0.2;
  if (clientY < mid - band) return "before";
  if (clientY > mid + band) return "after";
  return current ?? (clientY < mid ? "before" : "after");
}
function createManagerSection(env) {
  const { slots, policy, readSections, reorder, reset, resetAll, t } = env;
  function ManagerSection() {
    const [, force] = import_react.default.useReducer((value) => value + 1, 0);
    const dragId = import_react.default.useRef(null);
    const [overId, setOverId] = import_react.default.useState(null);
    const [overPlace, setOverPlace] = import_react.default.useState(null);
    const [indicatorY, setIndicatorY] = import_react.default.useState(null);
    const listRef = import_react.default.useRef(null);
    const editingIdRef = import_react.default.useRef(null);
    const [editingId, setEditingId] = import_react.default.useState(null);
    const [draft, setDraft] = import_react.default.useState("");
    import_react.default.useEffect(() => {
      let offSlot = () => {
      };
      let offPolicy = () => {
      };
      try {
        offSlot = slots.subscribe(SECTION_SLOT, force);
      } catch (error) {
      }
      offPolicy = policy.subscribe(force);
      return () => {
        offSlot();
        offPolicy();
      };
    }, []);
    const rows = readSections();
    function clearDragTarget() {
      if (overId !== null || overPlace !== null || indicatorY !== null) {
        setOverId(null);
        setOverPlace(null);
        setIndicatorY(null);
      }
    }
    function startEdit(row) {
      editingIdRef.current = row.id;
      setEditingId(row.id);
      setDraft(row.label);
    }
    function commitEdit(id) {
      if (editingIdRef.current !== id) return;
      editingIdRef.current = null;
      const row = rows.find((r) => r.id === id);
      const value = draft.trim();
      if (row && value !== "" && value !== row.originalLabel) policy.setLabel(id, value);
      else policy.setLabel(id, "");
      setEditingId(null);
      setDraft("");
    }
    function cancelEdit() {
      editingIdRef.current = null;
      setEditingId(null);
      setDraft("");
    }
    function computeIndicatorY(rect, place) {
      const listRect = listRef.current ? listRef.current.getBoundingClientRect() : null;
      if (!listRect) return null;
      return place === "before" ? rect.top - listRect.top - 3 : rect.bottom - listRect.top + 1;
    }
    function handleDragStart(e, id) {
      dragId.current = id;
      try {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
      } catch (error) {
      }
      force();
    }
    function handleDragOver(e, id) {
      if (dragId.current === id) {
        clearDragTarget();
        return;
      }
      e.preventDefault();
      try {
        e.dataTransfer.dropEffect = "move";
      } catch (error) {
      }
      const rect = e.currentTarget.getBoundingClientRect();
      const place = resolvePlace(e.clientY, rect, overPlace);
      if (overId !== id) setOverId(id);
      if (overPlace !== place) setOverPlace(place);
      const y = computeIndicatorY(rect, place);
      if (indicatorY !== y) setIndicatorY(y);
    }
    function handleListDragOver(e) {
      e.preventDefault();
      try {
        e.dataTransfer.dropEffect = "move";
      } catch (error) {
      }
    }
    function handleListDragLeave(e) {
      if (!e.currentTarget.contains(e.relatedTarget)) clearDragTarget();
    }
    function handleListDrop(e) {
      e.preventDefault();
      const movedId = dragId.current || e.dataTransfer && e.dataTransfer.getData("text/plain");
      const targetId = overId;
      const place = overPlace;
      dragId.current = null;
      clearDragTarget();
      force();
      if (!movedId || !targetId || !place) return;
      reorder(movedId, targetId, place);
    }
    function handleDrop(e, id) {
      e.preventDefault();
      e.stopPropagation();
      const movedId = dragId.current || e.dataTransfer && e.dataTransfer.getData("text/plain");
      dragId.current = null;
      clearDragTarget();
      force();
      if (!movedId || movedId === id) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const place = resolvePlace(e.clientY, rect, overPlace);
      reorder(movedId, id, place);
    }
    function handleDragEnd() {
      dragId.current = null;
      clearDragTarget();
      force();
    }
    function renderRow(row, index) {
      const isOwn = row.id === OWN_ID;
      const editing = editingId === row.id;
      const dragging = !editing && dragId.current === row.id;
      const className = ["dsm-row", dragging ? "dsm-row-dragging" : ""].filter(Boolean).join(" ");
      const prev = rows[index - 1];
      const next = rows[index + 1];
      const labelNode = editing ? import_react.default.createElement("input", {
        className: "dsm-rename-input",
        autoFocus: true,
        value: draft,
        style: styles.renameInput,
        placeholder: t("renamePlaceholder"),
        onChange: (e) => setDraft(e.target.value),
        onBlur: () => commitEdit(row.id),
        onKeyDown: (e) => {
          if (e.key === "Enter") commitEdit(row.id);
          else if (e.key === "Escape") cancelEdit();
        }
      }) : import_react.default.createElement("span", { style: styles.label }, row.label);
      return import_react.default.createElement(
        "li",
        {
          key: row.id,
          draggable: !editing,
          className,
          style: styles.row,
          onDragStart: (e) => handleDragStart(e, row.id),
          onDragOver: (e) => handleDragOver(e, row.id),
          onDrop: (e) => handleDrop(e, row.id),
          onDragEnd: handleDragEnd
        },
        import_react.default.createElement("span", { style: styles.grip, title: t("dragHint") }, svgIcon("grip")),
        import_react.default.createElement(
          "div",
          { style: styles.rowMain },
          import_react.default.createElement(
            "span",
            { style: styles.labelLine },
            labelNode,
            row.hidden ? import_react.default.createElement("span", { style: styles.tag }, t("hiddenTag")) : null
          ),
          import_react.default.createElement(
            "span",
            { style: styles.meta },
            `${row.id}${row.registrant ? " \xB7 " + row.registrant : ""}`
          )
        ),
        import_react.default.createElement(
          "button",
          {
            type: "button",
            className: "dsm-switch",
            role: "switch",
            "aria-checked": !row.hidden,
            disabled: isOwn,
            title: isOwn ? t("selfNote") : row.hidden ? t("show") : t("hide"),
            onClick: () => policy.setHidden(row.id, !row.hidden),
            style: {
              ...styles.switchTrack,
              ...row.hidden ? {} : { background: "var(--dsw-alias-state-success-primary)" }
            }
          },
          import_react.default.createElement("span", {
            style: {
              ...styles.switchKnob,
              transform: row.hidden ? "translateX(0)" : "translateX(14px)"
            }
          })
        ),
        import_react.default.createElement(
          "div",
          { style: styles.rowActions },
          import_react.default.createElement(
            "button",
            {
              type: "button",
              className: "dsm-icon-btn",
              title: t("moveUp"),
              "aria-label": t("moveUp"),
              style: styles.iconBtn,
              disabled: prev === void 0,
              onClick: () => reorder(row.id, prev.id, "before")
            },
            svgIcon("up")
          ),
          import_react.default.createElement(
            "button",
            {
              type: "button",
              className: "dsm-icon-btn",
              title: t("moveDown"),
              "aria-label": t("moveDown"),
              style: styles.iconBtn,
              disabled: next === void 0,
              onClick: () => reorder(row.id, next.id, "after")
            },
            svgIcon("down")
          ),
          import_react.default.createElement(
            "button",
            {
              type: "button",
              className: "dsm-icon-btn",
              title: t("rename"),
              "aria-label": t("rename"),
              style: styles.iconBtn,
              disabled: editing,
              onClick: () => startEdit(row)
            },
            svgIcon("pencil")
          ),
          import_react.default.createElement(
            "button",
            {
              type: "button",
              className: "dsm-icon-btn",
              title: t("reset"),
              "aria-label": t("reset"),
              style: styles.iconBtn,
              onClick: () => reset(row.id)
            },
            svgIcon("reset")
          )
        )
      );
    }
    const header = import_react.default.createElement(
      "div",
      { style: styles.header },
      import_react.default.createElement("p", { style: styles.hint }, t("hint")),
      import_react.default.createElement(
        "button",
        {
          type: "button",
          className: "dsm-reset-all",
          onClick: () => resetAll(),
          style: styles.resetAllBtn,
          title: t("resetAll")
        },
        svgIcon("reset"),
        import_react.default.createElement("span", null, t("resetAll"))
      )
    );
    const body = rows.length === 0 ? import_react.default.createElement("p", { style: styles.empty }, t("noSections")) : import_react.default.createElement(
      "ul",
      {
        ref: listRef,
        style: styles.list,
        onDragOver: handleListDragOver,
        onDragLeave: handleListDragLeave,
        onDrop: handleListDrop
      },
      // Single insertion indicator, positioned in the row gap; persists
      // across the gaps so it never blinks while dragging.
      indicatorY !== null ? import_react.default.createElement("div", { className: "dsm-drop-indicator", style: { top: indicatorY } }) : null,
      rows.map((row, index) => renderRow(row, index))
    );
    return import_react.default.createElement("div", { style: styles.wrap }, header, body);
  }
  return ManagerSection;
}
function globals() {
  return globalThis;
}
var name = "dsh-settings-manager";
var inject = ["slots", "locale"];
function apply(ctx) {
  const slots = ctx.get("slots");
  if (slots === void 0) return;
  const locale = ctx.get("locale");
  if (locale !== void 0) {
    ctx.effect(
      () => {
        locale.register(LOCALE_NS, { zh, en });
        return () => {
        };
      },
      "dsh-settings-manager: dictionaries"
    );
  }
  const t = locale !== void 0 ? locale.bind(LOCALE_NS) : (key) => key;
  ctx.effect(() => insertStyles(NAV_SCROLL_CSS + "\n" + PANEL_CSS), "dsh-settings-manager: styles");
  const policy = createPolicy();
  const patch = installPatches(ctx, policy);
  if (!patch.installed) return;
  policy.setOnChanged(patch.bump);
  patch.bump();
  const readSections = () => {
    let entries;
    try {
      entries = patch.origEntries.call(slots, SECTION_SLOT);
    } catch (error) {
      entries = [];
    }
    return entries.map((entry, seq) => {
      const originalLabel = resolveLabel(entry.options.label) || entry.options.id;
      return {
        id: entry.options.id,
        label: policy.labelFor(entry.options.id) ?? originalLabel,
        originalLabel,
        registrant: entry.options.registrant,
        order: policy.effectiveOrder(entry.options.id, entry.options.order),
        hidden: policy.isHidden(entry.options.id),
        seq
      };
    }).sort((a, b) => a.order - b.order || a.seq - b.seq);
  };
  const reorder = (movedId, targetId, place) => {
    const rows = readSections();
    const src = rows.findIndex((row) => row.id === movedId);
    if (src === -1) return;
    const list = rows.map((row) => row.id);
    list.splice(src, 1);
    let ins = list.indexOf(targetId);
    if (ins === -1) return;
    if (place === "after") ins += 1;
    list.splice(ins, 0, movedId);
    const orders = {};
    list.forEach((id, index) => {
      orders[id] = index * 10;
    });
    policy.setOrders(orders);
  };
  const env = { slots, policy, readSections, reorder, reset: policy.reset, resetAll: policy.resetAll, t };
  const ManagerSection = createManagerSection(env);
  slots.inject(
    SECTION_SLOT,
    () => slots.register(
      {
        name: SECTION_SLOT,
        id: OWN_ID,
        order: OWN_ORDER,
        label: () => t("nav"),
        locale: LOCALE_NS
      },
      () => import_react.default.createElement(ManagerSection)
    )
  );
  if (globals().__DSH_SETTINGS_MANAGER_TEST__) {
    const seam = {
      policy,
      readSections,
      reorder,
      setOrders: policy.setOrders,
      reset: policy.reset,
      resetAll: policy.resetAll,
      patch,
      inventory: patch.inventory
    };
    globals().__DSH_SETTINGS_MANAGER_SEAM__ = seam;
  }
}

    return module.exports
  },
});
