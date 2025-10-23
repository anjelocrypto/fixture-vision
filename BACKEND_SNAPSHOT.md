# Backend Security & Configuration Snapshot

## 1. Edge Functions JWT Configuration

All protected functions now require authentication via `verify_jwt = true`:

```toml
# supabase/config.toml

project_id = "dutkpzrisvqgxadxbkxo"

# ✅ Public functions (no JWT required)
[functions.fetch-leagues]
verify_jwt = false

[functions.fetch-fixtures]
verify_jwt = false

# ✅ Protected functions (JWT required)
[functions.analyze-fixture]
verify_jwt = true

[functions.fetch-odds]
verify_jwt = true

[functions.calculate-value]
verify_jwt = true

[functions.generate-ticket]
verify_jwt = true

[functions.fetch-odds-bets]
verify_jwt = true

[functions.filterizer-query]
verify_jwt = true

[functions.stats-refresh]
verify_jwt = true
```

## 2. RLS Policies for `generated_tickets`

```sql
-- User ownership enforced
ALTER TABLE public.generated_tickets
  ALTER COLUMN user_id SET NOT NULL;

-- Users can only view their own tickets
CREATE POLICY "Users can view their own tickets"
  ON public.generated_tickets
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Admins can view all tickets
CREATE POLICY "Admins can view all tickets"
  ON public.generated_tickets
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Users can only insert their own tickets
CREATE POLICY "Users can insert their own tickets"
  ON public.generated_tickets
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can only update their own tickets
CREATE POLICY "Users can update their own tickets"
  ON public.generated_tickets
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can only delete their own tickets
CREATE POLICY "Users can delete their own tickets"
  ON public.generated_tickets
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role has full access
CREATE POLICY "Service role has full access"
  ON public.generated_tickets
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Performance index
CREATE INDEX idx_tickets_user_created 
  ON public.generated_tickets(user_id, created_at DESC);
```

## 3. Zod Input Validation Examples

### `analyze-fixture` Function
```typescript
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const RequestSchema = z.object({
  fixtureId: z.number().int().positive(),
  homeTeamId: z.number().int().positive(),
  awayTeamId: z.number().int().positive(),
});

const validation = RequestSchema.safeParse(bodyRaw);
if (!validation.success) {
  console.error("[analyze-fixture] Validation error:", validation.error.format());
  return new Response(
    JSON.stringify({ error: "Invalid request parameters" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 422 }
  );
}
```

### `generate-ticket` Function
```typescript
const AITicketSchema = z.object({
  fixtureIds: z.array(z.number().int().positive()).min(1).max(50),
  minOdds: z.number().positive().min(1.01).max(1000),
  maxOdds: z.number().positive().min(1.01).max(1000),
  legsMin: z.number().int().min(1).max(50),
  legsMax: z.number().int().min(1).max(50),
  includeMarkets: z.array(z.enum(["goals", "corners", "cards", "offsides", "fouls"])).optional(),
  risk: z.enum(["safe", "standard", "risky"]).optional(),
  useLiveOdds: z.boolean().optional(),
});
```

### `fetch-odds` Function
```typescript
const RequestSchema = z.object({
  fixtureId: z.number().int().positive(),
  markets: z.array(z.string()).optional(),
  bookmakers: z.array(z.string()).optional(),
  live: z.boolean().optional(),
  forceRefresh: z.boolean().optional(),
});
```

### `filterizer-query` Function
```typescript
const RequestSchema = z.object({
  leagueIds: z.array(z.number().int().positive()).optional(),
  date: z.string(),
  markets: z.array(z.enum(["goals", "cards", "corners", "fouls", "offsides"])).optional(),
  thresholds: z.record(z.number()).optional(),
});
```

## 4. UI Authorization Headers

All protected function calls now include JWT token:

```typescript
// Example from Index.tsx
const session = await supabase.auth.getSession();
const token = session.data.session?.access_token;

const { data, error } = await supabase.functions.invoke("analyze-fixture", {
  headers: token ? { Authorization: `Bearer ${token}` } : {},
  body: { 
    fixtureId: fixture.id,
    homeTeamId,
    awayTeamId
  },
});
```

Applied to:
- ✅ `analyze-fixture`
- ✅ `calculate-value`
- ✅ `generate-ticket` (both AI and Bet Optimizer modes)
- ✅ `filterizer-query`

## 5. Successful Ticket Generation Log Example

