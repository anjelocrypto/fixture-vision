import { Home, TrendingUp, Ticket, User } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTicket } from "@/stores/useTicket";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { key: "home", icon: Home, route: "/", label: "Home" },
  { key: "markets", icon: TrendingUp, route: "/markets", label: "Markets" },
  { key: "ticket", icon: Ticket, route: "__ticket__", label: "Ticket" },
  { key: "account", icon: User, route: "/account", label: "Account" },
] as const;

/** Routes that show the bottom nav (authenticated app routes only) */
const BOTTOM_NAV_ROUTES = [
  "/",
  "/basketball",
  "/hockey",
  "/markets",
  "/account",
  "/admin/health",
];

function matchRoute(pathname: string): boolean {
  // exact match or starts-with for nested routes like /markets/:id
  return BOTTOM_NAV_ROUTES.some(
    (r) => pathname === r || (r === "/markets" && pathname.startsWith("/markets/"))
  );
}

interface MobileBottomNavProps {
  onTicketOpen: () => void;
}

export function MobileBottomNav({ onTicketOpen }: MobileBottomNavProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { legs } = useTicket();

  if (!matchRoute(location.pathname)) return null;

  const handleTap = (item: (typeof NAV_ITEMS)[number]) => {
    if (item.route === "__ticket__") {
      onTicketOpen();
      return;
    }
    navigate(item.route);
  };

  const isActive = (item: (typeof NAV_ITEMS)[number]) => {
    if (item.route === "__ticket__") return false;
    if (item.route === "/") return location.pathname === "/";
    return location.pathname.startsWith(item.route);
  };

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-50 border-t bg-background/95 backdrop-blur-md"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="flex items-center justify-around h-14">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item);
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              onClick={() => handleTap(item)}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 w-16 h-full transition-colors relative",
                active
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium leading-none">
                {item.label}
              </span>
              {item.key === "ticket" && legs.length > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute -top-0.5 right-1.5 h-4 min-w-[16px] flex items-center justify-center p-0 text-[9px]"
                >
                  {legs.length}
                </Badge>
              )}
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
