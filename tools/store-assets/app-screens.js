/* 藏币录 · 上架素材页面模板（与 harmony ArkUI 版式一一对应）
   所有数字来自 public/data（137 个品种、2026 马年贺岁、京剧丑角等），
   不虚构发行量 / 面额。 */

const IMG = '../../public/img/';
const img = (n) => IMG + String(n).padStart(3, '0') + '.jpg';

const STATUS = `
<div class="statusbar">
  <div class="time">9:41</div>
  <div class="icons">
    <svg width="18" height="12" viewBox="0 0 18 12" fill="#1C1C1E">
      <rect x="0" y="8" width="3" height="4" rx="1"/>
      <rect x="4.6" y="6" width="3" height="6" rx="1"/>
      <rect x="9.2" y="3.4" width="3" height="8.6" rx="1"/>
      <rect x="13.8" y="0.6" width="3" height="11.4" rx="1"/>
    </svg>
    <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="#1C1C1E" stroke-width="1.5" stroke-linecap="round">
      <path d="M1.4 4.2a9.6 9.6 0 0 1 13.2 0"/>
      <path d="M4 6.9a6 6 0 0 1 8 0"/>
      <circle cx="8" cy="10" r="1.1" fill="#1C1C1E" stroke="none"/>
    </svg>
    <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
      <rect x="0.6" y="0.6" width="20" height="10.8" rx="3" stroke="#1C1C1E" stroke-opacity=".38" stroke-width="1.2"/>
      <rect x="2.4" y="2.4" width="13" height="7.2" rx="1.8" fill="#1C1C1E"/>
      <path d="M22.2 4.2v3.6a2 2 0 0 0 0-3.6z" fill="#1C1C1E" fill-opacity=".4"/>
    </svg>
  </div>
</div>`;

const TAB = (active) => {
  const items = [
    ['首页', '<path d="M3 10.2 11 3.4l8 6.8V19a1.2 1.2 0 0 1-1.2 1.2h-4.3v-5.6H8.5v5.6H4.2A1.2 1.2 0 0 1 3 19z"/>'],
    ['计划', '<rect x="3.2" y="4.6" width="15.6" height="14.2" rx="2.4"/><path d="M3.2 9h15.6M7.4 2.6v4M14.6 2.6v4"/>'],
    ['清单', '<path d="M4 5.6h13M4 11h13M4 16.4h9"/>'],
    ['我的', '<circle cx="11" cy="8" r="3.4"/><path d="M4.6 19.2c.6-3.4 3.2-5.4 6.4-5.4s5.8 2 6.4 5.4"/>']
  ];
  return `<div class="tabbar">` + items.map(([label, path], i) => `
    <div class="tab ${i === active ? 'on' : ''}">
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor"
        stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg>
      <span>${label}</span>
    </div>`).join('') + `</div>`;
};

const SCREENS = {};

