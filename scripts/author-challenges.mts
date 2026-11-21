// Offline authoring tool. Only physically verified layouts are published.
import { writeFileSync } from "node:fs";
import {
  emptyProject,
  makeObject,
  physicalStroke,
  validate,
  clone,
  type Project,
  type Vec,
} from "../packages/core/src/index.ts";
import { Simulation } from "../apps/web/src/simulation/physics.ts";

function track(p: Project, points: Vec[]) {
  const o = makeObject("track", [0, 0]);
  if (o.kind === "track") o.shape.points = points;
  p.scene.objects.push(o);
  return o;
}
async function run(p: Project) {
  const sim = new Simulation();
  await sim.create(p.scene);
  try {
    for (let t = 0; t < 3600 && !sim.won; t++) {
      sim.step(p.scene);
      if (t > 960) {
        const b = sim.bodies.get("target-ball");
        if (!b || Math.hypot(b.linvel().x, b.linvel().y) < 0.01) break;
      }
    }
    return {
      won: sim.won,
      fired: sim.springFired.size,
      poses: new Map(sim.poses),
    };
  } finally {
    sim.destroy();
  }
}
const titles = [
  ["低空滑行", "高台远投", "断桥续接", "小球大杯", "一笔封顶"],
  [
    "绕开高墙",
    "屋檐之下",
    "双层走廊",
    "狭缝通行",
    "悬空隧道",
    "向左绕行",
    "低门洞",
    "高低错落",
    "三道关口",
    "迷宫出口",
  ],
  [
    "第一次起跳",
    "斜向发射",
    "接住抛物线",
    "越过矮墙",
    "高处接球",
    "反向弹射",
    "低空弹道",
    "窄杯接力",
    "弹射隧道",
    "飞跃终点",
  ],
  [
    "重锤启动",
    "杠杆送球",
    "空中接力",
    "轻球远行",
    "越墙投送",
    "反向杠杆",
    "高台接球",
    "窄口接住",
    "屋檐下的杠杆",
    "杠杆终点",
  ],
  [
    "弹射过门",
    "重锤迷宫",
    "低空穿梭",
    "杠杆越障",
    "远端接力",
    "反向机关",
    "针尖落杯",
    "连续关口",
    "极限一笔",
    "最后的机关",
  ],
];
const chapters = ["坡道进阶", "曲折迷宫", "弹射飞行", "杠杆机关", "综合试炼"];
const result: any[] = [],
  solutions: Vec[][][] = [];
