#!/usr/bin/env python3
"""生成元数据完整性报告"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from lib.config_loader import load_config
from lib.meta_parser import load_album_meta

CONFIG = load_config()
PROJECT = CONFIG.get("project", {})
COMMON = CONFIG.get("common", {})
META = CONFIG.get("meta", {})
DEV_REPORT = CONFIG.get("dev", {}).get("report", {})

ROOT_DIR = Path(__file__).resolve().parents[2]
RES_DIR = ROOT_DIR / str(PROJECT.get("res_dir", "res"))
DOCS_DIR = ROOT_DIR / str(PROJECT.get("docs_dir", "docs"))
COVER_EXTENSIONS = [str(item) for item in COMMON.get("cover_ext", [".jpg", ".png", ".jpeg", ".webp", ".bmp"])]

# 从配置中读取报告相关配置
DATA_TABLE_FIELDS = [str(f) for f in DEV_REPORT.get("data_table_fields", [])]

# 从 meta.field_schema 构建字段显示名称映射 (internal -> toml_key)
FIELD_DISPLAY_NAMES = {}
for field_schema in META.get("field_schema", []):
    internal = field_schema.get("internal")
    toml_key = field_schema.get("toml_key")
    if internal and toml_key:
        FIELD_DISPLAY_NAMES[str(internal)] = str(toml_key)

CORE_FIELDS = {k: str(v) for k, v in DEV_REPORT.get("core_fields", {}).items()}
WARNING_FIELDS = {k: str(v) for k, v in DEV_REPORT.get("warning_fields", {}).items()}
THRESHOLDS = DEV_REPORT.get("thresholds", {})
SKIP_ALBUMS = set(str(name) for name in DEV_REPORT.get("skip_albums", []))
REPORT_OUTPUT_PATH = str(DEV_REPORT.get("output_path", "dev/meta.md"))


def is_missing_value(value: str | list[str] | None) -> bool:
    """检查值是否真正缺失（空值、空列表等），"不适用"不算缺失"""
    if value is None:
        return True
    if isinstance(value, list):
        return len(value) == 0
    text = str(value).strip()
    return text == "" or text == "缺少信息"


def is_disabled_value(value: str | list[str] | None) -> bool:
    """检查值是否为禁用值（包括'不适用'和空值），用于核心元数据检查"""
    if value is None:
        return True
    if isinstance(value, list):
        return len(value) == 0 or all(v.strip() == "不适用" for v in value)
    text = str(value).strip()
    return text == "" or text == "不适用" or text == "缺少信息"


def has_valid_cover(album_dir: Path) -> bool:
    """检查专辑是否有合法的封面文件"""
    for file in album_dir.iterdir():
        if file.is_file() and file.stem.lower() == "cover":
            ext_lower = file.suffix.lower()
            if ext_lower in COVER_EXTENSIONS:
                return True
    return False


def check_album_integrity(album_dir: Path, album_name: str, info: dict[str, Any]) -> dict[str, Any]:
    """检查专辑元数据完整性
    
    返回包含以下键的字典：
    - level: "error", "warning", "hint" 或 "ok"
    - issues: 问题列表
    """
    issues = []
    
    # 检查核心字段（使用 is_missing_value，"不适用"不算缺失）
    year_missing = is_missing_value(info.get("year"))
    produce_missing = is_missing_value(info.get("produce"))
    release_missing = is_missing_value(info.get("release"))
    purchase_missing = is_missing_value(info.get("purchase"))
    electronic_missing = is_missing_value(info.get("electronic"))
    
    # 检查中英文名（"不适用"是合法占位符，不算缺失）
    zh_name = str(info.get("zh_name") or "").strip()
    en_name = str(info.get("en_name") or "").strip()
    zh_missing = not zh_name or zh_name == "缺少信息"
    en_missing = not en_name or en_name == "缺少信息"
    # "不适用"视为有效值，不算缺失
    if zh_name == "不适用":
        zh_missing = False
    if en_name == "不适用":
        en_missing = False
    
    # 错误级别：核心元数据缺失
    error_issues = []
    if year_missing and "year" in CORE_FIELDS:
        error_issues.append(CORE_FIELDS["year"])
    if produce_missing and "produce" in CORE_FIELDS:
        error_issues.append(CORE_FIELDS["produce"])
    if release_missing and "release" in CORE_FIELDS:
        error_issues.append(CORE_FIELDS["release"])
    if purchase_missing and electronic_missing and "purchase_or_electronic" in CORE_FIELDS:
        error_issues.append(CORE_FIELDS["purchase_or_electronic"])
    
    # 中英文名都缺失 -> 错误
    if zh_missing and en_missing:
        error_issues.append("缺少中文名和英文名（至少需要一个）")
    
    # 检查封面文件
    if not has_valid_cover(album_dir):
        error_issues.append("缺少合法的封面文件")
    
    # 计算专辑数据表缺失统计
    data_missing_count = sum(1 for field in DATA_TABLE_FIELDS if is_missing_value(info.get(field)) or 
                       (isinstance(info.get(field), list) and len(info.get(field)) == 0))
    
    error_threshold = THRESHOLDS.get("error_data_threshold", 3)
    
    if error_issues:
        # 如果是错误级别，也显示专辑数据表缺失统计
        if data_missing_count >= error_threshold:
            missing_fields = [
                field for field in DATA_TABLE_FIELDS
                if is_missing_value(info.get(field)) or 
                   (isinstance(info.get(field), list) and len(info.get(field)) == 0)
            ]
            missing_names = [FIELD_DISPLAY_NAMES.get(f, f) for f in missing_fields]
            error_issues.append(f"[统计] 专辑数据表缺失 {data_missing_count} 项：{', '.join(missing_names)}")
        
        return {
            "level": "error",
            "issues": error_issues
        }
    
    # 警告级别
    warning_issues = []
    
    # 中英文名缺失一个 -> 警告
    if zh_missing or en_missing:
        if zh_missing:
            warning_issues.append("缺少中文名")
        if en_missing:
            warning_issues.append("缺少英文名")
    
    # 购买/电子有一个缺失
    if purchase_missing or electronic_missing:
        if purchase_missing:
            field_name = FIELD_DISPLAY_NAMES.get("purchase", "购买")
            warning_issues.append(f"缺少{field_name}信息")
        else:
            field_name = FIELD_DISPLAY_NAMES.get("electronic", "电子")
            warning_issues.append(f"缺少{field_name}版本信息")
    
    # 歌词制作缺失
    if is_missing_value(info.get("lyric_maker")) and "lyric_maker" in WARNING_FIELDS:
        warning_issues.append(WARNING_FIELDS["lyric_maker"])
    
    warning_threshold = THRESHOLDS.get("warning_data_threshold", 5)
    
    # 专辑数据表中至少达到警告阈值项缺失
    if data_missing_count >= warning_threshold:
        missing_fields = [
            field for field in DATA_TABLE_FIELDS
            if is_missing_value(info.get(field)) or 
               (isinstance(info.get(field), list) and len(info.get(field)) == 0)
        ]
        missing_names = [FIELD_DISPLAY_NAMES.get(f, f) for f in missing_fields]
        warning_issues.append(f"专辑数据表缺失 {data_missing_count} 项：{', '.join(missing_names)}")
    
    if warning_issues:
        # 如果是警告级别，也显示专辑数据表缺失统计（error_threshold <= count < warning_threshold）
        if data_missing_count >= error_threshold and data_missing_count < warning_threshold:
            missing_fields = [
                field for field in DATA_TABLE_FIELDS
                if is_missing_value(info.get(field)) or 
                   (isinstance(info.get(field), list) and len(info.get(field)) == 0)
            ]
            missing_names = [FIELD_DISPLAY_NAMES.get(f, f) for f in missing_fields]
            warning_issues.append(f"[统计] 专辑数据表缺失 {data_missing_count} 项：{', '.join(missing_names)}")
        
        return {
            "level": "warning",
            "issues": warning_issues
        }
    
    # 提示级别：专辑数据表缺失达到提示阈值
    hint_threshold = THRESHOLDS.get("hint_data_threshold", 3)
    hint_issues = []
    if data_missing_count >= hint_threshold:
        missing_fields = [
            field for field in DATA_TABLE_FIELDS
            if is_missing_value(info.get(field)) or 
               (isinstance(info.get(field), list) and len(info.get(field)) == 0)
        ]
        missing_names = [FIELD_DISPLAY_NAMES.get(f, f) for f in missing_fields]
        hint_issues.append(f"专辑数据表缺失 {data_missing_count} 项：{', '.join(missing_names)}")
    
    if hint_issues:
        return {
            "level": "hint",
            "issues": hint_issues
        }
    
    return {
        "level": "ok",
        "issues": []
    }


def generate_report() -> str:
    """生成完整性报告"""
    albums = sorted([path for path in RES_DIR.iterdir() if path.is_dir()], key=lambda p: p.name)
    
    error_albums = []
    warning_albums = []
    hint_albums = []
    ok_albums = []
    skipped_count = 0
    
    for album_dir in albums:
        album_name = album_dir.name
        
        # 跳过白名单中的专辑
        if album_name in SKIP_ALBUMS:
            skipped_count += 1
            continue
        
        info, _ = load_album_meta(album_dir)
        
        result = check_album_integrity(album_dir, album_name, info)
        
        album_data = {
            "name": album_name,
            "issues": result["issues"]
        }
        
        if result["level"] == "error":
            error_albums.append(album_data)
        elif result["level"] == "warning":
            warning_albums.append(album_data)
        elif result["level"] == "hint":
            hint_albums.append(album_data)
        else:
            ok_albums.append(album_data)
    
    # 生成报告内容
    total_checked = len(albums) - skipped_count
    report_lines = [
        "---",
        "title: 元数据完整性报告",
        "index: false",
        "icon: material-symbols:analytics",
        "---",
        "",
        "# 元数据完整性报告",
        "",
        "本报告显示所有专辑的元数据完整性检查结果。",
        "",
        f"- **总计**：{len(albums)} 个专辑",
        f"- **已检查**：{total_checked} 个",
        f"- **跳过**：{skipped_count} 个",
        f"- **完整**：{len(ok_albums)} 个",
        f"- **提示**：{len(hint_albums)} 个",
        f"- **警告**：{len(warning_albums)} 个",
        f"- **错误**：{len(error_albums)} 个",
        "",
    ]
    
    # 错误级别
    if error_albums:
        report_lines.extend([
            "## ❌ 错误：核心元数据缺失",
            "",
            "以下专辑缺少关键元数据（发行日期、出品、发布、购买/电子至少一个、封面文件）：",
            "",
        ])
        
        for album in error_albums:
            report_lines.append(f"### {album['name']}")
            report_lines.append("")
            for issue in album["issues"]:
                report_lines.append(f"- {issue}")
            report_lines.append("")
    
    # 警告级别
    if warning_albums:
        report_lines.extend([
            "## ⚠️ 警告：重要信息缺失",
            "",
            "以下专辑缺少重要元数据：",
            "",
        ])
        
        for album in warning_albums:
            report_lines.append(f"### {album['name']}")
            report_lines.append("")
            for issue in album["issues"]:
                report_lines.append(f"- {issue}")
            report_lines.append("")
    
    # 提示级别
    if hint_albums:
        report_lines.extend([
            "## 💡 提示：部分信息缺失",
            "",
            "以下专辑有部分元数据缺失：",
            "",
        ])
        
        for album in hint_albums:
            report_lines.append(f"### {album['name']}")
            report_lines.append("")
            for issue in album["issues"]:
                report_lines.append(f"- {issue}")
            report_lines.append("")
    
    # 完整的专辑
    if ok_albums:
        report_lines.extend([
            "## ✅ 元数据完整",
            "",
            "以下专辑的元数据完整：",
            "",
        ])
        
        for album in ok_albums:
            report_lines.append(f"- {album['name']}")
        report_lines.append("")
    
    return "\n".join(report_lines)


def main() -> None:
    """主函数"""
    report_content = generate_report()
    report_path = DOCS_DIR / REPORT_OUTPUT_PATH
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report_content, encoding="utf-8")
    
    print(f"Report generated: {report_path}")


if __name__ == "__main__":
    main()
