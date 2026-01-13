import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { CalendarIcon, Plus, Check, X, RotateCcw, Loader2, Shield } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import { Market, useMarkets, useCreateMarket, useResolveMarket } from "@/hooks/useMarkets";
import { AdminFixturesDashboard } from "./AdminFixturesDashboard";

const createMarketSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters"),
  description: z.string().optional(),
  category: z.string().default("football"),
  closes_at: z.date({ required_error: "Closing date is required" }),
  initial_odds_yes: z.number().min(1.01).max(100).default(2.0),
  initial_odds_no: z.number().min(1.01).max(100).default(2.0),
  fixture_id: z.number().optional(),
  resolution_rule: z.string().optional(),
});

type CreateMarketFormData = z.infer<typeof createMarketSchema>;

export function AdminMarketControls() {
  const { t } = useTranslation("common");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  
  const { data: openMarkets } = useMarkets("open");
  const { data: closedMarkets } = useMarkets("closed");
  const createMarket = useCreateMarket();
  const resolveMarket = useResolveMarket();

  const form = useForm<CreateMarketFormData>({
    resolver: zodResolver(createMarketSchema),
    defaultValues: {
      title: "",
      description: "",
      category: "football",
      initial_odds_yes: 2.0,
      initial_odds_no: 2.0,
    },
  });

  const handleCreateMarket = async (data: CreateMarketFormData) => {
    try {
      await createMarket.mutateAsync({
        title: data.title,
        description: data.description,
        category: data.category,
        closes_at: data.closes_at.toISOString(),
        initial_odds_yes: data.initial_odds_yes,
        initial_odds_no: data.initial_odds_no,
        fixture_id: data.fixture_id,
      });
      toast.success("Market created successfully");
      setCreateDialogOpen(false);
      form.reset();
    } catch (error: any) {
      toast.error(error.message || "Failed to create market");
    }
  };

  const handleResolve = async (marketId: string, outcome: "yes" | "no" | null) => {
    const actionLabel = outcome === null ? "void" : outcome;
    try {
      await resolveMarket.mutateAsync({
        market_id: marketId,
        winning_outcome: outcome as "yes" | "no" | "void",
      });
      toast.success(`Market resolved: ${actionLabel.toUpperCase()}`);
    } catch (error: any) {
      toast.error(error.message || "Failed to resolve market");
    }
  };

  const allManageableMarkets = [...(openMarkets || []), ...(closedMarkets || [])];

  return (
    <div className="space-y-4">
      {/* Fixtures Dashboard - Primary way to create markets */}
      <AdminFixturesDashboard />

      {/* Manual Controls */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-amber-600">
            <Shield className="h-5 w-5" />
            Manual Admin Controls
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Create Market Button */}
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="w-full" variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              Create Market
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create New Market</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleCreateMarket)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title *</FormLabel>
                      <FormControl>
                        <Input placeholder="Will Team X score 2+ goals?" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Optional market details..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="closes_at"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Closes At *</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full pl-3 text-left font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              {field.value ? format(field.value, "PPP HH:mm") : "Select date & time"}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value}
                            onSelect={field.onChange}
                            disabled={(date) => date < new Date()}
                            initialFocus
                          />
                          <div className="p-3 border-t">
                            <Label>Time</Label>
                            <Input
                              type="time"
                              onChange={(e) => {
                                const [hours, minutes] = e.target.value.split(":").map(Number);
                                const newDate = field.value ? new Date(field.value) : new Date();
                                newDate.setHours(hours, minutes);
                                field.onChange(newDate);
                              }}
                            />
                          </div>
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="initial_odds_yes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Odds YES</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            {...field}
                            onChange={(e) => field.onChange(parseFloat(e.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="initial_odds_no"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Odds NO</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            {...field}
                            onChange={(e) => field.onChange(parseFloat(e.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="fixture_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fixture ID (optional)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="e.g., 123456"
                          {...field}
                          onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button type="submit" className="w-full" disabled={createMarket.isPending}>
                  {createMarket.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Create Market
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        {/* Manageable Markets List */}
        {allManageableMarkets.length > 0 ? (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Pending Resolution</h4>
            {allManageableMarkets.map((market) => (
              <MarketAdminRow
                key={market.id}
                market={market}
                onResolve={handleResolve}
                isResolving={resolveMarket.isPending}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-2">
            No markets pending resolution.
          </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MarketAdminRow({
  market,
  onResolve,
  isResolving,
}: {
  market: Market;
  onResolve: (marketId: string, outcome: "yes" | "no" | null) => void;
  isResolving: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-2 rounded-md bg-card/50 border text-sm">
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{market.title}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="text-xs">
            {market.status}
          </Badge>
          <span>Closes: {format(new Date(market.closes_at), "MMM d, HH:mm")}</span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-green-600 hover:text-green-700 hover:bg-green-500/10"
          onClick={() => onResolve(market.id, "yes")}
          disabled={isResolving || market.status === "resolved"}
          title="Resolve YES"
        >
          <Check className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-red-600 hover:text-red-700 hover:bg-red-500/10"
          onClick={() => onResolve(market.id, "no")}
          disabled={isResolving || market.status === "resolved"}
          title="Resolve NO"
        >
          <X className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-muted-foreground hover:bg-muted"
          onClick={() => onResolve(market.id, null)}
          disabled={isResolving || market.status === "resolved"}
          title="Void / Refund"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
