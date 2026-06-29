import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY,
});

/**
 * @description use OpenAI SDK to call the OpenAI server
 * @param {*} prompt
 * @returns raw response object from OpenAI
 */
/**
 * Safely parses JSON (removes ```json wrapping if present)
 */
function safeJsonParse(content) {
  try {
    if (!content) return null;

    let cleaned = content.trim();

    // Remove markdown wrapping if model returns it
    if (cleaned.startsWith("```")) {
      cleaned = cleaned
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();
    }

    return JSON.parse(cleaned);
  } catch (error) {
    console.error("JSON Parse Error:", error);
    console.error("Raw LLM Output:", content);
    return null;
  }
}

/**
 * Structured JSON Chat (Resume Screening Safe Version)
 */
async function createChat(prompt) {
  try {
    const chat = await client.chat.completions.create({
      model: "gpt-4o", //  Updated model
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant for extracting structured data from text. Return only valid JSON. Do not use markdown."
        },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" } //  Forces JSON
    });

    const content = chat.choices[0].message.content;

    console.log(" OpenAI Raw Response:", content);

    return safeJsonParse(content);

  } catch (error) {
    console.error("OpenAI API Error:", error);
    throw error;
  }
}

/**
 * Generic Chat (Non-JSON)
 */
async function chatCompletion(messages) {
  try {
    const chat = await client.chat.completions.create({
      model: "gpt-4o",
      messages
    });

    return chat.choices[0].message.content;

  } catch (error) {
    console.error("OpenAI Chat Error:", error);
    throw error;
  }
}

export default { createChat, chatCompletion, client };
