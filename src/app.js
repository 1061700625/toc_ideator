// ------------------ 状态与工具 ------------------
const STORAGE_KEY = "toc_ideator_split_v1";
const PREVIEW_NUM_KEY = "toc_preview_numbers_v1";
const DOC_TITLE_KEY = "toc_doc_title_v1";
const PREVIEW_TIP_KEY = "toc_preview_tip_v1";
const THEME_KEY = "toc_theme_v1"; // 'dark' | 'light'

function uid(){
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function makeNode(level){
  const def =
    level === 0 ? "文档标题" :
    level === 1 ? "第一章" :
    level === 2 ? "第一节" : "小节";

  return { id: uid(), level, options:[def], selected:0, children:[], collapsed:false };
}
function safeParse(str, fallback){
  try{ const v = JSON.parse(str); return v ?? fallback; }catch(e){ return fallback; }
}
function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

function nodeTitle(n){
  const s = (n.options?.[n.selected] ?? "未命名").trim();
  return s || "未命名";
}
let docTitle = (() => {
  const raw = localStorage.getItem(DOC_TITLE_KEY);
  return raw ? safeParse(raw, {
    options: ["文档标题"],
    selected: 0
  }) : {
    options: ["文档标题"],
    selected: 0
  };
})();

function toMarkdown(nodes){
  const lines = [];
  const walk = (arr) => {
    for (const n of arr){
      const prefix =
        n.level === 0 ? "#" :
        n.level === 1 ? "##" :
        n.level === 2 ? "###" : "####";
      lines.push(prefix + " " + nodeTitle(n));
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
  return lines.join("\n");
}

function toPreviewHTML(nodes, withNumbers = true){
  if (!nodes || !nodes.length){
    return `<div class="pv-empty">（暂无内容）</div>`;
  }

  const parts = [];
  const counters = [0, 0, 0]; // Lv1/Lv2/Lv3（标题 level=0 不参与编号）

  const walk = (arr) => {
    for (const raw of arr){
      const lvlRaw = Number(raw.level);

      // ---- Title：level = 0（更像“文档标题”，不编号、不缩进）----
      if (lvlRaw === 0){
        const titleHtml = `<span class="pv-title">${escapeHtml(nodeTitle(raw))}</span>`;
        parts.push(
          `<div class="pv-row pv-l1 pv-title-row"
                data-id="${escapeHtml(raw.id)}"
                data-level="0"
                style="margin-left:0px;font-size:22px;font-weight:900;display:flex;justify-content:center;text-align:center;">` +
            `${titleHtml}` +
          `</div>`
        );
        continue;
      }

      // ---- 正常章节：level = 1~3 ----
      const lvl = clamp(Number(raw.level) || 1, 1, 3);

      // 计数：本级 +1，低级清零
      counters[lvl - 1] += 1;
      for (let i = lvl; i < 3; i++) counters[i] = 0;

      const num = counters.slice(0, lvl).join(".");
      const indent = (lvl - 1) * 16;

      const numHtml = withNumbers ? `<span class="pv-num">${num}</span>` : "";
      const titleHtml = `<span class="pv-title">${escapeHtml(nodeTitle(raw))}</span>`;

      parts.push(
        `<div class="pv-row pv-l${lvl}"
              data-id="${escapeHtml(raw.id)}"
              data-level="${lvl}"
              style="margin-left:${indent}px">` +
          `${numHtml} ${titleHtml}` +
        `</div>`
      );

      if (raw.children?.length) walk(raw.children);
    }
  };

  walk(nodes);
  return parts.join("");
}


function toast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(()=>t.classList.remove("show"), 1200);
}

// 返回：{ node, parent, siblings, index }
function getContext(nodes, id, parent=null){
  for (let i = 0; i < nodes.length; i++){
    const n = nodes[i];
    if (n.id === id){
      return { node:n, parent, siblings:nodes, index:i };
    }
    const res = getContext(n.children || [], id, n);
    if (res) return res;
  }
  return null;
}


// ------------------ 数据导入/导出（JSON） ------------------
function buildExportPayload(){
  return {
    schema: "toc-ideator",
    version: 1,
    exportedAt: new Date().toISOString(),
    tree
  };
}

function exportJSONString(){
  return JSON.stringify(buildExportPayload(), null, 2);
}

function normalizeImportedTree(input){
  // 支持：直接传 tree 数组；或 {tree:[...]}；或完整导出包 {schema, version, tree}
  const src = Array.isArray(input) ? input : (input && Array.isArray(input.tree) ? input.tree : null);
  if (!src) throw new Error("导入失败：JSON 必须是数组，或包含 tree 数组。");

  const seen = new Set();

  function uniqueId(id){
    let out = (typeof id === "string" && id.trim()) ? id.trim() : uid();
    while (seen.has(out)) out = uid();
    seen.add(out);
    return out;
  }

  function normNode(obj, level){
    const n = (obj && typeof obj === "object") ? obj : {};
    const options = Array.isArray(n.options) ? n.options.map(x => (x == null ? "" : String(x))) : [];
    const cleaned = options.length ? options : ["未命名"];

    let selected = Number.isFinite(n.selected) ? Math.trunc(n.selected) : 0;
    selected = clamp(selected, 0, cleaned.length - 1);

    const node = {
      id: uniqueId(n.id),
      level,
      options: cleaned,
      selected,
      children: [],
      collapsed: !!n.collapsed
    };

    if (level < 3 && Array.isArray(n.children)) {
      node.children = n.children.map(c => normNode(c, level + 1));
    } else {
      node.children = [];
    }
    return node;
  }

  const out = src.map(x => normNode(x, 1));
  return out.length ? out : [makeNode(1)];
}

function setImportMessage(text, isError=false){
  if (!importMsg) return;
  importMsg.textContent = text || "";
  importMsg.classList.toggle("error", !!isError);
}

function selectDataTab(tab){
  const isExport = tab === "export";
  document.getElementById("tabExport")?.classList.toggle("active", isExport);
  document.getElementById("tabImport")?.classList.toggle("active", !isExport);
  document.getElementById("panelExport")?.classList.toggle("hidden", !isExport);
  document.getElementById("panelImport")?.classList.toggle("hidden", isExport);
}

function openDataDialog(tab){
  if (!dataDlg) return;
  selectDataTab(tab);
  if (tab === "export") {
    if (jsonText) jsonText.value = exportJSONString();
  } else {
    setImportMessage("导入会覆盖当前目录。建议先导出备份。");
  }
  dataDlg.showModal();
}

// ------------------ 初始化 ------------------
let tree = (() => {
  const raw = localStorage.getItem(STORAGE_KEY);
  const t = raw ? safeParse(raw, [makeNode(0), makeNode(1)]) : [makeNode(0), makeNode(1)];
  // 兜底：如果导入/旧数据没有标题，就补一个
  if (!t.length || t[0].level !== 0) t.unshift(makeNode(0));
  return t;
})();

let showPreviewNumbers = (() => {
  const v = localStorage.getItem(PREVIEW_NUM_KEY);
  if (v === null) return true;     // 默认开启
  return v === "1";
})();

let showPreviewTips = (() => {
  const v = localStorage.getItem(PREVIEW_TIP_KEY);
  if (v === null) return true;   // 默认开启
  return v === "1";
})();

// ------------------ 主题（深色/浅色） ------------------
function getInitialTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "dark" || saved === "light") return saved;
  // 未保存时：跟随系统
  try{
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }catch(_){
    return "light";
  }
}

