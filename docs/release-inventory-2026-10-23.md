# 待上线代码清单（更新至 2026-10-25）

本清单按当前本地提交 `bc365b2`（分支 `codex/multi-site-channels`）与工作区的差异整理，包含新增、修改和从源码中删除的文件。它不是与正式服务器版本的比较。本次未执行提交、推送或正式部署。

盘点时共有 **67 个源码文件、53 个测试文件、1 个工具脚本、1 个使用说明文件，共 122 个业务相关变更文件**；按操作分为新增 34 个、修改 34 个、删除 54 个。各分类均包含相应删除文件。

本清单文件自身另计 1 个文档。此前已有的 [DOMAIN_REDIRECT_PLAN.md](E:/hulim/DOMAIN_REDIRECT_PLAN.md) 未纳入本次业务发布范围；未读取其内容。下方“删除”表示待上线版本将移除该文件，不是新增功能文件；已删除文件以完整原路径列出。

## 功能改动

| 功能 | 当前待上线行为 | 主要文件 |
| --- | --- | --- |
| 商家地区筛选 | 商家管理新增与老师管理相近的地区卡片，先选省份，再选城市；直辖市选择区。显示各地区商家数量，支持全部、重新选择省份、展开和收起。兼容旧地区简称，筛选保留原商家顺序及未公开记录。 | [merchants/page.tsx](E:/hulim/src/app/adminzhangzhang/merchants/page.tsx)、[AdminMerchantFilters.tsx](E:/hulim/src/app/adminzhangzhang/merchants/AdminMerchantFilters.tsx)、[admin-merchant-filters.ts](E:/hulim/src/lib/admin-merchant-filters.ts) |
| 商家帖子隐藏与恢复 | 每条商家增加“隐藏／恢复展示”按钮，编辑和新增表单可选“正常显示／隐藏此商家帖子”。复用 `isPublished`，隐藏后公开列表、地区选项、详情、metadata、站点地图和阅读计数均不提供该帖子；后台保留资料和照片供恢复，不执行数据库迁移。操作须管理员授权，仅修改显示状态并刷新相关页面。 | [MerchantVisibilityButton.tsx](E:/hulim/src/app/adminzhangzhang/merchants/MerchantVisibilityButton.tsx)、[MerchantForm.tsx](E:/hulim/src/app/adminzhangzhang/merchants/MerchantForm.tsx)、[merchants/actions.ts](E:/hulim/src/app/adminzhangzhang/merchants/actions.ts) |
| 安全提示文案与红字 | 第一段改为“不要裸聊、刷单、下载、充值陌生软件”；末句改为“有诱导充值、欺骗行为，联系邮箱举报。”；其中“诱导充值、欺骗行为”与前面红字采用相同的红色加粗样式。 | [SafetyNotice.tsx](E:/hulim/src/app/teacher/[id]/SafetyNotice.tsx) |
| 合作网站图片获取 | 原“合作网站导入”改为“合作网站图片”，只获取、预览和下载图片，不建立帖子、导入任务或待审稿。支持列表页、前三页和单篇文章。 | [ImageCollector.tsx](E:/hulim/src/app/adminzhangzhang/partner-import/ImageCollector.tsx)、[image-actions.ts](E:/hulim/src/app/adminzhangzhang/partner-import/image-actions.ts)、[partner-images.ts](E:/hulim/src/lib/partner-images.ts) |
| 图片下载与继续获取 | ZIP 中图片直接平铺，命名如 `page-001-photo-01.jpg`。支持去重、暂停、继续，每批最多 400 张或 64 MB；确认保存本批后可继续。图片仅留在当前浏览器页面内存中，刷新或离开后清除。 | [partner-images-zip.ts](E:/hulim/src/lib/partner-images-zip.ts)、[partner-image-download.ts](E:/hulim/src/lib/partner-image-download.ts)、[partner-image-pagination.ts](E:/hulim/src/lib/partner-image-pagination.ts) |
| 66feng 列表适配 | 列表页和前三页模式从公开列表接口的图片数组获取图片，不打开帖子详情，不提取标题、正文或联系方式。保留城市和类型条件；列表页保留输入页码，前三页从第 1 页开始。通用来源仍支持 HTML 图片提取。 | [partner-66feng-images.ts](E:/hulim/src/lib/partner-66feng-images.ts)、[partner-import-fetch.ts](E:/hulim/src/lib/partner-import-fetch.ts)、[partner-import-parser.ts](E:/hulim/src/lib/partner-import-parser.ts)、[partner-image-parser.ts](E:/hulim/src/lib/partner-image-parser.ts) |
| Discuz 论坛适配 | 默认规则支持论坛标准标题及自定义图片卡片，严格识别同路径的帖子查询链接并归一为首帖首页；只取可明确识别的首帖正文和同区附件，不回退到回复，支持附件懒加载和标准下一页。新增来源级“应用 Discuz 首帖图片规则”按钮，明确保存后适配帖子区初始隐藏的主题，保留其他隐藏及首帖边界。 | [partner-import-parser.ts](E:/hulim/src/lib/partner-import-parser.ts)、[partner-discuz-image-rules.ts](E:/hulim/src/lib/partner-discuz-image-rules.ts)、[partner-image-pagination.ts](E:/hulim/src/lib/partner-image-pagination.ts)、[ImportForms.tsx](E:/hulim/src/app/adminzhangzhang/partner-import/ImportForms.tsx) |
| 来源配置入口与独立保存 | 增加“编辑此来源配置”联动，选中已有来源后可编辑 JSON 并保存。恢复默认帖子链接规则只替换该项，保留图片和翻页配置，不会自动保存。来源保存抽为独立采图配置服务，不再依赖旧导入工作流。 | [ImportForms.tsx](E:/hulim/src/app/adminzhangzhang/partner-import/ImportForms.tsx)、[PartnerImagesWorkspace.tsx](E:/hulim/src/app/adminzhangzhang/partner-import/PartnerImagesWorkspace.tsx)、[partner-image-sources.ts](E:/hulim/src/lib/partner-image-sources.ts)、[partner-import/actions.ts](E:/hulim/src/app/adminzhangzhang/partner-import/actions.ts) |
| 删除合作稿团队流转源码 | 删除导入任务、待审稿、团队分配、补稿、终审、发布、中转和私有稿件图片的页面、接口、界面组件、旧动作和专用服务；旧路由不再注册，不保留停用页面或跳转入口。标题、正文及联系方式的导入解析和旧分配 schema 工具一并删除。下方逐项列出删除文件。 | [partner-workflow-removed.test.mjs](E:/hulim/scripts/partner-workflow-removed.test.mjs)、[partner-import/actions.ts](E:/hulim/src/app/adminzhangzhang/partner-import/actions.ts)、[partner-import-parser.ts](E:/hulim/src/lib/partner-import-parser.ts) |
| 隔离历史导入记录 | 普通投稿审核、后台汇总、团队首页待审计数及“我的帖子”列表排除历史导入稿。保留历史数据和兼容旧数据库的外键检查；删除团队账号时仅释放历史稿件可空账号外键，不恢复分配流转。 | [ordinary-submission-boundary.ts](E:/hulim/src/lib/ordinary-submission-boundary.ts)、[admin-cooperation.ts](E:/hulim/src/lib/admin-cooperation.ts)、[submissions/actions.ts](E:/hulim/src/app/adminzhangzhang/submissions/actions.ts)、[sites/actions.ts](E:/hulim/src/app/adminzhangzhang/sites/actions.ts)、[team/page.tsx](E:/hulim/src/app/team/page.tsx)、[team/posts/page.tsx](E:/hulim/src/app/team/posts/page.tsx) |
| 结构诊断辅助代码 | 新增仅返回数量、标记和结构信息的纯解析工具及对应测试，不返回帖子文本。它未接入当前生产采图调用链。 | [partner-list-diagnostics.ts](E:/hulim/src/lib/partner-list-diagnostics.ts) |

