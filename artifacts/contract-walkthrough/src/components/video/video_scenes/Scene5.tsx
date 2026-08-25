import { motion } from 'framer-motion';
import { Cursor, Kicker, SceneFrame, WordReveal } from '@/components/video/VideoChrome';

const asset = `${import.meta.env.BASE_URL}assets/signature-detail.png`;

export function Scene5() {
  return (
    <SceneFrame className="scene-five">
      <div style={{ position: 'absolute', top: '16vh', left: '5vw', width: '31vw' }}>
        <Kicker>Step 03 / confidence-aware review</Kicker>
        <h2 className="headline" style={{ fontSize: '4.4vw', marginTop: '2.1vh' }}>
          <WordReveal delay={.16}>Confidence</WordReveal>
          <WordReveal delay={.34} accent><em>is visible.</em></WordReveal>
        </h2>
        <motion.p className="subline" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .82, duration: .5 }}>
          Review what the model knows — and what deserves your attention.
        </motion.p>
      </div>
      <motion.div
        className="paper-card"
        style={{ position: 'absolute', right: '7vw', bottom: '12vh', width: '15vw', height: '18vh', backgroundImage: `url(${asset})`, transform: 'rotate(8deg)', opacity: .85 }}
        initial={{ opacity: 0, x: 35, rotate: 18 }}
        animate={{ opacity: .85, x: 0, rotate: 8 }}
        transition={{ duration: .7, delay: .55 }}
      />
      <motion.div
        className="window"
        style={{ position: 'absolute', left: '38vw', right: '8vw', top: '16vh', height: '68vh' }}
        initial={{ opacity: 0, x: 42, rotateY: 8, scale: .96 }}
        animate={{ opacity: 1, x: 0, rotateY: 0, scale: 1 }}
        transition={{ duration: .88, delay: .2, ease: [0.16, 1, .3, 1] }}
      >
        <div className="window-bar">
          <div className="window-dots"><i /><i /><i /></div>
          <span className="window-url">review / northstar_msa.pdf</span>
          <span className="ui-label">REVIEW OPEN</span>
        </div>
        <div style={{ padding: '2.8vh 2vw' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end' }}>
            <div><div className="ui-label">Review contract</div><div className="ui-title" style={{ marginTop: '.45vh' }}>Northstar Sourcing Agreement</div></div>
            <div className="pill pill-orange">3 values to verify</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75vw', marginTop: '2.5vh' }}>
            <div className="review-field"><div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="ui-label">Counterparty</span><span className="pill pill-teal" style={{ padding: '.2vw .42vw' }}>98% sure</span></div><div className="field-value">Northstar Labs</div></div>
            <div className="review-field"><div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="ui-label">Renewal date</span><span className="pill pill-teal" style={{ padding: '.2vw .42vw' }}>94% sure</span></div><div className="field-value">17 Oct 2025</div></div>
            <div className="review-field low"><div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="ui-label">Contract value</span><span className="pill pill-orange" style={{ padding: '.2vw .42vw' }}>71% sure</span></div><div className="field-value">$84,600 USD</div><div style={{ marginTop: '.8vh', color: 'var(--orange-deep)', fontSize: '.56vw', fontWeight: 600 }}>Check this value against the source</div></div>
            <div className="review-field"><div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="ui-label">Owner</span><span className="pill pill-yellow" style={{ padding: '.2vw .42vw' }}>87% sure</span></div><div className="field-value">Maya Chen</div></div>
          </div>
          <div style={{ marginTop: '2.4vh', padding: '1.25vw', borderRadius: '.55vw', background: '#f7f3ed', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div className="ui-label">Model confidence</div><div style={{ color: 'var(--ink)', fontFamily: 'var(--display)', fontSize: '1.15vw', fontWeight: 600 }}>87.5% average</div></div>
            <div style={{ marginTop: '1.2vh', height: '.65vw', minHeight: 7, borderRadius: 99, background: '#e6e0d5', overflow: 'hidden' }}><motion.div style={{ height: '100%', width: '87.5%', borderRadius: 99, background: 'linear-gradient(90deg, var(--teal) 0 72%, var(--yellow) 72% 100%)', transformOrigin: 'left' }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 1.1, delay: 1.1 }} /></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '.8vh', color: 'var(--ink-soft)', fontSize: '.58vw' }}><span>High confidence</span><span>Needs a look</span></div>
          </div>
          <motion.div style={{ display: 'flex', alignItems: 'center', gap: '.7vw', marginTop: '2vh' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.62 }}>
            <div className="checkmark">✓</div><div><div style={{ color: 'var(--ink)', fontFamily: 'var(--display)', fontSize: '.78vw', fontWeight: 600 }}>Editable by design</div><div className="ui-body">Your team stays in control of the final record.</div></div>
          </motion.div>
        </div>
        <Cursor className="cursor-review" />
      </motion.div>
      <motion.div className="annotation" style={{ left: '26vw', bottom: '12vh', transform: 'rotate(-7deg)' }} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.5 }}>
        never hide the maybe
      </motion.div>
    </SceneFrame>
  );
}