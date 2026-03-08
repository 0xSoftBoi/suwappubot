# Screenshot Local Website

Take screenshots of a running local dev server for visual review.

## Instructions

1. Check if the target dev server is running (default: `http://localhost:3000`, try 3001 if 3000 is busy)
2. Use a Node.js script with Playwright to capture screenshots:
   - Full page at 1440x900 (desktop)
   - Full page at 375x812 (mobile)
   - If the page has horizontal scroll panels (`.gsap-panel`), scroll through each panel and screenshot individually
3. Save screenshots to `/tmp/screenshots/` with descriptive names
4. Read each screenshot using the Read tool to visually inspect them
5. Report findings: layout issues, visual bugs, alignment problems, missing content

## Arguments

- `$ARGUMENTS` — Optional: URL to screenshot (default: http://localhost:3001), or "mobile" / "desktop" to limit to one viewport

## Setup (run once if Playwright not installed)

```bash
npx --yes playwright install chromium
```

## Screenshot Script Template

```javascript
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000); // let GSAP init
  await page.screenshot({ path: '/tmp/screenshots/desktop-full.png', fullPage: true });
  // Scroll through panels if horizontal scroll
  const panels = await page.$$('.gsap-panel');
  for (let i = 0; i < panels.length; i++) {
    await page.evaluate((idx) => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, h * (idx / 4));
    }, i);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `/tmp/screenshots/panel-${i}.png` });
  }
  // Mobile
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/screenshots/mobile-full.png', fullPage: true });
  await browser.close();
})();
```
