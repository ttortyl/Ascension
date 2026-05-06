mod brain;
mod sentry;
mod commands;
mod memory;

use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use brain::Brain;
use futures_util::{sink::SinkExt, stream::StreamExt};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum KernelEvent {
    Thought(String),
    SystemLog(String),
    ModelStatus { model: String, status: String },
    JusticeAudit(brain::AuditReport),
    SentryFrame { frame: String, motion_detected: bool },
    CommandOutput(commands::CommandResult),
    GraphUpdate(memory::ProjectNode),
}

#[derive(Deserialize)]
struct PromptRequest {
    prompt: String,
    model: Option<String>,
}

#[derive(Deserialize)]
struct CommandRequest {
    command: String,
}

struct AppState {
    tx: broadcast::Sender<KernelEvent>,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from the Ascension Kernel!", name)
}

async fn heartbeat() -> &'static str {
    "Ascension Kernel: Online"
}

async fn get_graph() -> Json<memory::ProjectNode> {
    Json(memory::get_project_graph("."))
}

async fn process_command(
    axum::extract::State(state): axum::extract::State<std::sync::Arc<AppState>>,
    Json(payload): Json<CommandRequest>,
) -> Json<serde_json::Value> {
    let tx = state.tx.clone();
    let result = commands::execute_shell(&payload.command, tx.clone()).await;
    let _ = tx.send(KernelEvent::CommandOutput(result.clone()));
    
    Json(serde_json::json!({ "result": result }))
}

async fn process_prompt(
    axum::extract::State(state): axum::extract::State<std::sync::Arc<AppState>>,
    Json(payload): Json<PromptRequest>,
) -> Json<serde_json::Value> {
    let tx = state.tx.clone();
    let model_choice = payload.model.unwrap_or_else(|| "gemini".to_string());
    
    let _ = tx.send(KernelEvent::Thought(format!("Routing to {} for: {}", model_choice, payload.prompt)));

    let brain: Box<dyn Brain + Send + Sync> = match model_choice.to_lowercase().as_str() {
        "ollama" => Box::new(brain::OllamaBrain::default()),
        _ => Box::new(brain::GeminiBrain),
    };

    let _ = tx.send(KernelEvent::ModelStatus {
        model: brain.name().into(),
        status: "active".into(),
    });

    match brain.generate(&payload.prompt).await {
        Ok(primary_response) => {
            let _ = tx.send(KernelEvent::Thought("Primary response generated. Initializing Judicial Audit...".into()));
            
            // Chief Justice Audit
            let justice = brain::ChiefJustice {
                brain: Box::new(brain::GeminiBrain),
            };

            match justice.audit(&payload.prompt, &primary_response).await {
                Ok(report) => {
                    let _ = tx.send(KernelEvent::JusticeAudit(report.clone()));
                    
                    let final_response = if report.passed {
                        primary_response
                    } else {
                        report.adjusted_response.clone().unwrap_or(primary_response)
                    };

                    Json(serde_json::json!({ 
                        "response": final_response,
                        "audit": report 
                    }))
                }
                Err(e) => {
                    let _ = tx.send(KernelEvent::SystemLog(format!("Justice Error: {}", e)));
                    Json(serde_json::json!({ "response": primary_response, "audit_error": e }))
                }
            }
        }
        Err(e) => {
            let _ = tx.send(KernelEvent::SystemLog(format!("Brain Error ({}): {}", brain.name(), e)));
            Json(serde_json::json!({ "error": e }))
        }
    }
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    axum::extract::State(state): axum::extract::State<std::sync::Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: std::sync::Arc<AppState>) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.tx.subscribe();

    let mut send_task = tokio::spawn(async move {
        while let Ok(event) = rx.recv().await {
            let msg = serde_json::to_string(&event).unwrap();
            if sender.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if let Message::Text(text) = msg {
                tracing::info!("Received from client: {}", text);
            }
        }
    });

    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
    };
}

fn start_kernel_server(tx: broadcast::Sender<KernelEvent>) {
    let state = std::sync::Arc::new(AppState { tx: tx.clone() });

    tokio::spawn(async move {
        let app = Router::new()
            .route("/heartbeat", get(heartbeat))
            .route("/ws", get(ws_handler))
            .route("/prompt", post(process_prompt))
            .route("/execute", post(process_command))
            .route("/graph", get(get_graph))
            .layer(CorsLayer::permissive())
            .with_state(state);

        let addr = SocketAddr::from(([127, 0, 0, 1], 7338));
        tracing::info!("Kernel server listening on {}", addr);
        
        let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
        axum::serve(listener, app).await.unwrap();
    });

    let tx_clone = tx.clone();
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        let _ = tx_clone.send(KernelEvent::SystemLog("Kernel Communication Layer Initialized".into()));
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();
    
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let (tx, _rx) = broadcast::channel(100);

    let sentry_tx = tx.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(move |_app| {
            start_kernel_server(tx);
            sentry::start_sentry_loop(sentry_tx);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
