# 📥 upload 投递箱

这是 LRC 歌词库的**自动摄取投递箱**。把歌曲原料 push 到本 `upload` 分支，
自动化流水线（`.github/workflows/upload_ingest.yml`）会：

1. 立即取走原料并把本分支重置为空（投递箱常空、可并发投递）；
2. 识别歌词本（图片 OCR / pdf / docx / txt）、用 faster-whisper 给音频出**字级时间轴**，
   把**准确歌词**强制对齐到时间轴生成 `.lrc`，并从 staff/credits 抽取专辑元数据；
3. 整理成 `res/<专辑>/` 结构，从 `main` 迁出分支 `upload-<贡献者>-<时间>` **自动开 PR**，
   走现有审计自动合并；
4. **原料全程不入任何持久历史**，处理完即销毁（规避版权风险）。

> ⚠️ **仅有仓库写权限的贡献者**能 push 到 `upload`（这就是滥用闸门）。
> ⚠️ STT 为机器对齐、meta 为自动抽取，PR 产物**请人工复核**后再依赖合并。

---

## 怎么投递

把以下任意素材放进一个目录，push 到 `upload` 分支：

| 素材 | 后缀 | 处理 |
| :-- | :-- | :-- |
| 逐曲歌词 | `.txt`（每文件一首） | 解析「标题+分曲 staff+正文」直接成轨（**推荐，最准**） |
| 歌词本 | `.png/.jpg/.webp` | 视觉 OCR（含 credits） |
| 歌词本 | `.pdf/.docx` | 文本抽取；扫描版 PDF 渲染后 OCR |
| 专辑 credits | `.txt`（如 `Staff表.txt`） | 抽 staff → meta（不成轨） |
| 歌曲音频 | `.flac/.wav/.mp3/.m4a/...` | faster-whisper 字级时间戳 → 对齐 |
| 封面 | 图片，文件名含 `cover/封面/主视图` | 存为 `cover.*` |
| 投递清单 | `manifest.toml`（见下） | 指定专辑名 + 覆盖 meta |

**逐曲歌词 txt 格式**（与音频按内容自动匹配，无需同名）：

```
01 告别如汐
VOCAL 星尘
MUSIC 雪域小汪
LYRICS 雪域小汪
TUNING 凛空小猫

闹钟轻声起 睡眼朦胧里
晨光爬上窗棂
……（正文，每行一句）
```

## manifest.toml（可选，建议提供专辑名）

```toml
album = "永昼花"            # 目标专辑名（缺省时由 LLM 从歌词本推断，PR 标注待确认）

# 以下均可选，显式给出则**覆盖**自动抽取的 meta：
发行日期 = "2026-01-31"     # 也可用 year=
出品     = ["Zeno"]
演唱     = ["星尘", "海伊", "诗岸"]
作词     = []
作曲     = []
编曲     = []
调校     = []
曲绘     = ["Aries苑"]
混音     = []
发布     = "[Bilibili](https://www.bilibili.com/video/...)"
购买     = "[淘宝](...)"
电子     = "随专辑附赠"
```

> 字段名同 `res/<专辑>/meta.toml`（中文键）。未提供的字段由流水线从歌词本/Staff 抽取，
> 仍为空则留空，等人工在 PR 里补。

## 提示

- 优先提供**逐曲歌词 txt**，对齐质量最高；纯靠音频 STT 出字不可靠。
- 音频建议提供**纯歌曲**（带伴奏的演唱即可）；流水线只取时间不取字。
- STT 默认 `small` 模型，可由仓库变量 `WHISPER_MODEL`（tiny/base/small/medium/large-v3）调整。
