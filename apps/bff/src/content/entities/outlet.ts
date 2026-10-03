import { BadRequestException } from '@nestjs/common';
import { ENTITY_DEFS, normalizeDomain, uniqueSlug, type Outlet } from '@greed/domain';
import { OutletInputDto } from '../content.dto.js';
import { defineEntity } from '../entity.js';

export const outletSpec = defineEntity<Outlet, OutletInputDto>({
  def: ENTITY_DEFS.outlet,
  dto: OutletInputDto,
  route: 'outlets',

  makeId: (input, { index }) => {
    const taken = new Set((index.snapshot.outlets ?? []).map((o) => o.id));
    try {
      return uniqueSlug(normalizeDomain(input.domain), taken);
    } catch {
      return uniqueSlug('outlet', taken);
    }
  },

  fields: (input, { index, existing }) => {
    let domain: string;
    try {
      domain = normalizeDomain(input.domain);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'Not a domain');
    }
    const duplicate = (index.snapshot.outlets ?? []).find((o) => o.domain === domain && o.id !== existing?.id);
    if (duplicate) throw new BadRequestException(`An outlet for ${domain} already exists`);
    return {
      name: input.name.trim(),
      domain,
      paywall: input.paywall,
      accuracy: input.accuracy,
      bias: input.bias,
      oneSided: input.oneSided,
      factual: input.factual,
      note: input.note?.trim() || undefined,
    };
  },

  mcp: {
    create: {
      name: 'create_outlet',
      description:
        'Add a publication to the trust catalog, as a draft. Paywalled outlets are stored so research can skip them; they are a hard avoid. ' +
        'accuracy and factual: high, mixed, or low (high is better). bias: high, mixed, or low (low means less biased and ranks higher). ' +
        'oneSided is true when the outlet only presents one side. Research searches published non-paywalled outlets only.',
    },
    update: {
      description: 'Change an outlet’s trust ratings or paywall flag. Only the fields you pass change. A paywall flag takes effect for search even before publish.',
    },
    deleteDraft: true,
    fields: {
      name: 'Publication name, e.g. "NPR" or "Washington Post".',
      domain: 'Host only, e.g. "npr.org" or "washingtonpost.com".',
      paywall: 'True for a hard avoid: never search or fetch.',
      accuracy: 'high, mixed, or low. Do the checkable facts hold up?',
      bias: 'high, mixed, or low. high means it pushes a side hard.',
      oneSided: 'True if it only shows one side of a contested claim.',
      factual: 'high, mixed, or low. Is this reporting, rather than opinion or rumor presented as news?',
      note: 'Why this rating, or what the outlet is useful for.',
    },
  },
});
