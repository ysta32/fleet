# Visual baselines

From `packages/digest`, run `npm run visual` to capture and compare screenshots at
360, 768, 1280, and 1920 pixels in light and dark themes. To check one scenario,
run `npm run visual -- --only=typical`.

Missing reference images report `NO BASELINE` and do not cause a failure. Existing
references fail comparison if dimensions differ or more than 0.5% of pixels differ
(pixelmatch threshold 0.1). Failed comparisons exit with status 1.

After reviewing the screenshots, run `npm run visual:update` to create or replace
the reference PNGs in this directory. Add `-- --only=typical` to update just that
scenario. Baselines are intentionally absent until the restyled output is approved.

The runner requires Chrome or Chromium; set `CHROME_PATH` if it is not found
automatically. Generated HTML, screenshots, diffs, and the contact sheet are in
`packages/digest/.visual/` and are ignored by Git.
