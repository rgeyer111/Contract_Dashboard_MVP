import { AnimatePresence, motion } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { BrandLockup, SceneIndex } from '@/components/video/VideoChrome';
import { Scene1 } from '@/components/video/video_scenes/Scene1';
import { Scene2 } from '@/components/video/video_scenes/Scene2';
import { Scene3 } from '@/components/video/video_scenes/Scene3';
import { Scene4 } from '@/components/video/video_scenes/Scene4';
import { Scene5 } from '@/components/video/video_scenes/Scene5';
import { Scene6 } from '@/components/video/video_scenes/Scene6';

const SCENE_DURATIONS: Record<string, number> = {
  entry: 4800,
  dashboard: 5600,
  upload: 5200,
  extraction: 6200,
  review: 6500,
  confirmation: 5200,
};

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });
  const sceneBackgrounds = ['#f3efe7', '#f3efe7', '#edf3ef', '#f2efe7', '#f4eee7', '#ebf3ef'];
  const sceneKey = Object.keys(SCENE_DURATIONS)[currentScene];
  const scenes = [<Scene1 />, <Scene2 />, <Scene3 />, <Scene4 />, <Scene5 />, <Scene6 />];

  return (
    <main className="video-root" style={{ background: sceneBackgrounds[currentScene] }}>
      <motion.div
        className="backdrop"
        animate={{
          background: [
            'radial-gradient(circle at 75% 12%, rgba(245,196,107,.26), transparent 27%), radial-gradient(circle at 18% 86%, rgba(23,139,131,.16), transparent 28%), linear-gradient(130deg, #f3efe7 0%, #f5f0e9 52%, #ebe5da 100%)',
            'radial-gradient(circle at 60% 48%, rgba(230,110,75,.18), transparent 27%), radial-gradient(circle at 12% 80%, rgba(23,139,131,.2), transparent 32%), linear-gradient(130deg, #f3efe7 0%, #f5f0e9 52%, #ebe5da 100%)',
          ],
        }}
        transition={{ duration: 7, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
      >
        <div className="backdrop-grid" />
        <motion.div className="orb orb-a" animate={{ x: ['0vw', '-3vw', '1vw'], y: ['0vh', '3vh', '-1vh'] }} transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }} />
        <motion.div className="orb orb-b" animate={{ x: ['0vw', '3vw', '-1vw'], y: ['0vh', '-2vh', '2vh'] }} transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }} />
        <motion.div className="orb orb-c" animate={{ x: ['0vw', '5vw', '-2vw'], y: ['0vh', '-3vh', '1vh'] }} transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }} />
      </motion.div>

      <BrandLockup />
      <SceneIndex currentScene={currentScene} />
      <div aria-label={`Scene: ${sceneKey}`}>
        <AnimatePresence mode="sync" initial={false}>
          <motion.div
            key={sceneKey}
            style={{ position: 'absolute', inset: 0 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: .32, ease: 'easeOut' }}
          >
            {scenes[currentScene]}
          </motion.div>
        </AnimatePresence>
      </div>
    </main>
  );
}