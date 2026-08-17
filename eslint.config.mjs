import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // ffmpeg-core.js/ffmpeg.js são builds minificados de terceiros copiados de
    // node_modules em runtime (ver scripts/copy-ffmpeg-core.js) — nunca editados aqui,
    // não versionados (ver .gitignore), não faz sentido lintar.
    "public/ffmpeg/**",
    // Scripts de Node.js puro rodados fora do bundler do Next.js (via `node
    // scripts/*.js`, inclusive no postinstall) — CommonJS é o formato natural aqui, sem
    // "type": "module" no package.json.
    "scripts/**",
  ]),
]);

export default eslintConfig;
