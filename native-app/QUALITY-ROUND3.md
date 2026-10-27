# 第三轮：内容丰富度

日期：2026-10-27。基线为完成前两轮修复的 SQL Lab 5.0 原生版和共享 Web 工程。源码仓库为 `/Users/fengguanjia/sql-trainer`，当前聊天的 Documents 目录保留原有兼容 HTML 和设计稿。

## 内容与入口

保留原 42 道核心题、28 节微课、9 个模板及稳定 ID，新增 109 项可作答训练，共 151 项核心与拓展任务。其中新增内容包含 101 项 SQL 任务、8 项客观题，手写 SQL 仍占主要比例。

| 内容 | 数量 | 实际行为 |
| --- | ---: | --- |
| 条件变化 | 42 | 每道核心题新增 `qN-v2`，变化日期、状态、空值、聚合粒度、保留范围、排名或排序条件。 |
| 综合迁移 | 42 | 每道核心题新增 `qN-v3`，迁移到用户行为、营销转化或库存履约业务。 |
| 独立专题 | 8 | 连续登录、中位数、自连接、有序漏斗各 2 题；有参考答案、独立判题与结果检查。 |
| SQL 纠错与补全 | 8 | 各 4 题，提供有缺陷或待补全 SQL，提交完整查询并在三组数据上判分。 |
| 选择辨析与结果预测 | 8 | 各 4 题，按选项判分并保存错题、尝试与独立/辅助记录。 |
| 综合项目 | 1 | 营销投入复盘，提交 SQL、解释口径与结果、对照人工自查标准，导出含实际 SQL、结果和样本状态的 Markdown 作品。 |

Web：「训练 → 练习 → 变式与专题训练」；每道核心题另有「同知识点：条件变化与综合迁移」。原生：「训练 → 变式与专题训练」；核心题与周次页也可进入。原生搜索覆盖拓展题，库内可搜索或按题型筛选；Web 库支持周次、题型及场景筛选。

| 周次 | 原核心题 | 新增训练 | 新增 SQL 任务 |
| --- | ---: | ---: | ---: |
| W1 | 6 | 12 | 12 |
| W2 | 6 | 15 | 13 |
| W3 | 6 | 16 | 15 |
| W4 | 5 | 11 | 11 |
| W5 | 5 | 13 | 11 |
| W6 | 5 | 13 | 13 |
| W7 | 5 | 15 | 13 |
| W8 | 4 | 14 | 13 |

## 数据、判分与兼容

- 四类业务共 10 张表。新增 `events`、`campaigns`、`leads`、`ad_spend`、`inventory`、`shipments`；页面解释记录粒度、连接关系并可查看表定义与样例行。库存关联须同时使用 `sku` 与 `warehouse`，有序漏斗须同用户、同会话且逐步时间递增。
- SQL 任务均在业务、边界、空集三组数据库上运行，同一份查询须全部通过。边界数据覆盖 NULL、同名用户、重复明细/行为、并列价格、跨月连续登录、零订单日、零花费及零分母。旧核心题继续使用原种子库，不改变原答案基准。
- 三组数据是可复现的有限测试，不证明任意数据库上的数学正确性。专题和项目额外用独立预期值核对；代表性错误答案覆盖同名合并、错误计数、漏关联复合键、未去重连续登录、乱序/跨会话漏斗及硬编码结果。
- Web 判题改为通过预编译语句获取列信息，零行查询仍校验列数；原生与 Web 对照完整列名、值和空结果。排序与并列沿用既有协议。
- 新内容仍用 SQLite 执行。每项 SQL 配 MySQL 8 阅读对照；日期差、递归日历、连续日期分组、中位数整数位置分别标出函数或除法差异。学习计划统一说明本机使用 SQLite，MySQL 对照服务笔试迁移。
- `practice` 与核心题目录分离；新增作答进入原有 done/wrong/notes/attempts/sr/history/evidence，沿用 v1 备份及修订合并，不新建认证或云服务。核心通过数、42 题里程碑、原周测抽题和原课程 ID 不因拓展变动。
- 原生能力档案纳入拓展作答；错题与到期复习可重练新增任务。Web 亦保存拓展草稿、上次练习、错题、复习与备份记录。已发布旧客户端未升级前不能识别新增 ID，跨端备份与同步需要双方升级到本轮实现。
- 作品中的表达与业务判断使用人工自查标准，SQL 自动通过不等于分析结论已获评价；MySQL 对照未连接 MySQL 实际运行。

## 验证记录

共享测试、原生测试、构建、浏览器和模拟器证据见仓库 `output/round3/` 以及 `output/release/app-acceptance.json`。

| 验证 | 最终结果 | 证据 |
| --- | --- | --- |
| JavaScript 模块与可靠性测试 | 55/55 通过，包含本轮内容、三组判分和系统故障隔离。 | `output/round3/web-tests.log` |
| Swift 核心测试 | 33/33 通过，包含 109 项参考查询跨引擎结果对照、101 项 SQL 三组判分和进度隔离。 | `output/round3/native-tests.log` |
| Web 正式构建 | 通过；发布脚本仅检查 11 项资源，未执行发布。 | `output/round3/build.log` |
| 浏览器交互 | 本轮 7 组及 Web App 5 组全部通过；包含 SQL 与客观题作答、草稿恢复、错题、独立重做、离线、子路径更新和 Markdown 作品内容读回。320/390/768/1440 视口检查通过。 | `output/round3/browser.log`、`output/release/app-acceptance.json` |
| iOS 静态检查与编译 | `ios:check` 通过；键盘工具栏最后修订后的当前源码亦已由最终 UI 验收重新编译并运行。 | `output/round3/ios-check.log`、`output/round3/practice-ui-final.log` |
| iOS 模拟器交互 | 2/2 通过：选择错误→正确→独立重做；训练库搜索→输入 SQL→收起键盘→三组判分。设备为本轮隔离的 iPhone 18 Pro / iOS 27.0。 | `output/round3/practice-ui-final.xcresult`、`output/round3/ios-ui-summary.json` |
| 原生资源一致性 | 当前构建包的全部 12 项内容与数据库资源逐字节等于源码资源。核心 42 题、拓展 109 项、28 节微课、9 个模板均已进入构建。 | `output/ios-round3/Build/Products/Debug-iphonesimulator/App.app/SQLLab_SQLLabCore.bundle/` |

共享内容指纹：`a9358efcb1bf38afaed9ed311222c8709299083ff22db2f4677adfc9216300bc`。最终 `native:test` 同时完成资源新鲜度检查。相关已跟踪 diff 的空白检查通过。

模拟器截图已实际查看，保存在 `output/round3/ios-screenshots/`；Web 手机截图在 `output/playwright/round3-library-mobile.png` 和 `output/playwright/round3-practice-mobile.png`。

首次模拟器 SQL 验收因键盘影响滚动而失败，记录保留在 `output/round3/practice-ui.xcresult`。增加「收起键盘」工具栏后复验通过，最终结果以 `practice-ui-final.xcresult` 为准。最终包仍记录 1 条 `Invalid frame dimension (negative or non-finite).` 运行时布局告警，未提供源码定位；当前截图及两条交互断言通过，但不能据此声称没有运行告警。

本轮不包含提交、推送、线上部署、真机安装包更新、真实云账号往返、系统通知或 VoiceOver 验收。
