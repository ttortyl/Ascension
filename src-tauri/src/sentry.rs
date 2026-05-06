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
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

pub fn start_sentry_loop(tx: broadcast::Sender<KernelEvent>) {
    let tx_audio = tx.clone();
    let tx_cleanup = tx.clone();

    // 0. Cleanup Thread (The Janitor)
    thread::spawn(move || {
        loop {
            if let Ok(entries) = std::fs::read_dir("./Archives") {
                let now = std::time::SystemTime::now();
                let seven_days = Duration::from_secs(7 * 24 * 60 * 60);

                for entry in entries.flatten() {
                    if let Ok(metadata) = entry.metadata() {
                        if let Ok(modified) = metadata.modified() {
                            if now.duration_since(modified).unwrap_or(Duration::ZERO) > seven_days {
                                let _ = std::fs::remove_file(entry.path());
                                let _ = tx_cleanup.send(KernelEvent::SystemLog(format!("[SYS] Purged expired archive: {:?}", entry.file_name())));
                            }
                        }
                    }
                }
            }
            thread::sleep(Duration::from_secs(3600)); // Run every hour
        }
    });
    
    // 1. Audio Monitoring Thread (The Ears)
    thread::spawn(move || {
        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                let _ = tx_audio.send(KernelEvent::SystemLog("Sentry Audio Error: No input device found".into()));
                return;
            }
        };

        let config = match device.default_input_config() {
            Ok(c) => c,
            Err(_) => return,
        };

        let tx_cb = tx_audio.clone();
        let noise_threshold = 0.15; // Sensitivity for noise detection
        let mut last_log_time = std::time::Instant::now();

        let stream = device.build_input_stream(
            &config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                let rms = (data.iter().map(|&x| x * x).sum::<f32>() / data.len() as f32).sqrt();
                let noise_detected = rms > noise_threshold;

                if noise_detected && last_log_time.elapsed().as_secs() > 5 {
                    let _ = tx_cb.send(KernelEvent::SystemLog(format!("[ALERT] Significant Noise Detected (Level: {:.2})", rms)));
                    last_log_time = std::time::Instant::now();
                }

                let _ = tx_cb.send(KernelEvent::AudioStatus {
                    level: rms,
                    noise_detected,
                });
            },
            move |err| {
                eprintln!("Audio stream error: {}", err);
            },
            None
        ).unwrap();

        stream.play().unwrap();
        
        loop {
            thread::sleep(Duration::from_secs(1));
        }
    });

    // 2. Video Monitoring Thread (The Eyes)
    thread::spawn(move || {
        let index = CameraIndex::Index(0);
        let requested = RequestedFormat::new::<RgbFormat>(RequestedFormatType::AbsoluteHighestFrameRate);
        
        let mut camera = match Camera::new(index, requested) {
            Ok(c) => c,
            Err(e) => {
                let _ = tx.send(KernelEvent::SystemLog(format!("Sentry Video Error: {}", e)));
                return;
            }
        };

        if let Err(e) = camera.open_stream() {
            let _ = tx.send(KernelEvent::SystemLog(format!("Sentry Video Error: {}", e)));
            return;
        }

        let _ = tx.send(KernelEvent::SystemLog("Sentry Core: Eyes & Ears Online".into()));

        let mut last_frame: Option<ImageBuffer<Rgb<u8>, Vec<u8>>> = None;
        let motion_threshold = 20.0;

        loop {
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

            let mut motion_score = 0.0;
            if let Some(prev) = &last_frame {
                let current_pixels = decoded.as_raw();
                let prev_pixels = prev.as_raw();
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

            let resized = image::imageops::thumbnail(&decoded, 320, 240);
            let mut jpeg_data = Vec::new();
            let mut cursor = Cursor::new(&mut jpeg_data);
            
            if resized.write_to(&mut cursor, image::ImageFormat::Jpeg).is_ok() {
                let base64_frame = general_purpose::STANDARD.encode(jpeg_data);
                let _ = tx.send(KernelEvent::SentryFrame {
                    frame: base64_frame,
                    motion_detected,
                });
            }

            thread::sleep(Duration::from_millis(100));
        }
    });
}
