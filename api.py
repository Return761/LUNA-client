"""LUNA —— 前端 JS API 桥接层

pywebview 会把本类的公开方法暴露给前端，前端通过
``window.pywebview.api.<方法名>(...)`` 调用（返回 Promise）。

当前为骨架实现：
- ``list_tree`` 返回示例文件树（后续由 Agent / 文件系统接管数据源）；
- 编辑类方法（rename / move / delete）仅返回 True，
  表示"允许前端保留本次本地修改"；
  返回 False 或抛出异常时，前端 FileTree 组件会自动回滚本地修改。

约定：前端 FileTree 的钩子签名 -> 本类方法：
    onRename(node, newName, oldName) -> rename(node_id, new_name, old_name)
    onMove(node, to_parent, from_parent) -> move(node_id, to_parent_id, from_parent_id)
    onDelete(node, parent) -> delete(node_id)
"""

# 示例工作区文件树（与前端 SAMPLE_TREE 保持一致，后续由后端接管数据源）
SAMPLE_TREE = [
    {
        "id": "d-src",
        "name": "src",
        "type": "dir",
        "children": [
            {"id": "f-main", "name": "main.py", "type": "file"},
            {
                "id": "d-utils",
                "name": "utils",
                "type": "dir",
                "children": [
                    {"id": "f-fmt", "name": "formatter.py", "type": "file"},
                    {"id": "f-io", "name": "io_helper.py", "type": "file"},
                    {"id": "f-cache", "name": "cache.py", "type": "file"},
                ],
            },
            {
                "id": "d-ui",
                "name": "ui",
                "type": "dir",
                "children": [
                    {"id": "f-app", "name": "app.js", "type": "file"},
                    {"id": "f-style", "name": "style.css", "type": "file"},
                    {"id": "f-index", "name": "index.html", "type": "file"},
                ],
            },
            {"id": "f-requirements", "name": "requirements.txt", "type": "file"},
        ],
    },
    {
        "id": "d-docs",
        "name": "docs",
        "type": "dir",
        "children": [
            {"id": "f-readme", "name": "README.md", "type": "file"},
            {"id": "f-api", "name": "API.md", "type": "file"},
        ],
    },
    {"id": "f-pkg", "name": "package.json", "type": "file"},
    {"id": "f-config", "name": "config.yaml", "type": "file"},
]