function applyTheme(theme){
  const isDark = theme === "dark";
  document.body.classList.toggle("theme-dark", isDark);
  localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");

  // 同步开关 UI（以及文案）
  const chk = document.getElementById("chkTheme");
  if (chk) chk.checked = isDark;
  const txt = chk?.closest?.("label")?.querySelector?.(".toggle-text");
  if (txt) txt.textContent = isDark ? "深色" : "浅色";
}

// 页面初始化时先应用一次主题
applyTheme(getInitialTheme());

function save(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
  localStorage.setItem(DOC_TITLE_KEY, JSON.stringify(docTitle));
}

// ------------------ DOM ------------------
const elTree = document.getElementById("tree");
const elPreview = document.getElementById("preview");
const elRootDrop = document.getElementById("rootDrop");

// 候选标题 dialog
const dlg = document.getElementById("dlg");
const dlgTitle = document.getElementById("dlgTitle");
const dlgSub = document.getElementById("dlgSub");
const optList = document.getElementById("optList");
const newOpt = document.getElementById("newOpt");

// Markdown dialog
const mdDlg = document.getElementById("mdDlg");
const mdText = document.getElementById("mdText");

// 数据导入/导出 dialog
const dataDlg = document.getElementById("dataDlg");
const jsonText = document.getElementById("jsonText");
const jsonFile = document.getElementById("jsonFile");
const jsonImportText = document.getElementById("jsonImportText");
const importMsg = document.getElementById("importMsg");

