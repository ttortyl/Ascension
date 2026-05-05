use axum::{routing::get, Router};
use std::net::SocketAddr;
use tauri::Manager;
use tower_http::cors::CorsLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from the Ascension Kernel!", name)
}

async fn heartbeat() -> &'static str {
    "Ascension Kernel: Online"
}

fn start_kernel_server() {
    tokio::spawn(async move {
        let app = Router::new()
            .route("/heartbeat", get(heartbeat))
            .layer(CorsLayer::permissive());

        let addr = SocketAddr::from(([127, 0, 0, 1], 7338));
        tracing::info!("Kernel server listening on {}", addr);
        
        let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
        axum::serve(listener, app).await.unwrap();
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Start the Axum Kernel server in the background
            start_kernel_server();
            
            #[cfg(debug_assertions)] // only include this code on debug builds
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
