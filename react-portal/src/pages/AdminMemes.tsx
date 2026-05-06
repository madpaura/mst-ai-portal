import React, { useState, useEffect } from 'react';
import { api } from '../api/client';

interface Meme {
  id: string;
  group_id: string;
  title: string | null;
  image_url: string;
  link_url: string | null;
  sort_order: number;
}

interface MemeGroup {
  id: string;
  title: string;
  slug: string;
  category: string;
  sort_order: number;
  meme_count: number;
  thumbnail: string | null;
}

const CATEGORIES = ['General', 'AI Humor', 'Tech Life', 'Monday Mood', 'Deep Thoughts', 'Other'];

export const AdminMemes: React.FC = () => {
  const [groups, setGroups] = useState<MemeGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<MemeGroup | null>(null);
  const [memes, setMemes] = useState<Meme[]>([]);
  const [loading, setLoading] = useState(true);
  const [memesLoading, setMemesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Group form
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<MemeGroup | null>(null);
  const [groupForm, setGroupForm] = useState({ title: '', slug: '', category: 'General', sort_order: 0 });

  // Meme form
  const [showMemeForm, setShowMemeForm] = useState(false);
  const [memeForm, setMemeForm] = useState({ title: '', image_url: '', link_url: '', sort_order: 0 });

  const fetchGroups = async () => {
    try {
      const data = await api.get<MemeGroup[]>('/admin/memes/groups');
      setGroups(data);
    } finally {
      setLoading(false);
    }
  };

  const fetchMemes = async (group: MemeGroup) => {
    setMemesLoading(true);
    try {
      const data = await api.get<Meme[]>(`/admin/memes/groups/${group.id}/memes`);
      setMemes(data);
    } finally {
      setMemesLoading(false);
    }
  };

  useEffect(() => { fetchGroups(); }, []);

  const selectGroup = (g: MemeGroup) => {
    setSelectedGroup(g);
    fetchMemes(g);
    setShowMemeForm(false);
  };

  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  // Group CRUD
  const openCreateGroup = () => {
    setEditingGroup(null);
    setGroupForm({ title: '', slug: '', category: 'General', sort_order: groups.length });
    setShowGroupForm(true);
    setError('');
  };

  const openEditGroup = (g: MemeGroup) => {
    setEditingGroup(g);
    setGroupForm({ title: g.title, slug: g.slug, category: g.category, sort_order: g.sort_order });
    setShowGroupForm(true);
    setError('');
  };

  const saveGroup = async () => {
    if (!groupForm.title.trim() || !groupForm.slug.trim()) { setError('Title and slug are required.'); return; }
    setSaving(true); setError('');
    try {
      if (editingGroup) {
        await api.put(`/admin/memes/groups/${editingGroup.id}`, groupForm);
      } else {
        await api.post('/admin/memes/groups', groupForm);
      }
      await fetchGroups();
      setShowGroupForm(false);
    } catch (e: any) {
      setError(e?.message || 'Failed to save group.');
    } finally {
      setSaving(false);
    }
  };

  const deleteGroup = async (g: MemeGroup) => {
    if (!confirm(`Delete "${g.title}" and all its memes?`)) return;
    setSaving(true);
    try {
      await api.delete(`/admin/memes/groups/${g.id}`);
      if (selectedGroup?.id === g.id) { setSelectedGroup(null); setMemes([]); }
      await fetchGroups();
    } finally {
      setSaving(false);
    }
  };

  // Meme CRUD
  const openAddMeme = () => {
    setMemeForm({ title: '', image_url: '', link_url: '', sort_order: memes.length });
    setShowMemeForm(true);
    setError('');
  };

  const saveMeme = async () => {
    if (!memeForm.image_url.trim()) { setError('Image URL is required.'); return; }
    if (!selectedGroup) return;
    setSaving(true); setError('');
    try {
      await api.post(`/admin/memes/groups/${selectedGroup.id}/memes`, {
        title: memeForm.title || null,
        image_url: memeForm.image_url,
        link_url: memeForm.link_url || null,
        sort_order: memeForm.sort_order,
      });
      await fetchMemes(selectedGroup);
      await fetchGroups();
      setShowMemeForm(false);
      setMemeForm({ title: '', image_url: '', link_url: '', sort_order: memes.length + 1 });
    } catch (e: any) {
      setError(e?.message || 'Failed to add meme.');
    } finally {
      setSaving(false);
    }
  };

  const deleteMeme = async (meme: Meme) => {
    if (!confirm('Delete this meme?')) return;
    setSaving(true);
    try {
      await api.delete(`/admin/memes/memes/${meme.id}`);
      if (selectedGroup) {
        await fetchMemes(selectedGroup);
        await fetchGroups();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full">
      {/* Left panel: groups */}
      <div className="w-72 shrink-0 border-r border-slate-200 dark:border-white/10 flex flex-col bg-sidebar-light dark:bg-sidebar-dark">
        <div className="p-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
          <h2 className="font-bold text-sm text-slate-800 dark:text-white">Meme Groups</h2>
          <button
            onClick={openCreateGroup}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            New
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center flex-1">
            <span className="material-symbols-outlined text-2xl text-slate-400 animate-spin">progress_activity</span>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {groups.length === 0 ? (
              <p className="text-center text-sm text-slate-400 py-8">No groups yet.</p>
            ) : (
              groups.map((g) => (
                <div
                  key={g.id}
                  onClick={() => selectGroup(g)}
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-slate-100 dark:border-white/5 ${
                    selectedGroup?.id === g.id ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-slate-100 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-slate-200 dark:bg-slate-700">
                    {g.thumbnail ? (
                      <img src={g.thumbnail} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="material-symbols-outlined text-slate-400 text-sm">image</span>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-white truncate">{g.title}</p>
                    <p className="text-[10px] text-slate-400">{g.category} · {g.meme_count} images</p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => openEditGroup(g)} className="p-1 text-slate-400 hover:text-primary transition-colors">
                      <span className="material-symbols-outlined text-sm">edit</span>
                    </button>
                    <button onClick={() => deleteGroup(g)} className="p-1 text-slate-400 hover:text-red-400 transition-colors">
                      <span className="material-symbols-outlined text-sm">delete</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Right panel: memes in selected group */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedGroup ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <span className="material-symbols-outlined text-5xl text-slate-300 dark:text-slate-700 mb-3">collections</span>
            <p className="text-slate-500 dark:text-slate-400">Select a meme group to manage its images.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">{selectedGroup.title}</h2>
                <p className="text-xs text-slate-400">{selectedGroup.category} · {selectedGroup.meme_count} images</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openEditGroup(selectedGroup)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded-lg hover:border-primary hover:text-primary transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">edit</span>
                  Edit Group
                </button>
                <button
                  onClick={openAddMeme}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">add_photo_alternate</span>
                  Add Image
                </button>
              </div>
            </div>

            {/* Add meme form */}
            {showMemeForm && (
              <div className="mb-6 p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900/50">
                <h3 className="text-sm font-bold text-slate-800 dark:text-white mb-4">Add Image</h3>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-500 mb-1">Image URL *</label>
                    <input
                      className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:ring-1 focus:ring-primary focus:border-primary"
                      placeholder="https://example.com/meme.jpg"
                      value={memeForm.image_url}
                      onChange={(e) => setMemeForm({ ...memeForm, image_url: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Title (optional)</label>
                    <input
                      className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:ring-1 focus:ring-primary focus:border-primary"
                      placeholder="Caption or title"
                      value={memeForm.title}
                      onChange={(e) => setMemeForm({ ...memeForm, title: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Link URL (optional)</label>
                    <input
                      className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:ring-1 focus:ring-primary focus:border-primary"
                      placeholder="https://example.com/article"
                      value={memeForm.link_url}
                      onChange={(e) => setMemeForm({ ...memeForm, link_url: e.target.value })}
                    />
                  </div>
                </div>
                {/* Preview */}
                {memeForm.image_url && (
                  <div className="mb-4">
                    <p className="text-xs text-slate-500 mb-1">Preview</p>
                    <img src={memeForm.image_url} alt="preview" className="max-h-40 rounded-lg border border-slate-200 dark:border-white/10 object-contain" />
                  </div>
                )}
                {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
                <div className="flex gap-2">
                  <button onClick={saveMeme} disabled={saving} className="px-4 py-1.5 text-xs font-bold bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors">
                    {saving ? 'Saving…' : 'Add Image'}
                  </button>
                  <button onClick={() => setShowMemeForm(false)} className="px-4 py-1.5 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Meme grid */}
            {memesLoading ? (
              <div className="flex items-center justify-center h-32">
                <span className="material-symbols-outlined text-2xl text-slate-400 animate-spin">progress_activity</span>
              </div>
            ) : memes.length === 0 ? (
              <div className="text-center py-16 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-2xl">
                <span className="material-symbols-outlined text-4xl text-slate-300 dark:text-slate-700 block mb-2">add_photo_alternate</span>
                <p className="text-sm text-slate-500">No images yet. Add one above.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {memes.map((meme, i) => (
                  <div key={meme.id} className="group relative rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900">
                    <div className="aspect-square overflow-hidden bg-slate-100 dark:bg-slate-800">
                      <img src={meme.image_url} alt={meme.title || ''} className="w-full h-full object-cover" />
                    </div>
                    <div className="p-2">
                      {meme.title && <p className="text-[10px] text-slate-600 dark:text-slate-300 truncate">{meme.title}</p>}
                      {meme.link_url && (
                        <a href={meme.link_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary truncate block hover:underline">
                          {meme.link_url}
                        </a>
                      )}
                      <p className="text-[10px] text-slate-400">#{i + 1}</p>
                    </div>
                    <button
                      onClick={() => deleteMeme(meme)}
                      className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-red-500/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                    >
                      <span className="material-symbols-outlined text-[12px]">close</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Group form modal */}
      {showGroupForm && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-white/10 p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-5">
              {editingGroup ? 'Edit Group' : 'Create Meme Group'}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Title *</label>
                <input
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:ring-1 focus:ring-primary focus:border-primary"
                  placeholder="Monday Mood"
                  value={groupForm.title}
                  onChange={(e) => setGroupForm({ ...groupForm, title: e.target.value, slug: editingGroup ? groupForm.slug : slugify(e.target.value) })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Slug *</label>
                <input
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-slate-900 dark:text-white focus:ring-1 focus:ring-primary focus:border-primary"
                  placeholder="monday-mood"
                  value={groupForm.slug}
                  onChange={(e) => setGroupForm({ ...groupForm, slug: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Category</label>
                <select
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:ring-1 focus:ring-primary focus:border-primary"
                  value={groupForm.category}
                  onChange={(e) => setGroupForm({ ...groupForm, category: e.target.value })}
                >
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Sort Order</label>
                <input
                  type="number"
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:ring-1 focus:ring-primary focus:border-primary"
                  value={groupForm.sort_order}
                  onChange={(e) => setGroupForm({ ...groupForm, sort_order: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
            {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
            <div className="flex gap-3 mt-6">
              <button onClick={saveGroup} disabled={saving} className="flex-1 py-2 text-sm font-bold bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {saving ? 'Saving…' : (editingGroup ? 'Save Changes' : 'Create Group')}
              </button>
              <button onClick={() => setShowGroupForm(false)} className="px-4 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
