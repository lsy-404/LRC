# Findings

- [生产现象] -> 工作站投稿 `567a2b1` 在 20% 失败 -> Phase A 的 `_process_album` 抛出 `ValueError: not enough values to unpack (expected 2, got 0)`。
- [链路定位] -> WebM 已完成浏览器压缩、上传与 Worker 转写，错误发生在 Container 内 Phase A 元数据整理 -> 不是 WebM 编码或 OpenAI 转写失败。
- [根因] -> `uploaded_manifest` 存在时条件表达式返回 `{}`，调用方却固定解包为 `tag_meta, source_hint` -> 应返回二元组。
- [旁路问题] -> 投稿 `519ce4a` 显示 `Network connection lost.` -> 与上述解包错误不同，需在部署修复后分别重试验证。
- [测试缺口] -> 旧 Phase A 冒烟测试仍伪造容器本地 STT，未提供上传清单和 Worker 预转写结果 -> 测试未覆盖当前生产链路，已调整为新架构输入。
- [测试环境] -> Worker 编排测试直接使用 `vm.SyntheticModule`，Node 24 需加 `--experimental-vm-modules` -> 以该参数运行时专项测试全部通过，不属于 WebM 运行故障。
- [工作区边界] -> 本地 `/test` 下存在两个未被仓库追踪的旧脚本 -> 临时测试适配已恢复，不纳入本次提交。
- [本地端口] -> Node glob 会把常驻 QA 服务脚本当作测试启动，4174 已被另一个本地项目占用 -> 该脚本不属于仓库追踪的测试用例，正式测试统计排除它且不终止用户进程。
