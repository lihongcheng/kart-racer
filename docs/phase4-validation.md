# 第四阶段验收：幽灵车、分段计时与静态发布

日期：2026-10-02。范围对应 [实施方案](phase4-plan.md)。功能代码与本地验收完成；公开站点首次启用尚待仓库管理员操作，当前不宣称已上线。

## 已交付

- 两赛道各自保存最佳三圈的姿态回放，固定物理时间步下约 10 Hz 采样，比赛时钟插值。幽灵车使用独立半透明 Classic 网格，不加入物理世界和计圈名单。
- 暂停冻结、重赛归零，复位编码瞬移边界及两秒罚时停留。计时菜单与设置中的开关持久化；关闭显示仍记录。
- 每圈三段、整场九段。HUD 显示本段用时、最近分段差和累计差；结算显示九段表格与进步/损失最多路段。出发时冻结对比基准。
- 新增 `coastline.timing.v1`，与原 `coastline.records.v2` 关联校验。较慢和持平成绩不能替换最佳；旧最快没有轨迹时等待刷新纪录。损坏轨迹不阻止比赛，有效分段可以独立保留。
- 超过 15 分钟或 10,000 帧时丢弃不完整回放，保留完整成绩与九段。存储失败保留当前页面基准并提示。
- 资源使用 Vite base，生产工坊读取发布清单，无本地 API 请求和开发者生成面板。PR 验证、主分支自动部署的 Pages 工作流已配置。

## 验证结果

| 检查 | 实际结果 |
| --- | --- |
| `npm test` | 51/51 通过，包含原有 39 项及新增 12 项 |
| `npm run test:browser` | 14/14 通过，保留原有 9 组及新增 5 组 |
| `npm run build -- --base=/kart-racer/` | TypeScript 与生产构建通过 |
| `node scripts/validate-production.mjs` | 严格静态文件服务器下，双赛道键盘驾驶、暂停、重赛、赛道持久化通过 |
| 生产资源 | 四件 GLB 返回 200，校验 glTF 文件头，逐件预览与下载通过 |
| 生产隔离 | 无根路径资源请求、无 `/api` 请求、无 `window.__kart` 和开发者生成面板 |
| 布局 | 检视 1280×720 双赛道菜单和九段结算，1440×900 生产场景与工坊 |

新增浏览器用例在两赛道分别完成首场记录、刷新最佳、较慢比赛不覆盖、刷新恢复、幽灵车暂停冻结、重赛归零、复位、开关持久化和竞速模式隔离。另覆盖旧最快不生成替代轨迹、模拟存储配额失败、超过 15 分钟仍完赛、复位编码、损坏存档可开赛。原有双赛道 20 场竞速完赛与全部 AI 完赛回归仍通过。

纯逻辑用例检查 30/60/120 Hz 下固定步采样一致、方向角跨 ±π 最短插值、复位禁止跨地图插值、时间边界、九段和等于总用时、分段与累计差、容量上限、版本/赛道/总成绩匹配、旧存档与较慢成绩保护。

静态验收数据：[phase4-production-validation.json](phase4-production-validation.json)。

## 性能与画面

本机 Chrome 149 无头浏览器，1920×1080，落日峡谷计时模式，每档真实运行 20 秒；采样时未加速模拟。两档采样各 2,401 帧，幽灵车均处于显示状态，比赛时间各推进 20 秒。

| 画质 | 平均 FPS | P95 帧耗时 | 平均 draw calls | 平均三角形 |
| --- | --- | --- | --- | --- |
| 精致 | 120.02 | 9.0 ms | 100.7 | 99,031 |
| 流畅 | 120.01 | 9.1 ms | 100.7 | 99,048 |

没有运行时异常。结果受本机浏览器约 120 Hz 的刷新频率限制，不能推断其他设备帧率。详见 [performance-phase4-ghost.json](performance-phase4-ghost.json)。

- [可见幽灵车与分段 HUD](screenshots/phase4-ghost-race.png)
- [海风环线结算](screenshots/phase4-coastline-results.png) / [落日峡谷结算](screenshots/phase4-canyon-results.png)
- [720p 计时菜单](screenshots/phase4-canyon-menu.png) / [静态工坊](screenshots/phase4-production-workshop.png)

## 发布状态与首次启用

工作流：[pages.yml](../.github/workflows/pages.yml)。构建使用 Node.js 24，执行单元测试、生产构建与 Playwright Chromium 静态验收，再上传 Pages artifact；主分支才进入部署。

目标地址：`https://lihongcheng.github.io/kart-racer/`。开发时公开 API 返回仓库尚未启用 Pages；当前会话有 SSH 推送权限，但没有修改仓库 Pages 设置的管理认证。首次启用不是 SSH 推送或工作流默认令牌可以代办的操作。

管理员在 [Settings → Pages](https://github.com/lihongcheng/kart-racer/settings/pages) 将 Source 设为 **GitHub Actions**，再在 [Actions](https://github.com/lihongcheng/kart-racer/actions/workflows/pages.yml) 运行或重跑部署。部署成功后需访问公开地址确认加载；此步骤完成前，在线试玩仍为待启用状态。本地与在线存档按站点分别保存。
