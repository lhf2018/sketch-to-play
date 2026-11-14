import { describe, it, expect } from "vitest";
import {
  emptyProject,
  example,
  makeObject,
  physicalStroke,
  validate,
  geometry,
} from "../packages/core/src/index";
import { Simulation } from "../apps/web/src/simulation/physics";
describe("local physics", () => {
  it("freehand loops, crossings and dots have matching solid thickness", async () => {
    for (const width of [0.015, 0.12]) {
      for (const points of [
        [[2, 2]],
        [
          [2, 2],
          [4, 4],
          [2, 4],
          [4, 2],
        ],
        [
          [2, 2],
          [4, 2],
          [4, 4],
          [2, 2],
        ],
      ] as [number, number][][]) {
        const o = physicalStroke({
          id: "ink",
          points,
          status: "converted",
          width,
          color: "#5668de",
        });
        const p = emptyProject();
        p.scene.objects = [o];
        expect(
          validate(p.scene).filter((i) => i.severity !== "warning"),
        ).toEqual([]);
        expect(
          geometry(o).every(
            (g) => g.type === "capsule" && g.radius === width / 2,
          ),
        ).toBe(true);
        const sim = new Simulation();
        await sim.create(p.scene);
        sim.step(p.scene);
        sim.destroy();
      }
    }
  });
  it("only launches balls landing on the top plate, not the sides or underside", async () => {
    for (const approach of ["top", "side", "bottom"] as const) {
      const project = emptyProject(),
        spring = makeObject("spring", [3, 1]);
      const ball = makeObject(
        "ball",
        approach === "top"
          ? [3, 2]
          : approach === "side"
            ? [2.4, 1.12]
            : [3, 0.4],
      );
      project.scene.objects = [ball, spring];
      const sim = new Simulation();
      await sim.create(project.scene);
      if (approach === "side")
        sim.bodies.get(ball.id)!.setLinvel({ x: 4, y: 0 }, true);
      if (approach === "bottom")
        sim.bodies.get(ball.id)!.setLinvel({ x: 0, y: 4 }, true);
      for (let i = 0; i < 90; i++) sim.step(project.scene);
      expect(sim.springFired.has(spring.id), approach).toBe(approach === "top");
      sim.destroy();
    }
  });
  it("launches visibly, loses height on each return, and settles without recharging", async () => {
    for (const height of [1.58, 2, 4, 7]) {
      const p = emptyProject(),
        spring = makeObject("spring", [3, 1]),
        ball = makeObject("ball", [3, height]);
      p.scene.objects = [ball, spring];
      const sim = new Simulation();
      await sim.create(p.scene);
      let launches = 0,
        last = -Infinity;
      const velocities: number[] = [];
      const before = JSON.stringify(p.scene);
      for (let i = 0; i < 1200; i++) {
        sim.step(p.scene);
        const fired = sim.springFired.get(spring.id) ?? -Infinity;
        if (fired > last) {
          launches++;
          last = fired;
          velocities.push(sim.bodies.get(ball.id)!.linvel().y);
        }
      }
      expect(velocities[0], `drop height ${height}`).toBeGreaterThanOrEqual(
        2.9,
      );
      expect(launches).toBeGreaterThanOrEqual(3);
      expect(launches).toBeLessThanOrEqual(7);
      for (let i = 1; i < velocities.length; i++)
        expect(velocities[i]).toBeLessThan(velocities[i - 1] * 0.8);
      expect(Math.abs(sim.bodies.get(ball.id)!.linvel().y)).toBeLessThan(0.05);
      expect(sim.poses.get(ball.id)!.position[1]).toBeCloseTo(1.58, 1);
      const lastLaunch = sim.springFired.get(spring.id);
      for (let i = 0; i < 600; i++) sim.step(p.scene);
      expect(sim.springFired.get(spring.id)).toBe(lastLaunch);
      expect(JSON.stringify(p.scene)).toBe(before);
      sim.destroy();
    }
  });
  it("keeps decay independent for each ball and restores full strength on reset", async () => {
    const p = emptyProject(),
      spring = makeObject("spring", [3, 1]),
      ball = makeObject("ball", [3, 2]),
      other = makeObject("ball", [8, 2]);
    p.scene.objects = [spring, ball, other];
    const sim = new Simulation();
    await sim.create(p.scene);
    for (let i = 0; i < 1200; i++) sim.step(p.scene);
    sim.bodies.get(ball.id)!.setTranslation({ x: 6, y: 0.5 }, true);
    sim.bodies.get(other.id)!.setTranslation({ x: 3, y: 2 }, true);
    sim.bodies.get(other.id)!.setLinvel({ x: 0, y: 0 }, true);
    const previous = sim.springFired.get(spring.id)!;
    for (let i = 0; i < 120 && sim.springFired.get(spring.id) === previous; i++)
      sim.step(p.scene);
    expect(sim.bodies.get(other.id)!.linvel().y).toBeCloseTo(3, 1);
    sim.destroy();
    const fresh = new Simulation();
    await fresh.create(p.scene);
    for (let i = 0; i < 120 && !fresh.springFired.size; i++)
      fresh.step(p.scene);
    expect(fresh.bodies.get(ball.id)!.linvel().y).toBeCloseTo(3, 1);
    fresh.destroy();
  });
  it("preserves the design and rebuilds initial state on reset", async () => {
    const scene = example().scene,
      before = JSON.stringify(scene),
      id = scene.objects[0].id;
    const s = new Simulation();
    await s.create(scene);
    for (let i = 0; i < 120; i++) s.step(scene);
    expect(s.poses.get(id)!.position[1]).toBeLessThan(5.3);
    expect(JSON.stringify(scene)).toBe(before);
    s.destroy();
    const fresh = new Simulation();
    await fresh.create(scene);
    expect(fresh.poses.get(id)!.position).toEqual([2, expect.closeTo(5.3, 4)]);
    fresh.destroy();
  });
  it("completes both example targets 20 times each", async () => {
    for (const which of ["ramp", "spring"] as const)
      for (let run = 0; run < 20; run++) {
        const scene = example(which).scene,
          sim = new Simulation();
        await sim.create(scene);
        for (let i = 0; i < 2400 && !sim.won; i++) sim.step(scene);
        expect(sim.won, which).toBe(true);
        sim.destroy();
      }
  });
  it("blocks high speed balls at a thin horizontal track", async () => {
    const p = emptyProject(),
      ball = makeObject("ball", [5, 5]),
      track = makeObject("track", [0, 0]);
    if (track.kind === "track")
      track.shape.points = [
        [1, 2],
        [10, 2],
      ];
    p.scene.objects = [ball, track];
    const s = new Simulation();
    await s.create(p.scene);
    s.bodies.get(ball.id)!.setLinvel({ x: 0, y: -12 }, true);
    for (let i = 0; i < 120; i++) {
      s.step(p.scene);
      expect(s.poses.get(ball.id)!.position[1]).toBeGreaterThan(2.15);
    }
    s.destroy();
  });
  it("does not cross a thin track in 100 fixed high-speed approach conditions", async () => {
    for (let i = 0; i < 100; i++) {
      const angle = ((i % 25) / 24) * Math.PI * 0.8 - Math.PI * 0.4,
        normal: [number, number] = [-Math.sin(angle), Math.cos(angle)],
        tangent: [number, number] = [Math.cos(angle), Math.sin(angle)],
        offset = (Math.floor(i / 25) - 1.5) * 0.8;
      const p = emptyProject(),
        ball = makeObject("ball", [
          6 + normal[0] * 0.6 + tangent[0] * offset,
          4 + normal[1] * 0.6 + tangent[1] * offset,
        ]),
        track = makeObject("track", [0, 0]);
      if (ball.kind === "ball") ball.shape.radius = 0.1;
      if (track.kind === "track")
        track.shape.points = [
          [6 - tangent[0] * 2, 4 - tangent[1] * 2],
          [6 + tangent[0] * 2, 4 + tangent[1] * 2],
        ];
      p.scene.objects = [ball, track];
      const sim = new Simulation();
      await sim.create(p.scene);
      sim.bodies
        .get(ball.id)!
        .setLinvel({ x: -normal[0] * 12, y: -normal[1] * 12 }, true);
      for (let tick = 0; tick < 12; tick++) {
        sim.step(p.scene);
        const v = sim.poses.get(ball.id)!.position;
        expect(
          (v[0] - 6) * normal[0] + (v[1] - 4) * normal[1],
          `condition ${i}`,
        ).toBeGreaterThan(0.12);
      }
      sim.destroy();
    }
  });
});