for (let group = 0; group < 5; group++)
  for (let n = 0; n < titles[group].length; n++) {
    const p = emptyProject();
    const lever = group === 3 || (group === 4 && n % 2 === 1);
    const spring = group === 2 || (group === 4 && !lever);
    const maze = group === 1;
    let start: Vec;
    if (lever) {
      const x = 4.2;
      const board = makeObject("seesaw", [x, 1.3]);
      const weight = makeObject("block", [x - 0.9, 4]);
      if (weight.kind === "block") {
        weight.shape.width = 0.6;
        weight.shape.height = 0.6;
        weight.physics.mass = 4;
      }
      const ball = makeObject("ball", [x + 1, 1.6]);
      if (ball.kind === "ball") ball.physics.mass = 0.1;
      p.scene.objects.push(ball, board, weight);
      start = [x + 1, 1.6];
    } else if (spring) {
      const x = 2 + (n % 3) * 0.3;
      const ball = makeObject("ball", [x, 1.1]);
      if (ball.kind === "ball") ball.physics.mass = 0.7;
      const launcher = makeObject("spring", [x, 0.25]);
      if (launcher.kind === "spring") {
        launcher.behavior.direction = [
          0.55 + (n % 3) * 0.08,
          0.835 - (n % 3) * 0.06,
        ];
        launcher.behavior.direction[1] = Math.sqrt(
          1 - launcher.behavior.direction[0] ** 2,
        );
        launcher.behavior.impulse = 4.2 + (n % 4) * 0.2;
      }
      p.scene.objects.push(ball, launcher);
      start = [x, 1.1];
    } else {
      start = [1.7 + (n % 3) * 0.25, maze ? 6.8 : 5 + (n % 3) * 0.5];
      p.scene.objects.push(makeObject("ball", start));
    }
    p.scene.objects[0].id = "target-ball";
    const cupX = lever
      ? 9 + (n % 3) * 0.25
      : spring
        ? 7 + (n % 4) * 0.5
        : 8 + (n % 3) * 0.6;
    const cup = makeObject("cup", [cupX, 0.15]);
    cup.id = "target-cup";
    if (cup.kind === "cup") {
      cup.shape.innerWidth =
        group === 4 && lever ? 1.1 : n >= 7 ? 0.7 : n >= 4 ? 0.9 : 1.1;
      cup.shape.innerHeight = 0.8;
    }
    p.scene.objects.push(cup);
    const gates: Vec[] = [];
    if (maze) {
      // A descending corridor: floor and ceiling force a route through gates.
      for (let k = 0; k < 2 + (n % 3); k++) {
        const x = 3 + k * 1.25,
          y = 6.1 - (x - 1) * 0.64 + (k % 2 ? -0.25 : 0.25) + n * 0.025;
        gates.push([x, y]);
        track(p, [
          [x, y + 0.7],
          [x, 7.6],
        ]);
        track(p, [
          [x, 0.2],
          [x, y - 0.56],
        ]);
      }
    }
    // Launch chapters have a real wall between launch mechanism and cup.
    if ((spring || lever) && n >= 3)
      track(p, [
        [lever ? 6.5 : 4.2, 0.1],
        [lever ? 6.5 : 4.2, lever ? 1.5 : 0.9],
      ]);
    if (group === 4) {
      const gx = lever ? 7.2 : 5.6;
      track(p, [
        [gx, 0.1],
        [gx, 0.7 + n * 0.005],
      ]);
      track(p, [
        [gx, lever ? 3.5 : 2.7],
        [gx, 5.6],
      ]);
    }
    if (group === 4 || n === 8)
      track(p, [
        [7, 5.6],
        [10.8, 5.6],
      ]);
    p.scene.objectives = [
      {
        type: "ballInCup",
        ballId: "target-ball",
        cupId: "target-cup",
        enabled: true,
      },
    ];
    let found: Vec[][] | undefined;
    // Search receiver slopes, not model-generated guesses. No solution enters UI data.
    outer: for (const endY of group === 4 && lever
      ? [1.1, 0.9, 1.4, 1.7, 2, 2.4]
      : [1.4, 1.7, 1.1, 2, 0.9, 2.4])
      for (const gap of group === 4 && lever
        ? [1, 0.7, 0.4, 1.3]
        : [0.7, 1, 0.4, 1.3]) {
        const endX = cupX - gap;
        const starts: Vec[] = maze
          ? [
              [1, 6.1],
              [1, 6.2],
              [1, 6],
              [1, 5.9],
            ]
          : lever
            ? [
                [5.5, 3],
                [5.5, 2.5],
                [6, 3.5],
                [6, 2],
                [6.5, 2.5],
                [5, 2],
                [6, 4],
                [5, 3.5],
              ]
            : spring
              ? [
                  [3.2, 1.8],
                  [3.5, 2],
                  [4, 1.7],
                  [4, 2.5],
                  [3, 1.2],
                  [4.5, 1.3],
                  [4.5, 2],
                  [5, 1.5],
                ]
              : [
                  [1, start[1] - 0.5],
                  [1, start[1] - 0.7],
                  [1, start[1] - 0.9],
                ];
        if (spring || lever)
          for (let x = 3; x < 8; x += 0.5)
            for (let y = 0.8; y < 5; y += 0.4) starts.push([x, y]);
        if (group === 4 && lever)
          starts.unshift([4.5, 0.8], [3, 0.8], [5, 0.8]);
        for (const a of starts) {
          const line: Vec[] = maze
            ? [a, ...gates.map(([x, y]): Vec => [x, y - 0.24]), [endX, endY]]
            : [a, [endX, endY]];
          const q = clone(p);
          const stroke = {
            id: "answer",
            points: line,
            status: "converted" as const,
            width: 0.08,
          };
          q.strokes.push(stroke);
          q.scene.objects.push(physicalStroke(stroke));
          if (validate(q.scene).some((i) => i.severity !== "warning")) continue;
          const trial = await run(q);
          if (trial.won && (!spring || trial.fired > 0)) {
            found = [line];
            break outer;
          }
        }
      }
    if (!found) throw Error(`No solution: ${group}/${n} ${titles[group][n]}`);
    if ((await run(p)).won) throw Error("Already solved: " + titles[group][n]);
    // Mirror selected layouts, including launcher direction and mechanism geometry.
    if (n === 5 || (group === 0 && n === 3)) {
      for (const o of p.scene.objects) {
        o.transform.position[0] = 12 - o.transform.position[0];
        o.transform.rotation = -o.transform.rotation;
        if (o.kind === "track")
          o.shape.points = o.shape.points.map(([x, y]) => [-x, y]);
        if (o.kind === "spring") o.behavior.direction[0] *= -1;
      }
      found = found.map((line) => line.map(([x, y]) => [12 - x, y]));
    }
    p.scene.sceneId = `challenge-pack-${group}-${n}`;
    p.scene.objects.forEach((o, i) => {
      if (!o.id.startsWith("target-")) o.id = `fixed-${i}`;
    });
    result.push({
      id: `pack-${group}-${n}`,
      title: titles[group][n],
      chapter: chapters[group],
      maxStrokes: n >= 8 ? 1 : group === 4 ? 2 : 3,
      hint: lever
        ? "重锤会压动杠杆。观察小球被抛起的位置，补画接球轨道。"
        : spring
          ? "小球会被弹簧发射。让轨道接住下降中的球，绕过障碍送入杯子。"
          : maze
            ? "观察上下挡板之间的通道，补画连续路线，避免撞上关口。"
            : "观察高度与落点，补画轨道，把小球送入杯子。",
      project: p,
    });
    solutions.push(found);
    console.log(
      `${result.length + 5}/50 ${titles[group][n]} ${JSON.stringify(found)}`,
    );
  }
writeFileSync(
  new URL("../packages/core/src/challenge-pack.json", import.meta.url),
  JSON.stringify(result, null, 2) + "\n",
);
writeFileSync(
  new URL("../tests/challenge-solutions.json", import.meta.url),
  JSON.stringify(solutions, null, 2) + "\n",
);
