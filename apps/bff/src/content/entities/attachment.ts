import { BadRequestException } from '@nestjs/common';
import { type Attachment, ENTITY_DEFS } from '@greed/domain';
import { AttachmentInputDto } from '../content.dto.js';
import { defineEntity } from '../entity.js';
import { compactTopicView } from './compact.js';

/**
 * Archived evidence for a reference. Rows are written by the server when it archives a file
 * (attach_document), so there is no REST or generic MCP create: a caller cannot claim a hash,
 * type or size for bytes the server never saw. Editing changes only the human fields (caption,
 * alt text, which reference it supports, the extracted text and its status).
 */
export const attachmentSpec = defineEntity<Attachment, AttachmentInputDto>({
  def: ENTITY_DEFS.attachment,
  dto: AttachmentInputDto,
  route: 'attachments',
  serverCreated: true,

  fields: (input, { index, parent, existing }) => {
    const reference = index.snapshot.references.find((r) => r.id === input.referenceId);
    if (!reference || reference.topicId !== parent.id) throw new BadRequestException(`Reference "${input.referenceId}" is not on this topic`);
    if (reference.viralClaim) {
      throw new BadRequestException('A viral claim is cited and answered with a verdict, never attached as a file');
    }

    // What the archive vouches for is fixed when the file is stored.
    const sha256 = existing?.sha256 ?? input.sha256;
    const mimeType = existing?.mimeType ?? input.mimeType;
    const bytes = existing?.bytes ?? input.bytes;
    const capturedAt = existing?.capturedAt ?? input.capturedAt;
    if (!sha256 || !mimeType || !bytes || !capturedAt) {
      throw new BadRequestException('An attachment is created by archiving a file; use attach_document');
    }
    const duplicate = (index.snapshot.attachments ?? []).find((a) => a.id !== existing?.id && a.referenceId === reference.id && a.sha256 === sha256);
    if (duplicate) throw new BadRequestException(`That file is already attached to this reference (${duplicate.id})`);

    const extractedText = input.extractedText?.trim() || undefined;
    // An explicit change of status wins. Otherwise new text finishes the extraction, and a status
    // carried over from the stored row (an edit sends the whole row) is kept. "done" always has text.
    const requested = input.extractionStatus;
    const explicit = requested !== undefined && requested !== existing?.extractionStatus;
    let extractionStatus = explicit
      ? requested
      : extractedText && extractedText !== existing?.extractedText
        ? 'done'
        : (requested ?? existing?.extractionStatus ?? (extractedText ? 'done' : 'pending'));
    if (extractionStatus === 'done' && !extractedText) extractionStatus = 'pending';
    return {
      referenceId: reference.id,
      kind: input.kind,
      caption: input.caption.trim(),
      altText: input.altText.trim(),
      sourceUrl: existing ? existing.sourceUrl : input.sourceUrl?.trim() || undefined,
      capturedAt,
      sha256,
      mimeType,
      bytes,
      extractedText,
      extractionStatus,
    };
  },

  present: (attachment, { index }) => index.view(attachment.topicId),

  mcp: {
    update: {
      description:
        'Fix an attachment’s caption, alt text or the reference it supports, or store its text: for a scan with extractionStatus "pending", ' +
        'transcribe it (or paste the OCR) into extractedText. Only the fields you pass change; the archived file itself cannot be changed.',
    },
    deleteDraft: true,
    omit: ['sourceUrl', 'capturedAt', 'sha256', 'mimeType', 'bytes'],
    fields: {
      referenceId: 'The reference this evidence supports. The points that cite that reference are the points it supports.',
      kind: 'primary-document (an order, letter, filing or addendum), chart, or scan.',
      caption: 'What the file is, e.g. "Signed DOJ addendum, Oct. 2026".',
      altText: 'Describes the file for someone who cannot see it.',
      extractedText: 'Text read out of the file. Exactly what it says; do not summarise or correct it.',
      extractionStatus: 'pending (not read yet), done, or failed. Setting extractedText marks it done unless you say otherwise.',
    },
    result: compactTopicView,
  },
});
