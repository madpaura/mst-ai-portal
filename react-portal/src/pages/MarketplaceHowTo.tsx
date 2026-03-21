import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import 'highlight.js/styles/github-dark.css';
import '../styles/howto-markdown.css';
import { api } from '../api/client';
import { useParams } from 'react-router-dom';

interface ForgeComponent {
  slug: string;
  name: string;
  component_type: string;
  icon: string | null;
  icon_color: string | null;
  version: string;
  author: string | null;
  howto_guide: string | null;
}

export const MarketplaceHowTo: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [comp, setComp] = useState<ForgeComponent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!slug) return;
    api.get<ForgeComponent>(`/forge/components/${slug}`)
      .then(setComp)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [slug]);

  return (
    <div className="bg-[#0f1117] text-slate-100 min-h-screen">
      <div className="max-w-3xl mx-auto px-6 pt-12 pb-24">
        {loading ? (
          <div className="flex items-center justify-center py-32">
            <span className="material-symbols-outlined text-4xl text-slate-500 animate-spin">progress_activity</span>
          </div>
        ) : error || !comp ? (
          <div className="text-center py-32">
            <span className="material-symbols-outlined text-5xl text-slate-600 mb-4 block">error</span>
            <p className="text-slate-500">Component not found.</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="mb-10 pb-8 border-b border-white/10">
              <div className="flex items-center gap-3 mb-3">
                <span className="material-symbols-outlined text-2xl text-primary">{comp.icon || 'smart_toy'}</span>
                <h1 className="text-2xl font-bold text-white">{comp.name}</h1>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span className="capitalize px-2 py-0.5 rounded bg-white/5 border border-white/10">{comp.component_type.replace('_', ' ')}</span>
                <span>{comp.version}</span>
                {comp.author && <span>{comp.author}</span>}
              </div>
            </div>

            {/* How-To content */}
            {comp.howto_guide ? (
              <div className="howto-markdown text-sm text-slate-300 leading-relaxed">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight, rehypeRaw]}
                >
                  {comp.howto_guide}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-slate-500 italic">No how-to guide available for this component.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
};
