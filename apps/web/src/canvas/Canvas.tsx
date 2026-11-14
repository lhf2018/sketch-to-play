import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  clone,
  worldPoint,
  bounds,
  physicalStroke,
  selectionRectangle,
  geometry,
  makeObject,
  signedDistance,
  lassoHit,
  distance,
  uid,
  validate,
  type Vec,
  type SceneObject,
  type Primitive,
} from "@sketch/core";
import { store } from "../editor/store";
import { Simulation } from "../simulation/physics";
export const runtime: { current?: Simulation; generation: number } = {
  generation: 0,
};
export const prediction: {
  points: Map<string, Vec[]>;
  project?: object;
  busy: boolean;
  epoch: number;
} = { points: new Map(), busy: false, epoch: 0 };
export async function previewTrajectory() {
  if (prediction.busy) {
    prediction.epoch++;
    prediction.busy = false;
    store.set({ predicting: false, message: "已取消轨迹预测" });
    return;
  }
  const project = store.get().project;
  if (store.get().mode !== "editing") return;
  if (validate(project.scene).some((i) => i.severity !== "warning")) {
    store.set({ message: "请先修正场景，再预览轨迹" });
    return;
  }
  const epoch = ++prediction.epoch;
  prediction.busy = true;
  prediction.points = new Map();
  store.set({
    predicting: true,
    showTrails: true,
    message: "正在预测未来 8 秒的轨迹…",
  });
  const sim = new Simulation();
  try {
    await sim.create(project.scene);
    for (let i = 0; i < 960; i++) {
      if (
        epoch !== prediction.epoch ||
        store.get().project !== project ||
        store.get().mode !== "editing"
      )
        return;
      sim.step(project.scene);
      if (i % 120 === 119)
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    prediction.points = new Map(
      [...sim.trajectories].map(([id, points]) => [id, [...points]]),
    );
    prediction.project = project;
    store.set({ message: "虚线为未来 8 秒预测；实线为本轮实际轨迹" });
  } catch (e) {
    store.set({ message: `轨迹预测失败：${(e as Error).message}` });
  } finally {
    sim.destroy();
    if (epoch === prediction.epoch) {
      prediction.busy = false;
      store.set({ predicting: false });
    }
  }
}
export function singleStep() {
  const s = store.get();
  if (
    s.mode !== "paused" ||
    s.challengeWon ||
    s.challengeFailed ||
    !runtime.current
  )
    return;
  try {
    runtime.current.step(s.project.scene);
    checkRun();
  } catch (e) {
    store.set({ message: (e as Error).message });
  }
}
function checkRun() {
  const sim = runtime.current,
    s = store.get();
  if (!sim || s.challenge === undefined) return;
  if (sim.won) store.completeChallenge();
  else if (sim.escaped.size || sim.time >= 30)
    store.set({
      mode: "paused",
      challengeFailed: true,
      message: "本次未完成，点击重置保留补画并再试一次",
    });
}
export function resetSimulation() {
  prediction.epoch++;
  prediction.busy = false;
  store.set({ predicting: false });
  prediction.points.clear();
  runtime.generation++;
  runtime.current?.destroy();
  runtime.current = undefined;
  store.set({
    mode: "editing",
    challengeWon: false,
    challengeFailed: false,
    message: "已恢复设计稿的初始状态",
  });
}
export async function play() {
  const { mode, project } = store.get();
  prediction.epoch++;
  prediction.busy = false;
  store.set({ predicting: false });
  if (
    mode === "paused" &&
    (store.get().challengeWon || store.get().challengeFailed)
  )
    return;
  if (mode === "paused") {
    store.set({ mode: "running" });
    return;
  }
  if (mode === "running") {
    store.set({ mode: "paused" });
    return;
  }
  const bad = validate(project.scene).find((i) => i.severity !== "warning");
  if (bad) {
    store.set({ message: bad.message, selected: bad.objectIds });
    return;
  }
  if (!project.scene.objects.length) {
    store.set({ message: "先画几笔或放一个球吧" });
    return;
  }
  const gen = ++runtime.generation;
  store.set({ mode: "processing", message: "准备物理世界…" });
  const sim = new Simulation();
  try {
    await sim.create(project.scene);
    if (gen !== runtime.generation) {
      sim.destroy();
      return;
    }
    runtime.current = sim;
    store.set({
      mode: "running",
      message: "正在模拟 · 暂停可观察，重置可继续编辑",
    });
  } catch (e) {
    sim.destroy();
    store.set({
      mode: "editing",
      message: `物理初始化失败：${(e as Error).message}`,
    });
  }
}
const colors = {
  ball: "#e9a549",
  track: "#556f66",
  cup: "#b4a1ce",
  spring: "#dd8069",
  block: "#bc8c57",
  seesaw: "#649eac",
};
export function Canvas() {
  const state = useSyncExternalStore(store.subscribe, store.get);
  const ref = useRef<HTMLCanvasElement>(null);
  const interaction = useRef<
    | {
        marquee?: boolean;
        selectionBefore?: string[];
        additive?: boolean;
        points: Vec[];
        start: Vec;
        original?: SceneObject;
        handle?: number;
        rotate?: boolean;
        drag?: SceneObject;
        erased?: string[];
        group?: SceneObject[];
        groupOriginals?: SceneObject[];
      }
    | undefined
  >(undefined);
  const size = useRef({ w: 100, h: 100, scale: 1, ox: 0, oy: 0 });
  useEffect(() => {
    const canvas = ref.current!;
    let frame = 0,
      last = 0,
      acc = 0;
    let announced = false;
    let observedRun: Simulation | undefined;
    const resize = () => {
      const rect = canvas.getBoundingClientRect(),
        dpr = Math.min(devicePixelRatio, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const scale = Math.min(rect.width / 12, rect.height / 8);
      size.current = {
        w: rect.width,
        h: rect.height,
        scale,
        ox: (rect.width - scale * 12) / 2,
        oy: (rect.height - scale * 8) / 2,
      };
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    const tick = (now: number) => {
      const s = store.get(),
        sim = runtime.current;
      if (sim !== observedRun) {
        observedRun = sim;
        announced = false;
        acc = 0;
        last = now;
      }
      if (s.mode === "running" && sim) {
        acc += Math.min((now - last) / 1000, 8 / 120) * s.speed;
        let steps = 0;
        try {
          while (acc >= 1 / 120 && steps++ < 8) {
            sim.step(s.project.scene);
            acc -= 1 / 120;
            checkRun();
            if (store.get().mode !== "running") break;
          }
          checkRun();
          if (sim.won && !announced) {
            announced = true;
            store.set({
              message:
                s.challenge !== undefined
                  ? "挑战成功！可以进入下一关。"
                  : "成功啦！小球落进了杯子。重置后试试另一种解法。",
            });
          } else if (sim.escaped.size && !announced) {
            store.set({
              message: `${sim.escaped.size} 个小球已飞出，重置可恢复`,
            });
          }
        } catch (e) {
          store.set({ mode: "paused", message: (e as Error).message });
        }
      } else acc = 0;
      last = now;
      draw(canvas, interaction.current, size.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const pause = () => {
      if (store.get().mode === "running")
        store.set({ mode: "paused", message: "已自动暂停，点击继续可接着玩" });
    };
    window.addEventListener("blur", pause);
    document.addEventListener("visibilitychange", pause);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("blur", pause);
      document.removeEventListener("visibilitychange", pause);
    };
  }, []);
  function position(e: React.PointerEvent): Vec {
    const rect = ref.current!.getBoundingClientRect(),
      s = size.current;
    return [
      (e.clientX - rect.left - s.ox) / s.scale,
      8 - (e.clientY - rect.top - s.oy) / s.scale,
    ];
  }
  function erasedAt(p: Vec): string[] {
    return state.project.strokes
      .filter((s) => {
        const objects = state.project.scene.objects.filter((o) =>
          o.sourceStrokeIds.includes(s.id),
        );
        return objects.length
          ? objects.some((o) =>
              geometry(o).some((g) => signedDistance(p, g) < 0.12),
            )
          : s.points.some((q) => distance(q, p) < 0.15);
      })
      .map((s) => s.id);
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (state.mode !== "editing" || e.button !== 0) return;
    const p = position(e);
    if (p[0] < 0 || p[0] > 12 || p[1] < 0 || p[1] > 8) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (
      ["ball", "track", "cup", "spring", "block", "seesaw"].includes(state.tool)
    ) {
      const o = makeObject(state.tool as "ball", p);
      store.change((d) => d.scene.objects.push(o), "已放置组件");
      store.set({
        selected: [o.id],
        message: "继续点击可连续放置，按 V 返回选择工具",
      });
      return;
    }
    if (
      state.challenge !== undefined &&
      !["select", "draw", "erase", "lasso"].includes(state.tool)
    )
      return;
    if (state.tool === "erase") {
      interaction.current = {
        points: [p],
        start: p,
        erased: erasedAt(p),
      };
      return;
    }
    if (state.tool === "select") {
      const selected = state.project.scene.objects.find(
        (o) => o.id === state.selected[0],
      );
      if (
        state.selected.length === 1 &&
        (selected?.kind === "block" || selected?.kind === "seesaw")
      ) {
        const handle = worldPoint(selected, [
          0,
          selected.shape.height / 2 + 0.3,
        ]);
        if (distance(handle, p) < 12 / size.current.scale) {
          interaction.current = {
            points: [p],
            start: p,
            original: clone(selected),
            drag: clone(selected),
            rotate: true,
          };
          return;
        }
      }
      if (
        state.selected.length === 1 &&
        selected?.kind === "track" &&
        !(state.challenge !== undefined && !selected.sourceStrokeIds.length)
      )
        for (let i = 0; i < selected.shape.points.length; i++) {
          const v = selected.shape.points[i],
            a = selected.transform.rotation;
          const q: Vec = [
            selected.transform.position[0] +
              v[0] * Math.cos(a) -
              v[1] * Math.sin(a),
            selected.transform.position[1] +
              v[0] * Math.sin(a) +
              v[1] * Math.cos(a),
          ];
          if (distance(q, p) < 10 / size.current.scale) {
            interaction.current = {
              points: [p],
              start: p,
              original: clone(selected),
              drag: clone(selected),
              handle: i,
            };
            return;
          }
        }
      const hits = [...state.project.scene.objects]
        .reverse()
        .filter((o) =>
          geometry(o).some(
            (g) => signedDistance(p, g) < 6 / size.current.scale,
          ),
        );
      if ((e.ctrlKey || e.shiftKey) && hits.length) {
        const id = hits[0].id;
        store.set({
          selected: state.selected.includes(id)
            ? state.selected.filter((x) => x !== id)
            : [...state.selected, id],
          anchor: p,
        });
        return;
      }
      const current = hits.findIndex((o) => o.id === state.selected[0]);
      const groupHit =
        state.selected.length > 1 &&
        hits.find((o) => state.selected.includes(o.id));
      const hit = groupHit || hits[(current + 1) % hits.length];
      store.set({
        selected: groupHit ? state.selected : hit ? [hit.id] : [],
        anchor: p,
      });
      if (
        hit &&
        !(state.challenge !== undefined && !hit.sourceStrokeIds.length)
      )
        interaction.current = {
          points: [p],
          start: p,
          original: clone(hit),
          drag: clone(hit),
          group: groupHit
            ? clone(
                state.project.scene.objects.filter((o) =>
                  state.selected.includes(o.id),
                ),
              )
            : undefined,
          groupOriginals: groupHit
            ? clone(
                state.project.scene.objects.filter((o) =>
                  state.selected.includes(o.id),
                ),
              )
            : undefined,
        };
      if (!hit)
        interaction.current = {
          points: [p, p],
          start: p,
          marquee: true,
          selectionBefore: state.selected,
          additive: e.ctrlKey || e.shiftKey,
        };
      return;
    }
    interaction.current = {
      points: [p, p],
      start: p,
      marquee: state.tool === "lasso",
      selectionBefore: state.selected,
      additive: e.ctrlKey || e.shiftKey,
    };
    if (state.tool === "lasso" && !e.ctrlKey && !e.shiftKey)
      store.set({ selected: [] });
  }
  function move(e: React.PointerEvent) {
    const it = interaction.current;
    if (!it) return;
    const raw = position(e),
      p: Vec = [
        Math.max(0, Math.min(12, raw[0])),
        Math.max(0, Math.min(8, raw[1])),
      ];
    if (it.erased) {
      for (const id of erasedAt(p))
        if (!it.erased.includes(id)) it.erased.push(id);
      return;
    }
    if (it.marquee) {
      it.points = [it.start, p];
      const ids = state.project.scene.objects
        .filter((o) => lassoHit(o, selectionRectangle(it.start, p)))
        .map((o) => o.id);
      store.set({
        selected: [
          ...new Set([
            ...(it.additive ? (it.selectionBefore ?? []) : []),
            ...ids,
          ]),
        ],
      });
      return;
    }
    if (it.group && it.groupOriginals) {
      it.group = it.groupOriginals.map((o) => ({
        ...o,
        transform: {
          ...o.transform,
          position: [
            o.transform.position[0] + p[0] - it.start[0],
            o.transform.position[1] + p[1] - it.start[1],
          ],
        },
      }));
      return;
    }
    if (it.drag && it.original) {
      if (it.rotate) {
        it.drag.transform.rotation =
          Math.atan2(
            p[1] - it.original.transform.position[1],
            p[0] - it.original.transform.position[0],
          ) -
          Math.PI / 2;
      } else if (it.handle !== undefined && it.drag.kind === "track") {
        const a = -it.original.transform.rotation,
          x = p[0] - it.original.transform.position[0],
          y = p[1] - it.original.transform.position[1];
        it.drag.shape.points[it.handle] = [
          x * Math.cos(a) - y * Math.sin(a),
          x * Math.sin(a) + y * Math.cos(a),
        ];
      } else
        it.drag.transform.position = [
          it.original.transform.position[0] + p[0] - it.start[0],
          it.original.transform.position[1] + p[1] - it.start[1],
        ];
    } else if (
      it.points.length < 2000 &&
      distance(it.points.at(-1)!, p) > 0.015
    )
      it.points.push(p);
  }
  function up() {
    const it = interaction.current;
    interaction.current = undefined;
    if (!it) return;
    if (it.group && it.groupOriginals) {
      if (JSON.stringify(it.group) !== JSON.stringify(it.groupOriginals))
        store.change((p) => {
          p.scene.objects = p.scene.objects.map(
            (o) => it.group!.find((g) => g.id === o.id) ?? o,
          );
        }, `已移动 ${it.group.length} 个对象`);
      return;
    }
    if (it.erased) {
      store.change((p) => {
        p.strokes = p.strokes.filter((s) => !it.erased!.includes(s.id));
        p.scene.objects = p.scene.objects.filter(
          (o) => !o.sourceStrokeIds.some((id) => it.erased!.includes(id)),
        );
      }, "已擦除笔迹及其碰撞轨道");
      return;
    }
    if (it.drag) {
      const object = it.drag;
      if (JSON.stringify(object) !== JSON.stringify(it.original))
        store.update(object.id, (o) => Object.assign(o, object));
      return;
    }
    if (state.tool === "draw" && it.points.length >= 1) {
      const stroke = {
        id: uid(),
        points: it.points,
        status: "converted" as const,
        color: state.penColor,
        width: state.penWidth,
      };
      const object = physicalStroke(stroke);
      store.change((p) => {
        p.strokes.push(stroke);
        p.scene.objects.push(object);
      }, "已画出实体轨道，点击播放即可碰撞");
    }
    if (it.marquee) {
      const selected = store.get().selected;
      store.set({
        tool: "select",
        anchor: [
          (it.start[0] + it.points.at(-1)![0]) / 2,
          (it.start[1] + it.points.at(-1)![1]) / 2,
        ],
        message: selected.length
          ? `已选中 ${selected.length} 个对象，拖动选中对象可整体移动；Ctrl / Shift 点击可增减选择`
          : "未选中对象，在空白处拖出矩形即可框选",
      });
    }
  }

  return (
    <>
      {state.selected.length > 0 && state.mode === "editing" && (
        <div className="selection-summary" data-testid="selection-summary">
          已选中 {state.selected.length} 个 · 拖动可移动
        </div>
      )}
      <canvas
        ref={ref}
        aria-label="物理创作画布"
        data-testid="canvas"
        className={`canvas tool-${state.tool}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          if (interaction.current?.marquee)
            store.set({ selected: interaction.current.selectionBefore ?? [] });
          interaction.current = undefined;
        }}
      />
    </>
  );
}
function draw(
  canvas: HTMLCanvasElement,
  it: ReturnType<typeof useRef<any>>["current"],
  view: { w: number; h: number; scale: number; ox: number; oy: number },
) {
  const ctx = canvas.getContext("2d")!;
  const dpr = Math.min(devicePixelRatio, 2),
    { scale, ox, oy, w, h } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#f7f8f4";
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(ox, oy + 8 * scale);
  ctx.scale(scale, -scale);
  ctx.fillStyle = "#d5ddd4";
  for (let x = 0.25; x < 12; x += 0.25)
    for (let y = 0.25; y < 8; y += 0.25) {
      ctx.beginPath();
      ctx.arc(x, y, 0.011, 0, Math.PI * 2);
      ctx.fill();
    }
  ctx.strokeStyle = "#c6d0c5";
  ctx.lineWidth = 0.025;
  ctx.strokeRect(0, 0, 12, 8);
  const s = store.get();
  const sim = runtime.current;
  if (s.showTrails) {
    const trajectories =
      s.mode === "editing" && prediction.project === s.project
        ? prediction.points
        : sim?.trajectories;
    if (trajectories)
      [...trajectories].forEach(([id, points], index) => {
        ctx.strokeStyle = ["#6672df", "#dd8660", "#31947b"][index % 3];
        ctx.globalAlpha = 0.65;
        ctx.lineWidth = 0.025;
        ctx.setLineDash(s.mode === "editing" ? [0.09, 0.07] : []);
        poly(ctx, points);
        ctx.stroke();
        const end = points.at(-1);
        if (end) {
          ctx.beginPath();
          ctx.arc(...end, 0.05, 0, Math.PI * 2);
          ctx.fillStyle = ctx.strokeStyle;
          ctx.fill();
        }
      });
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }
  const object = (o: SceneObject, alpha = 1, dash = false) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = o.color ?? colors[o.kind];
    ctx.strokeStyle = o.color ?? colors[o.kind];
    ctx.lineWidth = 0.04;
    ctx.setLineDash(dash ? [0.1, 0.07] : []);
    for (const g of o.kind === "spring" ? [] : geometry(o)) {
      if (g.type === "box" && g.sensor) continue;
      path(ctx, g);
      ctx.fill();
      if (dash) ctx.stroke();
    }
    if (
      o.kind === "seesaw" ||
      s.project.scene.constraints.some((j) => j.bodyId === o.id)
    ) {
      const original = s.project.scene.objects.find((b) => b.id === o.id)!;
      const pivot =
        o.kind === "seesaw"
          ? original.transform.position
          : s.project.scene.constraints.find((j) => j.bodyId === o.id)!.anchor;
      ctx.beginPath();
      ctx.arc(...pivot, 0.08, 0, Math.PI * 2);
      ctx.fillStyle = "#344354";
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    }
    if (o.kind === "ball") {
      ctx.strokeStyle = "#8d632f";
      ctx.lineWidth = 0.018;
      ctx.beginPath();
      const [x, y] = o.transform.position,
        a = o.transform.rotation;
      ctx.moveTo(x, y);
      ctx.lineTo(
        x + Math.cos(a) * o.shape.radius * 0.7,
        y + Math.sin(a) * o.shape.radius * 0.7,
      );
      ctx.stroke();
    }
    if (o.kind === "spring") {
      const [x, y] = o.transform.position;
      const last = sim?.springFired.get(o.id) ?? -Infinity;
      const compression =
        s.mode === "running"
          ? Math.max(0, 1 - (sim!.time - last) / 0.22) * 0.09
          : 0;
      const top = y + 0.35 - compression;
      ctx.fillStyle = "#f9e2ce";
      ctx.fillRect(x - 0.16, y - 0.03, 0.32, 0.38);
      ctx.strokeStyle = "#deb698";
      ctx.lineWidth = 0.015;
      ctx.strokeRect(x - 0.16, y - 0.03, 0.32, 0.38);
      ctx.fillStyle = "#bc8060";
      ctx.fillRect(x - 0.2, y - 0.06, 0.4, 0.12);
      ctx.fillStyle = "#f2aa68";
      ctx.fillRect(x - 0.2, top - 0.03, 0.4, 0.06);
      ctx.strokeStyle = "#b8784f";
      ctx.lineWidth = 0.027;
      ctx.beginPath();
      ctx.moveTo(x - 0.12, y + 0.06);
      for (let i = 0; i < 10; i++)
        ctx.lineTo(
          x + (i % 2 ? 0.115 : -0.115),
          y + 0.07 + (i * (top - y - 0.11)) / 9,
        );
      ctx.stroke();
      const [dx, dy] = o.behavior.direction;
      ctx.strokeStyle = "#b9866266";
      ctx.lineWidth = 0.018;
      ctx.beginPath();
      ctx.moveTo(x, y + 0.46);
      ctx.lineTo(x + dx * 0.27, y + 0.46 + dy * 0.27);
      ctx.moveTo(
        x + dx * 0.27 - dx * 0.08 - dy * 0.05,
        y + 0.46 + dy * 0.27 - dy * 0.08 + dx * 0.05,
      );
      ctx.lineTo(x + dx * 0.27, y + 0.46 + dy * 0.27);
      ctx.lineTo(
        x + dx * 0.27 - dx * 0.08 + dy * 0.05,
        y + 0.46 + dy * 0.27 - dy * 0.08 - dx * 0.05,
      );
      ctx.stroke();
    }
    ctx.restore();
  };
  const selectedBounds: number[][] = [];
  for (const original of s.project.scene.objects) {
    if (original.sourceStrokeIds.some((id) => it?.erased?.includes(id)))
      continue;
    let o = original;
    const groupObject = it?.group?.find((g: SceneObject) => g.id === o.id);
    if (groupObject) o = groupObject;
    else if (it?.drag?.id === o.id) o = it.drag;
    else if (
      (s.mode === "running" || s.mode === "paused") &&
      sim?.poses.has(o.id)
    ) {
      o = { ...o, transform: sim.poses.get(o.id)! };
    }
    object(o, sim?.escaped.has(o.id) ? 0.3 : 1);
    if (s.selected.includes(o.id)) {
      selectedBounds.push(
        ...geometry(o)
          .filter((g) => !(g.type === "box" && g.sensor))
          .map(bounds),
      );
      ctx.strokeStyle = "#0078d4";
      ctx.lineWidth = 2 / scale;
      ctx.setLineDash([]);
      for (const g of geometry(o)) {
        path(ctx, g);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      if (
        s.mode === "editing" &&
        s.selected.length === 1 &&
        (o.kind === "block" || o.kind === "seesaw")
      ) {
        const top = worldPoint(o, [0, o.shape.height / 2]),
          handle = worldPoint(o, [0, o.shape.height / 2 + 0.3]);
        ctx.beginPath();
        ctx.moveTo(...top);
        ctx.lineTo(...handle);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(...handle, 0.08, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.stroke();
      }
      if (
        s.mode === "editing" &&
        s.selected.length === 1 &&
        o.kind === "track" &&
        !(s.challenge !== undefined && !o.sourceStrokeIds.length)
      ) {
        for (const p of o.shape.points) {
          ctx.fillStyle = "#fff";
          ctx.strokeStyle = "#0078d4";
          ctx.beginPath();
          ctx.arc(
            o.transform.position[0] +
              p[0] * Math.cos(o.transform.rotation) -
              p[1] * Math.sin(o.transform.rotation),
            o.transform.position[1] +
              p[0] * Math.sin(o.transform.rotation) +
              p[1] * Math.cos(o.transform.rotation),
            0.07,
            0,
            Math.PI * 2,
          );
          ctx.fill();
          ctx.stroke();
        }
      }
    }
  }
  if (selectedBounds.length && s.mode === "editing") {
    const pad = 6 / scale,
      x = Math.min(...selectedBounds.map((b) => b[0])) - pad,
      y = Math.min(...selectedBounds.map((b) => b[1])) - pad,
      right = Math.max(...selectedBounds.map((b) => b[2])) + pad,
      top = Math.max(...selectedBounds.map((b) => b[3])) + pad;
    ctx.strokeStyle = "#0078d4";
    ctx.lineWidth = 1 / scale;
    ctx.strokeRect(x, y, right - x, top - y);
    ctx.fillStyle = "white";
    for (const [px, py] of [
      [x, y],
      [right, y],
      [right, top],
      [x, top],
    ]) {
      ctx.fillRect(px - 3 / scale, py - 3 / scale, 6 / scale, 6 / scale);
      ctx.strokeRect(px - 3 / scale, py - 3 / scale, 6 / scale, 6 / scale);
    }
  }
  if (s.preview)
    for (const o of s.preview.scene.objects) {
      const before = s.project.scene.objects.find((x) => x.id === o.id);
      if (JSON.stringify(before) !== JSON.stringify(o)) object(o, 0.65, true);
    }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 0.035;
  for (const stroke of s.project.strokes)
    if (
      (stroke.status !== "converted" || s.showOriginal) &&
      !it?.erased?.includes(stroke.id)
    ) {
      ctx.strokeStyle =
        stroke.status !== "converted"
          ? (stroke.color ?? "#536c61")
          : "#a4b39d70";
      ctx.lineWidth = stroke.width ?? 0.035;
      poly(ctx, stroke.points);
      ctx.stroke();
      if (stroke.points.length === 1) {
        ctx.beginPath();
        ctx.arc(...stroke.points[0], ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
      }
    }
  if (it?.marquee) {
    const rect = selectionRectangle(it.start, it.points.at(-1)!);
    poly(ctx, rect);
    ctx.closePath();
    ctx.fillStyle = "#0078d430";
    ctx.fill();
    ctx.strokeStyle = "#0078d4";
    ctx.lineWidth = 1 / scale;
    ctx.stroke();
  } else if (it?.points?.length && !it.drag && !it.erased) {
    ctx.strokeStyle = s.penColor;
    ctx.lineWidth = s.penWidth;
    poly(ctx, it.points);
    ctx.stroke();
  }
  if (s.anchor && s.mode === "editing") {
    ctx.strokeStyle = "#a2b4a7";
    ctx.lineWidth = 0.015;
    const [x, y] = s.anchor;
    ctx.beginPath();
    ctx.moveTo(x - 0.07, y);
    ctx.lineTo(x + 0.07, y);
    ctx.moveTo(x, y - 0.07);
    ctx.lineTo(x, y + 0.07);
    ctx.stroke();
  }
  ctx.restore();
}
function poly(ctx: CanvasRenderingContext2D, points: Vec[]) {
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
}
function path(ctx: CanvasRenderingContext2D, g: Primitive) {
  ctx.beginPath();
  if (g.type === "circle") ctx.arc(...g.center, g.radius, 0, Math.PI * 2);
  else if (g.type === "capsule") {
    const angle = Math.atan2(g.b[1] - g.a[1], g.b[0] - g.a[0]);
    ctx.arc(...g.a, g.radius, angle + Math.PI / 2, angle + Math.PI * 1.5);
    ctx.arc(...g.b, g.radius, angle - Math.PI / 2, angle + Math.PI / 2);
    ctx.closePath();
  } else {
    const corners: Vec[] = [
      [-g.half[0], -g.half[1]],
      [g.half[0], -g.half[1]],
      [g.half[0], g.half[1]],
      [-g.half[0], g.half[1]],
    ];
    corners.forEach(([x, y], i) => {
      const px = g.center[0] + x * Math.cos(g.angle) - y * Math.sin(g.angle);
      const py = g.center[1] + x * Math.sin(g.angle) + y * Math.cos(g.angle);
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    });
    ctx.closePath();
  }
}
