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

pub struct OllamaBrain {
    pub model: String,
}

impl Default for OllamaBrain {
    fn default() -> Self {
        Self {
            model: "llama3".to_string(),
        }
    }
}

#[async_trait]
impl Brain for OllamaBrain {
    fn name(&self) -> &str {
        "Ollama"
    }

    async fn generate(&self, prompt: &str) -> Result<String, String> {
        let url = "http://localhost:11434/api/generate";

        let client = reqwest::Client::new();
        let body = serde_json::json!({
            "model": self.model,
            "prompt": prompt,
            "stream": false
        });

        let response = client
            .post(url)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Ollama connection error: {}. Is Ollama running?", e))?;

        let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
        
        json["response"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| format!("Invalid response from Ollama: {:?}", json))
    }
}

pub struct ChiefJustice {
    pub brain: Box<dyn Brain + Send + Sync>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditReport {
    pub passed: bool,
    pub reasoning: String,
    pub adjusted_response: Option<String>,
}

impl ChiefJustice {
    pub async fn audit(&self, original_prompt: &str, original_response: &str) -> Result<AuditReport, String> {
        let audit_prompt = format!(
            "YOU ARE THE PROJECT ASCENSION CHIEF JUSTICE. 
            YOUR TASK IS TO AUDIT THE FOLLOWING AI RESPONSE FOR LOGIC, HALLUCINATIONS, AND SAFETY.
            
            OPERATOR PROMPT: {}
            PRIMARY BRAIN RESPONSE: {}
            
            IF THE RESPONSE IS ACCURATE AND SAFE, RETURN: 'PASSED | [REASONING]'
            IF THE RESPONSE IS WRONG OR NEEDS CORRECTION, RETURN: 'FAILED | [REASONING] | [NEW CORRECTED RESPONSE]'
            
            YOUR OUTPUT MUST BE IN THE EXACT FORMAT ABOVE.",
            original_prompt, original_response
        );

        let audit_raw = self.brain.generate(&audit_prompt).await?;
        
        if audit_raw.starts_with("PASSED") {
            let parts: Vec<&str> = audit_raw.split('|').collect();
            Ok(AuditReport {
                passed: true,
                reasoning: parts.get(1).unwrap_or(&"Audit passed by Chief Justice").trim().to_string(),
                adjusted_response: None,
            })
        } else if audit_raw.starts_with("FAILED") {
            let parts: Vec<&str> = audit_raw.split('|').collect();
            Ok(AuditReport {
                passed: false,
                reasoning: parts.get(1).unwrap_or(&"Audit failed by Chief Justice").trim().to_string(),
                adjusted_response: parts.get(2).map(|s| s.trim().to_string()),
            })
        } else {
            Err(format!("Chief Justice returned invalid format: {}", audit_raw))
        }
    }
}