// 弹窗编辑中节点 id
let editingId = null;

// 拖拽状态
let dragId = null;
let dragLevel = null;
let lastHoverRow = null;

// 深色/浅色 开关
const elChkTheme = document.getElementById("chkTheme");
if (elChkTheme){
  // 这里再同步一次 UI（防止 DOM 还没就绪时 applyTheme 没更新到控件）
  elChkTheme.checked = localStorage.getItem(THEME_KEY) === "dark";
  applyTheme(elChkTheme.checked ? "dark" : "light");

  elChkTheme.onchange = () => {
    applyTheme(elChkTheme.checked ? "dark" : "light");
  };
}

const elChkNumbers = document.getElementById("chkNumbers");
if (elChkNumbers){
  elChkNumbers.checked = showPreviewNumbers;
  elChkNumbers.onchange = () => {
    showPreviewNumbers = elChkNumbers.checked;
    localStorage.setItem(PREVIEW_NUM_KEY, showPreviewNumbers ? "1" : "0");
    render();
  };
}

const elChkTip = document.getElementById("chkTip");
if (elChkTip){
  elChkTip.checked = showPreviewTips;
  elChkTip.onchange = () => {
    showPreviewTips = elChkTip.checked;
    localStorage.setItem(PREVIEW_TIP_KEY, showPreviewTips ? "1" : "0");
    if (!showPreviewTips) hidePreviewTip(); // 关掉时立刻隐藏
  };
}

// ------------------ 渲染 ------------------
function render(){
  elTree.innerHTML = "";
  for (const n of tree){
    elTree.appendChild(renderNode(n, 0, null));
  }
  elPreview.innerHTML = toPreviewHTML(tree, showPreviewNumbers);
}

