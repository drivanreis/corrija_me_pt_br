import { mkdir, rm, writeFile, copyFile, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const buildDir = path.join(rootDir, "build", "node-app");
const backendDir = path.join(buildDir, "backend");
const extensionDir = path.join(buildDir, "extension");
const dataDir = path.join(buildDir, "data");

async function buildReplacementData() {
  await mkdir(dataDir, { recursive: true });
  await copyFile(path.join(rootDir, "data/replacements.json"), path.join(dataDir, "replacements.json"));
}

async function buildBackend() {
  await esbuild.build({
    entryPoints: [path.join(rootDir, "src/backend/server.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    outfile: path.join(backendDir, "server.cjs"),
    sourcemap: false,
    banner: {
      js: "/* corrija_me_pt_br backend */"
    }
  });
}

async function buildExtension() {
  await esbuild.build({
    entryPoints: {
      content: path.join(rootDir, "src/extension/content.ts"),
      popup: path.join(rootDir, "src/extension/popup.ts")
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    target: ["chrome114"],
    outdir: extensionDir,
    sourcemap: false
  });

  const manifest = {
    manifest_version: 3,
    name: "corrija_me_pt_br",
    description: "Corretor gramatical em portugues do Brasil conectado ao backend local do corriga_me_pt_br.",
    version: "2.0.0",
    permissions: ["storage"],
    host_permissions: [
      "<all_urls>",
      "http://127.0.0.1:8081/*",
      "http://localhost:8081/*"
    ],
    action: {
      default_title: "corrija_me_pt_br",
      default_icon: {
        "16": "icons/icon16.png",
        "32": "icons/icon32.png",
        "48": "icons/icon48.png",
        "128": "icons/icon128.png"
      },
      default_popup: "popup.html"
    },
    icons: {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    },
    content_scripts: [
      {
        matches: ["http://*/*", "https://*/*"],
        js: ["content.js"],
        css: ["content.css"],
        run_at: "document_idle"
      }
    ]
  };

  await writeFile(path.join(extensionDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await copyFile(path.join(rootDir, "extensao_chrome/popup.html"), path.join(extensionDir, "popup.html"));
  await copyFile(path.join(rootDir, "extensao_chrome/popup.css"), path.join(extensionDir, "popup.css"));
  await copyFile(path.join(rootDir, "extensao_chrome/content.css"), path.join(extensionDir, "content.css"));
  if (existsSync(path.join(rootDir, "extensao_chrome/PRIVACY.md"))) {
    await copyFile(path.join(rootDir, "extensao_chrome/PRIVACY.md"), path.join(extensionDir, "PRIVACY.md"));
  }
  await cp(path.join(rootDir, "extensao_chrome/icons"), path.join(extensionDir, "icons"), { recursive: true });
}

async function writeReadme() {
  const readme = `# Corrija-me PT-BR v2

Build gerado automaticamente.

- Backend local: build/node-app/backend/server.cjs
- Dados de correcoes: build/node-app/data/replacements.json
- Extensao Chrome pronta para carregar: build/node-app/extension
`;
  await writeFile(path.join(buildDir, "README.txt"), readme);
}

async function main() {
  await rm(buildDir, { recursive: true, force: true });
  await mkdir(backendDir, { recursive: true });
  await mkdir(extensionDir, { recursive: true });
  await buildReplacementData();
  await buildBackend();
  await buildExtension();
  await writeReadme();
  console.log("Build TypeScript concluido em build/node-app");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
