import os
import urllib.parse
import re

EXCLUDE_DIRS = {'.git', '.github', 'scripts', 'node_modules', '.vscode'}
EXTENSIONS = {'.lrc'}
README_PATH = 'README.md'
RES_DIR = 'res'
PACK_DIR = 'pack'
COVER_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'}

def find_cover_image(dir_path):
    """Find cover image in the album directory"""
    for file in os.listdir(dir_path):
        name, ext = os.path.splitext(file)
        if name.lower() == 'cover' and ext.lower() in COVER_EXTENSIONS:
            return file
    return None

def process_lrc(file_path, album_name):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except UnicodeDecodeError:
        try:
            with open(file_path, 'r', encoding='gbk') as f:
                lines = f.readlines()
        except:
            print(f"Failed to read {file_path}")
            return False

    has_al = False
    al_index = -1
    
    for i, line in enumerate(lines):
        if line.strip().startswith('[al:'):
            has_al = True
            al_index = i
            break
    
    modified = False
    new_lines = list(lines)
    
    # Tag Optimization: Ensure [al:FolderName] exists
    target_tag = f'[al:{album_name}]\n'
    
    if has_al:
        # Check if it matches
        current_tag = new_lines[al_index]
        if current_tag != target_tag:
            new_lines[al_index] = target_tag
            modified = True
    else:
        # Insert at the beginning
        new_lines.insert(0, target_tag)
        modified = True

    if modified:
        print(f"Updating tag for: {file_path}")
        with open(file_path, 'w', encoding='utf-8') as f:
            f.writelines(new_lines)
            
    return modified

def update_readme_section(content, start_marker, end_marker, new_section_content):
    pattern = re.compile(f'({re.escape(start_marker)})(.*?)({re.escape(end_marker)})', re.DOTALL)
    if pattern.search(content):
        return pattern.sub(f'\\1\n{new_section_content}\n\\3', content)
    else:
        print(f"Warning: Markers {start_marker} ... {end_marker} not found in README.md")
        return content

def main():
    root_dir = os.getcwd()
    res_dir_path = os.path.join(root_dir, RES_DIR)
    pack_dir_path = os.path.join(root_dir, PACK_DIR)
    
    # Ensure res and pack directories exist
    if not os.path.exists(res_dir_path):
        print(f"Error: {RES_DIR} directory not found!")
        return
    
    if not os.path.exists(pack_dir_path):
        os.makedirs(pack_dir_path)
    
    # Prepare content lists
    album_list_content = []
    catalog_content = []
    
    dirs = sorted([d for d in os.listdir(res_dir_path) if os.path.isdir(os.path.join(res_dir_path, d)) and not d.startswith('.')])
    
    for album_name in dirs:
        dir_path = os.path.join(res_dir_path, album_name)
        
        # Add to Album List
        encoded_album_path = urllib.parse.quote(f"{RES_DIR}/{album_name}")
        album_list_content.append(f"- [{album_name}]({encoded_album_path})")

        # Add to Catalog with download buttons
        catalog_content.append(f"### {album_name}\n\n")
        
        # Check if album zip exists in pack folder
        zip_filename = f"{album_name}.zip"
        zip_path = os.path.join(pack_dir_path, zip_filename)
        if os.path.exists(zip_path):
            encoded_zip = urllib.parse.quote(f"{PACK_DIR}/{zip_filename}")
            cdn_zip_url = f"https://cdn.jsdelivr.net/gh/wuyilingwei/LRC@main/{encoded_zip}"
            catalog_content.append(f"**📦 [下载专辑歌词包]({cdn_zip_url})**\n\n")
        
        # Find cover image
        cover_file = find_cover_image(dir_path)
        
        files = sorted([f for f in os.listdir(dir_path) if os.path.splitext(f)[1] in EXTENSIONS])
        
        if not files:
            catalog_content.append("_暂无 LRC 文件_\n\n")
            continue

        # Start details/summary for track list with cover preview if exists
        if cover_file:
            cover_path = f"{RES_DIR}/{album_name}/{cover_file}"
            encoded_cover = urllib.parse.quote(cover_path)
            cdn_cover_url = f"https://cdn.jsdelivr.net/gh/wuyilingwei/LRC@main/{encoded_cover}"
            catalog_content.append(f'<details>\n<summary>📝 查看详细曲目 ({len(files)} 首)</summary>\n\n')
            catalog_content.append(f'<img src="{cdn_cover_url}" alt="专辑封面" width="150" align="right">\n\n')
        else:
            catalog_content.append(f"<details>\n<summary>📝 查看详细曲目 ({len(files)} 首)</summary>\n\n")

        for filename in files:
            file_path = os.path.join(dir_path, filename)
            process_lrc(file_path, album_name)
            
            # SEO Optimization: Create links
            rel_path = f"{RES_DIR}/{album_name}/{filename}"
            encoded_path = urllib.parse.quote(rel_path)
            # Create CDN download link
            cdn_url = f"https://cdn.jsdelivr.net/gh/wuyilingwei/LRC@main/{encoded_path}"
            catalog_content.append(f"- [{filename}]({encoded_path}) | [📥 下载]({cdn_url})\n")
        
        catalog_content.append("\n</details>\n\n")

    # Join content
    new_album_list_str = "\n".join(album_list_content)
    new_catalog_str = "".join(catalog_content)

    # Read README
    if os.path.exists(README_PATH):
        with open(README_PATH, 'r', encoding='utf-8') as f:
            readme_content = f.read()
        
        # Update Album List Section
        readme_content = update_readme_section(
            readme_content, 
            "<!-- ALBUM_LIST_START -->", 
            "<!-- ALBUM_LIST_END -->", 
            new_album_list_str
        )

        # Update Catalog Section
        readme_content = update_readme_section(
            readme_content, 
            "<!-- CATALOG_START -->", 
            "<!-- CATALOG_END -->", 
            new_catalog_str
        )

        with open(README_PATH, 'w', encoding='utf-8') as f:
            f.write(readme_content)
        print("README.md updated.")
    else:
        print("README.md not found!")

    # Remove old CATALOG.md if it exists
    if os.path.exists('CATALOG.md'):
        os.remove('CATALOG.md')
        print("Removed old CATALOG.md")

if __name__ == '__main__':
    main()
