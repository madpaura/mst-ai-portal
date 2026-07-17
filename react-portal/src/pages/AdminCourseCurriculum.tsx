import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, toApiError } from '../api/client';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface Course {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  level: string | null;
  tags: string[];
  cover_image: string | null;
  objectives: string[];
  prerequisites: string | null;
  curriculum_published: boolean;
}

interface CurriculumItem {
  id: string;
  module_id: string;
  item_type: 'video' | 'exercise' | 'reading' | 'link';
  title: string;
  description: string | null;
  duration_min: number;
  video_id: string | null;
  video_slug: string | null;
  video_title: string | null;
  external_url: string | null;
  sort_order: number;
}

interface CurriculumModule {
  id: string;
  course_id: string;
  week_number: number;
  title: string;
  summary: string | null;
  sort_order: number;
  total_duration_min: number;
  items: CurriculumItem[];
}

interface Curriculum {
  course_id: string;
  curriculum_published: boolean;
  total_duration_min: number;
  item_count: number;
  modules: CurriculumModule[];
}

interface AdminVideo {
  id: string;
  title: string;
  slug: string;
  course_id: string | null;
  duration_s: number | null;
  is_published: boolean;
  status: string;
}

interface ItemForm {
  moduleId: string;
  itemId: string | null; // null = creating
  item_type: CurriculumItem['item_type'];
  title: string;
  description: string;
  duration_min: string;
  video_id: string;
  external_url: string;
}

