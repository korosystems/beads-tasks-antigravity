# Beads Tasks · Antigravity 展示站

[Beads Tasks](https://github.com/korosystems/beads-tasks-antigravity) 的 GitHub Pages 官网和交互式文档演示。工作台模拟两个 Beads 项目，展示 epic、子任务、依赖、MCP Apps 内联卡片、全局看板、Sidecar、评审队列、页内搜索和设置。所有操作仅修改浏览器中的模拟数据，不连接真实服务；刷新页面重置状态。

安装插件：

```sh
agy plugin install https://github.com/korosystems/beads-tasks-antigravity
```

在仓库根目录同步真实插件界面、构建单文件并测试：

```sh
node site/scripts/sync-plugin.mjs
node site/scripts/build-standalone.mjs
node --test site/tests/site.test.mjs
```

使用 `python3 -m http.server --directory site` 本地预览。`site/dist/antigravity-showcase.html` 是可直接打开的独立页面。插件界面来自 `sidecars/tasks/web/`，`site/js/plugin_bundle.js` 由同步脚本生成。

`.github/workflows/pages.yml` 构建并将 `_site/` 部署至 GitHub Pages。仓库 Settings → Pages 的 Source 需设置为 GitHub Actions。站点地址为 https://korosystems.github.io/beads-tasks-antigravity/。
