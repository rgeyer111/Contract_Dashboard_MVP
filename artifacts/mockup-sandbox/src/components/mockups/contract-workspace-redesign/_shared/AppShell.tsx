import { Bell, ClipboardList, FileText, LayoutDashboard, Settings2, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import "../_group.css";

export const contracts = [
  { name: "Northstar Analytics", type: "Data platform · MSA", value: "$184,000 / yr", renewal: "14 Mar 2025", notice: "17 days", owner: "Maya Chen", initials: "MC", status: "critical", issues: 3, tag: "Notice window" },
  { name: "Juniper Health", type: "Benefits administration", value: "$96,500 / yr", renewal: "28 Apr 2025", notice: "62 days", owner: "Ravi Shah", initials: "RS", status: "watch", issues: 1, tag: "Price uplift" },
  { name: "Lattice & Co.", type: "Outside counsel", value: "$72,000 / yr", renewal: "02 Jun 2025", notice: "97 days", owner: "Maya Chen", initials: "MC", status: "healthy", issues: 0, tag: "Reviewed" },
  { name: "Porter Freight", type: "Logistics services", value: "$248,700 / yr", renewal: "18 Jul 2025", notice: "143 days", owner: "Theo Grant", initials: "TG", status: "watch", issues: 2, tag: "Owner needed" },
  { name: "Cinder Labs", type: "Security monitoring", value: "$41,200 / yr", renewal: "30 Aug 2025", notice: "186 days", owner: "Elena Ortiz", initials: "EO", status: "healthy", issues: 0, tag: "Reviewed" },
  { name: "Bluebird Office", type: "Workplace services", value: "$31,800 / yr", renewal: "11 Oct 2025", notice: "228 days", owner: "Theo Grant", initials: "TG", status: "healthy", issues: 0, tag: "Reviewed" },
  { name: "Kestrel Cloud", type: "Infrastructure", value: "$312,400 / yr", renewal: "09 Jan 2026", notice: "318 days", owner: "Ravi Shah", initials: "RS", status: "watch", issues: 1, tag: "Missing exhibit" },
];

type ShellProps = { active: "overview" | "actions" | "review"; eyebrow: string; title: string; subtitle: string; children: ReactNode };

export function AppShell({ active, eyebrow, title, subtitle, children }: ShellProps) {
  const nav = [
    { id: "overview", label: "Portfolio", icon: LayoutDashboard },
    { id: "actions", label: "Action queue", icon: ClipboardList, count: 5 },
  ];
  return <div className="contract-cockpit min-h-[100dvh] flex">
    <aside className="w-[232px] shrink-0 bg-[#edf2eb] border-r hairline p-5 flex flex-col">
      <div className="flex items-center gap-3 pb-8">
        <div className="h-9 w-9 rounded-[10px] bg-[#173f3c] text-[#d7f2e9] grid place-items-center"><ShieldCheck size={19}/></div>
        <div><div className="font-extrabold tracking-[-.03em] leading-none">Keel</div><div className="text-[10px] font-semibold tracking-[.14em] uppercase text-[#71827b] mt-1">Contract ops</div></div>
      </div>
      <div className="text-[10px] font-bold uppercase tracking-[.16em] text-[#82918a] px-3 mb-2">Workspace</div>
      <nav className="space-y-1">
        {nav.map(({id,label,icon:Icon,count}) => <a key={id} href={id === "overview" ? "#" : "#queue"} className={`side-link rounded-lg px-3 py-2.5 flex items-center gap-3 text-[13px] font-bold ${active === id ? "active" : "text-[#506461]"}`} onClick={(e)=>{e.preventDefault(); document.getElementById(id === "overview" ? "top" : "queue")?.scrollIntoView({behavior:"smooth"})}}><Icon size={16}/><span>{label}</span>{count && <span className="ml-auto mono text-[10px] bg-[#d4e3dc] text-[#176b67] rounded px-1.5 py-0.5">{count}</span>}</a>)}
        <a href="#review" className={`side-link rounded-lg px-3 py-2.5 flex items-center gap-3 text-[13px] font-bold ${active === "review" ? "active" : "text-[#506461]"}`}><FileText size={16}/><span>Issue review</span></a>
      </nav>
      <div className="mt-auto pt-6 border-t hairline">
        <div className="flex items-center gap-3 px-3 py-2 text-[#506461]"><div className="h-7 w-7 rounded-full bg-[#cfddd4] grid place-items-center text-[10px] font-extrabold">AM</div><div className="text-xs font-bold">Avery Morgan<div className="text-[10px] font-medium text-[#82918a]">Operations lead</div></div><Settings2 size={15} className="ml-auto"/></div>
      </div>
    </aside>
    <main className="min-w-0 flex-1 cockpit-grid">
      <header className="h-[68px] border-b hairline bg-[#f8faf5]/90 backdrop-blur-sm flex items-center justify-between px-6 lg:px-9">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#71827b]"><span className="h-2 w-2 rounded-full bg-[#3d9c72] pulse-dot"/><span>Synced just now</span><span className="mx-1 text-[#bcc9c1]">/</span><span>Tuesday, 25 Feb 2025</span></div>
        <button className="relative h-8 w-8 rounded-lg grid place-items-center text-[#58706b] hover:bg-[#e9f1eb]"><Bell size={16}/><span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 bg-[#c95143] rounded-full"/></button>
      </header>
      <div id="top" className="p-5 sm:p-7 lg:p-9 max-w-[1440px] mx-auto">
        <div className="mb-7"><div className="mono text-[10px] uppercase tracking-[.2em] text-[#b07d26] mb-2">{eyebrow}</div><h1 className="text-[29px] sm:text-[34px] leading-tight font-extrabold tracking-[-.055em]">{title}</h1><p className="text-sm text-[#61736e] mt-2">{subtitle}</p></div>
        {children}
      </div>
    </main>
  </div>
}

export const Pill = ({ tone, children }: { tone: "critical"|"watch"|"healthy"|"neutral"; children: ReactNode }) => <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[.08em] ${tone === "critical" ? "bg-[#fbe9e4] text-[#b54438]" : tone === "watch" ? "bg-[#f7efd9] text-[#956b20]" : tone === "healthy" ? "bg-[#e1f0ed] text-[#247267]" : "bg-[#e9efeb] text-[#657671]"}`}><span className={`h-1.5 w-1.5 rounded-full ${tone === "critical" ? "bg-[#c95143]" : tone === "watch" ? "bg-[#bf8d2e]" : tone === "healthy" ? "bg-[#3d9c72]" : "bg-[#83958e]"}`}/>{children}</span>;