# dsh-settings-manager

DSH web 插件：**管理其他插件在「全局设置」对话框中的放置**——显示/隐藏、排序、改名——**不需要修改上游**（deepseek-harness）。

## 它做什么

在「设置 → 设置编排」中列出所有已注册的设置分区（含内置的通用设置/模型/插件等 base 分区），支持：

- **隐藏 / 显示**：隐藏的分区立即从设置导航消失（内容也不会渲染），随时可恢复；
- **上移 / 下移 / 拖拽排序**：上移/下移按钮交换相邻分区；也可按住行首抓手拖到任意行的前/后，落点处显示蓝色插入指示线（带滞回，避免闪烁），松手即按插入位置重排——所有分区重编号为 10 的整数倍，精确且无冲突；
- **改名**：点铅笔进入行内编辑，Enter/失焦提交、Esc 取消；空值或等于原名即恢复原名。改的是设置导航名，分区内容头仍由插件自渲染、不受影响；
- **重置 / 全部恢复默认**：清除某个（或所有）分区的策略（含隐藏/顺序/改名），回到插件自身注册的原始值；
- **设置导航滚动**：设置外壳的导航列本身不滚动，分区多了会把底部几项裁掉（够不着）；本插件注入 CSS 让 `[role="dialog"] nav` 变为 `overflow-y: auto`，任何分区（包括排到末尾的）都能滚到——这也是"管理放置"的前提；
- **窄屏适配**：≤520px 视口下导航栏收窄、行动作紧凑（隐藏拖拽抓手、缩小图标），避免行内容溢出；
- **i18n**：内置简体中文与英文（`settingsManager` 命名空间，跟随外壳语言，默认回退英文）；
- 展示每个分区的 id 与来源插件（registrant）。

所有改动**即时生效**，无需重启。策略通过 **DSH 标准 settings 命名空间**（`settings-manager`）持久化到服务端：host 半区用 `installSettingsSection` 注册命名空间，客户端经 `connection.api.settings` 读写，由 SettingsProvider 落盘（loopback-only，纯服务端）。

## 原理：拦截槽位注册

全局设置的导航与内容都来自客户端槽位系统：每个插件通过
`ctx.slots.inject('settings.section', () => ctx.slots.register({ name, id, order, label }, Comp))` 注册分区。
本插件在 `SlotRegistry.prototype` 上打三个补丁（cordis 服务代理每次访问都动态取方法、不缓存，因此对所有插件立即生效）：

| 补丁 | 拦截点 | 作用 |
|---|---|---|
| `register` | 注册入口 | 每个 `settings.section` 注册都**经过**管理插件（记录库存；不落盘修改，保证 reset 永远能恢复原始值） |
| `entries` | 外壳导航读取 | 过滤隐藏分区 + 读时改写 order/label —— **覆盖所有分区，与注册时序无关**（含先于本插件注册的 base 分区） |
| `entriesOfSlot` | 内容选举读取 | 过滤隐藏分区（只过滤不克隆，满足渲染器 `isLive` 检查） |

策略变更后通过一次「注册+立即注销」临时条目 bump 槽位版本，外壳随即重读（无可见闪烁）。

## 安装

```bash
# 方式一：官方 CLI（需先发布或本地路径）
dsh plugin --profile web add dsh-settings-manager

# 方式二：profile 仓库（file: 依赖）
# package.json:
#   "dependencies": { "dsh-settings-manager": "file:../dsh-settings-manager" }
#   "dsh": { "profile": { "bundles": [ ..., "dsh-settings-manager" ] } }
pnpm install
```

重启 `dsh web` 后生效。

## 开发 / 构建

```bash
pnpm install        # 安装依赖（esbuild 需要 allowBuilds，见 pnpm-workspace.yaml）
pnpm typecheck      # tsc --noEmit（严格模式）
pnpm build          # esbuild 打包 → lib/（client.js 包进 DSH __ModuleLoader__ 格式）
pnpm test           # UT + e2e
```

`lib/` 是**构建产物**（已 gitignore），由 `pnpm build` 生成；`main`/`exports` 指向 `lib/`，所以用 `file:` 依赖前需先构建。本机开发时也常直接同步构建产物到活动 profile 的 `node_modules/dsh-settings-manager`（`lib/client.js` + `src/client.js`）实现即改即生效。

## 测试

三层测试，覆盖逻辑、组件交互、真实浏览器集成：

```bash
npm run test            # UT + e2e 冒烟（node:test，含 jsdom 真实渲染组件）
npm run test:unit       # 仅单元测试：policy / reorder / patches
npm run test:e2e        # 仅 e2e 冒烟：jsdom 里挂载管理面板并驱动开关/排序/重置
npm run test:playwright # 真实浏览器（本机 Edge）对运行中的 DSH GUI 做端到端
```

- **UT（`tests/unit/`）**：在 VM 沙箱里加载客户端 bundle（`window.__ModuleLoader__`），通过 `__test` 缝测策略存储、reorder 原语、改名/标签读写、三个槽位补丁（注册经过、读路径隐藏/重排/改名、`entriesOfSlot` 身份安全、bump 无残留、服务端 settings 持久化（mock connection）、reset/resetAll、自身分区保护）。
- **e2e 冒烟（`tests/e2e/`）**：jsdom + react-dom 真实渲染 `ManagerSection`，驱动开关隐藏/显示、↓ 重排、全部重置、改名提交/还原，验证实时响应与策略持久化。
- **Playwright（`tests/playwright/`）**：用本机 Microsoft Edge（`channel: 'msedge'`）连到活动 DSH GUI（`DSH_WEB_URL` 或 `DSH_PORT`，默认 `http://127.0.0.1:3080`），验证“设置编排”出现在导航顶部、面板按分区渲染、开关/排序/重置/拖拽（落点指示线出现与消失）/改名（含刷新后持久）真实生效。首启/引导对话框按 `dsh-web-profile` CI 的循环 dismiss 方式跳过。每个用例用独立浏览器上下文（localStorage 隔离），不污染你的真实 profile。

## 限制与说明

- **base 分区（通用设置/模型/插件）永远先于任何第三方插件注册**，注册入口抓不到它们——全部由读路径补丁覆盖，所以本插件不依赖加载顺序（读路径是主机制）。
- 导航图标来自设置外壳的内置 id 封闭列表，本插件的分区显示通用齿轮。
- 隐藏正在查看的分区时，内容区显示空占位，导航其余项照常可点。
- 策略按浏览器本地保存（settings RPC 只对白名单命名空间开放，profile 插件无法自注册命名空间）。
- 本插件自身分区（`settings-manager`）不可隐藏，保证管理入口始终可达。

## 结构

```
src/client.ts    浏览器半区源码（TS：策略存储 + 三个补丁 + 管理面板）
src/host.ts      宿主半区源码（TS：注册 `settings-manager` settings 命名空间，服务端持久化）
lib/client.js    构建产物（gitignore）：esbuild 打包 + DSH __ModuleLoader__.load 包装（只依赖 react seed）
lib/host.mjs     构建产物（gitignore）：宿主半区（ESM，import type 已擦除 → 零运行时导入）
scripts/build.mjs  构建（node scripts/build.mjs）；typecheck 用 pnpm typecheck
cordis.patch.yml 打包挂载声明
tests/           单元测试（node:test）、e2e 冒烟（jsdom+react）、Playwright（Edge）
```

宿主类型 `import type { Context } from '@deepseek-ai/cordis'` 仅编译期使用，产物零官方运行时导入；`@deepseek-ai/cordis` 作为 devDependency（类型检查用），不在 peerDependencies 里。

## License

MIT
