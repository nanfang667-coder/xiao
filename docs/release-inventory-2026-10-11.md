# 待上线代码盘点（2026-10-11）

盘点范围：本地分支 `codex/multi-site-channels`，相对最近提交 `7d02ce6`（2026-09-27）的工作区差异。盘点开始时有 38 个已跟踪文件被修改，另有新增源码、测试、迁移和文档尚未跟踪。本次未核对生产环境，不能据此断定每一项线上都尚未存在。

## 功能与代码范围

| 模块 | 本地新增或修改内容 | 主要文件/目录 |
| --- | --- | --- |
| 推广短链统计 | 新增推广渠道管理、创建/编辑/启停、复制重定向地址；按渠道显示今日新增、近24小时、累计独立访客和访问次数；主站统一匿名 Cookie 去重；独立于邀请码统计 | `src/app/adminzhangzhang/channels/`、`src/app/go/[code]/route.ts`、`src/lib/promotion-channel*.ts` |
| 合作网站导入 | 来源及解析规则、按页任务、暂停/继续和重试、内容去重及版本；支持正文与字段拆分、来源图片适配、私有草稿编辑、选择照片及人工发布 | `src/app/adminzhangzhang/partner-import/`、`src/lib/partner-import*.ts` |
| 导入稿团队协作 | 初审后分配团队成员，成员完善信息并提交，管理员终审发布或退回；团队只看自己的分配稿；投稿管理支持卡片内终审；删除账号时未完成分配稿退回私有草稿池 | `src/app/team/assigned/`、`src/app/adminzhangzhang/submissions/`、`src/lib/admin-cooperation.ts`、`src/lib/partner-import-assignment.ts` |
| 导入文件中转及图片处理 | 本地导入后下载/上传 JSONL 文件，可跳过重复版本；图片网址覆盖的位置与尺寸可调；任务/草稿分页与批量清理 | `partner-import/transfer/route.ts`、`partner-import/TransferUpload.tsx`、`src/lib/partner-import-transfer*.ts`、`src/lib/partner-import-photo-cover*.ts`、相关列表与删除逻辑 |
| 团队固定额度 | 从每月额度改为账号累计固定额度，跨月不重置；追加额度永久累加；已有22/150档位及旧30档兼容；各后台统一显示累计使用与剩余 | `src/lib/team-post-quota.ts`、`src/app/adminzhangzhang/sites/`、`src/app/team/actions.ts`、团队首页/帖子列表/新建页 |
| 团队额度记录 | 新增账号创建、追加额度、基础额度调整的记录；按账号/北京时间月份查询；保留删除账号的历史；升级时生成旧余额快照 | `src/app/adminzhangzhang/sites/quota-history/page.tsx`、`src/lib/team-quota-history-readiness.ts`、`scripts/apply-team-quota-history-schema.mjs` |
| 赔付展示标识 | 管理员逐帖设置“已交定金，支持赔付”；首页、地区、全国推广卡片显示红色盾牌角标；历史帖子默认关闭，团队和导入流程不会覆盖管理员设置 | `src/components/CompensationBadge.tsx`、`TeacherCard.tsx`、`NationalPromotionCard.tsx`、`src/lib/teachers.ts`、管理员新增/编辑操作 |
| 发帖表单与图片兼容 | 独立 CSS、移动端布局和标签关联；提交预览中完整的累计/压缩/排序图片；摆脱 DataTransfer 赋值依赖；处理图片期间防止重入 | `src/app/adminzhangzhang/TeacherForm.tsx`、`TeacherForm.module.css`、`src/lib/post-photo-selection.ts`、`teacher-post-input.ts` |
| 邀请域名兼容与登录提示 | 邀请链接在允许的 fenglou1.com、fenglou2.com、sjeeqw.fit、zollot.world 域名上保持入口归属；团队登录用户名转小写，限流单独提示15分钟；详情联系方式标签由“其他”改为“与你号” | `src/lib/referral.ts`、`site-config.ts`、`src/app/team/actions.ts`、`src/app/team/login/page.tsx`、`src/app/teacher/[id]/page.tsx` |
| 独立邀请入口页 | 静态中转页面、预览模式和单文件构建；当前解析 `?code=邀请码` 并前往 sjeeqw.fit 对应邀请码路径；没有接入主站 Next.js 路由 | `entry-page/` |
| 依赖与部署 | 新增 cheerio 1.1.2 及锁文件；代理请求上限20mb；蓝绿部署保留 `storage/partner-import` 私有照片目录；新增说明、定向补结构脚本及各模块测试 | `package.json`、`package-lock.json`、`next.config.ts`、`scripts/blue-green-deploy.sh`、`ZERO_DOWNTIME_DEPLOY.md`、`scripts/`、`docs/` |

团队额度的22/150档位此前已经存在，本次变更点是累计固定额度及永久追加。历史待审核/已通过的新帖占额度，拒审释放，普通删帖不退，修改类投稿不占新帖额度。赔付开关只控制展示，不包含自动收款或理赔流程。

## 本地新增的五份数据库迁移

按文件名顺序列出；生产环境实际待执行项需要核对迁移登记。

1. `20260928000100_add_partner_imports`：新增合作来源、导入任务、任务条目、原帖映射和草稿5张表。
2. `20260928000300_add_partner_import_assignments`：草稿增加团队负责人，投稿增加导入草稿关联及索引。
3. `20261001000100_add_team_post_quota_events`：新增额度记录表，并为现有账号写入一次当前余额快照。
4. `20261005000100_add_teacher_compensation`：帖子增加 `supportsCompensation` 字段，默认关闭。
5. `20261011000100_add_promotion_channels`：新增推广渠道和匿名访客表及索引。