## 本批上线影响

- 删除的是旧功能源码，不是清空历史数据；没有新增删表或数据库迁移，历史合作记录和已有图片不做自动清理。旧路由不再提供，历史未完成导入稿不能继续原流程。
- 已经发布的帖子、普通团队投稿、团队账号和固定发帖额度流程保留；历史导入稿从普通待审、历史列表及相应计数中隔离。
- 新采图结果不会写入服务端帖子表或媒体目录；已有来源配置继续使用。
- 相对当前本地提交，没有数据库 schema/迁移、依赖锁文件或部署脚本改动；旧团队分配的 schema 辅助脚本及其测试已删除。
- 邀请码静态跳转页、品牌改名和前期服务器迁移属于更早已提交的代码，不计入本批未提交改动；它们是否已在线需另与正式服务器版本核对。
- 现有增量部署流程按 Git 提交导出发布版本，当前工作区改动尚不会自动进入部署包。此次未执行提交、推送或部署。

## 验证状态

- 已完成一轮 274 项合成数据回归，覆盖采图和旧流程删除相关检查；之后追加的普通记录删除与解析错误相关 35 项合成测试另行通过。最终团队两页调整后，旧稿隔离、配额、访客统计和删除完整性相关 15 项测试再次通过；各轮不作简单累加。
- 商家地区筛选及商家、前台地区相关回归此前完成 23 项合成数据测试。
- 旧流程源码删除及最终团队两页调整后，定向 lint、TypeScript 和 Next.js 16.4.2 隔离生产构建均通过；构建使用无环境文件的源码副本与合成测试库，产物不再注册旧分配、草稿、任务、中转或私图路由。
- 安全提示字体统一已运行该文件的定向 lint 和差异检查。
- 2026-10-24 的论坛适配相关 202 项合成回归通过。经用户授权，仅对指定的单张公开列表页返回结构统计：识别到 21 个不同帖子及下一页，区域/分类条件保持完整；未访问详情页、下一页或图片，实际图片下载仍需用户本地重试。
- 论坛图片卡片的最后一处头像排除修正后，27 项解析测试、定向 lint、TypeScript 和隔离生产构建再次通过。
- 随后修复了标准帖列表表单被误当操作区而整批过滤的问题；按用户截图中的准确域名单张列表复测，匹配 21 条且保留下一页筛选条件，56 项解析和翻页合成测试、定向 lint、TypeScript 和隔离生产构建再次通过。
- 随后经新增授权，仅统计指定第一篇公开详情及其引用的同站公开脚本：确认首帖同区附件 3 张且根帖子区初始隐藏；来源预设复测由 0 张变为 3 张。未执行脚本、读取其他详情或下载图片，未向模型返回帖子文本、图片地址或脚本原文。
- 当前首帖附件及来源预设的最后修正后，63 项解析/翻页测试和 105 项采图服务/下载/界面回归均通过；所有本轮变更源码及测试文件的定向 lint、TypeScript 和 Next.js 16.4.2 隔离生产构建通过。来源预设仍须用户点击应用并保存后才生效。
- 2026-10-25 商家隐藏/恢复及相关商家、地区、SEO 回归共 46 项合成测试通过，验证了鉴权、显示状态持久化、资料/图片保留、后台恢复以及隐藏帖在公开入口的排除。变更源码与测试定向 lint、TypeScript、Next.js 16.4.2 隔离生产构建通过；未读取或修改真实商家记录，实际业务隐藏由管理员点击新按钮执行。
- 清单盘点仅核对 Git 差异、源码和文档；未读取环境配置、真实数据库、上传目录、业务日志或备份。上述公开页/脚本结构验证仅按用户授权范围进行。

