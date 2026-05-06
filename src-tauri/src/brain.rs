use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::env;

#[async_trait]
pub trait Brain {
    async fn generate(&self, prompt: &str) -> Result<String, String>;
    fn name(&self) -> &str;
}

pub struct GeminiBrain;

#[async_trait]
impl Brain for GeminiBrain {
    fn name(&self) -> &str {
        "Gemini"
    }

    async fn generate(&self, prompt: &str) -> Result<String, String> {
        let api_key = env::var("GEMINI_API_KEY").map_err(|_| "GEMINI_API_KEY not set")?;
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={}",
            api_key
        );

        let client = reqwest::Client::new();
        let body = serde_json::json!({
            "contents": [{
                "parts": [{ "text": prompt }]
            }]
        });

        let response = client
            .post(url)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
        
        // Basic extraction logic for Gemini response
        json["candidates"][0]["content"]["parts"][0]["text"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| format!("Invalid response from Gemini: {:?}", json))
    }
}
