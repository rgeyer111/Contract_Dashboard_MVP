import { type ReactNode } from 'react';
import { motion } from 'framer-motion';

export function BrandLockup() {
  return (
    <div className="brand-lockup">
      <div className="brand-mark">C</div>
      <span>Contract <em>Dash</em></span>
    </div>
  );
}

export function SceneIndex({ currentScene }: { currentScene: number }) {
  return (
    <motion.div
      className="scene-index"
      animate={{ opacity: [0.65, 1, 0.65] }}
      transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
    >
      {String(currentScene + 1).padStart(2, '0')} / 06
    </motion.div>
  );
}

export function WindowBar({ label = 'contractdash.app' }: { label?: string }) {
  return (
    <div className="window-bar">
      <div className="window-dots" aria-hidden="true">
        <i /><i /><i />
      </div>
      <span className="window-url">{label}</span>
      <span className="ui-label">LIVE VIEW</span>
    </div>
  );
}

export function SceneFrame({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.section
      className={`scene ${className}`}
      initial={{ opacity: 0, clipPath: 'polygon(0 0, 100% 0, 100% 0, 0 0)' }}
      animate={{ opacity: 1, clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)' }}
      exit={{ opacity: 0, clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)', scale: 1.025 }}
      transition={{ duration: 0.72, ease: [0.76, 0, 0.24, 1] }}
    >
      {children}
    </motion.section>
  );
}

export function Kicker({ children }: { children: ReactNode }) {
  return (
    <motion.div
      className="eyebrow"
      initial={{ opacity: 0, x: -18 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.42, delay: 0.14 }}
    >
      {children}
    </motion.div>
  );
}

export function WordReveal({
  children,
  delay = 0,
  accent = false,
}: {
  children: ReactNode;
  delay?: number;
  accent?: boolean;
}) {
  return (
    <motion.span
      style={{ display: 'block' }}
      className={accent ? 'headline-accent' : undefined}
      initial={{ opacity: 0, y: 55, rotateX: -25 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.span>
  );
}

export function Cursor({ className = '' }: { className?: string }) {
  return <motion.div className={`cursor ${className}`} animate={{ scale: [1, .82, 1] }} transition={{ duration: 1.1, repeat: Infinity }} />;
}