## 源码文件（67：新增 16、修改 20、删除 31）

- 新增 [src/app/adminzhangzhang/merchants/AdminMerchantFilters.tsx](E:/hulim/src/app/adminzhangzhang/merchants/AdminMerchantFilters.tsx)
- 新增 [src/app/adminzhangzhang/merchants/MerchantVisibilityButton.tsx](E:/hulim/src/app/adminzhangzhang/merchants/MerchantVisibilityButton.tsx)
- 新增 [src/app/adminzhangzhang/partner-import/image-actions.ts](E:/hulim/src/app/adminzhangzhang/partner-import/image-actions.ts)
- 新增 [src/app/adminzhangzhang/partner-import/ImageCollector.tsx](E:/hulim/src/app/adminzhangzhang/partner-import/ImageCollector.tsx)
- 新增 [src/app/adminzhangzhang/partner-import/PartnerImagesWorkspace.tsx](E:/hulim/src/app/adminzhangzhang/partner-import/PartnerImagesWorkspace.tsx)
- 新增 [src/lib/admin-merchant-filters.ts](E:/hulim/src/lib/admin-merchant-filters.ts)
- 新增 [src/lib/ordinary-submission-boundary.ts](E:/hulim/src/lib/ordinary-submission-boundary.ts)
- 新增 [src/lib/partner-66feng-images.ts](E:/hulim/src/lib/partner-66feng-images.ts)
- 新增 [src/lib/partner-discuz-image-rules.ts](E:/hulim/src/lib/partner-discuz-image-rules.ts)
- 新增 [src/lib/partner-image-download.ts](E:/hulim/src/lib/partner-image-download.ts)
- 新增 [src/lib/partner-image-pagination.ts](E:/hulim/src/lib/partner-image-pagination.ts)
- 新增 [src/lib/partner-image-parser.ts](E:/hulim/src/lib/partner-image-parser.ts)
- 新增 [src/lib/partner-image-sources.ts](E:/hulim/src/lib/partner-image-sources.ts)
- 新增 [src/lib/partner-images-zip.ts](E:/hulim/src/lib/partner-images-zip.ts)
- 新增 [src/lib/partner-images.ts](E:/hulim/src/lib/partner-images.ts)
- 新增 [src/lib/partner-list-diagnostics.ts](E:/hulim/src/lib/partner-list-diagnostics.ts)
- 修改 [src/app/adminzhangzhang/actions.ts](E:/hulim/src/app/adminzhangzhang/actions.ts)
- 修改 [src/app/adminzhangzhang/merchants/page.tsx](E:/hulim/src/app/adminzhangzhang/merchants/page.tsx)
- 修改 [src/app/adminzhangzhang/merchants/actions.ts](E:/hulim/src/app/adminzhangzhang/merchants/actions.ts)
- 修改 [src/app/adminzhangzhang/merchants/MerchantForm.tsx](E:/hulim/src/app/adminzhangzhang/merchants/MerchantForm.tsx)
- 修改 [src/app/adminzhangzhang/page.tsx](E:/hulim/src/app/adminzhangzhang/page.tsx)
- 修改 [src/app/adminzhangzhang/partner-import/actions.ts](E:/hulim/src/app/adminzhangzhang/partner-import/actions.ts)
- 修改 [src/app/adminzhangzhang/partner-import/ImportForms.tsx](E:/hulim/src/app/adminzhangzhang/partner-import/ImportForms.tsx)
- 修改 [src/app/adminzhangzhang/partner-import/page.tsx](E:/hulim/src/app/adminzhangzhang/partner-import/page.tsx)
- 修改 [src/app/adminzhangzhang/sites/actions.ts](E:/hulim/src/app/adminzhangzhang/sites/actions.ts)
- 修改 [src/app/adminzhangzhang/submissions/actions.ts](E:/hulim/src/app/adminzhangzhang/submissions/actions.ts)
- 修改 [src/app/adminzhangzhang/submissions/page.tsx](E:/hulim/src/app/adminzhangzhang/submissions/page.tsx)
- 修改 [src/app/teacher/[id]/SafetyNotice.tsx](E:/hulim/src/app/teacher/[id]/SafetyNotice.tsx)
- 修改 [src/app/team/page.tsx](E:/hulim/src/app/team/page.tsx)
- 修改 [src/app/team/posts/page.tsx](E:/hulim/src/app/team/posts/page.tsx)
- 修改 [src/lib/admin-cooperation.ts](E:/hulim/src/lib/admin-cooperation.ts)
- 修改 [src/lib/cooperation-filters.ts](E:/hulim/src/lib/cooperation-filters.ts)
- 修改 [src/lib/partner-import-errors.ts](E:/hulim/src/lib/partner-import-errors.ts)
- 修改 [src/lib/partner-import-fetch.ts](E:/hulim/src/lib/partner-import-fetch.ts)
- 修改 [src/lib/partner-import-parser.ts](E:/hulim/src/lib/partner-import-parser.ts)
- 修改 [src/lib/partner-import-types.ts](E:/hulim/src/lib/partner-import-types.ts)
- 删除 `E:\hulim\src\app\adminzhangzhang\partner-import\assignment-actions.ts`
- 删除 `E:\hulim\src\app\adminzhangzhang\partner-import\DraftForm.tsx`
- 删除 `E:\hulim\src\app\adminzhangzhang\partner-import\DraftList.tsx`
- 删除 `E:\hulim\src\app\adminzhangzhang\partner-import\drafts\[id]\page.tsx`
- 删除 `E:\hulim\src\app\adminzhangzhang\partner-import\final-review-actions.ts`
- 删除 `E:\hulim\src\app\adminzhangzhang\partner-import\FinalReviewPanel.tsx`
- 删除 `E:\hulim\src\app\adminzhangzhang\partner-import\JobList.tsx`
- 删除 `E:\hulim\src\app\adminzhangzhang\partner-import\JobRunner.tsx`
- 删除 `E:\hulim\src\app\adminzhangzhang\partner-import\jobs\[id]\page.tsx`
- 删除 `E:\hulim\src\app\adminzhangzhang\partner-import\photos\[draftId]\[filename]\route.ts`
- 删除 `E:\hulim\src\app\adminzhangzhang\partner-import\transfer\route.ts`
- 删除 `E:\hulim\src\app\adminzhangzhang\partner-import\TransferUpload.tsx`
- 删除 `E:\hulim\src\app\adminzhangzhang\submissions\InlineImportReview.tsx`
- 删除 `E:\hulim\src\app\team\assigned\[id]\page.tsx`
- 删除 `E:\hulim\src\app\team\assigned\[id]\photos\[filename]\route.ts`
- 删除 `E:\hulim\src\app\team\assigned\actions.ts`
- 删除 `E:\hulim\src\app\team\assigned\page.tsx`
- 删除 `E:\hulim\src\lib\partner-import-assignment-readiness.ts`
- 删除 `E:\hulim\src\lib\partner-import-assignment.ts`
- 删除 `E:\hulim\src\lib\partner-import-declarations.ts`
- 删除 `E:\hulim\src\lib\partner-import-delete.ts`
- 删除 `E:\hulim\src\lib\partner-import-job-delete.ts`
- 删除 `E:\hulim\src\lib\partner-import-labeled-fields.ts`
- 删除 `E:\hulim\src\lib\partner-import-origins.ts`
- 删除 `E:\hulim\src\lib\partner-import-photo-cover-render.ts`
- 删除 `E:\hulim\src\lib\partner-import-photo-cover.ts`
- 删除 `E:\hulim\src\lib\partner-import-photos.ts`
- 删除 `E:\hulim\src\lib\partner-import-transfer-client.ts`
- 删除 `E:\hulim\src\lib\partner-import-transfer-format.ts`
- 删除 `E:\hulim\src\lib\partner-import-transfer.ts`
- 删除 `E:\hulim\src\lib\partner-import.ts`