# 示例文件内容（与前端 FALLBACK_CONTENTS 保持一致；save_file 后的修改会写回这里）
DEMO_CONTENTS = {
    "f-main": (
        "#!/usr/bin/env python3\n"
        "# LUNA demo: agent entry — 模拟 Agent 主入口\n"
        "\n"
        "from utils.formatter import format_tree\n"
        "from utils.io_helper import read_workspace\n"
        "\n"
        "\n"
        "def bootstrap(workspace: str) -> None:\n"
        '    """加载工作区并格式化输出文件树。"""\n'
        "    tree = read_workspace(workspace)\n"
        "    print(format_tree(tree))\n"
        "\n"
        "\n"
        'if __name__ == "__main__":\n'
        '    bootstrap("")\n'
        ""
    ),
    "f-fmt": (
        '"""格式化文件树为文本树。"""\n'
        "\n"
        "def format_tree(nodes, indent: str = \"\") -> str:\n"
        "    lines = []\n"
        "    for node in nodes:\n"
        '        lines.append(indent + ("▸ " if node["type"] == "dir" else "· ") + node["name"])\n'
        '        if node.get("children"):\n'
        '            lines.append(format_tree(node["children"], indent + "  "))\n'
        '    return "\\n".join(lines)\n'
        ""
    ),
    "f-io": (
        '"""工作区读写工具。"""\n'
        "import json\n"
        "\n"
        "\n"
        "def read_workspace(path: str) -> list:\n"
        "    # TODO: 接入真实文件系统\n"
        "    return []\n"
        "\n"
        "\n"
        "def write_workspace(path: str, data: list) -> None:\n"
        "    # TODO: 接入真实文件系统\n"
        "    print(json.dumps(data, ensure_ascii=False, indent=2))\n"
        ""
    ),
    "f-cache": (
        '"""轻量缓存。"""\n'
        "\n"
        "_cache = {}\n"
        "\n"
        "\n"
        "def get(key):\n"
        "    return _cache.get(key)\n"
        "\n"
        "\n"
        "def put(key, value):\n"
        "    _cache[key] = value\n"
        ""
    ),
    "f-app": (
        "// LUNA demo: 前端交互逻辑\n"
        "const app = {\n"
        "  state: { activeFile: null },\n"
        '  open(file) { this.state.activeFile = file; console.log("open", file); },\n'
        '  save() { console.log("save"); }\n'
        "};\n"
        "\n"
        "window.app = app;\n"
        ""
    ),
    "f-style": (
        "/* LUNA demo: 样式示例 */\n"
        ".card {\n"
        "  border-radius: 18px;\n"
        "  background: rgba(255, 255, 255, 0.8);\n"
        "  box-shadow: 0 8px 30px rgba(20, 20, 20, 0.07);\n"
        "}\n"
        ""
    ),
    "f-index": (
        "<!DOCTYPE html>\n"
        '<html lang="zh-CN">\n'
        "<head>\n"
        '  <meta charset="UTF-8">\n'
        "  <title>LUNA Demo</title>\n"
        "</head>\n"
        "<body>\n"
        "  <h1>Hello LUNA</h1>\n"
        "</body>\n"
        "</html>\n"
        ""
    ),
    "f-requirements": "pywebview>=5.0\nflask\nrequests\n",
    "f-readme": (
        "# LUNA\n"
        "\n"
        "基于 pywebview 的 Agent 客户端项目骨架。\n"
        "\n"
        "## 运行\n"
        "\n"
        "```bash\n"
        "pip install -r requirements.txt\n"
        "python app.py\n"
        "```\n"
        ""
    ),
    "f-api": (
        "# API 文档（示例）\n"
        "\n"
        "## `list_tree()`\n"
        "返回工作区文件树根节点列表。\n"
        "\n"
        "## `open_file(node_id)`\n"
        '返回 `{ "ok": true, "content": "..." }`。\n'
        "\n"
        "## `save_file(node_id, content)`\n"
        "保存内容。\n"
        ""
    ),
    "f-pkg": (
        "{\n"
        '  "name": "luna-demo",\n'
        '  "version": "0.1.0",\n'
        '  "private": true\n'
        "}\n"
        ""
    ),
    "f-config": (
        "# LUNA 演示配置\n"
        "workspace: .\n"
        "auto_save: false\n"
        "theme: paper\n"
        ""
    ),
}


class Api:
    """暴露给前端 ``window.pywebview.api`` 的方法集合。"""

    # ---------- 数据 ----------

    def list_tree(self):
        """返回工作区文件树（根节点列表）。"""
        # TODO: 接入 Agent 后，改为返回真实工作区结构。
        return SAMPLE_TREE

    # ---------- 编辑操作 ----------

    def rename(self, node_id, new_name, old_name):
        """重命名文件 / 目录。返回 False 时前端会回滚本地修改。"""
        # TODO: 真实重命名逻辑（校验、调用文件系统等）。
        return True

    def move(self, node_id, to_parent_id, from_parent_id):
        """移动文件 / 目录。返回 False 时前端会回滚本地修改。"""
        # TODO: 真实移动逻辑（to_parent_id 为 null 表示根目录）。
        return True

    def delete(self, node_id):
        """删除文件 / 目录。返回 False 时前端会回滚本地修改。"""
        # TODO: 真实删除逻辑。
        return True

    # ---------- 文件内容 ----------

    def open_file(self, node_id):
        """打开文件，返回内容（供中央面板展示 / 编辑）。"""
        # TODO: 接入真实文件系统后改为读取实际文件。
        content = DEMO_CONTENTS.get(node_id, "")
        return {"ok": True, "content": content}

    def save_file(self, node_id, content):
        """保存文件内容。返回 False 时前端会提示保存失败。"""
        # TODO: 接入真实文件系统后改为写盘。
        if isinstance(content, str):
            DEMO_CONTENTS[node_id] = content
            return True
        return False
