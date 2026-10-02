# 可玩版本、Classic 造型与第二阶段验收记录

日期：2026-10-01。版本：0.1.0。入口：[开发版](http://localhost:5174) / [静态生产预览](http://127.0.0.1:4176)。

已完成核心单机比赛、真实 Rodin 场景资产接入、Classic 赛车重做与第二阶段驾驶/渲染打磨。最新优化数据见 [第二阶段验收](phase2-validation.md)。当前赛车为原创程序建模，初代 Rodin 赛车移入工坊收藏。

## 自动化结果

| 检查 | 结果 | 覆盖 |
| --- | --- | --- |
| `npm test` | 27 / 27 通过 | 17 项比赛/驾驶规则、3 项渲染资源、7 项资产服务 |
| `npm run test:browser` | 5 / 5 通过 | 左右方向与漂移、真实键盘、小喷 HUD、暂停视觉与固定 FOV、车库/工坊/设置、完整比赛与存档 |
| `npm run build` | 通过 | TypeScript 检查与 Vite 生产包 |
| 10 局三圈比赛 | 10 / 10 完赛 | 简单 5 局、普通 5 局，使用开发测试接口自动驾驶 |
| AI 完赛 | 5 / 5 完赛 | 普通难度，玩家停留起点，AI 独立运行 |
| 计时练习 | 通过 | 单车三圈完赛 |
| 成绩持久化 | 通过 | 10 场竞速 + 1 场计时，刷新后 11 条记录 |
| 独立生产包 | 通过 | 四件 GLB HTTP 200、W 加速、静态工坊、新赛车预览、无开发调试接口 |
| Classic 造型 | 通过 | 三色、前/侧/后三视图、车库、比赛、独立轮组与双尾焰 |

第二阶段比赛自动驾驶结果：简单约 **127.68 秒**，普通约 **101.35 秒**。同一输入与初始状态产生确定性结果；十局验证覆盖连续重赛和状态复位，并非十次随机或人工手感测试。完整数据见 [race-validation.json](race-validation.json)。

规则测试验证有序检查点、三圈边界、逆向/跳点/驶出道路不计圈、复位不重复计点、30/60/120 渲染 FPS 下固定步长轨迹一致、追帧上限、有效漂移集气、小喷及氮气按次消耗。

浏览器使用真实键盘事件验证 W 加速、Shift+D 漂移、松开 Shift 小喷、R 复位加时、Esc 暂停、暂停时计时/车轮/特效不变、重赛清空圈速与特效。暂停清空按键不会在继续比赛时误触发小喷；关闭镜头效果后小喷期间仍保持 62° FOV。首版补充测试曾通过真实 Space 按键验证氮气库存从 1 变为 0，历史数据见 [nitro-validation.json](nitro-validation.json)。

左右转向修复：统一 `steer=+1` 表示驾驶视角左转，修正 +Z 前进坐标系下的偏航符号，并同步前轮动画、AI 输入与弯道文字提示。新增四个车头朝向的相机空间回归测试，修复前全部失败、修复后全部通过；浏览器逐一验证 A、D、←、→ 在普通转弯和漂移时，车头及位移方向均与按键一致。10 局完赛与 5 名 AI 完赛回归通过。

资产服务全部使用模拟响应，不产生付费测试任务。覆盖缺失密钥、来源限制、请求幂等、凭据不外泄、空状态列表、阶段失败、429/Retry-After、提交结果未知、超时后恢复、进程重启恢复及过期签名地址重新获取。

## 真实模型

| 模型 | 来源 | 发布三角形 | GLB 大小 |
| --- | --- | ---: | ---: |
| 浪游者 Classic（当前赛车） | Coastline Club / 原创程序建模 | 30,438 | 205,668 B |
| 初代概念车（工坊收藏） | Hyper3D Rodin Gen-2.5 / OAuth MCP | 10,209 | 252,756 B |
| 海岛棕榈 | Hyper3D Rodin Gen-2.5 / OAuth MCP | 3,500 | 160,020 B |
| 海岸砂岩 | Hyper3D Rodin Gen-2.5 / OAuth MCP | 2,000 | 106,396 B |

四件 GLB 合计 **724,840 B，约 0.69 MiB**。模型清单保存稳定来源页，不保存临时下载签名。Classic 由游戏代码直接建模，工坊 GLB 从同一函数导出，保留独立轮组；比赛仅加载棕榈和岩石两个场景 GLB。初代概念车沿用原轮组裁剪，只作收藏。Rodin 原始 GLB 保存在本地忽略目录。

本次重做未产生新的付费生成任务。造型与展示见 [kart-redesign.md](kart-redesign.md)。

网页 REST 生成功能使用独立环境变量密钥，当前未配置密钥；真实供应商链路由已授权的 OAuth MCP 完成。新生成的网页任务可下载和预览，尚未自动优化/装备到比赛中。

## 浏览器与性能历史

本节保留首版和 Classic 重做阶段的历史环境结果。第二阶段已重新测量同条件静态开销及两档各 40 秒实际比赛，最新结果见 [第二阶段验收](phase2-validation.md)，不将不同刷新率环境的帧率差异归因于代码优化。

环境：Apple M5 Pro、48 GiB RAM、macOS、Chrome **149.0.7827.54**、Playwright 无头模式。以下 FPS 数据来自首版；1080p 测试 viewport 为 1920×1080、deviceScaleFactor=1，每档连续记录约 10 秒实际比赛渲染。

| 画质 | 平均 FPS | P95 帧间隔 |
| --- | ---: | ---: |
| 精致 | 30.04 | 34.2 ms |
| 流畅 | 30.01 | 34.1 ms |
| 相同浏览器的空白页基线 | 30.07 | — |

空白页基线同样约 30 FPS，本次环境不足以验证 60 FPS 目标；**不将 60 FPS 记为已通过**。需要在常规有界面的浏览器、目标显示器刷新率和更多硬件上再测。当前样本没有页面运行异常。数据见 [performance.json](performance.json)。

首版在本地 Vite 已预热环境，从导航到三件模型加载完成测得 734 ms；此结果不代表本次重做或公网冷启动。本次构建物理引擎分块约 2.24 MB（gzip 0.84 MB），Vite 给出大分块提示，构建成功。

Classic 重做后，1440×900 车库观测为 133 次绘制、127,614 个渲染三角形，显存计数 375 件几何、16 张纹理；镜头位置会影响该计数。单车固定展示视图为 30 次绘制（含地面），开启尾焰为 34 次。合并静态部件保留四轮动画，数据见 [classic-model-validation.json](classic-model-validation.json) 和 [classic-production-validation.json](classic-production-validation.json)。本轮未重新测量 FPS，不据此声称达成 60 FPS。

390×844 检查确认显示电脑键盘提示。本版没有移动触控驾驶。声音开关及合成音频代码可工作，音效听感仍需用户实际试听。

## 视觉与验证截图

- [主菜单](screenshots/menu.png)
- [橘色车库](screenshots/garage.png)
- [Classic 三视图与三色](screenshots/classic-kart-views.png)
- [Classic 蓝色车库](screenshots/classic-garage.png)
- [比赛 HUD](screenshots/race.png)
- [漂移](screenshots/drift.png)
- [三圈结算](screenshots/finish.png)
- [Rodin 资产工坊](screenshots/workshop.png)
- [Classic 静态生产工坊](screenshots/classic-production-workshop.png)
- [移动端提示](screenshots/mobile.png)

已修复开发环境 StrictMode 并发初始化 Rapier 导致的偶发 WASM 访问异常，改用共享初始化 Promise。本次生产调试接口检查仍为 `undefined`，四件 GLB 加载正常，静态工坊预览与键盘加速通过，没有页面异常，详见 [classic-production-validation.json](classic-production-validation.json)。

## 后续重点

1. 人工试玩调节转向、漂移集气、AI 速度与比赛时长；扩大常规浏览器与硬件性能验证范围。
2. 驾驶员动态动作、更多车款；远景 AI LOD 已完成。
3. 更多赛道/装饰和触控；多人、道具赛独立规划。
