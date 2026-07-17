import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { Navbar } from '../components/Navbar';
import { api, isLoggedIn, toApiError } from '../api/client';
import { LEVEL_CHIP, fmtTotal, coverGradient } from './Courses';
import '../styles/howto-markdown.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

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
  links: { label: string; url: string }[];
  sort_order: number;
}

interface CurriculumModule {
  id: string;
  week_number: number;
  title: string;
  summary: string | null;
  total_duration_min: number;
  items: CurriculumItem[];
}

interface CourseDetailData {
  course: {
    id: string; slug: string; title: string; description: string | null;
    level: string | null; tags: string[]; cover_image: string | null;
    objectives: string[]; prerequisites: string | null;
  };
  curriculum: {
    total_duration_min: number;
    item_count: number;
    modules: CurriculumModule[];
  };
  rating_avg: number | null;
  rating_count: number;
  user: {
    is_enrolled: boolean;
    enrolled_at: string | null;
    suggested_week: number | null;
    completed_item_ids: string[];
    completed: number;
    total: number;
    pct: number;
    feedback_rating: number | null;
    feedback_comment: string | null;
  } | null;
}

const TYPE_META: Record<CurriculumItem['item_type'], { label: string; icon: string; chip: string; bar: string }> = {
  video:    { label: 'Video',    icon: 'play_circle', chip: 'bg-primary/10 text-primary',                                bar: 'bg-primary' },
  exercise: { label: 'Exercise', icon: 'keyboard',    chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',       bar: 'bg-amber-500' },
  reading:  { label: 'Reading',  icon: 'menu_book',   chip: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',    bar: 'bg-violet-500' },
  link:     { label: 'Link',     icon: 'link',        chip: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',          bar: 'bg-teal-500' },
};

export const CourseDetail: React.FC = () => {
  const { courseSlug } = useParams<{ courseSlug: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<CourseDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(new Set());
  const [openItems, setOpenItems] = useState<Set<string>>(new Set());
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Feedback form
  const [fbRating, setFbRating] = useState(0);
  const [fbComment, setFbComment] = useState('');
  const [fbSaved, setFbSaved] = useState(false);

  const toast = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3500);
  };

  const load = useCallback(async () => {
    if (!courseSlug) return;
    try {
      const data = await api.get<CourseDetailData>(`/courses/${courseSlug}`);
      setDetail(data);
      setCompleted(new Set(data.user?.completed_item_ids || []));
      setFbRating(data.user?.feedback_rating || 0);
      setFbComment(data.user?.feedback_comment || '');
      // Open the suggested week (or the first) by default.
      const mods = data.curriculum.modules;
      if (mods.length) {
        const idx = Math.min((data.user?.suggested_week || 1) - 1, mods.length - 1);
        setOpenWeeks(new Set([mods[idx].id]));
      }
    } catch (err) {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [courseSlug]);

  useEffect(() => { load(); }, [load]);

  const toggleWeek = (id: string) => {
    setOpenWeeks(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleItemOpen = (id: string) => {
    setOpenItems(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const tick = async (item: CurriculumItem) => {
    if (!isLoggedIn()) {
      navigate('/login');
      return;
    }
    if (!detail || busy) return;
    setBusy(true);
    const nowDone = !completed.has(item.id);
    try {
      const resp = await api.post<{ auto_enrolled: boolean; completed_items: number; total_items: number; progress_pct: number }>(
        `/courses/${detail.course.slug}/items/${item.id}/progress`,
        { completed: nowDone },
      );
      setCompleted(prev => {
        const next = new Set(prev);
        nowDone ? next.add(item.id) : next.delete(item.id);
        return next;
      });
      if (resp.auto_enrolled) {
        toast('success', 'Subscribed to course — progress is now tracked');
        setDetail(d => d && d.user
          ? { ...d, user: { ...d.user, is_enrolled: true } }
          : d);
        // user state may have been null (first interaction) — reload for full state
        if (!detail.user?.is_enrolled) await load();
      }
    } catch (err) {
      toast('error', toApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleSubscribe = async () => {
    if (!isLoggedIn()) {
      navigate('/login');
      return;
    }
    if (!detail || busy) return;
    setBusy(true);
    try {
      if (detail.user?.is_enrolled) {
        await api.delete(`/video/courses/${detail.course.slug}/enroll`);
        toast('success', 'Unsubscribed — progress kept, hidden until you re-subscribe');
      } else {
        await api.post(`/video/courses/${detail.course.slug}/enroll`);
        toast('success', 'Subscribed');
      }
      await load();
    } catch (err) {
      toast('error', toApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const submitFeedback = async () => {
    if (!detail || !fbRating) return;
    try {
      await api.post(`/courses/${detail.course.slug}/feedback`, {
        rating: fbRating,
        comment: fbComment || null,
      });
      setFbSaved(true);
      toast('success', 'Feedback submitted — you can edit it anytime');
    } catch (err) {
      toast('error', toApiError(err));
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background-light dark:bg-background-dark">
        <Navbar variant="solutions" />
        <div className="text-center text-slate-400 py-24">Loading course…</div>
      </div>
    );
  }
  if (notFound || !detail) {
    return (
      <div className="min-h-screen bg-background-light dark:bg-background-dark">
        <Navbar variant="solutions" />
        <div className="text-center text-slate-400 py-24">
          Course not found. <Link to="/courses" className="text-primary hover:underline">All courses</Link>
        </div>
      </div>
    );
  }

  const { course, curriculum, user } = detail;
  const enrolled = user?.is_enrolled ?? false;
  const maxDur = Math.max(1, ...curriculum.modules.flatMap(m => m.items.map(i => i.duration_min)));
  const doneCount = completed.size;
  const pct = curriculum.item_count ? Math.round((doneCount / curriculum.item_count) * 100) : 0;
  const ringCircumference = 2 * Math.PI * 52;

  const weekPct = (mod: CurriculumModule): number => {
    if (!mod.items.length) return 0;
    const done = mod.items.filter(i => completed.has(i.id)).length;
    return Math.round((done / mod.items.length) * 100);
  };

  return (
    <div className="min-h-screen bg-background-light dark:bg-background-dark">
      <Navbar variant="solutions" />
      {message && (
        <div className={`fixed top-20 right-6 z-50 px-4 py-3 rounded-lg text-sm font-medium shadow-xl border ${
          message.type === 'success'
            ? 'bg-green-500/10 text-green-400 border-green-500/30'
            : 'bg-red-500/10 text-red-400 border-red-500/30'
        }`}>
          {message.text}
        </div>
      )}

      <main className="max-w-5xl mx-auto px-6 py-8">
        <Link to="/courses" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-primary transition-colors mb-4">
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          All courses
        </Link>

        {/* Hero */}
        <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-card-light dark:bg-card-dark overflow-hidden mb-6">
          <div
            className="h-2"
            style={course.cover_image
              ? { backgroundImage: `url(${API_BASE}${course.cover_image})`, backgroundSize: 'cover' }
              : { background: coverGradient(course.slug) }}
          />
          <div className="p-6 md:p-7 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">{course.title}</h1>
              {course.description && (
                <p className="text-sm text-slate-500 leading-relaxed max-w-2xl mb-3">{course.description}</p>
              )}
              <div className="flex items-center gap-2 flex-wrap text-sm text-slate-500 mb-4">
                {course.level && (
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${LEVEL_CHIP[course.level] || 'bg-slate-500/10 text-slate-500'}`}>
                    {course.level}
                  </span>
                )}
                <span className="tabular-nums">{curriculum.modules.length} week{curriculum.modules.length === 1 ? '' : 's'}</span>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <span className="tabular-nums">{fmtTotal(curriculum.total_duration_min)} total</span>
                {detail.rating_count > 0 && (
                  <>
                    <span className="text-slate-300 dark:text-slate-600">·</span>
                    <span className="tabular-nums"><span className="text-amber-500">★</span> {detail.rating_avg} ({detail.rating_count})</span>
                  </>
                )}
                {course.tags.map(t => (
                  <span key={t} className="px-2 py-0.5 rounded-full text-[11px] border border-slate-200 dark:border-white/10 text-slate-500">#{t}</span>
                ))}
              </div>
              {course.objectives.length > 0 && (
                <>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">What you'll learn</h3>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm text-slate-600 dark:text-slate-300 mb-3">
                    {course.objectives.map((o, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-green-500 font-bold shrink-0">✓</span>{o}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {course.prerequisites && (
                <p className="text-xs text-slate-500">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Prerequisites:</span> {course.prerequisites}
                </p>
              )}
            </div>

            {/* Progress ring + subscribe */}
            <div className="flex md:flex-col items-center gap-4 md:min-w-[160px]">
              <div className="relative w-28 h-28 shrink-0">
                <svg width="112" height="112" viewBox="0 0 118 118" className="-rotate-90">
                  <circle cx="59" cy="59" r="52" fill="none" className="stroke-slate-200 dark:stroke-slate-700" strokeWidth="9" />
                  <circle
                    cx="59" cy="59" r="52" fill="none" strokeWidth="9" strokeLinecap="round"
                    className="stroke-primary transition-all duration-300"
                    strokeDasharray={ringCircumference}
                    strokeDashoffset={enrolled ? ringCircumference * (1 - pct / 100) : ringCircumference}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-bold text-slate-900 dark:text-white tabular-nums">{enrolled ? `${pct}%` : '–'}</span>
                  <span className="text-[10px] text-slate-400 tabular-nums">
                    {enrolled ? `${doneCount} / ${curriculum.item_count} items` : 'not subscribed'}
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={toggleSubscribe}
                  disabled={busy}
                  className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 ${
                    enrolled
                      ? 'border border-slate-300 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      : 'bg-primary text-white hover:bg-primary/90'
                  }`}
                >
                  {enrolled ? 'Subscribed ✓' : 'Subscribe'}
                </button>
                {enrolled && user?.suggested_week && (
                  <div className="text-[11px] text-slate-500 text-center bg-slate-100 dark:bg-slate-800 rounded-lg px-2.5 py-1.5">
                    Suggested pace: <span className="font-bold">Week {user.suggested_week}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Week overview strip */}
        {curriculum.modules.length > 1 && (
          <div className="flex gap-2.5 mb-4">
            {curriculum.modules.map(mod => (
              <button
                key={mod.id}
                onClick={() => {
                  setOpenWeeks(prev => new Set(prev).add(mod.id));
                  document.getElementById(`week-${mod.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className="flex-1 group"
                title={`Week ${mod.week_number}: ${weekPct(mod)}% done`}
              >
                <div className="flex justify-between text-[10px] text-slate-400 mb-1 tabular-nums">
                  <span>W{mod.week_number}</span>
                  {enrolled && <span>{weekPct(mod)}%</span>}
                </div>
                <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${enrolled ? weekPct(mod) : 0}%` }} />
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="flex gap-4 items-center text-[11px] text-slate-400 mb-4 flex-wrap">
          {(Object.keys(TYPE_META) as CurriculumItem['item_type'][]).map(t => (
            <span key={t} className="flex items-center gap-1.5">
              <i className={`inline-block w-3.5 h-2 rounded-sm ${TYPE_META[t].bar}`} />
              {TYPE_META[t].label}
            </span>
          ))}
          <span className="ml-auto hidden sm:block">✓ videos auto-complete from your watch history</span>
        </div>

        {/* Weeks */}
        {curriculum.modules.map(mod => {
          const open = openWeeks.has(mod.id);
          const wDone = mod.items.filter(i => completed.has(i.id)).length;
          return (
            <div key={mod.id} id={`week-${mod.id}`} className="rounded-2xl border border-slate-200 dark:border-white/10 bg-card-light dark:bg-card-dark mb-4 overflow-hidden scroll-mt-20">
              <button
                onClick={() => toggleWeek(mod.id)}
                className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
              >
                <span className={`material-symbols-outlined text-slate-400 text-[18px] transition-transform ${open ? 'rotate-90' : ''}`}>chevron_right</span>
                <h2 className="flex-1 text-[15px] font-bold text-slate-900 dark:text-white">
                  Week {mod.week_number} — {mod.title}
                </h2>
                {enrolled && (
                  wDone === mod.items.length && mod.items.length > 0
                    ? <span className="text-xs font-semibold text-green-500">✓ complete</span>
                    : <span className="text-xs text-slate-400 tabular-nums">{wDone}/{mod.items.length} done</span>
                )}
                <span className="text-xs text-slate-400 tabular-nums">{fmtTotal(mod.total_duration_min)}</span>
              </button>

              {open && (
                <div className="border-t border-slate-100 dark:border-white/5">
                  {mod.summary && (
                    <p className="px-5 pt-3 pb-1 text-sm text-slate-500">{mod.summary}</p>
                  )}
                  {mod.items.map(item => {
                    const done = completed.has(item.id);
                    const itemOpen = openItems.has(item.id);
                    return (
                      <div key={item.id} className="border-t border-slate-100 dark:border-white/5 first:border-t-0">
                        <div
                          className="grid grid-cols-[auto_1fr_auto_auto] sm:grid-cols-[auto_92px_1fr_56px_auto] gap-3 items-center px-5 py-2.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                          onClick={() => toggleItemOpen(item.id)}
                        >
                          <button
                            onClick={(e) => { e.stopPropagation(); tick(item); }}
                            title={item.item_type === 'video' ? 'Auto-completes when watched (click to override)' : 'Mark complete'}
                            aria-label={`Mark ${item.title} complete`}
                            className={`w-5 h-5 rounded-md border flex items-center justify-center text-[11px] shrink-0 transition-colors ${
                              done
                                ? 'bg-green-500 border-green-500 text-white'
                                : 'border-slate-300 dark:border-slate-600 text-transparent hover:border-primary'
                            }`}
                          >
                            ✓
                          </button>
                          <span className={`hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold justify-center ${TYPE_META[item.item_type].chip}`}>
                            <span className="material-symbols-outlined text-[13px]">{TYPE_META[item.item_type].icon}</span>
                            {TYPE_META[item.item_type].label}
                          </span>
                          <div className="min-w-0">
                            <p className={`text-sm truncate ${done ? 'text-slate-400 font-normal' : 'font-semibold text-slate-800 dark:text-slate-100'}`}>
                              {item.title}
                            </p>
                            <div className="mt-1.5 h-2 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                              <div
                                className={`h-full rounded-sm ${TYPE_META[item.item_type].bar} ${done ? 'opacity-30' : 'opacity-80'}`}
                                style={{ width: `${Math.round((item.duration_min / maxDur) * 100)}%` }}
                              />
                            </div>
                          </div>
                          <span className="text-xs text-slate-400 tabular-nums text-right">{item.duration_min} min</span>
                          <span className={`material-symbols-outlined text-slate-300 dark:text-slate-600 text-[16px] transition-transform ${itemOpen ? 'rotate-90' : ''}`}>chevron_right</span>
                        </div>

                        {itemOpen && (
                          <div className="px-5 pb-4 sm:pl-[4.5rem]">
                            {item.description && (
                              <div className="howto-markdown text-sm text-slate-500 max-w-2xl mb-3">
                                <ReactMarkdown>{item.description}</ReactMarkdown>
                              </div>
                            )}
                            <div className="flex gap-2 flex-wrap">
                              {item.item_type === 'video' && item.video_slug && (
                                <Link
                                  to={`/ignite/${item.video_slug}`}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
                                >
                                  <span className="material-symbols-outlined text-[15px]">play_arrow</span>
                                  Watch in Ignite
                                </Link>
                              )}
                              {item.external_url && (
                                <a
                                  href={item.external_url} target="_blank" rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-xs text-slate-600 dark:text-slate-300 hover:border-primary hover:text-primary transition-colors"
                                >
                                  <span className="material-symbols-outlined text-[15px]">open_in_new</span>
                                  Open link
                                </a>
                              )}
                              {(item.links || []).map((l, i) => (
                                <a
                                  key={i} href={l.url} target="_blank" rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-xs text-slate-600 dark:text-slate-300 hover:border-primary hover:text-primary transition-colors"
                                >
                                  <span className="material-symbols-outlined text-[15px]">open_in_new</span>
                                  {l.label}
                                </a>
                              ))}
                              {item.item_type !== 'video' && (
                                <button
                                  onClick={() => tick(item)}
                                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                                    done
                                      ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                      : 'border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:border-green-500 hover:text-green-500'
                                  }`}
                                >
                                  {done ? '✓ Completed' : 'Mark as complete'}
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Feedback */}
        <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-card-light dark:bg-card-dark p-6 mt-6">
          <div className="flex gap-8 flex-wrap">
            <div className="min-w-[140px]">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900 dark:text-white tabular-nums">
                  {detail.rating_avg ?? '–'}
                </span>
                <span className="text-amber-500 text-lg tracking-wider">
                  {'★'.repeat(Math.round(detail.rating_avg || 0))}
                  <span className="opacity-30">{'★'.repeat(5 - Math.round(detail.rating_avg || 0))}</span>
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 tabular-nums">
                {detail.rating_count} rating{detail.rating_count === 1 ? '' : 's'}
              </p>
            </div>
            <div className={`flex-1 min-w-[260px] ${enrolled ? '' : 'opacity-50 pointer-events-none'}`}>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-2">Your feedback</h3>
              <div className="flex gap-1 mb-2">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    onClick={() => setFbRating(n)}
                    aria-label={`${n} star${n === 1 ? '' : 's'}`}
                    className={`text-2xl transition-colors ${n <= fbRating ? 'text-amber-500' : 'text-slate-300 dark:text-slate-600 hover:text-amber-400'}`}
                  >
                    ★
                  </button>
                ))}
              </div>
              <textarea
                rows={2}
                value={fbComment}
                onChange={(e) => setFbComment(e.target.value)}
                placeholder="What worked? What should change?"
                className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-200"
              />
              <div className="flex items-center gap-3 mt-2">
                <button
                  onClick={submitFeedback}
                  disabled={!fbRating}
                  className="px-4 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-40"
                >
                  {user?.feedback_rating || fbSaved ? 'Update feedback' : 'Submit feedback'}
                </button>
                {fbSaved && <span className="text-xs text-green-500">Saved — you can edit it anytime</span>}
              </div>
            </div>
            {!enrolled && (
              <p className="w-full text-xs text-slate-400 -mt-2">Subscribe to the course to leave feedback.</p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default CourseDetail;
