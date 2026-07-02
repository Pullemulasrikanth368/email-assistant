import express from 'express';
import multer from 'multer';
import asyncHandler from 'express-async-handler';
import draftCtrl from '../controllers/emailDraft.controller';

const router = express.Router(); // eslint-disable-line new-cap

// Attachment uploads land in memory and are written to disk in the controller.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB per attachment
});

/**
 * Draft management endpoints.
 * Mounted at /api/email-analysis/drafts.
 */

// List all drafts for the connected account.
router.get('/', asyncHandler(draftCtrl.listDrafts));

// Create a new draft (also creates the corresponding provider draft).
router.post('/', asyncHandler(draftCtrl.createDraft));

// Get a single draft by its MongoDB _id.
router.get('/:id', asyncHandler(draftCtrl.getDraft));

// Full update (recipients + subject + body). Also syncs to provider.
router.put('/:id', asyncHandler(draftCtrl.updateDraft));

// Lightweight auto-save endpoint — same logic as PUT but returns minimal payload.
router.post('/:id/autosave', asyncHandler(draftCtrl.autoSaveDraft));

// Send the draft via the provider (Gmail / Outlook).
router.post('/:id/send', asyncHandler(draftCtrl.sendDraft));

// Soft-delete locally and remove from provider drafts folder.
router.delete('/:id', asyncHandler(draftCtrl.deleteDraft));

// Attach a file to a draft (multipart/form-data).
router.post('/:id/attachments', upload.single('file'), asyncHandler(draftCtrl.uploadAttachment));

// Remove an attachment by its zero-based index.
router.delete('/:id/attachments/:index', asyncHandler(draftCtrl.removeAttachment));

export default router;
