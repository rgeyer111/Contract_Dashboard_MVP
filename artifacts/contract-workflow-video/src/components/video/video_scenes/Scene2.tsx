import { motion } from 'framer-motion';
import { Cursor, Kicker, SceneFrame, WindowBar, WordReveal } from '@/components/video/VideoChrome';

const rows = [
  ['Northstar Sourcing Agreement', 'Northstar Labs', '17 Oct 2025', 'Review Open'],
  ['Meridian Cloud Services', 'Meridian', '02 Dec 2025', 'Active'],
  ['Ridgeway Facilities Addendum', 'Ridgeway', '12 Jan 2026', 'Active'],
];

export function Scene2() {
  return (
    <SceneFrame className="scene-two">
      <div style={{ position: 'absolute', top: '13.8vh', left: '5vw', zIndex: 2 }}>
        <Kicker>Demo entry</Kicker>
        <h2 className="headline" style={{ fontSize: '4.4vw', marginTop: '2.1vh' }}>
          <WordReveal delay={0.18}>One view.</WordReveal>
          <WordReveal delay={0.36} accent><em>Every renewal.</em></WordReveal>
        </h2>
      </div>

      <motion.div
        className="window"
        style={{ position: 'absolute', left: '22vw', right: '5vw', top: '25.5vh', height: '59vh' }}
        initial={{ opacity: 0, y: 45, rotateX: 8, scale: .96 }}
        animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
        transition={{ duration: .82, delay: .28, ease: [0.16, 1, .3, 1] }}
      >
        <WindowBar />
        <div style={{ display: 'grid', gridTemplateColumns: '11vw 1fr', height: 'calc(100% - 4.4vh)' }}>
          <aside style={{ padding: '2.2vh 1.1vw', borderRight: '1px solid var(--line)', background: 'rgba(239,233,224,.62)' }}>
            <div className="ui-label" style={{ marginBottom: '2.7vh' }}>Workspace</div>
            <div style={{ color: 'var(--orange-deep)', fontFamily: 'var(--display)', fontSize: '.72vw', fontWeight: 700, padding: '.65vw .6vw', borderRadius: '.35vw', background: '#fae1d7' }}>Contracts <span style={{ float: 'right' }}>24</span></div>
            <div style={{ color: 'var(--ink-soft)', fontFamily: 'var(--display)', fontSize: '.72vw', padding: '.72vw .6vw' }}>Needs review <span style={{ float: 'right', color: 'var(--orange)' }}>3</span></div>
            <div style={{ color: 'var(--ink-soft)', fontFamily: 'var(--display)', fontSize: '.72vw', padding: '.72vw .6vw' }}>Archived <span style={{ float: 'right' }}>8</span></div>
            <div style={{ position: 'absolute', bottom: '3vh', left: '1.1vw', right: '1.1vw', paddingTop: '1.5vh', borderTop: '1px solid var(--line)' }}>
              <div className="ui-label">Renewal horizon</div>
              <div style={{ marginTop: '.7vh', color: 'var(--ink)', fontFamily: 'var(--display)', fontSize: '1.5vw', fontWeight: 600 }}>47 days</div>
            </div>
          </aside>
          <main style={{ padding: '2.5vh 1.7vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '2.4vh' }}>
              <div>
                <div className="ui-label">Operations workspace</div>
                <div className="ui-title" style={{ marginTop: '.55vh' }}>Contract Dashboard</div>
              </div>
              <div className="pill pill-teal">Updated just now</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.7vw', marginBottom: '2.3vh' }}>
              {[
                ['24', 'Active contracts', 'up 4 this month'],
                ['3', 'Needs attention', 'renewals soon'],
                ['42', 'Median days out', 'across workspace'],
              ].map(([value, label, note], index) => (
                <motion.div
                  key={label}
                  style={{ padding: '1.1vw', borderRadius: '.5vw', background: index === 1 ? '#fff2ec' : '#f7f3ed', border: '1px solid rgba(25,37,42,.08)' }}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: .65 + index * .13, duration: .4 }}
                >
                  <div style={{ color: index === 1 ? 'var(--orange-deep)' : 'var(--ink)', fontFamily: 'var(--display)', fontSize: '1.8vw', fontWeight: 600, letterSpacing: '-.07em' }}>{value}</div>
                  <div className="ui-label" style={{ marginTop: '.35vh' }}>{label}</div>
                  <div style={{ color: 'var(--ink-soft)', fontSize: '.57vw', marginTop: '.5vh' }}>{note}</div>
                </motion.div>
              ))}
            </div>
            <div style={{ border: '1px solid rgba(25,37,42,.1)', borderRadius: '.55vw', overflow: 'hidden', background: 'rgba(255,253,249,.56)' }}>
              <div className="data-row" style={{ minHeight: '4.2vh', background: '#f5f0e8', color: 'var(--ink-soft)', fontFamily: 'var(--display)', fontSize: '.57vw', fontWeight: 700, textTransform: 'uppercase' }}>
                <span>Contract</span><span>Counterparty</span><span>Renewal</span><span>Status</span>
              </div>
              {rows.map(([name, party, date, status], index) => (
                <motion.div key={name} className="data-row" initial={{ opacity: 0, x: 22 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .93 + index * .16, duration: .42 }}>
                  <div style={{ display: 'flex', gap: '.6vw', alignItems: 'center' }}>
                    <div className="file-icon">PDF</div>
                    <span style={{ color: 'var(--ink)', fontFamily: 'var(--display)', fontSize: '.7vw', fontWeight: 600 }}>{name}</span>
                  </div>
                  <span className="ui-body">{party}</span>
                  <span className="ui-body">{date}</span>
                  <span className={`pill ${index === 0 ? 'pill-orange' : 'pill-teal'}`}>{status}</span>
                </motion.div>
              ))}
            </div>
          </main>
        </div>
        <Cursor className="cursor-dashboard" />
      </motion.div>
      <motion.div
        style={{ position: 'absolute', left: '11vw', bottom: '10vh', color: 'var(--teal)', fontFamily: 'var(--display)', fontSize: '.7vw', fontWeight: 700, letterSpacing: '.04em' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.42 }}
      >
        TRACK THE MOMENT BEFORE IT BECOMES A SURPRISE
      </motion.div>
    </SceneFrame>
  );
}