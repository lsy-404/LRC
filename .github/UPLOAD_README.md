# 📥 upload 投递箱

把歌曲原料 push 到本分支，自动化会处理并向 `main` 开一个 draft PR。**人工复核后合并即可。**

> 仅有仓库写权限的人能 push；处理完原料即销毁，不进库。

---

## 怎么提交

1. 把素材（见下表）放进一个目录，可选附 `manifest.toml`；
2. 直接 push 到 `upload` 分支（覆盖/追加都行）；
3. 等几分钟，去看自动开出的 `ingest: <专辑>` draft PR，复核无误就标记 ready → 合并。

## 放什么

| 素材 | 后缀 | 说明 |
| :-- | :-- | :-- |
| 逐曲歌词 | `.txt`（每文件一首） | **推荐**。格式：首行标题 +（可选 staff 行）+ 空行 + 正文 |
| 歌词本 | `.png/.jpg/.pdf/.docx` | 自动 OCR / 抽取 |
| 专辑 credits | `.txt`（如 `Staff表.txt`） | 抽 staff 进 meta |
| 歌曲音频 | `.flac/.wav/.mp3/...` | 自动出时间轴，对齐到准确歌词生成 `.lrc` |
| 封面 | 图片，名字含 `cover/封面/主视图` | 存为 `cover.*` |
| 投递清单 | `manifest.toml` | 指定专辑名 + 覆盖 meta |

**逐曲歌词 txt 示例**

```
01 告别如汐
VOCAL 星尘
LYRICS 雪域小汪

闹钟轻声起 睡眼朦胧里
晨光爬上窗棂
……
```

**manifest.toml 示例**（标准 TOML，键用 ASCII）

```toml
album = "永昼花"
vocal = ["星尘", "海伊", "诗岸"]
illustrator = ["Aries苑"]
```

字段名见 `.github/upload_manifest.example.toml`。不写的字段会自动从歌词本/Staff 抽取。

---

- 优先放**逐曲歌词 txt**，对齐质量最高。
- 音频转写默认 `small` 模型，可由仓库变量 `WHISPER_MODEL` 调整。
