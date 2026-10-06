import type {
  Classification,
  CreateKnowledgeBaseRequest,
  KnowledgeBase,
  KnowledgeBaseAccessMode,
  UpdateKnowledgeBaseRequest,
} from '@/lib/api/types';

/**
 * The knowledge-base form (Phase 3 spec §5 "Knowledge bases", §6): its values, validation, and the
 * requests it produces. Chunk settings are inherited unless set (§4.5): knowledge
 * base → workspace settings → platform default.
 */

export const NAME_MAX = 120;
export const DESCRIPTION_MAX = 2000;
export const CHUNK_SIZE_MIN = 64;
export const CHUNK_SIZE_MAX = 4096;
export const CHUNK_OVERLAP_MAX = 1024;
/** The platform's defaults, "unless the deployment changed them" (§4.5). */
export const PLATFORM_CHUNK_SIZE = 512;
export const PLATFORM_CHUNK_OVERLAP = 64;

export type ChunkMode = 'inherit' | 'custom';

export interface KbFormValues {
  name: string;
  description: string;
  accessMode: KnowledgeBaseAccessMode;
  defaultClassification: Classification;
  chunkSizeMode: ChunkMode;
  chunkSize: string;
  chunkOverlapMode: ChunkMode;
  chunkOverlap: string;
}

export type KbFormField = keyof Pick<KbFormValues, 'name' | 'description' | 'defaultClassification' | 'chunkSize' | 'chunkOverlap'>;
export type KbFormErrors = Partial<Record<KbFormField | 'form', string>>;

/** The values a workspace's knowledge bases inherit; null when you can't read the workspace settings. */
export interface InheritedChunking {
  size: number | null;
  overlap: number | null;
}

export function initialValues(knowledgeBase: KnowledgeBase | undefined, assignable: readonly Classification[]): KbFormValues {
  if (knowledgeBase) {
    return {
      name: knowledgeBase.name,
      description: knowledgeBase.description ?? '',
      accessMode: knowledgeBase.accessMode,
      defaultClassification: knowledgeBase.defaultClassification,
      chunkSizeMode: knowledgeBase.chunkSize === null ? 'inherit' : 'custom',
      chunkSize: knowledgeBase.chunkSize === null ? '' : String(knowledgeBase.chunkSize),
      chunkOverlapMode: knowledgeBase.chunkOverlap === null ? 'inherit' : 'custom',
      chunkOverlap: knowledgeBase.chunkOverlap === null ? '' : String(knowledgeBase.chunkOverlap),
    };
  }
  // The server's default is INTERNAL; offer it when assignable, else the highest you can assign.
  const defaultClassification: Classification = assignable.includes('INTERNAL')
    ? 'INTERNAL'
    : (assignable[assignable.length - 1] ?? 'PUBLIC');
  return {
    name: '',
    description: '',
    accessMode: 'WORKSPACE',
    defaultClassification,
    chunkSizeMode: 'inherit',
    chunkSize: '',
    chunkOverlapMode: 'inherit',
    chunkOverlap: '',
  };
}

const asInteger = (value: string): number | null => {
  if (!/^\s*\d+\s*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

/** The chunk size that will actually apply: yours, else the workspace's, else the platform's. */
export function effectiveChunkSize(values: Pick<KbFormValues, 'chunkSizeMode' | 'chunkSize'>, inherited: InheritedChunking): number | null {
  if (values.chunkSizeMode === 'custom') return asInteger(values.chunkSize);
  return inherited.size ?? PLATFORM_CHUNK_SIZE;
}

/** Spec §6's client-side rules. The server checks the same, and its 422s land on the same fields. */
export function validateKbForm(
  values: KbFormValues,
  inherited: InheritedChunking,
  assignable: readonly Classification[],
): KbFormErrors {
  const errors: KbFormErrors = {};
  const name = values.name.trim();
  if (!name) errors.name = 'Give the knowledge base a name.';
  else if (name.length > NAME_MAX) errors.name = `Use no more than ${NAME_MAX} characters.`;
  if (values.description.length > DESCRIPTION_MAX) errors.description = `Use no more than ${DESCRIPTION_MAX} characters.`;
  if (!assignable.includes(values.defaultClassification)) {
    errors.defaultClassification = 'Above your clearance. Choose a classification you can assign.';
  }

  let size: number | null = null;
  if (values.chunkSizeMode === 'custom') {
    size = asInteger(values.chunkSize);
    if (size === null || size < CHUNK_SIZE_MIN || size > CHUNK_SIZE_MAX) {
      errors.chunkSize = `Use a whole number from ${CHUNK_SIZE_MIN} to ${CHUNK_SIZE_MAX}.`;
      size = null;
    }
  }
  if (values.chunkOverlapMode === 'custom') {
    const overlap = asInteger(values.chunkOverlap);
    if (overlap === null || overlap < 0 || overlap > CHUNK_OVERLAP_MAX) {
      errors.chunkOverlap = `Use a whole number from 0 to ${CHUNK_OVERLAP_MAX}.`;
    } else if (!errors.chunkSize) {
      // BF-15: against the size that will apply, including an inherited one.
      const effective = values.chunkSizeMode === 'custom' ? size : (inherited.size ?? PLATFORM_CHUNK_SIZE);
      if (effective !== null && overlap >= effective) {
        errors.chunkOverlap = `Must be smaller than the chunk size (${effective}).`;
      }
    }
  }
  return errors;
}

export function toCreateRequest(values: KbFormValues): CreateKnowledgeBaseRequest {
  const body: CreateKnowledgeBaseRequest = {
    name: values.name.trim(),
    accessMode: values.accessMode,
    defaultClassification: values.defaultClassification,
  };
  if (values.description.trim()) body.description = values.description.trim();
  if (values.chunkSizeMode === 'custom') body.chunkSize = Number(values.chunkSize);
  if (values.chunkOverlapMode === 'custom') body.chunkOverlap = Number(values.chunkOverlap);
  return body;
}

/** Only what changed (§5 "Knowledge bases"); `null` chunk settings go back to inheriting, `null` removes the description. */
export function toUpdateRequest(values: KbFormValues, knowledgeBase: KnowledgeBase): UpdateKnowledgeBaseRequest {
  const body: UpdateKnowledgeBaseRequest = {};
  const name = values.name.trim();
  if (name !== knowledgeBase.name) body.name = name;
  const description = values.description.trim();
  if (description !== (knowledgeBase.description ?? '')) body.description = description || null;
  if (values.accessMode !== knowledgeBase.accessMode) body.accessMode = values.accessMode;
  if (values.defaultClassification !== knowledgeBase.defaultClassification) body.defaultClassification = values.defaultClassification;
  const size = values.chunkSizeMode === 'custom' ? Number(values.chunkSize) : null;
  if (size !== knowledgeBase.chunkSize) body.chunkSize = size;
  const overlap = values.chunkOverlapMode === 'custom' ? Number(values.chunkOverlap) : null;
  if (overlap !== knowledgeBase.chunkOverlap) body.chunkOverlap = overlap;
  return body;
}

/** Whether a change of chunk settings means existing documents are chunked the old way. */
export const changesChunking = (body: UpdateKnowledgeBaseRequest): boolean =>
  body.chunkSize !== undefined || body.chunkOverlap !== undefined;
