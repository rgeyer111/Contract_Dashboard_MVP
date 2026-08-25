import { motion } from 'framer-motion';
import { Kicker, SceneFrame, WordReveal } from '@/components/video/VideoChrome';

const asset = `${import.meta.env.BASE_URL}assets/contract-paper.png`;
const facts = [
  ['Counterparty', 'Northstar Labs', '98%'],
  ['Renewal date', '17 Oct 2025', '94%'],
  ['Owner', 'Maya Chen', '87%'],
  ['Contract value', '$84,600 USD', '71%'],
];

export function Scene4() {
  return (
    <SceneFrame className="scene-four">
      <div style={{ position: 'absolute', top: '12.5vh', left: '5vw', width: '34vw' }}>
        <Kicker>Step 02 / live extraction</Kicker>
        <h2 className="headline" style={{ fontSize: '4.4vw', marginTop: '2.1vh' }}>
          <WordReveal delay={.14}>The busywork</WordReveal>
          <WordReveal delay={.32} accent><em>disappears.</em></WordReveal>
        </h2>
      </div>
      <motion.div
        className="pill pill-teal"
        style={{ position: 'absolute', top: '14.2vh', right: '8vw' }}
        initial={{ opacity: 0, scale: .7 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 330, damping: 22, delay: .35 }}
      >
        <span className="pulse" style={{ width: '.45vw', height: '.45vw', minWidth: 5, minHeight: 5, display: 'inline-block', borderRadius: '50%', background: 'var(--teal)' }} /> AI extraction live
      </motion.div>

      <motion.div
        className="window"
        style={{ position: 'absolute', left: '10vw', right: '6vw', top: '29vh', height: '54vh' }}
        initial={{ opacity: 0, y: 38, scale: .96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: .8, delay: .24, ease: [0.16, 1, .3, 1] }}
      >
        <div className="window-bar">
          <div className="window-dots"><i /><i /><i /></div>
          <span className="window-url">northstar_msa.pdf · processing</span>
          <span className="ui-label">AI READ</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '43% 57%', height: 'calc(100% - 4.4vh)' }}>
          <div style={{ position: 'relative', padding: '3vh 2.2vw', borderRight: '1px solid var(--line)', background: 'rgba(239,233,224,.55)' }}>
            <div className="ui-label">Source document</div>
            <div className="paper-card" style={{ marginTop: '1.8vh', height: '38vh', backgroundImage: `url(${asset})`, transform: 'rotate(-2deg)' }}>
              <div className="paper-copy" style={{ top: '14%' }}>
                <strong>MASTER SERVICES AGREEMENT</strong>
                <span>THIS AGREEMENT is made by Northstar Labs and the customer named below.</span>
                <span>Term and renewal provisions are set forth in Section 4.</span>
                <span>Fees: the annual contract value shall be paid in twelve installments.</span>
                <span>Notices shall be provided to the owner on file.</span>
              </div>
              <div className="paper-highlight" style={{ top: '43%', left: '8%', width: '76%' }} />
              <div className="paper-highlight" style={{ top: '66%', left: '19%', width: '62%', opacity: .52 }} />
              <motion.div className="scan-line" initial={{ top: '10%' }} animate={{ top: ['9%', '83%', '9%'] }} transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', delay: .9 }} />
            </div>
          </div>
          <div style={{ padding: '3vh 2vw' }}>
            <div className="ui-label">Extracted fields</div>
            <div style={{ marginTop: '1.3vh', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.7vw' }}>
              {facts.map(([label, value, confidence], index) => (
                <motion.div key={label} className="review-field" initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .65 + index * .2, duration: .42 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="ui-label">{label}</span>
                    <span style={{ color: index === 3 ? 'var(--orange-deep)' : 'var(--teal)', fontFamily: 'var(--display)', fontSize: '.56vw', fontWeight: 700 }}>{confidence}</span>
                  </div>
                  <div className="field-value">{value}</div>
                  <div className="mini-bar" style={{ marginTop: '.9vh' }}><div className="mini-bar-fill" style={{ width: confidence, background: index === 3 ? 'var(--orange)' : 'var(--teal)' }} /></div>
                </motion.div>
              ))}
            </div>
            <motion.div style={{ marginTop: '2vh', padding: '1.1vw', background: '#f7f3ed', borderRadius: '.5vw', border: '1px solid var(--line)', display: 'flex', gap: '.8vw', alignItems: 'center' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.72 }}>
              <div className="checkmark" style={{ width: '1.3vw', height: '1.3vw', fontSize: '.6vw', background: 'var(--orange)' }}>AI</div>
              <div><div style={{ color: 'var(--ink)', fontFamily: 'var(--display)', fontSize: '.72vw', fontWeight: 600 }}>Key terms found</div><div className="ui-body">4 fields ready for a human look.</div></div>
            </motion.div>
          </div>
        </div>
      </motion.div>
    </SceneFrame>
  );
}