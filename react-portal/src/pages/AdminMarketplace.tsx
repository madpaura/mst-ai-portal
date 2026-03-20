import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

interface ForgeComponent {
  id: string;
  slug: string;
  name: string;
  component_type: string;
  description: string | null;
  long_description: string | null;
  icon: string | null;
  icon_color: string | null;
  version: string;
  install_command: string;
  badge: string | null;
  author: string | null;
  downloads: number;
  tags: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface FormData {
  slug: string;
  name: string;
  component_type: string;
  description: string;
  long_description: string;
  icon: string;
  icon_color: string;
  version: string;
  install_command: string;
  badge: string;
  author: string;
  tags: string;
}

const EMPTY_FORM: FormData = {
  slug: '', name: '', component_type: 'agent', description: '',
  long_description: '', icon: 'smart_toy', icon_color: 'text-primary',
  version: 'v1.0.0', install_command: '', badge: '', author: '', tags: '',
};

const ICON_OPTIONS = [
  'smart_toy', 'architecture', 'psychology', 'sync_alt', 'auto_timer',
  'energy_savings_leaf', 'description', 'terminal', 'memory', 'hub',
  'integration_instructions', 'developer_board', 'code', 'bug_report',
];

const COLOR_OPTIONS = [
  { label: 'Blue', value: 'text-primary' },
  { label: 'Amber', value: 'text-amber-500' },
  { label: 'Purple', value: 'text-purple-500' },
  { label: 'Rose', value: 'text-rose-500' },
  { label: 'Cyan', value: 'text-cyan-500' },
  { label: 'Indigo', value: 'text-indigo-500' },
  { label: 'Green', value: 'text-green-500' },
];

export const AdminMarketplace: React.FC = () => {
  const [components, setComponents] = useState<ForgeComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('');

  const [editing, setEditing] = useState<ForgeComponent | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);

  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const fetchComponents = useCallback(async () => {
    try {
      const data = await api.get<ForgeComponent[]>('/admin/forge/components');
      setComponents(data);
    } catch (err: any) {
      showMsg('error', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchComponents();
  }, [fetchComponents]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setCreating(true);
  };

  const openEdit = (comp: ForgeComponent) => {
    setCreating(false);
    setEditing(comp);
    setForm({
      slug: comp.slug,
      name: comp.name,
      component_type: comp.component_type,
      description: comp.description || '',
      long_description: comp.long_description || '',
      icon: comp.icon || 'smart_toy',
      icon_color: comp.icon_color || 'text-primary',
      version: comp.version,
      install_command: comp.install_command,
      badge: comp.badge || '',
      author: comp.author || '',
      tags: comp.tags.join(', '),
    });
  };

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = async () => {
    const payload = {
      ...form,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      badge: form.badge || null,
      description: form.description || null,
      long_description: form.long_description || null,
    };

    try {
      if (creating) {
        await api.post('/admin/forge/components', payload);
        showMsg('success', 'Component created');
      } else if (editing) {
        await api.put(`/admin/forge/components/${editing.id}`, payload);
        showMsg('success', 'Component updated');
      }
      closeForm();
      await fetchComponents();
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleToggleActive = async (comp: ForgeComponent) => {
    try {
      if (comp.is_active) {
        await api.post(`/admin/forge/components/${comp.id}/deactivate`);
        showMsg('success', `${comp.name} deactivated`);
      } else {
        await api.post(`/admin/forge/components/${comp.id}/activate`);
        showMsg('success', `${comp.name} activated`);
      }
      await fetchComponents();
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const handleDelete = async (comp: ForgeComponent) => {
    if (!confirm(`Permanently delete "${comp.name}" from the registry? This cannot be undone.`)) return;
    try {
      await api.delete(`/admin/forge/components/${comp.id}`);
      await fetchComponents();
      showMsg('success', 'Component deleted');
    } catch (err: any) {
      showMsg('error', err.message);
    }
  };

  const filteredComponents = components.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.slug.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = !filterType || c.component_type === filterType;
    return matchesSearch && matchesType;
  });

  const typeBadge = (type: string) => {
    const colors: Record<string, string> = {
      agent: 'bg-primary/20 text-primary border-primary/30',
      skill: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      mcp_server: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    };
    const labels: Record<string, string> = { agent: 'Agent', skill: 'Skill', mcp_server: 'MCP Server' };
    return (
      <span className={`px-2 py-0.5 text-[10px] font-bold rounded border ${colors[type] || 'bg-slate-700 text-slate-400'}`}>
        {labels[type] || type}
      </span>
    );
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-slate-400 p-20">Loading marketplace...</div>;
  }

  const showForm = creating || editing;

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      {/* Toast */}
      {message && (
        <div className={`fixed top-20 right-6 z-50 px-4 py-3 rounded-lg text-sm font-medium shadow-xl border ${
          message.type === 'success' ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-red-500/10 text-red-400 border-red-500/30'
        }`}>
          {message.text}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Marketplace Catalog</h1>
          <p className="text-sm text-slate-400 mt-1">{components.length} component(s) in catalog</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
          <span className="material-symbols-outlined text-sm">add</span>
          Add Component
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <input
          type="text"
          placeholder="Search components..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 max-w-sm px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder-slate-500 focus:border-primary outline-none"
        />
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:border-primary outline-none"
        >
          <option value="">All Types</option>
          <option value="agent">Agents</option>
          <option value="skill">Skills</option>
          <option value="mcp_server">MCP Servers</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-card-light dark:bg-card-dark rounded-xl border border-slate-200 dark:border-white/5 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200 dark:border-white/10 text-xs font-bold text-slate-400 uppercase tracking-wider">
              <th className="text-left px-4 py-3">Component</th>
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-left px-4 py-3">Version</th>
              <th className="text-left px-4 py-3">Badge</th>
              <th className="text-left px-4 py-3">Downloads</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredComponents.map((comp) => (
              <tr key={comp.id} className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-white/10 flex items-center justify-center">
                      <span className={`material-symbols-outlined text-base ${comp.icon_color || 'text-primary'}`}>
                        {comp.icon || 'smart_toy'}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{comp.name}</p>
                      <p className="text-[10px] text-slate-500 font-mono">{comp.slug}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">{typeBadge(comp.component_type)}</td>
                <td className="px-4 py-3 text-xs text-slate-300 font-mono">{comp.version}</td>
                <td className="px-4 py-3">
                  {comp.badge ? (
                    <span className="px-2 py-0.5 text-[10px] rounded bg-green-500/20 text-green-400 border border-green-500/30 capitalize">
                      {comp.badge}
                    </span>
                  ) : (
                    <span className="text-slate-600 text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">{comp.downloads}</td>
                <td className="px-4 py-3">
                  {comp.is_active ? (
                    <span className="px-2 py-0.5 text-[10px] rounded bg-green-500/10 text-green-400">Active</span>
                  ) : (
                    <span className="px-2 py-0.5 text-[10px] rounded bg-slate-700 text-slate-400">Inactive</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => openEdit(comp)} className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
                      <span className="material-symbols-outlined text-sm">edit</span>
                    </button>
                    <button onClick={() => handleToggleActive(comp)} className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
                      <span className="material-symbols-outlined text-sm">{comp.is_active ? 'visibility_off' : 'visibility'}</span>
                    </button>
                    <button onClick={() => handleDelete(comp)} className="p-1.5 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors">
                      <span className="material-symbols-outlined text-sm">delete</span>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredComponents.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">No components found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Slide-out Edit / Create Form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={closeForm} />
          <div className="relative w-full max-w-lg bg-background-dark border-l border-white/10 overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {creating ? 'New Component' : `Edit: ${editing?.name}`}
              </h2>
              <button onClick={closeForm} className="text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Name</label>
                  <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Slug</label>
                  <input value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                    disabled={!!editing}
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none disabled:opacity-50" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Type</label>
                  <select value={form.component_type} onChange={(e) => setForm((f) => ({ ...f, component_type: e.target.value }))}
                    disabled={!!editing}
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none disabled:opacity-50">
                    <option value="agent">Agent</option>
                    <option value="skill">Skill</option>
                    <option value="mcp_server">MCP Server</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Version</label>
                  <input value={form.version} onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Description</label>
                <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2} className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none resize-none" />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Long Description (Markdown)</label>
                <textarea value={form.long_description} onChange={(e) => setForm((f) => ({ ...f, long_description: e.target.value }))}
                  rows={5} className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none resize-none font-mono" />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Install Command</label>
                <input value={form.install_command} onChange={(e) => setForm((f) => ({ ...f, install_command: e.target.value }))}
                  placeholder="forge install my-agent"
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none font-mono" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Icon</label>
                  <div className="flex flex-wrap gap-1.5">
                    {ICON_OPTIONS.map((icon) => (
                      <button
                        key={icon}
                        onClick={() => setForm((f) => ({ ...f, icon }))}
                        className={`w-8 h-8 rounded flex items-center justify-center transition-all ${
                          form.icon === icon ? 'bg-primary/20 border border-primary/50 ring-1 ring-primary/30' : 'bg-slate-800 border border-white/5 hover:border-white/20'
                        }`}
                      >
                        <span className={`material-symbols-outlined text-sm ${form.icon === icon ? 'text-primary' : 'text-slate-400'}`}>{icon}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Icon Color</label>
                  <select value={form.icon_color} onChange={(e) => setForm((f) => ({ ...f, icon_color: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none">
                    {COLOR_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Badge</label>
                  <select value={form.badge} onChange={(e) => setForm((f) => ({ ...f, badge: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none">
                    <option value="">None</option>
                    <option value="verified">Verified</option>
                    <option value="community">Community</option>
                    <option value="open_source">Open Source</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Author</label>
                  <input value={form.author} onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Tags (comma-separated)</label>
                <input value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                  placeholder="verification, systemverilog, uvm"
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-200 dark:border-white/10">
                <button onClick={handleSave} className="flex-1 px-6 py-2.5 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
                  {creating ? 'Create Component' : 'Save Changes'}
                </button>
                <button onClick={closeForm} className="px-6 py-2.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm rounded-lg transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
