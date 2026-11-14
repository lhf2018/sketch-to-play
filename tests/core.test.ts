import { describe, it, expect } from "vitest";
import {
  applyPatch,
  clone,
  emptyProject,
  example,
  fitStroke,
  History,
  makeObject,
  parseProject,
  validate,
  lassoHit,
  type Vec,
} from "../packages/core/src/index";
describe("scene contracts", () => {
  it("lasso uses visible geometry rather than a track storage origin", () => {
    const track = makeObject("track", [0, 0]);
    if (track.kind === "track")
      track.shape.points = [
        [5, 5],
        [7, 5],
      ];
    expect(
      lassoHit(track, [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]),
    ).toBe(false);
    expect(
      lassoHit(track, [
        [5.5, 4.5],
        [6.5, 4.5],
        [6.5, 5.5],
        [5.5, 5.5],
      ]),
    ).toBe(true);
    expect(
      lassoHit(track, [
        [5, 5],
        [6, 5],
        [7, 5],
      ]),
    ).toBe(false);
    const cup = makeObject("cup", [5, 3]);
    expect(
      lassoHit(cup, [
        [4.8, 3.2],
        [5.2, 3.2],
        [5.2, 3.5],
        [4.8, 3.5],
      ]),
    ).toBe(false);
  });
  it("loads both project files and PRD scene documents", () => {
    const p = example();
    expect(parseProject(p.scene).scene).toEqual(p.scene);
    expect(parseProject(p)).toEqual(p);
  });
  it("rejects duplicate IDs, invalid geometry and unsupported constraints", () => {
    const p = example();
    p.scene.objects.push(clone(p.scene.objects[0]));
    expect(() => parseProject(p)).toThrow("重复");
    expect(() =>
      parseProject({ ...example().scene, constraints: [{}] }),
    ).toThrow();
  });
  it("allows saving overlaps but blocks simulation", () => {
    const p = emptyProject();
    p.scene.objects = [makeObject("ball", [3, 3]), makeObject("ball", [3, 3])];
    expect(() => parseProject(p)).not.toThrow();
    expect(validate(p.scene).some((i) => i.code === "OVERLAP")).toBe(true);
  });
  it("fits a noisy circle and open ramp", () => {
    const points: Vec[] = Array.from({ length: 65 }, (_, i) => [
      3 + Math.cos((i * Math.PI) / 32) * 0.3,
      3 + Math.sin((i * Math.PI) / 32) * 0.3,
    ]);
    expect(fitStroke({ id: "s", status: "pending", points })?.kind).toBe(
      "ball",
    );
    expect(
      fitStroke({
        id: "t",
        status: "pending",
        points: [
          [1, 4],
          [2, 3],
          [3, 2],
        ],
      })?.kind,
    ).toBe("track");
  });
});
describe("transactions and AI permissions", () => {
  it("keeps 50 undoable edits and always advances revision", () => {
    const h = new History();
    let p = emptyProject();
    p.scene.objects = [makeObject("ball", [2, 2])];
    for (let i = 0; i < 50; i++) {
      const n = clone(p);
      n.scene.objects[0].transform.position[0] += 0.01;
      p = h.commit(p, n);
    }
    for (let i = 0; i < 50; i++) p = h.undo(p);
    expect(p.scene.revision).toBe(100);
    expect(p.scene.objects[0].transform.position[0]).toBeCloseTo(2);
    for (let i = 0; i < 50; i++) p = h.redo(p);
    expect(p.scene.revision).toBe(150);
  });
  it("rejects unauthorized, stale, duplicate and malformed changes atomically", () => {
    const s = example().scene,
      ball = s.objects[0],
      ramp = s.objects[1],
      original = JSON.stringify(s);
    for (const patch of [
      {
        operations: [{ type: "removeObject", objectId: ramp.id }],
        explanation: "",
      },
      {
        operations: [
          {
            type: "updateObject",
            objectId: ball.id,
            changes: { id: "hijack" },
          },
        ],
        explanation: "",
      },
      {
        operations: [
          {
            type: "updateObject",
            objectId: ball.id,
            changes: { shape: { type: "circle", radius: -1 } },
          },
        ],
        explanation: "",
      },
      {
        operations: [
          { type: "removeObject", objectId: ball.id },
          { type: "removeObject", objectId: ball.id },
        ],
        explanation: "",
      },
    ])
      expect(() => applyPatch(s, patch, [ball.id], s.revision)).toThrow();
    expect(() =>
      applyPatch(
        s,
        {
          operations: [{ type: "removeObject", objectId: ball.id }],
          explanation: "",
        },
        [ball.id],
        99,
      ),
    ).toThrow();
    expect(JSON.stringify(s)).toBe(original);
  });
  it("disables a target when its ball is removed", () => {
    const s = example().scene,
      id = s.objects[0].id;
    const n = applyPatch(
      s,
      {
        operations: [{ type: "removeObject", objectId: id }],
        explanation: "删除",
      },
      [id],
      s.revision,
    );
    expect(n.objectives[0].enabled).toBe(false);
  });
});