function renderNode(node, depth, parentId){
  const wrap = document.createElement("div");

  const isTitle = node.level === 0;

  const row = document.createElement("div");
  row.className = "row";
  // 标题行固定不缩进；其他按原逻辑缩进
  row.style.marginLeft = (isTitle ? 0 : depth * 16) + "px";
  row.dataset.id = node.id;
  row.dataset.level = String(node.level);
  row.dataset.parent = parentId ?? "";

  // 双击行：快速编辑当前显示的标题（打开“候选”弹窗并定位到当前选中项）
  row.title = "双击编辑当前标题";
  row.addEventListener("dblclick", (e) => {
    const t = e.target;
    // 双击在按钮/下拉/输入框等控件上时不触发（避免误触）
    if (t && (t.closest("button") || t.closest("select") || t.closest("input") || t.closest("textarea") || t.closest("a"))) return;
    openOptionDialog(node.id, "selected");
  });

  // 折叠按钮（标题不需要折叠）
  const btnCollapse = document.createElement("button");
  btnCollapse.className = "icon-btn";
  btnCollapse.title = node.collapsed ? "展开" : "折叠";
  btnCollapse.textContent = node.collapsed ? "▸" : "▾";
  btnCollapse.onclick = () => {
    const ctx = getContext(tree, node.id);
    if (!ctx) return;
    ctx.node.collapsed = !ctx.node.collapsed;
    save(); render();
  };
  if (isTitle){
    btnCollapse.disabled = true;
    btnCollapse.style.visibility = "hidden";
  }

  // 拖拽把手（标题固定在最上面：不允许拖拽）
  const dragHandle = document.createElement("button");
  dragHandle.className = "drag-handle";
  dragHandle.type = "button";
  dragHandle.title = "拖拽排序";
  dragHandle.textContent = "⠿";
  dragHandle.draggable = !isTitle;

  if (!isTitle){
    dragHandle.addEventListener("dragstart", (e) => {
      dragId = node.id;
      dragLevel = node.level;
      row.classList.add("dragging");
      clearDropClasses();

      if (dragLevel === 1) elRootDrop.classList.add("show");

      e.dataTransfer.setData("text/plain", dragId);
      e.dataTransfer.effectAllowed = "move";
    });

    dragHandle.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      clearDropClasses();
      dragId = null;
      dragLevel = null;
      elRootDrop.classList.remove("show", "active");
    });
  } else {
    dragHandle.style.visibility = "hidden";
  }

  // 等级标
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = isTitle ? "Title" : ("Lv" + node.level);

  // 候选下拉
  const sel = document.createElement("select");
  (node.options || []).forEach((opt, i) => {
    const op = document.createElement("option");
    op.value = String(i);
    op.textContent = opt || "（空）";
    sel.appendChild(op);
  });
  sel.value = String(node.selected);
  sel.onchange = (e) => {
    const idx = Number(e.target.value);
    const ctx = getContext(tree, node.id);
    if (!ctx) return;
    ctx.node.selected = clamp(idx, 0, (ctx.node.options?.length || 1) - 1);
    save(); render();
  };

  // 管理候选
  const btnOptions = document.createElement("button");
  btnOptions.textContent = "候选";
  btnOptions.title = "管理候选标题";
  btnOptions.onclick = () => openOptionDialog(node.id, "new");

  // 新增同级（标题不允许新增同级）
  const btnAddSibling = document.createElement("button");
  btnAddSibling.textContent = "+ 同级";
  btnAddSibling.title = "新增同级章节";
  btnAddSibling.disabled = isTitle;
  btnAddSibling.onclick = () => {
    if (isTitle) return;
    const ctx = getContext(tree, node.id);
    if (!ctx) return;
    ctx.siblings.splice(ctx.index + 1, 0, makeNode(node.level));
    save(); render();
  };

  // 新增下级（标题不允许；Lv3 也不允许）
  const btnAddChild = document.createElement("button");
  btnAddChild.textContent = "+ 下级";
  btnAddChild.title = "新增下级章节";
  btnAddChild.disabled = isTitle || node.level >= 3;
  btnAddChild.onclick = () => {
    if (isTitle || node.level >= 3) return;
    const ctx = getContext(tree, node.id);
    if (!ctx) return;
    ctx.node.children = ctx.node.children || [];
    ctx.node.children.push(makeNode(node.level + 1));
    ctx.node.collapsed = false;
    save(); render();
  };

  // 删除（标题不允许删除）
  const btnDel = document.createElement("button");
  btnDel.className = "btn-danger";
  btnDel.textContent = "删除";
  btnDel.title = "删除该章节";
  btnDel.disabled = isTitle;
  btnDel.onclick = () => {
    if (isTitle) return;
    const ctx = getContext(tree, node.id);
    if (!ctx) return;
    ctx.siblings.splice(ctx.index, 1);
    if (!tree.length) tree = [makeNode(1)];
    save(); render();
  };
  if (isTitle){
    btnDel.style.visibility = "hidden";
  }

  row.appendChild(btnCollapse);
  row.appendChild(dragHandle);
  row.appendChild(badge);
  row.appendChild(sel);
  row.appendChild(btnOptions);
  row.appendChild(btnAddSibling);
  row.appendChild(btnAddChild);
  row.appendChild(btnDel);

  // 标题行不参与拖拽落点逻辑
  if (!isTitle){
    attachRowDnD(row);
  }

  wrap.appendChild(row);

  // 子节点渲染（标题不应有 children；非标题按原逻辑）
  if (!isTitle && !node.collapsed && node.children?.length){
    const childrenBox = document.createElement("div");
    childrenBox.style.marginTop = "8px";
    childrenBox.style.display = "flex";
    childrenBox.style.flexDirection = "column";
    childrenBox.style.gap = "10px";
    for (const c of node.children){
      childrenBox.appendChild(renderNode(c, depth + 1, node.id));
    }
    wrap.appendChild(childrenBox);
  }

  return wrap;
}

// ------------------ 预览 Hover：显示候选标题浮层 ------------------
const previewTip = (() => {
  const el = document.createElement("div");
  el.id = "previewTip";
  el.className = "preview-tip hidden";
  document.body.appendChild(el);
  return el;
})();

function buildOptionsHTML(node){
  const opts = Array.isArray(node?.options) ? node.options : [];
  const sel = Number.isFinite(node?.selected) ? node.selected : 0;

  if (!opts.length) return `<div class="pt-empty">（无候选）</div>`;

  return opts.map((t, i) => {
    const safe = escapeHtml(String(t ?? ""));
    const cls = i === sel ? "pt-item active" : "pt-item";
    const tag = i === sel ? `<span class="pt-tag">展示中</span>` : "";
    return `<div class="${cls}">${safe}${tag}</div>`;
  }).join("");
}

