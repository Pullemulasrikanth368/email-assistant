/**@Ollama util — drop-in equivalent of utils/openai.util for the email-analysis
 * flow. Exposes the SAME interface (createChat / chatCompletion) so it can be
 * swapped in via aiClient when EMAIL_ANALYSIS_MODEL=ollama. The OpenAI util is
 * left completely untouched.
 *
 * Uses the Ollama /api/chat endpoint (non-streaming). For structured calls we
 * pass `format: "json"`, which makes Ollama emit valid JSON — so the existing
 * prompts work without change. A few prompt nudges are added here (a strict
 * system message + low temperature) because local models need firmer steering
 * than gpt-4o to return clean JSON.
 */
import axios from "axios";
import config from "../../config/config";

const BASE = String(config.ollamaUrl || "http://127.0.0.1:11434").replace(/\/+$/, "");
// const MODEL = config.ollamaModel || "llama3";
const MODEL="gpt-oss:120b-cloud";
const TIMEOUT_MS = 120000; // local models can be slow

const JSON_SYSTEM =
  "You are a precise assistant. Respond with a SINGLE valid JSON object only — " +
  "no markdown, no code fences, no commentary before or after. Use the exact keys requested.";

/** Strip ```json fences / stray prose and parse JSON (same spirit as the OpenAI util). */
function safeJsonParse(content) {
  try {
    if (!content) return null;
    let cleaned = String(content).trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/```json/gi, "").replace(/```/g, "").trim();
    }
    // If the model wrapped JSON in text, grab the outermost {...} or [...].
    if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
      const m = cleaned.match(/[{[][\s\S]*[}\]]/);
      if (m) cleaned = m[0];
    }
    return JSON.parse(cleaned);
  } catch (error) {
    console.error("[Ollama] JSON parse error:", error.message);
    console.error("[Ollama] Raw output:", content);
    return null;
  }
}

async function chat(messages, { json = false, temperature = json ? 0 : 0.4 } = {}) {
  const body = {
    model: MODEL,
    messages,
    stream: false,
    options: { temperature },
  };
  if (json) body.format = "json";

  const endpoint = `${BASE}/api/chat`;
  console.log(`[Ollama] POST ${endpoint} (model=${MODEL}, json=${json})`);
  const { data } = await axios.post(endpoint, body, { timeout: TIMEOUT_MS });
  return data?.message?.content || "";
}

/** Log full transport detail so 4xx/5xx from the model endpoint are diagnosable. */
function logOllamaError(where, error) {
  console.error(`[Ollama] ${where} error:`, {
    message: error.message,
    code: error.code,
    status: error?.response?.status,
    statusText: error?.response?.statusText,
    url: error?.config?.url,
    model: MODEL,
    data: error?.response?.data,
  });
}

/**
 * Structured JSON chat — mirrors openaiUtil.createChat(prompt).
 * Returns the parsed JSON object (or null on parse failure).
 */
async function createChat(prompt) {
  try {
    const content = await chat(
      [
        { role: "system", content: JSON_SYSTEM },
        { role: "user", content: prompt },
      ],
      { json: true }
    );
    return safeJsonParse(content);
  } catch (error) {
    logOllamaError("createChat", error);
    throw error;
  }
}

/**
 * Free-form chat — mirrors openaiUtil.chatCompletion(messages).
 * Returns the assistant's text content.
 */
async function chatCompletion(messages) {
  try {
    return await chat(messages, { json: false });
  } catch (error) {
    logOllamaError("chatCompletion", error);
    throw error;
  }
}

export default { createChat, chatCompletion };
