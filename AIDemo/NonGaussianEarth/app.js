import { createGlobe } from "./globe.js";

const el = (id) => document.getElementById(id);
const icon = (id) =>
  '<svg aria-hidden="true"><use href="#ico-' + id + '"/></svg>';
const esc = (str) =>
  String(str ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
const num = (n, digits = 2) => (Number.isFinite(n) ? n.toFixed(digits) : "—");
const pct = (n) => num(n * 100) + "%";
const layerName = (n) => "L" + String(n).padStart(2, "0");
const routes = [
  {
    nav: "山脊与浅滩",
    icon: "route",
    name: "山脊直达与浅滩混航",
    lead: "熟诗沿高峰续写，算术穿过低峰度水道。选一个样本，逐词查看船下的地形。",
    tracks: ["rail_01", "rail_02", "reason_01", "reason_08", "dive"],
  },
  {
    nav: "纠错折返",
    icon: "turn",
    name: "127.4° 纠错折返",
    lead: "复核 49 × 51 时，一个逗号记录了急转。逐帧看「等等，让我重新算」如何换岛。",
    tracks: ["correction_mul49", "reason_05"],
  },
  {
    nav: "停止符干预",
    icon: "port",
    name: "到达 42 号港以后",
    lead: "23 + 19 已经算完。屏蔽停止符，模型会在原地兜圈，还是重新出海？",
    tracks: ["forced", "natural", "repeat"],
  },
  {
    nav: "基线验潮",
    icon: "tide",
    name: "高斯海平线验潮站",
    lead: "用 4,096 条高斯向量标定海拔，再用同一帧算术激活检验大陆能量基线。",
    tracks: ["reason_08"],
  },
];
const names = {
  rail_01: "静夜思",
  rail_02: "悯农",
  reason_01: "四则运算",
  reason_08: "折扣找零",
  dive: "明月 · 64 层深潜",
  correction_mul49: "给定错误初稿",
  reason_05: "三段论自发改口",
  forced: "屏蔽 EOS",
  natural: "自然解码",
  repeat: "机械重复",
};
const colors = {
  forced: "#e9b767",
  natural: "#88d8bf",
  repeat: "#a3a1e0",
  reason_01: "#71d4b9",
  reason_08: "#71d4b9",
  reason_05: "#86cebe",
  correction_mul49: "#edb66b",
};
const metrics = [
  { key: "s", title: "球面步长", symbol: "sₜ", color: "#dfb572" },
  { key: "g", title: "测地曲率", symbol: "κg", color: "#7fcbbd" },
  { key: "rank5", title: "切平面秩", symbol: "rank5", color: "#b7a9d9" },
  { key: "z", title: "主岛海拔", symbol: "zₘₐₓ₊", color: "#df9d85" },
];
let stopAt = null;
let data,
  globe,
  route = 0,
  trackId = "rail_01",
  step = 0,
  tide = 4.64,
  playing = false,
  follow = false,
  timer,
  locked = null,
  chartCache = [];
const track = () => data.tracks[trackId];
const frames = () => track().frames;
const frame = () => frames()[step];
const dive = () => trackId === "dive";
const tokenLabel = (token) =>
  token
    .replaceAll("\n", "↵")
    .replaceAll("\t", "⇥")
    .replace(/^ +$/, (s) => "␣".repeat(s.length)) || "∅";
const words = (island) =>
  island.words.map((w) => w.trim() || tokenLabel(w)).join(" / ");
function button(label, fn, cls = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.className = cls;
  b.onclick = fn;
  return b;
}
function nav() {
  el("routes").innerHTML = routes
    .map(
      (r, i) =>
        '<button type="button" data-route="' +
        i +
        '" aria-current="' +
        (i === route) +
        '">' +
        icon(r.icon) +
        '<div><span class="tabNo">ROUTE 0' +
        (i + 1) +
        '</span><span class="tabName">' +
        r.nav +
        "</span></div></button>",
    )
    .join("");
  el("routes")
    .querySelectorAll("button")
    .forEach((b, i) => (b.onclick = () => selectRoute(i)));
}
function selectRoute(i) {
  route = i;
  nav();
  const r = routes[i];
  el("routeCode").textContent = "ROUTE 0" + (i + 1) + " / 04";
  el("routeTitle").textContent = r.name;
  el("routeLead").textContent = r.lead;
  el("logBody").scrollTop = 0;
  selectTrack(r.tracks[0]);
}
function preferredIndex() {
  if (dive()) return 20;
  const targets = {
    rail_01: 18,
    rail_02: 12,
    reason_01: 48,
    reason_08: 74,
    correction_mul49: 146,
    reason_05: 125,
    forced: 23,
    natural: 23,
  };
  const i = frames().findIndex((f) => f.t === targets[trackId]);
  return Math.max(0, i);
}
function selectTrack(id) {
  stop();
  trackId = id;
  step = preferredIndex();
  locked = null;
  hidePick();
  const r = routes[route],
    selected = el("samples");
  const lead = {
    dive: "固定《静夜思》的「明月」词元。从 L00 走到 L63，观测同一个词如何经过 64 张独立海图。",
    reason_01:
      "在全角圆括号内推演 (37 × 24 − 156) ÷ 12。比较算式连接轴的当步海拔与语料峰度。",
    reason_08:
      "240 元商品先打 75 折，再收 9% 的税。检查算式词元在哪些低峰度轴上聚集。",
    reason_05:
      "没有给模型塞入错误初稿。看它如何自己把「某些动物是石头」改口为「某些动物是狗」。",
    repeat:
      "固定「44，44，44…」数字串作为低秩正对照，检验海图能否识别港口兜圈。",
  };
  el("routeLead").textContent = route === 3 ? r.lead : lead[id] || r.lead;
  selected.replaceChildren();
  selected.hidden = r.tracks.length === 1;
  for (const id of r.tracks) {
    const b = button(names[id], () => selectTrack(id));
    b.setAttribute("aria-pressed", id === trackId);
    selected.append(b);
  }
  const mobile = el("mobileSample");
  mobile.replaceChildren();
  r.tracks.forEach((k) => mobile.add(new Option(names[k], k, false, k === id)));
  mobile.hidden = r.tracks.length === 1;
  mobile.onchange = (e) => selectTrack(e.target.value);
  const comparisons =
    route === 2
      ? r.tracks
          .filter((k) => k !== id)
          .map((k) => ({
            frames: data.tracks[k].frames,
            color: colors[k],
            label: names[k],
          }))
      : [];
  globe.setTrack(frames(), data.islands, {
    color: colors[id] || "#e9ba72",
    focusIndex: step,
    comparisons,
    label: names[id],
    tideMode: route === 3,
  });
  globe.setTide(route === 3 ? tide : data.calibration.zmax.p99);
  el("raw").open = false;
  el("rawText").textContent = track().prompt + track().text;
  el("tokensTitle").innerHTML = dive()
    ? "剖面层号 <small>LAYER LOG</small>"
    : "逐词记录 <small>TOKEN LOG</small>";
  const log = el("tokens");
  log.replaceChildren();
  frames().forEach((f, i) => {
    const b = button(dive() ? layerName(f.layer) : tokenLabel(f.token), () => {
      stop();
      seek(i);
    });
    b.title = (dive() ? layerName(f.layer) : "t=" + f.t) + " · " + f.top[0].id;
    log.append(b);
  });
  el("seek").max = Math.max(0, frames().length - 1);
  el("seek").setAttribute(
    "aria-label",
    dive() ? "深潜层号 L00 至 L63" : "逐词航迹帧",
  );
  writeContext();
  buildCharts();
  seek(step);
}
function rowStats(items) {
  return (
    '<div class="mini-grid">' +
    items
      .map(
        ([value, label]) =>
          "<div><b>" + value + "</b><span>" + label + "</span></div>",
      )
      .join("") +
    "</div>"
  );
}
const heading = (a, b) =>
  '<div class="subhead">' + a + " <small>" + b + "</small></div>";
function textJumps(box, markers) {
  const row = document.createElement("div");
  row.className = "jump-row";
  const text = frames()
    .map((f) => f.token)
    .join("");
  for (const [label, needle] of markers) {
    const at = text.indexOf(needle);
    if (at < 0) continue;
    let end = 0;
    const index = frames().findIndex((f) => (end += f.token.length) > at);
    if (index >= 0)
      row.append(
        button(label, () => {
          stop();
          seek(index);
        }),
      );
  }
  if (row.children.length) box.append(row);
}
function writeContext() {
  const box = el("context");
  box.replaceChildren();
  if (route === 0 && !dive()) {
    const poem = trackId.startsWith("rail");
    const group = data.groups[poem ? "rail_clean" : "reason"];
    box.innerHTML =
      heading(
        poem ? "8 段熟诗 · 组均值" : "8 道括号推理 · 组均值",
        "L32 MEAN",
      ) +
      rowStats([
        [num(group.zmax_positive), "主岛海拔 zₘₐₓ₊"],
        [num(group.kurt_d), "跨维峰度 Kurt_d"],
        [
          (group.deltaC_10 > 0 ? "+" : "") + pct(group.deltaC_10),
          "超额能量 ΔC₁₀",
        ],
      ]);
    if (poem)
      textJumps(
        box,
        trackId === "rail_01"
          ? [
              ["明月", "明月"],
              ["教辅赏析", "《静夜思》"],
            ]
          : [
              ["诗末", "辛苦"],
              ["教辅赏析", "《悯农》"],
            ],
      );
  } else if (dive()) {
    box.innerHTML =
      heading("固定词元「明月」", "LAYER DIVE") +
      '<div class="jump-row"></div><p class="note">从字形、月球意象到教辅解析，64 层各有独立的岛牌。</p>';
    [0, 10, 20, 32, 40, 63].forEach((n) =>
      box.querySelector(".jump-row").append(
        button(layerName(n), () => {
          stop();
          seek(n);
        }),
      ),
    );
  } else if (route === 1) {
    const seeded = trackId === "correction_mul49";
    box.innerHTML =
      heading(
        seeded ? "给定 2501，复核 2499" : "从石头改口举例",
        "CORRECTION",
      ) +
      '<p class="event-quote">' +
      (seeded ? "“等等，让我重新算：”" : "“但更严谨的例子是”") +
      '</p><p class="note">' +
      (seeded
        ? "t=145–149 是五个核心词元。转角记在出射步，t=146 的折点位于「等等」。"
        : "无外部错误注入。「但」与「严谨」依次点亮转折与正式表达，「的例子／是」同时激活替代方案副岛。") +
      "</p>";
    if (seeded) {
      const row = document.createElement("div");
      row.className = "jump-row";
      row.append(
        button("从「等等」重播五帧", () => {
          stop();
          seek(frames().findIndex((f) => f.t === 145));
          togglePlay();
          stopAt = frames().findIndex((f) => f.t === 149);
        }),
      );
      box.append(row);
    }
  } else if (route === 2) {
    const e = data.eos,
      repeat = data.tracks.repeat.port.after;
    const rows = [
      ["natural", "自然 · 3 步", e.before_rank, e.before_H],
      ["repeat", "复读 · 尾 31 步", repeat.rank5, repeat.H],
      ["forced", "屏蔽 · 尾 91 步", e.after_rank, e.after_H],
    ];
    box.innerHTML =
      heading("三臂尾窗对照", "EOS CONTROL") +
      '<table class="trip-table"><thead><tr><th>统计窗口</th><th>rank5</th><th>H / bits</th></tr></thead><tbody>' +
      rows
        .map(
          ([k, l, r, h]) =>
            '<tr class="' +
            (trackId === k ? "sel" : "") +
            '"><td>' +
            l +
            "</td><td>" +
            num(r) +
            "</td><td>" +
            num(h) +
            "</td></tr>",
        )
        .join("") +
      '</tbody></table><p class="note">自然与屏蔽臂共享前三步。复读臂是独立的固定数字串对照。</p>';
    if (trackId === "forced")
      textJumps(box, [
        ["答案到港", "42"],
        ["怀疑题意", "若题目原意"],
        ["乘法答案", "437"],
        ["自行更正", "更正"],
      ]);
  } else {
    const { calibration: c, ablation: a } = data;
    const b = c.thresholds["10"];
    box.innerHTML =
      heading("调节海平面", "GAUSSIAN TIDE") +
      '<div class="tide-range"><input id="tide" type="range" step=".01" min="3" max="10" aria-label="海拔阈值"><output id="tideOut"></output></div><div class="jump-row" id="tidePreset"></div><p class="note">海平面比较当步 z；岛峰按语料 κ 隆起。Kurt_d 的高斯 P99 为 ' +
      num(c.coordinate_kurtosis.p99) +
      "。</p>" +
      heading("大陆轴基线", "MASK ABLATION") +
      '<p class="note"><b>' +
      b.count.toLocaleString("en-US") +
      " / " +
      c.dimension.toLocaleString("en-US") +
      " = " +
      pct(b.fraction) +
      "</b>。随机向量也会把这部分能量分给大陆轴。固定 t=" +
      a.t +
      "，置换 " +
      a.permutations +
      " 次大陆标签，ΔC₁₀ 从 " +
      pct(a.real_deltaC10) +
      " 回到 " +
      pct(a.permuted_delta_mean) +
      "。</p>";
    const chart = document.createElement("div");
    chart.id = "ablationChart";
    box.append(chart);
    el("tide").value = tide;
    function set(v) {
      tide = Number(v);
      el("tide").value = tide;
      el("tideOut").textContent = "z ≥ " + num(tide);
      globe.setTide(tide);
      writeEvent();
    }
    el("tide").oninput = (e) => set(e.target.value);
    for (const q of ["p95", "p99"])
      el("tidePreset").append(
        button(q.toUpperCase() + " · " + num(c.zmax[q]), () =>
          set(Number(num(c.zmax[q]))),
        ),
      );
    set(tide);
  }
}
function writeEvent() {
  const f = frame(),
    box = el("event");
  let label = "",
    body = "";
  if (dive()) {
    label = "层间观测";
    body =
      layerName(f.layer) +
      " · " +
      f.top[0].id.split(" ")[1] +
      " 的词牌为「" +
      esc(words(data.islands[f.top[0].id])) +
      "」。";
    body +=
      '<p class="event-quote">“' +
      esc(data.tracks.rail_01.text.split("。\n").at(-1).slice(0, 53)) +
      '…”</p><span class="tiny">《静夜思》句号后的真实续写</span>';
  } else if (route === 0) {
    if (trackId === "reason_01") {
      label = "浅滩样本";
      body =
        "t=48 写出 888 的个位时，L32 C3416 升到 z = " +
        num(data.tracks.reason_01.frames.find((x) => x.t === 48).z) +
        "，其语料 κ 只有 " +
        num(data.islands["L32 C3416"].k, 1) +
        "。";
    } else if (trackId === "reason_08") {
      label = "折扣找零";
      body =
        "t=74 的算式词元仍有尖峰。到「基线验潮」可对照同一向量的置换实验。";
    } else {
      label = "航行原文";
      body =
        '<span class="event-quote">' +
        esc(
          track().prompt.split("\n").at(-1) +
            track()
              .text.split("。\n")
              .slice(0, 2)
              .join("。")
              .split("《")[0]
              .slice(0, 36),
        ) +
        "</span>";
    }
  } else if (route === 1) {
    const roles = {
      145: "异常警报",
      146: "否定反驳",
      147: "第一人称自指",
      148: "重新构造",
      149: "回归验算",
    };
    label =
      trackId === "correction_mul49" ? roles[f.t] || "纠偏窗口" : "自发纠偏";
    body =
      "球皮转向 <b>" +
      num((f.theta * 180) / Math.PI, 1) +
      "°</b>（" +
      num(f.theta, 3) +
      " rad），κg = " +
      num(f.g) +
      "。";
    if (f.t === 149 && trackId === "correction_mul49") {
      const old = frames()[step - 1].top.map((x) => x.id);
      body +=
        " 此步与上一帧 Top-5 重叠 <b>" +
        f.top.filter((x) => old.includes(x.id)).length +
        " / 5</b>。";
    }
    if (trackId === "reason_05" && [128, 129].includes(f.t)) {
      const rank = f.top.findIndex((x) => x.id === "L32 C1007");
      body +=
        " L32 C1007「instead / 改用」居第 " +
        (rank + 1) +
        "，z = " +
        num(f.top[rank].z) +
        "。";
    }
  } else if (route === 2) {
    label = names[trackId];
    body = {
      forced:
        "屏蔽 EOS 后多走 " +
        data.eos.extra_tokens +
        " 个词元，尾段 " +
        data.eos.after_main_islands +
        " 座主岛。",
      natural: "第 3 步完成「42」，EOS 登上首位。",
      repeat:
        "尾段 " +
        data.tracks.repeat.port.after.n +
        " 步经过 " +
        data.tracks.repeat.port.after.unique_main_islands +
        " 座岛，前四座包揽 " +
        num(data.tracks.repeat.port.after.top4_main_coverage * 100, 1) +
        "% 的停靠。",
    }[trackId];
    const partial = frames()
      .slice(0, step + 1)
      .map((x) => x.token)
      .join("")
      .slice(-68);
    body += '<p class="event-quote">“' + esc(partial.trim() || "↵") + "”</p>";
  } else {
    const a = data.ablation,
      baseline = data.calibration.thresholds["10"].fraction;
    const levels = [
      ["大陆轴基线", baseline, "κ > 10"],
      ["当前 t=" + f.t, baseline + f.delta, "Δ " + pct(f.delta)],
      [
        "置换 t=" + a.t,
        baseline + a.permuted_delta_mean,
        "Δ " + pct(a.permuted_delta_mean),
      ],
    ];
    const graph = el("ablationChart");
    graph.innerHTML =
      '<div class="tide-scale"><span>大陆能量占比</span><span>50%</span><span>60%</span><span>70%</span></div>' +
      levels
        .map(
          ([name, value, note], i) =>
            '<div class="tide-bar"><span>' +
            name +
            '</span><div class="tide-track"><i style="--pos:' +
            (value - 0.5) * 500 +
            "%;--hue:" +
            ["#75877a", "#987039", "#41836f"][i] +
            '"></i></div><strong>' +
            pct(value) +
            '</strong></div><div class="tide-delta">' +
            note +
            "</div>",
        )
        .join("");
    label = "当步越线观测";
    const n = Object.values(f.scores).filter((z) => z >= tide).length;
    body =
      "本图收录的 " +
      Object.keys(f.scores).length +
      " 座同层岛中，<b>" +
      n +
      " 座</b>越过 z = " +
      num(tide) +
      "。本步 Kurt_d = " +
      num(f.kurt) +
      "。";
  }
  box.innerHTML =
    heading(label, "FIELD NOTE") + '<div class="caption">' + body + "</div>";
}
function seek(n) {
  step = Math.max(0, Math.min(frames().length - 1, n));
  globe.setFrame(step);
  el("seek").value = step;
  const f = frame(),
    mark = dive() ? layerName(f.layer) : "t=" + f.t;
  el("fixMode").textContent = [
    dive() ? "纵向深潜" : names[trackId],
    "纠偏复核",
    "停止符干预",
    "验潮样本",
  ][route];
  el("fixToken").textContent = tokenLabel(f.token);
  el("fixCoord").textContent =
    route === 1
      ? num((f.theta * 180) / Math.PI, 1) + "° · " + mark
      : mark + " · " + f.top[0].id;
  el("counter").textContent = step + 1 + " / " + frames().length;
  el("mapTime").textContent = mark + " · " + track().case;
  el("layerStamp").textContent = layerName(f.layer);
  const selected = el("tokens").children[step];
  el("tokens").querySelector(".active")?.classList.remove("active");
  selected.classList.add("active");
  const log = el("tokens");
  if (
    selected.offsetTop < log.scrollTop ||
    selected.offsetTop + selected.offsetHeight >
      log.scrollTop + log.clientHeight
  )
    log.scrollTop =
      selected.offsetTop - log.clientHeight / 2 + selected.offsetHeight / 2;
  const island = data.islands[f.top[0].id];
  el("fix").innerHTML =
    '<button class="fix-main" aria-label="查看当前主岛 ' +
    island.id +
    '"><strong>' +
    island.id +
    "</strong><em>z = " +
    num(f.z) +
    ' ↗</em></button><div class="words">' +
    esc(words(island)) +
    "</div>";
  el("fix").firstChild.onclick = () => {
    if (!follow) globe.focusIsland?.(island.id);
    pick(island, f, { x: 18, y: 48 }, true);
  };
  if (locked && locked.layer !== f.layer) {
    locked = null;
    hidePick();
  }
  if (locked) showPick(locked, f, lastPoint);
  else hidePick();
  writeEvent();
  drawCharts();
  el("prev").disabled = step === 0;
  el("next").disabled = step === frames().length - 1;
}
function buildCharts() {
  chartCache = [];
  const outer = el("charts");
  outer.replaceChildren();
  metrics.forEach((m) => {
    const cell = document.createElement("div");
    cell.className = "metric";
    cell.style.setProperty("--series", m.color);
    cell.innerHTML =
      '<div class="metric-top"><span class="metric-key"><b>' +
      m.symbol +
      "</b> " +
      m.title +
      '</span><strong class="metric-num"></strong></div><svg class="spark" viewBox="0 0 300 40" preserveAspectRatio="none" role="img" aria-label="' +
      m.title +
      '的实测曲线"></svg>';
    const svg = cell.querySelector("svg");
    const values = frames().map((f) => f[m.key]);
    const valid = values.filter(Number.isFinite);
    const min = Math.min(...valid),
      max = Math.max(...valid);
    const x = (i) => 3 + (294 * i) / Math.max(1, values.length - 1),
      y = (v) => 32 - (26 * (v - min)) / (max - min || 1);
    let path = "",
      pen = false;
    values.forEach((v, i) => {
      if (Number.isFinite(v)) {
        path += (pen ? " L" : " M") + x(i).toFixed(2) + " " + y(v).toFixed(2);
        pen = true;
      } else pen = false;
    });
    svg.innerHTML =
      '<defs><linearGradient id="grad-' +
      m.key +
      '" x1="0" x2="0" y1="0" y2="1"><stop stop-color="' +
      m.color +
      '" stop-opacity=".20"/><stop offset="1" stop-color="' +
      m.color +
      '" stop-opacity="0"/></linearGradient></defs><path d="M0 33H300" stroke="#607164" opacity=".5" stroke-dasharray="2 5"/><path d="' +
      path +
      ' L297 39 L3 39 Z" fill="url(#grad-' +
      m.key +
      ')"/><path d="' +
      path +
      '" stroke="' +
      m.color +
      '" stroke-width="1.5" vector-effect="non-scaling-stroke"/><path class="cursor" stroke="#e7ebd8" opacity=".65" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/><circle r="2.7" fill="' +
      m.color +
      '" stroke="#182823" stroke-width="1"/>';
    svg.onclick = (e) => {
      const r = svg.getBoundingClientRect();
      stop();
      seek(Math.round(((e.clientX - r.left) / r.width) * (values.length - 1)));
    };
    outer.append(cell);
    chartCache.push({ m, cell, svg, x, y });
  });
  const first = frames()[0],
    last = frames().at(-1);
  el("teleRange").textContent = dive()
    ? "64 层 · L00 — L63 · t=18"
    : "t " + first.t + " — " + last.t + " · " + layerName(first.layer);
}
function drawCharts() {
  for (const { m, cell, svg, x, y } of chartCache) {
    const v = frame()[m.key],
      pos = x(step);
    cell.querySelector(".metric-num").textContent = num(
      v,
      m.key === "s" ? 3 : 2,
    );
    svg.querySelector(".cursor").setAttribute("d", "M" + pos + " 2V38");
    const dot = svg.querySelector("circle");
    dot.setAttribute("cx", pos);
    dot.setAttribute("cy", Number.isFinite(v) ? y(v) : -10);
  }
}
let lastPoint = { x: 16, y: 55 };
function hidePick() {
  el("pickCard").hidden = true;
}
function showPick(island, f, point) {
  const box = el("pickCard"),
    stage = el("globe");
  lastPoint = point || lastPoint;
  const z = f.scores?.[island.id] ?? f.top.find((x) => x.id === island.id)?.z;
  box.innerHTML =
    "<header><b>" +
    esc(island.id) +
    '</b><button aria-label="关闭岛屿词牌">×</button></header><div class="tiny">留出 κ ' +
    num(island.k) +
    "　当步 z " +
    num(z) +
    '</div><div class="words">' +
    esc(words(island)) +
    "</div>";
  box.hidden = false;
  box.style.left =
    Math.max(
      4,
      Math.min(lastPoint.x + 10, stage.clientWidth - box.offsetWidth - 6),
    ) + "px";
  box.style.top =
    Math.max(
      4,
      Math.min(lastPoint.y + 10, stage.clientHeight - box.offsetHeight - 6),
    ) + "px";
  box.querySelector("button").onclick = () => {
    locked = null;
    hidePick();
  };
}
function pick(island, f, p, pin) {
  if (pin) {
    locked = island;
    if (island) stop();
  }
  if (!island) {
    if (!locked) hidePick();
    return;
  }
  if (!pin && locked) return;
  showPick(island, f || frame(), p);
}
function stop() {
  playing = false;
  stopAt = null;
  clearTimeout(timer);
  el("play").innerHTML = icon("play");
  el("play").setAttribute("aria-label", "播放");
}
function tick() {
  clearTimeout(timer);
  if (!playing) return;
  timer = setTimeout(
    () => {
      if (step >= frames().length - 1) {
        stop();
        return;
      }
      seek(step + 1);
      if (step === frames().length - 1 || step === stopAt) stop();
      else tick();
    },
    (route === 1 ? 1550 : dive() ? 880 : 750) / Number(el("speed").value),
  );
}
function togglePlay() {
  if (playing) {
    stop();
    return;
  }
  locked = null;
  hidePick();
  if (step === frames().length - 1) seek(0);
  playing = true;
  el("play").innerHTML = icon("pause");
  el("play").setAttribute("aria-label", "暂停");
  tick();
}
function bind() {
  el("play").onclick = togglePlay;
  el("speed").onchange = tick;
  el("prev").onclick = () => {
    stop();
    seek(step - 1);
  };
  el("next").onclick = () => {
    stop();
    seek(step + 1);
  };
  el("seek").oninput = (e) => {
    stop();
    seek(Number(e.target.value));
  };
  el("follow").onclick = () => {
    follow = !follow;
    globe.setFollow(follow);
    el("follow").innerHTML =
      icon(follow ? "follow" : "view") +
      "<span>" +
      (follow ? "船首跟拍" : "自由轨道") +
      "</span>";
    el("follow").setAttribute("aria-pressed", follow);
  };
  el("reset").onclick = () => globe.resetView();
  el("fold").onclick = () => {
    const folded = document.querySelector(".log").classList.toggle("folded");
    el("fold").setAttribute("aria-expanded", !folded);
    el("fold").setAttribute(
      "aria-label",
      folded ? "展开航行日志" : "折叠航行日志",
    );
  };
  el("methodBtn").onclick = () => {
    stop();
    el("method").showModal();
  };
  el("methodClose").onclick = () => el("method").close();
  el("method").onclick = (e) => {
    if (e.target === el("method")) {
      const r = e.target.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        e.target.close();
    }
  };
  document.addEventListener("keydown", (e) => {
    if (
      el("method").open ||
      e.altKey ||
      e.metaKey ||
      e.ctrlKey ||
      ["INPUT", "SELECT", "BUTTON", "A", "SUMMARY"].includes(e.target.tagName)
    )
      return;
    if (["ArrowLeft", "ArrowRight", " "].includes(e.key)) {
      e.preventDefault();
      if (e.key === " ") togglePlay();
      else {
        stop();
        seek(step + (e.key === "ArrowLeft" ? -1 : 1));
      }
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });
}
async function start() {
  const response = await fetch("./atlas.json");
  if (!response.ok) throw Error("数据响应 " + response.status);
  data = await response.json();
  globe = createGlobe(el("globe"), {
    onPick: (a, f, p) => pick(a, f, p, true),
    onHover: (a, f, p) => pick(a, f, p, false),
  });
  const p = data.projection;
  el("methodText").innerHTML =
    "<h3>从 5,120 维到球面</h3><p>从原始 BF16 残差和 ICA 写入方向联合拟合球面邻域 MDS，再按原始步长和无符号转角展开航迹。邻域角距的均方根误差为 " +
    num(p.neighborsAngularRMSEdeg, 1) +
    "°。时间航线逐步弧长与转角的最大误差均小于 0.00001 rad。远距位置及航迹与岛峰的间距有投影失真。</p><h3>读海图与遥测</h3><p>全模型共 327,680 根轴。这里收录所选回放各帧 Top-5 的并集，共 " +
    Object.keys(data.islands).length +
    " 座岛。山体高度编码留出测试集轴峰度 κ，主岛对应当步正向激活最高的轴。点击山峰可查该层该步的真实 z 与原始 J-Lens 词牌。海面的高斯阈值在 ICA 白化坐标中标定。深潜覆盖 L00–L63 全 64 层，曲线给出同一词元在各层的时间运动学指标。</p><h3>操作</h3><p>拖动环绕，滚轮或双指缩放。点击词元或曲线跳转；空格播放，方向键单步。船首跟拍随船调整视角。</p>";
  bind();
  selectRoute(0);
  el("loading").hidden = true;
}
start().catch((e) => {
  el("loading").textContent = "海图载入失败 · " + e.message;
  console.error(e);
});
