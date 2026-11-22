# 柳园最终兵器

柳园21栋526，604联合出品。首页提供工具箱、T800 桌宠和日语歌词精讲。

## 本地预览

直接用浏览器打开 `index.html`。在首页工具箱点击卡片进入各详情页，点击「召唤桌宠」可直接在首页与 T800 互动。静态网页无需构建。

## 桌宠

`tools.html` 是 T800 桌宠的技术说明页，也是它的演示台：点「召唤桌宠」在首页唤起，或用页面上的动作按钮逐个触发。首屏那排按钮走的是同一个入口（`home.js` 里的 `ensurePet()`）。

`tool-assets/t800-pet.js` 是 6.3 MB 的单文件（内联 three.js r170），首页只在点击时才注入；`tool-assets/collection.js` 负责把桌宠停靠在演示台、同步动作状态和禁用未就绪的按钮。

## 安装包

`downloads/` 里放 MiniCode（2.2.0 / 2.3.0）、待办三个小包，合计约 300 KB。山水天气的安装包约 175 MB，超出 GitHub 单文件 100 MB 的上限，已移到上级目录 `_外链大文件/`，`weather.html` 指向 GitHub Releases 外链；换网盘只改那一处 `href`。对外发布不需要带 `_外链大文件/`。

## 目录结构

- `index.html`、`home.js`：展示首页和歌词索引
- `tools.html`、`tool-assets/`：T800 桌宠独立页和工具素材
- `lyrics/`：日语歌词逐句精讲
- `marketlab/`、`minicode/`、`downloads/`：工具页面、源码和安卓安装包

如需部署，可将本目录作为静态网站根目录。
