import EmailAnalysisUser from "../models/emailAnalysisUser.model";
import EmailAnalysisMessagesService from "./emailAnalysis.messages.service";
import OutlookMessagesService from "./outlook.messages.service";

export async function getAccount(email) {
  if (!email) return null;
  return EmailAnalysisUser.findOne({ email, active: true }).sort({ updatedAt: -1 }).lean();
}

export async function createMailService(email) {
  const account = await getAccount(email);
  if (!account) throw new Error(`No connected account for ${email}`);
  if (account.provider === "outlook" || account.provider === "microsoft") {
    return new OutlookMessagesService(email);
  }
  return new EmailAnalysisMessagesService(email);
}

export function createMailServiceForAccount(account) {
  if (!account?.email) throw new Error("No connected account.");
  if (account.provider === "outlook" || account.provider === "microsoft") {
    return new OutlookMessagesService(account.email);
  }
  return new EmailAnalysisMessagesService(account.email);
}
