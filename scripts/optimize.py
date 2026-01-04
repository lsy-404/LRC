import os
import urllib.parse
import re

EXCLUDE_DIRS = {'.git', '.github', 'scripts', 'node_modules', '.vscode'}
EXTENSIONS = {'.lrc'}
README_PATH = 'README.md'

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
    
    # Prepare content lists
    album_list_content = []
    catalog_content = []
    
    dirs = sorted([d for d in os.listdir(root_dir) if os.path.isdir(os.path.join(root_dir, d)) and d not in EXCLUDE_DIRS and not d.startswith('.')])
    
    for album_name in dirs:
        dir_path = os.path.join(root_dir, album_name)
        
        # Add to Album List
        encoded_album_path = urllib.parse.quote(album_name)
        album_list_content.append(f"- [{album_name}]({encoded_album_path})")

        # Add to Catalog
        catalog_content.append(f"### {album_name}\n\n")
        
        files = sorted([f for f in os.listdir(dir_path) if os.path.splitext(f)[1] in EXTENSIONS])
        
        if not files:
            catalog_content.append("_暂无 LRC 文件_\n\n")
            continue

        for filename in files:
            file_path = os.path.join(dir_path, filename)
            process_lrc(file_path, album_name)
            
            # SEO Optimization: Create links
            rel_path = f"{album_name}/{filename}"
            encoded_path = urllib.parse.quote(rel_path)
            catalog_content.append(f"- [{filename}]({encoded_path})\n")
        
        catalog_content.append("\n")

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
