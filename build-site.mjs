/* Assemble the folder GitHub Pages publishes.

   The app is the site: its files land at the root so the URL you add to your
   home screen is just the Pages URL, with the read-only demo alongside at
   /demo/. Everything the app references is a relative path, so the same output
   works under a project path (user.github.io/monthly_budget/) or a custom
   domain, with nothing to configure.

       node build-site.mjs        # writes _site/

   The workflow in .github/workflows/pages.yml runs this on every push to main. */
import fs from "fs";
import path from "path";

const OUT = "_site";

await import("./build-demo.mjs");            // refresh demo/ from the live app

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "demo"), { recursive: true });

/* The app, flattened to the site root. */
for (const f of fs.readdirSync("app")) {
  fs.copyFileSync(path.join("app", f), path.join(OUT, f));
}

/* One self-contained page, so it gets a directory of its own and a clean /demo/
   URL, with its favicon travelling beside it. */
fs.copyFileSync("demo/personal-budget-demo.html", path.join(OUT, "demo", "index.html"));
fs.copyFileSync("demo/icon.svg", path.join(OUT, "demo", "icon.svg"));

/* Without this, Pages runs the output through Jekyll, which drops files whose
   names begin with an underscore and slows every build down for nothing. */
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");

const list = (dir, pre = "") => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap(d => d.isDirectory()
    ? list(path.join(dir, d.name), `${pre}${d.name}/`)
    : [`${pre}${d.name}  ${fs.statSync(path.join(dir, d.name)).size}b`]);

/* A missing index.html deploys a blank site that looks like a Pages problem
   rather than a build one, so fail here where the cause is obvious. */
for (const required of ["index.html", "app.js", "sw.js", "manifest.json"]) {
  if (!fs.existsSync(path.join(OUT, required))) {
    throw new Error(`build-site: ${required} missing from ${OUT}/`);
  }
}

console.log(`${OUT}/\n  ` + list(OUT).join("\n  "));
