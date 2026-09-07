/*!
 * FileTree —— 通用文件树组件（纯前端，无依赖）
 * ==================================================================
 * 定位：适用于 Agent 演示页等场景的通用文件树。
 *       编辑能力仅包含：重命名 / 移动 / 删除（其余编辑功能一律不做）。
 *
 * 数据模型（node）：
 *   {
 *     id:       string,               // 必填，全局唯一
 *     name:     string,               // 显示名称
 *     type:     'file' | 'dir',       // 可省略：存在 children 数组时自动推断为 'dir'
 *     children: node[] | undefined,   // 仅目录需要
 *     extra:    any                   // 可选，宿主自定义附加数据（组件不关心）
 *   }
 *
 * 用法：
 *   const tree = new FileTree('#file-tree', {
 *     data: [ ... ],
 *     defaultExpandAll: true,
 *     onSelect(node) { ... },
 *     onOpen(node)   { ... },
 *     // 编辑操作：返回 false 或 Promise reject 时，组件会回滚本地修改（乐观更新）
 *     async onRename(node, newName, oldName) { return true; },
 *     async onMove(node, toParent, fromParent) { return true; },
 *     async onDelete(node, parent) { return true; },
 *   });
 *
 * 事件（在容器元素上派发 CustomEvent，bubbles）：
 *   filetree:select  { node }
 *   filetree:open    { node }
 *   filetree:rename  { node, oldName, newName }
 *   filetree:move    { node, fromParent, toParent }
 *   filetree:delete  { node, parent }
 *   （编辑操作被宿主拒绝而回滚时，额外派发对应的 *-revert 事件）
 *
 * 交互：
 *   单击选中 / 双击打开（文件）或展开（目录）
 *   F2 重命名 · Delete 删除 · Ctrl+X 剪切 · Ctrl+V 粘贴 · Esc 取消
 *   ↑ / ↓ 移动选择 · ← / → 折叠 / 展开
 *   拖拽移动：拖到目录上 = 移入目录；拖到文件上 = 同级插入；拖到空白 = 移到根
 * ==================================================================
 */
