import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

interface AuditEntry {
  id: string;
  ts: string;
  admin_id: string | null;
  admin_name: string | null;
  username: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  request_id: string | null;
}

interface AuditResponse {
  total: number;
  items: AuditEntry[];
}

const ACTION_COLOR: Record<string, string> = {
  'user.create': 'text-green-400 bg-green-400/10 border-green-400/20',
  'user.delete': 'text-red-400 bg-red-400/10 border-red-400/20',
  'user.role_change': 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  'user.password_reset': 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  'contribute_request.approved': 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  'contribute_request.rejected': 'text-rose-400 bg-rose-400/10 border-rose-400/20',
};

const actionBadge = (action: string) => {
  const cls = ACTION_COLOR[action] ?? 'text-slate-400 bg-slate-400/10 border-slate-400/20';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium border ${cls}`}>
      {action}
    </span>
  );
};

const PAGE_SIZE = 50;

export const AdminAuditLog: React.FC = () => {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [filterAction, setFilterAction] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async (p: number, action: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(p * PAGE_SIZE),
      });
      if (action) params.set('action', action);
      const data = await api.get<AuditResponse>(`/auth/admin/audit-log?${params}`);
      setEntries(data.items);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(page, filterAction); }, [load, page, filterAction]);

  const handleFilter = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPage(0);
    load(0, filterAction);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Audit Log</h1>
          <p className="text-slate-400 text-sm mt-1">All privileged admin actions — {total} total entries</p>
        </div>
        <form onSubmit={handleFilter} className="flex items-center gap-2">
          <input
            value={filterAction}
            onChange={e => setFilterAction(e.target.value)}
            placeholder="Filter by action…"
            className="px-3 py-1.5 text-sm rounded-lg bg-slate-800 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-primary w-52"
          />
          <button
            type="submit"
            className="px-3 py-1.5 text-sm bg-primary/10 text-primary border border-primary/20 rounded-lg hover:bg-primary/20 transition-colors"
          >
            Filter
          </button>
          {filterAction && (
            <button
              type="button"
              onClick={() => { setFilterAction(''); setPage(0); }}
              className="px-3 py-1.5 text-sm text-slate-400 hover:text-white transition-colors"
            >
              Clear
            </button>
          )}
        </form>
      </div>

      <div className="bg-slate-900/50 rounded-xl border border-white/10 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <span className="material-symbols-outlined animate-spin mr-2">autorenew</span>
            Loading…
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500 space-y-2">
            <span className="material-symbols-outlined text-4xl">manage_search</span>
            <p>No audit entries found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3 text-left font-medium">Timestamp</th>
                <th className="px-4 py-3 text-left font-medium">Admin</th>
                <th className="px-4 py-3 text-left font-medium">Action</th>
                <th className="px-4 py-3 text-left font-medium">Target</th>
                <th className="px-4 py-3 text-left font-medium">IP</th>
                <th className="px-4 py-3 text-left font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {entries.map(entry => (
                <React.Fragment key={entry.id}>
                  <tr
                    className="hover:bg-white/5 transition-colors cursor-pointer"
                    onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                  >
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap font-mono text-xs">
                      {new Date(entry.ts).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{entry.admin_name || '—'}</div>
                      {entry.username && (
                        <div className="text-xs text-slate-500">@{entry.username}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">{actionBadge(entry.action)}</td>
                    <td className="px-4 py-3 text-slate-400">
                      {entry.target_type && (
                        <span className="text-slate-300">{entry.target_type}</span>
                      )}
                      {entry.target_id && (
                        <div className="font-mono text-xs text-slate-500 truncate max-w-32" title={entry.target_id}>
                          {entry.target_id}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {entry.ip_address || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button className="text-slate-500 hover:text-slate-300 transition-colors">
                        <span className="material-symbols-outlined text-sm">
                          {expandedId === entry.id ? 'expand_less' : 'expand_more'}
                        </span>
                      </button>
                    </td>
                  </tr>
                  {expandedId === entry.id && (
                    <tr className="bg-slate-800/30">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="space-y-2">
                          {Object.keys(entry.details).length > 0 && (
                            <div>
                              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Details</div>
                              <pre className="text-xs text-slate-300 bg-slate-900 rounded p-3 overflow-x-auto">
                                {JSON.stringify(entry.details, null, 2)}
                              </pre>
                            </div>
                          )}
                          {entry.request_id && (
                            <div className="text-xs text-slate-500">
                              Request ID: <span className="font-mono text-slate-400">{entry.request_id}</span>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>Page {page + 1} of {totalPages} ({total} entries)</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => p - 1)}
              disabled={page === 0}
              className="px-3 py-1.5 rounded-lg border border-white/10 disabled:opacity-40 hover:bg-white/5 transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 rounded-lg border border-white/10 disabled:opacity-40 hover:bg-white/5 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
