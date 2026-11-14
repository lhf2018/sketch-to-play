import { test, expect } from "@playwright/test";

test("challenge drawing wins, stores progress, and preserves the free scene", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "⚑ 挑战模式" }).click();
  const freeScene = await page.evaluate(
    () => (window as any).__SKETCH_DEV__.store.get().project.scene.sceneId,
  );
  await page.getByRole("button", { name: /第一笔斜坡/ }).click();
  await expect(page.getByRole("region", { name: "当前挑战" })).toContainText(
    "0 / 3",
  );
  const box = (await page.getByTestId("canvas").boundingBox())!;
  const scale = Math.min(box.width / 12, box.height / 8);
  const screen = (x: number, y: number) => ({
    x: box.x + (box.width - scale * 12) / 2 + x * scale,
    y: box.y + (box.height - scale * 8) / 2 + (8 - y) * scale,
  });
  let point = screen(1, 4.8);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  point = screen(7, 1.7);
  await page.mouse.move(point.x, point.y, { steps: 30 });
  await page.mouse.up();
  await expect(page.getByRole("region", { name: "当前挑战" })).toContainText(
    "1 / 3",
  );
  await page.getByRole("button", { name: "预测轨迹", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("未来 8 秒预测");
  expect(
    await page.evaluate(() => (window as any).__SKETCH_DEV__.runtime.current),
  ).toBeUndefined();
  await page.getByRole("button", { name: /▶ 播放/ }).click();
  await expect(page.getByRole("alert")).toHaveText("挑战成功！", {
    timeout: 15000,
  });
  await page.getByRole("button", { name: "下一关", exact: true }).click();
  await expect(page.getByRole("region", { name: "当前挑战" })).toContainText(
    "向左出发",
  );
  await expect(page.getByText("已保存在本机", { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "当前挑战" })).toContainText(
    "向左出发",
  );
  await page.getByRole("button", { name: /▶ 播放/ }).click();
  await page.getByRole("button", { name: /Ⅱ 暂停/ }).click();
  await page.evaluate(() => {
    (window as any).__SKETCH_DEV__.runtime.current.time = 30;
  });
  await page.getByRole("button", { name: "单步", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("本次未完成");
  await expect(page.getByRole("button", { name: /▶ 继续/ })).toBeDisabled();
  await page.getByRole("button", { name: "↺ 重置", exact: true }).click();
  await expect(page.getByRole("button", { name: /▶ 播放/ })).toBeEnabled();
  await page.getByRole("button", { name: "返回自由创作" }).click();
  expect(
    await page.evaluate(
      () => (window as any).__SKETCH_DEV__.store.get().project.scene.sceneId,
    ),
  ).toBe(freeScene);
  await page.reload();
  await page.getByRole("button", { name: "⚑ 挑战模式" }).click();
  await expect(page.getByRole("button", { name: /第一笔斜坡/ })).toContainText(
    "已完成",
  );
  await page.getByRole("button", { name: /第一笔斜坡/ }).click();
  await expect(page.getByRole("region", { name: "当前挑战" })).toContainText(
    "1 / 3",
  );
});

test("slow motion and paused single-step use the same fixed physics step", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /▶ 播放/ }).click();
  await page.getByRole("button", { name: /Ⅱ 暂停/ }).click();
  await page.getByLabel("播放速度").selectOption("0.25");
  const before = await page.evaluate(
    () => (window as any).__SKETCH_DEV__.runtime.current.time,
  );
  await page.getByRole("button", { name: "单步", exact: true }).click();
  const after = await page.evaluate(
    () => (window as any).__SKETCH_DEV__.runtime.current.time,
  );
  expect(after - before).toBeCloseTo(1 / 120, 8);
  await page.getByRole("button", { name: "↺ 重置", exact: true }).click();
  await expect(page.getByLabel("播放速度")).toHaveValue("0.25");
});

test("chain examples expose editable rotating blocks and persistent hinges", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "▦ 示例场景" }).click();
  await page.getByRole("button", { name: /跷跷板送球/ }).click();
  await expect(
    page.getByRole("heading", { name: "从一个小实验开始" }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    const { store } = (window as any).__SKETCH_DEV__;
    store.set({
      selected: [
        store.get().project.scene.objects.find((o: any) => o.kind === "block")
          .id,
      ],
    });
  });
  await page.getByLabel("旋转 · °").fill("25");
  await page.getByRole("button", { name: "在中心添加固定铰链" }).click();
  await expect(
    page.getByRole("button", { name: "移除固定铰链" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "删除选中对象", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).__SKETCH_DEV__.store.get().project.scene.constraints
          .length,
    ),
  ).toBe(0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).__SKETCH_DEV__.store.get().project.scene.constraints
          .length,
    ),
  ).toBe(1);
  await expect(page.getByText("已保存在本机", { exact: false })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /▶ 播放/ }).waitFor();
  expect(
    await page.evaluate(
      () =>
        (window as any).__SKETCH_DEV__.store.get().project.scene.constraints
          .length,
    ),
  ).toBe(1);
});
