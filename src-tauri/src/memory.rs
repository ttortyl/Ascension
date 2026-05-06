use walkdir::WalkDir;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<ProjectNode>,
}

pub fn get_project_graph(root_path: &str) -> ProjectNode {
    let root = Path::new(root_path);
    let mut node = ProjectNode {
        name: root.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        path: root_path.to_string(),
        is_dir: true,
        children: Vec::new(),
    };

    // Very simple 1-level deep for now to avoid massive JSON
    for entry in WalkDir::new(root)
        .max_depth(2)
        .into_iter()
        .filter_map(|e| entry_to_node(e)) 
    {
        if entry.path != root_path {
            node.children.push(entry);
        }
    }

    node
}

fn entry_to_node(entry: Result<walkdir::DirEntry, walkdir::Error>) -> Option<ProjectNode> {
    let entry = entry.ok()?;
    let path = entry.path();
    
    // Ignore heavy folders
    if path.to_string_lossy().contains("node_modules") || path.to_string_lossy().contains("target") || path.to_string_lossy().contains(".git") {
        return None;
    }

    Some(ProjectNode {
        name: entry.file_name().to_string_lossy().into_owned(),
        path: path.to_string_lossy().into_owned(),
        is_dir: entry.file_type().is_dir(),
        children: Vec::new(),
    })
}
