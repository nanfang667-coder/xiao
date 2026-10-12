export type ImportActionState = {
  error?: string;
  deletedDraftIds?: number[];
  deletedJobId?: string;
  updatedDraftIds?: number[];
  submissionId?: number;
  submitted?: boolean;
  message?: string;
  jobId?: string;
  version?: number;
  teacherId?: number;
  imageOriginCheck?: ImportImageOriginCheck;
  imageOriginsSaved?: { sourceId: number; listUrl: string };
};

export type ImportProgress = {
  total: number;
  queued: number;
  processing: number;
  imported: number;
  skipped: number;
  failed: number;
  done: boolean;
  failures?: { code: string; count: number }[];
  error?: string;
};

export type ImportImageOriginCheck = {
  sourceId: number;
  listUrl: string;
  origins: string[];
  sampled: number;
  failed: number;
  photoCount: number;
};
