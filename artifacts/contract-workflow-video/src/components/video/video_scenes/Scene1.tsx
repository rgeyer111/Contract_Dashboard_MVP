import { motion } from 'framer-motion';
import { Kicker, SceneFrame, WordReveal } from '@/components/video/VideoChrome';

const asset = `${import.meta.env.BASE_URL}assets/contract-paper.png`;

export function Scene1() {
  return (
    <SceneFrame className="scene-one">
      <div style={{ position: 'absolute', top: '20vh', left: '5vw' }}>
        <Kicker>Operations workspace</Kicker>
        <h1 className="headline" style={{ marginTop: '2.8vh' }}>
          <WordReveal delay={0.28}>Stay ahead of</WordReveal>
          <WordReveal delay={0.46} accent><em>renewals.</em></WordReveal>
        </h1>
        <motion.p
          className="subline"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: .65, delay: .92 }}
        >
          One clear view for the agreements that keep your business moving.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, x: -18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: .5, delay: 1.22 }}
          style={{ marginTop: '3.6vh', display: 'flex', alignItems: 'center', gap: '.7vw' }}
        >
          <span className="pill pill-teal">24 active contracts</span>
          <span className="ui-label">No surprises. More leverage.</span>
        </motion.div>
      </div>

      <motion.div
        className="paper-card drift"
        style={{ position: 'absolute', right: '9.5vw', top: '15.2vh', width: '22vw', height: '52vh', backgroundImage: `url(${asset})`, transform: 'rotate(4deg)' }}
        initial={{ opacity: 0, y: 80, rotate: 10, scale: .88 }}
        animate={{ opacity: 1, y: 0, rotate: 4, scale: 1 }}
        transition={{ duration: 1.05, delay: .38, ease: [0.16, 1, .3, 1] }}
      >
        <div className="paper-copy">
          <strong>NORTHSTAR SOURCING AGREEMENT</strong>
          <span>THIS AGREEMENT is made and entered into by and between the parties named herein.</span>
          <span>Term. The initial term shall continue for twelve months from the effective date.</span>
          <span>Renewal. Unless notice is provided, this agreement will automatically renew.</span>
        </div>
        <div className="paper-highlight" style={{ top: '54%', left: '8%', width: '72%' }} />
        <div className="paper-highlight" style={{ top: '67%', left: '16%', width: '58%', opacity: .6 }} />
        <motion.div
          className="pill pill-orange"
          style={{ position: 'absolute', right: '8%', bottom: '9%', zIndex: 2 }}
          initial={{ opacity: 0, scale: .6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 390, damping: 22, delay: 1.45 }}
        >
          Renewal in 47 days
        </motion.div>
      </motion.div>

      <motion.div
        className="annotation"
        style={{ right: '31vw', top: '66vh' }}
        initial={{ opacity: 0, x: 15 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 1.35, duration: .5 }}
      >
        scattered PDFs → one clear view
      </motion.div>
      <motion.div
        className="orb"
        style={{ width: '10vw', height: '10vw', right: '6vw', bottom: '7vh', background: 'rgba(23,139,131,.2)' }}
        animate={{ scale: [1, 1.14, 1], rotate: [0, 12, 0] }}
        transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
      />
    </SceneFrame>
  );
}