# 自动化流程

该目录保存 VOZEB PRO 的 GitHub Actions 工作流，用于提交质量检查和多架构容器镜像发布。

- `quality.yml`：检查主应用与文档站的格式、类型、测试、构建和发布条件。
- `docker-image.yml`：构建并发布主应用多架构镜像。
- `docs-docker-image.yml`：构建并发布文档站多架构镜像。

`main` 分支用于持续集成，`v*` 标签用于正式版本镜像发布。

## Fork 与自有 GHCR

主应用和文档镜像地址从当前 `owner/repository` 自动解析并转为小写，分别使用 `ghcr.io/owner/repository` 和 `ghcr.io/owner/repository-docs`；Fork 不会向官方账号发布镜像。工作流使用本仓库的 `GITHUB_TOKEN`，镜像发布任务显式声明 `packages: write`，无需把个人 Token 写入源码。

Fork 后先启用仓库 Actions，将本地补丁提交到自己的仓库，再在 Actions 中选择 `Docker image`、点击 `Run workflow` 并选中包含补丁的分支。手动构建保留提交 SHA 镜像标签；只有符合现有版本标签规则的发布才更新 `latest`。应用与生成 Worker 应使用同一个已成功发布的镜像，部署时可固定 SHA 标签或 digest。质量、依赖审计、浏览器回归、Secret Scan、CodeQL、SBOM 与签名流程继续保留；检查失败时不会推送镜像，不能把仅触发工作流视为发布成功。

后续通过 Fork 的 `Sync fork` 或合并上游分支接入官方更新；冲突需要解决并重新检查。保留自有补丁提交，禁止通过强制同步或覆盖分支丢弃优化。合并完成后，在包含优化的分支重新运行镜像工作流。GHCR 镜像为私有时，服务器需自行登录后拉取；本流程只发布镜像，不自动修改服务器 Compose 或部署服务。

## 主应用依赖审计

主应用质量与发布检查先执行 `pnpm audit --prod --audit-level moderate`，再执行 `node scripts/dependency-audit.mjs` 审查完整依赖树；未核准的中危及以上公告阻断发布。脚本保留原始统计，当前主应用生产依赖审计和文档站完整审计为零；主应用完整审计仍有开发工具 `deepmerge@4.3.1` 的低危公告及下述 minimatch 源码误报，不能宣称完整依赖零漏洞。

`GHSA-g3hv-75wg-m249` 的版本范围覆盖全部 `<11.0.1`，但公告描述的 `firstPhasePreProcess` / `secondPhasePreProcess` 和 `optimizationLevel` 不存在于旧版 `minimatch@3.1.5`。现代版本已升级至 `11.0.4`；ESLint 旧插件需要可直接调用的 CommonJS API，保留 `3.1.5`。脚本仅在公告 ID、版本范围、精确版本、ESLint 开发路径全部匹配，且实际加载源码 SHA-256 为 `746849f267c4868a53729225bd85c7dccd387712136fb305fcc0a3eadd4a3d9d` 时接受该误报；其他路径、版本、公告或源码变化均阻断。核对依据为 [GitHub 公告](https://github.com/advisories/GHSA-g3hv-75wg-m249) 与 [npm 官方源码](https://registry.npmjs.org/minimatch/-/minimatch-3.1.5.tgz)。
