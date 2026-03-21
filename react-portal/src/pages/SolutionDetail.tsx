import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import 'highlight.js/styles/github-dark.css';
import '../styles/howto-markdown.css';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import { api } from '../api/client';

interface SolutionCard {
  id: string;
  title: string;
  subtitle: string | null;
  description: string;
  long_description: string | null;
  icon: string;
  icon_color: string;
  badge: string | null;
  link_url: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const SolutionDetail: React.FC = () => {
  const { cardId } = useParams<{ cardId: string }>();
  const navigate = useNavigate();
  const [card, setCard] = useState<SolutionCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cardId) return;
    api.get<SolutionCard>(`/api/solutions/cards/${cardId}`)
      .then(setCard)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [cardId]);

  if (loading) {
    return (
      <div className="bg-background-light dark:bg-background-dark min-h-screen">
        <Navbar variant="solutions" />
        <div className="flex items-center justify-center pt-32">
          <div className="text-slate-400">Loading...</div>
        </div>
      </div>
    );
  }

  if (error || !card) {
    return (
      <div className="bg-background-light dark:bg-background-dark min-h-screen">
        <Navbar variant="solutions" />
        <div className="flex flex-col items-center justify-center pt-32 gap-4">
          <span className="material-symbols-outlined text-5xl text-slate-500">error_outline</span>
          <p className="text-slate-400">{error || 'Solution not found'}</p>
          <button onClick={() => navigate('/')} className="text-primary hover:underline text-sm font-medium">
            Back to Solutions
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 min-h-screen">
      <Navbar variant="solutions" />

      <main className="relative pt-16">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-slate-200 dark:border-primary/10">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-[120px]" />
          <div className="max-w-4xl mx-auto px-6 py-20 relative z-10">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-primary transition-colors mb-8"
            >
              <span className="material-symbols-outlined text-sm">arrow_back</span>
              Back to Solutions
            </button>

            <div className="flex items-center gap-4 mb-6">
              <div className={`w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center ${card.icon_color}`}>
                <span className="material-symbols-outlined text-4xl">{card.icon}</span>
              </div>
              <div>
                <h1 className="text-4xl font-bold text-slate-900 dark:text-white">{card.title}</h1>
                {card.subtitle && (
                  <p className="text-lg text-slate-500 dark:text-slate-400 mt-1">{card.subtitle}</p>
                )}
              </div>
              {card.badge && (
                <span className="px-3 py-1 text-xs font-bold rounded-full bg-primary/10 text-primary border border-primary/20">
                  {card.badge}
                </span>
              )}
            </div>

            <p className="text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-3xl">
              {card.description}
            </p>
          </div>
        </section>

        {/* Content */}
        {card.long_description && (
          <section className="max-w-4xl mx-auto px-6 py-16">
            <div className="howto-markdown text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight, rehypeRaw]}
              >
                {card.long_description}
              </ReactMarkdown>
            </div>
          </section>
        )}

        {/* CTA */}
        <section className="max-w-4xl mx-auto px-6 pb-16">
          <div className="rounded-2xl bg-gradient-to-r from-primary/5 to-blue-500/5 border border-primary/20 p-8 flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Ready to get started?</h3>
              <p className="text-slate-500 dark:text-slate-400">Explore the AI Forge marketplace or start the training.</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => navigate('/marketplace')}
                className="px-6 py-3 bg-primary text-white font-bold rounded-lg hover:bg-blue-500 transition-colors"
              >
                AI Forge
              </button>
              <button
                onClick={() => navigate('/ignite')}
                className="px-6 py-3 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-bold rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-700"
              >
                AI Ignite
              </button>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};