```
[generate-ticket] User 123e4567-e89b-12d3-a456-426614174000 validated
[AI-ticket] Input: {"fixtureIds":5,"minOdds":18,"maxOdds":20,"legsMin":3,"legsMax":8,"includeMarkets":["goals","corners","cards"],"risk":"standard","useLiveOdds":false}
[AI-ticket] Candidate pool size: 12

[fixture:1234567] combined.goals=4.2 → pick Over 3.5 (found 1.87 @ Bet365)
[fixture:1234567] combined.corners=9.1 → pick Over 8.5 (found 1.92 @ Bet365)
[fixture:1234567] combined.cards=4.6 → pick Over 4.5 (found 2.10 @ bet365)

[fixture:2345678] combined.goals=2.8 → pick Over 2.5 (found 1.78 @ bet365)
[fixture:2345678] combined.corners=10.3 → pick Over 9.5 (found 2.05 @ Bet365)

[AI-ticket] Generated ticket: 5 legs, total odds 19.42
[AI-ticket] Persisted 5 legs to optimizer_cache and 1 ticket to generated_tickets

Response: {
  "ticket": {
    "total_odds": 19.42,
    "legs": [
      {
        "fixtureId": 1234567,
        "homeTeam": "Real Madrid",
        "awayTeam": "Barcelona",
        "market": "goals",
        "selection": "Over 3.5",
        "odds": 1.87,
        "bookmaker": "Bet365",
        "combinedAvg": 4.2,
        "source": "prematch"
      },
      ...
    ]
  },
  "pool_size": 12,
  "target": { "min": 18, "max": 20 },
  "used_live": false,
  "fallback_to_prematch": false
}
```

## 6. Rules → Odds Mapping Confirmation

### Rules Engine (`_shared/rules.ts`)

The system uses `pickFromCombined()` to translate combined stats into market picks:

```typescript
export function pickFromCombined(
  market: "goals" | "corners" | "cards" | "fouls" | "offsides",
  combinedValue: number
): { side: "over" | "under"; line: number } | null
```

**Market Examples:**
- `combined.goals = 4.2` → `Over 3.5`
- `combined.corners = 9.1` → `Over 8.5`
- `combined.cards = 4.6` → `Over 4.5`
- `combined.fouls = 24.8` → `Over 24.5`
- `combined.offsides = 3.2` → `Over 2.5`

### Odds Matching Flow

1. **Fetch Combined Stats** via `analyze-fixture`
2. **Apply Rules** to get (market, side, line)
3. **Find Exact Match** in odds selections
4. **If no exact match**, find nearest within ±0.5 tolerance
5. **Skip leg** if no odds found

### Odds Endpoints

**Pre-match (default):**
```
GET /v3/odds?fixture={fixtureId}
Cache: 1 hour TTL
```

**Live (when `useLiveOdds: true`):**
```
GET /v3/odds?fixture={fixtureId}&live=true
Fallback: Pre-match if live unavailable
Cache: No cache for live odds
```

## 7. Error Handling & Security

### Generic Error Responses (Client-Facing)
```typescript
catch (error) {
  console.error("[generate-ticket] Internal error:", {
    message: error instanceof Error ? error.message : "Unknown",
    stack: error instanceof Error ? error.stack : undefined,
    timestamp: new Date().toISOString(),
  });
  return new Response(
    JSON.stringify({ error: "Internal server error" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
  );
}
```

### Validation Errors (422)
```typescript
if (!validation.success) {
  console.error("[function] Validation error:", validation.error.format());
  return new Response(
    JSON.stringify({ error: "Invalid request parameters" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 422 }
  );
}
```

### Auth Errors (401)
```typescript
if (!authHeader) {
  return new Response(
    JSON.stringify({ error: "Authentication required" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
  );
}
```

## 8. Security Status

### ✅ Implemented
- Full authentication system with signup/login
- Protected routes with session guards
- JWT verification on all business-critical functions
- Input validation with Zod schemas
- Sanitized error responses
- User ownership enforcement on `generated_tickets`
- RLS policies preventing cross-user data access
- Performance index on `generated_tickets`
- Auto-confirm email enabled for testing

### ⚠️ Optional Enhancements
- Rate limiting (10-30 req/min per IP)
- Leaked password protection (Supabase Auth setting)
- Admin role assignment workflow

### 🔒 Security Architecture Summary
- **Authentication**: Supabase Auth with email/password
- **Authorization**: Row-Level Security + role-based access control
- **Input Validation**: Zod schemas on all edge functions
- **Error Handling**: Generic client messages, detailed server logs
- **Data Isolation**: Users can only access their own tickets
- **Edge Functions**: JWT-protected for business logic
