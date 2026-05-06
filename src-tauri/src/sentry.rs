use base64::{engine::general_purpose, Engine as _};
use image::{ImageBuffer, Rgb};
use nokhwa::pixel_format::RgbFormat;
use nokhwa::utils::{CameraIndex, RequestedFormat, RequestedFormatType};
use nokhwa::Camera;
use std::io::Cursor;
use std::thread;
use std::time::Duration;
use tokio::sync::broadcast;
use crate::KernelEvent;

pub fn start_sentry_loop(tx: broadcast::Sender<KernelEvent>) {
    // We use a native OS thread because nokhwa::Camera is not Send/Sync across await points
    thread::spawn(move || {
        // Initialize camera
        let index = CameraIndex::Index(0);
        let requested = RequestedFormat::new::<RgbFormat>(RequestedFormatType::AbsoluteHighestFrameRate);
        
        let mut camera = match Camera::new(index, requested) {
            Ok(c) => c,
            Err(e) => {
                let _ = tx.send(KernelEvent::SystemLog(format!("Sentry Error: Could not initialize camera: {}", e)));
                return;
            }
        };

        if let Err(e) = camera.open_stream() {
            let _ = tx.send(KernelEvent::SystemLog(format!("Sentry Error: Could not open stream: {}", e)));
            return;
        }

        let _ = tx.send(KernelEvent::SystemLog("Sentry Core: Eyes Online".into()));

        let mut last_frame: Option<ImageBuffer<Rgb<u8>, Vec<u8>>> = None;
        let motion_threshold = 20.0; // Sensitivity adjustment

        loop {
            // Capture frame
            let frame = match camera.frame() {
                Ok(f) => f,
                Err(_) => {
                    thread::sleep(Duration::from_millis(100));
                    continue;
                }
            };

            let decoded = match frame.decode_image::<RgbFormat>() {
                Ok(d) => d,
                Err(_) => continue,
            };

            // 1. Motion Detection (Simple pixel difference)
            let mut motion_score = 0.0;
            if let Some(prev) = &last_frame {
                let current_pixels = decoded.as_raw();
                let prev_pixels = prev.as_raw();
                
                // Compare a subset of pixels for performance
                let step = 10; 
                let mut diff_sum: u64 = 0;
                let mut count = 0;
                
                for i in (0..current_pixels.len()).step_by(step) {
                    let diff = (current_pixels[i] as i32 - prev_pixels[i] as i32).abs();
                    diff_sum += diff as u64;
                    count += 1;
                }
                motion_score = diff_sum as f64 / count as f64;
            }
            
            let motion_detected = motion_score > motion_threshold;
            last_frame = Some(decoded.clone());

            // 2. Encode to JPEG for streaming
            // Downscale for performance (mini-feed doesn't need 1080p)
            let resized = image::imageops::thumbnail(&decoded, 320, 240);
            let mut jpeg_data = Vec::new();
            let mut cursor = Cursor::new(&mut jpeg_data);
            
            if resized.write_to(&mut cursor, image::ImageFormat::Jpeg).is_ok() {
                let base64_frame = general_purpose::STANDARD.encode(jpeg_data);
                
                // 3. Broadcast (broadcast channel is Send/Sync)
                let _ = tx.send(KernelEvent::SentryFrame {
                    frame: base64_frame,
                    motion_detected,
                });
            }

            // Limit frame rate to ~10 FPS
            thread::sleep(Duration::from_millis(100));
        }
    });
}