function showPreviewTipForId(id, anchorRect){
  const ctx = getContext(tree, id);
  if (!ctx?.node) return;

  const opts = Array.isArray(ctx.node.options) ? ctx.node.options : [];
  // 只有 0/1 个候选：不显示浮层
  if (opts.length <= 1) {
    hidePreviewTip();
    return;
  }

  previewTip.innerHTML =
    `<div class="pt-title">${ctx.node.options?.length || 0} 个候选标题</div>` +
    `<div class="pt-list">${buildOptionsHTML(ctx.node)}</div>`;

  // 默认放在条目右侧；如果右侧空间不够就放左侧
  const gap = 10;
  previewTip.classList.remove("hidden");

  // 先测量 tooltip 宽高
  const tipRect = previewTip.getBoundingClientRect();

  let left = anchorRect.right + gap;
  let top = anchorRect.top;

  // 右侧不够：压回屏幕内（但仍然是“右侧策略”）
  left = Math.min(left, window.innerWidth - 8 - tipRect.width);
  left = Math.max(8, left);

  // 下方超出：向上挪
  if (top + tipRect.height > window.innerHeight - 8){
    top = Math.max(8, window.innerHeight - 8 - tipRect.height);
  }

  previewTip.style.left = left + "px";
  previewTip.style.top = top + "px";
}

function hidePreviewTip(){
  previewTip.classList.add("hidden");
}

function positionPreviewTipAtMouse(clientX, clientY){
  if (previewTip.classList.contains("hidden")) return;

  const gap = 12; // 鼠标到浮层的间距（右下角）
  const tipRect = previewTip.getBoundingClientRect();

  // 默认：鼠标右侧 + 下方
  let left = clientX + gap;
  let top  = clientY + gap;

  // 右侧超出：压回屏幕内（仍然优先右侧策略）
  if (left + tipRect.width > window.innerWidth - 8){
    left = window.innerWidth - 8 - tipRect.width;
  }
  // 下方超出：压回屏幕内
  if (top + tipRect.height > window.innerHeight - 8){
    top = window.innerHeight - 8 - tipRect.height;
  }

  // 最小边距
  left = Math.max(8, left);
  top  = Math.max(8, top);

  previewTip.style.left = left + "px";
  previewTip.style.top  = top + "px";
}


// 事件委托：在预览容器上监听 hover
let raf = 0;
let lastMouse = { x: 0, y: 0 };

if (elPreview){
  elPreview.addEventListener("mousemove", (e) => {
    if (!showPreviewTips) { hidePreviewTip(); return; }

    lastMouse.x = e.clientX;
    lastMouse.y = e.clientY;
    const row = e.target.closest?.(".pv-row");
    if (!row) { hidePreviewTip(); return; }

    const id = row.dataset.id;
    if (!id) { hidePreviewTip(); return; }

    // 找到节点，看是否需要显示（候选<=1 不显示）
    const ctx = getContext(tree, id);
    const opts = Array.isArray(ctx?.node?.options) ? ctx.node.options : [];
    if (!ctx?.node || opts.length <= 1) { hidePreviewTip(); return; }

    // 同一条目：只做位置跟随，不重建内容
    if (previewTip.dataset.currentId !== id || previewTip.classList.contains("hidden")){
      previewTip.dataset.currentId = id;

      previewTip.innerHTML =
        `<div class="pt-title">候选标题（${opts.length}）</div>` +
        `<div class="pt-list">${buildOptionsHTML(ctx.node)}</div>`;

      previewTip.classList.remove("hidden");
    }

    // 用 rAF 节流跟随鼠标（更顺滑）
    if (!raf){
      raf = requestAnimationFrame(() => {
        raf = 0;
        positionPreviewTipAtMouse(lastMouse.x, lastMouse.y);
      });
    }
  });

  elPreview.addEventListener("mouseleave", () => {
    previewTip.dataset.currentId = "";
    hidePreviewTip();
  });

  window.addEventListener("scroll", hidePreviewTip, true);
  window.addEventListener("resize", hidePreviewTip);
}