(function (global, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = factory();
    } else {
        global.FileTree = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const TYPE_FILE = 'file';
    const TYPE_DIR = 'dir';

    // ---------- 内联图标（复古磁带 / 构成主义风格，currentColor + 黄色点缀） ----------
    const ICONS = {
        // 实心三角（构成主义箭头）
        chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" d="M8.9 8.8 15.4 12 8.9 15.2Z"/></svg>',
        // 磁带文件夹：文件夹轮廓 + 磁带走带卷盘
        folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M3 8A2.5 2.5 0 0 1 5.5 5.5h4.1l2.1 2.2h6.8A2.5 2.5 0 0 1 21 10.2v6.3a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5Z"/>' +
            '<circle cx="12" cy="13.7" r="2.9" stroke-width="1.4"/>' +
            '<circle cx="12" cy="13.7" r="1.05" class="ic-accent"/></svg>',
        // 磁带文件：图纸轮廓 + 卷盘
        file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' +
            '<path d="M13.5 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8.5Z"/>' +
            '<path d="M13.5 3v5.5H19"/>' +
            '<circle cx="12" cy="14.8" r="2.6" stroke-width="1.4"/>' +
            '<circle cx="12" cy="14.8" r="0.95" class="ic-accent"/></svg>',
    };

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    const DEFAULTS = {
        allowRename: true,
        allowMove: true,
        allowDelete: true,
        confirmDelete: true,       // 删除前先显示行内确认
        showContextMenu: true,     // 右键菜单
        defaultExpandAll: true,    // 初始展开全部目录
        emptyText: '（空）',
        onSelect: null,
        onOpen: null,
        onRename: null,
        onMove: null,
        onDelete: null,
    };

    class FileTree {
        constructor(container, options) {
            if (!container) throw new Error('[FileTree] 缺少容器参数');
            this.container = typeof container === 'string' ? document.querySelector(container) : container;
            if (!this.container) throw new Error('[FileTree] 未找到容器元素: ' + container);
            this.options = Object.assign({}, DEFAULTS, options || {});

            this._model = [];            // 根节点列表
            this._byId = new Map();      // id -> node
            this._parentOf = new Map();  // node -> parent node（根为 null）
            this._collapsed = new Set(); // 折叠的目录 id
            this._rows = new Map();      // id -> row 元素（最近一次渲染）
            this._selectedId = null;
            this._cutId = null;          // 剪切（移动）待粘贴的节点 id
            this._editingId = null;      // 正在重命名的节点 id
            this._confirmNodeId = null;  // 正在行内确认删除的节点 id
            this._confirmCancelHandler = null;
            this._dragId = null;
            this._dropRow = null;
            this._menuEl = null;
            this._destroyed = false;

            this._buildRoot();
            if (Array.isArray(this.options.data)) this.setData(this.options.data);
            this._bind();
        }

        /* ================= 公共 API ================= */

        /** 设置 / 重置整棵树的根节点列表 */
        setData(data) {
            this._model = this._normalizeTree(Array.isArray(data) ? data : []);
            this._collapsed.clear();
            if (this.options.defaultExpandAll) this._expandAll(this._model);
            this._selectedId = null;
            this._cutId = null;
            this._editingId = null;
            this._render();
            return this;
        }

        /** 获取当前树的根节点列表（引用） */
        getData() {
            return this._model;
        }

        /** 按 id 查找节点 */
        getNode(id) {
            return this._byId.get(id) || null;
        }

        /** 当前选中节点 */
        getSelectedNode() {
            return this._selectedId ? this._byId.get(this._selectedId) || null : null;
        }

        /** 强制重新渲染 */
        refresh() {
            this._render();
            return this;
        }

        /* ================= 公共编辑动作（供宿主菜单调用） ================= */

        /** 开始对节点进行行内重命名（等价于选中后按 F2） */
        startRename(nodeOrId) {
            const node = typeof nodeOrId === 'string' ? this.getNode(nodeOrId) : nodeOrId;
            if (node && !this._editingId) {
                this._select(node);
                this._startRename(node);
            }
            return !!node;
        }

        /** 删除节点（带行内确认，双击确认行为一致） */
        deleteNode(nodeOrId) {
            const node = typeof nodeOrId === 'string' ? this.getNode(nodeOrId) : nodeOrId;
            if (!node) return false;
            this._select(node);
            this._delete(node);
            return true;
        }

        /** 剪切节点（待粘贴标记），再点一次取消 */
        cutNode(nodeOrId) {
            const node = typeof nodeOrId === 'string' ? this.getNode(nodeOrId) : nodeOrId;
            if (!node) return false;
            this._select(node);
            this._cut(node);
            return true;
        }

        /** 粘贴到目标节点（目录内）或根目录 */
        pasteNode(nodeOrId) {
            if (!this._cutId) return false;
            const node = typeof nodeOrId === 'string' ? this.getNode(nodeOrId) : nodeOrId;
            if (node) this._pasteTo(node);
            else this._pasteToRoot();
            return true;
        }

        /** 是否处于剪切待粘贴状态 */
        hasPendingCut() {
            return !!this._cutId;
        }

        /** 销毁组件（移除 DOM 与所有监听） */
        destroy() {
            this._destroyed = true;
            this._unbind();
            this._closeMenu();
            this._clearConfirmListener();
            if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
        }

        /* ================= 内部：初始化 ================= */

        _buildRoot() {
            const root = document.createElement('div');
            root.className = 'ft-root';
            root.tabIndex = 0;
            root.setAttribute('role', 'tree');
            root.setAttribute('aria-label', '文件树');
            this.container.appendChild(root);
            this.root = root;
        }

        _normalizeTree(nodes) {
            return nodes.map(function (n) {
                const node = Object.assign({}, n);
                const hasChildren = Array.isArray(node.children);
                if (node.type === undefined) node.type = hasChildren ? TYPE_DIR : TYPE_FILE;
                if (node.type === TYPE_DIR && !hasChildren) node.children = [];
                if (node.children) node.children = this._normalizeTree(node.children);
                return node;
            }, this);
        }

        _expandAll(nodes) {
            for (const node of nodes) {
                if (node.type === TYPE_DIR) {
                    this._collapsed.delete(node.id);
                    if (node.children) this._expandAll(node.children);
                }
            }
        }

        _bind() {
            this._onClick = (e) => this._handleClick(e);
            this._onDblClick = (e) => this._handleDblClick(e);
            this._onContext = (e) => this._handleContextMenu(e);
            this._onKeyDown = (e) => this._handleKeyDown(e);
            this._onDragStart = (e) => this._handleDragStart(e);
            this._onDragOver = (e) => this._handleDragOver(e);
            this._onDrop = (e) => this._handleDrop(e);
            this._onDragEnd = (e) => this._handleDragEnd(e);

            this.root.addEventListener('click', this._onClick);
            this.root.addEventListener('dblclick', this._onDblClick);
            this.root.addEventListener('contextmenu', this._onContext);
            this.root.addEventListener('keydown', this._onKeyDown);
            this.root.addEventListener('dragstart', this._onDragStart);
            this.root.addEventListener('dragover', this._onDragOver);
            this.root.addEventListener('drop', this._onDrop);
            this.root.addEventListener('dragend', this._onDragEnd);

            // 点击菜单外 / 滚动时关闭右键菜单
            this._onDocMouseDown = (e) => {
                if (this._menuEl && !this._menuEl.contains(e.target)) this._closeMenu();
            };
            this._onDocScroll = () => this._closeMenu();
            document.addEventListener('mousedown', this._onDocMouseDown, true);
            document.addEventListener('scroll', this._onDocScroll, true);
        }

        _unbind() {
            this.root.removeEventListener('click', this._onClick);
            this.root.removeEventListener('dblclick', this._onDblClick);
            this.root.removeEventListener('contextmenu', this._onContext);
            this.root.removeEventListener('keydown', this._onKeyDown);
            this.root.removeEventListener('dragstart', this._onDragStart);
            this.root.removeEventListener('dragover', this._onDragOver);
            this.root.removeEventListener('drop', this._onDrop);
            this.root.removeEventListener('dragend', this._onDragEnd);
            document.removeEventListener('mousedown', this._onDocMouseDown, true);
            document.removeEventListener('scroll', this._onDocScroll, true);
        }

        /* ================= 内部：渲染 ================= */

        _buildIndex(nodes, parent) {
            for (const node of nodes) {
                this._byId.set(node.id, node);
                this._parentOf.set(node, parent);
                if (node.type === TYPE_DIR && node.children) this._buildIndex(node.children, node);
            }
        }

        _render() {
            if (this._destroyed) return;
            this._closeMenu();
            this._clearConfirmListener();

            this._byId.clear();
            this._parentOf.clear();
            this._buildIndex(this._model, null);

            const scrollTop = this.root.scrollTop;

            this.root.innerHTML = this._model.length
                ? this._renderNodes(this._model)
                : '<div class="ft-empty">' + escapeHtml(this.options.emptyText) + '</div>';

            this._rows.clear();
            this.root.querySelectorAll('.ft-row').forEach((row) => {
                this._rows.set(row.dataset.id, row);
            });

            this._syncRowStates();
            this.root.scrollTop = scrollTop;
        }

        _renderNodes(nodes) {
            let html = '';
            for (const node of nodes) {
                const isDir = node.type === TYPE_DIR;
                const collapsed = isDir && this._collapsed.has(node.id);
                const childrenHtml = isDir && node.children && node.children.length
                    ? this._renderNodes(node.children)
                    : '';
                html +=
                    '<div class="ft-node" data-id="' + escapeHtml(node.id) + '"' +
                    ' data-type="' + (isDir ? TYPE_DIR : TYPE_FILE) + '"' +
                    ' data-collapsed="' + (collapsed ? 'true' : 'false') + '"' +
                    (isDir ? ' aria-expanded="' + (!collapsed) + '"' : '') + '>' +
                    '<div class="ft-row" draggable="true" data-id="' + escapeHtml(node.id) + '"' +
                    ' title="' + escapeHtml(node.name) + '" role="treeitem">' +
                    '<span class="ft-chevron' + (isDir ? '' : ' ft-chevron-placeholder') + '">' + ICONS.chevron + '</span>' +
                    '<span class="ft-icon ' + (isDir ? 'ft-icon-dir' : 'ft-icon-file') + '">' + (isDir ? ICONS.folder : ICONS.file) + '</span>' +
                    '<span class="ft-name">' + escapeHtml(node.name) + '</span>' +
                    '</div>' +
                    (isDir
                        ? '<div class="ft-children"' + (collapsed ? ' hidden' : '') + '>' + childrenHtml + '</div>'
                        : '') +
                    '</div>';
            }
            return html;
        }

        _syncRowStates() {
            this.root.querySelectorAll('.ft-row').forEach((row) => {
                row.classList.toggle('selected', row.dataset.id === this._selectedId);
                row.classList.toggle('cut', row.dataset.id === this._cutId);
            });
        }

        /* ================= 内部：选中 / 展开 ================= */

        _select(node) {
            const changed = this._selectedId !== node.id;
            this._selectedId = node.id;
            this._syncRowStates();
            if (changed) {
                this._emit('select', { node: node });
                this._call('onSelect', node);
            }
        }

        _toggle(node) {
            if (node.type !== TYPE_DIR) return;
            if (this._collapsed.has(node.id)) {
                this._collapsed.delete(node.id);
            } else {
                this._collapsed.add(node.id);
            }
            this._render();
        }

        _visibleOrder() {
            const out = [];
            const walk = (nodes) => {
                for (const n of nodes) {
                    out.push(n);
                    if (n.type === TYPE_DIR && !this._collapsed.has(n.id) && n.children) walk(n.children);
                }
            };
            walk(this._model);
            return out;
        }

        _moveSelection(dir) {
            const order = this._visibleOrder();
            if (!order.length) return;
            let idx = order.findIndex((n) => n.id === this._selectedId);
            if (idx < 0) idx = -1;
            idx = Math.max(0, Math.min(order.length - 1, idx + dir));
            this._select(order[idx]);
            const row = this._rows.get(order[idx].id);
            if (row) row.scrollIntoView({ block: 'nearest' });
        }

        /* ================= 内部：鼠标事件 ================= */

        _handleClick(e) {
            if (this._editingId) return; // 重命名输入框自己处理事件
            const row = e.target.closest('.ft-row');
            if (!row) return;
            const node = this._byId.get(row.dataset.id);
            if (!node) return;
            this._select(node);
            if (e.target.closest('.ft-chevron') && node.type === TYPE_DIR) this._toggle(node);
            this.root.focus({ preventScroll: true });
        }

        _handleDblClick(e) {
            const row = e.target.closest('.ft-row');
            if (!row) return;
            const node = this._byId.get(row.dataset.id);
            if (!node) return;
            if (node.type === TYPE_DIR) {
                this._toggle(node);
            } else {
                this._emit('open', { node: node });
                this._call('onOpen', node);
            }
        }

        _handleContextMenu(e) {
            if (!this.options.showContextMenu) return;
            const row = e.target.closest('.ft-row');
            if (!row) return;
            e.preventDefault();
            e.stopPropagation();
            const node = this._byId.get(row.dataset.id);
            if (!node) return;
            this._select(node);
            this._openMenu(e.clientX, e.clientY, node);
        }

        /* ================= 内部：右键菜单 ================= */

        _openMenu(x, y, node) {
            this._closeMenu();
            const isDir = node.type === TYPE_DIR;
            const canPaste = !!this._cutId && this.options.allowMove;

            const items = [];
            if (isDir) {
                items.push({
                    label: this._collapsed.has(node.id) ? '展开' : '折叠',
                    action: () => this._toggle(node),
                });
            } else {
                items.push({
                    label: '打开',
                    action: () => {
                        this._emit('open', { node: node });
                        this._call('onOpen', node);
                    },
                });
            }
            items.push({ type: 'sep' });
            items.push({
                label: '重命名',
                disabled: !this.options.allowRename,
                action: () => this._startRename(node),
            });
            items.push({
                label: '剪切',
                disabled: !this.options.allowMove,
                action: () => this._cut(node),
            });
            items.push({
                label: '粘贴',
                disabled: !canPaste,
                action: () => this._pasteTo(node),
            });
            items.push({ type: 'sep' });
            items.push({
                label: '删除',
                danger: true,
                disabled: !this.options.allowDelete,
                action: () => this._delete(node),
            });

            // 宿主扩展项（如"在此新建文件/文件夹"）：返回 [{ label, action?, danger?, disabled? }]
            if (typeof this.options.onMenuExtra === 'function') {
                const extra = this.options.onMenuExtra(node) || [];
                if (extra.length) {
                    items.push({ type: 'sep' });
                    extra.forEach((item) => items.push(item));
                }
            }

            const menu = document.createElement('div');
            menu.className = 'ft-menu';
            items.forEach((item) => {
                if (item.type === 'sep') {
                    const sep = document.createElement('div');
                    sep.className = 'ft-menu-sep';
                    menu.appendChild(sep);
                    return;
                }
                const el = document.createElement('div');
                el.className = 'ft-menu-item' + (item.disabled ? ' disabled' : '') + (item.danger ? ' danger' : '');
                el.textContent = item.label;
                if (!item.disabled) {
                    el.addEventListener('click', () => {
                        this._closeMenu();
                        item.action();
                    });
                }
                menu.appendChild(el);
            });

            document.body.appendChild(menu);
            // 视口内钳制位置
            const mw = menu.offsetWidth;
            const mh = menu.offsetHeight;
            menu.style.left = Math.min(x, window.innerWidth - mw - 8) + 'px';
            menu.style.top = Math.min(y, window.innerHeight - mh - 8) + 'px';
            this._menuEl = menu;
        }

        _closeMenu() {
            if (this._menuEl) {
                if (this._menuEl.parentNode) this._menuEl.parentNode.removeChild(this._menuEl);
                this._menuEl = null;
            }
        }

        /* ================= 内部：重命名 ================= */

        _startRename(node) {
            if (!this.options.allowRename) return;
            const row = this._rows.get(node.id);
            if (!row) return;
            const nameEl = row.querySelector('.ft-name');
            if (!nameEl) return;

            const input = document.createElement('input');
            input.className = 'ft-rename-input';
            input.value = node.name;
            input.maxLength = 255;
            input.setAttribute('aria-label', '重命名 ' + node.name);
            nameEl.replaceWith(input);
            this._editingId = node.id;
            input.focus();
            input.select();

            const validate = () => {
                const v = input.value.trim();
                if (!v) return '名称不能为空';
                if (/[\/\\]/.test(v)) return '名称不能包含 / 或 \\';
                const siblings = this._parentOf.get(node) ? this._parentOf.get(node).children : this._model;
                if (siblings.some((s) => s !== node && s.name.toLowerCase() === v.toLowerCase())) {
                    return '同级已存在同名项';
                }
                return null;
            };

            let done = false;
            const finish = (commit) => {
                if (done) return;
                if (commit) {
                    const err = validate();
                    if (err) {
                        input.classList.add('error');
                        input.title = err;
                        input.focus();
                        return;
                    }
                    done = true;
                    this._editingId = null;
                    this._commitRename(node, input.value.trim());
                } else {
                    done = true;
                    this._editingId = null;
                    this._render();
                }
            };

            input.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') finish(true);
                else if (e.key === 'Escape') finish(false);
            });
            input.addEventListener('blur', () => finish(true));
        }

        async _commitRename(node, newName) {
            const oldName = node.name;
            node.name = newName;
            this._render(); // 乐观更新：立即反映到界面
            this._emit('rename', { node: node, oldName: oldName, newName: newName });
            const ok = await this._callHook('onRename', node, newName, oldName);
            if (!ok) {
                node.name = oldName;
                this._emit('rename-revert', { node: node, oldName: oldName, newName: newName });
                this._render();
            }
        }

        /* ================= 内部：剪切 / 粘贴 / 移动 ================= */

        _cut(node) {
            if (!this.options.allowMove) return;
            this._cutId = this._cutId === node.id ? null : node.id;
            this._syncRowStates();
        }

        _clearCut() {
            if (this._cutId) {
                this._cutId = null;
                this._syncRowStates();
            }
        }

        _pasteTo(node) {
            if (!this._cutId) return;
            const cutNode = this._byId.get(this._cutId);
            if (!cutNode) {
                this._clearCut();
                return;
            }
            const target = node.type === TYPE_DIR ? node : this._parentOf.get(node) || null;
            this._moveNode(cutNode, target);
        }

        _pasteToRoot() {
            if (!this._cutId) return;
            const cutNode = this._byId.get(this._cutId);
            if (!cutNode) {
                this._clearCut();
                return;
            }
            this._moveNode(cutNode, null);
        }

        _isAncestor(ancestor, node) {
            let cur = node;
            while (cur) {
                if (cur === ancestor) return true;
                cur = this._parentOf.get(cur) || null;
            }
            return false;
        }

        /**
         * 移动节点：乐观更新本地模型，宿主 onMove 返回 false / reject 时回滚。
         * @param {object} node        被移动的节点
         * @param {object|null} toParent  目标目录（null = 根目录）
         * @param {object} [beforeNode]   可选：插入到该节点之前（同级排序）
         */
        async _moveNode(node, toParent, beforeNode) {
            if (!this.options.allowMove) return false;
            // 不能移入自身 / 其子孙 / 非目录节点
            if (toParent && (toParent.type !== TYPE_DIR || toParent === node || this._isAncestor(node, toParent))) {
                this._clearCut();
                this._render();
                return false;
            }

            const fromParent = this._parentOf.get(node) || null;
            const fromList = fromParent ? fromParent.children : this._model;
            const fromIndex = fromList.indexOf(node);
            if (fromIndex < 0) return false;

            const toList = toParent ? toParent.children : this._model;
            let insertAt = toList.length;
            if (beforeNode && beforeNode !== node) {
                const bi = toList.indexOf(beforeNode);
                if (bi >= 0) insertAt = bi;
            }
            // 同一列表内移动且目标位置在自身之后时修正索引
            if (toList === fromList && fromIndex < insertAt) insertAt -= 1;

            fromList.splice(fromIndex, 1);
            toList.splice(insertAt, 0, node);
            this._parentOf.set(node, toParent);

            // 移入目录时自动展开，便于查看
            if (toParent && toParent.type === TYPE_DIR) this._collapsed.delete(toParent.id);

            this._clearCut();
            this._render(); // 乐观更新：立即反映到界面
            this._emit('move', { node: node, fromParent: fromParent, toParent: toParent });

            const ok = await this._callHook('onMove', node, toParent, fromParent);
            if (!ok) {
                const i2 = toList.indexOf(node);
                if (i2 >= 0) toList.splice(i2, 1);
                const backIndex = Math.min(fromIndex, fromList.length);
                fromList.splice(backIndex, 0, node);
                this._parentOf.set(node, fromParent);
                this._emit('move-revert', { node: node, fromParent: fromParent, toParent: toParent });
                this._render();
            }
            return ok;
        }

        /* ================= 内部：删除 ================= */

        _delete(node) {
            if (!this.options.allowDelete) return;
            if (this._confirmNodeId === node.id) {
                // 再次触发（如再次按 Delete）= 确认
                this._doDelete(node);
                return;
            }
            if (this.options.confirmDelete) this._showConfirm(node);
            else this._doDelete(node);
        }

        _showConfirm(node) {
            const row = this._rows.get(node.id);
            if (!row) return;
            const nameEl = row.querySelector('.ft-name');
            if (!nameEl) return;

            const bar = document.createElement('div');
            bar.className = 'ft-confirm';
            const text = document.createElement('span');
            text.className = 'ft-confirm-text';
            text.textContent = '删除 “' + node.name + '”？';
            const okBtn = document.createElement('button');
            okBtn.type = 'button';
            okBtn.className = 'ft-confirm-btn ok';
            okBtn.textContent = '删除';
            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'ft-confirm-btn';
            cancelBtn.textContent = '取消';
            bar.append(text, okBtn, cancelBtn);
            nameEl.replaceWith(bar);

            this._confirmNodeId = node.id;

            this._clearConfirmListener();
            const cancel = (e) => {
                if (!bar.contains(e.target)) this._render();
            };
            this._confirmCancelHandler = cancel;
            this.root.addEventListener('mousedown', cancel);

            const cleanup = () => this._clearConfirmListener();
            okBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                cleanup();
                this._doDelete(node);
            });
            cancelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                cleanup();
                this._render();
            });
        }

        _clearConfirmListener() {
            if (this._confirmCancelHandler) {
                this.root.removeEventListener('mousedown', this._confirmCancelHandler);
                this._confirmCancelHandler = null;
            }
            this._confirmNodeId = null;
        }

        async _doDelete(node) {
            const parent = this._parentOf.get(node) || null;
            const list = parent ? parent.children : this._model;
            const idx = list.indexOf(node);
            if (idx < 0) return;

            list.splice(idx, 1);
            if (this._selectedId === node.id) this._selectedId = null;
            if (this._cutId === node.id) this._cutId = null;

            this._render(); // 乐观更新：立即反映到界面
            this._emit('delete', { node: node, parent: parent });

            const ok = await this._callHook('onDelete', node, parent);
            if (!ok) {
                const backIndex = Math.min(idx, list.length);
                list.splice(backIndex, 0, node);
                this._emit('delete-revert', { node: node, parent: parent });
                this._render();
            }
        }

        /* ================= 内部：拖拽 ================= */

        _handleDragStart(e) {
            if (this._editingId || !this.options.allowMove) {
                e.preventDefault();
                return;
            }
            const row = e.target.closest('.ft-row');
            if (!row) {
                e.preventDefault();
                return;
            }
            const node = this._byId.get(row.dataset.id);
            if (!node) {
                e.preventDefault();
                return;
            }
            this._dragId = node.id;
            this._select(node);
            e.dataTransfer.effectAllowed = 'move';
            try {
                e.dataTransfer.setData('text/plain', node.id);
            } catch (err) { /* 某些环境禁止 setData，忽略 */ }
            this.root.querySelectorAll('.ft-row.dragging').forEach((r) => r.classList.remove('dragging'));
            requestAnimationFrame(() => {
                const r2 = this._rows.get(node.id);
                if (r2) r2.classList.add('dragging');
            });
        }

        _handleDragOver(e) {
            if (!this._dragId || !this.options.allowMove) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            this.root.querySelectorAll('.ft-row.drop-target').forEach((r) => r.classList.remove('drop-target'));
            this.root.classList.remove('drop-root');
            this._dropRow = null;

            const row = e.target.closest('.ft-row');
            if (row) {
                const target = this._byId.get(row.dataset.id);
                const dragged = this._byId.get(this._dragId);
                if (target && dragged && target !== dragged && !this._isAncestor(dragged, target)) {
                    row.classList.add('drop-target');
                    this._dropRow = row;
                }
            } else {
                this.root.classList.add('drop-root');
            }
        }

        _handleDrop(e) {
            if (!this._dragId) return;
            e.preventDefault();
            e.stopPropagation();

            const node = this._byId.get(this._dragId);
            this._dragId = null;
            this.root.querySelectorAll('.ft-row.drop-target').forEach((r) => r.classList.remove('drop-target'));
            this.root.classList.remove('drop-root');
            this._dropRow = null;

            if (!node || !this.options.allowMove) return;

            if (this._dropRow) {
                const target = this._byId.get(this._dropRow.dataset.id);
                if (!target || target === node || this._isAncestor(node, target)) return;
                if (target.type === TYPE_DIR) {
                    this._moveNode(node, target);
                } else {
                    this._moveNode(node, this._parentOf.get(target) || null, target);
                }
            } else {
                // 空白处：移到根目录（悬停在自身/子孙上时 _dropRow 为空，此处忽略）
                const rowUnder = e.target.closest('.ft-row');
                if (rowUnder) return;
                this._moveNode(node, null);
            }
        }

        _handleDragEnd() {
            this._dragId = null;
            this._dropRow = null;
            this.root.querySelectorAll('.ft-row.dragging, .ft-row.drop-target')
                .forEach((r) => r.classList.remove('dragging', 'drop-target'));
            this.root.classList.remove('drop-root');
        }

        /* ================= 内部：键盘 ================= */

        _handleKeyDown(e) {
            if (this._editingId) return; // 输入框自己处理
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;

            // 行内删除确认打开时：Enter 确认，Esc 取消
            if (this._confirmNodeId) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const n = this.getNode(this._confirmNodeId);
                    if (n) this._doDelete(n);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    this._render();
                }
                return;
            }

            const mod = e.ctrlKey || e.metaKey;

            if (mod && e.key.toLowerCase() === 'x') {
                const n = this.getSelectedNode();
                if (n) {
                    e.preventDefault();
                    this._cut(n);
                }
                return;
            }
            if (mod && e.key.toLowerCase() === 'v') {
                if (!this._cutId) return;
                e.preventDefault();
                const sel = this.getSelectedNode();
                if (sel) this._pasteTo(sel);
                else this._pasteToRoot();
                return;
            }

            switch (e.key) {
                case 'ArrowUp':
                    e.preventDefault();
                    this._moveSelection(-1);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this._moveSelection(1);
                    break;
                case 'ArrowLeft': {
                    const n = this.getSelectedNode();
                    if (n) {
                        if (n.type === TYPE_DIR && !this._collapsed.has(n.id)) {
                            this._toggle(n);
                        } else {
                            const p = this._parentOf.get(n);
                            if (p) this._select(p);
                        }
                    }
                    break;
                }
                case 'ArrowRight': {
                    const n = this.getSelectedNode();
                    if (n && n.type === TYPE_DIR) {
                        if (this._collapsed.has(n.id)) {
                            this._toggle(n);
                        } else if (n.children && n.children[0]) {
                            this._select(n.children[0]);
                        }
                    }
                    break;
                }
                case 'F2': {
                    const n = this.getSelectedNode();
                    if (n) {
                        e.preventDefault();
                        this._startRename(n);
                    }
                    break;
                }
                case 'Delete': {
                    const n = this.getSelectedNode();
                    if (n) {
                        e.preventDefault();
                        this._delete(n);
                    }
                    break;
                }
                case 'Enter': {
                    const n = this.getSelectedNode();
                    if (n) {
                        e.preventDefault();
                        if (n.type === TYPE_DIR) {
                            this._toggle(n);
                        } else {
                            this._emit('open', { node: n });
                            this._call('onOpen', n);
                        }
                    }
                    break;
                }
                case 'Escape':
                    this._clearCut();
                    break;
            }
        }

        /* ================= 内部：事件与回调 ================= */

        _emit(type, detail) {
            this.container.dispatchEvent(new CustomEvent('filetree:' + type, {
                detail: detail,
                bubbles: true,
                cancelable: true,
            }));
        }

        _call(name) {
            const fn = this.options[name];
            if (typeof fn !== 'function') return;
            const args = Array.prototype.slice.call(arguments, 1);
            try {
                fn.apply(this, args);
            } catch (err) {
                console.warn('[FileTree] 回调 ' + name + ' 抛出异常：', err);
            }
        }

        /** 编辑操作钩子：返回 false / 抛异常 / reject 视为拒绝（触发回滚） */
        async _callHook(name) {
            const fn = this.options[name];
            if (typeof fn !== 'function') return true;
            const args = Array.prototype.slice.call(arguments, 1);
            try {
                const result = await fn.apply(this, args);
                return result !== false;
            } catch (err) {
                console.warn('[FileTree] 钩子 ' + name + ' 抛出异常，视为拒绝：', err);
                return false;
            }
        }
    }

    FileTree.TYPE_FILE = TYPE_FILE;
    FileTree.TYPE_DIR = TYPE_DIR;
    FileTree.VERSION = '1.0.0';

    return FileTree;
});
