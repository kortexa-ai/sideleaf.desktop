import type { ElectrobunConfig } from "electrobun";

export default {
  app: { name: "Sideleaf", identifier: "xyz.sideleaf.desktop", version: "0.1.0" },
  build: {
    mainProcess: "cottontail",
    cottontail: { entrypoint: "src/main.ts" },
    copy: { "dist/ui": "views/main", "dist/native": "native" },
    mac: { bundleCEF: false, bundleWGPU: false, icons: "assets/icon.iconset" },
    linux: { bundleCEF: false, bundleWGPU: false },
    win: { bundleCEF: false, bundleWGPU: false, icon: "assets/icon.png" },
  },
} satisfies ElectrobunConfig;
