import { describe, it, expect } from "vitest";
import {
  challengeProject,
  challenges,
  challengeViolation,
} from "../packages/core/src/challenges";
import {
  chainExample,
  clone,
  emptyProject,
  makeObject,
  physicalStroke,
  parseProject,
  validate,
} from "../packages/core/src/index";
import { Simulation } from "../apps/web/src/simulation/physics";
import { store } from "../apps/web/src/editor/store";

describe("challenge rules and physics", () => {
  it("has a repeatable one-stroke solution for each of five levels", async () => {
    for (let index = 0; index < 5; index++)
      for (let repeat = 0; repeat < 3; repeat++) {
        const base = challengeProject(index),
          p = clone(base);
        const points: [number, number][] =
          index === 1
            ? [
                [11, 4.8],
                [5, 1.7],
              ]
            : index === 2
              ? [
                  [1, 4.8],
                  [8, 1.7],
                ]
              : index === 4
                ? [
                    [4, 3.25],
                    [7, 1.7],
                  ]
                : [
                    [1, 4.8],
                    [7, 1.7],
                  ];
        const stroke = {
          id: "solution",
          points,
          status: "converted" as const,
          width: 0.08,
        };
        p.strokes.push(stroke);
        p.scene.objects.push(physicalStroke(stroke));
        expect(
          challengeViolation(base, p, challenges[index].maxStrokes),
        ).toBeUndefined();
        expect(
          validate(p.scene).filter((i) => i.severity !== "warning"),
        ).toEqual([]);
        const sim = new Simulation();
        try {
          await sim.create(p.scene);
          for (let i = 0; i < 3600 && !sim.won; i++) sim.step(p.scene);
          expect(sim.won, `level ${index}, repeat ${repeat}`).toBe(true);
        } finally {
          sim.destroy();
        }
      }
  });
  it("protects fixed objects and the stroke budget at the transaction boundary", () => {
    store.replace(emptyProject());
    store.enterChallenge(0, false);
    const original = clone(store.get().project);
    store.change((p) => {
      p.scene.objects[0].transform.position[0]++;
    });
    expect(store.get().project).toEqual(original);
    store.change((p) => {
      p.scene.objects.push(makeObject("block", [4, 4]));
    });
    expect(store.get().project).toEqual(original);
    for (let i = 0; i < 4; i++)
      store.change((p) => {
        const stroke = {
          id: `s${i}`,
          points: [
            [3 + i, 2],
            [3.5 + i, 2],
          ] as [number, number][],
          status: "converted" as const,
        };
        p.strokes.push(stroke);
        p.scene.objects.push(physicalStroke(stroke));
      });
    expect(store.get().project.strokes).toHaveLength(3);
    store.undo();
    expect(store.get().project.strokes).toHaveLength(2);
    store.redo();
    expect(store.get().project.strokes).toHaveLength(3);
    store.leaveChallenge();
    expect(store.get().project.scene.objects).toHaveLength(0);
  });
});

