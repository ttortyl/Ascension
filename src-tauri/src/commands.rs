use std::process::Command;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use crate::KernelEvent;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

pub async fn execute_shell(command_str: &str, tx: broadcast::Sender<KernelEvent>) -> CommandResult {
    let _ = tx.send(KernelEvent::Thought(format!("Executing Shell Command: {}", command_str)));

    // On Windows, use powershell
    let output = if cfg!(target_os = "windows") {
        Command::new("powershell")
            .arg("-NoProfile")
            .arg("-Command")
            .arg(command_str)
            .output()
    } else {
        Command::new("sh")
            .arg("-c")
            .arg(command_str)
            .output()
    };

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let success = out.status.success();

            if success {
                let _ = tx.send(KernelEvent::SystemLog(format!("Command Executed Successfully")));
            } else {
                let _ = tx.send(KernelEvent::SystemLog(format!("Command Failed: {}", stderr)));
            }

            CommandResult {
                success,
                stdout,
                stderr,
            }
        }
        Err(e) => {
            let error_msg = format!("Failed to spawn process: {}", e);
            let _ = tx.send(KernelEvent::SystemLog(error_msg.clone()));
            CommandResult {
                success: false,
                stdout: String::new(),
                stderr: error_msg,
            }
        }
    }
}
