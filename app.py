"""LUNA —— Agent 客户端（pywebview 入口）

运行：
    pip install -r requirements.txt
    python app.py
"""

import os

import webview

from api import Api

# 项目根目录 / 前端页面路径（使用绝对路径，避免受启动时工作目录影响）
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INDEX_HTML = os.path.join(BASE_DIR, "web", "index.html")


def main():
    api = Api()
    webview.create_window(
        "LUNA - Agent Client",
        INDEX_HTML,
        js_api=api,
        width=1280,
        height=800,
        min_size=(960, 600),
    )
    webview.start()


if __name__ == "__main__":
    main()
