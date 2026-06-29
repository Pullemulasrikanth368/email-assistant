/**@AI client switch for the email-analysis flow.
 *
 * Routes the SAME calls (createChat / chatCompletion) to either the existing
 * OpenAI util or the new Ollama util. The backend is chosen at RUNTIME from the
 * Settings document (set in the UI), so it can be switched without a restart.
 *
 * Precedence: Settings.emailAnalysisModel  ->  "openai" (default).
 * When it resolves to "openai" behaviour is byte-for-byte the current
 * implementation — the OpenAI util is untouched.
 */
import Settings from "../../models/settings.model";
import openaiUtil from "../../utils/openai.util";
import ollamaUtil from "./ollama.util";

// Tiny cache so a burst of calls (e.g. prioritization chunks) doesn't hit the
// DB every time. Short TTL so a UI change takes effect almost immediately.
let cached = { value: null, at: 0 };
const TTL_MS = 15 * 1000;

async function resolveModel() {
  const now = Date.now();
  if (cached.value && now - cached.at < TTL_MS) return cached.value;

  let model = "openai"; // default
  try {
    const s = await Settings.findOne({ active: true }).select("emailAnalysisModel").lean();
    if (s && String(s.emailAnalysisModel).toLowerCase() === "ollama") model = "ollama";
  } catch (e) {
    // keep default
  }
  cached = { value: model, at: now };
  return model;
}

function implFor(model) {
  return model === "ollama" ? ollamaUtil : openaiUtil;
}

export default {
  /** Current effective backend name ("openai" | "ollama"). */
  async currentProvider() {
    return resolveModel();
  },
  async createChat(prompt) {
    const model = await resolveModel();
    console.log(`[EmailAnalysis][AI] createChat using: ${model.toUpperCase()}`);
    const result = await implFor(model).createChat(prompt);
    console.log(`[EmailAnalysis][AI] createChat response received from: ${model.toUpperCase()}`);
    return result;
  },
  async chatCompletion(messages) {
    const model = await resolveModel();
    console.log(`[EmailAnalysis][AI] chatCompletion using: ${model.toUpperCase()}`);
    const result = await implFor(model).chatCompletion(messages);
    console.log(`[EmailAnalysis][AI] chatCompletion response received from: ${model.toUpperCase()}`);
    return result;
  },
};
