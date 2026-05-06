ALTER TABLE savings_events
  ADD CONSTRAINT savings_events_period_end_unique UNIQUE (period_end);
