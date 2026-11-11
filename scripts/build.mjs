import { cp, mkdir, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("site", "dist", {
  recursive: true,
  filter: (src) =>
    !/(?:^|\/)(api|node_modules|package(?:-lock)?\.json|vercel\.json)$/.test(
      src,
    ),
});
console.log(
  "Static portfolio exported to dist/ (no functions, MongoDB, or credentials).",
);
await cp("LICENSE", "dist/LICENSE");
await cp("NOTICE", "dist/NOTICE");
