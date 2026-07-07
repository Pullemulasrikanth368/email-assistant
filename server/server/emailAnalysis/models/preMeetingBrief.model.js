import Promise from 'bluebird';
import mongoose from 'mongoose';
import httpStatus from 'http-status';

import APIError from '../../helpers/APIError';

/**
 * Pre-Meeting Brief
 *
 * An AI-generated preparation brief for an upcoming meeting. It reuses the SAME
 * `brief` shape produced by the brief engine (narrative, decisionQueue, risks,
 * todoList, actions, events, ...) so the existing BriefDashboard / renderMd can
 * render it with no changes. Kept in its own collection so it never mixes with
 * the day/week operations reports (`email_analysis_reports`).
 *
 * The brief is built from the account's ALREADY-analyzed mail
 * (`email_analysis_mails`): participants, sender domains and AI-extracted
 * meeting topics select the relevant emails, and their stored metadata
 * (priority, category, intent) feeds the single AI summarization call.
 */
const PreMeetingBriefSchema = new mongoose.Schema({
  // Owning connected account (email_analysis_user.email).
  email: { type: String, index: true },

  // The meeting-invitation email this brief was built from (providerMessageId),
  // when the meeting was auto-detected from the inbox. Null for manual entries.
  meetingSourceId: { type: String, default: null, index: true },

  // Extracted meeting facts.
  meetingTitle: { type: String, default: '' },
  meetingWhen: { type: Date, default: null },       // parsed start time (best-effort)
  meetingWhenText: { type: String, default: '' },   // raw "When:" text as found
  meetingLocation: { type: String, default: '' },
  organizer: { type: String, default: '' },
  participants: { type: [String], default: [] },
  description: { type: String, default: '' },

  // AI-extracted discussion topics / keywords used to retrieve candidate mail.
  topics: { type: [String], default: [] },

  // How many analyzed emails fed the brief.
  candidateCount: { type: Number, default: 0 },

  // Full brief JSON — same contract as EmailAnalysisReport.brief.
  brief: { type: mongoose.Schema.Types.Mixed, default: {} },

  source: { type: String, enum: ['live', 'sample'], default: 'sample' },
  generatedAt: { type: Date },

  // Convenience counters for the list cards.
  counts: {
    decisions: { type: Number, default: 0 },
    risks: { type: Number, default: 0 },
    actions: { type: Number, default: 0 },
    todos: { type: Number, default: 0 },
  },

  // Snapshot of the KB config active at generation time (audit trail).
  knowledgeBaseSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },

  active: { type: Boolean, default: true },
}, { usePushEach: true, timestamps: true });

PreMeetingBriefSchema.index({ email: 1, meetingWhen: -1 });

PreMeetingBriefSchema.statics = {
  saveData(doc) {
    return doc.save()
      .then((saved) => {
        if (saved) return saved;
        const err = new APIError('Error saving pre-meeting brief', httpStatus.NOT_FOUND);
        return Promise.reject(err);
      });
  },
};

/**
 * @typedef PreMeetingBrief
 */
export default mongoose.model('preMeetingBrief', PreMeetingBriefSchema, 'pre_meeting_briefs');
