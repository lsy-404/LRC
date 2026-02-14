/**
 * 简单的 TOML 解析器，用于解析 info.toml 文件
 */

function parseToml(content) {
  const result = {};
  const lines = content.split('\n');

  for (let line of lines) {
    line = line.trim();

    // 跳过空行和注释
    if (!line || line.startsWith('#')) continue;

    // 解析键值对
    if (line.includes('=')) {
      const [key, ...valueParts] = line.split('=');
      const trimmedKey = key.trim();
      const value = valueParts.join('=').trim();

      // 处理值的类型
      if (value.startsWith('[') && value.endsWith(']')) {
        // 数组值
        const arrayContent = value.slice(1, -1).trim();
        if (arrayContent === '') {
          result[trimmedKey] = [];
        } else {
          result[trimmedKey] = arrayContent
            .split(',')
            .map(item => item.trim().replace(/^["']|["']$/g, ''));
        }
      } else if ((value.startsWith('"') && value.endsWith('"')) || 
                 (value.startsWith("'") && value.endsWith("'"))) {
        // 字符串值
        result[trimmedKey] = value.slice(1, -1);
      } else if (!isNaN(value) && value !== '') {
        // 数字值
        result[trimmedKey] = JSON.parse(value);
      } else {
        // 其他值
        result[trimmedKey] = value;
      }
    }
  }

  return result;
}

module.exports = { parseToml };
