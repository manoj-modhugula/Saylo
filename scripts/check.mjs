import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
async function check(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.name === "node_modules") continue;
    const path = `${dir}/${item.name}`;
    if (item.isDirectory()) await check(path);
    else if (/\.(js|mjs)$/.test(path)) {
      const result = spawnSync(process.execPath, ["--check", path], {
        encoding: "utf8",
      });
      if (result.status !== 0) {
        console.error(result.stderr);
        process.exitCode = 1;
      }
    }
  }
}
for (const dir of ["site", "scripts", "tests", "quickstart", "demo-agent"]) await check(dir);
if (!process.exitCode) console.log("JavaScript syntax checks passed.");
