import { challenges } from "../../../packages/core/src/challenges";
import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createRoot } from "react-dom/client";
import {
  applyPatch,
  clone,
  emptyProject,
  example,
  chainExample,
  fitStroke,
  parseProject,
  validate,
  makeObject,
  repairScene,
  steepenTrack,
  type Project,
  type SceneObject,
} from "@sketch/core";
import { store, type Tool } from "./editor/store";
import {
  Canvas,
  play,
  resetSimulation,
  runtime,
  previewTrajectory,
  singleStep,
} from "./canvas/Canvas";
import { load, save, markLoaded } from "./persistence/storage";
import { cropStrokes } from "./ai/crop";
import "./style.css";

// Dev-only bridge for browser regression and measurement; removed in production.
if (import.meta.env.DEV)
  Object.assign(window, {
    __SKETCH_DEV__: {
      store,
      play,
      resetSimulation,
      runtime,
      emptyProject,
      makeObject,
    },
  });

const names = {
  ball: "小球",
  track: "轨道",
  cup: "杯子",
  spring: "弹簧",
  block: "木块",
  seesaw: "跷跷板",
};
const tools: Array<{ id: Tool; icon: string; label: string; key: string }> = [
  { id: "select", icon: "↖", label: "选择", key: "V" },
  { id: "draw", icon: "✎", label: "画笔", key: "P" },
  { id: "lasso", icon: "▧", label: "多选", key: "L" },
  { id: "erase", icon: "▱", label: "擦除", key: "E" },
];
function App() {
  const s = useSyncExternalStore(store.subscribe, store.get),
    [booted, setBooted] = useState(false),
    [prompt, setPrompt] = useState(""),
    [ai, setAi] = useState({ enabled: false, model: "", image: false }),
    [showExamples, setShowExamples] = useState(false),
    [showHelp, setShowHelp] = useState(false),
    [showChallenges, setShowChallenges] = useState(false),
    [recognition, setRecognition] = useState<ReturnType<typeof cropStrokes>>();
  const input = useRef<HTMLInputElement>(null),
    request = useRef<AbortController | undefined>(undefined),
    epoch = useRef(0),
    activeId = useRef("");
  const project = s.project,
    editing = s.mode === "editing";
  const challenge =
    s.challenge !== undefined ? challenges[s.challenge] : undefined;
  const selected = project.scene.objects.find((o) => o.id === s.selected[0]);
  const issues = validate(project.scene);
  const pending = project.strokes.filter((x) => x.status !== "converted");
  useEffect(() => {
    let alive = true;
    load()
      .then((p) => {
        if (!alive) return;
        if (p) {
          markLoaded(p);
          store.replace(p);
        }
        try {
          const completed = JSON.parse(
            localStorage.getItem("sketch-completed") ?? "[]",
          );
          if (Array.isArray(completed))
            store.set({
              completed: completed.filter(
                (v: unknown) => typeof v === "string",
              ),
            });
          const active = localStorage.getItem("sketch-active-challenge");
          if (active !== null && challenges[Number(active)])
            store.enterChallenge(Number(active));
        } catch {
          /* Browser storage is optional. */
        }
        setBooted(true);
      })
      .catch((e) => {
        if (alive) {
          store.set({ message: `恢复失败：${e.message}` });
          setBooted(true);
        }
      });
    fetch("/api/capabilities")
      .then((r) => r.json())
      .then(setAi)
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!booted) return;
    store.set({ saveStatus: "保存中…" });
    const current = project;
    const challengeIndex = s.challenge;
    const timer = setTimeout(() => {
      (challengeIndex === undefined
        ? save(current)
        : Promise.resolve().then(() => {
            localStorage.setItem(
              `sketch-challenge-${challengeIndex}`,
              JSON.stringify(current),
            );
            localStorage.setItem(
              "sketch-active-challenge",
              String(challengeIndex),
            );
          })
      )
        .then(() => {
          if (store.get().project === current)
            store.set({ saveStatus: "已保存在本机" });
        })
        .catch((e) =>
          store.set({ saveStatus: "保存失败", message: e.message }),
        );
    }, 500);
    return () => clearTimeout(timer);
  }, [project, booted, s.challenge]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches("input,textarea,select")) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (["editing", "running", "paused"].includes(store.get().mode))
          void start();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        e.shiftKey ? store.redo() : store.undo();
      }
      if (e.key === "Escape") {
        if (store.get().mode === "preview")
          store.set({ mode: "editing", preview: undefined });
        else if (["running", "paused"].includes(store.get().mode))
          resetSimulation();
      }
      if (store.get().mode === "editing") {
        if (e.key.toLowerCase() === "b") store.set({ tool: "draw" });
        const t = tools.find(
          (t) => t.key.toLowerCase() === e.key.toLowerCase(),
        );
        if (t) store.set({ tool: t.id });
        if (e.key === "Delete" || e.key === "Backspace") remove();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (store.get().saveStatus !== "已保存在本机") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, []);
  async function openChallenge(index: number, restore = true) {
    try {
      if (store.get().challenge === undefined) await save(store.get().project);
      resetSimulation();
      store.enterChallenge(index, restore);
      setShowChallenges(false);
    } catch (e) {
      store.set({ message: `无法进入挑战：${(e as Error).message}` });
    }
  }
  function leaveChallenge() {
    resetSimulation();
    store.leaveChallenge();
    try {
      localStorage.removeItem("sketch-active-challenge");
    } catch {
      /* Optional storage. */
    }
  }
  async function replace(p: Project) {
    try {
      if (store.get().challenge !== undefined) {
        store.set({ message: "请先返回自由创作，再切换或导入场景" });
        return;
      }
      await save(store.get().project);
      epoch.current++;
      resetSimulation();
      store.replace(p);
      setShowExamples(false);
    } catch (e) {
      store.set({
        message: `无法切换：${(e as Error).message}。请先导出备份。`,
      });
    }
  }
  async function start() {
    await play();
  }
  function remove() {
    store.change((p) => {
      p.scene.objects = p.scene.objects.filter(
        (o) => !store.get().selected.includes(o.id),
      );
    }, "已删除选择对象");
    store.set({ selected: [] });
  }
  function convert() {
    const next = clone(project);
    let n = 0;
    for (const stroke of next.strokes) {
      if (stroke.status === "converted") continue;
      const o = fitStroke(stroke);
      if (o) {
        next.scene.objects.push(o);
        stroke.status = "converted";
        n++;
      }
    }
    if (!n) {
      store.set({
        message:
          "没有识别出支持的形状。试画开放线条或直径 0.2–1 米的圆，也可直接放置组件。",
      });
      return;
    }
    store.preview(next, `识别出 ${n} 个对象。检查轮廓，确认后应用。`);
  }
  async function editAI() {
    if (!prompt.trim() || !s.selected.length) return;
    const controller = new AbortController();
    request.current = controller;
    const id = crypto.randomUUID(),
      capturedEpoch = epoch.current,
      base = clone(project);
    activeId.current = id;
    store.set({ mode: "processing", message: "正在理解局部修改…" });
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch("/api/ai/edit", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: id,
          sceneId: project.scene.sceneId,
          baseRevision: project.scene.revision,
          sessionEpoch: capturedEpoch,
          instruction: prompt,
          targetIds: s.selected,
          anchor: s.anchor,
          scene: project.scene,
        }),
      });
      const result = await response.json();
      if (activeId.current !== id || epoch.current !== capturedEpoch) return;
      if (!response.ok) throw Error(result.error ?? "模型请求失败");
      if (result.status !== "ok")
        throw Error(result.explanation ?? "请补充位置或修改意图");
      const next = applyPatch(
        store.get().project.scene,
        result.patch,
        s.selected,
        base.scene.revision,
        s.anchor,
      );
      store.preview({ ...base, scene: next }, result.patch.explanation);
    } catch (e) {
      if (activeId.current === id)
        store.set({
          mode: "editing",
          message: controller.signal.aborted
            ? "请求已取消或超时，场景保持不变"
            : (e as Error).message,
        });
    } finally {
      clearTimeout(timeout);
    }
  }
  function cancel() {
    activeId.current = "";
    request.current?.abort();
    runtime.generation++;
    store.set({
      mode: "editing",
      preview: undefined,
      message: "已取消，设计稿保持不变",
    });
  }
  async function recognize() {
    if (!recognition) return;
    const base = clone(project),
      strokes = base.strokes
        .filter((s) => s.status !== "converted")
        .slice(0, 20),
      controller = new AbortController(),
      id = crypto.randomUUID(),
      capturedEpoch = epoch.current;
    activeId.current = id;
    request.current = controller;
    setRecognition(undefined);
    store.set({ mode: "processing", message: "正在理解这些笔迹…" });
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch("/api/ai/recognize", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: id,
          scene: base.scene,
          strokeIds: strokes.map((s) => s.id),
          ...recognition,
        }),
      });
      const result = await response.json();
      if (activeId.current !== id || epoch.current !== capturedEpoch) return;
      if (!response.ok) throw Error(result.error);
      if (store.get().project.scene.revision !== base.scene.revision)
        throw Error("场景已经改变，请重新识别");
      const objects = result.objects as SceneObject[];
      const next = parseProject({
        ...base,
        scene: { ...base.scene, objects: [...base.scene.objects, ...objects] },
        strokes: base.strokes.map((s) =>
          objects.some((o) => o.sourceStrokeIds.includes(s.id))
            ? { ...s, status: "converted" }
            : s,
        ),
      });
      store.preview(next, result.explanation ?? "检查识别轮廓后应用。");
    } catch (e) {
      if (activeId.current === id)
        store.set({
          mode: "editing",
          message: controller.signal.aborted
            ? "识别已取消或超时，原笔迹仍保留"
            : (e as Error).message,
        });
    } finally {
      clearTimeout(timeout);
    }
  }
  function exportFile() {
    const blob = new Blob([JSON.stringify(project, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `sketch-${project.scene.sceneId.slice(0, 8)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function fix() {
    const base = clone(s.preview ?? project);
    base.scene = repairScene(base.scene);
    store.preview(base, "已生成移回边界 / 分开重叠的候选位置，请确认后应用。");
  }
  function excludeCandidate(id: string) {
    if (!s.preview) return;
    const next = clone(s.preview),
      removed = next.scene.objects.find((o) => o.id === id);
    next.scene.objects = next.scene.objects.filter((o) => o.id !== id);
    next.strokes.forEach((stroke) => {
      if (removed?.sourceStrokeIds.includes(stroke.id))
        stroke.status = "pending";
    });
    store.set({ preview: next });
  }
  function candidateType(id: string, kind: SceneObject["kind"]) {
    if (!s.preview) return;
    const next = clone(s.preview),
      index = next.scene.objects.findIndex((o) => o.id === id),
      old = next.scene.objects[index],
      object = makeObject(kind, [...old.transform.position]);
    object.id = old.id;
    object.sourceStrokeIds = old.sourceStrokeIds;
    if (old.kind === "track" && old.shape.points.length) {
      const a = old.shape.points[0],
        b = old.shape.points.at(-1)!;
      object.transform.position = [
        old.transform.position[0] + (a[0] + b[0]) / 2,
        old.transform.position[1] + (a[1] + b[1]) / 2,
      ];
    }
    next.scene.objects[index] = object;
    store.set({ preview: next });
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw Error("文件不得超过 2 MiB");
      const parsed = parseProject(JSON.parse(await file.text()));
      await replace(parsed);
    } catch (e) {
      store.set({ message: `导入失败：${(e as Error).message}` });
    }
    if (input.current) input.current.value = "";
  }
  if (!booted)
    return (
      <div className="boot-screen">
        <span className="brand-mark">s</span>
        <p>正在打开你的物理游乐场…</p>
      </div>
    );
  const changed = s.preview?.scene.objects.filter(
    (o) =>
      JSON.stringify(o) !==
      JSON.stringify(project.scene.objects.find((b) => b.id === o.id)),
  );
  return (
    <div className="app-shell">
      <header className="header">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-mark">
            s<span>↗</span>
          </span>
          <div>
            sketch<span className="brand-to"> to </span>play
            <small>把想象，交给物理。</small>
          </div>
        </a>
        <div className="document-name">
          <span className="document-dot" />
          我的物理游乐场 <span className="tag">本地草稿</span>
        </div>
        <nav>
          <button onClick={() => setShowHelp(true)}>
            使用指南 <span>↗</span>
          </button>
        </nav>
      </header>
      <section className="topbar">
        <div className="breadcrumbs">
          工作台 <span>/</span> {challenge ? "挑战模式" : "自由创作"}{" "}
          <span className="save-state">● {s.saveStatus}</span>
        </div>
        <div className="file-actions">
          <button
            disabled={!["editing", "running", "paused"].includes(s.mode)}
            onClick={() => setShowChallenges(true)}
          >
            ⚑ 挑战模式
          </button>
          {challenge && (
            <button
              disabled={!["editing", "running", "paused"].includes(s.mode)}
              onClick={leaveChallenge}
            >
              返回自由创作
            </button>
          )}
          <button
            disabled={!editing}
            onClick={() => void replace(emptyProject())}
          >
            ＋ 新建
          </button>
          <button
            disabled={!editing}
            onClick={() => setShowExamples(!showExamples)}
          >
            ▦ 示例场景
          </button>
          <button disabled={!editing} onClick={() => input.current?.click()}>
            ↥ 导入
          </button>
          <button onClick={exportFile}>↧ 导出场景</button>
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => void importFile(e.target.files?.[0])}
          />
        </div>
      </section>
      <main className="workspace">
        <section className="stage-column">
          <div className="stage-heading">
            <div>
              <span className="eyebrow">YOUR LITTLE PHYSICS LAB</span>
              <h1>
                画出来，<em>玩起来。</em>
              </h1>
              <p>几笔涂鸦，一点重力，还有无限种可能。</p>
            </div>
            <div className="world-label">
              2D 沙盒<span>12 × 8 m · 地球重力</span>
            </div>
          </div>
          {challenge && (
            <section className="challenge-banner" aria-label="当前挑战">
              <div>
                <strong>
                  {s.challenge! + 1} / 5 · {challenge.title}
                </strong>
                <p>{challenge.hint}</p>
                <small>
                  固定组件已锁定 · 已画 {project.strokes.length} /{" "}
                  {challenge.maxStrokes} 笔 · 30 秒内稳定入杯
                </small>
              </div>
              <div>
                <button
                  disabled={!["editing", "running", "paused"].includes(s.mode)}
                  onClick={() => openChallenge(s.challenge!, false)}
                >
                  重新开始
                </button>
                {s.challengeWon && (
                  <>
                    <strong role="alert">挑战成功！</strong>
                    <button
                      onClick={() =>
                        s.challenge! < 4
                          ? openChallenge(s.challenge! + 1)
                          : setShowChallenges(true)
                      }
                    >
                      {s.challenge! < 4 ? "下一关" : "查看全部挑战"}
                    </button>
                  </>
                )}
              </div>
            </section>
          )}
          <div className="canvas-frame">
            <div className="canvas-toolbar">
              <div className="tool-group">
                {tools.map((t) => (
                  <button
                    key={t.id}
                    title={`${t.label} (${t.key})`}
                    aria-label={t.label}
                    disabled={!editing}
                    className={s.tool === t.id ? "active" : ""}
                    onClick={() =>
                      store.set({
                        tool: t.id,
                        ...(t.id === "lasso"
                          ? {
                              message:
                                "拖出蓝色矩形框选对象；也可用选择工具在空白处拖动框选",
                            }
                          : {}),
                      })
                    }
                  >
                    <span>{t.icon}</span>
                    <small>{t.label}</small>
                  </button>
                ))}
              </div>
              <div className="divider" />
              <button
                className="history-button"
                aria-label="撤销"
                disabled={!editing}
                onClick={store.undo}
              >
                ↶
              </button>
              <button
                className="history-button"
                aria-label="重做"
                disabled={!editing}
                onClick={store.redo}
              >
                ↷
              </button>
              <div className="toolbar-spacer" />
              <button
                className="original-button"
                onClick={() => store.set({ showOriginal: !s.showOriginal })}
              >
                {s.showOriginal ? "隐藏原稿" : "显示原稿"}
              </button>
              <button
                className="original-button"
                disabled={!editing || !pending.length || !ai.image}
                title={
                  ai.image ? "上传预览中的待转换笔迹" : "需配置支持图片的模型"
                }
                onClick={() => {
                  try {
                    setRecognition(cropStrokes(pending.slice(0, 20)));
                  } catch (e) {
                    store.set({ message: (e as Error).message });
                  }
                }}
              >
                ✧ AI 识别
              </button>
              <button
                className="convert-button"
                disabled={!editing || !pending.length}
                onClick={convert}
              >
                ✧ 转换笔迹 {pending.length > 0 && <b>{pending.length}</b>}
              </button>
            </div>
            <div className="canvas-container">
              {s.tool === "draw" && (
                <div className="pen-options">
                  <span>画笔</span>
                  {["#5668de", "#31947b", "#e2a244", "#df7b85", "#344354"].map(
                    (color) => (
                      <button
                        key={color}
                        aria-label={`画笔颜色 ${color}`}
                        aria-pressed={s.penColor === color}
                        style={{ background: color }}
                        onClick={() => store.set({ penColor: color })}
                      />
                    ),
                  )}
                  <label>
                    粗细
                    <input
                      aria-label="画笔粗细"
                      type="range"
                      min="0.015"
                      max="0.12"
                      step="0.005"
                      value={s.penWidth}
                      onChange={(e) =>
                        store.set({ penWidth: Number(e.target.value) })
                      }
                    />
                  </label>
                  <small>画完即可碰撞 · 粗细就是实体厚度</small>
                </div>
              )}
              <Canvas />
              <span className="canvas-caption">
                {s.mode === "running"
                  ? "● LIVE SIMULATION"
                  : s.mode === "paused"
                    ? "Ⅱ PAUSED"
                    : "✎ EDIT YOUR WORLD"}
              </span>
              <div className="canvas-scale">↔ 1 m</div>
              {project.scene.objects.length === 0 &&
                project.strokes.length === 0 && (
                  <div className="empty-hint">
                    <span>〰</span>
                    <h2>这里，是你的游乐场</h2>
                    <p>用画笔画一条坡，或从右侧放一个小球。</p>
                  </div>
                )}
            </div>
            <div className="simulation-bar">
              <span className="mode-label">
                <i className={s.mode === "running" ? "live" : ""} />
                {s.mode === "running"
                  ? "模拟进行中"
                  : s.mode === "paused"
                    ? "已暂停"
                    : s.mode === "preview"
                      ? "预览修改"
                      : "编辑模式"}
              </span>
              <div className="play-actions">
                <label className="speed-control">
                  速度{" "}
                  <select
                    aria-label="播放速度"
                    value={s.speed}
                    onChange={(e) =>
                      store.set({ speed: Number(e.target.value) })
                    }
                  >
                    <option value="1">1×</option>
                    <option value="0.5">0.5×</option>
                    <option value="0.25">0.25×</option>
                  </select>
                </label>
                <button
                  aria-pressed={s.showTrails}
                  onClick={() => store.set({ showTrails: !s.showTrails })}
                >
                  轨迹{s.showTrails ? "开" : "关"}
                </button>
                <button
                  disabled={!editing}
                  onClick={() => void previewTrajectory()}
                >
                  {s.predicting ? "取消预测" : "预测轨迹"}
                </button>
                <button
                  disabled={
                    s.mode !== "paused" || s.challengeWon || s.challengeFailed
                  }
                  onClick={singleStep}
                >
                  单步
                </button>
                <button
                  className="reset-button"
                  disabled={!["running", "paused"].includes(s.mode)}
                  onClick={resetSimulation}
                >
                  ↺ 重置
                </button>
                <button
                  className="play-button"
                  disabled={
                    !["editing", "running", "paused"].includes(s.mode) ||
                    s.challengeWon ||
                    s.challengeFailed
                  }
                  onClick={() => void start()}
                >
                  {s.mode === "running"
                    ? "Ⅱ 暂停"
                    : s.mode === "paused"
                      ? "▶ 继续"
                      : "▶ 播放"}{" "}
                  <kbd>Space</kbd>
                </button>
              </div>
              <span className="object-count">
                {project.scene.objects.length} / 80 个对象
              </span>
            </div>
          </div>
          <div className="status-line" role="status">
            <span>✦</span>
            {s.message}
          </div>
          <div className="experience-tips">
            <div>
              <b>01</b>
              <span>
                画几笔<small>自由画出有碰撞厚度的轨道</small>
              </span>
            </div>
            <i>→</i>
            <div>
              <b>02</b>
              <span>
                让它动起来<small>播放，观察你的物理世界</small>
              </span>
            </div>
            <i>→</i>
            <div>
              <b>03</b>
              <span>
                换个想法再玩<small>框选局部，用一句话修改</small>
              </span>
            </div>
          </div>
        </section>
        <aside className="sidebar">
          <section className="panel components">
            <div className="panel-title">
              <h2>给世界加点东西</h2>
              <span>＋</span>
            </div>
            <p>选中后连续放置 · 按 V 返回选择</p>
            <div className="component-grid">
              {(
                [
                  { kind: "ball", icon: "●", en: "BALL" },
                  { kind: "track", icon: "╱", en: "RAMP" },
                  { kind: "cup", icon: "∪", en: "CUP" },
                  { kind: "spring", icon: "▤", en: "SPRING" },
                  { kind: "block", icon: "▥", en: "BLOCK" },
                  { kind: "seesaw", icon: "⚖", en: "SEESAW" },
                ] as const
              ).map((c) => (
                <button
                  key={c.kind}
                  disabled={!editing || !!challenge}
                  className={`component ${c.kind} ${s.tool === c.kind ? "chosen" : ""}`}
                  aria-pressed={s.tool === c.kind}
                  onClick={() =>
                    store.set({
                      tool: c.kind,
                      message: `点击画布放置${names[c.kind]}`,
                    })
                  }
                >
                  <span>
                    {c.kind === "spring" ? (
                      <svg
                        width="36"
                        height="36"
                        viewBox="0 0 36 36"
                        fill="none"
                        aria-hidden="true"
                      >
                        <rect
                          x="7"
                          y="27"
                          width="22"
                          height="5"
                          rx="2"
                          fill="#bb8865"
                        />
                        <rect
                          x="9"
                          y="7"
                          width="18"
                          height="20"
                          rx="3"
                          fill="#fff0dd"
                          stroke="#e8cdb0"
                        />
                        <path
                          d="M12 25L24 22L12 19L24 16L12 13L24 10"
                          stroke="#bd8054"
                          strokeWidth="2"
                          strokeLinejoin="round"
                        />
                        <rect
                          x="6"
                          y="4"
                          width="24"
                          height="5"
                          rx="2"
                          fill="#efa65e"
                        />
                      </svg>
                    ) : (
                      c.icon
                    )}
                  </span>
                  <strong>{names[c.kind]}</strong>
                  <small>{c.en}</small>
                </button>
              ))}
            </div>
          </section>
          <section className="panel inspector">
            <div className="panel-title">
              <h2>对象属性</h2>
              <span className="subtle">
                {s.selected.length ? `${s.selected.length} 个选中` : "未选择"}
              </span>
            </div>
            {s.selected.length > 1 ? (
              <div className="multi-selection">
                <strong>已选择 {s.selected.length} 个对象</strong>
                <p>
                  拖动任一选中对象可整体移动；删除和 AI 修改会作用于整个选择。
                </p>
                <button
                  className="delete-button"
                  disabled={!editing}
                  onClick={remove}
                >
                  删除这 {s.selected.length} 个对象
                </button>
                <button
                  onClick={() =>
                    store.set({ selected: [], message: "已取消选择" })
                  }
                >
                  取消选择
                </button>
              </div>
            ) : selected ? (
              <>
                <div className="selected-name">
                  <i
                    style={{
                      background: {
                        ball: "#dfa047",
                        track: "#567666",
                        cup: "#ac99c7",
                        spring: "#d77e65",
                        block: "#bc8c57",
                        seesaw: "#649eac",
                      }[selected.kind],
                    }}
                  />
                  {names[selected.kind]}
                  <code>{selected.id.slice(0, 6)}</code>
                </div>
                <Properties
                  object={selected}
                  disabled={
                    !editing ||
                    (!!challenge && !selected.sourceStrokeIds.length)
                  }
                />
                {selected.kind === "block" && (
                  <button
                    disabled={!editing || !!challenge}
                    onClick={() =>
                      store.change((p) => {
                        const joint = p.scene.constraints.find(
                          (j) => j.bodyId === selected.id,
                        );
                        if (joint)
                          p.scene.constraints = p.scene.constraints.filter(
                            (j) => j.id !== joint.id,
                          );
                        else
                          p.scene.constraints.push({
                            id: crypto.randomUUID(),
                            type: "hinge",
                            bodyId: selected.id,
                            anchor: [...selected.transform.position],
                          });
                      })
                    }
                  >
                    {project.scene.constraints.some(
                      (j) => j.bodyId === selected.id,
                    )
                      ? "移除固定铰链"
                      : "在中心添加固定铰链"}
                  </button>
                )}
                {selected.kind === "track" &&
                  selected.shape.points.length === 2 && (
                    <button
                      className="steepen-button"
                      disabled={!editing}
                      onClick={() => {
                        try {
                          const next = clone(project);
                          next.scene.objects = next.scene.objects.map((o) =>
                            o.id === selected.id ? steepenTrack(o) : o,
                          );
                          store.preview(
                            next,
                            "固定低端，坡度增加 10°，保持轨道长度。",
                          );
                        } catch (e) {
                          store.set({ message: (e as Error).message });
                        }
                      }}
                    >
                      ↗ 变陡 10° · 预览
                    </button>
                  )}
                <button
                  className="delete-button"
                  disabled={!editing}
                  onClick={remove}
                >
                  删除选中对象
                </button>
              </>
            ) : (
              <div className="inspector-empty">
                <span>↖</span>选择画布中的对象
                <small>调整它的位置、形状和物理属性</small>
              </div>
            )}
            {s.selected.length > 1 && (
              <div className="selection-list">
                {s.selected
                  .filter((id) =>
                    project.scene.objects.some((o) => o.id === id),
                  )
                  .map((id) => (
                    <label key={id}>
                      <input
                        type="checkbox"
                        checked
                        onChange={() =>
                          store.set({
                            selected: s.selected.filter((x) => x !== id),
                          })
                        }
                      />
                      {
                        names[
                          project.scene.objects.find((o) => o.id === id)!.kind
                        ]
                      }{" "}
                      · {id.slice(0, 6)}
                    </label>
                  ))}
              </div>
            )}
          </section>
          <section className="panel ai-panel">
            <div className="panel-title">
              <h2>
                <span>✧</span> 用一句话，改个玩法
              </h2>
              <span className="tag">AI</span>
            </div>
            <p>点击选择一个对象，或用多选工具选择多个。</p>
            <textarea
              aria-label="局部修改指令"
              placeholder={"“把这条斜坡变陡一点”\n“在这里加个弹簧”"}
              maxLength={500}
              value={prompt}
              disabled={!editing}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="prompt-chips">
              {["变陡一点", "把小球变大"].map((t) => (
                <button
                  key={t}
                  disabled={!editing}
                  onClick={() => setPrompt(t)}
                >
                  {t} ↗
                </button>
              ))}
            </div>
            <button
              className="ai-button"
              disabled={
                !editing || !ai.enabled || !s.selected.length || !prompt.trim()
              }
              onClick={() => void editAI()}
            >
              ✧ 预览修改 <span>→</span>
            </button>
            <small className="privacy-note">
              {ai.enabled
                ? "将发送选择对象、指令及必要的邻域数据"
                : "AI 尚未配置 · 手动编辑和物理模拟始终可用"}
            </small>
          </section>
          <div className="note-card">
            <span>✳</span>
            <div>
              没有标准答案，只有下一次尝试。
              <p>失败也没关系，重置一下，换个角度。</p>
            </div>
          </div>
        </aside>
      </main>
      {s.mode === "processing" && (
        <div className="request-toast">
          <span className="spinner" />
          正在处理…<button onClick={cancel}>取消</button>
        </div>
      )}
      {s.mode === "preview" && s.preview && (
        <div className="preview-dock">
          <div>
            <span className="eyebrow">PREVIEW CHANGES</span>
            <h3>先看看，再决定</h3>
            <p>{s.message}</p>
            <div className="candidate-list">
              {changed?.map((o) => (
                <div key={o.id}>
                  <span>
                    {names[o.kind]} · {o.id.slice(0, 6)}
                  </span>
                  {!project.scene.objects.some((b) => b.id === o.id) && (
                    <>
                      <select
                        aria-label="候选类型"
                        value={o.kind}
                        onChange={(e) =>
                          candidateType(
                            o.id,
                            e.target.value as SceneObject["kind"],
                          )
                        }
                      >
                        {Object.entries(names).map(([kind, name]) => (
                          <option key={kind} value={kind}>
                            {name}
                          </option>
                        ))}
                      </select>
                      <button onClick={() => excludeCandidate(o.id)}>
                        排除此项
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
            <small>
              {changed
                ?.map(
                  (o) =>
                    `${project.scene.objects.some((b) => b.id === o.id) ? "修改" : "新增"}${names[o.kind]}`,
                )
                .join(" · ")}
              {project.scene.objects
                .filter(
                  (o) => !s.preview!.scene.objects.some((x) => x.id === o.id),
                )
                .map((o) => ` · 删除${names[o.kind]}`)}
            </small>
            {validate(s.preview.scene)
              .filter((i) => i.severity !== "warning")
              .map((i, n) => (
                <p className="error" key={n}>
                  {i.message}
                </p>
              ))}
          </div>
          <div>
            <button onClick={fix}>修正位置</button>
            <button onClick={cancel}>取消</button>
            <button
              className="play-button"
              disabled={validate(s.preview.scene).some(
                (i) => i.severity !== "warning",
              )}
              onClick={() =>
                store.commit(s.preview!, "已应用修改，可以再玩一次")
              }
            >
              ✓ 应用修改
            </button>
          </div>
        </div>
      )}
      {showChallenges && (
        <div
          className="modal-backdrop"
          onClick={() => setShowChallenges(false)}
        >
          <section
            className="modal"
            role="dialog"
            aria-label="挑战关卡"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="close" onClick={() => setShowChallenges(false)}>
              ×
            </button>
            <span className="eyebrow">DRAW YOUR SOLUTION</span>
            <h2>补画几笔，让球入杯</h2>
            <p>固定组件不能修改，重置保留补画；重新开始会清空本关补画。</p>
            {challenges.map((level, index) => (
              <button
                className="example-card"
                key={level.id}
                onClick={() => openChallenge(index)}
              >
                <span>{s.completed.includes(level.id) ? "✓" : index + 1}</span>
                <div>
                  <h3>{level.title}</h3>
                  <p>
                    最多 {level.maxStrokes} 笔 ·{" "}
                    {s.completed.includes(level.id) ? "已完成" : "待挑战"}
                  </p>
                </div>
                <b>↗</b>
              </button>
            ))}
          </section>
        </div>
      )}
      {showExamples && (
        <div className="modal-backdrop" onClick={() => setShowExamples(false)}>
          <section className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setShowExamples(false)}>
              ×
            </button>
            <span className="eyebrow">A LITTLE INSPIRATION</span>
            <h2>从一个小实验开始</h2>
            <p>加载示例将保存当前场景。示例中的每个对象都可以修改。</p>
            <button
              className="example-card"
              onClick={() => void replace(example("ramp"))}
            >
              <span>◒ ╲ ∪</span>
              <div>
                <h3>让小球落进杯子</h3>
                <p>一条斜坡、一点重力，试试改变球的落点。</p>
              </div>
              <b>↗</b>
            </button>
            <button
              className="example-card"
              onClick={() => void replace(example("spring"))}
            >
              <span>♧ ●</span>
              <div>
                <h3>弹簧送球</h3>
                <p>观察弹射和回落，再调整力度与方向。</p>
              </div>
              <b>↗</b>
            </button>
            {(["domino", "lever"] as const).map((kind) => (
              <button
                key={kind}
                className="example-card"
                onClick={() => void replace(chainExample(kind))}
              >
                <span>{kind === "domino" ? "▥" : "⚖"}</span>
                <div>
                  <h3>{kind === "domino" ? "木块接力推球" : "跷跷板送球"}</h3>
                  <p>
                    {kind === "domino"
                      ? "让滚动的小球推倒整排木块。"
                      : "重物落下，杠杆把另一端的小球送起来。"}
                  </p>
                </div>
                <b>↗</b>
              </button>
            ))}
          </section>
        </div>
      )}
      {recognition && (
        <div
          className="modal-backdrop"
          onClick={() => setRecognition(undefined)}
        >
          <section className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setRecognition(undefined)}>
              ×
            </button>
            <span className="eyebrow">RECOGNIZE SKETCH</span>
            <h2>只发送这些待转换笔迹</h2>
            <p>
              最多 20 笔，将发送下方局部图片和笔迹 ID；识别后仍需检查并应用。
            </p>
            <img
              className="recognition-image"
              src={recognition.image}
              alt="将发送给模型的局部笔迹"
            />
            <button className="play-button" onClick={() => void recognize()}>
              确认并识别
            </button>
          </section>
        </div>
      )}
      {showHelp && (
        <div className="modal-backdrop" onClick={() => setShowHelp(false)}>
          <section className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setShowHelp(false)}>
              ×
            </button>
            <span className="eyebrow">QUICK START</span>
            <h2>你的第一分钟</h2>
            <ol>
              <li>点击播放，看球滚动、碰撞；按 Space 暂停。</li>
              <li>点击重置，回到设计稿初始状态。</li>
              <li>
                按 P（或
                B）使用画笔自由画轨道，画完即有碰撞体，粗细决定实体厚度。
              </li>
              <li>选择对象拖动，拖动轨道白色端点改变坡度。</li>
              <li>框选对象后，可用已配置的 AI 预览局部修改。</li>
            </ol>
            <p>V 选择 · P / B 画笔 · L 多选 · E 擦除 · Ctrl+Z 撤销</p>
            <p>
              数据保存在此浏览器。清理浏览器数据会移除场景，建议定期导出。刷新后不保留撤销历史。
            </p>
          </section>
        </div>
      )}
      {issues.some((i) => i.severity !== "warning") && editing && (
        <button className="validation-count" onClick={fix}>
          ⚑ {issues.filter((i) => i.severity !== "warning").length} 处需要调整 ·
          预览修正位置
        </button>
      )}
    </div>
  );
}
function Properties({
  object: o,
  disabled,
}: {
  object: SceneObject;
  disabled: boolean;
}) {
  function number(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    fn: (o: SceneObject, v: number) => void,
  ) {
    return (
      <label className="property" key={label}>
        <span>{label}</span>
        <input
          aria-label={label}
          type="number"
          value={Number(value.toFixed(3))}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => {
            if (!e.target.value) return;
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= min && v <= max)
              store.update(o.id, (next) => fn(next, v));
          }}
        />
      </label>
    );
  }
  return (
    <div className="properties">
      {number("位置 X · m", o.transform.position[0], 0, 12, 0.1, (x, v) => {
        x.transform.position[0] = v;
      })}
      {number("位置 Y · m", o.transform.position[1], 0, 8, 0.1, (x, v) => {
        x.transform.position[1] = v;
      })}
      {(o.kind === "block" || o.kind === "seesaw") && (
        <>
          {number("宽度 · m", o.shape.width, 0.1, 4, 0.1, (x, v) => {
            if (x.kind === "block" || x.kind === "seesaw") x.shape.width = v;
          })}
          {number("高度 · m", o.shape.height, 0.1, 2, 0.1, (x, v) => {
            if (x.kind === "block" || x.kind === "seesaw") x.shape.height = v;
          })}
          {number(
            "旋转 · °",
            (o.transform.rotation * 180) / Math.PI,
            -180,
            180,
            5,
            (x, v) => {
              x.transform.rotation = (v * Math.PI) / 180;
            },
          )}
          {number("质量 · kg", o.physics.mass, 0.1, 10, 0.1, (x, v) => {
            if (x.kind === "block" || x.kind === "seesaw") x.physics.mass = v;
          })}
        </>
      )}
      {o.kind === "ball" && (
        <>
          {number("半径 · m", o.shape.radius, 0.1, 0.5, 0.02, (x, v) => {
            if (x.kind === "ball") x.shape.radius = v;
          })}
          {number("质量 · kg", o.physics.mass, 0.1, 10, 0.1, (x, v) => {
            if (x.kind === "ball") x.physics.mass = v;
          })}
        </>
      )}
      {number("摩擦系数", o.physics.friction, 0, 1, 0.05, (x, v) => {
        x.physics.friction = v;
      })}
      {number("弹性系数", o.physics.restitution, 0, 1, 0.05, (x, v) => {
        x.physics.restitution = v;
      })}
      {o.kind === "cup" && (
        <>
          {number("内宽 · m", o.shape.innerWidth, 0.25, 4, 0.1, (x, v) => {
            if (x.kind === "cup") x.shape.innerWidth = v;
          })}
          {number("内高 · m", o.shape.innerHeight, 0.3, 4, 0.1, (x, v) => {
            if (x.kind === "cup") x.shape.innerHeight = v;
          })}
        </>
      )}
      {o.kind === "spring" && (
        <>
          {number("冲量 · N·s", o.behavior.impulse, 0.2, 5, 0.1, (x, v) => {
            if (x.kind === "spring") x.behavior.impulse = v;
          })}
          {number(
            "方向 · °",
            (Math.atan2(o.behavior.direction[1], o.behavior.direction[0]) *
              180) /
              Math.PI,
            -180,
            180,
            5,
            (x, v) => {
              if (x.kind === "spring")
                x.behavior.direction = [
                  Math.cos((v * Math.PI) / 180),
                  Math.sin((v * Math.PI) / 180),
                ];
            },
          )}
        </>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
