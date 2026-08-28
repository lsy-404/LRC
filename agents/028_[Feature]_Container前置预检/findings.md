# 调研结论

- [现象] `IngestJob.alarm()` 的 `#dispatchQueued()` 是 Phase A 唯一调用 `RUNNER.fetch()` 的位置。 -> [结论] 预检应置于这里，涵盖首次与全部重试，且不改变入口鉴权或同一 jobId 的幂等语义。
- [现象] 上传完成时写入 `web/<ref>/manifest.json`，每个上传对象键为 `web/<ref>/<n>`。 -> [结论] 对 manifest 的 `album`、`session`、`files` 结构及每项 `n/path/size` 校验后，以 `head()` 比较声明大小即可避免唤醒无效 Container。
- [现象] 基础 Container 磁盘为 4 GiB，生产镜像和空载盘约 716 MiB，现有最大专辑约 1.11 GB。 -> [结论] 单次投稿限制为 1.25 GiB；可覆盖现有最大值，并为原料展开、临时转码与仓库预留约 0.8 GiB 以上的空间。
