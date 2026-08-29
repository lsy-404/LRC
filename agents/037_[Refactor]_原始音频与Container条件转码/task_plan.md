# 原始音频与 Container 条件转码

- [x] 核对当前链路及 8c3e20e/349eeae 历史实现。
- [x] 移除浏览器端转码，保持原始文件与上传清单。
- [x] 将音频下载、元数据/封面提取、条件转码和转写恢复到 Container。
- [x] 让 Worker 只执行清单与 R2 对象完整性预检并调度 Container。
- [x] 调整 Container 规格为 basic，并补充根目录测试。
- [x] 运行 Node/Python 测试、构建与静态检查，审阅差异并提交。
