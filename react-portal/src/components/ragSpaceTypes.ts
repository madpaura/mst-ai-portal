export type SpaceStatus =
  | 'pending' | 'needs_info' | 'rejected' | 'deploying' | 'deploy_failed' | 'deployed'
  | 'live' | 'stopped' | 'delete_requested' | 'deleting' | 'delete_failed' | 'deleted';

export interface ServiceHealth {
  service: string;
  state: string;
}

export interface SpaceHealth {
  healthy: boolean;
  services: ServiceHealth[];
  error?: string;
}

export interface SpaceJob {
  id: string;
  kind: string;
  label: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  created_at: string;
  started_at: string | null;
  finished_at?: string | null;
  error?: string | null;
  log?: string;
}

export interface SpaceEvent {
  event: string;
  note: string | null;
  actor_name: string | null;
  created_at: string;
}

export interface RagSpace {
  id: string;
  slug: string;
  name: string;
  plm_project: string;
  reason: string;
  status: SpaceStatus;
  review_note: string | null;
  delete_reason: string | null;
  provisioned: boolean;
  api_url: string | null;
  mgmt_url: string | null;
  owner_name: string | null;
  owner_email: string | null;
  health: SpaceHealth | null;
  health_checked_at: string | null;
  created_at: string;
  updated_at: string;
  active_job: SpaceJob | null;
  backup_path?: string | null;
  events?: SpaceEvent[];
  jobs?: SpaceJob[];
}

export interface RevealedKey {
  username: string;
  key: string;
}

export const STATUS_META: Record<SpaceStatus, { label: string; className: string }> = {
  pending: { label: 'Awaiting approval', className: 'bg-amber-500/10 text-amber-500 border-amber-500/30' },
  needs_info: { label: 'More info needed', className: 'bg-amber-500/10 text-amber-500 border-amber-500/30' },
  rejected: { label: 'Rejected', className: 'bg-rose-500/10 text-rose-500 border-rose-500/30' },
  deploying: { label: 'Deploying', className: 'bg-primary/10 text-primary border-primary/30' },
  deploy_failed: { label: 'Deploy failed', className: 'bg-rose-500/10 text-rose-500 border-rose-500/30' },
  deployed: { label: 'Awaiting verification', className: 'bg-violet-500/10 text-violet-500 border-violet-500/30' },
  live: { label: 'Live', className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' },
  stopped: { label: 'Stopped', className: 'bg-slate-500/10 text-text-muted border-border-base' },
  delete_requested: { label: 'Deletion requested', className: 'bg-amber-500/10 text-amber-500 border-amber-500/30' },
  deleting: { label: 'Deleting', className: 'bg-primary/10 text-primary border-primary/30' },
  delete_failed: { label: 'Delete failed', className: 'bg-rose-500/10 text-rose-500 border-rose-500/30' },
  deleted: { label: 'Deleted', className: 'bg-slate-500/10 text-text-muted border-border-base' },
};

export const EVENT_LABELS: Record<string, string> = {
  requested: 'Requested',
  resubmitted: 'Resubmitted',
  approved: 'Approved for deployment',
  info_requested: 'More information requested',
  rejected: 'Rejected',
  deploy_retried: 'Deployment retried',
  deploy_succeeded: 'Deployment finished',
  deploy_failed: 'Deployment failed',
  went_live: 'Final approval: live',
  redeploy_requested: 'Redeploy requested',
  redeploy_succeeded: 'Redeploy finished',
  redeploy_failed: 'Redeploy failed',
  stop_requested: 'Stop requested',
  stop_succeeded: 'Stopped',
  stop_failed: 'Stop failed',
  start_requested: 'Start requested',
  start_succeeded: 'Started',
  start_failed: 'Start failed',
  key_rotation_requested: 'Key rotation requested',
  rotate_key_succeeded: 'Access key rotated',
  rotate_key_failed: 'Key rotation failed',
  delete_requested: 'Deletion requested',
  delete_cancelled: 'Deletion request cancelled',
  delete_approved: 'Deletion approved',
  delete_denied: 'Deletion declined',
  delete_retried: 'Deletion retried',
  destroy_succeeded: 'Backed up and deleted',
  destroy_failed: 'Deletion failed',
  teardown_succeeded: 'Deployment removed',
  teardown_failed: 'Removing deployment failed',
  cleanup_retried: 'Cleanup retried',
  deleted_by_owner: 'Deleted by owner',
  force_removed: 'Record removed by admin',
};

export const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString() : '—';
