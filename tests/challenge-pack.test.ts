import { describe, expect, it } from "vitest";
import {
  challenges,
  challengeProject,
  challengeViolation,
} from "../packages/core/src/challenges";
import {
  clone,
  physicalStroke,
  validate,
  type Vec,
} from "../packages/core/src/index";
import { Simulation } from "../apps/web/src/simulation/physics";
import solutions from "./challenge-solutions.json";

describe("50-level challenge campaign", () => {
  it("has five chapters, stable unique IDs and independent drafts", () => {
    expect(challenges).toHaveLength(50);
    expect(new Set(challenges.map((level) => level.id)).size).toBe(50);
    for (const chapter of new Set(challenges.map((level) => level.chapter)))
      expect(
        challenges.filter((level) => level.chapter === chapter),
      ).toHaveLength(10);
    const a = challengeProject(49),
      b = challengeProject(49);
    expect(a).toEqual(b);
    a.scene.objects.pop();
    expect(challengeProject(49)).toEqual(b);
    expect(() => challengeProject(-1)).toThrow();
    expect(() => challengeProject(50)).toThrow();
  });

  for (let index = 5; index < 50; index++) {
    it(`${index + 1}: ${challenges[index].title} is unsolved initially and repeatably solvable within budget`, async () => {
      const base = challengeProject(index);
      expect(
        validate(base.scene).filter((i) => i.severity !== "warning"),
      ).toEqual([]);
      const blank = new Simulation();
      try {
        await blank.create(base.scene);
        for (let t = 0; t < 3600; t++) blank.step(base.scene);
        expect(blank.won).toBe(false);
      } finally {
        blank.destroy();
      }
      for (let repeat = 0; repeat < 3; repeat++) {
        const p = clone(base);
        solutions[index - 5].forEach((points, n) => {
          const stroke = {
            id: `answer-${n}`,
            points: points as Vec[],
            status: "converted" as const,
            width: 0.08,
          };
          p.strokes.push(stroke);
          p.scene.objects.push(physicalStroke(stroke));
        });
        expect(
          challengeViolation(base, p, challenges[index].maxStrokes),
        ).toBeUndefined();
        expect(
          validate(p.scene).filter((i) => i.severity !== "warning"),
        ).toEqual([]);
        const sim = new Simulation();
        try {
          await sim.create(p.scene);
          for (let t = 0; t < 3600 && !sim.won; t++) sim.step(p.scene);
          expect(sim.won, `repeat ${repeat}`).toBe(true);
          if (base.scene.objects.some((o) => o.kind === "spring"))
            expect(sim.springFired.size).toBeGreaterThan(0);
          if (base.scene.objects.some((o) => o.kind === "seesaw")) {
            const board = base.scene.objects.find((o) => o.kind === "seesaw")!;
            expect(Math.abs(sim.poses.get(board.id)!.rotation)).toBeGreaterThan(
              0.1,
            );
          }
        } finally {
          sim.destroy();
        }
      }
    });
  }
});
