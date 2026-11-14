import { z } from "zod";

export const limits = {
  objects: 80,
  balls: 30,
  segments: 160,
  colliders: 512,
  strokes: 200,
  points: 50000,
  fileBytes: 2 * 1024 * 1024,
  speed: 12,
};
const num = z.number().finite();
const point = z.tuple([num, num]);
export type Vec = [number, number];
const transform = z.strictObject({ position: point, rotation: num });
const material = {
  friction: num.min(0).max(1),
  restitution: num.min(0).max(1),
  collisionEnabled: z.literal(true),
};
const fixed = z.strictObject({ ...material, bodyType: z.literal("static") });
const base = {
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  id: z.string().min(1).max(100),
  transform,
  sourceStrokeIds: z.array(z.string()).max(200),
};
const plank = z.strictObject({
  type: z.literal("rectangle"),
  width: num.min(0.1).max(4),
  height: num.min(0.1).max(2),
});
const dynamic = z.strictObject({
  ...material,
  bodyType: z.literal("dynamic"),
  mass: num.min(0.1).max(10),
});
export const objectSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...base,
    kind: z.literal("block"),
    shape: plank,
    physics: dynamic,
  }),
  z.strictObject({
    ...base,
    kind: z.literal("seesaw"),
    shape: plank,
    physics: dynamic,
  }),
  z.strictObject({
    ...base,
    kind: z.literal("ball"),
    shape: z.strictObject({
      type: z.literal("circle"),
      radius: num.min(0.1).max(0.5),
    }),
    physics: z.strictObject({
      ...material,
      bodyType: z.literal("dynamic"),
      mass: num.min(0.1).max(10),
    }),
  }),
  z.strictObject({
    ...base,
    kind: z.literal("track"),
    shape: z.strictObject({
      type: z.literal("polyline"),
      points: z.array(point).min(2).max(161),
      thickness: num.min(0.015).max(0.12),
    }),
    physics: fixed,
  }),
  z.strictObject({
    ...base,
    kind: z.literal("cup"),
    shape: z.strictObject({
      type: z.literal("cup"),
      innerWidth: num.min(0.25).max(4),
      innerHeight: num.min(0.3).max(4),
      wallThickness: z.literal(0.08),
    }),
    physics: fixed,
  }),
  z.strictObject({
    ...base,
    kind: z.literal("spring"),
    shape: z.strictObject({
      type: z.literal("launcher"),
      baseWidth: z.literal(0.4),
      baseHeight: z.literal(0.12),
      triggerDepth: z.literal(0.08),
    }),
    physics: fixed,
    behavior: z.strictObject({
      type: z.literal("launcher"),
      direction: point,
      impulse: num.min(0.2).max(5),
      cooldown: z.literal(0.3),
    }),
  }),
]);
export type SceneObject = z.infer<typeof objectSchema>;
export type Kind = SceneObject["kind"];
export const sceneSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sceneId: z.string().min(1).max(100),
  revision: z.number().int().nonnegative(),
  world: z.strictObject({
    width: z.literal(12),
    height: z.literal(8),
    gravity: z.tuple([z.literal(0), z.literal(-9.8)]),
    boundaries: z.literal("sides-and-floor"),
  }),
  objects: z.array(objectSchema).max(limits.objects),
  constraints: z
    .array(
      z.strictObject({
        id: z.string(),
        type: z.literal("hinge"),
        bodyId: z.string(),
        anchor: point,
      }),
    )
    .max(30),
  objectives: z
    .array(
      z.strictObject({
        type: z.literal("ballInCup"),
        ballId: z.string(),
        cupId: z.string(),
        enabled: z.boolean(),
      }),
    )
    .max(10),
});
export type Scene = z.infer<typeof sceneSchema>;
export const strokeSchema = z.strictObject({
  id: z.string(),
  points: z.array(point).min(1).max(2000),
  status: z.enum(["pending", "converted", "decoration"]),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  width: num.min(0.015).max(0.12).optional(),
});
export type Stroke = z.infer<typeof strokeSchema>;
export const projectSchema = z.strictObject({
  fileVersion: z.literal(1),
  scene: sceneSchema,
  strokes: z.array(strokeSchema).max(limits.strokes),
});
export type Project = z.infer<typeof projectSchema>;
export const uid = () => crypto.randomUUID();
export const clone = <T>(value: T): T => structuredClone(value);
export const distance = (a: Vec, b: Vec) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);
export function makeObject(kind: Kind, position: Vec): SceneObject {
  const b = {
    id: uid(),
    transform: { position, rotation: 0 },
    sourceStrokeIds: [],
  };
  const p = {
    bodyType: "static" as const,
    friction: 0.3,
    restitution: 0.2,
    collisionEnabled: true as const,
  };
  if (kind === "block" || kind === "seesaw")
    return {
      ...b,
      kind,
      shape: {
        type: "rectangle",
        width: kind === "seesaw" ? 2.6 : 0.3,
        height: kind === "seesaw" ? 0.16 : 1,
      },
      physics: { ...p, bodyType: "dynamic", mass: 1 },
    };
  if (kind === "ball")
    return {
      ...b,
      kind,
      shape: { type: "circle", radius: 0.2 },
      physics: { ...p, bodyType: "dynamic", mass: 1 },
    };
  if (kind === "track")
    return {
      ...b,
      kind,
      shape: {
        type: "polyline",
        points: [
          [-1, 0.35],
          [1, -0.35],
        ],
        thickness: 0.08,
      },
      physics: p,
    };
  if (kind === "cup")
    return {
      ...b,
      kind,
      shape: {
        type: "cup",
        innerWidth: 1.1,
        innerHeight: 0.8,
        wallThickness: 0.08,
      },
      physics: p,
    };
  return {
    ...b,
    kind,
    shape: {
      type: "launcher",
      baseWidth: 0.4,
      baseHeight: 0.12,
      triggerDepth: 0.08,
    },
    physics: p,
    behavior: {
      type: "launcher",
      direction: [0, 1],
      impulse: 3,
      cooldown: 0.3,
    },
  };
}
export function emptyProject(): Project {
  return {
    fileVersion: 1,
    scene: {
      schemaVersion: 1,
      sceneId: uid(),
      revision: 0,
      world: {
        width: 12,
        height: 8,
        gravity: [0, -9.8],
        boundaries: "sides-and-floor",
      },
      objects: [],
      constraints: [],
      objectives: [],
    },
    strokes: [],
  };
}
export function example(which: "ramp" | "spring" = "ramp"): Project {
  const p = emptyProject();
  const ball = makeObject("ball", which === "ramp" ? [2, 5.3] : [3, 0.95]);
  const cup = makeObject("cup", which === "ramp" ? [8, 0.15] : [4.5, 0.15]);
  if (which === "ramp") {
    const ramp = makeObject("track", [0, 0]);
    if (ramp.kind === "track")
      ramp.shape.points = [
        [1, 4.8],
        [7, 1.7],
      ];
    p.scene.objects = [ball, ramp, cup];
  } else {
    const spring = makeObject("spring", [3, 0.25]);
    if (spring.kind === "spring") {
      spring.behavior.direction = [0.5, Math.sqrt(0.75)];
      spring.behavior.impulse = 4;
    }
    if (cup.kind === "cup") cup.shape.innerHeight = 0.5;
    p.scene.objects = [ball, cup, spring];
  }
  p.scene.objectives = [
    { type: "ballInCup", ballId: ball.id, cupId: cup.id, enabled: true },
  ];
  return p;
}

