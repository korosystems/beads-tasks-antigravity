#!/usr/bin/env node
/**
 * 零依赖单文件构建：把 index.html、styles.css 与 4 个 ES Module
 * 合成一个可通过 file:// 直接双击打开的 HTML。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist/antigravity-showcase.html");

const modules = [
  { id: "data", file: "js/data.js" },
  { id: "store", file: "js/store.js" },
  { id: "plugin_bundle", file: "js/plugin_bundle.js" },
  { id: "mock_api", file: "js/mock_api.js" },
  { id: "workbench", file: "js/workbench.js" },
  { id: "app", file: "js/app.js" },
];

const moduleId = (specifier) => {
  const match = /^(?:\.\/)?([\w-]+)\.js$/.exec(specifier);
  if (!match || !modules.some((module) => module.id === match[1]))
    throw new Error(`未知模块引用：${specifier}`);
  return match[1];
};

const importPattern =
  /^[ \t]*import\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["'];?[ \t]*$/gm;
const exportPattern =
  /^[ \t]*export\s+(?=(?:const|let|var|function|class)\b)/gm;

function buildModule(source, id) {
  const imports = [];
  let code = source.replace(importPattern, (full, specifiers, specifier) => {
    const bindings = specifiers
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [name, alias] = entry.split(/\s+as\s+/);
        return alias ? `${name}: ${alias}` : name;
      });
    imports.push({ id: moduleId(specifier), bindings });
    return "";
  });

  const exported = [...source.matchAll(
    /^[ \t]*export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm,
  )].map((match) => match[1]);
  code = code.replace(exportPattern, "").trim();

  const dependencyLines = imports
    .map(
      (dependency) =>
        `  const { ${dependency.bindings.join(", ")} } = __modules.${dependency.id};`,
    )
    .join("\n");
  const returnLine = exported.length
    ? `  return { ${exported.join(", ")} };\n`
    : "";

  return [
    `__modules.${id} = (() => {`,
    dependencyLines,
    code,
    returnLine + "})();",
  ]
    .filter(Boolean)
    .join("\n");
}

function inlineSafe(text, tag) {
  return text.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
}

const [html, css, ...sources] = await Promise.all([
  readFile(resolve(root, "index.html"), "utf8"),
  readFile(resolve(root, "styles.css"), "utf8"),
  ...modules.map((module) => readFile(resolve(root, module.file), "utf8")),
]);

const moduleCode = sources
  .map((source, i) => buildModule(source, modules[i].id))
  .join("\n\n");

const script = [
  "(function () {",
  '  "use strict";',
  "  const __modules = Object.create(null);",
  moduleCode,
  "})();",
].join("\n");

const inlinedCss = inlineSafe(
  css.replace(/^\s*@charset[^;]*;\s*/i, ""),
  "style",
);
const inlinedScript = inlineSafe(script, "script");

let outputHtml = html
  .replace(
    /[ \t]*<link\b[^>]*href="styles\.css"[^>]*>\s*/i,
    () => `    <!-- 单文件构建：样式已内联 -->\n    <style>\n${inlinedCss}\n    </style>\n`,
  )
  .replace(
    /[ \t]*<script\b[^>]*src="js\/app\.js"[^>]*>\s*<\/script>\s*/i,
    () => `    <!-- 单文件构建：脚本已内联（无 ES Module 依赖） -->\n    <script>\n${inlinedScript}\n    </script>\n`,
  );

if (/<link\b[^>]*href="styles\.css"|<script\b[^>]*src="js\/app\.js"/i.test(outputHtml))
  throw new Error("构建结果仍包含外部引用，请检查 index.html 模板");
if (!/<style>/.test(outputHtml) || !/<script>/.test(outputHtml))
  throw new Error("构建结果缺少内联样式或内联脚本");

outputHtml = outputHtml.replace(/\s*$/, "\n");

await mkdir(dirname(output), { recursive: true });
await writeFile(output, outputHtml, "utf8");
console.log(
  `已生成 ${output.replace(root + "/", "")}（${(Buffer.byteLength(outputHtml) / 1024).toFixed(1)} KB）`,
);