// ------------------ 拖拽排序逻辑 ------------------
function clearDropClasses(){
  if (lastHoverRow){
    lastHoverRow.classList.remove("drop-before", "drop-after", "drop-into");
    lastHoverRow = null;
  }
}

function attachRowDnD(row){
  row.addEventListener("dragover", (e) => {
    if (!dragId) return;

    const targetId = row.dataset.id;
    if (!targetId || targetId === dragId) return;

    const targetLevel = Number(row.dataset.level);

    const ctxDrag = getContext(tree, dragId);
    const ctxTarget = getContext(tree, targetId);
    if (!ctxDrag || !ctxTarget) return;

    let mode = null; // 'before' | 'after' | 'into'

    // A) 同级排序（同 parent、同 level）
    if (targetLevel === dragLevel && (ctxDrag.parent?.id ?? null) === (ctxTarget.parent?.id ?? null)){
      const rect = row.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      mode = (e.clientY < mid) ? "before" : "after";
    }
    // B) 放入上一级（dragLevel = targetLevel + 1）
    else if (targetLevel === dragLevel - 1) {
      mode = "into";
    } else {
      clearDropClasses();
      return;
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    clearDropClasses();
    lastHoverRow = row;
    if (mode === "before") row.classList.add("drop-before");
    if (mode === "after") row.classList.add("drop-after");
    if (mode === "into") row.classList.add("drop-into");
    row.dataset.dropMode = mode;
  });

  row.addEventListener("dragleave", (e) => {
    if (e.relatedTarget && row.contains(e.relatedTarget)) return;
    if (lastHoverRow === row) clearDropClasses();
  });

  row.addEventListener("drop", (e) => {
    if (!dragId) return;
    e.preventDefault();

    const targetId = row.dataset.id;
    const mode = row.dataset.dropMode;
    clearDropClasses();

    if (!targetId || targetId === dragId) return;

    const ctxDrag = getContext(tree, dragId);
    const ctxTarget = getContext(tree, targetId);
    if (!ctxDrag || !ctxTarget) return;

    if (mode === "before" || mode === "after"){
      const sameParent = (ctxDrag.parent?.id ?? null) === (ctxTarget.parent?.id ?? null);
      const sameLevel = ctxDrag.node.level === ctxTarget.node.level;
      if (!sameParent || !sameLevel) return;

      const list = ctxDrag.siblings;
      const from = ctxDrag.index;
      let to = ctxTarget.index + (mode === "after" ? 1 : 0);
      if (from < to) to -= 1;

      const [item] = list.splice(from, 1);
      list.splice(to, 0, item);

      save(); render();
      return;
    }

    if (mode === "into"){
      if (ctxTarget.node.level !== ctxDrag.node.level - 1) return;

      const [item] = ctxDrag.siblings.splice(ctxDrag.index, 1);
      ctxTarget.node.children = ctxTarget.node.children || [];
      ctxTarget.node.children.push(item);
      ctxTarget.node.collapsed = false;

      if (!tree.length) tree = [makeNode(1)];

      save(); render();
      return;
    }
  });
}

// 根目录 drop（仅允许一级拖到 root 空白处 -> 移到末尾）
elTree.addEventListener("dragover", (e) => {
  if (!dragId || dragLevel !== 1) return;

  const inRow = e.target.closest && e.target.closest(".row");
  if (inRow) return;

  e.preventDefault();
  elRootDrop.classList.add("show", "active");
});

elTree.addEventListener("dragleave", (e) => {
  if (!dragId || dragLevel !== 1) return;
  if (e.relatedTarget && elTree.contains(e.relatedTarget)) return;
  elRootDrop.classList.remove("active");
});

elTree.addEventListener("drop", (e) => {
  if (!dragId || dragLevel !== 1) return;

  const inRow = e.target.closest && e.target.closest(".row");
  if (inRow) return;

  e.preventDefault();
  elRootDrop.classList.remove("active");

  const ctxDrag = getContext(tree, dragId);
  if (!ctxDrag) return;

  const [item] = ctxDrag.siblings.splice(ctxDrag.index, 1);
  tree.push(item);

  save(); render();
});

// ------------------ 候选标题弹窗 ------------------
function openOptionDialog(nodeId, focusMode = "new"){
  editingId = nodeId;
  const ctx = getContext(tree, nodeId);
  if (!ctx) return;

  dlgTitle.textContent = `管理候选标题（Lv${ctx.node.level}）`;
  dlgSub.textContent = `已选：${nodeTitle(ctx.node)} · 候选数：${ctx.node.options?.length || 0}`;
  newOpt.value = "";

  renderOptionList();

  if (typeof dlg.showModal === "function") dlg.showModal();
  else alert("你的浏览器不支持 <dialog>，请换 Chrome/Edge/Firefox。");

  setTimeout(() => {
    const c = getContext(tree, editingId);
    if (!c) return newOpt?.focus();
    if (focusMode === "selected") {
      const idx = Number.isFinite(c.node.selected) ? c.node.selected : 0;
      const input = optList?.querySelector(`input[type="text"][data-idx="${idx}"]`);
      if (input) { input.focus(); input.select(); return; }
    }
    newOpt?.focus();
  }, 60);
}

function renderOptionList(){
  const ctx = getContext(tree, editingId);
  if (!ctx) return;
  optList.innerHTML = "";

  const n = ctx.node;

  (n.options || []).forEach((opt, idx) => {
    const row = document.createElement("div");
    row.className = "opt-row";

    const radioWrap = document.createElement("label");
    radioWrap.className = "radio";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "selectedOpt";
    radio.checked = idx === n.selected;
    radio.onchange = () => {
      const c = getContext(tree, editingId);
      if (!c) return;
      c.node.selected = idx;
      save(); render();
      renderOptionList();
      dlgSub.textContent = `已选：${nodeTitle(c.node)} · 候选数：${c.node.options?.length || 0}`;
    };

    const radioText = document.createElement("span");
    radioText.textContent = (idx === n.selected) ? "展示中" : "展示";
    radioWrap.appendChild(radio);
    radioWrap.appendChild(radioText);

    const input = document.createElement("input");
    input.type = "text";
    input.value = opt;
    input.oninput = (e) => {
      const v = e.target.value;
      const c = getContext(tree, editingId);
      if (!c) return;
      c.node.options[idx] = v;
      save(); render();
      dlgSub.textContent = `已选：${nodeTitle(c.node)} · 候选数：${c.node.options?.length || 0}`;
    };
    input.dataset.idx = String(idx);

    const del = document.createElement("button");
    del.className = "btn-danger";
    del.textContent = "删";
    del.title = "删除该候选";
    del.disabled = (n.options || []).length <= 1;
    del.onclick = () => {
      const c = getContext(tree, editingId);
      if (!c) return;

      c.node.options.splice(idx, 1);
      if (!c.node.options.length) c.node.options = ["未命名"];

      c.node.selected = clamp(c.node.selected, 0, c.node.options.length - 1);
      save(); render();
      renderOptionList();
      dlgSub.textContent = `已选：${nodeTitle(c.node)} · 候选数：${c.node.options?.length || 0}`;
    };

    row.appendChild(radioWrap);
    row.appendChild(input);
    row.appendChild(del);
    optList.appendChild(row);
  });
}

document.getElementById("btnAddOpt").onclick = () => {
  const v = (newOpt.value || "").trim();
  if (!v) return;

  const ctx = getContext(tree, editingId);
  if (!ctx) return;

  ctx.node.options = ctx.node.options || [];
  ctx.node.options.push(v);
  save(); render();

  newOpt.value = "";
  renderOptionList();
  dlgSub.textContent = `已选：${nodeTitle(ctx.node)} · 候选数：${ctx.node.options?.length || 0}`;
  newOpt.focus();
};

newOpt.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("btnAddOpt").click();
});

