use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

fn main() {
    println!("--- LAZARUS PROTOCOL INITIALIZED ---");
    println!("Monitoring Project Ascension Kernel...");

    loop {
        // We assume the binary is in the same directory or standard build path
        let mut child = Command::new("./ascension.exe")
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("Lazarus Error: Failed to spawn Ascension Kernel");

        println!("[LAZARUS] Kernel Spawned. PID: {}", child.id());

        let status = child.wait().expect("Lazarus Error: Failed to wait on Kernel");

        println!("[LAZARUS] Kernel Exited with status: {}. Re-initiating Lazarus Protocol in 3 seconds...", status);
        thread::sleep(Duration::from_secs(3));
    }
}