export type Primitive =
  | { type: "circle"; center: Vec; radius: number }
  | { type: "capsule"; a: Vec; b: Vec; radius: number }
  | { type: "box"; center: Vec; half: Vec; angle: number; sensor?: boolean };
export function worldPoint(o: SceneObject, p: Vec): Vec {
  const a = o.transform.rotation;
  return [
    o.transform.position[0] + p[0] * Math.cos(a) - p[1] * Math.sin(a),
    o.transform.position[1] + p[0] * Math.sin(a) + p[1] * Math.cos(a),
  ];
}
export function geometry(o: SceneObject): Primitive[] {
  if (o.kind === "block" || o.kind === "seesaw")
    return [
      {
        type: "box",
        center: o.transform.position,
        half: [o.shape.width / 2, o.shape.height / 2],
        angle: o.transform.rotation,
      },
    ];
  if (o.kind === "ball")
    return [
      { type: "circle", center: o.transform.position, radius: o.shape.radius },
    ];
  if (o.kind === "track")
    return o.shape.points.slice(1).map((b, i) => ({
      type: "capsule",
      a: worldPoint(o, o.shape.points[i]),
      b: worldPoint(o, b),
      radius: o.shape.thickness / 2,
    }));
  if (o.kind === "cup") {
    const { innerWidth: w, innerHeight: h, wallThickness: t } = o.shape;
    return [
      {
        type: "box",
        center: worldPoint(o, [0, t / 2]),
        half: [w / 2 + t, t / 2],
        angle: 0,
      },
      {
        type: "box",
        center: worldPoint(o, [-w / 2 - t / 2, t + h / 2]),
        half: [t / 2, h / 2],
        angle: 0,
      },
      {
        type: "box",
        center: worldPoint(o, [w / 2 + t / 2, t + h / 2]),
        half: [t / 2, h / 2],
        angle: 0,
      },
    ];
  }
  return [
    { type: "box", center: o.transform.position, half: [0.2, 0.06], angle: 0 },
    {
      type: "box",
      center: worldPoint(o, [0, 0.16]),
      half: [0.16, 0.19],
      angle: 0,
    },
    {
      type: "box",
      center: worldPoint(o, [0, 0.35]),
      half: [0.2, 0.03],
      angle: 0,
    },
    {
      type: "box",
      center: worldPoint(o, [0, 0.395]),
      half: [0.2, 0.015],
      angle: 0,
      sensor: true,
    },
  ];
}
export function segmentDistance(p: Vec, a: Vec, b: Vec) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    len = dx * dx + dy * dy;
  const t = len
    ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len))
    : 0;
  return distance(p, [a[0] + dx * t, a[1] + dy * t]);
}
export function signedDistance(p: Vec, g: Primitive): number {
  if (g.type === "circle") return distance(p, g.center) - g.radius;
  if (g.type === "capsule") return segmentDistance(p, g.a, g.b) - g.radius;
  const dx = p[0] - g.center[0],
    dy = p[1] - g.center[1],
    c = Math.cos(g.angle),
    s = Math.sin(g.angle);
  const qx = Math.abs(dx * c + dy * s) - g.half[0],
    qy = Math.abs(-dx * s + dy * c) - g.half[1];
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0)
  );
}
export function bounds(g: Primitive): [number, number, number, number] {
  if (g.type === "circle")
    return [
      g.center[0] - g.radius,
      g.center[1] - g.radius,
      g.center[0] + g.radius,
      g.center[1] + g.radius,
    ];
  if (g.type === "capsule")
    return [
      Math.min(g.a[0], g.b[0]) - g.radius,
      Math.min(g.a[1], g.b[1]) - g.radius,
      Math.max(g.a[0], g.b[0]) + g.radius,
      Math.max(g.a[1], g.b[1]) + g.radius,
    ];
  const x =
      Math.abs(Math.cos(g.angle)) * g.half[0] +
      Math.abs(Math.sin(g.angle)) * g.half[1],
    y =
      Math.abs(Math.sin(g.angle)) * g.half[0] +
      Math.abs(Math.cos(g.angle)) * g.half[1];
  return [g.center[0] - x, g.center[1] - y, g.center[0] + x, g.center[1] + y];
}
export function boxCorners(g: Extract<Primitive, { type: "box" }>): Vec[] {
  return (
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as Vec[]
  ).map(([x, y]) => [
    g.center[0] +
      x * g.half[0] * Math.cos(g.angle) -
      y * g.half[1] * Math.sin(g.angle),
    g.center[1] +
      x * g.half[0] * Math.sin(g.angle) +
      y * g.half[1] * Math.cos(g.angle),
  ]);
}
function boxOverlap(
  a: Extract<Primitive, { type: "box" }>,
  b: Primitive,
): boolean {
  if (b.type === "box" && b.sensor) return false;
  if (b.type === "circle") return signedDistance(b.center, a) < b.radius - 0.01;
  const corners = boxCorners(a);
  if (b.type === "capsule")
    return (
      signedDistance(b.a, a) < -0.005 ||
      signedDistance(b.b, a) < -0.005 ||
      corners.some(
        (v, i) =>
          segmentSegmentDistance(v, corners[(i + 1) % 4], b.a, b.b) <
          b.radius - 0.005,
      )
    );
  const other = boxCorners(b);
  // Separating axis test, allowing touching surfaces without blocking playback.
  for (const angle of [
    a.angle,
    a.angle + Math.PI / 2,
    b.angle,
    b.angle + Math.PI / 2,
  ]) {
    const project = (v: Vec) => v[0] * Math.cos(angle) + v[1] * Math.sin(angle);
    const pa = corners.map(project),
      pb = other.map(project);
    if (
      Math.min(Math.max(...pa), Math.max(...pb)) -
        Math.max(Math.min(...pa), Math.min(...pb)) <=
      0.005
    )
      return false;
  }
  return true;
}
export type Issue = {
  code: string;
  severity: "invalid" | "blocked" | "warning";
  objectIds: string[];
  message: string;
};
export function validate(scene: Scene): Issue[] {
  const issues: Issue[] = [];
  const add = (
    code: string,
    severity: Issue["severity"],
    ids: string[],
    message: string,
  ) => issues.push({ code, severity, objectIds: ids, message });
  const parsed = sceneSchema.safeParse(scene);
  if (!parsed.success)
    return [
      {
        code: "SCHEMA",
        severity: "invalid",
        objectIds: [],
        message: parsed.error.issues[0].message,
      },
    ];
  const ids = new Set<string>();
  let balls = 0,
    segments = 0,
    colliders = 3;
  for (const o of scene.objects) {
    if (ids.has(o.id)) add("DUPLICATE_ID", "invalid", [o.id], "对象 ID 重复");
    ids.add(o.id);
    if (o.physics.bodyType === "dynamic") balls++;
    if (o.kind === "track") {
      segments += o.shape.points.length - 1;
      if (
        o.shape.points.some(
          (v, i) => i > 0 && distance(v, o.shape.points[i - 1]) < 0.004,
        )
      )
        add("SHORT_SEGMENT", "invalid", [o.id], "轨道段至少 0.004 米");
    }
    if ((o.kind === "cup" || o.kind === "spring") && o.transform.rotation !== 0)
      add("ROTATION", "invalid", [o.id], "杯子与弹簧不支持旋转");
    if (
      o.kind === "spring" &&
      Math.abs(Math.hypot(...o.behavior.direction) - 1) > 0.001
    )
      add("DIRECTION", "invalid", [o.id], "弹射方向必须为单位向量");
    const shapes = geometry(o);
    colliders += shapes.length;
    if (
      shapes.some((g) => {
        const [x, y, r, t] = bounds(g);
        return x < 0 || y < 0 || r > 12 || t > 8;
      })
    )
      add("OUTSIDE", "blocked", [o.id], "对象超出画布，请移回边界");
  }
  if (balls > 30 || segments > 160 || colliders > 512)
    add("CAPACITY", "invalid", [], "超出场景容量限制");
  for (let i = 0; i < scene.objects.length; i++) {
    const a = scene.objects[i];
    if (a.kind === "block" || a.kind === "seesaw") {
      const shape = geometry(a)[0] as Extract<Primitive, { type: "box" }>;
      for (const b of scene.objects) {
        if (
          b.id === a.id ||
          b.kind === "ball" ||
          ((b.kind === "block" || b.kind === "seesaw") &&
            scene.objects.indexOf(b) < i)
        )
          continue;
        if (geometry(b).some((g) => boxOverlap(shape, g)))
          add(
            "OVERLAP",
            "blocked",
            [a.id, b.id],
            "动态组件与其他对象重叠，请拖动分开",
          );
      }
    }
    if (a.kind !== "ball") continue;
    for (const b of scene.objects) {
      if (b.id === a.id) continue;
      if (b.kind === "ball" && scene.objects.indexOf(b) < i) continue;
      if (
        geometry(b).some(
          (g) =>
            !(g.type === "box" && g.sensor) &&
            signedDistance(a.transform.position, g) < a.shape.radius - 0.01,
        )
      )
        add("OVERLAP", "blocked", [a.id, b.id], "球与其他对象重叠，请拖动分开");
    }
  }
  const jointIds = new Set<string>();
  for (const joint of scene.constraints) {
    const body = scene.objects.find((o) => o.id === joint.bodyId);
    if (
      jointIds.has(joint.id) ||
      !body ||
      body.kind !== "block" ||
      joint.anchor[0] < 0 ||
      joint.anchor[0] > 12 ||
      joint.anchor[1] < 0 ||
      joint.anchor[1] > 8
    )
      add(
        "JOINT",
        "invalid",
        [joint.bodyId],
        "铰链引用或锚点无效（仅支持动态木块）",
      );
    jointIds.add(joint.id);
    if (scene.constraints.filter((j) => j.bodyId === joint.bodyId).length > 1)
      add("JOINT", "invalid", [joint.bodyId], "每个木块最多一个固定支点");
  }
  for (const target of scene.objectives)
    if (target.enabled) {
      const b = scene.objects.find((o) => o.id === target.ballId),
        c = scene.objects.find((o) => o.id === target.cupId);
      if (b?.kind !== "ball" || c?.kind !== "cup")
        add("TARGET", "invalid", [], "目标引用无效");
      else if (c.shape.innerWidth < b.shape.radius * 2 + 0.04)
        add("NARROW", "warning", [c.id], "杯口太窄，小球无法进入");
    }
  return issues;
}
export function parseProject(raw: unknown): Project {
  const stack: Array<[unknown, number]> = [[raw, 0]];
  while (stack.length) {
    const [value, depth] = stack.pop()!;
    if (depth > 16) throw Error("场景嵌套过深");
    if (value && typeof value === "object")
      for (const child of Object.values(value)) stack.push([child, depth + 1]);
  }
  const p = projectSchema.parse(
    raw && typeof raw === "object" && "fileVersion" in raw
      ? raw
      : { fileVersion: 1, scene: raw, strokes: [] },
  );
  if (p.strokes.reduce((n, s) => n + s.points.length, 0) > limits.points)
    throw Error("笔迹点数超限");
  const errors = validate(p.scene).filter((x) => x.severity === "invalid");
  if (errors.length) throw Error(errors[0].message);
  return p;
}
export function pointInPolygon(p: Vec, poly: Vec[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
export function lassoHit(o: SceneObject, poly: Vec[]): boolean {
  if (poly.length < 3) return false;
  const area =
    Math.abs(
      poly.reduce((sum, p, i) => {
        const q = poly[(i + 1) % poly.length];
        return sum + p[0] * q[1] - q[0] * p[1];
      }, 0),
    ) / 2;
  if (area < 0.0001) return false;
  return geometry(o).some((g) => {
    if (poly.some((p) => signedDistance(p, g) <= 0)) return true;
    if (g.type === "circle")
      return (
        pointInPolygon(g.center, poly) ||
        poly.some(
          (p, i) =>
            segmentDistance(g.center, p, poly[(i + 1) % poly.length]) <=
            g.radius,
        )
      );
    if (g.type === "capsule")
      return (
        pointInPolygon(g.a, poly) ||
        pointInPolygon(g.b, poly) ||
        poly.some(
          (p, i) =>
            segmentSegmentDistance(p, poly[(i + 1) % poly.length], g.a, g.b) <=
            g.radius,
        )
      );
    const corners = boxCorners(g);
    return (
      corners.some((p) => pointInPolygon(p, poly)) ||
      poly.some((p, i) =>
        corners.some(
          (q, j) =>
            segmentSegmentDistance(
              p,
              poly[(i + 1) % poly.length],
              q,
              corners[(j + 1) % 4],
            ) < 1e-8,
        ),
      )
    );
  });
}
function segmentSegmentDistance(a: Vec, b: Vec, c: Vec, d: Vec) {
  const cross = (p: Vec, q: Vec, r: Vec) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  if (
    cross(a, b, c) * cross(a, b, d) < 0 &&
    cross(c, d, a) * cross(c, d, b) < 0
  )
    return 0;
  return Math.min(
    segmentDistance(a, c, d),
    segmentDistance(b, c, d),
    segmentDistance(c, a, b),
    segmentDistance(d, a, b),
  );
}
/** Free drawing is a static solid line, including loops and crossings. */
export function physicalStroke(s: Stroke): SceneObject {
  const thickness = s.width ?? 0.045,
    r = thickness / 2 + 0.00001;
  const points: Vec[] = [];
  for (const p of s.points) {
    const q: Vec = [
      Math.max(r, Math.min(12 - r, p[0])),
      Math.max(r, Math.min(8 - r, p[1])),
    ];
    if (!points.length || distance(points.at(-1)!, q) >= 0.005) points.push(q);
  }
  if (!points.length) throw new Error("笔迹为空");
  if (points.length === 1) {
    const p = points[0];
    points.push([p[0] > 6 ? p[0] - 0.006 : p[0] + 0.006, p[1]]);
  }
  let epsilon = 0.008;
  let simplified = rdp(points, epsilon);
  while (simplified.length > 121) simplified = rdp(points, (epsilon *= 1.4));
  simplified = simplified.filter(
    (p, i, a) => !i || distance(p, a[i - 1]) >= 0.004,
  );
  if (simplified.length < 2) simplified = points.slice(0, 2);
  const o = makeObject("track", [0, 0]);
  if (o.kind === "track")
    o.shape = { type: "polyline", points: simplified, thickness };
  o.color = s.color;
  o.sourceStrokeIds = [s.id];
  return o;
}
export function selectionRectangle(a: Vec, b: Vec): Vec[] {
  return [
    [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
    [Math.max(a[0], b[0]), Math.min(a[1], b[1])],
    [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
    [Math.min(a[0], b[0]), Math.max(a[1], b[1])],
  ];
}
export function fitStroke(s: Stroke): SceneObject | null {
  if (s.points.length < 2) return null;
  const pts = s.points;
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs),
    h = Math.max(...ys) - Math.min(...ys);
  if (Math.hypot(w, h) < 0.15) return null;
  for (let i = 0; i < pts.length - 1; i++)
    for (let j = i + 2; j < pts.length - 1; j++) {
      if (i === 0 && j === pts.length - 2) continue;
      const a = pts[i],
        b = pts[i + 1],
        c = pts[j],
        d = pts[j + 1];
      const cross = (p: Vec, q: Vec, r: Vec) =>
        (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
      if (
        cross(a, b, c) * cross(a, b, d) < 0 &&
        cross(c, d, a) * cross(c, d, b) < 0
      )
        return null;
    }
  const center: Vec = [
    (Math.max(...xs) + Math.min(...xs)) / 2,
    (Math.max(...ys) + Math.min(...ys)) / 2,
  ];
  const radius = (w + h) / 4;
  if (
    radius >= 0.1 &&
    radius <= 0.5 &&
    distance(pts[0], pts.at(-1)!) < radius * 0.65 &&
    pts.reduce((n, p) => n + Math.abs(distance(p, center) - radius), 0) /
      pts.length /
      radius <
      0.12
  ) {
    const o = makeObject("ball", center);
    if (o.kind === "ball") o.shape.radius = radius;
    o.sourceStrokeIds = [s.id];
    return o;
  }
  const simplified = rdp(pts, 0.03);
  if (
    simplified.length < 2 ||
    simplified.some((p, i) => i > 0 && distance(p, simplified[i - 1]) < 0.15) ||
    distance(pts[0], pts.at(-1)!) < 0.15
  )
    return null;
  const o = makeObject("track", [0, 0]);
  if (o.kind === "track") o.shape.points = simplified;
  o.sourceStrokeIds = [s.id];
  return o;
}
function rdp(p: Vec[], epsilon: number): Vec[] {
  if (p.length < 3) return p;
  let max = 0,
    index = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const d = segmentDistance(p[i], p[0], p.at(-1)!);
    if (d > max) {
      max = d;
      index = i;
    }
  }
  return max > epsilon
    ? [
        ...rdp(p.slice(0, index + 1), epsilon).slice(0, -1),
        ...rdp(p.slice(index), epsilon),
      ]
    : [p[0], p.at(-1)!];
}

const updateSchema = z.strictObject({
  type: z.literal("updateObject"),
  objectId: z.string(),
  changes: z.record(z.string(), z.unknown()),
});
export const patchSchema = z.strictObject({
  operations: z
    .array(
      z.union([
        updateSchema,
        z.strictObject({
          type: z.literal("removeObject"),
          objectId: z.string(),
        }),
        z.strictObject({ type: z.literal("addObject"), object: z.unknown() }),
      ]),
    )
    .min(1)
    .max(10),
  explanation: z.string().max(1000),
});
export type Patch = z.infer<typeof patchSchema>;
export function applyPatch(
  scene: Scene,
  raw: unknown,
  targets: string[],
  baseRevision: number,
  anchor?: Vec,
): Scene {
  if (scene.revision !== baseRevision)
    throw Error("场景版本已改变，请重新请求");
  const patch = patchSchema.parse(raw),
    next = clone(scene),
    seen = new Set<string>();
  for (const op of patch.operations) {
    if (op.type === "addObject") {
      if (!anchor) throw Error("请先在画布指定新增位置");
      const candidate = objectSchema.parse({
        ...(op.object as object),
        id: uid(),
      });
      if (
        geometry(candidate).some((g) => {
          const [l, b, r, t] = bounds(g);
          return [
            [l, b],
            [l, t],
            [r, b],
            [r, t],
          ].some((p) => distance(p as Vec, anchor) > 1);
        })
      )
        throw Error("新增对象超出锚点 1 米范围");
      next.objects.push(candidate);
      continue;
    }
    if (!targets.includes(op.objectId) || seen.has(op.objectId))
      throw Error("修改越出选择范围或重复修改");
    seen.add(op.objectId);
    const index = next.objects.findIndex((o) => o.id === op.objectId);
    if (index < 0) throw Error("对象不存在");
    if (op.type === "removeObject") {
      next.objects.splice(index, 1);
      continue;
    }
    if (
      Object.keys(op.changes).some(
        (k) => !["transform", "shape", "physics", "behavior"].includes(k),
      )
    )
      throw Error("不允许修改此字段");
    const before = next.objects[index],
      after = objectSchema.parse({ ...before, ...op.changes });
    if (before.physics.bodyType !== after.physics.bodyType)
      throw Error("不能修改物体类型");
    for (const joint of next.constraints.filter((j) => j.bodyId === before.id))
      joint.anchor = [
        joint.anchor[0] +
          after.transform.position[0] -
          before.transform.position[0],
        joint.anchor[1] +
          after.transform.position[1] -
          before.transform.position[1],
      ];
    next.objects[index] = after;
  }
  for (const target of next.objectives)
    if (
      !next.objects.some((o) => o.id === target.ballId) ||
      !next.objects.some((o) => o.id === target.cupId)
    )
      target.enabled = false;
  next.constraints = next.constraints.filter((j) =>
    next.objects.some((o) => o.id === j.bodyId && o.kind === "block"),
  );
  const bad = validate(next).find((i) => i.severity !== "warning");
  if (bad) throw Error(bad.message);
  return next;
}

export class History {
  undoStack: Project[] = [];
  redoStack: Project[] = [];
  commit(current: Project, next: Project) {
    parseProject(next);
    this.undoStack.push(clone(current));
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
    return {
      ...next,
      scene: { ...next.scene, revision: current.scene.revision + 1 },
    };
  }
  undo(current: Project) {
    const prior = this.undoStack.pop();
    if (!prior) return current;
    this.redoStack.push(clone(current));
    return {
      ...prior,
      scene: { ...prior.scene, revision: current.scene.revision + 1 },
    };
  }
  redo(current: Project) {
    const next = this.redoStack.pop();
    if (!next) return current;
    this.undoStack.push(clone(current));
    return {
      ...next,
      scene: { ...next.scene, revision: current.scene.revision + 1 },
    };
  }
}

/** Deterministic repair proposal. Caller must preview before committing. */
export function repairScene(scene: Scene): Scene {
  const next = clone(scene);
  for (const o of next.objects) {
    const boxes = geometry(o)
      .filter((g) => !(g.type === "box" && g.sensor))
      .map(bounds);
    const left = Math.min(...boxes.map((b) => b[0])),
      bottom = Math.min(...boxes.map((b) => b[1])),
      right = Math.max(...boxes.map((b) => b[2])),
      top = Math.max(...boxes.map((b) => b[3]));
    o.transform.position[0] += left < 0 ? -left : right > 12 ? 12 - right : 0;
    o.transform.position[1] += bottom < 0 ? -bottom : top > 8 ? 8 - top : 0;
  }
  for (const o of next.objects) {
    if (
      o.kind !== "ball" ||
      !validate(next).some(
        (i) => i.code === "OVERLAP" && i.objectIds.includes(o.id),
      )
    )
      continue;
    const original: Vec = [...o.transform.position];
    let found = false;
    for (let radius = 0.01; radius <= 0.30001 && !found; radius += 0.01) {
      for (let i = 0; i < 32; i++) {
        const a = (i * Math.PI) / 16;
        o.transform.position = [
          original[0] + Math.cos(a) * radius,
          original[1] + Math.sin(a) * radius,
        ];
        if (
          !validate(next).some(
            (issue) =>
              issue.severity !== "warning" && issue.objectIds.includes(o.id),
          )
        ) {
          found = true;
          break;
        }
      }
    }
    if (!found) o.transform.position = original;
  }
  return next;
}

export function steepenTrack(object: SceneObject): SceneObject {
  if (object.kind !== "track" || object.shape.points.length !== 2)
    throw Error("请先选择只有一段的轨道");
  const o = clone(object);
  if (o.kind !== "track") return o;
  const [a, b] = o.shape.points;
  const low = a[1] <= b[1] ? 0 : 1,
    high = 1 - low,
    p = o.shape.points[low],
    q = o.shape.points[high],
    length = distance(p, q),
    sign = q[0] >= p[0] ? 1 : -1;
  const angle =
    (Math.min(
      75,
      Math.max(
        5,
        (Math.atan2(Math.abs(q[1] - p[1]), Math.abs(q[0] - p[0])) * 180) /
          Math.PI +
          10,
      ),
    ) *
      Math.PI) /
    180;
  o.shape.points[high] = [
    p[0] + sign * length * Math.cos(angle),
    p[1] + length * Math.sin(angle),
  ];
  return o;
}

/** Ready-to-play chain-reaction examples using existing scene contracts. */
export function chainExample(which: "domino" | "lever"): Project {
  const p = emptyProject();
  if (which === "domino") {
    const ball = makeObject("ball", [2, 3]);
    const ramp = makeObject("track", [0, 0]);
    if (ramp.kind === "track")
      ramp.shape.points = [
        [1, 2.5],
        [3.8, 0.3],
      ];
    p.scene.objects = [ball, ramp];
    for (let i = 0; i < 7; i++) {
      const block = makeObject("block", [4.4 + i * 0.65, 0.52]);
      if (block.kind === "block") {
        block.shape.width = 0.18;
        block.physics.mass = 0.3;
      }
      p.scene.objects.push(block);
    }
  } else {
    const board = makeObject("seesaw", [6, 1]);
    const weight = makeObject("block", [5.1, 4]);
    if (weight.kind === "block") {
      weight.shape.width = 0.6;
      weight.shape.height = 0.6;
      weight.physics.mass = 4;
    }
    const ball = makeObject("ball", [7, 1.3]);
    if (ball.kind === "ball") ball.physics.mass = 0.1;
    p.scene.objects = [board, weight, ball];
  }
  return p;
}