/* ---------------- 1. 首页 ---------------- */
SCREENS.home = `
<div class="scr">
  ${STATUS}
  <div class="page">
    <div class="hero">
      <div class="l">
        <div class="name">藏币录</div>
        <div class="sub">中国纪念币图鉴</div>
        <div class="meta">1984—2026 · 137 个品种</div>
        <div class="btn">复制分享链接</div>
      </div>
      <img class="coin" src="${img(132)}" alt="">
    </div>

    <div class="card ledger">
      <div class="top">
        <span class="k">我的收藏</span>
        <span class="v">43</span><span class="tot">/ 137</span>
      </div>
      <div class="track"><i style="width:31.4%"></i></div>
      <div class="mid"><span class="a">43 个品种 · 52 套</span><span class="b">已收 31.4%</span></div>
      <div class="nums">
        <div class="cell"><span class="ck">面值</span><span class="cv">¥420</span></div>
        <div class="sep"></div>
        <div class="cell"><span class="ck">投入</span><span class="cv">¥1,286</span></div>
        <div class="sep"></div>
        <div class="cell"><span class="ck">市值</span><span class="cv">¥1,642</span></div>
        <div class="sep"></div>
        <div class="cell"><span class="ck">浮动</span><span class="cv up">+¥356</span></div>
      </div>
    </div>

    <div class="sec"><i class="bar"></i><span class="t">最新发行</span><span class="more">全部 ›</span></div>
    <div class="latest">
      <div class="item">
        <div class="thumb"><img src="${img(132)}" alt=""><span class="year">2026</span></div>
        <div class="nm">2026年贺岁（马）</div>
        <div class="fc">面额 10 元</div>
        <div class="pr">参考 ¥28</div>
      </div>
      <div class="item">
        <div class="thumb"><img src="${img(137)}" alt=""><span class="year">2026</span></div>
        <div class="nm">京剧艺术 · 丑角</div>
        <div class="fc">面额 5 元</div>
        <div class="pr">参考 ¥5</div>
      </div>
      <div class="item">
        <div class="thumb"><img src="${img(133)}" alt=""><span class="year">2026</span></div>
        <div class="nm">武夷山国家公园</div>
        <div class="fc">面额 10 元</div>
        <div class="pr">参考 ¥11</div>
      </div>
    </div>

    <div class="sec"><i class="bar"></i><span class="t">今日金银价</span><span class="more">贵金属目录 ›</span></div>
    <div class="metal">
      <div class="row">
        <div class="col">
          <span class="lbl">黄金</span>
          <span class="val"><b>¥942.60</b><span>元/克</span></span>
        </div>
        <div class="col">
          <span class="lbl">白银</span>
          <span class="val"><b class="s">¥11.28</b><span>元/克</span></span>
        </div>
      </div>
      <div class="foot"><span>11-22 09:38 更新</span><span>仅材料价值，随行情浮动</span></div>
    </div>

    <div class="footnote">价格均为参考估算，不构成投资建议</div>
  </div>
  ${TAB(0)}
</div>`;

/* ---------------- 2. 全套清单 ---------------- */
const listRow = (imgn, name, meta, mintage, set, year, price) => `
  <div class="row">
    <img class="th" src="${img(imgn)}" alt="">
    <div class="mid">
      <div class="n">${name}</div>
      <div class="m">${meta}</div>
      <div class="x">${mintage ? `<span>${mintage}</span><span>·</span>` : ''}<span>${set}</span></div>
    </div>
    <div class="r"><span class="y">${year}</span><span class="p">${price}</span></div>
  </div>`;

SCREENS.list = `
<div class="scr">
  ${STATUS}
  <div class="page">
    <div class="viewswitch">
      <div class="v on">顺序清单</div>
      <div class="v">按系列</div>
    </div>
    <div class="chips">
      <div class="chip on">普通纪念币</div>
      <div class="chip">纪念钞</div>
      <div class="chip">贵金属</div>
    </div>
    <div class="searchrow">
      <div class="search">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#A1A1A6" stroke-width="1.6">
          <circle cx="6.2" cy="6.2" r="4.4"/><path d="m9.6 9.6 3 3" stroke-linecap="round"/>
        </svg>
        <span>搜品种 / 年份</span>
      </div>
      <div class="filter">筛选</div>
    </div>
    <div class="sortrow">
      <span>共 137 个品种 · 已收 43</span>
      <span class="srt">年份 ↓</span>
    </div>
    <div class="rows">
      ${listRow(132, '2026年贺岁（马·二轮收官）', '双色铜合金 · 直径 27 毫米', '发行 10000 万枚', '1 枚/套', 2026, '¥28')}
      ${listRow(135, '2026年贺岁纪念钞（马钞）', '塑料 · 145×70 毫米', '发行 10000 万张', '1 张/套', 2026, '¥35')}
      ${listRow(133, '武夷山国家公园', '双色铜合金 · 直径 27 毫米', '发行 5000 万枚', '1 枚/套', 2026, '¥11')}
      ${listRow(137, '中国京剧艺术（丑角）', '黄铜合金 · 直径 30 毫米', '发行 6000 万枚', '1 枚/套', 2026, '¥5')}
      ${listRow(134, '江泽民诞辰 100 周年', '钢芯镀镍 · 直径 25 毫米', '发行 1000 万枚', '1 枚/套', 2026, '¥1.3')}
      ${listRow(129, '海南热带雨林国家公园', '双色铜合金 · 直径 27 毫米', '发行 5000 万枚', '1 枚/套', 2025, '¥11.5')}
    </div>
  </div>
  ${TAB(2)}
</div>`;

