import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LanguageProvider } from '@/lib/i18n';
import NotFound from '@/pages/not-found';
import Home from '@/pages/home';
import Dashboard from '@/pages/dashboard';
import Review from '@/pages/review-compact';
import ContractDecisionPage from '@/pages/contract-decision';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/action-items" component={Dashboard} />
        <Route path="/review" component={Review} />
        <Route path="/contracts/:id/edit" component={Review} />
        <Route path="/contracts/:id" component={ContractDecisionPage} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </LanguageProvider>
  );
}

export default App;
