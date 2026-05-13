import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api/client';

const API_BASE = import.meta.env.VITE_API_URL || '';
const mediaUrl = (url: string | null | undefined) =>
  url ? (url.startsWith('/') ? `${API_BASE}${url}` : url) : '';

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

interface PendingUpload {
  uid: string;
  file: File;
  objectUrl: string;
  imageUrl: string | null;
  linkUrl: string;
  uploading: boolean;
  error: string | null;
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

  // Inline link edit
  const [editingMemeId, setEditingMemeId] = useState<string | null>(null);
  const [editLinkUrl, setEditLinkUrl] = useState('');

  // Bulk upload
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setPendingUploads([]);
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
      if (selectedGroup?.id === g.id) { setSelectedGroup(null); setMemes([]); setPendingUploads([]); }
      await fetchGroups();
    } finally {
      setSaving(false);
    }
  };

  const openEditLink = (meme: Meme) => {
    setEditingMemeId(meme.id);
    setEditLinkUrl(meme.link_url || '');
  };

  const saveEditLink = async (meme: Meme) => {
    if (editingMemeId !== meme.id) return;
    setEditingMemeId(null);
    const newUrl = editLinkUrl.trim() || null;
    if (newUrl === meme.link_url) return;
    try {
      await api.put(`/admin/memes/memes/${meme.id}`, { link_url: newUrl });
      setMemes((prev) => prev.map((m) => m.id === meme.id ? { ...m, link_url: newUrl } : m));
    } catch { /* ignore */ }
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

  // Upload a single file and update state
  const uploadOne = useCallback(async (uid: string, file: File, groupId: string) => {
    const formData = new FormData();
    formData.append('files', file);
    try {
      const results = await api.post<{ image_url?: string; error?: string }[]>(
        `/admin/memes/groups/${groupId}/upload`,
        formData,
      );
      const result = results[0];
      setPendingUploads((prev) =>
        prev.map((p) =>
          p.uid === uid
            ? { ...p, uploading: false, imageUrl: result.image_url ?? null, error: result.error ?? null }
            : p,
        ),
      );
    } catch {
      setPendingUploads((prev) =>
        prev.map((p) => (p.uid === uid ? { ...p, uploading: false, error: 'Upload failed' } : p)),
      );
    }
  }, []);

  const addFiles = useCallback(
    (files: File[]) => {
      if (!selectedGroup) return;
      const imageFiles = files.filter((f) => f.type.startsWith('image/'));
      if (!imageFiles.length) return;

      const newItems: PendingUpload[] = imageFiles.map((file) => ({
        uid: crypto.randomUUID(),
        file,
        objectUrl: URL.createObjectURL(file),
        imageUrl: null,
        linkUrl: '',
        uploading: true,
        error: null,
      }));

      setPendingUploads((prev) => [...prev, ...newItems]);

      // Upload all immediately in parallel
      newItems.forEach((item) => uploadOne(item.uid, item.file, selectedGroup.id));
    },
    [selectedGroup, uploadOne],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      addFiles(Array.from(e.dataTransfer.files));
    },
    [addFiles],
  );

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files));
    e.target.value = '';
  };

  const removePending = (uid: string) => {
    setPendingUploads((prev) => {
      const item = prev.find((p) => p.uid === uid);
      if (item) URL.revokeObjectURL(item.objectUrl);
      return prev.filter((p) => p.uid !== uid);
    });
  };

  const saveAll = async () => {
    if (!selectedGroup) return;
    const ready = pendingUploads.filter((p) => p.imageUrl && !p.uploading && !p.error);
    if (!ready.length) return;
    setSaving(true);
    try {
      const baseOrder = memes.length;
      await Promise.all(
        ready.map((p, i) =>
          api.post(`/admin/memes/groups/${selectedGroup.id}/memes`, {
            title: null,
            image_url: p.imageUrl,
            link_url: p.linkUrl.trim() || null,
            sort_order: baseOrder + i,
          }),
        ),
      );
      // Cleanup object URLs
      pendingUploads.forEach((p) => URL.revokeObjectURL(p.objectUrl));
      setPendingUploads([]);
      await fetchMemes(selectedGroup);
      await fetchGroups();
    } finally {
      setSaving(false);
    }
  };

  const uploadingCount = pendingUploads.filter((p) => p.uploading).length;
  const readyCount = pendingUploads.filter((p) => p.imageUrl && !p.uploading).length;

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
              <p className="text-center text-sm text-slate-500 dark:text-slate-400 py-8">No groups yet.</p>
            ) : (
              groups.map((g) => (
                <div
                  key={g.id}
                  onClick={() => selectGroup(g)}
                  className={`group flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-slate-100 dark:border-white/5 ${
                    selectedGroup?.id === g.id ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-slate-100 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-slate-200 dark:bg-slate-700">
                    {g.thumbnail ? (
                      <img src={mediaUrl(g.thumbnail)} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="material-symbols-outlined text-slate-400 text-sm">image</span>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-white truncate">{g.title}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">{g.category} · {g.meme_count} images</p>
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

      {/* Right panel */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedGroup ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <span className="material-symbols-outlined text-5xl text-slate-300 dark:text-slate-700 mb-3">collections</span>
            <p className="text-slate-500 dark:text-slate-400">Select a meme group to manage its images.</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">{selectedGroup.title}</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">{selectedGroup.category} · {selectedGroup.meme_count} images</p>
              </div>
              <button
                onClick={() => openEditGroup(selectedGroup)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded-lg hover:border-primary hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-sm">edit</span>
                Edit Group
              </button>
            </div>

            {/* Drop zone */}
            <div
              onDrop={onDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
              className={`mb-6 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-2 py-8 cursor-pointer transition-all ${
                dragOver
                  ? 'border-primary bg-primary/5 scale-[1.01]'
                  : 'border-slate-200 dark:border-white/10 hover:border-primary/50 hover:bg-slate-50 dark:hover:bg-slate-900/50'
              }`}
            >
              <span className="material-symbols-outlined text-3xl text-slate-400" style={{ fontVariationSettings: "'FILL' 1" }}>add_photo_alternate</span>
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Drop images here or click to pick</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">JPG, PNG, GIF, WebP · up to 20 MB each · multiple files at once</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={onFileInput}
              />
            </div>

            {/* Pending uploads: thumbnails + link inputs */}
            {pendingUploads.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    {uploadingCount > 0 ? `Uploading ${uploadingCount}…` : `${readyCount} ready`}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        pendingUploads.forEach((p) => URL.revokeObjectURL(p.objectUrl));
                        setPendingUploads([]);
                      }}
                      className="text-xs text-slate-500 dark:text-slate-400 hover:text-red-400 transition-colors"
                    >
                      Clear all
                    </button>
                    <button
                      onClick={saveAll}
                      disabled={saving || readyCount === 0 || uploadingCount > 0}
                      className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors"
                    >
                      {saving ? (
                        <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                      ) : (
                        <span className="material-symbols-outlined text-sm">save</span>
                      )}
                      Save {readyCount} {readyCount === 1 ? 'image' : 'images'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {pendingUploads.map((p) => (
                    <div key={p.uid} className="relative flex flex-col gap-1.5">
                      {/* Thumbnail */}
                      <div className="relative aspect-square rounded-xl overflow-hidden bg-panel-light dark:bg-input-dark border border-slate-200 dark:border-white/10">
                        <img src={p.objectUrl} alt="" className="w-full h-full object-cover" />
                        {p.uploading && (
                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                            <span className="material-symbols-outlined text-white text-xl animate-spin">progress_activity</span>
                          </div>
                        )}
                        {p.error && (
                          <div className="absolute inset-0 bg-red-900/60 flex items-center justify-center p-2">
                            <span className="text-[10px] text-white text-center">{p.error}</span>
                          </div>
                        )}
                        {!p.uploading && !p.error && (
                          <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center">
                            <span className="material-symbols-outlined text-white text-[10px]" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
                          </div>
                        )}
                        <button
                          onClick={() => removePending(p.uid)}
                          className="absolute top-1 left-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[11px]">close</span>
                        </button>
                      </div>
                      {/* Link URL input */}
                      <input
                        type="url"
                        placeholder="Link URL (optional)"
                        value={p.linkUrl}
                        onChange={(e) =>
                          setPendingUploads((prev) =>
                            prev.map((x) => (x.uid === p.uid ? { ...x, linkUrl: e.target.value } : x)),
                          )
                        }
                        className="w-full bg-input-light dark:bg-input-dark border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1 text-[10px] text-slate-700 dark:text-slate-300 placeholder-slate-400 focus:ring-1 focus:ring-primary focus:border-primary"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Existing memes */}
            {memesLoading ? (
              <div className="flex items-center justify-center h-32">
                <span className="material-symbols-outlined text-2xl text-slate-400 animate-spin">progress_activity</span>
              </div>
            ) : memes.length === 0 && pendingUploads.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-sm text-slate-500 dark:text-slate-400">No images yet — drop some above.</p>
              </div>
            ) : memes.length > 0 ? (
              <>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Saved images</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {memes.map((meme, i) => (
                    <div key={meme.id} className="group relative rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900">
                      <div className="aspect-square overflow-hidden bg-panel-light dark:bg-input-dark">
                        <img src={mediaUrl(meme.image_url)} alt={meme.title || ''} className="w-full h-full object-cover" />
                      </div>
                      <div className="p-2">
                        {editingMemeId === meme.id ? (
                          <input
                            autoFocus
                            type="url"
                            value={editLinkUrl}
                            onChange={(e) => setEditLinkUrl(e.target.value)}
                            onBlur={() => saveEditLink(meme)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveEditLink(meme); if (e.key === 'Escape') setEditingMemeId(null); }}
                            placeholder="https://..."
                            className="w-full bg-input-light dark:bg-input-dark border border-primary rounded px-1.5 py-0.5 text-[10px] text-slate-700 dark:text-slate-200 focus:outline-none"
                          />
                        ) : (
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400">#{i + 1}</span>
                            <button
                              onClick={() => openEditLink(meme)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-slate-400 hover:text-primary"
                              title="Edit link URL"
                            >
                              <span className="material-symbols-outlined text-[12px]">edit</span>
                            </button>
                            {meme.link_url && (
                              <a href={meme.link_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary truncate hover:underline ml-auto" title={meme.link_url}>
                                <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                              </a>
                            )}
                          </div>
                        )}
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
              </>
            ) : null}
          </>
        )}
      </div>

      {/* Group form modal */}
      {showGroupForm && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-input-light dark:bg-input-dark rounded-2xl border border-slate-200 dark:border-white/10 p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-5">
              {editingGroup ? 'Edit Group' : 'Create Meme Group'}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Title *</label>
                <input
                  className="w-full bg-input-light dark:bg-input-dark border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:ring-1 focus:ring-primary focus:border-primary"
                  placeholder="Monday Mood"
                  value={groupForm.title}
                  onChange={(e) => setGroupForm({ ...groupForm, title: e.target.value, slug: editingGroup ? groupForm.slug : slugify(e.target.value) })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Slug *</label>
                <input
                  className="w-full bg-input-light dark:bg-input-dark border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-slate-900 dark:text-white focus:ring-1 focus:ring-primary focus:border-primary"
                  placeholder="monday-mood"
                  value={groupForm.slug}
                  onChange={(e) => setGroupForm({ ...groupForm, slug: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Category</label>
                <select
                  className="w-full bg-input-light dark:bg-input-dark border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:ring-1 focus:ring-primary focus:border-primary"
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
                  className="w-full bg-input-light dark:bg-input-dark border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:ring-1 focus:ring-primary focus:border-primary"
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
