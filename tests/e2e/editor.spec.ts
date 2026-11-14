import { test, expect } from "@playwright/test";
test("lasso selects a group, returns to selection, moves atomically and deletes the group", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "多选", exact: true }).waitFor();
  await page.evaluate(() => {
    const { store, emptyProject, makeObject } = (window as any).__SKETCH_DEV__;
    const project = emptyProject();
    project.scene.objects = [
      [3, 4],
      [4, 4],
      [8, 4],
    ].map((p) => makeObject("ball", p));
    store.replace(project);
  });
  const box = (await page.getByTestId("canvas").boundingBox())!,
    scale = Math.min(box.width / 12, box.height / 8),
    screen = (x: number, y: number) => ({
      x: box.x + (box.width - scale * 12) / 2 + x * scale,
      y: box.y + (box.height - scale * 8) / 2 + (8 - y) * scale,
    });
  await page.getByRole("button", { name: "多选", exact: true }).click();
  let p = screen(2.5, 3.5);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  p = screen(4.5, 4.5);
  await page.mouse.move(p.x, p.y, { steps: 12 });
  await expect(page.getByTestId("selection-summary")).toContainText(
    "已选中 2 个",
  );
  await page.mouse.up();
  await expect(
    page.getByText("已选择 2 个对象", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("半径 · m")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as any).__SKETCH_DEV__.store.get().tool),
  ).toBe("select");
  p = screen(3, 4);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  p = screen(3.5, 4.4);
  await page.mouse.move(p.x, p.y, { steps: 15 });
  await page.mouse.up();
  const positions = await page.evaluate(() =>
    (window as any).__SKETCH_DEV__.store
      .get()
      .project.scene.objects.map((o: any) => o.transform.position),
  );
  expect(positions[0][0]).toBeCloseTo(3.5, 2);
  expect(positions[1][0]).toBeCloseTo(4.5, 2);
  expect(positions[2]).toEqual([8, 4]);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as any).__SKETCH_DEV__.store
        .get()
        .project.scene.objects.map((o: any) => o.transform.position),
    ),
  ).toEqual([
    [3, 4],
    [4, 4],
    [8, 4],
  ]);
  await page.getByRole("button", { name: "删除这 2 个对象" }).click();
  await expect(page.getByText("1 / 80 个对象")).toBeVisible();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.getByText("3 / 80 个对象")).toBeVisible();
});
test("one brush converts old freehand strokes and undo restores their colors", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "画笔", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "自由画笔", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    const { store } = (window as any).__SKETCH_DEV__;
    const project = structuredClone(store.get().project);
    project.strokes = [
      {
        id: "old-freehand",
        points: [
          [4, 6],
          [6, 5],
        ],
        status: "decoration",
        color: "#df7b85",
        width: 0.06,
      },
    ];
    store.replace(project);
  });
  await page.getByRole("button", { name: /转换笔迹/ }).click();
  await page.getByRole("button", { name: "✓ 应用修改" }).click();
  await expect(page.getByText("4 / 80 个对象")).toBeVisible();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.getByText("3 / 80 个对象")).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as any).__SKETCH_DEV__.store.get().project.strokes[0],
    ),
  ).toMatchObject({ status: "decoration", color: "#df7b85", width: 0.06 });
});
test("component placement stays active until another tool is chosen", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "● 小球 BALL" }).click();
  const canvas = page.getByTestId("canvas");
  await canvas.click({ position: { x: 250, y: 100 } });
  await canvas.click({ position: { x: 350, y: 100 } });
  await canvas.click({ position: { x: 450, y: 100 } });
  await expect(page.getByText("6 / 80 个对象")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "● 小球 BALL" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("v");
  await expect(
    page.getByRole("button", { name: "● 小球 BALL" }),
  ).toHaveAttribute("aria-pressed", "false");
});
test("unified brush keeps colored scribbles through simulation and reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "画笔", exact: true }).click();
  await page
    .getByRole("button", { name: "画笔颜色 #df7b85", exact: true })
    .click();
  const box = (await page.getByTestId("canvas").boundingBox())!;
  await page.mouse.move(box.x + 160, box.y + 130);
  await page.mouse.down();
  await page.mouse.move(box.x + 210, box.y + 100, { steps: 6 });
  await page.mouse.move(box.x + 170, box.y + 190, { steps: 6 });
  await page.mouse.move(box.x + 270, box.y + 140, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: /转换笔迹/ })).toBeDisabled();
  await expect(page.getByText("4 / 80 个对象")).toBeVisible();
  await page.getByRole("button", { name: "▶ 播放" }).click();
  await expect(page.getByRole("button", { name: "Ⅱ 暂停" })).toBeVisible();
  await page.getByRole("button", { name: "↺ 重置" }).click();
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByText("已保存在本机", { exact: false })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as any).__SKETCH_DEV__.store.get().project.strokes[0],
    ),
  ).toMatchObject({ status: "converted", color: "#df7b85" });
});
test("play, pause, reset, edit, undo and restore", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("已保存在本机", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "▶ 播放" }).click();
  await expect(page.getByRole("button", { name: "Ⅱ 暂停" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).__SKETCH_DEV__.runtime.current?.time ?? 0,
      ),
    )
    .toBeGreaterThan(0.2);
  await page.getByRole("button", { name: "Ⅱ 暂停" }).click();
  await expect(page.getByRole("button", { name: "▶ 继续" })).toBeVisible();
  await page.getByRole("button", { name: "↺ 重置" }).click();
  const canvas = page.getByTestId("canvas"),
    box = (await canvas.boundingBox())!;
  await page.getByRole("button", { name: "● 小球 BALL" }).click();
  await canvas.click({
    position: { x: box.width * 0.75, y: box.height * 0.2 },
  });
  await expect(page.getByLabel("半径 · m")).toBeVisible();
  await page.getByLabel("半径 · m").fill("0.3");
  await expect(page.getByLabel("半径 · m")).toHaveValue("0.3");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.getByLabel("半径 · m")).toHaveValue("0.2");
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByText("4 / 80 个对象")).toBeVisible();
  expect(errors).toEqual([]);
});
test("brush makes a colliding line immediately and undo restores both stroke and body", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("canvas").waitFor();
  await page.evaluate(() => {
    const { store, emptyProject, makeObject } = (window as any).__SKETCH_DEV__;
    const p = emptyProject();
    p.scene.objects = [makeObject("ball", [5, 5])];
    store.replace(p);
  });
  await page.getByRole("button", { name: "画笔", exact: true }).click();
  const b = (await page.getByTestId("canvas").boundingBox())!,
    scale = Math.min(b.width / 12, b.height / 8);
  const screen = (x: number, y: number) => ({
    x: b.x + (b.width - scale * 12) / 2 + x * scale,
    y: b.y + (b.height - scale * 8) / 2 + (8 - y) * scale,
  });
  let p = screen(3, 3);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  p = screen(7, 3);
  await page.mouse.move(p.x, p.y, { steps: 20 });
  await page.mouse.up();
  const object = await page.evaluate(
    () => (window as any).__SKETCH_DEV__.store.get().project.scene.objects[1],
  );
  expect(object).toMatchObject({
    kind: "track",
    color: "#5668de",
    shape: { thickness: 0.045 },
    physics: { bodyType: "static" },
  });
  await page.getByRole("button", { name: "▶ 播放" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).__SKETCH_DEV__.runtime.current?.time ?? 0,
      ),
    )
    .toBeGreaterThan(1.2);
  const y = await page.evaluate(() => {
    const { runtime, store } = (window as any).__SKETCH_DEV__;
    return runtime.current.poses.get(store.get().project.scene.objects[0].id)
      .position[1];
  });
  expect(y).toBeGreaterThan(3.19);
  expect(y).toBeLessThan(3.4);
  await page.getByRole("button", { name: "↺ 重置" }).click();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect(
    await page.evaluate(() => {
      const p = (window as any).__SKETCH_DEV__.store.get().project;
      return [p.strokes.length, p.scene.objects.length];
    }),
  ).toEqual([0, 1]);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).__SKETCH_DEV__.store.get().project.scene.objects.length,
    ),
  ).toBe(2);
  await page.getByRole("button", { name: "擦除", exact: true }).click();
  p = screen(5, 3);
  await page.mouse.click(p.x, p.y);
  expect(
    await page.evaluate(() => {
      const p = (window as any).__SKETCH_DEV__.store.get().project;
      return [p.strokes.length, p.scene.objects.length];
    }),
  ).toEqual([0, 1]);
});
test("AI edits need preview and undo restores the original", async ({
  page,
}) => {
  await page.route("**/api/capabilities", (r) =>
    r.fulfill({ json: { enabled: true, model: "mock-model", image: false } }),
  );
  await page.route("**/api/ai/edit", (r) => {
    const body = r.request().postDataJSON();
    return r.fulfill({
      json: {
        status: "ok",
        patch: {
          operations: [
            {
              type: "updateObject",
              objectId: body.targetIds[0],
              changes: { shape: { type: "circle", radius: 0.3 } },
            },
          ],
          explanation: "半径改为 0.3 米",
        },
      },
    });
  });
  await page.goto("/");
  const b = (await page.getByTestId("canvas").boundingBox())!,
    scale = Math.min(b.width / 12, b.height / 8);
  await page.getByTestId("canvas").click({
    position: {
      x: (b.width - scale * 12) / 2 + 2 * scale,
      y: (b.height - scale * 8) / 2 + 2.7 * scale,
    },
  });
  await page.getByLabel("局部修改指令").fill("把小球变大");
  await page.getByRole("button", { name: "✧ 预览修改" }).click();
  await expect(
    page.getByRole("heading", { name: "先看看，再决定" }),
  ).toBeVisible();
  await expect(page.getByLabel("半径 · m")).toHaveValue("0.2");
  await page.getByRole("button", { name: "✓ 应用修改" }).click();
  await expect(page.getByLabel("半径 · m")).toHaveValue("0.3");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.getByLabel("半径 · m")).toHaveValue("0.2");
});
test("invalid imports leave the current scene intact", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("已保存在本机", { exact: false })).toBeVisible();
  await page.locator("input[type=file]").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schemaVersion":99}'),
  });
  await expect(page.getByRole("status")).toContainText("导入失败");
  await expect(page.getByText("3 / 80 个对象")).toBeVisible();
});
test("a conflicting tab cannot overwrite a newer saved design", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.getByText("已保存在本机", { exact: false })).toBeVisible();
  const second = await context.newPage();
  await second.goto("/");
  await expect(
    second.getByText("已保存在本机", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "● 小球 BALL" }).click();
  await page.getByTestId("canvas").click({ position: { x: 200, y: 100 } });
  await page.waitForTimeout(900);
  await second.getByRole("button", { name: "● 小球 BALL" }).click();
  await second.getByTestId("canvas").click({ position: { x: 300, y: 100 } });
  await expect(second.getByRole("status")).toContainText("其他标签页已更新");
  await expect(second.getByText("保存失败", { exact: false })).toBeVisible();
});

