/*!
 * k4godot - Kitten4(.bcm4) -> Godot 转换器
 * 核心模块：项目解析 + 积木反编译 -> 中间表示(IR)
 *
 * 该文件不依赖任何宿主 API（无 fs / 无 DOM），可直接在 Node 与浏览器中运行。
 *
 * 数据来源（已核对 K4 Ultra 打包产物 resources/app/build/kitten.822d814413fb10654fde.js）：
 *   - workspace 序列化格式:  Blockly.json.workspace_to_json  =>  {blocks, connections, comments}
 *     每个 block: {type,id,is_shadow,collapsed,disabled,deletable,movable,editable,visible,
 *                  location,shadows,fields,field_constraints,field_extra_attr,comment,
 *                  mutation,parent_id,is_output}
 *   - connections[源块id][目标块id] = {type:"next"}                (语句/socket 连接)
 *   - connections[父块id][子块id]   = {type:"input",input_name:"IF0"} (值输入连接)
 *   - shadows[输入名] = '<shadow type="math_number" ...><field name="NUM">3</field></shadow>'
 *   - controls_if 变异: <mutation elseif="n" else="1"></mutation>，输入名 IF0/DO0/IF1/DO1/.../ELSE
 *
 * 由于上述多来源交叉验证的存在，本文件在无法运行 Node 的环境下也保持了可静态审查的结构。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports && typeof K4_BUNDLED === 'undefined') {
    module.exports = factory(require('./blocks.js'));
  } else {
    // 打包环境（dist/k4tools.js）或浏览器：同一作用域里已有其它模块
    var blocksNS = (typeof K4_BLOCKS !== 'undefined') ? K4_BLOCKS
      : ((root && root.K4 && root.K4.blocks) || null);
    if (root && root.K4) root.K4.core = factory(blocksNS);
  }
})(typeof globalThis !== 'undefined' ? globalThis
  : (typeof self !== 'undefined' ? self : this), function (BLOCKS) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* 基础工具                                                            */
  /* ------------------------------------------------------------------ */

  function isObj(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function attrOf(xml, name) {
    if (!xml) return null;
    var m = new RegExp(name + '\\s*=\\s*"([^"]*)"').exec(xml);
    return m ? m[1] : null;
  }

  function fieldOf(xml, name) {
    if (!xml) return null;
    var re = new RegExp('<field[^>]*name\\s*=\\s*"' + name + '"[^>]*>([\\s\\S]*?)</field>');
    var m = re.exec(xml);
    return m ? m[1] : null;
  }

  function shadowType(xml) {
    return attrOf(xml, 'type');
  }

  /** 影子元素自己的 id —— 它指向**同一个造型选择器对应的真实块**（见 shadowValue） */
  function shadowId(xml) {
    return attrOf(xml, 'id');
  }

  /* ------------------------------------------------------------------ */
  /* BlockModel：把 {blocks, connections} 变成可遍历的图                  */
  /* ------------------------------------------------------------------ */

  function BlockModel(blockData) {
    var data = blockData || {};
    this.blocks = isObj(data.blocks) ? data.blocks : {};
    this.connections = isObj(data.connections) ? data.connections : {};
    this.comments = isObj(data.comments) ? data.comments : {};

    // parentOf[childId] = {parentId, kind:'next'|'input', inputName}
    var parentOf = {};
    var keys = Object.keys(this.connections);
    for (var i = 0; i < keys.length; i++) {
      var from = keys[i];
      var inner = this.connections[from];
      if (!isObj(inner)) continue;
      var targets = Object.keys(inner);
      for (var j = 0; j < targets.length; j++) {
        var to = targets[j];
        var info = inner[to] || {};
        parentOf[to] = {
          parentId: from,
          kind: info.type === 'next' ? 'next' : 'input',
          inputName: info.input_name || null,
          raw: info
        };
      }
    }
    this.parentOf = parentOf;

    // nextOf[blockId] = childBlockId  （语句顺序）
    this.nextOf = {};
    for (var k = 0; k < keys.length; k++) {
      var f = keys[k];
      var inn = this.connections[f];
      if (!isObj(inn)) continue;
      var ts = Object.keys(inn);
      for (var t = 0; t < ts.length; t++) {
        if ((inn[ts[t]] || {}).type === 'next') {
          this.nextOf[f] = ts[t];
        }
      }
    }

    // ★parent_id -> [子块] 索引★（按 this.blocks 的键顺序）
    //   一次性建好，供 input() 的「退化到 parent_id」路径与 collectSpareTexts 的 DFS 复用。
    //   以前这两处每调用一次就 Object.keys(this.blocks) 全表扫描（3 万块 → 每次 3 万次比较），
    //   大型工程（PICKCAT斗地主：29805 块）会退化成 O(n²)，转换跑几十分钟都出不来。
    this.childrenByParent = {};
    var allIds = Object.keys(this.blocks);
    for (var z = 0; z < allIds.length; z++) {
      var cb = this.blocks[allIds[z]];
      if (!cb || cb.is_shadow === true) continue;
      var pid = cb.parent_id;
      if (pid === null || pid === undefined) continue;
      var bucket = this.childrenByParent[pid];
      if (!bucket) { bucket = []; this.childrenByParent[pid] = bucket; }
      bucket.push(cb);
    }
  }

  BlockModel.prototype.get = function (id) {
    return this.blocks[id] || null;
  };

  BlockModel.prototype.typeOf = function (id) {
    var b = this.blocks[id];
    return b ? b.type : null;
  };

  /** 该块是否是被别的块“装入”的（即不是顶层块） */
  BlockModel.prototype.isNested = function (id) {
    return Object.prototype.hasOwnProperty.call(this.parentOf, id);
  };

  BlockModel.prototype.nextId = function (id) {
    return this.nextOf[id] || null;
  };

  /** 值输入：返回 {kind:'block',block} | {kind:'shadow',shadow} | {kind:'rawshadow',text} | null */
  BlockModel.prototype.input = function (blockId, inputName) {
    // 1) 由 connections 反查
    //    ★直接索引，不要全表扫描★：原来写的是「Object.keys(this.connections) +
    //    逐项比对 keys[i] !== blockId」，语义上等价于 this.connections[blockId]，
    //    但代价是 O(连接数) 且每次都重建一个几万元素的数组 —— 大型工程下 input()
    //    被调用几十万次，整体退化成 O(n²)。
    var inner = this.connections[blockId];
    if (isObj(inner)) {
      var ts = Object.keys(inner);
      for (var j = 0; j < ts.length; j++) {
        var info = inner[ts[j]] || {};
        if (info.type !== 'next' && info.input_name === inputName) {
          return { kind: 'block', id: ts[j], block: this.blocks[ts[j]] || null };
        }
      }
    }
    var b = this.blocks[blockId];

    // 2) 退化到 parent_id（K4 在值输入上也会写 parent_id）
    //    关键：只有当本块「没有任何 input 类连接」时才允许退化。
    //    否则「语句输入」的孩子（如 DO0 里的积木）会因为 parent_id 指向本块，
    //    被误判成本块某个值输入的取值，从而污染表达式解析。
    var hasInputRows = false;
    var own = this.connections[blockId];
    if (isObj(own)) {
      var oks = Object.keys(own);
      for (var q = 0; q < oks.length; q++) {
        var oi = own[oks[q]] || {};
        if (oi.type !== 'next') { hasInputRows = true; break; }
      }
    }
    if (b && !hasInputRows) {
      // ★用预建索引，避免每次全表扫描 this.blocks★（语义同原实现，顺序也一致）
      var cands0 = this.childrenByParent[blockId];
      if (cands0) {
        for (var m = 0; m < cands0.length; m++) {
          var cand = cands0[m];
          var owner = this.parentOf[cand.id];
          if (!owner) return { kind: 'block', id: cand.id, block: cand };
        }
      }
    }
    // 3) shadows 定义里的 XML
    if (b && isObj(b.shadows) && b.shadows[inputName]) {
      var xml = b.shadows[inputName];
      // ★关键：影子块的「当前值」K4 会**另外存一份**在 blocks[影子id] 里★
      //   shadows 的 XML 只是**创建时的默认值**，用户改过之后就不再更新了。
      //   实例（pec2txt）：text_split 的 TEXT_TO_SPLIT 影子
      //     shadows.XML 里写的还是默认的 "1,2,3,4"
      //     而 blocks[id].fields.TEXT 才是真正输入的 "175\n bp 0.000 …"（100+ 字）
      //   以前只读 XML → 生成的是默认值，真实内容整个丢掉。
      //   两种形态都有（有的影子 fields 是空的，内容只在 XML 里），所以按「有没有值」选。
      var sid = attrOf(xml, 'id');
      var sb = sid ? this.blocks[sid] : null;
      if (sb && sb.is_shadow === true && isObj(sb.fields) && Object.keys(sb.fields).length > 0) {
        return { kind: 'block', id: sid, block: sb };
      }
      return { kind: 'rawshadow', text: xml };
    }
    return null;
  };

  /** 语句输入：返回 entry block id 或 null */
  BlockModel.prototype.statementEntry = function (blockId, inputName) {
    var conn = this.connections[blockId];
    if (isObj(conn)) {
      var ts = Object.keys(conn);
      for (var i = 0; i < ts.length; i++) {
        var info = conn[ts[i]] || {};
        if (info.type !== 'next' && info.input_name === inputName) return ts[i];
      }
    }
    return null;
  };

  /** 顶层（未被装入）的块 id 列表 */
  BlockModel.prototype.topLevelIds = function () {
    var self = this;
    return Object.keys(this.blocks).filter(function (id) {
      return !self.isNested(id);
    });
  };

  /** 取出从 entryId 开始的整条语句链 */
  BlockModel.prototype.statementChain = function (entryId) {
    var out = [];
    var cur = entryId;
    var guard = 0;
    while (cur && guard++ < 100000) {
      out.push(cur);
      cur = this.nextId(cur);
    }
    return out;
  };

  /* ------------------------------------------------------------------ */
  /* 值节点的构造辅助                                                    */
  /* ------------------------------------------------------------------ */

  function lit(v) {
    return { k: 'lit', v: v };
  }
  function num(v) {
    var n = parseFloat(v);
    return { k: 'lit', v: isFinite(n) ? n : 0, num: true };
  }
  function str(v) {
    return { k: 'lit', v: v === null || v === undefined ? '' : String(v), str: true };
  }
  function ref(v) {
    return { k: 'ref', name: String(v === null || v === undefined ? '' : v) };
  }
  function listRef(v) {
    return { k: 'listref', name: String(v === null || v === undefined ? '' : v) };
  }
  function op(name, args) {
    return { k: 'op', op: name, args: args || [] };
  }

  /* ------------------------------------------------------------------ */
  /* Decompiler                                                          */
  /* ------------------------------------------------------------------ */

  function Decompiler(options) {
    this.model = null;
    this.warnings = [];
    this.options = options || {};
    /** 名称注册表（K4 字段里存的是 UUID，需要换回名字） */
    this.names = this.options.names || null;
    /**
     * 全工程自定义积木注册表。Kitten4 的自定义积木是**跨角色全局**的：
     * 调用块 mutation 里的 def_id 就是定义块的块 id，而定义块可能挂在别的角色上。
     * 结构：{ byDefId: {id: {name, owner, params}}, owners: {name: owner} }
     */
    this.procRegistry = this.options.procRegistry || null;
    /** 当前正在反编译的实体名（用于判断过程是本角色还是别处定义的） */
    this.entName = this.options.entName || '';
    /** 本角色拥有的自定义积木（会在本脚本里生成函数） */
    this.procs = [];
    this._procSeq = 0;
  }

  /** 取调用块引用的定义块 id（mutation 里的 def_id） */
  Decompiler.prototype.procDefId = function (block) {
    if (!block || !block.mutation) return null;
    var m = /\bdef_id\s*=\s*"([^"]*)"/.exec(block.mutation);
    return m && m[1] ? m[1] : null;
  };

  /**
   * 该调用应该走哪条路：
   *   {kind:'local'}                 本角色定义，直接调用
   *   {kind:'remote', owner:'角色名'} 别的角色定义，需要运行时转发
   *   {kind:'missing'}               找不到定义（K4 里也可能有悬空引用）
   */
  Decompiler.prototype.procRoute = function (block) {
    var name = this.procedureName(block) || '';
    var defId = this.procDefId(block);
    var reg = this.procRegistry;
    if (reg && defId && reg.byDefId[defId]) {
      var owner = reg.byDefId[defId].owner;
      if (owner === this.entName) return { kind: 'local', owner: owner, name: name };
      return { kind: 'remote', owner: owner, name: name };
    }
    // 没有 def_id 或查不到：按「同名且本角色拥有」判断
    if (reg && reg.owners[name] !== undefined) {
      if (reg.owners[name] === this.entName) return { kind: 'local', owner: this.entName, name: name };
      return { kind: 'remote', owner: reg.owners[name], name: name };
    }
    return { kind: 'missing', owner: null, name: name };
  };

  /** K4 里的特殊实体指代 */
  var SELF_ALIASES = { '__self': '自己', '__mouse': '鼠标指针', '__stage': '舞台', '__edge': '边缘' };

  /**
   * 把某个实体 id 解析成人类可读名字。
   * K4 里角色用 UUID，另有 __self / __mouse 等保留值。
   */
  Decompiler.prototype.entityName = function (id) {
    if (id === undefined || id === null) return '';
    var s = String(id);
    if (SELF_ALIASES[s]) return SELF_ALIASES[s];
    if (s === '') return '';
    if (this.names) {
      var 角色名 = this.names.resolve('actors', s);
      if (角色名 !== s) return 角色名;
      // ★也可能指向一个「角色组」★（K4 的 theatre.groups —— 用户截图里左侧列表那些）
      //   组的语义就是"一组角色的集合"，运行时用 Godot 原生 group 承接。
      var 组名 = this.names.resolve('groups', s);
      if (组名 !== s) return 组名;
      return 角色名;
    }
    return s;
  };

  /** 把某个变量 / 列表 id 解析成名字 */
  Decompiler.prototype.varName = function (id) {
    if (id === undefined || id === null) return '';
    var s = String(id);
    if (s === '' || SELF_ALIASES[s]) return s;
    return this.names ? this.names.resolve('vars', s) : s;
  };

  Decompiler.prototype.listName = function (id) {
    if (id === undefined || id === null) return '';
    var s = String(id);
    if (s === '') return s;
    if (!this.names) return s;
    var 名 = this.names.resolve('lists', s);
    if (名) return 名;
    // ★K4 允许"变量里存一个列表"★：列表积木的目标可能指向**变量**，
    //   而它的 uuid 只登记在 vars 表里 → 查 lists 表必然落空 →
    //   名字变空 → 生成出凭空多出来的"局部列表"，数据整段丢掉。
    //   实测（外部图片绘制.bcm4）：`image_data` 就是 type=any 的全局变量，
    //   两处「复制列表」的目标正是它。查不到 lists 时再查一次 vars。
    var 变量名 = this.names.resolve('vars', s);
    return 变量名 || s;
  };

  Decompiler.prototype.registerTellProc = function (body, target) {
    var name = 'tell_' + (++this._procSeq);
    this.procs.push({ name: name, body: body, target: target, kind: 'tell' });
    return name;
  };

  /** 尽力把值节点还原为字面文本（用于 tell / goto 等以角色名做参数的场景） */
  /**
   * 取「列表」输入 -> 列表名（字符串）。
   * 两种存法都要兜：
   *   ① 老版 / 部分块：列表名直接放 **字段** VAR/LIST 里；
   *   ② Kitten4：VAR 是一个 `lists_get` 影子输入，value() 会把它解析成
   *      listref 节点（里面已经是解析好的名字）。
   * 以前只试字段，字段为空时退化到 `textish(value('TARGET'))` ——
   * TARGET 在 Kitten4 上根本不存在，于是列表名变成 "0"，列表操作全部打空。
   */
  Decompiler.prototype.listArgName = function (blockId, block, names) {
    var f = this.field(block, 'VAR', this.field(block, 'LIST', ''));
    if (f) return this.listName(f);
    var node = this.valueAny(blockId, names || ['VAR', 'LIST', 'TARGET']);
    // ★目标槽连的是「变量」时要认 `ref`★ —— K4 允许"变量当列表"，
    //   所以「复制 … 到 image_data」这种写法，TARGET 槽里的**真块**是
    //   `variables_get(image_data)`，解析出来是 `{k:'ref', name:'image_data'}`
    //   （不是 `listref`）。以前只认 listref → 掉到 textish(ref)=null → 名字变空 →
    //   生成出凭空多出来的 `_l_局部列表`，整段数据丢掉。
    //   实测（外部图片绘制 (2).bcm4）：block_data_json.connections 里
    //     lists_copy.euBY2BCkkjzfqNLyxM78 的 TARGET → variables_get(image_data) ✓
    //   注意别被 `blocks[].shadows` 骗了 —— 那是**建块时的默认值**（这里恒为
    //   lists_get(rect_h)），真连接在 `connections` 里。
    if (node && (node.k === 'listref' || node.k === 'ref')) return node.name;
    // ★目标槽里连的是**真块**时，取回来的是一个表达式，而列表引用就裹在里面★
    //   （实测形态：`{k:'op', op:'listref_from', args:[{k:'listref', …}]}`）
    //   以前只认最外层的 listref → 掉到 textish(null) → 名字变空串 →
    //   生成出 `复制列表(角色._l_局部列表, …)`：凭空多一个恒为空的"局部列表"，
    //   真正要写进去的那份数据整段丢掉。
    //   实测（外部图片绘制.bcm4）：5 处「复制列表」里有 2 处命中，
    //   后果是 image_data 永远加载不进去（rect_quantity=0、画笔逐像素画的都是空文本）。
    //   所以这里**递归**在表达式里找第一个 listref —— 形态再多也不用一条条补。
    var 搜 = function 找列表引用(n) {
      if (!n || typeof n !== 'object') return null;
      if (Array.isArray(n)) {
        for (var i = 0; i < n.length; i++) { var r0 = 找列表引用(n[i]); if (r0) return r0; }
        return null;
      }
      if (n.k === 'listref' || n.k === 'ref') return n;
      var ks = Object.keys(n);
      for (var j = 0; j < ks.length; j++) { var r = 找列表引用(n[ks[j]]); if (r) return r; }
      return null;
    };
    var 命中 = 搜(node);
    if (命中 && 命中.name) return 命中.name;
    var t = this.textish(node);
    return this.listName(t || '');
  };

  Decompiler.prototype.textish = function (node) {
    if (!node) return '';
    if (node.k === 'lit') return node.v === null ? '' : String(node.v);
    if (node.k === 'unknown') return '';
    return null; // 动态表达式：运行时求解
  };

  /**
   * K4 的「目标」选择器字段 -> 生成用的字面量节点。
   *
   * K4 把「移到 <目标>」「面向 <目标>」的目标放在**字段**里（不是输入框），
   * 取值是：实体 uuid / __self / __mouse / __stage / __edge / __random / __pointer。
   * 实测（_dev/probe_block_raw.js）：
   *   self_move_specify → fields.target
   *   self_face_to      → fields.sprite
   *
   * 注意 __random / __pointer 这两个**不在 SELF_ALIASES 里**，必须单独翻译，
   * 否则会变成空字符串 → 生成 `移到_目标(0.0)`，角色每帧被拖到舞台原点。
   */
  Decompiler.prototype.目标字段 = function (block, 字段名) {
    var s = String(this.field(block, 字段名, '') || '');
    if (s === '__random') return { k: 'lit', v: '随机位置', str: true };
    if (s === '__pointer' || s === '__mouse') return { k: 'lit', v: '鼠标指针', str: true };
    var 名 = s ? this.entityName(s) : '';
    return { k: 'lit', v: 名 || '', str: true };
  };

  Decompiler.prototype.warn = function (msg) {
    if (this.warnings.indexOf(msg) === -1) this.warnings.push(msg);
  };

  /** 字段读取（K4 field 名大小写不完全统一，做容错） */
  Decompiler.prototype.field = function (block, name, dflt) {
    if (!block || !isObj(block.fields)) return dflt;
    if (Object.prototype.hasOwnProperty.call(block.fields, name)) return block.fields[name];
    var keys = Object.keys(block.fields);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === String(name).toLowerCase()) return block.fields[keys[i]];
    }
    return dflt;
  };

  /**
   * 依次尝试多个输入名，返回第一个**真实存在**的输入的值。
   *
   * ⚠ 为什么不能写 `A('VALUE') || A('A')`：
   *   value() 在输入不存在时返回 num(0) —— 那是个**对象**，永远是 truthy。
   *   所以那个 `||` 从来没生效过，后面那些名字全是死代码，
   *   一旦第一个名字不对就直接退化成 0（文本/数字字面量凭空消失）。
   *
   * K4 的输入名有 Kitten4 / Scratch 两套写法，必须按实际存在的取：
   *   original_value / VALUE、TEXT1+TEXT2 / VALUE+FIND、
   *   NUMBER_TO_CHECK / NUMBER、VAR / TARGET …
   */
  Decompiler.prototype.valueAny = function (blockId, names) {
    for (var i = 0; i < names.length; i++) {
      if (names[i] && this.model.input(blockId, names[i])) return this.value(blockId, names[i]);
    }
    return num(0);
  };

  /** 云变量 / 云列表的字段里存的是 uuid，换回中文名 */
  Decompiler.prototype.cloudName = function (block) {
    var id = String(this.field(block, 'valname', this.field(block, 'VAR', '')));
    if (!id) return '';
    return this.names ? this.names.resolve('clouds', id) : id;
  };

  /** 数值输入 -> 值节点 */
  Decompiler.prototype.value = function (blockId, inputName) {
    var slot = this.model.input(blockId, inputName);
    if (!slot) {
      // ★ 自检：这个块明明有「值输入」，我们却问了一个它没有的名字。
      //   典型症状就是生成出来变成 0.0 / ""（文本和数字字面量被吞掉）。
      //   实例：新的作品的 self_go_forward 被当成「移到图层」，
      //         text_contain 的输入其实叫 TEXT1/TEXT2，text_split 是
      //         TEXT_TO_SPLIT/SPLIT_TEXT —— 以前这些全是静默的。
      var bb = this.model.blocks[blockId];
      if (bb && bb.is_shadow !== true) {
        var avail = this.inputNames(blockId, bb);
        if (avail.length) {
          this.warn('值输入名对不上: 块类型 ' + bb.type + ' 上不存在输入 "' + inputName +
            '"，它实际有的是 ' + avail.join('/') + '（该处取值会退化成 0）');
        }
      }
      return num(0);
    }
    if (slot.kind === 'block' && slot.block) return this.expr(slot.id);
    if (slot.kind === 'rawshadow') return this.shadowValue(slot.text);
    return num(0);
  };

  /** 解析 shadow XML -> 值节点 */
  Decompiler.prototype.shadowValue = function (xml) {
    var t = shadowType(xml);
    if (t === 'math_number' || t === 'controller_shadow') {
      var raw = fieldOf(xml, 'NUM');
      if (raw !== null) return num(raw);
      // 同上的影子版本：NUM 缺就用 TEXT —— 而 **TEXT 字段就是文本**，
      // 不能按"内容像不像数字"猜（`"000000…0"` 是文本，parseFloat 会变成 0）。
      return this.影子取值(xml);
    }
    if (t === 'text') return str(fieldOf(xml, 'TEXT') || '');
    if (t === 'logic_empty') return { k: 'emptybool' };
    if (t === 'default_value') {
      // 「默认值」影子：里面是一个普通值
      var dv = fieldOf(xml, 'TEXT');
      if (dv === null) dv = fieldOf(xml, 'VALUE');
      if (dv === null) dv = fieldOf(xml, 'NUM');
      if (dv === null) return num(0);
      return this.isNumericText(dv) ? num(dv) : str(dv);
    }
    if (t === 'lists_get') {
      // 影子里的 VAR 是列表 uuid，必须换成列表名；
      // 否则生成的是字符串字面量，运行时会报
      // 「list_len: Nonexistent function 'size' in base 'String'」
      return listRef(this.listName(fieldOf(xml, 'VAR') || ''));
    }
    if (t === 'get_current_scene' || t === 'get_sensing_current_scene') return str(fieldOf(xml, 'scene') || '');
    if (t === 'broadcast_input') return str(fieldOf(xml, 'MESSAGE') || '');
    // ★造型影子：它同时被两种积木用作"造型下拉框"★
    //   · 「切换到造型 X」的 index 输入      -> 要的是**选中的造型名**
    //   · 「当前造型」取值积木的独立块        -> 走 stmt/expr 的 case，不到这里
    //
    // ★★ 关键：K4 把同一个造型选择器存了**两份**，而影子那份可能是过期的 ★★
    //   实测（高考呐(1) 加油，块 dIp6rjPo3…）：
    //     set_costume dIp6rjPo3…            <- 语句块
    //       ├ shadows.index 影子: <field style_id>491d26ab…</field>   ← "新角色"   ❌ 旧值
    //       └ 真实块 id=fW1gf7Vgrd…（parent_id == dIp6rjPo3…）
    //           fields.style_id = 4783bb47…                          ← "新角色(1)" ✅ 当前值
    //   两者的区别：**影子元素带 id**，那个 id 就是真实块的 id。
    //   规则：影子有 id 且该 id 的真实块存在 -> 以**真实块的 fields**为准；
    //         否则（纯影子、没有对应块）才用影子自己的字段。
    //   以前一律读影子字段 —— 于是「切换到造型」永远切到那个过期造型。
    if (t === 'get_current_costume') {
      var 影id = shadowId(xml);
      var 真块 = (影id && this.model) ? this.model.blocks[影id] : null;
      var 造id = '';
      if (真块 && 真块.fields && 真块.fields.style_id) {
        造id = String(真块.fields.style_id);
      }
      if (!造id) 造id = fieldOf(xml, 'style_id') || '';
      if (this.names) return str(this.names.resolve('styles', 造id));
      return str(造id);
    }
    if (t === 'get_audios' || t === 'get_whole_audios') {
      // K4 里面这里是声音的 uuid，必须换回名字才能去 assets/sounds 找文件
      var sid = fieldOf(xml, 'sound_id') || '';
      return str(this.names ? this.names.resolve('audios', sid) : sid);
    }
    if (t === 'shadow_number') {
      var sn = fieldOf(xml, 'VALUE');
      if (sn === null) sn = fieldOf(xml, 'NUM');
      if (sn === null) sn = fieldOf(xml, 'TEXT');
      return this.数值或文本(sn);
    }
    if (t === 'shadow_text') return str(fieldOf(xml, 'TEXT') || fieldOf(xml, 'VALUE') || '');
    // 未知 shadow：尽量取第一个 field 的文本
    var fb = fieldOf(xml, 'TEXT');
    if (fb === null) fb = fieldOf(xml, 'NUM');
    if (fb !== null) return this.isNumericText(fb) ? num(fb) : str(fb);
    return num(0);
  };

  /**
   * 「数字或文本」的影子怎么取值 —— **按字段名判断，不要按内容猜**。
   *
   * K4 的 `math_number` 块/影子带 `allow_text="true"`，同一个块兼作文本输入：
   *   · 数字 -> 字段 `NUM`
   *   · 文本 -> 字段 `TEXT`      ← 字段名本身就说明了类型
   * 证据：`如果 <当前的地图 = "主界面">` 里右操作数的影子是
   *   `<shadow type="math_number"><field name="TEXT">主界面</field></shadow>`
   * 而 `如果 <存档 = 0>` 里左边那个 0 在 `NUM` 里。
   *
   * ⚠ 曾经按「内容像不像数字」判断（isNumericText），结果 `"000000…0"`
   *   这种**文本**被 parseFloat 成 0 —— 用户明确说了它是字符串。
   */
  Decompiler.prototype.影子取值 = function (xml) {
    var n = fieldOf(xml, 'NUM');
    if (n !== null) return num(n);                 // NUM 字段 = 数字
    var t = fieldOf(xml, 'TEXT');
    if (t === null) return num(0);
    if (String(t).trim() === '') return num(0);    // 空输入在 K4 里就是 0
    return str(t);                                 // TEXT 字段 = 文本
  };

  /** 同上的「块」版本：看 fields 里是 NUM 还是 TEXT */
  Decompiler.prototype.字段取值 = function (block) {
    var n = block && block.fields ? block.fields.NUM : null;
    if (n !== null && n !== undefined) return num(n);
    var t = block && block.fields ? block.fields.TEXT : null;
    if (t === null || t === undefined) return num(0);
    if (String(t).trim() === '') return num(0);
    return str(t);
  };

  Decompiler.prototype.isNumericText = function (s) {
    return /^\s*-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(String(s));
  };

  /**
   * 「数字影子」里装的可能是文本 —— 按**内容**决定给数字还是字符串字面量。
   *
   * K4 的 `math_number` 块/影子带 `allow_text="true"`：数字放 `NUM`，
   * 文本放 **`TEXT`**。任何一处无条件 `num()` 都会让文本静默变成 0
   * （`parseFloat("主界面")` = NaN → 0），这是最难发现的一类丢失：
   * 代码照样编译、照样跑，只是永远比较不相等。
   */
  Decompiler.prototype.数值或文本 = function (raw) {
    if (raw === null || raw === undefined) return num(0);
    var s = String(raw);
    // 空输入在 K4 里就是 0（不能变成 ""，否则 移动_步("") 之类的会变味）
    if (s.trim() === '') return num(0);
    return this.isNumericText(s) ? num(s) : str(s);
  };

  /** 表达式块 -> 值节点 */
  Decompiler.prototype.expr = function (blockId) {
    var block = this.model.get(blockId);
    if (!block) return num(0);
    var t = block.type;
    var d = this;
    var self = this;

    // 「影子类」积木即使以 block 形式出现（is_shadow=true）也要先处理，
    // 否则会落到 default 分支被当成「未支持的取值积木」。
    if (t === 'broadcast_input') return str(this.field(block, 'MESSAGE', ''));
    if (t === 'default_value' || t === 'shadow_number' || t === 'shadow_text' ||
      t === 'controller_shadow') {
      if (t === 'shadow_text') {
        // ★内容在 **VALUE 影子**里，不在本块自己的 fields 上★
        //   本块 fields 通常是空的，形如：
        //     {"type":"shadow_text","fields":{},"shadows":{"VALUE":"<shadow type=\"text\">…"}}
        //   以前这里写 `str(field(block,'TEXT', field(block,'VALUE','')))` —— 两个都读不到
        //   → 一律空串。用户报的「设置 存档 的值为 "0000…0"」变成 `""` 就是这里。
        //   ⚠ 注意：这段提前返回**先于 switch** 执行，所以只改 switch 里那个
        //     case 'shadow_text' 是没用的（那个分支永远到不了）。
        var stOwn = this.field(block, 'TEXT', null);
        if (stOwn !== null && stOwn !== '') return str(stOwn);
        return this.valueAny(blockId, ['VALUE', 'TEXT']);
      }
      // ★shadow_number 的真实值也在 **VALUE 影子**里★（实测 查表3）：
      //   {"type":"shadow_number","fields":{},
      //    "shadows":{"VALUE":"<shadow type=math_number><field name=NUM>2</field>"}}
      //   下面那三个 field() 全是读 **fields**，而这个块的 fields 是空的
      //   → 一律 num(0)：凡是走这条影子形态的「内嵌数字」全部静默变 0
      //   （「播放声音 2 直到结束」里的 2 就是这么变成 0 的）。
      //   ⚠ 与 shadow_text 同理：这段提前返回**先于 switch**，
      //     只改 switch 里那个 case 'shadow_number' 是没用的。
      if (t === 'shadow_number') {
        var snOwn = this.field(block, 'NUM', null);
        if (snOwn === null) snOwn = this.field(block, 'VALUE', null);
        if (snOwn === null) snOwn = this.field(block, 'TEXT', null);
        if (snOwn !== null && String(snOwn).trim() !== '') {
          return this.isNumericText(snOwn) ? num(snOwn) : str(snOwn);
        }
        // 退化到影子里取（value → model.input → shadows → shadowValue）
        return this.valueAny(blockId, ['VALUE', 'NUM', 'TEXT']);
      }
      var shv = this.field(block, 'TEXT', null);
      if (shv === null) shv = this.field(block, 'VALUE', null);
      if (shv === null) shv = this.field(block, 'NUM', null);
      if (shv === null) return num(0);
      return this.isNumericText(shv) ? num(shv) : str(shv);
    }

    function A(n) { return d.value(blockId, n); }
    function A2(names) { return d.valueAny(blockId, names); }
    function F(n, dflt) { return d.field(block, n, dflt); }

    switch (t) {
      case 'math_number':
        // ⚠ K4 用 `math_number` 这个块/影子同时装**数字和文本**
        //   （field 上有 allow_text="true"）：数字放在 NUM，文本放在 **TEXT**。
        //   按**字段名**判断类型 —— 不能按"内容像不像数字"猜，
        //   否则 `"000000…0"` 这种文本会被 parseFloat 成 0。
        //   以前这里无条件 `num(F('NUM', 0))`：文本值的块 NUM 不存在 →
        //   `num(0)`；典型症状 `如果 <当前的地图 = "主界面">` → 等于(..., 0.0)。
        return this.字段取值(block);

      case 'text':
        return str(F('TEXT', ''));

      case 'logic_empty':
        return { k: 'emptybool' };

      case 'variables_get':
      case 'data_variable':
        return ref(this.varName(F('VAR', '')));

      /* ---- 自定义积木的参数在表达式里就是局部变量 ---- */
      // 注意：必须放在 default 之前，且 K4 的参数块类型是 procedures_2_parameter
      case 'procedures_2_parameter':
      case 'procedures_2_stable_parameter':
      case 'procedures_parameter':
      case 'procedures_stable_parameter':
        return ref(String(F('param_name', F('NAME', '参数'))));

      case 'lists_get':
        return listRef(this.listName(F('VAR', '')));

      /* ============================================================ */
      /* Kitten4 真实取值积木                                          */
      /* ============================================================ */

      // 角色属性：get_3(角色, 属性) / get(角色, 属性)
      // ★实参顺序必须反过来★
      //   本方法在方法表里的签名是 `角色属性(属性, 目标)`（第一个是属性、第二个是角色），
      //   而 K4 的字段是 fields.sprite = 角色、fields.attribute = 属性（或数字下标）。
      //   以前直接按 [角色, 属性] 传 → "射击手" 被当成属性名、"3" 被当成角色名 →
      //   _目标节点("3") 找("3") 找不到 → 返回 0.0。
      //   实测症状（射击生存 蓄力模式）：两条射线关于"正下方"对称，而不是关于
      //   射击手朝向对称 —— 因为 角色属性("射击手","3") 恒等于 0。
      case 'get_3':
      case 'get':
        return op('entity_property',
          [str(String(F('attribute', '0'))), str(this.entityName(F('sprite', '__self')))]);

      // 随机数
      case 'random':
        return op('random_int', [A('a'), A('b')]);

      // 列表
      // Kitten4 的输入名：VAR(列表) / INDEX 或 ITEM(序号) / VALUE 或 ITEM(值)
      // （Scratch 老版是 A/B/TARGET），统一走 A2 按实际存在的取。
      case 'lists_length':
        return op('list_len', [op('listref_from', [A2(['VAR', 'LIST', 'TARGET']), A2(['A'])])]);
      case 'lists_is_exist':
        return op('list_contains', [op('listref_from', [A2(['VAR', 'LIST', 'TARGET']), A2(['A'])]), A2(['VALUE', 'ITEM', 'B'])]);
      case 'lists_index_of':
        return op('list_index_of', [op('listref_from', [A2(['VAR', 'LIST', 'TARGET']), A2(['A'])]), A2(['VALUE', 'ITEM', 'B'])]);
      case 'lists_get_value':
        return op('list_item_special', [
          op('listref_from', [A2(['VAR', 'LIST', 'TARGET']), A2(['A'])]),
          str(String(F('TYPE', 'first')).toLowerCase()),
          A2(['INDEX', 'ITEM', 'index', 'B'])
        ]);

      // 侦测
      case 'self_distance_to':
        return op('distance_to', [str(this.entityName(F('sprite', '__mouse')))]);
      case 'get_timer':
        // 「计时器」——是**另一个块**（K4 的 get_timer），别和下面的日期混了
        return op('timer', []);
      case 'get_time': {
        // ★K4 的「当前 <年/月/日/星期/时/分/秒>」——字段 fields.op★
        //   实测（查表4）**8 种取值全部出现**：
        //     year / month / date / week(星期文本，如 "星期二") / week_num(星期数字，如 2)
        //     / hour / minute / second
        //   ⚠ 以前只映射了 year / month / date，其余**一律落到最后那个 return
        //     （= 当前年）** —— 于是「当前 星期」「当前 小时」「当前 分钟」「当前 秒」
        //     四个积木全都静默变成"当前年"。
        //   ⚠ 判断顺序要紧：week_num 必须在 week 之前，否则永远匹配不到。
        var 时项 = String(F('op', '') || F('OP', '') || 'year').toLowerCase();
        if (时项.indexOf('week_num') >= 0 || 时项.indexOf('weekday_num') >= 0) return op('time_week_num', []);
        if (时项.indexOf('week') >= 0) return op('time_week', []);
        if (时项.indexOf('hour') >= 0) return op('time_hour', []);
        if (时项.indexOf('minute') >= 0) return op('time_minute', []);
        if (时项.indexOf('second') >= 0) return op('time_second', []);
        if (时项.indexOf('month') >= 0) return op('time_month', []);
        if (时项.indexOf('date') >= 0 || 时项.indexOf('day') >= 0) return op('time_date', []);
        return op('time_year', []);
      }
      case 'mouse_down': {
        var mt = String(F('mouse_event_type', 'down')).toLowerCase();
        return op(mt.indexOf('up') >= 0 ? 'mouse_up' : (mt.indexOf('press') >= 0 ? 'mouse_down' : 'mouse_down'), []);
      }
      case 'check_key': {
        // ★按键侦测也有"按下 / 松开"两档★（fields.key_event_type = down | up）
        //   以前一律生成 按键按下() → 选"松开"的积木逻辑正好反过来。
        var 键事件 = String(this.field(block, 'key_event_type', 'down')).toLowerCase();
        var 键名 = keyCodeToName(F('key', 'space'));
        return op(键事件 === 'up' ? 'key_released' : 'key_pressed', [str(键名)]);
      }
      case 'check_hidden':
        return op('self_visible', []);
      case 'get_current_costume': {
        // ★同一个块类型被两种语义共用，按"有没有 style_id"区分★
        //   · 作为**造型选择器影子**（set_costume 之类输入框里的选中的造型）：
        //     fields/shadow 里带 style_id → 必须产出**造型名**；
        //   · 作为独立的「当前造型」取值（和 self_get_costume 同义）：没有 style_id
        //     → 产出 self_costume（读角色当前的造型名）。
        //   以前这里无条件 `op('self_costume')`，而后面还写了两份更细的处理
        //   （755 行那份会解析 style_id）—— 那两份**永远不可达**，于是
        //   "把选中造型当参数传给积木"的地方会拿到"当前造型"，静默错位。
        var 造id = F('style_id', '');
        if (造id !== '' && 造id !== null && 造id !== undefined) {
          return str(this.names ? this.names.resolve('styles', String(造id)) : String(造id));
        }
        return op('self_costume', []);
      }

      // 碰撞：「<a> 碰到 <b>」
      //   ★两个目标都要传下去★，而且每个目标都可能是**角色**或**角色组**
      //   （用户图 3：碰到 运算 / 侦测组 / 运算组 / 侦测）。
      //   以前产出的是 `touching_entities`，而 emit 的 ARG 表把它写成空数组 `[]`
      //   → 两个目标在生成期被丢光，全都变成无参的 `碰到角色()`。
      case 'bump':
        return op('touching_pair',
          [str(this.entityName(F('sprite1', '__self'))), str(this.entityName(F('sprite2', '')))]);

      /* ---- 声音 / 造型等「资源选择」影子积木 ---- */
      case 'get_audios':
      case 'get_whole_audios':
        return str(this.names
          ? this.names.resolve('audios', String(F('sound_id', '')))
          : String(F('sound_id', '')));
      case 'shadow_number': {
        // ★值和 shadow_text 完全一样：真实内容在 **VALUE 影子**里，不在 fields 上★
        //   实测（查表3）：
        //     {"type":"shadow_number","fields":{},
        //      "shadows":{"VALUE":"<shadow type=math_number><field name=NUM>2</field>"}}
        //   以前这里写 F('VALUE') / F('NUM') / F('TEXT') —— 三个都是读 **fields**，
        //   而这个块的 fields 是空的 → 一律 num(0)。
        //   症状：「播放声音 2 直到结束」里的 2 变成 0，
        //        凡是走这条影子形态的"内嵌数字"（声音编号、造型编号、参数…）全部静默变 0。
        var own = F('VALUE', null);
        if (own === null) own = F('NUM', null);
        if (own === null) own = F('TEXT', null);
        if (own !== null && String(own).trim() !== '') {
          return this.isNumericText(own) ? num(own) : str(own);
        }
        // 退化：去影子里取（value → model.input → shadows → shadowValue）
        return this.valueAny(blockId, ['VALUE', 'NUM', 'TEXT']);
      }
      case 'shadow_text': {
        // ⚠ 文本内容在 **VALUE 影子**里（<shadow type="text"><field name="TEXT">…），
        // 不在本块的 fields 上。以前写 F('TEXT') 再退 F('VALUE')，两个都读不到，
        // 于是一律变成空串 —— 空白作品里 394 个 shadow_text 全丢了。
        var sv = this.valueAny(blockId, ['VALUE', 'TEXT']);
        var own = F('TEXT', null);
        if (own !== null && own !== '') return str(own);
        return sv;
      }

      /* ---- 云变量 / 云列表：本地持久化（K4Store） ---- */
      case 'cloud_variables_get':
        return op('cloud_get', [str(this.cloudName(block))]);
      case 'cloud_lists_get':
        return op('cloud_list_get', [str(this.cloudName(block))]);
      case 'cloud_lists_length':
        return op('list_len', [op('cloud_list_get', [str(this.cloudName(block))])]);
      case 'cloud_lists_index_of':
        return op('list_index_of', [op('cloud_list_get', [str(this.cloudName(block))]), A2(['VALUE', 'ITEM', 'B'])]);
      case 'cloud_lists_is_exist':
        return op('list_contains', [op('cloud_list_get', [str(this.cloudName(block))]), A2(['VALUE', 'ITEM', 'B'])]);

      /* ---- MIDI（电子琴等）：Godot 无内置 MIDI 合成，按音名近似 ---- */
      case 'midi_get':
        return op('midi_note', [str(String(F('midi', '')))]);

      /* ---- 常见运算（复杂工程里出现频率高）---- */
      case 'math_trig': {
        var tri = String(F('OP', 'SIN')).toUpperCase();
        var tmap = {
          SIN: 'math_sin', COS: 'math_cos', TAN: 'math_tan',
          ASIN: 'math_asin', ACOS: 'math_acos', ATAN: 'math_atan'
        };
        return op(tmap[tri] || 'math_sin', [A('NUM') || A('A')]);
      }
      case 'convert_type': {
        var ct = String(F('TYPE', F('type', 'number'))).toLowerCase();
        // Kitten4 的输入名是 original_value（Scratch 是 VALUE / A）
        if (ct.indexOf('str') >= 0 || ct.indexOf('字符') >= 0) {
          return op('to_string', [A2(['original_value', 'VALUE', 'A', 'value'])]);
        }
        return op('to_number', [A2(['original_value', 'VALUE', 'A', 'value'])]);
      }
      case 'divisible_by':
        // Kitten4：NUMBER_TO_CHECK / DIVISOR（Scratch 是 NUMBER / DIVISOR）
        return op('is_divisibleby', [A2(['NUMBER_TO_CHECK', 'NUMBER', 'A']), A2(['DIVISOR', 'B'])]);
      case 'text_contain': {
        // Kitten4：TEXT1(文本) / TEXT2(要找的子串)（Scratch 是 VALUE / FIND）
        return op('str_contains', [A2(['TEXT1', 'VALUE', 'STRING', 'A']), A2(['TEXT2', 'FIND', 'B'])]);
      }
      case 'text_select_changeable': {
        // K4 的这个块有**两种槽数**（看输入名里有没有 NUM1）：
        //   items=1：「文本 [STRING] 的第 [NUM0] 个字符」       → 取**单个**字符
        //   items=2：「文本 [STRING] 的第 [NUM0] 到 [NUM1] 个字符」→ 截取一段
        // ⚠ 以前一律按"截取"生成：单槽块读不到 NUM1（默认成 0），
        //   于是「取第 i 个字符」变成「取前 i 个字符」——
        //   实测 画笔图层与执行顺序测试 的数字显示器（score="365"）：
        //   i=1 得 "3" ✓、i=2 得 "36" ✗ → 造型编号算成 36 → 画面上的 365 出不来。
        // 参数照 str_substring 的 5 元组给（第 3/5 个是 FROM_START/FROM_END 标志，
        // 这个块没有那个下拉，恒为 FROM_START）。
        var 文本 = A2(['STRING', 'VALUE', 'TEXT', 'A']);
        var 名 = this.inputNames(blockId, block);
        if (名.indexOf('NUM1') >= 0) {
          return op('str_substring', [
            文本,
            A2(['NUM0', 'FROM', 'AT1', 'B']), str('FROM_START'),
            A2(['NUM1', 'TO', 'AT2', 'C']), str('FROM_START')
          ]);
        }
        return op('str_char_at', [文本, A2(['NUM0', 'AT', 'INDEX', 'B'])]);
      }
      case 'get_mouse_info': {
        // ★K4 的字段名是 `position`，不是 `scope`★（实测 _dev/probe_block_raw.js）
        //   以前写成 F('scope','x') → 永远读不到 → 默认值恒为 'x'，
        //   于是"鼠标 y"被生成成"鼠标 x"：
        //      移到x_y(鼠标x - 20,  鼠标x)
        //   角色就只能沿着 y = x 这条对角线动
        //   （用户实测原话："准星只在 y=x 方向上移动"）。
        var 项 = String(F('position', '') || F('scope', '') || F('type', '') || 'x').toLowerCase();
        return op('mouse_info', [str(项)]);
      }
      case 'get_current_clone_index':
        // 「克隆体编号」——以前这里写死 num(1)，所有克隆体都自称 1 号。
        return op('clone_index', []);
      case 'get_clone_num':
        // 「克隆体数量」
        return op('clone_count', []);
      case 'get_clone_index_property':
        return op('self_name', []);
      case 'user_id_get':
        // 「用户ID」——K4 是云平台账号 id。这里做成 op（可覆写），本地化成一个固定值。
        //   ⚠ 以前直接 `return str('player')` —— 生成出来是**字面量** "player"，
        //     用户在角色类里也没法接管。
        return op('user_id', []);
      case 'username_get':
        return op('user_name', []);
      case 'connected_users_get':
        return op('connected_users', []);
      case 'get_running_device':
        // 「运行设备」——取值形态，返回 "mobile" / "pc" 之类
        return op('running_device', []);
      case 'check_running_device': {
        // ★「运行设备为 <手机 / 电脑>」★ 实测 fields.device = "mobile"
        //   ⚠ 以前这里直接 `return str('computer')` —— 生成出来是个**常量字符串**，
        //     在 if 里恒为真（非空字符串真值），
        //     于是用户图 3 的「如果 运行设备为 手机」永远成立、后面的分支全跑。
        return op('running_device_is', [str(String(this.field(block, 'device', 'pc')).toLowerCase())]);
      }
      case 'is_ranking_show_hide':
        // 实测 fields.VAL = "show" | "hide"，问的是"排行榜当前是否显示着"
        return op('ranking_shown', [str(String(this.field(block, 'VAL', 'show')).toLowerCase())]);
      case 'cloud_lists_get_value': {
        // 「云列表 <名> 的 第 n 项 / 最后一项」
        //   ★索引输入名是 INDEX★，以前读 ITEM —— 而 ITEM 在这个块里是个空影子，
        //     于是索引恒为 0（报"值输入名对不上"）。
        //   实测 fields.TYPE = "last" | "nth"
        return op('cloud_list_item', [
          str(this.cloudName(block)),
          str(String(this.field(block, 'TYPE', 'nth')).toLowerCase()),
          this.valueAny(blockId, ['INDEX', 'ITEM'])
        ]);
      }
      case 'get_stage_info': {
        // ★K4 的「舞台的 <宽/高>」用 `fields.info`，取值 width / height★
        //   实测：fields.info = "height" | "width"。
        //   以前整块返回 num(0) —— 任何用"舞台宽度/高度"算坐标的积木都拿到 0。
        //   运行时 自带积木.舞台信息("width"/"height") 已经实现（读视口尺寸）。
        var 项2 = String(F('info', '') || F('scope', '') || F('type', '') || 'width').toLowerCase();
        return op('screen_info', [str(项2)]);
      }
      case 'calculate': {
        // ★K4 的「计算」积木（算式求值）★
        //   块形态：fields 空，shadows.input 是**一个文本框**。
        //   实测（Phigros模拟器v2.5(编程猫版)，16 处）input 取值：
        //     "1+2" / "sin1" / "9/11" / "15/16" / "3/4" / "6/11" / "7/11"
        //   —— 是**算式求值**（1+2 求 3、sin1 求 sin(1)），不是把文本原样显示；
        //      否则没人会写 "1+2" 当文本给玩家看。
        //   以前这个类型在 value() 里没有分支 → 落进「未支持的取值积木」
        //   → 按空值处理生成 `0.0`：分数 / 进度比 / 判定比例**全部算成 0**，
        //   而且一个字都不报（只在转换日志里留一行 warn）。
        //   实现链路：自带积木.计算() → 角色基类.算式求值()（Godot Expression + K4 语法预处理）。
        return op('calculate', [this.value(blockId, 'input')]);
      }
      // ★「离开 <n> 边缘」★（用户截图：「如果 离开 边缘」）
      //   实测 fields.boundary = 0 / 1 / 2 / 3 / 4（5 个块正好覆盖）
      //   ⚠ 以前这里返回 `op('touching', ['边缘'])` —— 那是「**碰到**边缘」，
      //     和 K4 的「**离开**边缘」**语义正好相反**：
      //     角色站在屏幕中间时"离开边缘"应为真，按"碰到边缘"算则恒为假。
      //   boundary 含义（K4 无文档，按最合理解释）：0=任意一边 1=上 2=下 3=左 4=右
      //   实现在 自带积木.离开边缘()。
      case 'self_out_of_boundary':
        return op('out_of_boundary', [str(String(F('boundary', '0')))]);

      // 「碰到 <颜色>」——用户自己标注"最屎代码，功能空着也没事"，
      //   所以给一个**不崩、能判定**的近似实现（见 自带积木.碰到颜色）。
      case 'bump_into_color':
        return op('bump_into_color', [
          str(this.entityName(String(this.field(block, 'sprite', '__self')) || '__self')),
          str(String(this.field(block, 'color', '#000000')))
        ]);

      // 「当前 音量」——K4 的声音侦测（麦克风）读数，0-100
      case 'get_voice_volume':
        return op('voice_volume', []);

      // 注：enable_voice_detection（开启/关闭 声音侦测）是**语句**，
      //     它的分支在 stmt() 里（放这里会永远走不到 —— 曾经就是这个问题）。

      // 「屏幕方向 <X / Y>」——实测 fields.axis = X | Y
      //   （手机重力/倾斜感应；桌面端用重力向量兜底，见 自带积木.屏幕方向）
      case 'get_orientation':
        return op('orientation', [str(String(this.field(block, 'axis', 'X')).toUpperCase())]);

      case 'controller_shadow': {
        // 字段名是 NUM（或 TEXT），保留原语义
        var cs = F('NUM', null);
        if (cs === null) cs = F('TEXT', null);
        if (cs === null || String(cs).trim() === '') return num(0);
        return this.isNumericText(cs) ? num(cs) : str(cs);
      }


      /* ---- 物理引擎积木：Godot 端未内置，读属性按 0 处理 ---- */
      case 'physics2_get_property':
      case 'get_physics_property':
      case 'physics2_forbid_bump_with':
        return num(0);

      /* ---- 文字处理 ---- */
      case 'text_split':
        // Kitten4 只有**两个**输入：TEXT_TO_SPLIT(要分割的文本) / SPLIT_TEXT(分隔符)。
        // 以前按 Scratch 的 (VALUE, TEXT_TO_SPLIT, SPLIT_TEXT) 三个名字取，
        // 于是第 1 个位置恒为 0，剩下两个还整体错位一格
        // —— 生成 文本分割(0.0, <文本>)，分隔符反而被当成文本。
        return op('str_split', [A2(['TEXT_TO_SPLIT', 'VALUE', 'STRING', 'A']), A2(['SPLIT_TEXT', 'SPLIT', 'B'])]);

      case 'math_arithmetic': {
        var o = String(F('OP', 'ADD')).toUpperCase();
        var map = { ADD: 'add', MINUS: 'sub', MULTIPLY: 'mul', DIVIDE: 'div', MOD: 'mod', POWER: 'pow' };
        return op(map[o] || 'add', [A('A'), A('B')]);
      }

      case 'math_single': {
        var os = String(F('OP', 'ABS')).toUpperCase();
        // K4 里取负也叫 math_single，OP 为 NEG
        if (os === 'NEG' || os === 'NEGATE') return op('neg', [A('NUM') || A('VALUE')]);
        return op('math_' + os.toLowerCase(), [A('NUM') || A('VALUE')]);
      }

      case 'math_round': {
        var or_ = String(F('OP', 'ROUND')).toUpperCase();
        // 带上 op 名，由 K4Lib.取整模式 做等效实现（rounddown/roundup/roundeven）
        return op('round_mode', [str('round_' + or_.toLowerCase()), A('NUM')]);
      }

      case 'math_root': {
        // Kitten4 的开方积木：默认 2 次根，也可以指定次数
        var rootN = A('DEGREE') || A('N');
        return op('math_root_n', [A('NUM') || A('VALUE'), rootN || num(2)]);
      }

      case 'math_number_property': {
        var prop = String(F('PROPERTY', 'EVEN')).toLowerCase();
        return op('is_' + prop, [A('NUMBER_TO_CHECK')]);
      }

      case 'math_modulo':
        return op('mod', [A('DIVIDEND'), A('DIVISOR')]);

      case 'math_random_int':
        return op('random_int', [A('FROM'), A('TO')]);

      case 'math_random_float':
        return op('random_float', []);

      case 'logic_compare': {
        var oc = String(F('OP', 'EQ')).toUpperCase();
        var mc = { EQ: 'cmp_eq', NEQ: 'cmp_neq', LT: 'cmp_lt', LTE: 'cmp_lte', GT: 'cmp_gt', GTE: 'cmp_gte' };
        return op(mc[oc] || 'cmp_eq', [A('A'), A('B')]);
      }

      case 'logic_operation': {
        var oo = String(F('OP', 'AND')).toUpperCase();
        return op(oo === 'OR' ? 'or' : 'and', [A('A'), A('B')]);
      }

      case 'logic_negate':
        return op('not', [A('BOOL')]);

      case 'logic_boolean':
        return { k: 'lit', v: String(F('BOOL', 'true')).toLowerCase() === 'true', bool: true };

      case 'logic_null':
        return { k: 'lit', v: null };

      case 'text_join': {
        // Kitten4 的输入是 ADD0 / ADD1 / ADD2…（个数看实际有哪些，别信 STEPS 字段：
        // 那些块 fields 是空的，数量信息在 mutation 里）。
        // Scratch 老版则是 STEPS 字段 + ADD0…，这里都兜住。
        var idx = [];
        if (isObj(block.shadows)) {
          Object.keys(block.shadows).forEach(function (k) {
            var m = /^ADD(\d+)$/.exec(k);
            if (m) idx.push(parseInt(m[1], 10));
          });
        }
        var ownConn = this.model.connections[blockId];
        if (isObj(ownConn)) {
          Object.keys(ownConn).forEach(function (id) {
            var info = ownConn[id] || {};
            var m2 = /^ADD(\d+)$/.exec(String(info.input_name || ''));
            if (m2) {
              var v2 = parseInt(m2[1], 10);
              if (idx.indexOf(v2) < 0) idx.push(v2);
            }
          });
        }
        if (!idx.length) {
          var st = parseInt(F('STEPS', 2), 10);
          if (!isFinite(st) || st < 2 || st > 32) st = 2;
          for (var q = 0; q < st; q++) idx.push(q);
        }
        idx.sort(function (a, c) { return a - c; });
        return op('join', idx.map(function (i) { return A('ADD' + i); }));
      }

      case 'text_append':
        return op('append', [ref(F('VAR', '')), A2(['TEXT', 'VALUE'])]);

      case 'text_length':
        return op('str_len', [A2(['VALUE', 'TEXT', 'STRING', 'A'])]);

      case 'text_isEmpty':
        return op('str_empty', [A2(['VALUE', 'TEXT', 'STRING', 'A'])]);

      case 'text_indexOf': {
        var oi = String(F('END', 'FIRST')).toUpperCase();
        var args = [A2(['VALUE', 'TEXT', 'STRING', 'A']), A2(['FIND', 'B'])];
        return op(oi === 'LAST' ? 'str_last_index' : 'str_index', args);
      }

      case 'text_charAt': {
        var ow = String(F('WHERE', 'FIRST')).toUpperCase();
        return op('str_char_at', [A2(['VALUE', 'TEXT', 'STRING', 'A']), A2(['AT', 'INDEX', 'B']), str(ow)]);
      }

      case 'text_getSubstring': {
        var f1 = String(F('WHERE1', 'FIRST')).toUpperCase();
        var f2 = String(F('WHERE2', 'LAST')).toUpperCase();
        return op('str_substring', [A2(['STRING', 'VALUE', 'TEXT', 'A']), A2(['AT1', 'B']), str(f1), A2(['AT2', 'C']), str(f2)]);
      }

      case 'text_changeCase': {
        var ocase = String(F('CASE', 'UPPERCASE')).toUpperCase();
        return op('str_case', [A2(['TEXT', 'VALUE', 'STRING', 'A']), str(ocase)]);
      }

      case 'text_trim':
        return op('str_trim', [A2(['TEXT', 'VALUE', 'STRING', 'A'])]);

      case 'text_prompt_ext':
        return op('ask', [A2(['TEXT', 'VALUE', 'A'])]);

      case 'self_get_coordinate':
        return op('coord_' + String(F('coordinary', 'x')).toLowerCase(), []);

      case 'self_get_rotation':
        return op('self_rotation', []);

      case 'self_get_scale':
        return op('self_scale', []);

      case 'self_get_visible':
        return op('self_visible', []);

      case 'self_get_costume':
        return op('self_costume', []);

      case 'self_get_size':
        return op('self_size', []);

      case 'screen_get_coordinate':
        return op('screen_coord', []);

      case 'screen_get_rotation':
        return op('screen_rotation', []);

      case 'screen_get_scale':
        return op('screen_scale', []);

      case 'sensing_timer':
        return op('timer', []);

      case 'sensing_mouse_x':
        return op('mouse_x', []);
      case 'sensing_mouse_y':
        return op('mouse_y', []);
      case 'sensing_mousedown':
        return op('mouse_down', []);
      case 'sensing_keypressed':
        return op('key_pressed', [A('KEY')]);
      case 'sensing_touchingobject':
        return op('touching', [A('OBJECT')]);
      case 'sensing_distanceto':
        return op('distance_to', [A('DISTANCETO')]);
      case 'sensing_answer':
        return op('answer', []);
      // ★这两个必须放在**取值**路径上★（放在 stmt() 里等于没接：
      //   它们的块出现在表达式位置上，缺分支就会报"未支持的取值积木"并按空值处理）
      //   get_answer      = Scratch 形态的「回答」
      //   translate_result= 「把 <文本> 翻译成 <语言>」的**取值**形态
      //                     （实测 fields.language = japanese|spanish|chinese|english…）
      case 'get_answer':
        return op('answer', []);
      case 'translate_result':
        return op('translate_result', [
          this.valueAny(blockId, ['text', 'TEXT']),
          str(String(F('language', 'english')).toLowerCase())
        ]);
      // ★「询问并选择」的配套取值块（三个类型，同一个语义家族）★
      //     get_choice          → 选中的**内容**
      //     get_choice_index    → 选中的**序号**（从 1 开始，和列表序号同规则）
      //     get_choice_or_index → **同一个块**用 fields.type 区分：
      //                           select_content / select_index
      //     实测（Phigros模拟器v2.5）：fields.type = "select_content" | "select_index"。
      //   以前这三个类型在 value() 里都没有分支 → 落进「未支持的取值积木」
      //   → 生成 `0.0`：询问结果恒为 0，所有"选对了吗"的判断永远走 else 分支。
      case 'get_choice_or_index': {
        var 取哪 = String(F('type', 'select_content') || 'select_content').toLowerCase();
        return op(取哪.indexOf('index') >= 0 ? 'get_choice_index' : 'get_choice', []);
      }
      case 'get_choice':
        return op('get_choice', []);
      case 'get_choice_index':
        return op('get_choice_index', []);
      case 'sensing_loudness':
        return op('loudness', []);
      case 'sensing_of':
        return op('of_property', [A('OBJECT'), str(String(F('PROPERTY', '')))]);

      case 'self_get_entity_id':
      case 'get_entity_id':
        return op('self_name', []);

      // 变量列表相关取值：K4 用 lists_* 家族
      //   （`lists_length` 在上面已经有完整分支：K4 的列表长度带 VAR/INDEX 两个输入）
      case 'lists_isEmpty':
        return op('list_empty', [listRef(F('LIST', ''))]);
      case 'lists_indexOf': {
        var idx = String(F('END', 'FIRST')).toUpperCase();
        return op(idx === 'LAST' ? 'list_last_index' : 'list_index', [listRef(F('LIST', '')), A('ITEM')]);
      }
      case 'lists_itemOf':
      case 'lists_getIndex': {
        var w = String(F('WHERE', 'FROM_START')).toUpperCase();
        return op('list_item', [listRef(F('LIST', '')), A('AT'), str(w)]);
      }

      default:
        break;
    }

    // 变异信息中可能带 procedure 名
    var procName = self.procedureName(block);
    switch (t) {
      case 'procedures_callreturn':
      case 'procedures_callnoreturn':
      case 'procedures_2_callreturn':
      case 'procedures_2_callnoreturn': {
        var cargs = self.callArgs(block);
        var route = self.procRoute(block);
        var pn = str(route.name || '(未命名)');
        if (route.kind === 'remote') {
          return op('call_remote', [pn, str(route.owner), cargs]);
        }
        return op('call_proc', [pn, cargs]);
      }
      case 'procedures_2_return_value':
      case 'procedures_return':
        return op('return_proc', [A('VALUE')]);
      default:
        break;
    }

    // 未知表达式块 -> 占位 + 警告
    //   ★屏幕类取值块**不算未支持**★：get_current_scene / get_sensing_current_scene
    //     由 emit.js 的 屏幕取值() 直接生成（当前屏 / 下一屏 / 上一屏），
    //     check_screen 由 emit.expr 生成 `角色.当前屏幕是(...)`。
    //     以前这里会跟着 warn 一句"未支持的取值积木" —— 功能明明是好的，
    //     报告却写着"未支持"（实测 切屏用例就被这条误导过）。
    if (t !== 'get_current_scene' && t !== 'get_sensing_current_scene' && t !== 'check_screen') {
      this.warn('未支持的取值积木 "' + t + '"（已按空值处理）');
    }
    // 取值类兜底：把输入一起带上（否则 check_screen 这类判断积木没法生成）
    var gIn = {};
    try {
      var gNames = this.inputNames(blockId, block);
      for (var gi = 0; gi < gNames.length; gi++) gIn[gNames[gi]] = this.value(blockId, gNames[gi]);
    } catch (e) { }
    var gFields = {};
    if (block && isObj(block.fields)) {
      Object.keys(block.fields).forEach(function (fk) {
        var fv = block.fields[fk];
        gFields[fk] = (fv && typeof fv === 'object' && fv.value !== undefined) ? fv.value : fv;
      });
    }
    return { k: 'unknown', type: t, inputs: gIn, fields: gFields };
  };

  Decompiler.prototype.procedureName = function (block) {
    if (!block) return null;
    // 注意：不能直接匹配第一个 name="..."，因为 <mutation><arg name="参数"></arg></mutation>
    // 里的 name 属于参数，不属于过程。所以只允许 <mutation ...> 标签自身带 name，
    // 即 name= 之前不能出现 '<'。
    var mut = block.mutation || '';
    var m = /<mutation[^<>]*?\bname\s*=\s*"([^"]*)"/.exec(mut);
    if (m && m[1]) return m[1];
    // 退化：直接以 <mutation name="..."> 开头
    m = /^\s*<mutation[^>]*\bname\s*=\s*"([^"]*)"/.exec(mut);
    if (m && m[1]) return m[1];
    var n = this.field(block, 'NAME', null);
    if (n) return n;
    var custom = this.field(block, 'custom', null);
    if (custom) return custom;
    return null;
  };

  /**
   * 解析自定义积木（过程）定义
   * K4 的 procedures_defnoreturn 变异形如：
   *   <mutation><arg name="参数1"></arg></mutation>  或  <mutation><arg name="x"></arg></mutation>
   * 语句体输入名固定为 STACK
   * 调用块参数输入名固定为 ARG0 / ARG1 ...
   */
  Decompiler.prototype.procedureArgs = function (block) {
    var mut = block.mutation || '';
    var names = [];
    var re = /<arg[^>]*name\s*=\s*"([^"]*)"/g;
    var m;
    while ((m = re.exec(mut)) !== null) names.push(m[1]);
    if (!names.length) {
      // 退化：读取 ARG0.. 字段
      var i = 0;
      while (true) {
        var v = this.field(block, 'ARG' + i, null);
        if (v === null) break;
        names.push(String(v));
        i++;
      }
    }
    return names;
  };

  /** 调用块的实参列表：兼容 ARG0.. 与 a/b/c.. 两种命名 */
  Decompiler.prototype.callArgs = function (block) {
    var out = [];
    var i, slot;
    // 样式一：ARG0, ARG1, ...
    for (i = 0; i < 16; i++) {
      slot = this.model.input(block.id, 'ARG' + i);
      if (!slot) break;
      if (slot.kind === 'block' && slot.block) out.push(this.expr(slot.id));
      else if (slot.kind === 'rawshadow') out.push(this.shadowValue(slot.text));
      else out.push(num(0));
    }
    if (out.length) return { k: 'args', args: out };
    // 样式二（K4 真实）：a, b, c, ... z
    var letters = 'abcdefghijklmnopqrstuvwxyz';
    for (i = 0; i < letters.length; i++) {
      slot = this.model.input(block.id, letters.charAt(i));
      if (!slot) break;
      if (slot.kind === 'block' && slot.block) out.push(this.expr(slot.id));
      else if (slot.kind === 'rawshadow') out.push(this.shadowValue(slot.text));
      else out.push(num(0));
    }
    return { k: 'args', args: out };
  };

  /**
   * 过程参数名。
   * Kitten4 的 def 块把参数放在 PARAMS0.. 输入里，连的是 procedures_2_parameter /
   * procedures_2_stable_parameter 块，参数名在该块的 param_name 字段。
   * 另外 mutation 里也会写一份 <procedures_2_parameter_shadow name="X">，
   * 两种情况都要兼容。
   */
  Decompiler.prototype.procedureParamNames = function (block) {
    var names = [];
    for (var i = 0; i < 16; i++) {
      var slot = this.model.input(block.id, 'PARAMS' + i);
      if (!slot) break;
      if (slot.kind === 'block' && slot.block) {
        var b = slot.block;
        if (b.type === 'procedures_2_parameter' || b.type === 'procedures_2_stable_parameter' ||
          b.type === 'procedures_parameter' || b.type === 'procedures_stable_parameter') {
          names.push(String(this.field(b, 'param_name', '参数' + (i + 1))));
        } else {
          names.push('参数' + (i + 1));
        }
      } else {
        names.push('参数' + (i + 1));
      }
    }
    if (names.length) return names;
    // 退化：从 mutation 里的 <procedures_2_parameter_shadow name="X" value="0"> 取
    var mut = block.mutation || '';
    var re = /<procedures_2_parameter_shadow[^>]*\bname\s*=\s*"([^"]*)"/g;
    var m;
    while ((m = re.exec(mut)) !== null) names.push(m[1]);
    if (names.length) return names;
    return this.procedureArgs(block);
  };

  Decompiler.prototype.registerProcedure = function (block) {
    var name = this.procedureName(block) || ('过程' + (this.procs.length + 1));
    var args = this.procedureParamNames(block);
    if (!args.length) args = this.procedureArgs(block);
    var body = this.blockBody(block.id, 'STACK');
    if (!body.length) body = this.blockBody(block.id, 'DO');
    this.procs.push({ name: name, kind: 'procedure', params: args, body: body });
    return name;
  };

  /**
   * controls_if 的分支展开。
   * 变异格式（已核对 kitten.js mutationToDom）：<mutation elseif="n" else="1"></mutation>
   * 输入命名：IF0/DO0, IF1/DO1, ... ELSE （elseif 个数 = elseif 属性值）
   */
  Decompiler.prototype.ifBranches = function (block) {
    var mut = block.mutation || '';
    var elseif = parseInt(attrOf(mut, 'elseif') || '0', 10);
    var els = parseInt(attrOf(mut, 'else') || '0', 10);
    if (!isFinite(elseif) || elseif < 0) elseif = 0;
    var branches = [];
    for (var i = 0; i <= elseif; i++) {
      branches.push({
        cond: this.value(block.id, 'IF' + i),
        body: this.blockBody(block.id, 'DO' + i)
      });
    }
    if (els) branches.push({ cond: null, body: this.blockBody(block.id, 'ELSE') });
    return branches;
  };

  /**
   * 该块所有「值输入」的名字：connections 里的 input 行 + shadows 声明。
   * 供通用兜底使用（未知积木不能丢输入）。
   */
  Decompiler.prototype.inputNames = function (blockId, block) {
    var seen = {};
    var out = [];
    var own = this.model.connections[blockId];
    if (isObj(own)) {
      var ks = Object.keys(own);
      for (var i = 0; i < ks.length; i++) {
        var info = own[ks[i]] || {};
        if (info.type === 'next') continue;
        var n = info.input_name;
        if (n && !seen[n]) { seen[n] = 1; out.push(n); }
      }
    }
    if (block && isObj(block.shadows)) {
      var sk = Object.keys(block.shadows);
      for (var j = 0; j < sk.length; j++) {
        if (!seen[sk[j]]) { seen[sk[j]] = 1; out.push(sk[j]); }
      }
    }
    return out;
  };

  /**
   * 通用兜底语句（k:'stub'）
   *
   * 反编译器没有专用分支的积木，**不再丢弃输入**，而是把全部 inputs + fields
   * 原样带进 IR，交给下游的「类型层方法表」生成 角色类 方法调用。
   * 没有实现的方法由 角色自带积木.gd 里的桩（pass / return 默认值）接住 ——
   * 因此转换永远是 100% 成功的，缺口表现为"待填的桩"而不是"丢失的代码"。
   */
  Decompiler.prototype.stubStmt = function (blockId, block) {
    var d = this;
    var inputs = {};
    var names = this.inputNames(blockId, block);
    for (var i = 0; i < names.length; i++) {
      try { inputs[names[i]] = d.value(blockId, names[i]); }
      catch (e) { inputs[names[i]] = null; }
    }
    var fields = {};
    if (block && isObj(block.fields)) {
      var fk = Object.keys(block.fields);
      for (var j = 0; j < fk.length; j++) {
        var v = block.fields[fk[j]];
        fields[fk[j]] = (v && typeof v === 'object' && v.value !== undefined) ? v.value : v;
      }
    }
    return { k: 'stub', type: block.type, inputs: inputs, fields: fields, blockId: blockId };
  };

  /** 语句块 -> IR 语句节点（不含 next 链，next 由 statementChain 驱动） */
  Decompiler.prototype.stmt = function (blockId) {
    var block = this.model.get(blockId);
    if (!block) return { k: 'nop' };
    var t = block.type;
    var d = this;

    function A(n) { return d.value(blockId, n); }
    function A2(names) { return d.valueAny(blockId, names); }
    function S(n) { return d.blockBody(blockId, n); }

    switch (t) {
      case 'repeat_forever':
        return { k: 'forever', body: S('DO') };

      case 'repeat_n_times':
        return { k: 'repeat', times: A('times'), body: S('DO') };

      case 'repeat_forever_until':
        return { k: 'repeat_until', cond: A('condition'), body: S('DO') };

      case 'controls_if':
        return { k: 'if', branches: this.ifBranches(block) };

      case 'wait':
        return { k: 'wait', seconds: A('time') };

      case 'wait_until':
        return { k: 'wait_until', cond: A('condition') };

      case 'break':
        return { k: 'break' };

      /* ============================================================ */
      /* Kitten4 真实积木（名字与字段来自 7 个官方样例工程统计）        */
      /* ============================================================ */

      // 广播 + 紧随其后的一段脚本（K4 的广播块自带 DO 语句输入）
      case 'self_broadcast':
        return {
          k: 'broadcast_body',
          message: this.value(blockId, 'message'),
          body: S('DO')
        };
      case 'self_broadcast_and_wait':
        return {
          k: 'broadcast_body_wait',
          message: this.value(blockId, 'message'),
          body: S('DO')
        };

      case 'self_appear':
        return { k: 'show' };
      case 'self_disappear':
        return { k: 'hide' };
      case 'self_gradually_show_hide': {
        var isShow = String(this.field(block, 'is_show', 'show')).toLowerCase();
        return {
          k: isShow === 'hide' ? 'fade_out' : 'fade_in',
          seconds: this.value(blockId, 'time')
        };
      }

      // 换造型
      // ★K4 的「切换到造型 X」把选中的造型放在 `index` 输入里，而且那是一个
      //   **type=get_current_costume 的影子**（style_id 字段是造型 uuid）★
      //   实测（高考呐 加油）：set_costume 的 shadows.index =
      //     <shadow type="get_current_costume"><field name="style_id">491d26ab-…</field>
      //   而 shadowValue() 把 get_current_costume 影子一律当成"读取当前造型"的
      //   `self_costume` —— 于是生成
      //       await 角色.设置造型(await 角色.当前造型())
      //   自赋值，等于**什么都没切换**（用户实测："custom 读的是自己的当前造型"）。
      //   这里直接读影子 XML 的 style_id 并 resolve 成造型名。
      case 'set_costume': {
        // 「切换到造型 <…>」的 index 输入有**两种完全不同的形态**，必须按连接区分：
        //
        //   ① 下拉框（最常见）：index 连到的是**造型选择器影子** get_current_costume
        //      （is_shadow = true，fields.style_id = 选中的造型）。也可能连到一个
        //      **非影子**的 get_current_costume 块（用户改过下拉框时 K4 会这么存，
        //      且那块 fields 才是最新值、影子 XML 里的是过期值 —— 见下）。
        //      → 取它的 fields.style_id，解析成造型名。
        //
        //   ② 嵌套表达式：index 连到的是**真实的功能块**（角色属性 get_3、算术
        //      math_arithmetic、变量……）。K4 在这种情况下**仍然**在 index 的
        //      shadows XML 里留着一份 style_id —— 那是**创建时的默认造型**。
        //      → 必须生成那个表达式，绝不能拿默认 style_id 当结果。
        //
        //   ⚠ 以前这里只做 ①：先找"影子里的 id 指向的真实块"、找不到就退回影子 XML
        //     的 style_id。于是 ② 的四个块全被生成成同一个造型名
        //     （`设置造型("新角色")`），嵌套输入被静默吃掉 —— 这正是
        //     「custom 测试」里暴露的问题（4 个块 IR 完全一样）。
        var 连 = this.model ? this.model.input(blockId, 'index') : null;
        var 选块 = (连 && 连.kind === 'block') ? 连.block : null;
        var 是造型选择器 = !!(选块 && 选块.fields && 选块.fields.style_id &&
          (选块.is_shadow === true || 选块.type === 'get_current_costume'));
        if (连 && 连.kind === 'block' && !是造型选择器) {
          // 形态 ②：挂的是表达式，原样生成（它自己会算出造型编号 / 名称 / 文本）
          return { k: 'set_costume', value: this.expr(连.id) };
        }
        var sid = 是造型选择器 ? String(选块.fields.style_id) : '';
        if (!sid) {
          // 没有可用的选择器块 —— 退回影子定义（旧工程 / 只有 XML 的情况）
          var 影 = (block.shadows || {}).index;
          if (typeof 影 === 'string') {
            var 影id = shadowId(影);
            var 真块 = (影id && this.model) ? this.model.blocks[影id] : null;
            if (真块 && 真块.fields && 真块.fields.style_id) sid = String(真块.fields.style_id);
            if (!sid) sid = fieldOf(影, 'style_id') || '';
          } else if (影 && 影.fields && 影.fields.style_id) {
            sid = String(影.fields.style_id);
          }
        }
        if (!sid) {
          // 连一个造型引用都没有 → 只能当表达式取值（例如变量里存着造型名）
          return { k: 'set_costume', value: this.value(blockId, 'index') };
        }
        return { k: 'set_costume', value: str(this.names ? this.names.resolve('styles', sid) : sid) };
      }
      case 'self_next_style':
        return { k: 'next_costume', dir: 1 };
      case 'self_prev_next_style':
        return {
          k: 'next_costume',
          dir: String(this.field(block, 'prev_or_next', 'next')).toLowerCase() === 'prev' ? -1 : 1
        };

      case 'self_move_to':
        // ★K4 的 self_move_to 是「移到 x:__ y:__」★ —— 两个数字输入 x / y，
        // 不是 Scratch 的「移到 <角色/鼠标>」（那个是 self_move_specify）。
        // 以前按 motion_goto 处理成 goto_target 并去读 TARGET，输入名不存在 →
        // 空白作品里 124 处全变成 移到_目标(0.0)，坐标整个丢掉。
        return { k: 'goto_xy', x: A2(['x', 'X']), y: A2(['y', 'Y']) };
      case 'self_move_specify':
        // K4 的「移到 <目标>」把选择器放在 field `target` 里
        // （__random / __pointer / 实体 uuid …）。以前走 textish()，
        // __random / __pointer 不在 SELF_ALIASES 里 → 解析成空 → 生成
        // `移到_目标(0.0)`，敌人每帧被硬拖到舞台原点（实测 射击生存 就是这样）。
        return { k: 'goto_target', target: this.目标字段(block, 'target') };
      case 'self_face_to':
        // 「面向 <目标>」：同一个选择器，但字段名是 `sprite`（不是 target）。
        // 以前**整块没有映射** → 掉进 default 变成空参桩 `面向_角色([])`。
        return { k: 'face_to', target: this.目标字段(block, 'sprite') };
      case 'self_point_towards':
        return { k: 'point_towards', target: this.value(blockId, 'degrees') };
      case 'self_rotate':
        return { k: 'change_rotation', delta: this.value(blockId, 'degrees') };
      case 'self_set_position': {
        // ★实测修正（_dev/probe_block_raw.js 游戏-空白作品.bcm4）★
        //   K4 的 `self_set_position` 常见形态是**单轴**「把 x / y 坐标设为 值」：
        //       fields  = { coordinary: "x" }，值在 shadows.value
        //   以前只按单轴处理、且没兜住双轴形态。这里按字段判断，两种都接住：
        //     · 有 coordinary → set_coord（单轴）
        //     · 没有          → goto_xy（双轴，x / y 两个输入）
        //   ⚠ 这段逻辑在 stmt() 后面**曾经又抄了一份**，而这里先命中 ——
        //     那份永远不可达。已经删掉，别再在后面补第二份。
        var 坐标轴 = String(this.field(block, 'coordinary', ''));
        if (坐标轴.length > 0) {
          return { k: 'set_coord', axis: 坐标轴.toLowerCase(), value: this.value(blockId, 'value') };
        }
        return { k: 'goto_xy', x: this.value(blockId, 'x'), y: this.value(blockId, 'y') };
      }
      case 'self_glide_to':
        return {
          k: 'glide_to',
          x: this.value(blockId, 'x'),
          y: this.value(blockId, 'y'),
          seconds: this.value(blockId, 'time')
        };
      case 'self_bounce_off_edge':
        return { k: 'bounce' };
      case 'self_change_scale_2':
      case 'self_change_scale': {
        var inc = String(this.field(block, 'increase', 'increase')).toLowerCase();
        var sv = this.value(blockId, 'scale') || this.value(blockId, 'value');
        return {
          k: 'change_scale',
          value: (inc === 'decrease' ? op('neg', [sv]) : sv)
        };
      }
      case 'self_flip':
        return { k: 'flip', axis: String(this.field(block, 'coordinary', 'x')).toLowerCase() };

      // 对话 / 思考
      // ★两个块的命名和实际语义是**反的**，以数据为准★（实测 积木对查表测试_2）：
      //     self_dialog      → fields.type = say|think，shadows = { text, time: 2 }  ← **带持续秒数**
      //     self_dialog_wait → fields.type = say|think，shadows = { text }           ← **不带秒数**
      //   ⚠ 以前正好当成反的（self_dialog → 说，self_dialog_wait → 说_秒）：
      //     「对话 Hi 持续 2 秒」变成"一直说着不消失"，
      //     而「对话 Hi」反而去读一个根本不存在的 time（值恒为 0）。
      case 'self_dialog': {
        var dtype = String(this.field(block, 'type', 'say')).toLowerCase();
        return {
          k: 'say_for',
          text: this.value(blockId, 'text'),
          seconds: this.valueAny(blockId, ['time', 'SECONDS']),
          think: dtype.indexOf('think') >= 0 || dtype.indexOf('想') >= 0
        };
      }
      case 'self_dialog_wait': {
        var dtype2 = String(this.field(block, 'type', 'say')).toLowerCase();
        return {
          k: 'say',
          text: this.value(blockId, 'text'),
          think: dtype2.indexOf('think') >= 0 || dtype2.indexOf('想') >= 0
        };
      }

      /* ---- 本轮补齐（积木对查表测试_2 带出来的缺口）---- */
      // 「设置 角色阵营为 <红色/绿色/蓝色/无 阵营>」
      //   实测 fields.role_camp = camp_red | camp_yellow | camp_blue | no_camp
      //   用户建议用 Godot 的 group 实现 —— 采纳：阵营本质就是"给角色打个标签"，
      //   和 add_to_group() 语义完全重合，比另建一套状态表干净。
      case 'self_set_role_camp':
        return op('set_role_camp', [str(String(this.field(block, 'role_camp', 'no_camp')).toLowerCase())]);

      // 「设置 此角色 <可拖动 / 不可拖动>」——实测 fields.draggable = "0" | "1"
      case 'self_set_draggable':
        return op('set_draggable', [str(String(this.field(block, 'draggable', '0')))]);

      // 「设置 旋转模式为 <自由旋转 / 左右翻转 / 不旋转>」
      //   实测 fields.rotation_type = "0" | "1" | "2"（三个块分别是 2 / 1 / 0）
      case 'self_set_rotation_type':
        return op('set_rotation_type', [str(String(this.field(block, 'rotation_type', '0')))]);

      // 「抖动 <n> 秒」——实测只有 shadows.time
      case 'self_shake':
        return op('shake', [this.valueAny(blockId, ['time', 'SECONDS'])]);

      // 「围绕 <角色> 旋转 <n> 度」——实测 fields.sprite = 目标角色 uuid，shadows.degrees = 30
      case 'self_rotate_around': {
        var 绕谁 = String(this.field(block, 'sprite', '__self') || '__self');
        return op('rotate_around', [
          str(绕谁 === '__self' ? '' : this.entityName(绕谁)),
          this.valueAny(blockId, ['degrees', 'DEGREES'])
        ]);
      }

      // 「<角色> 新建对话框 <文本>」——让**指定角色**说话（不是自己）
      //   实测 fields.actor = 目标角色 uuid，shadows.text = "Hi"
      case 'create_stage_dialog': {
        var 谁 = String(this.field(block, 'actor', '__self') || '__self');
        return op('stage_dialog', [
          str(谁 === '__self' ? '' : this.entityName(谁)),
          this.valueAny(blockId, ['text', 'TEXT'])
        ]);
      }

      // 「将角色的 <宽度/高度> <增加/减少> <n>」——和 set_width_height_scale 是姊妹块
      //   实测 fields = { type: width|height, increase: increase|decrease }，shadows.value = 10
      case 'add_width_height_scale_2':
        return op('add_width_height_scale', [
          str(String(this.field(block, 'type', 'width')).toLowerCase()),
          str(String(this.field(block, 'increase', 'increase')).toLowerCase()),
          this.valueAny(blockId, ['value', 'VALUE'])
        ]);

      // 「在 <n> 秒内 逐渐显示/隐藏」「将 <目标> 显示/隐藏」「将 <目标> 在 <n> 秒内 逐渐…」
      //   实测 fields.type  = grad_show | grad_hide | show | hide
      //        fields.sprite = 目标实体 uuid —— ★**可以是角色，也可以是"角色组"**★
      //        shadows.time = 渐变秒数（show / hide 瞬变时没有）
      //   ⚠ 以前这个块整块未映射，而且 core 读的是 TYPE / IN / SECONDS 三个不存在的输入名，
      //     报三条"值输入名对不上"，全部退化成 0。
      case 'set_entity_show_hide': {
        var 目标id = String(this.field(block, 'sprite', '__self') || '__self');
        return op('entity_show_hide', [
          str(目标id === '__self' ? '' : this.entityName(目标id)),
          str(String(this.field(block, 'type', 'show')).toLowerCase()),
          this.valueAny(blockId, ['time', 'SECONDS'])
        ]);
      }

      // 「把 <文本> 翻译成 <语言>」——语句形态（把译文说出来）
      //   实测 fields.language = english | chinese | japanese | spanish | french | classical_chinese
      case 'translate':
        return op('translate', [
          this.valueAny(blockId, ['text', 'TEXT']),
          str(String(this.field(block, 'language', 'english')).toLowerCase())
        ]);

      // 「把 <文本> 翻译成 <语言>」——取值形态
      case 'translate_result':
        return op('translate_result', [
          this.valueAny(blockId, ['text', 'TEXT']),
          str(String(this.field(block, 'language', 'english')).toLowerCase())
        ]);

      // Scratch 形态的「回答」（K4 里 sensing_answer 已经有映射，这里补别名）
      case 'get_answer':
        return op('answer', []);

      // 「询问 <文本> 并等待」——K4 的 self_ask（实测：fields 空，shadows.text = 问题）
      //   语句形态：把问题交给运行时已有的 询问并等待()（它同时返回答案，
      //   答案由「回答」/ get_answer 取值块去取）。以前它是个桩（什么都不问）。
      case 'self_ask':
        return op('ask', [this.valueAny(blockId, ['text', 'TEXT'])]);

      // 「开启 / 关闭 声音侦测」——K4 的 enable_voice_detection
      //   实测 fields.state = open | close。
      //   ⚠ 它是**语句**，必须挂在 stmt() 上（挂到 value() 里永远不会被走到）。
      //   实现在 自带积木.开启声音侦测() → autoload K4Voice（见 runtime/全局/声音侦测.gd）。
      case 'enable_voice_detection':
        return op('enable_voice_detection', [str(String(this.field(block, 'state', 'open')).toLowerCase())]);

      // 声音
      case 'play_audio_2':
        return { k: 'play_sound', sound: this.value(blockId, 'audio'), wait: false };
      case 'play_audio_and_wait_2':
        return { k: 'play_sound', sound: this.value(blockId, 'audio'), wait: true };
      case 'stop_audio_2': {
        // ★必须把"停哪个声音"带出来★：K4 的 stop_audio_2 在 audio 输入里给的是
        //   sound_id = 具体 uuid，或 "all"（停止所有声音）。
        //   以前这里一律返回无参的 {k:'stop_sound'} —— 于是不管选哪个声音，
        //   生成的都是「停止所有声音」，"停止 猫叫" 会把整条音轨全掐了。
        var 音 = this.value(blockId, 'audio');
        var 音名 = (音 && 音.v !== undefined) ? String(音.v) : '';
        if (音名 === '' || 音名.toLowerCase() === 'all') return { k: 'stop_sound' };
        return { k: 'stop_sound_named', sound: 音 };
      }
      case 'set_volume_or_rate':
      case 'set_volume_or_rate_2': {
        // ★下拉框 audio_key = volume | rate★（实测 set_volume_or_rate_2 里是 "rate"）
        //   选 rate 时是"播放速率"（→ AudioStreamPlayer.pitch_scale）。
        //   以前字段被丢掉，选 rate 也会去改音量。
        //   注意：volume 时仍产出老的 set_volume（IR_METHODS 里的 设置音量），
        //   只有 rate 才走新方法，这样不破坏既有映射。
        var 音项 = String(this.field(block, 'audio_key', 'volume') || 'volume').toLowerCase();
        var 值 = this.valueAny(blockId, ['value', 'VALUE', 'audio_value']);
        if (音项.indexOf('rate') >= 0) return { k: 'set_volume_or_rate', item: str(音项), value: 值 };
        return { k: 'set_volume', value: 值 };
      }
      case 'change_volume_or_rate':
      case 'change_volume_or_rate_2': {
        var 音项2 = String(this.field(block, 'audio_key', 'volume') || 'volume').toLowerCase();
        var 值2 = this.valueAny(blockId, ['value', 'VALUE', 'audio_value']);
        if (音项2.indexOf('rate') >= 0) return { k: 'change_volume_or_rate', item: str(音项2), value: 值2 };
        return { k: 'change_volume', value: 值2 };
      }

      // 变量
      case 'variables_set':
      case 'data_setvariableto':
        return {
          k: 'set_var',
          name: this.varName(this.field(block, 'VAR', '')),
          value: this.value(blockId, 'VALUE')
        };
      case 'change_variable':
      case 'variables_change':
      case 'data_changevariableby': {
        var vname = this.varName(this.field(block, 'valname', this.field(block, 'VAR', '')));
        var method = String(this.field(block, 'method', 'increase')).toLowerCase();
        var amount = this.value(blockId, 'n') || this.value(blockId, 'VALUE');
        if (method === 'decrease' || method === '减') {
          amount = op('neg', [amount]);
        }
        return { k: 'change_var', name: vname, value: amount };
      }

      // 列表
      case 'lists_append':
      case 'lists_add':
        return {
          k: 'list_add',
          name: this.listArgName(blockId, block),
          value: this.valueAny(blockId, ['VALUE', 'ITEM'])
        };
      case 'lists_delete': {
        var delType = String(this.field(block, 'TYPE', 'first')).toLowerCase();
        return {
          k: 'list_delete_special',
          name: this.listArgName(blockId, block),
          where: delType,
          index: this.valueAny(blockId, ['INDEX', 'ITEM', 'index'])
        };
      }
      case 'lists_insert_value':
        return {
          k: 'list_insert',
          name: this.listArgName(blockId, block),
          index: this.valueAny(blockId, ['INDEX', 'index']),
          value: this.valueAny(blockId, ['VALUE', 'ITEM'])
        };
      case 'lists_replace':
      case 'lists_replace_value':
        // Kitten4 的 lists_replace：VAR(列表影子) + INDEX(序号) + VALUE(新值)，
        // 另有 ITEM/IS 两个恒为空串的影子（有人用有人不用）。以前只读 ITEM，读不到。
        //
        // ★TYPE 一定要带上★：它和 lists_get_value / lists_delete 是同一个下拉，
        // 值是 first / last —— 也就是「从头数第 n 项」还是「从倒数第 n 项」。
        // 以前这里没读 TYPE，TYPE=last 的 5 处会被当成 first。
        return {
          k: 'list_replace',
          name: this.listArgName(blockId, block),
          where: String(this.field(block, 'TYPE', 'first')).toLowerCase(),
          index: this.valueAny(blockId, ['INDEX', 'index']),
          value: this.valueAny(blockId, ['VALUE', 'ITEM'])
        };
      case 'lists_copy':
        // ★K4 的「复制 <值> 到 <列表>」★
        //   K4 编辑器里它看起来是**一个**块，其实是两层嵌套：
        //       外层 lists_copy:  复制 [ ⟨内层⟩ ] 到 [输入]
        //       内层 text_split:        [文本] 按 [分隔符] 分开成列表
        //   所以 <值> 槽里插的常常是 **text_split**（或别的表达式），
        //   它必须是**任意表达式**，不能当成列表名去解析。
        //
        //   以前写 `this.textish(this.valueAny(blockId,['VALUE','VAR']))` ——
        //   textish 只认字面量（lit），表达式一律返回 null，于是源/目标双双变空串，
        //   生成 `复制列表(角色.局部列表, 角色.局部列表)`（用户看到的"局部列表"），
        //   同时插在 VALUE 里的 text_split 连同那段长文本**一起被丢掉**。
        return {
          k: 'list_copy',
          name: this.listArgName(blockId, block, ['TARGET', 'LIST', 'VAR']),
          value: this.valueAny(blockId, ['VALUE', 'VAR'])
        };

      // 画笔
      case 'clear_drawing':
        return { k: 'pen_clear' };
      case 'self_pen_down':
        return { k: 'pen_down' };
      case 'self_pen_up':
        return { k: 'pen_up' };
      case 'stamp': {
        // Kitten4 的 `stamp` 是**文字图章**（text + size + align 字段），
        // 不是画笔的「图章」。以前和 pen_stamp 一起映射成 {k:'pen_stamp'}，
        // 文本和字号全被丢掉（空白作品 61 处、Phigros 多处）。
        // ★align 也要带出去★：实测 fields.align = "left" | "center" | "right"
        //   （18 个样本里 left/center 都有）—— 以前没读，所有文字图章都按居中画。
        var 对齐 = String(this.field(block, 'align', 'center') || 'center').toLowerCase();
        if (对齐 !== 'left' && 对齐 !== 'right') 对齐 = 'center';
        return {
          k: 'text_stamp',
          text: this.valueAny(blockId, ['text', 'TEXT']),
          size: this.valueAny(blockId, ['size', 'SIZE']),
          align: str(对齐)
        };
      }
      case 'image_stamp':
        // 「图片图章」= 把**当前角色的造型**原样印到画笔层上（K4 里叫角色印章）。
        // 和画笔分类的「图章」(pen_stamp) 是同一件事，只是 K4 给了两个入口块。
        // 语义要点（用户明确过）：印章**不跟着角色动**、只继承角色的长宽（大小），
        // **不继承角色身上的效果/透明度**，用的也是**原纹理的颜色**。
        // 这些都由 自带积木.图章() → 屏幕绘制._画图章() 保证：
        //   画布节点自己没有角色的 modulate，draw_texture 用默认白色调制。
        return { k: 'pen_stamp' };
      case 'set_fill_style':
        // 「设置填充 <颜色>」——字段名是 color（和画笔的 set_pen_color 一样）
        return { k: 'fill_style', value: str(String(this.field(block, 'color', '#FFFFFF'))) };
      case 'set_pen_path': {
        // 「设置当前为填充 <起点 / 终点>」
        // K4 源码：point === "start_point" → begin_path，其它 → close_path
        //   ⚠ 这不是"画笔路径"，而是**填充多边形的起止**：
        //     起点 = 开始记录路径点；终点 = 闭合 + 用填充色填上。
        //   以前整块没映射（掉成桩），所以"设置填充"这条路完全走不通。
        return {
          k: 'fill_path',
          point: String(this.field(block, 'point', 'start_point')).toLowerCase()
        };
      }
      case 'self_set_pen_size':
        return { k: 'pen_size', value: this.valueAny(blockId, ['steps', 'size', 'value', 'VALUE']) };
      case 'self_change_pen_size':
      case 'self_change_pen_size_2':
        // Kitten4 的输入名是 steps（Scratch 是 size/value）
        return { k: 'pen_change_size', value: this.valueAny(blockId, ['steps', 'size', 'value', 'VALUE']) };
      case 'self_set_pen_color':
        return { k: 'pen_color', value: str(String(this.field(block, 'color', '#000000'))) };

      // ---- 画笔颜色家族（K4 一共 5 个块，以前只接上了 2 个）----
      //   self_set_pen_color            → set_brush_color_to(颜色)        → pen_color            ✓
      //   self_change_pen_color         → add_brush_color(增量)          → pen_change_color
      //   self_change_pen_shade         → add_brush_brightness(增量)     → pen_change_shade
      //   self_set_pen_color_property   → set_color_property(项, 值)     → pen_color_property
      //   self_change_pen_color_property→ change_color_property(项, 增量) → pen_change_property
      //
      //   ⚠ 以前 self_change_pen_color / self_change_pen_shade /
      //     self_set_pen_color_property **三个根本没映射**（掉成"参数没解析出来"的桩），
      //     而 self_change_pen_color_property 又被错映射成 pen_change_color ——
      //     和"增加画笔颜色"抢了同一个签名，结果 scope 被截掉、只剩下增量。
      case 'self_change_pen_color':
        return { k: 'pen_change_color', value: this.valueAny(blockId, ['steps', 'value', 'VALUE']) };
      case 'self_change_pen_shade':
        return { k: 'pen_change_shade', value: this.valueAny(blockId, ['steps', 'value', 'VALUE']) };
      case 'self_set_pen_color_property':
        return {
          k: 'pen_color_property',
          prop: String(this.field(block, 'scope', '')),
          value: this.valueAny(blockId, ['val', 'value', 'steps', 'VALUE'])
        };
      case 'self_change_pen_color_property':
      case 'self_change_pen_color_property_2': {
        // ★加减号在 increase 字段里★
        //   实测（_dev/probe_pen_fields.js 扫全量）：scope=hue, increase=increase；
        //   和「把 <特效> 增加 <值>」那块是同一个套路 —— 值一律正数，符号单独给。
        var inc = String(this.field(block, 'increase', 'increase')).toLowerCase();
        return {
          k: 'pen_change_property',
          prop: String(this.field(block, 'scope', '')),
          sign: (inc.indexOf('decrease') >= 0 || inc.indexOf('减') >= 0) ? -1 : 1,
          value: this.valueAny(blockId, ['steps', 'value', 'VALUE'])
        };
      }
      // ★这两个块**不是**落笔 / 抬笔★
      //   K4 源码（kitten.*.js 的 47954 / 47962 行）：
      //     pen_begin_path → start_fill_path()：开始记录填充路径 —— 挂上角色 change 监听，
      //                      角色每移动一次就记一个点，**起点 = 角色当前位置**（不需要落笔！）
      //     pen_close_path → end_fill_path()：把记录的点连成**闭合路径**后 fill()，
      //                      填充色取 set_fill_style（没设就用画笔色），lineJoin = round
      //   以前这里映射成 pen_down / pen_up —— 于是"填充"实际变成"画一条线"，
      //   用户看到的就是"画笔填充功能没法用"。
      //   `set_pen_path`（下拉选 起点/终点）是同一行为的另一个入口，见它上面的 case。
      case 'pen_begin_path':
        return { k: 'fill_path', point: 'start_point' };
      case 'pen_close_path':
        return { k: 'fill_path', point: 'end_point' };

      // 图层
      // 图层：K4 是**四档**下拉（用户截图：移至 最上层 / 最下层 / 上一层 / 下一层）
      //   实测 fields.layer = peak | bottom | previous_level | next_level
      //   ⚠ 以前这里只用一条正则区分"前 / 后"，四档被压成两档：
      //     上一层和下一层都落到 -1（= 跑到最下层），"上下移一层"完全失效。
      case 'set_theatre_layer':
      case 'set_layer': {
        var layerField = String(this.field(block, 'layer', 'peak')).toLowerCase();
        // 最上层 / 最下层 → 移到图层(±1)（一步到位）
        if (/top|peak|front|最上|最前/.test(layerField)) return { k: 'layer', dir: 1 };
        if (/bottom|back|最下|最后/.test(layerField)) return { k: 'layer', dir: -1 };
        // 上一层 / 下一层 → 图层前后移(±1)（相对移动一层）
        if (/previous|prev|上一层|前移/.test(layerField)) return { k: 'layer_move', value: num(1) };
        if (/next|下一层|后移/.test(layerField)) return { k: 'layer_move', value: num(-1) };
        return { k: 'layer', dir: 1 };
      }
      case 'self_change_layer':
        return { k: 'layer_move', value: this.value(blockId, 'n') };
      case 'set_layer_with_pen': {
        // 「移到画笔图层 <上方 / 下方>」
        // 字段 position = "above" / "below"（实测 _dev/probe_block_raw.js）
        return {
          k: 'layer_with_pen',
          position: String(this.field(block, 'position', 'above')).toLowerCase()
        };
      }

      // 侦测 / 输入
      case 'set_timer_state': {
        // K4 这个积木的 actions 只有三种取值（已在 4 个样例里核对过）：
        //   start / stop / reset
        var act = String(this.field(block, 'actions', 'start')).toLowerCase();
        var tk = 'timer_reset';
        if (act.indexOf('stop') >= 0 || act.indexOf('pause') >= 0) tk = 'timer_stop';
        else if (act.indexOf('start') >= 0 || act.indexOf('resume') >= 0) tk = 'timer_start';
        return { k: tk };
      }
      case 'ask_and_choose': {
        // ★选项个数是**动态**的：K4 按用户实际填了几个选项生成 CHOICE0..CHOICEn★
        //   实测（Phigros模拟器v2.5）：有一个块同时有 CHOICE0/1/2/3（4 个选项），
        //   而这里以前**写死只取 CHOICE0 和 CHOICE1** —— 第 3、4 个选项被静默丢掉，
        //   玩家永远选不到（询问界面上只剩前两项，选对了也判错）。
        //   改成按 inputNames 里实际存在的 CHOICEn 收集，并按**序号排序**
        //   （依赖对象键序会错位：CHOICE10 会排到 CHOICE2 前面）。
        var 选名 = this.inputNames(blockId, block)
          .filter(function (n) { return /^CHOICE\d+$/.test(n); })
          .sort(function (a, b) { return parseInt(a.slice(6), 10) - parseInt(b.slice(6), 10); });
        var 选值 = [];
        for (var ci = 0; ci < 选名.length; ci++) 选值.push(this.value(blockId, 选名[ci]));
        return {
          k: 'ask_choose',
          question: this.value(blockId, 'question'),
          choices: 选值,
          body: S('DO')
        };
      }

      // 克隆体
      case 'dispose':
      case 'dispose_clone':
        return { k: 'destroy_self' };
      case 'mirror': {
        // ★K4 的「克隆」块带一个 **sprite 字段**，可以指定克隆谁★
        //     "__self"  -> 克隆自己
        //     实体 uuid -> **克隆那个角色**（Scratch 的 "create clone of <sprite>"）
        // 以前这里一律返回 clone_self —— 于是 射击生存 里"克隆 炮弹"被生成成
        // `角色.克隆自己()`，克隆出来的是**射击辅助器**，而它没有
        // 「当作为克隆体启动时」脚本 → 点了鼠标什么也射不出去。
        // （实测该工程 3 个 mirror：1 个 __self、2 个 uuid。）
        var sp = String(this.field(block, 'sprite', '__self') || '__self');
        if (sp === '' || sp === '__self') return { k: 'clone_self' };
        return { k: 'clone_target', target: this.目标字段(block, 'sprite') };
      }

      /* ---- 云变量 / 云列表：Godot 端用本地持久化做等价替代 ---- */
      case 'cloud_variables_set': {
        // 名字字段里存的是 **uuid**，要换回中文名
        // （以前直接 String() 出来，生成 `云变量设置("n749e60b5_…")`）
        var cname = this.cloudName(block);
        var cmethod = String(this.field(block, 'method', 'set')).toLowerCase();
        // Kitten4 的输入名是 VALUE（小写 value / n 是 Scratch 写法）；
        // 以前写成 `A('value') || A('n') || A('VALUE')`，第一个就命中不了，
        // 而 A() 返回的 num(0) 是对象、永远 truthy，后面的名字全成了死代码。
        var cval = this.valueAny(blockId, ['VALUE', 'value', 'n']);
        if (cmethod === 'increase' || cmethod === 'decrease') {
          if (cmethod === 'decrease') cval = op('neg', [cval]);
          return { k: 'cloud_change', name: cname, value: cval };
        }
        return { k: 'cloud_set', name: cname, value: cval };
      }
      case 'cloud_lists_append':
        return { k: 'cloud_list_append', name: this.cloudName(block), value: this.valueAny(blockId, ['VALUE']) };
      // ★「插入 <值> 到 云列表 的第 <n> 项」★
      //   ⚠ 以前和 append 共用同一个分支 → 生成的是"加到末尾"，
      //     选"第 4 项"的积木永远插在最后（用户图 2 里的「插入 33 到 云列表 的第 4 项」）。
      case 'cloud_lists_insert_value':
        return op('cloud_list_insert', [
          str(this.cloudName(block)),
          this.valueAny(blockId, ['INDEX']),
          this.valueAny(blockId, ['VALUE'])
        ]);
      // 「将云变量 <名> 增加 / 减少 <n>」
      //   实测 fields = { method: increase | decrease, valname: uuid }，值在 shadows.n
      //   ⚠ 这里必须产出**对象形态** {k:'cloud_change', name, value} ——
      //     cloud_change 在 emit 的 ARG 表里登记的是 ['name','value']，
      //     用 op('cloud_change', [名, 值]) 的话 ARG 表会去读 stmt.name / stmt.value
      //     （都不存在）→ 生成 `云变量增加(0.0, 0.0)`，名字和值一起丢。
      case 'change_cloud_variable': {
        var cval2 = this.valueAny(blockId, ['n', 'VALUE', 'value']);
        if (String(this.field(block, 'method', 'increase')).toLowerCase() === 'decrease') {
          cval2 = op('neg', [cval2]);
        }
        return { k: 'cloud_change', name: this.cloudName(block), value: cval2 };
      }
      // 「删除 云列表 <名> 的 <第 n 项 / 最后一项 / 所有项>」
      //   实测 fields.TYPE = nth | last | all；索引输入名是 INDEX
      case 'cloud_lists_delete':
        return op('cloud_list_delete', [
          str(this.cloudName(block)),
          str(String(this.field(block, 'TYPE', 'nth')).toLowerCase()),
          this.valueAny(blockId, ['INDEX', 'ITEM'])
        ]);
      // 「替换 云列表 <名> 的 <第 n 项 / 最后一项> 为 <值>」
      //   实测 fields.TYPE + shadows = { INDEX, ITEM(空), IS(空), VALUE }
      //   ⚠ 以前读 ITEM / IS 两个**空影子** → 报两条"输入名对不上"，索引和值都退化成 0
      case 'cloud_lists_replace':
        return op('cloud_list_replace', [
          str(this.cloudName(block)),
          str(String(this.field(block, 'TYPE', 'nth')).toLowerCase()),
          this.valueAny(blockId, ['INDEX', 'ITEM']),
          this.valueAny(blockId, ['VALUE'])
        ]);
      // 「显示 / 隐藏 变量 <名>」——实测 fields = { FUNC: show|hide, VAR: 变量 uuid }
      //   注意三者的 VAR 指向**不同的表**：普通变量 / 列表 / 云变量
      case 'show_hide_variable':
        return op('show_hide_var', [
          str(this.varName(String(this.field(block, 'VAR', '')))),
          str(String(this.field(block, 'FUNC', 'show')).toLowerCase())
        ]);
      case 'show_hide_list':
        return op('show_hide_list', [
          str(this.listName(String(this.field(block, 'VAR', '')))),
          str(String(this.field(block, 'FUNC', 'show')).toLowerCase())
        ]);
      case 'show_hide_cloud_variable':
        return op('show_hide_var', [
          str(this.cloudName(block)),
          str(String(this.field(block, 'FUNC', 'show')).toLowerCase())
        ]);
      // 「显示 / 隐藏 排行榜」—— K4 的排行榜就是**某个云变量**的展示
      //   实测 show_ranking 的 fields.VAR 指向"私有云变量"那张 uuid
      case 'show_ranking':
        return op('show_ranking', [str(this.cloudName(block))]);
      case 'hide_ranking':
        return op('hide_ranking', []);

      /* ---- MIDI 演奏（Godot 端无内置 MIDI 合成器）---- */
      case 'midi_play_num_note':
        return this.stubStmt(blockId, block);

      /* ---- 物理引擎积木（Godot 端未内置 Box2D，按提示占位）---- */
      case 'physics2_set_texture':
      case 'physics2_set_mass':
      case 'physics2_set_boundary':
      case 'physics2_allow_rotate':
      case 'physics2_set_flexibility':
      case 'physics2_enable_force':
      case 'physics2_set_resilience':
      case 'physics2_set_roughness':
      case 'physics2_set_speed':
      case 'physics2_set_gravity':
      case 'physics2_set_force':
      case 'physics2_set_actor_as':
      case 'allow_rotate':
      case 'set_velocity':
      case 'self_enable_physics':
      case 'self_disable_physics':
      case 'self_set_mass':
      case 'self_set_gravity':
      case 'self_set_friction':
      case 'self_set_air_friction':
      case 'self_set_static_friction':
        return this.stubStmt(blockId, block);

      /* ---- 外观补充 ---- */
      case 'self_set_effect_2':
      case 'self_set_effect':
        return {
          k: 'set_effect',
          scope: String(this.field(block, 'scope', '1')),
          value: this.value(blockId, 'val') || this.value(blockId, 'value')
        };
      // 「把 <特效> 增加 <值>」（K4 的 self_change_effect_3）
      //   ★K4 把**减号放在 increase 字段里**（increase / decrease），值一律是正数★
      //   以前没映射这一块，它掉进 default 变成"参数没解析出来"的桩 ——
      //   于是"把亮度增加 10"这类积木在生成工程里静默无效。
      //   实测（_dev/probe_effect.js）：游戏-空白作品 里 self_change_effect_3 有 70+ 处。
      case 'self_change_effect_3':
      case 'self_change_effect': {
        var inc = String(this.field(block, 'increase', 'increase')).toLowerCase();
        var 减 = inc.indexOf('decrease') >= 0 || inc.indexOf('减') >= 0;
        return {
          k: 'change_effect',
          scope: String(this.field(block, 'scope', '1')),
          sign: 减 ? -1 : 1,
          // ⚠ 值放在 **shadows.steps** 里（实测：self_change_effect_3 的 shadadows 键
          //   就叫 "steps"，不是 val/value）。以前只找 val/value → 永远读不到，
          //   于是"增加特效"的增量恒为 0。
          value: this.valueAny(blockId, ['steps', 'val', 'value', 'VALUE'])
        };
      }
      case 'show_hide_timer':
        return this.stubStmt(blockId, block);
      case 'get_choice_or_index':
        return this.stubStmt(blockId, block);

      // 自定义积木
      case 'procedures_2_callnoreturn':
      case 'procedures_callnoreturn': {
        var route = this.procRoute(block);
        var cnn = route.name || '(未命名)';
        if (route.kind === 'remote') {
          return { k: 'call_remote', name: cnn, owner: route.owner, args: this.callArgs(block).args };
        }
        return { k: 'call', name: cnn, args: this.callArgs(block).args };
      }
      case 'procedures_2_return_value':
      case 'procedures_return':
        return { k: 'return', value: A('VALUE') };

      case 'timer_reset':
      case 'sensing_resettimer':
      case 'reset_timer':
        return { k: 'timer_reset' };

      case 'stop': {
        // ★K4 的「停止」用 `fields.scope`，取值是数字 1 / 2 / 3★
        //   实测（18 个样本，_k4tmp_probe/probe_raw.js）：fields.scope = "1" / "2" / "3"。
        //   以前读的是 `STOP_OPTION`（K4 里根本没有这个字段）→ 永远落到默认 'all'，
        //   于是「停止 [这个脚本]」和「停止 [这个角色]」全都变成"停止全部"。
        //   运行时（自带积木.停止）认的是 all / this / others，所以这里翻译过去。
        var sc = String(this.field(block, 'scope', '1')).trim();
        var 选项 = 'all';
        // ★K4 的「停止」是**四档**下拉**（用户截图确认）：
        //     1 = 全部脚本            2 = 当前脚本
        //     3 = 当前角色的其他脚本   0 = 其他角色的脚本
        //   ⚠ 注意第 4 档的取值是 **"0"**，不是 "4" —— 实测（积木对查表测试_1）：
        //     同一角色下 4 个 stop 块的 scope 依次是 3 / 2 / 1 / **0**，
        //     而截图里那 4 项的顺序正是 全部 / 当前 / 当前角色的其他 / 其他角色的。
        //   ⚠ 以前这里只认到 3 档（注释写"实测 18 个样本只有 1/2/3"），
        //     "0" 落到默认值变成"停止全部" —— 于是"停其他角色"和"停全部"行为一样。
        //   ⚠ 顺带：第 3 档的语义也不是"其他角色"，而是"**当前角色的**其他脚本"。
        if (sc === '2' || sc === 'this' || sc === 'this_script') 选项 = 'this';
        else if (sc === '3' || sc === 'others' || sc === 'other') 选项 = 'others';
        else if (sc === '0' || sc === '4' || sc === 'other_sprites' || sc === 'all_others' || sc === 'others_all') 选项 = 'other_sprites';
        return { k: 'stop', option: 选项 };
      }
      case 'terminate':
        return { k: 'stop', option: 'all' };
      case 'set_scene_transition': {
        // ★K4 的「设置 屏幕切换特效为 <方向> <效果>」★（用户截图 + 字段实测确认）
        //   实测 fields：
        //     transition = "slide"(移入) | "bounce"(弹出) | "fadeInOut"(渐显)
        //                | "distrot"(扭曲，K4 自己拼错的) | "none"(无效果)
        //     direction  = "up" | "down" | "left" | "right"（只有 slide/bounce 才带）
        //   以前这个类型**没有任何分支** → 生成 `# 未映射积木类型` + pass。
        //   实现链路：自带积木.设置屏幕切换特效() → 画布调度.设置转场()（转场层挂在
        //   autoload 上，否则 change_scene_to_file 会把转场节点一起销毁）。
        return op('set_scene_transition', [
          str(String(this.field(block, 'transition', 'none') || 'none').toLowerCase()),
          str(String(this.field(block, 'direction', 'up') || 'up').toLowerCase())
        ]);
      }
      case 'restart':
        return { k: 'restart' };
      case 'destruct':
        return { k: 'destroy_self' };
      case 'warp':
        return { k: 'warp', body: S('DO') };

      case 'clone': {
        // ★K4 的「分裂 <角色> 到 x:<x> y:<y>」★（用户截图 + 字段实测确认）
        //   实测字段：fields.sprite = 目标角色 uuid；shadows.x / shadows.y = 落点。
        //   ⚠ 以前这里读的是 `TARGET` —— K4 的 clone 块**根本没有这个输入**，
        //     于是 target 恒为 0，x/y 虽然读到了却没往下传（emit 的 clone 分支不吃它们），
        //     生成出来是 `await 角色.克隆自己()`：**落点丢失 + 语义整个错**。
        //   用户注释原话："分裂是深度复制，像普通角色一样，**不是克隆体**" ——
        //   所以它和 mirror（克隆）是两件事，单独走 自带积木.分裂()。
        var sp = String(this.field(block, 'sprite', '__self') || '__self');
        return {
          k: 'split',
          target: sp === '__self' ? '' : this.entityName(sp),
          x: this.valueAny(blockId, ['x', 'X']),
          y: this.valueAny(blockId, ['y', 'Y'])
        };
      }

      case 'tell':
      case 'sync_tell': {
        // 目标角色名（无目标 => 自己）
        // Kitten4 放在 **字段 sprite** 里（实体 uuid，要换回名字），不是输入 TARGET；
        // 以前读 TARGET 读不到，textish 拿到 num(0) 后变成字符串 "0"，
        // 于是注册出一个「发给名叫 0 的角色」的假过程。
        var tgt = '';
        var spField = this.field(block, 'sprite', '');
        if (spField) tgt = this.entityName(spField);
        if (!tgt) tgt = this.textish(this.valueAny(blockId, ['TARGET', 'sprite']));
        if (tgt === '0') tgt = '';       // 兜底：num(0) 的字符串形态不是角色名
        var body = S('DO');
        var pname = this.registerTellProc(body, tgt);
        return {
          k: t === 'sync_tell' ? 'tell_sync' : 'tell',
          target: tgt,
          proc: pname
        };
      }

      /* ---- 运动 ---- */
      case 'self_move_steps':
      case 'motion_movesteps':
        return { k: 'move_steps', steps: A('STEPS') };
      case 'self_change_coordinate':
        return {
          k: 'change_coord',
          axis: String(this.field(block, 'coordinary', this.field(block, 'axis', 'x'))).toLowerCase(),
          delta: A('value'),
          sign: String(this.field(block, 'increase',
            this.field(block, 'set_increase',
              this.field(block, 'direction', 'increase')))).toLowerCase()
        };
      case 'self_set_coordinate':
        return {
          k: 'set_coord',
          axis: String(this.field(block, 'coordinary', 'x')).toLowerCase(),
          value: A('value')
        };
      case 'self_glide_coordinate': {
        // ★K4 的「滑行坐标」：在 <时间> 秒内把 <x/y> 坐标 <增加/减少> <值>★
        //   结构和上面 self_change_coordinate（「把 x 坐标增加 N」）**完全同族**：
        //     fields = { coordinary: "x"|"y", increase: "increase"|"decrease" }
        //     inputs = { time: 秒数, value: 增量 }
        //   只多一个 time，而且要求"边移动边等"（阻塞式滑行）。
        //   ⚠ 它是**语句块**，必须挂在 stmt() 上 ——
        //     挂到 value()（取值路径）上永远不会被走到，只会继续落进
        //     `未支持的语句积木` + 类型层桩（实参打包成数组，运行时什么也不做）。
        //   实参顺序对应 methodtable 的 OP_METHODS.self_glide_coordinate
        //   （轴 / 方向 / 时间 / 值），实现见 自带积木.滑行坐标()：Tween + await。
        return op('self_glide_coordinate', [
          str(String(this.field(block, 'coordinary', this.field(block, 'axis', 'x'))).toLowerCase()),
          str(String(this.field(block, 'increase', 'increase')).toLowerCase()),
          A2(['time', 'TIME']),
          A2(['value', 'VALUE'])
        ]);
      }
      case 'motion_gotoxy':
        return { k: 'goto_xy', x: A('X'), y: A('Y') };
      case 'self_set_rotation':
      case 'motion_pointindirection':
        return { k: 'set_rotation', value: A('VALUE') || A('DIRECTION') };
      case 'self_change_rotation':
      case 'motion_turnright':
      case 'motion_turnleft':
        return { k: 'change_rotation', delta: A('VALUE') || A('DEGREES') };
      case 'motion_pointtowards':
        return { k: 'point_towards', target: A('TOWARDS') };
      case 'motion_goto':
        return { k: 'goto_target', target: A('TO') };
      case 'self_bounce':
        return { k: 'bounce' };
      case 'set_scale':
      case 'self_set_scale':
        // ★实测修正（_dev/probe_block_raw.js 游戏-空白作品.bcm4）★
        //   ①块类型是 `set_scale`（不是 `self_set_scale`）
        //   ②值在 `shadows.scale`（不是 VALUE）
        //   以前两条都写错 → 这些语句保留了原始 type → emit 按 type 落到
        //   TYPE_METHODS 的桩「设置大小_外观」→ 只打印一句 _桩提醒就不管了。
        //   症状：空白作品里 **102 处**「设置大小为 X%」全部静默失效（角色大小全不对）。
        return { k: 'set_scale', value: A('scale') || A('VALUE') };

      /* ---- 外观 ---- */
      case 'self_show':
        return { k: 'show' };
      case 'self_hide':
        return { k: 'hide' };
      case 'self_set_visible':
        return { k: 'set_visible', value: A('VALUE') };
      case 'self_set_opacity':
        return { k: 'set_opacity', value: A('VALUE') };
      case 'self_change_opacity':
        return { k: 'change_opacity', value: A('VALUE') };
      case 'self_set_costume':
        return { k: 'set_costume', value: A('VALUE') };
      case 'looks_say':
        return { k: 'say', text: A('MESSAGE') };
      case 'looks_sayforsecs':
        return { k: 'say_for', text: A('MESSAGE'), seconds: A('SECS') };
      case 'looks_think':
        return { k: 'think', text: A('MESSAGE') };
      case 'looks_thinkforsecs':
        return { k: 'think_for', text: A('MESSAGE'), seconds: A('SECS') };
      // ★ Kitten4 的「移动 N 步 / 后退 N 步」★
      // 这两个块**不是**"移到图层"，以前错映射成 layer，
      // 生成出来的 `角色.移到图层(1.0)` 把步数整个丢掉了。
      //
      // 证据（新的作品的舞台）：原始积木只有 4 个 ——
      //   start_on_click → repeat_forever → self_go_forward(steps = -2) + math_number(-2)
      // 而 K4 编辑器里这个角色的脚本正是「当开始被点击 / 重复执行 / 移动 -2 步」。
      // 另外 self_go_forward 的输入名叫 steps（普通数值输入），
      // 而真正的图层块 self_change_layer / set_layer 用的是 layer / n 字段，两者完全不同。
      case 'self_go_forward':
        return { k: 'move_steps', steps: A('steps') || A('STEPS') };
      case 'self_go_backward': {
        // 后退 = 朝反方向移动：步数取负（move_steps 内部按 cos/sin 前进）
        var back = A('steps') || A('STEPS');
        return { k: 'move_steps', steps: back ? op('neg', [back]) : null };
      }

      /* ---- 声音 ---- */
      case 'sound_play':
      case 'self_play_audio': {
        var mode = String(this.field(block, 'sound_play', this.field(block, 'MODE', 'once'))).toLowerCase();
        var wait = mode.indexOf('wait') >= 0 || mode === 'once_wait';
        return { k: 'play_sound', sound: A('sound_id') || A('SOUND'), wait: wait };
      }
      case 'sound_stop_all':
      case 'self_stop_audio':
        return { k: 'stop_sound' };
      case 'sound_set_volume':
        return { k: 'set_volume', value: A('VALUE') };
      case 'sound_change_volume':
        return { k: 'change_volume', value: A('VALUE') };

      /* ---- 画笔 ---- */
      case 'pen_clear':
        return { k: 'pen_clear' };
      case 'pen_penDown':
        return { k: 'pen_down' };
      case 'pen_penUp':
        return { k: 'pen_up' };
      case 'pen_setPenColorToColor':
        return { k: 'pen_color', value: A('COLOR') };
      case 'pen_setPenSizeTo':
        return { k: 'pen_size', value: A('SIZE') };
      case 'pen_stamp':
        return { k: 'pen_stamp' };

      /* ---- 数据 ---- */
      // 注：`variables_set` / `variables_change` / `lists_add` / `lists_delete` /
      //     `lists_replace` 这些 K4 原生类型**在上面（第 17xx 行那批）已经处理过** ——
      //     那里会用 varName()/listArgName() 把 uuid 解析成中文名、还会读 first/last/all
      //     下拉。这里只保留 Scratch 别名（data_*）与另外几个没有重复的类型；
      //     以前在这后面又抄了一份原生类型的 case，全是**不可达死代码**（已删）。
      case 'data_addtolist':
        return { k: 'list_add', name: this.listArgName(blockId, block), value: this.valueAny(blockId, ['VALUE', 'ITEM']) };
      case 'data_deleteoflist':
        return { k: 'list_delete', name: this.listArgName(blockId, block), index: A('INDEX') };
      case 'lists_delete_all':
      case 'data_deletealloflist':
        return { k: 'list_clear', name: this.listArgName(blockId, block) };
      case 'lists_insert':
      case 'data_insertatlist':
        return { k: 'list_insert', name: this.listArgName(blockId, block), index: A('INDEX'), value: A('ITEM') };
      case 'data_replaceitemoflist':
        return { k: 'list_replace', name: this.listArgName(blockId, block), index: A('INDEX'), value: A('ITEM') };
      case 'lists_show':
        return { k: 'list_show', name: this.listArgName(blockId, block) };
      case 'lists_hide':
        return { k: 'list_hide', name: this.listArgName(blockId, block) };

      /* ---- 事件 / 广播 ---- */
      case 'event_broadcast':
        return { k: 'broadcast', message: A('BROADCAST_INPUT') || A('MESSAGE') };
      case 'event_broadcastandwait':
        return { k: 'broadcast_wait', message: A('BROADCAST_INPUT') || A('MESSAGE') };

      /* ---- 过程 ---- */
      // 注：`procedures_callnoreturn`（K4 原生）在上面已经处理（会走 procRoute
      //     判 local/remote）—— 这里不再重复，只留过程定义块。

      /* ---- 过程定义（顶层，不是语句） ---- */
      case 'procedures_2_defnoreturn':
      case 'procedures_defnoreturn':
      case 'procedures_defreturn':
        return { k: 'nop' };

      default:
        break;
    }

    // ★由 emit.js 的 stmtLines 按 type 直接实现的块**不算未支持**★
    //   `switch_to_screen` → `角色.切换屏幕(<屏幕实参>)`（屏幕实参见 emit 的 screenArg）。
    //   以前这里会跟着 warn 一句"未支持的语句积木"，报告里看着像没实现 —— 实测误导过一轮。
    if (t !== 'switch_to_screen') {
      this.warn('未支持的语句积木 "' + t + '"（已生成类型层方法调用桩）');
    }
    return this.stubStmt(blockId, block);

    function unused() { return S; }
  };

  /** 语句输入 -> IR 列表 */
  Decompiler.prototype.blockBody = function (blockId, inputName) {
    var entry = this.model.statementEntry(blockId, inputName);
    if (!entry) return [];
    return this.chain(entry);
  };

  /** 语句链 -> IR 列表（展开 next 连接） */
  Decompiler.prototype.chain = function (entryId) {
    var out = [];
    var ids = this.model.statementChain(entryId);
    for (var i = 0; i < ids.length; i++) {
      var s = this.stmt(ids[i]);
      // ★把源块的 blockId 带进 IR★
      //   生成器用它写 `# 原积木: 名字 @id` 注释 —— 有了 id 才能把**源文件里的每一个块**
      //   和生成代码逐一对上（"积木对查表"就靠这个）。
      //   以前只有 stub 分支自己带了 blockId，其余语句的注释都没有 id，
      //   于是"这块积木到底生成了什么"只能靠肉眼认名字。
      if (s && typeof s === 'object' && s.blockId === undefined) s.blockId = ids[i];
      out.push(s);
    }
    return out;
  };

  /* ------------------------------------------------------------------ */
  /* 事件（帽子块）                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * 帽子块（事件入口）。
   * 上半部分是 Kitten4 真实使用的名字（已用 7 个官方样例工程统计确认）；
   * 下半部分是 Scratch/推断名，保留兼容。
   */
  var HAT_TYPES = {
    /* --- Kitten4 真实帽子 --- */
    start_on_click: { kind: 'flag', label: '当开始运行' },
    start_on_click_2: { kind: 'flag', label: '当开始运行' },
    self_listen: { kind: 'message', label: '当收到消息' },
    on_keydown: { kind: 'key', label: '当按下按键' },
    start_as_a_mirror: { kind: 'clone_start', label: '当作为克隆体启动' },
    sprite_on_tap: { kind: 'clicked', label: '当角色被点击' },
    // ★K4 的「当在手机中向 <上/下/左/右> 滑动」★（用户截图确认）
    //   实测字段：fields.type = "up" | "down" | "left" | "right"。
    //   以前**完全没有这个类型** —— 四个方向的滑动事件整块不生成
    //   （在生成目录里连它的 blockId 都搜不到），是"积木对查表"里最扎眼的一处缺口。
    on_swipe: { kind: 'swipe', label: '当在手机中向…滑动' },
    backdrop_on_change: { kind: 'backdrop', label: '当背景切换' },
    // ★「当切换到当前屏幕时」★ —— K4 的块类型是 on_running_group_activated
    //   （运行组被激活）。以前**没登记** → 这个帽子整块丢掉，脚本都不生成
    //   （用户报"当切换到当前屏幕时帽子全丢"就是它）。
    on_running_group_activated: { kind: 'screen', label: '当切换到当前屏幕' },
    when: { kind: 'condition_hat', label: '当满足条件' },
    /* --- Scratch / 推断名 --- */
    event_whenflagclicked: { kind: 'flag', label: '当开始运行' },
    event_whenkeypressed: { kind: 'key', label: '当按下按键' },
    event_whenbroadcastreceived: { kind: 'message', label: '当收到消息' },
    event_whenclicked: { kind: 'clicked', label: '当角色被点击' },
    event_whenthisspriteclicked: { kind: 'clicked', label: '当角色被点击' },
    event_whenstageclicked: { kind: 'clicked', label: '当舞台被点击' },
    event_when_clone_start: { kind: 'clone_start', label: '当作为克隆体启动' },
    event_whenclone: { kind: 'clone_start', label: '当作为克隆体启动' },
    event_whenIstart: { kind: 'clone_start', label: '当作为克隆体启动' },
    event_whengreaterthan: { kind: 'loudness', label: '当响度大于' },
    event_whentimer: { kind: 'timer', label: '当计时器大于' }
  };

  /** K4 里「按键」字段是数字键码（浏览器的 keyCode） */
  //  ★只有字母数字在 ASCII 上与 Godot 一致（65-90 / 48-57），其余**必须查表**★
  //    浏览器 13=回车、37=左方向，而 Godot 的 KEY_ENTER=4194309、KEY_LEFT=4194319。
  //    运行时侧的同一张表在 runtime/全局/按键表.gd（K4键码表），两边要对齐。
  var KEY_CODE_NAMES = {
    '8': 'KEY_BACKSPACE', '9': 'KEY_TAB', '12': 'KEY_CLEAR', '13': 'KEY_ENTER',
    '16': 'KEY_SHIFT', '17': 'KEY_CTRL', '18': 'KEY_ALT', '19': 'KEY_PAUSE',
    '20': 'KEY_CAPSLOCK', '27': 'KEY_ESCAPE', '32': 'KEY_SPACE',
    '33': 'KEY_PAGEUP', '34': 'KEY_PAGEDOWN', '35': 'KEY_END', '36': 'KEY_HOME',
    '37': 'KEY_LEFT', '38': 'KEY_UP', '39': 'KEY_RIGHT', '40': 'KEY_DOWN',
    '42': 'KEY_PRINT', '45': 'KEY_INSERT', '46': 'KEY_DELETE', '93': 'KEY_MENU',
    '112': 'KEY_F1', '113': 'KEY_F2', '114': 'KEY_F3', '115': 'KEY_F4',
    '116': 'KEY_F5', '117': 'KEY_F6', '118': 'KEY_F7', '119': 'KEY_F8',
    '120': 'KEY_F9', '121': 'KEY_F10', '122': 'KEY_F11', '123': 'KEY_F12',
    '144': 'KEY_NUMLOCK', '145': 'KEY_SCROLLLOCK',
    '186': 'KEY_SEMICOLON', '187': 'KEY_EQUAL', '188': 'KEY_COMMA', '189': 'KEY_MINUS',
    '190': 'KEY_PERIOD', '191': 'KEY_SLASH', '192': 'KEY_QUOTELEFT',
    '219': 'KEY_BRACKETLEFT', '220': 'KEY_BACKSLASH', '221': 'KEY_BRACKETRIGHT',
    '222': 'KEY_APOSTROPHE',
    '96': 'KEY_KP_0', '97': 'KEY_KP_1', '98': 'KEY_KP_2', '99': 'KEY_KP_3',
    '100': 'KEY_KP_4', '101': 'KEY_KP_5', '102': 'KEY_KP_6', '103': 'KEY_KP_7',
    '104': 'KEY_KP_8', '105': 'KEY_KP_9', '106': 'KEY_KP_MULTIPLY',
    '107': 'KEY_KP_ADD', '109': 'KEY_KP_SUBTRACT', '110': 'KEY_KP_PERIOD',
    '111': 'KEY_KP_DIVIDE'
  };
  var KEY_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var KEY_DIGITS = '0123456789';
  function keyCodeToName(code) {
    var s = String(code === undefined || code === null ? '' : code).trim();
    if (s === '') return 'KEY_SPACE';
    if (KEY_CODE_NAMES[s]) return KEY_CODE_NAMES[s];
    var n = parseInt(s, 10);
    // 字母：65-90；数字：48-57（这两段与 Godot 的 Key 枚举重合，可直接用）
    if (n >= 65 && n <= 90) return 'KEY_' + KEY_LETTERS.charAt(n - 65);
    if (n >= 48 && n <= 57) return 'KEY_' + KEY_DIGITS.charAt(n - 48);
    if (/^key_/i.test(s)) return s.toUpperCase();
    // 其余原样传出：运行时的 按键表.解析() 会先按 K4 十进制键码查表，
    // 认不出来就不触发（不会退化成"任意键"）
    return s;
  }

  Decompiler.prototype.isHat = function (block) {
    if (!block) return false;
    return Object.prototype.hasOwnProperty.call(HAT_TYPES, block.type);
  };

  Decompiler.prototype.eventOf = function (block) {
    var meta = HAT_TYPES[block.type];
    if (!meta) return null;
    var ev = { kind: meta.kind, label: meta.label, type: block.type, blockId: block.id };
    if (meta.kind === 'key') {
      var rawKey = this.field(block, 'key', this.field(block, 'KEY', 'space'));
      ev.key = keyCodeToName(rawKey);
      ev.keyRaw = String(rawKey);
      // ★K4 的按键帽子有「按下 / 松开」下拉框（fields.key_event_type = down | up）★
      //   实测 18 个样本里 down / up 都出现过。以前没读这个字段 →
      //   「当松开 X 键」也被当成"按下"触发（帽子_按键._input 不区分事件类型）。
      ev.keyEvent = String(this.field(block, 'key_event_type', 'down')).toLowerCase();
    } else if (meta.kind === 'message') {
      // shadow 里的 message 输入，或直接字段
      ev.message = String(this.textish(this.value(block.id, 'message')) ||
        this.field(block, 'MESSAGE', this.field(block, 'message', '')));
    } else if (meta.kind === 'loudness') {
      ev.value = this.value(block.id, 'VALUE');
    } else if (meta.kind === 'condition_hat') {
      // 当满足条件（K4 的 "when" 帽子）
      ev.condition = this.value(block.id, 'condition');
      ev.label = '当满足条件';
      ev.body = this.blockBody(block.id, 'DO');
    } else if (meta.kind === 'backdrop') {
      ev.scene = this.entityName(this.field(block, 'scene', ''));
    } else if (meta.kind === 'clicked') {
      ev.actor = this.entityName(this.field(block, 'actor', '__self'));
      ev.tapType = String(this.field(block, 'type', 'mouse_click'));
    } else if (meta.kind === 'swipe') {
      // 「当在手机中向 <上/下/左/右> 滑动」——方向在 fields.type 里
      ev.direction = String(this.field(block, 'type', 'up')).toLowerCase();
      ev.label = '当在手机中向 ' +
        ({ up: '上', down: '下', left: '左', right: '右' }[ev.direction] || ev.direction) + ' 滑动';
    }
    if (block.disabled === true) ev.disabled = true;
    return ev;
  };

  /* ------------------------------------------------------------------ */
  /* 工程 / 角色 级解析                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * 把某个实体的造型 id 列表翻译成「造型名 -> 文件名」的映射。
   * 生成的 Godot 代码靠它去 assets/styles/ 里找文件；Kitten4 的角色名
   * 通常和造型名不一样，所以必须按 id 查表，不能拿角色名去猜。
   */
  function entityStyles(entity, names, assets) {
    var list = entity.styles || [];
    var byId = {};
    var byName = {};
    var ownFiles = {};      // 造型名 -> res:// 绝对路径
    var ownPivots = {};     // 造型名 -> {x,y} 旋转中心相对图片中心的偏移（像素，x 右 y 下）
    var byFile = {};        // res:// 路径 -> true
    var byIdName = (assets && assets.byIdName) || { styles: {} };
    // 优先按 id 建索引（id 才是工程内唯一的），名字只作为退路
    var fileById = {};
    var pivotById = {};
    if (assets && assets.styles) {
      assets.styles.forEach(function (a) {
        fileById[a.id] = 'res://' + a.path;
        pivotById[a.id] = a.pivot || { x: 0, y: 0 };
      });
    }
    var ids = [];
    for (var i = 0; i < list.length; i++) {
      var raw = list[i];
      var id = typeof raw === 'string' ? raw : (raw && (raw.id || raw.style_id)) || '';
      var nm = '';
      if (typeof raw === 'object' && raw) nm = raw.name || raw.style_name || '';
      if (!nm && assets) nm = byIdName.styles[id] || '';
      if (!nm && names) nm = names.resolve('styles', id);
      if (!nm) nm = id;
      if (id) { byId[id] = nm; ids.push(id); }
      byName[nm] = true;
      // 用 id 定位文件（同一角色内同名造型也不会串）
      var f = fileById[id];
      if (!f) f = fileById[nm];
      if (f) { ownFiles[nm] = f; byFile[f] = true; }
      // ★锚点：K4 的「旋转中心」是**相对图片中心**的像素偏移，x 向右、y 向下
      //   （依据 K4 Ultra 里 pixi 的 pivot = 图宽/2 + custom.x、图高/2 + custom.y）
      var pv = pivotById[id];
      if (pv && (Number(pv.x) || Number(pv.y))) {
        ownPivots[nm] = { x: Number(pv.x) || 0, y: Number(pv.y) || 0 };
      }
    }
    return {
      ids: ids,
      byId: byId,
      names: Object.keys(byName),
      files: ownFiles,
      pivots: ownPivots,
      paths: Object.keys(byFile)
    };
  }

  var PROC_DEF_TYPES = {
    procedures_2_defnoreturn: 1, procedures_2_defreturn: 1,
    procedures_defnoreturn: 1, procedures_defreturn: 1
  };

  /**
   * 扫全部角色，建立「全工程自定义积木注册表」。
   * Kitten4 的自定义积木是跨角色可调用的：调用块的 mutation 里带 def_id，
   * 而 def_id 就是定义块的块 id（已用 19MB 官方示例核对过）。
   */
  function buildProcRegistry(project) {
    var byDefId = {};
    var owners = {};
    var order = project.scenesOrder;
    for (var i = 0; i < order.length; i++) {
      var sc = project.scenes[order[i]];
      if (!sc) continue;
      var ents = [sc].concat(sc.actors || []);
      for (var j = 0; j < ents.length; j++) {
        var ent = ents[j];
        var data = ent.block_data;
        if (!data || !isObj(data.blocks)) continue;
        var ids = Object.keys(data.blocks);
        for (var k = 0; k < ids.length; k++) {
          var b = data.blocks[ids[k]];
          if (!PROC_DEF_TYPES[b.type]) continue;
          var nm = (b.fields && (b.fields.NAME || b.fields.name)) || b.id;
          byDefId[b.id] = { name: String(nm), owner: ent.name, type: b.type };
          if (owners[nm] === undefined) owners[nm] = ent.name;
        }
      }
    }
    return { byDefId: byDefId, owners: owners };
  }

  function parseEntity(raw, kind) {
    var e = {
      kind: kind,
      id: raw.id || '',
      name: raw.name || (kind === 'scene' ? '背景' : '角色'),
      raw: raw,
      x: typeof raw.x === 'number' ? raw.x : 0,
      y: typeof raw.y === 'number' ? raw.y : 0,
      rotation: typeof raw.rotation === 'number' ? raw.rotation : 0,
      scale: typeof raw.scale === 'number' ? raw.scale : 100,
      visible: raw.visible !== false,
      draggable: raw.draggable === true,
      current_style_id: raw.current_style_id || null,
      /** 造型 id -> 造型名（原始名字，例如「空白场景」），由 entityStyles 填充 */
      style_names_raw: {},
      styles: Array.isArray(raw.styles) ? raw.styles : [],
      screen_name: raw.screen_name || '',
      block_data: raw.block_data_json || { blocks: {}, connections: {}, comments: {} },
      is_stage: kind === 'scene'
    };
    // 资源（图片/声音）信息 —— 不同版本字段名不同，做兼容
    e.costumes = collectAssets(raw, ['styles', 'costumes', 'style_list']);
    e.sounds = collectAssets(raw, ['audio', 'sounds', 'audio_list']);
    return e;
  }

  function collectAssets(raw, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = raw[keys[i]];
      if (Array.isArray(v)) {
        return v.map(function (a) {
          if (typeof a === 'string') return { id: a, name: a, url: null };
          return {
            id: a.id || a.style_id || a.audio_id || a.name || '',
            name: a.name || a.style_name || a.audio_name || '',
            url: a.url || a.file || a.md5 || null
          };
        });
      }
    }
    return [];
  }

  /**
   * 解析 K4 工程 JSON -> 规范化工程对象
   */
  function parseProject(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('不是有效的 JSON 工程');
    if (!raw.theatre) throw new Error('缺少 theatre 字段，可能不是 Kitten4 工程文件(.bcm4)');

    var th = raw.theatre;
    var scenesOrder = Array.isArray(th.scenes_order) ? th.scenes_order : [];
    var scenes = {};

    var i;
    if (isObj(th.scenes)) {
      var sids = Object.keys(th.scenes);
      for (i = 0; i < sids.length; i++) {
        var sc = parseEntity(th.scenes[sids[i]], 'scene');
        var actors = [];
        var aorder = Array.isArray(sc.raw.actors) ? sc.raw.actors : null;
        if (isObj(th.actors)) {
          var aids = Object.keys(th.actors);
          for (var j = 0; j < aids.length; j++) {
            var act = parseEntity(th.actors[aids[j]], 'actor');
            if (act.raw.scene_id && act.raw.scene_id !== sc.id) continue;
            if (act.raw.scene && act.raw.scene !== sc.id) continue;
            actors.push(act);
          }
        }
        // ★角色图层的先后 = `scene.group_order`★（K4 里每个角色被包在一个"图层组"里，
        //   group_order 就是 K4 编辑器左侧面板**从上到下**的顺序）。
        //   Godot 里同一父节点下**越靠后添加的画得越上面**，所以这里按它**倒序**排：
        //     group_order[0]（面板最上）→ 排到最后 → 画在最上层 ✓
        //   ⚠ 以前只认 `sc.raw.actors`（K4 导出的那个数组**经常是空数组**），
        //     一旦为空顺序就退回 `theatre.actors` 的键顺序（= 角色创建顺序），
        //     和真实图层无关 —— 于是「移到画笔下方 / 移到图层」这类依赖"谁在谁上面"
        //     的积木结果全错（实测 画笔图层与执行顺序测试：绿盖住了本该压住它的紫）。
        var 组顺序 = (sc.raw && Array.isArray(sc.raw.group_order)) ? sc.raw.group_order : null;
        if ((!aorder || !aorder.length) && 组顺序 && isObj(th.groups)) {
          var 序 = [];
          组顺序.forEach(function (gid) {
            var g = th.groups[gid] || {};
            (Array.isArray(g.actors) ? g.actors : []).forEach(function (aid) { 序.push(aid); });
          });
          if (序.length) {
            actors.sort(function (a, b) {
              var ia = 序.indexOf(a.id), ib = 序.indexOf(b.id);
              if (ia < 0) ia = 序.length;
              if (ib < 0) ib = 序.length;
              return ib - ia;                 // ★倒序★：面板最上 = 最后添加 = 画在最上
            });
          }
        } else if (aorder && aorder.length) {
          actors.sort(function (a, b) {
            return aorder.indexOf(a.id) - aorder.indexOf(b.id);
          });
        }
        sc.actors = actors;
        scenes[sc.id] = sc;
      }
    }

    if (!scenesOrder.length) scenesOrder = Object.keys(scenes);

    if (!Object.keys(scenes).length) {
      throw new Error('工程里没有任何场景（theatre.scenes 为空或缺失），无法转换');
    }

    // ---- 变量 / 列表 ----
    // 已核对 K4 Ultra 打包产物：**顶层键是 `variables`**（不是 `variable`），
    // 而且没有独立的 `list` 顶层键 —— 列表是 variables 里 type==="list" 的条目。
    // 局部变量靠 is_global===false + current_entity 标记归属。
    // （旧版本读的是 raw.variable / raw.list，两个键都不存在，导致变量名从未解析成功、
    //   生成代码里全是 uuid。这里修正。）
    var variables = [];
    var lists = [];
    var vtable = isObj(raw.variables) ? raw.variables : (isObj(raw.variable) ? raw.variable : null);
    if (isObj(vtable)) {
      Object.keys(vtable).forEach(function (k) {
        var v = vtable[k] || {};
        var item = {
          id: k,
          name: v.name || k,
          value: v.value,
          type: v.type || 'any',
          is_global: v.is_global !== false,
          owner: v.current_entity || null
        };
        if (item.type === 'list') lists.push(item); else variables.push(item);
      });
    }
    // 兼容：万一某版本确实另有顶层 list 表
    if (isObj(raw.list)) {
      Object.keys(raw.list).forEach(function (k) {
        var v = raw.list[k] || {};
        var items = v.items || v.value || [];
        if (!Array.isArray(items)) items = items === '' || items === undefined ? [] : [items];
        lists.push({ id: k, name: v.name || k, value: items, type: 'list', is_global: v.is_global !== false, owner: v.current_entity || null });
      });
    }
    // 云变量（也是 uuid -> {name,...}，一并登记，免得积木里出现裸 uuid）
    var cloudVars = [];
    if (isObj(raw.cloud_variables)) {
      Object.keys(raw.cloud_variables).forEach(function (k) {
        var v = raw.cloud_variables[k] || {};
        cloudVars.push({ id: k, name: v.name || k, cvid: v.cvid || '', value: v.value });
      });
    }

    var size = raw.size && typeof raw.size === 'object' ? raw.size : { width: 480, height: 360 };
    var name = raw.project_name || 'k4project';

    // ---- 名称注册表 ----
    // Kitten4 的积木字段里存的是 UUID（变量/列表/角色/声音/造型的 id），
    // 生成可读 GDScript 时必须换回人类可读的名字。
    var names = { vars: {}, lists: {}, actors: {}, audios: {}, styles: {}, scenes: {}, clouds: {}, groups: {} };
    variables.forEach(function (v) { names.vars[v.id] = v.name; });
    lists.forEach(function (l) { names.lists[l.id] = l.name; });
    // 云变量：积木字段里同样存 uuid，不登记的话生成代码里会出现裸 uuid
    // （`云变量设置("n749e60b5_…")` 而不是 `云变量设置("存档")`）
    cloudVars.forEach(function (c) { if (c.id) names.clouds[c.id] = c.name; });
    if (isObj(th.actors)) {
      Object.keys(th.actors).forEach(function (k) {
        var a = th.actors[k];
        names.actors[k] = a.name || k;
      });
    }
    if (isObj(th.scenes)) {
      Object.keys(th.scenes).forEach(function (k) {
        var s = th.scenes[k];
        names.scenes[k] = s.name || k;
      });
    }
    // ★K4 的「角色组」★（theatre.groups —— 用户截图里左侧列表那些「新角色组」）
    //   数据结构：{ id, name, actors: [角色id...], scene, is_group, is_fold, visible }
    //   这是**编辑器层面的角色归类**，但**积木能引用它**
    //   （「将 <新角色组> 在 1 秒内 逐渐显示」的目标就是一个组）。
    //   这里登记组名，并反向算出"每个角色属于哪些组"，供生成器写进角色脚本。
    var actorGroups = {};      // 角色 id -> [组名...]
    if (isObj(th.groups)) {
      Object.keys(th.groups).forEach(function (k) {
        var g = th.groups[k] || {};
        var 组名 = g.name || k;
        names.groups[k] = 组名;
        // is_group === false 的是"单个角色的包装"，不当组用（否则满屏都是单角色组）
        if (g.is_group === false) return;
        (Array.isArray(g.actors) ? g.actors : []).forEach(function (aid) {
          (actorGroups[aid] = actorGroups[aid] || []).push(组名);
        });
      });
    }
    // 声音 / 造型：项目级 audio 表 + 各实体的 styles/audio 列表
    if (isObj(raw.audio)) {
      Object.keys(raw.audio).forEach(function (k) {
        var v = raw.audio[k] || {};
        names.audios[k] = v.name || v.audio_name || k;
      });
    }
    [].concat(
      isObj(th.scenes) ? Object.keys(th.scenes).map(function (k) { return th.scenes[k]; }) : [],
      isObj(th.actors) ? Object.keys(th.actors).map(function (k) { return th.actors[k]; }) : []
    ).forEach(function (ent) {
      ['styles', 'costumes', 'style_list'].forEach(function (f) {
        if (!Array.isArray(ent[f])) return;
        ent[f].forEach(function (s) {
          if (typeof s === 'string') { names.styles[s] = s; return; }
          var id = s.id || s.style_id;
          if (id) names.styles[id] = s.name || s.style_name || id;
        });
      });
      ['audio', 'sounds', 'audio_list'].forEach(function (f) {
        if (!Array.isArray(ent[f])) return;
        ent[f].forEach(function (s) {
          if (typeof s === 'string') { names.audios[s] = s; return; }
          var id = s.id || s.audio_id;
          if (id) names.audios[id] = s.name || s.audio_name || id;
        });
      });
    });
    // 如果某个 id 没登记，至少回退成 id 本身，避免出现 undefined
    names.resolve = function (kind, id) {
      var table = names[kind] || {};
      if (id === undefined || id === null || id === '') return '';
      if (table[id]) return table[id];
      return String(id);
    };

    // 合并索引：uuid -> 名字（各类 id 不会互相冲突，合并安全）
    // 用途：IR 里到处散落着裸 uuid（变量/列表/角色/造型/声音），
    //       统一在一处回填成人类可读名字，避免生成代码里出现 uuid。
    names.any = {};
    ['vars', 'lists', 'actors', 'audios', 'styles', 'scenes', 'clouds'].forEach(function (kind) {
      var t = names[kind] || {};
      Object.keys(t).forEach(function (id) {
        if (names.any[id] === undefined) names.any[id] = t[id];
      });
    });
    names.resolveAny = function (id) {
      if (id === undefined || id === null || id === '') return id;
      var n = names.any[id];
      return n === undefined ? id : n;
    };
    // 变量 / 列表的归属索引（按名字查，供生成器决定"局部成员"还是"全局 autoload"）
    names.varScope = {};   // 名字 -> 'global' | 'local'
    names.listScope = {};
    variables.forEach(function (v) { names.varScope[v.name] = v.is_global ? 'global' : 'local'; });
    lists.forEach(function (l) { names.listScope[l.name] = l.is_global ? 'global' : 'local'; });

    // 把"所属组名"补到每个角色实体上（生成器写 add_to_group("K4组_…") 用）
    Object.keys(scenes).forEach(function (sid) {
      var sc = scenes[sid];
      [sc].concat(sc.actors || []).forEach(function (ent) {
        if (ent && ent.id && actorGroups[ent.id]) ent.groups = actorGroups[ent.id];
      });
    });

    return {
      raw: raw,
      name: String(name),
      version: raw.application_version || String(raw.version || ''),
      work_type: raw.work_type || 'KITTEN',
      size: { width: Number(size.width) || 480, height: Number(size.height) || 360 },
      scenesOrder: scenesOrder,
      scenes: scenes,
      variables: variables,
      lists: lists,
      names: names
    };
  }

  /* ------------------------------------------------------------------ */
  /* IR 名字回填                                                          */
  /*                                                                      */
  /* 反编译过程中，很多积木字段拿到的是**裸 uuid**（变量/列表/角色/造型/   */
  /* 声音的 id）。生成可读 GDScript 之前必须统一换成人类可读名字。         */
  /* 与其在几十个构造点分别处理，不如在这里做一次全树回填。                */
  /* ------------------------------------------------------------------ */

  var UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  function isUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }

  function resolveIRNames(node, names, stats) {
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) resolveIRNames(node[i], names, stats);
      return;
    }
    if (!node || typeof node !== 'object') return;
    var keys = Object.keys(node);
    for (var j = 0; j < keys.length; j++) {
      var key = keys[j];
      var v = node[key];
      if (isUuid(v)) {
        var n = names.resolveAny ? names.resolveAny(v) : v;
        if (n !== v) { node[key] = n; if (stats) stats.resolved++; }
        else if (stats) { stats.unresolved[v] = (stats.unresolved[v] || 0) + 1; }
      } else if (v && typeof v === 'object') {
        resolveIRNames(v, names, stats);
      }
    }
  }

  /** 单个实体的积木工作区 -> 脚本列表 */
  function entityScripts(entity, names, procRegistry) {
    var model = new BlockModel(entity.block_data);
    var dec = new Decompiler({
      names: names,
      procRegistry: procRegistry,
      entName: entity.name
    });
    dec.model = model;
    var scripts = [];
    var tops = model.topLevelIds();

    // 第一遍：收集自定义积木（过程）定义，保证调用点在函数定义之前就被登记
    for (var p = 0; p < tops.length; p++) {
      var pb = model.get(tops[p]);
      if (!pb) continue;
      if (pb.type === 'procedures_defnoreturn' || pb.type === 'procedures_defreturn' ||
        pb.type === 'procedures_2_defnoreturn' || pb.type === 'procedures_2_defreturn') {
        dec.registerProcedure(pb);
      }
    }

    for (var i = 0; i < tops.length; i++) {
      var id = tops[i];
      var block = model.get(id);
      if (!block) continue;
      if (!dec.isHat(block)) continue;
      var ev = dec.eventOf(block);
      if (!ev) continue;
      var body = model.nextId(id) ? dec.chain(model.nextId(id)) : [];
      // 很多帽子（当收到消息 / 当满足条件 / 当作为克隆体启动 …）的主体挂在
      // **语句输入** DO / STACK 上，而不是 next 链上。只读 next 会得到空主体。
      if (!body.length) {
        var viaDo = dec.blockBody(id, 'DO');
        if (viaDo.length) body = viaDo;
      }
      if (!body.length) {
        var viaStack = dec.blockBody(id, 'STACK');
        if (viaStack.length) body = viaStack;
      }
      if (!body.length && ev.body && ev.body.length) body = ev.body;
      scripts.push({ event: ev, body: body, hatId: id });
    }

    // 名字回填：把 IR 里残留的裸 uuid 换成人类可读名字
    var nameStats = { resolved: 0, unresolved: {} };
    for (var s = 0; s < scripts.length; s++) resolveIRNames(scripts[s].body, names, nameStats);
    for (var pi = 0; pi < dec.procs.length; pi++) resolveIRNames(dec.procs[pi].body, names, nameStats);

    return { scripts: scripts, warnings: dec.warnings, model: model, decompiler: dec, nameStats: nameStats };
  }

  /** 统计工程里出现过的所有积木类型（用于覆盖率报告） */
  function collectBlockTypes(project) {
    var counts = {};
    var order = project.scenesOrder;
    for (var i = 0; i < order.length; i++) {
      var sc = project.scenes[order[i]];
      if (!sc) continue;
      var ents = [sc].concat(sc.actors || []);
      for (var j = 0; j < ents.length; j++) {
        var data = ents[j].block_data;
        if (!data || !isObj(data.blocks)) continue;
        var ids = Object.keys(data.blocks);
        for (var k = 0; k < ids.length; k++) {
          var t = data.blocks[ids[k]].type;
          counts[t] = (counts[t] || 0) + 1;
        }
      }
    }
    return counts;
  }

  /**
   * 主入口：K4 工程 JSON -> IR
   * 返回 {project, scenes:[{...entity, scripts:[...]}], warnings, blockTypes, coverage}
   */
  function projectToIR(rawProject) {
    var project = parseProject(rawProject);
    var warnings = [];
    var outScenes = [];
    var order = project.scenesOrder;

    // 素材：默认顺手提取一份元信息（含 id->名字 映射，供变量/造型引用解析）
    var assets = null;
    try {
      assets = extractAssets(rawProject);
      // 把造型/声音的 id->名字 合并进名称注册表：
      // K4 积木与当前造型字段里存的是 uuid，靠它换回可读名字。
      // ⚠ parseProject 会先把 names.styles[id] 预填成 **uuid 自身**（自映射），
      //   于是以前那句 `if (!names.styles[id])` 永远为假 —— 真名字永远进不来，
      //   resolve('styles', uuid) 返回 uuid。症状：生成
      //     await 角色.设置造型("491d26ab-…")   // 一个 uuid，运行时查不到造型
      //   所以这里连"值是 uuid 自己"的情况一起覆盖。
      if (assets && assets.byIdName) {
        Object.keys(assets.byIdName.styles).forEach(function (id) {
          var 现有 = project.names.styles[id];
          if (!现有 || 现有 === id) project.names.styles[id] = assets.byIdName.styles[id];
        });
        Object.keys(assets.byIdName.audios).forEach(function (id) {
          var 现有音 = project.names.audios[id];
          if (!现有音 || 现有音 === id) project.names.audios[id] = assets.byIdName.audios[id];
        });
      }
      if (assets.stats.external) {
        warnings.push('工程里有 ' + assets.stats.external + ' 个素材是外链，需要联网下载');
      }
      assets.warnings.forEach(function (w) { warnings.push(w); });
    } catch (e) {
      warnings.push('素材提取失败: ' + (e && e.message));
    }

    // 全工程自定义积木注册表（跨角色可调用）
    var procRegistry = buildProcRegistry(project);

    for (var i = 0; i < order.length; i++) {
      var sc = project.scenes[order[i]];
      if (!sc) {
        warnings.push('场景 ' + order[i] + ' 未找到定义');
        continue;
      }
      var scOut = toIR(sc, project.names, assets, procRegistry);
      var actorsOut = [];
      for (var j = 0; j < (sc.actors || []).length; j++) {
        actorsOut.push(toIR(sc.actors[j], project.names, assets, procRegistry));
      }
      scOut.actors = actorsOut;
      outScenes.push(scOut);
      warnings = warnings.concat(scOut.warnings || []);
      for (var k = 0; k < actorsOut.length; k++) warnings = warnings.concat(actorsOut[k].warnings || []);
    }

    var blockTypes = collectBlockTypes(project);
    var knownTypes = {};
    if (BLOCKS && BLOCKS.SUPPORTED) {
      Object.keys(blockTypes).forEach(function (t) {
        knownTypes[t] = !!BLOCKS.SUPPORTED[t];
      });
    }

    // ★把「角色组」挂到实体上★（emit 的 emitActorScript 据此写 add_to_group("K4组_…")）
    //   ⚠ 必须在这里补：projectToIR 返回的 `scenes` 是**重新构造**的一套对象
    //     （下面的 outScenes），parseProject 里补的 groups 到不了这一层 ——
    //     上一版就是漏在这里，导致生成的角色脚本里一个 add_to_group 都没有。
    (function () {
      var 组表 = (rawProject && rawProject.theatre && rawProject.theatre.groups) || {};
      var 归属 = {};
      Object.keys(组表).forEach(function (k) {
        var g = 组表[k] || {};
        if (g.is_group === false) return;      // 单角色的包装，不当组用
        (Array.isArray(g.actors) ? g.actors : []).forEach(function (aid) {
          (归属[aid] = 归属[aid] || []).push(g.name || k);
        });
      });
      (outScenes || []).forEach(function (sc) {
        [sc].concat(sc.actors || []).forEach(function (ent) {
          if (ent && ent.id && 归属[ent.id]) ent.groups = 归属[ent.id];
        });
      });
    })();

    return {
      project: project,
      scenes: outScenes,
      warnings: dedupe(warnings),
      blockTypes: blockTypes,
      supported: knownTypes,
      assets: assets,
      procRegistry: procRegistry
    };
  }

  /** 兼容 K4 老版命名（entityScripts 的旧签名） */
  /**
   * 收集「悬空块」（没连到任何事件 / 自定义积木上、不参与运行的块）里的文本。
   *
   * K4 里这类块很常见：用户写了一大段文本、后来换成别的就不再用的，
   * 或者从别处复制过来忘在那儿的。它们**不影响运行**，但里面可能有唯一的数据
   * （用户说"有时作为替换当前运行文本用的"）。
   *
   * 转换器不把它们变成代码（本来就不该运行），而是备份进
   * `<角色>/预备块.gd`（那个脚本**不挂载到任何节点上**），需要时自己复制回去。
   *
   * 只收 `type === 'text'` 且长度 >= 16 的：K4 自带的默认影子
   * （`123` / `abc` / `Hello` / `1,2,3,4`）满工程都是，收进来只是噪音。
   */
  function collectSpareTexts(model) {
    if (!model) return [];
    var 可达 = {};
    var 栈 = [];
    Object.keys(model.blocks).forEach(function (id) {
      var b = model.blocks[id];
      if (!b) return;
      // 入口：帽子块 + 自定义积木定义块（定义块不挂在帽子上）
      if (HAT_TYPES[b.type] || /^procedures_.*def/.test(String(b.type))) 栈.push(id);
    });
    while (栈.length) {
      var id = 栈.pop();
      if (!id || 可达[id]) continue;
      var b = model.blocks[id];
      if (!b) continue;
      可达[id] = 1;
      var own = model.connections[id];
      if (own) Object.keys(own).forEach(function (n) { 栈.push(n); });
      // parent_id 的「子块」：跳过影子（影子只通过连接才可达）
      //   ★这里原来每次都 Object.keys(model.blocks) 全表扫描★ —— DFS 每弹出一个块
      //   就扫一遍全部块（29805 × 29805 ≈ 8.9 亿次迭代 + 巨量数组分配），
      //   是「斗地主转换 40 分钟不结束」的主因。改用预建索引后只需 37 秒。
      if (model.childrenByParent) {
        var bucketE = model.childrenByParent[id];
        if (bucketE) { for (var qE = 0; qE < bucketE.length; qE++) 栈.push(bucketE[qE].id); }
      } else {
        Object.keys(model.blocks).forEach(function (k) {
          var c = model.blocks[k];
          if (c && c.parent_id === id && c.is_shadow !== true) 栈.push(k);
        });
      }
    }
    var 见过 = {};
    var out = [];
    Object.keys(model.blocks).forEach(function (id) {
      if (可达[id]) return;
      var b = model.blocks[id];
      if (!b || b.type !== 'text') return;
      var t = b.fields && b.fields.TEXT;
      // 阈值 16 字：K4 自带的默认影子（`123` / `abc` / `Hello` / `1,2,3,4`）
      // 满工程都是，收进来只是噪音。要全收就把它改成 1。
      if (typeof t !== 'string' || t.trim().length < 16) return;
      if (见过[t]) return;
      见过[t] = 1;
      out.push({ id: id, text: t });
    });
    out.sort(function (a, b) { return b.text.length - a.text.length; });
    return out;
  }

  function toIR(entity, names, assets, procRegistry) {
    var res = entityScripts(entity, names, procRegistry);
    var styleInfo = entityStyles(entity, names, assets);
    // 当前造型：current_style_id 是 uuid，必须先换成造型名
    var currentStyle = '';
    if (entity.current_style_id) {
      if (styleInfo.byId[entity.current_style_id]) {
        currentStyle = styleInfo.byId[entity.current_style_id];
      } else if (names) {
        currentStyle = names.resolve('styles', entity.current_style_id);
      }
    }
    if (!currentStyle && styleInfo.names.length) currentStyle = styleInfo.names[0];
    return {
      kind: entity.kind,
      id: entity.id,
      name: entity.name,
      is_stage: entity.is_stage,
      x: entity.x,
      y: entity.y,
      rotation: entity.rotation,
      scale: entity.scale,
      visible: entity.visible,
      current_style_id: entity.current_style_id,
      styles: entity.styles,
      styleInfo: styleInfo,
      current_style: currentStyle,
      costumes: entity.costumes,
      sounds: entity.sounds,
      scripts: res.scripts,
      procs: res.decompiler.procs,
      warnings: res.warnings,
      model: res.model,
      spare: collectSpareTexts(res.model),
      decompiler: res.decompiler
    };
  }

  function dedupe(arr) {
    var seen = {};
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      if (seen[arr[i]]) continue;
      seen[arr[i]] = true;
      out.push(arr[i]);
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 素材提取                                                            */
  /*                                                                    */
  /* 经核对 7 个官方样例：所有造型/声音都是**内嵌 base64 data URI**，     */
  /* 没有一条外链（113 个造型 + 23 个声音，外链数 0）。                  */
  /* 所以素材可以 100% 离线提取，不需要联网。                            */
  /*                                                                    */
  /* 结构：                                                             */
  /*   raw.theatre.styles[<uuid>] = { id, name, url:"data:image/png;base64,...", */
  /*                                  cdn_url, pivot:{x,y}, rotate_center:{x,y},  */
  /*                                  adaptive }                                 */
  /*   raw.audio[<uuid>]         = { id, name, url:"data:audio/mpeg;base64,...", */
  /*                                  cdn_url, volume, playback_rate, effects }   */
  /* ------------------------------------------------------------------ */

  var MIME_EXT = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/webm': 'webm'
  };

  /** 文件名安全化（保留中文，去掉路径与非法字符） */
  function safeFileName(name, fallback) {
    var s = String(name === undefined || name === null ? '' : name).trim();
    s = s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
    s = s.replace(/\s+/g, '_');
    if (s === '' || s === '.' || s === '..') s = fallback || 'asset';
    return s;
  }

  /** 解析 data URI -> { mime, ext, bytes(Uint8Array), ok } */
  function parseDataUri(uri) {
    if (!uri || typeof uri !== 'string') return null;
    var m = /^data:([^;,]+)?(;charset=[^;,]+)?(;base64)?,(.*)$/s.exec(uri);
    if (!m) return null;
    var mime = (m[1] || 'application/octet-stream').toLowerCase().trim();
    var isB64 = !!m[3];
    var payload = m[4] || '';
    var bytes;
    if (isB64) bytes = base64ToBytes(payload);
    else bytes = textToBytes(decodeURIComponent(payload));
    return {
      mime: mime,
      ext: MIME_EXT[mime] || (mime.split('/')[1] || 'bin').replace(/[^a-z0-9]/g, ''),
      bytes: bytes,
      ok: bytes && bytes.length > 0
    };
  }

  /** 纯 JS base64 解码（Node 与浏览器通用，不依赖 Buffer/atob） */
  var B64CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64ToBytes(b64) {
    var clean = String(b64).replace(/[^A-Za-z0-9+/=]/g, '');
    var len = clean.length;
    while (len > 0 && clean.charAt(len - 1) === '=') len--;
    var outLen = Math.floor(len * 3 / 4);
    var out = new Uint8Array(outLen);
    var buf = 0, bits = 0, p = 0;
    for (var i = 0; i < len; i++) {
      var idx = B64CHARS.indexOf(clean.charAt(i));
      if (idx < 0) continue;
      buf = (buf << 6) | idx;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[p++] = (buf >> bits) & 0xff;
      }
    }
    return p === outLen ? out : out.subarray(0, p);
  }

  function textToBytes(s) {
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }

  /**
   * 从工程里提取全部素材。
   * @returns {{styles:Array, audios:Array, warnings:Array, stats:Object}}
   *   每项：{ id, name, file, dir, mime, ext, bytes, dataUri, cdn, pivot }
   */
  function extractAssets(rawProject) {
    var warnings = [];
    var styles = [];
    var audios = [];
    var used = {};
    var stats = { total: 0, inline: 0, external: 0, empty: 0, failed: 0, bytes: 0 };
    /** id -> 名字，供名称注册表使用（K4 积木里存的是 uuid） */
    var byIdName = { styles: {}, audios: {} };
    /** id -> 拥有者名（按角色分目录，避免不同角色出现同名造型时互相覆盖） */
    var ownerOf = { styles: {}, audios: {} };

    if (!rawProject || typeof rawProject !== 'object') {
      return { styles: styles, audios: audios, warnings: ['输入不是有效工程'], stats: stats };
    }
    var th = rawProject.theatre || {};

    function take(kind, id, entry, dir) {
      stats.total++;
      var name = (entry && entry.name) || id;
      var url = entry && entry.url ? String(entry.url) : '';
      if (url === '') {
        stats.empty++;
        warnings.push(kind + '「' + name + '」没有内嵌数据（url 为空），无法导出');
        return null;
      }
      if (url.indexOf('data:') !== 0) {
        stats.external++;
        warnings.push(kind + '「' + name + '」是外链（' + url.slice(0, 80) +
          '），需要联网下载，本次未导出');
        return null;
      }
      stats.inline++;
      var parsed = parseDataUri(url);
      if (!parsed || !parsed.ok) {
        stats.failed++;
        warnings.push(kind + '「' + name + '」的 data URI 解析失败');
        return null;
      }
      // 按角色分子目录：不同角色可能有同名造型，放同一目录会互相覆盖
      var kindKey = dir === 'assets/sounds' ? 'audios' : 'styles';
      var owner = ownerOf[kindKey][id] || 'common';
      var sub = dir + '/' + owner;
      // 同名文件去重：同一角色目录内重名时加序号
      var base = safeFileName(name, kind + '_' + String(id).slice(0, 8));
      var file = base + '.' + parsed.ext;
      var n = 2;
      while (used[(sub + '/' + file).toLowerCase()] && used[(sub + '/' + file).toLowerCase()] !== id) {
        file = base + '_' + n + '.' + parsed.ext;
        n++;
      }
      used[(sub + '/' + file).toLowerCase()] = id;
      stats.bytes += parsed.bytes.length;
      byIdName[kindKey][id] = String(name);
      var item = {
        id: id,
        name: String(name),
        owner: owner,
        file: file,
        dir: sub,
        path: sub + '/' + file,
        mime: parsed.mime,
        ext: parsed.ext,
        bytes: parsed.bytes,
        size: parsed.bytes.length,
        cdn: (entry && entry.cdn_url) || '',
        pivot: (entry && (entry.pivot || entry.rotate_center)) || null,
        adaptive: !!(entry && entry.adaptive),
        volume: entry && entry.volume !== undefined ? entry.volume : 1,
        playback_rate: entry && entry.playback_rate !== undefined ? entry.playback_rate : 1
      };
      return item;
    }

    var styleMap = th.styles || {};
    var audioMap = rawProject.audio || {};

    /* ---- 先算出每个造型/声音属于哪个角色 ---- */
    // Kitten4 的造型 id 是工程级的，但**不同角色完全可以用同名造型**
    // （「蓝雀」「蓝雀1」在两个角色里都叫这个名字）。按角色分目录才不会互相覆盖。
    var ents = [];
    if (isObj(th.scenes)) {
      Object.keys(th.scenes).forEach(function (k) { ents.push(th.scenes[k]); });
    }
    if (isObj(th.actors)) {
      Object.keys(th.actors).forEach(function (k) { ents.push(th.actors[k]); });
    }
    ents.forEach(function (ent) {
      var who = safeFileName(ent.name || ent.id || 'unknown', 'unknown');
      (ent.styles || []).forEach(function (s) {
        var id = typeof s === 'string' ? s : (s && (s.id || s.style_id));
        if (id && !ownerOf.styles[id]) ownerOf.styles[id] = who;
      });
      ['audio', 'sounds', 'audio_list'].forEach(function (f) {
        if (!Array.isArray(ent[f])) return;
        ent[f].forEach(function (s) {
          var id = typeof s === 'string' ? s : (s && (s.id || s.audio_id));
          if (id && !ownerOf.audios[id]) ownerOf.audios[id] = who;
        });
      });
    });

    Object.keys(styleMap).forEach(function (id) {
      var it = take('造型', id, styleMap[id], 'assets/styles');
      if (it) styles.push(it);
    });
    Object.keys(audioMap).forEach(function (id) {
      var it = take('声音', id, audioMap[id], 'assets/sounds');
      if (it) audios.push(it);
    });

    return {
      styles: styles,
      audios: audios,
      warnings: dedupe(warnings),
      stats: stats,
      byIdName: byIdName
    };
  }

  return {
    parseProject: parseProject,
    projectToIR: projectToIR,
    entityScripts: entityScripts,
    collectBlockTypes: collectBlockTypes,
    extractAssets: extractAssets,
    parseDataUri: parseDataUri,
    base64ToBytes: base64ToBytes,
    safeFileName: safeFileName,
    BlockModel: BlockModel,
    Decompiler: Decompiler,
    HAT_TYPES: HAT_TYPES,
    helpers: { attrOf: attrOf, fieldOf: fieldOf, shadowType: shadowType }
  };
});
