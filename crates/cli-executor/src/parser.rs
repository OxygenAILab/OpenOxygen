//! 输出解析器
//! 
//! 将命令行输出解析为结构化数据

use serde::{Deserialize, Serialize};
use super::ExecutionResult;

/// 解析后的输出
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedOutput<T> {
    pub raw: ExecutionResult,
    pub data: Option<T>,
    pub parse_error: Option<String>,
}

/// 解析格式
#[derive(Debug, Clone, Copy, Default)]
pub enum ParseFormat {
    #[default]
    Auto,
    Json,
    Yaml,
    Csv,
    Table,
    KeyValue,
}

/// 解析输出
pub fn parse_output<T>(result: &ExecutionResult) -> Result<ParsedOutput<T>, String> 
where
    T: serde::de::DeserializeOwned,
{
    let stdout = &result.stdout;
    
    // 尝试 JSON 解析
    match serde_json::from_str::<T>(stdout) {
        Ok(data) => {
            return Ok(ParsedOutput {
                raw: result.clone(),
                data: Some(data),
                parse_error: None,
            });
        }
        Err(_) => {}
    }
    
    // 尝试从 JSON 块中提取
    if let Some(json) = extract_json_block(stdout) {
        match serde_json::from_str::<T>(&json) {
            Ok(data) => {
                return Ok(ParsedOutput {
                    raw: result.clone(),
                    data: Some(data),
                    parse_error: None,
                });
            }
            Err(e) => {
                return Ok(ParsedOutput {
                    raw: result.clone(),
                    data: None,
                    parse_error: Some(format!("JSON parse error: {}", e)),
                });
            }
        }
    }
    
    // 尝试 YAML 解析
    match serde_yaml::from_str::<T>(stdout) {
        Ok(data) => {
            return Ok(ParsedOutput {
                raw: result.clone(),
                data: Some(data),
                parse_error: None,
            });
        }
        Err(_) => {}
    }
    
    Ok(ParsedOutput {
        raw: result.clone(),
        data: None,
        parse_error: Some("Failed to parse output in any known format".to_string()),
    })
}

/// 从文本中提取 JSON 代码块
fn extract_json_block(text: &str) -> Option<String> {
    // 尝试提取 ```json ... ``` 块
    if let Some(start) = text.find("```json") {
        let start = start + 7;
        if let Some(end) = text[start..].find("```") {
            return Some(text[start..start + end].trim().to_string());
        }
    }
    
    // 尝试提取 ``` ... ``` 块
    if let Some(start) = text.find("```") {
        let start = start + 3;
        if let Some(end) = text[start..].find("```") {
            let block = &text[start..start + end].trim();
            if block.starts_with('{') || block.starts_with('[') {
                return Some(block.to_string());
            }
        }
    }
    
    // 尝试提取第一个 { ... } 或 [ ... ]
    if let Some(start) = text.find('{') {
        let mut depth = 0;
        let mut in_string = false;
        let mut escape_next = false;
        
        for (i, c) in text[start..].char_indices() {
            if escape_next {
                escape_next = false;
                continue;
            }
            
            match c {
                '\\' if in_string => escape_next = true,
                '"' if !in_string => in_string = true,
                '"' if in_string => in_string = false,
                '{' if !in_string => depth += 1,
                '}' if !in_string => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(text[start..start + i + 1].to_string());
                    }
                }
                '[' if !in_string => depth += 1,
                ']' if !in_string => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(text[start..start + i + 1].to_string());
                    }
                }
                _ => {}
            }
        }
    }
    
    None
}

/// 解析表格输出
pub fn parse_table_output(lines: &[String]) -> Vec<Vec<String>> {
    lines.iter()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            line.split_whitespace()
                .map(|s| s.to_string())
                .collect()
        })
        .collect()
}

/// 解析键值对输出
pub fn parse_key_value_output(lines: &[String]) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    
    for line in lines {
        if let Some(pos) = line.find(':') {
            let key = line[..pos].trim().to_string();
            let value = line[pos + 1..].trim().to_string();
            map.insert(key, value);
        } else if let Some(pos) = line.find('=') {
            let key = line[..pos].trim().to_string();
            let value = line[pos + 1..].trim().to_string();
            map.insert(key, value);
        }
    }
    
    map
}

/// 解析 CSV 输出
pub fn parse_csv_output(content: &str) -> Result<Vec<Vec<String>>, String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .from_reader(content.as_bytes());
    
    let mut records = Vec::new();
    
    for result in reader.records() {
        let record = result.map_err(|e| e.to_string())?;
        records.push(record.iter().map(|s| s.to_string()).collect());
    }
    
    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_json_block() {
        let text = r#"
Some text
```json
{"key": "value"}
```
More text
"#;
        assert_eq!(
            extract_json_block(text),
            Some(r#"{"key": "value"}"#.to_string())
        );
    }

    #[test]
    fn test_parse_key_value() {
        let lines = vec![
            "key1: value1".to_string(),
            "key2=value2".to_string(),
        ];
        let result = parse_key_value_output(&lines);
        assert_eq!(result.get("key1"), Some(&"value1".to_string()));
        assert_eq!(result.get("key2"), Some(&"value2".to_string()));
    }
}
