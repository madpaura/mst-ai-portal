import React, { useState } from 'react';
import { api, isLoggedIn } from '../api/client';

export interface CourseInfo {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  video_count: number;
  thumbnail: string | null;
}

export interface CourseProgress {
  course_id: string;
  course_slug: string;
  course_title?: string;
  total_videos: number;
  completed_videos: number;
  progress_pct: number;
  is_enrolled: boolean;
}

interface VideoPreview {
  id: string;
  slug: string;
  title: string;
  category: string;
  duration_s: number | null;
  thumbnail: string | null;
  sort_order: number;
}

interface CourseBrowserProps {
  courses: CourseInfo[];
  courseProgress?: Record<string, CourseProgress>;
  onEnroll?: (course: CourseInfo) => Promise<void>;
  onEnrollAll?: () => Promise<void>;
  onStartCourse: (courseSlug: string) => void;
  enrollingId?: string | null;
}

const formatDuration = (s: number | null): string => {
  if (!s) return '–';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

export const CourseBrowser: React.FC<CourseBrowserProps> = ({
  courses,
  courseProgress = {},
  onEnroll,
  onEnrollAll,
  onStartCourse,
  enrollingId = null,
}) => {
  const [selectedCourse, setSelectedCourse] = useState<CourseInfo | null>(null);
  const [previewVideos, setPreviewVideos] = useState<VideoPreview[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [enrollingAll, setEnrollingAll] = useState(false);

  const enrolledCount = courses.filter((c) => courseProgress[c.id]?.is_enrolled).length;
  const allEnrolled = enrolledCount === courses.length && courses.length > 0;

  const handleSelectCourse = async (course: CourseInfo) => {
    setSelectedCourse(course);
    setPreviewVideos([]);
    setPreviewLoading(true);
    try {
      const data = await api.get<{ videos: VideoPreview[] }>(`/video/courses/${course.slug}`);
      setPreviewVideos(data.videos);
    } catch {
      setPreviewVideos([]);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleEnrollAll = async () => {
    if (!isLoggedIn() || enrollingAll || !onEnrollAll) return;
    setEnrollingAll(true);
    await onEnrollAll();
    setEnrollingAll(false);
  };

  const apiBase = import.meta.env.VITE_API_URL || '';

  if (selectedCourse) {
    const cp = courseProgress[selectedCourse.id];
    const isEnrolled = cp?.is_enrolled ?? false;
    const thumb = selectedCourse.thumbnail
      ? `${apiBase}${selectedCourse.thumbnail}`
      : null;

    return (
      <div className="max-w-4xl mx-auto">
        {/* Back */}
        <button
          onClick={() => setSelectedCourse(null)}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-primary transition-colors mb-6"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          All Courses
        </button>

        {/* Course hero */}
        <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-white/10 bg-card-light dark:bg-card-dark mb-6">
          {thumb && (
            <div className="w-full h-48 overflow-hidden">
              <img src={thumb} alt={selectedCourse.title} className="w-full h-full object-cover" />
            </div>
          )}
          <div className="p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex-1">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">{selectedCourse.title}</h1>
                {selectedCourse.description && (
                  <p className="text-sm text-slate-500 leading-relaxed">{selectedCourse.description}</p>
                )}
              </div>
              <div className="shrink-0 flex flex-col items-end gap-2">
                <span className="text-xs text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-full">
                  {selectedCourse.video_count} {selectedCourse.video_count === 1 ? 'video' : 'videos'}
                </span>
                {isEnrolled && cp.total_videos > 0 && (
                  <span className="text-xs font-bold text-primary">{cp.progress_pct}% complete</span>
                )}
              </div>
            </div>

            {/* Progress bar */}
            {isEnrolled && cp.total_videos > 0 && (
              <div className="mb-4">
                <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{ width: `${cp.progress_pct}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-400 mt-1">{cp.completed_videos}/{cp.total_videos} completed</p>
              </div>
            )}

            <div className="flex gap-3">
              {isLoggedIn() && onEnroll && (
                <button
                  onClick={() => onEnroll(selectedCourse)}
                  disabled={enrollingId === selectedCourse.id}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                    isEnrolled
                      ? 'bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-rose-500/10 hover:border-rose-500/30 hover:text-rose-400'
                      : 'bg-primary hover:bg-blue-500 text-white'
                  } disabled:opacity-50`}
                >
                  <span className="material-symbols-outlined text-[18px]"
                    style={{ fontVariationSettings: isEnrolled ? "'FILL' 1" : "'FILL' 0" }}
                  >
                    {enrollingId === selectedCourse.id ? 'progress_activity' : 'bookmark'}
                  </span>
                  {enrollingId === selectedCourse.id ? 'Saving...' : isEnrolled ? 'Subscribed' : 'Subscribe'}
                </button>
              )}
              {previewVideos.length > 0 && (
                <button
                  onClick={() => onStartCourse(selectedCourse.slug)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary rounded-xl text-sm font-bold transition-all"
                >
                  <span className="material-symbols-outlined text-[18px]">play_circle</span>
                  Start Learning
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Video list */}
        <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-3">
          Course Content
        </h2>
        {previewLoading ? (
          <div className="flex items-center justify-center py-12">
            <span className="material-symbols-outlined text-2xl text-slate-400 animate-spin">progress_activity</span>
          </div>
        ) : previewVideos.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No videos published yet.</p>
        ) : (
          <div className="space-y-2">
            {previewVideos.map((v, idx) => {
              const vThumb = v.thumbnail ? `${apiBase}${v.thumbnail}` : null;
              return (
                <div
                  key={v.id}
                  className="flex items-center gap-4 p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-card-light dark:bg-card-dark"
                >
                  <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-500 shrink-0">
                    {idx + 1}
                  </div>
                  {vThumb ? (
                    <img src={vThumb} alt={v.title} className="w-16 h-10 object-cover rounded-lg shrink-0" />
                  ) : (
                    <div className="w-16 h-10 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-sm text-slate-400">play_circle</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{v.title}</p>
                    <p className="text-[11px] text-slate-400">{v.category} · {formatDuration(v.duration_s)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Available Courses</h1>
          <p className="text-sm text-slate-500 mt-1">
            {enrolledCount > 0
              ? `You're subscribed to ${enrolledCount} of ${courses.length} courses`
              : 'Subscribe to courses to start learning'}
          </p>
        </div>
        {isLoggedIn() && !allEnrolled && courses.length > 0 && (
          <button
            onClick={handleEnrollAll}
            disabled={enrollingAll}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-blue-500 text-white text-sm font-bold rounded-xl transition-all disabled:opacity-50"
          >
            {enrollingAll ? (
              <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-[18px]">bookmarks</span>
            )}
            {enrollingAll ? 'Subscribing...' : 'Interested in All'}
          </button>
        )}
        {allEnrolled && courses.length > 0 && (
          <span className="flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/20 text-green-500 text-sm font-bold rounded-xl">
            <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            Subscribed to all
          </span>
        )}
      </div>

      {/* Course grid */}
      {courses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <span className="material-symbols-outlined text-6xl text-slate-300 dark:text-slate-600 mb-4">school</span>
          <h2 className="text-xl font-bold text-slate-400 dark:text-slate-500 mb-2">No Courses Available</h2>
          <p className="text-sm text-slate-400 dark:text-slate-500">Courses will appear here once created by an admin.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {courses.map((course) => {
            const cp = courseProgress[course.id];
            const isEnrolled = cp?.is_enrolled ?? false;
            const thumb = course.thumbnail ? `${apiBase}${course.thumbnail}` : null;

            return (
              <div
                key={course.id}
                onClick={() => handleSelectCourse(course)}
                className="group cursor-pointer rounded-2xl border border-slate-200 dark:border-white/10 bg-card-light dark:bg-card-dark overflow-hidden hover:border-primary/30 hover:shadow-lg transition-all duration-200"
              >
                {/* Thumbnail */}
                <div className="w-full h-40 bg-slate-100 dark:bg-slate-800 overflow-hidden relative">
                  {thumb ? (
                    <img src={thumb} alt={course.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="material-symbols-outlined text-5xl text-slate-300 dark:text-slate-600">school</span>
                    </div>
                  )}
                  {isEnrolled && (
                    <div className="absolute top-2 right-2 px-2 py-1 bg-primary/90 text-white text-[10px] font-bold rounded-full flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>bookmark</span>
                      Subscribed
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="p-4">
                  <h3 className="font-bold text-slate-900 dark:text-white text-base mb-1 group-hover:text-primary transition-colors line-clamp-2">
                    {course.title}
                  </h3>
                  {course.description && (
                    <p className="text-xs text-slate-500 leading-relaxed mb-3 line-clamp-2">{course.description}</p>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">play_circle</span>
                      {course.video_count} videos
                    </span>
                    {isEnrolled && cp.total_videos > 0 && (
                      <span className="text-xs font-bold text-primary">{cp.progress_pct}%</span>
                    )}
                  </div>

                  {/* Progress bar */}
                  {isEnrolled && cp.total_videos > 0 && (
                    <div className="mt-2 w-full h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${cp.progress_pct}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
