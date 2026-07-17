import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { api } from '../api/client';

const API_BASE = import.meta.env.VITE_API_URL || '';

export interface CourseCard {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  level: string | null;
  tags: string[];
  cover_image: string | null;
  week_count: number;
  item_count: number;
  total_duration_min: number;
  rating_avg: number | null;
  rating_count: number;
  is_enrolled: boolean;
  completed_items: number;
  progress_pct: number;
}

export const LEVEL_CHIP: Record<string, string> = {
  Beginner: 'bg-green-500/10 text-green-600 dark:text-green-400',
  Intermediate: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  Advanced: 'bg-red-500/10 text-red-600 dark:text-red-400',
};

export const fmtTotal = (min: number): string =>
  min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min} min`;

// Deterministic fallback gradient per course when no cover is set.
const COVER_GRADIENTS = [
  'linear-gradient(120deg,#1e3a8a,#258cf4)',
  'linear-gradient(120deg,#065f46,#0d9488)',
  'linear-gradient(120deg,#7c2d12,#d97706)',
  'linear-gradient(120deg,#4c1d95,#8b5cf6)',
];
export const coverGradient = (slug: string): string =>
  COVER_GRADIENTS[[...slug].reduce((a, ch) => a + ch.charCodeAt(0), 0) % COVER_GRADIENTS.length];

export const Courses: React.FC = () => {
  const [courses, setCourses] = useState<CourseCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setCourses(await api.get<CourseCard[]>('/courses'));
      } catch {
        setCourses([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = levelFilter ? courses.filter(c => c.level === levelFilter) : courses;
  const levels = [...new Set(courses.map(c => c.level).filter(Boolean))] as string[];

  return (
    <div className="min-h-screen bg-background-light dark:bg-background-dark">
      <Navbar variant="solutions" />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Courses</h1>
            <p className="text-sm text-slate-500 mt-1">
              Structured learning paths with videos, hands-on exercises and a weekly plan.
            </p>
          </div>
          {levels.length > 1 && (
            <div className="flex gap-2">
              <button
                onClick={() => setLevelFilter('')}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                  !levelFilter ? 'bg-primary text-white border-primary' : 'border-slate-300 dark:border-white/10 text-slate-500'
                }`}
              >
                All
              </button>
              {levels.map(l => (
                <button
                  key={l}
                  onClick={() => setLevelFilter(levelFilter === l ? '' : l)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                    levelFilter === l ? 'bg-primary text-white border-primary' : 'border-slate-300 dark:border-white/10 text-slate-500'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-center text-slate-400 py-20">Loading courses…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-slate-400 py-20">
            No courses published yet — check back soon.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map(c => (
              <Link
                key={c.id}
                to={`/courses/${c.slug}`}
                className="group rounded-2xl overflow-hidden border border-slate-200 dark:border-white/10 bg-card-light dark:bg-card-dark hover:-translate-y-0.5 hover:shadow-lg transition-all flex flex-col"
              >
                <div
                  className="h-28 flex items-end p-3"
                  style={c.cover_image
                    ? { backgroundImage: `url(${API_BASE}${c.cover_image})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                    : { background: coverGradient(c.slug) }}
                >
                  <span className="bg-black/55 text-white rounded-lg px-2.5 py-0.5 text-xs font-semibold">
                    {c.week_count} week{c.week_count === 1 ? '' : 's'} · {fmtTotal(c.total_duration_min)}
                  </span>
                </div>
                <div className="p-4 flex flex-col gap-2.5 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-bold text-slate-900 dark:text-white group-hover:text-primary transition-colors">
                      {c.title}
                    </h3>
                    {c.rating_count > 0 && (
                      <span className="text-xs text-slate-500 whitespace-nowrap">
                        <span className="text-amber-500">★</span> {c.rating_avg} ({c.rating_count})
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {c.level && (
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${LEVEL_CHIP[c.level] || 'bg-slate-500/10 text-slate-500'}`}>
                        {c.level}
                      </span>
                    )}
                    {c.tags.slice(0, 3).map(t => (
                      <span key={t} className="px-2 py-0.5 rounded-full text-[11px] border border-slate-200 dark:border-white/10 text-slate-500">
                        #{t}
                      </span>
                    ))}
                  </div>
                  {c.description && (
                    <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 flex-1">{c.description}</p>
                  )}
                  {c.is_enrolled ? (
                    <div className="mt-auto">
                      <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${c.progress_pct}%` }} />
                      </div>
                      <div className="flex justify-between items-center mt-1.5">
                        <span className="text-[11px] text-slate-500 tabular-nums">
                          {c.progress_pct}% · {c.completed_items}/{c.item_count} items
                        </span>
                        <span className="text-xs font-semibold text-primary">Continue →</span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-auto flex justify-between items-center">
                      <span className="text-[11px] text-slate-400">{c.item_count} items</span>
                      <span className="text-xs font-semibold text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                        View course →
                      </span>
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Courses;
