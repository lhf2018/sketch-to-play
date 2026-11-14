import type RAPIER from "@dimforge/rapier2d-compat";
import { geometry, limits, type Scene, type Vec } from "@sketch/core";
let ready:
  Promise<(typeof import("@dimforge/rapier2d-compat"))["default"]> | undefined;
export type Pose = { position: Vec; rotation: number };
export class Simulation {
  world!: RAPIER.World;
  bodies = new Map<string, RAPIER.RigidBody>();
  poses = new Map<string, Pose>();
  escaped = new Set<string>();
  won = false;
  springFired = new Map<string, number>();
  time = 0;
  private pairs = new Map<
    string,
    { inside: boolean; last: number; launches: number }
  >();
  private targetTimes = new Map<number, number>();
  async create(scene: Scene) {
    ready ??= import("@dimforge/rapier2d-compat").then(async (module) => {
      await module.default.init();
      return module.default;
    });
    const RAPIER = await ready;
    this.world = new RAPIER.World({ x: 0, y: -9.8 });
    this.world.timestep = 1 / 120;
    this.world.integrationParameters.maxCcdSubsteps = 4;
    this.world.integrationParameters.normalizedPredictionDistance = 0.08;
    this.world.integrationParameters.numSolverIterations = 8;
    for (const [x, y, hx, hy] of [
      [-0.1, 4, 0.1, 5],
      [12.1, 4, 0.1, 5],
      [6, -0.1, 6, 0.1],
    ])
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy).setTranslation(x, y),
      );
    for (const o of scene.objects) {
      const body = this.world.createRigidBody(
        (o.kind === "ball"
          ? RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true)
          : RAPIER.RigidBodyDesc.fixed()
        )
          .setTranslation(...o.transform.position)
          .setRotation(o.transform.rotation),
      );
      this.bodies.set(o.id, body);
      for (const g of geometry(o)) {
        let desc: RAPIER.ColliderDesc;
        if (g.type === "circle")
          desc = RAPIER.ColliderDesc.ball(g.radius).setDensity(
            o.kind === "ball"
              ? o.physics.mass / (Math.PI * g.radius * g.radius)
              : 1,
          );
        else if (g.type === "capsule") {
          const dx = g.b[0] - g.a[0],
            dy = g.b[1] - g.a[1];
          desc = RAPIER.ColliderDesc.capsule(Math.hypot(dx, dy) / 2, g.radius)
            .setTranslation(
              (g.a[0] + g.b[0]) / 2 - o.transform.position[0],
              (g.a[1] + g.b[1]) / 2 - o.transform.position[1],
            )
            .setRotation(
              Math.atan2(dy, dx) - Math.PI / 2 - o.transform.rotation,
            );
          // Track points are world-transformed; remove the body rotation from offsets.
          const a = -o.transform.rotation,
            x = (g.a[0] + g.b[0]) / 2 - o.transform.position[0],
            y = (g.a[1] + g.b[1]) / 2 - o.transform.position[1];
          desc.setTranslation(
            x * Math.cos(a) - y * Math.sin(a),
            x * Math.sin(a) + y * Math.cos(a),
          );
        } else
          desc = RAPIER.ColliderDesc.cuboid(...g.half)
            .setTranslation(
              g.center[0] - o.transform.position[0],
              g.center[1] - o.transform.position[1],
            )
            .setSensor(!!g.sensor);
        desc
          .setFriction(o.physics.friction)
          .setRestitution(o.physics.restitution)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Average);
        this.world.createCollider(desc, body);
      }
    }
    this.read();
  }
  step(scene: Scene) {
    const previous = new Map(
      [...this.bodies].map(([id, b]) => [
        id,
        { ...b.translation(), vy: b.linvel().y },
      ]),
    );
    this.world.step();
    this.time += 1 / 120;
    for (const o of scene.objects) {
      if (o.kind !== "ball" || this.escaped.has(o.id)) continue;
      const b = this.bodies.get(o.id)!;
      const p = b.translation(),
        v = b.linvel();
      if (![p.x, p.y, v.x, v.y].every(Number.isFinite))
        throw Error("物理计算异常，请重置");
      if (p.x < -1 || p.x > 13 || p.y < -1 || p.y > 9) {
        this.escaped.add(o.id);
        this.world.removeRigidBody(b);
        this.bodies.delete(o.id);
        continue;
      }
      for (const spring of scene.objects) {
        if (spring.kind !== "spring") continue;
        const key = JSON.stringify([spring.id, o.id]),
          state = this.pairs.get(key) ?? {
            inside: false,
            last: -Infinity,
            launches: 0,
          };
        const [sx, sy] = spring.transform.position,
          r = o.shape.radius;
        const top = sy + 0.38;
        const inside =
          Math.abs(p.x - sx) <= 0.2 + r &&
          p.y - r >= top - 0.03 &&
          p.y - r <= top + 0.08;
        const prev = previous.get(o.id)!;
        const fromAbove = prev.y - r >= top - 0.02 && prev.vy <= 0.02;
        const hitTop =
          Math.abs(p.x - sx) <= 0.2 &&
          p.y - r <= top + 0.025 &&
          p.y - r >= top - 0.03;
        // Each spring/ball pair loses 30% of its launch impulse per return.
        // A new ball starts at full strength; reset rebuilds this runtime state.
        const impulse = spring.behavior.impulse * 0.7 ** state.launches;
        if (
          !state.inside &&
          fromAbove &&
          hitTop &&
          this.time - state.last >= 0.3 &&
          impulse / o.physics.mass >= 0.6
        ) {
          const [dx, dy] = spring.behavior.direction;
          // The plate may be reached before the contact solver cancels the fall.
          // Resolve vertical contact before launching. Do not stack the plate's
          // ordinary restitution on top of the decaying spring impulse.
          const velocity = b.linvel();
          b.setLinvel({ x: velocity.x, y: 0 }, true);
          b.applyImpulse(
            {
              x: dx * impulse,
              y: dy * impulse,
            },
            true,
          );
          state.last = this.time;
          state.launches++;
          state.inside = true;
          this.springFired.set(spring.id, this.time);
        }
        // Latch only after firing; touching at rest must not disarm the pad.
        state.inside = inside && state.inside;
        this.pairs.set(key, state);
      }
      const velocity = b.linvel(),
        speed = Math.hypot(velocity.x, velocity.y);
      if (speed > limits.speed)
        b.setLinvel(
          {
            x: (velocity.x * limits.speed) / speed,
            y: (velocity.y * limits.speed) / speed,
          },
          true,
        );
    }
    scene.objectives.forEach((t, i) => {
      if (!t.enabled) return;
      const ball = scene.objects.find((o) => o.id === t.ballId),
        cup = scene.objects.find((o) => o.id === t.cupId),
        b = this.bodies.get(t.ballId);
      if (ball?.kind !== "ball" || cup?.kind !== "cup" || !b) return;
      const p = b.translation(),
        v = b.linvel(),
        [x, y] = cup.transform.position,
        r = ball.shape.radius;
      const valid =
        Math.abs(p.x - x) < cup.shape.innerWidth / 2 - r &&
        p.y - r >= y + 0.07 &&
        p.y + r < y + 0.08 + cup.shape.innerHeight &&
        Math.hypot(v.x, v.y) < 0.3;
      const ticks = valid ? (this.targetTimes.get(i) ?? 0) + 1 : 0;
      this.targetTimes.set(i, ticks);
      if (ticks >= 60) this.won = true;
    });
    this.read();
  }
  private read() {
    for (const [id, b] of this.bodies) {
      const p = b.translation();
      this.poses.set(id, { position: [p.x, p.y], rotation: b.rotation() });
    }
  }
  destroy() {
    this.world?.free();
    this.bodies.clear();
    this.poses.clear();
    this.pairs.clear();
    this.targetTimes.clear();
  }
}