document.getElementById("btnClose").onclick = () => {
  dlg.close();
  editingId = null;
};

// ------------------ Markdown 弹窗 ------------------
function openMarkdownDialog(markdown){
  mdText.value = markdown || "";
  if (typeof mdDlg.showModal === "function") mdDlg.showModal();
  else alert(mdText.value);
  setTimeout(() => {
    mdText.focus();
    mdText.select();
  }, 60);
}

document.getElementById("btnMdClose").onclick = () => mdDlg.close();

document.getElementById("btnMdCopy").onclick = async () => {
  const text = mdText.value || "";
  try{
    await navigator.clipboard.writeText(text);
    toast("已复制");
  }catch(_){
    // fallback：让用户手动复制
    mdText.focus();
    mdText.select();
    toast("请手动复制");
  }
};

// ------------------ 顶部按钮 ------------------
document.getElementById("btnAddRoot").onclick = () => {
  tree.push(makeNode(1));
  save(); render();
};

document.getElementById("btnReset").onclick = () => {
  tree = [makeNode(1)];
  localStorage.removeItem(STORAGE_KEY);
  save(); render();
  toast("已重置");
};

// 点击复制：先复制，再弹出 Markdown
document.getElementById("btnCopy").onclick = async () => {
  const text = toMarkdown(tree);

  let copied = false;
  try{
    await navigator.clipboard.writeText(text);
    copied = true;
    toast("已复制");
  }catch(e){
    // fallback：不强求复制成功，弹窗里给手动复制
    toast("复制受限，已弹出 Markdown");
  }

  openMarkdownDialog(text);

  if (!copied) {
    // 尝试传统 execCommand（有些环境可用）
    try{
      mdText.focus();
      mdText.select();
      document.execCommand("copy");
      toast("已复制（兼容模式）");
    }catch(_){}
  }
};


