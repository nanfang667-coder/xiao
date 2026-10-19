# 新加坡邀请入口

独立静态页面，不接入 Next.js 路由，不访问数据库。入口域名为 `hlwi.world`，部署在新加坡服务器 `45.76.148.42`；固定目标为香港服务器 `140.235.96.155` 上的 `https://husil.world`。

邀请访问链路：`https://hlwi.world/go/index.html?code=NVG` → `https://husil.world/NVG`。目标网站负责验证邀请码和处理来源；入口不向现有五个域名跳转，也不在查询参数中接收目标主机。

此目录需要单独构建和部署；主站蓝绿发布不会自动部署入口页面。当前跳转目标是 `/{邀请码}`，不是推广渠道的 `/go/{渠道代码}`，因此不能直接用于新的 gp77 推广统计入口。

运行 `node entry-page/preview-server.mjs` 后打开：

`http://127.0.0.1:8765/go/index.html?code=NVG&preview=1`

预览模式自动展示目标 URL，不产生真实邀请访问。
删除 `preview=1` 则在脚本加载后立即真实跳转，无需等待或点击，会产生正常网站访问；测试时不要使用真实渠道。

目标只能通过编辑 `entry.mjs` 中的 `TARGET_ORIGIN` 修改。渠道参数只接受短邀请码及既有 UUID 格式；保留代码大小写，由正式网站验证代码是否存在。缺失或无效格式不会跳到首页，防止悄悄丢失来源。

验证：`node --test entry-page/entry.test.mjs`。
构建：`node entry-page/build.mjs`，生成单文件 `entry-page/dist/index.html`。
上线时放入独立入口站点的 `go/index.html`。入口域名的普通根路径 `/` 可由 Nginx 以 302 跳到 `https://husil.world/`；它与带邀请码的 `/go/index.html` 页面分别配置，后者缺码时仍提示错误，不跳首页。服务器必须为该 HTML 设置 `Cache-Control: no-store`；meta 标签不能替代响应头。生成文件包含内联脚本和样式，若入口站点已有 CSP，需要使用对应内容哈希允许它们，或改用三个独立源文件并允许同源脚本与样式。不要直接关闭现有 CSP。

本目录只提供部署产物；DNS、Nginx、HTTPS 和目标站点域名识别需要另外配置并验证。入口必须能访问，页面不是防封保证。跨目标域名的 Cookie 不互通，邀请渠道可保留，但访客不能因此自动跨域去重。

## 当前部署（2026-10-19）

- 新加坡：`/var/www/hlwi-entry/go/index.html`，Nginx 站点 `hlwi-entry`。HTTP 升级 HTTPS，`www` 规范到主域名；普通根路径 302 到 `https://husil.world/`。
- 香港：Nginx 站点 `husil-world`，代理现有 `hulim-hk` 服务。`husil.world` 共用默认站点的 ID、账号和价格，不新增数据库站点记录；原五个域名保留现有规则。
- 香港运行代码为提交 `c69a86c`，目录 `/opt/hulim-releases/husil-c69a86c`；systemd drop-in 为 `/etc/systemd/system/hulim-hk.service.d/20-husil-release.conf`。`/opt/hulim` 继续保存源代码 checkout 和原有共享运行数据。后续发布应先构建独立 release，再切换服务，不能假定更新 checkout 就会更新运行版本。
- 两站 HTTPS 已签发，`certbot.timer` 已启用；证书续期后会校验并重载 Nginx。入口响应使用 `no-store`、`noindex` 和内联资源 SHA256 CSP；修改页面后必须同步重算 CSP 哈希。

已验证入口浏览器预览、新域名 HTTPS／重定向、旧五域名响应，以及隔离测试库下的邀请归属、账号命名空间和 SEO URL。真实邀请码链路未用于线上验证，以免新增推广统计；上线使用已有有效邀请码，并移除测试用的 `preview=1`。
