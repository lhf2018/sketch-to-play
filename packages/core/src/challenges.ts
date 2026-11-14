import { clone, example, objectSchema, type Project } from "./index";

export const challenges = [
  {
    id: "bridge",
    title: "第一笔斜坡",
    hint: "从小球下方画一条向右下方的坡，把球送进杯子。",
    maxStrokes: 3,
  },
  {
    id: "mirror",
    title: "向左出发",
    hint: "这次杯子在左边，试试反方向的斜坡。",
    maxStrokes: 3,
  },
  {
    id: "landing",
    title: "远处的杯子",
    hint: "杯子更远了，观察落点，延长轨道。",
    maxStrokes: 3,
  },
  {
    id: "precision",
    title: "精准落杯",
    hint: "杯口变窄了，用轨迹预览找准落点。",
    maxStrokes: 2,
  },
  {
    id: "relay",
    title: "接力最后一段",
    hint: "已有半段轨道，补齐余下的路线。",
    maxStrokes: 2,
  },
] as const;
export function challengeProject(index: number): Project {
  const p = example("ramp");
  p.scene.sceneId = `challenge-${challenges[index].id}`;
  const [ball, ramp, cup] = p.scene.objects;
  ball.id = "target-ball";
  cup.id = "target-cup";
  ramp.id = "fixed-ramp";
  if (index === 1) {
    ball.transform.position[0] = 10;
    cup.transform.position[0] = 4;
  }
  if (index === 2) cup.transform.position[0] = 9;
  if (index === 3 && cup.kind === "cup") cup.shape.innerWidth = 0.8;
  p.scene.objects = index === 4 ? [ball, ramp, cup] : [ball, cup];
  if (index === 4 && ramp.kind === "track")
    ramp.shape.points = [
      [1, 4.8],
      [4, 3.25],
    ];
  p.scene.objectives = [
    { type: "ballInCup", ballId: ball.id, cupId: cup.id, enabled: true },
  ];
  return clone(p);
}
export function challengeViolation(
  base: Project,
  next: Project,
  maxStrokes: number,
): string | undefined {
  for (const object of base.scene.objects)
    if (
      JSON.stringify(
        objectSchema.safeParse(
          next.scene.objects.find((o) => o.id === object.id),
        ).data,
      ) !== JSON.stringify(objectSchema.parse(object))
    )
      return "关卡固定对象不能修改或删除";
  if (
    JSON.stringify(next.scene.world) !== JSON.stringify(base.scene.world) ||
    JSON.stringify(next.scene.objectives) !==
      JSON.stringify(base.scene.objectives) ||
    next.scene.constraints.length
  )
    return "挑战规则不能修改";
  const added = next.scene.objects.filter(
    (o) => !base.scene.objects.some((b) => b.id === o.id),
  );
  if (
    added.some(
      (o) =>
        o.kind !== "track" ||
        o.sourceStrokeIds.length !== 1 ||
        !next.strokes.some(
          (s) => s.id === o.sourceStrokeIds[0] && s.status === "converted",
        ),
    )
  )
    return "挑战中只能用画笔补画轨道";
  if (next.strokes.length > maxStrokes)
    return `最多画 ${maxStrokes} 笔，撤销或擦除后可重新画`;
  return undefined;
}