// ------------------ 导入/导出 事件 ------------------
document.getElementById("btnExport")?.addEventListener("click", () => openDataDialog("export"));
document.getElementById("btnImport")?.addEventListener("click", () => openDataDialog("import"));
document.getElementById("btnDataClose")?.addEventListener("click", () => dataDlg?.close());

document.getElementById("tabExport")?.addEventListener("click", () => {
  selectDataTab("export");
  if (jsonText) jsonText.value = exportJSONString();
});

document.getElementById("tabImport")?.addEventListener("click", () => {
  selectDataTab("import");
  setImportMessage("导入会覆盖当前目录。建议先导出备份。");
});

document.getElementById("btnJsonCopy")?.addEventListener("click", async () => {
  const text = exportJSONString();
  if (jsonText) jsonText.value = text;
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制 JSON");
  } catch (_) {
    toast("复制受限");
  }
});

document.getElementById("btnShare")?.addEventListener("click", async () => {
  const payload = buildExportPayload(); // 你已有:contentReference[oaicite:6]{index=6}
  try{
    toast("生成中…");
    const res = await fetch("./save.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const out = await res.json().catch(() => null);
    if (!res.ok || !out?.ok || !out?.url) {
      throw new Error(out?.msg || ("HTTP " + res.status));
    }

    const link = new URL(out.url, location.href).toString();

    try {
      await navigator.clipboard.writeText(link);
      toast("分享链接已复制");
      // 也可以顺便弹一下，方便看见
      window.prompt("分享链接（已复制）：", link);
    } catch (_) {
      window.prompt("分享链接：", link);
      toast("复制受限，已弹出链接");
    }
  } catch (e) {
    console.error(e);
    toast("分享失败");
    alert("分享失败：" + (e?.message || e));
  }
});


document.getElementById("btnJsonDownload")?.addEventListener("click", () => {
  const text = exportJSONString();
  if (jsonText) jsonText.value = text;
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const a = document.createElement("a");
  const ts = new Date().toISOString().replaceAll(":", "-");
  a.href = URL.createObjectURL(blob);
  a.download = `toc-ideator-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("已下载");
});

document.getElementById("btnUseFile")?.addEventListener("click", async () => {
  const f = jsonFile?.files?.[0];
  if (!f) {
    setImportMessage("请先选择一个 .json 文件。", true);
    return;
  }
  try {
    const text = await f.text();
    if (jsonImportText) jsonImportText.value = text;
    setImportMessage("文件已读取到文本框。请确认后点击“应用导入”。");
  } catch (e) {
    setImportMessage("读取文件失败。", true);
  }
});

document.getElementById("btnApplyImport")?.addEventListener("click", () => {
  const text = (jsonImportText?.value || "").trim();
  if (!text) {
    setImportMessage("请粘贴 JSON，或先读取文件。", true);
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    setImportMessage("JSON 解析失败：请检查格式。", true);
    return;
  }

  let normalized;
  try {
    normalized = normalizeImportedTree(parsed);
  } catch (e) {
    setImportMessage(e?.message || "导入失败：数据结构不符合要求。", true);
    return;
  }

  const ok = window.confirm("导入会覆盖当前目录。确定继续吗？");
  if (!ok) return;

  tree = normalized;
  save();
  render();
  setImportMessage("导入成功 ✅");
  toast("已导入");
});

// 首次渲染
render();