test("spring visibly launches, decays and settles instead of bouncing forever", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("canvas").waitFor();
  await page.evaluate(() => {
    const { store, emptyProject, makeObject } = (window as any).__SKETCH_DEV__;
    const p = emptyProject();
    p.scene.objects = [
      makeObject("ball", [3, 4]),
      makeObject("spring", [3, 1]),
    ];
    store.replace(p);
  });
  await page.getByRole("button", { name: "▶ 播放" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__SKETCH_DEV__.runtime.current?.springFired.size ?? 0,
      ),
    )
    .toBe(1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { runtime, store } = (window as any).__SKETCH_DEV__;
        return runtime.current.poses.get(
          store.get().project.scene.objects[0].id,
        ).position[1];
      }),
    )
    .toBeGreaterThan(1.9);
  const first = await page.evaluate(
    () =>
      [
        ...(window as any).__SKETCH_DEV__.runtime.current.springFired.values(),
      ][0] as number,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          [
            ...(
              window as any
            ).__SKETCH_DEV__.runtime.current.springFired.values(),
          ][0] as number,
      ),
    )
    .toBeGreaterThan(first);
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as any).__SKETCH_DEV__.runtime.current.time,
        ),
      { timeout: 8000 },
    )
    .toBeGreaterThan(5);
  const settled = await page.evaluate(() => {
    const { runtime, store } = (window as any).__SKETCH_DEV__;
    const id = store.get().project.scene.objects[0].id;
    return {
      last: [...runtime.current.springFired.values()][0],
      y: runtime.current.poses.get(id).position[1],
      vy: runtime.current.bodies.get(id).linvel().y,
    };
  });
  expect(settled.y).toBeCloseTo(1.58, 1);
  expect(Math.abs(settled.vy)).toBeLessThan(0.05);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__SKETCH_DEV__.runtime.current.time),
    )
    .toBeGreaterThan(6);
  expect(
    await page.evaluate(
      () =>
        [
          ...(
            window as any
          ).__SKETCH_DEV__.runtime.current.springFired.values(),
        ][0],
    ),
  ).toBe(settled.last);
  await page.getByRole("button", { name: "↺ 重置" }).click();
});
