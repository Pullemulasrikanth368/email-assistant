import Joi from "joi";

const ENVIRONMENT = process.env.ENVIRONMENT || 'local';
const PREFIX = `${ENVIRONMENT.toUpperCase()}_`;

function getRequiredEnv(key) {
  console.log(`Checking required env var: ${key}`);
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getOptionalEnv(...keys) {
  console.log(`Checking optional env vars: ${keys.join(", ")}`);
  return keys.map(key => process.env[key]).find(Boolean);
}

let arr = ["local", "development", "production", "test", "provision"];

// define validation for all the env vars
const envVarsSchema = Joi.object({
  ENVIRONMENT: Joi.string()
    .allow(...arr)
    .default("local"),
  MONGOOSE_DEBUG: Joi.boolean().when("ENVIRONMENT", {
    is: Joi.string().equal("development"),
    then: Joi.boolean().default(true),
    otherwise: Joi.boolean().default(false),
  }),
})
  .unknown()
  .required();

const { error, value: envVars } = envVarsSchema.validate(process.env);
if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

const config = {
  env: envVars.ENVIRONMENT,
  port: getRequiredEnv(`${PREFIX}PORT`),
  mongooseDebug: envVars.MONGOOSE_DEBUG,
  jwtSecret: "0a6b944d-d2fb-46fc-a85e-0295c986cd9f",
  mongo: {
    host: getRequiredEnv(`${PREFIX}MONGO_HOST`),
    dmsHost: getRequiredEnv(`${PREFIX}DMS_MONGO_HOST`),
    port: 27017,
    test: "mongodb://localhost:27017/executive_email_assistant_dev",
  },
  projectName: "executive-email-assistant",
  isLoggerValidEnable: false,
  serverUrl: getOptionalEnv(`${PREFIX}SERVER_URL`) || `http://localhost:${process.env[`${PREFIX}PORT`] || 8676}/`,
  frontendUrl: getOptionalEnv(`${PREFIX}CLIENT_URL`) || "http://localhost:5173/",
  adminRoomName: "adminRoomUser",

  // Google OAuth for the email-analysis Gmail connection
  googleClient: process.env.GOOGLE_CLIENT_KEY_EMAIL,
  googleSecret: process.env.GOOGLE_SECRET_EMAIL,

  // Redirect URI for the email-analysis Google connection flow.
  // Register this exact URL in the Google Cloud console.
  emailAnalysisRedirectUri:
    process.env.EMAIL_ANALYSIS_REDIRECT_URI ||
    `http://localhost:${process.env[`${PREFIX}PORT`] || 8676}/api/auth/google/email-analysis/webhook`,

  /**
   * Microsoft (Entra ID) connection for Teams message delivery.
   */
  microsoftClient: process.env.MICROSOFT_CLIENT_ID,
  microsoftSecret: process.env.MICROSOFT_SECRET,
  microsoftTenant: process.env.MICROSOFT_TENANT_ID || "common",
  microsoftTeamsRedirectUri:
    process.env.MS_TEAMS_REDIRECT_URI ||
    `http://localhost:${process.env[`${PREFIX}PORT`] || 8676}/api/auth/microsoft/teams/webhook`,
  microsoftOutlookRedirectUri:
    process.env.MS_OUTLOOK_REDIRECT_URI ||
    `http://localhost:${process.env[`${PREFIX}PORT`] || 8676}/api/auth/microsoft/outlook/webhook`,

  // Alias used by microsoft/services/outlookAuth.service.js
  outlookRedirectUri:
    process.env.MS_OUTLOOK_REDIRECT_URI ||
    `http://localhost:${process.env[`${PREFIX}PORT`] || 8676}/api/auth/microsoft/outlook/webhook`,

  /**
   * AI backend for the email-analysis flow.
   * "openai" (default) or "ollama"
   */
  emailAnalysisModel: (process.env.EMAIL_ANALYSIS_MODEL || "openai").toLowerCase(),
  ollamaUrl: process.env.LOCAL_OLLAMA_API_URL || process.env.OLLAMA_API_URL || "http://127.0.0.1:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "llama3",

  // Upload path for email attachments
  upload: {
    emailAnalysis: "server/upload/email-analysis",
  },
};

export default config;
