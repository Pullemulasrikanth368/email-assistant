/**
 * mailProvider.service.js
 *
 * Resolves the correct mail service (Gmail or Outlook) for a given email.
 * Checks EmailAnalysisUser first (Google / Outlook via emailAnalysis flow),
 * then falls back to OutlookUser (Outlook via microsoft.controller flow).
 */
import EmailAnalysisUser from "../models/emailAnalysisUser.model";
import OutlookUser from "../../microsoft/models/outlookUser.model";
import EmailAnalysisMessagesService from "./emailAnalysis.messages.service";

// Two separate Outlook service implementations — one per integration path.
// Both expose the same public interface (syncForUser, sendMail, etc.)
import OutlookMessagesServiceEA from "./outlook.messages.service";           // emailAnalysis path
import OutlookMessagesServiceMS from "../../microsoft/services/outlookMessages.service"; // microsoft path

/**
 * Resolve the connected account record for the given email.
 * Priority: EmailAnalysisUser → OutlookUser
 */
export async function getAccount(email) {
  if (!email) return null;

  // 1) Check the emailAnalysis user collection (Google + emailAnalysis Outlook)
  const eaUser = await EmailAnalysisUser.findOne({ email, active: true })
    .sort({ updatedAt: -1 })
    .lean();
  if (eaUser) return { ...eaUser, _source: "emailAnalysis" };

  // 2) Fall back to the microsoft-controller Outlook user collection
  const msUser = await OutlookUser.findOne({ email, active: true })
    .sort({ updatedAt: -1 })
    .lean();
  if (msUser) return { ...msUser, _source: "outlook" };

  return null;
}

/**
 * Build the correct service instance for the resolved account.
 * - Google accounts → EmailAnalysisMessagesService
 * - Outlook via emailAnalysis path → OutlookMessagesServiceEA (uses EmailAnalysisUser)
 * - Outlook via microsoft path → OutlookMessagesServiceMS (uses OutlookUser)
 */
export async function createMailService(email) {
  const account = await getAccount(email);
  if (!account) throw new Error(`No connected account for ${email}. Connect an account in Connections & Delivery.`);

  if (account.provider === "outlook" || account.provider === "microsoft") {
    // Use the service that matches the collection the user is stored in
    if (account._source === "outlook") {
      return new OutlookMessagesServiceMS(email);
    }
    return new OutlookMessagesServiceEA(email);
  }

  // Default: Gmail / Google Workspace
  return new EmailAnalysisMessagesService(email);
}

/**
 * Build the correct service instance directly from an already-loaded account object.
 */
export function createMailServiceForAccount(account) {
  if (!account?.email) throw new Error("No connected account.");

  if (account.provider === "outlook" || account.provider === "microsoft") {
    if (account._source === "outlook") {
      return new OutlookMessagesServiceMS(account.email);
    }
    return new OutlookMessagesServiceEA(account.email);
  }

  return new EmailAnalysisMessagesService(account.email);
}
