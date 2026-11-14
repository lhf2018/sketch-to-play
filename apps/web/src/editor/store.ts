import {
  challenges,
  challengeProject,
  challengeViolation,
} from "../../../../packages/core/src/challenges";
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
  | "select"
  | "draw"
  | "lasso"
  | "ball"
  | "track"
  | "cup"
  | "spring"
  | "block"
  | "seesaw"
  | "erase";
type State = {
  project: Project;
  challenge?: number;
  challengeWon: boolean;
  challengeFailed: boolean;
  completed: string[];
  speed: number;
  showTrails: boolean;
  predicting: boolean;
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
  challengeWon: false,
  challengeFailed: false,
  completed: [],
  speed: 1,
  showTrails: true,
  predicting: false,
  selected: [],
  mode: "editing",
  tool: "select",
  message: "试试播放，或画一条属于你的轨道。",
  saveStatus: "正在恢复…",
  showOriginal: false,
  penColor: "#5668de",
  penWidth: 0.045,
};
let freeProject: Project | undefined;
function persistChallenge() {
  if (state.challenge === undefined) return;
  try {
    localStorage.setItem(
      `sketch-challenge-${state.challenge}`,
      JSON.stringify(state.project),
    );
  } catch {
    /* The main autosave UI reports storage availability. */
  }
}
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
      if (state.challenge !== undefined) {
        const error = challengeViolation(
          challengeProject(state.challenge),
          p,
          challenges[state.challenge].maxStrokes,
        );
        if (error) throw Error(error);
      }
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
    for (const joint of next.scene.constraints) {
      const before = state.project.scene.objects.find(
        (o) => o.id === joint.bodyId,
      );
      const after = next.scene.objects.find((o) => o.id === joint.bodyId);
      if (before && after)
        joint.anchor = [
          joint.anchor[0] +
            after.transform.position[0] -
            before.transform.position[0],
          joint.anchor[1] +
            after.transform.position[1] -
            before.transform.position[1],
        ];
    }
    next.scene.constraints = next.scene.constraints.filter((j) =>
      next.scene.objects.some((o) => o.id === j.bodyId && o.kind === "block"),
    );
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
      tool: "select",
      selected: [],
      mode: "editing",
      preview: undefined,
      anchor: undefined,
      message: "场景已加载，撤销历史从这里开始",
    });
  },
  enterChallenge: (index: number, restore = true) => {
    if (!challenges[index]) return;
    persistChallenge();
    if (state.challenge === undefined) freeProject = clone(state.project);
    let project = challengeProject(index);
    try {
      const saved = localStorage.getItem(`sketch-challenge-${index}`);
      if (restore && saved) {
        const candidate = parseProject(JSON.parse(saved));
        if (
          !challengeViolation(project, candidate, challenges[index].maxStrokes)
        )
          project = candidate;
      }
    } catch {
      /* Invalid draft falls back to initial level. */
    }
    store.replace(project);
    store.set({
      challenge: index,
      challengeWon: false,
      challengeFailed: false,
      tool: "draw",
      message: challenges[index].hint,
    });
  },
  leaveChallenge: () => {
    persistChallenge();
    const project = freeProject;
    store.set({
      challenge: undefined,
      challengeWon: false,
      challengeFailed: false,
    });
    if (project) store.replace(project);
    freeProject = undefined;
  },
  completeChallenge: () => {
    if (state.challenge === undefined || state.challengeWon) return;
    const completed = [
      ...new Set([...state.completed, challenges[state.challenge].id]),
    ];
    store.set({
      completed,
      challengeWon: true,
      mode: "paused",
      message: "挑战成功！可以尝试另一种解法，或进入下一关。",
    });
    try {
      localStorage.setItem("sketch-completed", JSON.stringify(completed));
    } catch {
      store.set({ message: "挑战成功，但进度保存失败，请检查浏览器存储空间" });
    }
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
