import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
const site = resolve("site");
test("all static page asset and navigation references resolve", async () => {
  for (const file of (await readdir(site)).filter((f) => f.endsWith(".html"))) {
    const html = await readFile(resolve(site, file), "utf8");
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(ids.length, new Set(ids).size, `duplicate ids in ${file}`);
    for (const match of html.matchAll(
      /(?:href|src|content)="(\/[^"#]*)(?:#[^"]*)?"/g,
    )) {
      const url = new URL(match[1], "https://saylo.local").pathname;
      if (url === "/") continue;
      await assert.doesNotReject(
        access(url === "/NOTICE" || url === "/LICENSE" ? resolve(url.slice(1)) : resolve(site, "." + url)),
        `${file}: ${url}`,
      );
    }
  }
});
test("entry pages retain Saylo identity, demo disclosure, and no commercial lead form", async () => {
  const home = await readFile(resolve(site, "index.html"), "utf8"),
    demo = await readFile(resolve(site, "try.html"), "utf8");
  assert.match(home, /<h1 id="hero-title">Say hello to/);
  assert.match(demo, /<option value="browser">Browser demo<\/option>/);
  assert.match(demo, /scripted local replies/);
  assert.doesNotMatch(home, /access-form|api-production|_vercel\/insights/);
  assert.doesNotMatch(demo, /_vercel\/insights/);
});
