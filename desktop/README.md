# AI Project Commander — Windows 桌面版

把本地 Web 应用变成真正的桌面程序：双击桌面图标即可使用，零 npm 依赖（ADR-001）。

## 装了什么

| 文件 | 作用 |
| --- | --- |
| `AIProjectCommander.exe` | 桌面启动器（C# WinForms，415 KB）。用系统自带的 `csc.exe` 编译。 |
| `Commander.cs` | 启动器源码：AppUserModelID、健康探测、拉起 node、Edge 应用窗口、托盘、进程清理。 |
| `build.ps1` | 编译脚本（`csc /target:winexe /win32icon:icons/app.ico`）。 |
| `build-icons.ps1` + `make-ico.py` | 从 `icons/icon-1024.png` 渲染全套图标并手写 `.ico` 容器。 |
| `icons/` | `app.ico`(16/24/32/48/64/128/256)、`icon-{32,48,192,512}.png`、`maskable-512.png`、原始 `icon-1024.png`。 |
| `install-shortcuts.ps1` / `uninstall-shortcuts.ps1` | 创建 / 清理「AI Project Commander」桌面与开始菜单快捷方式。 |

## 怎么用

1. 双击桌面（或开始菜单）的 **AI Project Commander**。
2. 启动器先探测 `GET /api/health`：
   - 服务已在跑（比如你用 `启动.bat` 起的）→ 直接接管，**不会**再起第二个 node；
   - 没在跑 → 以隐藏子进程启动 `node src/server/cli.js start`（工作目录 = 项目根，`data/` 才会落在正确位置），期间显示带图标的进度窗。
3. 就绪后用 Edge 应用模式打开界面（无地址栏、无标签页），并弹出自己的任务栏按钮。
4. 右下角托盘图标（Win11 默认收进「隐藏的图标」里，点 `^` 展开）：
   - **打开窗口** —— 重新打开/聚焦应用窗口，服务没起会自动起；
   - **停止服务** —— 结束 node 进程树后退出（也会清理由 `启动.bat` 等方式启动的同名服务）；
   - **退出** —— 只结束自己启动的 node；接管来的服务保持不动。
5. 再次双击图标 = 让常驻实例重新开窗口（单实例，不会重复起服务）。

命令行等价物（无需 PowerShell 之外任何东西）：

```bat
"C:\Users\Administrator\Desktop\AI-Project-Commander\desktop\AIProjectCommander.exe"
"C:\...\AIProjectCommander.exe" --exit        :: 让常驻实例优雅退出
```

可用环境变量：`COMMANDER_PORT`（默认 8787，服务自带向上退避）、`COMMANDER_DATA_DIR`、`COMMANDER_NODE`。

## 重新构建

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File desktop\build.ps1
:: 改了图标源文件后：
powershell -NoProfile -ExecutionPolicy Bypass -File desktop\build-icons.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File desktop\install-shortcuts.ps1
```

`build.ps1` 只做三件事：找到 `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`、编译、然后校验产物（`ExtractAssociatedIcon` 取回图标 + 确认 `app.ico` 资源已内嵌）。源码含中文，**保存时必须带 UTF-8 BOM**，否则 `csc` 会按系统 ANSI 代码页解码成乱码。

## 诚实的限制

* **窗口不是 Electron/WebView2，而是本机安装的 Microsoft Edge（Chromium）以 `--app=` 模式渲染。** 这正是零依赖的代价与理由：机器上没有 WebView2 的托管封装程序集，也没有 NuGet 缓存，装不了任何包。因此：
  * 需要机器上装有 Edge（本机会退化为找不到 `msedge.exe` 时弹窗报错，不会静默失败）；
  * 窗口标题栏/任务栏图标取自**网页自己的 favicon**，不是 `app.ico`。实测已确认：当前 `src/web/index.html` 里那条内联 SVG `<link rel="icon">`（紫色方块 + `^`）就是窗口和任务栏显示的图标。
  * `--classid` 在 Edge 154 上被忽略（实测窗口类名仍是 `Chrome_WidgetWin_1`），所以没有传这个参数。
* 服务日志在 `data/logs/`，启动器日志在 `data/desktop/launcher.log`；Edge 独立配置目录 `data/desktop/browser/`（约 83 MB，属 `data/`，已被 .gitignore 忽略）。
* 端口退避会让 PWA 安装失去意义（`start_url` 绑定具体 origin），桌面启动器则每次自动跟随实际 URL。

## 想让窗口也用上新图标？（PWA 路线，需你改 src/web 与 src/server）

结论：**能，而且不必装 Service Worker。** Edge 应用模式窗口已经用网页 favicon 当图标，所以最快路径只是把 favicon 换成设计好的 PNG；再配一份 manifest 才能被 Edge 认作「可安装应用」（独立任务栏身份 + 开始菜单项 + 更高清的图标）。

必须先知道的两个坑（都在这份代码里）：

1. `src/server/http-server.js` 只从 `WEB_ROOT = src/web` 提供静态文件，所以图标要复制到 `src/web/icons/`，`desktop/icons/` 里的不会被 serve。
2. 它的 `MIME` 表**没有** `.webmanifest`，会按 `application/octet-stream` + `nosniff` 返回，Chromium 会直接拒绝解析 manifest。二选一：文件命名成 `manifest.json`（表里有 `.json` → `application/json`，Chromium 接受），或在 `MIME` 里加 `'.webmanifest': 'application/manifest+json'`。

复制图标：

```bat
mkdir src\web\icons 2>nul
copy desktop\icons\icon-{32,48,192,512}.png desktop\icons\maskable-512.png src\web\icons\
```

`src/web/index.html` 的 `<head>` 里（替换现有那条内联 SVG favicon）：

```html
<link rel="manifest" href="/manifest.json" />
<link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png" />
<link rel="icon" type="image/png" sizes="48x48" href="/icons/icon-48.png" />
<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
<link rel="apple-touch-icon" href="/icons/icon-192.png" />
<meta name="theme-color" content="#5e6ad2" />
```

`src/web/manifest.json`：

```json
{
  "name": "AI Project Commander",
  "short_name": "Commander",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#0f1115",
  "theme_color": "#5e6ad2",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Service Worker 只在需要离线时才加（`http://127.0.0.1` 属于 secure context，可以注册）。放 `src/web/sw.js`，并在 `index.html` 末尾注册：

```html
<script>
  if ('serviceWorker' in navigator) {
    addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
</script>
```

```js
// src/web/sw.js —— 只缓存静态资源，绝不缓存 /api/
const CACHE = 'commander-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(e.request);
    const net = fetch(e.request).then((r) => { if (r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  })());
});
```

装好后在普通 Edge 窗口地址栏右侧（或 `edge://apps`）点「安装 AI Project Commander」，Windows 会给出带设计图标的独立应用窗口与开始菜单项——但那条路径依赖端口固定，日常使用仍以本启动器为准。