## 工具脚本（1：新增 0、修改 0、删除 1）

- 删除 `E:\hulim\scripts\apply-partner-assignment-schema.mjs`

## 测试文件（53：新增 18、修改 13、删除 22）

- 新增 [scripts/admin-merchant-filters-ui.test.mjs](E:/hulim/scripts/admin-merchant-filters-ui.test.mjs)
- 新增 [scripts/admin-merchant-filters.test.mjs](E:/hulim/scripts/admin-merchant-filters.test.mjs)
- 新增 [scripts/merchant-visibility.test.mjs](E:/hulim/scripts/merchant-visibility.test.mjs)
- 新增 [scripts/merchant-visibility-ui.test.mjs](E:/hulim/scripts/merchant-visibility-ui.test.mjs)
- 新增 [scripts/merchant-visibility-public.test.mjs](E:/hulim/scripts/merchant-visibility-public.test.mjs)
- 新增 [scripts/partner-image-collector-ui.test.mjs](E:/hulim/scripts/partner-image-collector-ui.test.mjs)
- 新增 [scripts/partner-image-sources.test.mjs](E:/hulim/scripts/partner-image-sources.test.mjs)
- 新增 [scripts/partner-images-page.test.mjs](E:/hulim/scripts/partner-images-page.test.mjs)
- 新增 [scripts/partner-images-workspace.test.mjs](E:/hulim/scripts/partner-images-workspace.test.mjs)
- 新增 [scripts/partner-images.test.mjs](E:/hulim/scripts/partner-images.test.mjs)
- 新增 [scripts/partner-source-actions.test.mjs](E:/hulim/scripts/partner-source-actions.test.mjs)
- 新增 [scripts/partner-workflow-removed.test.mjs](E:/hulim/scripts/partner-workflow-removed.test.mjs)
- 新增 [scripts/teacher-submission-review.test.mjs](E:/hulim/scripts/teacher-submission-review.test.mjs)
- 新增 [src/lib/partner-66feng-images.test.ts](E:/hulim/src/lib/partner-66feng-images.test.ts)
- 新增 [src/lib/partner-image-download.test.ts](E:/hulim/src/lib/partner-image-download.test.ts)
- 新增 [src/lib/partner-image-pagination.test.ts](E:/hulim/src/lib/partner-image-pagination.test.ts)
- 新增 [src/lib/partner-image-parser.test.ts](E:/hulim/src/lib/partner-image-parser.test.ts)
- 新增 [src/lib/partner-list-diagnostics.test.ts](E:/hulim/src/lib/partner-list-diagnostics.test.ts)
- 修改 [scripts/compensation-management.test.mjs](E:/hulim/scripts/compensation-management.test.mjs)
- 修改 [scripts/cooperation-management.test.mjs](E:/hulim/scripts/cooperation-management.test.mjs)
- 修改 [scripts/merchant-ui.test.mjs](E:/hulim/scripts/merchant-ui.test.mjs)
- 修改 [scripts/partner-import-forms.test.mjs](E:/hulim/scripts/partner-import-forms.test.mjs)
- 修改 [scripts/partner-import-schema-compatibility.test.mjs](E:/hulim/scripts/partner-import-schema-compatibility.test.mjs)
- 修改 [scripts/partner-removal.test.mjs](E:/hulim/scripts/partner-removal.test.mjs)
- 修改 [scripts/team-account-delete.test.mjs](E:/hulim/scripts/team-account-delete.test.mjs)
- 修改 [scripts/team-account-management.test.mjs](E:/hulim/scripts/team-account-management.test.mjs)
- 修改 [scripts/team-post-quota-ui.test.mjs](E:/hulim/scripts/team-post-quota-ui.test.mjs)
- 修改 [scripts/visitor-stats.test.mjs](E:/hulim/scripts/visitor-stats.test.mjs)
- 修改 [src/lib/partner-import-errors.test.ts](E:/hulim/src/lib/partner-import-errors.test.ts)
- 修改 [src/lib/partner-import-fetch.test.ts](E:/hulim/src/lib/partner-import-fetch.test.ts)
- 修改 [src/lib/partner-import-parser.test.ts](E:/hulim/src/lib/partner-import-parser.test.ts)
- 删除 `E:\hulim\scripts\apply-partner-assignment-schema.test.mjs`
- 删除 `E:\hulim\scripts\partner-import-access.test.mjs`
- 删除 `E:\hulim\scripts\partner-import-assignment-readiness.test.mjs`
- 删除 `E:\hulim\scripts\partner-import-assignment-ui.test.mjs`
- 删除 `E:\hulim\scripts\partner-import-assignment.test.mjs`
- 删除 `E:\hulim\scripts\partner-import-declaration-draft.test.mjs`
- 删除 `E:\hulim\scripts\partner-import-delete.test.mjs`
- 删除 `E:\hulim\scripts\partner-import-draft-list.test.mjs`
- 删除 `E:\hulim\scripts\partner-import-edit.test.mjs`
- 删除 `E:\hulim\scripts\partner-import-final-review.test.mjs`
- 删除 `E:\hulim\scripts\partner-import-inline-review.test.mjs`
- 删除 `E:\hulim\scripts\partner-import-job-delete.test.mjs`
- 删除 `E:\hulim\scripts\partner-import-job-list.test.mjs`
- 删除 `E:\hulim\scripts\partner-import-job-page.test.mjs`
- 删除 `E:\hulim\scripts\partner-import-origins.test.mjs`
- 删除 `E:\hulim\scripts\partner-import-photo-cover-ui.test.mjs`
- 删除 `E:\hulim\scripts\partner-import-team.test.mjs`
- 删除 `E:\hulim\scripts\partner-import-transfer.test.mjs`
- 删除 `E:\hulim\scripts\partner-import-workflow.test.mjs`
- 删除 `E:\hulim\src\lib\partner-import-declarations.test.ts`
- 删除 `E:\hulim\src\lib\partner-import-labeled-fields.test.ts`
- 删除 `E:\hulim\src\lib\partner-import-photo-cover.test.ts`

## 使用说明文件（1：新增 0、修改 1、删除 0）

- 修改 [docs/partner-import.md](E:/hulim/docs/partner-import.md)
