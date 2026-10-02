# 极速小车 · Coastline Club

可直接在 PC 浏览器游玩的原创 3D 街机竞速游戏：海风环线与落日峡谷双赛道、1 玩家 + 5 AI、三圈比赛、漂移集气、小喷、氮气、赛事奖牌、最佳幽灵车、分段计时、车库配色、本地纪录与 Hyper3D 模型工坊。

在线试玩目标地址：**https://lihongcheng.github.io/kart-racer/**。首次上线需仓库管理员在 [Settings → Pages](https://github.com/lihongcheng/kart-racer/settings/pages) 将 Source 设为 **GitHub Actions**，然后在 [发布工作流](https://github.com/lihongcheng/kart-racer/actions/workflows/pages.yml) 运行或重跑部署。部署完成前请使用下方本地启动方式。

## 启动

需要 **Node.js 22.13+**（内置 SQLite）及 npm，推荐 Node.js 24 LTS。验证环境为 Node.js 26.8.2。

```sh
cd kart-racer
npm install
npm run dev
```

打开 **http://localhost:5174**。游戏端口固定为 5174，资产服务只监听 `127.0.0.1:4175`；Vite 将 `/api` 转发给资产服务。端口占用时请先关闭旧进程。

游戏与内置模型不需要 API Key。首次开始比赛会展示操作教学。电脑键盘优先，手机仅显示浏览提示。

| 按键 | 操作 |
| --- | --- |
| W / ↑ | 加速 |
| S / ↓ | 刹车、低速倒车 |
| A D / ← → | 转向 |
| Shift + 转向 | 漂移，累计有效侧滑积攒氮气 |
| Space | 消耗一罐氮气，最多储存两罐 |
| R | 返回最近有效检查点，用时 +2 秒 |
| Esc | 暂停 / 继续 |

有效漂移达到 0.6 秒、中央进度条亮起后，松开 **Shift** 可获得小喷。低速、撞墙和驶出道路不集气，单独松开方向键不会触发小喷。切出页面自动暂停。快速竞速有轻松/普通两档 AI；计时练习独自跑三圈。

第二阶段已加入渐进转向、高速转向衰减、平滑跟随镜头、小喷提示和火花反馈。关闭加速镜头效果后，比赛视野固定；暂停会冻结车轮与漂移特效。赛道装饰按区域实例化，远处 AI 使用保留 Classic 轮廓的简化模型，烟雾和胎痕使用固定容量实例池。

## 赛道与奖牌

点击主菜单底部的赛道卡片切换赛道，路线图、3D 场景、AI、HUD 与纪录会同步切换。海风环线适合熟悉驾驶，落日峡谷增加连续回头弯与缓坡，穿行于砂岩台地之间。

| 赛道 | 单圈长度 | 计时金牌（三圈） | 银牌 | 铜牌 |
| --- | --- | --- | --- | --- |
| 海风环线 | 约 0.82 km | ≤ 1:40 | ≤ 2:00 | ≤ 2:30 |
| 落日峡谷 | 约 1.13 km | ≤ 2:20 | ≤ 2:50 | ≤ 3:30 |

快速竞速按名次发奖：第 1 名金牌、第 2–3 名银牌，其余完赛铜牌。计时练习按总用时发奖，超过铜牌门槛仍保存完赛纪录。结算显示本场奖牌、下一目标及刷新个人最佳的提示。

每条赛道、每种模式独立保存最佳总用时、最佳单圈与最高奖牌。个人纪录可筛选赛道/模式；最近 30 场之外的最佳成绩仍会保留。旧版成绩自动归入海风环线，继续保留旧存档备份。成绩仅存于当前浏览器，没有跨设备同步。

## 最佳幽灵车与分段计时

计时练习每条赛道保存**最佳三圈那一场**的轨迹。下一场出现半透明幽灵车，可在菜单或设置中关闭显示，仍继续记录新成绩；幽灵车不参与碰撞、排名和计圈。暂停会冻结回放，重赛从零开始，复位的 +2 秒罚时与瞬移会保留。

每圈分为 S1、S2、S3 三段，地图标出 S1/S2 和终点。HUD 显示刚完成路段相对最佳同段的差值及累计差；负值表示更快。结算列出九段用时，标出进步最多、损失最多的路段。对比基准在出发时冻结，刷新纪录后也不会用本场成绩和自己比较。

已有旧成绩保持不变；旧最佳没有历史轨迹时，需要刷新最佳才会生成幽灵车。每条赛道只保留一场最佳回放，最多 15 分钟/10,000 个采样点。超过容量仍保存成绩与完整分段。浏览器空间不足时会提示，当前页面仍可使用新纪录。清理浏览器站点数据会移除本地进度；本地站点与在线站点使用各自的存档。

## 赛车造型与 Hyper3D 接入

当前赛车是重做的 **浪游者 Classic**：参考早期《跑跑卡丁车》的短宽车身、圆润车头、低座舱和大头盔比例，以独立网格原创建模。玩家与五名 AI 都使用新版，四轮可以独立转向/滚动，三种车库配色同步改变车身与车手。[前后侧面展示](docs/screenshots/classic-kart-views.png) / [造型记录](docs/kart-redesign.md)。

