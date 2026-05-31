// One-off DOM probe: navigate to the IG signup page and dump the structure of
// the Birthday controls so we can drive them correctly against Stagehand v3's
// understudy page API (which lacks Playwright's getByRole/getAttribute/etc.).
import { withStagehand } from "../services/browser/stagehand.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("probe");

await withStagehand(async ({ page, sessionUrl }) => {
  log.info("session", sessionUrl);
  await page.goto("https://www.instagram.com/accounts/emailsignup/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(5000);

  const info = await page.evaluate(() => {
    const out = { url: location.href, selects: [], comboboxes: [], birthdayHtml: null };

    document.querySelectorAll("select").forEach((s) => {
      out.selects.push({
        title: s.getAttribute("title"),
        ariaLabel: s.getAttribute("aria-label"),
        name: s.getAttribute("name"),
        optionCount: s.options.length,
        sampleOptions: Array.from(s.options).slice(0, 5).map((o) => ({ value: o.value, text: (o.textContent || "").trim() })),
      });
    });

    document.querySelectorAll('[role="combobox"]').forEach((c) => {
      out.comboboxes.push({
        tag: c.tagName,
        ariaLabel: c.getAttribute("aria-label"),
        ariaExpanded: c.getAttribute("aria-expanded"),
        ariaControls: c.getAttribute("aria-controls"),
        text: (c.textContent || "").trim().slice(0, 40),
      });
    });

    // Grab the container around the "Birthday" label for full context.
    const labels = Array.from(document.querySelectorAll("*")).filter(
      (el) => el.children.length === 0 && /birthday/i.test(el.textContent || "")
    );
    if (labels[0]) {
      let node = labels[0];
      for (let i = 0; i < 4 && node.parentElement; i++) node = node.parentElement;
      out.birthdayHtml = node.outerHTML.slice(0, 4000);
    }
    return out;
  });

  log.info("PROBE RESULT:\n" + JSON.stringify(info, (k, v) => v, 2));
  return info;
});
