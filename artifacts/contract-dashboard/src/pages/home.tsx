import { Link } from "wouter";
import { ArrowRight, FileText, ShieldCheck, Zap } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n";

export default function Home() {
  const { t } = useLanguage();
  return (
    <div className="min-h-[100dvh] w-full bg-background flex flex-col relative overflow-hidden">
      {/* Abstract Background Elements */}
      <div className="absolute top-0 right-0 -mr-20 -mt-20 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />
      
      <div className="flex-1 w-full max-w-7xl mx-auto px-6 py-12 flex flex-col md:flex-row items-center justify-center gap-16 relative z-10">
        
        {/* Left Side: Copy & CTA */}
        <div className="flex-1 max-w-2xl flex flex-col items-start space-y-8">
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-sm font-semibold text-primary shadow-sm">
            <span className="relative flex h-2.5 w-2.5 mr-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary"></span>
            </span>
            {t("home.operationsWorkspace")}
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-foreground leading-[1.1]">
            {t("home.stayAhead")} <br />
            <span className="text-primary">{t("home.contractRenewals")}</span>
          </h1>
          
          <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-xl">
            {t("home.description")}
          </p>
          
          <div className="flex flex-col sm:flex-row items-center gap-4 pt-4 w-full sm:w-auto">
            <Link 
              href="/dashboard" 
              className={cn(
                buttonVariants({ size: "lg" }), 
                "w-full sm:w-auto h-14 px-8 text-base shadow-xl shadow-primary/20 transition-all hover:scale-[1.02]"
              )}
            >
              {t("home.continue")}
              <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </div>
          
          <div className="flex items-center gap-8 pt-12 text-sm text-muted-foreground font-medium">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary/70" />
              <span>{t("home.enterpriseGrade")}</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary/70" />
              <span>{t("home.realtimeAlerts")}</span>
            </div>
          </div>
        </div>

        {/* Right Side: Visual/Abstract representation */}
        <div className="flex-1 hidden md:flex justify-center items-center relative">
          <div className="relative w-[480px] h-[520px] bg-card border shadow-2xl rounded-2xl p-6 flex flex-col gap-4 transform rotate-2 hover:rotate-0 transition-transform duration-500 ease-out z-10">
            <div className="flex items-center justify-between border-b pb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-primary/10 rounded-lg flex items-center justify-center">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="h-4 w-24 bg-muted rounded mb-2"></div>
                  <div className="h-3 w-16 bg-muted/50 rounded"></div>
                </div>
              </div>
              <div className="h-8 px-3 bg-destructive/10 rounded-full flex items-center justify-center border border-destructive/20">
                 <span className="text-xs font-bold text-destructive">{t("home.expiresIn3d")}</span>
              </div>
            </div>
            
            <div className="space-y-3 pt-4">
              <div className="h-3 w-full bg-muted/40 rounded"></div>
              <div className="h-3 w-5/6 bg-muted/40 rounded"></div>
              <div className="h-3 w-4/6 bg-muted/40 rounded"></div>
              <div className="h-3 w-full bg-muted/40 rounded"></div>
              <div className="h-3 w-3/4 bg-muted/40 rounded"></div>
            </div>
            
            <div className="mt-auto grid grid-cols-2 gap-4">
              <div className="h-24 bg-primary/5 rounded-xl border border-primary/10 p-4 flex flex-col justify-end">
                <div className="h-6 w-12 bg-primary/20 rounded mb-2"></div>
                <div className="h-3 w-20 bg-primary/40 rounded"></div>
              </div>
              <div className="h-24 bg-muted/30 rounded-xl border p-4 flex flex-col justify-end">
                <div className="h-6 w-16 bg-muted rounded mb-2"></div>
                <div className="h-3 w-24 bg-muted/50 rounded"></div>
              </div>
            </div>
          </div>
          
          {/* Floating element 1 */}
          <div className="absolute -left-16 top-24 bg-card border shadow-xl rounded-xl p-4 flex items-center gap-4 animate-in fade-in slide-in-from-bottom-10 duration-1000 delay-300 fill-mode-both z-20">
             <div className="h-3 w-3 bg-green-500 rounded-full shadow-[0_0_10px_rgba(34,197,94,0.5)]"></div>
             <div>
               <p className="text-sm font-bold text-foreground">{t("home.vendorApproved")}</p>
               <p className="text-xs font-medium text-muted-foreground">Alpine Cloud AG</p>
             </div>
          </div>

          {/* Floating element 2 */}
          <div className="absolute -right-8 bottom-32 bg-card border shadow-xl rounded-xl p-4 flex items-center gap-4 animate-in fade-in slide-in-from-bottom-10 duration-1000 delay-500 fill-mode-both z-20">
             <div className="h-10 w-10 bg-primary/10 rounded-full flex items-center justify-center">
                <span className="text-sm font-bold text-primary">CHF 12'000</span>
             </div>
             <div>
               <p className="text-sm font-bold text-foreground">{t("home.savingsCaptured")}</p>
               <p className="text-xs font-medium text-muted-foreground">{t("home.negotiatedRate")}</p>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}