/* ---------------- 3. 品种详情 ---------------- */
SCREENS.detail = `
<div class="scr">
  ${STATUS}
  <div class="dhead">
    <div class="back">‹</div>
    <div class="t">2026年贺岁（马·二轮收官）</div>
    <div class="fix">纠错</div>
  </div>
  <div class="bigimg">
    <img src="${img(132)}" alt="">
    <div class="lab">正面</div>
  </div>
  <div class="thumbs">
    <img class="on" src="${img(132)}" alt="">
    <img src="${img(132).replace('.jpg', '-s.jpg')}" alt="">
  </div>
  <div class="dname">
    <div class="n">2026年贺岁（马·二轮收官）</div>
    <div class="s">2026 年 · 二轮生肖贺岁 · 纪念币</div>
  </div>

  <div class="pblock">
    <div class="top"><span>AI 推理价</span><span class="q">?</span><span class="note">币面参考，不构成投资建议</span></div>
    <div class="pv"><span class="cur">¥</span><span class="num">28</span><span class="badge">二轮收官</span></div>
  </div>

  <div class="facts">
    <div class="f"><span class="k">面额</span><span class="v">10 元</span></div>
    <div class="f"><span class="k">发行量</span><span class="v">10000 万枚</span></div>
    <div class="f"><span class="k">材质</span><span class="v">双色铜合金</span></div>
    <div class="f"><span class="k">直径</span><span class="v">27 毫米</span></div>
    <div class="f"><span class="k">重量</span><span class="v">9.2 克</span></div>
    <div class="f"><span class="k">发行年份</span><span class="v">2026 年（丙午马年）</span></div>
    <div class="f"><span class="k">铸造单位</span><span class="v">沈阳造币有限公司</span></div>
  </div>

  <div class="dcta"><div class="btn">加入我的收藏</div></div>
  ${TAB(2)}
</div>`;

/* ---------------- 4. 发行计划 ---------------- */
const planItem = (name, face, mintage, note, date, badge, badgeCls, cd, cdCls, remind) => `
  <div class="pitem">
    <div class="l">
      <div class="n">${name}</div>
      <div class="tags"><span class="ptag">纪念币</span><span>${face} 元</span><span>${mintage}</span></div>
      ${note ? `<div class="note">${note}</div>` : ''}
    </div>
    <div class="r">
      <span class="badge2 ${badgeCls}">${badge}</span>
      <span class="date">${date} 发行</span>
      ${cd ? `<span class="cd ${cdCls}">${cd}</span>` : ''}
      ${remind ? `<span class="rem">提醒我</span>` : ''}
    </div>
  </div>`;

SCREENS.plan = `
<div class="scr">
  ${STATUS}
  <div class="ptitle">
    <h1>发行计划</h1>
    <div class="src">中国人民银行 2025-12-08 公布</div>
  </div>
  <div class="next">
    <span class="tag">下一枚</span>
    <span class="nm">京剧·丑角</span>
    <span class="meta">5 元 · 11/24 · 还有 2 天</span>
  </div>
  <div class="ptabs">
    <div class="b on">普通纪念币（钞）</div>
    <div class="b">贵金属纪念币</div>
  </div>
  <div class="pgroup">
    <div class="gh"><span class="y">2026 年</span><span class="c">5 项 · 已发 4</span></div>
    <div class="pcard">
      ${planItem('中国京剧艺术 · 丑角', 5, '6000 万枚', '黄铜合金，彩色图案', '11/24', '待发行', 'up', '还有 2 天', '', true)}
      ${planItem('江泽民诞辰 100 周年', 1, '1000 万枚', '钢芯镀镍', '08/17', '已发行', '', '已过发行日', 'end', false)}
      ${planItem('武夷山国家公园', 10, '5000 万枚', '双色铜合金', '04/03', '已发行', '', '', '', false)}
      ${planItem('马年贺岁纪念钞', 20, '10000 万张', '塑料钞', '12/22', '已发行', '', '', '', false)}
    </div>
    <div class="footnote tight">来源：中国人民银行年度公告，以发行前公告为准</div>
  </div>
  ${TAB(1)}
</div>`;