海岛棕榈、海岸砂岩及工坊中的初代概念车通过已授权的 `hyper3d` OAuth MCP 实际生成；初代车型保留为收藏。来源与模型尺寸见 [资产清单](assets/manifest.json)。赛车由游戏代码直接建立，场景加载本地压缩 GLB，生成服务离线不影响比赛。工坊也提供新版完整赛车的 GLB 预览和下载。

两条资产制作路径：

- **TRAE OAuth MCP**：在 TRAE 对话中请求生成、查询和下载模型，再运行优化脚本入库。已有 OAuth 授权不需要复制到本项目。
- **网页工作台**：复制 `.env.example` 为 `.env`，设置 `RODIN_API_KEY`，重启 `npm run dev`。工坊的“开发者资产工作台”即可提交描述。生成会使用 Hyper3D 额度；新模型可预览/下载，装备为赛车需要开发侧装配和验收。

两者的认证独立；网页不会读取 IDE 的 OAuth Token。服务端密钥只用于官方 Rodin API，不会传入前端或转发给模型下载地址。工作台仅供本机开发，拒绝其他 Host/Origin，限制两个同时运行任务。

任务持久化于 `.data/assets.sqlite`。已知任务在重启后恢复查询；超时可恢复。结果不明确的生成提交标记为“待核实”，需要先去 Hyper3D 工作区查验，不自动重提付费生成。下载文件存入 `apps/web/public/models/generated/`，不会用临时签名链接作为发布地址。

## 构建与验证

```sh
npm test               # 驾驶/比赛规则与资产服务模拟测试，不调用付费接口
npm run test:browser   # 本机 Chrome；真实键盘、双赛道、存档迁移、20局完整比赛
npm run build          # TypeScript 检查 + 静态包输出到 dist/
npm run preview        # 预览生产构建，http://127.0.0.1:4176
node scripts/benchmark.mjs current  # 开发版：1080p 静止场景基准
node scripts/benchmark-race.mjs     # 开发版：两档画质各 40 秒实际比赛渲染
node scripts/benchmark-race.mjs canyon # 落日峡谷：1080p、两档画质各 40 秒
node scripts/benchmark-ghost.mjs    # 开发版：1080p 可见幽灵车，两档画质各 20 秒
npm run build -- --base=/kart-racer/ # GitHub Pages 子路径构建
node scripts/validate-production.mjs # 自启静态文件服务器，验证子路径构建
```

浏览器测试使用已安装的 Chrome。没有 Chrome 时可安装 Playwright Chromium，并将 `playwright.config.ts` 的 `channel: 'chrome'` 删除。

`dist/` 可部署到静态托管。根路径使用普通构建；仓库子路径使用 `--base=/kart-racer/`，本地预览同样传入 `npm run preview -- --base=/kart-racer/`。生产静态站点通过已发布 manifest 展示工坊收藏，不请求本地 API，也不展示开发者生成面板。前端开发调试接口 `window.__kart` 在生产构建中不暴露。

[GitHub Actions](.github/workflows/pages.yml) 在 PR 上执行单元测试、构建和双赛道静态浏览器验收；主分支通过后上传并部署 Pages。CI 固定 Ubuntu 24.04，项目与 Action 均使用 Node.js 24；Playwright Chromium 在无 GPU 的运行器中使用 SwiftShader 软件渲染。构建只读，部署仅申请 Pages/OIDC 权限。公开站点首次启用后，后续推送 `main` 会自动发布。浏览器验收失败时，检查注释会显示具体错误，`static-validation` 附件中的 `test-results/production/` 保留诊断和截图。

原始 GLB 位于未提交的 `assets/source/`。需要重新优化时先恢复原文件，再执行：

```sh
npm run assets:optimize
npm run assets:kart    # 仅重新导出当前 Classic 赛车，不需要 Rodin 原文件
```

优化脚本压缩纹理和网格、导出 Classic 赛车并更新发布清单。初代 Rodin 收藏沿用原先的轮组区域裁剪参数。Classic 导出与实际游戏共用 `kart-model.ts`，合并静态同材质部件并保留独立轮轴；隐藏的动态尾焰不包含在静态 GLB 中。

## 工程与当前范围

- `apps/web/src/game/`：Three.js 场景、Rapier 碰撞、固定 60 Hz 驾驶、AI、检查点、音效。
- `apps/web/src/ui/`：React 菜单、HUD、车库、结算、工坊。
- `apps/asset-service/server.mjs`：Fastify + SQLite，Rodin 任务提交/查询/恢复/下载。
- `tests/`：规则与服务测试、Playwright 浏览器验收。
- [设计方案](docs/design-plan.md)、[验收记录](docs/validation.md)、[比赛结果](docs/race-validation.json)。

当前已完成首个可玩版本、Classic 赛车重做、[第二阶段体验打磨](docs/phase2-validation.md)、[第三阶段双赛道与赛事奖牌](docs/phase3-validation.md)及[第四阶段幽灵车、分段计时与发布配置](docs/phase4-validation.md)。地面高度来自样条投影，Rapier 处理车辆和护栏碰撞；尚未实现自由悬挂/跳跃、驾驶员骨骼动画、多人联机、道具赛、移动触控和用户生成模型自动装备。实际帧率与测试范围见验收记录。
