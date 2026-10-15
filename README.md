# DLSS 5 交互式架构拆解与 RDNA4 (`gfx1201`) 算子优化实战教程

👉 **在线交互式 3D 教程体验地址（GitHub Pages）：[https://lmxxf.github.io/DLSS5-Explanation/](https://lmxxf.github.io/DLSS5-Explanation/)**
🦩 **彩蛋 AI 基准展台（鹈鹕骑车 3D IK + 动态 SVG）：[https://lmxxf.github.io/DLSS5-Explanation/AIDemo/PelicanCycling/](https://lmxxf.github.io/DLSS5-Explanation/AIDemo/PelicanCycling/)**

---

## 📖 这是什么？

这是一个 **100% 零外网依赖、单文件自包含的 3D 交互式神经渲染教学可视化系统**，直观拆解：
1. **DLSS 5 的 71-Block Hybrid Swin-U-Net + ViT 混合神经网络架构**：
   - 从游戏引擎输入的 **11 张 D3D12 缓冲纹理**（Noisy Raytracing Color、Albedo、Normal、Roughness、Depth、Motion Vectors 与 Temporal History），经 `2×2 Patch Embed` 进入 5 级 Encoder 下采样（`C32 → C64 → C128 → C256 → C512`）。
   - 在谷底 `30×18`（640 Tokens）分辨率进入 **9 层 Vision Transformer (ViT) 全局自注意力瓶颈**，打通全屏光影与反射一致性。
   - 再经 5 座跨层 **Skip-Connection 残差光桥** 与 Decoder 上采样重建出无噪、细节锐利的完整帧。
2. **AMD Radeon RX 9070 XT (`gfx1201` / RDNA4) 汇编级算子优化实战**：
   - 展示我们如何通过 6 组核心优化（`16-Byte W16 b128 合并访存`、`Split-FFN 16B 满载`、`C32 LDS ds_load_b128 向量化`、`ViT 禁用外层循环展开立省 96 VGPR`、`全网 Epilogue fmed3f(x+0.f) 无分支化`、`ViT + C512 全链路 1-Byte E4M3 字节直通流`），在 **FP16 输出逐位一致（`0-DIFF`）** 的前提下：
     - 每帧减少 **681.5 MB** 显存读写流量；
     - 消灭全部 **8 次** `vit_pack_input` 额外核启动；
     - 将 `1920×1152` 纯网络耗时从 **`9.609 ms` 压至 `9.055 ms`（最佳稳态槽位 `8.945 ms`）**，让《剑星》(Stellar Blade) 2K 实机稳锁 **60.0 FPS**。

---

## 🎮 如何使用

1. 直接点击上方 **[GitHub Pages 在线链接](https://lmxxf.github.io/DLSS5-Explanation/)** 即可在浏览器中交互体验。
2. 或者克隆本仓库后，直接双击打开 `index.html`（无需安装任何依赖、无需联网）：
   ```bash
   git clone https://github.com/lmxxf/DLSS5-Explanation.git
   ```
3. **交互操作说明**：
   - **顶部 5 步课程导航**：点击 `第 1 课` ～ `第 5 课`（或 `◀ 上一课 / 下一课 ▶`），镜头会自动运镜对焦到对应的网络结构并给出原理解析。
   - **左侧 6 大优化卡片**：点击任意卡片单独开关该项优化，实时观察中央 Token 粒子流从发散的 `4B Float` 收束为高密度的 `1B E4M3` 激光束，并在右侧终端对比真实的 **优化前 vs 优化后 `gfx1201` RDNA4 汇编指令**。
   - **3D 自由检视**：鼠标左键拖拽 360° 旋转、滚轮缩放、悬停任意算子球体查看该层的算子名称、特征图尺寸与微秒级耗时。