更新数据库后需要重新生成 Prisma Client。赔付字段被前台查询使用，不能只上线源码而遗漏该字段；额度记录结构未就绪时，新建账号和修改额度也会被阻止。

## 一起上线前需要处理的事项

1. **提交范围**：大量新增源码目前未跟踪。蓝绿脚本从指定 Git 提交归档发布，不会带上本地未提交的内容。需把本次业务源码、迁移、依赖锁文件、测试及说明纳入准备发布的提交。
2. **gp77.top 配置冲突**：旧 `DOMAIN_REDIRECT_PLAN.md` 计划按原路径直接301跳到主站；新的推广统计需要经过 `/go/gp77`。直接跳首页会绕过渠道计数。上线前统一推广入口规则；如保留原帖深链接或其他业务路径，需分别处理。
3. **静态入口区分**：`entry-page/` 当前是邀请码中转，不能直接拿它当推广渠道入口；它需要单独部署、配置目标和缓存规则。
4. **部署脚本选择**：新出现的根目录 `deploy.sh` 属于旧初始化脚本，包含重写 `.env`、旧初始化及密钥占位符流程；本次增量上线不应直接使用。`.codex-recover.bat` 是本机运维辅助文件，不是应用运行代码。沿用并审查现有蓝绿部署流程。
5. **迁移与运行环境**：核对线上已应用迁移及是否执行过定向补结构脚本，避免重复加字段。现有说明记载从空库重放旧迁移曾遇到缺少 `Order` 表的问题，本轮未复现，也未查询生产库。新依赖和使用 `node:sqlite` 的补结构脚本均需要核对服务器 Node 版本。
6. **存储与请求大小**：导入草稿照片目录和公开上传目录需要跨版本保留。文件中转单请求最多18MiB，应用代理已放宽到20mb，外层反向代理需要相应支持。
7. **测试遗留项已修复（2026-10-12）**：`scripts/referral-tracking.test.mjs` 的模拟函数已从 `getTrustedSiteOrigin` 对齐到 `getReferralSiteOrigin`，保留原有去重、归属、注册及 Cookie 断言。邀请码、渠道及访客统计相关回归共76项通过，之前的7项失败已消除。
8. **发布排除项**：已在 `.gitignore` 加入 `.playwright-cli/`、`output/`、`.codex-recover.bat` 和根目录旧 `deploy.sh`，保留本地文件而不纳入提交。临时验证目录、构建产物、环境文件、真实数据库和上传数据继续按已有规则排除。忽略规则不替代正式发布提交的文件复核。

## 发布文件范围（2026-10-12 准备）

| 范围 | 处理方式 |
| --- | --- |
| `src/` 的业务源码、样式及相关测试 | 纳入本次待审查提交 |
| `prisma/schema.prisma`、上述五份迁移 | 与对应源码一并纳入；不包含数据库文件 |
| `package.json`、`package-lock.json`、`next.config.ts` | 一并纳入，保证依赖与配置一致 |
| `.gitignore`、`scripts/` 的业务测试和蓝绿部署变更、`docs/`、`ZERO_DOWNTIME_DEPLOY.md` | 纳入待审查提交；定向补结构脚本不自动执行 |
| `entry-page/` 源码及说明 | 可随代码保存，但单独构建和部署；`dist/` 已由该目录的忽略规则排除 |
| `DOMAIN_REDIRECT_PLAN.md` | 旧方案与推广统计入口冲突，已留在本地、未纳入发布候选，修订前不作为域名操作依据 |
| 验证产物、本机辅助脚本、旧初始化脚本、运行数据 | 不纳入发布提交，不删除本地文件 |

2026-10-12 已把上述业务源码、迁移、依赖、测试和说明整理并暂存为发布候选。独立入口源码随代码保存，仍需单独部署。正式发布仍需核对服务器状态、迁移登记、备份及域名配置；此清单不代表已经推送或上线。

## 当前验证状态

2026-10-12 发布候选在新的隔离源码副本中验证，阻断环境文件读取和外部网络，使用新建 SQLite 测试库；没有复制运行数据或访问真实数据库。

- 整批脚本、库及独立入口页测试666项全部通过，无跳过项。修复两处旧测试夹具：邀请码 mock 接口，以及分配兼容测试缺少已要求迁移的赔付字段；原有业务断言保留。
- 本次所有变更的 JavaScript/TypeScript 文件定向 ESLint、完整 TypeScript 检查通过。
- Next.js 16.2.10 的 Webpack 生产构建通过，生成27个页面。隔离副本因多锁文件产生 tracing root 提示，不影响本次构建结果；这不替代 Linux 服务器上的最终安装与构建。
- 部署脚本改为比较活动/目标 Git 提交中的迁移树，避免源码目录更新后误判迁移未变；新增4项离线部署测试包含在666项内。迁移已开始后发生失败，会明确提示数据库不会随应用回滚。
- 发布前仍需核对线上迁移及定向补结构记录、备份服务、Node 版本和持久化存储。团队额度快照迁移前至新进程接管并排空旧进程期间，应暂停团队账号创建、额度变更与团队投稿；部署脚本不会自动强制这项写入暂停。

此前已做过本机生产服务请求和手机/桌面页面验收。本轮尚未进行生产环境操作；gp77 的渠道创建、域名跳转和实际入口验收在主站发布后进行。

模块说明：`docs/partner-import.md`、`docs/team-post-quota.md`、`docs/compensation-badge.md`、`docs/promotion-channels.md`。
