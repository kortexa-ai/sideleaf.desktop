import type { ElectrobunConfig } from "electrobun";
import { APP_VERSION } from "./src/shared/version.ts";

export default {
  app: {
    name: "Sideleaf",
    identifier: "ai.kortexa.sideleaf",
    version: APP_VERSION,
    description: "A Markdown editor for your words and your files.",
    fileAssociations: [{ ext: ["md", "markdown", "mdown"], name: "Markdown document", role: "Editor" }],
  },
  scripts: { postBuild: "scripts/post-build.ts", postWrap: "scripts/post-build.ts" },
  build: {
    mainProcess: "cottontail",
    cottontail: { entrypoint: "src/main.ts", minify: true },
    views: { main: { entrypoint: "src/ui/app.ts", minify: true } },
    copy: { "src/ui/index.html": "views/main/index.html", "src/ui/app.css": "views/main/app.css", "src/ui/assets/empty-state.png": "views/main/assets/empty-state.png", "dist/cli": "cli", "dist/native": "native", "LICENSE": "licenses/Sideleaf.txt", "licenses/third-party.txt": "licenses/third-party.txt", "THIRD_PARTY_NOTICES.md": "licenses/README.md" },
    watchIgnore: [".cottontail-tmp/**", ".hutch/**", "dist/**", "tmp/**"],
    mac: { bundleCEF: false, bundleWGPU: false, icons: "assets/icon.iconset", codesign: true, notarize: true, createDmg: false },
    linux: { bundleCEF: false, bundleWGPU: false },
    win: { bundleCEF: false, bundleWGPU: false, icon: "assets/icon.ico" },
  },
  release: { generatePatch: false },
} satisfies ElectrobunConfig;
