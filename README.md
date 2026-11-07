# 紫荆情怀 · 个人博客

一个霓虹风格的静态个人博客，包含「文章」与「日语歌词逐句精讲」两个板块。

## 技术栈

- 纯静态：HTML + CSS + 原生 JS，零依赖、零构建
- 托管：GitHub Pages

## 目录结构

```
├── index.html        # 首页
├── about.html        # 关于页
├── style.css         # 全局样式（霓虹浅色主题）
├── home.js           # 首页歌词曲目卡片渲染
├── posts.js          # 文章列表数据
├── posts/            # 文章页
├── lyrics/           # 日语歌词逐句精讲（17 首成品 + 数据）
├── avatar.jpg        # 头像
└── hero.jpg          # 首页头图
```

## 本地预览

直接用浏览器打开 `index.html` 即可（零依赖，无需构建）。

## 部署

推送到 GitHub 后，在仓库 Settings → Pages 里开启 GitHub Pages，选择 `main` 分支部署。