describe("dynamic components and observation", () => {
  it("chain examples transfer motion and remain playable", async () => {
    for (const kind of ["domino", "lever"] as const) {
      const p = chainExample(kind);
      expect(validate(p.scene).filter((i) => i.severity !== "warning")).toEqual(
        [],
      );
      const sim = new Simulation();
      try {
        await sim.create(p.scene);
        let maxBallHeight = 0;
        for (let i = 0; i < 960; i++) {
          sim.step(p.scene);
          if (kind === "lever")
            maxBallHeight = Math.max(
              maxBallHeight,
              sim.poses.get(p.scene.objects[2].id)!.position[1],
            );
        }
        if (kind === "domino")
          expect(
            Math.abs(sim.poses.get(p.scene.objects.at(-1)!.id)!.rotation),
          ).toBeGreaterThan(0.5);
        else expect(maxBallHeight).toBeGreaterThan(1.8);
      } finally {
        sim.destroy();
      }
    }
  });
  it("detects rotated block overlaps and enforces a shared dynamic-body budget", () => {
    const p = emptyProject(),
      a = makeObject("block", [3, 3]),
      b = makeObject("block", [3, 3]);
    b.transform.rotation = 0.7;
    p.scene.objects = [a, b];
    expect(validate(p.scene).some((i) => i.code === "OVERLAP")).toBe(true);
    p.scene.objects = Array.from({ length: 31 }, (_, i) =>
      makeObject(i % 2 ? "block" : "ball", [
        1 + (i % 10),
        1 + Math.floor(i / 10),
      ]),
    );
    expect(() => parseProject(p)).toThrow();
  });
  it("keeps thirty pivoted dynamic bodies stable at the capacity limit", async () => {
    const p = emptyProject();
    for (let i = 0; i < 30; i++) {
      const o = makeObject("seesaw", [1 + (i % 5) * 2, 1 + Math.floor(i / 5)]);
      if (o.kind === "seesaw") o.shape.width = 0.8;
      p.scene.objects.push(o);
    }
    expect(validate(p.scene)).toEqual([]);
    const sim = new Simulation();
    try {
      await sim.create(p.scene);
      for (let i = 0; i < 1200; i++) sim.step(p.scene);
      for (const o of p.scene.objects) {
        expect(sim.poses.get(o.id)!.position[0]).toBeCloseTo(
          o.transform.position[0],
          3,
        );
        expect(sim.poses.get(o.id)!.position[1]).toBeCloseTo(
          o.transform.position[1],
          3,
        );
      }
    } finally {
      sim.destroy();
    }
  });
  it("simulates rotated blocks and fixed pivots without changing the design", async () => {
    const p = emptyProject();
    const block = makeObject("block", [3, 5]),
      hinged = makeObject("block", [6, 3]),
      seesaw = makeObject("seesaw", [9, 2]);
    block.transform.rotation = 0.4;
    p.scene.objects = [block, hinged, seesaw];
    p.scene.constraints = [
      { id: "hinge", type: "hinge", bodyId: hinged.id, anchor: [6, 3] },
    ];
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
    const initial = JSON.stringify(p),
      sim = new Simulation();
    try {
      await sim.create(p.scene);
      sim.bodies.get(seesaw.id)!.applyTorqueImpulse(0.5, true);
      for (let i = 0; i < 480; i++) sim.step(p.scene);
      expect(sim.poses.get(block.id)!.position[1]).toBeLessThan(1);
      expect(sim.poses.get(hinged.id)!.position[0]).toBeCloseTo(6, 3);
      expect(sim.poses.get(hinged.id)!.position[1]).toBeCloseTo(3, 3);
      expect(sim.poses.get(seesaw.id)!.position[1]).toBeCloseTo(2, 3);
      expect(Math.abs(sim.poses.get(seesaw.id)!.rotation)).toBeGreaterThan(0.1);
      expect(JSON.stringify(p)).toBe(initial);
    } finally {
      sim.destroy();
    }
  });
  it("cleans up deleted hinges atomically and rejects dangling imports", () => {
    const p = emptyProject(),
      block = makeObject("block", [3, 3]);
    p.scene.objects.push(block);
    p.scene.constraints.push({
      id: "hinge",
      type: "hinge",
      bodyId: block.id,
      anchor: [3, 3],
    });
    store.replace(p);
    store.change((p) => {
      p.scene.objects = [];
    });
    expect(store.get().project.scene.constraints).toHaveLength(0);
    store.undo();
    expect(store.get().project.scene.constraints).toHaveLength(1);
    const invalid = clone(p);
    invalid.scene.objects = [];
    expect(() => parseProject(invalid)).toThrow();
  });
  it("bounds actual trajectories and isolates predictive runs", async () => {
    const p = challengeProject(0),
      initial = JSON.stringify(p),
      actual = new Simulation(),
      predicted = new Simulation();
    try {
      await actual.create(p.scene);
      await predicted.create(p.scene);
      for (let i = 0; i < 960; i++) predicted.step(p.scene);
      expect(actual.time).toBe(0);
      expect(actual.trajectories.size).toBe(0);
      for (let i = 0; i < 960; i++) actual.step(p.scene);
      expect(actual.poses).toEqual(predicted.poses);
      for (let i = 0; i < 8000; i++) actual.step(p.scene);
      expect(
        actual.trajectories.get("target-ball")!.length,
      ).toBeLessThanOrEqual(1800);
      expect(JSON.stringify(p)).toBe(initial);
    } finally {
      actual.destroy();
      predicted.destroy();
    }
  });
});
