import { useCallback, useEffect, useState } from 'react';
import type { RunResult } from './engine/game';
import type { PathId } from './engine/types';
import { lessonById, lessonsInPath } from './content/lessons';
import { loadProgress, recordResult, saveProgress } from './state/progress';
import type { Progress } from './state/progress';
import { decodeAudioBytes } from './engine/transcribe';
import { fitToContext } from './engine/stretch';
import { sharedAudio } from './engine/audio';
import { getSong } from './engine/songstore';
import type { SongChart } from './engine/transcribe';
import Home from './ui/Home';
import LessonList from './ui/LessonList';
import PlayView from './ui/PlayView';
import ResultsView from './ui/ResultsView';
import KitSetup from './ui/KitSetup';
import SongLibrary from './ui/SongLibrary';

type View =
  | { name: 'home' }
  | { name: 'path'; pathId: PathId }
  | { name: 'play'; lessonId: string }
  | { name: 'kit' }
  | { name: 'songs' }
  | { name: 'songplay'; songId: string }
  | { name: 'results'; lessonId: string; result: RunResult; title?: string };

export default function App() {
  const [progress, setProgress] = useState<Progress>(loadProgress);
  const [view, setView] = useState<View>({ name: 'home' });
  const [prevBest, setPrevBest] = useState<number | null>(null);

  const handleFinish = useCallback((r: RunResult, title?: string) => {
    const isPerformance = r.mode === 'performance';
    setPrevBest(isPerformance ? (loadProgress().lessons[r.lessonId]?.bestAcc ?? 0) : null);
    setProgress((p) => {
      const next = recordResult(p, r.lessonId, r, isPerformance);
      saveProgress(next);
      return next;
    });
    setView({ name: 'results', lessonId: r.lessonId, result: r, title });
  }, []);

  if (view.name === 'home') {
    return (
      <Home
        progress={progress}
        onPath={(pathId) => setView({ name: 'path', pathId })}
        onKit={() => setView({ name: 'kit' })}
        onSongs={() => setView({ name: 'songs' })}
      />
    );
  }

  if (view.name === 'path') {
    return (
      <LessonList
        pathId={view.pathId}
        progress={progress}
        onBack={() => setView({ name: 'home' })}
        onPlay={(lessonId) => setView({ name: 'play', lessonId })}
      />
    );
  }

  if (view.name === 'kit') {
    return <KitSetup onBack={() => setView({ name: 'home' })} />;
  }

  if (view.name === 'songs') {
    return (
      <SongLibrary
        progress={progress}
        onBack={() => setView({ name: 'home' })}
        onPlay={(songId) => setView({ name: 'songplay', songId })}
      />
    );
  }

  if (view.name === 'songplay') {
    return (
      <SongPlay
        songId={view.songId}
        onFinish={(r, title) => handleFinish(r, title)}
        onQuit={() => setView({ name: 'songs' })}
      />
    );
  }

  const lesson = view.name === 'play' || view.name === 'results' ? lessonById(view.lessonId) : undefined;

  if (view.name === 'play' && lesson) {
    return (
      <PlayView
        lesson={lesson}
        song={null}
        onFinish={handleFinish}
        onQuit={() => setView({ name: 'home' })}
      />
    );
  }

  if (view.name === 'results') {
    const title = view.title ?? lesson?.title ?? 'Song';
    if (lesson) {
      const siblings = lessonsInPath(lesson.pathId);
      const idx = siblings.findIndex((l) => l.id === lesson.id);
      const nextLesson = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
      return (
        <ResultsView
          title={title}
          result={view.result}
          isBest={prevBest !== null && view.result.accuracy > prevBest && view.result.mode === 'performance'}
          nextLabel={nextLesson ? `Next: ${nextLesson.title}` : undefined}
          onRetry={() => setView({ name: 'play', lessonId: lesson.id })}
          onNext={() => nextLesson && setView({ name: 'play', lessonId: nextLesson.id })}
          onHome={() => setView({ name: 'home' })}
        />
      );
    }
    // song results
    return (
      <ResultsView
        title={title}
        result={view.result}
        isBest={prevBest !== null && view.result.accuracy > prevBest && view.result.mode === 'performance'}
        onRetry={() => setView({ name: 'songplay', songId: view.lessonId })}
        onHome={() => setView({ name: 'songs' })}
        homeLabel="My songs"
      />
    );
  }

  return null;
}

function SongPlay({
  songId,
  onFinish,
  onQuit,
}: {
  songId: string;
  onFinish: (r: RunResult, title?: string) => void;
  onQuit: () => void;
}) {
  const [loaded, setLoaded] = useState<{ chart: SongChart; buffer: AudioBuffer; title: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await getSong(songId);
        if (!s) throw new Error('Song not found — it may have been deleted.');
        const decoded = await decodeAudioBytes(s.bytes);
        // playback context may run at 24/48k — resample so SongTouch and the
        // plain fallback both play at true speed
        const buffer = await fitToContext(decoded, sharedAudio.sampleRate());
        if (!cancelled) setLoaded({ chart: s.chart, buffer, title: s.title });
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [songId]);

  if (err) {
    return (
      <div className="app">
        <div className="card" style={{ marginTop: 40, textAlign: 'center' }}>
          <p style={{ color: 'var(--red)' }}>{err}</p>
          <button type="button" className="btn primary" onClick={onQuit}>
            Back to songs
          </button>
        </div>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="app">
        <p style={{ color: 'var(--muted)', marginTop: 40 }}>Loading song…</p>
      </div>
    );
  }
  return (
    <PlayView
      lesson={null}
      song={loaded}
      onFinish={(r) => onFinish(r, loaded.title)}
      onQuit={onQuit}
    />
  );
}
