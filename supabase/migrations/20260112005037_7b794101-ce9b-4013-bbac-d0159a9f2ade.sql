-- Add ticket_mode and ticket_model_prob to generated_tickets
ALTER TABLE public.generated_tickets
ADD COLUMN IF NOT EXISTS ticket_mode TEXT,
ADD COLUMN IF NOT EXISTS ticket_model_prob NUMERIC(5,4);

-- Add constraint for ticket_model_prob (product of leg model_probs, 0-1 range)
ALTER TABLE public.generated_tickets
ADD CONSTRAINT generated_tickets_ticket_model_prob_check 
CHECK (ticket_model_prob IS NULL OR (ticket_model_prob >= 0 AND ticket_model_prob <= 1));

COMMENT ON COLUMN public.generated_tickets.ticket_model_prob IS 'Product of all leg model_probs - represents overall ticket win probability from model';

-- Add ticket_mode and ticket_model_prob to ticket_outcomes
ALTER TABLE public.ticket_outcomes
ADD COLUMN IF NOT EXISTS ticket_mode TEXT,
ADD COLUMN IF NOT EXISTS ticket_model_prob NUMERIC(5,4);

ALTER TABLE public.ticket_outcomes
ADD CONSTRAINT ticket_outcomes_ticket_model_prob_check 
CHECK (ticket_model_prob IS NULL OR (ticket_model_prob >= 0 AND ticket_model_prob <= 1));

COMMENT ON COLUMN public.ticket_outcomes.ticket_model_prob IS 'Product of all leg model_probs - represents overall ticket win probability from model';

-- Add model_prob to ticket_leg_outcomes (leg-level calibration)
ALTER TABLE public.ticket_leg_outcomes
ADD COLUMN IF NOT EXISTS model_prob NUMERIC(5,4);

ALTER TABLE public.ticket_leg_outcomes
ADD CONSTRAINT ticket_leg_outcomes_model_prob_check 
CHECK (model_prob IS NULL OR (model_prob >= 0 AND model_prob <= 1));

COMMENT ON COLUMN public.ticket_leg_outcomes.model_prob IS 'Model confidence for this specific leg (0-1), used for calibration analysis';