/* ---------------- 5. 我的 ---------------- */
SCREENS.mine = `
<div class="scr">
  ${STATUS}
  <div class="page">
    <div class="profile">
      <div class="av">藏</div>
      <div class="c"><div class="n">同好</div><div class="s">43 个品种 · 52 套</div></div>
      <div class="edit">编辑</div>
    </div>

    <div class="balance">
      <div class="k">参考市值</div>
      <div class="v"><span class="cur">¥</span><span class="num">1,642</span><span class="pct">+¥356 · +27.7%</span></div>
      <div class="sub">已投入 ¥1,286 · 面值 ¥420</div>
      <div class="track"><i style="width:31.4%"></i></div>
      <div class="pg"><span class="a">收藏进度</span><span class="b">43 / 137</span></div>
    </div>

    <div class="dist">
      <div class="d"><span class="n">36</span><span class="l">普通纪念币</span></div>
      <div class="d"><span class="n">5</span><span class="l">纪念钞</span></div>
      <div class="d"><span class="n">2</span><span class="l">贵金属</span></div>
      <div class="d"><span class="n">52</span><span class="l">套系</span></div>
    </div>

    <div class="cellcard">
      <div class="cell"><span class="t">我的收藏</span><span class="s">43 个品种</span><span class="g">›</span></div>
      <div class="cell"><span class="t">更多功能</span><span class="s">备份 · 关于 · 条款</span><span class="g">›</span></div>
    </div>

    <div class="quick">
      <div class="q">
        <div class="ic"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#7A541A" stroke-width="1.5" stroke-linecap="round"><path d="M3 5.4h14v11.2H3z"/><path d="M3 8.4h14"/><path d="M6.4 3.2v2.2M13.6 3.2v2.2"/></svg></div>
        <span class="lb">发行计划</span>
      </div>
      <div class="q">
        <div class="ic"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#7A541A" stroke-width="1.5" stroke-linecap="round"><path d="M4 15.6V9.4M8 15.6V5.2M12 15.6V7.6M16 15.6V3.4"/><path d="M2.6 17.4h14.8"/></svg></div>
        <span class="lb">系列进度</span>
      </div>
      <div class="q">
        <div class="ic"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#7A541A" stroke-width="1.5" stroke-linecap="round"><path d="M10 3v9"/><path d="M6.4 8.6 10 12.2l3.6-3.6"/><path d="M4 15.4h12"/></svg></div>
        <span class="lb">备份</span>
      </div>
      <div class="q">
        <div class="ic"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#7A541A" stroke-width="1.5" stroke-linecap="round"><path d="M4 4.6h12v10.8H4z"/><path d="M7 8h6M7 11.2h4"/></svg></div>
        <span class="lb">意见反馈</span>
      </div>
    </div>

    <div class="recent">
      <div class="h"><span class="t">最近添加</span><span class="m">全部 ›</span></div>
      <div class="list">
        <div class="it"><img src="${img(132)}" alt=""><span class="nm">马年贺岁</span></div>
        <div class="it"><img src="${img(137)}" alt=""><span class="nm">京剧丑角</span></div>
        <div class="it"><img src="${img(133)}" alt=""><span class="nm">武夷山</span></div>
        <div class="it"><img src="${img(135)}" alt=""><span class="nm">马钞</span></div>
      </div>
    </div>

    <div class="footnote">价格为参考估算，不构成投资建议</div>
  </div>
  ${TAB(3)}
</div>`;

window.SCREENS = SCREENS;
