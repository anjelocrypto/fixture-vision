import { Link } from "react-router-dom";

const Footer = () => {
  return (
    <footer className="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <span>© {new Date().getFullYear()} Ticket AI.</span>
            <span className="hidden sm:inline">All rights reserved.</span>
          </div>
          
          <nav className="flex items-center gap-4 sm:gap-6">
            <Link 
              to="/legal/terms" 
              className="hover:text-foreground transition-colors"
            >
              Terms
            </Link>
            <Link 
              to="/legal/privacy" 
              className="hover:text-foreground transition-colors"
            >
              Privacy
            </Link>
            <a 
              href="/legal/terms#fees-refunds" 
              className="hover:text-foreground transition-colors"
            >
              Refund Policy
            </a>
          </nav>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
