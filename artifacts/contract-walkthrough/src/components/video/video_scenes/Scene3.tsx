import { motion } from 'framer-motion';
import { Kicker, SceneFrame, WordReveal } from '@/components/video/VideoChrome';

const asset = `${import.meta.env.BASE_URL}assets/contract-paper.png`;

export function Scene3() {
  return (
    <SceneFrame className="scene-three">
      <div style={{ position: 'absolute', top: '18vh', left: '5vw', width: '26vw' }}>
        <Kicker>Step 01 / add a contract</Kicker>
        <h2 className="headline" style={{ marginTop: '2.4vh', fontSize: '5vw' }}>
          <WordReveal delay={.16}>Drop in</WordReveal>
          <WordReveal delay={.35} accent><em>the PDF.</em></WordReveal>
        </h2>
        <motion.p className="subline" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .72, duration: .55 }}>
          Start with the document you already have. The workspace handles the rest.
        </motion.p>
      </div>
      <motion.div
        className="paper-card"
        style={{ position: 'absolute', left: '39vw', top: '18vh', width: '19vw', height: '57vh', backgroundImage: `url(${asset})`, transform: 'rotate(-5deg)' }}
        initial={{ opacity: 0, x: -30, rotate: -13, scale: .86 }}
        animate={{ opacity: 1, x: 0, rotate: -5, scale: 1 }}
        transition={{ duration: .78, delay: .3, ease: [0.16, 1, .3, 1] }}
      >
        <div className="paper-copy">
          <strong>MSA / NORTHSTAR LABS</strong>
          <span>MASTER SERVICES AGREEMENT</span>
          <span>Effective date: 17 October 2024</span>
          <span>Service terms and conditions follow below.</span>
          <span>Renewal notice must be delivered in writing.</span>
        </div>
        <div className="paper-highlight" style={{ top: '36%', left: '9%', width: '63%' }} />
        <div className="paper-highlight" style={{ top: '52%', left: '17%', width: '74%', opacity: .5 }} />
      </motion.div>
      <motion.div
        className="window"
        style={{ position: 'absolute', left: '57vw', top: '23vh', width: '32vw', height: '46vh', background: 'rgba(250,248,243,.9)' }}
        initial={{ opacity: 0, x: 45, scale: .88 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        transition={{ duration: .8, delay: .55, ease: [0.16, 1, .3, 1] }}
      >
        <div style={{ padding: '3vh 2vw' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div className="ui-label">New contract</div>
              <div className="ui-title" style={{ marginTop: '.5vh' }}>Upload document</div>
            </div>
            <motion.div className="pill pill-teal" animate={{ opacity: [0.65, 1, .65] }} transition={{ duration: 1.8, repeat: Infinity }}>PDF</motion.div>
          </div>
          <motion.div
            style={{ marginTop: '3vh', height: '23vh', border: '1.5px dashed rgba(23,139,131,.6)', borderRadius: '.7vw', background: 'rgba(216,238,234,.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1.2vh', overflow: 'hidden' }}
            initial={{ opacity: 0, scale: .94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: .82, duration: .45 }}
          >
            <motion.div style={{ width: '3.2vw', height: '3.2vw', borderRadius: '.6vw', background: 'var(--teal)', color: '#effaf7', display: 'grid', placeItems: 'center', fontFamily: 'var(--display)', fontSize: '.7vw', fontWeight: 700 }} animate={{ y: [0, -6, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}>PDF</motion.div>
            <div style={{ color: 'var(--ink)', fontFamily: 'var(--display)', fontSize: '.9vw', fontWeight: 600 }}>Northstar MSA.pdf</div>
            <div className="ui-body">2.4 MB · ready to read</div>
            <motion.div className="scan-line shimmer" style={{ top: '25%' }} />
          </motion.div>
          <motion.div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2vh' }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.24 }}>
            <span className="ui-label">Document attached</span>
            <span className="pill pill-orange">Ready to extract</span>
          </motion.div>
        </div>
      </motion.div>
      <motion.div className="annotation" style={{ left: '55vw', bottom: '17vh' }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.48 }}>
        no renaming. no reformatting.
      </motion.div>
    </SceneFrame>
  );
}