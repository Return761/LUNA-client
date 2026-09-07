# LUNA

基于 **pywebview** 的 Agent 客户端项目骨架。
前端 UI 从 `Prismex-studio.github.io/pages/agent-ui-demo.html` 分离而来（最小化保留），
视觉风格整体重制为「纸面 + 硬件」美学：暖浅灰底色 · 近黑重音 · 信号黄强调 ·
大圆角卡片 · 衬线标题 · 等宽小字 · 弥散渐变/点阵网格/交叉细线装饰。
图标采用**复古磁带 × 构成主义**语言（磁带壳与卷盘、斜切几何、直角箭头、黄点强调），
全部为内联 SVG（`currentColor` 自适应浅/深主题）；界面动效保持克制轻量
（入场错峰、日志滑入、未保存点脉冲、打字机光标、按钮微回旋等），并支持多档响应式布局。

## 目录结构

```
LUNA/
├── app.py               # 入口：创建 pywebview 窗口并启动
├── api.py               # 前端 JS API 桥接层（window.pywebview.api.*）
├── requirements.txt
├── README.md
└── web/                 # 前端（独立于站点，浏览器可直接预览）
    ├── index.html       # Agent UI 界面（顶栏菜单/文件标签页/文件树/编辑器/操作日志）
    ├── css/
    │   ├── theme.css        # 主题变量与字体（浅色色板 / 兼容旧变量名）
    │   ├── ui.css           # 页面级界面样式（菜单/标签页/编辑器/模态等）
    │   └── file-tree.css    # 通用文件树组件样式
    └── js/
        └── file-tree.js     # 通用文件树组件（重命名 / 移动 / 删除 / 右键菜单扩展）
```

## 运行

```bash
pip install -r requirements.txt
python app.py
```

## 前后端交互方式

- 前端编辑操作（重命名 / 移动 / 删除）会优先调用后端：
  `window.pywebview.api.rename / move / delete(...)`（对应 `api.py` 中的方法）。
- **返回 `false` 或抛异常 → 前端自动回滚本地修改**（FileTree 组件乐观更新模式）。
- 打开文件：`open_file(node_id)` 返回 `{ "ok": True, "content": "..." }`；
  保存内容：`save_file(node_id, content)`（示例数据保存在 `api.py` 的 `DEMO_CONTENTS`）。
- 浏览器直接打开 `web/index.html` 时为"仅前端模式"（无 `window.pywebview`，
  编辑只在本地生效，示例内容由前端 `FALLBACK_CONTENTS` 提供），便于脱离 Python 环境调试 UI。

## 顶栏功能（已可用）

- **菜单栏**：Project / Edit / View / More 四个下拉菜单（点击或按 P / E / V / X 打开，Esc 关闭）：
  - 项目：新建文件/文件夹（含扩展名模板）、保存全部、刷新文件树、关闭当前标签、重置演示数据；
  - 编辑：重命名 / 删除 / 剪切 / 粘贴（作用于文件树选中节点）、复制文件名；
  - 视图：弥散渐变背景、点阵网格、交叉细线、漂移动效、CRT 扫描线、**深色模式（⌃D）**、
    界面字号、重置视图设置；
  - 其他：关于 LUNA、清空操作日志。
- **深色模式**：View 菜单「深色模式」或顶栏月亮按钮（⌃D）切换；手动选择会通过
  `localStorage('luna.theme')` 持久化，默认跟随系统 `prefers-color-scheme`；
  「重置视图设置」恢复跟随系统。整套配色由 CSS 变量驱动（黄色主色在两种模式下保持不变）。
- **文件标签页**：双击文件树中的文件打开；标签可点击切换、× 关闭（未保存时二次确认）；
  编辑后出现黄色未保存点；⌃S 保存当前、⌃⇧S 保存全部、⌃W 关闭标签、⌃R 刷新、⌃N 新建。
- **右键菜单**（文件树）：打开/折叠、重命名、剪切、粘贴、删除，以及"在此新建文件/文件夹"。

## 后续 TODO

- [ ] `api.py` 中接入真实文件系统 / Agent 逻辑
- [ ] 编辑器语法高亮、文件类型图标
- [ ] 工作区目录选择、Agent 任务编排等
