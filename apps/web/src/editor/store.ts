import {
  History,
  clone,
  example,
  parseProject,
  validate,
  type Project,
  type SceneObject,
  type Vec,
} from "@sketch/core";
export type Mode = "editing" | "processing" | "preview" | "running" | "paused";
export type Tool =
  "select" | "draw" | "lasso" | "ball" | "track" | "cup" | "spring" | "erase";
type State = {
  project: Project;
  selected: string[];
  mode: Mode;
  tool: Tool;
  preview?: Project;
  message: string;
  saveStatus: string;
  anchor?: Vec;
  showOriginal: boolean;
  penColor: string;
  penWidth: number;
};
const history = new History();
let state: State = {
  project: example(),
  selected: [],
  mode: "editing",
  tool: "select",
  message: "试试播放，或画一条属于你的轨道。",
  saveStatus: "正在恢复…",
  showOriginal: false,
  penColor: "#5668de",
  penWidth: 0.045,
};
const listeners = new Set<() => void>();
export const store = {
  get: () => state,
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  set: (patch: Partial<State>) => {
    state = { ...state, ...patch };
    listeners.forEach((f) => f());
  },
  commit: (p: Project, label = "已应用修改") => {
    try {
      store.set({
        project: history.commit(state.project, p),
        preview: undefined,
        mode: "editing",
        message: label,
      });
    } catch (e) {
      store.set({ message: (e as Error).message });
    }
  },
  change: (fn: (p: Project) => void, label?: string) => {
    if (state.mode !== "editing") return;
    const next = clone(state.project);
    fn(next);
    for (const t of next.scene.objectives)
      if (
        !next.scene.objects.some((o) => o.id === t.ballId) ||
        !next.scene.objects.some((o) => o.id === t.cupId)
      )
        t.enabled = false;
    store.commit(next, label);
  },
  update: (id: string, fn: (o: SceneObject) => void) =>
    store.change((p) => {
      const o = p.scene.objects.find((o) => o.id === id);
      if (o) fn(o);
    }),
  undo: () => {
    if (state.mode === "editing")
      store.set({ project: history.undo(state.project), message: "已撤销" });
  },
  redo: () => {
    if (state.mode === "editing")
      store.set({ project: history.redo(state.project), message: "已重做" });
  },
  replace: (raw: unknown) => {
    const project = parseProject(raw);
    history.undoStack = [];
    history.redoStack = [];
    store.set({
      project,
      selected: [],
      mode: "editing",
      preview: undefined,
      anchor: undefined,
      message: "场景已加载，撤销历史从这里开始",
    });
  },
  preview: (project: Project, message: string) => {
    const bad = validate(project.scene).find((i) => i.severity === "invalid");
    if (bad) {
      store.set({ message: bad.message });
      return;
    }
    store.set({ preview: project, mode: "preview", message });
  },
};
