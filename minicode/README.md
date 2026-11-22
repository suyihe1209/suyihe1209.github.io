# MiniCode 安卓版

`mini-code-editor.html` 是安卓安装包内的编辑器。浏览器可打开它试用本地编辑，网页与安卓共用该编辑器和 AI 试运行对话框。网页版通过浏览器直接连接兼容接口，API Key 仅留在当前标签页内存。安卓通过原生网络接口发送请求。

应用包名为 `com.minicode.editor`。2.3.0 可覆盖安装原签名的 2.1.0 和 2.2.0。已签名的成品位于 [博客下载目录](../downloads/MiniCode-2.3.0.apk)，使用说明在 [MiniCode 工具页](../minicode.html)。

## 构建

在 macOS 或 Linux 安装 JDK 17 与 Android SDK，设置 `JAVA_HOME` 和 `ANDROID_HOME`。脚本默认使用 Android 平台 33 和 Build Tools 33.0.2，需要时可用 `ANDROID_PLATFORM` 和 `ANDROID_BUILD_TOOLS` 指定本机版本。

```sh
./android/build.sh /tmp/MiniCode-aligned.apk
```

签发可安装版本时，从本机凭据管理工具提供 `MINICODE_SIGNING_FILE`、`MINICODE_KEY_ALIAS`、`MINICODE_STORE_PASSWORD` 和 `MINICODE_KEY_PASSWORD`，再运行同一命令。覆盖旧版需要使用同一签名。

## 编辑器回归检查

安装 Node.js、Playwright 及其 Chromium 后，运行以下这些入口。若使用已安装的 Chrome，可用 `CHROME_PATH` 指定可执行文件。

```sh
node tests/editor.cjs
node tests/editor-data.cjs
node tests/editor-lines.cjs
node --test tests/sim-engine.cjs
node tests/sim-editor-browser.cjs
```