const TYPE_META: Record<CurriculumItem['item_type'], { label: string; icon: string; chip: string }> = {
  video:    { label: 'Video',    icon: 'play_circle',    chip: 'bg-primary/10 text-primary' },
  exercise: { label: 'Exercise', icon: 'keyboard',       chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  reading:  { label: 'Reading',  icon: 'menu_book',      chip: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' },
  link:     { label: 'Link',     icon: 'link',           chip: 'bg-teal-500/10 text-teal-600 dark:text-teal-400' },
};

const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

const fmtDuration = (min: number): string =>
  min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min} min`;

export const AdminCourseCurriculum: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();

  const [course, setCourse] = useState<Course | null>(null);
  const [curriculum, setCurriculum] = useState<Curriculum | null>(null);
  const [videos, setVideos] = useState<AdminVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Course metadata form
  const [metaOpen, setMetaOpen] = useState(false);
  const [metaForm, setMetaForm] = useState({ description: '', level: '', tags: '', objectives: '', prerequisites: '' });
  const [metaSaving, setMetaSaving] = useState(false);

  // Week / item editing state
  const [newWeekTitle, setNewWeekTitle] = useState('');
  const [addingWeek, setAddingWeek] = useState(false);
  const [weekEdit, setWeekEdit] = useState<{ id: string; title: string; summary: string } | null>(null);
  const [itemForm, setItemForm] = useState<ItemForm | null>(null);
  const [pickerAllVideos, setPickerAllVideos] = useState(false);
  const [saving, setSaving] = useState(false);

  const toast = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3500);
  };

  const loadAll = useCallback(async () => {
    if (!courseId) return;
    try {
      const [c, cur, vids] = await Promise.all([
        api.get<Course>(`/admin/courses/${courseId}`),
        api.get<Curriculum>(`/admin/courses/${courseId}/curriculum`),
        api.get<AdminVideo[]>('/admin/videos'),
      ]);
      setCourse(c);
      setCurriculum(cur);
      setVideos(vids);
      setMetaForm({
        description: c.description || '',
        level: c.level || '',
        tags: (c.tags || []).join(', '),
        objectives: (c.objectives || []).join('\n'),
        prerequisites: c.prerequisites || '',
      });
    } catch (err) {
      toast('error', toApiError(err));
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const refreshCurriculum = async () => {
    if (!courseId) return;
    setCurriculum(await api.get<Curriculum>(`/admin/courses/${courseId}/curriculum`));
  };

  // ── Course metadata ───────────────────────────────────

  const saveMeta = async () => {
    if (!courseId) return;
    setMetaSaving(true);
    try {
      const updated = await api.put<Course>(`/admin/courses/${courseId}`, {
        description: metaForm.description || null,
        level: metaForm.level || null,
        tags: metaForm.tags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean),
        objectives: metaForm.objectives.split('\n').map(o => o.trim()).filter(Boolean),
        prerequisites: metaForm.prerequisites || null,
      });
      setCourse(updated);
      toast('success', 'Course details saved');
    } catch (err) {
      toast('error', toApiError(err));
    } finally {
      setMetaSaving(false);
    }
  };

  const uploadCover = async (file: File) => {
    if (!courseId) return;
    try {
      await api.upload(`/admin/courses/${courseId}/cover`, file);
      setCourse(await api.get<Course>(`/admin/courses/${courseId}`));
      toast('success', 'Cover uploaded');
    } catch (err) {
      toast('error', toApiError(err));
    }
  };

  // ── Publish ───────────────────────────────────────────

  const togglePublish = async () => {
    if (!course || !courseId) return;
    try {
      const updated = await api.post<Course>(`/admin/courses/${courseId}/curriculum/publish`, {
        published: !course.curriculum_published,
      });
      setCourse(updated);
      toast('success', updated.curriculum_published
        ? 'Curriculum published — course is now visible in the Courses section'
        : 'Curriculum unpublished');
    } catch (err) {
      toast('error', toApiError(err));
    }
  };

  // ── Weeks ─────────────────────────────────────────────

  const addWeek = async () => {
    if (!courseId || !newWeekTitle.trim()) return;
    setSaving(true);
    try {
      await api.post(`/admin/courses/${courseId}/curriculum/modules`, { title: newWeekTitle.trim() });
      setNewWeekTitle('');
      setAddingWeek(false);
      await refreshCurriculum();
    } catch (err) {
      toast('error', toApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const saveWeek = async () => {
    if (!weekEdit) return;
    setSaving(true);
    try {
      await api.put(`/admin/curriculum/modules/${weekEdit.id}`, {
        title: weekEdit.title,
        summary: weekEdit.summary || null,
      });
      setWeekEdit(null);
      await refreshCurriculum();
    } catch (err) {
      toast('error', toApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const deleteWeek = async (mod: CurriculumModule) => {
    if (!window.confirm(`Delete "Week ${mod.week_number} — ${mod.title}" and its ${mod.items.length} item(s)?`)) return;
    try {
      await api.delete(`/admin/curriculum/modules/${mod.id}`);
      await refreshCurriculum();
    } catch (err) {
      toast('error', toApiError(err));
    }
  };

  const moveWeek = async (index: number, dir: -1 | 1) => {
    if (!curriculum || !courseId) return;
    const ids = curriculum.modules.map(m => m.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await api.put(`/admin/courses/${courseId}/curriculum/modules/reorder`, { ids });
      await refreshCurriculum();
    } catch (err) {
      toast('error', toApiError(err));
    }
  };

  // ── Items ─────────────────────────────────────────────

  const openAddItem = (moduleId: string, type: CurriculumItem['item_type']) => {
    setPickerAllVideos(false);
    setItemForm({
      moduleId, itemId: null, item_type: type,
      title: '', description: '', duration_min: '', video_id: '', external_url: '',
    });
  };

  const openEditItem = (item: CurriculumItem) => {
    setPickerAllVideos(false);
    setItemForm({
      moduleId: item.module_id, itemId: item.id, item_type: item.item_type,
      title: item.title, description: item.description || '',
      duration_min: String(item.duration_min || ''),
      video_id: item.video_id || '', external_url: item.external_url || '',
    });
  };

  const pickVideo = (videoId: string) => {
    if (!itemForm) return;
    const v = videos.find(x => x.id === videoId);
    setItemForm({
      ...itemForm,
      video_id: videoId,
      title: itemForm.title || v?.title || '',
      duration_min: v?.duration_s ? String(Math.max(1, Math.ceil(v.duration_s / 60))) : itemForm.duration_min,
    });
  };

  const saveItem = async () => {
    if (!itemForm || !itemForm.title.trim()) return;
    if (itemForm.item_type === 'video' && !itemForm.video_id) {
      toast('error', 'Pick a video for this item');
      return;
    }
    setSaving(true);
    const payload = {
      item_type: itemForm.item_type,
      title: itemForm.title.trim(),
      description: itemForm.description || null,
      duration_min: itemForm.duration_min ? parseInt(itemForm.duration_min, 10) || 0 : null,
      video_id: itemForm.video_id || null,
      external_url: itemForm.external_url || null,
    };
    try {
      if (itemForm.itemId) {
        const { item_type: _omit, ...update } = payload;
        await api.put(`/admin/curriculum/items/${itemForm.itemId}`, update);
      } else {
        await api.post(`/admin/curriculum/modules/${itemForm.moduleId}/items`, payload);
      }
      setItemForm(null);
      await refreshCurriculum();
    } catch (err) {
      toast('error', toApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async (item: CurriculumItem) => {
    if (!window.confirm(`Delete item "${item.title}"?`)) return;
    try {
      await api.delete(`/admin/curriculum/items/${item.id}`);
      await refreshCurriculum();
    } catch (err) {
      toast('error', toApiError(err));
    }
  };

  const moveItem = async (mod: CurriculumModule, index: number, dir: -1 | 1) => {
    const ids = mod.items.map(i => i.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await api.put(`/admin/curriculum/modules/${mod.id}/items/reorder`, { ids });
      await refreshCurriculum();
    } catch (err) {
      toast('error', toApiError(err));
    }
  };

  // ── Render ────────────────────────────────────────────

  if (loading) {
    return <div className="flex items-center justify-center h-full text-slate-400 p-20">Loading curriculum...</div>;
  }
  if (!course || !curriculum) {
    return (
      <div className="p-10 text-center text-slate-400">
        Course not found. <Link to="/admin/videos" className="text-primary hover:underline">Back to videos</Link>
      </div>
    );
  }

  const pickerVideos = videos
    .filter(v => pickerAllVideos || v.course_id === courseId)
    .sort((a, b) => a.title.localeCompare(b.title));

  const itemFormBlock = itemForm && (
    <div className="m-3 p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/60">
      <div className="flex items-center gap-2 mb-3">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${TYPE_META[itemForm.item_type].chip}`}>
          <span className="material-symbols-outlined text-[14px]">{TYPE_META[itemForm.item_type].icon}</span>
          {TYPE_META[itemForm.item_type].label}
        </span>
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {itemForm.itemId ? 'Edit item' : 'New item'}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {itemForm.item_type === 'video' && (
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Video</label>
            <div className="flex gap-2 items-center">
              <select
                value={itemForm.video_id}
                onChange={(e) => pickVideo(e.target.value)}
                className="flex-1 rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              >
                <option value="">— pick a video —</option>
                {pickerVideos.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.title}{v.duration_s ? ` (${Math.ceil(v.duration_s / 60)} min)` : ''}{v.is_published ? '' : ' — draft'}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                <input type="checkbox" checked={pickerAllVideos} onChange={(e) => setPickerAllVideos(e.target.checked)} />
                All courses
              </label>
            </div>
          </div>
        )}
        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Title</label>
          <input
            value={itemForm.title}
            onChange={(e) => setItemForm({ ...itemForm, title: e.target.value })}
            className="w-full rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
            placeholder={`${TYPE_META[itemForm.item_type].label} title`}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
            Duration (min){itemForm.item_type === 'video' ? ' — from video' : ''}
          </label>
          <input
            type="number" min="0"
            value={itemForm.duration_min}
            onChange={(e) => setItemForm({ ...itemForm, duration_min: e.target.value })}
            className="w-full rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
        </div>
        {itemForm.item_type !== 'video' && (
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
              Link URL{itemForm.item_type === 'exercise' ? ' (starter repo, lab…)' : ''}
            </label>
            <input
              value={itemForm.external_url}
              onChange={(e) => setItemForm({ ...itemForm, external_url: e.target.value })}
              className="w-full rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              placeholder="https://…"
            />
          </div>
        )}
        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Details (markdown)</label>
          <textarea
            rows={3}
            value={itemForm.description}
            onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
            className="w-full rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
            placeholder={itemForm.item_type === 'exercise' ? 'Instructions for the hands-on exercise…' : 'Optional details shown when the item is expanded'}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <button onClick={() => setItemForm(null)} className="px-3 py-1.5 rounded-lg text-sm border border-slate-300 dark:border-white/10 text-slate-600 dark:text-slate-300">
          Cancel
        </button>
        <button onClick={saveItem} disabled={saving} className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-primary text-white disabled:opacity-50">
          {itemForm.itemId ? 'Save item' : 'Add item'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto p-6 font-sans">
      {message && (
        <div className={`fixed top-20 right-6 z-50 px-4 py-3 rounded-lg text-sm font-medium shadow-xl border ${
          message.type === 'success'
            ? 'bg-green-500/10 text-green-400 border-green-500/30'
            : 'bg-red-500/10 text-red-400 border-red-500/30'
        }`}>
          {message.text}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap mb-5">
        <Link to="/admin/videos" className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500" title="Back to videos">
          <span className="material-symbols-outlined">arrow_back</span>
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white truncate">Curriculum — {course.title}</h1>
          <p className="text-xs text-slate-500">
            {curriculum.modules.length} week{curriculum.modules.length === 1 ? '' : 's'} · {curriculum.item_count} item{curriculum.item_count === 1 ? '' : 's'} · {fmtDuration(curriculum.total_duration_min)}
          </p>
        </div>
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
          course.curriculum_published
            ? 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/30'
            : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30'
        }`}>
          {course.curriculum_published ? 'Published' : 'Draft'}
        </span>
        <div className="flex-1" />
        <button
          onClick={togglePublish}
          className={`px-4 py-2 rounded-lg text-sm font-semibold ${
            course.curriculum_published
              ? 'border border-slate-300 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              : 'bg-primary text-white hover:bg-primary/90'
          }`}
        >
          {course.curriculum_published ? 'Unpublish' : 'Publish curriculum'}
        </button>
      </div>

      {/* Course details */}
      <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-card-dark mb-5">
        <button
          onClick={() => setMetaOpen(!metaOpen)}
          className="w-full flex items-center gap-2 px-4 py-3 text-left"
        >
          <span className={`material-symbols-outlined text-slate-400 transition-transform ${metaOpen ? 'rotate-90' : ''}`}>chevron_right</span>
          <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Course details</span>
          <span className="text-xs text-slate-400">level, tags, objectives, cover — shown on the course page</span>
        </button>
        {metaOpen && (
          <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Description</label>
              <textarea
                rows={2}
                value={metaForm.description}
                onChange={(e) => setMetaForm({ ...metaForm, description: e.target.value })}
                className="w-full rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Level</label>
              <select
                value={metaForm.level}
                onChange={(e) => setMetaForm({ ...metaForm, level: e.target.value })}
                className="w-full rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              >
                <option value="">— none —</option>
                {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Tags (comma-separated)</label>
              <input
                value={metaForm.tags}
                onChange={(e) => setMetaForm({ ...metaForm, tags: e.target.value })}
                placeholder="llm, python"
                className="w-full rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">What you'll learn (one per line)</label>
              <textarea
                rows={3}
                value={metaForm.objectives}
                onChange={(e) => setMetaForm({ ...metaForm, objectives: e.target.value })}
                className="w-full rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Prerequisites</label>
              <input
                value={metaForm.prerequisites}
                onChange={(e) => setMetaForm({ ...metaForm, prerequisites: e.target.value })}
                placeholder="Python basics · access to the on-prem LLM endpoint"
                className="w-full rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              />
            </div>
            <div className="md:col-span-2 flex items-center gap-4 flex-wrap">
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Cover image</label>
                <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-300 dark:border-white/20 text-sm text-slate-500 dark:text-slate-400 cursor-pointer hover:border-primary hover:text-primary">
                  <span className="material-symbols-outlined text-[18px]">upload</span>
                  Upload .jpg / .png / .webp
                  <input
                    type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden"
                    onChange={(e) => e.target.files?.[0] && uploadCover(e.target.files[0])}
                  />
                </label>
              </div>
              {course.cover_image && (
                <img
                  src={`${API_BASE}${course.cover_image}`}
                  alt="Course cover"
                  className="h-16 rounded-lg border border-slate-200 dark:border-white/10 object-cover"
                />
              )}
              <div className="flex-1" />
              <button
                onClick={saveMeta}
                disabled={metaSaving}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-white disabled:opacity-50"
              >
                {metaSaving ? 'Saving…' : 'Save details'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Weeks */}
      {curriculum.modules.map((mod, mi) => (
        <div key={mod.id} className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-card-dark mb-4 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-white/5">
            <span className="text-[11px] font-bold tracking-wider text-slate-400 shrink-0">WEEK {mod.week_number}</span>
            {weekEdit?.id === mod.id ? (
              <>
                <input
                  value={weekEdit.title}
                  onChange={(e) => setWeekEdit({ ...weekEdit, title: e.target.value })}
                  className="flex-1 min-w-0 rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-900 px-2 py-1 text-sm font-semibold"
                  placeholder="Week title"
                />
                <input
                  value={weekEdit.summary}
                  onChange={(e) => setWeekEdit({ ...weekEdit, summary: e.target.value })}
                  className="flex-1 min-w-0 rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-900 px-2 py-1 text-sm hidden md:block"
                  placeholder="Short summary (optional)"
                />
                <button onClick={saveWeek} disabled={saving} className="p-1.5 rounded-lg text-green-600 hover:bg-green-500/10" title="Save week">
                  <span className="material-symbols-outlined text-[18px]">check</span>
                </button>
                <button onClick={() => setWeekEdit(null)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" title="Cancel">
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </>
            ) : (
              <>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate block">{mod.title}</span>
                  {mod.summary && <span className="text-xs text-slate-400 truncate block">{mod.summary}</span>}
                </div>
                <span className="text-xs text-slate-400 shrink-0">{fmtDuration(mod.total_duration_min)}</span>
                <button onClick={() => moveWeek(mi, -1)} disabled={mi === 0} className="p-1 rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30" title="Move week up">
                  <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                </button>
                <button onClick={() => moveWeek(mi, 1)} disabled={mi === curriculum.modules.length - 1} className="p-1 rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30" title="Move week down">
                  <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
                </button>
                <button onClick={() => setWeekEdit({ id: mod.id, title: mod.title, summary: mod.summary || '' })} className="p-1 rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" title="Edit week">
                  <span className="material-symbols-outlined text-[16px]">edit</span>
                </button>
                <button onClick={() => deleteWeek(mod)} className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-500/10" title="Delete week">
                  <span className="material-symbols-outlined text-[16px]">delete</span>
                </button>
              </>
            )}
          </div>

          {/* Items */}
          {mod.items.map((item, ii) => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 dark:border-white/5">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold shrink-0 w-24 justify-center ${TYPE_META[item.item_type].chip}`}>
                <span className="material-symbols-outlined text-[13px]">{TYPE_META[item.item_type].icon}</span>
                {TYPE_META[item.item_type].label}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{item.title}</p>
                <p className="text-xs text-slate-400 truncate">
                  {item.item_type === 'video' && item.video_title
                    ? `linked: ${item.video_title}`
                    : item.external_url || (item.description ? item.description.slice(0, 80) : '—')}
                </p>
              </div>
              <span className="text-xs text-slate-400 shrink-0 tabular-nums">{item.duration_min} min</span>
              <div className="flex items-center gap-0.5 shrink-0">
                <button onClick={() => moveItem(mod, ii, -1)} disabled={ii === 0} className="p-1 rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30" title="Move up">
                  <span className="material-symbols-outlined text-[15px]">arrow_upward</span>
                </button>
                <button onClick={() => moveItem(mod, ii, 1)} disabled={ii === mod.items.length - 1} className="p-1 rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30" title="Move down">
                  <span className="material-symbols-outlined text-[15px]">arrow_downward</span>
                </button>
                <button onClick={() => openEditItem(item)} className="p-1 rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" title="Edit item">
                  <span className="material-symbols-outlined text-[15px]">edit</span>
                </button>
                <button onClick={() => deleteItem(item)} className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-500/10" title="Delete item">
                  <span className="material-symbols-outlined text-[15px]">delete</span>
                </button>
              </div>
            </div>
          ))}
          {mod.items.length === 0 && !(itemForm && itemForm.moduleId === mod.id) && (
            <p className="px-4 py-3 text-xs text-slate-400">No items yet — add the first one below.</p>
          )}

          {/* Add item buttons / inline form */}
          {itemForm && itemForm.moduleId === mod.id ? itemFormBlock : (
            <div className="flex gap-2 px-4 py-3 flex-wrap">
              {(Object.keys(TYPE_META) as CurriculumItem['item_type'][]).map(t => (
                <button
                  key={t}
                  onClick={() => openAddItem(mod.id, t)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-dashed border-slate-300 dark:border-white/20 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:border-primary hover:text-primary"
                >
                  <span className="material-symbols-outlined text-[14px]">{TYPE_META[t].icon}</span>
                  + {TYPE_META[t].label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Add week */}
      {addingWeek ? (
        <div className="flex gap-2 items-center rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-card-dark p-3">
          <span className="text-[11px] font-bold tracking-wider text-slate-400 shrink-0">WEEK {curriculum.modules.length + 1}</span>
          <input
            autoFocus
            value={newWeekTitle}
            onChange={(e) => setNewWeekTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addWeek()}
            placeholder="Week title, e.g. Foundations"
            className="flex-1 rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
          <button onClick={addWeek} disabled={saving || !newWeekTitle.trim()} className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-white disabled:opacity-50">
            Add week
          </button>
          <button onClick={() => { setAddingWeek(false); setNewWeekTitle(''); }} className="px-3 py-2 rounded-lg text-sm border border-slate-300 dark:border-white/10 text-slate-500">
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAddingWeek(true)}
          className="w-full py-3 rounded-xl border-2 border-dashed border-slate-300 dark:border-white/20 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:border-primary hover:text-primary"
        >
          + Add week
        </button>
      )}
    </div>
  );
};

export default AdminCourseCurriculum;
