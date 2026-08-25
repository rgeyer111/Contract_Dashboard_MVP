import { motion } from 'framer-motion';
import { Kicker, SceneFrame, WordReveal } from '@/components/video/VideoChrome';

const asset = `${import.meta.env.BASE_URL}assets/signature-detail.png`;

export function Scene6() {
  return (
    <SceneFrame className="scene-six">
      <motion.div className="paper-card" style={{ position: 'absolute', inset: '8vh 0 0 53vw', opacity: .22, filter: 'saturate(.7)', backgroundImage: `url(${asset})`, transform: 'rotate(4deg) scale(1.1)' }} animate={{ x: [0, -12, 0], y: [0, 8, 0] }} transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }} />
      <div style={{ position: 'absolute', top: '19vh', left: '5vw', width: '34vw' }}>
        <Kicker>Step 04 / confirmation</Kicker>
        <h2 className="headline" style={{ marginTop: '2.5vh', fontSize: '5.2vw' }}>
          <WordReveal delay={.18}>Confirm once.</WordReveal>
          <WordReveal delay={.38} accent><em>Keep moving.</em></WordReveal>
        </h2>
        <motion.p className="subline" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .9, duration: .55 }}>
          A clean, trusted record — ready for the next renewal conversation.
        </motion.p>
      </div>
      <motion.div
        className="window"
        style={{ position: 'absolute', left: '49vw', top: '18vh', width: '38vw', height: '55vh' }}
        initial={{ opacity: 0, y: 42, scale: .9, rotate: 2 }}
        animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
        transition={{ duration: .9, delay: .3, ease: [0.16, 1, .3, 1] }}
      >
        <div className="window-bar">
          <div className="window-dots"><i /><i /><i /></div>
          <span className="window-url">contractdash.app / dashboard</span>
          <span className="ui-label">SAVED</span>
        </div>
        <div style={{ padding: '4vh 2.3vw' }}>
          <motion.div style={{ width: '4.6vw', height: '4.6vw', minWidth: 45, minHeight: 45, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--teal)', color: '#effaf7', fontFamily: 'var(--display)', fontSize: '2vw', fontWeight: 600, boxShadow: '0 .7vw 0 rgba(23,139,131,.16)' }} initial={{ scale: .4, rotate: -20 }} animate={{ scale: [1, 1.08, 1], rotate: 0 }} transition={{ delay: .76, duration: 1.1, ease: [0.16, 1, .3, 1] }}>✓</motion.div>
          <motion.div className="ui-label" style={{ marginTop: '2.8vh', color: 'var(--teal)' }} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.02 }}>Contract confirmed</motion.div>
          <motion.div style={{ marginTop: '.55vh', color: 'var(--ink)', fontFamily: 'var(--display)', fontSize: '1.8vw', fontWeight: 600, letterSpacing: '-.06em' }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.12 }}>Northstar Sourcing Agreement</motion.div>
          <motion.div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75vw', marginTop: '2.5vh' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.35 }}>
            <div className="review-field"><div className="ui-label">Next renewal</div><div className="field-value">17 Oct 2025</div></div>
            <div className="review-field"><div className="ui-label">Owner</div><div className="field-value">Maya Chen</div></div>
          </motion.div>
          <motion.div style={{ display: 'flex', alignItems: 'center', gap: '.6vw', marginTop: '2.4vh', paddingTop: '1.8vh', borderTop: '1px solid var(--line)' }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.58 }}>
            <span className="pill pill-teal">Saved to dashboard</span><span className="ui-body">Your team can pick up from here.</span>
          </motion.div>
        </div>
      </motion.div>
      <motion.div style={{ position: 'absolute', left: '5vw', bottom: '12vh', display: 'flex', alignItems: 'center', gap: '.8vw' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.55 }}>
        <div className="brand-mark">C</div><span style={{ color: 'var(--ink)', fontFamily: 'var(--display)', fontSize: '.82vw', fontWeight: 600 }}>Contract Dashboard</span><span style={{ color: 'var(--ink-soft)', fontSize: '.72vw' }}>for operations teams</span>
      </motion.div>
    </SceneFrame>
  );
}