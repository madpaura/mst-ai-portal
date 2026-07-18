import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, toApiError } from '../api/client';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface Course {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  sort_order: number;
  is_featured: boolean;
  level: string | null;
  tags: string[];
  cover_image: string | null;
  objectives: string[];
  prerequisites: string | null;
  curriculum_published: boolean;
  module_count: number;
  item_count: number;
}

interface CourseForm {
  title: string;
  slug: string;
  description: string;
  level: string;
  tags: string;
  objectives: string;
  prerequisites: string;
}

const EMPTY_FORM: CourseForm = {
  title: '', slug: '', description: '', level: '', tags: '', objectives: '', prerequisites: '',
};

const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export const AdminCourses: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Create/edit form state
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Course | null>(null);
  const [form, setForm] = useState<CourseForm>(EMPTY_FORM);
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const [uploadingCoverFor, setUploadingCoverFor] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const fetchCourses = useCallback(async () => {
    try {
      const data = await api.get<Course[]>('/admin/courses');
      setCourses(data);
      return data;
    } catch (err) {
      showMsg('error', toApiError(err));
      return [] as Course[];
    }
  }, []);

  useEffect(() => { fetchCourses().finally(() => setLoading(false)); }, [fetchCourses]);

  // ── Create / edit form ─────────────────────────────────

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setSlugTouched(false);
    setCreating(true);
  };

  const openEdit = (course: Course) => {
    setCreating(false);
    setEditing(course);
    setSlugTouched(true);
    setForm({
      title: course.title,
      slug: course.slug,
      description: course.description || '',
      level: course.level || '',
      tags: (course.tags || []).join(', '),
      objectives: (course.objectives || []).join('\n'),
      prerequisites: course.prerequisites || '',
    });
  };

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setSlugTouched(false);
  };

  const handleTitleChange = (title: string) => {
    setForm((f) => ({ ...f, title, slug: slugTouched ? f.slug : slugify(title) }));
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.slug.trim()) {
      showMsg('error', 'Title and slug are required');
      return;
    }
    setSaving(true);
    const payload = {
      title: form.title.trim(),
      slug: slugify(form.slug),
      description: form.description || null,
      level: form.level || null,
      tags: form.tags.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean),
      objectives: form.objectives.split('\n').map((o) => o.trim()).filter(Boolean),
      prerequisites: form.prerequisites || null,
    };
    try {
      if (creating) {
        await api.post('/admin/courses', payload);
        showMsg('success', 'Course created');
      } else if (editing) {
        await api.put(`/admin/courses/${editing.id}`, payload);
        showMsg('success', 'Course updated');
      }
      closeForm();
      await fetchCourses();
    } catch (err) {
      showMsg('error', toApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (course: Course) => {
    if (!window.confirm(`Delete "${course.title}"? This permanently removes its curriculum (${course.module_count} week(s), ${course.item_count} item(s)).`)) return;
    try {
      await api.delete(`/admin/courses/${course.id}`);
      showMsg('success', 'Course deleted');
      await fetchCourses();
    } catch (err) {
      showMsg('error', toApiError(err));
    }
  };

  const togglePublish = async (course: Course) => {
    setPublishingId(course.id);
    try {
      await api.post<Course>(`/admin/courses/${course.id}/curriculum/publish`, {
        published: !course.curriculum_published,
      });
      showMsg('success', course.curriculum_published ? 'Curriculum unpublished' : 'Curriculum published');
      await fetchCourses();
    } catch (err) {
      showMsg('error', toApiError(err));
    } finally {
      setPublishingId(null);
    }
  };

  const uploadCover = async (course: Course, file: File) => {
    setUploadingCoverFor(course.id);
    try {
      await api.upload(`/admin/courses/${course.id}/cover`, file);
      showMsg('success', 'Cover uploaded');
      const updated = await fetchCourses();
      if (editing && editing.id === course.id) {
        const fresh = updated.find((c) => c.id === course.id);
        if (fresh) setEditing(fresh);
      }
    } catch (err) {
      showMsg('error', toApiError(err));
    } finally {
      setUploadingCoverFor(null);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-slate-400 p-20">Loading...</div>;
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

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Courses</h1>
          <p className="text-sm text-text-muted mt-1">Manage curriculum courses — metadata, cover image, and publish state</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
          <span className="material-symbols-outlined text-sm">add</span>
          Add Course
        </button>
      </div>

      <div className="bg-card-light dark:bg-card-dark rounded-xl border border-slate-200 dark:border-white/5 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200 dark:border-white/10 text-xs font-bold text-text-muted uppercase tracking-wider">
              <th className="text-left px-4 py-3">Course</th>
              <th className="text-left px-4 py-3">Level</th>
              <th className="text-left px-4 py-3">Tags</th>
              <th className="text-left px-4 py-3">Curriculum</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((course) => (
              <tr key={course.id} className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {course.cover_image ? (
                      <img src={`${API_BASE}${course.cover_image}`} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-200 dark:border-white/10" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-panel-light dark:bg-panel-dark border border-slate-200 dark:border-white/10 flex items-center justify-center text-slate-400">
                        <span className="material-symbols-outlined text-base">school</span>
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{course.title}</p>
                      <p className="text-[10px] text-slate-500">/{course.slug}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-text-muted">{course.level || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1 max-w-[160px]">
                    {course.tags.slice(0, 3).map((t) => (
                      <span key={t} className="px-1.5 py-0.5 text-[10px] rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">{t}</span>
                    ))}
                    {course.tags.length === 0 && <span className="text-xs text-slate-400">—</span>}
                    {course.tags.length > 3 && <span className="text-[10px] text-slate-400">+{course.tags.length - 3}</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-text-muted">
                  {course.module_count} week{course.module_count === 1 ? '' : 's'} · {course.item_count} item{course.item_count === 1 ? '' : 's'}
                </td>
                <td className="px-4 py-3">
                  {course.curriculum_published ? (
                    <span className="px-2 py-0.5 text-[10px] rounded bg-green-500/10 text-green-400">Published</span>
                  ) : (
                    <span className="px-2 py-0.5 text-[10px] rounded bg-slate-700 text-slate-400">Draft</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Link
                      to={`/admin/courses/${course.id}/curriculum`}
                      title="Open curriculum builder"
                      className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-primary transition-colors"
                    >
                      <span className="material-symbols-outlined text-sm">menu_book</span>
                    </Link>
                    <label
                      title="Upload cover image"
                      className={`p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer ${uploadingCoverFor === course.id ? 'opacity-50 pointer-events-none' : ''}`}
                    >
                      <span className="material-symbols-outlined text-sm">
                        {uploadingCoverFor === course.id ? 'autorenew' : 'image'}
                      </span>
                      <input
                        type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden"
                        onChange={(e) => e.target.files?.[0] && uploadCover(course, e.target.files[0])}
                      />
                    </label>
                    <button
                      onClick={() => togglePublish(course)}
                      disabled={publishingId === course.id}
                      title={course.curriculum_published ? 'Unpublish curriculum' : 'Publish curriculum'}
                      className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-sm">{course.curriculum_published ? 'visibility_off' : 'visibility'}</span>
                    </button>
                    <button onClick={() => openEdit(course)} title="Edit metadata" className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
                      <span className="material-symbols-outlined text-sm">edit</span>
                    </button>
                    <button onClick={() => handleDelete(course)} title="Delete course" className="p-1.5 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors">
                      <span className="material-symbols-outlined text-sm">delete</span>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {courses.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">No courses yet — click "Add Course" to create your first curriculum course.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Create/Edit Slide-out Form ────────────────── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={closeForm} />
          <div className="relative w-full max-w-lg bg-white dark:bg-background-dark border-l border-slate-200 dark:border-white/10 overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {creating ? 'New Course' : `Edit: ${editing?.title}`}
              </h2>
              <button onClick={closeForm} className="text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-1">Title</label>
                <input value={form.title} onChange={(e) => handleTitleChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
              </div>

              <div>
                <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-1">Slug</label>
                <input value={form.slug} onChange={(e) => { setSlugTouched(true); setForm((f) => ({ ...f, slug: e.target.value })); }}
                  onBlur={(e) => setForm((f) => ({ ...f, slug: slugify(e.target.value) }))}
                  className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none font-mono" />
              </div>

              <div>
                <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-1">Description</label>
                <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3} className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none resize-none" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-1">Level</label>
                  <select value={form.level} onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none">
                    <option value="">— none —</option>
                    {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-1">Tags (comma-separated)</label>
                  <input value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                    placeholder="llm, python"
                    className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-1">What you'll learn (one per line)</label>
                <textarea value={form.objectives} onChange={(e) => setForm((f) => ({ ...f, objectives: e.target.value }))}
                  rows={3} className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none resize-none" />
              </div>

              <div>
                <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-1">Prerequisites</label>
                <input value={form.prerequisites} onChange={(e) => setForm((f) => ({ ...f, prerequisites: e.target.value }))}
                  placeholder="Python basics · access to the on-prem LLM endpoint"
                  className="w-full px-3 py-2 rounded-lg bg-input-light dark:bg-input-dark border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-sm focus:border-primary outline-none" />
              </div>

              {editing ? (
                <div>
                  <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-1">Cover image</label>
                  <div className="flex items-center gap-3">
                    <label className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-300 dark:border-white/20 text-sm text-slate-500 dark:text-slate-400 cursor-pointer hover:border-primary hover:text-primary ${uploadingCoverFor === editing.id ? 'opacity-50 pointer-events-none' : ''}`}>
                      <span className="material-symbols-outlined text-[18px]">upload</span>
                      {uploadingCoverFor === editing.id ? 'Uploading…' : 'Upload .jpg / .png / .webp'}
                      <input
                        type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden"
                        onChange={(e) => e.target.files?.[0] && uploadCover(editing, e.target.files[0])}
                      />
                    </label>
                    {editing.cover_image && (
                      <img src={`${API_BASE}${editing.cover_image}`} alt="Course cover" className="h-12 rounded-lg border border-slate-200 dark:border-white/10 object-cover" />
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500">Cover image can be uploaded after the course is created.</p>
              )}

              <div className="flex gap-3 pt-4 border-t border-slate-200 dark:border-white/10">
                <button onClick={handleSave} disabled={saving} className="flex-1 px-6 py-2.5 bg-primary hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg transition-colors">
                  {saving ? 'Saving…' : creating ? 'Create Course' : 'Save Changes'}
                </button>
                <button onClick={closeForm} className="px-6 py-2.5 bg-muted-light dark:bg-muted-dark hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm rounded-lg transition-colors">
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
