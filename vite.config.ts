import { defineConfig } from "vite-plus";
export default defineConfig({
  pack: {
    entry: ["src/index.ts", "src/client.ts"],
    format: ["esm"],
    platform: "neutral",
    target: "es2022",
    dts: true,
  },
});
