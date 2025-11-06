/**
 * OpenAI API Configuration
 * Whisper and GPT settings
 */

require("dotenv").config();

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required in environment variables");
}

module.exports = {
  apiKey: process.env.OPENAI_API_KEY,

  // Whisper Configuration
  whisper: {
    model: "whisper-1",
    language: "en",
    responseFormat: "json",
    temperature: 0,
  },

  // GPT Configuration
  gpt: {
    model: "gpt-4",
    maxTokens: 1000,
    temperature: 0.3,
  },

  // API Settings
  timeout: 60000, // 60 seconds
  maxRetries: 3,

  // System Prompts
  prompts: {
    cleanTranscription: `You are a professional transcription editor. Your task is to:
1. Remove filler words (um, uh, like, you know, etc.)
2. Fix grammar and punctuation
3. Correct obvious speech-to-text errors
4. Maintain the original meaning and tone
5. Keep the response concise but complete
6. Ensure proper capitalization

Return only the cleaned text without any additional commentary.`,
  },
};