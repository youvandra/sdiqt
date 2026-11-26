/**
 * The demo path a judge follows: open the landing, go to the explorer, pick the
 * reference rollup from the list of every qledger rollup, open a proven batch,
 * verify its STARK proof in the browser, then flip one byte and watch the
 * verifier reject it.
 */
import { expect, type Page, test } from "@playwright/test";

interface BatchSummary {
  batch_index: string;
  validity: string;
}

async function latestProven(page: Page): Promise<string> {
  const res = await page.request.get("/api/batches");
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { batches: BatchSummary[] };
  const proven = body.batches.filter((b) => b.validity === "proven");
  expect(proven.length, "at least one proven batch on the deployed tower").toBeGreaterThan(0);
  return proven.map((b) => b.batch_index).sort((a, b) => Number(b) - Number(a))[0] as string;
}

test("list, batch, browser verify, flip one byte", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  const index = await latestProven(page);

  await page.goto("/");
  await expect(page).toHaveTitle("SDIQT · Proof that outlives the chain");
  await page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("link", { name: "Explorer" })
    .click();
  await expect(page).toHaveURL(/\/rollups$/);
  const rollups = page.getByRole("list", { name: "Rollups" });
  await expect(rollups.getByRole("link")).not.toHaveCount(0);
  await rollups.getByRole("link").filter({ hasText: "sdiqt-1" }).click();
  await expect(page).toHaveURL(/\/r\/sdiqt-1$/);

  const list = page.getByRole("list", { name: "Batches" });
  const row = list.getByRole("button").filter({ hasText: `#${index}` });
  await expect(row).toBeVisible();

  await row.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: `Batch ${index}` })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`[?&]batch=${index}\\b`));

  await drawer.getByRole("button", { name: "Proof", exact: true }).click();
  await drawer.getByRole("button", { name: "Verify Proof" }).click();
  await expect(drawer.getByText("Valid", { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(drawer.getByText(/All \d+ fields match the chain/)).toBeVisible();

  await drawer.getByRole("button", { name: "Flip One Byte" }).click();
  await expect(drawer.getByText(/Tampered copy rejected in/)).toBeVisible({ timeout: 90_000 });

  expect(errors).toEqual([]);
});

test("an other team's rollup shows re-execution only", async ({ page }) => {
  const res = await page.request.get("/api/rollups");
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as {
    rollups: Array<{ rollup_id: string; tier: string; batches: string }>;
  };
  // The re-execution-only rollup with the most batches, so its batch list has rows.
  const pick = body.rollups
    .filter((r) => r.tier === "reexec")
    .sort((a, b) => Number(b.batches) - Number(a.batches))[0];
  if (!pick) throw new Error("no re-execution-only rollup on the deployed tower");
  expect(Number(pick.batches), `${pick.rollup_id} has archived batches`).toBeGreaterThan(0);
  const id = pick.rollup_id;

  await page.goto("/rollups");
  const rollups = page.getByRole("list", { name: "Rollups" });
  await expect(rollups.getByText("STARK + Re-executed", { exact: true })).toHaveCount(1);
  await expect(rollups.getByText("Re-executed", { exact: true })).not.toHaveCount(0);
  await rollups.getByRole("link").filter({ hasText: id }).first().click();
  await expect(page).toHaveURL(new RegExp(`/r/${id}$`));

  const head = page.locator("section.rollup-head");
  await expect(head.getByRole("heading", { name: id, exact: true })).toBeVisible();
  await expect(head.getByText("Re-executed", { exact: true })).toBeVisible();
  await expect(head.getByText("STARK + Re-executed")).toHaveCount(0);
  await expect(page.getByText("Proven by a STARK")).toHaveCount(0);
  await expect(page.getByText("Roots Match", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Batches" }).getByRole("button")).not.toHaveCount(0);
});
